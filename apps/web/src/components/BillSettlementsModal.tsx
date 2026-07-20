import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { CSSProperties } from 'react';
import { FormModalBackdrop } from './FormModalBackdrop';
import { CostCenterSelect } from './CostCenterSelect';
import { api } from '../lib/api';
import {
  type BillKind,
  type BillSettlementRow,
  type BillWithSettlements,
  PAYMENT_LABELS,
  saldoAbertoBill,
  settlementDateIso,
} from '../lib/finance-bills';
import { formatBRL, formatDate } from '../lib/format';

type EditForm = {
  amount: string;
  method: string;
  settledAt: string;
  notes: string;
  referentialAccountId: string;
};

function emptyEditForm(): EditForm {
  return {
    amount: '',
    method: 'PIX',
    settledAt: '',
    notes: '',
    referentialAccountId: '',
  };
}

function toEditForm(row: BillSettlementRow, kind: BillKind): EditForm {
  return {
    amount: String(row.amount),
    method: row.method ?? 'OTHER',
    settledAt: settlementDateIso(row, kind),
    notes: row.notes ?? '',
    referentialAccountId: row.referentialAccount?.id ?? '',
  };
}

export type BillSettlementsModalProps = {
  kind: BillKind;
  billId: string;
  description?: string;
  onClose: () => void;
};

export function BillSettlementsModal({ kind, billId, description, onClose }: BillSettlementsModalProps) {
  const qc = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditForm>(emptyEditForm());
  const [editErr, setEditErr] = useState<string | null>(null);

  const endpoint = kind === 'pagar' ? `/finance/payables/${billId}` : `/finance/receivables/${billId}`;

  const bill = useQuery({
    queryKey: ['finance', 'bill-settlements', kind, billId],
    queryFn: () => api<BillWithSettlements>(endpoint),
  });

  const updateSettlement = useMutation({
    mutationFn: ({
      settlementId,
      payload,
    }: {
      settlementId: string;
      payload: Record<string, unknown>;
    }) => {
      const path =
        kind === 'pagar'
          ? `/finance/payable-settlements/${settlementId}`
          : `/finance/receivable-settlements/${settlementId}`;
      return api(path, { method: 'PATCH', json: payload });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['finance', 'bill-settlements', kind, billId] });
      qc.invalidateQueries({ queryKey: ['payables'] });
      qc.invalidateQueries({ queryKey: ['receivables'] });
      qc.invalidateQueries({ queryKey: ['finance', 'payable'] });
      qc.invalidateQueries({ queryKey: ['finance', 'receivable'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      setEditingId(null);
      setEditForm(emptyEditForm());
      setEditErr(null);
    },
    onError: (e: Error) => setEditErr(e.message),
  });

  const data = bill.data;
  const settlements = data?.settlements ?? [];
  const flow = kind === 'pagar' ? 'OUT' : 'IN';

  function startEdit(row: BillSettlementRow) {
    setEditingId(row.id);
    setEditForm(toEditForm(row, kind));
    setEditErr(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditForm(emptyEditForm());
    setEditErr(null);
  }

  function saveEdit() {
    if (!editingId) return;
    const amt = parseFloat(String(editForm.amount).replace(',', '.'));
    if (!Number.isFinite(amt) || amt <= 0) {
      setEditErr('Informe um valor válido.');
      return;
    }
    updateSettlement.mutate({
      settlementId: editingId,
      payload: {
        amount: amt,
        method: editForm.method,
        settledAt: editForm.settledAt ? new Date(editForm.settledAt).toISOString() : undefined,
        notes: editForm.notes.trim() === '' ? null : editForm.notes.trim(),
        referentialAccountId: editForm.referentialAccountId.trim() || null,
      },
    });
  }

  return (
    <FormModalBackdrop onClose={onClose}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(720px, 96vw)', maxHeight: '90vh', overflow: 'auto' }}
      >
        <h2 style={{ fontSize: '1.15rem' }}>
          {kind === 'pagar' ? 'Pagamentos informados' : 'Recebimentos informados'}
        </h2>
        {description && (
          <p style={{ color: 'var(--color-text-muted)', fontSize: '0.88rem', marginTop: 0 }}>
            {description}
          </p>
        )}

        {bill.isLoading && <p>Carregando…</p>}
        {bill.isError && <div className="alert alert-error">{(bill.error as Error).message}</div>}

        {data && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
              gap: '0.65rem',
              marginBottom: '1rem',
              fontSize: '0.88rem',
            }}
          >
            <div>
              <div style={{ color: 'var(--color-text-muted)' }}>Valor (face)</div>
              <strong>{formatBRL(data.amount)}</strong>
            </div>
            <div>
              <div style={{ color: 'var(--color-text-muted)' }}>Saldo em aberto</div>
              <strong>{formatBRL(saldoAbertoBill(data))}</strong>
            </div>
            <div>
              <div style={{ color: 'var(--color-text-muted)' }}>Vencimento</div>
              <strong>{formatDate(data.dueDate)}</strong>
            </div>
          </div>
        )}

        {!bill.isLoading && data && !settlements.length && (
          <p className="empty">Nenhum pagamento registrado neste título.</p>
        )}

        {settlements.length > 0 && (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Valor</th>
                  <th>Forma</th>
                  <th>Centro de custo</th>
                  <th>Caixa</th>
                  <th>Observações</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {settlements.map((s) => {
                  const dateRaw = kind === 'pagar' ? s.paidAt : s.receivedAt;
                  return (
                    <tr key={s.id}>
                      <td style={{ whiteSpace: 'nowrap' }}>{dateRaw ? formatDate(dateRaw) : '—'}</td>
                      <td>{formatBRL(s.amount)}</td>
                      <td>{s.method ? PAYMENT_LABELS[s.method] ?? s.method : '—'}</td>
                      <td style={{ fontSize: '0.82rem' }}>
                        {s.referentialAccount
                          ? `${s.referentialAccount.code} — ${s.referentialAccount.description}`
                          : '—'}
                      </td>
                      <td style={{ fontSize: '0.82rem' }}>
                        {s.cashSession
                          ? `#${s.cashSession.controlNumber}${s.cashSession.user ? ` (${s.cashSession.user.name})` : ''}`
                          : '—'}
                      </td>
                      <td style={{ fontSize: '0.82rem', maxWidth: '12rem' }}>{s.notes ?? '—'}</td>
                      <td style={{ textAlign: 'right' }}>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          style={{ fontSize: '0.82rem' }}
                          onClick={() => startEdit(s)}
                        >
                          Editar
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {editingId && (
          <div
            style={{
              marginTop: '1rem',
              padding: '0.85rem',
              border: '1px solid var(--color-border)',
              borderRadius: 8,
            }}
          >
            <h3 style={{ margin: '0 0 0.65rem', fontSize: '1rem' }}>Editar pagamento</h3>
            {editErr && <div className="alert alert-error">{editErr}</div>}
            <div className="form-row">
              <div className="field">
                <label htmlFor="ed-amt">Valor *</label>
                <input
                  id="ed-amt"
                  type="number"
                  step="0.01"
                  min="0"
                  value={editForm.amount}
                  onChange={(e) => setEditForm({ ...editForm, amount: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="ed-dt">Data/hora</label>
                <input
                  id="ed-dt"
                  type="datetime-local"
                  value={editForm.settledAt}
                  onChange={(e) => setEditForm({ ...editForm, settledAt: e.target.value })}
                />
              </div>
            </div>
            <div className="field">
              <label htmlFor="ed-method">Forma</label>
              <select
                id="ed-method"
                value={editForm.method}
                onChange={(e) => setEditForm({ ...editForm, method: e.target.value })}
              >
                {Object.entries(PAYMENT_LABELS)
                  .filter(([k]) => k !== 'EXPENSE')
                  .map(([k, lab]) => (
                    <option key={k} value={k}>
                      {lab}
                    </option>
                  ))}
              </select>
            </div>
            <CostCenterSelect
              flow={flow}
              id="ed-cost"
              value={editForm.referentialAccountId}
              onChange={(v) => setEditForm({ ...editForm, referentialAccountId: v })}
              label={
                kind === 'pagar'
                  ? 'Centro de custo (opcional)'
                  : 'Centro de custo / receita (opcional)'
              }
            />
            <div className="field">
              <label htmlFor="ed-notes">Observações</label>
              <textarea
                id="ed-notes"
                rows={2}
                value={editForm.notes}
                onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
              />
            </div>
            <div className="modal-actions" style={{ marginTop: '0.5rem' }}>
              <button type="button" className="btn btn-secondary" onClick={cancelEdit}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={updateSettlement.isPending}
                onClick={saveEdit}
              >
                Salvar alterações
              </button>
            </div>
          </div>
        )}

        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Fechar
          </button>
        </div>
      </div>
    </FormModalBackdrop>
  );
}

export type BillPaymentsButtonProps = {
  kind: BillKind;
  billId: string;
  description?: string;
  className?: string;
  style?: CSSProperties;
  label?: string;
};

export function BillPaymentsButton({
  kind,
  billId,
  description,
  className = 'btn btn-ghost',
  style,
  label = 'Pagamentos',
}: BillPaymentsButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className={className}
        style={{ fontSize: '0.82rem', ...style }}
        onClick={() => setOpen(true)}
      >
        {label}
      </button>
      {open && (
        <BillSettlementsModal
          kind={kind}
          billId={billId}
          description={description}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
