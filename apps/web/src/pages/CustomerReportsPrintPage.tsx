import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { StandardReportHeader } from '../components/StandardReportHeader';
import { api } from '../lib/api';
import { PAYMENT_LABELS } from '../lib/finance-bills';
import { formatBRL, formatCpfCnpj, formatDate } from '../lib/format';

type CreditLimitsReport = {
  title: string;
  note: string;
  lines: Array<{
    name: string;
    document: string | null;
    segment: string | null;
    creditBalance: string;
    requisitionLimit: string;
    requisitionUsed: string;
    requisitionAvailable: string;
  }>;
  totals: { customers: number; creditBalance: string; requisitionOpen: string };
};

type DelinquencyReport = {
  title: string;
  asOf: string;
  note: string;
  lines: Array<{
    name: string;
    document: string | null;
    segment: string | null;
    openTitles: number;
    totalOverdue: string;
    oldestDueDate: string;
    maxDaysOverdue: number;
    titles: Array<{
      description: string;
      dueDate: string;
      amountRemaining: string;
      status: string;
      saleNumber: number | null;
      daysOverdue: number;
    }>;
  }>;
  totals: { customers: number; titles: number; totalOverdue: string };
};

type SalesHistoryReport = {
  title: string;
  period: { from: string; to: string };
  customer: { name: string; document: string | null; segment: string | null };
  note?: string;
  lines: Array<{
    number: number;
    createdAt: string;
    total: string;
    itemCount: number;
    payments: Array<{ method: string; amount: string }>;
    items: Array<{ productName: string; sku: string; quantity: string; totalLine: string }>;
  }>;
  totals: { sales: number; revenue: string };
};

function paymentLabel(method: string): string {
  return PAYMENT_LABELS[method as keyof typeof PAYMENT_LABELS] ?? method;
}

export function CustomerReportsPrintPage() {
  const [params] = useSearchParams();
  const report = params.get('report') ?? 'credit-limits';

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (params.get('customerId')) p.set('customerId', params.get('customerId')!);
    if (params.get('segment')) p.set('segment', params.get('segment')!);
    if (params.get('from')) p.set('from', params.get('from')!);
    if (params.get('to')) p.set('to', params.get('to')!);
    return p.toString();
  }, [params]);

  const endpoint =
    report === 'delinquency'
      ? '/reports/customers/delinquency'
      : report === 'sales-history'
        ? '/reports/customers/sales-history'
        : '/reports/customers/credit-limits';

  const query = useQuery({
    queryKey: ['customer-reports', report, qs],
    queryFn: () => api<CreditLimitsReport | DelinquencyReport | SalesHistoryReport>(`${endpoint}?${qs}`),
    enabled:
      report === 'sales-history'
        ? Boolean(params.get('customerId') && params.get('from') && params.get('to'))
        : true,
  });

  useEffect(() => {
    if (query.isSuccess) {
      const t = window.setTimeout(() => window.print(), 400);
      return () => window.clearTimeout(t);
    }
  }, [query.isSuccess]);

  const err =
    report === 'sales-history' && !params.get('customerId')
      ? 'Informe o cliente para gerar o histórico de vendas.'
      : report === 'sales-history' && (!params.get('from') || !params.get('to'))
        ? 'Informe o período (de/até) para o histórico de vendas.'
        : query.isError
          ? (query.error as Error).message
          : null;

  return (
    <div className="page print-area gv-report-sheet">
      <StandardReportHeader
        documentTitle={
          report === 'delinquency'
            ? 'Clientes — inadimplência'
            : report === 'sales-history'
              ? 'Clientes — histórico de vendas'
              : 'Clientes — limites crédito / requisição'
        }
        documentExtras={
          <p className="print-sub page-desc no-print" style={{ marginBottom: 0 }}>
            <Link to="/clientes">← Voltar aos clientes</Link>
          </p>
        }
      />

      {query.isLoading && <p>Carregando relatório…</p>}
      {err && <div className="alert alert-error">{err}</div>}

      {query.data && report === 'credit-limits' && (
        <CreditLimitsView data={query.data as CreditLimitsReport} />
      )}
      {query.data && report === 'delinquency' && (
        <DelinquencyView data={query.data as DelinquencyReport} />
      )}
      {query.data && report === 'sales-history' && (
        <SalesHistoryView data={query.data as SalesHistoryReport} />
      )}
    </div>
  );
}

function CreditLimitsView({ data }: { data: CreditLimitsReport }) {
  return (
    <>
      <p className="page-desc">{data.note}</p>
      <p>
        {data.totals.customers} cliente(s) · Saldo crédito total {formatBRL(data.totals.creditBalance)} ·
        Requisição em aberto {formatBRL(data.totals.requisitionOpen)}
      </p>
      <table className="data-table">
        <thead>
          <tr>
            <th>Cliente</th>
            <th>Documento</th>
            <th>Grupo</th>
            <th className="num">Saldo crédito</th>
            <th className="num">Lim. requisição</th>
            <th className="num">Req. em aberto</th>
            <th className="num">Req. disponível</th>
          </tr>
        </thead>
        <tbody>
          {data.lines.length === 0 && (
            <tr>
              <td colSpan={7}>Nenhum cliente no filtro.</td>
            </tr>
          )}
          {data.lines.map((r) => (
            <tr key={`${r.name}-${r.document}`}>
              <td>{r.name}</td>
              <td>{r.document ? formatCpfCnpj(r.document) : '—'}</td>
              <td>{r.segment ?? '—'}</td>
              <td className="num">{formatBRL(r.creditBalance)}</td>
              <td className="num">{formatBRL(r.requisitionLimit)}</td>
              <td className="num">{formatBRL(r.requisitionUsed)}</td>
              <td className="num">{formatBRL(r.requisitionAvailable)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function DelinquencyView({ data }: { data: DelinquencyReport }) {
  return (
    <>
      <p className="page-desc">
        {data.note} Referência: {formatDate(data.asOf)}.
      </p>
      <p>
        {data.totals.customers} cliente(s) · {data.totals.titles} título(s) · Total em atraso{' '}
        {formatBRL(data.totals.totalOverdue)}
      </p>
      {data.lines.length === 0 ? (
        <p>Nenhum cliente inadimplente no filtro.</p>
      ) : (
        data.lines.map((c) => (
          <section key={c.name} style={{ marginBottom: '1.25rem', breakInside: 'avoid' }}>
            <h2 style={{ fontSize: '1rem', marginBottom: '0.35rem' }}>
              {c.name}
              {c.document ? ` · ${formatCpfCnpj(c.document)}` : ''}
              {c.segment ? ` · ${c.segment}` : ''}
            </h2>
            <p style={{ margin: '0 0 0.5rem', fontSize: '0.9rem' }}>
              {c.openTitles} título(s) · Total {formatBRL(c.totalOverdue)} · Maior atraso{' '}
              {c.maxDaysOverdue} dia(s) · Vencimento mais antigo {formatDate(c.oldestDueDate)}
            </p>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Vencimento</th>
                  <th>Descrição</th>
                  <th>Venda</th>
                  <th className="num">Em aberto</th>
                  <th className="num">Dias atraso</th>
                  <th>Situação</th>
                </tr>
              </thead>
              <tbody>
                {c.titles.map((t) => (
                  <tr key={t.description + t.dueDate}>
                    <td>{formatDate(t.dueDate)}</td>
                    <td>{t.description}</td>
                    <td>{t.saleNumber != null ? `#${t.saleNumber}` : '—'}</td>
                    <td className="num">{formatBRL(t.amountRemaining)}</td>
                    <td className="num">{t.daysOverdue}</td>
                    <td>{t.status === 'OVERDUE' ? 'Vencido' : 'Em aberto'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))
      )}
    </>
  );
}

function SalesHistoryView({ data }: { data: SalesHistoryReport }) {
  return (
    <>
      <p className="page-desc">
        Cliente: <strong>{data.customer.name}</strong>
        {data.customer.document ? ` · ${formatCpfCnpj(data.customer.document)}` : ''}
        {data.customer.segment ? ` · ${data.customer.segment}` : ''}
        <br />
        Período: {formatDate(data.period.from)} a {formatDate(data.period.to)}
      </p>
      <p>
        {data.totals.sales} venda(s) concluída(s) · Total {formatBRL(data.totals.revenue)}
      </p>
      {data.lines.length === 0 ? (
        <p>Nenhuma venda no período.</p>
      ) : (
        data.lines.map((s) => (
          <section key={s.number} style={{ marginBottom: '1rem', breakInside: 'avoid' }}>
            <h2 style={{ fontSize: '1rem', marginBottom: '0.25rem' }}>
              Venda #{s.number} · {formatDate(s.createdAt)} · {formatBRL(s.total)}
            </h2>
            <p style={{ margin: '0 0 0.35rem', fontSize: '0.88rem' }}>
              Pagamentos:{' '}
              {s.payments.map((p) => `${paymentLabel(p.method)} ${formatBRL(p.amount)}`).join(' · ') ||
                '—'}
            </p>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Produto</th>
                  <th>SKU</th>
                  <th className="num">Qtd</th>
                  <th className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {s.items.map((it) => (
                  <tr key={`${it.sku}-${it.productName}`}>
                    <td>{it.productName}</td>
                    <td>{it.sku}</td>
                    <td className="num">{it.quantity}</td>
                    <td className="num">{formatBRL(it.totalLine)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))
      )}
    </>
  );
}
