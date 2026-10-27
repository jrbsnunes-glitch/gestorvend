/**
 * Grupo YA (tPag / xPag) — NT 2020.006 + IT 2024.002 (tabela de meios de pagamento).
 * Uso exclusivo de XML NFC-e/NF-e e DANFE. O comprovante interno do PDV
 * continua com o catálogo GestorVend (Dinheiro, Requisição, etc.).
 */

export type NfcePagInput = {
  method: string;
  amount: number | string | { toString(): string };
  cardOperation?: string | null;
  paymentFormName?: string | null;
};

export type NfcePagRow = {
  tPag: string;
  vPag: number;
  /** Só enviar no XML quando tPag = 99 (regra YA02a-10 / rejeição 441). */
  xPag?: string;
  /** 0 à vista, 1 a prazo. */
  indPag: 0 | 1;
  /** Descrição oficial para DANFE. */
  label: string;
};

/** Descrições oficiais (IT 2024.002). Códigos sem uso no PDV ficam para consulta/DANFE. */
export const NFCE_TPAG_LABEL: Record<string, string> = {
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

function toAmount(value: number | string | { toString(): string }): number {
  const n = Number(typeof value === 'object' && value != null ? value.toString() : value);
  return Number.isFinite(n) ? n : 0;
}

/** xPag: 2–60 caracteres (YA02a). */
export function sanitizeXPag(raw: string | null | undefined): string {
  const latin = [...String(raw ?? '')]
    .map((ch) => {
      const c = ch.charCodeAt(0);
      if (c >= 0x20 && c <= 0xff) return ch;
      return ' ';
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  return latin.length >= 2 ? latin : 'Outros';
}

export function nfceTPagLabel(tPag: string, xPag?: string | null): string {
  if (tPag === '99') return sanitizeXPag(xPag);
  return NFCE_TPAG_LABEL[tPag] ?? tPag;
}

/**
 * Método interno do PDV → código oficial.
 * Requisição = 91 (pagamento depois da nota). Cartão usa crédito/débito da venda.
 */
export function mapSalePaymentToNfcePag(input: NfcePagInput): NfcePagRow {
  const method = String(input.method ?? '').toUpperCase();
  const vPag = toAmount(input.amount);
  const op = String(input.cardOperation ?? '').toUpperCase();

  if (method === 'CASH') {
    return { tPag: '01', vPag, indPag: 0, label: NFCE_TPAG_LABEL['01'] };
  }
  if (method === 'CARD') {
    const tPag = op === 'DEBIT' ? '04' : '03';
    return { tPag, vPag, indPag: 0, label: NFCE_TPAG_LABEL[tPag] };
  }
  if (method === 'PIX') {
    return { tPag: '17', vPag, indPag: 0, label: NFCE_TPAG_LABEL['17'] };
  }
  if (method === 'CREDIT') {
    return { tPag: '05', vPag, indPag: 1, label: NFCE_TPAG_LABEL['05'] };
  }
  if (method === 'REQUISITION') {
    return { tPag: '91', vPag, indPag: 1, label: NFCE_TPAG_LABEL['91'] };
  }

  const xPag = sanitizeXPag(input.paymentFormName || 'Outros');
  return { tPag: '99', vPag, xPag, indPag: 0, label: xPag };
}

/** Compatível com chamadas antigas que só pediam o código. */
export function paymentMethodToTPag(method: string): string {
  return mapSalePaymentToNfcePag({ method, amount: 0 }).tPag;
}
