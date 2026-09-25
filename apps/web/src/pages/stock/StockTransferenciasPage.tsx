import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useMemo, useState } from 'react';
import { CrudToolbar } from '../../components/CrudToolbar';
import { ModuleReportsModal } from '../../components/ModuleReportsModal';
import { ProductSearchModal, type ProductSearchRow } from '../../components/ProductSearchModal';
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

type TransferLineDraft = {
  variantId: string;
  label: string;
  quantity: string;
};

function transferRefKey(reference: string | null): string | null {
  const ref = (reference ?? '').trim();
  if (!ref.startsWith('TRF:')) return null;
  const pipe = ref.indexOf(' | ');
  return pipe >= 0 ? ref.slice(0, pipe).trim() : ref;
}

function variantKey(v: MovementRow['variant']) {
  return `${v.sku}\0${v.product.name}`;
}

function parseQty(raw: string): number {
  const n = parseFloat(raw.replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

/** Uma linha por produto; vários produtos podem compartilhar o mesmo TRF. */
function parseTransferGroups(rows: MovementRow[]) {
  const map = new Map<string, MovementRow[]>();
  for (const m of rows) {
    const refKey = transferRefKey(m.reference);
    if (!refKey) continue;
    if (!map.has(refKey)) map.set(refKey, []);
    map.get(refKey)!.push(m);
  }
  const out: Array<{
    key: string;
    rowKey: string;
    createdAt: string;
    quantity: string;
    variant: MovementRow['variant'];
    from: { code: string; name: string };
    to: { code: string; name: string };
  }> = [];
  for (const [refKey, ms] of map) {
    const outs = ms.filter((x) => x.type === 'OUT');
    const ins = ms.filter((x) => x.type === 'IN');
    const createdAt = ms.reduce(
      (best, m) => (new Date(m.createdAt) > new Date(best) ? m.createdAt : best),
      ms[0]!.createdAt,
    );
    const from = outs[0]?.location ?? ins[0]?.location ?? { code: '—', name: '—' };
    const to =
      ins.find((i) => i.location.code !== from.code)?.location ??
      ins[0]?.location ??
      { code: '—', name: '—' };

    const usedIn = new Set<string>();
    for (const outM of outs) {
      const vk = variantKey(outM.variant);
      const inM =
        ins.find((i) => !usedIn.has(i.id) && variantKey(i.variant) === vk) ??
        ins.find((i) => !usedIn.has(i.id) && i.quantity === outM.quantity);
      if (inM) usedIn.add(inM.id);
      out.push({
        key: refKey,
        rowKey: `${refKey}:${vk}`,
        createdAt,
        quantity: outM.quantity,
        variant: outM.variant,
        from,
        to,
      });
    }
    for (const inM of ins.filter((i) => !usedIn.has(i.id))) {
      out.push({
        key: refKey,
        rowKey: `${refKey}:${inM.id}`,
        createdAt,
        quantity: inM.quantity,
        variant: inM.variant,
        from,
        to,
      });
    }
  }
  return out.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function StockTransferenciasPage() {
  const qc = useQueryClient();
  const [reportsOpen, setReportsOpen] = useState(false);
  const [fromLocationId, setFromLocationId] = useState('');
  const [toLocationId, setToLocationId] = useState('');
  const [lines, setLines] = useState<TransferLineDraft[]>([]);
  const [productSearchOpen, setProductSearchOpen] = useState(false);
  const [notes, setNotes] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const locations = useQuery({
    queryKey: ['stock-locations'],
    queryFn: () => api<Location[]>('/stock-locations'),
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
    setLines([]);
    setNotes('');
    setErr(null);
  }

  const transferMut = useMutation({
    mutationFn: () =>
      api('/stock-transfers', {
        method: 'POST',
        json: {
          fromLocationId,
          toLocationId,
          lines: lines.map((l) => ({
            variantId: l.variantId,
            quantity: parseQty(l.quantity),
          })),
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

  function pickProduct(row: ProductSearchRow) {
    setLines((prev) => {
      const idx = prev.findIndex((l) => l.variantId === row.variantId);
      if (idx >= 0) {
        return prev.map((l, i) =>
          i === idx ? { ...l, quantity: String(parseQty(l.quantity) + 1) } : l,
        );
      }
      return [
        ...prev,
        { variantId: row.variantId, label: `${row.sku} — ${row.productName}`, quantity: '1' },
      ];
    });
    setProductSearchOpen(false);
    setErr(null);
  }

  function setLineQty(variantId: string, quantity: string) {
    setLines((prev) => prev.map((l) => (l.variantId === variantId ? { ...l, quantity } : l)));
  }

  function removeLine(variantId: string) {
    setLines((prev) => prev.filter((l) => l.variantId !== variantId));
  }

  const linesValid =
    lines.length > 0 && lines.every((l) => parseQty(l.quantity) > 0);

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
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '0.5rem',
              flexWrap: 'wrap',
              margin: '0.75rem 0 0.5rem',
            }}
          >
            <strong style={{ fontSize: '0.95rem' }}>Produtos ({lines.length})</strong>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setProductSearchOpen(true)}
            >
              + Pesquisar produto
            </button>
          </div>
          <div className="table-wrap" style={{ maxHeight: '16rem', overflow: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Produto</th>
                  <th style={{ width: '8rem' }}>Quantidade</th>
                  <th style={{ width: '5rem' }} />
                </tr>
              </thead>
              <tbody>
                {lines.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="empty">
                      Nenhum produto. Use &quot;Pesquisar produto&quot; para incluir um ou mais itens.
                    </td>
                  </tr>
                ) : null}
                {lines.map((l) => (
                  <tr key={l.variantId}>
                    <td>{l.label}</td>
                    <td>
                      <input
                        value={l.quantity}
                        inputMode="decimal"
                        onChange={(e) => setLineQty(l.variantId, e.target.value)}
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-danger btn-compact"
                        onClick={() => removeLine(l.variantId)}
                      >
                        Remover
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="field" style={{ marginTop: '0.75rem' }}>
            <label htmlFor="tr-notes">Observação (opcional)</label>
            <input
              id="tr-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ex.: remessa para ponto de venda"
            />
          </div>
          <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={
                transferMut.isPending ||
                !fromLocationId ||
                !toLocationId ||
                !linesValid ||
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
                  <tr key={g.rowKey}>
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

      <ProductSearchModal
        open={productSearchOpen}
        title="Pesquisar produto para transferência"
        onClose={() => setProductSearchOpen(false)}
        onPick={pickProduct}
      />
    </div>
  );
}
