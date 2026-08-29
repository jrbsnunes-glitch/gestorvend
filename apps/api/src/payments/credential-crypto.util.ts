import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

function deriveKey(): Buffer {
  const secret =
    process.env.PAYMENT_CREDENTIALS_KEY?.trim() ||
    process.env.JWT_ACCESS_SECRET?.trim() ||
    'gv-payment-dev-insecure';
  return scryptSync(secret, 'gv-payment-creds-v1', 32);
}

export function encryptSecret(plain: string): string {
  if (!plain) return '';
  const key = deriveKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

export function decryptSecret(enc: string | null | undefined): string {
  if (!enc?.trim()) return '';
  const buf = Buffer.from(enc, 'base64');
  if (buf.length < 29) return '';
  const key = deriveKey();
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

export function maskSecret(value: string | null | undefined, visible = 4): string {
  if (!value?.trim()) return '';
  const v = value.trim();
  if (v.length <= visible) return '••••';
  return `${'•'.repeat(Math.min(8, v.length - visible))}${v.slice(-visible)}`;
}
