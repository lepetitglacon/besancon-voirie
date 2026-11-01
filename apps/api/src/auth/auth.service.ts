import { ConflictException, ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { hash, verify } from '@node-rs/argon2';
import type { Inscription, Session } from '@voirie/schema';
import type { Response } from 'express';
import { DRIZZLE, type Db } from '../db/db.module.js';
import { utilisateur } from '../db/schema.js';
import type { UtilisateurConnecte } from './acces.js';
import { ComptesService, type LigneUtilisateur } from './comptes.service.js';
import { COOKIE_SESSION, ConfigAuth } from './config-auth.js';
import { JetonsService } from './jetons.service.js';
import { MailService } from './mail.service.js';

/** Contenu du JWT : le compte et la version de ses sessions (révocation). */
export interface ContenuJeton {
  sub: string;
  v: number;
}

/** Profil Google utile à la connexion. */
export interface ProfilGoogle {
  id: string;
  email: string | null;
  emailVerifie: boolean;
  nom: string;
}

/** Aller-retour Google : connexion, ou liaison au compte déjà connecté. */
export interface EtatGoogle {
  mode: 'connexion' | 'liaison';
  retour: string;
}

export interface ResultatGoogle {
  utilisateur: LigneUtilisateur;
  /** Compte créé à cette connexion : il choisit ensuite ses rôles. */
  nouveau: boolean;
}

const IDENTIFIANTS_INCORRECTS = 'E-mail ou mot de passe incorrect';

@Injectable()
export class AuthService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly comptes: ComptesService,
    private readonly jetons: JetonsService,
    private readonly mail: MailService,
    private readonly jwt: JwtService,
    private readonly config: ConfigAuth,
  ) {}

  /** Inscription par mot de passe : le compte s'active par le lien envoyé par e-mail. */
  async inscrire({ nom, email, motDePasse, roles }: Inscription): Promise<void> {
    if (await this.comptes.parEmail(email)) {
      throw new ConflictException('Un compte existe déjà avec cette adresse : connectez-vous, ou utilisez « Mot de passe oublié »');
    }
    const [ligne] = await this.db
      .insert(utilisateur)
      .values({ email, nom, motDePasse: await hash(motDePasse) })
      .returning();
    await this.comptes.demanderRoles(ligne.id, roles);
    await this.mail.verification(email, await this.jetons.creer(ligne.id, 'verification_email'));
  }

  async verifierEmail(jeton: string): Promise<LigneUtilisateur> {
    const id = await this.jetons.consommer(jeton, 'verification_email');
    return this.comptes.modifier(id, { emailVerifieLe: new Date() });
  }

  /** Stratégie locale : refuse sans dire si l'e-mail existe. */
  async validerIdentifiants(email: string, motDePasse: string): Promise<LigneUtilisateur> {
    const ligne = await this.comptes.parEmail(email);
    if (!ligne?.motDePasse || !(await verify(ligne.motDePasse, motDePasse))) {
      throw new UnauthorizedException(IDENTIFIANTS_INCORRECTS);
    }
    if (!ligne.actif) throw new ForbiddenException('Compte désactivé');
    if (!ligne.emailVerifieLe) {
      await this.mail.verification(ligne.email, await this.jetons.creer(ligne.id, 'verification_email'));
      throw new ForbiddenException('Adresse e-mail non confirmée : un nouveau lien vient de vous être envoyé');
    }
    return ligne;
  }

  /**
   * Connexion Google, fusionnée avec le compte local de même e-mail :
   * 1. compte Google déjà connu → connexion ;
   * 2. liaison demandée depuis un compte connecté → rattachement à ce compte ;
   * 3. même e-mail (vérifié par Google) → rattachement. Un compte local jamais confirmé perd
   *    son mot de passe : son auteur n'a pas prouvé posséder l'adresse ;
   * 4. sinon, nouveau compte, sans rôle.
   */
  async connexionGoogle(profil: ProfilGoogle, etat: EtatGoogle, courant: UtilisateurConnecte | null): Promise<ResultatGoogle> {
    const lie = await this.comptes.parGoogleId(profil.id);
    if (etat.mode === 'liaison') {
      if (!courant) throw new UnauthorizedException('Connectez-vous avant de lier un compte Google');
      if (lie && lie.id !== courant.id) throw new ConflictException('Ce compte Google est déjà lié à un autre compte');
      return { utilisateur: await this.comptes.modifier(courant.id, { googleId: profil.id }), nouveau: false };
    }
    if (lie) return { utilisateur: this.actif(lie), nouveau: false };

    if (!profil.email || !profil.emailVerifie) throw new ForbiddenException('Adresse e-mail Google non vérifiée');
    const existant = await this.comptes.parEmail(profil.email);
    if (existant) {
      const confirme = existant.emailVerifieLe !== null;
      const ligne = await this.comptes.modifier(existant.id, {
        googleId: profil.id,
        emailVerifieLe: existant.emailVerifieLe ?? new Date(),
        ...(confirme ? {} : { motDePasse: null }),
      });
      return { utilisateur: this.actif(ligne), nouveau: false };
    }
    const [ligne] = await this.db
      .insert(utilisateur)
      .values({ email: profil.email, nom: profil.nom || profil.email.split('@')[0], googleId: profil.id, emailVerifieLe: new Date() })
      .returning();
    return { utilisateur: ligne, nouveau: true };
  }

  private actif(ligne: LigneUtilisateur): LigneUtilisateur {
    if (!ligne.actif) throw new ForbiddenException('Compte désactivé');
    return ligne;
  }

  /** Pose le JWT de l'app en cookie et renvoie la session. */
  async ouvrirSession(res: Response, ligne: LigneUtilisateur): Promise<Session> {
    const misAJour = await this.comptes.modifier(ligne.id, { derniereConnexionLe: new Date() });
    const contenu: ContenuJeton = { sub: misAJour.id, v: misAJour.versionJeton };
    const jeton = await this.jwt.signAsync(contenu, { expiresIn: `${this.config.dureeSessionJours}d` });
    res.cookie(COOKIE_SESSION, jeton, this.config.cookie(this.config.dureeSessionMs));
    return this.comptes.session(await this.comptes.connecte(misAJour));
  }

  /** Compte du cookie de session, s'il est valide (liaison Google). */
  async connecteDepuisCookie(jeton: string | undefined): Promise<UtilisateurConnecte | null> {
    if (!jeton) return null;
    try {
      const contenu = await this.jwt.verifyAsync<ContenuJeton>(jeton);
      return await this.comptes.chargerConnecte(contenu.sub, contenu.v);
    } catch {
      return null;
    }
  }

  fermerSession(res: Response): void {
    res.clearCookie(COOKIE_SESSION, { ...this.config.cookie(0), maxAge: undefined });
  }

  /** Toujours silencieux : ne révèle pas si l'adresse a un compte. */
  async motDePasseOublie(email: string): Promise<void> {
    const ligne = await this.comptes.parEmail(email);
    if (!ligne?.actif) return;
    await this.mail.reinitialisation(ligne.email, await this.jetons.creer(ligne.id, 'reinitialisation_mdp'));
  }

  /** Nouveau mot de passe par lien : l'adresse est prouvée, les autres sessions sont fermées. */
  async reinitialiser(jeton: string, motDePasse: string): Promise<LigneUtilisateur> {
    const id = await this.jetons.consommer(jeton, 'reinitialisation_mdp');
    const ligne = await this.comptes.revoquerSessions(id);
    return this.comptes.modifier(id, {
      motDePasse: await hash(motDePasse),
      emailVerifieLe: ligne.emailVerifieLe ?? new Date(),
    });
  }

  async changerMotDePasse(connecte: UtilisateurConnecte, actuel: string | undefined, nouveau: string): Promise<LigneUtilisateur> {
    const ligne = await this.comptes.parId(connecte.id);
    if (ligne?.motDePasse && !(actuel && (await verify(ligne.motDePasse, actuel)))) {
      throw new ForbiddenException('Mot de passe actuel incorrect');
    }
    await this.comptes.revoquerSessions(connecte.id);
    return this.comptes.modifier(connecte.id, { motDePasse: await hash(nouveau) });
  }
}
