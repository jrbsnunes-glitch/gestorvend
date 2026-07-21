/**
 * Menu Cartões — listagem de transações de cartão com filtros e impressões.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CrudToolbar } from '../components/CrudToolbar';
import { FormModalBackdrop } from '../components/FormModalBackdrop';
import { ListPagination, LIST_PAGE_SIZE } from '../components/ListPagination';
import { ModuleReportsModal } from '../components/ModuleReportsModal';
import { RecordViewModal } from '../components/RecordViewModal';
import { api } from '../lib/api';
import { formatBRL, formatDate } from '../lib/format';
import {
  CARD_BRAND_OPTIONS,
  cardBrandLabel,
  cardOperationLabel,
  type PaymentForm,
} from '../lib/payment-forms';

type CardRow = {
  id: string;
  amount: string;
  installments: number;
  cardBrand: string | null;
  cardOperation: string | null;
  adminFeeAmount: string;
  netAmount: string | null;
  settlementStatus: 'OPEN' | 'SETTLED' | null;
  settledAt: string | null;
  expectedSettleAt: string | null;
  authCode: string | null;
  paymentForm: { id: string; name: string } | null;
  sale: {
    id: string;
    number: number;
    total: string;
    createdAt: string;
    customer: { id: string; name: string } | null;
    user: { id: string; name: string } | null;
  };
};

type Filters = {
  dateFrom: string;
  dateTo: string;
  brand: string;
  settlement: '' | 'OPEN' | 'SETTLED';
  paymentFormId: string;
  cardOperation: '' | 'CREDIT' | 'DEBIT';
};

const EMPTY: Filters = {
  dateFrom: '',
  dateTo: '',
  brand: '',
  settlement: '',
  paymentFormId: '',
  cardOperation: '',
};

function buildQs(f: Filters, page: number): string {
  const p = new URLSearchParams();
  p.set('take', String(LIST_PAGE_SIZE));
  p.set('skip', String((page - 1) * LIST_PAGE_SIZE));
  if (f.dateFrom) p.set('dateFrom', f.dateFrom);
  if (f.dateTo) p.set('dateTo', f.dateTo);
  if (f.brand) p.set('brand', f.brand);
  if (f.settlement) p.set('settlement', f.settlement);
  if (f.paymentFormId) p.set('paymentFormId', f.paymentFormId);
  if (f.cardOperation) p.set('cardOperation', f.cardOperation);
  return p.toString();
}

export function CardsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [applied, setApplied] = useState<Filters>(EMPTY);
  const [page, setPage] = useState(1);
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [reportsOpen, setReportsOpen] = useState(false);
  const [viewId, setViewId] = useState<string | null>(null);
  const [editRow, setEditRow] = useState<CardRow | null>(null);
  const [editForm, setEditForm] = useState({
    paymentFormId: '',
    amount: '',
    installments: '1',
    authCode: '',
  });

  const qs = useMemo(() => buildQs(applied, page), [applied, page]);

  const list = useQuery({
    queryKey: ['card-transactions', qs],
    queryFn: () => api<{ total: number; items: CardRow[] }>(`/card-transactions?${qs}`),
  });

  const forms = useQuery({
    queryKey: ['payment-forms', 'card'],
    queryFn: () => api<PaymentForm[]>('/payment-forms?kind=CARD'),
  });

  const detail = useQuery({
    queryKey: ['card-transactions', viewId],
    queryFn: () => api<CardRow>(`/card-transactions/${viewId}`),
    enabled: Boolean(viewId),
  });

  const settle = useMutation({
    mutationFn: (id: string) =>
      api(`/card-transactions/${id}/settle`, { method: 'POST', json: {} }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['card-transactions'] }),
  });

  const reopen = useMutation({
    mutationFn: (id: string) =>
      api(`/card-transactions/${id}/reopen`, { method: 'POST', json: {} }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['card-transactions'] }),
  });

  const patch = useMutation({
    mutationFn: () =>
      api(`/card-transactions/${editRow!.id}`, {
        method: 'PATCH',
        json: {
          paymentFormId: editForm.paymentFormId || undefined,
          amount: editForm.amount,
          installments: Number(editForm.installments) || 1,
          authCode: editForm.authCode || null,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['card-transactions'] });
      qc.invalidateQueries({ queryKey: ['cash'] });
      setEditRow(null);
    },
  });

  const total = list.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / LIST_PAGE_SIZE));
  const rows = list.data?.items ?? [];
  const cardForms = (forms.data ?? []).filter((f) => f.kind === 'CARD');

  return (
    <div className="page print-area">
      <h1 className="page-title">Cartões</h1>
      <p className="page-desc">
        Transações de cartão das vendas. Filtre por período, bandeira e situação (aberto / baixado).
        Corrija pagamentos quando houver erro na captura.
      </p>

      <CrudToolbar
        onPrint={() => window.print()}
        onReports={() => setReportsOpen(true)}
        leadingPrimary={
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setFiltersOpen((o) => !o)}
          >
            {filtersOpen ? 'Ocultar filtro' : 'Filtro'}
          </button>
        }
      />

      {filtersOpen && (
        <details className="submenu-details no-print" open>
          <summary className="submenu-summary">Filtros</summary>
          <div className="submenu-body">
            <div className="form-row" style={{ flexWrap: 'wrap', gap: '0.75rem' }}>
              <div className="field">
                <label>De</label>
                <input
                  type="date"
                  value={filters.dateFrom}
                  onChange={(e) => setFilters((f) => ({ ...f, dateFrom: e.target.value }))}
                />
              </div>
              <div className="field">
                <label>Até</label>
                <input
                  type="date"
                  value={filters.dateTo}
                  onChange={(e) => setFilters((f) => ({ ...f, dateTo: e.target.value }))}
                />
              </div>
              <div className="field">
                <label>Bandeira</label>
                <select
                  value={filters.brand}
                  onChange={(e) => setFilters((f) => ({ ...f, brand: e.target.value }))}
                >
                  <option value="">Todas</option>
                  {CARD_BRAND_OPTIONS.map((b) => (
                    <option key={b.value} value={b.value}>
                      {b.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Situação</label>
                <select
                  value={filters.settlement}
                  onChange={(e) =>
                    setFilters((f) => ({
                      ...f,
                      settlement: e.target.value as Filters['settlement'],
                    }))
                  }
                >
                  <option value="">Todas</option>
                  <option value="OPEN">Abertos</option>
                  <option value="SETTLED">Baixados</option>
                </select>
              </div>
              <div className="field">
                <label>Operação</label>
                <select
                  value={filters.cardOperation}
                  onChange={(e) =>
                    setFilters((f) => ({
                      ...f,
                      cardOperation: e.target.value as Filters['cardOperation'],
                    }))
                  }
                >
                  <option value="">Todas</option>
                  <option value="CREDIT">Crédito</option>
                  <option value="DEBIT">Débito</option>
                </select>
              </div>
              <div className="field">
                <label>Forma cadastrada</label>
                <select
                  value={filters.paymentFormId}
                  onChange={(e) => setFilters((f) => ({ ...f, paymentFormId: e.target.value }))}
                >
                  <option value="">Todas</option>
                  {cardForms.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setApplied({ ...filters });
                  setPage(1);
                }}
              >
                Aplicar
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setFilters(EMPTY);
                  setApplied(EMPTY);
                  setPage(1);
                }}
              >
                Limpar
              </button>
            </div>
          </div>
        </details>
      )}

      <ModuleReportsModal
        open={reportsOpen}
        title="Cartões — Impressões"
        wide
        compactLauncher
        onClose={() => setReportsOpen(false)}
      >
        <div style={{ display: 'grid', gap: '0.75rem' }}>
          {(
            [
              ['period', 'Por período'],
              ['brand', 'Por bandeira'],
              ['open', 'Somente abertos'],
              ['settled', 'Somente baixados'],
            ] as const
          ).map(([report, label]) => (
            <button
              key={report}
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                const p = new URLSearchParams();
                p.set('report', report);
                if (applied.dateFrom) p.set('dateFrom', applied.dateFrom);
                if (applied.dateTo) p.set('dateTo', applied.dateTo);
                if (applied.brand) p.set('brand', applied.brand);
                if (report === 'open') p.set('settlement', 'OPEN');
                if (report === 'settled') p.set('settlement', 'SETTLED');
                if (applied.paymentFormId) p.set('paymentFormId', applied.paymentFormId);
                if (applied.cardOperation) p.set('cardOperation', applied.cardOperation);
                setReportsOpen(false);
                navigate(`/cartoes/impressao?${p.toString()}`);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </ModuleReportsModal>

      <div className="table-wrap" style={{ marginTop: '0.75rem' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Data</th>
              <th>Venda</th>
              <th>Cliente</th>
              <th>Forma / bandeira</th>
              <th className="num">Valor</th>
              <th className="num">Taxa</th>
              <th>Situação</th>
              <th className="col-actions no-print">Ações</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={8}>Nenhuma transação de cartão com os filtros atuais.</td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{formatDate(r.sale.createdAt)}</td>
                <td>#{r.sale.number}</td>
                <td>{r.sale.customer?.name ?? 'Consumidor'}</td>
                <td>
                  {r.paymentForm?.name ?? 'Cartão'}
                  <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                    {cardBrandLabel(r.cardBrand)} · {cardOperationLabel(r.cardOperation)}
                    {r.installments > 1 ? ` · ${r.installments}x` : ''}
                  </div>
                </td>
                <td className="num">{formatBRL(Number(r.amount))}</td>
                <td className="num">{formatBRL(Number(r.adminFeeAmount))}</td>
                <td>
                  {r.settlementStatus === 'SETTLED' ? (
                    <span style={{ color: '#15803d', fontWeight: 600 }}>Baixado</span>
                  ) : (
                    <span style={{ color: '#b45309', fontWeight: 600 }}>Aberto</span>
                  )}
                </td>
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
                      onClick={() => {
                        setEditRow(r);
                        setEditForm({
                          paymentFormId: r.paymentForm?.id ?? '',
                          amount: String(r.amount),
                          installments: String(r.installments),
                          authCode: r.authCode ?? '',
                        });
                      }}
                    >
                      Editar
                    </button>
                    {r.settlementStatus !== 'SETTLED' ? (
                      <button
                        type="button"
                        className="btn btn-primary btn-compact"
                        disabled={settle.isPending}
                        onClick={() => settle.mutate(r.id)}
                      >
                        Baixar
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-secondary btn-compact"
                        disabled={reopen.isPending}
                        onClick={() => reopen.mutate(r.id)}
                      >
                        Reabrir
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ListPagination
        page={page}
        totalPages={totalPages}
        totalItems={total}
        onPageChange={setPage}
        itemLabel="transação(ões)"
      />

      <RecordViewModal
        open={Boolean(viewId)}
        title="Transação de cartão — visualização"
        onClose={() => setViewId(null)}
        loading={detail.isLoading}
        error={detail.isError ? (detail.error as Error).message : null}
        sections={
          detail.data
            ? [
                {
                  title: 'Dados da transação',
                  fields: [
                    { label: 'Venda', value: `#${detail.data.sale.number}` },
                    { label: 'Data', value: formatDate(detail.data.sale.createdAt) },
                    {
                      label: 'Cliente',
                      value: detail.data.sale.customer?.name ?? 'Consumidor',
                    },
                    {
                      label: 'Forma',
                      value: detail.data.paymentForm?.name ?? 'Cartão',
                    },
                    {
                      label: 'Bandeira / operação',
                      value: `${cardBrandLabel(detail.data.cardBrand)} · ${cardOperationLabel(detail.data.cardOperation)}`,
                    },
                    { label: 'Valor', value: formatBRL(Number(detail.data.amount)) },
                    { label: 'Taxa', value: formatBRL(Number(detail.data.adminFeeAmount)) },
                    {
                      label: 'Líquido',
                      value:
                        detail.data.netAmount != null
                          ? formatBRL(Number(detail.data.netAmount))
                          : null,
                    },
                    { label: 'Autorização', value: detail.data.authCode },
                    {
                      label: 'Previsão baixa',
                      value: detail.data.expectedSettleAt
                        ? formatDate(detail.data.expectedSettleAt)
                        : null,
                    },
                    {
                      label: 'Situação',
                      value:
                        detail.data.settlementStatus === 'SETTLED' ? 'Baixado' : 'Aberto',
                    },
                  ],
                },
              ]
            : []
        }
      />

      {editRow && (
        <FormModalBackdrop onClose={() => setEditRow(null)}>
          <div className="modal" role="dialog">
            <h2>Editar pagamento cartão — venda #{editRow.sale.number}</h2>
            {patch.isError && (
              <div className="alert alert-error">{(patch.error as Error).message}</div>
            )}
            <div className="field">
              <label>Forma de pagamento</label>
              <select
                value={editForm.paymentFormId}
                onChange={(e) => setEditForm((f) => ({ ...f, paymentFormId: e.target.value }))}
              >
                <option value="">Manter / sem forma</option>
                {cardForms.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-row">
              <div className="field">
                <label>Valor</label>
                <input
                  value={editForm.amount}
                  onChange={(e) => setEditForm((f) => ({ ...f, amount: e.target.value }))}
                />
              </div>
              <div className="field">
                <label>Parcelas</label>
                <input
                  value={editForm.installments}
                  onChange={(e) => setEditForm((f) => ({ ...f, installments: e.target.value }))}
                />
              </div>
            </div>
            <div className="field">
              <label>NSU / autorização</label>
              <input
                value={editForm.authCode}
                onChange={(e) => setEditForm((f) => ({ ...f, authCode: e.target.value }))}
              />
            </div>
            <p className="page-desc">
              A soma dos pagamentos da venda deve continuar igual ao total ({formatBRL(Number(editRow.sale.total))}).
            </p>
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setEditRow(null)}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={patch.isPending}
                onClick={() => patch.mutate()}
              >
                {patch.isPending ? 'Salvando…' : 'Salvar'}
              </button>
            </div>
          </div>
        </FormModalBackdrop>
      )}
    </div>
  );
}
