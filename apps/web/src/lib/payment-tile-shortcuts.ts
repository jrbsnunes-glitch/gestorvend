/** Atalhos de teclado para tiles de pagamento no PDV (A, B, C… em ordem). */

export type PaymentTileShortcut = { id: string; key: string };

export function buildPaymentTileShortcuts(tiles: { id: string; label: string }[]): PaymentTileShortcut[] {
  const out: PaymentTileShortcut[] = [];
  for (let i = 0; i < tiles.length && i < 26; i++) {
    const tile = tiles[i]!;
    out.push({ id: tile.id, key: String.fromCharCode(65 + i) });
  }
  return out;
}

export function findTileByShortcutKey(
  shortcuts: PaymentTileShortcut[],
  evKey: string,
): PaymentTileShortcut | undefined {
  if (evKey.length !== 1) return undefined;
  const k = evKey.toUpperCase();
  if (!/[A-Z]/.test(k)) return undefined;
  return shortcuts.find((s) => s.key === k);
}
