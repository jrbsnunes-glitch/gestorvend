/** Código numérico da UF utilizado na chave NFC-e/NF-e (2 dígitos). */
export const UF_IBGE_DIGITS: Record<string, string> = {
  RO: '11',
  AC: '12',
  AM: '13',
  RR: '14',
  PA: '15',
  AP: '16',
  TO: '17',
  MA: '21',
  PI: '22',
  CE: '23',
  RN: '24',
  PB: '25',
  PE: '26',
  AL: '27',
  SE: '28',
  BA: '29',
  MG: '31',
  ES: '32',
  RJ: '33',
  SP: '35',
  PR: '41',
  SC: '42',
  RS: '43',
  MS: '50',
  MT: '51',
  GO: '52',
  DF: '53',
};

export function ufToCodIbge(siglaRaw: string | null | undefined): string {
  const k = String(siglaRaw ?? '')
    .trim()
    .toUpperCase();
  return UF_IBGE_DIGITS[k] ?? '35';
}
