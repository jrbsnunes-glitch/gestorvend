import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { hasRestaurantPlan, isWaiter } from '../../lib/auth';
import { formatServiceTabBadge, formatServiceTabLabel } from '../../lib/service-tab';
import { FormModalBackdrop } from '../../components/FormModalBackdrop';
import { useEffect, useState } from 'react';
import './restaurant.css';

const DEFAULT_CUSTOMER_NAME = 'Cliente Padrão';

type DiningTable = {
  id: string;
  code: string;
  label: string | null;
  status: string;
  tabs: Array<{
    id: string;
    number: number;
    customerId?: string | null;
    customer?: { id: string; name: string } | null;
    _count?: { items: number };
  }>;
};

type DiningArea = {
  id: string;
  name: string;
  tables: DiningTable[];
};

type ComandaStation = {
  id: string;
  code: string;
  label: string | null;
  tabs: Array<{
    id: string;
    number: number;
    customerId?: string | null;
    customer?: { id: string; name: string } | null;
    _count?: { items: number };
  }>;
};

type OpenTab = {
  id: string;
  number: number;
  table: { code: string; label: string | null; area: { name: string } } | null;
  station?: { code: string; label: string | null } | null;
  customer?: { id: string; name: string } | null;
  items: Array<{ totalLine: string | number }>;
};

function tabTotal(items: Array<{ totalLine: string | number }>): number {
  return items.reduce((s, it) => s + Number(it.totalLine), 0);
}

function TabReceiptIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="M7 3h10a2 2 0 0 1 2 2v16l-2-1.5L15 21l-2-1.5L11 21l-2-1.5L7 21l-2-1.5V5a2 2 0 0 1 2-2z" />
      <path d="M9 8h6M9 12h6M9 16h4" strokeLinecap="round" />
    </svg>
  );
}

function TableIcon({ occupied }: { occupied: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.75">
      <ellipse cx="12" cy="7" rx="8" ry="2.5" />
      <path d="M4 7v3M20 7v3" strokeLinecap="round" />
      <path d={occupied ? 'M6 18v-5M18 18v-5' : 'M6 19v-6M18 19v-6'} strokeLinecap="round" />
    </svg>
  );
}

/** Mesa ou comanda fixa ocupada só com cliente vinculado ou item lançado. */
function tabIsOccupied(tab: {
  customerId?: string | null;
  _count?: { items: number };
}): boolean {
  return Boolean(tab.customerId) || (tab._count?.items ?? 0) > 0;
}

export function RestaurantFloorPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const planOk = hasRestaurantPlan();
  const waiterOnly = isWaiter();
  const [areaName, setAreaName] = useState('');
  const [tableForm, setTableForm] = useState({ areaId: '', code: '', label: '' });
  const [stationForm, setStationForm] = useState({ code: '', label: '' });
  const [setupOpen, setSetupOpen] = useState(false);
  const [openDraft, setOpenDraft] = useState<{
    tableId: string | null;
    stationId: string | null;
    targetLabel: string;
    customerName: string;
  } | null>(null);

  const companyQ = useQuery({
    queryKey: ['company'],
    queryFn: () =>
      api<{ restaurantModuleEnabled?: boolean; comandaNumberingMode?: 'DYNAMIC' | 'FIXED' }>(
        '/company',
      ),
    staleTime: 10 * 60_000,
  });

  const fixedNumbering = companyQ.data?.comandaNumberingMode === 'FIXED';

  const areasQ = useQuery({
    queryKey: ['restaurant', 'areas'],
    queryFn: () => api<DiningArea[]>('/restaurant/areas'),
    enabled: planOk && companyQ.data?.restaurantModuleEnabled === true,
    refetchInterval: () =>
      typeof document !== 'undefined' && document.visibilityState === 'hidden' ? false : 15_000,
    staleTime: 8_000,
  });

  const tabsQ = useQuery({
    queryKey: ['restaurant', 'tabs'],
    queryFn: () => api<OpenTab[]>('/restaurant/tabs'),
    enabled: planOk && companyQ.data?.restaurantModuleEnabled === true && !fixedNumbering,
    refetchInterval: () =>
      typeof document !== 'undefined' && document.visibilityState === 'hidden' ? false : 15_000,
    staleTime: 8_000,
  });

  const stationsQ = useQuery({
    queryKey: ['restaurant', 'stations'],
    queryFn: () => api<ComandaStation[]>('/restaurant/stations'),
    enabled: planOk && companyQ.data?.restaurantModuleEnabled === true && fixedNumbering,
    refetchInterval: () =>
      typeof document !== 'undefined' && document.visibilityState === 'hidden' ? false : 15_000,
    staleTime: 8_000,
  });

  useEffect(() => {
    const first = areasQ.data?.[0]?.id;
    if (first) {
      setTableForm((f) => (f.areaId ? f : { ...f, areaId: first }));
    }
  }, [areasQ.data]);

  const createArea = useMutation({
    mutationFn: () => api('/restaurant/areas', { method: 'POST', json: { name: areaName.trim() } }),
    onSuccess: () => {
      setAreaName('');
      void qc.invalidateQueries({ queryKey: ['restaurant', 'areas'] });
    },
  });

  const createTable = useMutation({
    mutationFn: () =>
      api('/restaurant/tables', {
        method: 'POST',
        json: {
          areaId: tableForm.areaId,
          code: tableForm.code.trim(),
          label: tableForm.label.trim() || null,
        },
      }),
    onSuccess: () => {
      setTableForm((f) => ({ ...f, code: '', label: '' }));
      void qc.invalidateQueries({ queryKey: ['restaurant', 'areas'] });
    },
  });

  const createStation = useMutation({
    mutationFn: () =>
      api('/restaurant/stations', {
        method: 'POST',
        json: {
          code: stationForm.code.trim(),
          label: stationForm.label.trim() || null,
        },
      }),
    onSuccess: () => {
      setStationForm({ code: '', label: '' });
      void qc.invalidateQueries({ queryKey: ['restaurant', 'stations'] });
    },
  });

  const [openTabError, setOpenTabError] = useState<string | null>(null);
  const openTab = useMutation({
    mutationFn: (body: {
      tableId: string | null;
      stationId: string | null;
      customerName: string;
    }) =>
      api<{ id: string }>('/restaurant/tabs', {
        method: 'POST',
        json: {
          tableId: body.tableId,
          stationId: body.stationId,
          customerName: body.customerName.trim() || DEFAULT_CUSTOMER_NAME,
        },
      }),
    onSuccess: (tab) => {
      setOpenTabError(null);
      setOpenDraft(null);
      void qc.invalidateQueries({ queryKey: ['restaurant'] });
      navigate(`/salao/comanda/${tab.id}`);
    },
    onError: (e: Error) => setOpenTabError(e.message),
  });

  function beginOpenTab(opts: {
    tableId?: string | null;
    stationId?: string | null;
    targetLabel: string;
  }) {
    setOpenTabError(null);
    setOpenDraft({
      tableId: opts.tableId ?? null,
      stationId: opts.stationId ?? null,
      targetLabel: opts.targetLabel,
      customerName: '',
    });
  }

  const areas = areasQ.data ?? [];
  const stations = stationsQ.data ?? [];
  /** Numeração dinâmica: comandas avulsas (sem mesa e sem slot fixo). */
  const openTabsWithoutTable = (tabsQ.data ?? []).filter((t) => !t.table && !t.station);

  if (!planOk) {
    return (
      <div className="page restaurant-page">
        <h1>Salão / Comandas</h1>
        <p className="muted">
          O plano deste tenant não inclui o módulo restaurante. Altere o plano no portal de
          licenças para <strong>RESTAURANT</strong>.
        </p>
      </div>
    );
  }

  if (companyQ.data && companyQ.data.restaurantModuleEnabled === false) {
    return (
      <div className="page restaurant-page">
        <h1>Salão / Comandas</h1>
        <p className="muted">
          Módulo desativado. Ative em <Link to="/empresa">Empresa → Restaurante</Link>.
        </p>
      </div>
    );
  }

  return (
    <div className="page restaurant-page">
      <header className="restaurant-page__header">
        <div>
          <h1>Salão / Comandas</h1>
          <p className="muted">
            {fixedNumbering
              ? 'Em cima: comandas cadastradas (numeração fixa) · Embaixo: mesas'
              : 'Em cima: comandas sem mesa · Embaixo: mesas'}
          </p>
        </div>
        <div className="restaurant-page__actions">
          {!waiterOnly ? (
            <>
              <Link to="/salao/fichas-tecnicas" className="btn btn-secondary">
                Fichas técnicas
              </Link>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setSetupOpen(true)}
              >
                Cadastro rápido
              </button>
            </>
          ) : null}
          {!fixedNumbering ? (
            <button
              type="button"
              className="btn btn-primary"
              disabled={openTab.isPending}
              onClick={() => beginOpenTab({ targetLabel: 'sem mesa' })}
            >
              Abrir comanda (sem mesa)
            </button>
          ) : null}
        </div>
      </header>

      {(areasQ.error ||
        tabsQ.error ||
        stationsQ.error ||
        createStation.error ||
        openTabError) && (
        <div className="alert alert-error" role="alert">
          {(areasQ.error as Error)?.message ||
            (tabsQ.error as Error)?.message ||
            (stationsQ.error as Error)?.message ||
            (createStation.error as Error)?.message ||
            openTabError}
        </div>
      )}

      {openDraft && (
        <section className="card" style={{ marginBottom: '0.75rem' }}>
          <h2 style={{ marginTop: 0, fontSize: '1.05rem' }}>
            Abrir comanda · {openDraft.targetLabel}
          </h2>
          <form
            className="form-row"
            style={{ alignItems: 'end', gap: '0.75rem', flexWrap: 'wrap' }}
            onSubmit={(e) => {
              e.preventDefault();
              openTab.mutate({
                tableId: openDraft.tableId,
                stationId: openDraft.stationId,
                customerName: openDraft.customerName,
              });
            }}
          >
            <div className="field" style={{ flex: '1 1 220px', margin: 0 }}>
              <label htmlFor="open-customer-name">Nome do cliente</label>
              <input
                id="open-customer-name"
                autoFocus
                value={openDraft.customerName}
                onChange={(e) =>
                  setOpenDraft((d) => (d ? { ...d, customerName: e.target.value } : d))
                }
                placeholder={DEFAULT_CUSTOMER_NAME}
              />
              <span className="muted" style={{ fontSize: '0.8rem' }}>
                Vazio = {DEFAULT_CUSTOMER_NAME}
              </span>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={openTab.isPending}
                onClick={() => setOpenDraft(null)}
              >
                Cancelar
              </button>
              <button type="submit" className="btn btn-primary" disabled={openTab.isPending}>
                {openTab.isPending ? 'Abrindo…' : 'Abrir'}
              </button>
            </div>
          </form>
        </section>
      )}

      {/* Comandas sem mesa */}
      <section className="card restaurant-open-tabs">
        <h2>
          Comandas sem mesa
          {fixedNumbering
            ? ` (${stations.length} cadastradas)`
            : ` (${openTabsWithoutTable.length} abertas)`}
        </h2>
        {fixedNumbering ? (
          stationsQ.isLoading ? (
            <p className="muted">Carregando…</p>
          ) : stations.length === 0 ? (
            <p className="muted">
              Nenhuma comanda cadastrada. Use o cadastro rápido abaixo ou altere para numeração
              dinâmica em <Link to="/empresa">Empresa → Restaurante</Link>.
            </p>
          ) : (
            <div className="restaurant-table-grid restaurant-station-grid">
              {stations.map((station) => {
                const occupying = station.tabs.filter(tabIsOccupied);
                const occupied = occupying.length > 0;
                const resumeTab = occupying[0] ?? station.tabs[0];
                const displayCode = station.label || station.code;
                return (
                  <button
                    key={station.id}
                    type="button"
                    className={
                      'restaurant-table-tile restaurant-station-tile' +
                      (occupied
                        ? ' restaurant-table-tile--busy'
                        : ' restaurant-table-tile--free')
                    }
                    onClick={() => {
                      if (resumeTab) {
                        navigate(`/salao/comanda/${resumeTab.id}`);
                      } else {
                        beginOpenTab({
                          stationId: station.id,
                          targetLabel: `Comanda ${displayCode}`,
                        });
                      }
                    }}
                  >
                    <span className="restaurant-table-tile__icon" aria-hidden>
                      <TabReceiptIcon />
                    </span>
                    <span className="restaurant-table-tile__code">{displayCode}</span>
                    {station.label && station.label !== station.code ? (
                      <span className="restaurant-station-tile__code-hint">{station.code}</span>
                    ) : null}
                    {occupied ? (
                      <>
                        <span className="restaurant-table-tile__badge restaurant-table-tile__badge--busy">
                          Em uso
                        </span>
                        {resumeTab?.customer?.name ? (
                          <span className="restaurant-table-tile__guest">
                            {resumeTab.customer.name}
                          </span>
                        ) : null}
                      </>
                    ) : (
                      <span className="restaurant-table-tile__badge restaurant-table-tile__badge--free">
                        Livre
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )
        ) : tabsQ.isLoading ? (
          <p className="muted">Carregando…</p>
        ) : openTabsWithoutTable.length === 0 ? (
          <p className="muted">Nenhuma comanda sem mesa.</p>
        ) : (
          <ul className="restaurant-tab-list">
            {openTabsWithoutTable.map((t) => (
              <li key={t.id}>
                <Link to={`/salao/comanda/${t.id}`} className="restaurant-tab-chip">
                  <span className="restaurant-tab-chip__icon" aria-hidden>
                    <TabReceiptIcon />
                  </span>
                  <span className="restaurant-tab-chip__body">
                    <span className="restaurant-tab-chip__number">
                      {formatServiceTabLabel(t)}
                    </span>
                    <span className="restaurant-tab-chip__customer">
                      {t.customer?.name || DEFAULT_CUSTOMER_NAME}
                    </span>
                  </span>
                  <span className="restaurant-tab-chip__total">
                    {tabTotal(t.items).toLocaleString('pt-BR', {
                      style: 'currency',
                      currency: 'BRL',
                    })}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Baixo: mesas (mapa do salão) */}
      {areas.map((area) => (
        <section key={area.id} className="card">
          <h2>{area.name}</h2>
          <div className="restaurant-table-grid">
            {area.tables.map((table) => {
              const occupying = table.tabs.filter(tabIsOccupied);
              const occupied = occupying.length > 0;
              const resumeTab = occupying[0] ?? table.tabs[0];
              return (
                <button
                  key={table.id}
                  type="button"
                  className={
                    'restaurant-table-tile' +
                    (occupied ? ' restaurant-table-tile--busy' : ' restaurant-table-tile--free')
                  }
                  onClick={() => {
                    if (resumeTab) {
                      navigate(`/salao/comanda/${resumeTab.id}`);
                    } else {
                      beginOpenTab({
                        tableId: table.id,
                        targetLabel: `Mesa ${table.label || table.code}`,
                      });
                    }
                  }}
                >
                  <span className="restaurant-table-tile__icon" aria-hidden>
                    <TableIcon occupied={occupied} />
                  </span>
                  <span className="restaurant-table-tile__code">{table.label || table.code}</span>
                  {occupied ? (
                    <>
                      <span className="restaurant-table-tile__badge restaurant-table-tile__badge--busy">
                        {occupying.length > 1
                          ? `${occupying.length} comandas`
                          : formatServiceTabBadge(resumeTab ?? { number: 0 })}
                      </span>
                      {resumeTab?.customer?.name ? (
                        <span className="restaurant-table-tile__guest">{resumeTab.customer.name}</span>
                      ) : null}
                    </>
                  ) : (
                    <span className="restaurant-table-tile__badge restaurant-table-tile__badge--free">
                      Livre
                    </span>
                  )}
                </button>
              );
            })}
            {area.tables.length === 0 && <p className="muted">Nenhuma mesa neste ambiente.</p>}
          </div>
        </section>
      ))}

      {setupOpen && !waiterOnly ? (
        <FormModalBackdrop onClose={() => setSetupOpen(false)}>
          <div
            className="modal restaurant-setup-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="restaurant-setup-title"
          >
            <h2 id="restaurant-setup-title">Cadastro rápido</h2>
            <p className="muted" style={{ marginTop: '-0.35rem', marginBottom: '0.85rem' }}>
              Ambientes, mesas{fixedNumbering ? ' e comandas fixas' : ''}.
            </p>

            {(createArea.error || createTable.error || createStation.error) && (
              <div className="alert alert-error" role="alert" style={{ marginBottom: '0.75rem' }}>
                {(createArea.error as Error)?.message ||
                  (createTable.error as Error)?.message ||
                  (createStation.error as Error)?.message}
              </div>
            )}

            <div className="restaurant-setup restaurant-setup--modal">
              <div className="restaurant-setup-panel restaurant-setup-panel--floor">
                <h3 className="restaurant-setup-panel__title">Mesas e ambientes</h3>
                <div className="restaurant-setup-panel__grid">
                  <div className="field">
                    <label>Novo ambiente</label>
                    <div className="restaurant-inline-form">
                      <input
                        value={areaName}
                        onChange={(e) => setAreaName(e.target.value)}
                        placeholder="Ex.: Salão, Varanda"
                      />
                      <button
                        type="button"
                        className="btn btn-secondary"
                        disabled={!areaName.trim() || createArea.isPending}
                        onClick={() => createArea.mutate()}
                      >
                        Adicionar
                      </button>
                    </div>
                  </div>
                  <div className="field">
                    <label>Nova mesa</label>
                    <div className="restaurant-inline-form restaurant-inline-form--wrap">
                      <select
                        value={tableForm.areaId}
                        onChange={(e) => setTableForm({ ...tableForm, areaId: e.target.value })}
                      >
                        <option value="">Ambiente…</option>
                        {areas.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                      </select>
                      <input
                        value={tableForm.code}
                        onChange={(e) => setTableForm({ ...tableForm, code: e.target.value })}
                        placeholder="Código"
                      />
                      <input
                        value={tableForm.label}
                        onChange={(e) => setTableForm({ ...tableForm, label: e.target.value })}
                        placeholder="Rótulo (opcional)"
                      />
                      <button
                        type="button"
                        className="btn btn-secondary"
                        disabled={
                          !tableForm.areaId || !tableForm.code.trim() || createTable.isPending
                        }
                        onClick={() => createTable.mutate()}
                      >
                        Adicionar
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {fixedNumbering ? (
                <div className="restaurant-setup-panel restaurant-setup-panel--stations">
                  <h3 className="restaurant-setup-panel__title">Comandas sem mesa</h3>
                  <div className="field">
                    <label>Nova comanda</label>
                    <div className="restaurant-inline-form restaurant-inline-form--wrap">
                      <input
                        value={stationForm.code}
                        onChange={(e) => setStationForm({ ...stationForm, code: e.target.value })}
                        placeholder="Número ou sigla"
                      />
                      <input
                        value={stationForm.label}
                        onChange={(e) => setStationForm({ ...stationForm, label: e.target.value })}
                        placeholder="Rótulo (opcional)"
                      />
                      <button
                        type="button"
                        className="btn btn-secondary"
                        disabled={!stationForm.code.trim() || createStation.isPending}
                        onClick={() => createStation.mutate()}
                      >
                        Adicionar
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="modal-actions">
              <button type="button" className="btn btn-primary" onClick={() => setSetupOpen(false)}>
                Fechar
              </button>
            </div>
          </div>
        </FormModalBackdrop>
      ) : null}
    </div>
  );
}
