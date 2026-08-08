import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { CrudToolbar } from '../../components/CrudToolbar';
import { FormModalBackdrop } from '../../components/FormModalBackdrop';
import { ModuleReportsModal } from '../../components/ModuleReportsModal';
import { ProductSearchModal, type ProductSearchRow } from '../../components/ProductSearchModal';
import { api } from '../../lib/api';

const MOTIVES = ['Avaria', 'Perda / quebra', 'Consumo interno', 'Amostra / brinde', 'Vencido', 'Outro'];

type MovementRow = {
  id: string;
  createdAt: string;
  quantity: string;
  reference: string | null;
  outboundReason: string | null;
  variant: { sku: string; product: { name: string } };
  location: { code: string; name: string };
};

export function StockSaidasPage() {
  const qc = useQueryClient();
  const [includeOpen, setIncludeOpen] = useState(false);
  const [reportsOpen, setReportsOpen] = useState(false);
  const [productSearchOpen, setProductSearchOpen] = useState(false);
  const [variantId, setVariantId] = useState('');
  const [productLabel, setProductLabel] = useState('');
  const [locationId, setLocationId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [reason, setReason] = useState(MOTIVES[0]);
  const [reference, setReference] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const exits = useQuery({
    queryKey: ['stock-movements', 'MANUAL_OUT'],
    queryFn: () => api<MovementRow[]>('/stock-movements?take=100&source=MANUAL_OUT'),
  });

  const locations = useQuery({
    queryKey: ['stock-locations'],
    queryFn: () => api<Array<{ id: string; code: string; name: string }>>('/stock-locations'),
  });

  const recentExits = useMemo(() => (exits.data ?? []).slice(0, 50), [exits.data]);

  function resetSaidaForm() {
    setVariantId('');
    setProductLabel('');
    setLocationId('');
    setQuantity('1');
    setReason(MOTIVES[0]);
    setReference('');
    setErr(null);
  }

  function pickProduct(row: ProductSearchRow) {
    setVariantId(row.variantId);
    setProductLabel(`${row.sku} — ${row.productName}`);
    setProductSearchOpen(false);
  }

  const exitMut = useMutation({
    mutationFn: () =>
      api('/stock-exits', {
        method: 'POST',
        json: {
          variantId,
          locationId,
          quantity: parseFloat(quantity.replace(',', '.')) || 0,
          reason,
          reference: reference || null,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stock-movements'] });
      qc.invalidateQueries({ queryKey: ['reports', 'stock-position'] });
      setErr(null);
      setIncludeOpen(false);
      resetSaidaForm();
      alert('Saída registrada.');
    },
    onError: (e: Error) => setErr(e.message),
  });

  return (
    <div>
      <CrudToolbar
        onInclude={() => {
          resetSaidaForm();
          setIncludeOpen(true);
        }}
        onPrint={() => window.print()}
        onReports={() => setReportsOpen(true)}
      />

      <ModuleReportsModal
        open={reportsOpen}
        title="Saídas de estoque"
        onClose={() => setReportsOpen(false)}
      >
        <ul style={{ margin: 0, paddingLeft: '1.2rem' }}>
          <li>Resumo de saídas por motivo</li>
          <li>Saídas × centro de custo (futuro)</li>
        </ul>
      </ModuleReportsModal>

      <div className="card">
        <h2 className="page-title" style={{ fontSize: '1.05rem', marginBottom: '0.75rem' }}>
          Últimas saídas (não venda)
        </h2>
        <p className="page-desc" style={{ marginBottom: '1rem' }}>
          Baixas por avaria, perda, consumo interno etc. (<code>MANUAL_OUT</code>). Use <strong>Incluir</strong> para
          nova saída.
        </p>
        {exits.isError && <div className="alert alert-error">{(exits.error as Error).message}</div>}
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Data</th>
                <th>Produto</th>
                <th>Local</th>
                <th>Qtd</th>
                <th>Motivo</th>
                <th>Referência</th>
              </tr>
            </thead>
            <tbody>
              {exits.isLoading && (
                <tr>
                  <td colSpan={6} className="empty">
                    Carregando…
                  </td>
                </tr>
              )}
              {!exits.isLoading && !recentExits.length && (
                <tr>
                  <td colSpan={6} className="empty">
                    Nenhuma saída manual. Clique em Incluir para lançar.
                  </td>
                </tr>
              )}
              {recentExits.map((m) => (
                <tr key={m.id}>
                  <td style={{ whiteSpace: 'nowrap', fontSize: '0.85rem' }}>
                    {new Date(m.createdAt).toLocaleString('pt-BR')}
                  </td>
                  <td>
                    <strong>{m.variant.product.name}</strong>
                    <div style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>{m.variant.sku}</div>
                  </td>
                  <td>
                    {m.location.code} — {m.location.name}
                  </td>
                  <td>{m.quantity}</td>
                  <td>{m.outboundReason ?? '—'}</td>
                  <td style={{ fontSize: '0.85rem' }}>{m.reference ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {includeOpen && (
        <FormModalBackdrop
          className="no-print"
          onClose={() => {
            setIncludeOpen(false);
            setErr(null);
          }}
        >
          <div className="modal" role="dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
            <h2>Nova saída de estoque</h2>
            <p className="page-desc" style={{ marginBottom: '1rem' }}>
              Utilize para baixar estoque sem vinculação a venda. A origem será <code>MANUAL_OUT</code>.
            </p>
            {err && <div className="alert alert-error">{err}</div>}
            <div className="field">
              <label>Produto *</label>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <input
                  readOnly
                  value={productLabel}
                  placeholder="Nenhum produto selecionado"
                  style={{ flex: '1 1 12rem', minWidth: 0 }}
                />
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setProductSearchOpen(true)}
                >
                  Pesquisar
                </button>
              </div>
            </div>
            <div className="field">
              <label>Local *</label>
              <select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                <option value="">— Selecione —</option>
                {locations.data?.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.code} — {l.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-row">
              <div className="field">
                <label>Quantidade *</label>
                <input value={quantity} onChange={(e) => setQuantity(e.target.value)} />
              </div>
              <div className="field">
                <label>Motivo *</label>
                <select value={reason} onChange={(e) => setReason(e.target.value)}>
                  {MOTIVES.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="field">
              <label>Referência / observação</label>
              <input value={reference} onChange={(e) => setReference(e.target.value)} />
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setIncludeOpen(false);
                  setErr(null);
                }}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!variantId || !locationId || !quantity || exitMut.isPending}
                onClick={() => exitMut.mutate()}
              >
                Registrar saída
              </button>
            </div>
          </div>
        </FormModalBackdrop>
      )}

      <ProductSearchModal
        open={productSearchOpen}
        title="Pesquisar produto para saída"
        onClose={() => setProductSearchOpen(false)}
        onPick={pickProduct}
      />
    </div>
  );
}
