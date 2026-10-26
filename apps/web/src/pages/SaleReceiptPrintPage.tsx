import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CompanyLogo } from '../components/CompanyLogo';
import { api } from '../lib/api';
import { companyUsesCustomLogo } from '../lib/company-branding';
import { formatBRL, formatDate } from '../lib/format';
import { getDesktopApi, isGestorVendDesktop } from '../lib/desktop-bridge';
import { consumeAutoPrintNonce } from '../lib/sale-receipt-print';
import { formatNfceAccessKey, NfceQrImage, useNfceQrDataUrl } from '../lib/nfce-qr';
import {
  hardenSaleReceiptStyles,
  inlineSaleReceiptImages,
  waitSaleReceiptImages,
} from '../lib/sale-receipt-harden';
import { printDocument } from '../lib/desktop-print';
import { APP_VERSION } from '../version';
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
  cardFeeSurcharge?: string;
  serviceFeeAmount?: string;
  couvertAmount?: string;
  waiterTipAmount?: string;
  total: string;
  createdAt: string;
  notes: string | null;
  customer: { name: string } | null;
  user: { name: string } | null;
  sellerName?: string | null;
  sellerUser?: { name: string } | null;
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

type NfceReceipt = {
  documentId: string;
  status: string;
  accessKey: string | null;
  protocol: string | null;
  sefazEnvironment: string | null;
  qrCode: string | null;
  urlChave: string | null;
  serie: number | null;
  nNF: number | null;
  pending: boolean;
};

type ReceiptPayload = {
  sale: SaleReceipt;
  company: Company;
  nfce?: NfceReceipt | null;
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

/**
 * Escala do cupom configurada no PDV (Desktop). Aplicada na tipografia, nunca
 * na largura — a caixa precisa continuar do tamanho da bobina.
 */
async function readPdvReceiptScale(): Promise<number> {
  try {
    const cfg = await getDesktopApi()?.getPdvPrinter?.();
    const raw = cfg?.receiptScale;
    if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return raw;
  } catch {
    /* navegador ou shell antigo */
  }
  return 1.4;
}

/** Venda fictícia do modo demonstração (`?demo=1`) — valida o layout na térmica. */
function buildDemoSale(): SaleReceipt {
  return {
    id: 'demo-cupom-000000',
    number: 0,
    status: 'PAID',
    subtotal: '38.40',
    discount: '2.40',
    total: '36.00',
    createdAt: new Date().toISOString(),
    notes: 'Cupom de teste — confira logo, CNPJ e alinhamento.',
    customer: { name: 'Cliente de teste' },
    user: { name: 'Operador' },
    items: [
      {
        quantity: '2',
        unitPrice: '12.90',
        discount: '0',
        totalLine: '25.80',
        variant: { sku: 'TESTE-001', product: { name: 'Produto de demonstração' } },
      },
      {
        quantity: '1',
        unitPrice: '12.60',
        discount: '0',
        totalLine: '12.60',
        variant: { sku: 'TESTE-002', product: { name: 'Item com nome mais longo para conferir a quebra de linha' } },
      },
    ],
    payments: [{ method: 'CASH', amount: '36.00', installments: 1 }],
  };
}

function safeReturnTo(raw: string | null): string | null {
  const value = raw?.trim() ?? '';
  if (!value.startsWith('/')) return null;
  if (value.startsWith('//')) return null;
  if (value.startsWith('/notas-fiscais') || value.startsWith('/vendas')) return value;
  return null;
}

function leaveReceiptPage(
  navigate: ReturnType<typeof useNavigate>,
  returnTo?: string | null,
): void {
  if (window.opener && !window.opener.closed) {
    try {
      window.close();
      return;
    } catch {
      /* janela principal segue no sistema */
    }
  }
  if (window.history.length > 1) {
    navigate(-1);
    return;
  }
  const dest = safeReturnTo(returnTo ?? null);
  if (dest) {
    navigate(dest);
    return;
  }
  navigate('/vendas');
}

export function SaleReceiptPrintPage() {
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const saleId = sp.get('id')?.trim() ?? '';
  const demo = sp.get('demo') === '1' || sp.get('demo') === 'true';
  const wantAutoPrint = sp.get('autoprint') === '1' || sp.get('autoprint') === 'true';
  const wantClose = sp.get('close') === '1' || sp.get('close') === 'true';
  const isSecondCopy = sp.get('copy') === '1' || sp.get('copy') === 'true';
  const np = sp.get('_np');
  const [printErr, setPrintErr] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);

  const receiptQ = useQuery({
    queryKey: demo ? ['sale-receipt', 'demo'] : ['sales', saleId, 'receipt'],
    queryFn: async (): Promise<ReceiptPayload> => {
      if (demo) {
        const company = await api<Company>('/company');
        return { sale: buildDemoSale(), company, nfce: null };
      }
      try {
        return await api<ReceiptPayload>(`/sales/${encodeURIComponent(saleId)}/receipt`);
      } catch {
        // API antiga sem /receipt — carrega venda + empresa em paralelo.
        const [sale, company] = await Promise.all([
          api<SaleReceipt>(`/sales/${encodeURIComponent(saleId)}`),
          api<Company>('/company'),
        ]);
        return { sale, company, nfce: null };
      }
    },
    enabled: demo || Boolean(saleId),
    retry: 2,
    retryDelay: 400,
    refetchInterval: (query) => {
      if (demo) return false;
      const nfce = query.state.data?.nfce;
      if (nfce?.pending) return 2000;
      return false;
    },
  });

  const docRef = useRef<HTMLElement | null>(null);
  const [hardened, setHardened] = useState(false);
  /** Sem o shell Desktop a impressão cai no diálogo do sistema (papel do driver). */
  const [browserPrint, setBrowserPrint] = useState(false);

  useEffect(() => {
    setBrowserPrint(!isGestorVendDesktop());
  }, []);

  const s = receiptQ.data?.sale;
  const c = receiptQ.data?.company;
  const nfce = receiptQ.data?.nfce ?? null;
  const nfceAuthorized = nfce?.status === 'AUTHORIZED';
  const qrSrc = useNfceQrDataUrl(nfceAuthorized ? nfce?.qrCode : null);
  const needQr = Boolean(nfceAuthorized && nfce?.qrCode);
  const [fiscalWaitDone, setFiscalWaitDone] = useState(false);
  const loading = (demo || Boolean(saleId)) && receiptQ.isLoading;
  const companyOk = Boolean(s && (c?.legalName || c?.tradeName));
  const waitingFiscal = Boolean(wantAutoPrint && nfce?.pending && !fiscalWaitDone);
  /** Só libera impressão com empresa no DOM, QR (se NFC-e) e layout já blindado. */
  const receiptReady = companyOk && hardened && !waitingFiscal && (!needQr || Boolean(qrSrc));

  useEffect(() => {
    document.documentElement.classList.add('gv-sale-receipt-print');
    document.body.classList.add('gv-sale-receipt-print');
    return () => {
      document.documentElement.classList.remove('gv-sale-receipt-print');
      document.body.classList.remove('gv-sale-receipt-print');
    };
  }, []);

  /**
   * Blinda o cupom antes de qualquer impressão: largura física da bobina,
   * escala só na tipografia, estilos `important` inline (imunes à folha
   * injetada pelo shell) e logo em `data:` URL.
   */
  useEffect(() => {
    if (!nfce?.pending) {
      setFiscalWaitDone(false);
      return;
    }
    const t = window.setTimeout(() => setFiscalWaitDone(true), 15_000);
    return () => window.clearTimeout(t);
  }, [nfce?.pending, saleId]);

  useEffect(() => {
    const root = docRef.current;
    if (!companyOk || (needQr && !qrSrc) || !root) return;
    let alive = true;
    setHardened(false);
    void (async () => {
      const scale = await readPdvReceiptScale();
      hardenSaleReceiptStyles(root, scale);
      await inlineSaleReceiptImages(root);
      await waitSaleReceiptImages(root);
      if (!alive) return;
      hardenSaleReceiptStyles(root, scale);
      setHardened(true);
    })();
    return () => {
      alive = false;
    };
  }, [companyOk, needQr, qrSrc, receiptQ.dataUpdatedAt]);

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
    if (!wantAutoPrint || !receiptReady) return;
    if (!consumeAutoPrintNonce(np, saleId || 'demo')) return;
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

  async function handlePrint() {
    if (!receiptReady || printing) return;
    setPrintErr(null);
    setPrinting(true);
    try {
      await printDocument('80mm');
    } catch (err) {
      setPrintErr(err instanceof Error ? err.message : 'Falha ao imprimir o cupom.');
    } finally {
      setPrinting(false);
    }
  }

  useEffect(() => {
    function onFail(ev: Event) {
      const detail = (ev as CustomEvent<{ error?: string }>).detail;
      const msg = detail?.error?.trim() || 'Falha ao enviar cupom à impressora.';
      setPrintErr(msg);
      setPrinting(false);
    }
    function onKey(ev: KeyboardEvent) {
      if (!(ev.ctrlKey || ev.metaKey) || ev.key.toLowerCase() !== 'p') return;
      ev.preventDefault();
      ev.stopPropagation();
      void handlePrint();
    }
    window.addEventListener('gv-print-failed', onFail);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('gv-print-failed', onFail);
      window.removeEventListener('keydown', onKey);
    };
  }, [receiptReady, printing]);

  return (
    <div
      className="sale-receipt-page"
      data-receipt-ready={receiptReady ? '1' : '0'}
      data-company-ok={companyOk ? '1' : '0'}
    >
      <div className="sale-receipt-toolbar no-print">
        <div className="sale-receipt-toolbar-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => leaveReceiptPage(navigate, sp.get('returnTo'))}
          >
            Voltar
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void handlePrint()}
            disabled={!receiptReady || printing}
          >
            {printing ? 'Imprimindo…' : 'Imprimir (Ctrl+P)'}
          </button>
        </div>
        {printErr ? (
          <p role="alert" style={{ margin: '0.35rem 0 0', color: '#b91c1c', fontSize: '0.88rem' }}>
            {printErr}
          </p>
        ) : null}
        <span style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
          {demo ? (
            <>
              <strong>Modelo de teste</strong> — mesma formatação de um cupom real, com os dados da
              sua empresa.{' '}
            </>
          ) : null}
          {nfceAuthorized
            ? 'Bobina 80 mm — DANFE NFC-e com QR Code.'
            : 'Bobina 80 mm — cupom não fiscal.'}{' '}
          No GestorVend Desktop, use a impressora configurada em Configurações → Impressão (PDV). No
          navegador, o diálogo do sistema escolhe a impressora.
          {browserPrint ? (
            <>
              {' '}
              <strong>Impressão pelo navegador:</strong> no diálogo, escolha o papel da bobina (80 mm
              / Roll) e deixe a escala em <strong>100%</strong> e as margens em{' '}
              <strong>Nenhuma</strong>. Com papel A4 e “Ajustar à página”, o cupom sai minúsculo — a
              impressão silenciosa do Desktop já usa a bobina.
            </>
          ) : null}
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

      <div className="sale-receipt-preview">
      {!saleId && !demo && (
        <div className="sale-receipt-doc">
          <p>
            Informe o código da venda na URL: <strong>?id=</strong>…
          </p>
        </div>
      )}

      {loading && (
        <div className="sale-receipt-doc">
          <p>Carregando cupom e dados da empresa…</p>
        </div>
      )}

      {(saleId || demo) && receiptQ.isError && (
        <div className="sale-receipt-doc">
          <p>Não foi possível carregar o cupom. {(receiptQ.error as Error).message}</p>
        </div>
      )}

      {s && c && (
        <article
          ref={docRef}
          className={'sale-receipt-doc' + (nfceAuthorized ? ' sale-receipt-doc--nfce' : '')}
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

          {nfceAuthorized ? (
            <>
              <p className="sale-receipt-center sale-receipt-sub">
                <strong>DANFE NFC-e</strong>
              </p>
              <p className="sale-receipt-center sale-receipt-fiscal-note">
                Documento Auxiliar da Nota Fiscal de Consumidor Eletrônica
              </p>
              <p className="sale-receipt-center sale-receipt-fiscal-note">
                Não permite aproveitamento de crédito de ICMS
              </p>
              {nfce?.sefazEnvironment !== 'PRODUCAO' ? (
                <p className="sale-receipt-banner">
                  Emitida em homologação — sem valor fiscal
                </p>
              ) : null}
            </>
          ) : (
            <>
              <p className="sale-receipt-center sale-receipt-sub">
                <strong>DOCUMENTO AUXILIAR DE VENDA</strong>
              </p>
              <p className="sale-receipt-center sale-receipt-fiscal-note">
                Não possui validade fiscal — conferência interna / troca mediante política da loja
              </p>
              {nfce?.pending ? (
                <p className="sale-receipt-center sale-receipt-fiscal-note">
                  NFC-e em processamento na SEFAZ…
                </p>
              ) : null}
            </>
          )}

          {s.status === 'CANCELLED' && (
            <p className="sale-receipt-banner">Venda cancelada</p>
          )}

          <div className="sale-receipt-meta">
            <span>
              {nfceAuthorized ? (
                <strong>
                  NFC-e
                  {nfce?.nNF != null ? ` nº ${nfce.nNF}` : ''}
                  {nfce?.serie != null ? ` · Série ${nfce.serie}` : ''}
                </strong>
              ) : (
                <strong>Venda #{s.number}</strong>
              )}
            </span>
            <span>{formatDate(s.createdAt)}</span>
          </div>
          {nfceAuthorized ? (
            <div className="sale-receipt-meta">
              <span>Venda</span>
              <span>#{s.number}</span>
            </div>
          ) : null}
          {isSecondCopy ? (
            <p className="sale-receipt-banner">2ª via do comprovante</p>
          ) : null}
          {s.user?.name ? (
            <div className="sale-receipt-meta">
              <span>Operador</span>
              <span>{s.user.name}</span>
            </div>
          ) : null}
          {s.sellerName || s.sellerUser?.name || s.user?.name ? (
            <div className="sale-receipt-meta">
              <span>Responsável</span>
              <span>{s.sellerName || s.sellerUser?.name || s.user?.name}</span>
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
              const itemDisc = parseN(it.discount);
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
                      {itemDisc > 0.005 ? ` (− ${formatBRL(itemDisc)})` : ''}
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
            {parseN(s.cardFeeSurcharge) > 0.005 && (
              <div className="sale-receipt-totals-row">
                <span>Taxa cartão (repasse)</span>
                <span>+ {formatBRL(s.cardFeeSurcharge)}</span>
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

          {nfceAuthorized ? (
            <>
              <hr className="sale-receipt-line" />
              <div className="sale-receipt-nfce">
                <p className="sale-receipt-center sale-receipt-fiscal-note">
                  Consulte pela Chave de Acesso em
                </p>
                {nfce?.urlChave ? (
                  <p className="sale-receipt-center sale-receipt-fiscal-note">{nfce.urlChave}</p>
                ) : null}
                {nfce?.accessKey ? (
                  <p className="sale-receipt-nfce-key">{formatNfceAccessKey(nfce.accessKey)}</p>
                ) : null}
                {nfce?.protocol ? (
                  <p className="sale-receipt-center sale-receipt-fiscal-note">
                    Protocolo de Autorização: {nfce.protocol}
                  </p>
                ) : null}
                {qrSrc ? (
                  <div className="sale-receipt-nfce-qr">
                    <NfceQrImage src={qrSrc} />
                  </div>
                ) : null}
              </div>
            </>
          ) : null}

          <hr className="sale-receipt-line" />

          <footer className="sale-receipt-foot">
            <p style={{ margin: 0 }}>Obrigado pela preferência!</p>
            <p className="sale-receipt-foot-muted">
              {nfceAuthorized
                ? `DANFE NFC-e · GestorVend v${APP_VERSION}`
                : `Cupom gerado pelo GestorVend v${APP_VERSION} · ID ${s.id.slice(0, 8)}…`}
            </p>
          </footer>
        </article>
      )}
      </div>
    </div>
  );
}
