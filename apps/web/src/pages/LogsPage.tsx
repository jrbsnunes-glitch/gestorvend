import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CrudToolbar } from '../components/CrudToolbar';
import { ModuleReportsModal } from '../components/ModuleReportsModal';
import { ReportPrintSticker } from '../components/ReportPrintSticker';
import { api } from '../lib/api';
import { formatDate } from '../lib/format';
import { NAV_MENU_FILTER_OPTIONS } from '../lib/nav-menu-registry';

function daysAgoISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

type UserOpt = { id: string; name: string; email: string };
type LogItem = {
  id: string;
  createdAt: string;
  path: string;
  menuKey: string;
  menuLabel: string;
  detail: string | null;
  user: UserOpt;
};

type LogsResponse = { take: number; count: number; items: LogItem[] };

function buildQuery(params: {
  userId: string;
  menuKey: string;
  from: string;
  to: string;
  q: string;
  take: string;
}): string {
  const sp = new URLSearchParams();
  if (params.userId.trim()) sp.set('userId', params.userId.trim());
  if (params.menuKey.trim()) sp.set('menuKey', params.menuKey.trim());
  if (params.from.trim()) sp.set('from', params.from.trim());
  if (params.to.trim()) sp.set('to', params.to.trim());
  if (params.q.trim()) sp.set('q', params.q.trim());
  sp.set('take', params.take.trim() || '200');
  return sp.toString();
}

export function LogsPage() {
  const [reportsOpen, setReportsOpen] = useState(false);
  const [draftUserId, setDraftUserId] = useState('');
  const [draftMenuKey, setDraftMenuKey] = useState('');
  const [draftFrom, setDraftFrom] = useState(() => daysAgoISO(7));
  const [draftTo, setDraftTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [draftQ, setDraftQ] = useState('');
  const [draftTake, setDraftTake] = useState('200');

  const [applied, setApplied] = useState(() => ({
    userId: '',
    menuKey: '',
    from: daysAgoISO(7),
    to: new Date().toISOString().slice(0, 10),
    q: '',
    take: '200',
  }));

  const qs = useMemo(() => buildQuery(applied), [applied]);

  const users = useQuery({
    queryKey: ['users'],
    queryFn: () => api<UserOpt[]>('/users'),
  });

  const logs = useQuery({
    queryKey: ['activity-logs', qs],
    queryFn: () => api<LogsResponse>(`/activity-logs?${qs}`),
  });

  function runSearch() {
    setApplied({
      userId: draftUserId,
      menuKey: draftMenuKey,
      from: draftFrom,
      to: draftTo,
      q: draftQ,
      take: draftTake,
    });
  }

  const printExtras = (
    <p className="print-sub" style={{ margin: 0 }}>
      Período {applied.from || '—'} a {applied.to || '—'}
      {!applied.userId ? ' · todos os usuários' : ' · um usuário filtrado'}
      {!applied.menuKey ? ' · todos os menus' : ` · menu “${applied.menuKey}”`}
      {applied.q ? ` · texto “${applied.q}”` : ''}
      {' · limite '}
      {applied.take}
    </p>
  );

  return (
    <div className="page print-area">
      <ReportPrintSticker documentTitle="Logs de navegação" documentExtras={printExtras} />

      <h1 className="page-title">Logs</h1>
      <p className="page-desc">
        Registro automático de acessos às telas ao navegar no sistema (layout principal). Use os filtros e{' '}
        <strong>Imprimir</strong> para gerar PDF ou papel no padrão dos demais módulos.
      </p>

      <CrudToolbar onPrint={() => window.print()} onReports={() => setReportsOpen(true)} />

      <ModuleReportsModal open={reportsOpen} title="Logs" onClose={() => setReportsOpen(false)}>
        <p style={{ margin: 0, fontSize: '0.9rem', lineHeight: 1.4 }}>
          Relatórios adicionais (CSV, auditoria avançada) podem ser ligados aqui. Para exportar o resultado atual, use{' '}
          <strong>Imprimir</strong> e salve como PDF no navegador.
        </p>
      </ModuleReportsModal>

      <div className="card no-print" style={{ marginBottom: '1rem', padding: '1rem' }}>
        <strong style={{ fontSize: '0.9rem' }}>Pesquisa</strong>
        <div className="form-row" style={{ flexWrap: 'wrap', gap: '0.75rem', marginTop: '0.65rem', alignItems: 'flex-end' }}>
          <div className="field">
            <label htmlFor="log-user">Usuário</label>
            <select
              id="log-user"
              value={draftUserId}
              onChange={(e) => setDraftUserId(e.target.value)}
              style={{ minWidth: '12rem' }}
            >
              <option value="">Todos</option>
              {(users.data ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.email})
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="log-menu">Menu</label>
            <select id="log-menu" value={draftMenuKey} onChange={(e) => setDraftMenuKey(e.target.value)} style={{ minWidth: '14rem' }}>
              <option value="">Todos</option>
              {NAV_MENU_FILTER_OPTIONS.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="log-from">Período de</label>
            <input id="log-from" type="date" value={draftFrom} onChange={(e) => setDraftFrom(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="log-to">Período até</label>
            <input id="log-to" type="date" value={draftTo} onChange={(e) => setDraftTo(e.target.value)} />
          </div>
          <div className="field" style={{ flex: '1 1 12rem', minWidth: '10rem' }}>
            <label htmlFor="log-q">Texto (caminho, menu, e-mail, nome…)</label>
            <input id="log-q" value={draftQ} onChange={(e) => setDraftQ(e.target.value)} placeholder="Opcional" />
          </div>
          <div className="field" style={{ width: '5.5rem' }}>
            <label htmlFor="log-take">Limite</label>
            <input id="log-take" value={draftTake} onChange={(e) => setDraftTake(e.target.value)} inputMode="numeric" />
          </div>
          <button type="button" className="btn btn-primary" onClick={() => runSearch()}>
            Pesquisar
          </button>
        </div>
      </div>

      <div className="toolbar no-print">
        <span style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>
          {logs.data ? `${logs.data.count} registro(s) (máx. ${logs.data.take})` : '—'}
        </span>
      </div>

      {logs.isError && <div className="alert alert-error no-print">{(logs.error as Error).message}</div>}

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th className="num" style={{ width: '3.2rem' }}>
                Cont.
              </th>
              <th>Quando</th>
              <th>Usuário</th>
              <th>Menu</th>
              <th>Caminho</th>
              <th>Detalhe</th>
            </tr>
          </thead>
          <tbody>
            {logs.isLoading && (
              <tr>
                <td colSpan={6} className="empty">
                  Carregando…
                </td>
              </tr>
            )}
            {!logs.isLoading && !logs.data?.items.length && (
              <tr>
                <td colSpan={6} className="empty">
                  Nenhum registro com os filtros atuais.
                </td>
              </tr>
            )}
            {logs.data?.items.map((row, idx) => (
              <tr key={row.id}>
                <td className="num">{idx + 1}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{formatDate(row.createdAt)}</td>
                <td>
                  <strong>{row.user.name}</strong>
                  <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>{row.user.email}</div>
                </td>
                <td>{row.menuLabel}</td>
                <td style={{ fontSize: '0.85rem', wordBreak: 'break-all' }}>{row.path}</td>
                <td style={{ fontSize: '0.85rem' }}>{row.detail ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
