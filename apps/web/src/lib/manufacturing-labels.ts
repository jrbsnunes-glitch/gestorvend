export type MfgStatus =
  | 'PRODUCT_SELECTION'
  | 'QUOTE'
  | 'STARTED'
  | 'IN_DEVELOPMENT'
  | 'TESTING'
  | 'FINISHED'
  | 'CANCELLED';

export const MFG_STATUS_LABEL: Record<MfgStatus, string> = {
  PRODUCT_SELECTION: 'Escolha do produto',
  QUOTE: 'Orçamento',
  STARTED: 'Início',
  IN_DEVELOPMENT: 'Em desenvolvimento',
  TESTING: 'Testes',
  FINISHED: 'Produto finalizado',
  CANCELLED: 'Cancelado',
};

export const NEXT_MFG_STATUS: Partial<Record<MfgStatus, MfgStatus>> = {
  PRODUCT_SELECTION: 'QUOTE',
  QUOTE: 'STARTED',
  STARTED: 'IN_DEVELOPMENT',
  IN_DEVELOPMENT: 'TESTING',
  TESTING: 'FINISHED',
};

export type MfgSource =
  | 'INTERNAL'
  | 'CATALOG'
  | 'WHATSAPP_LINK'
  | 'INSTAGRAM'
  | 'OTHER';

export const MFG_SOURCE_LABEL: Record<MfgSource, string> = {
  INTERNAL: 'Interno',
  CATALOG: 'Catálogo / lead',
  WHATSAPP_LINK: 'WhatsApp (bot / link)',
  INSTAGRAM: 'Instagram',
  OTHER: 'Outro',
};

export const MFG_KANBAN_COLS: MfgStatus[] = [
  'PRODUCT_SELECTION',
  'QUOTE',
  'STARTED',
  'IN_DEVELOPMENT',
  'TESTING',
  'FINISHED',
];

/** Transições permitidas (espelha a matriz da API). */
export const MFG_ALLOWED_STATUS_MOVES: Record<MfgStatus, MfgStatus[]> = {
  PRODUCT_SELECTION: ['QUOTE', 'CANCELLED'],
  QUOTE: ['STARTED', 'PRODUCT_SELECTION', 'CANCELLED'],
  STARTED: ['IN_DEVELOPMENT', 'CANCELLED'],
  IN_DEVELOPMENT: ['TESTING', 'CANCELLED'],
  TESTING: ['FINISHED', 'IN_DEVELOPMENT', 'CANCELLED'],
  FINISHED: [],
  CANCELLED: [],
};

export function canMoveMfgStatus(from: MfgStatus, to: MfgStatus): boolean {
  if (from === to) return false;
  return (MFG_ALLOWED_STATUS_MOVES[from] ?? []).includes(to);
}

export function mfgStatusChipStyle(status: MfgStatus): { background: string; color: string } {
  switch (status) {
    case 'PRODUCT_SELECTION':
      return { background: 'rgba(59,130,246,0.15)', color: '#1d4ed8' };
    case 'QUOTE':
      return { background: 'rgba(234,179,8,0.2)', color: '#a16207' };
    case 'STARTED':
      return { background: 'rgba(22,163,74,0.12)', color: '#15803d' };
    case 'IN_DEVELOPMENT':
      return { background: 'rgba(124,58,237,0.12)', color: '#6d28d9' };
    case 'TESTING':
      return { background: 'rgba(249,115,22,0.15)', color: '#c2410c' };
    case 'FINISHED':
      return { background: 'rgba(15,118,110,0.15)', color: '#0f766e' };
    default:
      return { background: 'rgba(148,163,184,0.2)', color: '#64748b' };
  }
}
