/**
 * Cadastro de Formas de Pagamento (Cadastros Gerais).
 * Cartão exige bandeira, crédito/débito, taxas e dias para baixa.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { CrudToolbar } from '../components/CrudToolbar';
import { FormModalBackdrop } from '../components/FormModalBackdrop';
import { ListPagination } from '../components/ListPagination';
import { RecordViewModal } from '../components/RecordViewModal';
import { api } from '../lib/api';
import { useListPagination } from '../hooks/useListPagination';
import {
  CARD_BRAND_OPTIONS,
  PAYMENT_FORM_KIND_LABELS,
  cardBrandLabel,
  cardOperationLabel,
  type CardBrand,
  type CardOperation,
  type PaymentForm,
  type PaymentFormKind,
} from '../lib/payment-forms';

type Draft = {
  name: string;
  kind: PaymentFormKind;
  isActive: boolean;
  sortOrder: string;
  cardBrand: CardBrand;
  cardOperation: CardOperation;
  adminFeePercent: string;
  adminFeeFixed: string;
  settlementDays: string;
  maxInstallments: string;
  notes: string;
};

const emptyDraft = (): Draft => ({
  name: '',
  kind: 'CASH',
  isActive: true,
  sortOrder: '0',
  cardBrand: 'VISA',
  cardOperation: 'CREDIT',
  adminFeePercent: '0',
  adminFeeFixed: '0',
  settlementDays: '1',
  maxInstallments: '1',
  notes: '',
});

function rowToDraft(row: PaymentForm): Draft {
  return {
    name: row.name,
    kind: row.kind,
    isActive: row.isActive,
    sortOrder: String(row.sortOrder ?? 0),
    cardBrand: row.cardBrand ?? 'VISA',
    cardOperation: row.cardOperation ?? 'CREDIT',
    adminFeePercent: String(row.adminFeePercent ?? '0'),
    adminFeeFixed: String(row.adminFeeFixed ?? '0'),
    settlementDays: String(row.settlementDays ?? 1),
    maxInstallments: String(row.maxInstallments ?? 1),
    notes: row.notes ?? '',
  };
}

function draftToBody(d: Draft) {
  const body: Record<string, unknown> = {
    name: d.name.trim(),
    kind: d.kind,
    isActive: d.isActive,
    sortOrder: Number(d.sortOrder) || 0,
    notes: d.notes.trim() || null,
  };
  if (d.kind === 'CARD') {
    body.cardBrand = d.cardBrand;
    body.cardOperation = d.cardOperation;
    body.adminFeePercent = d.adminFeePercent;
    body.adminFeeFixed = d.adminFeeFixed;
    body.settlementDays = Number(d.settlementDays) || 0;
    body.maxInstallments = Number(d.maxInstallments) || 1;
  }
  return body;
}

export function PaymentFormsPage() {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [editing, setEditing] = useState<PaymentForm | null>(null);
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState<PaymentForm | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ['payment-forms'],
    queryFn: () => api<PaymentForm[]>('/payment-forms'),
  });

  const rows = list.data ?? [];
  const { page, setPage, pageItems, totalPages } = useListPagination(rows, 20);

  const save = useMutation({
    mutationFn: async () => {
      const body = draftToBody(draft);
      if (editing) {
        return api(`/payment-forms/${editing.id}`, { method: 'PATCH', json: body });
      }
      return api('/payment-forms', { method: 'POST', json: body });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payment-forms'] });
      setCreating(false);
      setEditing(null);
      setErr(null);
    },
    onError: (e: Error) => setErr(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/payment-forms/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['payment-forms'] }),
    onError: (e: Error) => setErr(e.message),
  });

  const isCard = draft.kind === 'CARD';

  const formFields = useMemo(
    () => (
      <>
        <div className="form-row">
          <div className="field" style={{ flex: 2 }}>
            <label>Nome *</label>
            <input
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              placeholder="Ex.: Visa crédito loja"
            />
          </div>
          <div className="field">
            <label>Tipo *</label>
            <select
              value={draft.kind}
              onChange={(e) =>
                setDraft((d) => ({ ...d, kind: e.target.value as PaymentFormKind }))
              }
            >
              {(Object.keys(PAYMENT_FORM_KIND_LABELS) as PaymentFormKind[]).map((k) => (
                <option key={k} value={k}>
                  {PAYMENT_FORM_KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Ordem</label>
            <input
              value={draft.sortOrder}
              onChange={(e) => setDraft((d) => ({ ...d, sortOrder: e.target.value }))}
            />
          </div>
        </div>

        {isCard && (
          <>
            <div className="form-row">
              <div className="field">
                <label>Bandeira *</label>
                <select
                  value={draft.cardBrand}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, cardBrand: e.target.value as CardBrand }))
                  }
                >
                  {CARD_BRAND_OPTIONS.map((b) => (
                    <option key={b.value} value={b.value}>
                      {b.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Operação *</label>
                <select
                  value={draft.cardOperation}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      cardOperation: e.target.value as CardOperation,
                      maxInstallments:
                        e.target.value === 'DEBIT' ? '1' : d.maxInstallments,
                    }))
                  }
                >
                  <option value="CREDIT">Crédito</option>
                  <option value="DEBIT">Débito</option>
                </select>
              </div>
              <div className="field">
                <label>Máx. parcelas</label>
                <input
                  value={draft.maxInstallments}
                  disabled={draft.cardOperation === 'DEBIT'}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, maxInstallments: e.target.value }))
                  }
                />
              </div>
            </div>
            <div className="form-row">
              <div className="field">
                <label>Taxa adm. %</label>
                <input
                  value={draft.adminFeePercent}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, adminFeePercent: e.target.value }))
                  }
                />
              </div>
              <div className="field">
                <label>Taxa fixa (R$)</label>
                <input
                  value={draft.adminFeeFixed}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, adminFeeFixed: e.target.value }))
                  }
                />
              </div>
              <div className="field">
                <label>Dias p/ baixa (D+N)</label>
                <input
                  value={draft.settlementDays}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, settlementDays: e.target.value }))
                  }
                />
              </div>
            </div>
          </>
        )}

        <div className="field">
          <label>Observações</label>
          <input
            value={draft.notes}
            onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
          />
        </div>
        <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
            checked={draft.isActive}
            onChange={(e) => setDraft((d) => ({ ...d, isActive: e.target.checked }))}
          />
          Ativa (aparece no PDV)
        </label>
      </>
    ),
    [draft, isCard],
  );

  return (
    <div>
      <p className="page-desc">
        Cadastre as formas usadas no PDV. Para cartão, informe bandeira, crédito/débito e taxas
        administrativas — as vendas aparecerão no menu Cartões.
      </p>

      <CrudToolbar
        onInclude={() => {
          setDraft(emptyDraft());
          setEditing(null);
          setCreating(true);
          setErr(null);
        }}
        onPrint={() => window.print()}
        onReports={() => {
          /* Sem relatórios dedicados neste cadastro */
        }}
      />

      {err && <div className="alert alert-error">{err}</div>}
      {list.isLoading && <p>Carregando…</p>}

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Nome</th>
              <th>Tipo</th>
              <th>Bandeira / operação</th>
              <th className="num">Taxa %</th>
              <th>Situação</th>
              <th className="col-actions no-print">Ações</th>
            </tr>
          </thead>
          <tbody>
            {pageItems.map((r) => (
              <tr key={r.id}>
                <td>{r.name}</td>
                <td>{PAYMENT_FORM_KIND_LABELS[r.kind]}</td>
                <td>
                  {r.kind === 'CARD'
                    ? `${cardBrandLabel(r.cardBrand)} · ${cardOperationLabel(r.cardOperation)}`
                    : '—'}
                </td>
                <td className="num">
                  {r.kind === 'CARD' ? Number(r.adminFeePercent).toLocaleString('pt-BR') : '—'}
                </td>
                <td>{r.isActive ? 'Ativa' : 'Inativa'}</td>
                <td className="col-actions no-print">
                  <div className="row-record-actions">
                    <button
                      type="button"
                      className="btn btn-secondary btn-compact"
                      onClick={() => setViewing(r)}
                    >
                      Visualizar
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-compact"
                      onClick={() => {
                        setDraft(rowToDraft(r));
                        setEditing(r);
                        setCreating(true);
                        setErr(null);
                      }}
                    >
                      Alterar
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger btn-compact"
                      onClick={() => {
                        if (window.confirm(`Remover ou desativar “${r.name}”?`)) {
                          remove.mutate(r.id);
                        }
                      }}
                    >
                      Excluir
                    </button>
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
        totalItems={rows.length}
        onPageChange={setPage}
        itemLabel="forma(s)"
      />

      {creating && (
        <FormModalBackdrop
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        >
          <div className="modal" role="dialog">
            <h2>{editing ? 'Alterar forma' : 'Nova forma de pagamento'}</h2>
            {err && <div className="alert alert-error">{err}</div>}
            {formFields}
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setCreating(false);
                  setEditing(null);
                }}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={save.isPending}
                onClick={() => save.mutate()}
              >
                {save.isPending ? 'Salvando…' : 'Salvar'}
              </button>
            </div>
          </div>
        </FormModalBackdrop>
      )}

      <RecordViewModal
        open={Boolean(viewing)}
        title={`${viewing?.name ?? 'Forma'} — visualização`}
        onClose={() => setViewing(null)}
        sections={
          viewing
            ? [
                {
                  title: 'Dados da forma de pagamento',
                  fields: [
                    { label: 'Nome', value: viewing.name },
                    { label: 'Tipo', value: PAYMENT_FORM_KIND_LABELS[viewing.kind] },
                    ...(viewing.kind === 'CARD'
                      ? [
                          { label: 'Bandeira', value: cardBrandLabel(viewing.cardBrand) },
                          { label: 'Operação', value: cardOperationLabel(viewing.cardOperation) },
                          { label: 'Taxa adm. %', value: viewing.adminFeePercent },
                          { label: 'Taxa fixa (R$)', value: viewing.adminFeeFixed },
                          { label: 'Dias p/ baixa (D+N)', value: viewing.settlementDays },
                          { label: 'Máx. parcelas', value: viewing.maxInstallments },
                        ]
                      : []),
                    { label: 'Ordem', value: viewing.sortOrder },
                    { label: 'Situação', value: viewing.isActive ? 'Ativa' : 'Inativa' },
                    { label: 'Observações', value: viewing.notes },
                  ],
                },
              ]
            : []
        }
      />
    </div>
  );
}
