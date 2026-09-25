import type { MfgStatus } from './manufacturing-labels';

export type MfgProjectSource =
  | 'INTERNAL'
  | 'CATALOG'
  | 'WHATSAPP_LINK'
  | 'INSTAGRAM'
  | 'OTHER';

export type MfgBomLine = {
  id: string;
  plannedQty: string;
  scrapPct: string;
  consumedQty: string;
  reservedQty: string;
  issueAtStart: boolean;
  ingredientVariant: { id: string; sku: string; product: { name: string } };
};

export type MfgProjectDetail = {
  id: string;
  number: number;
  status: MfgStatus;
  source: MfgProjectSource;
  externalRef: string | null;
  quantity: string;
  title: string | null;
  customerBrief: string | null;
  technicalSpec: string | null;
  deliveryNotes: string | null;
  internalNotes: string | null;
  qualityNotes: string | null;
  quoteTotal: string | null;
  depositAmount: string;
  promisedAt: string | null;
  customer: { id: string; name: string };
  finishedVariant: {
    id: string;
    sku: string;
    product: { id: string; name: string; controlNumber: number };
  };
  technicalResponsible: { id: string; name: string } | null;
  commercialResponsible: { id: string; name: string } | null;
  bomLines: MfgBomLine[];
  statusHistory: Array<{
    id: string;
    fromStatus: MfgStatus | null;
    toStatus: MfgStatus;
    note: string | null;
    createdAt: string;
    userId: string | null;
  }>;
  materialIssues: Array<{
    id: string;
    quantity: string;
    phase: string;
    createdAt: string;
    ingredientVariantId: string;
    userId: string | null;
  }>;
  sale: { id: string; number: number; total: string; status: string } | null;
  depositSale: { id: string; number: number; total: string; status: string } | null;
};

export type MfgScheduleProject = {
  id: string;
  number: number;
  status: MfgStatus;
  promisedAt: string | null;
  createdAt: string;
  finishedAt: string | null;
  quantity: string;
  title: string | null;
  customer: { id: string; name: string };
  finishedVariant: {
    id: string;
    sku: string;
    product: { id: string; name: string; controlNumber: number };
  };
  statusHistory: Array<{ toStatus: MfgStatus; createdAt: string }>;
};

export type MfgOperationalAlerts = {
  overdueCount: number;
  overdue: Array<{
    id: string;
    number: number;
    promisedAt: string | null;
    status: MfgStatus;
    customer: { name: string };
  }>;
  materialShortageCount: number;
  materialShortages: Array<{
    variantId: string;
    sku: string;
    name: string;
    need: number;
    available: number;
    gap: number;
  }>;
};
