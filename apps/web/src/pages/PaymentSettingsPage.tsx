import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

import { api } from '../lib/api';
import { paymentProviderLabel, type PaymentPspProvider, type PaymentSettings } from '../lib/payments';

type FormState = {
  activeProvider: PaymentPspProvider | '';
  getnetEnabled: boolean;
  mercadoPagoEnabled: boolean;
  environment: 'SANDBOX' | 'PRODUCTION';
  pixEnabled: boolean;
  cardEnabled: boolean;
  pixTimeoutSeconds: number;
  pixKeyType: string;
  pixKey: string;
  getnetClientId: string;
  getnetClientSecret: string;
  getnetChannel: string;
  getnetScope: string;
  getnetWebhookUser: string;
  getnetWebhookPassword: string;
  mercadoPagoAccessToken: string;
  mercadoPagoPublicKey: string;
  mercadoPagoWebhookSecret: string;
};

const EMPTY: FormState = {
  activeProvider: '',
  getnetEnabled: false,
  mercadoPagoEnabled: false,
  environment: 'SANDBOX',
  pixEnabled: true,
  cardEnabled: true,
  pixTimeoutSeconds: 900,
  pixKeyType: '',
  pixKey: '',
  getnetClientId: '',
  getnetClientSecret: '',
  getnetChannel: '',
  getnetScope: 'oob',
  getnetWebhookUser: '',
  getnetWebhookPassword: '',
  mercadoPagoAccessToken: '',
  mercadoPagoPublicKey: '',
  mercadoPagoWebhookSecret: '',
};

function fromSettings(s: PaymentSettings): FormState {
  return {
    ...EMPTY,
    activeProvider: s.activeProvider ?? '',
    getnetEnabled: s.getnetEnabled,
    mercadoPagoEnabled: s.mercadoPagoEnabled,
    environment: s.environment,
    pixEnabled: s.pixEnabled,
    cardEnabled: s.cardEnabled,
    pixTimeoutSeconds: s.pixTimeoutSeconds,
    pixKeyType: s.pixKeyType ?? '',
    pixKey: s.pixKey ?? '',
    mercadoPagoPublicKey: s.mercadoPagoPublicKey ?? '',
  };
}

export function PaymentSettingsPage() {
  const qc = useQueryClient();
  const settingsQ = useQuery({
    queryKey: ['payments', 'settings'],
    queryFn: () => api<PaymentSettings>('/payments/settings'),
  });
  const [form, setForm] = useState<FormState>(EMPTY);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    if (settingsQ.data) setForm(fromSettings(settingsQ.data));
  }, [settingsQ.data]);

  const saveMut = useMutation({
    mutationFn: () =>
      api<PaymentSettings>('/payments/settings', {
        method: 'POST',
        json: {
          activeProvider: form.activeProvider || null,
          getnetEnabled: form.getnetEnabled,
          mercadoPagoEnabled: form.mercadoPagoEnabled,
          environment: form.environment,
          pixEnabled: form.pixEnabled,
          cardEnabled: form.cardEnabled,
          pixTimeoutSeconds: form.pixTimeoutSeconds,
          pixKeyType: form.pixKeyType || null,
          pixKey: form.pixKey || null,
          getnetClientId: form.getnetClientId || null,
          getnetClientSecret: form.getnetClientSecret || null,
          getnetChannel: form.getnetChannel || null,
          getnetScope: form.getnetScope || null,
          getnetWebhookUser: form.getnetWebhookUser || null,
          getnetWebhookPassword: form.getnetWebhookPassword || null,
          mercadoPagoAccessToken: form.mercadoPagoAccessToken || null,
          mercadoPagoPublicKey: form.mercadoPagoPublicKey || null,
          mercadoPagoWebhookSecret: form.mercadoPagoWebhookSecret || null,
        },
      }),
    onSuccess: (data) => {
      setForm(fromSettings(data));
      setFeedback('Configurações salvas.');
      void qc.invalidateQueries({ queryKey: ['payments'] });
    },
    onError: (e: Error) => setFeedback(e.message),
  });

  const webhookUrls = settingsQ.data?.webhookUrls;

  const providerOptions = useMemo(() => {
    const opts: PaymentPspProvider[] = [];
    if (form.getnetEnabled) opts.push('GETNET');
    if (form.mercadoPagoEnabled) opts.push('MERCADO_PAGO');
    return opts;
  }, [form.getnetEnabled, form.mercadoPagoEnabled]);

  return (
    <div className="page-shell">
      <header className="page-header">
        <div>
          <h1>Pagamentos online</h1>
          <p className="page-subtitle">
            Provedor ativo da loja (Mercado Pago: PIX QR e cartão online). Getnet aparece somente após
            credenciamento.
          </p>
        </div>
      </header>

      {feedback ? (
        <p className="form-feedback" style={{ marginBottom: '1rem' }}>
          {feedback}
        </p>
      ) : null}

      {settingsQ.isLoading ? (
        <p>Carregando…</p>
      ) : (
        <form
          className="card"
          style={{ padding: '1.25rem', maxWidth: 720 }}
          onSubmit={(e) => {
            e.preventDefault();
            saveMut.mutate();
          }}
        >
          <fieldset style={{ border: 0, padding: 0, margin: '0 0 1.25rem' }}>
            <legend style={{ fontWeight: 700, marginBottom: '0.75rem' }}>Geral</legend>
            <div className="form-row" style={{ flexWrap: 'wrap', gap: '1rem' }}>
              <label className="field" style={{ flex: '1 1 200px' }}>
                Provedor preferido
                <select
                  value={form.activeProvider}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      activeProvider: e.target.value as PaymentPspProvider | '',
                    }))
                  }
                >
                  <option value="">Automático</option>
                  {providerOptions.map((p) => (
                    <option key={p} value={p}>
                      {paymentProviderLabel(p)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field" style={{ flex: '1 1 160px' }}>
                Ambiente
                <select
                  value={form.environment}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      environment: e.target.value as 'SANDBOX' | 'PRODUCTION',
                    }))
                  }
                >
                  <option value="SANDBOX">Sandbox / Teste</option>
                  <option value="PRODUCTION">Produção</option>
                </select>
              </label>
              <label className="field" style={{ flex: '1 1 120px' }}>
                Timeout PIX (s)
                <input
                  type="number"
                  min={60}
                  max={3600}
                  value={form.pixTimeoutSeconds}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, pixTimeoutSeconds: Number(e.target.value) || 900 }))
                  }
                />
              </label>
            </div>
            <div className="form-row" style={{ gap: '1rem', marginTop: '0.75rem' }}>
              <label>
                <input
                  type="checkbox"
                  checked={form.pixEnabled}
                  onChange={(e) => setForm((f) => ({ ...f, pixEnabled: e.target.checked }))}
                />{' '}
                PIX online (QR)
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={form.cardEnabled}
                  onChange={(e) => setForm((f) => ({ ...f, cardEnabled: e.target.checked }))}
                />{' '}
                Cartão online
              </label>
            </div>
            <div className="form-row" style={{ flexWrap: 'wrap', gap: '1rem', marginTop: '0.75rem' }}>
              <label className="field" style={{ flex: '1 1 140px' }}>
                Tipo chave PIX
                <select
                  value={form.pixKeyType}
                  onChange={(e) => setForm((f) => ({ ...f, pixKeyType: e.target.value }))}
                >
                  <option value="">—</option>
                  <option value="CNPJ">CNPJ</option>
                  <option value="EMAIL">E-mail</option>
                  <option value="PHONE">Telefone</option>
                  <option value="EVP">Aleatória</option>
                </select>
              </label>
              <label className="field" style={{ flex: '2 1 240px' }}>
                Chave PIX (referência)
                <input
                  value={form.pixKey}
                  onChange={(e) => setForm((f) => ({ ...f, pixKey: e.target.value }))}
                />
              </label>
            </div>
          </fieldset>

          {form.getnetEnabled || settingsQ.data?.getnetEnabled ? (
          <fieldset style={{ border: 0, padding: 0, margin: '0 0 1.25rem' }}>
            <legend style={{ fontWeight: 700, marginBottom: '0.75rem' }}>Getnet</legend>
            <label style={{ display: 'block', marginBottom: '0.75rem' }}>
              <input
                type="checkbox"
                checked={form.getnetEnabled}
                onChange={(e) => setForm((f) => ({ ...f, getnetEnabled: e.target.checked }))}
              />{' '}
              Habilitar Getnet
              {settingsQ.data?.hasGetnetCredentials ? ' (credenciais salvas)' : ''}
            </label>
            <div className="form-row" style={{ flexWrap: 'wrap', gap: '1rem' }}>
              <label className="field" style={{ flex: '1 1 220px' }}>
                Client ID
                <input
                  value={form.getnetClientId}
                  placeholder={settingsQ.data?.hasGetnetCredentials ? '•••• (deixe vazio para manter)' : ''}
                  onChange={(e) => setForm((f) => ({ ...f, getnetClientId: e.target.value }))}
                />
              </label>
              <label className="field" style={{ flex: '1 1 220px' }}>
                Client Secret
                <input
                  type="password"
                  value={form.getnetClientSecret}
                  placeholder={settingsQ.data?.hasGetnetCredentials ? '•••• (deixe vazio para manter)' : ''}
                  onChange={(e) => setForm((f) => ({ ...f, getnetClientSecret: e.target.value }))}
                />
              </label>
              <label className="field" style={{ flex: '1 1 160px' }}>
                Channel
                <input
                  value={form.getnetChannel}
                  onChange={(e) => setForm((f) => ({ ...f, getnetChannel: e.target.value }))}
                />
              </label>
              <label className="field" style={{ flex: '1 1 100px' }}>
                Scope
                <input
                  value={form.getnetScope}
                  onChange={(e) => setForm((f) => ({ ...f, getnetScope: e.target.value }))}
                />
              </label>
            </div>
            <div className="form-row" style={{ flexWrap: 'wrap', gap: '1rem', marginTop: '0.75rem' }}>
              <label className="field" style={{ flex: '1 1 180px' }}>
                Webhook user
                <input
                  value={form.getnetWebhookUser}
                  onChange={(e) => setForm((f) => ({ ...f, getnetWebhookUser: e.target.value }))}
                />
              </label>
              <label className="field" style={{ flex: '1 1 180px' }}>
                Webhook password
                <input
                  type="password"
                  value={form.getnetWebhookPassword}
                  onChange={(e) => setForm((f) => ({ ...f, getnetWebhookPassword: e.target.value }))}
                />
              </label>
            </div>
            {webhookUrls ? (
              <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginTop: '0.5rem' }}>
                Webhook Getnet: <code>{webhookUrls.getnet}</code>
              </p>
            ) : null}
          </fieldset>
          ) : (
            <p style={{ fontSize: '0.88rem', color: 'var(--color-text-muted)', margin: '0 0 1.25rem' }}>
              Getnet oculto até credenciamento.{' '}
              <button
                type="button"
                className="btn btn-link"
                style={{ padding: 0 }}
                onClick={() => setForm((f) => ({ ...f, getnetEnabled: true }))}
              >
                Configurar Getnet
              </button>
            </p>
          )}

          <fieldset style={{ border: 0, padding: 0, margin: '0 0 1.25rem' }}>
            <legend style={{ fontWeight: 700, marginBottom: '0.75rem' }}>Mercado Pago — provedor ativo</legend>
            <label style={{ display: 'block', marginBottom: '0.75rem' }}>
              <input
                type="checkbox"
                checked={form.mercadoPagoEnabled}
                onChange={(e) => setForm((f) => ({ ...f, mercadoPagoEnabled: e.target.checked }))}
              />{' '}
              Habilitar Mercado Pago
              {settingsQ.data?.hasMercadoPagoCredentials ? ' (token salvo)' : ''}
            </label>
            <div className="form-row" style={{ flexWrap: 'wrap', gap: '1rem' }}>
              <label className="field" style={{ flex: '1 1 280px' }}>
                Access Token (backend)
                <input
                  type="password"
                  value={form.mercadoPagoAccessToken}
                  placeholder={
                    settingsQ.data?.hasMercadoPagoCredentials ? '•••• (deixe vazio para manter)' : ''
                  }
                  onChange={(e) => setForm((f) => ({ ...f, mercadoPagoAccessToken: e.target.value }))}
                />
              </label>
              <label className="field" style={{ flex: '1 1 220px' }}>
                Public Key (PDV / Brick)
                <input
                  value={form.mercadoPagoPublicKey}
                  onChange={(e) => setForm((f) => ({ ...f, mercadoPagoPublicKey: e.target.value }))}
                />
              </label>
              <label className="field" style={{ flex: '1 1 220px' }}>
                Webhook secret
                <input
                  type="password"
                  value={form.mercadoPagoWebhookSecret}
                  onChange={(e) => setForm((f) => ({ ...f, mercadoPagoWebhookSecret: e.target.value }))}
                />
              </label>
            </div>
            {webhookUrls ? (
              <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginTop: '0.5rem' }}>
                Webhook MP (evento Order): <code>{webhookUrls.mercadoPago}</code>
              </p>
            ) : null}
          </fieldset>

          <button type="submit" className="btn btn-primary" disabled={saveMut.isPending}>
            {saveMut.isPending ? 'Salvando…' : 'Salvar configurações'}
          </button>
        </form>
      )}
    </div>
  );
}
