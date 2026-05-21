import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { CostCenterSelect } from './CostCenterSelect';
import { api } from '../lib/api';

const PAYMENT_IN_LABELS: Record<string, string> = {
  CASH: 'Dinheiro',
  CARD: 'Cartão',
  PIX: 'Pix',
  OTHER: 'Outro',
};

type MovOutKind = 'WITHDRAWAL' | 'EXPENSE';

type Props = {
  open: boolean;
  onClose: () => void;
};

export function BalanceMovementModal({ open, onClose }: Props) {
  const qc = useQueryClient();
  const [movType, setMovType] = useState<'IN' | 'OUT'>('OUT');
  const [movOutKind, setMovOutKind] = useState<MovOutKind>('WITHDRAWAL');
  const [inMethod, setInMethod] = useState('PIX');
  const [amount, setAmount] = useState('');
  const [referentialAccountId, setReferentialAccountId] = useState('');
  const [notes, setNotes] = useState('');
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setMovType('OUT');
    setMovOutKind('WITHDRAWAL');
    setInMethod('PIX');
    setAmount('');
    setReferentialAccountId('');
    setNotes('');
    setErr(null);
  }, [open]);

  useEffect(() => {
    if (movType === 'IN') {
      setMovOutKind('WITHDRAWAL');
      setReferentialAccountId('');
    }
  }, [movType]);

  const movement = useMutation({
    mutationFn: () => {
      const v = parseFloat(String(amount).replace(',', '.')) || 0;
      if (v <= 0) throw new Error('Informe um valor válido.');
      if (movType === 'OUT' && movOutKind === 'EXPENSE' && !referentialAccountId.trim()) {
        throw new Error('Selecione o centro de custo para despesas.');
      }
      const json: Record<string, unknown> = {
        type: movType,
        amount: v,
        reason: notes.trim() || null,
      };
      if (movType === 'IN') {
        json.method = inMethod;
      } else if (movOutKind === 'EXPENSE') {
        json.method = 'EXPENSE';
        json.referentialAccountId = referentialAccountId.trim();
      } else {
        json.method = null;
      }
      return api('/cash/movement', { method: 'POST', json });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['financial-overview'] });
      qc.invalidateQueries({ queryKey: ['cash'] });
      onClose();
    },
    onError: (e: Error) => setErr(e.message),
  });

  if (!open) return null;

  return (
    <div className="modal-backdrop no-print" role="presentation" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-labelledby="bal-mov-title"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(480px, 96vw)' }}
      >
        <h2 id="bal-mov-title" style={{ fontSize: '1.15rem', marginTop: 0 }}>
          Novo lançamento de caixa
        </h2>
        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.88rem', marginTop: 0 }}>
          Mesmo fluxo do pagamento no financeiro: valor, forma e, em despesas, centro de custo no plano
          referencial. É necessário ter um <strong>caixa aberto</strong> para o seu usuário.
        </p>
        {err && <div className="alert alert-error">{err}</div>}

        <div className="field">
          <label htmlFor="bal-mov-type">Tipo *</label>
          <select
            id="bal-mov-type"
            value={movType}
            onChange={(e) => setMovType(e.target.value as 'IN' | 'OUT')}
          >
            <option value="IN">Entrada</option>
            <option value="OUT">Saída</option>
          </select>
        </div>

        {movType === 'OUT' ? (
          <div className="field">
            <label htmlFor="bal-mov-out-kind">Natureza da saída *</label>
            <select
              id="bal-mov-out-kind"
              value={movOutKind}
              onChange={(e) => setMovOutKind(e.target.value as MovOutKind)}
            >
              <option value="WITHDRAWAL">Sangria / retirada (sem centro de custo)</option>
              <option value="EXPENSE">Despesa classificada (centro de custo obrigatório)</option>
            </select>
          </div>
        ) : null}

        <div className="field">
          <label htmlFor="bal-mov-amt">Valor *</label>
          <input
            id="bal-mov-amt"
            type="number"
            step="0.01"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>

        {movType === 'IN' ? (
          <div className="field">
            <label htmlFor="bal-mov-method-in">Forma de pagamento *</label>
            <select
              id="bal-mov-method-in"
              value={inMethod}
              onChange={(e) => setInMethod(e.target.value)}
            >
              {Object.entries(PAYMENT_IN_LABELS).map(([k, lab]) => (
                <option key={k} value={k}>
                  {lab}
                </option>
              ))}
            </select>
          </div>
        ) : movOutKind === 'EXPENSE' ? (
          <>
            <div className="field">
              <label htmlFor="bal-mov-method-exp">Forma</label>
              <input id="bal-mov-method-exp" value="Despesas (classificação no plano)" readOnly disabled />
            </div>
            <CostCenterSelect
              flow="EXPENSE"
              id="bal-mov-cc"
              value={referentialAccountId}
              onChange={setReferentialAccountId}
              emptyLabel="— Selecione —"
              label="Centro de custo — plano referencial (grupos 4 e 5) *"
            />
          </>
        ) : (
          <p style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', margin: '0 0 0.5rem' }}>
            Sangria não usa forma de pagamento nem centro de custo.
          </p>
        )}

        <div className="field">
          <label htmlFor="bal-mov-notes">Observações</label>
          <textarea
            id="bal-mov-notes"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Motivo, referência, comprovante…"
          />
        </div>

        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={movement.isPending}
            onClick={() => movement.mutate()}
          >
            Confirmar
          </button>
        </div>
      </div>
    </div>
  );
}
