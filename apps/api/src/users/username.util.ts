/**
 * Normalização e validação do login (username) do tenant.
 * Regras: 3–32 chars, minúsculas, apenas [a-z0-9._-]
 */

const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;

export function normalizeUsername(raw: string): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '');
}

/** Deriva username a partir do e-mail (parte local) ou de um raw explícito. */
export function usernameFromEmail(email: string): string {
  const local = String(email ?? '').split('@')[0] ?? '';
  let u = normalizeUsername(local);
  if (u.length < 3) {
    u = `user_${u}`.slice(0, 32);
  }
  if (u.length < 3) {
    u = 'user';
  }
  return u.slice(0, 32);
}

export function assertValidUsername(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new Error('Informe o usuário de login.');
  }
  const u = normalizeUsername(raw);
  if (!USERNAME_RE.test(u)) {
    throw new Error(
      'Usuário inválido: use 3 a 32 caracteres (letras, números, ponto, underscore ou hífen).',
    );
  }
  return u;
}
