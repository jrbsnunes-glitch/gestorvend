import { PaymentMethod } from '../generated/tenant-client';

export type ManualNfeItemInput = {
  variantId: string;
  quantity: number;
  unitPrice: number;
  discount?: number;
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
