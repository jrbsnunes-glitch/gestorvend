/** Normaliza texto para busca parcial (sem acentos, minúsculas). */
export function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim();
}

/** Verifica se algum campo contém o termo (busca parcial). */
export function matchesListSearch(fields: Array<string | null | undefined>, query: string): boolean {
  const q = normalizeSearchText(query);
  if (!q) return true;
  return fields.some((f) => normalizeSearchText(String(f ?? '')).includes(q));
}
