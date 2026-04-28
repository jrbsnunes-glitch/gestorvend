import { type FormEvent, useState } from 'react';
import { setToken } from '../lib/api';
import './login.css';

export function Login({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [email, setEmail] = useState('admin@demo.local');
  const [password, setPassword] = useState('Admin123!');
  const [tenantSlug, setTenantSlug] = useState('demo');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, tenantSlug }),
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || 'Falha no login');
      }
      const data = (await res.json()) as { accessToken: string };
      setToken(data.accessToken);
      onLoggedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao entrar');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <span className="login-logo">GV</span>
          <div>
            <h1>GestorVend</h1>
            <p>Gestão para lojas e comércio</p>
          </div>
        </div>
        <p className="login-hint">Entre com o tenant (slug), e-mail e senha.</p>
        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="tenant">Tenant (slug)</label>
            <input
              id="tenant"
              value={tenantSlug}
              onChange={(e) => setTenantSlug(e.target.value)}
              required
              autoComplete="organization"
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
