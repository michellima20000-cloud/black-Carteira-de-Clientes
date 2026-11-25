import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const PREFIX = 'enc:v1:';
const ALGORITHM = 'aes-256-gcm';

function deriveKey(secret: string): Buffer {
  return createHash('sha256').update(secret).digest();
}

/**
 * Criptografa segredos (tokens da Meta) antes de persistir no banco.
 * Formato: enc:v1:<iv>:<authTag>:<ciphertext> (base64url)
 */
export function encryptSecret(value: string, secret: string): string {
  if (!value) return value;

  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, deriveKey(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return (
    PREFIX +
    [iv.toString('base64url'), authTag.toString('base64url'), ciphertext.toString('base64url')].join(
      ':',
    )
  );
}

/**
 * Descriptografa segredos. Valores legados sem o prefixo são retornados como estão,
 * mantendo compatibilidade com configurações gravadas antes da criptografia.
 */
export function decryptSecret(value: string, secret: string): string {
  if (!value.startsWith(PREFIX)) return value;

  const [ivPart, authTagPart, ciphertextPart] = value.slice(PREFIX.length).split(':');
  if (!ivPart || !authTagPart || !ciphertextPart) {
    throw new Error('Segredo criptografado em formato inválido.');
  }

  const decipher = createDecipheriv(
    ALGORITHM,
    deriveKey(secret),
    Buffer.from(ivPart, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(authTagPart, 'base64url'));

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextPart, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

/** Gera um token de verificação de webhook aleatório e seguro. */
export function generateWebhookSecret(): string {
  return randomBytes(24).toString('hex');
}
