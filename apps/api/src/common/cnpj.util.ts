/** Remove máscara e mantém até 14 dígitos. */
export function digitsCnpj(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 14);
}

export function validateCnpj14(cnpjRaw: string): { ok: true; cnpj: string } | { ok: false; reason: string } {
  const cnpj = digitsCnpj(cnpjRaw);
  if (cnpj.length !== 14) {
    return { ok: false, reason: 'CNPJ deve ter 14 dígitos.' };
  }
  if (/^(\d)\1{13}$/.test(cnpj) || cnpj === '00000000000000') {
    return { ok: false, reason: 'CNPJ inválido (zeros ou sequência repetida).' };
  }

  const dv = (base: string, weights: number[]): number => {
    let sum = 0;
    for (let i = 0; i < weights.length; i++) {
      sum += Number(base[i]!) * weights[i]!;
    }
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };

  const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const d1 = dv(cnpj.slice(0, 12), w1);
  const d2 = dv(cnpj.slice(0, 12) + String(d1), w2);
  if (cnpj[12] !== String(d1) || cnpj[13] !== String(d2)) {
    return { ok: false, reason: 'Dígitos verificadores do CNPJ estão incorretos.' };
  }

  return { ok: true, cnpj };
}
