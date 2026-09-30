/** Textos exigidos/recomendados pela SEFAZ em tpAmb=2 (homologação). */
export const HOMOLOG_FISCAL_LABEL =
  'NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL';

const HOMOLOG_DEST_XNOME = HOMOLOG_FISCAL_LABEL.slice(0, 60);

export function homologFieldText(name: string, tpAmb: 1 | 2, maxLen: number): string {
  if (tpAmb === 1) return name.slice(0, maxLen);
  const label = maxLen <= 60 ? HOMOLOG_DEST_XNOME : HOMOLOG_FISCAL_LABEL;
  return label.slice(0, maxLen);
}
