import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CompanyLogo } from '../components/CompanyLogo';
import { api } from '../lib/api';
import { isGestorVendDesktop } from '../lib/desktop-bridge';
import { printDocument } from '../lib/desktop-print';
import { formatBRL, formatDate } from '../lib/format';
import { PAYMENT_FORM_KIND_LABELS, type PaymentFormKind } from '../lib/payment-forms';
import { consumeAutoPrintNonce } from '../lib/sale-receipt-print';
import { APP_VERSION } from '../version';
import './sale-reservation-print.css';

type Company = {
  legalName: string;
  tradeName: string;
  cnpj: string;
  address: string | null;
  city: string | null;
  state: string | null;
  phone: string | null;
  logoUrl?: string | null;
};

type ReservationReceipt = {
  id: string;
  number: number;
  status: string;
  subtotal: string;
  total: string;
  notes: string | null;
  expiresAt: string;
  createdAt: string;
  customer: { name: string } | null;
  user: { name: string } | null;
  items: Array<{
    quantity: string;
    unitPrice: string;
    totalLine: string;
    variant: { sku: string; product: { name: string } };
  }>;
  payments: Array<{
    method: PaymentFormKind;
    amount: string;
    installments: number;
    paymentForm?: { name?: string | null } | null;
  }>;
};

const STATUS_BANNER: Record<string, string> = {
  CANCELLED: 'Reserva cancelada',
  EXPIRED: 'Reserva expirada',
  CONFIRMED: 'Reserva confirmada',
};

const PRINT_STYLE_ID = 'gv-rsv-print-override';

function parseN(v: string | number | null | undefined): number {
  const n = typeof v === 'string' ? parseFloat(v) : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function installPrintOverride(thermal: boolean): () => void {
  document.getElementById(PRINT_STYLE_ID)?.remove();
  const style = document.createElement('style');
  style.id = PRINT_STYLE_ID;
  style.textContent = thermal
    ? `
    @page { size: 80mm auto !important; margin: 2mm !important; }
    @media print {
      html, body {
        width: 80mm !important;
        max-width: 80mm !important;
        font-size: 18px !important;
        font-family: Tahoma, Verdana, 'Arial Black', Arial, sans-serif !important;
      }
    }
  `
    : `
    @page { size: A4 portrait !important; margin: 12mm !important; }
    @media print {
      html, body {
        width: auto !important;
        max-width: none !important;
        height: auto !important;
        margin: 0 !important;
        padding: 0 !important;
        background: #fff !important;
        font-size: 20pt !important;
        font-family: Tahoma, Verdana, 'Arial Black', Arial, sans-serif !important;
      }
    }
  `;
  document.head.appendChild(style);
  return () => style.remove();
}

export function SaleReservationPrintPage() {
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const id = sp.get('id')?.trim() ?? '';
  const isSecondCopy = sp.get('copy') === '1';
  const wantAutoPrint = sp.get('autoprint') === '1';
  const wantClose = sp.get('close') === '1';
  const np = sp.get('_np');
  const [printing, setPrinting] = useState(false);
  const printedRef = useRef(false);
  const thermal = isGestorVendDesktop();

  const q = useQuery({
    queryKey: ['sales-reservations', id, 'receipt'],
    queryFn: () =>
      api<{ reservation: ReservationReceipt; company: Company }>(
        `/sales-reservations/${encodeURIComponent(id)}/receipt`,
      ),
    enabled: Boolean(id),
  });

  const r = q.data?.reservation;
  const c = q.data?.company;
  const ready = Boolean(r && c);

  useEffect(() => {
    document.documentElement.classList.add('gv-rsv-receipt-print');
    document.body.classList.add('gv-rsv-receipt-print');
    if (thermal) {
      document.documentElement.classList.add('gv-rsv-thermal');
      document.body.classList.add('gv-rsv-thermal');
    }
    const undo = installPrintOverride(thermal);
    return () => {
      undo();
      document.documentElement.classList.remove('gv-rsv-receipt-print', 'gv-rsv-thermal');
      document.body.classList.remove('gv-rsv-receipt-print', 'gv-rsv-thermal');
    };
  }, [thermal]);

  useEffect(() => {
    const prev = document.title;
    if (r) document.title = `Reserva #${r.number}`;
    return () => {
      document.title = prev;
    };
  }, [r]);

  useEffect(() => {
    if (!wantAutoPrint || !ready || printedRef.current) return;
    if (!consumeAutoPrintNonce(np, id || 'reservation')) return;
    printedRef.current = true;
    const t = window.setTimeout(() => {
      void printDocument(thermal ? '80mm' : 'A4').then(() => {
        if (wantClose) {
          window.setTimeout(() => {
            try {
              window.close();
            } catch {
              /* ignore */
            }
          }, 400);
        }
      });
    }, 500);
    return () => window.clearTimeout(t);
  }, [wantAutoPrint, ready, np, id, wantClose, thermal]);

  async function handlePrint() {
    if (!ready || printing) return;
    setPrinting(true);
    try {
      await printDocument(thermal ? '80mm' : 'A4');
    } finally {
      setPrinting(false);
    }
  }

  if (!id) {
    return (
      <div className="gv-rsv-print-page">
        <p>Informe a reserva para impressão.</p>
      </div>
    );
  }

  return (
    <div className="gv-rsv-print-page">
      <div className="gv-rsv-print-toolbar no-print">
        <div className="gv-rsv-print-toolbar-actions">
          <button type="button" className="btn btn-secondary" onClick={() => navigate(-1)}>
            Voltar
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!ready || printing}
            onClick={() => void handlePrint()}
          >
            {printing ? 'Imprimindo…' : 'Imprimir'}
          </button>
        </div>
        <p className="gv-rsv-print-hint">
          Folha A4, escala 100%. No diálogo do Chrome desmarque cabeçalhos e rodapés.
        </p>
      </div>

      {q.isLoading ? (
        <article className={'gv-rsv-doc' + (thermal ? ' sale-receipt-doc' : '')}>
          <p className="gv-rsv-center">Carregando comprovante…</p>
        </article>
      ) : q.isError || !r || !c ? (
        <article className={'gv-rsv-doc' + (thermal ? ' sale-receipt-doc' : '')}>
          <p className="gv-rsv-center">Não foi possível carregar a reserva.</p>
        </article>
      ) : (
        <article
          className={'gv-rsv-doc' + (thermal ? ' sale-receipt-doc' : '')}
          data-receipt-ready="1"
        >
          <div className="gv-rsv-center">
            <CompanyLogo
              className={'gv-rsv-logo' + (thermal ? ' sale-receipt-logo' : '')}
              company={c}
              alt={c.tradeName || c.legalName}
            />
            <p className="gv-rsv-company">{c.tradeName || c.legalName}</p>
            {c.tradeName && c.legalName && c.tradeName !== c.legalName ? (
              <p className="gv-rsv-legal">{c.legalName}</p>
            ) : null}
            {c.cnpj ? <p className="gv-rsv-legal">CNPJ {c.cnpj}</p> : null}
            {c.address || c.city ? (
              <p className="gv-rsv-legal">{[c.address, c.city, c.state].filter(Boolean).join(' · ')}</p>
            ) : null}
            {c.phone ? <p className="gv-rsv-legal">{c.phone}</p> : null}
          </div>

          <hr className="gv-rsv-line" />

          <p className="gv-rsv-center gv-rsv-headline">Reserva de venda</p>
          <p className="gv-rsv-center gv-rsv-note">Não possui validade fiscal</p>
          {isSecondCopy ? (
            <p className="gv-rsv-center">
              <span className="gv-rsv-banner">2ª via</span>
            </p>
          ) : null}
          {STATUS_BANNER[r.status] ? (
            <p className="gv-rsv-center">
              <span className="gv-rsv-banner">{STATUS_BANNER[r.status]}</span>
            </p>
          ) : null}

          <table className="gv-rsv-meta">
            <tbody>
              <tr>
                <th>Reserva</th>
                <td>#{r.number}</td>
              </tr>
              <tr>
                <th>Emissão</th>
                <td>{formatDate(r.createdAt)}</td>
              </tr>
              <tr>
                <th>Válida até</th>
                <td>{formatDate(r.expiresAt)}</td>
              </tr>
              <tr>
                <th>Cliente</th>
                <td>{r.customer?.name ?? 'Cliente Balcão'}</td>
              </tr>
              {r.user?.name ? (
                <tr>
                  <th>Operador</th>
                  <td>{r.user.name}</td>
                </tr>
              ) : null}
            </tbody>
          </table>

          <hr className="gv-rsv-line" />

          <table className="gv-rsv-items">
            <thead>
              <tr>
                <th>Produto</th>
                <th className="num">Qtd</th>
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {r.items.map((it, i) => (
                <tr key={i}>
                  <td>
                    <span className="gv-rsv-item-name">{it.variant.product.name}</span>
                    <span className="gv-rsv-item-sku">
                      {it.variant.sku} · {formatBRL(it.unitPrice)} un
                    </span>
                  </td>
                  <td className="num">{parseN(it.quantity)}</td>
                  <td className="num">{formatBRL(it.totalLine)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="gv-rsv-total">
            <span>TOTAL</span>
            <span>{formatBRL(r.total)}</span>
          </div>

          {r.payments.map((p, i) => (
            <div key={i} className="gv-rsv-pay">
              <span>
                {p.paymentForm?.name || PAYMENT_FORM_KIND_LABELS[p.method] || p.method}
                {p.installments > 1 ? ` · ${p.installments}x` : ''}
              </span>
              <span>{formatBRL(p.amount)}</span>
            </div>
          ))}

          {r.notes?.trim() ? <p className="gv-rsv-note">Obs.: {r.notes.trim()}</p> : null}

          <hr className="gv-rsv-line" />

          <div className="gv-rsv-foot">
            <div>Retire em até 24 horas.</div>
            <small>
              Depois disso a reserva é cancelada e o estoque volta ao local padrão.
              <br />
              GestorVend v{APP_VERSION}
            </small>
          </div>
        </article>
      )}
    </div>
  );
}
