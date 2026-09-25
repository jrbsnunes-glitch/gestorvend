import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { formatStockQty } from '../lib/format';

type MrpResponse = {
  generatedAt: string;
  suggestions: Array<{
    ingredientVariantId: string;
    sku: string;
    productName: string;
    suggestedPurchaseQty: number;
    reason: string;
  }>;
};

export function ManufacturingMrpPage() {
  const mrpQ = useQuery({
    queryKey: ['manufacturing', 'mrp'],
    queryFn: () => api<MrpResponse>('/manufacturing/mrp/suggestions'),
  });

  const rows = mrpQ.data?.suggestions ?? [];

  return (
    <div className="page">
      <h1>MRP simplificado</h1>
      <p className="page-desc">
        Sugestão de compra com base na demanda agregada dos projetos ativos menos estoque disponível
        (ATP). Não substitui planejamento MRP enterprise — use como lista de prioridades.
      </p>
      {mrpQ.data?.generatedAt ? (
        <p className="muted" style={{ fontSize: '0.85rem' }}>
          Gerado em {new Date(mrpQ.data.generatedAt).toLocaleString('pt-BR')}
        </p>
      ) : null}

      {mrpQ.isLoading ? <p>Carregando…</p> : null}
      {mrpQ.isError ? <p className="alert alert-error">Não foi possível carregar sugestões.</p> : null}

      <div className="table-wrap" style={{ marginTop: '1rem' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>SKU</th>
              <th>Insumo</th>
              <th className="num">Sugerir compra</th>
              <th>Motivo</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.ingredientVariantId}>
                <td>{r.sku}</td>
                <td>{r.productName}</td>
                <td className="num">{formatStockQty(r.suggestedPurchaseQty)}</td>
                <td className="muted">{r.reason}</td>
              </tr>
            ))}
            {!rows.length && !mrpQ.isLoading ? (
              <tr>
                <td colSpan={4} className="empty">
                  Nenhuma falta de material nos projetos ativos.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ marginTop: '1rem', fontSize: '0.85rem' }}>
        Lotes e rastreabilidade por lote/série permanecem fora do escopo até validação com clientes
        (ICP).
      </p>
    </div>
  );
}
