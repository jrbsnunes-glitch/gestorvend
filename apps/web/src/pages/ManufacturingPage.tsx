import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ManufacturingProjectReportsLauncher } from '../components/ManufacturingProjectReportsLauncher';
import { ModuleReportsModal } from '../components/ModuleReportsModal';
import { useManufacturingCreateDraft } from '../context/manufacturing-create-draft';
import { CrudSearchFilterLeading } from '../components/CrudSearchFilterLeading';
import { CrudToolbar } from '../components/CrudToolbar';
import { FormModalBackdrop } from '../components/FormModalBackdrop';
import { FilterControlRangeFields, FilterModalActions } from '../components/ListFilterFields';
import { ListFilterCustomerField } from '../components/ListFilterCustomerField';
import { ManufacturingProjectDetailModal } from '../components/ManufacturingProjectDetailModal';
import { ManufacturingStatusChip } from '../components/ManufacturingStatusChip';
import { api } from '../lib/api';
import { hasFactoryModule } from '../lib/auth';
import { formatCalendarDate } from '../lib/format';
import { controlRangeActive, matchesControlValue } from '../lib/list-filters';
import { addCalendarDays, todayISODate } from '../lib/local-date';
import {
  MFG_KANBAN_COLS,
  MFG_SOURCE_LABEL,
  MFG_STATUS_LABEL,
  canMoveMfgStatus,
  type MfgSource,
  type MfgStatus,
} from '../lib/manufacturing-labels';
import { MFG_REPORTS_MODAL_PARAM } from '../lib/manufacturing-project-reports';
import type { MfgOperationalAlerts } from '../lib/manufacturing-types';

type MfgRow = {
  id: string;
  number: number;
  status: MfgStatus;
  source: MfgSource;
  externalRef?: string | null;
  quantity: string;
  title: string | null;
  promisedAt: string | null;
  quoteTotal: string | null;
  customer: { id: string; name: string; phone: string | null };
  finishedVariant: {
    id: string;
    sku: string;
    product: { id: string; name: string; controlNumber: number };
  };
  technicalResponsible: { id: string; name: string } | null;
  bomLines: Array<{
    id: string;
    plannedQty: string;
    consumedQty: string;
    ingredientVariant: { sku: string; product: { name: string } };
  }>;
};

type Assignee = { id: string; name: string };
type ManufacturedProduct = {
  id: string;
  name: string;
  controlNumber: number;
  manufacturingLeadTimeDays?: number | null;
  variants: Array<{ id: string; sku: string }>;
};

function suggestedPromisedDate(leadDays: number | null | undefined): string {
  if (leadDays == null || !Number.isFinite(leadDays) || leadDays < 0) return '';
  return addCalendarDays(todayISODate(), Math.round(leadDays));
}

export function ManufacturingPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const qc = useQueryClient();
  const moduleOk = hasFactoryModule();
  const [viewMode, setViewMode] = useState<'list' | 'kanban'>('list');
  const [appliedStatus, setAppliedStatus] = useState('ALL');
  const [appliedSource, setAppliedSource] = useState('ALL');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [appliedControlMin, setAppliedControlMin] = useState('');
  const [appliedControlMax, setAppliedControlMax] = useState('');
  const [draftStatus, setDraftStatus] = useState('ALL');
  const [draftSource, setDraftSource] = useState('ALL');
  const [draftControlMin, setDraftControlMin] = useState('');
  const [draftControlMax, setDraftControlMax] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [reportsOpen, setReportsOpen] = useState(
    () => searchParams.get(MFG_REPORTS_MODAL_PARAM) === '1',
  );
  const [draftSearch, setDraftSearch] = useState('');

  const closeReportsModal = () => {
    setReportsOpen(false);
    if (searchParams.get(MFG_REPORTS_MODAL_PARAM) === '1') {
      const next = new URLSearchParams(searchParams);
      for (const key of [
        MFG_REPORTS_MODAL_PARAM,
        'report',
        'dateField',
        'from',
        'to',
        'customerId',
      ]) {
        next.delete(key);
      }
      setSearchParams(next, { replace: true });
    }
  };

  useEffect(() => {
    if (searchParams.get(MFG_REPORTS_MODAL_PARAM) === '1') {
      setReportsOpen(true);
    }
  }, [searchParams]);
  const [detailId, setDetailId] = useState<string | null>(null);
  const { draft, patchDraft, resetDraft, openNewProject, closeModal } = useManufacturingCreateDraft();
  const createOpen = draft.open;
  const {
    customerId,
    customerLabel,
    finishedVariantId,
    quantity,
    title,
    promisedAt,
    suggestedLeadDays,
    promisedAtTouched,
    technicalId,
  } = draft;
  const [err, setErr] = useState<string | null>(null);
  const [dragMfgId, setDragMfgId] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<MfgStatus | null>(null);

  function applyLeadTimeForVariant(variantId: string, products: ManufacturedProduct[]) {
    for (const p of products) {
      const v = p.variants.find((x) => x.id === variantId);
      if (v) {
        const lead = p.manufacturingLeadTimeDays;
        const leadNum = lead != null && Number.isFinite(Number(lead)) ? Number(lead) : null;
        const patch: Partial<typeof draft> = {
          suggestedLeadDays: leadNum,
        };
        if (!promisedAtTouched) {
          patch.promisedAt = suggestedPromisedDate(leadNum);
        }
        patchDraft(patch);
        return;
      }
    }
    patchDraft({
      suggestedLeadDays: null,
      ...(!promisedAtTouched ? { promisedAt: '' } : {}),
    });
  }

  const companyQ = useQuery({
    queryKey: ['company'],
    queryFn: () => api<{ factoryModuleEnabled?: boolean }>('/company'),
  });
  const companyEnabled = companyQ.data?.factoryModuleEnabled === true;

  const listQ = useQuery({
    queryKey: ['manufacturing', 'projects', appliedStatus, appliedSource],
    queryFn: () => {
      const qs = new URLSearchParams();
      if (appliedStatus !== 'ALL') qs.set('status', appliedStatus);
      if (appliedSource !== 'ALL') qs.set('source', appliedSource);
      qs.set('take', '200');
      return api<MfgRow[]>(`/manufacturing/projects?${qs}`);
    },
    enabled: moduleOk && companyEnabled,
  });

  const alertsQ = useQuery({
    queryKey: ['manufacturing', 'alerts'],
    queryFn: () => api<MfgOperationalAlerts>('/manufacturing/alerts'),
    enabled: moduleOk && companyEnabled,
  });

  const searchQ = useQuery({
    queryKey: ['manufacturing', 'search', appliedSearch],
    queryFn: () => api<MfgRow[]>(`/manufacturing/projects/search?q=${encodeURIComponent(appliedSearch)}`),
    enabled: moduleOk && companyEnabled && appliedSearch.trim().length >= 1,
  });

  const assigneesQ = useQuery({
    queryKey: ['manufacturing', 'assignees'],
    queryFn: () => api<Assignee[]>('/manufacturing/assignees'),
    enabled: moduleOk && companyEnabled && createOpen,
  });

  const productsQ = useQuery({
    queryKey: ['products', 'manufactured'],
    queryFn: () => api<ManufacturedProduct[]>('/products?includeInactive=0'),
    enabled: createOpen,
    select: (rows) =>
      rows.filter((p: any) => p.isManufacturedFinishedGood && (p.variants?.length ?? 0) > 0),
  });

  const manufacturedProducts = productsQ.data ?? [];

  const rows = useMemo(() => {
    let items = appliedSearch.trim() ? (searchQ.data ?? []) : (listQ.data ?? []);
    if (controlRangeActive({ controlMin: appliedControlMin, controlMax: appliedControlMax })) {
      items = items.filter((r) => matchesControlValue(r.number, appliedControlMin, appliedControlMax));
    }
    return [...items].sort((a, b) => a.number - b.number);
  }, [listQ.data, searchQ.data, appliedSearch, appliedControlMin, appliedControlMax]);

  const filtersActive =
    appliedStatus !== 'ALL' ||
    appliedSource !== 'ALL' ||
    controlRangeActive({ controlMin: appliedControlMin, controlMax: appliedControlMax });

  const alerts = alertsQ.data;
  const alertsVisible =
    alerts &&
    (alerts.overdueCount > 0 || alerts.materialShortageCount > 0);

  const statusMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: MfgStatus }) =>
      api(`/manufacturing/projects/${id}/status`, { method: 'POST', json: { status } }),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['manufacturing'] });
      if (vars?.id) {
        void qc.invalidateQueries({ queryKey: ['manufacturing', 'detail', vars.id] });
      }
      setErr(null);
    },
    onError: (e: Error) => setErr(e.message),
  });

  const onKanbanDrop = (toStatus: MfgStatus) => {
    if (!dragMfgId) return;
    const row = kanbanRows.find((r) => r.id === dragMfgId);
    setDragMfgId(null);
    setDragOverCol(null);
    if (!row || row.status === toStatus) return;
    if (!canMoveMfgStatus(row.status, toStatus)) {
      setErr(
        `Não é permitido mover de ${MFG_STATUS_LABEL[row.status]} para ${MFG_STATUS_LABEL[toStatus]}.`,
      );
      return;
    }
    statusMut.mutate({ id: row.id, status: toStatus });
  };

  const createMut = useMutation({
    mutationFn: () =>
      api<MfgRow>('/manufacturing/projects', {
        method: 'POST',
        json: {
          customerId,
          finishedVariantId,
          quantity,
          title: title.trim() || null,
          promisedAt: promisedAt || null,
          technicalResponsibleId: technicalId || null,
        },
      }),
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ['manufacturing'] });
      resetDraft();
      setDetailId(row.id);
      setErr(null);
    },
    onError: (e: Error) => setErr(e.message),
  });

  if (!moduleOk) {
    return (
      <div className="page">
        <h1>Fábrica</h1>
        <p className="muted">Addon Fábrica não contratado no portal de licenças.</p>
      </div>
    );
  }

  if (companyQ.isSuccess && !companyEnabled) {
    return (
      <div className="page">
        <h1>Fábrica</h1>
        <p className="muted">
          Ative em <Link to="/empresa">Empresa → Fábrica</Link>.
        </p>
      </div>
    );
  }

  const kanbanRows = rows.filter((r) => r.status !== 'CANCELLED');

  return (
    <div className="page">
      <h1>Fábrica</h1>
      <p className="page-desc">
        Projetos de fabricação de produto acabado — fases, BOM, reserva e consumo de insumos por etapa.
      </p>

      {alertsVisible ? (
        <div className="alert alert-warning" style={{ marginBottom: '0.75rem' }}>
          {alerts!.overdueCount > 0 ? (
            <span>
              <strong>{alerts!.overdueCount}</strong> projeto(s) com prazo vencido.{' '}
            </span>
          ) : null}
          {alerts!.materialShortageCount > 0 ? (
            <span>
              Falta de material em <strong>{alerts!.materialShortageCount}</strong> insumo(s) nos
              projetos ativos.{' '}
              <Link to="/fabrica/mrp">Ver MRP</Link>
            </span>
          ) : null}
        </div>
      ) : null}

      <CrudToolbar
        leadingPrimary={
          <>
            <CrudSearchFilterLeading
              onSearch={() => {
                setDraftSearch(appliedSearch);
                setSearchOpen(true);
              }}
              onFilters={() => {
                setDraftStatus(appliedStatus);
                setDraftSource(appliedSource);
                setDraftControlMin(appliedControlMin);
                setDraftControlMax(appliedControlMax);
                setFiltersOpen(true);
              }}
              filtersActive={filtersActive}
            />
            <div className="crud-view-toggle" role="group" aria-label="Visualização">
              <button
                type="button"
                className={`crud-view-toggle__btn${viewMode === 'list' ? ' is-active' : ''}`}
                onClick={() => setViewMode('list')}
              >
                Lista
              </button>
              <button
                type="button"
                className={`crud-view-toggle__btn${viewMode === 'kanban' ? ' is-active' : ''}`}
                onClick={() => setViewMode('kanban')}
              >
                Kanban
              </button>
            </div>
          </>
        }
        onInclude={() => {
          setErr(null);
          openNewProject();
        }}
        onReports={() => setReportsOpen(true)}
        includeLabel="Novo projeto"
      />

      <ModuleReportsModal
        open={reportsOpen}
        title="Projetos"
        compactLauncher
        onClose={closeReportsModal}
      >
        <ManufacturingProjectReportsLauncher onClose={closeReportsModal} />
      </ModuleReportsModal>

      {filtersOpen && (
        <FormModalBackdrop className="no-print" onClose={() => setFiltersOpen(false)}>
          <div className="modal modal--filters-compact" role="dialog" onClick={(e) => e.stopPropagation()}>
            <h2>Filtros</h2>
            <FilterControlRangeFields
              idPrefix="mfg"
              controlMin={draftControlMin}
              controlMax={draftControlMax}
              onControlMinChange={setDraftControlMin}
              onControlMaxChange={setDraftControlMax}
              minLabel="Controle mín."
              maxLabel="Controle máx."
            />
            <div className="field filter-modal-row">
              <label htmlFor="mfg-st">Fase</label>
              <select id="mfg-st" value={draftStatus} onChange={(e) => setDraftStatus(e.target.value)}>
                <option value="ALL">Todas</option>
                {Object.entries(MFG_STATUS_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <div className="field filter-modal-row">
              <label htmlFor="mfg-src">Origem</label>
              <select id="mfg-src" value={draftSource} onChange={(e) => setDraftSource(e.target.value)}>
                <option value="ALL">Todas</option>
                {(Object.entries(MFG_SOURCE_LABEL) as [MfgSource, string][]).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <FilterModalActions
              onClear={() => {
                setDraftStatus('ALL');
                setDraftSource('ALL');
                setDraftControlMin('');
                setDraftControlMax('');
                setAppliedStatus('ALL');
                setAppliedSource('ALL');
                setAppliedControlMin('');
                setAppliedControlMax('');
                setFiltersOpen(false);
              }}
              onCancel={() => setFiltersOpen(false)}
              onApply={() => {
                setAppliedStatus(draftStatus);
                setAppliedSource(draftSource);
                setAppliedControlMin(draftControlMin.trim());
                setAppliedControlMax(draftControlMax.trim());
                setFiltersOpen(false);
              }}
            />
          </div>
        </FormModalBackdrop>
      )}

      {searchOpen && (
        <FormModalBackdrop className="no-print" onClose={() => setSearchOpen(false)}>
          <div className="modal" role="dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
            <h2>Pesquisar projetos</h2>
            <div className="field">
              <label htmlFor="mfg-q">Termo</label>
              <input
                id="mfg-q"
                value={draftSearch}
                onChange={(e) => setDraftSearch(e.target.value)}
                placeholder="Nº, cliente, produto…"
              />
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => { setAppliedSearch(''); setSearchOpen(false); }}>
                Limpar
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setSearchOpen(false)}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setAppliedSearch(draftSearch.trim());
                  setSearchOpen(false);
                }}
              >
                Aplicar
              </button>
            </div>
          </div>
        </FormModalBackdrop>
      )}

      {createOpen && (
        <FormModalBackdrop
          className="modal-backdrop--cadastro modal-backdrop--wide no-print"
          onClose={closeModal}
        >
          <div
            className="modal modal--wide form-cadastro-modal"
            role="dialog"
            onClick={(e) => e.stopPropagation()}
          >
            <h2>Novo projeto de fabricação</h2>
            {err && <div className="alert alert-error">{err}</div>}
            <ListFilterCustomerField
              idPrefix="mfg-new"
              customerId={customerId}
              customerLabel={customerLabel}
              allowQuickCreate
              onSelect={(c) => {
                patchDraft({ customerId: c.id, customerLabel: c.name });
              }}
              onClear={() => {
                patchDraft({ customerId: '', customerLabel: '' });
              }}
            />
            <div className="field">
              <label htmlFor="mfg-prod">Produto acabado (PA)</label>
              <select
                id="mfg-prod"
                value={finishedVariantId}
                onChange={(e) => {
                  const v = e.target.value;
                  patchDraft({ finishedVariantId: v });
                  if (v) applyLeadTimeForVariant(v, manufacturedProducts);
                  else {
                    patchDraft({
                      suggestedLeadDays: null,
                      ...(!promisedAtTouched ? { promisedAt: '' } : {}),
                    });
                  }
                }}
              >
                <option value="">— Selecione —</option>
                {manufacturedProducts.flatMap((p) =>
                  p.variants.map((v) => (
                    <option key={v.id} value={v.id}>
                      #{p.controlNumber} — {p.name} ({v.sku})
                    </option>
                  )),
                )}
              </select>
            </div>
            <div className="form-row form-row--2">
              <div className="field">
                <label htmlFor="mfg-qty">Quantidade</label>
                <input
                  id="mfg-qty"
                  value={quantity}
                  onChange={(e) => patchDraft({ quantity: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="mfg-prom">Prazo prometido</label>
                <input
                  id="mfg-prom"
                  type="date"
                  value={promisedAt}
                  onChange={(e) => {
                    patchDraft({ promisedAt: e.target.value, promisedAtTouched: true });
                  }}
                />
                {suggestedLeadDays != null ? (
                  <p className="muted" style={{ margin: '0.35rem 0 0', fontSize: '0.78rem' }}>
                    Sugerido pelo cadastro do PA ({suggestedLeadDays} dia
                    {suggestedLeadDays === 1 ? '' : 's'}). Ajuste conforme a carga da fábrica — veja{' '}
                    <Link to="/fabrica/agenda">Agenda</Link>.
                  </p>
                ) : finishedVariantId ? (
                  <p className="muted" style={{ margin: '0.35rem 0 0', fontSize: '0.78rem' }}>
                    PA sem prazo sugerido no cadastro. Informe a data manualmente.
                  </p>
                ) : null}
              </div>
            </div>
            <div className="field">
              <label htmlFor="mfg-title">Título / referência</label>
              <input
                id="mfg-title"
                value={title}
                onChange={(e) => patchDraft({ title: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="mfg-tech">Responsável técnico</label>
              <select
                id="mfg-tech"
                value={technicalId}
                onChange={(e) => patchDraft({ technicalId: e.target.value })}
              >
                <option value="">— Opcional —</option>
                {(assigneesQ.data ?? []).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={closeModal}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!customerId || !finishedVariantId || createMut.isPending}
                onClick={() => createMut.mutate()}
              >
                {createMut.isPending ? 'Salvando…' : 'Criar projeto'}
              </button>
            </div>
          </div>
        </FormModalBackdrop>
      )}

      {detailId ? (
        <ManufacturingProjectDetailModal projectId={detailId} onClose={() => setDetailId(null)} />
      ) : null}

      {listQ.isLoading && <p>Carregando…</p>}

      {viewMode === 'list' ? (
        <div className="table-wrap" style={{ marginTop: '1rem' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th className="num">Cont.</th>
                <th>Fase</th>
                <th>Origem</th>
                <th>Cliente</th>
                <th>Produto acabado</th>
                <th className="num">Qtd</th>
                <th>Prazo</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="num">#{r.number}</td>
                  <td>
                    <ManufacturingStatusChip status={r.status} />
                  </td>
                  <td>
                    {MFG_SOURCE_LABEL[r.source] ?? r.source}
                    {r.externalRef?.startsWith('wa:') ? (
                      <span className="muted" style={{ display: 'block', fontSize: '0.75rem' }}>
                        Bot
                      </span>
                    ) : null}
                  </td>
                  <td>{r.customer.name}</td>
                  <td>{r.finishedVariant.product.name}</td>
                  <td className="num">{r.quantity}</td>
                  <td>{formatCalendarDate(r.promisedAt)}</td>
                  <td>
                    <button type="button" className="btn btn-secondary btn-compact" onClick={() => setDetailId(r.id)}>
                      Abrir
                    </button>
                  </td>
                </tr>
              ))}
              {!rows.length && !listQ.isLoading && (
                <tr>
                  <td colSpan={8} className="empty">
                    Nenhum projeto.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="os-kanban" style={{ marginTop: '1rem' }}>
          {err && !createOpen && !detailId ? (
            <div className="alert alert-error" style={{ gridColumn: '1 / -1' }}>
              {err}
            </div>
          ) : null}
          {MFG_KANBAN_COLS.map((col) => (
            <div
              key={col}
              className={`card os-kanban__col${dragOverCol === col ? ' is-drop-target' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                setDragOverCol(col);
              }}
              onDragLeave={() => setDragOverCol((c) => (c === col ? null : c))}
              onDrop={(e) => {
                e.preventDefault();
                onKanbanDrop(col);
              }}
            >
              <strong className="os-kanban__col-title">{MFG_STATUS_LABEL[col]}</strong>
              <div className="os-kanban__cards">
                {kanbanRows
                  .filter((r) => r.status === col)
                  .map((r) => (
                    <div
                      key={r.id}
                      className={`os-kanban__card${dragMfgId === r.id ? ' is-dragging' : ''}`}
                      draggable={!statusMut.isPending}
                      onDragStart={(e) => {
                        setDragMfgId(r.id);
                        e.dataTransfer.setData('text/plain', r.id);
                        e.dataTransfer.effectAllowed = 'move';
                      }}
                      onDragEnd={() => {
                        setDragMfgId(null);
                        setDragOverCol(null);
                      }}
                    >
                      <button
                        type="button"
                        className="os-kanban__card-open"
                        onClick={() => setDetailId(r.id)}
                      >
                        <div className="os-kanban__card-num">#{r.number}</div>
                        <div className="os-kanban__card-name">{r.customer.name}</div>
                        <div className="os-kanban__card-meta">{r.finishedVariant.product.name}</div>
                      </button>
                    </div>
                  ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
