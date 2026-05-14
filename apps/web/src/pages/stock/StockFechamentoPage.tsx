import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { CrudToolbar } from '../../components/CrudToolbar';
import { ModuleReportsModal } from '../../components/ModuleReportsModal';
import { RecentMovementsSection } from './RecentMovementsSection';
import { api } from '../../lib/api';

type DailyLine = {
  variantId: string;
  sku: string;
  productName: string;
  locationId: string;
  locationCode: string;
  opening: number;
  entriesPurchase: number;
  entriesOther: number;
  exitsSale: number;
  exitsManual: number;
  adjustments: number;
  closing: number;
};

type DailyResp = { date: string; locationId: string | null; note: string; lines: DailyLine[] };

export function StockFechamentoPage() {
  const qc = useQueryClient();
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [locationId, setLocationId] = useState('');
  const [reportsOpen, setReportsOpen] = useState(false);

  const locations = useQuery({
    queryKey: ['stock-locations'],
    queryFn: () => api<Array<{ id: string; code: string }>>('/stock-locations'),
  });

  // Fechamento Diário: ao entrar na tela ou trocar filtro, sempre recarregar.
  // `placeholderData: keepPreviousData` evita flicker entre buscas consecutivas.
  const daily = useQuery({
    queryKey: ['reports', 'stock-daily', date, locationId],
    queryFn: () =>
      api<DailyResp>(
        `/reports/stock-daily?date=${encodeURIComponent(date)}${locationId ? `&locationId=${encodeURIComponent(locationId)}` : ''}`,
      ),
    refetchOnMount: 'always',
    placeholderData: keepPreviousData,
  });

  // Ao trocar de data/local, invalida o cache antigo de outras combinações
  // — assim, voltar ao filtro anterior também dispara refetch.
  useEffect(() => {
    qc.invalidateQueries({ queryKey: ['reports', 'stock-daily'], exact: false });
  }, [date, locationId, qc]);

  return (
    <div>
      <CrudToolbar onPrint={() => window.print()} onReports={() => setReportsOpen(true)} />

      <ModuleReportsModal open={reportsOpen} title="Fechamento diário" onClose={() => setReportsOpen(false)}>
        <ul style={{ margin: 0, paddingLeft: '1.2rem' }}>
          <li>Exportação CSV do fechamento (a implementar)</li>
          <li>Comparativo entre locais</li>
        </ul>
      </ModuleReportsModal>

      <RecentMovementsSection take={12} />

      <div className="card no-print">
        <div className="form-row">
          <div className="field">
            <label>Data do fechamento</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="field">
            <label>Local (opcional)</label>
            <select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              <option value="">Todos</option>
              {locations.data?.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.code}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p style={{ fontSize: '0.88rem', color: 'var(--color-text-muted)', margin: 0 }}>
          {daily.data?.note}
        </p>
      </div>

      {daily.isError && <div className="alert alert-error">{(daily.error as Error).message}</div>}

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>SKU</th>
              <th>Produto</th>
              <th>Local</th>
              <th>Saldo inicial</th>
              <th>Entr. compra</th>
              <th>Entr. outras</th>
              <th>Saída venda</th>
              <th>Saída manual</th>
              <th>Ajustes (qtd)</th>
              <th>Saldo final</th>
            </tr>
          </thead>
          <tbody>
            {daily.isLoading && (
              <tr>
                <td colSpan={10} className="empty">
                  Carregando…
                </td>
              </tr>
            )}
            {!daily.isLoading && !daily.data?.lines.length && (
              <tr>
                <td colSpan={10} className="empty">
                  Sem dados para esta data.
                </td>
              </tr>
            )}
            {daily.data?.lines.map((r) => (
              <tr key={`${r.variantId}-${r.locationId}`}>
                <td>
                  <strong>{r.sku}</strong>
                </td>
                <td>{r.productName}</td>
                <td>{r.locationCode}</td>
                <td>{r.opening}</td>
                <td>{r.entriesPurchase}</td>
                <td>{r.entriesOther}</td>
                <td>{r.exitsSale}</td>
                <td>{r.exitsManual}</td>
                <td>{r.adjustments}</td>
                <td>
                  <strong>{r.closing}</strong>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
