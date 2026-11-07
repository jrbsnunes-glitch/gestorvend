import { formatBRL } from '../lib/format';

export type SalesRevenueBreakdownProps = {
  revenueTotal: number;
  receivedAtSale: number;
  /** Total a receber posteriormente (requisição + crédito, etc.). Preferir em relatórios de caixa. */
  deferredReceiptAtSale?: number;
  /** Legado: só requisição (visão financeira). Ignorado se `deferredReceiptAtSale` vier preenchido. */
  requisitionAtSale?: number;
  receivableSettledViaCash?: number;
  compact?: boolean;
};

/** Resumo: faturamento = recebido no ato + a receber posteriormente (vendas concluídas). */
export function SalesRevenueBreakdown({
  revenueTotal,
  receivedAtSale,
  deferredReceiptAtSale,
  requisitionAtSale = 0,
  receivableSettledViaCash = 0,
  compact,
}: SalesRevenueBreakdownProps) {
  const deferred =
    deferredReceiptAtSale != null ? deferredReceiptAtSale : requisitionAtSale;
  const cls = compact ? 'sales-rev-breakdown sales-rev-breakdown--compact' : 'sales-rev-breakdown';
  return (
    <div className={cls}>
      <p className="sales-rev-breakdown__line">
        <span>Faturamento (vendas concluídas)</span>
        <strong>{formatBRL(revenueTotal)}</strong>
      </p>
      <p className="sales-rev-breakdown__line">
        <span>Recebido no ato</span>
        <strong>{formatBRL(receivedAtSale)}</strong>
      </p>
      {deferred > 0 ? (
        <p className="sales-rev-breakdown__line">
          <span>A receber posteriormente</span>
          <strong>{formatBRL(deferred)}</strong>
        </p>
      ) : null}
      {receivableSettledViaCash > 0 ? (
        <p className="sales-rev-breakdown__line">
          <span>Títulos recebidos no caixa</span>
          <strong>{formatBRL(receivableSettledViaCash)}</strong>
        </p>
      ) : null}
      <p className="sales-rev-breakdown__hint">
        Composição do faturamento: recebido no ato + a receber posteriormente ≈ total vendido.
        {deferredReceiptAtSale != null
          ? ' Requisições e cartões de crédito aparecem detalhados por forma logo abaixo.'
          : null}
      </p>
    </div>
  );
}
