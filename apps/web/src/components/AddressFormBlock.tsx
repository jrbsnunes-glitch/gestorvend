import { useState, type ReactNode } from 'react';
import { formatCep } from '../lib/format';
import { lookupCep } from '../lib/lookups';

export type AddressFormFields = {
  zip: string;
  street: string;
  number: string;
  complement: string;
  district: string;
  city: string;
  state: string;
};

type Props = {
  idPrefix: string;
  value: AddressFormFields;
  onChange: (patch: Partial<AddressFormFields>) => void;
  /** Campo extra após o endereço (ex.: limite de crédito). */
  extra?: ReactNode;
};

export function AddressFormBlock({ idPrefix, value, onChange, extra }: Props) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function buscarCep() {
    setMsg(null);
    const digits = value.zip.replace(/\D/g, '');
    if (digits.length !== 8) {
      setMsg('Informe um CEP com 8 dígitos.');
      return;
    }
    setBusy(true);
    try {
      const data = await lookupCep(digits);
      onChange({
        zip: formatCep(data.zip),
        street: data.street || value.street,
        complement: data.complement || value.complement,
        district: data.district || value.district,
        city: data.city || value.city,
        state: data.state || value.state,
      });
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Falha ao consultar CEP.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="form-row" style={{ alignItems: 'flex-end' }}>
        <div className="field" style={{ flex: '0 0 9rem' }}>
          <label htmlFor={`${idPrefix}-zip`}>CEP</label>
          <input
            id={`${idPrefix}-zip`}
            value={value.zip}
            onChange={(e) => onChange({ zip: formatCep(e.target.value) })}
            onBlur={() => {
              if (value.zip.replace(/\D/g, '').length === 8) void buscarCep();
            }}
            inputMode="numeric"
            autoComplete="postal-code"
          />
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          style={{ marginBottom: '0.15rem' }}
          disabled={busy}
          onClick={() => void buscarCep()}
        >
          {busy ? 'Buscando…' : 'Buscar CEP'}
        </button>
      </div>
      {msg && (
        <div className="alert alert-error" style={{ marginTop: 0 }}>
          {msg}
        </div>
      )}
      <div className="field">
        <label htmlFor={`${idPrefix}-street`}>Logradouro</label>
        <input
          id={`${idPrefix}-street`}
          value={value.street}
          onChange={(e) => onChange({ street: e.target.value })}
          autoComplete="street-address"
        />
      </div>
      <div className="form-row">
        <div className="field" style={{ flex: '0 0 7rem' }}>
          <label htmlFor={`${idPrefix}-num`}>Número</label>
          <input
            id={`${idPrefix}-num`}
            value={value.number}
            onChange={(e) => onChange({ number: e.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor={`${idPrefix}-comp`}>Complemento</label>
          <input
            id={`${idPrefix}-comp`}
            value={value.complement}
            onChange={(e) => onChange({ complement: e.target.value })}
          />
        </div>
      </div>
      <div className="field">
        <label htmlFor={`${idPrefix}-dist`}>Bairro</label>
        <input
          id={`${idPrefix}-dist`}
          value={value.district}
          onChange={(e) => onChange({ district: e.target.value })}
        />
      </div>
      <div className="form-row">
        <div className="field">
          <label htmlFor={`${idPrefix}-city`}>Cidade</label>
          <input
            id={`${idPrefix}-city`}
            value={value.city}
            onChange={(e) => onChange({ city: e.target.value })}
          />
        </div>
        <div className="field" style={{ flex: '0 0 5rem' }}>
          <label htmlFor={`${idPrefix}-uf`}>UF</label>
          <input
            id={`${idPrefix}-uf`}
            value={value.state}
            onChange={(e) => onChange({ state: e.target.value.toUpperCase().slice(0, 2) })}
            maxLength={2}
          />
        </div>
      </div>
      {extra}
    </>
  );
}

export const EMPTY_ADDRESS: AddressFormFields = {
  zip: '',
  street: '',
  number: '',
  complement: '',
  district: '',
  city: '',
  state: '',
};
