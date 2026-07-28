/**
 * DANFE simplificado em HTML — imprimir / salvar PDF pelo navegador.
 * Abre em nova aba a partir de Emitir / 2ª via.
 */
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { formatBRL, formatCnpj, formatCpfCnpj, formatDate } from '../lib/format';

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
      createdAt: string;
      customer: { name: string; document: string | null } | null;
      items?: Array<{
        quantity: string;
        unitPrice: string;
        totalLine: string;
        variant?: { sku?: string; product?: { name?: string } };
      }>;
    };
  };
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

  useEffect(() => {
    document.title = q.data
      ? `DANFE NF-e #${q.data.document.sale.number}`
      : 'DANFE NF-e';
  }, [q.data]);

  const doc = q.data?.document;
  const company = q.data?.company;
  const pending =
    doc &&
    (doc.status === 'QUEUED' ||
      doc.status === 'BUILDING_XML' ||
      doc.status === 'SENT' ||
      doc.status === 'CONTINGENCY');

  return (
    <div className="page print-area" style={{ maxWidth: 900, margin: '0 auto' }}>
      <div className="no-print" style={{ marginBottom: '1rem', display: 'flex', gap: '0.5rem' }}>
        <Link to="/notas-fiscais?tab=NF_E">← Notas</Link>
        <button type="button" className="btn btn-primary" onClick={() => window.print()}>
          Imprimir / PDF
        </button>
        {pending && (
          <span style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>
            Aguardando autorização SEFAZ ({doc?.status})…
          </span>
        )}
      </div>

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

          <section style={{ fontSize: '0.9rem', marginBottom: '0.75rem' }}>
            <strong>Destinatário</strong>
            <div>
              {doc.sale.customer?.name ?? '—'}
              {doc.sale.customer?.document
                ? ` · ${formatCpfCnpj(doc.sale.customer.document)}`
                : ''}
            </div>
          </section>

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
              <strong>Total: {formatBRL(doc.sale.total)}</strong>
            </div>
          </footer>

          <p style={{ marginTop: '1.25rem', fontSize: '0.72rem', color: '#444' }}>
            Documento auxiliar de NF-e (DANFE). A validade jurídica é do XML autorizado junto à SEFAZ.
            Use Imprimir do navegador para gerar PDF.
          </p>
        </article>
      )}
    </div>
  );
}
