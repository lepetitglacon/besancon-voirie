import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ROLES, type Role } from '@voirie/schema';
import nodemailer, { type Transporter } from 'nodemailer';
import { ConfigAuth } from './config-auth.js';

/**
 * E-mails des comptes, par SMTP_URL (smtp://utilisateur:mot-de-passe@hote:587). Sans SMTP_URL
 * (développement), le message et son lien sont écrits dans les logs de l'API.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transport: Transporter | null;
  private readonly expediteur: string;

  constructor(
    config: ConfigService,
    private readonly auth: ConfigAuth,
  ) {
    const url = config.get<string>('SMTP_URL');
    this.transport = url ? nodemailer.createTransport(url) : null;
    this.expediteur = config.get<string>('MAIL_EXPEDITEUR') || 'Besançon Voirie <ne-pas-repondre@localhost>';
  }

  verification(email: string, jeton: string) {
    return this.envoyer(
      email,
      'Confirmez votre adresse e-mail',
      `Bonjour,\n\nPour activer votre compte Besançon Voirie, ouvrez ce lien (valable 48 heures) :\n${this.lien('/verification', jeton)}\n\nSi vous n'êtes pas à l'origine de cette inscription, ignorez ce message.`,
    );
  }

  reinitialisation(email: string, jeton: string) {
    return this.envoyer(
      email,
      'Nouveau mot de passe',
      `Bonjour,\n\nPour choisir un nouveau mot de passe, ouvrez ce lien (valable 1 heure) :\n${this.lien('/reinitialisation', jeton)}\n\nSi vous n'avez rien demandé, ignorez ce message : votre mot de passe ne change pas.`,
    );
  }

  decisionRole(email: string, role: Role, decision: 'accorde' | 'refuse') {
    const libelle = ROLES[role].libelle;
    return this.envoyer(
      email,
      decision === 'accorde' ? `Rôle accordé : ${libelle}` : `Rôle refusé : ${libelle}`,
      decision === 'accorde'
        ? `Bonjour,\n\nVotre demande « ${libelle} » est acceptée. Les outils correspondants sont disponibles sur ${this.auth.urlPublique}.`
        : `Bonjour,\n\nVotre demande « ${libelle} » n'a pas été retenue. Vous pouvez la renouveler depuis les paramètres de votre compte.`,
    );
  }

  private lien(chemin: string, jeton: string) {
    return `${this.auth.urlPublique}${chemin}?jeton=${encodeURIComponent(jeton)}`;
  }

  private async envoyer(destinataire: string, sujet: string, texte: string) {
    if (!this.transport) {
      this.logger.log(`E-mail non envoyé (pas de SMTP_URL) à ${destinataire} — ${sujet}\n${texte}`);
      return;
    }
    try {
      await this.transport.sendMail({ from: this.expediteur, to: destinataire, subject: `Besançon Voirie — ${sujet}`, text: texte });
    } catch (erreur) {
      // L'opération (inscription, demande…) est faite : un échec d'envoi ne l'annule pas.
      this.logger.error(`Échec d'envoi à ${destinataire} : ${(erreur as Error).message}`);
    }
  }
}
