import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { CompanyLogo } from '../components/CompanyLogo';
import { api } from '../lib/api';
import { companyUsesCustomLogo } from '../lib/company-branding';
import { formatBRL, formatDate } from '../lib/format';
import { consumeAutoPrintNonce } from '../lib/sale-receipt-print';
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
  saleReceiptAutoPrint?: boolean;
  saleReceiptPrinterHint?: string | null;
};

type SaleReceipt = {
  id: string;
  number: number;
  status: string;
  subtotal: string;
  discount: string;
  total: string;
  createdAt: string;
  notes: string | null;
  customer: { name: string } | null;
  user: { name: string } | null;
  items: Array<{
    quantity: string;
    unitPrice: string;
    discount: string;
    totalLine: string;
    variant: { sku: string; product: { name: string } };
  }>;
  payments: Array<{
    method: 'CASH' | 'CARD' | 'PIX' | 'CREDIT' | 'OTHER';
    amount: string;
    installments: number;
  }>;
};

const PAY_LABEL: Record<SaleReceipt['payments'][number]['method'], string> = {
  CASH: 'Dinheiro',
  CARD: 'Cartão',
  PIX: 'Pix',
  CREDIT: 'Crediário',
  OTHER: 'Outro',
};

function onlyDigits(s: string): string {
  return String(s ?? '').replace(/\D/g, '');
}

function formatCnpjForReceipt(raw: string): string {
  const d = onlyDigits(raw).slice(0, 14);
  if (d.length !== 14) return raw;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

function parseN(v: string | number): number {
  const n = typeof v === 'string' ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function SaleReceiptPrintPage() {
  const [sp] = useSearchParams();
  const saleId = sp.get('id')?.trim() ?? '';
  const wantAutoPrint = sp.get('autoprint') === '1' || sp.get('autoprint') === 'true';
  const np = sp.get('_np');

  const companyQ = useQuery({
    queryKey: ['company'],
    queryFn: () => api<Company>('/company'),
  });

  const saleQ = useQuery({
    queryKey: ['sales', saleId],
    queryFn: () => api<SaleReceipt>(`/sales/${encodeURIComponent(saleId)}`),
    enabled: Boolean(saleId),
  });

  const c = companyQ.data;
  const s = saleQ.data;
  const loading = Boolean(saleId) && (saleQ.isLoading || companyQ.isLoading);

  useEffect(() => {
    if (!wantAutoPrint || !saleId || !s) return;
    if (!consumeAutoPrintNonce(np, saleId)) return;
    const t = window.setTimeout(() => window.print(), 450);
    return () => window.clearTimeout(t);
  }, [wantAutoPrint, saleId, s, np]);

  return (
    <div className="sale-receipt-page">
      <div className="sale-receipt-toolbar no-print">
        <button type="button" className="btn btn-primary" onClick={() => window.print()}>
          Imprimir (Ctrl+P)
        </button>
        <span style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
          Bobina 80 mm — não fiscal. Mesmo com o sistema na nuvem, a impressão usa a impressora
          instalada neste computador (diálogo do navegador).
          {c?.saleReceiptPrinterHint?.trim() ? (
            <>
              {' '}
              <strong>Dica da loja:</strong> {c.saleReceiptPrinterHint.trim()}
            </>
          ) : null}
        </span>
      </div>

      {!saleId && (
        <div className="sale-receipt-doc">
          <p>
            Informe o código da venda na URL: <strong>?id=</strong>…
          </p>
        </div>
      )}

      {saleId && loading && (
        <div className="sale-receipt-doc">
          <p>Carregando…</p>
        </div>
      )}

      {saleId && saleQ.isError && (
        <div className="sale-receipt-doc">
          <p>Não foi possível carregar a venda. {(saleQ.error as Error).message}</p>
        </div>
      )}

      {s && (
        <article className="sale-receipt-doc">
          {c ? (
            <header className="sale-receipt-center">
              {companyUsesCustomLogo(c) ? (
                <CompanyLogo className="sale-receipt-logo" company={c} alt={c.tradeName || c.legalName} />
              ) : null}
              <p className="sale-receipt-title">{c.tradeName || c.legalName}</p>
              {c.tradeName && c.legalName !== c.tradeName && (
                <p className="sale-receipt-legal">{c.legalName}</p>
              )}
              <p className="sale-receipt-sub">CNPJ {formatCnpjForReceipt(c.cnpj)}</p>
              {c.ie?.trim() ? <p className="sale-receipt-sub">IE {c.ie}</p> : null}
              {c.address?.trim() ? <p className="sale-receipt-sub">{c.address}</p> : null}
              {(c.city || c.state || c.zip) && (
                <p className="sale-receipt-sub">
                  {[c.city, c.state].filter(Boolean).join(' / ')}
                  {(() => {
                    const z = onlyDigits(c.zip ?? '');
                    if (z.length !== 8) return c.zip?.trim() ? ` · CEP ${c.zip}` : '';
                    return ` · CEP ${z.slice(0, 5)}-${z.slice(5)}`;
                  })()}
                </p>
              )}
              {c.phone?.trim() ? <p className="sale-receipt-sub">Tel. {c.phone}</p> : null}
            </header>
          ) : (
            <p className="sale-receipt-center sale-receipt-sub">
              Cadastre a empresa em <strong>Empresa</strong> para exibir razão social e CNPJ no cupom.
            </p>
          )}

          <hr className="sale-receipt-line" />

          <p className="sale-receipt-center sale-receipt-sub">
            <strong>DOCUMENTO AUXILIAR DE VENDA</strong>
          </p>
          <p className="sale-receipt-center sale-receipt-fiscal-note">
            Não possui validade fiscal — conferência interna / troca mediante política da loja
          </p>

          {s.status === 'CANCELLED' && (
            <p className="sale-receipt-banner">Venda cancelada</p>
          )}

          <div className="sale-receipt-meta">
            <span>
              <strong>Venda</strong> #{s.number}
            </span>
            <span>{formatDate(s.createdAt)}</span>
          </div>
          {s.user?.name ? (
            <div className="sale-receipt-meta">
              <span>Operador</span>
              <span>{s.user.name}</span>
            </div>
          ) : null}
          <div className="sale-receipt-meta">
            <span>Cliente</span>
            <span>{s.customer?.name ?? 'Balcão'}</span>
          </div>

          <hr className="sale-receipt-line" />

          <h2 className="sale-receipt-section-title">Itens</h2>
          <ul className="sale-receipt-items">
            {s.items.map((it, idx) => {
              const q = parseN(it.quantity);
              const line = parseN(it.totalLine);
              const unit = parseN(it.unitPrice);
              const name = it.variant.product?.name ?? 'Item';
              return (
                <li key={`${s.id}-line-${idx}`}>
                  <span className="sale-receipt-item-desc">{name}</span>
                  <span className="sale-receipt-item-desc sale-receipt-item-sku">
                    Cód. {it.variant.sku}
                  </span>
                  <div className="sale-receipt-item-qty">
                    <span>
                      {q} × {formatBRL(unit)}
                    </span>
                    <strong>{formatBRL(line)}</strong>
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="sale-receipt-totals">
            <div className="sale-receipt-totals-row">
              <span>Subtotal</span>
              <span>{formatBRL(s.subtotal)}</span>
            </div>
            {parseN(s.discount) > 0.005 && (
              <div className="sale-receipt-totals-row">
                <span>Desconto</span>
                <span>− {formatBRL(s.discount)}</span>
              </div>
            )}
            <div className="sale-receipt-totals-row is-total">
              <span>TOTAL</span>
              <span>{formatBRL(s.total)}</span>
            </div>
          </div>

          <hr className="sale-receipt-line" />

          <h2 className="sale-receipt-section-title">Pagamentos</h2>
          <ul className="sale-receipt-payments">
            {s.payments.map((p, i) => (
              <li key={`${s.id}-pay-${i}`}>
                <span>
                  {PAY_LABEL[p.method]}
                  {p.method === 'CREDIT' && p.installments > 1 ? ` · ${p.installments}×` : ''}
                </span>
                <span>{formatBRL(p.amount)}</span>
              </li>
            ))}
          </ul>

          {s.notes?.trim() ? (
            <>
              <hr className="sale-receipt-line" />
              <p className="sale-receipt-sub" style={{ margin: '0.25rem 0' }}>
                <strong>Obs.</strong> {s.notes}
              </p>
            </>
          ) : null}

          <hr className="sale-receipt-line" />

          <footer className="sale-receipt-foot">
            <p style={{ margin: 0 }}>Obrigado pela preferência!</p>
            <p className="sale-receipt-foot-muted">
              Cupom gerado pelo GestorVend · ID {s.id.slice(0, 8)}…
            </p>
          </footer>
        </article>
      )}
    </div>
  );
}
