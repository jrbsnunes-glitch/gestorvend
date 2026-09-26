import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { formatCpfCnpj } from '../lib/format';
import {
  MFG_PROJECT_REPORT_DATE_FIELDS,
  MFG_PROJECT_REPORT_KINDS,
  mfgProjectReportMonthDefaults,
  type MfgProjectReportDateField,
  type MfgProjectReportKind,
} from '../lib/manufacturing-project-reports';

function initialDateField(params: URLSearchParams): MfgProjectReportDateField {
  const v = params.get('dateField');
  if (v === 'createdAt' || v === 'promisedAt' || v === 'quotedAt' || v === 'finishedAt' || v === 'approvedAt') {
    return v;
  }
  return 'createdAt';
}

type CustomerSearchRow = {
  id: string;
  name: string;
  document: string | null;
};

export function ManufacturingProjectReportsLauncher({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const defaults = useMemo(() => mfgProjectReportMonthDefaults(), []);
  const [dateField, setDateField] = useState<MfgProjectReportDateField>(() =>
    initialDateField(searchParams),
  );
  const [from, setFrom] = useState(() => searchParams.get('from') || defaults.from);
  const [to, setTo] = useState(() => searchParams.get('to') || defaults.to);
  const [customerId, setCustomerId] = useState(() => searchParams.get('customerId')?.trim() ?? '');
  const [customerLabel, setCustomerLabel] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerOpen, setCustomerOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const customerSearchQ = useQuery({
    queryKey: ['customers', 'search', customerSearch],
    queryFn: () =>
      api<CustomerSearchRow[]>(`/customers/search?q=${encodeURIComponent(customerSearch.trim())}`),
    enabled: customerOpen && customerSearch.trim().length >= 1,
  });

  function openReport(report: MfgProjectReportKind) {
    setErr(null);
    if (!from || !to) {
      setErr('Informe o período (de/até).');
      return;
    }
    if (from > to) {
      setErr('A data inicial não pode ser posterior à final.');
      return;
    }
    const p = new URLSearchParams({ report, dateField, from, to });
    if (customerId.trim()) p.set('customerId', customerId.trim());
    onClose();
    navigate(`/fabrica/relatorio/impressao?${p.toString()}`);
  }

  return (
    <div className="mfg-reports-launcher">
      <div className="mfg-reports-launcher__period">
        <div className="field">
          <label htmlFor="mfg-rep-from">De</label>
          <input id="mfg-rep-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="mfg-rep-to">Até</label>
          <input id="mfg-rep-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="field mfg-reports-launcher__date-field">
          <label htmlFor="mfg-rep-date-field">Período por</label>
          <select
            id="mfg-rep-date-field"
            value={dateField}
            onChange={(e) => setDateField(e.target.value as MfgProjectReportDateField)}
          >
            {MFG_PROJECT_REPORT_DATE_FIELDS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="field">
        <label htmlFor="mfg-rep-cust">Cliente (opcional)</label>
        <input
          id="mfg-rep-cust"
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

      {err && (
        <div className="alert alert-error" style={{ margin: 0 }}>
          {err}
        </div>
      )}

      <div className="mfg-reports-launcher__types">
        {MFG_PROJECT_REPORT_KINDS.map((k) => (
          <button
            key={k.id}
            type="button"
            className="btn btn-secondary btn-sm"
            title={k.hint}
            onClick={() => openReport(k.id)}
          >
            {k.label}
          </button>
        ))}
      </div>
    </div>
  );
}
