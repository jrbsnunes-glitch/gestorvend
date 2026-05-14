import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { isManager } from '../lib/auth';

type Company = {
  id: string;
  legalName: string;
  tradeName: string;
  cnpj: string;
  ie: string | null;
  im: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  logoUrl: string | null;
  saleReceiptAutoPrint?: boolean;
  saleReceiptPrinterHint?: string | null;
};

type FormState = Omit<Company, 'id'>;

const EMPTY_FORM: FormState = {
  legalName: '',
  tradeName: '',
  cnpj: '',
  ie: '',
  im: '',
  email: '',
  phone: '',
  address: '',
  city: '',
  state: '',
  zip: '',
  logoUrl: '',
  saleReceiptAutoPrint: false,
  saleReceiptPrinterHint: '',
};

function toForm(c: Company): FormState {
  return {
    legalName: c.legalName ?? '',
    tradeName: c.tradeName ?? '',
    cnpj: c.cnpj ?? '',
    ie: c.ie ?? '',
    im: c.im ?? '',
    email: c.email ?? '',
    phone: c.phone ?? '',
    address: c.address ?? '',
    city: c.city ?? '',
    state: c.state ?? '',
    zip: c.zip ?? '',
    logoUrl: c.logoUrl ?? '',
    saleReceiptAutoPrint: Boolean(c.saleReceiptAutoPrint),
    saleReceiptPrinterHint: c.saleReceiptPrinterHint ?? '',
  };
}

export function CompanyPage() {
  const qc = useQueryClient();
  const manager = isManager();
  const company = useQuery({
    queryKey: ['company'],
    queryFn: () => api<Company>('/company'),
  });

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [touched, setTouched] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  useEffect(() => {
    if (company.data && !touched) setForm(toForm(company.data));
  }, [company.data, touched]);

  const save = useMutation({
    mutationFn: (payload: Partial<FormState>) =>
      api<Company>('/company', { method: 'PATCH', json: payload }),
    onSuccess: (data) => {
      qc.setQueryData(['company'], data);
      setTouched(false);
      setFeedback({ kind: 'ok', msg: 'Dados da empresa atualizados.' });
    },
    onError: (err: Error) => {
      setFeedback({ kind: 'err', msg: err.message });
    },
  });

  if (!manager) {
    return (
      <div className="page">
        <h1 className="page-title">Empresa</h1>
        <div className="alert alert-error">
          Apenas usuários com perfil <strong>Gerente</strong> podem acessar este cadastro.
        </div>
      </div>
    );
  }

  function update<K extends keyof FormState>(k: K, v: FormState[K]) {
    setTouched(true);
    setFeedback(null);
    setForm((prev) => ({ ...prev, [k]: v }));
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    save.mutate(form);
  }

  return (
    <div className="page">
      <h1 className="page-title">Empresa</h1>
      <p className="page-desc">
        Dados cadastrais da loja — usados nos cabeçalhos de impressões e relatórios.
      </p>

      {company.isLoading && <p>Carregando…</p>}
      {company.isError && (
        <div className="alert alert-error">{(company.error as Error)?.message}</div>
      )}

      {company.data && (
        <form onSubmit={onSubmit} style={{ maxWidth: 880 }}>
          <section className="card" style={{ padding: '1.1rem 1.25rem', marginBottom: '1rem' }}>
            <h2 style={{ marginTop: 0, fontSize: '0.95rem' }}>Identificação</h2>
            <div className="form-row">
              <div className="field" style={{ flex: 2 }}>
                <label htmlFor="c-legal">Razão social *</label>
                <input
                  id="c-legal"
                  value={form.legalName}
                  onChange={(e) => update('legalName', e.target.value)}
                  required
                />
              </div>
              <div className="field" style={{ flex: 2 }}>
                <label htmlFor="c-trade">Nome fantasia *</label>
                <input
                  id="c-trade"
                  value={form.tradeName}
                  onChange={(e) => update('tradeName', e.target.value)}
                  required
                />
              </div>
            </div>
            <div className="form-row">
              <div className="field">
                <label htmlFor="c-cnpj">CNPJ *</label>
                <input
                  id="c-cnpj"
                  value={form.cnpj}
                  onChange={(e) => update('cnpj', e.target.value)}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="c-ie">Inscrição estadual</label>
                <input
                  id="c-ie"
                  value={form.ie ?? ''}
                  onChange={(e) => update('ie', e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="c-im">Inscrição municipal</label>
                <input
                  id="c-im"
                  value={form.im ?? ''}
                  onChange={(e) => update('im', e.target.value)}
                />
              </div>
            </div>
          </section>

          <section className="card" style={{ padding: '1.1rem 1.25rem', marginBottom: '1rem' }}>
            <h2 style={{ marginTop: 0, fontSize: '0.95rem' }}>Contato</h2>
            <div className="form-row">
              <div className="field" style={{ flex: 2 }}>
                <label htmlFor="c-email">E-mail</label>
                <input
                  id="c-email"
                  type="email"
                  value={form.email ?? ''}
                  onChange={(e) => update('email', e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="c-phone">Telefone</label>
                <input
                  id="c-phone"
                  value={form.phone ?? ''}
                  onChange={(e) => update('phone', e.target.value)}
                />
              </div>
            </div>
          </section>

          <section className="card" style={{ padding: '1.1rem 1.25rem', marginBottom: '1rem' }}>
            <h2 style={{ marginTop: 0, fontSize: '0.95rem' }}>Endereço</h2>
            <div className="form-row">
              <div className="field" style={{ flex: 3 }}>
                <label htmlFor="c-addr">Logradouro</label>
                <input
                  id="c-addr"
                  value={form.address ?? ''}
                  onChange={(e) => update('address', e.target.value)}
                  placeholder="Rua, número, bairro"
                />
              </div>
              <div className="field">
                <label htmlFor="c-zip">CEP</label>
                <input
                  id="c-zip"
                  value={form.zip ?? ''}
                  onChange={(e) => update('zip', e.target.value)}
                />
              </div>
            </div>
            <div className="form-row">
              <div className="field" style={{ flex: 2 }}>
                <label htmlFor="c-city">Cidade</label>
                <input
                  id="c-city"
                  value={form.city ?? ''}
                  onChange={(e) => update('city', e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="c-state">UF</label>
                <input
                  id="c-state"
                  value={form.state ?? ''}
                  onChange={(e) => update('state', e.target.value.toUpperCase())}
                  maxLength={2}
                />
              </div>
            </div>
          </section>

          <section className="card" style={{ padding: '1.1rem 1.25rem', marginBottom: '1rem' }}>
            <h2 style={{ marginTop: 0, fontSize: '0.95rem' }}>PDV — cupom não fiscal</h2>
            <p style={{ margin: '0 0 0.75rem', fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>
              Mesmo com o GestorVend hospedado na nuvem, a impressão ocorre no{' '}
              <strong>navegador do computador do caixa</strong>, usando as impressoras instaladas
              localmente. Não é possível designar remotamente qual driver será usado: defina a térmica
              como <strong>impressora padrão</strong> no Windows ou escolha-a no diálogo &quot;Imprimir&quot;.
            </p>
            <div className="field" style={{ marginBottom: '0.85rem' }}>
              <label htmlFor="c-autoprint" style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
                <input
                  id="c-autoprint"
                  type="checkbox"
                  checked={Boolean(form.saleReceiptAutoPrint)}
                  onChange={(e) => update('saleReceiptAutoPrint', e.target.checked)}
                  style={{ marginTop: '0.15rem' }}
                />
                <span>
                  Abrir impressão automaticamente após finalizar cada venda no PDV
                  <span style={{ display: 'block', fontSize: '0.78rem', color: 'var(--color-text-muted)', fontWeight: 400 }}>
                    O operador pode desativar só na estação dele (PDV → Impressão). O navegador pode
                    ainda exibir o diálogo de impressão — impressão totalmente silenciosa exige quiosque ou
                    serviço auxiliar instalado no PC.
                  </span>
                </span>
              </label>
            </div>
            <div className="field">
              <label htmlFor="c-printer-hint">Referência da impressora de cupom (opcional)</label>
              <input
                id="c-printer-hint"
                value={form.saleReceiptPrinterHint ?? ''}
                onChange={(e) => update('saleReceiptPrinterHint', e.target.value)}
                placeholder="Ex.: Epson TM-T20 · USB001 · IP 192.168.0.50"
              />
              <span style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
                Texto de apoio para TI e operadores; o sistema não conecta a esse nome automaticamente.
              </span>
            </div>
          </section>

          <section className="card" style={{ padding: '1.1rem 1.25rem', marginBottom: '1rem' }}>
            <h2 style={{ marginTop: 0, fontSize: '0.95rem' }}>Identidade visual</h2>
            <div className="form-row">
              <div className="field" style={{ flex: 2 }}>
                <label htmlFor="c-logo">URL do logotipo</label>
                <input
                  id="c-logo"
                  value={form.logoUrl ?? ''}
                  onChange={(e) => update('logoUrl', e.target.value)}
                  placeholder="https://…/logo.png"
                />
              </div>
              {form.logoUrl && (
                <div style={{ alignSelf: 'flex-end' }}>
                  <img
                    src={form.logoUrl}
                    alt="Pré-visualização do logotipo"
                    style={{ maxHeight: 64, maxWidth: 200, border: '1px solid var(--color-border)', borderRadius: 8, padding: 4, background: '#fff' }}
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                </div>
              )}
            </div>
          </section>

          {feedback && (
            <div className={feedback.kind === 'ok' ? 'alert alert-success' : 'alert alert-error'}>
              {feedback.msg}
            </div>
          )}

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!touched || save.isPending}
            >
              {save.isPending ? 'Salvando…' : 'Salvar alterações'}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={!touched || save.isPending}
              onClick={() => {
                if (company.data) setForm(toForm(company.data));
                setTouched(false);
                setFeedback(null);
              }}
            >
              Cancelar
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
