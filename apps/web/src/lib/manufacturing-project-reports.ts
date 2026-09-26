import type { MfgDeliverySituation, MfgStatus } from './manufacturing-labels';

export type MfgProjectReportKind = 'on_time' | 'overdue' | 'top_price' | 'low_price' | 'by_customer';
export type MfgProjectReportDateField =
  | 'createdAt'
  | 'promisedAt'
  | 'quotedAt'
  | 'finishedAt'
  | 'approvedAt';

export const MFG_PROJECT_REPORT_KINDS: Array<{ id: MfgProjectReportKind; label: string; hint: string }> =
  [
    {
      id: 'on_time',
      label: 'Dentro do prazo',
      hint: 'Em aberto com entrega futura ou já concluídos no prazo',
    },
    {
      id: 'overdue',
      label: 'Atrasados',
      hint: 'Promessa vencida ou entrega concluída após o prazo',
    },
    { id: 'top_price', label: 'Maior orçamento', hint: 'Ordenado do maior para o menor valor' },
    { id: 'low_price', label: 'Menor orçamento', hint: 'Ordenado do menor para o maior valor' },
    { id: 'by_customer', label: 'Por cliente', hint: 'Quantidade e valor por cliente no período' },
  ];

export const MFG_PROJECT_REPORT_DATE_FIELDS: Array<{ id: MfgProjectReportDateField; label: string }> =
  [
    { id: 'promisedAt', label: 'Promessa de entrega' },
    { id: 'createdAt', label: 'Abertura do projeto' },
    { id: 'quotedAt', label: 'Data do orçamento' },
    { id: 'finishedAt', label: 'Conclusão' },
    { id: 'approvedAt', label: 'Aprovação' },
  ];

export type MfgProjectReportResponse = {
  report: MfgProjectReportKind;
  reportLabel: string;
  period: {
    from: string;
    to: string;
    dateField: MfgProjectReportDateField;
    dateFieldLabel: string;
  };
  summary: {
    projectCount: number;
    totalInPeriod?: number;
    truncated?: boolean;
    quotedTotal?: number;
    customerCount?: number;
  };
  groups: Array<{
    customerId: string;
    customerName: string;
    projectCount: number;
    quotedTotal: number;
    onTimeCount: number;
    overdueCount: number;
  }>;
  rows: Array<{
    id: string;
    number: number;
    status: MfgStatus;
    title: string | null;
    promisedAt: string | null;
    quoteTotal: string | null;
    customer: { id: string; name: string };
    finishedVariant: {
      sku: string;
      product: { name: string; controlNumber: number };
    };
    deliverySituation: MfgDeliverySituation;
  }>;
};

function formatLocalDateISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Período inicial: 1º de janeiro do ano até hoje (fuso local). */
export function mfgProjectReportMonthDefaults(): { from: string; to: string } {
  const n = new Date();
  const start = new Date(n.getFullYear(), 0, 1);
  return {
    from: formatLocalDateISO(start),
    to: formatLocalDateISO(n),
  };
}

/** Query em /fabrica para reabrir o modal de relatórios com os mesmos filtros. */
export const MFG_REPORTS_MODAL_PARAM = 'relatorios';

export function mfgReportsModalSearch(params: {
  report?: MfgProjectReportKind;
  dateField?: MfgProjectReportDateField;
  from?: string;
  to?: string;
  customerId?: string;
}): string {
  const p = new URLSearchParams();
  p.set(MFG_REPORTS_MODAL_PARAM, '1');
  if (params.report) p.set('report', params.report);
  if (params.dateField) p.set('dateField', params.dateField);
  if (params.from) p.set('from', params.from);
  if (params.to) p.set('to', params.to);
  if (params.customerId?.trim()) p.set('customerId', params.customerId.trim());
  return p.toString();
}

export function mfgProjectReportQueryString(params: {
  report: MfgProjectReportKind;
  dateField: MfgProjectReportDateField;
  from: string;
  to: string;
  customerId?: string;
}): string {
  const p = new URLSearchParams({
    report: params.report,
    dateField: params.dateField,
    from: params.from,
    to: params.to,
  });
  if (params.customerId?.trim()) p.set('customerId', params.customerId.trim());
  return p.toString();
}
