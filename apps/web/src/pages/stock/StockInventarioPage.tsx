/**
 * Inventário físico: documento com 1 a N produtos no mesmo local.
 * Rascunho → incluir produtos → informar contagens → postar (gera ADJUST).
 * Também: import/export CSV e coletor mobile (/estoque/inventario/:id/coletar).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CrudToolbar } from '../../components/CrudToolbar';
import { FormModalBackdrop } from '../../components/FormModalBackdrop';
import { ModuleReportsModal } from '../../components/ModuleReportsModal';
import { InventoryReportsPanel } from '../../components/InventoryReportsPanel';
import { ProductSearchModal, type ProductSearchRow } from '../../components/ProductSearchModal';
import { RecordViewModal } from '../../components/RecordViewModal';
import { api, apiDownload, apiUpload } from '../../lib/api';
import { formatDate } from '../../lib/format';

type Location = { id: string; code: string; name: string };

type InventoryListRow = {
  id: string;
  controlNumber: number;
  status: 'DRAFT' | 'POSTED' | 'CANCELLED';
  notes: string | null;
  postedAt: string | null;
  createdAt: string;
  location: Location;
  user: { id: string; name: string } | null;
  _count: { items: number };
};

type InventoryItem = {
  id: string;
  systemQty: string;
  countedQty: string | null;
  notes: string | null;
  variant: {
    id: string;
    sku: string;
    barcode: string | null;
    product: { id: string; name: string; controlNumber?: number };
  };
};

type InventoryDetail = {
  id: string;
  controlNumber: number;
  status: 'DRAFT' | 'POSTED' | 'CANCELLED';
  notes: string | null;
  postedAt: string | null;
  createdAt: string;
  location: Location;
  user: { id: string; name: string } | null;
  items: InventoryItem[];
};

type CsvImportResult = {
  inventory: InventoryDetail;
  summary: {
    created: number;
    updated: number;
    skipped: number;
    errors: Array<{ line: number; reason: string; raw?: string }>;
  };
};

function statusLabel(s: string): string {
  if (s === 'DRAFT') return 'Rascunho';
  if (s === 'POSTED') return 'Postado';
  if (s === 'CANCELLED') return 'Cancelado';
  return s;
}

export function StockInventarioPage() {
  const qc = useQueryClient();
  const csvInputRef = useRef<HTMLInputElement>(null);
  const [reportsOpen, setReportsOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [createLoc, setCreateLoc] = useState('');
  const [createNotes, setCreateNotes] = useState('');
  const [createErr, setCreateErr] = useState<string | null>(null);

  const [editId, setEditId] = useState<string | null>(null);
  const [viewId, setViewId] = useState<string | null>(null);
  const [productSearchOpen, setProductSearchOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkScope, setBulkScope] = useState<'category' | 'all'>('category');
  const [bulkCategoryId, setBulkCategoryId] = useState('');
  const [bulkErr, setBulkErr] = useState<string | null>(null);
  const [editErr, setEditErr] = useState<string | null>(null);
  const [qtyDraft, setQtyDraft] = useState<Record<string, string>>({});
  const [importResult, setImportResult] = useState<CsvImportResult['summary'] | null>(null);
  const [csvBusy, setCsvBusy] = useState(false);

  const locations = useQuery({
    queryKey: ['stock-locations'],
    queryFn: () => api<Location[]>('/stock-locations'),
  });

  const categories = useQuery({
    queryKey: ['categories', 'inventory-bulk'],
    queryFn: () => api<Array<{ id: string; name: string }>>('/categories'),
    enabled: bulkOpen,
  });

  const listQs = statusFilter ? `?status=${statusFilter}` : '';
  const list = useQuery({
    queryKey: ['stock-inventories', statusFilter],
    queryFn: () => api<InventoryListRow[]>(`/stock-inventories${listQs}`),
  });

  const detail = useQuery({
    queryKey: ['stock-inventories', editId ?? viewId],
    queryFn: () => api<InventoryDetail>(`/stock-inventories/${editId ?? viewId}`),
    enabled: Boolean(editId || viewId),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['stock-inventories'] });
    qc.invalidateQueries({ queryKey: ['stock-movements'] });
    qc.invalidateQueries({ queryKey: ['reports', 'stock-position'] });
  };

  const createMut = useMutation({
    mutationFn: () =>
      api<InventoryDetail>('/stock-inventories', {
        method: 'POST',
        json: { locationId: createLoc, notes: createNotes.trim() || null },
      }),
    onSuccess: (row) => {
      invalidate();
      setCreateOpen(false);
      setCreateLoc('');
      setCreateNotes('');
      setCreateErr(null);
      setEditId(row.id);
      setQtyDraft({});
    },
    onError: (e: Error) => setCreateErr(e.message),
  });

  const addItemMut = useMutation({
    mutationFn: (variantId: string) =>
      api(`/stock-inventories/${editId}/items`, {
        method: 'POST',
        json: { variantId },
      }),
    onSuccess: () => {
      setEditErr(null);
      qc.invalidateQueries({ queryKey: ['stock-inventories', editId] });
    },
    onError: (e: Error) => setEditErr(e.message),
  });

  const bulkAddMut = useMutation({
    mutationFn: (body: { scope: 'all' | 'category'; categoryId?: string }) =>
      api<{
        inventory: InventoryDetail;
        summary: {
          added: number;
          skippedAlreadyInInventory: number;
          candidates: number;
        };
      }>(`/stock-inventories/${editId}/items/bulk`, {
        method: 'POST',
        json: body,
      }),
    onSuccess: (res) => {
      setBulkErr(null);
      setBulkOpen(false);
      setBulkCategoryId('');
      setBulkScope('category');
      qc.setQueryData(['stock-inventories', editId], res.inventory);
      invalidate();
      const { added, skippedAlreadyInInventory, candidates } = res.summary;
      if (added === 0) {
        alert(
          candidates === 0
            ? 'Nenhum produto elegível encontrado (ativos e unitários).'
            : `Nenhum produto novo. ${skippedAlreadyInInventory} já estavam no inventário.`,
        );
      } else {
        alert(
          `Incluídos ${added} produto(s).` +
            (skippedAlreadyInInventory > 0
              ? ` ${skippedAlreadyInInventory} já estavam no inventário e foram ignorados.`
              : ''),
        );
      }
    },
    onError: (e: Error) => setBulkErr(e.message),
  });

  const patchItemMut = useMutation({
    mutationFn: ({ itemId, countedQty }: { itemId: string; countedQty: string }) =>
      api(`/stock-inventories/${editId}/items/${itemId}`, {
        method: 'PATCH',
        json: { countedQty: countedQty.trim() === '' ? null : countedQty },
      }),
    onSuccess: () => {
      setEditErr(null);
      qc.invalidateQueries({ queryKey: ['stock-inventories', editId] });
    },
    onError: (e: Error) => setEditErr(e.message),
  });

  const removeItemMut = useMutation({
    mutationFn: (itemId: string) =>
      api(`/stock-inventories/${editId}/items/${itemId}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stock-inventories', editId] });
    },
    onError: (e: Error) => setEditErr(e.message),
  });

  const postMut = useMutation({
    mutationFn: () =>
      api(`/stock-inventories/${editId}/post`, { method: 'POST', json: {} }),
    onSuccess: () => {
      invalidate();
      setEditId(null);
      setQtyDraft({});
      alert('Inventário postado. Saldos ajustados.');
    },
    onError: (e: Error) => setEditErr(e.message),
  });

  const cancelMut = useMutation({
    mutationFn: (id: string) =>
      api(`/stock-inventories/${id}/cancel`, { method: 'POST', json: {} }),
    onSuccess: () => {
      invalidate();
      setEditId(null);
    },
    onError: (e: Error) => setEditErr(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api(`/stock-inventories/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      invalidate();
      setEditId(null);
    },
    onError: (e: Error) => alert(e.message),
  });

  const editing = detail.data && editId ? detail.data : null;

  const canPost = useMemo(() => {
    if (!editing || editing.status !== 'DRAFT') return false;
    if (editing.items.length < 1) return false;
    return editing.items.every((it) => {
      const draft = qtyDraft[it.id];
      const raw = draft !== undefined ? draft : it.countedQty ?? '';
      return String(raw).trim() !== '' && !Number.isNaN(Number(String(raw).replace(',', '.')));
    });
  }, [editing, qtyDraft]);

  function openEdit(id: string) {
    setEditId(id);
    setViewId(null);
    setEditErr(null);
    setQtyDraft({});
  }

  function countedDisplay(it: InventoryItem): string {
    if (qtyDraft[it.id] !== undefined) return qtyDraft[it.id]!;
    return it.countedQty ?? '';
  }

  function deltaText(systemQty: string, counted: string): string | null {
    if (counted.trim() === '') return null;
    const c = Number(counted.replace(',', '.'));
    const s = Number(systemQty);
    if (!Number.isFinite(c)) return null;
    const d = c - s;
    if (d === 0) return 'Sem diferença';
    if (d > 0) return `+${d}`;
    return String(d);
  }

  async function exportCsv(inventoryId: string, controlNumber: number) {
    try {
      setCsvBusy(true);
      await apiDownload(
        `/stock-inventories/${inventoryId}/export-csv`,
        `inventario-${controlNumber}.csv`,
      );
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Falha ao exportar CSV.');
    } finally {
      setCsvBusy(false);
    }
  }

  async function onCsvSelected(file: File | undefined) {
    if (!file || !editId) return;
    try {
      setCsvBusy(true);
      setEditErr(null);
      const result = await apiUpload<CsvImportResult>(
        `/stock-inventories/${editId}/import-csv`,
        file,
      );
      qc.setQueryData(['stock-inventories', editId], result.inventory);
      invalidate();
      setImportResult(result.summary);
    } catch (e) {
      setEditErr(e instanceof Error ? e.message : 'Falha ao importar CSV.');
    } finally {
      setCsvBusy(false);
      if (csvInputRef.current) csvInputRef.current.value = '';
    }
  }

  return (
    <div>
      <CrudToolbar
        onInclude={() => {
          setCreateErr(null);
          setCreateOpen(true);
        }}
        includeLabel="Novo inventário"
        onReports={() => setReportsOpen(true)}
      />

      <ModuleReportsModal
        open={reportsOpen}
        title="Inventário"
        compactLauncher
        onClose={() => setReportsOpen(false)}
      >
        <InventoryReportsPanel defaultInventoryId={editId ?? viewId} />
      </ModuleReportsModal>

      <p className="page-desc">
        Monte um inventário por local, adicione produtos (tela, CSV ou coletor no celular), informe a
        contagem física e poste para igualar os saldos.
      </p>

      <div className="form-row no-print" style={{ marginBottom: '0.75rem', alignItems: 'flex-end' }}>
        <div className="field" style={{ maxWidth: 220 }}>
          <label htmlFor="inv-status-f">Situação</label>
          <select
            id="inv-status-f"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">Todas</option>
            <option value="DRAFT">Rascunhos</option>
            <option value="POSTED">Postados</option>
            <option value="CANCELLED">Cancelados</option>
          </select>
        </div>
      </div>

      {list.isError && (
        <div className="alert alert-error">{(list.error as Error).message}</div>
      )}

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th className="num">Controle</th>
              <th>Data</th>
              <th>Local</th>
              <th className="num">Itens</th>
              <th>Situação</th>
              <th>Observação</th>
              <th className="col-actions no-print">Ações</th>
            </tr>
          </thead>
          <tbody>
            {(list.data ?? []).length === 0 && (
              <tr>
                <td colSpan={7}>Nenhum inventário encontrado.</td>
              </tr>
            )}
            {(list.data ?? []).map((r) => (
              <tr key={r.id}>
                <td className="num">#{r.controlNumber}</td>
                <td style={{ whiteSpace: 'nowrap', fontSize: '0.85rem' }}>
                  {formatDate(r.createdAt)}
                </td>
                <td>
                  {r.location.code} — {r.location.name}
                </td>
                <td className="num">{r._count.items}</td>
                <td>{statusLabel(r.status)}</td>
                <td style={{ fontSize: '0.85rem' }}>{r.notes ?? '—'}</td>
                <td className="col-actions no-print">
                  <div className="row-record-actions">
                    <button
                      type="button"
                      className="btn btn-secondary btn-compact"
                      onClick={() => setViewId(r.id)}
                    >
                      Visualizar
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-compact"
                      disabled={csvBusy}
                      onClick={() => void exportCsv(r.id, r.controlNumber)}
                    >
                      CSV
                    </button>
                    {r.status === 'DRAFT' && (
                      <Link
                        className="btn btn-secondary btn-compact"
                        to={`/estoque/inventario/${r.id}/coletar`}
                      >
                        Coletar
                      </Link>
                    )}
                    {r.status === 'DRAFT' && (
                      <button
                        type="button"
                        className="btn btn-secondary btn-compact"
                        onClick={() => openEdit(r.id)}
                      >
                        Alterar
                      </button>
                    )}
                    {r.status === 'DRAFT' && (
                      <button
                        type="button"
                        className="btn btn-danger btn-compact"
                        onClick={() => {
                          if (window.confirm(`Excluir inventário #${r.controlNumber}?`)) {
                            deleteMut.mutate(r.id);
                          }
                        }}
                      >
                        Excluir
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {createOpen && (
        <FormModalBackdrop
          onClose={() => {
            setCreateOpen(false);
            setCreateErr(null);
          }}
        >
          <div className="modal" role="dialog">
            <h2>Novo inventário</h2>
            {createErr && <div className="alert alert-error">{createErr}</div>}
            <div className="field">
              <label htmlFor="inv-new-loc">Local de estoque *</label>
              <select
                id="inv-new-loc"
                value={createLoc}
                onChange={(e) => setCreateLoc(e.target.value)}
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
              <label htmlFor="inv-new-notes">Observação (opcional)</label>
              <input
                id="inv-new-notes"
                value={createNotes}
                onChange={(e) => setCreateNotes(e.target.value)}
                placeholder="Ex.: inventário rotativo gôndola A"
              />
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setCreateOpen(false)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!createLoc || createMut.isPending}
                onClick={() => createMut.mutate()}
              >
                {createMut.isPending ? 'Criando…' : 'Criar e incluir produtos'}
              </button>
            </div>
          </div>
        </FormModalBackdrop>
      )}

      {editId && editing && (
        <FormModalBackdrop
          className="modal-backdrop--wide"
          onClose={() => {
            setEditId(null);
            setQtyDraft({});
            setEditErr(null);
          }}
        >
          <div className="modal modal--wide" role="dialog">
            <h2>
              Inventário #{editing.controlNumber} —{' '}
              {editing.location.code} {editing.location.name}
            </h2>
            <p className="page-desc" style={{ marginTop: 0 }}>
              Inclua produtos (manual, CSV ou coletor no celular), informe a quantidade física e poste
              para ajustar o estoque.
            </p>
            {editErr && <div className="alert alert-error">{editErr}</div>}
            {detail.isLoading && <p>Carregando…</p>}

            <input
              ref={csvInputRef}
              type="file"
              accept=".csv,text/csv,text/plain"
              style={{ display: 'none' }}
              onChange={(e) => void onCsvSelected(e.target.files?.[0])}
            />

            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
              <button
                type="button"
                className="btn btn-primary"
                disabled={editing.status !== 'DRAFT' || addItemMut.isPending || bulkAddMut.isPending}
                onClick={() => setProductSearchOpen(true)}
              >
                + Incluir produto
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={editing.status !== 'DRAFT' || bulkAddMut.isPending}
                onClick={() => {
                  setBulkErr(null);
                  setBulkScope('category');
                  setBulkCategoryId('');
                  setBulkOpen(true);
                }}
              >
                Incluir categoria / todos
              </button>
              <Link
                className="btn btn-secondary"
                to={`/estoque/inventario/${editing.id}/coletar`}
                style={{
                  pointerEvents: editing.status !== 'DRAFT' ? 'none' : undefined,
                  opacity: editing.status !== 'DRAFT' ? 0.5 : 1,
                }}
              >
                Coletar no celular
              </Link>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={editing.status !== 'DRAFT' || csvBusy}
                onClick={() => csvInputRef.current?.click()}
              >
                {csvBusy ? 'CSV…' : 'Importar CSV'}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={csvBusy}
                onClick={() => void exportCsv(editing.id, editing.controlNumber)}
              >
                Exportar CSV
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={
                  editing.status !== 'DRAFT' || !canPost || postMut.isPending
                }
                onClick={() => {
                  const pending = editing.items.filter((it) => qtyDraft[it.id] !== undefined);
                  const run = async () => {
                    for (const it of pending) {
                      await patchItemMut.mutateAsync({
                        itemId: it.id,
                        countedQty: qtyDraft[it.id] ?? '',
                      });
                    }
                    if (
                      !window.confirm(
                        `Postar inventário com ${editing.items.length} produto(s)? Os saldos serão igualados às contagens.`,
                      )
                    ) {
                      return;
                    }
                    postMut.mutate();
                  };
                  void run().catch((e: Error) => setEditErr(e.message));
                }}
              >
                {postMut.isPending ? 'Postando…' : 'Postar inventário'}
              </button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={editing.status !== 'DRAFT' || cancelMut.isPending}
                onClick={() => {
                  if (window.confirm('Cancelar este rascunho?')) {
                    cancelMut.mutate(editing.id);
                  }
                }}
              >
                Cancelar rascunho
              </button>
            </div>

            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Produto</th>
                    <th>SKU</th>
                    <th className="num">Saldo sist.</th>
                    <th className="num">Contagem</th>
                    <th className="num">Dif.</th>
                    <th className="col-actions">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {editing.items.length === 0 && (
                    <tr>
                      <td colSpan={6}>Nenhum produto. Clique em “Incluir produto”.</td>
                    </tr>
                  )}
                  {editing.items.map((it) => {
                    const counted = countedDisplay(it);
                    const delta = deltaText(it.systemQty, counted);
                    return (
                      <tr key={it.id}>
                        <td>
                          <strong>{it.variant.product.name}</strong>
                        </td>
                        <td>{it.variant.sku}</td>
                        <td className="num">{Number(it.systemQty)}</td>
                        <td className="num">
                          <input
                            style={{ width: '6rem', textAlign: 'right' }}
                            inputMode="decimal"
                            value={counted}
                            disabled={editing.status !== 'DRAFT'}
                            onChange={(e) =>
                              setQtyDraft((d) => ({ ...d, [it.id]: e.target.value }))
                            }
                            onBlur={() => {
                              if (qtyDraft[it.id] === undefined) return;
                              patchItemMut.mutate({
                                itemId: it.id,
                                countedQty: qtyDraft[it.id]!,
                              });
                            }}
                            placeholder="0"
                          />
                        </td>
                        <td className="num">{delta ?? '—'}</td>
                        <td className="col-actions">
                          <button
                            type="button"
                            className="btn btn-danger btn-compact"
                            disabled={editing.status !== 'DRAFT' || removeItemMut.isPending}
                            onClick={() => removeItemMut.mutate(it.id)}
                          >
                            Remover
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setEditId(null);
                  setQtyDraft({});
                }}
              >
                Fechar
              </button>
            </div>
          </div>
        </FormModalBackdrop>
      )}

      {importResult && (
        <FormModalBackdrop onClose={() => setImportResult(null)}>
          <div className="modal" role="dialog">
            <h2>Importação CSV</h2>
            <p>
              Criados: <strong>{importResult.created}</strong> · Atualizados:{' '}
              <strong>{importResult.updated}</strong> · Ignorados:{' '}
              <strong>{importResult.skipped}</strong>
            </p>
            {importResult.errors.length > 0 && (
              <>
                <p className="page-desc">Avisos / erros ({importResult.errors.length}):</p>
                <div className="table-wrap" style={{ maxHeight: 240, overflow: 'auto' }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th className="num">Linha</th>
                        <th>Motivo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importResult.errors.map((e, i) => (
                        <tr key={`${e.line}-${i}`}>
                          <td className="num">{e.line}</td>
                          <td style={{ fontSize: '0.85rem' }}>{e.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setImportResult(null)}
              >
                OK
              </button>
            </div>
          </div>
        </FormModalBackdrop>
      )}

      {bulkOpen && (
        <FormModalBackdrop
          onClose={() => {
            if (bulkAddMut.isPending) return;
            setBulkOpen(false);
            setBulkErr(null);
          }}
        >
          <div className="modal" role="dialog">
            <h2>Incluir vários produtos</h2>
            <p className="page-desc" style={{ marginTop: 0 }}>
              Inclui SKUs unitários ativos. Produtos compostos (caixa/pack) e itens já no inventário
              são ignorados. A contagem fica em branco para você preencher depois.
            </p>
            {bulkErr && <div className="alert alert-error">{bulkErr}</div>}
            <fieldset className="field" style={{ border: 'none', padding: 0, margin: 0 }}>
              <legend style={{ fontWeight: 600, marginBottom: '0.5rem' }}>Escopo</legend>
              <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.4rem' }}>
                <input
                  type="radio"
                  name="inv-bulk-scope"
                  checked={bulkScope === 'category'}
                  onChange={() => setBulkScope('category')}
                />
                Todos os produtos de uma categoria
              </label>
              <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <input
                  type="radio"
                  name="inv-bulk-scope"
                  checked={bulkScope === 'all'}
                  onChange={() => setBulkScope('all')}
                />
                Todos os produtos cadastrados
              </label>
            </fieldset>
            {bulkScope === 'category' && (
              <div className="field" style={{ marginTop: '0.75rem' }}>
                <label htmlFor="inv-bulk-cat">Categoria *</label>
                <select
                  id="inv-bulk-cat"
                  value={bulkCategoryId}
                  onChange={(e) => setBulkCategoryId(e.target.value)}
                  disabled={categories.isLoading}
                >
                  <option value="">Selecione…</option>
                  {(categories.data ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-secondary"
                disabled={bulkAddMut.isPending}
                onClick={() => {
                  setBulkOpen(false);
                  setBulkErr(null);
                }}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={
                  bulkAddMut.isPending ||
                  (bulkScope === 'category' && !bulkCategoryId)
                }
                onClick={() => {
                  const label =
                    bulkScope === 'all'
                      ? 'todos os produtos cadastrados'
                      : `a categoria selecionada`;
                  if (
                    !window.confirm(
                      `Incluir ${label} neste inventário? Itens já presentes serão ignorados.`,
                    )
                  ) {
                    return;
                  }
                  bulkAddMut.mutate(
                    bulkScope === 'all'
                      ? { scope: 'all' }
                      : { scope: 'category', categoryId: bulkCategoryId },
                  );
                }}
              >
                {bulkAddMut.isPending ? 'Incluindo…' : 'Incluir'}
              </button>
            </div>
          </div>
        </FormModalBackdrop>
      )}

      <ProductSearchModal
        open={productSearchOpen}
        title="Incluir produto no inventário"
        onClose={() => setProductSearchOpen(false)}
        onPick={(row: ProductSearchRow) => {
          setProductSearchOpen(false);
          addItemMut.mutate(row.variantId);
        }}
      />

      <RecordViewModal
        open={Boolean(viewId && !editId)}
        wide
        title={
          detail.data
            ? `Inventário #${detail.data.controlNumber} — visualização`
            : 'Inventário — visualização'
        }
        onClose={() => setViewId(null)}
        loading={detail.isLoading}
        error={detail.isError ? (detail.error as Error).message : null}
        sections={
          detail.data && viewId
            ? [
                {
                  title: 'Cabeçalho',
                  fields: [
                    { label: 'Controle', value: `#${detail.data.controlNumber}` },
                    {
                      label: 'Local',
                      value: `${detail.data.location.code} — ${detail.data.location.name}`,
                    },
                    { label: 'Situação', value: statusLabel(detail.data.status) },
                    { label: 'Data', value: formatDate(detail.data.createdAt) },
                    {
                      label: 'Postado em',
                      value: detail.data.postedAt
                        ? formatDate(detail.data.postedAt)
                        : null,
                    },
                    { label: 'Responsável', value: detail.data.user?.name },
                    { label: 'Observação', value: detail.data.notes },
                  ],
                },
                {
                  title: 'Produtos',
                  empty: 'Nenhum item.',
                  columns: [
                    'Produto',
                    'SKU',
                    { label: 'Saldo sist.', num: true },
                    { label: 'Contagem', num: true },
                    { label: 'Dif.', num: true },
                  ],
                  rows: detail.data.items.map((it) => {
                    const c = it.countedQty != null ? Number(it.countedQty) : null;
                    const s = Number(it.systemQty);
                    const d = c == null ? null : c - s;
                    return [
                      it.variant.product.name,
                      it.variant.sku,
                      s,
                      c ?? '—',
                      d == null ? '—' : d > 0 ? `+${d}` : String(d),
                    ];
                  }),
                },
              ]
            : []
        }
      />
    </div>
  );
}
