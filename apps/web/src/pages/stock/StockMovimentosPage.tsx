import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CrudToolbar, RowRecordActions } from '../../components/CrudToolbar';
import { FormModalBackdrop } from '../../components/FormModalBackdrop';
import { ModuleReportsModal } from '../../components/ModuleReportsModal';
import { api } from '../../lib/api';

type Movement = {
  id: string;
  controlNumber: number;
  type: string;
  source: string;
  quantity: string;
  createdAt: string;
  reference: string | null;
  outboundReason: string | null;
  variant: { sku: string; product: { name: string } };
  location: { code: string; name: string };
};

type ControlRange = { min: number | null; max: number | null; count: number };

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function sourceLabel(source: string): string {
  const map: Record<string, string> = {
    GOODS_RECEIPT: 'Entrada / compra (NF)',
    SALE: 'Venda (PDV)',
    MANUAL_OUT: 'Saída manual',
    ADJUSTMENT: 'Ajuste de inventário',
    OTHER: 'Outras',
  };
  return map[source] ?? source;
}

export function StockMovimentosPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [viewMovement, setViewMovement] = useState<Movement | null>(null);
  const [reportsOpen, setReportsOpen] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);
  const [movOpen, setMovOpen] = useState(false);
  const [movType, setMovType] = useState<'IN' | 'OUT' | 'ADJUST'>('IN');
  const [variantId, setVariantId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [qty, setQty] = useState('1');
  const [unitCost, setUnitCost] = useState('');
  const [ref, setRef] = useState('');
  const [outboundReason, setOutboundReason] = useState('');
  const [movErr, setMovErr] = useState<string | null>(null);

  // Modal de impressão
  const [printOpen, setPrintOpen] = useState(false);
  const [printMode, setPrintMode] = useState<'period' | 'control'>('period');
  const [printFrom, setPrintFrom] = useState(todayISO());
  const [printTo, setPrintTo] = useState(todayISO());
  const [printControlFrom, setPrintControlFrom] = useState('');
  const [printControlTo, setPrintControlTo] = useState('');
  const [printType, setPrintType] = useState<'' | 'IN' | 'OUT' | 'ADJUST'>('');
  const [printVariantId, setPrintVariantId] = useState('');

  const controlRange = useQuery({
    queryKey: ['stock-mov-control-range'],
    queryFn: () => api<ControlRange>('/stock-movements/control-range'),
    enabled: printOpen,
  });

  const locations = useQuery({
    queryKey: ['stock-locations'],
    queryFn: () => api<Array<{ id: string; code: string; name: string }>>('/stock-locations'),
  });

  const movements = useQuery({
    queryKey: ['stock-movements'],
    queryFn: () => api<Movement[]>('/stock-movements?take=100'),
  });

  const variantOptions = useQuery({
    queryKey: ['products-for-select'],
    queryFn: async () => {
      const products = await api<Array<{ name: string; variants: Array<{ id: string; sku: string }> }>>(
        '/products',
      );
      return products.flatMap((p) => p.variants.map((v) => ({ id: v.id, label: `${v.sku} — ${p.name}` })));
    },
  });

  const createMov = useMutation({
    mutationFn: () =>
      api('/stock-movements', {
        method: 'POST',
        json: {
          type: movType,
          variantId,
          locationId,
          quantity: qty,
          unitCost: unitCost ? unitCost : null,
          reference: ref || null,
          outboundReason: movType === 'OUT' && outboundReason.trim() ? outboundReason.trim() : null,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stock-movements'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['reports', 'stock-position'] });
      setMovOpen(false);
      setVariantId('');
      setLocationId('');
      setQty('1');
      setUnitCost('');
      setRef('');
      setOutboundReason('');
      setMovErr(null);
    },
    onError: (e: Error) => setMovErr(e.message),
  });

  return (
    <div className="print-area">
      <CrudToolbar
        onInclude={() => {
          setMovErr(null);
          setMovOpen(true);
        }}
        onPrint={() => setPrintOpen(true)}
        onReports={() => setReportsOpen(true)}
      />

      <ModuleReportsModal open={reportsOpen} title="Movimentações de estoque" onClose={() => setReportsOpen(false)}>
        <ul style={{ margin: 0, paddingLeft: '1.2rem' }}>
          <li>Razão auxiliar por produto e período</li>
          <li>Movimentos por origem (compra, venda, manual)</li>
        </ul>
      </ModuleReportsModal>

      <div className="card">
        <h2 className="page-title" style={{ fontSize: '1.05rem', marginBottom: '0.5rem' }}>
          Últimos lançamentos
        </h2>
        <p className="page-desc" style={{ marginBottom: '1rem' }}>
          Histórico geral de movimentações. <strong>Incluir</strong> registra entrada, saída ou ajuste manual.
        </p>
      <div className="toolbar no-print">
        <span style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>
          Até 100 registros mais recentes
        </span>
      </div>
      {movements.isError && (
        <div className="alert alert-error">{(movements.error as Error).message}</div>
      )}
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: 80 }}>Controle</th>
              <th>Data</th>
              <th>Tipo</th>
              <th>Origem</th>
              <th>Produto / SKU</th>
              <th>Local</th>
              <th>Qtd</th>
              <th>Ref. / motivo</th>
              <th className="col-actions">Ações</th>
            </tr>
          </thead>
          <tbody>
            {movements.isLoading && (
              <tr>
                <td colSpan={9} className="empty">
                  Carregando…
                </td>
              </tr>
            )}
            {!movements.isLoading && !movements.data?.length && (
              <tr>
                <td colSpan={9} className="empty">
                  Sem movimentos.
                </td>
              </tr>
            )}
            {movements.data?.map((m) => (
              <tr key={m.id}>
                <td>
                  <span
                    style={{
                      display: 'inline-block',
                      padding: '0.15rem 0.5rem',
                      background: '#eef2ff',
                      color: '#3730a3',
                      borderRadius: 6,
                      fontWeight: 700,
                      fontSize: '0.8rem',
                    }}
                  >
                    #{m.controlNumber}
                  </span>
                </td>
                <td style={{ whiteSpace: 'nowrap', fontSize: '0.85rem' }}>
                  {new Date(m.createdAt).toLocaleString('pt-BR')}
                </td>
                <td>
                  <span className="badge badge-muted">{m.type}</span>
                </td>
                <td style={{ fontSize: '0.85rem' }}>{sourceLabel(m.source)}</td>
                <td>
                  <strong>{m.variant.product.name}</strong>
                  <div style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>{m.variant.sku}</div>
                </td>
                <td>
                  {m.location.code} — {m.location.name}
                </td>
                <td>{m.quantity}</td>
                <td style={{ fontSize: '0.85rem' }}>
                  {m.reference ?? '—'}
                  {m.outboundReason ? (
                    <div style={{ color: 'var(--color-text-muted)' }}>{m.outboundReason}</div>
                  ) : null}
                </td>
                <td className="col-actions">
                  <RowRecordActions
                    canDelete={false}
                    onEdit={() =>
                      alert(
                        'Movimentações lançadas não podem ser alteradas. Use ajuste de inventário ou política de estorno.',
                      )
                    }
                    onView={() => {
                      setViewMovement(m);
                      setViewOpen(true);
                    }}
                    onDelete={() =>
                      alert(
                        'Exclusão de movimento não é permitida (auditoria). Considere lançamento de contrapartida.',
                      )
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </div>

      {viewMovement && viewOpen && (
        <div className="modal-backdrop no-print" role="presentation" onClick={() => setViewOpen(false)}>
          <div className="modal" role="dialog" onClick={(e) => e.stopPropagation()}>
            <h2>Movimentação — visualização</h2>
            <p style={{ fontSize: '0.9rem', color: 'var(--color-text-secondary)' }}>ID: {viewMovement.id}</p>
            <p>
              <strong>Data:</strong> {new Date(viewMovement.createdAt).toLocaleString('pt-BR')}
            </p>
            <p>
              <strong>Tipo:</strong> {viewMovement.type} · <strong>Origem:</strong>{' '}
              {sourceLabel(viewMovement.source)}
            </p>
            <p>
              <strong>Produto:</strong> {viewMovement.variant.product.name} ({viewMovement.variant.sku})
            </p>
            <p>
              <strong>Local:</strong> {viewMovement.location.code} — {viewMovement.location.name}
            </p>
            <p>
              <strong>Quantidade:</strong> {viewMovement.quantity}
            </p>
            <p>
              <strong>Referência:</strong> {viewMovement.reference ?? '—'}
            </p>
            {viewMovement.outboundReason ? (
              <p>
                <strong>Motivo (saída):</strong> {viewMovement.outboundReason}
              </p>
            ) : null}
            <div className="modal-actions">
              <button type="button" className="btn btn-primary" onClick={() => setViewOpen(false)}>
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {movOpen && (
        <FormModalBackdrop className="no-print" onClose={() => setMovOpen(false)}>
          <div className="modal" role="dialog" onClick={(e) => e.stopPropagation()}>
            <h2>Registrar movimento</h2>
            {movErr && <div className="alert alert-error">{movErr}</div>}
            <div className="field">
              <label htmlFor="sm-type">Tipo</label>
              <select id="sm-type" value={movType} onChange={(e) => setMovType(e.target.value as typeof movType)}>
                <option value="IN">Entrada</option>
                <option value="OUT">Saída</option>
                <option value="ADJUST">Ajuste (saldo absoluto)</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="sm-var">Variação (SKU) *</label>
              <select id="sm-var" value={variantId} onChange={(e) => setVariantId(e.target.value)} required>
                <option value="">— Selecione —</option>
                {variantOptions.data?.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="sm-loc">Local *</label>
              <select id="sm-loc" value={locationId} onChange={(e) => setLocationId(e.target.value)} required>
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
                <label htmlFor="sm-qty">Quantidade *</label>
                <input id="sm-qty" value={qty} onChange={(e) => setQty(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="sm-cost">Custo unitário (entrada)</label>
                <input
                  id="sm-cost"
                  value={unitCost}
                  onChange={(e) => setUnitCost(e.target.value)}
                  placeholder="Opcional"
                />
              </div>
            </div>
            {movType === 'OUT' && (
              <div className="field">
                <label htmlFor="sm-reason">Motivo da saída (opcional)</label>
                <input
                  id="sm-reason"
                  value={outboundReason}
                  onChange={(e) => setOutboundReason(e.target.value)}
                  placeholder="Ex.: Ajuste operacional"
                />
              </div>
            )}
            <div className="field">
              <label htmlFor="sm-ref">Referência</label>
              <input id="sm-ref" value={ref} onChange={(e) => setRef(e.target.value)} />
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setMovOpen(false)}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!variantId || !locationId || !qty || createMov.isPending}
                onClick={() => createMov.mutate()}
              >
                Registrar
              </button>
            </div>
          </div>
        </FormModalBackdrop>
      )}

      {printOpen && (
        <div className="modal-backdrop no-print" role="presentation" onClick={() => setPrintOpen(false)}>
          <div className="modal" role="dialog" onClick={(e) => e.stopPropagation()} style={{ width: 'min(640px, 96vw)' }}>
            <h2>Imprimir movimentações</h2>
            <p style={{ margin: '0 0 0.75rem', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
              Selecione um recorte (período ou faixa de controle) e os filtros adicionais.
            </p>
            <div className="print-modes" style={{ marginBottom: '0.75rem' }}>
              <button
                type="button"
                className={'print-mode-card ' + (printMode === 'period' ? 'is-active' : '')}
                onClick={() => setPrintMode('period')}
              >
                <strong>Período</strong>
                <span>Data inicial e final</span>
              </button>
              <button
                type="button"
                className={'print-mode-card ' + (printMode === 'control' ? 'is-active' : '')}
                onClick={() => setPrintMode('control')}
              >
                <strong>Controle</strong>
                <span>
                  Faixa de #min a #máx{' '}
                  {controlRange.data?.min != null && (
                    <em>
                      ({controlRange.data.min}–{controlRange.data.max})
                    </em>
                  )}
                </span>
              </button>
            </div>

            {printMode === 'period' && (
              <div className="form-row">
                <div className="field">
                  <label htmlFor="pr-from">De</label>
                  <input id="pr-from" type="date" value={printFrom} onChange={(e) => setPrintFrom(e.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="pr-to">Até</label>
                  <input id="pr-to" type="date" value={printTo} onChange={(e) => setPrintTo(e.target.value)} />
                </div>
              </div>
            )}

            {printMode === 'control' && (
              <div className="form-row">
                <div className="field">
                  <label htmlFor="pr-cf">Controle mínimo</label>
                  <input
                    id="pr-cf"
                    type="number"
                    min={1}
                    value={printControlFrom}
                    placeholder={controlRange.data?.min != null ? String(controlRange.data.min) : ''}
                    onChange={(e) => setPrintControlFrom(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="pr-ct">Controle máximo</label>
                  <input
                    id="pr-ct"
                    type="number"
                    min={1}
                    value={printControlTo}
                    placeholder={controlRange.data?.max != null ? String(controlRange.data.max) : ''}
                    onChange={(e) => setPrintControlTo(e.target.value)}
                  />
                </div>
              </div>
            )}

            <div className="form-row">
              <div className="field">
                <label htmlFor="pr-type">Tipo (opcional)</label>
                <select id="pr-type" value={printType} onChange={(e) => setPrintType(e.target.value as typeof printType)}>
                  <option value="">Todos</option>
                  <option value="IN">Entrada</option>
                  <option value="OUT">Saída</option>
                  <option value="ADJUST">Ajuste</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="pr-var">Produto/SKU (opcional)</label>
                <select id="pr-var" value={printVariantId} onChange={(e) => setPrintVariantId(e.target.value)}>
                  <option value="">Todos</option>
                  {variantOptions.data?.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setPrintOpen(false)}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  const qs = new URLSearchParams();
                  if (printMode === 'control') {
                    if (printControlFrom) qs.set('controlFrom', printControlFrom);
                    if (printControlTo) qs.set('controlTo', printControlTo);
                  } else {
                    if (printFrom) qs.set('from', printFrom);
                    if (printTo) qs.set('to', printTo);
                  }
                  if (printType) qs.set('type', printType);
                  if (printVariantId) qs.set('variantId', printVariantId);
                  setPrintOpen(false);
                  navigate(`/estoque/movimentos/impressao?${qs.toString()}`);
                }}
              >
                Imprimir
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
