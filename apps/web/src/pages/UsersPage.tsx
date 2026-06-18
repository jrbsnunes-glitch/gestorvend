import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { getIdentity, isManager, profileLabel, type UserProfile } from '../lib/auth';
import {
  type UserPermissionRow,
  type UserPermissionsResponse,
} from '../lib/user-permissions';

type SystemUser = {
  id: string;
  email: string;
  name: string;
  isActive: boolean;
  profile: UserProfile;
  roles: string[];
  createdAt: string;
  updatedAt: string;
};

type FormState = {
  name: string;
  email: string;
  profile: UserProfile;
  password: string;
  confirmPassword: string;
};

type PermFormRow = UserPermissionRow & {
  password: string;
  confirmPassword: string;
};

type UserModalTab = 'dados' | 'permissoes';

const EMPTY_FORM: FormState = {
  name: '',
  email: '',
  profile: 'cashier',
  password: '',
  confirmPassword: '',
};

export function UsersPage() {
  const qc = useQueryClient();
  const identity = useMemo(() => getIdentity(), []);
  const canManage = isManager();

  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<SystemUser | null>(null);
  const [removing, setRemoving] = useState<SystemUser | null>(null);
  const [passwordTarget, setPasswordTarget] = useState<SystemUser | null>(null);

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [userModalTab, setUserModalTab] = useState<UserModalTab>('dados');
  const [permRows, setPermRows] = useState<PermFormRow[]>([]);
  const [permErr, setPermErr] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ['users'],
    queryFn: () => api<SystemUser[]>('/users'),
    enabled: canManage,
  });

  const filtered = useMemo(() => {
    const data = list.data ?? [];
    const term = search.trim().toLowerCase();
    if (!term) return data;
    return data.filter(
      (u) =>
        u.name.toLowerCase().includes(term) ||
        u.email.toLowerCase().includes(term) ||
        profileLabel(u.profile).toLowerCase().includes(term),
    );
  }, [list.data, search]);

  function resetForm() {
    setForm(EMPTY_FORM);
    setUserModalTab('dados');
    setPermRows([]);
    setPermErr(null);
    setErr(null);
  }

  const editingPermsQ = useQuery({
    queryKey: ['users', editing?.id, 'permissions'],
    queryFn: () => api<UserPermissionsResponse>(`/users/${editing!.id}/permissions`),
    enabled: !!editing,
  });

  useEffect(() => {
    if (!editing || !editingPermsQ.data) return;
    setPermRows(
      editingPermsQ.data.permissions.map((p) => ({
        ...p,
        password: '',
        confirmPassword: '',
      })),
    );
  }, [editing, editingPermsQ.data]);

  const savePermissions = useMutation({
    mutationFn: () => {
      if (!editing) throw new Error('Nenhum usuário selecionado.');
      for (const row of permRows) {
        if (!row.enabled) continue;
        if (row.password && row.password !== row.confirmPassword) {
          throw new Error(`As senhas da permissão «${row.label}» não coincidem.`);
        }
        if (!row.hasPassword && row.password.length < 4) {
          throw new Error(`Informe a senha de autorização para «${row.label}» (mín. 4 caracteres).`);
        }
        if (row.hasPassword && row.password && row.password.length < 4) {
          throw new Error(`Nova senha de «${row.label}» precisa ter pelo menos 4 caracteres.`);
        }
      }
      return api(`/users/${editing.id}/permissions`, {
        method: 'PATCH',
        json: {
          grants: permRows.map((row) => ({
            code: row.code,
            enabled: row.enabled,
            password: row.password.trim() || undefined,
          })),
        },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users', editing?.id, 'permissions'] });
      qc.invalidateQueries({ queryKey: ['users', 'me', 'permissions'] });
      setPermErr(null);
      setEditing(null);
      resetForm();
    },
    onError: (e: Error) => setPermErr(e.message),
  });

  function openCreate() {
    resetForm();
    setCreateOpen(true);
  }

  function openEdit(u: SystemUser) {
    setEditing(u);
    setUserModalTab('dados');
    setPermErr(null);
    setForm({
      name: u.name,
      email: u.email,
      profile: u.profile,
      password: '',
      confirmPassword: '',
    });
    setErr(null);
  }

  const create = useMutation({
    mutationFn: () => {
      if (form.password !== form.confirmPassword) {
        throw new Error('As senhas não coincidem.');
      }
      return api<SystemUser>('/users', {
        method: 'POST',
        json: {
          name: form.name,
          email: form.email,
          profile: form.profile,
          password: form.password,
        },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      setCreateOpen(false);
      resetForm();
    },
    onError: (e: Error) => setErr(e.message),
  });

  const update = useMutation({
    mutationFn: () => {
      if (!editing) throw new Error('Nenhum usuário selecionado.');
      return api<SystemUser>(`/users/${editing.id}`, {
        method: 'PATCH',
        json: {
          name: form.name,
          email: form.email,
          profile: form.profile,
        },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      setEditing(null);
      resetForm();
    },
    onError: (e: Error) => setErr(e.message),
  });

  const toggleActive = useMutation({
    mutationFn: (u: SystemUser) =>
      api<SystemUser>(`/users/${u.id}`, {
        method: 'PATCH',
        json: { isActive: !u.isActive },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });

  const remove = useMutation({
    mutationFn: () => {
      if (!removing) throw new Error('Nenhum usuário selecionado.');
      return api(`/users/${removing.id}`, { method: 'DELETE' });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      setRemoving(null);
    },
    onError: (e: Error) => setErr(e.message),
  });

  const changePassword = useMutation({
    mutationFn: () => {
      if (!passwordTarget) throw new Error('Usuário não selecionado.');
      if (newPassword !== confirmNewPassword) {
        throw new Error('As senhas não coincidem.');
      }
      return api<SystemUser>(`/users/${passwordTarget.id}`, {
        method: 'PATCH',
        json: { password: newPassword },
      });
    },
    onSuccess: () => {
      setPasswordTarget(null);
      setNewPassword('');
      setConfirmNewPassword('');
      setErr(null);
    },
    onError: (e: Error) => setErr(e.message),
  });

  useEffect(() => {
    if (!createOpen && !editing && !removing && !passwordTarget) setErr(null);
  }, [createOpen, editing, removing, passwordTarget]);

  if (!canManage) {
    return (
      <div className="page">
        <h1 className="page-title">Usuários</h1>
        <p className="page-desc">
          Esta área é exclusiva para usuários com perfil de <strong>Gerente</strong>.
          Caixas só podem operar o PDV e o caixa.
        </p>
        <div className="alert alert-error" role="alert">
          Acesso negado. Solicite a um gerente que conceda permissão.
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: '1rem',
          marginBottom: '1rem',
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h1 className="page-title">Usuários do sistema</h1>
          <p className="page-desc" style={{ marginBottom: 0 }}>
            Cadastre operadores e defina o perfil de acesso. Apenas gerentes podem
            criar, editar ou desativar usuários.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Pesquisar por nome, e-mail ou perfil…"
            style={{
              padding: '0.55rem 0.85rem',
              border: '1px solid var(--color-border-strong)',
              borderRadius: 'var(--radius-md)',
              minWidth: 260,
            }}
          />
          <button type="button" className="btn btn-primary" onClick={openCreate}>
            + Novo usuário
          </button>
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {list.isLoading && (
          <div style={{ padding: '1.25rem', color: 'var(--color-text-secondary)' }}>
            Carregando usuários…
          </div>
        )}
        {list.isError && (
          <div className="alert alert-error" style={{ margin: '1rem' }}>
            {(list.error as Error)?.message ?? 'Erro ao carregar.'}
          </div>
        )}
        {!list.isLoading && !list.isError && (
          <table className="data-table">
            <thead>
              <tr>
                <th className="num" style={{ width: '3.2rem' }}>
                  Cont.
                </th>
                <th>Nome</th>
                <th>E-mail</th>
                <th>Perfil</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
                    Nenhum usuário encontrado.
                  </td>
                </tr>
              )}
              {filtered.map((u, idx) => {
                const isSelf = identity?.sub === u.id;
                return (
                  <tr key={u.id}>
                    <td className="num">{idx + 1}</td>
                    <td>
                      <strong>{u.name}</strong>
                      {isSelf && (
                        <span
                          className="badge"
                          style={{
                            marginLeft: '0.4rem',
                            background: 'var(--color-primary-muted)',
                            color: 'var(--color-primary)',
                            fontSize: '0.7rem',
                            padding: '0.1rem 0.45rem',
                            borderRadius: '999px',
                            fontWeight: 600,
                          }}
                        >
                          você
                        </span>
                      )}
                    </td>
                    <td>{u.email}</td>
                    <td>
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.3rem',
                          padding: '0.15rem 0.55rem',
                          borderRadius: '999px',
                          background:
                            u.profile === 'manager'
                              ? 'rgba(22,163,74,0.12)'
                              : 'rgba(37,99,235,0.12)',
                          color:
                            u.profile === 'manager'
                              ? '#15803d'
                              : '#1d4ed8',
                          fontSize: '0.78rem',
                          fontWeight: 700,
                        }}
                      >
                        {profileLabel(u.profile)}
                      </span>
                    </td>
                    <td>
                      <span
                        style={{
                          padding: '0.15rem 0.55rem',
                          borderRadius: '999px',
                          background: u.isActive ? 'rgba(22,163,74,0.12)' : 'rgba(148,163,184,0.18)',
                          color: u.isActive ? '#15803d' : '#64748b',
                          fontSize: '0.78rem',
                          fontWeight: 600,
                        }}
                      >
                        {u.isActive ? 'Ativo' : 'Inativo'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: '0.35rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          style={{ padding: '0.3rem 0.65rem', fontSize: '0.82rem' }}
                          onClick={() => openEdit(u)}
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          style={{ padding: '0.3rem 0.65rem', fontSize: '0.82rem' }}
                          onClick={() => {
                            setPasswordTarget(u);
                            setNewPassword('');
                            setConfirmNewPassword('');
                            setErr(null);
                          }}
                        >
                          Trocar senha
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          style={{ padding: '0.3rem 0.65rem', fontSize: '0.82rem' }}
                          disabled={isSelf || toggleActive.isPending}
                          title={isSelf ? 'Você não pode desativar a si mesmo' : ''}
                          onClick={() => toggleActive.mutate(u)}
                        >
                          {u.isActive ? 'Desativar' : 'Ativar'}
                        </button>
                        <button
                          type="button"
                          className="btn btn-danger"
                          style={{ padding: '0.3rem 0.65rem', fontSize: '0.82rem' }}
                          disabled={isSelf}
                          title={isSelf ? 'Você não pode remover a si mesmo' : ''}
                          onClick={() => setRemoving(u)}
                        >
                          Remover
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* --- Modal: criar/editar --- */}
      {(createOpen || editing) && (
        <div
          className="modal-backdrop"
          onClick={() => {
            setCreateOpen(false);
            setEditing(null);
            resetForm();
          }}
          role="presentation"
        >
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 560 }}
          >
            <h2>{editing ? `Editar “${editing.name}”` : 'Novo usuário'}</h2>

            {editing && (
              <div className="user-modal-tabs" role="tablist" aria-label="Seções do cadastro">
                <button
                  type="button"
                  role="tab"
                  aria-selected={userModalTab === 'dados'}
                  className={'user-modal-tab' + (userModalTab === 'dados' ? ' is-active' : '')}
                  onClick={() => setUserModalTab('dados')}
                >
                  Dados
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={userModalTab === 'permissoes'}
                  className={'user-modal-tab' + (userModalTab === 'permissoes' ? ' is-active' : '')}
                  onClick={() => setUserModalTab('permissoes')}
                >
                  Permissões
                </button>
              </div>
            )}

            {(err || permErr) && <div className="alert alert-error">{err || permErr}</div>}

            {(!editing || userModalTab === 'dados') && (
              <>
            <p style={{ marginTop: 0, color: 'var(--color-text-secondary)', fontSize: '0.88rem' }}>
              {editing
                ? 'Atualize os dados de acesso. Para alterar a senha use o botão Trocar senha.'
                : 'Cadastre um novo operador. Permissões operacionais podem ser definidas após salvar, na aba Permissões.'}
            </p>

            <div className="field">
              <label htmlFor="user-name">Nome completo</label>
              <input
                id="user-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                autoFocus
              />
            </div>
            <div className="field">
              <label htmlFor="user-email">E-mail (login)</label>
              <input
                id="user-email"
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                autoComplete="off"
              />
            </div>

            <div className="field">
              <span className="label">Perfil de acesso</span>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <ProfileChoice
                  active={form.profile === 'manager'}
                  title="Gerente"
                  subtitle="Gerencia cadastros, usuários e relatórios. Permissões sensíveis são concedidas pelo administrador."
                  onClick={() => setForm((f) => ({ ...f, profile: 'manager' }))}
                />
                <ProfileChoice
                  active={form.profile === 'cashier'}
                  title="Caixa"
                  subtitle="Opera o PDV e o caixa. Ações sensíveis exigem permissão e senha do administrador."
                  onClick={() => setForm((f) => ({ ...f, profile: 'cashier' }))}
                />
              </div>
            </div>

            {!editing && (
              <>
                <div className="form-row">
                  <div className="field">
                    <label htmlFor="user-pass">Senha</label>
                    <input
                      id="user-pass"
                      type="password"
                      value={form.password}
                      onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                      autoComplete="new-password"
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="user-pass2">Confirmar senha</label>
                    <input
                      id="user-pass2"
                      type="password"
                      value={form.confirmPassword}
                      onChange={(e) => setForm((f) => ({ ...f, confirmPassword: e.target.value }))}
                      autoComplete="new-password"
                    />
                  </div>
                </div>
                <p style={{ fontSize: '0.78rem', color: 'var(--color-text-secondary)', marginTop: 0 }}>
                  A senha precisa ter pelo menos 6 caracteres.
                </p>
              </>
            )}
              </>
            )}

            {editing && userModalTab === 'permissoes' && (
              <div className="user-permissions-panel">
                <p style={{ marginTop: 0, color: 'var(--color-text-secondary)', fontSize: '0.88rem' }}>
                  Conceda permissões operacionais com senha de autorização. O{' '}
                  <strong>Administrador</strong> possui acesso total e não utiliza estas senhas.
                </p>
                {editing.roles.includes('admin') ? (
                  <div className="alert alert-info">
                    Este usuário é <strong>Administrador</strong> e pode realizar todas as operações sem senha
                    adicional.
                  </div>
                ) : editingPermsQ.isLoading ? (
                  <p>Carregando permissões…</p>
                ) : (
                  <div className="user-permissions-list">
                    {permRows.map((row, idx) => (
                      <div key={row.code} className="user-permission-card">
                        <label className="user-permission-toggle">
                          <input
                            type="checkbox"
                            checked={row.enabled}
                            onChange={(e) =>
                              setPermRows((rows) =>
                                rows.map((r, i) =>
                                  i === idx ? { ...r, enabled: e.target.checked } : r,
                                ),
                              )
                            }
                          />
                          <span>
                            <strong>{row.label}</strong>
                            <span className="user-permission-desc">{row.description}</span>
                          </span>
                        </label>
                        {row.enabled && (
                          <div className="form-row">
                            <div className="field">
                              <label htmlFor={`perm-pwd-${row.code}`}>
                                {row.hasPassword ? 'Nova senha (opcional)' : 'Senha de autorização *'}
                              </label>
                              <input
                                id={`perm-pwd-${row.code}`}
                                type="password"
                                autoComplete="new-password"
                                value={row.password}
                                onChange={(e) =>
                                  setPermRows((rows) =>
                                    rows.map((r, i) =>
                                      i === idx ? { ...r, password: e.target.value } : r,
                                    ),
                                  )
                                }
                              />
                            </div>
                            <div className="field">
                              <label htmlFor={`perm-pwd2-${row.code}`}>Confirmar senha</label>
                              <input
                                id={`perm-pwd2-${row.code}`}
                                type="password"
                                autoComplete="new-password"
                                value={row.confirmPassword}
                                onChange={(e) =>
                                  setPermRows((rows) =>
                                    rows.map((r, i) =>
                                      i === idx ? { ...r, confirmPassword: e.target.value } : r,
                                    ),
                                  )
                                }
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setCreateOpen(false);
                  setEditing(null);
                  resetForm();
                }}
              >
                Cancelar
              </button>
              {editing && userModalTab === 'permissoes' ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={
                    editing.roles.includes('admin') ||
                    savePermissions.isPending ||
                    editingPermsQ.isLoading
                  }
                  onClick={() => savePermissions.mutate()}
                >
                  Salvar permissões
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!form.name.trim() || create.isPending || update.isPending}
                  onClick={() => (editing ? update.mutate() : create.mutate())}
                >
                  {editing ? 'Salvar alterações' : 'Cadastrar usuário'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* --- Modal: trocar senha --- */}
      {passwordTarget && (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => setPasswordTarget(null)}
        >
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 440 }}
          >
            <h2>Trocar senha</h2>
            <p style={{ marginTop: 0, color: 'var(--color-text-secondary)', fontSize: '0.88rem' }}>
              Definir uma nova senha para <strong>{passwordTarget.name}</strong>.
              O usuário precisará entrar com a nova senha no próximo login.
            </p>
            {err && <div className="alert alert-error">{err}</div>}

            <div className="field">
              <label htmlFor="np">Nova senha</label>
              <input
                id="np"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                autoFocus
              />
            </div>
            <div className="field">
              <label htmlFor="np2">Confirmar nova senha</label>
              <input
                id="np2"
                type="password"
                value={confirmNewPassword}
                onChange={(e) => setConfirmNewPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setPasswordTarget(null)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={changePassword.isPending}
                onClick={() => changePassword.mutate()}
              >
                Atualizar senha
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- Modal: remover --- */}
      {removing && (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => setRemoving(null)}
        >
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 420 }}
          >
            <h2>Remover usuário</h2>
            <p style={{ marginTop: 0 }}>
              Tem certeza que deseja remover <strong>{removing.name}</strong>?
            </p>
            <p style={{ marginTop: 0, color: 'var(--color-text-secondary)', fontSize: '0.85rem' }}>
              O usuário ficará <strong>inativo</strong> e não poderá mais entrar no sistema.
              O histórico de vendas e movimentos é preservado.
            </p>
            {err && <div className="alert alert-error">{err}</div>}
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setRemoving(null)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={remove.isPending}
                onClick={() => remove.mutate()}
              >
                Confirmar remoção
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ProfileChoice({
  active,
  title,
  subtitle,
  onClick,
}: {
  active: boolean;
  title: string;
  subtitle: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: '1 1 200px',
        padding: '0.75rem 0.85rem',
        border: `1px solid ${active ? 'var(--color-primary)' : 'var(--color-border-strong)'}`,
        background: active ? 'var(--color-primary-muted)' : 'var(--color-surface)',
        color: 'var(--color-text)',
        borderRadius: 'var(--radius-md)',
        textAlign: 'left',
        cursor: 'pointer',
        transition: 'all 0.12s',
      }}
    >
      <strong style={{ display: 'block', fontSize: '0.95rem', marginBottom: '0.15rem' }}>
        {title}
      </strong>
      <span style={{ fontSize: '0.78rem', color: 'var(--color-text-secondary)', lineHeight: 1.4 }}>
        {subtitle}
      </span>
    </button>
  );
}
