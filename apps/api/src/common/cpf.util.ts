/** Validação de CPF (11 dígitos + DV). */
export function digitsCpf(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 11);
}

export function validateCpf11(cpfRaw: string): { ok: true; cpf: string } | { ok: false; reason: string } {
  const cpf = digitsCpf(cpfRaw);
  if (cpf.length !== 11) {
    return { ok: false, reason: 'CPF deve ter 11 dígitos.' };
  }
  if (/^(\d)\1{10}$/.test(cpf)) {
    return { ok: false, reason: 'CPF inválido (sequência repetida).' };
  }

  const calc = (base: string, factor: number): number => {
    let sum = 0;
    for (let i = 0; i < base.length; i++) {
      sum += Number(base[i]!) * (factor - i);
    }
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };

  const d1 = calc(cpf.slice(0, 9), 10);
  const d2 = calc(cpf.slice(0, 10), 11);
  if (cpf[9] !== String(d1) || cpf[10] !== String(d2)) {
    return { ok: false, reason: 'Dígitos verificadores do CPF estão incorretos.' };
  }
  return { ok: true, cpf };
}
