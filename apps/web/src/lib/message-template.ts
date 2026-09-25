const DEFAULT_CATALOG_WHATSAPP_MESSAGE =
  'Olá! Gostaria de um orçamento para o produto #{codigo} — {nome}.';

export function applyMessageTemplate(
  template: string | null | undefined,
  vars: Record<string, string | number>,
  fallback = DEFAULT_CATALOG_WHATSAPP_MESSAGE,
): string {
  const tpl = template?.trim() || fallback;
  return tpl.replace(/\{(\w+)\}/g, (_, key: string) => {
    const v = vars[key];
    return v === undefined || v === null ? '' : String(v);
  });
}
