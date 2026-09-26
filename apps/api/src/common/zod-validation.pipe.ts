import { BadRequestException, type PipeTransform } from '@nestjs/common';
import type { z } from 'zod';

/**
 * Valide et transforme une entrée avec un schéma zod de @voirie/schema.
 * (nestjs-zod ne supporte pas encore Nest 12.)
 */
export class ZodValidationPipe<T extends z.ZodType> implements PipeTransform<unknown, z.output<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.output<T> {
    const resultat = this.schema.safeParse(value);
    if (!resultat.success) {
      throw new BadRequestException({
        message: 'Requête invalide',
        issues: resultat.error.issues.map(({ path, message }) => ({ path, message })),
      });
    }
    return resultat.data;
  }
}
