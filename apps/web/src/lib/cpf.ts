/** Validação de CPF no frontend (espelha a API). */
export function validateCpf(cpfRaw: string): { ok: true; cpf: string } | { ok: false; reason: string } {
  const cpf = String(cpfRaw ?? '').replace(/\D/g, '').slice(0, 11);
  if (!cpf) return { ok: true, cpf: '' };
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

/** Valida documento se for CPF (11) ou deixa CNPJ para a API. */
export function validateDocumentIfCpf(docRaw: string): string | null {
  const d = String(docRaw ?? '').replace(/\D/g, '');
  if (!d) return null;
  if (d.length === 11) {
    const r = validateCpf(d);
    return r.ok ? null : r.reason;
  }
  if (d.length === 14 || d.length < 11) return null;
  return 'Documento incompleto (CPF 11 ou CNPJ 14 dígitos).';
}
