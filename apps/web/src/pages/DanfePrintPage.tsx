/**
 * DANFE / cupom auxiliar — NF-e (A4) ou NFC-e (térmica 80 mm).
 */
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { printDocument } from '../lib/desktop-print';
import { formatBRL, formatCnpj, formatCpfCnpj, formatDate } from '../lib/format';
import { fiscalPaymentLabel } from '../lib/nfce-payment';
import { formatNfceAccessKey, NfceQrImage, useNfceQrDataUrl } from '../lib/nfce-qr';
import { DanfeNfeDocument, type DanfeNfePayload } from './DanfeNfeDocument';
import './danfe-thermal-print.css';
import './danfe-nfe-print.css';

type DanfePayload = {
  preview?: boolean;
  document: {
    id: string;
    status: string;
    accessKey: string | null;
    protocol: string | null;
    kind: string;
    sefazEnvironment?: string | null;
    lastError: string | null;
    sale: {
      number: number;
      total: string;
      discount: string;
      surcharge: string;
      freightAmount?: string;
      freightMod?: number;
      deliveryVehiclePlate?: string | null;
      deliveryDriverName?: string | null;
      notes?: string | null;
      createdAt: string;
      customer: { name: string; document: string | null } | null;
      operationNature?: {
        code: string;
        description: string;
        cfop: string;
      } | null;
      items?: Array<{
        quantity: string;
        unitPrice: string;
        totalLine: string;
        variant?: {
          sku?: string;
          product?: {
            name?: string;
            fiscalSituation?: { cstIbsCbs?: string | null; cClassTrib?: string | null } | null;
          };
        };
      }>;
      payments?: Array<{
        method: string;
        amount: string;
        installments: number;
        cardOperation?: string | null;
        paymentForm?: { name?: string | null } | null;
        tPag?: string | null;
        xPag?: string | null;
        fiscalLabel?: string | null;
      }>;
    };
  };
  nfce?: {
    qrCode: string | null;
    urlChave: string | null;
    serie: number | null;
    nNF: number | null;
  } | null;
  aliquots?: Array<{
    code: string;
    name: string;
    aliqIcms: string;
    aliqIpi: string;
    aliqPis: string;
    aliqCofins: string;
  }>;
  /** NT 2026.010. No Simples/MEI em 2026 os totais saem zerados. */
  rtc?: {
    crt: number;
    totals: { cbs: string; ibsUf: string; ibsMun: string; is: string };
  };
  company: {
    legalName: string;
    tradeName: string;
    cnpj: string;
    ie: string | null;
    im?: string | null;
    address: string | null;
    addressNumber?: string | null;
    district?: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
    phone: string | null;
    email?: string | null;
    logoUrl?: string | null;
  } | null;
  nfe?: { serie: number | null; nNF: number | null } | null;
};

export function DanfePrintPage() {
  const { id } = useParams<{ id: string }>();
  const isPreview = id === 'preview';

  const q = useQuery({
    queryKey: ['fiscal', 'danfe', id],
    queryFn: () => {
      if (isPreview) {
        const raw = sessionStorage.getItem('gv-danfe-preview');
        if (!raw) throw new Error('Pré-visualização expirada — gere de novo no formulário NF-e.');
        return JSON.parse(raw) as DanfePayload;
      }
      return api<DanfePayload>(`/fiscal/documents/${id}/danfe`);
    },
    enabled: !!id,
    refetchInterval: (query) => {
      if (isPreview) return false;
      const st = query.state.data?.document.status;
      if (st === 'AUTHORIZED' || st === 'REJECTED' || st === 'ERROR' || st === 'CANCELLED') {
        return false;
      }
      return 2500;
    },
  });

  const doc = q.data?.document;
  const company = q.data?.company;
  const isNfce = doc?.kind === 'NFC_E';
  const nfce = q.data?.nfce;
  const qrSrc = useNfceQrDataUrl(isNfce ? nfce?.qrCode : null);
  const homolog = doc?.sefazEnvironment !== 'PRODUCAO';
  const pending =
    doc &&
    (doc.status === 'QUEUED' ||
      doc.status === 'BUILDING_XML' ||
      doc.status === 'SENT' ||
      doc.status === 'CONTINGENCY');

  useEffect(() => {
    document.title = doc
      ? `${isNfce ? 'NFC-e' : 'DANFE NF-e'} #${doc.sale.number}`
      : 'Documento fiscal';
  }, [doc, isNfce]);

  const toolbar = (
    <div className="no-print" style={{ marginBottom: '1rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
      <Link to={isNfce ? '/notas-fiscais?tab=NFC_E' : '/notas-fiscais?tab=NF_E'}>← Notas</Link>
      <button
        type="button"
        className="btn btn-primary"
        onClick={() => void printDocument(isNfce ? '80mm' : 'A4')}
      >
        Imprimir {isNfce ? '(80 mm)' : '/ PDF'}
      </button>
      {pending && (
        <span style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>
          Aguardando autorização SEFAZ ({doc?.status})…
        </span>
      )}
      {(isPreview || q.data?.preview) && (
        <span className="alert alert-error" style={{ margin: 0, padding: '0.35rem 0.65rem' }}>
          Pré-visualização — sem valor fiscal / não transmitida
        </span>
      )}
    </div>
  );

  if (isNfce && doc) {
    const serie = nfce?.serie;
    const nNF = nfce?.nNF;
    const payments = doc.sale.payments ?? [];
    return (
      <div className="danfe-thermal-page">
        {toolbar}
        {q.isLoading && <p className="no-print">Carregando…</p>}
        {q.isError && (
          <div className="alert alert-error no-print">{(q.error as Error).message}</div>
        )}
        <article className="danfe-thermal-doc">
          <h1>{company?.tradeName || company?.legalName || 'Emitente'}</h1>
          {company && (
            <p className="muted-line">
              CNPJ {formatCnpj(company.cnpj)}
              {company.ie ? ` · IE ${company.ie}` : ''}
            </p>
          )}
          {company && (
            <p className="muted-line">
              {[company.address, company.city, company.state].filter(Boolean).join(' · ')}
            </p>
          )}
          <hr />
          <p className="muted-line">
            <strong>DANFE NFC-e</strong>
          </p>
          <p className="muted-line">Documento Auxiliar da Nota Fiscal de Consumidor Eletrônica</p>
          <p className="muted-line">Não permite aproveitamento de crédito de ICMS</p>
          {homolog && doc.status === 'AUTHORIZED' && (
            <p className="muted-line">
              <strong>EMITIDA EM AMBIENTE DE HOMOLOGAÇÃO — SEM VALOR FISCAL</strong>
            </p>
          )}
          <hr />
          <div>
            NFC-e
            {nNF != null ? ` nº ${nNF}` : ''}
            {serie != null ? ` · Série ${serie}` : ''}
            {` · Venda #${doc.sale.number}`}
          </div>
          <div>{formatDate(doc.sale.createdAt)}</div>
          {doc.sale.customer?.name && (
            <div>
              Consumidor: {doc.sale.customer.name}
              {doc.sale.customer.document
                ? ` · ${formatCpfCnpj(doc.sale.customer.document)}`
                : ''}
            </div>
          )}
          <hr />
          <table>
            <tbody>
              {(doc.sale.items ?? []).map((it, i) => (
                <tr key={i}>
                  <td style={{ width: '100%' }}>
                    <div>{it.variant?.product?.name ?? '—'}</div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.35rem' }}>
                      <span>
                        {Number(it.quantity).toLocaleString('pt-BR')} x {formatBRL(it.unitPrice)}
                      </span>
                      <span>{formatBRL(it.totalLine)}</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <hr />
          {Number(doc.sale.discount) > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Desconto</span>
              <span>{formatBRL(doc.sale.discount)}</span>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
            <strong>TOTAL</strong>
            <strong>{formatBRL(doc.sale.total)}</strong>
          </div>
          {payments.length > 0 && (
            <>
              <hr />
              {payments.map((p, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>
                    {fiscalPaymentLabel(p)}
                  </span>
                  <span>{formatBRL(p.amount)}</span>
                </div>
              ))}
            </>
          )}
          {(doc.accessKey || qrSrc) && (
            <>
              <hr />
              <p className="muted-line">Consulte pela Chave de Acesso em</p>
              {nfce?.urlChave ? <p className="muted-line">{nfce.urlChave}</p> : null}
              {doc.accessKey ? (
                <div className="key">{formatNfceAccessKey(doc.accessKey)}</div>
              ) : null}
              {doc.protocol ? (
                <p className="muted-line">Protocolo de Autorização: {doc.protocol}</p>
              ) : null}
              {qrSrc ? (
                <div className="nfce-qr-wrap">
                  <NfceQrImage src={qrSrc} />
                </div>
              ) : null}
            </>
          )}
          {doc.lastError && doc.status !== 'AUTHORIZED' && (
            <div className="alert alert-error no-print">{doc.lastError}</div>
          )}
          <hr />
          <p className="muted-line">
            Documento auxiliar da NFC-e. A validade jurídica é do XML autorizado pela SEFAZ.
          </p>
        </article>
      </div>
    );
  }

  return (
    <div className="danfe-nfe-page">
      <div className="no-print" style={{ maxWidth: 900, margin: '0 auto 0.75rem', padding: '0 1rem' }}>
        {toolbar}
        {q.isLoading && <p>Carregando DANFE…</p>}
        {q.isError && <div className="alert alert-error">{(q.error as Error).message}</div>}
      </div>
      {q.data && doc ? <DanfeNfeDocument data={q.data as DanfeNfePayload} /> : null}
    </div>
  );
}
