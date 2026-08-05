import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import {
  buildInventoryDivergenceQuery,
  buildInventorySummaryQuery,
  resolveInventoryControlRange,
} from '../lib/inventory-report-format';

function monthStartISO(): string {
  const d = new Date();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-01`;
}

function todayISO(): string {
  const d = new Date();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Painel modal: resumo de inventários e divergências (abre página de impressão). */
export function InventoryReportsPanel({
  defaultInventoryId,
}: {
  /** Se o usuário está editando um inventário, pré-preenche o relatório de divergências. */
  defaultInventoryId?: string | null;
}) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<'summary' | 'divergences'>('summary');

  const [sumFrom, setSumFrom] = useState(monthStartISO);
  const [sumTo, setSumTo] = useState(todayISO);
  const [sumLocation, setSumLocation] = useState('');
  const [sumStatus, setSumStatus] = useState('POSTED');
  const [sumControlMin, setSumControlMin] = useState('');
  const [sumControlMax, setSumControlMax] = useState('');
  const [sumErr, setSumErr] = useState<string | null>(null);

  const [divFrom, setDivFrom] = useState(monthStartISO);
  const [divTo, setDivTo] = useState(todayISO);
  const [divLocation, setDivLocation] = useState('');
  const [divInventoryId, setDivInventoryId] = useState(defaultInventoryId ?? '');
  const [divControlMin, setDivControlMin] = useState('');
  const [divControlMax, setDivControlMax] = useState('');
  const [divOnlyDiffs, setDivOnlyDiffs] = useState(false);
  const [divErr, setDivErr] = useState<string | null>(null);

  const locations = useQuery({
    queryKey: ['stock-locations'],
    queryFn: () => api<Array<{ id: string; code: string; name: string }>>('/stock-locations'),
  });

  const inventories = useQuery({
    queryKey: ['stock-inventories', 'report-picker'],
    queryFn: () =>
      api<
        Array<{
          id: string;
          controlNumber: number;
          status: string;
          postedAt: string | null;
          location: { code: string; name: string };
        }>
      >('/stock-inventories'),
  });

  function openSummary() {
    setSumErr(null);
    const ctrl = resolveInventoryControlRange(sumControlMin, sumControlMax);
    if (!ctrl.ok) {
      setSumErr(ctrl.error);
      return;
    }
    const hasControl = Boolean(ctrl.min && ctrl.max);
    const hasPeriod = Boolean(sumFrom.trim() && sumTo.trim());
    if (!hasControl && !hasPeriod) {
      setSumErr('Informe o período e/ou o nº de controle do inventário.');
      return;
    }
    const qs = buildInventorySummaryQuery({
      from: hasControl ? undefined : sumFrom,
      to: hasControl ? undefined : sumTo,
      locationId: sumLocation || undefined,
      status: sumStatus || undefined,
      controlMin: ctrl.min,
      controlMax: ctrl.max,
    });
    navigate(`/estoque/inventario/relatorio/resumo?${qs}`);
  }

  function openDivergences() {
    setDivErr(null);
    if (divInventoryId.trim()) {
      const qs = buildInventoryDivergenceQuery({
        inventoryId: divInventoryId.trim(),
        onlyDiffs: divOnlyDiffs,
      });
      navigate(`/estoque/inventario/relatorio/divergencias?${qs}`);
      return;
    }
    const ctrl = resolveInventoryControlRange(divControlMin, divControlMax);
    if (!ctrl.ok) {
      setDivErr(ctrl.error);
      return;
    }
    const hasControl = Boolean(ctrl.min && ctrl.max);
    const hasPeriod = Boolean(divFrom.trim() && divTo.trim());
    if (!hasControl && !hasPeriod) {
      setDivErr('Informe o inventário, o período ou o nº de controle.');
      return;
    }
    const qs = buildInventoryDivergenceQuery({
      from: hasControl ? undefined : divFrom,
      to: hasControl ? undefined : divTo,
      locationId: divLocation || undefined,
      onlyDiffs: divOnlyDiffs,
      controlMin: ctrl.min,
      controlMax: ctrl.max,
    });
    navigate(`/estoque/inventario/relatorio/divergencias?${qs}`);
  }

  const tabBtn = (id: typeof tab, label: string) => (
    <button
      type="button"
      className={tab === id ? 'btn btn-primary' : 'btn btn-secondary'}
      style={{ fontSize: '0.85rem', padding: '0.35rem 0.7rem' }}
      onClick={() => setTab(id)}
    >
      {label}
    </button>
  );

  return (
    <div>
      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.85rem' }}>
        {tabBtn('summary', 'Resumo de inventários')}
        {tabBtn('divergences', 'Divergências')}
      </div>

      {tab === 'summary' && (
        <div>
          <p className="page-desc" style={{ fontSize: '0.86rem', marginTop: 0 }}>
            Filtre por período e/ou pelo nº de controle (#). Com controle preenchido (ex.: mín. 1),
            o sistema localiza o inventário mesmo fora do mês atual.
          </p>
          {sumErr && <div className="alert alert-error">{sumErr}</div>}
          <div className="form-row form-row--2" style={{ marginBottom: '0.65rem' }}>
            <div className="field">
              <label htmlFor="inv-sum-from">De</label>
              <input
                id="inv-sum-from"
                type="date"
                value={sumFrom}
                onChange={(e) => setSumFrom(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="inv-sum-to">Até</label>
              <input
                id="inv-sum-to"
                type="date"
                value={sumTo}
                onChange={(e) => setSumTo(e.target.value)}
              />
            </div>
          </div>
          <div className="form-row form-row--2" style={{ marginBottom: '0.65rem' }}>
            <div className="field">
              <label htmlFor="inv-sum-loc">Local</label>
              <select
                id="inv-sum-loc"
                value={sumLocation}
                onChange={(e) => setSumLocation(e.target.value)}
              >
                <option value="">Todos</option>
                {(locations.data ?? []).map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.code} — {l.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="inv-sum-status">Status</label>
              <select
                id="inv-sum-status"
                value={sumStatus}
                onChange={(e) => setSumStatus(e.target.value)}
              >
                <option value="POSTED">Postados</option>
                <option value="DRAFT">Rascunhos</option>
                <option value="CANCELLED">Cancelados</option>
                <option value="ALL">Todos</option>
              </select>
            </div>
          </div>
          <div className="form-row form-row--2" style={{ marginBottom: '0.65rem' }}>
            <div className="field">
              <label htmlFor="inv-sum-cmin">Controle mín.</label>
              <input
                id="inv-sum-cmin"
                inputMode="numeric"
                placeholder="ex.: 1"
                value={sumControlMin}
                onChange={(e) => setSumControlMin(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="inv-sum-cmax">Controle máx.</label>
              <input
                id="inv-sum-cmax"
                inputMode="numeric"
                placeholder="igual ao mín. se for um só"
                value={sumControlMax}
                onChange={(e) => setSumControlMax(e.target.value)}
              />
            </div>
          </div>
          <button type="button" className="btn btn-primary" onClick={openSummary}>
            Abrir relatório
          </button>
        </div>
      )}

      {tab === 'divergences' && (
        <div>
          <p className="page-desc" style={{ fontSize: '0.86rem', marginTop: 0 }}>
            Itens com diferença entre contagem física e saldo do sistema na postagem. Informe um
            inventário específico ou o período dos postados.
          </p>
          {divErr && <div className="alert alert-error">{divErr}</div>}
          <div className="field" style={{ marginBottom: '0.65rem' }}>
            <label htmlFor="inv-div-id">Inventário (opcional)</label>
            <select
              id="inv-div-id"
              value={divInventoryId}
              onChange={(e) => setDivInventoryId(e.target.value)}
            >
              <option value="">Todos no período abaixo</option>
              {(inventories.data ?? []).map((inv) => (
                <option key={inv.id} value={inv.id}>
                  #{inv.controlNumber} · {inv.status} · {inv.location.code}
                  {inv.postedAt
                    ? ` · ${new Date(inv.postedAt).toLocaleDateString('pt-BR')}`
                    : ''}
                </option>
              ))}
            </select>
          </div>
          {!divInventoryId.trim() && (
            <>
              <div className="form-row form-row--2" style={{ marginBottom: '0.65rem' }}>
                <div className="field">
                  <label htmlFor="inv-div-from">De</label>
                  <input
                    id="inv-div-from"
                    type="date"
                    value={divFrom}
                    onChange={(e) => setDivFrom(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="inv-div-to">Até</label>
                  <input
                    id="inv-div-to"
                    type="date"
                    value={divTo}
                    onChange={(e) => setDivTo(e.target.value)}
                  />
                </div>
              </div>
              <div className="field" style={{ marginBottom: '0.65rem' }}>
                <label htmlFor="inv-div-loc">Local</label>
                <select
                  id="inv-div-loc"
                  value={divLocation}
                  onChange={(e) => setDivLocation(e.target.value)}
                >
                  <option value="">Todos</option>
                  {(locations.data ?? []).map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.code} — {l.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-row form-row--2" style={{ marginBottom: '0.65rem' }}>
                <div className="field">
                  <label htmlFor="inv-div-cmin">Controle mín.</label>
                  <input
                    id="inv-div-cmin"
                    inputMode="numeric"
                    placeholder="opcional"
                    value={divControlMin}
                    onChange={(e) => setDivControlMin(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="inv-div-cmax">Controle máx.</label>
                  <input
                    id="inv-div-cmax"
                    inputMode="numeric"
                    placeholder="opcional"
                    value={divControlMax}
                    onChange={(e) => setDivControlMax(e.target.value)}
                  />
                </div>
              </div>
            </>
          )}
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.45rem',
              marginBottom: '0.75rem',
              fontSize: '0.9rem',
            }}
          >
            <input
              type="checkbox"
              checked={divOnlyDiffs}
              onChange={(e) => setDivOnlyDiffs(e.target.checked)}
            />
            Somente itens com divergência
          </label>
          <button type="button" className="btn btn-primary" onClick={openDivergences}>
            Abrir relatório
          </button>
        </div>
      )}
    </div>
  );
}
