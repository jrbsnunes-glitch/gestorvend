import { CustomerGroupSearchCombo } from './ProductCatalogCombos';

/** Par controle mín. / máx. — layout compacto para modais de filtro. */
export function FilterControlRangeFields({
  idPrefix,
  controlMin,
  controlMax,
  onControlMinChange,
  onControlMaxChange,
  minLabel = 'Controle mín.',
  maxLabel = 'Controle máx.',
}: {
  idPrefix: string;
  controlMin: string;
  controlMax: string;
  onControlMinChange: (v: string) => void;
  onControlMaxChange: (v: string) => void;
  minLabel?: string;
  maxLabel?: string;
}) {
  return (
    <div className="form-row form-row--2 filter-modal-row">
      <div className="field">
        <label htmlFor={`${idPrefix}-cmin`}>{minLabel}</label>
        <input
          id={`${idPrefix}-cmin`}
          inputMode="numeric"
          value={controlMin}
          onChange={(e) => onControlMinChange(e.target.value)}
          placeholder="Opc."
        />
      </div>
      <div className="field">
        <label htmlFor={`${idPrefix}-cmax`}>{maxLabel}</label>
        <input
          id={`${idPrefix}-cmax`}
          inputMode="numeric"
          value={controlMax}
          onChange={(e) => onControlMaxChange(e.target.value)}
          placeholder="Opc."
        />
      </div>
    </div>
  );
}

/** Período de / até — layout compacto. */
export function FilterPeriodRangeFields({
  idPrefix,
  from,
  to,
  onFromChange,
  onToChange,
  fromLabel = 'Período de',
  toLabel = 'Período até',
}: {
  idPrefix: string;
  from: string;
  to: string;
  onFromChange: (v: string) => void;
  onToChange: (v: string) => void;
  fromLabel?: string;
  toLabel?: string;
}) {
  return (
    <div className="form-row form-row--2 filter-modal-row">
      <div className="field">
        <label htmlFor={`${idPrefix}-from`}>{fromLabel}</label>
        <input id={`${idPrefix}-from`} type="date" value={from} onChange={(e) => onFromChange(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor={`${idPrefix}-to`}>{toLabel}</label>
        <input id={`${idPrefix}-to`} type="date" value={to} onChange={(e) => onToChange(e.target.value)} />
      </div>
    </div>
  );
}

export function FilterGroupField({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="field filter-modal-row">
      <label htmlFor={id}>Grupo</label>
      <CustomerGroupSearchCombo id={id} value={value} onChange={onChange} />
    </div>
  );
}

/** Botões padrão dos modais de filtro. */
export function FilterModalActions({
  onClear,
  onCancel,
  onApply,
}: {
  onClear: () => void;
  onCancel: () => void;
  onApply: () => void;
}) {
  return (
    <div className="modal-actions">
      <button type="button" className="btn btn-ghost" onClick={onClear}>
        Limpar
      </button>
      <button type="button" className="btn btn-secondary" onClick={onCancel}>
        Cancelar
      </button>
      <button type="button" className="btn btn-primary" onClick={onApply}>
        Aplicar
      </button>
    </div>
  );
}
