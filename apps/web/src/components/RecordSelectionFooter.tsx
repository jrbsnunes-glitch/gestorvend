import { useNavigate } from 'react-router-dom';
import './crud-toolbar.css';

type Props = {
  partyLabel: string;
  partyType: 'customer' | 'supplier';
  partyId: string;
  onClear: () => void;
};

export function RecordSelectionFooter({ partyLabel, partyType, partyId, onClear }: Props) {
  const navigate = useNavigate();
  const encodedName = encodeURIComponent(partyLabel);

  function goFinance() {
    if (partyType === 'customer') {
      navigate(
        `/financeiro?tab=receber&customerId=${encodeURIComponent(partyId)}&partyName=${encodedName}`,
      );
      return;
    }
    navigate(
      `/financeiro?tab=pagar&supplierId=${encodeURIComponent(partyId)}&partyName=${encodedName}`,
    );
  }

  function goFiscalNotes() {
    const param =
      partyType === 'customer'
        ? `customerId=${encodeURIComponent(partyId)}`
        : `supplierId=${encodeURIComponent(partyId)}`;
    navigate(`/notas-fiscais?${param}&partyName=${encodedName}`);
  }

  return (
    <footer className="record-selection-footer no-print" role="region" aria-label="Ações do registro selecionado">
      <div className="record-selection-footer__info">
        <span className="record-selection-footer__label">Selecionado</span>
        <strong className="record-selection-footer__name">{partyLabel}</strong>
      </div>
      <div className="record-selection-footer__actions">
        <button type="button" className="btn btn-primary" onClick={goFinance}>
          {partyType === 'customer' ? 'Contas a receber' : 'Contas a pagar'}
        </button>
        <button type="button" className="btn btn-secondary" onClick={goFiscalNotes}>
          Notas Fiscais
        </button>
        <button type="button" className="btn btn-ghost" onClick={onClear}>
          Limpar seleção
        </button>
      </div>
    </footer>
  );
}
