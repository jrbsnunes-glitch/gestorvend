import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CompanyLogo } from '../components/CompanyLogo';
import { api } from '../lib/api';
import { consumeAutoPrintNonce } from '../lib/sale-receipt-print';
import { printDocument } from '../lib/desktop-print';
import { formatBRL } from '../lib/format';
import { PAYMENT_LABELS, sortPaymentMethodKeys } from '../lib/finance-bills';
import { presentedTotalFromSession } from '../lib/cash-reconciliation';
import './sale-receipt-print.css';

type Company = {
  legalName: string;
  tradeName: string;
  cnpj: string;
  ie: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  logoUrl?: string | null;
  cashExpenseInPresentedTotal?: boolean;
};

type MovementBreakdown = {
  suprimentos: number;
  sangrias: number;
  despesas: number;
};

type ExpenseLine = {
  amount: number;
  description: string;
};

type ReportSession = {
  id: string;
  controlNumber: number;
  status: 'OPEN' | 'CLOSED';
  openedAt: string;
  closedAt: string | null;
  openingBalance: string;
  closingBalance: string | null;
  presentedTotal: number | null;
  closingNotes: string | null;
  user: { id: string; name: string } | null;
  movementsIn: number;
  movementsOut: number;
  movementBreakdown: MovementBreakdown;
  completedCount: number;
  cancelledCount: number;
  itemsCount: number;
  totalCompleted: number;
  totalReceivedAtSale?: number;
  totalRequisitionAtSale?: number;
  totalReceivableCollectionsViaCash?: number;
  totalCancelled: number;
  totalDiscounts: number;
  totalSurcharges: number;
  salesByMethod: Record<string, number>;
  expectedByMethod: Record<string, number>;
  declaredByMethod: Record<string, number> | null;
  expenseLines?: ExpenseLine[];
};

type ReportData = {
  sessions: ReportSession[];
};

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function money(n: number | string | null | undefined): string {
  if (n == null || n === '') return formatBRL(0);
  return formatBRL(n);
}

function methodLabel(key: string): string {
  return PAYMENT_LABELS[key] ?? key;
}

function entries(rec: Record<string, number> | null | undefined): Array<[string, number]> {
  if (!rec) return [];
  return sortPaymentMethodKeys(Object.keys(rec))
    .filter((k) => Number(rec[k]) !== 0)
    .map((k) => [k, rec[k]] as [string, number]);
}

export function CashCloseThermalPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const sessionId = params.get('id') ?? '';
  const autoprint = params.get('autoprint') === '1';
  const closeAfter = params.get('close') === '1';
  const nonce = params.get('_np');
  const [receiptReady, setReceiptReady] = useState(false);
  const printedRef = useRef(false);

  const companyQ = useQuery({
    queryKey: ['company'],
    queryFn: () => api<Company>('/company'),
  });

  const reportQ = useQuery({
    queryKey: ['cash', 'close-thermal', sessionId],
    queryFn: () => api<ReportData>(`/cash/report?sessionId=${encodeURIComponent(sessionId)}&status=ALL`),
    enabled: Boolean(sessionId),
  });

  const session = reportQ.data?.sessions?.[0];
  const c = companyQ.data;
  const ready = Boolean(session && c);

  useEffect(() => {
    if (!ready) return;
    setReceiptReady(true);
  }, [ready]);

  useEffect(() => {
    document.documentElement.classList.add('gv-sale-receipt-print');
    document.body.classList.add('gv-sale-receipt-print');
    return () => {
      document.documentElement.classList.remove('gv-sale-receipt-print');
      document.body.classList.remove('gv-sale-receipt-print');
    };
  }, []);

  useEffect(() => {
    if (!autoprint || !receiptReady || printedRef.current) return;
    if (!consumeAutoPrintNonce(nonce, `cash:${sessionId}`)) return;
    printedRef.current = true;
    void printDocument('80mm').then(() => {
      if (closeAfter) {
        window.setTimeout(() => {
          try {
            window.close();
          } catch {
            navigate(-1);
          }
        }, 400);
      }
    });
  }, [autoprint, receiptReady, nonce, sessionId, closeAfter, navigate]);

  const presented = session
    ? session.presentedTotal ??
      presentedTotalFromSession(session.declaredByMethod, session.closingBalance, {
        includeExpenseInPresentedTotal: Boolean(c?.cashExpenseInPresentedTotal),
      })
    : null;

  return (
    <div className="sale-receipt-page" data-receipt-ready={receiptReady ? '1' : '0'}>
      <div className="sale-receipt-toolbar no-print">
        <div className="sale-receipt-toolbar-actions">
          <button type="button" className="btn" onClick={() => void printDocument('80mm')}>
            Imprimir
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => navigate(-1)}>
            Voltar
          </button>
        </div>
      </div>

      <div className="sale-receipt-preview">
        {!sessionId ? (
          <article className="sale-receipt-doc cash-close-doc cash-close-doc--fechamento">
            <p className="sale-receipt-center">Sessão de caixa não informada.</p>
          </article>
        ) : reportQ.isLoading || companyQ.isLoading ? (
          <article className="sale-receipt-doc cash-close-doc cash-close-doc--fechamento">
            <p className="sale-receipt-center">Carregando fechamento…</p>
          </article>
        ) : reportQ.isError || !session || !c ? (
          <article className="sale-receipt-doc cash-close-doc cash-close-doc--fechamento">
            <p className="sale-receipt-center">
              {(reportQ.error as Error | undefined)?.message || 'Caixa não encontrado.'}
            </p>
          </article>
        ) : (
          <article
            className="sale-receipt-doc cash-close-doc cash-close-doc--fechamento"
            data-receipt-ready={receiptReady ? '1' : '0'}
          >
            <header className="sale-receipt-center sale-receipt-company">
              <CompanyLogo className="sale-receipt-logo" company={c} alt={c.tradeName || c.legalName} />
              <p className="sale-receipt-title">{c.tradeName || c.legalName}</p>
              {c.tradeName && c.legalName && c.tradeName !== c.legalName ? (
                <p className="sale-receipt-legal">{c.legalName}</p>
              ) : null}
              {c.cnpj ? <p className="sale-receipt-sub">CNPJ {c.cnpj}</p> : null}
              {c.phone?.trim() ? <p className="sale-receipt-sub">Tel. {c.phone}</p> : null}
            </header>

            <hr className="sale-receipt-line" />
            <p className="sale-receipt-center sale-receipt-title">
              FECHAMENTO DE CAIXA
            </p>
            <p className="sale-receipt-center sale-receipt-sub">
              Controle #{session.controlNumber}
            </p>

            <div className="sale-receipt-meta">
              <span>Operador</span>
              <span>{session.user?.name ?? '—'}</span>
            </div>
            <div className="sale-receipt-meta">
              <span>Abertura</span>
              <span>{fmtDateTime(session.openedAt)}</span>
            </div>
            <div className="sale-receipt-meta">
              <span>Fechamento</span>
              <span>{fmtDateTime(session.closedAt)}</span>
            </div>
            <div className="sale-receipt-meta">
              <span>Situação</span>
              <span>{session.status === 'OPEN' ? 'Aberto' : 'Fechado'}</span>
            </div>

            <hr className="sale-receipt-line" />
            <h2 className="sale-receipt-section-title">Resumo</h2>
            <div className="sale-receipt-totals">
              <div className="sale-receipt-totals-row">
                <span>Fundo inicial</span>
                <span>{money(session.openingBalance)}</span>
              </div>
              <div className="sale-receipt-totals-row is-sold">
                <span>TOTAL VENDIDO</span>
                <span>{money(session.totalCompleted)}</span>
              </div>
              <div className="sale-receipt-totals-row">
                <span>Recebido na venda</span>
                <span>{money(session.totalReceivedAtSale ?? 0)}</span>
              </div>
              <div className="sale-receipt-totals-row">
                <span>Contas recebidas</span>
                <span>{money(session.totalReceivableCollectionsViaCash ?? 0)}</span>
              </div>
              <div className="sale-receipt-totals-row">
                <span>Requisições</span>
                <span>{money(session.totalRequisitionAtSale ?? 0)}</span>
              </div>
              <div className="sale-receipt-totals-row">
                <span>Suprimentos</span>
                <span>{money(session.movementBreakdown?.suprimentos ?? 0)}</span>
              </div>
              <div className="sale-receipt-totals-row is-outflow">
                <span>SANGRIAS</span>
                <span>{money(session.movementBreakdown?.sangrias ?? 0)}</span>
              </div>
              <div className="sale-receipt-totals-row is-outflow">
                <span>DESPESAS</span>
                <span>{money(session.movementBreakdown?.despesas ?? 0)}</span>
              </div>
              <div className="sale-receipt-totals-row">
                <span>Cancelamentos</span>
                <span>{money(session.totalCancelled)}</span>
              </div>
              <div className="sale-receipt-totals-row">
                <span>Descontos</span>
                <span>{money(session.totalDiscounts)}</span>
              </div>
              <div className="sale-receipt-totals-row">
                <span>Acréscimos</span>
                <span>{money(session.totalSurcharges)}</span>
              </div>
              <div className="sale-receipt-totals-row">
                <span>Vendas (qtd)</span>
                <span>{session.completedCount}</span>
              </div>
              <div className="sale-receipt-totals-row is-total">
                <span>Total apresentado</span>
                <span>{presented != null ? money(presented) : '—'}</span>
              </div>
              <div className="sale-receipt-totals-row">
                <span>Saldo de fechamento</span>
                <span>{session.closingBalance != null ? money(session.closingBalance) : '—'}</span>
              </div>
            </div>

            {entries(session.salesByMethod).length > 0 ? (
              <>
                <hr className="sale-receipt-line" />
                <h2 className="sale-receipt-section-title">Vendas por forma</h2>
                <ul className="sale-receipt-payments">
                  {entries(session.salesByMethod).map(([k, v]) => (
                    <li key={`s-${k}`}>
                      <span>{methodLabel(k)}</span>
                      <span>{money(v)}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}

            {entries(session.expectedByMethod).length > 0 ? (
              <>
                <hr className="sale-receipt-line" />
                <h2 className="sale-receipt-section-title">Esperado no caixa</h2>
                <ul className="sale-receipt-payments">
                  {entries(session.expectedByMethod).map(([k, v]) => (
                    <li key={`e-${k}`}>
                      <span>{methodLabel(k)}</span>
                      <span>{money(v)}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}

            {entries(session.declaredByMethod).length > 0 ? (
              <>
                <hr className="sale-receipt-line" />
                <h2 className="sale-receipt-section-title">Apresentado</h2>
                <ul className="sale-receipt-payments">
                  {entries(session.declaredByMethod).map(([k, v]) => (
                    <li key={`d-${k}`}>
                      <span>{methodLabel(k)}</span>
                      <span>{money(v)}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}

            {session.expenseLines && session.expenseLines.length > 0 ? (
              <>
                <hr className="sale-receipt-line" />
                <h2 className="sale-receipt-section-title">Despesas</h2>
                <ul className="sale-receipt-payments">
                  {session.expenseLines.map((e, i) => (
                    <li key={`x-${i}`}>
                      <span>{e.description || 'Despesa'}</span>
                      <span>{money(e.amount)}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}

            {session.closingNotes?.trim() ? (
              <>
                <hr className="sale-receipt-line" />
                <p className="sale-receipt-sub" style={{ margin: '0.25rem 0' }}>
                  Obs.: {session.closingNotes.trim()}
                </p>
              </>
            ) : null}

            <hr className="sale-receipt-line" />
            <footer className="sale-receipt-foot">
              <p className="sale-receipt-center">Conferência do operador</p>
              <p className="sale-receipt-foot-muted">________________________________</p>
              <p className="sale-receipt-foot-muted">GestorVend · cupom 80 mm</p>
            </footer>
          </article>
        )}
      </div>
    </div>
  );
}
