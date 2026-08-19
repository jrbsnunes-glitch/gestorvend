/**
 * Saídas de estoque que não são venda (avaria, perda, consumo interno…).
 * Cada saída é um documento com 1 a N produtos no mesmo local; cancelar
 * devolve as quantidades ao estoque (movimento IN de estorno).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { CrudToolbar } from '../../components/CrudToolbar';
import { FormModalBackdrop } from '../../components/FormModalBackdrop';
import { ModuleReportsModal } from '../../components/ModuleReportsModal';
import { ProductSearchModal, type ProductSearchRow } from '../../components/ProductSearchModal';
import { RecordViewModal, type RecordViewSection } from '../../components/RecordViewModal';
import { api } from '../../lib/api';

const MOTIVES = ['Avaria', 'Perda / quebra', 'Consumo interno', 'Amostra / brinde', 'Vencido', 'Outro'];

type ExitItem = {
  id: string;
  variantId: string;
  quantity: string;
  notes: string | null;
  variant: { id: string; sku: string; product: { id: string; name: string; controlNumber: number } };
};

type ExitRow = {
  id: string;
  controlNumber: number;
  status: 'POSTED' | 'CANCELLED';
  reason: string;
  reference: string | null;
  cancelledAt: string | null;
  cancellationNotes: string | null;
  createdAt: string;
  location: { id: string; code: string; name: string };
  user: { id: string; name: string } | null;
  items: ExitItem[];
};

/** Linha do carrinho de itens da nova saída. */
type DraftLine = {
  variantId: string;
  label: string;
  quantity: string;
};

function parseQty(value: string): number {
  return parseFloat(String(value).replace(',', '.')) || 0;
}

function formatQty(value: string | number): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 4 });
}

export function StockSaidasPage() {
  const qc = useQueryClient();
  const [includeOpen, setIncludeOpen] = useState(false);
  const [reportsOpen, setReportsOpen] = useState(false);
  const [productSearchOpen, setProductSearchOpen] = useState(false);
  const [viewing, setViewing] = useState<ExitRow | null>(null);
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'POSTED' | 'CANCELLED'>('ALL');
  const [locationId, setLocationId] = useState('');
  const [reason, setReason] = useState(MOTIVES[0]);
  const [reference, setReference] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const exits = useQuery({
    queryKey: ['stock-exits'],
    queryFn: () => api<ExitRow[]>('/stock-exits?take=200'),
  });

  const locations = useQuery({
    queryKey: ['stock-locations'],
    queryFn: () => api<Array<{ id: string; code: string; name: string }>>('/stock-locations'),
  });

  const rows = useMemo(() => {
    const all = exits.data ?? [];
    if (statusFilter === 'ALL') return all;
    return all.filter((r) => r.status === statusFilter);
  }, [exits.data, statusFilter]);

  const totalDraftQty = useMemo(
    () => lines.reduce((sum, l) => sum + parseQty(l.quantity), 0),
    [lines],
  );

  function resetSaidaForm() {
    setLocationId('');
    setReason(MOTIVES[0]);
    setReference('');
    setLines([]);
    setErr(null);
  }

  /** Produto repetido soma quantidade em vez de duplicar linha (a API também agrupa). */
  function pickProduct(row: ProductSearchRow) {
    setLines((prev) => {
      const idx = prev.findIndex((l) => l.variantId === row.variantId);
      if (idx >= 0) {
        return prev.map((l, i) =>
          i === idx ? { ...l, quantity: String(parseQty(l.quantity) + 1) } : l,
        );
      }
      return [...prev, { variantId: row.variantId, label: `${row.sku} — ${row.productName}`, quantity: '1' }];
    });
    setProductSearchOpen(false);
  }

  function setLineQty(variantId: string, quantity: string) {
    setLines((prev) => prev.map((l) => (l.variantId === variantId ? { ...l, quantity } : l)));
  }

  function removeLine(variantId: string) {
    setLines((prev) => prev.filter((l) => l.variantId !== variantId));
  }

  const exitMut = useMutation({
    mutationFn: () =>
      api('/stock-exits', {
        method: 'POST',
        json: {
          locationId,
          reason,
          reference: reference || null,
          items: lines.map((l) => ({ variantId: l.variantId, quantity: parseQty(l.quantity) })),
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stock-exits'] });
      qc.invalidateQueries({ queryKey: ['stock-movements'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['reports', 'stock-position'] });
      setErr(null);
      setIncludeOpen(false);
      resetSaidaForm();
      alert('Saída registrada.');
    },
    onError: (e: Error) => setErr(e.message),
  });

  const cancelMut = useMutation({
    mutationFn: (payload: { id: string; notes?: string }) =>
      api(`/stock-exits/${payload.id}/cancel`, {
        method: 'POST',
        json: { notes: payload.notes || null },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stock-exits'] });
      qc.invalidateQueries({ queryKey: ['stock-movements'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['reports', 'stock-position'] });
      setViewing(null);
      alert('Saída cancelada. As quantidades voltaram ao estoque.');
    },
    onError: (e: Error) => alert(e.message),
  });

  function confirmCancel(row: ExitRow) {
    if (row.status === 'CANCELLED') {
      alert('Esta saída já está cancelada.');
      return;
    }
    const notes = window.prompt(
      `Cancelar a saída #${row.controlNumber}?\n\n` +
        `• ${row.items.length} produto(s) voltam ao estoque em ${row.location.name}\n` +
        '• O documento fica registrado como cancelado (histórico preservado)\n\n' +
        'Informe o motivo (opcional):',
      '',
    );
    if (notes === null) return;
    cancelMut.mutate({ id: row.id, notes: notes.trim() || undefined });
  }

  const viewSections: RecordViewSection[] = viewing
    ? [
        {
          title: 'Dados da saída',
          fields: [
            { label: 'Controle', value: `#${viewing.controlNumber}` },
            { label: 'Data', value: new Date(viewing.createdAt).toLocaleString('pt-BR') },
            { label: 'Local', value: `${viewing.location.code} — ${viewing.location.name}` },
            { label: 'Motivo', value: viewing.reason },
            { label: 'Referência', value: viewing.reference },
            { label: 'Usuário', value: viewing.user?.name ?? null },
            { label: 'Situação', value: viewing.status === 'CANCELLED' ? 'Cancelada' : 'Efetivada' },
            {
              label: 'Cancelada em',
              value: viewing.cancelledAt
                ? new Date(viewing.cancelledAt).toLocaleString('pt-BR')
                : null,
            },
            { label: 'Motivo do cancelamento', value: viewing.cancellationNotes },
          ],
        },
        {
          title: `Produtos (${viewing.items.length})`,
          columns: ['Código', 'Produto', 'SKU', { label: 'Quantidade', num: true }],
          rows: viewing.items.map((it) => [
            it.variant.product.controlNumber,
            it.variant.product.name,
            it.variant.sku,
            formatQty(it.quantity),
          ]),
          empty: 'Nenhum produto nesta saída.',
        },
      ]
    : [];

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
          Saídas de estoque (não venda)
        </h2>
        <p className="page-desc" style={{ marginBottom: '1rem' }}>
          Baixas por avaria, perda, consumo interno etc. Cada saída pode conter vários produtos.
          Use <strong>Incluir</strong> para lançar e <strong>Cancelar</strong> para estornar o
          estoque de uma saída já registrada.
        </p>

        <div className="field" style={{ maxWidth: 260 }}>
          <label>Situação</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'ALL' | 'POSTED' | 'CANCELLED')}
          >
            <option value="ALL">Todas</option>
            <option value="POSTED">Efetivadas</option>
            <option value="CANCELLED">Canceladas</option>
          </select>
        </div>

        {exits.isError && <div className="alert alert-error">{(exits.error as Error).message}</div>}
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Controle</th>
                <th>Data</th>
                <th>Local</th>
                <th>Motivo</th>
                <th>Produtos</th>
                <th className="num">Qtd total</th>
                <th>Situação</th>
                <th className="no-print">Ações</th>
              </tr>
            </thead>
            <tbody>
              {exits.isLoading && (
                <tr>
                  <td colSpan={8} className="empty">
                    Carregando…
                  </td>
                </tr>
              )}
              {!exits.isLoading && !rows.length && (
                <tr>
                  <td colSpan={8} className="empty">
                    Nenhuma saída registrada. Clique em Incluir para lançar.
                  </td>
                </tr>
              )}
              {rows.map((r) => {
                const totalQty = r.items.reduce((sum, it) => sum + Number(it.quantity), 0);
                return (
                  <tr key={r.id}>
                    <td>#{r.controlNumber}</td>
                    <td style={{ whiteSpace: 'nowrap', fontSize: '0.85rem' }}>
                      {new Date(r.createdAt).toLocaleString('pt-BR')}
                    </td>
                    <td>
                      {r.location.code} — {r.location.name}
                    </td>
                    <td>{r.reason}</td>
                    <td>
                      {r.items.length === 1 ? (
                        <>
                          <strong>{r.items[0].variant.product.name}</strong>
                          <div style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>
                            {r.items[0].variant.sku}
                          </div>
                        </>
                      ) : (
                        `${r.items.length} produtos`
                      )}
                    </td>
                    <td className="num">{formatQty(totalQty)}</td>
                    <td>
                      {r.status === 'CANCELLED' ? (
                        <span className="badge badge-danger">Cancelada</span>
                      ) : (
                        <span className="badge badge-success">Efetivada</span>
                      )}
                    </td>
                    <td className="no-print">
                      <div className="row-record-actions no-print">
                        <button
                          type="button"
                          className="btn btn-secondary btn-compact"
                          onClick={() => setViewing(r)}
                        >
                          Visualizar
                        </button>
                        <button
                          type="button"
                          className="btn btn-danger btn-compact"
                          disabled={r.status === 'CANCELLED' || cancelMut.isPending}
                          onClick={() => confirmCancel(r)}
                        >
                          Cancelar
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
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
          <div className="modal" role="dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 720 }}>
            <h2>Nova saída de estoque</h2>
            <p className="page-desc" style={{ marginBottom: '1rem' }}>
              Baixa de estoque sem vínculo com venda. Informe o local e o motivo e adicione quantos
              produtos precisar.
            </p>
            {err && <div className="alert alert-error">{err}</div>}

            <div className="form-row">
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

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '0.5rem',
                flexWrap: 'wrap',
                margin: '0.5rem 0',
              }}
            >
              <strong style={{ fontSize: '0.95rem' }}>Produtos da saída ({lines.length})</strong>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setProductSearchOpen(true)}
              >
                Pesquisar produto
              </button>
            </div>

            <div className="table-wrap" style={{ maxHeight: '18rem', overflow: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Produto</th>
                    <th style={{ width: '8rem' }}>Quantidade</th>
                    <th style={{ width: '5rem' }} />
                  </tr>
                </thead>
                <tbody>
                  {lines.length === 0 && (
                    <tr>
                      <td colSpan={3} className="empty">
                        Nenhum produto adicionado. Clique em Pesquisar produto.
                      </td>
                    </tr>
                  )}
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

            {lines.length > 0 && (
              <p className="page-desc" style={{ marginTop: '0.5rem' }}>
                Quantidade total: <strong>{formatQty(totalDraftQty)}</strong>
              </p>
            )}

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
                disabled={
                  !locationId ||
                  lines.length === 0 ||
                  lines.some((l) => parseQty(l.quantity) <= 0) ||
                  exitMut.isPending
                }
                onClick={() => exitMut.mutate()}
              >
                Registrar saída
              </button>
            </div>
          </div>
        </FormModalBackdrop>
      )}

      <RecordViewModal
        open={viewing != null}
        title={viewing ? `Saída #${viewing.controlNumber}` : 'Saída'}
        wide
        sections={viewSections}
        onClose={() => setViewing(null)}
      >
        {viewing && viewing.status !== 'CANCELLED' ? (
          <div className="modal-actions no-print" style={{ justifyContent: 'flex-start' }}>
            <button
              type="button"
              className="btn btn-danger"
              disabled={cancelMut.isPending}
              onClick={() => confirmCancel(viewing)}
            >
              Cancelar saída
            </button>
          </div>
        ) : null}
      </RecordViewModal>

      <ProductSearchModal
        open={productSearchOpen}
        title="Pesquisar produto para saída"
        onClose={() => setProductSearchOpen(false)}
        onPick={pickProduct}
      />
    </div>
  );
}
