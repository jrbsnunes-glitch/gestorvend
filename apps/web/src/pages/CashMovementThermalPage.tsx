import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CompanyLogo } from '../components/CompanyLogo';
import { api } from '../lib/api';
import { consumeAutoPrintNonce } from '../lib/sale-receipt-print';
import { printDocument } from '../lib/desktop-print';
import { formatBRL } from '../lib/format';
import './sale-receipt-print.css';

type Company = {
  legalName: string;
  tradeName: string;
  cnpj: string;
  phone: string | null;
  logoUrl?: string | null;
};

type MovementPrint = {
  id: string;
  kind: 'sangria' | 'despesa' | 'suprimento';
  kindLabel: string;
  amount: number;
  reason: string | null;
  createdAt: string;
  referentialAccount: { id: string; code: string; name: string } | null;
  session: {
    id: string;
    controlNumber: number;
    operatorName: string;
  };
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

export function CashMovementThermalPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const movementId = params.get('id') ?? '';
  const autoprint = params.get('autoprint') === '1';
  const closeAfter = params.get('close') === '1';
  const nonce = params.get('_np');
  const [receiptReady, setReceiptReady] = useState(false);
  const printedRef = useRef(false);

  const companyQ = useQuery({
    queryKey: ['company'],
    queryFn: () => api<Company>('/company'),
  });

  const movQ = useQuery({
    queryKey: ['cash', 'movement', movementId],
    queryFn: () => api<MovementPrint>(`/cash/movement/${encodeURIComponent(movementId)}`),
    enabled: Boolean(movementId),
  });

  const mov = movQ.data;
  const c = companyQ.data;
  const ready = Boolean(mov && c);

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
    if (!consumeAutoPrintNonce(nonce, `cash-mov:${movementId}`)) return;
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
  }, [autoprint, receiptReady, nonce, movementId, closeAfter, navigate]);

  const signed =
    mov?.kind === 'suprimento' ? 'Quem entrega / recebe' : 'Quem retira / autoriza';

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
        {!movementId ? (
          <article className="sale-receipt-doc cash-close-doc">
            <p className="sale-receipt-center">Lançamento não informado.</p>
          </article>
        ) : movQ.isLoading || companyQ.isLoading ? (
          <article className="sale-receipt-doc cash-close-doc">
            <p className="sale-receipt-center">Carregando comprovante…</p>
          </article>
        ) : movQ.isError || !mov || !c ? (
          <article className="sale-receipt-doc cash-close-doc">
            <p className="sale-receipt-center">
              {(movQ.error as Error | undefined)?.message ?? 'Não foi possível carregar o lançamento.'}
            </p>
          </article>
        ) : (
          <article className="sale-receipt-doc cash-close-doc" data-receipt-ready={receiptReady ? '1' : '0'}>
            <header className="sale-receipt-center sale-receipt-company">
              <CompanyLogo className="sale-receipt-logo" company={c} alt={c.tradeName || c.legalName} />
              <p className="sale-receipt-title">{c.tradeName || c.legalName}</p>
              {c.legalName && c.legalName !== c.tradeName ? (
                <p className="sale-receipt-legal">{c.legalName}</p>
              ) : null}
              {c.cnpj ? <p className="sale-receipt-sub">CNPJ {c.cnpj}</p> : null}
              {c.phone?.trim() ? <p className="sale-receipt-sub">Tel. {c.phone}</p> : null}
            </header>

            <hr className="sale-receipt-line" />
            <p className="sale-receipt-center sale-receipt-sub">COMPROVANTE DE CAIXA</p>
            <p className="sale-receipt-center sale-receipt-title" style={{ fontSize: '1.05rem' }}>
              {mov.kindLabel.toUpperCase()}
            </p>
            <p className="sale-receipt-center sale-receipt-title" style={{ fontSize: '1.35rem', margin: '0.35rem 0' }}>
              {formatBRL(mov.amount)}
            </p>

            <hr className="sale-receipt-line" />
            <div className="sale-receipt-meta">
              <span>Caixa</span>
              <strong>#{mov.session.controlNumber}</strong>
            </div>
            <div className="sale-receipt-meta">
              <span>Operador</span>
              <strong>{mov.session.operatorName}</strong>
            </div>
            <div className="sale-receipt-meta">
              <span>Data</span>
              <strong>{fmtDateTime(mov.createdAt)}</strong>
            </div>
            {mov.referentialAccount ? (
              <div className="sale-receipt-meta">
                <span>Centro</span>
                <strong>
                  {mov.referentialAccount.code} {mov.referentialAccount.name}
                </strong>
              </div>
            ) : null}
            {mov.reason?.trim() ? (
              <>
                <hr className="sale-receipt-line" />
                <p className="sale-receipt-sub" style={{ margin: '0.25rem 0' }}>
                  {mov.reason.trim()}
                </p>
              </>
            ) : null}

            <hr className="sale-receipt-line" />
            <footer className="sale-receipt-foot">
              <p className="sale-receipt-center">{signed}</p>
              <p className="sale-receipt-foot-muted">________________________________</p>
              <p className="sale-receipt-foot-muted">GestorVend · cupom 80 mm</p>
            </footer>
          </article>
        )}
      </div>
    </div>
  );
}
