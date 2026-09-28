import { formatBRL } from '../lib/format';

export type SalesRevenueBreakdownProps = {
  revenueTotal: number;
  receivedAtSale: number;
  requisitionAtSale: number;
  receivableSettledViaCash?: number;
  compact?: boolean;
};

/** Resumo: faturamento = recebido no ato + requisição (vendas concluídas). */
export function SalesRevenueBreakdown({
  revenueTotal,
  receivedAtSale,
  requisitionAtSale,
  receivableSettledViaCash = 0,
  compact,
}: SalesRevenueBreakdownProps) {
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
      {requisitionAtSale > 0 ? (
        <p className="sales-rev-breakdown__line">
          <span>Em requisição (a receber)</span>
          <strong>{formatBRL(requisitionAtSale)}</strong>
        </p>
      ) : null}
      {receivableSettledViaCash > 0 ? (
        <p className="sales-rev-breakdown__line">
          <span>Títulos recebidos no caixa</span>
          <strong>{formatBRL(receivableSettledViaCash)}</strong>
        </p>
      ) : null}
      <p className="sales-rev-breakdown__hint">
        Composição do faturamento: recebido no ato + em requisição ≈ total vendido.
      </p>
    </div>
  );
}
