import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BalanceMovementModal } from '../components/BalanceMovementModal';
import { BalancePrintModal } from '../components/BalancePrintModal';
import { CostCenterSelect } from '../components/CostCenterSelect';
import { CrudSearchFilterLeading } from '../components/CrudSearchFilterLeading';
import { CrudToolbar } from '../components/CrudToolbar';
import { FormModalBackdrop } from '../components/FormModalBackdrop';
import {
  FilterGroupField,
  FilterModalActions,
  FilterPeriodRangeFields,
} from '../components/ListFilterFields';
import { ListFilterCustomerField } from '../components/ListFilterCustomerField';
import { ReportPrintSticker } from '../components/ReportPrintSticker';
import { api } from '../lib/api';
import { formatBRL } from '../lib/format';
import { ledgerDirectionLabel, ledgerKindLabel } from '../lib/financial-overview-ledger-labels';
import { dateInInclusiveRange } from '../lib/list-filters';
import { matchesListSearch } from '../lib/list-search';

type LedgerRow = {
  occurredAt: string;
  kind: string;
  direction: 'IN' | 'OUT' | 'INFO';
  amount: string;
  title: string;
  detail: string | null;
  methodLabel: string | null;
  referentialAccountLabel?: string | null;
};

type Summary = {
  period: { from: string; to: string; label?: string; isCustomRange?: boolean };
  ledger: LedgerRow[];
  cash: {
    periodInflows: number;
    periodOutflows: number;
  };
};

function monthRangeDefaults(): { from: string; to: string } {
  const n = new Date();
  const start = new Date(n.getFullYear(), n.getMonth(), 1);
  const end = new Date(n.getFullYear(), n.getMonth() + 1, 0);
  return {
    from: start.toISOString().slice(0, 10),
    to: end.toISOString().slice(0, 10),
  };
}

export function FinancialOverviewPage() {
  const [includeOpen, setIncludeOpen] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  const [printInitial, setPrintInitial] = useState(() => monthRangeDefaults());
  const [searchOpen, setSearchOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [draftSearch, setDraftSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [draftDirection, setDraftDirection] = useState<'ALL' | 'IN' | 'OUT'>('ALL');
  const [appliedDirection, setAppliedDirection] = useState<'ALL' | 'IN' | 'OUT'>('ALL');
  const [draftPeriodFrom, setDraftPeriodFrom] = useState('');
  const [draftPeriodTo, setDraftPeriodTo] = useState('');
  const [appliedPeriodFrom, setAppliedPeriodFrom] = useState('');
  const [appliedPeriodTo, setAppliedPeriodTo] = useState('');
  const [draftCostCenterId, setDraftCostCenterId] = useState('');
  const [appliedCostCenterId, setAppliedCostCenterId] = useState('');
  const [draftCustomerId, setDraftCustomerId] = useState('');
  const [draftCustomerLabel, setDraftCustomerLabel] = useState('');
  const [appliedCustomerId, setAppliedCustomerId] = useState('');
  const [appliedCustomerLabel, setAppliedCustomerLabel] = useState('');
  const [draftGroup, setDraftGroup] = useState('');
  const [appliedGroup, setAppliedGroup] = useState('');

  const printCostCenters = useQuery({
    queryKey: ['financial-overview', 'cost-centers', 'all'],
    queryFn: () =>
      api<Array<{ id: string; code: string; description: string }>>('/financial-overview/cost-centers'),
    staleTime: 60_000,
    enabled: printOpen,
  });

  const summaryQs = useMemo(() => {
    const p = new URLSearchParams();
    if (appliedPeriodFrom.trim() && appliedPeriodTo.trim()) {
      p.set('from', appliedPeriodFrom.trim());
      p.set('to', appliedPeriodTo.trim());
    }
    if (appliedCostCenterId.trim()) p.set('costCenterId', appliedCostCenterId.trim());
    return p.toString();
  }, [appliedPeriodFrom, appliedPeriodTo, appliedCostCenterId]);

  const summary = useQuery({
    queryKey: ['financial-overview', 'summary', summaryQs || 'acumulado'],
    queryFn: () =>
      api<Summary>(`/financial-overview/summary${summaryQs ? `?${summaryQs}` : ''}`),
  });

  const customersForGroup = useQuery({
    queryKey: ['customers'],
    queryFn: () =>
      api<Array<{ id: string; name: string; segment: string | null }>>('/customers'),
    enabled: appliedGroup.trim() !== '',
    staleTime: 120_000,
  });

  const data = summary.data;

  function openPrintModal() {
    setPrintInitial(monthRangeDefaults());
    setPrintOpen(true);
  }

  const groupCustomerNames = useMemo(() => {
    if (!appliedGroup.trim()) return null;
    return (customersForGroup.data ?? [])
      .filter((c) => matchesListSearch([c.segment], appliedGroup))
      .map((c) => c.name.toLowerCase());
  }, [appliedGroup, customersForGroup.data]);

  const movimentacoesFluxo = useMemo(() => {
    let rows = (data?.ledger ?? []).filter((row) => row.direction !== 'INFO');
    if (appliedDirection === 'IN') rows = rows.filter((row) => row.direction === 'IN');
    if (appliedDirection === 'OUT') rows = rows.filter((row) => row.direction === 'OUT');
    if (appliedPeriodFrom.trim() || appliedPeriodTo.trim()) {
      rows = rows.filter((row) =>
        dateInInclusiveRange(row.occurredAt, appliedPeriodFrom, appliedPeriodTo),
      );
    }
    if (appliedCustomerId && appliedCustomerLabel.trim()) {
      const name = appliedCustomerLabel.trim().toLowerCase();
      rows = rows.filter((row) => {
        const hay = `${row.title ?? ''} ${row.detail ?? ''}`.toLowerCase();
        return hay.includes(name);
      });
    }
    if (groupCustomerNames?.length) {
      rows = rows.filter((row) => {
        const hay = `${row.title ?? ''} ${row.detail ?? ''}`.toLowerCase();
        return groupCustomerNames.some((n) => hay.includes(n));
      });
    }
    const q = appliedSearch.trim();
    if (q) {
      rows = rows.filter((row) => matchesListSearch([row.title, row.detail], q));
    }
    return rows;
  }, [
    data?.ledger,
    appliedSearch,
    appliedDirection,
    appliedPeriodFrom,
    appliedPeriodTo,
    appliedCustomerId,
    appliedCustomerLabel,
    groupCustomerNames,
  ]);

  const filtersActive =
    appliedDirection !== 'ALL' ||
    appliedPeriodFrom.trim() !== '' ||
    appliedPeriodTo.trim() !== '' ||
    appliedCostCenterId.trim() !== '' ||
    appliedCustomerId !== '' ||
    appliedGroup.trim() !== '';

  return (
    <div className="page print-area">
      <ReportPrintSticker documentTitle="Balanço financeiro" />

      <h1 className="page-title">Balanço financeiro</h1>
      <p className="page-desc">
        Movimentações com efeito de entrada ou saída no período (inclui caixa, vendas no PDV e
        pagamentos/recebimentos no financeiro). Títulos apenas registrados aparecem em{' '}
        <Link to="/balanco/relatorios">Relatórios por período</Link> (diário completo).
      </p>

      <CrudToolbar
        leadingPrimary={
          <CrudSearchFilterLeading
            onSearch={() => {
              setDraftSearch(appliedSearch);
              setSearchOpen(true);
            }}
            onFilters={() => {
              setDraftDirection(appliedDirection);
              setDraftPeriodFrom(appliedPeriodFrom);
              setDraftPeriodTo(appliedPeriodTo);
              setDraftCostCenterId(appliedCostCenterId);
              setDraftCustomerId(appliedCustomerId);
              setDraftCustomerLabel(appliedCustomerLabel);
              setDraftGroup(appliedGroup);
              setFiltersOpen(true);
            }}
            filtersActive={filtersActive}
          />
        }
        onInclude={() => setIncludeOpen(true)}
        onReports={openPrintModal}
      />

      {searchOpen && (
        <FormModalBackdrop className="no-print" onClose={() => setSearchOpen(false)}>
          <div className="modal" role="dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
            <h2>Pesquisar movimentações</h2>
            <p style={{ margin: '0 0 0.75rem', fontSize: '0.88rem', color: 'var(--color-text-secondary)' }}>
              Título ou detalhe na tabela abaixo.
            </p>
            <div className="field">
              <label htmlFor="bal-search-q">Termo</label>
              <input
                id="bal-search-q"
                type="search"
                autoFocus
                value={draftSearch}
                onChange={(e) => setDraftSearch(e.target.value)}
                placeholder="Ex.: venda, despesa…"
              />
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setDraftSearch('');
                  setAppliedSearch('');
                  setSearchOpen(false);
                }}
              >
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

      {filtersOpen && (
        <FormModalBackdrop className="no-print" onClose={() => setFiltersOpen(false)}>
          <div
            className="modal modal--filters-compact"
            role="dialog"
            onClick={(e) => e.stopPropagation()}
          >
            <h2>Filtros da listagem</h2>
            <FilterPeriodRangeFields
              idPrefix="bal"
              from={draftPeriodFrom}
              to={draftPeriodTo}
              onFromChange={setDraftPeriodFrom}
              onToChange={setDraftPeriodTo}
            />
            <ListFilterCustomerField
              idPrefix="bal"
              customerId={draftCustomerId}
              customerLabel={draftCustomerLabel}
              onSelect={(c) => {
                setDraftCustomerId(c.id);
                setDraftCustomerLabel(c.name);
              }}
              onClear={() => {
                setDraftCustomerId('');
                setDraftCustomerLabel('');
              }}
            />
            <FilterGroupField id="bal-filter-group" value={draftGroup} onChange={setDraftGroup} />
            <CostCenterSelect
              flow="OUT"
              id="bal-filter-cc"
              value={draftCostCenterId}
              onChange={setDraftCostCenterId}
              label="Centro de custo"
            />
            <div className="field filter-modal-row">
              <label htmlFor="bal-filter-dir">Natureza</label>
              <select
                id="bal-filter-dir"
                value={draftDirection}
                onChange={(e) => setDraftDirection(e.target.value as 'ALL' | 'IN' | 'OUT')}
              >
                <option value="ALL">Entradas e saídas</option>
                <option value="IN">Somente entradas</option>
                <option value="OUT">Somente saídas</option>
              </select>
            </div>
            <FilterModalActions
              onClear={() => {
                setDraftDirection('ALL');
                setDraftPeriodFrom('');
                setDraftPeriodTo('');
                setDraftCostCenterId('');
                setDraftCustomerId('');
                setDraftCustomerLabel('');
                setDraftGroup('');
                setAppliedDirection('ALL');
                setAppliedPeriodFrom('');
                setAppliedPeriodTo('');
                setAppliedCostCenterId('');
                setAppliedCustomerId('');
                setAppliedCustomerLabel('');
                setAppliedGroup('');
                setFiltersOpen(false);
              }}
              onCancel={() => setFiltersOpen(false)}
              onApply={() => {
                setAppliedDirection(draftDirection);
                setAppliedPeriodFrom(draftPeriodFrom.trim());
                setAppliedPeriodTo(draftPeriodTo.trim());
                setAppliedCostCenterId(draftCostCenterId.trim());
                setAppliedCustomerId(draftCustomerId);
                setAppliedCustomerLabel(draftCustomerLabel);
                setAppliedGroup(draftGroup.trim());
                setFiltersOpen(false);
              }}
            />
          </div>
        </FormModalBackdrop>
      )}

      {summary.isError && (
        <div className="alert alert-error">{(summary.error as Error).message}</div>
      )}

      {summary.isLoading && <p>Carregando…</p>}

      {data && (
        <>
          <p style={{ marginTop: '1rem', fontSize: '0.92rem', color: 'var(--color-text-muted)' }}>
            <strong>{data.period.label ?? 'Período acumulado'}</strong>
            {' · '}
            {new Date(data.period.from).toLocaleDateString('pt-BR', {
              day: '2-digit',
              month: '2-digit',
              year: 'numeric',
            })}{' '}
            até{' '}
            {new Date(data.period.to).toLocaleDateString('pt-BR', {
              day: '2-digit',
              month: '2-digit',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </p>

          <div
            className="dash-hero"
            style={{
              marginTop: '0.75rem',
              gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))',
            }}
          >
            <article className="dash-hero-card">
              <span className="dash-hero-label">Total entradas (período)</span>
              <strong className="dash-hero-value" style={{ color: '#15803d' }}>
                {formatBRL(data.cash.periodInflows)}
              </strong>
            </article>
            <article className="dash-hero-card">
              <span className="dash-hero-label">Total saídas (período)</span>
              <strong className="dash-hero-value" style={{ color: '#b91c1c' }}>
                {formatBRL(data.cash.periodOutflows)}
              </strong>
            </article>
            <article className="dash-hero-card">
              <span className="dash-hero-label">Líquido (entradas − saídas)</span>
              <strong className="dash-hero-value">
                {formatBRL(data.cash.periodInflows - data.cash.periodOutflows)}
              </strong>
            </article>
          </div>

          <section style={{ marginTop: '1rem' }}>
            <h2 style={{ fontSize: '1.05rem', margin: '0 0 0.75rem' }}>Movimentações</h2>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Natureza</th>
                    <th>Origem</th>
                    <th className="num">Valor</th>
                    <th>Forma</th>
                    <th>Centro de custo</th>
                    <th>Descrição</th>
                  </tr>
                </thead>
                <tbody>
                  {movimentacoesFluxo.map((row, idx) => (
                    <tr key={`${row.occurredAt}-${row.kind}-${idx}`}>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {new Date(row.occurredAt).toLocaleString('pt-BR')}
                      </td>
                      <td>{ledgerDirectionLabel(row.direction)}</td>
                      <td>{ledgerKindLabel(row.kind)}</td>
                      <td className="num">
                        {row.direction === 'OUT' ? '−' : ''}
                        {formatBRL(row.amount)}
                      </td>
                      <td>{row.methodLabel ?? '—'}</td>
                      <td style={{ fontSize: '0.8rem', maxWidth: 200 }}>
                        {row.referentialAccountLabel ?? '—'}
                      </td>
                      <td style={{ maxWidth: 320, fontSize: '0.85rem' }}>
                        <strong>{row.title}</strong>
                        {row.detail ? <div style={{ opacity: 0.9 }}>{row.detail}</div> : null}
                      </td>
                    </tr>
                  ))}
                  {!movimentacoesFluxo.length && (
                    <tr>
                      <td colSpan={7} className="empty">
                        Nenhuma movimentação no período.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      <BalanceMovementModal open={includeOpen} onClose={() => setIncludeOpen(false)} />

      <BalancePrintModal
        open={printOpen}
        onClose={() => setPrintOpen(false)}
        initialFrom={printInitial.from}
        initialTo={printInitial.to}
        initialCostCenterId=""
        costCenters={printCostCenters.data ?? []}
      />
    </div>
  );
}
