import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';
import { DRIZZLE, type Db } from '../db/db.module.js';
import { jetonUtilisateur, typeJetonUtilisateur } from '../db/schema.js';

type TypeJeton = (typeof typeJetonUtilisateur.enumValues)[number];

const DUREE_MIN: Record<TypeJeton, number> = {
  verification_email: 48 * 60,
  reinitialisation_mdp: 60,
};

const empreinte = (jeton: string) => createHash('sha256').update(jeton).digest('hex');

/** Jetons à usage unique des liens envoyés par e-mail (vérification, mot de passe oublié). */
@Injectable()
export class JetonsService {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  /** Nouveau jeton en clair ; les précédents du même type ne servent plus. */
  async creer(utilisateurId: string, type: TypeJeton): Promise<string> {
    const jeton = randomBytes(32).toString('base64url');
    await this.db.transaction(async (tx) => {
      await tx
        .delete(jetonUtilisateur)
        .where(and(eq(jetonUtilisateur.utilisateurId, utilisateurId), eq(jetonUtilisateur.type, type)));
      await tx.insert(jetonUtilisateur).values({
        utilisateurId,
        type,
        hash: empreinte(jeton),
        expireLe: new Date(Date.now() + DUREE_MIN[type] * 60_000),
      });
    });
    return jeton;
  }

  /** Utilise le jeton et renvoie son compte. */
  async consommer(jeton: string, type: TypeJeton): Promise<string> {
    const [ligne] = await this.db
      .update(jetonUtilisateur)
      .set({ utiliseLe: new Date() })
      .where(
        and(
          eq(jetonUtilisateur.hash, empreinte(jeton)),
          eq(jetonUtilisateur.type, type),
          isNull(jetonUtilisateur.utiliseLe),
          gt(jetonUtilisateur.expireLe, new Date()),
        ),
      )
      .returning({ utilisateurId: jetonUtilisateur.utilisateurId });
    if (!ligne) throw new BadRequestException('Lien invalide ou expiré');
    return ligne.utilisateurId;
  }
}
