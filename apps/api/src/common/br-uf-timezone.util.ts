/** Fuso IANA padrão por UF (Brasil). Demais UFs usam America/Sao_Paulo. */
const UF_TIMEZONE: Record<string, string> = {
  AC: 'America/Rio_Branco',
  AM: 'America/Manaus',
  MS: 'America/Cuiaba',
  MT: 'America/Cuiaba',
  RO: 'America/Porto_Velho',
  RR: 'America/Boa_Vista',
};

export const DEFAULT_BUSINESS_TIMEZONE = 'America/Sao_Paulo';

export function timezoneFromBrazilUf(uf: string | null | undefined): string {
  const key = String(uf ?? '')
    .trim()
    .toUpperCase();
  if (key.length !== 2) return DEFAULT_BUSINESS_TIMEZONE;
  return UF_TIMEZONE[key] ?? DEFAULT_BUSINESS_TIMEZONE;
}
