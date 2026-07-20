import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { FormModalBackdrop } from '../components/FormModalBackdrop';
import { formatBRL } from '../lib/format';
import { portalApi } from './portal-api';

type Client = {
  id: string;
  slug: string;
  cnpj: string;
  companyName: string;
  planCode: 'STANDARD' | 'WHATSAPP';
  licenseStatus: 'trial' | 'active' | 'suspended' | 'expired';
  licenseValidFrom: string | null;
  licenseExpiresAt: string | null;
  licenseLastValidatedAt: string | null;
  remainingDays: number | null;
  databaseName: string;
  provisioningStatus: 'PENDING' | 'PROVISIONING' | 'READY' | 'FAILED';
  provisioningError: string | null;
  provisioningUpdatedAt: string | null;
  provisionAdminEmail: string | null;
  provisionAdminUsername?: string | null;
  monthlyFee: string | null;
  createdAt: string;
};

type CreateForm = {
  cnpj: string;
  companyName: string;
  slug: string;
  planCode: Client['planCode'];
  licenseStatus: Client['licenseStatus'];
  licenseValidFrom: string;
  licenseExpiresAt: string;
  firstAdminEmail: string;
  firstAdminPassword: string;
  monthlyFee: string;
};

const STATUS_LABEL: Record<Client['licenseStatus'], string> = {
  trial: 'Avaliação',
  active: 'Ativa',
  suspended: 'Suspensa',
  expired: 'Expirada',
};

const PLAN_LABEL: Record<Client['planCode'], string> = {
  STANDARD: 'Padrão',
  WHATSAPP: 'WhatsApp',
};

const PROVISIONING_LABEL: Record<Client['provisioningStatus'], string> = {
  PENDING: 'Aguardando…',
  PROVISIONING: 'Provisionando…',
  READY: 'Pronto',
  FAILED: 'Falhou',
};

function provisioningStyle(
  s: Client['provisioningStatus'],
): { bg: string; fg: string } {
  if (s === 'READY') return { bg: '#dcfce7', fg: '#166534' };
  if (s === 'FAILED') return { bg: '#fee2e2', fg: '#b91c1c' };
  if (s === 'PROVISIONING') return { bg: '#e0e7ff', fg: '#3730a3' };
  return { bg: '#f3f4f6', fg: '#4b5563' };
}

function formatDate(s: string | null): string {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('pt-BR');
}

/** CNPJ só com dígitos — evita path quebrado nas URLs `/portal/clients/:cnpj` */
function onlyDigitsCnpj(s: string): string {
  return String(s ?? '').replace(/\D+/g, '');
}

function statusColor(s: Client['licenseStatus'], days: number | null): { bg: string; fg: string } {
  if (s === 'expired' || s === 'suspended') return { bg: '#fee2e2', fg: '#b91c1c' };
  if (s === 'trial') return { bg: '#fef3c7', fg: '#92400e' };
  if (days != null && days <= 7) return { bg: '#fef3c7', fg: '#92400e' };
  return { bg: '#dcfce7', fg: '#166534' };
}

type EditForm = {
  companyName: string;
  planCode: Client['planCode'];
  licenseStatus: Client['licenseStatus'];
  licenseValidFrom: string;
  licenseExpiresAt: string;
  monthlyFee: string;
};

function toDateInput(s: string | null): string {
  if (!s) return '';
  return new Date(s).toISOString().slice(0, 10);
}

function clientToEditForm(c: Client): EditForm {
  return {
    companyName: c.companyName,
    planCode: c.planCode,
    licenseStatus: c.licenseStatus,
    licenseValidFrom: toDateInput(c.licenseValidFrom),
    licenseExpiresAt: toDateInput(c.licenseExpiresAt),
    monthlyFee: c.monthlyFee ?? '',
  };
}

const EMPTY_FORM: CreateForm = {
  cnpj: '',
  companyName: '',
  slug: '',
  planCode: 'STANDARD',
  licenseStatus: 'trial',
  licenseValidFrom: new Date().toISOString().slice(0, 10),
  licenseExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
  firstAdminEmail: '',
  firstAdminPassword: '',
  monthlyFee: '',
};

function matchesClientSearch(c: Client, term: string): boolean {
  const q = term.trim().toLowerCase();
  if (!q) return true;
  const digits = q.replace(/\D+/g, '');
  const haystack = [
    c.companyName,
    c.slug,
    c.cnpj,
    c.databaseName,
    c.provisionAdminEmail ?? '',
    PLAN_LABEL[c.planCode],
    STATUS_LABEL[c.licenseStatus],
    PROVISIONING_LABEL[c.provisioningStatus ?? 'READY'],
  ]
    .join(' ')
    .toLowerCase();
  if (haystack.includes(q)) return true;
  if (digits.length >= 3 && c.cnpj.includes(digits)) return true;
  return false;
}

export function PortalClientsPage() {
  const qc = useQueryClient();
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<CreateForm>(EMPTY_FORM);
  const [editing, setEditing] = useState<Client | null>(null);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [editErr, setEditErr] = useState<string | null>(null);
  const [renewing, setRenewing] = useState<Client | null>(null);
  const [renewDays, setRenewDays] = useState(30);
  const [err, setErr] = useState<string | null>(null);

  const [reprovisioning, setReprovisioning] = useState<Client | null>(null);
  const [reprovisionEmail, setReprovisionEmail] = useState('');
  const [reprovisionPassword, setReprovisionPassword] = useState('');

  const [adminReseeding, setAdminReseeding] = useState<Client | null>(null);
  const [adminReseedEmail, setAdminReseedEmail] = useState('');
  const [adminReseedPassword, setAdminReseedPassword] = useState('');

  const list = useQuery({
    queryKey: ['portal', 'clients'],
    queryFn: () => portalApi<Client[]>('/portal/clients'),
    refetchInterval: (query) => {
      const rows = query.state.data;
      if (!rows?.length) return false;
      const busy = rows.some(
        (c) => c.provisioningStatus === 'PENDING' || c.provisioningStatus === 'PROVISIONING',
      );
      return busy ? 3000 : false;
    },
  });

  const create = useMutation({
    mutationFn: () =>
      portalApi<Client>('/portal/clients', {
        method: 'POST',
        json: {
          cnpj: form.cnpj.replace(/\D+/g, ''),
          companyName: form.companyName,
          slug: form.slug || undefined,
          planCode: form.planCode,
          licenseStatus: form.licenseStatus,
          licenseValidFrom: form.licenseValidFrom || null,
          licenseExpiresAt: form.licenseExpiresAt || null,
          firstAdminEmail: form.firstAdminEmail.trim() || undefined,
          firstAdminPassword: form.firstAdminPassword.trim() || undefined,
          monthlyFee: form.monthlyFee.trim()
            ? parseFloat(form.monthlyFee.replace(',', '.'))
            : null,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portal', 'clients'] });
      setCreateOpen(false);
      setForm(EMPTY_FORM);
      setErr(null);
    },
    onError: (e: Error) => setErr(e.message),
  });

  const updateClient = useMutation({
    mutationFn: (payload: { cnpj: string; form: EditForm }) =>
      portalApi<Client>(`/portal/clients/${onlyDigitsCnpj(payload.cnpj)}/license`, {
        method: 'PATCH',
        json: {
          companyName: payload.form.companyName.trim(),
          planCode: payload.form.planCode,
          licenseStatus: payload.form.licenseStatus,
          licenseValidFrom: payload.form.licenseValidFrom || null,
          licenseExpiresAt: payload.form.licenseExpiresAt || null,
          monthlyFee: payload.form.monthlyFee.trim()
            ? parseFloat(payload.form.monthlyFee.replace(',', '.'))
            : null,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portal', 'clients'] });
      setEditing(null);
      setEditForm(null);
      setEditErr(null);
    },
    onError: (e: Error) => setEditErr(e.message),
  });

  const renew = useMutation({
    mutationFn: (payload: { cnpj: string; days: number }) =>
      portalApi<Client>(`/portal/clients/${onlyDigitsCnpj(payload.cnpj)}/license`, {
        method: 'PATCH',
        json: { renewDays: payload.days },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portal', 'clients'] });
      setRenewing(null);
    },
  });

  const reprovision = useMutation({
    mutationFn: (payload: {
      cnpj: string;
      firstAdminEmail?: string;
      firstAdminPassword?: string;
    }) =>
      portalApi<Client>(`/portal/clients/${onlyDigitsCnpj(payload.cnpj)}/provision`, {
        method: 'POST',
        json: {
          firstAdminEmail: payload.firstAdminEmail?.trim() || undefined,
          firstAdminPassword: payload.firstAdminPassword?.trim() || undefined,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portal', 'clients'] });
      setReprovisioning(null);
      setReprovisionPassword('');
    },
    onError: (e: Error) => alert(e.message),
  });

  const reseedAdmin = useMutation({
    mutationFn: (payload: {
      cnpj: string;
      firstAdminEmail?: string;
      firstAdminPassword?: string;
    }) =>
      portalApi<{ ok: true; provisionAdminEmail: string }>(
        `/portal/clients/${onlyDigitsCnpj(payload.cnpj)}/admin-seed`,
        {
          method: 'POST',
          json: {
            firstAdminEmail: payload.firstAdminEmail?.trim() || undefined,
            firstAdminPassword: payload.firstAdminPassword?.trim() || undefined,
          },
        },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portal', 'clients'] });
      setAdminReseeding(null);
      setAdminReseedPassword('');
    },
    onError: (e: Error) => alert(e.message),
  });

  const remove = useMutation({
    mutationFn: (c: Client) => {
      const purge =
        c.provisioningStatus === 'FAILED' ||
        c.provisioningStatus === 'PENDING' ||
        c.provisioningStatus === 'PROVISIONING';
      const q = purge ? '?purge=1' : '';
      const cnpj = onlyDigitsCnpj(c.cnpj);
      return portalApi(`/portal/clients/${encodeURIComponent(cnpj)}${q}`, { method: 'DELETE' });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['portal', 'clients'] }),
    onError: (e: Error) => alert(e.message),
  });

  const setLicenseStatus = useMutation({
    mutationFn: (payload: { cnpj: string; licenseStatus: Client['licenseStatus'] }) =>
      portalApi<Client>(`/portal/clients/${onlyDigitsCnpj(payload.cnpj)}/license`, {
        method: 'PATCH',
        json: { licenseStatus: payload.licenseStatus },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['portal', 'clients'] }),
    onError: (e: Error) => alert(e.message),
  });

  const filteredClients = useMemo(() => {
    const rows = list.data ?? [];
    if (!searchQuery.trim()) return rows;
    return rows.filter((c) => matchesClientSearch(c, searchQuery));
  }, [list.data, searchQuery]);

  const totalMonthlyFee = useMemo(
    () =>
      (list.data ?? []).reduce((sum, c) => sum + (parseFloat(c.monthlyFee ?? '') || 0), 0),
    [list.data],
  );

  function runSearch() {
    setSearchQuery(searchInput.trim());
  }

  function clearSearch() {
    setSearchInput('');
    setSearchQuery('');
  }

  return (
    <div className="portal-page">
      <div className="portal-page-head">
        <div>
          <h1>Clientes / Licenças</h1>
          <p>Cadastro, renovação, pausa da licença (acesso ao sistema) e desativação/remoção do catálogo.</p>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            setForm(EMPTY_FORM);
            setErr(null);
            setCreateOpen(true);
          }}
        >
          + Nova licença
        </button>
      </div>

      {list.isError && <div className="alert alert-error">{(list.error as Error).message}</div>}

      <div className="portal-clients-toolbar card">
        <div className="portal-clients-search">
          <label htmlFor="portal-clients-q" className="portal-clients-search__label">
            Pesquisar clientes
          </label>
          <div className="portal-clients-search__row">
            <input
              id="portal-clients-q"
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  runSearch();
                }
              }}
              placeholder="Razão social, CNPJ, slug, e-mail admin, plano ou status…"
            />
            <button type="button" className="btn btn-primary" onClick={runSearch}>
              Pesquisar
            </button>
            {searchQuery && (
              <button type="button" className="btn btn-secondary" onClick={clearSearch}>
                Limpar
              </button>
            )}
          </div>
        </div>
        <p className="portal-clients-search__meta">
          {list.isLoading
            ? 'Carregando clientes…'
            : searchQuery
              ? `${filteredClients.length} de ${list.data?.length ?? 0} cliente(s) encontrado(s)`
              : `${list.data?.length ?? 0} cliente(s) cadastrado(s)`}
        </p>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Razão social</th>
                <th>CNPJ</th>
                <th>Plano</th>
                <th style={{ textAlign: 'right' }}>Mensalidade</th>
                <th>Status</th>
                <th>Validade</th>
                <th style={{ textAlign: 'right' }}>Restante</th>
                <th>Provisionamento</th>
                <th style={{ textAlign: 'right' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {list.isLoading && (
                <tr>
                  <td colSpan={9} className="empty">
                    Carregando…
                  </td>
                </tr>
              )}
              {!list.isLoading && !list.data?.length && (
                <tr>
                  <td colSpan={9} className="empty">
                    Nenhum cliente cadastrado.
                  </td>
                </tr>
              )}
              {!list.isLoading && list.data?.length && !filteredClients.length && (
                <tr>
                  <td colSpan={9} className="empty">
                    Nenhum cliente corresponde a &quot;{searchQuery}&quot;.
                  </td>
                </tr>
              )}
              {filteredClients.map((c) => {
                const sc = statusColor(c.licenseStatus, c.remainingDays);
                const prov = c.provisioningStatus ?? 'READY';
                const pc = provisioningStyle(prov);
                return (
                  <tr key={c.id}>
                    <td>
                      <strong>{c.companyName}</strong>
                      <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
                        slug: {c.slug} · db: {c.databaseName}
                        {c.provisionAdminUsername || c.provisionAdminEmail ? (
                          <>
                            <br />
                            login admin: <strong>{c.provisionAdminUsername || c.provisionAdminEmail}</strong>
                            <span style={{ fontWeight: 400 }}> (senha padrão do seed: Admin123!)</span>
                          </>
                        ) : null}
                      </div>
                    </td>
                    <td style={{ fontVariantNumeric: 'tabular-nums' }}>{c.cnpj}</td>
                    <td>
                      <span className="badge" style={{ background: '#eef2ff', color: '#4338ca' }}>
                        {PLAN_LABEL[c.planCode]}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {c.monthlyFee != null ? formatBRL(c.monthlyFee) : '—'}
                    </td>
                    <td>
                      <span
                        className="badge"
                        style={{ background: sc.bg, color: sc.fg, fontWeight: 700 }}
                      >
                        {STATUS_LABEL[c.licenseStatus]}
                      </span>
                    </td>
                    <td style={{ fontSize: '0.82rem' }}>
                      {formatDate(c.licenseValidFrom)} → {formatDate(c.licenseExpiresAt)}
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: sc.fg }}>
                      {c.remainingDays != null
                        ? c.remainingDays >= 0
                          ? `${c.remainingDays}d`
                          : `–${Math.abs(c.remainingDays)}d`
                        : '—'}
                    </td>
                    <td style={{ fontSize: '0.82rem', maxWidth: 200 }}>
                      <span
                        className="badge"
                        style={{ background: pc.bg, color: pc.fg, fontWeight: 700 }}
                      >
                        {PROVISIONING_LABEL[prov]}
                      </span>
                      {c.provisioningError && prov === 'FAILED' ? (
                        <div
                          style={{
                            marginTop: '0.35rem',
                            fontSize: '0.72rem',
                            color: '#b91c1c',
                            wordBreak: 'break-word',
                          }}
                          title={c.provisioningError}
                        >
                          {c.provisioningError.length > 120
                            ? `${c.provisioningError.slice(0, 120)}…`
                            : c.provisioningError}
                        </div>
                      ) : null}
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        style={{ fontSize: '0.78rem' }}
                        onClick={() => {
                          setEditErr(null);
                          setEditing(c);
                          setEditForm(clientToEditForm(c));
                        }}
                      >
                        Editar
                      </button>
                      {prov === 'READY' && (
                        <button
                          type="button"
                          className="btn btn-ghost"
                          style={{ fontSize: '0.78rem' }}
                          disabled={reseedAdmin.isPending}
                          onClick={() => {
                            setAdminReseedEmail(c.provisionAdminEmail?.trim() || '');
                            setAdminReseedPassword('');
                            setAdminReseeding(c);
                          }}
                        >
                          Ajustar admin
                        </button>
                      )}
                      {(prov === 'FAILED' || prov === 'PENDING') && (
                        <button
                          type="button"
                          className="btn btn-ghost"
                          style={{ fontSize: '0.78rem' }}
                          disabled={reprovision.isPending}
                          onClick={() => {
                            setReprovisionEmail(c.provisionAdminEmail?.trim() || '');
                            setReprovisionPassword('');
                            setReprovisioning(c);
                          }}
                        >
                          {prov === 'PENDING' ? 'Processar' : 'Tentar de novo'}
                        </button>
                      )}
                      {(c.licenseStatus === 'trial' || c.licenseStatus === 'active') && (
                        <button
                          type="button"
                          className="btn btn-ghost"
                          style={{ fontSize: '0.78rem', color: '#b45309' }}
                          disabled={setLicenseStatus.isPending}
                          onClick={() => {
                            if (
                              confirm(
                                `Pausar a licença de "${c.companyName}"? O cliente não poderá acessar o GestorVend até a retomada.`,
                              )
                            ) {
                              setLicenseStatus.mutate({ cnpj: c.cnpj, licenseStatus: 'suspended' });
                            }
                          }}
                        >
                          Pausar
                        </button>
                      )}
                      {c.licenseStatus === 'suspended' && (
                        <button
                          type="button"
                          className="btn btn-ghost"
                          style={{ fontSize: '0.78rem', color: '#166534' }}
                          disabled={setLicenseStatus.isPending}
                          onClick={() => {
                            setLicenseStatus.mutate({ cnpj: c.cnpj, licenseStatus: 'active' });
                          }}
                        >
                          Retomar
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn-ghost"
                        style={{ fontSize: '0.78rem' }}
                        onClick={() => {
                          setRenewDays(30);
                          setRenewing(c);
                        }}
                      >
                        Revalidar
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        style={{ fontSize: '0.78rem', color: '#b91c1c' }}
                        onClick={() => {
                          const prov = c.provisioningStatus ?? 'READY';
                          const purge =
                            prov === 'FAILED' ||
                            prov === 'PENDING' ||
                            prov === 'PROVISIONING';
                          const msg = purge
                            ? `Remover "${c.companyName}" do catálogo? Libera CNPJ para nova licença. O banco PostgreSQL (se existir) não será apagado.`
                            : `Desativar licença de ${c.companyName}?`;
                          if (confirm(msg)) remove.mutate(c);
                        }}
                      >
                        Excluir
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {createOpen && (
        <FormModalBackdrop onClose={() => setCreateOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 'min(560px, 96vw)' }}>
            <h2>Nova licença / cliente</h2>
            {err && <div className="alert alert-error">{err}</div>}
            <div className="form-row">
              <div className="field" style={{ flex: 2 }}>
                <label htmlFor="pc-name">Razão social *</label>
                <input
                  id="pc-name"
                  value={form.companyName}
                  onChange={(e) => setForm({ ...form, companyName: e.target.value })}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="pc-cnpj">CNPJ *</label>
                <input
                  id="pc-cnpj"
                  value={form.cnpj}
                  onChange={(e) => setForm({ ...form, cnpj: e.target.value })}
                  placeholder="00.000.000/0000-00"
                  required
                />
              </div>
            </div>
            <div className="form-row">
              <div className="field">
                <label htmlFor="pc-slug">Slug (opcional)</label>
                <input
                  id="pc-slug"
                  value={form.slug}
                  onChange={(e) => setForm({ ...form, slug: e.target.value })}
                  placeholder="auto"
                />
              </div>
              <div className="field">
                <label htmlFor="pc-plan">Plano</label>
                <select
                  id="pc-plan"
                  value={form.planCode}
                  onChange={(e) => setForm({ ...form, planCode: e.target.value as Client['planCode'] })}
                >
                  <option value="STANDARD">Padrão</option>
                  <option value="WHATSAPP">WhatsApp</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="pc-status">Status</label>
                <select
                  id="pc-status"
                  value={form.licenseStatus}
                  onChange={(e) =>
                    setForm({ ...form, licenseStatus: e.target.value as Client['licenseStatus'] })
                  }
                >
                  {(['trial', 'active', 'suspended', 'expired'] as Client['licenseStatus'][]).map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="form-row">
              <div className="field">
                <label htmlFor="pc-monthly">Mensalidade (R$)</label>
                <input
                  id="pc-monthly"
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.monthlyFee}
                  onChange={(e) => setForm({ ...form, monthlyFee: e.target.value })}
                  placeholder="0,00"
                />
              </div>
            </div>
            <div className="form-row">
              <div className="field">
                <label htmlFor="pc-from">Início da validade</label>
                <input
                  id="pc-from"
                  type="date"
                  value={form.licenseValidFrom}
                  onChange={(e) => setForm({ ...form, licenseValidFrom: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="pc-exp">Expira em</label>
                <input
                  id="pc-exp"
                  type="date"
                  value={form.licenseExpiresAt}
                  onChange={(e) => setForm({ ...form, licenseExpiresAt: e.target.value })}
                />
              </div>
            </div>
            <div className="form-row">
              <div className="field" style={{ flex: 1 }}>
                <label htmlFor="pc-admin-email">E-mail interno do admin (opcional)</label>
                <input
                  id="pc-admin-email"
                  type="email"
                  value={form.firstAdminEmail}
                  onChange={(e) => setForm({ ...form, firstAdminEmail: e.target.value })}
                  placeholder="vazio = admin.<slug>@gestorvend.local"
                />
                <p style={{ margin: '0.25rem 0 0', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                  Login na tela usa o usuário derivado deste e-mail (parte antes do @), ex.: admin.
                </p>
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label htmlFor="pc-admin-pass">Senha do admin (opcional)</label>
                <input
                  id="pc-admin-pass"
                  type="password"
                  autoComplete="new-password"
                  value={form.firstAdminPassword}
                  onChange={(e) => setForm({ ...form, firstAdminPassword: e.target.value })}
                  placeholder="padrão: Admin123!"
                />
              </div>
            </div>
            <p style={{ margin: '0.5rem 0 0', fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
              O banco PostgreSQL é criado em segundo plano (migrate + usuário admin). Acompanhe o status na
              tabela; use &quot;Processar&quot; ou &quot;Tentar de novo&quot; se falhar.
            </p>
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setCreateOpen(false)}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!form.companyName.trim() || !form.cnpj || create.isPending}
                onClick={() => create.mutate()}
              >
                Criar licença
              </button>
            </div>
          </div>
        </FormModalBackdrop>
      )}

      {editing && editForm && (
        <FormModalBackdrop
          onClose={() => {
            setEditing(null);
            setEditForm(null);
            setEditErr(null);
          }}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 'min(560px, 96vw)' }}>
            <h2>Editar cliente / licença</h2>
            {editErr && <div className="alert alert-error">{editErr}</div>}
            <p style={{ margin: '0 0 0.75rem', fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>
              CNPJ <strong>{editing.cnpj}</strong> · slug <strong>{editing.slug}</strong> · banco{' '}
              <strong>{editing.databaseName}</strong>
            </p>
            <div className="form-row">
              <div className="field" style={{ flex: 1 }}>
                <label htmlFor="pe-name">Razão social *</label>
                <input
                  id="pe-name"
                  value={editForm.companyName}
                  onChange={(e) => setEditForm({ ...editForm, companyName: e.target.value })}
                  required
                />
              </div>
            </div>
            <div className="form-row">
              <div className="field">
                <label htmlFor="pe-plan">Plano</label>
                <select
                  id="pe-plan"
                  value={editForm.planCode}
                  onChange={(e) =>
                    setEditForm({ ...editForm, planCode: e.target.value as Client['planCode'] })
                  }
                >
                  <option value="STANDARD">Padrão</option>
                  <option value="WHATSAPP">WhatsApp</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="pe-status">Status da licença</label>
                <select
                  id="pe-status"
                  value={editForm.licenseStatus}
                  onChange={(e) =>
                    setEditForm({
                      ...editForm,
                      licenseStatus: e.target.value as Client['licenseStatus'],
                    })
                  }
                >
                  {(['trial', 'active', 'suspended', 'expired'] as Client['licenseStatus'][]).map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="pe-monthly">Mensalidade (R$)</label>
                <input
                  id="pe-monthly"
                  type="number"
                  step="0.01"
                  min="0"
                  value={editForm.monthlyFee}
                  onChange={(e) => setEditForm({ ...editForm, monthlyFee: e.target.value })}
                  placeholder="0,00"
                />
              </div>
            </div>
            <div className="form-row">
              <div className="field">
                <label htmlFor="pe-from">Início da validade</label>
                <input
                  id="pe-from"
                  type="date"
                  value={editForm.licenseValidFrom}
                  onChange={(e) => setEditForm({ ...editForm, licenseValidFrom: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="pe-exp">Expira em</label>
                <input
                  id="pe-exp"
                  type="date"
                  value={editForm.licenseExpiresAt}
                  onChange={(e) => setEditForm({ ...editForm, licenseExpiresAt: e.target.value })}
                />
              </div>
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setEditing(null);
                  setEditForm(null);
                  setEditErr(null);
                }}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!editForm.companyName.trim() || updateClient.isPending}
                onClick={() => updateClient.mutate({ cnpj: editing.cnpj, form: editForm })}
              >
                {updateClient.isPending ? 'Salvando…' : 'Salvar alterações'}
              </button>
            </div>
          </div>
        </FormModalBackdrop>
      )}

      {adminReseeding && (
        <FormModalBackdrop onClose={() => setAdminReseeding(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 'min(480px, 96vw)' }}>
            <h2>Atualizar login do administrador</h2>
            <p style={{ margin: '0 0 0.75rem', fontSize: '0.88rem' }}>
              <strong>{adminReseeding.companyName}</strong>
              <br />
              <span style={{ color: 'var(--color-text-muted)', fontSize: '0.82rem' }}>
                slug {adminReseeding.slug}
              </span>
            </p>
            <p style={{ margin: '0 0 0.75rem', fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
              Reaplica o usuário admin no banco (mesmo efeito do seed inicial). Use o e-mail e a senha com
              que o cliente deve entrar no GestorVend. Se deixar a senha em branco, será{' '}
              <strong>Admin123!</strong>.
            </p>
            <div className="field">
              <label htmlFor="ar-email">E-mail do admin</label>
              <input
                id="ar-email"
                type="email"
                value={adminReseedEmail}
                onChange={(e) => setAdminReseedEmail(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="ar-pass">Senha (opcional)</label>
              <input
                id="ar-pass"
                type="password"
                autoComplete="new-password"
                value={adminReseedPassword}
                onChange={(e) => setAdminReseedPassword(e.target.value)}
                placeholder="vazio = Admin123!"
              />
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setAdminReseeding(null)}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={reseedAdmin.isPending}
                onClick={() =>
                  reseedAdmin.mutate({
                    cnpj: adminReseeding.cnpj,
                    firstAdminEmail: adminReseedEmail.trim() || undefined,
                    firstAdminPassword: adminReseedPassword || undefined,
                  })
                }
              >
                {reseedAdmin.isPending ? 'Aplicando…' : 'Aplicar'}
              </button>
            </div>
          </div>
        </FormModalBackdrop>
      )}

      {reprovisioning && (
        <FormModalBackdrop onClose={() => setReprovisioning(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 'min(480px, 96vw)' }}>
            <h2>Provisionar banco do tenant</h2>
            <p style={{ margin: '0 0 0.75rem', fontSize: '0.88rem' }}>
              <strong>{reprovisioning.companyName}</strong>
              <br />
              <span style={{ color: 'var(--color-text-muted)', fontSize: '0.82rem' }}>
                slug {reprovisioning.slug} · CNPJ {reprovisioning.cnpj}
              </span>
            </p>
            <p style={{ margin: '0 0 0.75rem', fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
              Informe o mesmo e-mail e senha do primeiro admin que você usou na licença (ou deixe a senha em
              branco para usar <strong>Admin123!</strong>). Isso evita criar o usuário com outro e-mail ao
              tentar de novo.
            </p>
            <div className="field">
              <label htmlFor="rp-email">E-mail do primeiro admin</label>
              <input
                id="rp-email"
                type="email"
                value={reprovisionEmail}
                onChange={(e) => setReprovisionEmail(e.target.value)}
                placeholder="ex.: seu@gmail.com"
              />
            </div>
            <div className="field">
              <label htmlFor="rp-pass">Senha (opcional)</label>
              <input
                id="rp-pass"
                type="password"
                autoComplete="new-password"
                value={reprovisionPassword}
                onChange={(e) => setReprovisionPassword(e.target.value)}
                placeholder="vazio = Admin123!"
              />
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setReprovisioning(null)}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={reprovision.isPending}
                onClick={() =>
                  reprovision.mutate({
                    cnpj: onlyDigitsCnpj(reprovisioning.cnpj),
                    firstAdminEmail: reprovisionEmail || undefined,
                    firstAdminPassword: reprovisionPassword || undefined,
                  })
                }
              >
                {reprovision.isPending ? 'Enviando…' : 'Tentar provisionar'}
              </button>
            </div>
          </div>
        </FormModalBackdrop>
      )}

      {renewing && (
        <FormModalBackdrop onClose={() => setRenewing(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 'min(420px, 96vw)' }}>
            <h2>Revalidar licença</h2>
            <p style={{ margin: '0 0 0.75rem', fontSize: '0.88rem' }}>
              <strong>{renewing.companyName}</strong>
              <br />
              <span style={{ color: 'var(--color-text-muted)', fontSize: '0.82rem' }}>CNPJ {renewing.cnpj}</span>
            </p>
            <div className="field">
              <label htmlFor="pr-days">Adicionar dias</label>
              <input
                id="pr-days"
                type="number"
                min={1}
                max={3650}
                value={renewDays}
                onChange={(e) => setRenewDays(Math.max(1, Math.min(3650, Number(e.target.value) || 30)))}
              />
            </div>
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.4rem' }}>
              {[30, 90, 180, 365].map((d) => (
                <button
                  key={d}
                  type="button"
                  className="btn btn-ghost"
                  style={{ fontSize: '0.78rem' }}
                  onClick={() => setRenewDays(d)}
                >
                  +{d}d
                </button>
              ))}
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setRenewing(null)}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={renew.isPending}
                onClick={() => renew.mutate({ cnpj: renewing.cnpj, days: renewDays })}
              >
                Revalidar (+{renewDays}d)
              </button>
            </div>
          </div>
        </FormModalBackdrop>
      )}
      <footer className="portal-clients-footer card">
        <div className="portal-clients-footer__label">Total de mensalidades cadastradas</div>
        <div className="portal-clients-footer__value">{formatBRL(totalMonthlyFee)}</div>
        <p className="portal-clients-footer__hint">
          Soma dos valores informados em todas as licenças. Atualiza automaticamente ao incluir um
          novo cliente.
        </p>
      </footer>
    </div>
  );
}
