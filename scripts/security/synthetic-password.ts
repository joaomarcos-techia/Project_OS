import { randomBytes } from 'node:crypto';

export function requireSyntheticPassword(value: string | undefined, variable: string): string {
  if (!value || value.length < 16) {
    throw new Error(`${variable} deve conter pelo menos 16 caracteres para executar este script.`);
  }
  return value;
}

export function randomSyntheticPassword(): string {
  return randomBytes(32).toString('base64url');
}
