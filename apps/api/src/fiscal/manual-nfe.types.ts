import { PaymentMethod } from '../generated/tenant-client';

export type ManualNfeItemInput = {
  variantId: string;
  quantity: number;
  unitPrice: number;
  discount?: number;
};

/** Cliente e itens da venda vinculada à nota (rejeição / reenvio). */
export type FiscalNoteSaleContentInput = {
  customerId?: string | null;
  items: ManualNfeItemInput[];
};

export type ManualNfeInput = {
  customerId: string;
  operationNatureId: string;
  notes?: string | null;
  discount?: number;
  surcharge?: number;
  freightAmount?: number;
  freightMod?: number;
  deliveryVehiclePlate?: string | null;
  deliveryDriverName?: string | null;
  deductStock?: boolean;
  items: ManualNfeItemInput[];
  payments: Array<{ method: PaymentMethod; amount: number }>;
  /** Se true, transmite à SEFAZ após gravar o rascunho. */
  emitNow?: boolean;
};
