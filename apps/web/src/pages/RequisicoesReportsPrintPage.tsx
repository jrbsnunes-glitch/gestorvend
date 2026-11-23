import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { A4ReportPages, type A4Item } from '../components/A4ReportPages';
import { PrintActions } from '../components/PrintActions';
import { ReportPartyBanner } from '../components/ReportPartyBanner';
import { StandardReportHeader } from '../components/StandardReportHeader';
import { api } from '../lib/api';
import { formatBRL, formatCalendarDate, formatCpfCnpj, formatDate } from '../lib/format';
import { scheduleAutoPrint } from '../lib/print-page';
import './cash-print.css';

type SalesReport = {
  title: string;
  period: { from: string; to: string };
  note: string;
  lines: Array<{
    number: number;
    createdAt: string;
    customerName: string;
    customerDocument: string | null;
    source: string;
    itemCount: number;
    installments: number;
    total: string;
    remaining: string;
    openTitles: number;
    nextDueDate: string | null;
    status: string;
    items?: ReportProduct[];
  }>;
  totals: { count: number; total: string; remaining: string };
};

type OpenInstallmentsReport = {
  title: string;
  period: { from: string | null; to: string | null } | null;
  note: string;
  lines: Array<{
    dueDate: string;
    saleNumber: number | null;
    saleDate: string | null;
    customerName: string;
    customerDocument: string | null;
    description: string;
    amount: string;
    amountRemaining: string;
    status: string;
    visibleInFinance: boolean;
    items?: ReportProduct[];
  }>;
  totals: { count: number; remaining: string; hiddenFromFinance: number };
};

type ReportProduct = {
  productName: string;
  sku: string | null;
  quantity: number;
  unitPrice: string;
  totalLine: string;
};

const SOURCE_LABELS: Record<string, string> = {
  PDV: 'PDV',
  REQUISITION: 'Manual',
  WHATSAPP: 'WhatsApp',
  NFE_FORM: 'Formulário NF-e',
  RESTAURANT: 'Salão',
  DELIVERY: 'Delivery',
};

function saleStatusLabel(status: string, openTitles: number): string {
  if (status === 'CANCELLED') return 'Cancelada';
  if (openTitles > 0) return 'Em aberto';
  return 'Quitada';
}

export function RequisicoesReportsPrintPage() {
  const [params] = useSearchParams();
  const report = params.get('report') === 'open-installments' ? 'open-installments' : 'sales';

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (params.get('customerId')) p.set('customerId', params.get('customerId')!);
    if (params.get('from')) p.set('from', params.get('from')!);
    if (params.get('to')) p.set('to', params.get('to')!);
    if (params.get('detalhar') === '1') p.set('detalhar', '1');
    return p.toString();
  }, [params]);

  const endpoint =
    report === 'open-installments'
      ? '/requisitions/reports/open-installments'
      : '/requisitions/reports/sales';

  const query = useQuery({
    queryKey: ['requisition-reports', report, qs],
    queryFn: () => api<SalesReport | OpenInstallmentsReport>(`${endpoint}?${qs}`),
    enabled: report === 'open-installments' || Boolean(params.get('from') && params.get('to')),
  });

  const printed = useRef(false);
  const onReady = useCallback(
    (count: number) => {
      if (printed.current || count < 1 || !query.isSuccess) return;
      printed.current = true;
      scheduleAutoPrint();
    },
    [query.isSuccess],
  );

  const err =
    report === 'sales' && (!params.get('from') || !params.get('to'))
      ? 'Informe o período pela data da venda.'
      : query.isError
        ? (query.error as Error).message
        : null;

  const documentTitle =
    report === 'open-installments'
      ? 'Requisições — parcelas em aberto'
      : 'Requisições — por cliente e período';

  const detalhar = params.get('detalhar') === '1';
  const customerName = params.get('customerName')?.trim() ?? '';

  const reportItems = useMemo((): A4Item[] => {
    if (query.isLoading) return [{ kind: 'block', key: 'loading', node: <p>Carregando relatório…</p> }];
    if (!query.data) return customerName ? [partyBlock(customerName, null)] : [];
    const body =
      report === 'open-installments'
        ? openItems(query.data as OpenInstallmentsReport, detalhar)
        : salesItems(query.data as SalesReport, detalhar);
    const party = partyFromLines(customerName, query.data.lines);
    return party ? [partyBlock(party.name, party.document), ...body] : body;
  }, [query.data, query.isLoading, report, detalhar, customerName]);

  return (
    <div className="print-page">
      <div className="print-toolbar no-print">
        <Link className="btn btn-secondary" to="/requisicoes">
          ← Voltar às requisições
        </Link>
        <div style={{ flex: 1 }} />
        <PrintActions />
      </div>
      {err ? (
        <div className="alert alert-error no-print" style={{ width: '210mm', maxWidth: '100%', margin: '0 auto 0.75rem' }}>
          {err}
        </div>
      ) : null}
      <A4ReportPages
        header={<StandardReportHeader documentTitle={documentTitle} />}
        items={reportItems}
        layoutKey={`requisitions:${report}:${detalhar ? 'itens' : 'resumo'}:${query.dataUpdatedAt}`}
        onReady={onReady}
      />
    </div>
  );
}

function partyFromLines(
  filteredName: string,
  lines: Array<{ customerName: string; customerDocument: string | null }>,
): { name: string; document: string | null } | null {
  const named = lines.filter((line) => line.customerName && line.customerName !== '—');
  const unique = [...new Set(named.map((line) => line.customerName))];
  if (filteredName) {
    const match = named.find((line) => line.customerName === filteredName);
    return { name: filteredName, document: unique.length === 1 ? (match?.customerDocument ?? null) : null };
  }
  if (unique.length !== 1) return null;
  return { name: unique[0], document: named[0]?.customerDocument ?? null };
}

function partyBlock(name: string, document: string | null): A4Item {
  return {
    kind: 'block',
    key: 'party',
    node: <ReportPartyBanner name={name} document={document} />,
  };
}

function productLines(items: ReportProduct[] | undefined) {
  if (!items?.length) return null;
  return (
    <div style={{ fontSize: '0.78rem', lineHeight: 1.35 }}>
      {items.map((it, index) => (
        <div key={`${it.sku ?? it.productName}-${index}`}>
          {it.productName}
          {it.sku ? ` (${it.sku})` : ''} — {formatQty(it.quantity)} un · {formatBRL(it.totalLine)}
        </div>
      ))}
    </div>
  );
}

function formatQty(n: number): string {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(n);
}

function salesItems(data: SalesReport, detalhar: boolean): A4Item[] {
  return [
    {
      kind: 'block',
      key: 'intro',
      node: (
        <>
          <p className="print-sub">{data.note}</p>
          <p className="print-sub">
            Período: {formatCalendarDate(data.period.from)} a {formatCalendarDate(data.period.to)} ·{' '}
            {data.totals.count} requisição(ões) · Total {formatBRL(data.totals.total)} · Em aberto{' '}
            {formatBRL(data.totals.remaining)}
          </p>
        </>
      ),
    },
    {
      kind: 'table',
      key: 'sales',
      tableClassName: 'data-table',
      head: (
        <tr>
          <th>Nº</th>
          <th>Data</th>
          <th>Cliente</th>
          <th>Origem</th>
          <th className="num">Itens</th>
          <th className="num">Parc.</th>
          <th className="num">Total</th>
          <th className="num">Em aberto</th>
          <th>Próx. venc.</th>
          <th>Situação</th>
        </tr>
      ),
      rows: data.lines.flatMap((r) => {
        const products = detalhar ? productLines(r.items) : null;
        return [
          <tr key={r.number}>
            <td>#{r.number}</td>
            <td>{formatDate(r.createdAt)}</td>
            <td>
              {r.customerName}
              {r.customerDocument ? (
                <div style={{ fontSize: '0.78rem' }}>{formatCpfCnpj(r.customerDocument)}</div>
              ) : null}
            </td>
            <td>{SOURCE_LABELS[r.source] ?? r.source}</td>
            <td className="num">{r.itemCount}</td>
            <td className="num">{r.installments}x</td>
            <td className="num">{formatBRL(r.total)}</td>
            <td className="num">{formatBRL(r.remaining)}</td>
            <td>{r.nextDueDate ? formatCalendarDate(r.nextDueDate) : '—'}</td>
            <td>{saleStatusLabel(r.status, r.openTitles)}</td>
          </tr>,
          ...(products
            ? [
                <tr key={`${r.number}-itens`}>
                  <td colSpan={10}>{products}</td>
                </tr>,
              ]
            : []),
        ];
      }),
      empty: (
        <tr>
          <td colSpan={10}>Nenhuma requisição no período.</td>
        </tr>
      ),
    },
  ];
}

function openItems(data: OpenInstallmentsReport, detalhar: boolean): A4Item[] {
  const period =
    data.period?.from || data.period?.to
      ? `Vencimento: ${data.period?.from ? formatCalendarDate(data.period.from) : '…'} a ${
          data.period?.to ? formatCalendarDate(data.period.to) : '…'
        }`
      : 'Todos os vencimentos em aberto';
  return [
    {
      kind: 'block',
      key: 'intro',
      node: (
        <>
          <p className="print-sub">{data.note}</p>
          <p className="print-sub">
            {period} · {data.totals.count} parcela(s) · Em aberto {formatBRL(data.totals.remaining)}
            {data.totals.hiddenFromFinance > 0
              ? ` · ${data.totals.hiddenFromFinance} fora de Contas a receber (marcadas só como crédito)`
              : ''}
          </p>
        </>
      ),
    },
    {
      kind: 'table',
      key: 'installments',
      tableClassName: 'data-table',
      head: (
        <tr>
          <th>Vencimento</th>
          <th>Venda</th>
          <th>Data da venda</th>
          <th>Cliente</th>
          <th>Descrição</th>
          <th className="num">Valor</th>
          <th className="num">Em aberto</th>
          <th>Situação</th>
        </tr>
      ),
      rows: data.lines.flatMap((r, index) => {
        const products = detalhar ? productLines(r.items) : null;
        const key = `${r.saleNumber}-${r.dueDate}-${index}`;
        return [
          <tr key={key}>
            <td>{formatCalendarDate(r.dueDate)}</td>
            <td>{r.saleNumber != null ? `#${r.saleNumber}` : '—'}</td>
            <td>{r.saleDate ? formatCalendarDate(r.saleDate) : '—'}</td>
            <td>
              {r.customerName}
              {!r.visibleInFinance ? (
                <div style={{ fontSize: '0.78rem' }}>Não entra em Contas a receber</div>
              ) : null}
            </td>
            <td>{r.description}</td>
            <td className="num">{formatBRL(r.amount)}</td>
            <td className="num">{formatBRL(r.amountRemaining)}</td>
            <td>{r.status === 'OVERDUE' ? 'Vencido' : 'Em aberto'}</td>
          </tr>,
          ...(products
            ? [
                <tr key={`${key}-itens`}>
                  <td colSpan={8}>{products}</td>
                </tr>,
              ]
            : []),
        ];
      }),
      empty: (
        <tr>
          <td colSpan={8}>Nenhuma parcela em aberto no filtro.</td>
        </tr>
      ),
    },
  ];
}
