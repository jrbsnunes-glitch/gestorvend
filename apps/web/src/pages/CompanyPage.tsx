import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { api, apiUpload } from '../lib/api';
import { resolveCompanyAssetUrl } from '../lib/company-branding';
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
  /** Comprovante interno × planejamento documento fiscal (NF-e futura). */
  pdvDocumentMode?: 'NON_FISCAL_RECEIPT' | 'ELECTRONIC_FISCAL_PLANNED';
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
  pdvDocumentMode: 'NON_FISCAL_RECEIPT',
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
    pdvDocumentMode: c.pdvDocumentMode ?? 'NON_FISCAL_RECEIPT',
    saleReceiptAutoPrint: Boolean(c.saleReceiptAutoPrint),
    saleReceiptPrinterHint: c.saleReceiptPrinterHint ?? '',
  };
}

type IssuerSettingsPublic = {
  sefazEnvironment: 'HOMOLOGACAO' | 'PRODUCAO';
  crt: number;
  uf: string;
  municipalityIbge: string;
  nfceSerie: number;
  nfeSerie: number;
  nfceLastNumber: number;
  nfeLastNumber: number;
  certificatePath: string | null;
  certPathFromEnvFallback: boolean;
  hasCertificatePasswordInDb: boolean;
  certificatePasswordConfigured: boolean;
  nfceCscId: string | null;
  hasNfceCscSecretInDb: boolean;
  nfceCscSecretConfigured: boolean;
  nfceCscIdConfigured: boolean;
  nfceCscIdFromEnvFallback: boolean;
  nfceCscSecretFromEnvFallback: boolean;
};

function IssuerEmissorCard() {
  const qc = useQueryClient();
  const [uf, setUf] = useState('');
  const [municipalityIbge, setMunicipalityIbge] = useState('');
  const [nfceSerie, setNfceSerie] = useState(1);
  const [crt, setCrt] = useState(1);
  const [sefazEnvironment, setSefazEnvironment] = useState<'HOMOLOGACAO' | 'PRODUCAO'>(
    'HOMOLOGACAO',
  );
  const [certificatePath, setCertificatePath] = useState('');
  const [nfceCscIdInput, setNfceCscIdInput] = useState('');
  const [nfceCscSecretInput, setNfceCscSecretInput] = useState('');
  const [certificatePasswordInput, setCertificatePasswordInput] = useState('');
  const [clearNfceCsc, setClearNfceCsc] = useState(false);
  const [clearCertificatePassword, setClearCertificatePassword] = useState(false);
  const [issuerFeedback, setIssuerFeedback] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(
    null,
  );

  const issuer = useQuery({
    queryKey: ['fiscal-issuer-settings'],
    queryFn: () => api<IssuerSettingsPublic>('/fiscal/issuer-settings'),
  });

  useEffect(() => {
    if (!issuer.data) return;
    const d = issuer.data;
    setUf(d.uf);
    setMunicipalityIbge(d.municipalityIbge);
    setNfceSerie(d.nfceSerie);
    setCrt(d.crt);
    setSefazEnvironment(d.sefazEnvironment);
    setCertificatePath(d.certificatePath ?? '');
    setNfceCscIdInput(d.nfceCscId ?? '');
    setNfceCscSecretInput('');
    setCertificatePasswordInput('');
    setClearNfceCsc(false);
    setClearCertificatePassword(false);
  }, [issuer.data]);

  const saveIssuer = useMutation({
    mutationFn: () => {
      const json: Record<string, unknown> = {
        uf,
        municipalityIbge,
        nfceSerie,
        crt,
        sefazEnvironment,
        certificatePath: certificatePath.trim() || null,
        nfceCscId: nfceCscIdInput.trim() || null,
      };
      if (clearNfceCsc) json.clearNfceCsc = true;
      else if (nfceCscSecretInput.trim()) json.nfceCsc = nfceCscSecretInput.trim();
      if (clearCertificatePassword) json.clearCertificatePassword = true;
      else if (certificatePasswordInput.trim()) json.certificatePassword = certificatePasswordInput.trim();
      return api<IssuerSettingsPublic>('/fiscal/issuer-settings', {
        method: 'PATCH',
        json,
      });
    },
    onSuccess: (data) => {
      qc.setQueryData(['fiscal-issuer-settings'], data);
      setIssuerFeedback({ kind: 'ok', msg: 'Configurações do emissor salvas.' });
      setNfceCscSecretInput('');
      setCertificatePasswordInput('');
      setClearNfceCsc(false);
      setClearCertificatePassword(false);
    },
    onError: (e: Error) => setIssuerFeedback({ kind: 'err', msg: e.message }),
  });

  return (
    <>
      <p style={{ margin: '0 0 0.75rem', fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>
        Usado pelo worker da API (~60&nbsp;s) com <code>FISCAL_MODULE_ENABLED=true</code>. CSC, token CSC e senha do
        .pfx podem ser gravados por cliente (abaixo); variáveis <code>FISCAL_*</code> no servidor ficam só como
        <strong> fallback</strong> quando o campo na base está vazio.
      </p>
      {issuer.isLoading && <p className="muted">Carregando emissor…</p>}
      {issuer.isError && <div className="alert alert-error">{(issuer.error as Error).message}</div>}
      {issuerFeedback && (
        <div
          className={issuerFeedback.kind === 'ok' ? 'alert alert-success' : 'alert alert-error'}
          style={{ marginBottom: '0.75rem', fontSize: '0.86rem' }}
        >
          {issuerFeedback.msg}
        </div>
      )}
      {issuer.data && (
        <>
          <p style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', marginBottom: '0.75rem' }}>
            Esta versão trata apenas <strong>CRT&nbsp;=&nbsp;1 (Simples)</strong> no XML. Última NFC-e gravada pelo
            worker: <strong>{issuer.data.nfceLastNumber}</strong>. Certificado efetivo:{' '}
            <strong>
              [{issuer.data.certificatePasswordConfigured ? 'senha OK' : 'sem senha'} |{' '}
              {issuer.data.certificatePath?.trim() || issuer.data.certPathFromEnvFallback
                ? 'caminho OK'
                : 'sem caminho'}
              ]
            </strong>
            . CSC efetivo:{' '}
            <strong>
              [
              {issuer.data.nfceCscIdConfigured ? 'ID OK' : 'sem ID'}, {issuer.data.nfceCscSecretConfigured ? 'token OK' : 'sem token'}
              ]
            </strong>
            {(issuer.data.nfceCscIdFromEnvFallback || issuer.data.nfceCscSecretFromEnvFallback) && (
              <span>
                {' '}
                · parte via <code>.env</code> da API
              </span>
            )}
          </p>
          <div className="form-row">
            <div className="field">
              <label htmlFor="iss-uf">UF emissor</label>
              <input
                id="iss-uf"
                value={uf}
                maxLength={2}
                onChange={(e) => setUf(e.target.value.toUpperCase())}
              />
            </div>
            <div className="field" style={{ flex: 2 }}>
              <label htmlFor="iss-mun">IBGE município (7 dígitos)</label>
              <input
                id="iss-mun"
                value={municipalityIbge}
                onChange={(e) => setMunicipalityIbge(e.target.value.replace(/\D/g, '').slice(0, 7))}
              />
            </div>
            <div className="field">
              <label htmlFor="iss-serie">Série NFC-e</label>
              <input
                id="iss-serie"
                type="number"
                min={1}
                max={999}
                value={nfceSerie}
                onChange={(e) => setNfceSerie(Number(e.target.value) || 1)}
              />
            </div>
          </div>
          <div className="form-row">
            <div className="field">
              <label htmlFor="iss-crt">CRT</label>
              <select id="iss-crt" value={crt} onChange={(e) => setCrt(Number(e.target.value))}>
                <option value={1}>1 — Simples Nacional</option>
                <option value={2}>2 — SN excesso</option>
                <option value={3}>3 — Regime normal</option>
              </select>
              <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                O worker atual rejeitará CRT ≠ 1 até extensões do XML ICMS normal.
              </span>
            </div>
            <div className="field" style={{ flex: 2 }}>
              <label>Ambiente SEFAZ gravado nos documentos</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginTop: '0.25rem' }}>
                <label style={{ display: 'flex', gap: '0.45rem', alignItems: 'center' }}>
                  <input
                    type="radio"
                    name="iss-amb"
                    checked={sefazEnvironment === 'HOMOLOGACAO'}
                    onChange={() => setSefazEnvironment('HOMOLOGACAO')}
                  />
                  Homologação
                </label>
                <label style={{ display: 'flex', gap: '0.45rem', alignItems: 'center' }}>
                  <input
                    type="radio"
                    name="iss-amb"
                    checked={sefazEnvironment === 'PRODUCAO'}
                    onChange={() => setSefazEnvironment('PRODUCAO')}
                  />
                  Produção
                </label>
              </div>
            </div>
          </div>
          <div className="field" style={{ marginBottom: '0.85rem' }}>
            <label htmlFor="iss-cert-path">Caminho absoluto .pfx no servidor (opcional)</label>
            <input
              id="iss-cert-path"
              value={certificatePath}
              onChange={(e) => setCertificatePath(e.target.value)}
              placeholder="Ou use apenas FISCAL_ISSUER_CERT_PATH no servidor"
              autoComplete="off"
            />
          </div>
          <div className="field" style={{ marginBottom: '0.85rem' }}>
            <label htmlFor="iss-cert-pwd">Senha do .pfx (grava na base deste cliente)</label>
            <input
              id="iss-cert-pwd"
              type="password"
              value={certificatePasswordInput}
              onChange={(e) => setCertificatePasswordInput(e.target.value)}
              placeholder={issuer.data.hasCertificatePasswordInDb ? '•••• deixe vazio para manter' : 'Obrigatório para emitir'}
              autoComplete="new-password"
            />
            <label style={{ display: 'flex', gap: '0.45rem', alignItems: 'center', marginTop: '0.35rem' }}>
              <input
                type="checkbox"
                checked={clearCertificatePassword}
                onChange={(e) => {
                  setClearCertificatePassword(e.target.checked);
                  if (e.target.checked) setCertificatePasswordInput('');
                }}
              />
              Remover senha guardada na base (passa a usar só <code>FISCAL_ISSUER_CERT_PASSWORD</code> se existir)
            </label>
          </div>
          <div className="form-row" style={{ marginBottom: '0.85rem' }}>
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="iss-csc-id">CSC ID (NFC-e)</label>
              <input
                id="iss-csc-id"
                value={nfceCscIdInput}
                onChange={(e) => setNfceCscIdInput(e.target.value)}
                placeholder="Código do contribuinte no portal estadual"
                autoComplete="off"
              />
            </div>
            <div className="field" style={{ flex: 2 }}>
              <label htmlFor="iss-csc-token">Token / segredo CSC</label>
              <input
                id="iss-csc-token"
                type="password"
                value={nfceCscSecretInput}
                onChange={(e) => setNfceCscSecretInput(e.target.value)}
                placeholder={issuer.data.hasNfceCscSecretInDb ? '•••• deixe vazio para manter' : 'Inclua para QR / SOAP'}
                autoComplete="new-password"
              />
            </div>
          </div>
          <label
            style={{
              display: 'flex',
              gap: '0.45rem',
              alignItems: 'center',
              marginBottom: '0.85rem',
              fontSize: '0.86rem',
            }}
          >
            <input
              type="checkbox"
              checked={clearNfceCsc}
              onChange={(e) => {
                setClearNfceCsc(e.target.checked);
                if (e.target.checked) setNfceCscSecretInput('');
              }}
            />
            Remover token CSC guardado na base (usa só <code>FISCAL_NFCE_CSC</code> se existir)
          </label>
          <button
            type="button"
            className="btn btn-primary"
            disabled={saveIssuer.isPending}
            onClick={() => {
              setIssuerFeedback(null);
              saveIssuer.mutate();
            }}
          >
            {saveIssuer.isPending ? 'Salvando…' : 'Salvar emissor NFC-e'}
          </button>
          <p style={{ marginTop: '0.75rem', fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
            <code>FISCAL_EMIT_TRANSPORT=dry-run</code> assina e autoriza NFC-e fictícia com protocolo <code>DRY-RUN</code>.
            SOAP requer CSC e URL correta do autorizador.
          </p>
        </>
      )}
    </>
  );
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
  const [logoPreviewKey, setLogoPreviewKey] = useState(0);

  useEffect(() => {
    if (company.data && !touched) setForm(toForm(company.data));
  }, [company.data, touched]);

  const uploadLogo = useMutation({
    mutationFn: (file: File) => apiUpload<Company>('/company/logo', file),
    onSuccess: (data) => {
      qc.setQueryData(['company'], data);
      setForm(toForm(data));
      setTouched(false);
      setLogoPreviewKey((k) => k + 1);
      setFeedback({
        kind: 'ok',
        msg: 'Logotipo enviado ao servidor. Já aparece no PDV, relatórios e cupom.',
      });
    },
    onError: (err: Error) => setFeedback({ kind: 'err', msg: err.message }),
  });

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
            <h2 style={{ marginTop: 0, fontSize: '0.95rem' }}>PDV — documento da venda</h2>
            <p style={{ margin: '0 0 0.75rem', fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>
              Defina se o fluxo atual é apenas <strong>comprovante interno não fiscal</strong> (cupom térmico) ou se a
              empresa está em <strong>preparação para documento fiscal eletrônico</strong> (NF-e/NFC-e + campos CBS/IBS na
              transição). Isso não ativa integração com a SEFAZ — use a variável de ambiente <code>FISCAL_MODULE_ENABLED</code>{' '}
              na API quando o certificado estiver pronto.
            </p>
            <div className="field" style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
              <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', fontWeight: 600 }}>
                <input
                  type="radio"
                  name="pdv-doc-mode"
                  checked={form.pdvDocumentMode === 'NON_FISCAL_RECEIPT'}
                  onChange={() =>
                    update('pdvDocumentMode', 'NON_FISCAL_RECEIPT')
                  }
                />
                <span>
                  Comprovante / cupom não fiscal (padrão)
                  <span style={{ display: 'block', fontSize: '0.78rem', fontWeight: 400, color: 'var(--color-text-muted)' }}>
                    Impressão local; sem transmissão à Receita.
                  </span>
                </span>
              </label>
              <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', fontWeight: 600 }}>
                <input
                  type="radio"
                  name="pdv-doc-mode"
                  checked={form.pdvDocumentMode === 'ELECTRONIC_FISCAL_PLANNED'}
                  onChange={() =>
                    update('pdvDocumentMode', 'ELECTRONIC_FISCAL_PLANNED')
                  }
                />
                <span>
                  Planejamento para documento fiscal (NF-e/NFC-e)
                  <span style={{ display: 'block', fontSize: '0.78rem', fontWeight: 400, color: 'var(--color-text-muted)' }}>
                    Usa cadastros fiscais mestre (Situação fiscal) e, quando o módulo estiver ativo, tentará emissão
                    eletrônica. Em 2026 a legislação prevê destaque informativo CBS/IBS nos DFe — consulte normas atuais.
                  </span>
                </span>
              </label>
            </div>
          </section>

          <section className="card" style={{ padding: '1.1rem 1.25rem', marginBottom: '1rem' }}>
            <h2 style={{ marginTop: 0, fontSize: '0.95rem' }}>Emissor NFC-e (servidor)</h2>
            <IssuerEmissorCard />
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
            <p style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', marginTop: 0 }}>
              A logo aparece nos relatórios, na página inicial, no PDV e no cupom não fiscal.
              Caminhos do Windows (<code>C:\…\logo.png</code>) <strong>não funcionam</strong> no
              navegador — use o envio de arquivo abaixo ou uma URL pública na internet.
            </p>

            <div className="field" style={{ marginBottom: '0.85rem' }}>
              <label htmlFor="c-logo-file">Enviar arquivo do computador (recomendado)</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
                <input
                  id="c-logo-file"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  disabled={uploadLogo.isPending}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    uploadLogo.mutate(file);
                    e.target.value = '';
                  }}
                />
                {uploadLogo.isPending ? (
                  <span style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>
                    Enviando…
                  </span>
                ) : null}
              </div>
              <span style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
                PNG, JPEG ou WebP · até 2 MB · fica salvo no servidor da loja.
              </span>
            </div>

            <div className="form-row">
              <div className="field" style={{ flex: 2 }}>
                <label htmlFor="c-logo">Ou URL pública na internet (opcional)</label>
                <input
                  id="c-logo"
                  value={form.logoUrl ?? ''}
                  onChange={(e) => update('logoUrl', e.target.value)}
                  placeholder="https://seusite.com.br/logo.png"
                />
                <span style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
                  Use se a imagem já estiver hospedada (site, CDN, Google Drive com link direto, etc.).
                </span>
              </div>
              {form.logoUrl && (
                <div style={{ alignSelf: 'flex-end' }}>
                  <img
                    key={logoPreviewKey}
                    src={`${resolveCompanyAssetUrl(form.logoUrl)}${form.logoUrl.includes('?') ? '&' : '?'}v=${logoPreviewKey}`}
                    alt="Pré-visualização do logotipo"
                    style={{
                      maxHeight: 64,
                      maxWidth: 200,
                      border: '1px solid var(--color-border)',
                      borderRadius: 8,
                      padding: 4,
                      background: '#fff',
                    }}
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
