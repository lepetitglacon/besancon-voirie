import { type CanActivate, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Autorise les routes d'écriture (composition des carrefours…) uniquement quand
 * EDITION_LOCALE=true. Protection provisoire pour le développement local, en attendant
 * l'authentification admin (docs/ARCHITECTURE.md §12).
 */
@Injectable()
export class EditionGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(): boolean {
    if (this.config.get<string>('EDITION_LOCALE') === 'true') return true;
    throw new ForbiddenException('Édition désactivée (EDITION_LOCALE=true pour le développement local)');
  }
}
