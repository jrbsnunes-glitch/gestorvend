import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useMemo, useState } from 'react';
import { CrudToolbar } from '../../components/CrudToolbar';
import { ModuleReportsModal } from '../../components/ModuleReportsModal';
import { api } from '../../lib/api';

type Location = { id: string; code: string; name: string };

type MovementRow = {
  id: string;
  type: string;
  source: string;
  createdAt: string;
  quantity: string;
  reference: string | null;
  variant: { sku: string; product: { name: string } };
  location: { code: string; name: string };
};

type CreateTransferRes = {
  transferRef: string;
  outMovement: { id: string };
  inMovement: { id: string };
};

function parseTransferGroups(rows: MovementRow[]) {
  const map = new Map<string, MovementRow[]>();
  for (const m of rows) {
    const ref = (m.reference ?? '').trim();
    if (!ref.startsWith('TRF:')) continue;
    if (!map.has(ref)) map.set(ref, []);
    map.get(ref)!.push(m);
  }
  const out: Array<{
    key: string;
    createdAt: string;
    quantity: string;
    variant: MovementRow['variant'];
    from: { code: string; name: string };
    to: { code: string; name: string };
    outM?: MovementRow;
    inM?: MovementRow;
  }> = [];
  for (const [refKey, ms] of map) {
    const outM = ms.find((x) => x.type === 'OUT');
    const inM = ms.find((x) => x.type === 'IN');
    const createdAt = ms.reduce(
      (best, m) => (new Date(m.createdAt) > new Date(best) ? m.createdAt : best),
      ms[0]!.createdAt,
    );
    const qty = outM?.quantity ?? inM?.quantity ?? '0';
    const variant = outM?.variant ?? inM?.variant ?? ms[0]!.variant;
    out.push({
      key: refKey,
      createdAt,
      quantity: qty,
      variant,
      from: outM?.location ?? { code: '—', name: '—' },
      to: inM?.location ?? { code: '—', name: '—' },
      outM,
      inM,
    });
  }
  return out.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function StockTransferenciasPage() {
  const qc = useQueryClient();
  const [reportsOpen, setReportsOpen] = useState(false);
  const [fromLocationId, setFromLocationId] = useState('');
  const [toLocationId, setToLocationId] = useState('');
  const [variantId, setVariantId] = useState('');
  const [quantity, setQuantity] = useState('1');
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

  const transferRows = useQuery({
    queryKey: ['stock-movements', 'TRANSFER', 'recent'],
    queryFn: () =>
      api<MovementRow[]>('/stock-movements?take=120&source=TRANSFER&order=desc'),
  });

  const grouped = useMemo(() => parseTransferGroups(transferRows.data ?? []), [transferRows.data]);

  const hasMultipleLocations = (locations.data?.length ?? 0) >= 2;

  function resetForm() {
    setFromLocationId('');
    setToLocationId('');
    setVariantId('');
    setQuantity('1');
    setNotes('');
    setErr(null);
  }

  const transferMut = useMutation({
    mutationFn: () =>
      api<CreateTransferRes>('/stock-transfers', {
        method: 'POST',
        json: {
          fromLocationId,
          toLocationId,
          variantId,
          quantity: parseFloat(quantity.replace(',', '.')) || 0,
          notes: notes.trim() || null,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stock-movements'] });
      qc.invalidateQueries({ queryKey: ['reports', 'stock-position'] });
      qc.invalidateQueries({ queryKey: ['stock-movements', 'TRANSFER', 'recent'] });
      qc.invalidateQueries({ queryKey: ['stock-movements', 'painel-overview'] });
      resetForm();
      alert('Transferência registrada.');
    },
    onError: (e: Error) => setErr(e.message),
  });

  return (
    <div>
      <CrudToolbar onPrint={() => window.print()} onReports={() => setReportsOpen(true)} />

      <ModuleReportsModal
        open={reportsOpen}
        title="Transferências entre locais"
        onClose={() => setReportsOpen(false)}
      >
        <ul style={{ margin: 0, paddingLeft: '1.2rem' }}>
          <li>Resumo por período / local (a implementar)</li>
          <li>Use <strong>Movimentos → impressão</strong> para extrato detalhado com filtro.</li>
        </ul>
      </ModuleReportsModal>

      {!hasMultipleLocations && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <h2 className="page-title" style={{ fontSize: '1.05rem' }}>
            É preciso ter mais de um local de estoque
          </h2>
          <p className="page-desc">
            Cadastre pelo menos dois locais em{' '}
            <Link to="/estoque/locais">Locais</Link> para poder transferir mercadoria entre depósitos ou filiais.
          </p>
        </div>
      )}

      {hasMultipleLocations && (
        <div className="card no-print" style={{ marginBottom: '1.25rem' }}>
          <h2 className="page-title" style={{ fontSize: '1.05rem', marginBottom: '0.5rem' }}>
            Nova transferência
          </h2>
          <p className="page-desc" style={{ marginBottom: '1rem' }}>
            Retira quantidade do <strong>local de origem</strong> e credita no <strong>destino</strong>. O custo médio
            global do produto não é alterado — apenas o saldo por local.
          </p>
          {err && <div className="alert alert-error">{err}</div>}
          <div className="field">
            <label htmlFor="tr-from">Local de origem</label>
            <select
              id="tr-from"
              value={fromLocationId}
              onChange={(e) => setFromLocationId(e.target.value)}
              required
            >
              <option value="">Selecione…</option>
              {(locations.data ?? []).map((l) => (
                <option key={l.id} value={l.id} disabled={l.id === toLocationId}>
                  {l.code} — {l.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="tr-to">Local de destino</label>
            <select
              id="tr-to"
              value={toLocationId}
              onChange={(e) => setToLocationId(e.target.value)}
              required
            >
              <option value="">Selecione…</option>
              {(locations.data ?? []).map((l) => (
                <option key={l.id} value={l.id} disabled={l.id === fromLocationId}>
                  {l.code} — {l.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="tr-variant">Produto / variação</label>
            <select
              id="tr-variant"
              value={variantId}
              onChange={(e) => setVariantId(e.target.value)}
              required
            >
              <option value="">Selecione…</option>
              {(variantOptions.data ?? []).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <div className="field">
              <label htmlFor="tr-qty">Quantidade</label>
              <input
                id="tr-qty"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                inputMode="decimal"
                required
              />
            </div>
            <div className="field">
              <label htmlFor="tr-notes">Observação (opcional)</label>
              <input
                id="tr-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Ex.: remessa para ponto de venda"
              />
            </div>
          </div>
          <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={
                transferMut.isPending ||
                !fromLocationId ||
                !toLocationId ||
                !variantId ||
                fromLocationId === toLocationId
              }
              onClick={() => transferMut.mutate()}
            >
              {transferMut.isPending ? 'Salvando…' : 'Registrar transferência'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={resetForm}>
              Limpar
            </button>
          </div>
        </div>
      )}

      <div className="card">
        <h2 className="page-title" style={{ fontSize: '1.05rem', marginBottom: '0.75rem' }}>
          Transferências recentes
        </h2>
        <p className="page-desc" style={{ marginBottom: '1rem' }}>
          Cada operação gera uma <strong>saída</strong> no origem e uma <strong>entrada</strong> no destino (mesma
          referência interna).
        </p>
        {transferRows.isError && (
          <div className="alert alert-error">{(transferRows.error as Error).message}</div>
        )}
        {transferRows.isLoading ? (
          <p className="page-desc">Carregando…</p>
        ) : grouped.length === 0 ? (
          <p className="page-desc">Nenhuma transferência registrada ainda.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="num" style={{ width: '3rem' }}>
                    Cont.
                  </th>
                  <th>Data</th>
                  <th>Origem</th>
                  <th>Destino</th>
                  <th>Produto</th>
                  <th>Qtd</th>
                </tr>
              </thead>
              <tbody>
                {grouped.map((g, idx) => (
                  <tr key={g.key}>
                    <td className="num">{idx + 1}</td>
                    <td>{new Date(g.createdAt).toLocaleString()}</td>
                    <td>
                      {g.from.code} — {g.from.name}
                    </td>
                    <td>
                      {g.to.code} — {g.to.name}
                    </td>
                    <td>
                      {g.variant.sku} — {g.variant.product.name}
                    </td>
                    <td>{g.quantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
