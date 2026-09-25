import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { validateDocumentIfCpf } from '../lib/cpf';
import { api } from '../lib/api';
import { formatCpfCnpj } from '../lib/format';

type CustomerHit = { id: string; name: string; document: string | null };

/** Cliente opcional em modais de filtro (busca `/customers/search`). */
export function ListFilterCustomerField({
  idPrefix,
  customerId,
  customerLabel,
  onSelect,
  onClear,
  allowQuickCreate = false,
}: {
  idPrefix: string;
  customerId: string;
  customerLabel: string;
  onSelect: (c: CustomerHit) => void;
  onClear: () => void;
  /** Cadastro mínimo (nome + telefone/documento opcionais) sem sair do modal. */
  allowQuickCreate?: boolean;
}) {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createErr, setCreateErr] = useState<string | null>(null);
  const [createForm, setCreateForm] = useState({ name: '', phone: '', document: '' });

  const search = useQuery({
    queryKey: ['customers', 'search', 'list-filter', idPrefix, q],
    queryFn: () =>
      api<CustomerHit[]>(`/customers/search?q=${encodeURIComponent(q.trim())}`),
    enabled: open && q.trim().length >= 1 && !createOpen,
  });

  const createMut = useMutation({
    mutationFn: () => {
      const name = createForm.name.trim();
      if (!name) throw new Error('Informe o nome do cliente.');
      const docErr = validateDocumentIfCpf(createForm.document);
      if (docErr) throw new Error(docErr);
      const digits = createForm.document.replace(/\D/g, '');
      return api<CustomerHit>('/customers', {
        method: 'POST',
        json: {
          name,
          phone: createForm.phone.trim() || null,
          document: digits || null,
        },
      });
    },
    onSuccess: (c) => {
      void qc.invalidateQueries({ queryKey: ['customers'] });
      onSelect(c);
      setQ('');
      setOpen(false);
      setCreateOpen(false);
      setCreateForm({ name: '', phone: '', document: '' });
      setCreateErr(null);
    },
    onError: (e: Error) => setCreateErr(e.message),
  });

  if (customerId) {
    return (
      <div className="field filter-modal-row">
        <label htmlFor={`${idPrefix}-cust`}>Cliente</label>
        <div className="filter-customer-picked">
          <span id={`${idPrefix}-cust`}>{customerLabel}</span>
          <button type="button" className="btn btn-ghost btn-compact" onClick={onClear}>
            Limpar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="field filter-modal-row">
      <div className="filter-customer-label-row">
        <label htmlFor={`${idPrefix}-cust-q`}>Cliente</label>
        {allowQuickCreate ? (
          <button
            type="button"
            className="btn btn-ghost btn-compact filter-customer-new-btn"
            onClick={() => {
              setCreateOpen((v) => !v);
              setCreateErr(null);
              if (!createOpen && q.trim()) {
                setCreateForm((f) => ({ ...f, name: q.trim() }));
              }
            }}
          >
            {createOpen ? 'Cancelar cadastro' : '+ Novo cliente'}
          </button>
        ) : null}
      </div>
      {!createOpen ? (
        <>
          <input
            id={`${idPrefix}-cust-q`}
            value={q}
            placeholder="Nome ou documento…"
            onChange={(e) => {
              setQ(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
          />
          {open && q.trim().length >= 1 ? (
            <div className="filter-customer-hits">
              {search.isLoading ? (
                <p className="filter-customer-hits__empty">Buscando…</p>
              ) : !(search.data ?? []).length ? (
                <p className="filter-customer-hits__empty">
                  Nenhum cliente encontrado.
                  {allowQuickCreate ? ' Use “+ Novo cliente” para cadastrar.' : ''}
                </p>
              ) : (
                (search.data ?? []).slice(0, 8).map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className="filter-customer-hits__btn"
                    onClick={() => {
                      onSelect(c);
                      setQ('');
                      setOpen(false);
                    }}
                  >
                    {c.name}
                    {c.document ? ` · ${c.document}` : ''}
                  </button>
                ))
              )}
            </div>
          ) : null}
        </>
      ) : (
        <div className="filter-customer-quick">
          <p className="filter-customer-quick__hint">
            Cadastro rápido — complete endereço e limites depois em Clientes, se precisar.
          </p>
          {createErr ? (
            <div className="alert alert-error" role="alert">
              {createErr}
            </div>
          ) : null}
          <div className="field">
            <label htmlFor={`${idPrefix}-cust-new-name`}>Nome *</label>
            <input
              id={`${idPrefix}-cust-new-name`}
              value={createForm.name}
              onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
              autoFocus
            />
          </div>
          <div className="form-row form-row--2">
            <div className="field">
              <label htmlFor={`${idPrefix}-cust-new-phone`}>Telefone</label>
              <input
                id={`${idPrefix}-cust-new-phone`}
                value={createForm.phone}
                onChange={(e) => setCreateForm((f) => ({ ...f, phone: e.target.value }))}
              />
            </div>
            <div className="field">
              <label htmlFor={`${idPrefix}-cust-new-doc`}>CPF/CNPJ</label>
              <input
                id={`${idPrefix}-cust-new-doc`}
                value={createForm.document}
                onChange={(e) =>
                  setCreateForm((f) => ({ ...f, document: formatCpfCnpj(e.target.value) }))
                }
                inputMode="numeric"
              />
            </div>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            disabled={createMut.isPending}
            onClick={() => {
              setCreateErr(null);
              createMut.mutate();
            }}
          >
            {createMut.isPending ? 'Salvando…' : 'Salvar e selecionar cliente'}
          </button>
        </div>
      )}
    </div>
  );
}
