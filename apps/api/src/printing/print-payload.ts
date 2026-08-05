/** Payload canônico de ticket de cozinha (JSON — desktop ou ESC/POS futuro). */
export type KitchenPrintItemPayload = {
  id: string;
  name: string;
  quantity: number;
  unit?: string | null;
  notes?: string | null;
};

export type KitchenPrintPayload = {
  kind: 'KITCHEN';
  title: string;
  tabNumber: number;
  tableCode?: string | null;
  tableLabel?: string | null;
  areaName?: string | null;
  guestCount: number;
  waiterName?: string | null;
  /** true = itens adicionais (já havia impressão anterior na comanda). */
  additional: boolean;
  printedAt: string;
  items: KitchenPrintItemPayload[];
};

export type PrintJobPayload = KitchenPrintPayload | Record<string, unknown>;
