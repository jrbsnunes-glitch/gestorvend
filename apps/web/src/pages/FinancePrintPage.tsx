import { useQueries, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { StandardReportHeader } from '../components/StandardReportHeader';
import { BillPaymentsButton } from '../components/BillSettlementsModal';
import { api } from '../lib/api';
import { hasInformedPayment, PAYMENT_LABELS, saldoAbertoBill } from '../lib/finance-bills';
import { formatBRL, formatDate } from '../lib/format';
import './cash-print.css';

type CashSess = {
  id: string;
  controlNumber: number;
  user: { name: string; email: string } | null;
};

type SaleLineItem = {
  id: string;
  quantity: string;
  unitPrice: string;
  totalLine: string;
  variant: { sku: string; product: { name: string } };
};

type SaleBrief = {
  id: string;
  number: number;
  total: string;
  createdAt: string;
  items: SaleLineItem[];
};

type GoodsReceiptLineItem = {
  id: string;
  quantity: string;
  unitCost: string;
  description: string | null;
  variant: { sku: string; product: { name: string } };
};

type GoodsReceiptBrief = {
  id: string;
  controlNumber: number;
  documentNumber: string | null;
  issueDate: string | null;
  totalValue: string | null;
  items: GoodsReceiptLineItem[];
};

type ReceivableItem = {
  id: string;
  description: string;
  quantity: string;
  unitPrice: string;
  totalLine: string;
};

type Payable = {
  id: string;
  description: string;
  amount: string;
  amountRemaining?: string;
  dueDate: string;
  paidAt: string | null;
  status: string;
  paymentMethod: string | null;
  paymentNotes: string | null;
  settledAmount: string | null;
  goodsReceiptId?: string | null;
  goodsReceipt?: GoodsReceiptBrief | null;
  supplier: { legalName: string; segment: string | null } | null;
  cashSession: CashSess | null;
};

type Receivable = {
  id: string;
  description: string;
  amount: string;
  amountRemaining?: string;
  dueDate: string;
  receivedAt: string | null;
  status: string;
  paymentMethod: string | null;
  paymentNotes: string | null;
  settledAmount: string | null;
  saleId?: string | null;
  sale?: SaleBrief | null;
  items?: ReceivableItem[];
  customer: { name: string; segment: string | null } | null;
  cashSession: CashSess | null;
};

function saldoAberto(row: Payable | Receivable): string {
  return saldoAbertoBill(row);
}

/** Total já pago/recebido (baixas parciais acumuladas). */
function valorPagoAcumulado(row: Payable | Receivable): number | null {
  const s = row.settledAmount;
  if (s == null || String(s).trim() === '') return null;
  const n = Number(String(s).replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function tituloEmAbertoComParcial(row: Payable | Receivable): boolean {
  if (row.status === 'PAID') return false;
  return valorPagoAcumulado(row) != null;
}

function statusPt(s: string): string {
  switch (s) {
    case 'OPEN':
      return 'Em aberto';
    case 'PAID':
      return 'Pago';
    case 'OVERDUE':
      return 'Vencido';
    case 'CANCELLED':
      return 'Cancelado';
    default:
      return s;
  }
}

function lineLabel(name: string | undefined | null, sku?: string | null): string {
  const label = name?.trim() || '—';
  const s = sku?.trim();
  return s ? `${label} (${s})` : label;
}

type SoldLine = {
  key: string;
  description: string;
  quantity: string;
  unitPrice: string;
  totalLine: string;
};

type ReceivableSaleGroup = {
  saleId: string;
  sale: SaleBrief | null;
  rows: Receivable[];
};

function saleItemsToSoldLines(items: SaleLineItem[]): SoldLine[] {
  return items.map((it) => ({
    key: it.id,
    description: lineLabel(it.variant?.product?.name, it.variant?.sku),
    quantity: it.quantity,
    unitPrice: it.unitPrice,
    totalLine: it.totalLine,
  }));
}

function mergeReceivableItemsToSoldLines(rows: Receivable[]): SoldLine[] {
  const acc = new Map<string, { description: string; quantity: number; totalLine: number }>();
  for (const row of rows) {
    for (const it of row.items ?? []) {
      const desc = it.description.trim() || 'Item';
      const prev = acc.get(desc);
      const qty = Number(it.quantity);
      const total = Number(it.totalLine);
      if (!Number.isFinite(qty) || !Number.isFinite(total)) continue;
      if (prev) {
        prev.quantity += qty;
        prev.totalLine += total;
      } else {
        acc.set(desc, { description: desc, quantity: qty, totalLine: total });
      }
    }
  }
  return [...acc.entries()].map(([key, v]) => ({
    key,
    description: v.description,
    quantity: String(v.quantity),
    unitPrice: String(v.quantity > 0 ? (v.totalLine / v.quantity).toFixed(2) : v.totalLine.toFixed(2)),
    totalLine: v.totalLine.toFixed(2),
  }));
}

function resolveSoldLines(
  group: ReceivableSaleGroup,
  saleItemsById: Map<string, SaleLineItem[]>,
): SoldLine[] {
  const fromMap = saleItemsById.get(group.saleId);
  if (fromMap?.length) return saleItemsToSoldLines(fromMap);
  if (group.sale?.items?.length) return saleItemsToSoldLines(group.sale.items);
  return mergeReceivableItemsToSoldLines(group.rows);
}

function groupReceivablesBySale(rows: Receivable[]) {
  const groups = new Map<string, ReceivableSaleGroup>();
  const standalone: Receivable[] = [];
  for (const row of rows) {
    if (row.saleId) {
      const g = groups.get(row.saleId) ?? {
        saleId: row.saleId,
        sale: row.sale ?? null,
        rows: [],
      };
      if (row.sale && !g.sale) g.sale = row.sale;
      g.rows.push(row);
      groups.set(row.saleId, g);
    } else {
      standalone.push(row);
    }
  }
  return { groups: [...groups.values()], standalone };
}

function groupPayablesByReceipt(rows: Payable[]) {
  const groups = new Map<string, { receipt: GoodsReceiptBrief; rows: Payable[] }>();
  const standalone: Payable[] = [];
  for (const row of rows) {
    if (row.goodsReceiptId && row.goodsReceipt) {
      const g = groups.get(row.goodsReceiptId) ?? { receipt: row.goodsReceipt, rows: [] };
      g.rows.push(row);
      groups.set(row.goodsReceiptId, g);
    } else {
      standalone.push(row);
    }
  }
  return { groups: [...groups.values()], standalone };
}

export function FinancePrintPage() {
  const [sp] = useSearchParams();
  const tipo = sp.get('tipo') === 'receber' ? 'receber' : 'pagar';
  const modoRaw = sp.get('modo');
  const modo =
    modoRaw === 'conta' || modoRaw === 'abertas' || modoRaw === 'pagas' ? modoRaw : 'abertas';
  const id = sp.get('id') ?? '';
  const from = sp.get('from') ?? '';
  const to = sp.get('to') ?? '';
  const segment = sp.get('segment') ?? '';
  const partyId = sp.get('partyId') ?? '';
  const detalhar = sp.get('detalhar') === '1';

  const listQs = useMemo(() => {
    const p = new URLSearchParams();
    if (modo === 'abertas') {
      // Inclui vencidos e títulos com pagamento parcial (OPEN/OVERDUE com saldo).
      p.set('statusIn', 'OPEN,OVERDUE');
    }
    if (modo === 'pagas') p.set('status', 'PAID');
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    if (segment) p.set('segment', segment);
    if (partyId) {
      if (tipo === 'pagar') p.set('supplierId', partyId);
      else p.set('customerId', partyId);
    }
    if (detalhar) p.set('detalhar', '1');
    return p.toString();
  }, [modo, from, to, segment, partyId, tipo, detalhar]);

  const singlePayable = useQuery({
    queryKey: ['finance', 'payable', id],
    queryFn: () => api<Payable>(`/finance/payables/${id}`),
    enabled: tipo === 'pagar' && modo === 'conta' && !!id,
  });

  const singleReceivable = useQuery({
    queryKey: ['finance', 'receivable', id],
    queryFn: () => api<Receivable>(`/finance/receivables/${id}`),
    enabled: tipo === 'receber' && modo === 'conta' && !!id,
  });

  const listPayables = useQuery({
    queryKey: ['finance', 'payables', listQs],
    queryFn: () => api<Payable[]>(`/finance/payables?${listQs}`),
    enabled: tipo === 'pagar' && modo !== 'conta',
  });

  const listReceivables = useQuery({
    queryKey: ['finance', 'receivables', listQs],
    queryFn: () => api<Receivable[]>(`/finance/receivables?${listQs}`),
    enabled: tipo === 'receber' && modo !== 'conta',
    staleTime: 0,
  });

  const saleIdsNeedingItems = useMemo(() => {
    if (!detalhar || tipo !== 'receber' || !listReceivables.data?.length) return [];
    const ids = new Set<string>();
    for (const r of listReceivables.data) {
      if (!r.saleId) continue;
      if ((r.sale?.items?.length ?? 0) > 0) continue;
      ids.add(r.saleId);
    }
    return [...ids];
  }, [detalhar, tipo, listReceivables.data]);

  const saleDetailQueries = useQueries({
    queries: saleIdsNeedingItems.map((saleId) => ({
      queryKey: ['finance', 'print', 'sale', saleId],
      queryFn: () => api<SaleBrief>(`/sales/${saleId}`),
      staleTime: 0,
    })),
  });

  const saleItemsById = useMemo(() => {
    const map = new Map<string, SaleLineItem[]>();
    for (const r of listReceivables.data ?? []) {
      if (r.saleId && r.sale?.items?.length) {
        map.set(r.saleId, r.sale.items);
      }
    }
    saleIdsNeedingItems.forEach((saleId, idx) => {
      const items = saleDetailQueries[idx]?.data?.items;
      if (items?.length) map.set(saleId, items);
    });
    return map;
  }, [listReceivables.data, saleIdsNeedingItems, saleDetailQueries]);

  const salesItemsLoading =
    detalhar && saleDetailQueries.some((q) => q.isLoading || q.isFetching);

  const kindLabel = tipo === 'pagar' ? 'Contas a pagar' : 'Contas a receber';
  const modeLabel =
    modo === 'conta'
      ? 'Detalhe do título'
      : modo === 'abertas'
        ? 'Títulos em aberto (vencidos e parciais)'
        : 'Títulos liquidados';

  const subtitle = useMemo(() => {
    const parts: string[] = [];
    if (from && to) parts.push(`Período: ${formatDate(from)} — ${formatDate(to)}`);
    else if (from) parts.push(`A partir de ${formatDate(from)}`);
    else if (to) parts.push(`Até ${formatDate(to)}`);
    if (segment) parts.push(`Grupo: ${segment}`);
    return parts.length ? <span>{parts.join(' · ')}</span> : null;
  }, [from, to, segment]);

  const documentTitle = `${kindLabel} — ${modeLabel}`;

  const loading =
    (tipo === 'pagar' && modo === 'conta' && singlePayable.isLoading) ||
    (tipo === 'receber' && modo === 'conta' && singleReceivable.isLoading) ||
    (tipo === 'pagar' && modo !== 'conta' && listPayables.isLoading) ||
    (tipo === 'receber' && modo !== 'conta' && (listReceivables.isLoading || salesItemsLoading));

  const err =
    (tipo === 'pagar' && modo === 'conta' && singlePayable.error) ||
    (tipo === 'receber' && modo === 'conta' && singleReceivable.error) ||
    (tipo === 'pagar' && modo !== 'conta' && listPayables.error) ||
    (tipo === 'receber' && modo !== 'conta' && listReceivables.error);

  const errMessage = err
    ? err instanceof Error
      ? err.message
      : String(err)
    : null;

  const listReady =
    (tipo === 'pagar' && modo !== 'conta' && listPayables.isFetched) ||
    (tipo === 'receber' && modo !== 'conta' && listReceivables.isFetched);

  function PartyCell({ row }: { row: Payable | Receivable }) {
    if ('supplier' in row && row.supplier) {
      return (
        <span>
          {row.supplier.legalName}
          {row.supplier.segment ? ` — ${row.supplier.segment}` : ''}
        </span>
      );
    }
    if ('customer' in row && row.customer) {
      return (
        <span>
          {row.customer.name}
          {row.customer.segment ? ` — ${row.customer.segment}` : ''}
        </span>
      );
    }
    return <span>—</span>;
  }

  function renderReceivableBillRow(r: Receivable, idx: number, compact = false) {
    const vp = valorPagoAcumulado(r);
    return (
      <tr key={r.id} className={compact ? 'gv-finance-bill-row gv-finance-bill-row--nested' : undefined}>
        <td className="num">{idx + 1}</td>
        <td>{formatDate(r.dueDate)}</td>
        <td>{r.description}</td>
        <td>
          <PartyCell row={r} />
        </td>
        <td>{formatBRL(r.amount)}</td>
        <td>{vp != null ? formatBRL(vp) : '—'}</td>
        <td>{formatBRL(saldoAberto(r))}</td>
        <td>
          {statusPt(r.status)}
          {tituloEmAbertoComParcial(r) ? ' · parcial' : ''}
        </td>
        {modo === 'pagas' && (
          <>
            <td>{r.receivedAt ? formatDate(r.receivedAt) : '—'}</td>
            <td>{r.paymentMethod ? PAYMENT_LABELS[r.paymentMethod] ?? r.paymentMethod : '—'}</td>
          </>
        )}
        <td className="no-print" style={{ textAlign: 'right' }}>
          {hasInformedPayment(r) ? (
            <BillPaymentsButton kind="receber" billId={r.id} description={r.description} />
          ) : (
            '—'
          )}
        </td>
      </tr>
    );
  }

  function renderPayableBillRow(p: Payable, idx: number, compact = false) {
    const vp = valorPagoAcumulado(p);
    return (
      <tr key={p.id} className={compact ? 'gv-finance-bill-row gv-finance-bill-row--nested' : undefined}>
        <td className="num">{idx + 1}</td>
        <td>{formatDate(p.dueDate)}</td>
        <td>{p.description}</td>
        <td>
          <PartyCell row={p} />
        </td>
        <td>{formatBRL(p.amount)}</td>
        <td>{vp != null ? formatBRL(vp) : '—'}</td>
        <td>{formatBRL(saldoAberto(p))}</td>
        <td>
          {statusPt(p.status)}
          {tituloEmAbertoComParcial(p) ? ' · parcial' : ''}
        </td>
        {modo === 'pagas' && (
          <>
            <td>{p.paidAt ? formatDate(p.paidAt) : '—'}</td>
            <td>{p.paymentMethod ? PAYMENT_LABELS[p.paymentMethod] ?? p.paymentMethod : '—'}</td>
          </>
        )}
        <td className="no-print" style={{ textAlign: 'right' }}>
          {hasInformedPayment(p) ? (
            <BillPaymentsButton kind="pagar" billId={p.id} description={p.description} />
          ) : (
            '—'
          )}
        </td>
      </tr>
    );
  }

  function receivableListHead() {
    return (
      <thead>
        <tr>
          <th className="num">Cont.</th>
          <th>Vencimento</th>
          <th>Descrição</th>
          <th>Cliente</th>
          <th>Valor (face)</th>
          <th>Pago / recebido</th>
          <th>Saldo em aberto</th>
          <th>Status</th>
          {modo === 'pagas' && (
            <>
              <th>Recebido em</th>
              <th>Forma</th>
            </>
          )}
          <th className="no-print">Ações</th>
        </tr>
      </thead>
    );
  }

  function payableListHead() {
    return (
      <thead>
        <tr>
          <th className="num">Cont.</th>
          <th>Vencimento</th>
          <th>Descrição</th>
          <th>Fornecedor</th>
          <th>Valor (face)</th>
          <th>Pago / recebido</th>
          <th>Saldo em aberto</th>
          <th>Status</th>
          {modo === 'pagas' && (
            <>
              <th>Pago em</th>
              <th>Forma</th>
            </>
          )}
          <th className="no-print">Ações</th>
        </tr>
      </thead>
    );
  }

  function renderSoldItemsSection(lines: SoldLine[]) {
    return (
      <div className="gv-finance-sold-items">
        <p className="gv-finance-origin-group__items-title">Itens vendidos</p>
        {lines.length ? (
          <table className="data-table gv-finance-print-table gv-finance-origin-items">
            <thead>
              <tr>
                <th>Produto</th>
                <th className="num">Qtd</th>
                <th className="num">Unit.</th>
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((it) => (
                <tr key={it.key}>
                  <td>{it.description}</td>
                  <td className="num">{Number(it.quantity)}</td>
                  <td className="num">{formatBRL(it.unitPrice)}</td>
                  <td className="num">{formatBRL(it.totalLine)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="gv-finance-origin-group__items-empty">Itens da venda não disponíveis.</p>
        )}
      </div>
    );
  }

  function renderReceiptItemsBlock(items: GoodsReceiptLineItem[] | null | undefined) {
    const rows = items ?? [];
    if (!rows.length) return null;
    return (
      <table className="data-table gv-finance-print-table gv-finance-origin-items">
        <thead>
          <tr>
            <th>Produto</th>
            <th className="num">Qtd</th>
            <th className="num">Custo unit.</th>
            <th className="num">Total est.</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((it) => {
            const qty = Number(it.quantity);
            const unit = Number(it.unitCost);
            const total = Number.isFinite(qty * unit) ? qty * unit : 0;
            return (
              <tr key={it.id}>
                <td>
                  {it.description?.trim() ||
                    lineLabel(it.variant?.product?.name, it.variant?.sku)}
                </td>
                <td className="num">{qty}</td>
                <td className="num">{formatBRL(it.unitCost)}</td>
                <td className="num">{formatBRL(total)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  }

  function renderReceivablesDetailed(rows: Receivable[]) {
    const { groups, standalone } = groupReceivablesBySale(rows);
    let cont = 0;
    const emptyColSpan = modo === 'pagas' ? 11 : 9;

    if (!rows.length) {
      return (
        <table className="data-table" style={{ width: '100%' }}>
          {receivableListHead()}
          <tbody>
            <tr>
              <td colSpan={emptyColSpan} className="empty">
                Nenhum registro.
              </td>
            </tr>
          </tbody>
        </table>
      );
    }

    return (
      <div className="gv-finance-grouped-list">
        {groups.map((group) => {
          const customer = group.rows[0]?.customer;
          const sale = group.sale;
          const saleNumber =
            sale?.number ??
            Number(group.rows[0]?.description.match(/venda #(\d+)/i)?.[1] ?? NaN);
          const soldLines = resolveSoldLines(group, saleItemsById);
          return (
            <section key={group.saleId} className="gv-finance-origin-group">
              <header className="gv-finance-origin-group__head">
                <strong>
                  Venda #{Number.isFinite(saleNumber) ? saleNumber : sale?.number ?? '—'}
                </strong>
                <span>Cliente: {customer?.name ?? '—'}</span>
                {sale?.createdAt ? <span>Data: {formatDate(sale.createdAt)}</span> : null}
                {sale?.total ? <span>Total da venda: {formatBRL(sale.total)}</span> : null}
              </header>
              {renderSoldItemsSection(soldLines)}
              <table className="data-table gv-finance-print-table" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th colSpan={emptyColSpan} className="gv-finance-origin-group__subhead">
                      Títulos desta venda
                    </th>
                  </tr>
                </thead>
                {receivableListHead()}
                <tbody>
                  {group.rows.map((r) => {
                    const row = renderReceivableBillRow(r, cont, true);
                    cont += 1;
                    return row;
                  })}
                </tbody>
              </table>
            </section>
          );
        })}
        {standalone.map((r) => {
          const idx = cont;
          cont += 1;
          const soldLines = mergeReceivableItemsToSoldLines([r]);
          return (
            <section key={r.id} className="gv-finance-origin-group">
              <header className="gv-finance-origin-group__head">
                <strong>{r.description}</strong>
                <span>Cliente: {r.customer?.name ?? '—'}</span>
                <span>Vencimento: {formatDate(r.dueDate)}</span>
              </header>
              {soldLines.length ? renderSoldItemsSection(soldLines) : null}
              <table className="data-table gv-finance-print-table" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th colSpan={emptyColSpan} className="gv-finance-origin-group__subhead">
                      Título
                    </th>
                  </tr>
                </thead>
                {receivableListHead()}
                <tbody>{renderReceivableBillRow(r, idx)}</tbody>
              </table>
            </section>
          );
        })}
      </div>
    );
  }

  function renderPayablesDetailed(rows: Payable[]) {
    const { groups, standalone } = groupPayablesByReceipt(rows);
    let cont = 0;
    const emptyColSpan = modo === 'pagas' ? 11 : 9;

    if (!rows.length) {
      return (
        <table className="data-table" style={{ width: '100%' }}>
          {payableListHead()}
          <tbody>
            <tr>
              <td colSpan={emptyColSpan} className="empty">
                Nenhum registro.
              </td>
            </tr>
          </tbody>
        </table>
      );
    }

    return (
      <div className="gv-finance-grouped-list">
        {groups.map(({ receipt, rows: billRows }) => {
          const supplier = billRows[0]?.supplier;
          return (
            <section key={receipt.id} className="gv-finance-origin-group">
              <header className="gv-finance-origin-group__head">
                <strong>Entrada #{receipt.controlNumber}</strong>
                <span>Fornecedor: {supplier?.legalName ?? '—'}</span>
                {receipt.documentNumber ? <span>NF: {receipt.documentNumber}</span> : null}
                {receipt.issueDate ? <span>Emissão: {formatDate(receipt.issueDate)}</span> : null}
                {receipt.totalValue ? (
                  <span>Total entrada: {formatBRL(receipt.totalValue)}</span>
                ) : null}
              </header>
              {renderReceiptItemsBlock(receipt.items)}
              <table className="data-table gv-finance-print-table" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th colSpan={emptyColSpan} className="gv-finance-origin-group__subhead">
                      Títulos desta entrada
                    </th>
                  </tr>
                </thead>
                {payableListHead()}
                <tbody>
                  {billRows.map((p) => {
                    const row = renderPayableBillRow(p, cont, true);
                    cont += 1;
                    return row;
                  })}
                </tbody>
              </table>
            </section>
          );
        })}
        {standalone.map((p) => {
          const idx = cont;
          cont += 1;
          return (
            <section key={p.id} className="gv-finance-origin-group">
              <table className="data-table gv-finance-print-table" style={{ width: '100%' }}>
                {payableListHead()}
                <tbody>{renderPayableBillRow(p, idx)}</tbody>
              </table>
            </section>
          );
        })}
      </div>
    );
  }

  function renderPayableDetail(p: Payable) {
    return (
      <section className="gv-finance-print-detail">
        <h2>Título</h2>
        <dl className="gv-finance-dl">
          <dt>Fornecedor</dt>
          <dd>{p.supplier?.legalName ?? '—'}</dd>
          <dt>Descrição</dt>
          <dd>{p.description}</dd>
          <dt>Vencimento</dt>
          <dd>{formatDate(p.dueDate)}</dd>
          <dt>Valor (face)</dt>
          <dd>{formatBRL(p.amount)}</dd>
          <dt>Saldo em aberto</dt>
          <dd>{formatBRL(saldoAberto(p))}</dd>
          {(p.status === 'OPEN' || p.status === 'OVERDUE') && tituloEmAbertoComParcial(p) ? (
            <>
              <dt>Valor já pago (acum.)</dt>
              <dd>{formatBRL(valorPagoAcumulado(p)!)}</dd>
            </>
          ) : null}
          <dt>Status</dt>
          <dd>{statusPt(p.status)}</dd>
          {(p.status === 'OPEN' || p.status === 'OVERDUE') && p.paymentNotes?.trim() ? (
            <>
              <dt>Histórico / parciais</dt>
              <dd style={{ whiteSpace: 'pre-wrap' }}>{p.paymentNotes}</dd>
            </>
          ) : null}
          {p.status === 'PAID' && (
            <>
              <dt>Pago em</dt>
              <dd>{p.paidAt ? formatDate(p.paidAt) : '—'}</dd>
              <dt>Forma de pagamento</dt>
              <dd>{p.paymentMethod ? PAYMENT_LABELS[p.paymentMethod] ?? p.paymentMethod : '—'}</dd>
              <dt>Valor liquidado</dt>
              <dd>{p.settledAmount ? formatBRL(p.settledAmount) : '—'}</dd>
              <dt>Caixa (controle)</dt>
              <dd>
                {p.cashSession
                  ? `#${p.cashSession.controlNumber} — ${p.cashSession.user?.name ?? '—'}`
                  : '—'}
              </dd>
              <dt>Observações da baixa</dt>
              <dd>{p.paymentNotes ?? '—'}</dd>
            </>
          )}
        </dl>
        {hasInformedPayment(p) && (
          <div className="no-print" style={{ marginTop: '1rem' }}>
            <BillPaymentsButton
              kind="pagar"
              billId={p.id}
              description={p.description}
              label="Detalhar / editar pagamentos"
            />
          </div>
        )}
      </section>
    );
  }

  function renderReceivableDetail(r: Receivable) {
    return (
      <section className="gv-finance-print-detail">
        <h2>Título</h2>
        <dl className="gv-finance-dl">
          <dt>Cliente</dt>
          <dd>{r.customer?.name ?? '—'}</dd>
          <dt>Descrição</dt>
          <dd>{r.description}</dd>
          <dt>Vencimento</dt>
          <dd>{formatDate(r.dueDate)}</dd>
          <dt>Valor (face)</dt>
          <dd>{formatBRL(r.amount)}</dd>
          <dt>Saldo em aberto</dt>
          <dd>{formatBRL(saldoAberto(r))}</dd>
          {(r.status === 'OPEN' || r.status === 'OVERDUE') && tituloEmAbertoComParcial(r) ? (
            <>
              <dt>Valor já recebido (acum.)</dt>
              <dd>{formatBRL(valorPagoAcumulado(r)!)}</dd>
            </>
          ) : null}
          <dt>Status</dt>
          <dd>{statusPt(r.status)}</dd>
          {(r.status === 'OPEN' || r.status === 'OVERDUE') && r.paymentNotes?.trim() ? (
            <>
              <dt>Histórico / parciais</dt>
              <dd style={{ whiteSpace: 'pre-wrap' }}>{r.paymentNotes}</dd>
            </>
          ) : null}
          {r.status === 'PAID' && (
            <>
              <dt>Recebido em</dt>
              <dd>{r.receivedAt ? formatDate(r.receivedAt) : '—'}</dd>
              <dt>Forma de pagamento</dt>
              <dd>{r.paymentMethod ? PAYMENT_LABELS[r.paymentMethod] ?? r.paymentMethod : '—'}</dd>
              <dt>Valor liquidado</dt>
              <dd>{r.settledAmount ? formatBRL(r.settledAmount) : '—'}</dd>
              <dt>Caixa (controle)</dt>
              <dd>
                {r.cashSession
                  ? `#${r.cashSession.controlNumber} — ${r.cashSession.user?.name ?? '—'}`
                  : '—'}
              </dd>
              <dt>Observações da baixa</dt>
              <dd>{r.paymentNotes ?? '—'}</dd>
            </>
          )}
        </dl>
        {hasInformedPayment(r) && (
          <div className="no-print" style={{ marginTop: '1rem' }}>
            <BillPaymentsButton
              kind="receber"
              billId={r.id}
              description={r.description}
              label="Detalhar / editar recebimentos"
            />
          </div>
        )}
      </section>
    );
  }

  return (
    <div className="print-page">
      <div className="print-toolbar no-print">
        <Link to="/financeiro" className="btn btn-secondary">
          ← Voltar ao financeiro
        </Link>
        <div style={{ flex: 1 }} />
        <button type="button" className="btn btn-primary" onClick={() => window.print()}>
          Imprimir
        </button>
      </div>

      <div className="print-doc gv-finance-print-root">
        <StandardReportHeader documentTitle={documentTitle} documentExtras={subtitle} />

      {loading && <p>Carregando…</p>}
      {errMessage && <div className="alert alert-error">{errMessage}</div>}

      {!loading && !err && modo === 'conta' && tipo === 'pagar' && singlePayable.data && (
        renderPayableDetail(singlePayable.data)
      )}
      {!loading && !err && modo === 'conta' && tipo === 'receber' && singleReceivable.data && (
        renderReceivableDetail(singleReceivable.data)
      )}

      {!loading && !err && modo !== 'conta' && tipo === 'pagar' && listPayables.data &&
        (detalhar
          ? renderPayablesDetailed(listPayables.data)
          : (
        <table className="data-table" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th className="num">Cont.</th>
              <th>Vencimento</th>
              <th>Descrição</th>
              <th>Fornecedor</th>
              <th>Valor (face)</th>
              <th>Pago / recebido</th>
              <th>Saldo em aberto</th>
              <th>Status</th>
              {modo === 'pagas' && (
                <>
                  <th>Pago em</th>
                  <th>Forma</th>
                </>
              )}
              <th className="no-print">Ações</th>
            </tr>
          </thead>
          <tbody>
            {!listPayables.data.length ? (
              <tr>
                <td colSpan={modo === 'pagas' ? 11 : 9} className="empty">
                  Nenhum registro.
                </td>
              </tr>
            ) : (
              listPayables.data.map((p, idx) => {
                const vp = valorPagoAcumulado(p);
                return (
                <tr key={p.id}>
                  <td className="num">{idx + 1}</td>
                  <td>{formatDate(p.dueDate)}</td>
                  <td>{p.description}</td>
                  <td>
                    <PartyCell row={p} />
                  </td>
                  <td>{formatBRL(p.amount)}</td>
                  <td>{vp != null ? formatBRL(vp) : '—'}</td>
                  <td>{formatBRL(saldoAberto(p))}</td>
                  <td>
                    {statusPt(p.status)}
                    {tituloEmAbertoComParcial(p) ? ' · parcial' : ''}
                  </td>
                  {modo === 'pagas' && (
                    <>
                      <td>{p.paidAt ? formatDate(p.paidAt) : '—'}</td>
                      <td>{p.paymentMethod ? PAYMENT_LABELS[p.paymentMethod] ?? p.paymentMethod : '—'}</td>
                    </>
                  )}
                  <td className="no-print" style={{ textAlign: 'right' }}>
                    {hasInformedPayment(p) ? (
                      <BillPaymentsButton kind="pagar" billId={p.id} description={p.description} />
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
                );
              })
            )}
          </tbody>
        </table>
          ))}

      {!loading && !err && modo !== 'conta' && tipo === 'receber' && listReceivables.data &&
        (detalhar
          ? renderReceivablesDetailed(listReceivables.data)
          : (
        <table className="data-table" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th className="num">Cont.</th>
              <th>Vencimento</th>
              <th>Descrição</th>
              <th>Cliente</th>
              <th>Valor (face)</th>
              <th>Pago / recebido</th>
              <th>Saldo em aberto</th>
              <th>Status</th>
              {modo === 'pagas' && (
                <>
                  <th>Recebido em</th>
                  <th>Forma</th>
                </>
              )}
              <th className="no-print">Ações</th>
            </tr>
          </thead>
          <tbody>
            {!listReceivables.data.length ? (
              <tr>
                <td colSpan={modo === 'pagas' ? 11 : 9} className="empty">
                  Nenhum registro.
                </td>
              </tr>
            ) : (
              listReceivables.data.map((r, idx) => {
                const vp = valorPagoAcumulado(r);
                return (
                <tr key={r.id}>
                  <td className="num">{idx + 1}</td>
                  <td>{formatDate(r.dueDate)}</td>
                  <td>{r.description}</td>
                  <td>
                    <PartyCell row={r} />
                  </td>
                  <td>{formatBRL(r.amount)}</td>
                  <td>{vp != null ? formatBRL(vp) : '—'}</td>
                  <td>{formatBRL(saldoAberto(r))}</td>
                  <td>
                    {statusPt(r.status)}
                    {tituloEmAbertoComParcial(r) ? ' · parcial' : ''}
                  </td>
                  {modo === 'pagas' && (
                    <>
                      <td>{r.receivedAt ? formatDate(r.receivedAt) : '—'}</td>
                      <td>{r.paymentMethod ? PAYMENT_LABELS[r.paymentMethod] ?? r.paymentMethod : '—'}</td>
                    </>
                  )}
                  <td className="no-print" style={{ textAlign: 'right' }}>
                    {hasInformedPayment(r) ? (
                      <BillPaymentsButton kind="receber" billId={r.id} description={r.description} />
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
                );
              })
            )}
          </tbody>
        </table>
          ))}

      {modo === 'conta' && !id && <p className="alert alert-error">Informe o id do título.</p>}

      {listReady && !errMessage && tipo === 'receber' && listReceivables.data == null && (
        <p className="alert alert-error">Não foi possível carregar os títulos a receber.</p>
      )}
      {listReady && !errMessage && tipo === 'pagar' && listPayables.data == null && (
        <p className="alert alert-error">Não foi possível carregar os títulos a pagar.</p>
      )}
      </div>
    </div>
  );
}
