/**
 * Edição do cadastro do cliente por cima da nota (sem abrir outra janela).
 * No Desktop, window.open não recebe o clique do formulário.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { AddressFormBlock, type AddressFormFields } from './AddressFormBlock';
import { FormModalBackdrop } from './FormModalBackdrop';
import { api } from '../lib/api';
import { validateDocumentIfCpf } from '../lib/cpf';
import { formatCep, formatCpfCnpj } from '../lib/format';

type Customer = {
  id: string;
  name: string;
  document: string | null;
  ie: string | null;
  email: string | null;
  phone: string | null;
  street: string | null;
  number: string | null;
  complement: string | null;
  district: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  cityIbge: string | null;
};

const EMPTY_ADDRESS: AddressFormFields = {
  zip: '',
  street: '',
  number: '',
  complement: '',
  district: '',
  city: '',
  state: '',
  cityIbge: '',
};

export function CustomerCadastroModal({
  customerId,
  onClose,
  onSaved,
}: {
  customerId: string;
  onClose: () => void;
  onSaved?: (customer: { id: string; name: string }) => void;
}) {
  const qc = useQueryClient();
  const hydrated = useRef(false);
  const [name, setName] = useState('');
  const [document, setDocument] = useState('');
  const [ie, setIe] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [addr, setAddr] = useState<AddressFormFields>(EMPTY_ADDRESS);
  const [err, setErr] = useState<string | null>(null);

  const detail = useQuery({
    queryKey: ['customers', customerId, 'note-cadastro'],
    queryFn: () => api<Customer>(`/customers/${customerId}`),
  });

  useEffect(() => {
    const c = detail.data;
    if (!c || hydrated.current) return;
    hydrated.current = true;
    setName(c.name);
    setDocument(c.document ? formatCpfCnpj(c.document) : '');
    setIe(c.ie ?? '');
    setEmail(c.email ?? '');
    setPhone(c.phone ?? '');
    setAddr({
      zip: c.zip ? formatCep(c.zip) : '',
      street: c.street ?? '',
      number: c.number ?? '',
      complement: c.complement ?? '',
      district: c.district ?? '',
      city: c.city ?? '',
      state: c.state ?? '',
      cityIbge: c.cityIbge ?? '',
    });
  }, [detail.data]);

  const isPj = document.replace(/\D/g, '').length === 14;

  const save = useMutation({
    mutationFn: () => {
      const docErr = validateDocumentIfCpf(document);
      if (!name.trim()) throw new Error('Informe o nome do cliente.');
      if (docErr) throw new Error(docErr);
      return api<Customer>(`/customers/${customerId}`, {
        method: 'PATCH',
        json: {
          name: name.trim(),
          document: document.replace(/\D/g, '') || null,
          ie: isPj ? ie.trim() || null : null,
          email: email.trim() || null,
          phone: phone.trim() || null,
          street: addr.street.trim() || null,
          number: addr.number.trim() || null,
          complement: addr.complement.trim() || null,
          district: addr.district.trim() || null,
          city: addr.city.trim() || null,
          state: addr.state.trim() || null,
          zip: addr.zip.replace(/\D/g, '') || null,
          cityIbge: addr.cityIbge.replace(/\D/g, '').slice(0, 7) || null,
        },
      });
    },
    onSuccess: (saved) => {
      void qc.invalidateQueries({ queryKey: ['customers'] });
      onSaved?.({ id: saved.id, name: saved.name });
      onClose();
    },
    onError: (e: Error) => setErr(e.message),
  });

  return (
    <FormModalBackdrop className="modal-backdrop--nested modal-backdrop--cadastro" onClose={onClose}>
      <div className="modal form-cadastro-modal" role="dialog" aria-labelledby="note-customer-cadastro-title">
        <h2 id="note-customer-cadastro-title">Cadastro do cliente</h2>
        <p className="page-desc" style={{ marginTop: 0 }}>
          Endereço, documento e inscrição estadual usados na NF-e. Salve aqui e reenvie a nota.
        </p>
        {detail.isError ? (
          <div className="alert alert-error">{(detail.error as Error).message}</div>
        ) : null}
        {err ? <div className="alert alert-error">{err}</div> : null}
        {detail.isPending ? (
          <p>Carregando cadastro…</p>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setErr(null);
              save.mutate();
            }}
          >
            <div className="field">
              <label htmlFor="note-cli-name">Nome *</label>
              <input id="note-cli-name" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="form-row">
              <div className="field">
                <label htmlFor="note-cli-doc">CPF/CNPJ</label>
                <input
                  id="note-cli-doc"
                  value={document}
                  onChange={(e) => setDocument(formatCpfCnpj(e.target.value))}
                  inputMode="numeric"
                />
              </div>
              {isPj ? (
                <div className="field">
                  <label htmlFor="note-cli-ie">Inscrição estadual</label>
                  <input
                    id="note-cli-ie"
                    value={ie}
                    onChange={(e) => setIe(e.target.value.toUpperCase().replace(/[^0-9A-Z./-]/g, ''))}
                    placeholder="Números ou ISENTO"
                    maxLength={20}
                    autoComplete="off"
                  />
                </div>
              ) : null}
            </div>
            <div className="form-row">
              <div className="field">
                <label htmlFor="note-cli-phone">Telefone</label>
                <input id="note-cli-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="note-cli-email">E-mail</label>
                <input
                  id="note-cli-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </div>
            <AddressFormBlock
              idPrefix="note-cli"
              value={addr}
              onChange={(patch) => setAddr((prev) => ({ ...prev, ...patch }))}
              showCityIbge
            />
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '0.75rem' }}>
              <button type="button" className="btn btn-secondary" onClick={onClose}>
                Cancelar
              </button>
              <button type="submit" className="btn btn-primary" disabled={save.isPending}>
                {save.isPending ? 'Salvando…' : 'Salvar cadastro'}
              </button>
            </div>
          </form>
        )}
      </div>
    </FormModalBackdrop>
  );
}
