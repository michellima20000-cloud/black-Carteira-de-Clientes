import { z } from 'zod';
import { ValidationError } from './app-error';

export function parseInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ValidationError(z.flattenError(result.error));
  }
  return result.data;
}
