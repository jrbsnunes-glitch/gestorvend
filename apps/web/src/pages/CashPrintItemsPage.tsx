import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CompanyHeader } from '../components/CompanyHeader';
import { api } from '../lib/api';
import { formatBRL } from '../lib/format';
import './cash-print.css';

type ItemRow = {
  saleId: string;
  saleNumber: number;
  saleStatus: 'COMPLETED' | 'CANCELLED' | string;
  saleCreatedAt: string;
  saleTotal: string;
  user: { id: string; name: string; email: string } | null;
  customer: { id: string; name: string } | null;
  payments: { method: string; amount: string }[];
  itemId: string;
  productName: string;
  sku: string | null;
  barcode: string | null;
  quantity: string;
  unitPrice: string;
  discount: string;
  totalLine: string;
};

type Report = {
  from: string;
  to: string;
  userId: string | null;
  status: string;
  items: ItemRow[];
  totals: {
    totalItems: number;
    totalGross: number;
    totalDiscount: number;
    totalNet: number;
    completedLineCount: number;
    cancelledLineCount: number;
  };
  byProduct: { name: string; sku: string | null; quantity: number; total: number }[];
  byUser: { name: string; email: string; quantity: number; total: number }[];
};

type Me = { name: string; email: string };
type Operator = { id: string; name: string; email: string };

type Company = {
  legalName: string;
  tradeName: string;
  cnpj: string;
  ie: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  logoUrl: string | null;
};

const PAYMENT_LABELS: Record<string, string> = {
  CASH: 'Dinheiro',
  CARD: 'Cartão',
  PIX: 'Pix',
  CREDIT: 'Crediário',
  OTHER: 'Outro',
};

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
  return new Date(iso).toLocaleString('pt-BR');
}

function periodLabel(from: string, to: string): string {
  const f = parseLocalDate(from);
  const t = parseLocalDate(to);
  const sameDay =
    f.getFullYear() === t.getFullYear() &&
    f.getMonth() === t.getMonth() &&
    f.getDate() === t.getDate();
  return sameDay
    ? `Itens vendidos em ${f.toLocaleDateString('pt-BR')}`
    : `Itens vendidos de ${f.toLocaleDateString('pt-BR')} a ${t.toLocaleDateString('pt-BR')}`;
}

export function CashPrintItemsPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const userId = params.get('userId') ?? '';
  const status = params.get('status') ?? 'COMPLETED';

  const report = useQuery({
    queryKey: ['cash', 'report-items', from, to, userId, status],
    queryFn: () => {
      const qs = new URLSearchParams({ from, to, status });
      if (userId) qs.set('userId', userId);
      return api<Report>(`/cash/report/items?${qs.toString()}`);
    },
    enabled: !!from && !!to,
  });

  const me = useQuery({
    queryKey: ['users', 'me'],
    queryFn: () => api<Me>('/users/me'),
    staleTime: 5 * 60_000,
  });

  const company = useQuery({
    queryKey: ['company'],
    queryFn: () => api<Company>('/company'),
    staleTime: 10 * 60_000,
  });

  // Para mostrar o nome do operador filtrado (sem precisar de outra rota).
  const operators = useQuery({
    queryKey: ['users'],
    queryFn: () => api<Operator[]>('/users'),
    staleTime: 5 * 60_000,
    enabled: !!userId,
  });

  const operatorLabel = useMemo(() => {
    if (!userId) return null;
    const op = operators.data?.find((u) => u.id === userId);
    return op ? op.name : userId;
  }, [userId, operators.data]);

  if (!from || !to) {
    return (
      <div className="print-page">
        <p>Parâmetros inválidos. Volte e selecione um período.</p>
        <button type="button" className="btn btn-primary" onClick={() => navigate('/caixa')}>
          Voltar
        </button>
      </div>
    );
  }

  const data = report.data;

  return (
    <div className="print-page">
      <div className="print-toolbar no-print">
        <button type="button" className="btn btn-secondary" onClick={() => navigate('/caixa')}>
          ← Voltar
        </button>
        <div style={{ flex: 1 }} />
        <button type="button" className="btn btn-primary" onClick={() => window.print()}>
          🖨 Imprimir agora
        </button>
      </div>

      <div className="print-doc">
        <CompanyHeader company={company.data ?? null} />
        <header className="print-head">
          <div>
            <h1>Relatório de Itens Vendidos</h1>
            <p className="print-sub">{periodLabel(from, to)}</p>
            {operatorLabel && (
              <p className="print-sub" style={{ marginTop: '0.15rem' }}>
                Operador: <strong>{operatorLabel}</strong>
              </p>
            )}
          </div>
          <div className="print-meta">
            <div>
              <span className="print-meta-label">Gerado em</span>
              <strong>{new Date().toLocaleString('pt-BR')}</strong>
            </div>
            <div>
              <span className="print-meta-label">Por</span>
              <strong>{me.data?.name ?? '—'}</strong>
            </div>
          </div>
        </header>

        {report.isLoading && <p>Carregando…</p>}
        {report.isError && (
          <div className="alert alert-error">
            {(report.error as Error)?.message ?? 'Erro ao carregar relatório.'}
          </div>
        )}

        {data && (
          <>
            {/* Resumo do período */}
            <section className="print-section">
              <h2>Resumo</h2>
              <div className="print-kpis">
                <KpiPrint
                  label="Itens vendidos"
                  value={String(Math.round(data.totals.totalItems * 100) / 100)}
                />
                <KpiPrint label="Linhas (concluídas)" value={String(data.totals.completedLineCount)} />
                <KpiPrint
                  label="Linhas (canceladas)"
                  value={String(data.totals.cancelledLineCount)}
                  muted
                />
                <KpiPrint
                  label="Total líquido"
                  value={formatBRL(data.totals.totalNet)}
                  highlight
                />
              </div>
            </section>

            {/* Resumo por produto */}
            {data.byProduct.length > 0 && (
              <section className="print-section">
                <h2>Resumo por produto (vendas concluídas)</h2>
                <table className="print-table">
                  <thead>
                    <tr>
                      <th>Produto</th>
                      <th>SKU</th>
                      <th className="num">Qtd</th>
                      <th className="num">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byProduct.map((p, i) => (
                      <tr key={`${p.name}-${i}`}>
                        <td>{p.name}</td>
                        <td>{p.sku ?? '—'}</td>
                        <td className="num">{p.quantity}</td>
                        <td className="num">{formatBRL(p.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th colSpan={2}>Total</th>
                      <th className="num">
                        {Math.round(data.totals.totalItems * 100) / 100}
                      </th>
                      <th className="num">{formatBRL(data.totals.totalNet)}</th>
                    </tr>
                  </tfoot>
                </table>
              </section>
            )}

            {/* Resumo por operador — só faz sentido quando não filtrou um único */}
            {!userId && data.byUser.length > 1 && (
              <section className="print-section">
                <h2>Resumo por operador</h2>
                <table className="print-table">
                  <thead>
                    <tr>
                      <th>Operador</th>
                      <th className="num">Itens</th>
                      <th className="num">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byUser.map((u, i) => (
                      <tr key={`${u.name}-${i}`}>
                        <td>
                          {u.name}
                          {u.email && (
                            <span style={{ color: '#64748b', marginLeft: 6 }}>· {u.email}</span>
                          )}
                        </td>
                        <td className="num">{u.quantity}</td>
                        <td className="num">{formatBRL(u.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}

            {/* Lista detalhada de itens */}
            <section className="print-section">
              <h2>Detalhamento item a item</h2>
              {data.items.length === 0 ? (
                <p className="print-empty">Nenhum item vendido no período.</p>
              ) : (
                <table className="print-table">
                  <thead>
                    <tr>
                      <th>Data / Hora</th>
                      <th>Venda</th>
                      {!userId && <th>Operador</th>}
                      <th>Produto</th>
                      <th>SKU</th>
                      <th className="num">Qtd</th>
                      <th className="num">Unit.</th>
                      <th className="num">Desc.</th>
                      <th className="num">Total</th>
                      <th>Pgto.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((it) => (
                      <tr
                        key={it.itemId}
                        className={it.saleStatus === 'CANCELLED' ? 'is-cancelled' : ''}
                      >
                        <td>{fmtDateTime(it.saleCreatedAt)}</td>
                        <td>
                          #{it.saleNumber}
                          {it.saleStatus === 'CANCELLED' && (
                            <span className="badge-cancelled"> CANCELADA</span>
                          )}
                        </td>
                        {!userId && <td>{it.user?.name ?? '—'}</td>}
                        <td>{it.productName}</td>
                        <td>{it.sku ?? '—'}</td>
                        <td className="num">{Number(it.quantity)}</td>
                        <td className="num">{formatBRL(it.unitPrice)}</td>
                        <td className="num">
                          {Number(it.discount) > 0 ? formatBRL(it.discount) : '—'}
                        </td>
                        <td className="num">{formatBRL(it.totalLine)}</td>
                        <td>{paymentsLabel(it.payments)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th colSpan={userId ? 5 : 6}>Total</th>
                      <th className="num">{Math.round(data.totals.totalItems * 100) / 100}</th>
                      <th />
                      <th className="num">{formatBRL(data.totals.totalDiscount)}</th>
                      <th className="num">{formatBRL(data.totals.totalNet)}</th>
                      <th />
                    </tr>
                  </tfoot>
                </table>
              )}
            </section>

            <footer className="print-foot">
              <span>
                GestorVend · Itens vendidos · {fmtDate(from)} – {fmtDate(to)}
              </span>
              <span>Página gerada por {me.data?.name ?? '—'}</span>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}

function paymentsLabel(payments: { method: string; amount: string }[]): string {
  if (payments.length === 0) return '—';
  // Agrupa por método (várias parcelas no mesmo método).
  const map = new Map<string, number>();
  for (const p of payments) {
    map.set(p.method, (map.get(p.method) ?? 0) + Number(p.amount));
  }
  return Array.from(map.entries())
    .map(([k, v]) => `${PAYMENT_LABELS[k] ?? k} ${formatBRL(v)}`)
    .join(' · ');
}

function KpiPrint({
  label,
  value,
  highlight,
  muted,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  muted?: boolean;
}) {
  return (
    <div className={'print-kpi' + (highlight ? ' is-highlight' : muted ? ' is-muted' : '')}>
      <span className="print-kpi-label">{label}</span>
      <strong className="print-kpi-value">{value}</strong>
    </div>
  );
}
