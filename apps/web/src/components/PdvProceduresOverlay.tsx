import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { CostCenterSelect } from './CostCenterSelect';
import { api } from '../lib/api';
import '../pages/pos.css';

export type PdvProcedureKind = 'WITHDRAWAL' | 'EXPENSE' | 'SUPPLY';

type Props = {
  open: boolean;
  onClose: () => void;
  onSuccess?: (msg: string) => void;
  /** Caixa alvo — gerente pode lançar no caixa aberto de outro operador. */
  sessionId?: string | null;
  /** Rótulo do caixa alvo (ex.: «#12 · Rayelle») exibido no cabeçalho. */
  sessionLabel?: string | null;
};

const KIND_LABEL: Record<PdvProcedureKind, string> = {
  WITHDRAWAL: 'Retirada / Sangria',
  EXPENSE: 'Despesas',
  SUPPLY: 'Suprimentos / Fundo',
};

/**
 * Overlay do PDV (F3): sangria, despesa (caixa aberto) ou suprimento.
 * Usa POST /cash/movement — no caixa OPEN do operador logado ou, quando
 * `sessionId` é informado por um gerente, no caixa de outro operador.
 */
export function PdvProceduresOverlay({
  open,
  onClose,
  onSuccess,
  sessionId = null,
  sessionLabel = null,
}: Props) {
  const qc = useQueryClient();
  const amountRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<'pick' | 'form'>('pick');
  const [kind, setKind] = useState<PdvProcedureKind | null>(null);
  const [amount, setAmount] = useState('');
  const [referentialAccountId, setReferentialAccountId] = useState('');
  const [notes, setNotes] = useState('');
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setStep('pick');
    setKind(null);
    setAmount('');
    setReferentialAccountId('');
    setNotes('');
    setErr(null);
  }, [open]);

  useEffect(() => {
    if (!open || step !== 'form') return;
    const t = window.setTimeout(() => amountRef.current?.focus(), 50);
    return () => window.clearTimeout(t);
  }, [open, step]);

  useEffect(() => {
    if (!open) return;
    function onKey(ev: KeyboardEvent) {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        if (step === 'form') {
          setStep('pick');
          setKind(null);
          setErr(null);
        } else {
          onClose();
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, step, onClose]);

  const movement = useMutation({
    mutationFn: () => {
      if (!kind) throw new Error('Escolha o procedimento.');
      const v = parseFloat(String(amount).replace(',', '.')) || 0;
      if (v <= 0) throw new Error('Informe um valor válido.');
      if (kind === 'EXPENSE' && !referentialAccountId.trim()) {
        throw new Error('Selecione o centro de custo para despesas.');
      }
      const json: Record<string, unknown> = {
        amount: v,
        reason: notes.trim() || null,
        ...(sessionId ? { sessionId } : {}),
      };
      if (kind === 'SUPPLY') {
        json.type = 'IN';
      } else if (kind === 'EXPENSE') {
        json.type = 'OUT';
        json.method = 'EXPENSE';
        json.referentialAccountId = referentialAccountId.trim();
      } else {
        json.type = 'OUT';
        json.method = null;
      }
      return api('/cash/movement', { method: 'POST', json });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cash', 'session'] });
      qc.invalidateQueries({ queryKey: ['cash', 'sessions'] });
      qc.invalidateQueries({ queryKey: ['cash'] });
      const label = kind ? KIND_LABEL[kind] : 'Procedimento';
      onSuccess?.(
        sessionLabel
          ? `${label} registrado(a) no caixa ${sessionLabel}.`
          : `${label} registrado(a) no caixa aberto.`,
      );
      onClose();
    },
    onError: (e: Error) => setErr(e.message),
  });

  if (!open) return null;

  function choose(k: PdvProcedureKind) {
    setKind(k);
    setStep('form');
    setErr(null);
    setAmount('');
    setReferentialAccountId('');
    setNotes('');
  }

  return (
    <div className="pos-payment-overlay pos-procedures-overlay" role="dialog" aria-modal="true">
      <div className="pos-payment-shell" style={{ maxWidth: 520 }}>
        <div className="pos-payment-header">
          <div>
            <span className="pos-payment-eyebrow">
              {sessionLabel ? `Caixa ${sessionLabel}` : 'Caixa aberto'}
            </span>
            <h2>Procedimentos</h2>
          </div>
          <button type="button" className="pos-btn pos-btn-ghost" onClick={onClose}>
            ✕ Fechar <span className="pos-shortcut-key">Esc</span>
          </button>
        </div>

        {step === 'pick' ? (
          <div className="pos-procedures-pick">
            <p className="pos-procedures-lead">
              {sessionLabel
                ? `Lançamentos no caixa ${sessionLabel}. Despesas ficam atreladas a essa sessão.`
                : 'Lançamentos no seu caixa atual. Despesas ficam atreladas à sessão aberta.'}
            </p>
            <button type="button" className="pos-procedures-tile" onClick={() => choose('WITHDRAWAL')}>
              <strong>Retirada / Sangria</strong>
              <span>Saída de dinheiro sem centro de custo</span>
            </button>
            <button type="button" className="pos-procedures-tile" onClick={() => choose('EXPENSE')}>
              <strong>Despesas</strong>
              <span>Saída classificada (centro de custo obrigatório)</span>
            </button>
            <button type="button" className="pos-procedures-tile" onClick={() => choose('SUPPLY')}>
              <strong>Suprimentos / Fundo</strong>
              <span>Entrada de dinheiro no caixa (fundo de troco)</span>
            </button>
          </div>
        ) : (
          <div className="pos-procedures-form">
            <button
              type="button"
              className="pos-btn pos-btn-ghost"
              style={{ marginBottom: '0.75rem' }}
              onClick={() => {
                setStep('pick');
                setKind(null);
                setErr(null);
              }}
            >
              ← Voltar
            </button>
            <h3 style={{ margin: '0 0 0.75rem', fontSize: '1.05rem' }}>
              {kind ? KIND_LABEL[kind] : ''}
            </h3>
            {err && <div className="alert alert-error">{err}</div>}
            <div className="field">
              <label htmlFor="pdv-proc-amt">Valor (R$) *</label>
              <input
                ref={amountRef}
                id="pdv-proc-amt"
                type="number"
                step="0.01"
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    movement.mutate();
                  }
                }}
              />
            </div>
            {kind === 'EXPENSE' ? (
              <CostCenterSelect
                flow="EXPENSE"
                id="pdv-proc-cc"
                value={referentialAccountId}
                onChange={setReferentialAccountId}
                allowEmpty={false}
                emptyLabel="— Selecione —"
                label="Centro de custo *"
              />
            ) : null}
            <div className="field">
              <label htmlFor="pdv-proc-notes">Observações</label>
              <input
                id="pdv-proc-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Motivo, referência…"
              />
            </div>
            <div className="modal-actions" style={{ marginTop: '1rem' }}>
              <button type="button" className="btn btn-secondary" onClick={onClose}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={movement.isPending}
                onClick={() => movement.mutate()}
              >
                {movement.isPending ? 'Registrando…' : 'Registrar'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
