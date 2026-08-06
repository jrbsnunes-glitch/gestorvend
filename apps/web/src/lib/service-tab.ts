/** Rótulo exibido da comanda: sigla fixa ou #sequencial. */
export type ServiceTabLabelSource = {
  number: number;
  station?: { code: string; label?: string | null } | null;
};

export function formatServiceTabLabel(tab: ServiceTabLabelSource): string {
  if (tab.station) {
    const code = tab.station.label?.trim() || tab.station.code;
    return code;
  }
  return `#${tab.number}`;
}

/** Prefixo curto para badges (mesas/comandas fixas). */
export function formatServiceTabBadge(tab: ServiceTabLabelSource): string {
  if (tab.station) return tab.station.code;
  return `#${tab.number}`;
}
