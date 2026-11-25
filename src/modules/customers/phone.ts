/**
 * Normalizes a phone number to digits only.
 * Brazilian 10- or 11-digit numbers without country code receive the `55` prefix.
 */
export function normalizePhone(raw: string): string {
  const hasPlusPrefix = raw.trim().startsWith('+');
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  if (!hasPlusPrefix && (digits.length === 10 || digits.length === 11) && !digits.startsWith('55')) {
    return `55${digits}`;
  }
  return digits;
}

export function isValidNormalizedPhone(phone: string): boolean {
  return /^\d{10,15}$/.test(phone);
}
