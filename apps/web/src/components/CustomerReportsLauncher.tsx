import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CustomerGroupSearchCombo } from './ProductCatalogCombos';
import { api } from '../lib/api';
import { formatCpfCnpj } from '../lib/format';

type CustomerSearchRow = {
  id: string;
  name: string;
  document: string | null;
};

function defaultDateRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 30);
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { from: fmt(from), to: fmt(to) };
}

export function CustomerReportsLauncher({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const defaults = useMemo(() => defaultDateRange(), []);
  const [segment, setSegment] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [customerLabel, setCustomerLabel] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerOpen, setCustomerOpen] = useState(false);
  const [from, setFrom] = useState(defaults.from);
  const [to, setTo] = useState(defaults.to);
  const [err, setErr] = useState<string | null>(null);

  const customerSearchQ = useQuery({
    queryKey: ['customers', 'search', customerSearch],
    queryFn: () =>
      api<CustomerSearchRow[]>(`/customers/search?q=${encodeURIComponent(customerSearch.trim())}`),
    enabled: customerOpen && customerSearch.trim().length >= 1,
  });

  function openReport(report: 'credit-limits' | 'delinquency' | 'sales-history') {
    setErr(null);
    if (report === 'sales-history') {
      if (!customerId) {
        setErr('Selecione o cliente para o histórico de vendas.');
        return;
      }
      if (!from || !to) {
        setErr('Informe o período (de/até).');
        return;
      }
    }
    const p = new URLSearchParams();
    p.set('report', report);
    if (segment.trim()) p.set('segment', segment.trim());
    if (customerId) p.set('customerId', customerId);
    if (report === 'sales-history') {
      p.set('from', from);
      p.set('to', to);
    }
    onClose();
    navigate(`/clientes/relatorio/impressao?${p.toString()}`);
  }

  return (
    <div style={{ display: 'grid', gap: '0.85rem' }}>
      <div className="form-row form-row--2">
        <div className="field">
          <label htmlFor="cr-seg">Grupo de clientes (opcional)</label>
          <CustomerGroupSearchCombo id="cr-seg" value={segment} onChange={setSegment} />
        </div>
        <div className="field">
          <label htmlFor="cr-cust">Cliente (opcional / obrigatório no histórico)</label>
          <input
            id="cr-cust"
            value={customerOpen ? customerSearch : customerLabel}
            placeholder="Pesquisar nome ou documento…"
            onChange={(e) => {
              setCustomerOpen(true);
              setCustomerSearch(e.target.value);
              if (!e.target.value.trim()) {
                setCustomerId('');
                setCustomerLabel('');
              }
            }}
            onFocus={() => setCustomerOpen(true)}
            onBlur={() => window.setTimeout(() => setCustomerOpen(false), 150)}
          />
          {customerOpen && customerSearch.trim().length >= 1 && (
            <div className="table-wrap" style={{ maxHeight: '10rem', overflow: 'auto', marginTop: '0.35rem' }}>
              <table className="data-table">
                <tbody>
                  {customerSearchQ.isLoading && (
                    <tr>
                      <td className="empty">Buscando…</td>
                    </tr>
                  )}
                  {!customerSearchQ.isLoading && !(customerSearchQ.data ?? []).length && (
                    <tr>
                      <td className="empty">Nenhum cliente encontrado.</td>
                    </tr>
                  )}
                  {(customerSearchQ.data ?? []).map((c) => (
                    <tr key={c.id}>
                      <td style={{ width: '6rem' }}>
                        <button
                          type="button"
                          className="btn btn-secondary btn-compact"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            setCustomerId(c.id);
                            setCustomerLabel(
                              `${c.name}${c.document ? ` · ${formatCpfCnpj(c.document)}` : ''}`,
                            );
                            setCustomerSearch('');
                            setCustomerOpen(false);
                          }}
                        >
                          Selecionar
                        </button>
                      </td>
                      <td>
                        <strong>{c.name}</strong>
                        {c.document ? (
                          <div style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>
                            {formatCpfCnpj(c.document)}
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
      <div className="form-row form-row--2">
        <div className="field">
          <label htmlFor="cr-from">De (histórico de vendas)</label>
          <input id="cr-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="cr-to">Até (histórico de vendas)</label>
          <input id="cr-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>

      {err && (
        <div className="alert alert-error" style={{ margin: 0 }}>
          {err}
        </div>
      )}

      <div style={{ display: 'grid', gap: '0.5rem' }}>
        <button type="button" className="btn btn-secondary" onClick={() => openReport('credit-limits')}>
          Extrato de limite de crédito / requisição
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => openReport('delinquency')}>
          Lista de clientes com inadimplência
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => openReport('sales-history')}>
          Histórico de vendas por cliente
        </button>
      </div>
    </div>
  );
}
