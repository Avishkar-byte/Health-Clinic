import { PipeTransform, BadRequestException } from '@nestjs/common';
import { ZodSchema, ZodError } from 'zod';

/**
 * Validates request body against a zod schema.
 * Uses shared schemas from @healthcare/contracts.
 */
export class ZodValidationPipe implements PipeTransform {
  constructor(private schema: ZodSchema) {}

  transform(value: unknown) {
    try {
      return this.schema.parse(value);
    } catch (error) {
      if (error instanceof ZodError) {
        const messages = error.errors.map(
          (e) => `${e.path.join('.')}: ${e.message}`,
        );
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          title: 'Validation failed',
          detail: messages.join('; '),
          errors: error.errors,
        });
      }
      throw error;
    }
  }
}
