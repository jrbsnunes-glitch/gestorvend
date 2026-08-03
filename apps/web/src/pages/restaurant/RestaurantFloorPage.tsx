import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { hasRestaurantPlan } from '../../lib/auth';
import { useEffect, useState } from 'react';

type DiningTable = {
  id: string;
  code: string;
  label: string | null;
  status: string;
  tabs: Array<{ id: string; number: number }>;
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
  items: Array<{ totalLine: string | number }>;
};

function tabTotal(items: Array<{ totalLine: string | number }>): number {
  return items.reduce((s, it) => s + Number(it.totalLine), 0);
}

export function RestaurantFloorPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const planOk = hasRestaurantPlan();
  const [areaName, setAreaName] = useState('');
  const [tableForm, setTableForm] = useState({ areaId: '', code: '', label: '' });

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

  const openTab = useMutation({
    mutationFn: (tableId: string | null) =>
      api<{ id: string }>('/restaurant/tabs', {
        method: 'POST',
        json: { tableId },
      }),
    onSuccess: (tab) => {
      void qc.invalidateQueries({ queryKey: ['restaurant'] });
      navigate(`/salao/comanda/${tab.id}`);
    },
  });

  const areas = areasQ.data ?? [];
  const openTabs = tabsQ.data ?? [];

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
          <p className="muted">Mesas opcionais · comanda é a conta aberta</p>
        </div>
        <div className="restaurant-page__actions">
          <Link to="/salao/fichas-tecnicas" className="btn btn-secondary">
            Fichas técnicas
          </Link>
          <button
            type="button"
            className="btn btn-primary"
            disabled={openTab.isPending}
            onClick={() => openTab.mutate(null)}
          >
            Abrir comanda (sem mesa)
          </button>
        </div>
      </header>

      {(areasQ.error || tabsQ.error) && (
        <div className="alert alert-error" role="alert">
          {(areasQ.error as Error)?.message || (tabsQ.error as Error)?.message}
        </div>
      )}

      <section className="card restaurant-open-tabs">
        <h2>Comandas abertas ({openTabs.length})</h2>
        {openTabs.length === 0 ? (
          <p className="muted">Nenhuma comanda aberta.</p>
        ) : (
          <ul className="restaurant-tab-list">
            {openTabs.map((t) => (
              <li key={t.id}>
                <Link to={`/salao/comanda/${t.id}`} className="restaurant-tab-chip">
                  <strong>#{t.number}</strong>
                  <span>
                    {t.table
                      ? `${t.table.area.name} · Mesa ${t.table.label || t.table.code}`
                      : 'Sem mesa'}
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

      {areas.map((area) => (
        <section key={area.id} className="card">
          <h2>{area.name}</h2>
          <div className="restaurant-table-grid">
            {area.tables.map((table) => {
              const occupied = table.tabs.length > 0 || table.status === 'OCCUPIED';
              return (
                <button
                  key={table.id}
                  type="button"
                  className={
                    'restaurant-table-tile' +
                    (occupied ? ' restaurant-table-tile--busy' : ' restaurant-table-tile--free')
                  }
                  onClick={() => {
                    if (table.tabs[0]) {
                      navigate(`/salao/comanda/${table.tabs[0].id}`);
                    } else {
                      openTab.mutate(table.id);
                    }
                  }}
                >
                  <span className="restaurant-table-tile__code">{table.label || table.code}</span>
                  <span className="restaurant-table-tile__status">
                    {occupied
                      ? table.tabs.map((t) => `#${t.number}`).join(', ') || 'Ocupada'
                      : 'Livre'}
                  </span>
                </button>
              );
            })}
            {area.tables.length === 0 && <p className="muted">Nenhuma mesa neste ambiente.</p>}
          </div>
        </section>
      ))}

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
    </div>
  );
}
