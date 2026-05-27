/**
 * DV da chave (44ª posição) pelo algoritmo da NF-e/NFC-e (pesos 2–9 repetidos sobre as 43 posições).
 */
export function nfeDvBase43Chars(base43Digits: string): string {
  if (!/^\d{43}$/.test(base43Digits)) {
    throw new Error('Base da chave deve ter exatamente 43 dígitos numéricos.');
  }
  let sum = 0;
  let mult = 2;
  for (let i = base43Digits.length - 1; i >= 0; i--) {
    sum += Number(base43Digits.charAt(i)) * mult;
    mult += 1;
    if (mult > 9) mult = 2;
  }
  const mod11 = sum % 11;
  const dv = mod11 === 0 || mod11 === 1 ? 0 : 11 - mod11;
  return String(dv);
}

/**
 * Monta 44 dígitos da chave NFC-e modelo 65: cUF + AAMM + CNPJ(14) + mod(02) + série(03) +
 * nNF(09) + tpEmiss(01) + cNF(08) + DV(01).
 */
export function buildNfceAccessKey(parts: {
  codUf: string;
  aammEmissao: string; // AAAAMM só 4 dígitos yyMM oficial — usamos apenas mm? Manual: últimos dois do ano + mês YYMM na chave são "AAMM" (4 dígitos)
  cnpj14: string;
  serie3: number;
  nNF9: number;
  tpEmis: number;
  codigoNumerico8: number;
}): string {
  const yyMM = parts.aammEmissao.replace(/\D/g, '').slice(0, 4).padStart(4, '0');
  const cnpj14 = parts.cnpj14.replace(/\D/g, '').slice(0, 14).padStart(14, '0');
  const serie = String(parts.serie3).padStart(3, '0').slice(-3);
  const nnf = String(parts.nNF9).padStart(9, '0').slice(-9);
  const tp = String(parts.tpEmis).replace(/\D/g, '').slice(0, 1);
  const cNF = String(parts.codigoNumerico8).padStart(8, '0').slice(-8);
  const base43 =
    parts.codUf.replace(/\D/g, '').padStart(2, '0').slice(-2) +
    yyMM +
    cnpj14 +
    '65' +
    serie +
    nnf +
    tp +
    cNF;
  if (base43.length !== 43) {
    throw new Error(`Chave base inválida (${base43.length} dígitos).`);
  }
  return base43 + nfeDvBase43Chars(base43);
}
