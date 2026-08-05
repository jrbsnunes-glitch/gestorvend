import { type FormEvent, useEffect, useState } from 'react';
import { NavIcon } from '../components/nav-icons';
import { DEFAULT_APP_LOGO_WHITE } from '../lib/company-branding';
import { formatFetchNetworkError, formatLoginFailureMessage, setRefreshToken, setToken } from '../lib/api';
import './login.css';

const REMEMBER_KEY = 'gv_login_remember';

type Remembered = { tenantSlug: string; username: string };

function readRemembered(): Remembered | null {
  try {
    const raw = localStorage.getItem(REMEMBER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Remembered;
    if (typeof parsed?.tenantSlug === 'string' && typeof parsed?.username === 'string') return parsed;
    return null;
  } catch {
    return null;
  }
}

export function Login({ onLoggedIn }: { onLoggedIn: () => void }) {
  const remembered = readRemembered();
  const [username, setUsername] = useState(remembered?.username ?? '');
  const [password, setPassword] = useState('');
  const [tenantSlug, setTenantSlug] = useState(remembered?.tenantSlug ?? '');
  const [remember, setRemember] = useState(Boolean(remembered));
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!remember) {
      try {
        localStorage.removeItem(REMEMBER_KEY);
      } catch {
        /* ignore */
      }
    }
  }, [remember]);

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
      if (remember) {
        try {
          localStorage.setItem(
            REMEMBER_KEY,
            JSON.stringify({ tenantSlug: tenantSlug.trim(), username: username.trim().toLowerCase() }),
          );
        } catch {
          /* ignore */
        }
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
      <div className="login-shell">
        <aside className="login-hero" aria-hidden="false">
          <img
            className="login-hero-logo"
            src={DEFAULT_APP_LOGO_WHITE}
            alt="Gestor Vendas"
            decoding="async"
          />
          <h1 className="login-hero-title">Controle Total do Seu Negócio</h1>
          <p className="login-hero-text">
            Vendas, estoque, financeiro e salão em um só lugar — simples no desktop e no celular.
          </p>
        </aside>

        <div className="login-card">
          <div className="login-mobile-hero">
            <img
              className="login-mobile-logo"
              src={DEFAULT_APP_LOGO_WHITE}
              alt="Gestor Vendas"
              decoding="async"
            />
          </div>

          <div className="login-card-body">
            <div className="login-brand-copy">
              <h2>Bem-vindo ao GestorVend</h2>
              <p className="login-subtitle">Entre com a abreviatura da empresa, usuário e senha.</p>
            </div>

            <form onSubmit={submit}>
              <div className="field login-field">
                <label htmlFor="tenant">Empresa</label>
                <div className="login-input-wrap">
                  <span className="login-input-icon" aria-hidden>
                    <NavIcon name="building" />
                  </span>
                  <input
                    id="tenant"
                    value={tenantSlug}
                    onChange={(e) => setTenantSlug(e.target.value)}
                    required
                    autoComplete="organization"
                    placeholder="Abreviatura da empresa"
                  />
                </div>
              </div>

              <div className="field login-field">
                <label htmlFor="username">Usuário</label>
                <div className="login-input-wrap">
                  <span className="login-input-icon" aria-hidden>
                    <NavIcon name="user" />
                  </span>
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
                    placeholder="Seu usuário"
                  />
                </div>
              </div>

              <div className="field login-field">
                <label htmlFor="password">Senha</label>
                <div className="login-input-wrap">
                  <span className="login-input-icon" aria-hidden>
                    <NavIcon name="lock" />
                  </span>
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="current-password"
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    className="login-eye"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                  >
                    <NavIcon name={showPassword ? 'eye-off' : 'eye'} />
                  </button>
                </div>
              </div>

              <label className="login-remember">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                />
                <span>Lembrar-me</span>
              </label>

              {error && <div className="alert alert-error">{error}</div>}

              <button type="submit" className="btn btn-primary login-submit" disabled={loading}>
                {loading ? 'Entrando…' : 'Entrar'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
