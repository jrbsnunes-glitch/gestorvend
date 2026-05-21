import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

type Props = {
  open: boolean;
  onClose: () => void;
  /** Ao abrir, estes valores preenchem o formulário. */
  initialFrom: string;
  initialTo: string;
  initialCostCenterId: string;
  costCenters: Array<{ id: string; code: string; description: string }>;
};

/**
 * Mesmo padrão do modal de impressões do Financeiro: período, filtros e navegação
 * para a tela de relatório nesta aba.
 */
export function BalancePrintModal({
  open,
  onClose,
  initialFrom,
  initialTo,
  initialCostCenterId,
  costCenters,
}: Props) {
  const navigate = useNavigate();
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [costCenterId, setCostCenterId] = useState(initialCostCenterId);

  useEffect(() => {
    if (!open) return;
    setFrom(initialFrom);
    setTo(initialTo);
    setCostCenterId(initialCostCenterId);
  }, [open, initialFrom, initialTo, initialCostCenterId]);

  if (!open) return null;

  function goToReport() {
    const p = new URLSearchParams();
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    if (costCenterId.trim()) p.set('costCenterId', costCenterId.trim());
    p.set('summary', '1');
    p.set('notes', '1');
    p.set('movements', '1');
    p.set('ledger', '0');
    navigate(`/balanco/impressao?${p.toString()}`);
    onClose();
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-labelledby="bal-print-title"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(520px, 96vw)' }}
      >
        <h2 id="bal-print-title" style={{ fontSize: '1.15rem', marginTop: 0 }}>
          Impressões — balanço financeiro
        </h2>
        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.88rem', marginTop: 0 }}>
          Exibe o relatório nesta aba, pronto para imprimir (Ctrl+P).
        </p>

        <div className="form-row">
          <div className="field">
            <label htmlFor="bal-print-from">De</label>
            <input id="bal-print-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="bal-print-to">Até</label>
            <input id="bal-print-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="bal-print-cc">Centro de custo</label>
          <select
            id="bal-print-cc"
            value={costCenterId}
            onChange={(e) => setCostCenterId(e.target.value)}
          >
            <option value="">Todos</option>
            {costCenters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} — {c.description}
              </option>
            ))}
          </select>
        </div>

        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Fechar
          </button>
          <button type="button" className="btn btn-primary" onClick={goToReport}>
            Abrir para imprimir
          </button>
        </div>
      </div>
    </div>
  );
}
