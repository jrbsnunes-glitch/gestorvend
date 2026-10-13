import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { A4ReportPages, type A4Item } from '../components/A4ReportPages';
import { StandardReportHeader } from '../components/StandardReportHeader';
import { api } from '../lib/api';
import { formatBRL } from '../lib/format';
import './cash-print.css';

type ItemRow = {
  saleId: string;
  saleNumber: number;
  saleStatus: 'COMPLETED' | 'CANCELLED' | string;
  saleCreatedAt: string;
  user: { id: string; name: string; email: string } | null;
  itemId: string;
  productName: string;
  sku: string | null;
  quantity: string;
  unitPrice: string;
  discount: string;
  totalLine: string;
};

type Report = {
  from: string;
  to: string;
  items: ItemRow[];
  totals: {
    totalItems: number;
    totalLineItemDiscount: number;
    totalOrderDiscount: number;
    totalSurcharges: number;
    linesSubtotalBeforeOrderDiscount: number;
    totalDiscount: number;
    totalNet: number;
    completedLineCount: number;
    cancelledLineCount: number;
  };
};

type Operator = { id: string; name: string; email: string };

function parseLocalDate(s: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) {
    const [, y, mo, d] = m;
    return new Date(Number(y), Number(mo) - 1, Number(d));
  }
  return new Date(s);
}

function fmtDate(s: string): string {
  return parseLocalDate(s).toLocaleDateString('pt-BR');
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function filterSubtitle(opts: {
  from: string;
  to: string;
  controlFrom: string;
  controlTo: string;
  operatorLabel: string | null;
  status: string;
}): string {
  const parts: string[] = [];
  if (opts.controlFrom || opts.controlTo) {
    if (opts.controlFrom && opts.controlTo && opts.controlFrom !== opts.controlTo) {
      parts.push(`Controles #${opts.controlFrom}–#${opts.controlTo}`);
    } else if (opts.controlFrom) parts.push(`Controle ≥ #${opts.controlFrom}`);
    else parts.push(`Controle ≤ #${opts.controlTo}`);
  }
  if (opts.from && opts.to) {
    const f = parseLocalDate(opts.from);
    const t = parseLocalDate(opts.to);
    const same =
      f.getFullYear() === t.getFullYear() &&
      f.getMonth() === t.getMonth() &&
      f.getDate() === t.getDate();
    parts.push(same ? f.toLocaleDateString('pt-BR') : `${fmtDate(opts.from)} – ${fmtDate(opts.to)}`);
  }
  if (opts.operatorLabel) parts.push(opts.operatorLabel);
  if (opts.status === 'CANCELLED') parts.push('Canceladas');
  else if (opts.status === 'ALL') parts.push('Todas as vendas');
  else parts.push('Concluídas');
  return parts.join(' · ') || 'Itens vendidos';
}

export function CashPrintItemsPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const userId = params.get('userId') ?? '';
  const status = params.get('status') ?? 'COMPLETED';
  const controlFrom = params.get('controlFrom') ?? '';
  const controlTo = params.get('controlTo') ?? '';
  const hasControl = Boolean(controlFrom || controlTo);
  const hasDate = Boolean(from && to);

  const report = useQuery({
    queryKey: ['cash', 'report-items', from, to, userId, status, controlFrom, controlTo],
    queryFn: () => {
      const qs = new URLSearchParams({ status });
      if (hasDate) {
        qs.set('from', from);
        qs.set('to', to);
      }
      if (userId) qs.set('userId', userId);
      if (controlFrom) qs.set('controlFrom', controlFrom);
      if (controlTo) qs.set('controlTo', controlTo);
      return api<Report>(`/cash/report/items?${qs.toString()}`);
    },
    enabled: hasDate || hasControl,
  });

  const operators = useQuery({
    queryKey: ['users'],
    queryFn: () => api<Operator[]>('/users'),
    staleTime: 5 * 60_000,
    enabled: !!userId,
  });

  const operatorLabel = useMemo(() => {
    if (!userId) return null;
    return operators.data?.find((u) => u.id === userId)?.name ?? null;
  }, [userId, operators.data]);

  const reportItems = useMemo((): A4Item[] => {
    const data = report.data;
    if (report.isError) {
      return [{ kind: 'block', key: 'error', node: <p>Não foi possível montar o relatório.</p> }];
    }
    if (!data) return [{ kind: 'block', key: 'loading', node: <p>Carregando…</p> }];
    return [
      {
        kind: 'block',
        key: 'summary',
        node: (
          <section className="print-section">
            <h2>Itens</h2>
            <p className="print-summary-line">
              {Math.round(data.totals.totalItems * 100) / 100} un. · {data.totals.completedLineCount}{' '}
              linha(s)
              {data.totals.cancelledLineCount > 0 ? ` · ${data.totals.cancelledLineCount} cancelada(s)` : ''}
              {data.totals.totalDiscount > 0 ? ` · Descontos totais ${formatBRL(data.totals.totalDiscount)}` : ''}
              {(data.totals.totalSurcharges ?? 0) > 0
                ? ` · Acréscimos totais ${formatBRL(data.totals.totalSurcharges)}`
                : ''}
              {' · '}
              Líquido {formatBRL(data.totals.totalNet)}
            </p>
          </section>
        ),
      },
      {
        kind: 'table',
        key: 'items',
        tableClassName: 'print-table print-table-compact',
        head: (
          <tr>
            <th>Data</th>
            <th className="num">Venda</th>
            {!userId && <th>Funcionário</th>}
            <th>Produto</th>
            <th className="num">Qtd</th>
            <th className="num">Unit.</th>
            <th className="num">Total</th>
          </tr>
        ),
        rows: data.items.map((it) => (
          <tr key={it.itemId} className={it.saleStatus === 'CANCELLED' ? 'is-cancelled' : undefined}>
            <td>{fmtDateTime(it.saleCreatedAt)}</td>
            <td className="num">
              #{it.saleNumber}
              {it.saleStatus === 'CANCELLED' ? ' ✕' : ''}
            </td>
            {!userId && <td>{it.user?.name ?? '—'}</td>}
            <td>
              {it.productName}
              {it.sku ? ` · ${it.sku}` : ''}
            </td>
            <td className="num">{Number(it.quantity)}</td>
            <td className="num">{formatBRL(it.unitPrice)}</td>
            <td className="num">{formatBRL(it.totalLine)}</td>
          </tr>
        )),
        empty: (
          <tr>
            <td colSpan={userId ? 6 : 7}>Nenhum item no filtro selecionado.</td>
          </tr>
        ),
        foot: data.items.length ? (
          <tr>
            <th colSpan={userId ? 3 : 4}>Total</th>
            <th className="num">{Math.round(data.totals.totalItems * 100) / 100}</th>
            <th />
            <th className="num">{formatBRL(data.totals.linesSubtotalBeforeOrderDiscount)}</th>
          </tr>
        ) : undefined,
      },
    ];
  }, [report.data, report.isError, userId]);

  if (!hasDate && !hasControl) {
    return (
      <div className="print-page">
        <p>Parâmetros inválidos. Volte e selecione período ou controles.</p>
        <button type="button" className="btn btn-primary" onClick={() => navigate('/caixa')}>
          Voltar
        </button>
      </div>
    );
  }

  const subtitle = filterSubtitle({
    from,
    to,
    controlFrom,
    controlTo,
    operatorLabel,
    status,
  });

  return (
    <div className="print-page print-page--compact">
      <div className="print-toolbar no-print">
        <button type="button" className="btn btn-secondary" onClick={() => navigate('/caixa')}>
          ← Voltar
        </button>
        <div style={{ flex: 1 }} />
        <button type="button" className="btn btn-primary" onClick={() => window.print()}>
          Imprimir
        </button>
      </div>

      {report.isError && (
        <div className="alert alert-error no-print" style={{ width: '210mm', maxWidth: '100%', margin: '0 auto 0.75rem' }}>
          {(report.error as Error)?.message ?? 'Erro ao carregar relatório.'}
        </div>
      )}

      <A4ReportPages
        header={
          <StandardReportHeader
            documentTitle="Itens vendidos"
            documentExtras={<p className="print-sub">{subtitle}</p>}
          />
        }
        items={reportItems}
        layoutKey={`cash-items:${report.status}:${report.data?.items.length ?? 0}:${userId}`}
      />
    </div>
  );
}
