/**
 * DANFE / cupom auxiliar — NF-e (A4) ou NFC-e (térmica 80 mm).
 */
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { printDocument } from '../lib/desktop-print';
import { formatBRL, formatCnpj, formatCpfCnpj, formatDate } from '../lib/format';
import './danfe-thermal-print.css';

type DanfePayload = {
  document: {
    id: string;
    status: string;
    accessKey: string | null;
    protocol: string | null;
    kind: string;
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
        variant?: { sku?: string; product?: { name?: string } };
      }>;
    };
  };
  aliquots?: Array<{
    code: string;
    name: string;
    aliqIcms: string;
    aliqIpi: string;
    aliqPis: string;
    aliqCofins: string;
  }>;
  company: {
    legalName: string;
    tradeName: string;
    cnpj: string;
    ie: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
    phone: string | null;
  } | null;
};

function freightLabel(mod?: number): string {
  switch (mod) {
    case 0:
      return 'Emitente (CIF)';
    case 1:
      return 'Destinatário (FOB)';
    default:
      return 'Sem frete';
  }
}

export function DanfePrintPage() {
  const { id } = useParams<{ id: string }>();

  const q = useQuery({
    queryKey: ['fiscal', 'danfe', id],
    queryFn: () => api<DanfePayload>(`/fiscal/documents/${id}/danfe`),
    enabled: !!id,
    refetchInterval: (query) => {
      const st = query.state.data?.document.status;
      if (st === 'AUTHORIZED' || st === 'REJECTED' || st === 'ERROR' || st === 'CANCELLED') {
        return false;
      }
      return 2500;
    },
  });

  const doc = q.data?.document;
  const company = q.data?.company;
  const aliquots = q.data?.aliquots ?? [];
  const isNfce = doc?.kind === 'NFC_E';
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
      <Link to="/notas-fiscais">← Notas</Link>
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
    </div>
  );

  if (isNfce && doc) {
    return (
      <div className="danfe-thermal-page">
        {toolbar}
        {q.isLoading && <p className="no-print">Carregando…</p>}
        {q.isError && (
          <div className="alert alert-error no-print">{(q.error as Error).message}</div>
        )}
        <article className="danfe-thermal-doc">
          <div className="muted-line">NFC-e — modelo 65</div>
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
          <div>
            Cupom #{doc.sale.number} · {formatDate(doc.sale.createdAt)}
          </div>
          <div>
            Situação: <strong>{doc.status}</strong>
            {doc.protocol ? ` · Prot. ${doc.protocol}` : ''}
          </div>
          {doc.sale.customer?.name && (
            <div>
              Cliente: {doc.sale.customer.name}
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
          {doc.accessKey && (
            <>
              <hr />
              <div className="key">
                Chave:
                <br />
                {doc.accessKey}
              </div>
            </>
          )}
          {doc.lastError && doc.status !== 'AUTHORIZED' && (
            <div className="alert alert-error no-print">{doc.lastError}</div>
          )}
          <hr />
          <p className="muted-line">Documento auxiliar NFC-e. Validade jurídica: XML SEFAZ.</p>
        </article>
      </div>
    );
  }

  return (
    <div className="page print-area" style={{ maxWidth: 900, margin: '0 auto' }}>
      {toolbar}
      {q.isLoading && <p>Carregando DANFE…</p>}
      {q.isError && <div className="alert alert-error">{(q.error as Error).message}</div>}

      {doc && (
        <article
          style={{
            border: '1px solid #222',
            padding: '1rem 1.25rem',
            background: '#fff',
            color: '#111',
            fontFamily: 'Georgia, "Times New Roman", serif',
          }}
        >
          <header style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
            <div>
              <div style={{ fontSize: '0.75rem', letterSpacing: '0.06em' }}>DANFE — NF-e modelo 55</div>
              <h1 style={{ margin: '0.2rem 0', fontSize: '1.35rem' }}>
                {company?.tradeName || company?.legalName || 'Emitente'}
              </h1>
              {company && (
                <p style={{ margin: 0, fontSize: '0.85rem', lineHeight: 1.45 }}>
                  {company.legalName}
                  <br />
                  CNPJ {formatCnpj(company.cnpj)}
                  {company.ie ? ` · IE ${company.ie}` : ''}
                  <br />
                  {[company.address, company.city, company.state, company.zip]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              )}
            </div>
            <div style={{ textAlign: 'right', fontSize: '0.9rem' }}>
              <div>
                Controle <strong>#{doc.sale.number}</strong>
              </div>
              <div>{formatDate(doc.sale.createdAt)}</div>
              <div style={{ marginTop: '0.35rem' }}>
                Situação: <strong>{doc.status}</strong>
              </div>
              {doc.protocol && <div>Protocolo: {doc.protocol}</div>}
            </div>
          </header>

          <hr style={{ margin: '0.85rem 0', border: 0, borderTop: '1px solid #333' }} />

          {doc.sale.operationNature && (
            <section style={{ fontSize: '0.88rem', marginBottom: '0.55rem' }}>
              <strong>Natureza da operação</strong>
              <div>
                {doc.sale.operationNature.description} · CFOP {doc.sale.operationNature.cfop} (
                {doc.sale.operationNature.code})
              </div>
            </section>
          )}

          <section style={{ fontSize: '0.9rem', marginBottom: '0.75rem' }}>
            <strong>Destinatário</strong>
            <div>
              {doc.sale.customer?.name ?? '—'}
              {doc.sale.customer?.document
                ? ` · ${formatCpfCnpj(doc.sale.customer.document)}`
                : ''}
            </div>
          </section>

          {(doc.sale.deliveryVehiclePlate || doc.sale.deliveryDriverName) && (
            <section style={{ fontSize: '0.85rem', marginBottom: '0.65rem' }}>
              <strong>Entrega / transporte</strong>
              <div>
                {[
                  doc.sale.deliveryVehiclePlate
                    ? `Placa ${doc.sale.deliveryVehiclePlate}`
                    : null,
                  doc.sale.deliveryDriverName
                    ? `Motorista ${doc.sale.deliveryDriverName}`
                    : null,
                  `Frete: ${freightLabel(doc.sale.freightMod)}`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
            </section>
          )}

          {doc.accessKey && (
            <p style={{ fontSize: '0.78rem', wordBreak: 'break-all' }}>
              Chave de acesso: <strong>{doc.accessKey}</strong>
            </p>
          )}

          {doc.lastError && doc.status !== 'AUTHORIZED' && (
            <div className="alert alert-error no-print">{doc.lastError}</div>
          )}

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #333', padding: '0.35rem' }}>
                  Produto
                </th>
                <th style={{ textAlign: 'right', borderBottom: '1px solid #333', padding: '0.35rem' }}>
                  Qtd
                </th>
                <th style={{ textAlign: 'right', borderBottom: '1px solid #333', padding: '0.35rem' }}>
                  Unit.
                </th>
                <th style={{ textAlign: 'right', borderBottom: '1px solid #333', padding: '0.35rem' }}>
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {(doc.sale.items ?? []).map((it, i) => (
                <tr key={i}>
                  <td style={{ padding: '0.3rem', borderBottom: '1px solid #ddd' }}>
                    {it.variant?.product?.name ?? '—'}
                    {it.variant?.sku ? (
                      <span style={{ color: '#555' }}> ({it.variant.sku})</span>
                    ) : null}
                  </td>
                  <td style={{ textAlign: 'right', padding: '0.3rem', borderBottom: '1px solid #ddd' }}>
                    {Number(it.quantity).toLocaleString('pt-BR')}
                  </td>
                  <td style={{ textAlign: 'right', padding: '0.3rem', borderBottom: '1px solid #ddd' }}>
                    {formatBRL(it.unitPrice)}
                  </td>
                  <td style={{ textAlign: 'right', padding: '0.3rem', borderBottom: '1px solid #ddd' }}>
                    {formatBRL(it.totalLine)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <footer
            style={{
              marginTop: '1rem',
              display: 'flex',
              justifyContent: 'flex-end',
              fontSize: '1.05rem',
            }}
          >
            <div>
              {Number(doc.sale.discount) > 0 && (
                <div style={{ textAlign: 'right', fontSize: '0.85rem' }}>
                  Desconto: {formatBRL(doc.sale.discount)}
                </div>
              )}
              {Number(doc.sale.surcharge) > 0 && (
                <div style={{ textAlign: 'right', fontSize: '0.85rem' }}>
                  Acréscimo: {formatBRL(doc.sale.surcharge)}
                </div>
              )}
              {Number(doc.sale.freightAmount ?? 0) > 0 && (
                <div style={{ textAlign: 'right', fontSize: '0.85rem' }}>
                  Frete ({freightLabel(doc.sale.freightMod)}): {formatBRL(doc.sale.freightAmount)}
                </div>
              )}
              <strong>Total: {formatBRL(doc.sale.total)}</strong>
            </div>
          </footer>

          {doc.sale.notes && (
            <p style={{ marginTop: '0.85rem', fontSize: '0.8rem', whiteSpace: 'pre-wrap' }}>
              <strong>Observações:</strong> {doc.sale.notes}
            </p>
          )}

          <section
            style={{
              marginTop: '1.25rem',
              paddingTop: '0.75rem',
              borderTop: '1px solid #333',
              fontSize: '0.78rem',
            }}
          >
            <strong>Alíquotas (Situação Fiscal)</strong>
            {aliquots.length === 0 ? (
              <p style={{ margin: '0.35rem 0 0', color: '#555' }}>
                Sem alíquotas cadastradas nas situações fiscais dos produtos desta nota.
              </p>
            ) : (
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  marginTop: '0.4rem',
                  fontSize: '0.75rem',
                }}
              >
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', borderBottom: '1px solid #999', padding: '0.25rem' }}>
                      Situação
                    </th>
                    <th style={{ textAlign: 'right', borderBottom: '1px solid #999', padding: '0.25rem' }}>
                      ICMS %
                    </th>
                    <th style={{ textAlign: 'right', borderBottom: '1px solid #999', padding: '0.25rem' }}>
                      IPI %
                    </th>
                    <th style={{ textAlign: 'right', borderBottom: '1px solid #999', padding: '0.25rem' }}>
                      PIS %
                    </th>
                    <th style={{ textAlign: 'right', borderBottom: '1px solid #999', padding: '0.25rem' }}>
                      COFINS %
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {aliquots.map((a) => (
                    <tr key={a.code}>
                      <td style={{ padding: '0.25rem', borderBottom: '1px solid #eee' }}>
                        {a.code} — {a.name}
                      </td>
                      <td style={{ textAlign: 'right', padding: '0.25rem', borderBottom: '1px solid #eee' }}>
                        {a.aliqIcms}
                      </td>
                      <td style={{ textAlign: 'right', padding: '0.25rem', borderBottom: '1px solid #eee' }}>
                        {a.aliqIpi}
                      </td>
                      <td style={{ textAlign: 'right', padding: '0.25rem', borderBottom: '1px solid #eee' }}>
                        {a.aliqPis}
                      </td>
                      <td style={{ textAlign: 'right', padding: '0.25rem', borderBottom: '1px solid #eee' }}>
                        {a.aliqCofins}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <p style={{ marginTop: '1.25rem', fontSize: '0.72rem', color: '#444' }}>
            Documento auxiliar de NF-e (DANFE). A validade jurídica é do XML autorizado junto à SEFAZ.
          </p>
        </article>
      )}
    </div>
  );
}
