import { useQuery } from '@tanstack/react-query';
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
    return p.toString();
  }, [modo, from, to, segment, partyId, tipo]);

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
  });

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
    (tipo === 'receber' && modo !== 'conta' && listReceivables.isLoading);

  const err =
    (tipo === 'pagar' && modo === 'conta' && singlePayable.error) ||
    (tipo === 'receber' && modo === 'conta' && singleReceivable.error) ||
    (tipo === 'pagar' && modo !== 'conta' && listPayables.error) ||
    (tipo === 'receber' && modo !== 'conta' && listReceivables.error);

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
      {err && <div className="alert alert-error">{(err as Error).message}</div>}

      {!loading && !err && modo === 'conta' && tipo === 'pagar' && singlePayable.data && (
        renderPayableDetail(singlePayable.data)
      )}
      {!loading && !err && modo === 'conta' && tipo === 'receber' && singleReceivable.data && (
        renderReceivableDetail(singleReceivable.data)
      )}

      {!loading && !err && modo !== 'conta' && tipo === 'pagar' && listPayables.data && (
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
      )}

      {!loading && !err && modo !== 'conta' && tipo === 'receber' && listReceivables.data && (
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
      )}

      {modo === 'conta' && !id && <p className="alert alert-error">Informe o id do título.</p>}
      </div>
    </div>
  );
}
