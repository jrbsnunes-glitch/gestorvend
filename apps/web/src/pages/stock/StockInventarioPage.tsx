import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { CrudToolbar } from '../../components/CrudToolbar';
import { ModuleReportsModal } from '../../components/ModuleReportsModal';
import { api } from '../../lib/api';

type Location = { id: string; code: string; name: string };

type StockPositionRow = {
  quantity: string;
  variantId: string;
  locationId: string;
  variant: { sku: string; minStock?: number; product: { name: string } };
  location: { code: string; name: string };
  minStock?: number;
  stockOnHandTotal?: number;
  belowMinStock?: boolean;
  aboveMaxStock?: boolean;
};

type StockPositionPayload = {
  rows: StockPositionRow[];
};

type AdjustRow = {
  id: string;
  type: string;
  createdAt: string;
  quantity: string;
  reference: string | null;
  outboundReason: string | null;
  variant: { sku: string; product: { name: string } };
  location: { code: string; name: string };
};

export function StockInventarioPage() {
  const qc = useQueryClient();
  const [reportsOpen, setReportsOpen] = useState(false);
  const [locationId, setLocationId] = useState('');
  const [variantId, setVariantId] = useState('');
  const [countedQty, setCountedQty] = useState('');
  const [notes, setNotes] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const locations = useQuery({
    queryKey: ['stock-locations'],
    queryFn: () => api<Location[]>('/stock-locations'),
  });

  const variantOptions = useQuery({
    queryKey: ['products-for-select'],
    queryFn: async () => {
      const products = await api<Array<{ name: string; variants: Array<{ id: string; sku: string }> }>>('/products');
      return products.flatMap((p) => p.variants.map((v) => ({ id: v.id, label: `${v.sku} — ${p.name}` })));
    },
  });

  const stockPosition = useQuery({
    queryKey: ['reports', 'stock-position', 'inventory'],
    queryFn: () => api<StockPositionPayload>('/reports/stock-position'),
  });

  const recentAdjust = useQuery({
    queryKey: ['stock-movements', 'ADJUSTMENT', 'recent'],
    queryFn: () =>
      api<AdjustRow[]>('/stock-movements?take=80&source=ADJUSTMENT&order=desc'),
  });

  const systemQty = useMemo(() => {
    if (!locationId || !variantId || !stockPosition.data) return null;
    const rows = stockPosition.data.rows ?? [];
    const row = rows.find((b) => b.variantId === variantId && b.locationId === locationId);
    if (!row) return 0;
    return Number(row.quantity);
  }, [locationId, variantId, stockPosition.data]);

  const countedNum =
    countedQty.trim() === '' ? NaN : parseFloat(countedQty.replace(',', '.'));

  function resetForm() {
    setLocationId('');
    setVariantId('');
    setCountedQty('');
    setNotes('');
    setErr(null);
  }

  const adjustMut = useMutation({
    mutationFn: () =>
      api('/stock-movements', {
        method: 'POST',
        json: {
          type: 'ADJUST',
          variantId,
          locationId,
          quantity: countedNum,
          unitCost: null,
          reference: notes.trim() || null,
          outboundReason: null,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stock-movements'] });
      qc.invalidateQueries({ queryKey: ['reports', 'stock-position'] });
      qc.invalidateQueries({ queryKey: ['stock-movements', 'ADJUSTMENT', 'recent'] });
      qc.invalidateQueries({ queryKey: ['stock-movements', 'painel-overview'] });
      resetForm();
      alert('Acerto de estoque registrado.');
    },
    onError: (e: Error) => setErr(e.message),
  });

  let deltaHint: string | null = null;
  if (
    locationId &&
    variantId &&
    countedQty.trim() !== '' &&
    systemQty !== null &&
    !Number.isNaN(countedNum)
  ) {
    const delta = countedNum - systemQty;
    if (delta === 0) deltaHint = 'Sem diferença em relação ao sistema.';
    else if (delta > 0) deltaHint = `Acréscimo de ${delta} unidade(s) em relação ao saldo atual.`;
    else deltaHint = `Redução de ${Math.abs(delta)} unidade(s) em relação ao saldo atual.`;
  }

  return (
    <div>
      <CrudToolbar onPrint={() => window.print()} onReports={() => setReportsOpen(true)} />

      <ModuleReportsModal open={reportsOpen} title="Inventário / acertos" onClose={() => setReportsOpen(false)}>
        <ul style={{ margin: 0, paddingLeft: '1.2rem' }}>
          <li>Listagem consolidada por local — exportação (em evolução)</li>
          <li>Use <strong>Movimentos → impressão</strong> para filtro por período ou tipo AJUSTE</li>
        </ul>
      </ModuleReportsModal>

      <div className="card no-print" style={{ marginBottom: '1.25rem' }}>
        <h2 className="page-title" style={{ fontSize: '1.05rem', marginBottom: '0.35rem' }}>
          Inventário
        </h2>
        <p className="page-desc" style={{ margin: '0 0 1rem', fontSize: '0.9rem' }}>
          <strong>Acerto de estoque:</strong> informe a quantidade física encontrada para o item no local. O sistema
          igualará o saldo a esse valor (lançamento de ajuste).
        </p>
        {err && <div className="alert alert-error">{err}</div>}
        <div className="field">
          <label htmlFor="inv-loc">Local de estoque</label>
          <select
            id="inv-loc"
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
            required
          >
            <option value="">Selecione…</option>
            {(locations.data ?? []).map((l) => (
              <option key={l.id} value={l.id}>
                {l.code} — {l.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="inv-variant">Produto / variação</label>
          <select id="inv-variant" value={variantId} onChange={(e) => setVariantId(e.target.value)} required>
            <option value="">Selecione…</option>
            {(variantOptions.data ?? []).map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        {locationId && variantId && systemQty !== null && (
          <p className="page-desc" style={{ marginBottom: '0.75rem', fontWeight: 500 }}>
            Saldo atual no sistema neste local: <strong>{systemQty}</strong>
          </p>
        )}
        <div className="field">
          <label htmlFor="inv-qty">Quantidade física (contagem)</label>
          <input
            id="inv-qty"
            value={countedQty}
            onChange={(e) => setCountedQty(e.target.value)}
            inputMode="decimal"
            placeholder="Ex.: contagem realizada na gôndola / depósito"
            required
          />
          {deltaHint && (
            <p className="page-desc" id="inv-delta-hint" style={{ marginTop: '0.35rem', marginBottom: 0, fontSize: '0.88rem' }}>
              {deltaHint}
            </p>
          )}
        </div>
        <div className="field">
          <label htmlFor="inv-notes">Observação / referência (opcional)</label>
          <input
            id="inv-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Ex.: inventário rotativo abril/2026"
          />
        </div>
        <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-primary"
            disabled={adjustMut.isPending || !locationId || !variantId || countedQty.trim() === '' || Number.isNaN(countedNum)}
            onClick={() => adjustMut.mutate()}
          >
            {adjustMut.isPending ? 'Salvando…' : 'Aplicar acerto'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={resetForm}>
            Limpar
          </button>
        </div>
      </div>

      <div className="card">
        <h2 className="page-title" style={{ fontSize: '1.05rem', marginBottom: '0.75rem' }}>
          Últimos acertos registrados
        </h2>
        <p className="page-desc" style={{ marginBottom: '1rem' }}>
          Movimentações com origem <code>ADJUSTMENT</code> (ajuste manual de saldo por inventário).
        </p>
        {recentAdjust.isError && (
          <div className="alert alert-error">{(recentAdjust.error as Error).message}</div>
        )}
        {recentAdjust.isLoading ? (
          <p className="page-desc">Carregando…</p>
        ) : !(recentAdjust.data ?? []).length ? (
          <p className="page-desc">Nenhum acerto registrado recentemente.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="num" style={{ width: '3rem' }}>
                    Cont.
                  </th>
                  <th>Data</th>
                  <th>Local</th>
                  <th>Produto</th>
                  <th>Qtd nova *</th>
                  <th>Referência</th>
                </tr>
              </thead>
              <tbody>
                {(recentAdjust.data ?? []).map((m, idx) => (
                  <tr key={m.id}>
                    <td className="num">{idx + 1}</td>
                    <td style={{ whiteSpace: 'nowrap', fontSize: '0.85rem' }}>
                      {new Date(m.createdAt).toLocaleString('pt-BR')}
                    </td>
                    <td>
                      {m.location.code} — {m.location.name}
                    </td>
                    <td>
                      <strong>{m.variant.product.name}</strong>
                      <div style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>{m.variant.sku}</div>
                    </td>
                    <td>{m.quantity}</td>
                    <td style={{ fontSize: '0.85rem' }}>{m.reference ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="page-desc" style={{ marginTop: '0.75rem', marginBottom: 0, fontSize: '0.82rem' }}>
              * No lançamento de ajuste, a coluna mostra o saldo configurado pela contagem física no momento do
              acerto.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
