import { type FormEvent, useState } from 'react';
import { formatFetchNetworkError, setRefreshToken, setToken } from '../lib/api';
import './login.css';

export function Login({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [email, setEmail] = useState('');
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
        body: JSON.stringify({ email, password, tenantSlug }),
      });
      if (!res.ok) {
        let message = `Falha no login (HTTP ${res.status}).`;
        try {
          const data = (await res.json()) as { message?: string | string[] };
          if (Array.isArray(data.message)) {
            message = data.message.join('; ');
          } else if (typeof data.message === 'string' && data.message.trim()) {
            message = data.message;
          }
        } catch {
          // resposta não é JSON — mantém mensagem padrão
        }
        throw new Error(message);
      }
      const data = (await res.json()) as { accessToken: string; refreshToken: string };
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
          Entre com a abreviatura da empresa, e-mail e senha do seu usuário administrador ou operador —
          são definidos quando o cliente é provisionado no portal de licenciamento ou pelo administrador
          técnico.
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
            <label htmlFor="email">E-mail</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="username"
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
