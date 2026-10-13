import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { A4ReportPages, type A4Item } from '../../components/A4ReportPages';
import { StandardReportHeader } from '../../components/StandardReportHeader';
import { api } from '../../lib/api';
import { formatBRL } from '../../lib/format';
import '../cash-print.css';

type Movement = {
  id: string;
  controlNumber: number;
  type: 'IN' | 'OUT' | 'ADJUST' | 'TRANSFER';
  source: string;
  createdAt: string;
  quantity: string;
  unitCost: string | null;
  reference: string | null;
  outboundReason: string | null;
  location: { code: string; name: string };
  variant: { sku: string; barcode: string | null; product: { name: string } };
  user: string | null;
};

type Report = {
  movements: Movement[];
  summary: {
    count: number;
    totalIn: number;
    totalOut: number;
    totalAdjust: number;
    valueIn: number;
  };
  filters: {
    from: string | null;
    to: string | null;
    controlFrom: string | null;
    controlTo: string | null;
    variantId: string | null;
    type: string | null;
  };
};

function parseLocalDate(s: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Date(s);
}

function formatDateLong(s: string): string {
  return parseLocalDate(s).toLocaleDateString('pt-BR');
}

const TYPE_LABEL: Record<string, string> = {
  IN: 'Entrada',
  OUT: 'Saída',
  ADJUST: 'Ajuste',
  TRANSFER: 'Transferência',
};

const SOURCE_LABEL: Record<string, string> = {
  GOODS_RECEIPT: 'Entrada NF',
  SALE: 'Venda',
  MANUAL_OUT: 'Saída manual',
  ADJUSTMENT: 'Ajuste',
  OTHER: 'Outros',
};

export function StockMovPrintPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const controlFrom = params.get('controlFrom') ?? '';
  const controlTo = params.get('controlTo') ?? '';
  const type = params.get('type') ?? '';
  const variantId = params.get('variantId') ?? '';
  const hasControl = Boolean(controlFrom || controlTo);
  const hasDate = Boolean(from || to);

  const report = useQuery({
    queryKey: ['stock-mov-report', { from, to, controlFrom, controlTo, type, variantId }],
    queryFn: () => {
      const qs = new URLSearchParams();
      if (hasControl) {
        if (controlFrom) qs.set('controlFrom', controlFrom);
        if (controlTo) qs.set('controlTo', controlTo);
      } else {
        if (from) qs.set('from', from);
        if (to) qs.set('to', to);
      }
      if (type) qs.set('type', type);
      if (variantId) qs.set('variantId', variantId);
      return api<Report>(`/stock-movements/report?${qs.toString()}`);
    },
    enabled: hasDate || hasControl,
  });

  const subtitle = useMemo(() => {
    if (hasControl) {
      if (controlFrom && controlTo) return `Controles #${controlFrom} a #${controlTo}`;
      if (controlFrom) return `A partir do controle #${controlFrom}`;
      return `Até o controle #${controlTo}`;
    }
    if (from && to) return `Período de ${formatDateLong(from)} a ${formatDateLong(to)}`;
    if (from) return `A partir de ${formatDateLong(from)}`;
    if (to) return `Até ${formatDateLong(to)}`;
    return 'Sem filtro';
  }, [hasControl, controlFrom, controlTo, from, to]);

  const printed = useRef(false);
  const onReady = useCallback((count: number) => {
    if (printed.current || count < 1 || !report.data) return;
    printed.current = true;
    window.setTimeout(() => window.print(), 400);
  }, [report.data]);

  const summary = report.data?.summary;

  const reportItems = useMemo((): A4Item[] => {
    if (report.isError) {
      return [{ kind: 'block', key: 'error', node: <p>Não foi possível montar o relatório.</p> }];
    }
    if (!report.data || !summary) {
      return [{ kind: 'block', key: 'loading', node: <p>Carregando…</p> }];
    }
    return [
      {
        kind: 'block',
        key: 'kpis',
        node: (
          <section className="print-section">
            <div className="print-kpis">
              <div className="print-kpi">
                <span>Movimentações</span>
                <strong>{summary.count}</strong>
              </div>
              <div className="print-kpi">
                <span>Total entradas</span>
                <strong>{summary.totalIn.toLocaleString('pt-BR')}</strong>
              </div>
              <div className="print-kpi">
                <span>Total saídas</span>
                <strong>{summary.totalOut.toLocaleString('pt-BR')}</strong>
              </div>
              <div className="print-kpi">
                <span>Ajustes</span>
                <strong>{summary.totalAdjust.toLocaleString('pt-BR')}</strong>
              </div>
              <div className="print-kpi">
                <span>Valor entradas</span>
                <strong>{formatBRL(summary.valueIn)}</strong>
              </div>
            </div>
          </section>
        ),
      },
      {
        kind: 'table',
        key: 'movements',
        title: <h2 className="print-section-title">Detalhamento</h2>,
        tableClassName: 'print-table',
        head: (
          <tr>
            <th style={{ width: 60 }}>#</th>
            <th style={{ width: 110 }}>Data</th>
            <th style={{ width: 80 }}>Tipo</th>
            <th>Produto</th>
            <th>Local</th>
            <th style={{ width: 90, textAlign: 'right' }}>Qtd</th>
            <th style={{ width: 110, textAlign: 'right' }}>Custo unit.</th>
            <th>Origem</th>
          </tr>
        ),
        rows: report.data.movements.map((m) => (
          <tr key={m.id}>
            <td>
              <strong>#{m.controlNumber}</strong>
            </td>
            <td>{new Date(m.createdAt).toLocaleString('pt-BR')}</td>
            <td>{TYPE_LABEL[m.type] ?? m.type}</td>
            <td>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <strong>{m.variant.product.name}</strong>
                <span style={{ color: '#64748b', fontSize: '0.78rem' }}>
                  SKU {m.variant.sku}
                  {m.variant.barcode ? ` · EAN ${m.variant.barcode}` : ''}
                </span>
              </div>
            </td>
            <td>
              {m.location.code} — {m.location.name}
            </td>
            <td style={{ textAlign: 'right' }}>{m.quantity}</td>
            <td style={{ textAlign: 'right' }}>{m.unitCost ? formatBRL(m.unitCost) : '—'}</td>
            <td>{SOURCE_LABEL[m.source] ?? m.source}</td>
          </tr>
        )),
        empty: (
          <tr>
            <td colSpan={8}>Nenhuma movimentação no filtro.</td>
          </tr>
        ),
      },
    ];
  }, [report.data, report.isError, summary]);

  return (
    <div className="print-page">
      <div className="print-toolbar no-print">
        <button type="button" className="btn btn-secondary" onClick={() => navigate('/estoque/movimentos')}>
          ← Voltar
        </button>
        <button type="button" className="btn btn-primary" onClick={() => window.print()}>
          Imprimir
        </button>
      </div>

      {report.isError && (
        <div className="alert alert-error no-print" style={{ width: '210mm', maxWidth: '100%', margin: '0 auto 0.75rem' }}>
          {(report.error as Error)?.message ?? 'Erro ao gerar relatório.'}
        </div>
      )}

      <A4ReportPages
        header={
          <StandardReportHeader
            documentTitle="Movimentações de estoque"
            documentExtras={
              <>
                <p className="print-sub">{subtitle}</p>
                {type && (
                  <p className="print-sub" style={{ marginTop: '0.15rem' }}>
                    Tipo: <strong>{TYPE_LABEL[type] ?? type}</strong>
                  </p>
                )}
              </>
            }
          />
        }
        items={reportItems}
        layoutKey={`stock-mov:${report.status}:${report.data?.movements.length ?? 0}`}
        onReady={onReady}
      />
    </div>
  );
}
