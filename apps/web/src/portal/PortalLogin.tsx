import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { portalApi, setPortalMe, setPortalToken } from './portal-api';

export function PortalLogin() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const res = await portalApi<{ token: string; user: { id: string; email: string; name: string } }>(
        '/portal/auth/login',
        { method: 'POST', json: { email, password } },
      );
      setPortalToken(res.token);
      setPortalMe(res.user);
      navigate('/portal-admin/clientes', { replace: true });
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Erro de login.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="portal-login-page">
      <div className="portal-login-card">
        <div className="portal-login-brand">
          <img className="portal-login-mark" src="/gv.png" alt="" width={52} height={52} decoding="async" />
          <div className="portal-login-brand-copy">
            <strong>GestorVend</strong>
            <span>Portal de Licenciamento</span>
          </div>
        </div>

        <form onSubmit={onSubmit}>
          {err && <div className="alert alert-error">{err}</div>}
          <div className="field">
            <label htmlFor="pl-email">E-mail</label>
            <input
              id="pl-email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="pl-pwd">Senha</label>
            <input
              id="pl-pwd"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={busy} style={{ width: '100%' }}>
            {busy ? 'Entrando…' : 'Entrar'}
          </button>
        </form>

        <p className="portal-login-hint">
          Esta área é restrita à equipe interna do GestorVend para gerenciar licenças de clientes.
        </p>
      </div>
    </div>
  );
}
