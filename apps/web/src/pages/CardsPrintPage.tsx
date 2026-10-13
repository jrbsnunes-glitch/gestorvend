import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { A4ReportPages, type A4Item } from '../components/A4ReportPages';
import { StandardReportHeader } from '../components/StandardReportHeader';
import { api } from '../lib/api';
import './cash-print.css';
import { formatBRL, formatDate } from '../lib/format';
import { cardBrandLabel, cardOperationLabel } from '../lib/payment-forms';

type CardRow = {
  id: string;
  amount: string;
  installments: number;
  cardBrand: string | null;
  cardOperation: string | null;
  adminFeeAmount: string;
  settlementStatus: string | null;
  paymentForm: { name: string } | null;
  sale: {
    number: number;
    createdAt: string;
    customer: { name: string } | null;
  };
};

export function CardsPrintPage() {
  const [params] = useSearchParams();
  const report = params.get('report') ?? 'period';

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    p.set('take', '500');
    p.set('skip', '0');
    if (params.get('dateFrom')) p.set('dateFrom', params.get('dateFrom')!);
    if (params.get('dateTo')) p.set('dateTo', params.get('dateTo')!);
    if (params.get('brand')) p.set('brand', params.get('brand')!);
    if (params.get('settlement')) p.set('settlement', params.get('settlement')!);
    if (params.get('paymentFormId')) p.set('paymentFormId', params.get('paymentFormId')!);
    if (params.get('cardOperation')) p.set('cardOperation', params.get('cardOperation')!);
    return p.toString();
  }, [params]);

  const list = useQuery({
    queryKey: ['card-transactions', 'print', qs],
    queryFn: () => api<{ items: CardRow[] }>(`/card-transactions?${qs}`),
  });

  const printed = useRef(false);
  const onReady = useCallback((count: number) => {
    if (printed.current || count < 1 || !list.isSuccess) return;
    printed.current = true;
    window.setTimeout(() => window.print(), 400);
  }, [list.isSuccess]);

  const title =
    report === 'brand'
      ? 'Cartões por bandeira'
      : report === 'open'
        ? 'Cartões abertos'
        : report === 'settled'
          ? 'Cartões baixados'
          : 'Cartões por período';

  const items = list.data?.items ?? [];
  const total = items.reduce((s, r) => s + Number(r.amount), 0);
  const fees = items.reduce((s, r) => s + Number(r.adminFeeAmount), 0);

  const byBrand = useMemo(() => {
    const map = new Map<string, { count: number; amount: number }>();
    for (const r of items) {
      const key = r.cardBrand ?? 'OTHER';
      const cur = map.get(key) ?? { count: 0, amount: 0 };
      cur.count += 1;
      cur.amount += Number(r.amount);
      map.set(key, cur);
    }
    return [...map.entries()].sort((a, b) => b[1].amount - a[1].amount);
  }, [items]);

  const reportItems = useMemo((): A4Item[] => {
    const intro: A4Item = {
      kind: 'block',
      key: 'intro',
      node: (
        <p className="print-sub">
          {items.length} transação(ões) · Total {formatBRL(total)} · Taxas {formatBRL(fees)}
        </p>
      ),
    };
    if (report === 'brand') {
      return [
        intro,
        {
          kind: 'table',
          key: 'brands',
          tableClassName: 'data-table',
          head: (
            <tr>
              <th>Bandeira</th>
              <th className="num">Qtd</th>
              <th className="num">Total</th>
            </tr>
          ),
          rows: byBrand.map(([brand, v]) => (
            <tr key={brand}>
              <td>{cardBrandLabel(brand)}</td>
              <td className="num">{v.count}</td>
              <td className="num">{formatBRL(v.amount)}</td>
            </tr>
          )),
          empty: (
            <tr>
              <td colSpan={3}>Nenhuma transação.</td>
            </tr>
          ),
        },
      ];
    }
    return [
      intro,
      {
        kind: 'table',
        key: 'cards',
        tableClassName: 'data-table',
        head: (
          <tr>
            <th>Data</th>
            <th>Venda</th>
            <th>Cliente</th>
            <th>Forma</th>
            <th>Bandeira</th>
            <th className="num">Valor</th>
            <th>Situação</th>
          </tr>
        ),
        rows: items.map((r) => (
          <tr key={r.id}>
            <td>{formatDate(r.sale.createdAt)}</td>
            <td>#{r.sale.number}</td>
            <td>{r.sale.customer?.name ?? 'Consumidor'}</td>
            <td>{r.paymentForm?.name ?? 'Cartão'}</td>
            <td>
              {cardBrandLabel(r.cardBrand)} · {cardOperationLabel(r.cardOperation)}
            </td>
            <td className="num">{formatBRL(Number(r.amount))}</td>
            <td>{r.settlementStatus === 'SETTLED' ? 'Baixado' : 'Aberto'}</td>
          </tr>
        )),
        empty: (
          <tr>
            <td colSpan={7}>Nenhuma transação.</td>
          </tr>
        ),
      },
    ];
  }, [byBrand, fees, items, report, total]);

  return (
    <div className="print-page">
      <div className="print-toolbar no-print">
        <Link className="btn btn-secondary" to="/cartoes">
          ← Voltar
        </Link>
        <div style={{ flex: 1 }} />
        <button type="button" className="btn btn-primary" onClick={() => window.print()}>
          Imprimir
        </button>
      </div>
      <A4ReportPages
        header={<StandardReportHeader documentTitle={`Cartões — ${title}`} />}
        items={reportItems}
        layoutKey={`cards:${report}:${items.length}:${list.isSuccess}`}
        onReady={onReady}
      />
    </div>
  );
}
