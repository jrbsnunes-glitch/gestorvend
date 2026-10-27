/**
 * Rótulos oficiais NFC-e/NF-e (NT 2020.006 / IT 2024.002).
 * Só usar em DANFE e no comprovante quando a NFC-e estiver autorizada.
 * Comprovante não fiscal: `PAYMENT_FORM_KIND_LABELS` em payment-forms.ts.
 */

export type FiscalPaySource = {
  method: string;
  cardOperation?: string | null;
  paymentFormName?: string | null;
  paymentForm?: { name?: string | null } | null;
  tPag?: string | null;
  xPag?: string | null;
  fiscalLabel?: string | null;
};

const NFCE_TPAG_LABEL: Record<string, string> = {
  '01': 'Dinheiro',
  '02': 'Cheque',
  '03': 'Cartão de Crédito',
  '04': 'Cartão de Débito',
  '05': 'Cartão da Loja / Crediário',
  '10': 'Vale Alimentação',
  '11': 'Vale Refeição',
  '12': 'Vale Presente',
  '13': 'Vale Combustível',
  '14': 'Duplicata Mercantil',
  '15': 'Boleto Bancário',
  '16': 'Depósito Bancário',
  '17': 'Pagamento Instantâneo (PIX) — Dinâmico',
  '18': 'TED',
  '19': 'Programa de fidelidade / Cashback',
  '20': 'Pagamento Instantâneo (PIX) — Estático',
  '21': 'Crédito em Loja',
  '22': 'Pagamento eletrônico não informado',
  '23': 'Pagamento Instantâneo (PIX) — Automático',
  '24': 'TEF — Book Transfer',
  '90': 'Sem Pagamento',
  '91': 'Pagamento Posterior',
  '99': 'Outros',
};

function formName(p: FiscalPaySource): string {
  return (p.paymentFormName ?? p.paymentForm?.name ?? '').trim();
}

function mapMethodToTPag(p: FiscalPaySource): { tPag: string; xPag?: string } {
  const method = String(p.method ?? '').toUpperCase();
  const op = String(p.cardOperation ?? '').toUpperCase();
  if (method === 'CASH') return { tPag: '01' };
  if (method === 'CARD') return { tPag: op === 'DEBIT' ? '04' : '03' };
  if (method === 'PIX') return { tPag: '17' };
  if (method === 'CREDIT') return { tPag: '05' };
  if (method === 'REQUISITION') return { tPag: '91' };
  const name = formName(p);
  return { tPag: '99', xPag: name.length >= 2 ? name.slice(0, 60) : 'Outros' };
}

/** Nome que a SEFAZ reconhece (tabela tPag / xPag). */
export function fiscalPaymentLabel(p: FiscalPaySource): string {
  if (p.fiscalLabel?.trim()) return p.fiscalLabel.trim();
  const tPag = (p.tPag ?? '').trim() || mapMethodToTPag(p).tPag;
  if (tPag === '99') {
    const x = (p.xPag ?? formName(p)).trim();
    return x.length >= 2 ? x : 'Outros';
  }
  return NFCE_TPAG_LABEL[tPag] ?? tPag;
}
