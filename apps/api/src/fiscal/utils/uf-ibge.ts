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

/** Código IBGE da capital da UF — fallback de cMun/cMunFG quando o cadastro ainda não informou o município. */
export const UF_CAPITAL_IBGE: Record<string, string> = {
  AC: '1200401',
  AL: '2704302',
  AM: '1302603',
  AP: '1600303',
  BA: '2927408',
  CE: '2304400',
  DF: '5300108',
  ES: '3205309',
  GO: '5208707',
  MA: '2111300',
  MG: '3106200',
  MS: '5002704',
  MT: '5103403',
  PA: '1501402',
  PB: '2507507',
  PE: '2611606',
  PI: '2211001',
  PR: '4106902',
  RJ: '3304557',
  RN: '2408102',
  RO: '1100205',
  RR: '1400100',
  RS: '4314902',
  SC: '4205407',
  SE: '2800308',
  SP: '3550308',
  TO: '1721000',
};

export function ufCapitalIbge(siglaRaw: string | null | undefined): string {
  const k = String(siglaRaw ?? '')
    .trim()
    .toUpperCase();
  return UF_CAPITAL_IBGE[k] ?? '3550308';
}
