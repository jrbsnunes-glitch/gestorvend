import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { CompanyLogo } from '../components/CompanyLogo';
import { api } from '../lib/api';
import { companyUsesCustomLogo } from '../lib/company-branding';
import { formatBRL, formatDate } from '../lib/format';
import { consumeAutoPrintNonce } from '../lib/sale-receipt-print';
import {
  hardenSaleReceiptStyles,
  inlineSaleReceiptImages,
  waitSaleReceiptImages,
} from '../lib/sale-receipt-harden';
import { printDocument } from '../lib/desktop-print';
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
  surcharge?: string;
  serviceFeeAmount?: string;
  couvertAmount?: string;
  waiterTipAmount?: string;
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

type ReceiptPayload = {
  sale: SaleReceipt;
  company: Company;
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

function parseN(v: string | number | null | undefined): number {
  const n = typeof v === 'string' ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function formatAddressLine(c: Company): string {
  const parts = [c.city, c.state].filter(Boolean);
  const cityState = parts.join(' / ');
  const z = onlyDigits(c.zip ?? '');
  const cep =
    z.length === 8 ? `CEP ${z.slice(0, 5)}-${z.slice(5)}` : c.zip?.trim() ? `CEP ${c.zip}` : '';
  return [cityState, cep].filter(Boolean).join(' · ');
}

export function SaleReceiptPrintPage() {
  const [sp] = useSearchParams();
  const saleId = sp.get('id')?.trim() ?? '';
  const wantAutoPrint = sp.get('autoprint') === '1' || sp.get('autoprint') === 'true';
  const wantClose = sp.get('close') === '1' || sp.get('close') === 'true';
  const np = sp.get('_np');

  const receiptQ = useQuery({
    queryKey: ['sales', saleId, 'receipt'],
    queryFn: async (): Promise<ReceiptPayload> => {
      try {
        return await api<ReceiptPayload>(`/sales/${encodeURIComponent(saleId)}/receipt`);
      } catch {
        // API antiga sem /receipt — carrega venda + empresa em paralelo.
        const [sale, company] = await Promise.all([
          api<SaleReceipt>(`/sales/${encodeURIComponent(saleId)}`),
          api<Company>('/company'),
        ]);
        return { sale, company };
      }
    },
    enabled: Boolean(saleId),
    retry: 2,
    retryDelay: 400,
  });

  const docRef = useRef<HTMLElement | null>(null);
  const [hardened, setHardened] = useState(false);

  const s = receiptQ.data?.sale;
  const c = receiptQ.data?.company;
  const loading = Boolean(saleId) && receiptQ.isLoading;
  const companyOk = Boolean(s && (c?.legalName || c?.tradeName));
  /** Só libera impressão com empresa no DOM e layout já blindado. */
  const receiptReady = companyOk && hardened;

  useEffect(() => {
    document.documentElement.classList.add('gv-sale-receipt-print');
    document.body.classList.add('gv-sale-receipt-print');
    return () => {
      document.documentElement.classList.remove('gv-sale-receipt-print');
      document.body.classList.remove('gv-sale-receipt-print');
    };
  }, []);

  /**
   * Blinda o cupom antes de qualquer impressão: estilos `important` inline
   * (imunes à folha injetada pelo shell) e logo em `data:` URL.
   */
  useEffect(() => {
    const root = docRef.current;
    if (!companyOk || !root) return;
    let alive = true;
    setHardened(false);
    void (async () => {
      hardenSaleReceiptStyles(root);
      await inlineSaleReceiptImages(root);
      await waitSaleReceiptImages(root);
      if (!alive) return;
      hardenSaleReceiptStyles(root);
      setHardened(true);
    })();
    return () => {
      alive = false;
    };
  }, [companyOk, receiptQ.dataUpdatedAt]);

  useEffect(() => {
    if (!wantClose) return;
    function onAfterPrint() {
      try {
        window.close();
      } catch {
        /* ignore */
      }
    }
    window.addEventListener('afterprint', onAfterPrint);
    return () => window.removeEventListener('afterprint', onAfterPrint);
  }, [wantClose]);

  useEffect(() => {
    if (!wantAutoPrint || !saleId || !receiptReady) return;
    if (!consumeAutoPrintNonce(np, saleId)) return;
    const t = window.setTimeout(() => {
      void printDocument('80mm').then(() => {
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
    }, 600);
    return () => window.clearTimeout(t);
  }, [wantAutoPrint, saleId, receiptReady, np, wantClose]);

  return (
    <div
      className="sale-receipt-page"
      data-receipt-ready={receiptReady ? '1' : '0'}
      data-company-ok={companyOk ? '1' : '0'}
    >
      <div className="sale-receipt-toolbar no-print">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => void printDocument('80mm')}
          disabled={!receiptReady}
        >
          Imprimir (Ctrl+P)
        </button>
        <span style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
          Bobina 80 mm — não fiscal. No GestorVend Desktop, use a impressora configurada em
          Configurações → Impressão (PDV). No navegador, o diálogo do sistema escolhe a impressora.
          {c && !companyUsesCustomLogo(c) ? (
            <>
              {' '}
              <strong>Sem logotipo próprio:</strong> cadastre em Empresa → Identidade visual para
              sair a marca da loja no cupom.
            </>
          ) : null}
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
          <p>Carregando cupom e dados da empresa…</p>
        </div>
      )}

      {saleId && receiptQ.isError && (
        <div className="sale-receipt-doc">
          <p>Não foi possível carregar o cupom. {(receiptQ.error as Error).message}</p>
        </div>
      )}

      {s && c && (
        <article
          ref={docRef}
          className="sale-receipt-doc"
          data-receipt-ready={receiptReady ? '1' : '0'}
          data-company-ok={companyOk ? '1' : '0'}
        >
          <header className="sale-receipt-center sale-receipt-company">
            <CompanyLogo
              className="sale-receipt-logo"
              company={c}
              alt={c.tradeName || c.legalName}
            />
            <p className="sale-receipt-title">{c.tradeName || c.legalName}</p>
            {c.tradeName && c.legalName && c.legalName !== c.tradeName && (
              <p className="sale-receipt-legal">{c.legalName}</p>
            )}
            {c.cnpj?.trim() ? (
              <p className="sale-receipt-sub">CNPJ {formatCnpjForReceipt(c.cnpj)}</p>
            ) : null}
            {c.ie?.trim() ? <p className="sale-receipt-sub">IE {c.ie}</p> : null}
            {c.address?.trim() ? <p className="sale-receipt-sub">{c.address}</p> : null}
            {formatAddressLine(c) ? (
              <p className="sale-receipt-sub">{formatAddressLine(c)}</p>
            ) : null}
            {c.phone?.trim() ? <p className="sale-receipt-sub">Tel. {c.phone}</p> : null}
          </header>

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
            {parseN(s.serviceFeeAmount) > 0.005 && (
              <div className="sale-receipt-totals-row">
                <span>Taxa de serviço</span>
                <span>+ {formatBRL(s.serviceFeeAmount)}</span>
              </div>
            )}
            {parseN(s.couvertAmount) > 0.005 && (
              <div className="sale-receipt-totals-row">
                <span>Couvert</span>
                <span>+ {formatBRL(s.couvertAmount)}</span>
              </div>
            )}
            {parseN(s.waiterTipAmount) > 0.005 && (
              <div className="sale-receipt-totals-row">
                <span>Taxa do garçom</span>
                <span>+ {formatBRL(s.waiterTipAmount)}</span>
              </div>
            )}
            {parseN(s.serviceFeeAmount) <= 0.005 &&
              parseN(s.couvertAmount) <= 0.005 &&
              parseN(s.waiterTipAmount) <= 0.005 &&
              parseN(s.surcharge) > 0.005 && (
                <div className="sale-receipt-totals-row">
                  <span>Acréscimo</span>
                  <span>+ {formatBRL(s.surcharge)}</span>
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
