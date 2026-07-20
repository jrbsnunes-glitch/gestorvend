import { type FormEvent, useState } from 'react';
import { formatFetchNetworkError, formatLoginFailureMessage, setRefreshToken, setToken } from '../lib/api';
import './login.css';

export function Login({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [tenantSlug, setTenantSlug] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim();
      const url = apiBase ? `${apiBase.replace(/\/$/, '')}/api/auth/login` : '/api/auth/login';
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username.trim().toLowerCase(),
          password,
          tenantSlug: tenantSlug.trim(),
        }),
      });
      const bodyText = await res.text();
      if (!res.ok) {
        throw new Error(formatLoginFailureMessage(res.status, bodyText));
      }
      let data: { accessToken: string; refreshToken: string };
      try {
        data = JSON.parse(bodyText) as { accessToken: string; refreshToken: string };
      } catch {
        throw new Error('Resposta inválida do servidor após login.');
      }
      if (data.refreshToken) setRefreshToken(data.refreshToken);
      setToken(data.accessToken);
      onLoggedIn();
    } catch (err) {
      setError(formatFetchNetworkError(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <img className="login-logo-img" src="/gv.png" alt="" width={56} height={56} decoding="async" />
          <div className="login-brand-copy">
            <h1>GestorVend</h1>
            <p>Gestão para lojas e comércio</p>
          </div>
        </div>
        <p className="login-hint">
          Entre com a abreviatura da empresa, o usuário e a senha — definidos no provisionamento
          do cliente ou pelo administrador do sistema.
        </p>
        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="tenant">abrev. emp</label>
            <p className="field-legend" id="tenant-legend">
              Abreviatura da empresa para login
            </p>
            <input
              id="tenant"
              value={tenantSlug}
              onChange={(e) => setTenantSlug(e.target.value)}
              required
              autoComplete="organization"
              aria-describedby="tenant-legend"
            />
          </div>
          <div className="field">
            <label htmlFor="username">Usuário</label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoComplete="username"
              minLength={3}
              maxLength={32}
              spellCheck={false}
            />
          </div>
          <div className="field">
            <label htmlFor="password">Senha</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>
          {error && <div className="alert alert-error">{error}</div>}
          <button type="submit" className="btn btn-primary login-submit" disabled={loading}>
            {loading ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  );
}
