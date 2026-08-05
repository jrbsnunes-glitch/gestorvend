import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { hasRestaurantPlan, isWaiter } from '../../lib/auth';
import { useEffect, useState } from 'react';

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

type OpenTab = {
  id: string;
  number: number;
  table: { code: string; label: string | null; area: { name: string } } | null;
  customer?: { id: string; name: string } | null;
  items: Array<{ totalLine: string | number }>;
};

function tabTotal(items: Array<{ totalLine: string | number }>): number {
  return items.reduce((s, it) => s + Number(it.totalLine), 0);
}

/** Mesa ocupada só com cliente vinculado ou item lançado na comanda. */
function tabOccupiesTable(tab: DiningTable['tabs'][number]): boolean {
  return Boolean(tab.customerId) || (tab._count?.items ?? 0) > 0;
}

export function RestaurantFloorPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const planOk = hasRestaurantPlan();
  const waiterOnly = isWaiter();
  const [areaName, setAreaName] = useState('');
  const [tableForm, setTableForm] = useState({ areaId: '', code: '', label: '' });
  const [openDraft, setOpenDraft] = useState<{
    tableId: string | null;
    tableLabel: string;
    customerName: string;
  } | null>(null);

  const companyQ = useQuery({
    queryKey: ['company'],
    queryFn: () => api<{ restaurantModuleEnabled?: boolean }>('/company'),
  });

  const areasQ = useQuery({
    queryKey: ['restaurant', 'areas'],
    queryFn: () => api<DiningArea[]>('/restaurant/areas'),
    enabled: planOk && companyQ.data?.restaurantModuleEnabled === true,
    refetchInterval: 8_000,
  });

  const tabsQ = useQuery({
    queryKey: ['restaurant', 'tabs'],
    queryFn: () => api<OpenTab[]>('/restaurant/tabs'),
    enabled: planOk && companyQ.data?.restaurantModuleEnabled === true,
    refetchInterval: 8_000,
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

  const [openTabError, setOpenTabError] = useState<string | null>(null);
  const openTab = useMutation({
    mutationFn: (body: { tableId: string | null; customerName: string }) =>
      api<{ id: string }>('/restaurant/tabs', {
        method: 'POST',
        json: {
          tableId: body.tableId,
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

  function beginOpenTab(tableId: string | null, tableLabel: string) {
    setOpenTabError(null);
    setOpenDraft({ tableId, tableLabel, customerName: '' });
  }

  const areas = areasQ.data ?? [];
  /** Topo: só comandas avulsas (sem mesa). Comandas de mesa aparecem no mapa abaixo. */
  const openTabsWithoutTable = (tabsQ.data ?? []).filter((t) => !t.table);

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
          <p className="muted">Em cima: comandas sem mesa · Embaixo: mesas</p>
        </div>
        <div className="restaurant-page__actions">
          {!waiterOnly ? (
            <Link to="/salao/fichas-tecnicas" className="btn btn-secondary">
              Fichas técnicas
            </Link>
          ) : null}
          <button
            type="button"
            className="btn btn-primary"
            disabled={openTab.isPending}
            onClick={() => beginOpenTab(null, 'sem mesa')}
          >
            Abrir comanda (sem mesa)
          </button>
        </div>
      </header>

      {(areasQ.error || tabsQ.error || openTabError) && (
        <div className="alert alert-error" role="alert">
          {(areasQ.error as Error)?.message ||
            (tabsQ.error as Error)?.message ||
            openTabError}
        </div>
      )}

      {openDraft && (
        <section className="card" style={{ marginBottom: '0.75rem' }}>
          <h2 style={{ marginTop: 0, fontSize: '1.05rem' }}>
            Abrir comanda · {openDraft.tableLabel}
          </h2>
          <form
            className="form-row"
            style={{ alignItems: 'end', gap: '0.75rem', flexWrap: 'wrap' }}
            onSubmit={(e) => {
              e.preventDefault();
              openTab.mutate({
                tableId: openDraft.tableId,
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

      {/* Topo: só comandas sem mesa */}
      <section className="card restaurant-open-tabs">
        <h2>Comandas sem mesa ({openTabsWithoutTable.length})</h2>
        {tabsQ.isLoading ? (
          <p className="muted">Carregando…</p>
        ) : openTabsWithoutTable.length === 0 ? (
          <p className="muted">Nenhuma comanda sem mesa.</p>
        ) : (
          <ul className="restaurant-tab-list">
            {openTabsWithoutTable.map((t) => (
              <li key={t.id}>
                <Link to={`/salao/comanda/${t.id}`} className="restaurant-tab-chip">
                  <strong>#{t.number}</strong>
                  <span>{t.customer?.name || DEFAULT_CUSTOMER_NAME}</span>
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
              const occupying = table.tabs.filter(tabOccupiesTable);
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
                      beginOpenTab(table.id, `Mesa ${table.label || table.code}`);
                    }
                  }}
                >
                  <span className="restaurant-table-tile__code">{table.label || table.code}</span>
                  <span className="restaurant-table-tile__status">
                    {occupied
                      ? occupying
                          .map(
                            (t) =>
                              `#${t.number}${t.customer?.name ? ` · ${t.customer.name}` : ''}`,
                          )
                          .join(', ') || 'Ocupada'
                      : 'Livre'}
                  </span>
                </button>
              );
            })}
            {area.tables.length === 0 && <p className="muted">Nenhuma mesa neste ambiente.</p>}
          </div>
        </section>
      ))}

      {!waiterOnly ? (
        <section className="card restaurant-setup">
          <h2>Cadastro rápido</h2>
          <div className="form-row form-row--2">
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
                  disabled={!tableForm.areaId || !tableForm.code.trim() || createTable.isPending}
                  onClick={() => createTable.mutate()}
                >
                  Adicionar
                </button>
              </div>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
