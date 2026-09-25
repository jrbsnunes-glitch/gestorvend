import { useMutation, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { formatBRL } from '../lib/format';
import { applyMessageTemplate } from '../lib/message-template';

type CatalogResponse = {
  company: { tradeName: string; phone: string | null; city: string | null; state: string | null };
  catalogSettings?: { whatsappMessageTemplate: string | null };
  products: Array<{
    id: string;
    name: string;
    description: string | null;
    controlNumber: number;
    leadTimeDays: number | null;
    hasImage: boolean;
    imageVersion: number;
    variant: { id: string; sku: string; retailPrice: string } | null;
  }>;
};

function whatsAppLink(phone: string | null | undefined, text: string): string | null {
  const digits = (phone ?? '').replace(/\D/g, '');
  if (digits.length < 10) return null;
  const n = digits.startsWith('55') ? digits : `55${digits}`;
  return `https://wa.me/${n}?text=${encodeURIComponent(text)}`;
}

export function PublicStorePage() {
  const { tenantSlug = '' } = useParams<{ tenantSlug: string }>();
  const [searchParams] = useSearchParams();
  const utm = searchParams.get('utm') ?? 'catalog';
  const [leadProduct, setLeadProduct] = useState<CatalogResponse['products'][0] | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [qty, setQty] = useState('1');
  const [notes, setNotes] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const catalog = useQuery({
    queryKey: ['public-store', tenantSlug],
    queryFn: async () => {
      const res = await fetch(
        `/api/manufacturing/public/catalog?tenantSlug=${encodeURIComponent(tenantSlug)}`,
      );
      if (!res.ok) throw new Error(await res.text());
      return res.json() as Promise<CatalogResponse>;
    },
    enabled: tenantSlug.length > 0,
  });

  const leadMut = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/manufacturing/public/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantSlug,
          customerName: name.trim(),
          phone: phone.trim() || null,
          email: email.trim() || null,
          finishedVariantId: leadProduct!.variant!.id,
          quantity: qty,
          notes: notes.trim() || null,
          source: utm === 'instagram' ? 'INSTAGRAM' : 'CATALOG',
          externalRef: `${utm}-${Date.now()}`,
        }),
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || 'Falha ao enviar');
      }
      return res.json();
    },
    onSuccess: (data: { number?: number }) => {
      setDone(`Solicitação registrada${data?.number ? ` (#${data.number})` : ''}. Entraremos em contato.`);
      setErr(null);
      setLeadProduct(null);
    },
    onError: (e: Error) => setErr(e.message),
  });

  const data = catalog.data;
  const waBase = useMemo(() => data?.company.phone, [data?.company.phone]);

  if (!tenantSlug) {
    return <p>Loja inválida.</p>;
  }

  return (
    <div className="page" style={{ maxWidth: 960, margin: '0 auto', padding: '1.5rem' }}>
      <header style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ margin: 0 }}>{data?.company.tradeName ?? 'Catálogo'}</h1>
        <p style={{ color: 'var(--color-text-muted)' }}>
          Produtos sob encomenda · {data?.company.city}
          {data?.company.state ? `/${data.company.state}` : ''}
        </p>
      </header>

      {catalog.isLoading && <p>Carregando catálogo…</p>}
      {catalog.isError && (
        <div className="alert alert-error">{(catalog.error as Error).message}</div>
      )}

      {done && <div className="alert alert-success">{done}</div>}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))',
          gap: '1rem',
        }}
      >
        {(data?.products ?? []).map((p) => {
          const msg = applyMessageTemplate(data?.catalogSettings?.whatsappMessageTemplate, {
            codigo: p.controlNumber,
            nome: p.name,
          });
          const wa = whatsAppLink(waBase, msg);
          return (
            <article key={p.id} className="card" style={{ padding: '0.85rem' }}>
              {p.hasImage && (
                <img
                  src={`/api/catalog/${encodeURIComponent(tenantSlug)}/products/${encodeURIComponent(p.id)}/image?size=thumb&v=${p.imageVersion}`}
                  alt=""
                  style={{ width: '100%', height: 140, objectFit: 'cover', borderRadius: 8 }}
                />
              )}
              <h2 style={{ fontSize: '1rem', margin: '0.5rem 0 0.25rem' }}>{p.name}</h2>
              <p style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', margin: 0 }}>
                Cód. {p.controlNumber}
                {p.leadTimeDays ? ` · prazo ~${p.leadTimeDays} dias` : ''}
              </p>
              {p.description?.trim() ? (
                <p
                  style={{
                    fontSize: '0.8rem',
                    margin: '0.35rem 0 0',
                    color: 'var(--color-text-muted)',
                    lineHeight: 1.35,
                  }}
                >
                  {p.description.trim()}
                </p>
              ) : null}
              {p.variant && (
                <p style={{ fontWeight: 600, margin: '0.35rem 0' }}>
                  {Number(p.variant.retailPrice) > 0
                    ? formatBRL(p.variant.retailPrice)
                    : 'Sob consulta'}
                </p>
              )}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginTop: '0.5rem' }}>
                <button
                  type="button"
                  className="btn btn-primary btn-compact"
                  disabled={!p.variant}
                  onClick={() => {
                    setLeadProduct(p);
                    setDone(null);
                    setErr(null);
                  }}
                >
                  Solicitar orçamento
                </button>
                {wa && (
                  <a className="btn btn-secondary btn-compact" href={wa} target="_blank" rel="noreferrer">
                    WhatsApp
                  </a>
                )}
              </div>
            </article>
          );
        })}
      </div>

      {leadProduct && (
        <div className="modal-backdrop" role="presentation" onClick={() => setLeadProduct(null)}>
          <div className="modal" role="dialog" onClick={(e) => e.stopPropagation()}>
            <h2>Orçamento — {leadProduct.name}</h2>
            {err && <div className="alert alert-error">{err}</div>}
            <div className="field">
              <label>Nome</label>
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="field">
              <label>Telefone / WhatsApp</label>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="field">
              <label>E-mail</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="field">
              <label>Quantidade</label>
              <input value={qty} onChange={(e) => setQty(e.target.value)} />
            </div>
            <div className="field">
              <label>Observações</label>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setLeadProduct(null)}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={name.trim().length < 2 || leadMut.isPending}
                onClick={() => leadMut.mutate()}
              >
                Enviar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
