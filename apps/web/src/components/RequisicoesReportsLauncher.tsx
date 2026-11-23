import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ListFilterCustomerField } from './ListFilterCustomerField';
import { monthRangeLocal, validateFilterPeriodRange } from '../lib/list-filters';

type ReportKind = 'sales' | 'open-installments';

export function RequisicoesReportsLauncher({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const defaults = useMemo(() => monthRangeLocal(), []);
  const [customerId, setCustomerId] = useState('');
  const [customerLabel, setCustomerLabel] = useState('');
  const [from, setFrom] = useState(defaults.from);
  const [to, setTo] = useState(defaults.to);
  const [dueFrom, setDueFrom] = useState('');
  const [dueTo, setDueTo] = useState('');
  const [detalhar, setDetalhar] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function openReport(report: ReportKind) {
    if (report === 'sales') {
      const periodErr = validateFilterPeriodRange(from, to);
      if (periodErr) {
        setErr(periodErr);
        return;
      }
      if (!from || !to) {
        setErr('Informe o período pela data da venda.');
        return;
      }
    } else {
      const periodErr = validateFilterPeriodRange(dueFrom, dueTo);
      if (periodErr) {
        setErr(periodErr);
        return;
      }
      if ((dueFrom && !dueTo) || (!dueFrom && dueTo)) {
        setErr('Informe o início e o fim do vencimento, ou deixe os dois em branco.');
        return;
      }
    }
    const p = new URLSearchParams();
    p.set('report', report);
    if (customerId) {
      p.set('customerId', customerId);
      if (customerLabel.trim()) p.set('customerName', customerLabel.trim());
    }
    if (report === 'sales') {
      p.set('from', from);
      p.set('to', to);
    } else {
      if (dueFrom) p.set('from', dueFrom);
      if (dueTo) p.set('to', dueTo);
    }
    if (detalhar) p.set('detalhar', '1');
    onClose();
    navigate(`/requisicoes/relatorio/impressao?${p.toString()}`);
  }

  return (
    <div style={{ display: 'grid', gap: '0.85rem' }}>
      <ListFilterCustomerField
        idPrefix="req-rep"
        customerId={customerId}
        customerLabel={customerLabel}
        onSelect={(c) => {
          setCustomerId(c.id);
          setCustomerLabel(c.name);
        }}
        onClear={() => {
          setCustomerId('');
          setCustomerLabel('');
        }}
      />
      <div className="form-row form-row--2">
        <div className="field">
          <label htmlFor="req-rep-from">Venda de</label>
          <input id="req-rep-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="req-rep-to">Venda até</label>
          <input id="req-rep-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>
      <div className="form-row form-row--2">
        <div className="field">
          <label htmlFor="req-rep-due-from">Vencimento de (opcional)</label>
          <input
            id="req-rep-due-from"
            type="date"
            value={dueFrom}
            onChange={(e) => setDueFrom(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="req-rep-due-to">Vencimento até (opcional)</label>
          <input
            id="req-rep-due-to"
            type="date"
            value={dueTo}
            onChange={(e) => setDueTo(e.target.value)}
          />
        </div>
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <input type="checkbox" checked={detalhar} onChange={(e) => setDetalhar(e.target.checked)} />
        Detalhar os produtos
      </label>
      <p className="filter-modal-hint" style={{ margin: 0 }}>
        Contas a receber lista pelo vencimento. Uma venda de novembro não aparece lá se a parcela vence fora
        do período escolhido. Aqui o primeiro relatório usa a data da venda; o segundo, em branco, traz todas
        as parcelas em aberto.
      </p>
      {err ? (
        <div className="alert alert-error" style={{ margin: 0 }}>
          {err}
        </div>
      ) : null}
      <div style={{ display: 'grid', gap: '0.5rem' }}>
        <button type="button" className="btn btn-secondary" onClick={() => openReport('sales')}>
          Requisições por cliente e período
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => openReport('open-installments')}>
          Parcelas em aberto por vencimento
        </button>
      </div>
    </div>
  );
}
