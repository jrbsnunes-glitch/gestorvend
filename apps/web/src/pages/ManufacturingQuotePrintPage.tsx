import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { CompanyHeader, type CompanyHeaderData } from '../components/CompanyHeader';
import { api } from '../lib/api';
import { formatBRL, formatCalendarDate } from '../lib/format';
import type { MfgProjectDetail } from '../lib/manufacturing-types';
import './cash-print.css';
import './manufacturing-quote-print.css';

type PrintPayload = {
  company: {
    legalName: string;
    tradeName: string;
    cnpj: string;
    phone: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
    termsText: string | null;
  };
  project: MfgProjectDetail;
};

function parseMoney(raw: string | null | undefined): number {
  if (raw == null || raw === '') return 0;
  const n = parseFloat(String(raw).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function parseQty(raw: string): number {
  const n = parseFloat(String(raw).replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function companyForHeader(c: PrintPayload['company']): CompanyHeaderData {
  return {
    legalName: c.legalName,
    tradeName: c.tradeName,
    cnpj: c.cnpj,
    phone: c.phone,
    address: c.address,
    city: c.city,
    state: c.state,
  };
}

function formatQtyDisplay(raw: string): string {
  const n = parseFloat(String(raw).replace(',', '.'));
  if (!Number.isFinite(n)) return raw;
  return Number.isInteger(n) ? String(n) : n.toLocaleString('pt-BR', { maximumFractionDigits: 4 });
}

export function ManufacturingQuotePrintPage() {
  const [params] = useSearchParams();
  const id = params.get('id') ?? '';

  const printQ = useQuery({
    queryKey: ['manufacturing', 'print', id],
    queryFn: () => api<PrintPayload>(`/manufacturing/projects/${id}/print-data`),
    enabled: Boolean(id),
  });

  useEffect(() => {
    if (printQ.data) window.scrollTo({ top: 0 });
  }, [printQ.data]);

  const data = printQ.data;
  const p = data?.project;

  const quoteDate = useMemo(() => formatCalendarDate(new Date().toISOString()), []);

  const values = useMemo(() => {
    if (!p) return null;
    const total = parseMoney(p.quoteTotal);
    const deposit = parseMoney(p.depositAmount);
    const qty = parseQty(p.quantity);
    const balance = total > 0 ? Math.max(0, total - deposit) : 0;
    const unitPrice = total > 0 ? total / qty : 0;
    return {
      total,
      deposit,
      balance,
      qty,
      unitPrice,
      hasTotal: total > 0,
      hasDeposit: deposit > 0,
    };
  }, [p]);

  const lineDescription = useMemo(() => {
    if (!p) return '';
    const parts = [p.finishedVariant.product.name];
    if (p.title?.trim()) parts.push(p.title.trim());
    return parts.join(' — ');
  }, [p]);

  const scopeBlocks = useMemo(() => {
    if (!p) return [];
    const blocks: Array<{ label: string; text: string }> = [];
    if (p.customerBrief?.trim()) {
      blocks.push({ label: 'Solicitação do cliente', text: p.customerBrief.trim() });
    }
    if (p.technicalSpec?.trim()) {
      blocks.push({ label: 'Detalhes acordados', text: p.technicalSpec.trim() });
    }
    if (p.deliveryNotes?.trim()) {
      blocks.push({ label: 'Entrega e observações', text: p.deliveryNotes.trim() });
    }
    return blocks;
  }, [p]);

  return (
    <div className="print-page">
      <div className="no-print print-toolbar">
        <button type="button" className="btn btn-primary" onClick={() => window.print()}>
          Imprimir / PDF
        </button>
      </div>

      {!id ? <p>Informe o parâmetro id na URL.</p> : null}
      {printQ.isLoading ? <p>Carregando…</p> : null}
      {printQ.isError ? <p className="alert alert-error">Falha ao carregar orçamento.</p> : null}

      {data && p && values ? (
        <article className="print-doc mfg-quote-print">
          <CompanyHeader company={companyForHeader(data.company)} />

          <header className="mfg-quote-print__head">
            <h1>Orçamento de fabricação</h1>
            <p className="mfg-quote-print__ref">
              Proposta nº {p.number}
              {' · '}
              Emitido em {quoteDate}
              {p.promisedAt ? ` · Entrega prevista ${formatCalendarDate(p.promisedAt)}` : ''}
            </p>
          </header>

          <div className="mfg-quote-print__meta-grid">
            <div className="mfg-quote-print__meta-box">
              <span className="mfg-quote-print__meta-label">Cliente</span>
              <span className="mfg-quote-print__meta-value">{p.customer.name}</span>
            </div>
            <div className="mfg-quote-print__meta-box">
              <span className="mfg-quote-print__meta-label">Prazo de entrega</span>
              <span className="mfg-quote-print__meta-value">
                {p.promisedAt ? formatCalendarDate(p.promisedAt) : 'A combinar'}
              </span>
            </div>
          </div>

          {scopeBlocks.length ? (
            <section className="mfg-quote-print__section">
              <p className="mfg-quote-print__section-title">Escopo do serviço</p>
              {scopeBlocks.map((b) => (
                <div key={b.label} className="mfg-quote-print__notes-block">
                  <strong>{b.label}</strong>
                  <div className="mfg-quote-print__notes-box">{b.text}</div>
                </div>
              ))}
            </section>
          ) : null}

          <div className="mfg-quote-print__items-wrap">
            <table className="mfg-quote-print__items">
              <thead>
                <tr>
                  <th className="col-desc">Descrição</th>
                  <th className="col-num">Unidades</th>
                  <th className="col-num">Preço</th>
                  <th className="col-num">Total</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="col-desc">
                    {lineDescription}
                    {scopeBlocks.length === 0 && p.deliveryNotes?.trim() ? (
                      <span className="col-desc-sub">{p.deliveryNotes.trim()}</span>
                    ) : null}
                  </td>
                  <td className="col-num">{formatQtyDisplay(p.quantity)}</td>
                  <td className="col-num">
                    {values.hasTotal ? (
                      formatBRL(String(values.unitPrice))
                    ) : (
                      <span className="col-muted">Sob consulta</span>
                    )}
                  </td>
                  <td className="col-num">
                    {values.hasTotal ? (
                      formatBRL(String(values.total))
                    ) : (
                      <span className="col-muted">Sob consulta</span>
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="mfg-quote-print__totals-wrap">
            <div className="mfg-quote-print__totals">
              <div className="mfg-quote-print__totals-row">
                <span>Subtotal</span>
                <span>
                  {values.hasTotal ? formatBRL(String(values.total)) : 'Sob consulta'}
                </span>
              </div>
              {values.hasDeposit ? (
                <div className="mfg-quote-print__totals-row">
                  <span>Sinal para reserva</span>
                  <span>{formatBRL(String(values.deposit))}</span>
                </div>
              ) : null}
              {values.hasTotal && values.hasDeposit ? (
                <div className="mfg-quote-print__totals-row">
                  <span>Saldo na entrega</span>
                  <span>{formatBRL(String(values.balance))}</span>
                </div>
              ) : null}
              <div className="mfg-quote-print__grand">
                <span>Total orçado</span>
                <span>
                  {values.hasTotal ? formatBRL(String(values.total)) : 'Sob consulta'}
                </span>
              </div>
            </div>
          </div>

          {data.company.termsText?.trim() ? (
            <section className="mfg-quote-print__section mfg-quote-print__section--terms">
              <p className="mfg-quote-print__section-title">Condições gerais</p>
              <p className="mfg-quote-print__terms">{data.company.termsText.trim()}</p>
            </section>
          ) : null}

          <footer className="mfg-quote-print__sign">
            <div className="mfg-quote-print__sign-block">
              <div className="mfg-quote-print__sign-line" aria-hidden />
              <p className="mfg-quote-print__sign-label">Assinatura do emissor</p>
            </div>
            <div className="mfg-quote-print__sign-block">
              <div className="mfg-quote-print__sign-line" aria-hidden />
              <p className="mfg-quote-print__sign-label">Assinatura do cliente</p>
            </div>
          </footer>
        </article>
      ) : null}
    </div>
  );
}
