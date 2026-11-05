export function normalizeDistrictName(raw: string): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ');
}

export function isDistrictAllowed(
  mode: 'OFF' | 'ALLOWLIST' | 'BLOCKLIST',
  districts: string[],
  districtRaw: string,
): boolean {
  if (mode === 'OFF' || !districts.length) return true;
  const key = normalizeDistrictName(districtRaw);
  if (!key) return mode !== 'ALLOWLIST';
  const hit = districts.some((d) => d === key || key.includes(d) || d.includes(key));
  if (mode === 'ALLOWLIST') return hit;
  if (mode === 'BLOCKLIST') return !hit;
  return true;
}

export function formatDistrictMessage(template: string, bairro: string, cidade: string): string {
  return template.replace(/\{bairro\}/gi, bairro).replace(/\{cidade\}/gi, cidade);
}

export function districtsJsonToText(json: string | null | undefined): string {
  if (!json?.trim()) return '';
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) return '';
    return parsed.map((x) => String(x ?? '').trim()).filter(Boolean).join('\n');
  } catch {
    return '';
  }
}
