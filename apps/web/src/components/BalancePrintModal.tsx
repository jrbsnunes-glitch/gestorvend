import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useModalEscapeKey } from '../lib/useModalEscapeKey';

type ReportKind = 'balance' | 'profitability';

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
  const [reportKind, setReportKind] = useState<ReportKind>('balance');

  useEffect(() => {
    if (!open) return;
    setFrom(initialFrom);
    setTo(initialTo);
    setCostCenterId(initialCostCenterId);
    setReportKind('balance');
  }, [open, initialFrom, initialTo, initialCostCenterId]);

  useModalEscapeKey(onClose, open);

  if (!open) return null;

  function openReport() {
    if (!from.trim() || !to.trim()) return;

    if (reportKind === 'profitability') {
      const p = new URLSearchParams({ from, to });
      navigate(`/balanco/rentabilidade?${p.toString()}`);
      onClose();
      return;
    }

    const p = new URLSearchParams();
    p.set('from', from);
    p.set('to', to);
    if (costCenterId.trim()) p.set('costCenterId', costCenterId.trim());
    p.set('summary', '1');
    p.set('notes', '1');
    p.set('movements', '1');
    p.set('ledger', '0');
    navigate(`/balanco/impressao?${p.toString()}`);
    onClose();
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <div
        className="modal"
        role="dialog"
        aria-labelledby="bal-print-title"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(520px, 96vw)' }}
      >
        <h2 id="bal-print-title" style={{ fontSize: '1.15rem', marginTop: 0 }}>
          Impressões — balanço
        </h2>
        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.88rem', marginTop: 0 }}>
          Escolha o relatório e o período. A visualização abre nesta aba, pronta para imprimir (Ctrl+P).
        </p>

        <div className="field">
          <span id="bal-print-kind-label" style={{ fontWeight: 600, fontSize: '0.88rem' }}>
            Relatório
          </span>
          <div
            role="radiogroup"
            aria-labelledby="bal-print-kind-label"
            style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', marginTop: '0.35rem' }}
          >
            <label style={{ display: 'flex', gap: '0.45rem', alignItems: 'flex-start', cursor: 'pointer' }}>
              <input
                type="radio"
                name="bal-report-kind"
                checked={reportKind === 'balance'}
                onChange={() => setReportKind('balance')}
              />
              <span>
                <strong>Resumo do balanço</strong>
                <span style={{ display: 'block', fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>
                  Caixa, diário, movimentos e totais do período.
                </span>
              </span>
            </label>
            <label style={{ display: 'flex', gap: '0.45rem', alignItems: 'flex-start', cursor: 'pointer' }}>
              <input
                type="radio"
                name="bal-report-kind"
                checked={reportKind === 'profitability'}
                onChange={() => setReportKind('profitability')}
              />
              <span>
                <strong>Rentabilidade</strong>
                <span style={{ display: 'block', fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>
                  DRE gerencial, margens, NFC-e autorizadas e totais dos caixas fechados.
                </span>
              </span>
            </label>
          </div>
        </div>

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

        {reportKind === 'balance' && (
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
        )}

        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Fechar
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!from.trim() || !to.trim()}
            onClick={openReport}
          >
            {reportKind === 'profitability' ? 'Abrir rentabilidade' : 'Abrir para imprimir'}
          </button>
        </div>
      </div>
    </div>
  );
}
