import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { api, apiUpload } from '../lib/api';
import { resolveCompanyAssetUrl } from '../lib/company-branding';
import { useMenuAccess } from '../hooks/useMenuAccess';
import { digitsOnly, formatCep, formatCnpj } from '../lib/format';
import { lookupCep } from '../lib/lookups';

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
  restaurantModuleEnabled?: boolean;
  comandaNumberingMode?: 'DYNAMIC' | 'FIXED';
  scaleMode?: 'MANUAL' | 'SERIAL_DIRECT' | 'AGENT' | 'BARCODE_LABEL';
  scaleProfile?: string | null;
  barcodeWeightPattern?: string | null;
  scaleAutoConfirmMs?: number;
  scaleHint?: string | null;
  kitchenPrinterHint?: string | null;
  serviceFeeEnabled?: boolean;
  serviceFeeMode?: 'PERCENT' | 'FIXED';
  serviceFeeValue?: string | number | null;
  couvertEnabled?: boolean;
  couvertMode?: 'PERCENT' | 'FIXED';
  couvertValue?: string | number | null;
  waiterTipEnabled?: boolean;
  waiterTipMode?: 'PERCENT' | 'FIXED';
  waiterTipValue?: string | number | null;
  cashExpenseInPresentedTotal?: boolean;
  serviceOrderModuleEnabled?: boolean;
  serviceOrderDefaultBillingMode?: 'PDV' | 'INTERNAL' | 'CHOICE_PER_ORDER';
  serviceOrderRequireEquipment?: boolean;
  serviceOrderAllowQuote?: boolean;
  serviceOrderTermsText?: string | null;
};

type FormState = Omit<Company, 'id'>;

type FeeMode = 'PERCENT' | 'FIXED';

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
  restaurantModuleEnabled: false,
  comandaNumberingMode: 'DYNAMIC',
  scaleMode: 'MANUAL',
  scaleProfile: '',
  barcodeWeightPattern: '2PPPPPWWWWWC',
  scaleAutoConfirmMs: 700,
  scaleHint: '',
  kitchenPrinterHint: '',
  serviceFeeEnabled: false,
  serviceFeeMode: 'PERCENT',
  serviceFeeValue: 0,
  couvertEnabled: false,
  couvertMode: 'FIXED',
  couvertValue: 0,
  waiterTipEnabled: false,
  waiterTipMode: 'PERCENT',
  waiterTipValue: 0,
  cashExpenseInPresentedTotal: false,
  serviceOrderModuleEnabled: false,
  serviceOrderDefaultBillingMode: 'CHOICE_PER_ORDER',
  serviceOrderRequireEquipment: false,
  serviceOrderAllowQuote: true,
  serviceOrderTermsText: '',
};

function toForm(c: Company): FormState {
  return {
    legalName: c.legalName ?? '',
    tradeName: c.tradeName ?? '',
    cnpj: formatCnpj(c.cnpj ?? ''),
    ie: c.ie ?? '',
    im: c.im ?? '',
    email: c.email ?? '',
    phone: c.phone ?? '',
    address: c.address ?? '',
    city: c.city ?? '',
    state: c.state ?? '',
    zip: c.zip ? formatCep(c.zip) : '',
    logoUrl: c.logoUrl ?? '',
    pdvDocumentMode: c.pdvDocumentMode ?? 'NON_FISCAL_RECEIPT',
    saleReceiptAutoPrint: Boolean(c.saleReceiptAutoPrint),
    saleReceiptPrinterHint: c.saleReceiptPrinterHint ?? '',
    restaurantModuleEnabled: Boolean(c.restaurantModuleEnabled),
    comandaNumberingMode: c.comandaNumberingMode === 'FIXED' ? 'FIXED' : 'DYNAMIC',
    scaleMode: c.scaleMode ?? 'MANUAL',
    scaleProfile: c.scaleProfile ?? '',
    barcodeWeightPattern: c.barcodeWeightPattern ?? '2PPPPPWWWWWC',
    scaleAutoConfirmMs: c.scaleAutoConfirmMs ?? 700,
    scaleHint: c.scaleHint ?? '',
    kitchenPrinterHint: c.kitchenPrinterHint ?? '',
    serviceFeeEnabled: Boolean(c.serviceFeeEnabled),
    serviceFeeMode: c.serviceFeeMode === 'FIXED' ? 'FIXED' : 'PERCENT',
    serviceFeeValue: Number(c.serviceFeeValue ?? 0),
    couvertEnabled: Boolean(c.couvertEnabled),
    couvertMode: c.couvertMode === 'PERCENT' ? 'PERCENT' : 'FIXED',
    couvertValue: Number(c.couvertValue ?? 0),
    waiterTipEnabled: Boolean(c.waiterTipEnabled),
    waiterTipMode: c.waiterTipMode === 'FIXED' ? 'FIXED' : 'PERCENT',
    waiterTipValue: Number(c.waiterTipValue ?? 0),
    cashExpenseInPresentedTotal: Boolean(c.cashExpenseInPresentedTotal),
    serviceOrderModuleEnabled: Boolean(c.serviceOrderModuleEnabled),
    serviceOrderDefaultBillingMode:
      c.serviceOrderDefaultBillingMode === 'PDV' ||
      c.serviceOrderDefaultBillingMode === 'INTERNAL'
        ? c.serviceOrderDefaultBillingMode
        : 'CHOICE_PER_ORDER',
    serviceOrderRequireEquipment: Boolean(c.serviceOrderRequireEquipment),
    serviceOrderAllowQuote: c.serviceOrderAllowQuote !== false,
    serviceOrderTermsText: c.serviceOrderTermsText ?? '',
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
  certificateManagedUpload: boolean;
  certPathFromEnvFallback: boolean;
  hasCertificatePasswordInDb: boolean;
  certificatePasswordConfigured: boolean;
  nfceCscId: string | null;
  hasNfceCscSecretInDb: boolean;
  nfceCscSecretConfigured: boolean;
  nfceCscIdConfigured: boolean;
  nfceCscIdFromEnvFallback: boolean;
  nfceCscSecretFromEnvFallback: boolean;
  inboundAutoReceiptEnabled: boolean;
  inboundAutoReceiptPostStock: boolean;
  inboundAutoReceiptMinMatchPercent: number;
  inboundUltNsu: string | null;
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
  const [inboundAutoReceiptEnabled, setInboundAutoReceiptEnabled] = useState(false);
  const [inboundAutoReceiptPostStock, setInboundAutoReceiptPostStock] = useState(false);
  const [inboundAutoReceiptMinMatchPercent, setInboundAutoReceiptMinMatchPercent] = useState(100);
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
    setInboundAutoReceiptEnabled(Boolean(d.inboundAutoReceiptEnabled));
    setInboundAutoReceiptPostStock(Boolean(d.inboundAutoReceiptPostStock));
    setInboundAutoReceiptMinMatchPercent(d.inboundAutoReceiptMinMatchPercent ?? 100);
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
        inboundAutoReceiptEnabled,
        inboundAutoReceiptPostStock,
        inboundAutoReceiptMinMatchPercent,
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

  const uploadCert = useMutation({
    mutationFn: (file: File) => {
      const fields: Record<string, string> = {};
      if (certificatePasswordInput.trim()) {
        fields.certificatePassword = certificatePasswordInput.trim();
      }
      return apiUpload<IssuerSettingsPublic>(
        '/fiscal/issuer-settings/certificate',
        file,
        'file',
        fields,
      );
    },
    onSuccess: (data) => {
      qc.setQueryData(['fiscal-issuer-settings'], data);
      setCertificatePath(data.certificatePath ?? '');
      setCertificatePasswordInput('');
      setClearCertificatePassword(false);
      setIssuerFeedback({
        kind: 'ok',
        msg: 'Certificado A1 enviado e instalado no servidor desta loja.',
      });
    },
    onError: (e: Error) => setIssuerFeedback({ kind: 'err', msg: e.message }),
  });

  return (
    <>
      <p className="company-form__hint">
        Worker da API (~60s) com <code>FISCAL_MODULE_ENABLED=true</code>. CSC/senha por cliente;{' '}
        <code>FISCAL_*</code> no servidor só como fallback.
      </p>
      {issuer.isLoading && <p className="muted">Carregando emissor…</p>}
      {issuer.isError && <div className="alert alert-error">{(issuer.error as Error).message}</div>}
      {issuerFeedback && (
        <div
          className={issuerFeedback.kind === 'ok' ? 'alert alert-success' : 'alert alert-error'}
          style={{ marginBottom: '0.5rem', fontSize: '0.82rem' }}
        >
          {issuerFeedback.msg}
        </div>
      )}
      {issuer.data && (
        <>
          <p className="company-form__status">
            CRT&nbsp;1 (Simples) · NFC-e #{issuer.data.nfceLastNumber} · Cert: [
            {issuer.data.certificatePasswordConfigured ? 'senha OK' : 'sem senha'} |{' '}
            {issuer.data.certificatePath?.trim() || issuer.data.certPathFromEnvFallback
              ? issuer.data.certificateManagedUpload
                ? 'arquivo no servidor'
                : 'caminho OK'
              : 'sem caminho'}
            ] · CSC: [{issuer.data.nfceCscIdConfigured ? 'ID OK' : 'sem ID'},{' '}
            {issuer.data.nfceCscSecretConfigured ? 'token OK' : 'sem token'}]
            {(issuer.data.nfceCscIdFromEnvFallback || issuer.data.nfceCscSecretFromEnvFallback) && (
              <span>
                {' '}
                · parte via <code>.env</code>
              </span>
            )}
          </p>
          <div className="form-row form-row--4">
            <div className="field">
              <label htmlFor="iss-uf">UF emissor</label>
              <input
                id="iss-uf"
                value={uf}
                maxLength={2}
                onChange={(e) => setUf(e.target.value.toUpperCase())}
              />
            </div>
            <div className="field">
              <label htmlFor="iss-mun">IBGE município</label>
              <input
                id="iss-mun"
                value={municipalityIbge}
                onChange={(e) => setMunicipalityIbge(e.target.value.replace(/\D/g, '').slice(0, 7))}
                inputMode="numeric"
                maxLength={7}
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
            <div className="field">
              <label htmlFor="iss-crt">CRT</label>
              <select id="iss-crt" value={crt} onChange={(e) => setCrt(Number(e.target.value))}>
                <option value={1}>1 — Simples Nacional</option>
                <option value={2}>2 — SN excesso</option>
                <option value={3}>3 — Regime normal</option>
              </select>
            </div>
          </div>
          <div className="inline-checks" style={{ marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-secondary)' }}>
              Ambiente SEFAZ
            </span>
            <label>
              <input
                type="radio"
                name="iss-amb"
                checked={sefazEnvironment === 'HOMOLOGACAO'}
                onChange={() => setSefazEnvironment('HOMOLOGACAO')}
              />
              Homologação
            </label>
            <label>
              <input
                type="radio"
                name="iss-amb"
                checked={sefazEnvironment === 'PRODUCAO'}
                onChange={() => setSefazEnvironment('PRODUCAO')}
              />
              Produção
            </label>
          </div>
          <details className="submenu-details" style={{ marginBottom: '0.65rem' }}>
            <summary className="submenu-summary">NF-e de entrada (Distribuição DF-e)</summary>
            <div className="submenu-body">
              <p className="company-form__hint" style={{ marginTop: 0 }}>
                Canal oficial do Ambiente Nacional (mesmo do Portal). Último NSU:{' '}
                <code>{issuer.data.inboundUltNsu ?? '0'}</code>
              </p>
              <label className="company-form__check">
                <input
                  type="checkbox"
                  checked={inboundAutoReceiptEnabled}
                  onChange={(e) => setInboundAutoReceiptEnabled(e.target.checked)}
                />
                <span>Lançar entrada automaticamente quando todos os itens tiverem match</span>
              </label>
              <label className="company-form__check" style={{ opacity: inboundAutoReceiptEnabled ? 1 : 0.55 }}>
                <input
                  type="checkbox"
                  disabled={!inboundAutoReceiptEnabled}
                  checked={inboundAutoReceiptPostStock}
                  onChange={(e) => setInboundAutoReceiptPostStock(e.target.checked)}
                />
                <span>Já confirmar estoque (senão cria só rascunho DRAFT)</span>
              </label>
              <div className="field" style={{ maxWidth: '12rem', marginTop: '0.35rem' }}>
                <label htmlFor="iss-auto-match">Match mínimo (%)</label>
                <input
                  id="iss-auto-match"
                  type="number"
                  min={0}
                  max={100}
                  disabled={!inboundAutoReceiptEnabled}
                  value={inboundAutoReceiptMinMatchPercent}
                  onChange={(e) =>
                    setInboundAutoReceiptMinMatchPercent(
                      Math.max(0, Math.min(100, Number(e.target.value) || 0)),
                    )
                  }
                />
              </div>
            </div>
          </details>
          <div className="form-row form-row--2">
            <div className="field">
              <label htmlFor="iss-cert-file">Certificado A1 (.pfx)</label>
              <input
                id="iss-cert-file"
                type="file"
                accept=".pfx,.p12,application/x-pkcs12"
                disabled={uploadCert.isPending}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  setIssuerFeedback(null);
                  uploadCert.mutate(file);
                  e.target.value = '';
                }}
              />
            </div>
            <div className="field">
              <label htmlFor="iss-cert-pwd">Senha do .pfx</label>
              <input
                id="iss-cert-pwd"
                type="password"
                value={certificatePasswordInput}
                onChange={(e) => setCertificatePasswordInput(e.target.value)}
                placeholder={
                  issuer.data.hasCertificatePasswordInDb
                    ? '•••• deixe vazio para manter'
                    : 'Informe antes de enviar o .pfx'
                }
                autoComplete="new-password"
              />
              <label className="company-form__check">
                <input
                  type="checkbox"
                  checked={clearCertificatePassword}
                  onChange={(e) => {
                    setClearCertificatePassword(e.target.checked);
                    if (e.target.checked) setCertificatePasswordInput('');
                  }}
                />
                <span>Remover senha da base (usa só <code>FISCAL_ISSUER_CERT_PASSWORD</code>)</span>
              </label>
            </div>
          </div>
          <p className="company-form__hint company-form__path">
            {uploadCert.isPending
              ? 'Enviando e validando…'
              : issuer.data.certificateManagedUpload
                ? 'Instalado no servidor desta loja (issuer.pfx).'
                : issuer.data.certificatePath?.trim()
                  ? (
                      <>
                        Caminho:{' '}
                        <code title={issuer.data.certificatePath}>{issuer.data.certificatePath}</code>
                      </>
                    )
                  : issuer.data.certPathFromEnvFallback
                    ? 'Usando FISCAL_ISSUER_CERT_PATH (fallback).'
                    : 'Nenhum certificado instalado. Informe a senha e envie o .pfx.'}
          </p>
          <details className="company-form__more">
            <summary>Avançado: caminho absoluto no servidor</summary>
            <div className="field" style={{ marginTop: '0.35rem' }}>
              <label htmlFor="iss-cert-path">Caminho absoluto .pfx (opcional)</label>
              <input
                id="iss-cert-path"
                value={certificatePath}
                onChange={(e) => setCertificatePath(e.target.value)}
                placeholder="Só se o arquivo já estiver na VPS sem usar o upload"
                autoComplete="off"
              />
            </div>
          </details>
          <div className="form-row form-row--2">
            <div className="field">
              <label htmlFor="iss-csc-id">CSC ID (NFC-e)</label>
              <input
                id="iss-csc-id"
                value={nfceCscIdInput}
                onChange={(e) => setNfceCscIdInput(e.target.value)}
                placeholder="Código do contribuinte no portal estadual"
                autoComplete="off"
              />
            </div>
            <div className="field">
              <label htmlFor="iss-csc-token">Token / segredo CSC</label>
              <input
                id="iss-csc-token"
                type="password"
                value={nfceCscSecretInput}
                onChange={(e) => setNfceCscSecretInput(e.target.value)}
                placeholder={
                  issuer.data.hasNfceCscSecretInDb ? '•••• deixe vazio para manter' : 'Inclua para QR / SOAP'
                }
                autoComplete="new-password"
              />
            </div>
          </div>
          <label
            style={{
              display: 'flex',
              gap: '0.35rem',
              alignItems: 'center',
              marginBottom: '0.5rem',
              fontSize: '0.74rem',
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
            Remover token CSC da base (usa só <code>FISCAL_NFCE_CSC</code>)
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
          <p className="company-form__hint" style={{ marginTop: '0.45rem' }}>
            <code>FISCAL_EMIT_TRANSPORT=dry-run</code> assina NFC-e fictícia (<code>DRY-RUN</code>). SOAP
            requer CSC e URL do autorizador. Worker rejeita CRT ≠ 1 por enquanto.
          </p>
        </>
      )}
    </>
  );
}

export function CompanyPage() {
  const qc = useQueryClient();
  const menuAccess = useMenuAccess();
  const canViewCompany = menuAccess.canView('company');
  const canUpdateCompany = menuAccess.canUpdate('company');
  const company = useQuery({
    queryKey: ['company'],
    queryFn: () => api<Company>('/company'),
    enabled: canViewCompany,
  });

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [touched, setTouched] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const [logoPreviewKey, setLogoPreviewKey] = useState(0);
  const [cepBusy, setCepBusy] = useState(false);
  const logoFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (company.data && !touched) setForm(toForm(company.data));
  }, [company.data, touched]);

  const uploadLogo = useMutation({
    mutationFn: (file: File) => apiUpload<Company>('/company/logo', file),
    onSuccess: (data) => {
      qc.setQueryData(['company'], data);
      void qc.invalidateQueries({ queryKey: ['company'] });
      setForm(toForm(data));
      setTouched(false);
      setLogoPreviewKey((k) => k + 1);
      if (logoFileRef.current) logoFileRef.current.value = '';
      setFeedback({
        kind: 'ok',
        msg: 'Logotipo atualizado no servidor. A nova imagem já aparece no menu, PDV e relatórios.',
      });
    },
    onError: (err: Error) => {
      if (logoFileRef.current) logoFileRef.current.value = '';
      setFeedback({ kind: 'err', msg: err.message });
    },
  });

  const save = useMutation({
    mutationFn: (payload: Partial<FormState>) =>
      api<Company>('/company', { method: 'PATCH', json: payload }),
    onSuccess: (data) => {
      qc.setQueryData(['company'], data);
      setForm(toForm(data));
      setTouched(false);
      setFeedback({ kind: 'ok', msg: 'Dados da empresa atualizados.' });
    },
    onError: (err: Error) => {
      setFeedback({ kind: 'err', msg: err.message });
    },
  });

  if (!canViewCompany) {
    return (
      <div className="page">
        <h1 className="page-title">Empresa</h1>
        <div className="alert alert-error">
          Sem permissão para acessar o menu <strong>Empresa</strong>. Solicite ao gerente.
        </div>
      </div>
    );
  }

  function update<K extends keyof FormState>(k: K, v: FormState[K]) {
    setTouched(true);
    setFeedback(null);
    setForm((prev) => ({ ...prev, [k]: v }));
  }

  async function buscarCepEmpresa() {
    setFeedback(null);
    const digits = digitsOnly(form.zip, 8);
    if (digits.length !== 8) {
      setFeedback({ kind: 'err', msg: 'Informe um CEP com 8 dígitos.' });
      return;
    }
    setCepBusy(true);
    try {
      const data = await lookupCep(digits);
      setTouched(true);
      setForm((f) => ({
        ...f,
        zip: formatCep(data.zip),
        address: [data.street, data.district].filter(Boolean).join(' — ') || f.address,
        city: data.city || f.city,
        state: data.state || f.state,
      }));
    } catch (e) {
      setFeedback({
        kind: 'err',
        msg: e instanceof Error ? e.message : 'Falha ao consultar CEP.',
      });
    } finally {
      setCepBusy(false);
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const cnpjDigits = digitsOnly(form.cnpj, 14);
    if (cnpjDigits.length !== 14) {
      setFeedback({ kind: 'err', msg: 'CNPJ deve ter 14 dígitos (formato 00.000.000/0000-00).' });
      return;
    }
    save.mutate({
      ...form,
      cnpj: cnpjDigits,
      zip: digitsOnly(form.zip, 8) || null,
    });
  }

  return (
    <div className="page company-page">
      <h1 className="page-title">Empresa</h1>
      <p className="page-desc">
        Dados cadastrais da loja — usados nos cabeçalhos de impressões e relatórios.
      </p>

      {company.isLoading && <p>Carregando…</p>}
      {company.isError && (
        <div className="alert alert-error">{(company.error as Error)?.message}</div>
      )}

      {company.data && (
        <form onSubmit={onSubmit} className="company-form">
          <section className="card">
            <h2 className="company-form__h">Dados cadastrais</h2>
            <div className="form-row form-row--2">
              <div className="field">
                <label htmlFor="c-legal">Razão social *</label>
                <input
                  id="c-legal"
                  value={form.legalName}
                  onChange={(e) => update('legalName', e.target.value)}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="c-trade">Nome fantasia *</label>
                <input
                  id="c-trade"
                  value={form.tradeName}
                  onChange={(e) => update('tradeName', e.target.value)}
                  required
                />
              </div>
            </div>
            <div className="form-row form-row--4">
              <div className="field">
                <label htmlFor="c-cnpj">CNPJ *</label>
                <input
                  id="c-cnpj"
                  value={form.cnpj}
                  onChange={(e) => update('cnpj', formatCnpj(e.target.value))}
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="00.000.000/0000-00"
                  maxLength={18}
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
              <div className="field">
                <label htmlFor="c-phone">Telefone</label>
                <input
                  id="c-phone"
                  value={form.phone ?? ''}
                  onChange={(e) => update('phone', e.target.value)}
                />
              </div>
            </div>
            <div className="form-row form-row--2">
              <div className="field">
                <label htmlFor="c-email">E-mail</label>
                <input
                  id="c-email"
                  type="email"
                  value={form.email ?? ''}
                  onChange={(e) => update('email', e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="c-addr">Logradouro</label>
                <input
                  id="c-addr"
                  value={form.address ?? ''}
                  onChange={(e) => update('address', e.target.value)}
                  placeholder="Rua, número, bairro"
                />
              </div>
            </div>
            <div className="form-row form-row--addr">
              <div className="field">
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
              <div className="field">
                <label htmlFor="c-zip">CEP</label>
                <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                  <input
                    id="c-zip"
                    value={form.zip ?? ''}
                    onChange={(e) => update('zip', formatCep(e.target.value))}
                    onBlur={() => {
                      if (digitsOnly(form.zip, 8).length === 8) void buscarCepEmpresa();
                    }}
                    inputMode="numeric"
                    style={{ flex: 1 }}
                  />
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={cepBusy}
                    onClick={() => void buscarCepEmpresa()}
                  >
                    {cepBusy ? '…' : 'Buscar'}
                  </button>
                </div>
              </div>
            </div>
          </section>

          <section className="card">
            <h2 className="company-form__h">PDV</h2>
            <p className="company-form__hint">
              Modo do documento da venda e impressão do cupom não fiscal (no navegador do caixa). Não ativa
              SEFAZ — use <code>FISCAL_MODULE_ENABLED</code> quando o certificado estiver pronto.
            </p>
            <div className="inline-checks" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
              <label>
                <input
                  type="radio"
                  name="pdv-doc-mode"
                  checked={form.pdvDocumentMode === 'NON_FISCAL_RECEIPT'}
                  onChange={() => update('pdvDocumentMode', 'NON_FISCAL_RECEIPT')}
                />
                <span>
                  Comprovante / cupom não fiscal (padrão)
                  <span className="sub">Impressão local; sem transmissão à Receita.</span>
                </span>
              </label>
              <label>
                <input
                  type="radio"
                  name="pdv-doc-mode"
                  checked={form.pdvDocumentMode === 'ELECTRONIC_FISCAL_PLANNED'}
                  onChange={() => update('pdvDocumentMode', 'ELECTRONIC_FISCAL_PLANNED')}
                />
                <span>
                  Planejamento para documento fiscal (NF-e/NFC-e)
                  <span className="sub">
                    Usa cadastros fiscais mestre; emissão eletrônica quando o módulo estiver ativo.
                  </span>
                </span>
              </label>
            </div>
            <div className="form-row form-row--2" style={{ marginTop: '0.25rem' }}>
              <div className="field">
                <label htmlFor="c-autoprint" style={{ display: 'flex', gap: '0.4rem', alignItems: 'flex-start' }}>
                  <input
                    id="c-autoprint"
                    type="checkbox"
                    checked={Boolean(form.saleReceiptAutoPrint)}
                    onChange={(e) => update('saleReceiptAutoPrint', e.target.checked)}
                    style={{ marginTop: '0.15rem' }}
                  />
                  <span>
                    Abrir impressão automaticamente após cada venda
                    <span className="sub" style={{ fontWeight: 400 }}>
                      Operador pode desativar na estação (PDV → Impressão).
                    </span>
                  </span>
                </label>
              </div>
              <div className="field">
                <label htmlFor="c-printer-hint">Referência da impressora (opcional)</label>
                <input
                  id="c-printer-hint"
                  value={form.saleReceiptPrinterHint ?? ''}
                  onChange={(e) => update('saleReceiptPrinterHint', e.target.value)}
                  placeholder="Ex.: Epson TM-T20 · USB001 · IP 192.168.0.50"
                />
              </div>
            </div>
          </section>

          <section className="card">
            <h2 className="company-form__h">Caixa</h2>
            <p className="company-form__hint">
              Define como as <strong>despesas retiradas do caixa</strong> entram na conferência de
              fechamento (apresentados × esperado). O lançamento financeiro e o centro de custo
              continuam iguais nos dois modos.
            </p>
            <div className="inline-checks" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
              <label>
                <input
                  type="radio"
                  name="cash-expense-mode"
                  checked={!form.cashExpenseInPresentedTotal}
                  onChange={() => update('cashExpenseInPresentedTotal', false)}
                />
                <span>
                  Despesa analítica (padrão)
                  <span className="sub">
                    Despesa fica em linha separada e <strong>não soma</strong> no total apresentado.
                    O esperado em dinheiro já desconta as despesas lançadas.
                  </span>
                </span>
              </label>
              <label>
                <input
                  type="radio"
                  name="cash-expense-mode"
                  checked={Boolean(form.cashExpenseInPresentedTotal)}
                  onChange={() => update('cashExpenseInPresentedTotal', true)}
                />
                <span>
                  Despesa soma no apresentado
                  <span className="sub">
                    Conferência por <strong>dinheiro na gaveta + despesa retirada</strong>, que deve
                    bater com o total vendido em dinheiro (como no exemplo: R$ 50 + R$ 50 = R$ 100).
                  </span>
                </span>
              </label>
            </div>
          </section>

          <section className="card">
            <h2 className="company-form__h">Ordem de Serviços</h2>
            <p className="company-form__hint">
              Requer o adicional <strong>Ordem de Serviços</strong> no portal de licenças. Ativa o
              menu, o faturamento e a busca de OS no PDV.
            </p>
            <div className="field">
              <label
                htmlFor="c-os-enabled"
                style={{ display: 'flex', gap: '0.4rem', alignItems: 'flex-start' }}
              >
                <input
                  id="c-os-enabled"
                  type="checkbox"
                  checked={Boolean(form.serviceOrderModuleEnabled)}
                  onChange={(e) => update('serviceOrderModuleEnabled', e.target.checked)}
                  style={{ marginTop: '0.15rem' }}
                />
                <span>
                  Ativar módulo Ordem de Serviços neste estabelecimento
                  <span className="sub" style={{ fontWeight: 400 }}>
                    Exibe o menu quando o addon estiver contratado no portal.
                  </span>
                </span>
              </label>
            </div>
            {form.serviceOrderModuleEnabled ? (
              <>
                <div className="field" style={{ marginTop: '0.75rem' }}>
                  <label htmlFor="c-os-billing">Modo de faturamento padrão</label>
                  <select
                    id="c-os-billing"
                    value={form.serviceOrderDefaultBillingMode ?? 'CHOICE_PER_ORDER'}
                    onChange={(e) =>
                      update(
                        'serviceOrderDefaultBillingMode',
                        e.target.value as FormState['serviceOrderDefaultBillingMode'],
                      )
                    }
                  >
                    <option value="CHOICE_PER_ORDER">Escolher por OS (PDV ou interno)</option>
                    <option value="PDV">Somente no PDV</option>
                    <option value="INTERNAL">Somente na tela da OS</option>
                  </select>
                </div>
                <div className="inline-checks" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
                  <label>
                    <input
                      type="checkbox"
                      checked={Boolean(form.serviceOrderRequireEquipment)}
                      onChange={(e) => update('serviceOrderRequireEquipment', e.target.checked)}
                    />
                    Exigir equipamento ou descrição do bem na abertura
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={form.serviceOrderAllowQuote !== false}
                      onChange={(e) => update('serviceOrderAllowQuote', e.target.checked)}
                    />
                    Permitir fluxo de orçamento (QUOTE → Aprovada)
                  </label>
                </div>
                <div className="field">
                  <label htmlFor="c-os-terms">Termos no espelho da OS</label>
                  <textarea
                    id="c-os-terms"
                    rows={3}
                    value={form.serviceOrderTermsText ?? ''}
                    onChange={(e) => update('serviceOrderTermsText', e.target.value)}
                    placeholder="Texto impresso no espelho (garantia, responsabilidade…)"
                  />
                </div>
              </>
            ) : null}
          </section>

          <section className="card">
            <h2 className="company-form__h">Restaurante</h2>
            <p className="company-form__hint">
              Requer plano <strong>RESTAURANT</strong> no portal. Ativa salão/comandas, pesagem e
              impressão de cozinha. Para estações do app desktop (fila da cozinha), abra{' '}
              <Link to="/configuracoes/impressao">Impressão</Link>.
            </p>
            <div className="field">
              <label htmlFor="c-rest-enabled" style={{ display: 'flex', gap: '0.4rem', alignItems: 'flex-start' }}>
                <input
                  id="c-rest-enabled"
                  type="checkbox"
                  checked={Boolean(form.restaurantModuleEnabled)}
                  onChange={(e) => update('restaurantModuleEnabled', e.target.checked)}
                  style={{ marginTop: '0.15rem' }}
                />
                <span>
                  Ativar módulo restaurante neste estabelecimento
                  <span className="sub" style={{ fontWeight: 400 }}>
                    Exibe o menu Salão / Comandas quando o plano permitir.
                  </span>
                </span>
              </label>
            </div>

            {form.restaurantModuleEnabled ? (
              <div className="field" style={{ marginTop: '0.75rem' }}>
                <span
                  className="company-form__h"
                  style={{ display: 'block', fontSize: '0.95rem', marginBottom: '0.35rem' }}
                >
                  Numeração das comandas sem mesa
                </span>
                <label
                  htmlFor="c-comanda-dynamic"
                  style={{
                    display: 'flex',
                    gap: '0.4rem',
                    alignItems: 'flex-start',
                    marginBottom: '0.35rem',
                  }}
                >
                  <input
                    id="c-comanda-dynamic"
                    type="radio"
                    name="comandaNumberingMode"
                    checked={form.comandaNumberingMode !== 'FIXED'}
                    onChange={() => update('comandaNumberingMode', 'DYNAMIC')}
                    style={{ marginTop: '0.15rem' }}
                  />
                  <span>
                    Dinâmica (livre)
                    <span className="sub" style={{ fontWeight: 400, display: 'block' }}>
                      Número sequencial automático e botão “Abrir comanda sem mesa”.
                    </span>
                  </span>
                </label>
                <label
                  htmlFor="c-comanda-fixed"
                  style={{ display: 'flex', gap: '0.4rem', alignItems: 'flex-start' }}
                >
                  <input
                    id="c-comanda-fixed"
                    type="radio"
                    name="comandaNumberingMode"
                    checked={form.comandaNumberingMode === 'FIXED'}
                    onChange={() => update('comandaNumberingMode', 'FIXED')}
                    style={{ marginTop: '0.15rem' }}
                  />
                  <span>
                    Fixa (cadastrada)
                    <span className="sub" style={{ fontWeight: 400, display: 'block' }}>
                      Cadastre comandas com número ou sigla no Salão (como as mesas).
                    </span>
                  </span>
                </label>
              </div>
            ) : null}

            <div className="form-row form-row--2">
              <div className="field">
                <label htmlFor="c-scale-mode">Captura de peso (self-service)</label>
                <select
                  id="c-scale-mode"
                  value={form.scaleMode ?? 'MANUAL'}
                  onChange={(e) =>
                    update('scaleMode', e.target.value as NonNullable<FormState['scaleMode']>)
                  }
                >
                  <option value="MANUAL">Digitação manual</option>
                  <option value="SERIAL_DIRECT">Balança serial (Web Serial)</option>
                  <option value="AGENT">Agente local (localhost)</option>
                  <option value="BARCODE_LABEL">Etiqueta EAN-13 com peso</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="c-scale-ms">Auto-confirmar peso estável (ms)</label>
                <input
                  id="c-scale-ms"
                  type="number"
                  min={0}
                  max={30000}
                  value={form.scaleAutoConfirmMs ?? 700}
                  onChange={(e) => update('scaleAutoConfirmMs', Number(e.target.value) || 0)}
                />
              </div>
            </div>
            <div className="form-row form-row--2">
              <div className="field">
                <label htmlFor="c-scale-profile">Perfil / protocolo da balança</label>
                <input
                  id="c-scale-profile"
                  value={form.scaleProfile ?? ''}
                  onChange={(e) => update('scaleProfile', e.target.value)}
                  placeholder="Ex.: GENERIC_STREAM"
                />
              </div>
              <div className="field">
                <label htmlFor="c-barcode-weight">Padrão EAN com peso</label>
                <input
                  id="c-barcode-weight"
                  value={form.barcodeWeightPattern ?? ''}
                  onChange={(e) => update('barcodeWeightPattern', e.target.value)}
                  placeholder="2PPPPPWWWWWC"
                />
              </div>
            </div>
            <div className="form-row form-row--2">
              <div className="field">
                <label htmlFor="c-scale-hint">Referência da balança (opcional)</label>
                <input
                  id="c-scale-hint"
                  value={form.scaleHint ?? ''}
                  onChange={(e) => update('scaleHint', e.target.value)}
                  placeholder="Ex.: Toledo Prix · COM3 · 9600"
                />
              </div>
              <div className="field">
                <label htmlFor="c-kitchen-hint">Impressora de cozinha (opcional)</label>
                <input
                  id="c-kitchen-hint"
                  value={form.kitchenPrinterHint ?? ''}
                  onChange={(e) => update('kitchenPrinterHint', e.target.value)}
                  placeholder="Ex.: Epson cozinha · USB"
                />
              </div>
            </div>

            {form.restaurantModuleEnabled ? (
              <>
                <h3 className="company-form__h" style={{ marginTop: '1.25rem', fontSize: '1rem' }}>
                  Taxas da comanda
                </h3>
                <p className="company-form__hint">
                  Aplicadas só no fluxo de salão/comanda. Couvert em R$ é por pessoa.
                </p>
                {(
                  [
                    {
                      key: 'service' as const,
                      title: 'Taxa de serviço',
                      enabled: 'serviceFeeEnabled' as const,
                      mode: 'serviceFeeMode' as const,
                      value: 'serviceFeeValue' as const,
                    },
                    {
                      key: 'couvert' as const,
                      title: 'Couvert',
                      enabled: 'couvertEnabled' as const,
                      mode: 'couvertMode' as const,
                      value: 'couvertValue' as const,
                    },
                    {
                      key: 'waiter' as const,
                      title: 'Taxa do garçom',
                      enabled: 'waiterTipEnabled' as const,
                      mode: 'waiterTipMode' as const,
                      value: 'waiterTipValue' as const,
                    },
                  ] as const
                ).map((block) => (
                  <div
                    key={block.key}
                    className="form-row form-row--3"
                    style={{
                      alignItems: 'end',
                      marginBottom: '0.75rem',
                      padding: '0.65rem 0.75rem',
                      border: '1px solid var(--color-border, #e2e8f0)',
                      borderRadius: 8,
                    }}
                  >
                    <div className="field">
                      <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                        <input
                          type="checkbox"
                          checked={Boolean(form[block.enabled])}
                          onChange={(e) => update(block.enabled, e.target.checked)}
                        />
                        <span>{block.title}</span>
                      </label>
                    </div>
                    <div className="field">
                      <label>Modo</label>
                      <select
                        value={(form[block.mode] as FeeMode) ?? 'PERCENT'}
                        disabled={!form[block.enabled]}
                        onChange={(e) => update(block.mode, e.target.value as FeeMode)}
                      >
                        <option value="PERCENT">Percentual (%)</option>
                        <option value="FIXED">Valor fixo (R$)</option>
                      </select>
                    </div>
                    <div className="field">
                      <label>
                        {(form[block.mode] as FeeMode) === 'FIXED' ? 'Valor (R$)' : 'Valor (%)'}
                        {block.key === 'couvert' && (form[block.mode] as FeeMode) === 'FIXED'
                          ? ' / pessoa'
                          : ''}
                      </label>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        disabled={!form[block.enabled]}
                        value={Number(form[block.value] ?? 0)}
                        onChange={(e) => update(block.value, Number(e.target.value) || 0)}
                      />
                    </div>
                  </div>
                ))}
              </>
            ) : null}
          </section>

          <section className="card">
            <h2 className="company-form__h">Identidade visual</h2>
            <div className="company-form__logo-row">
              <button
                id="c-logo-file-btn"
                type="button"
                className="btn btn-secondary company-form__file-btn"
                disabled={uploadLogo.isPending}
                onClick={() => logoFileRef.current?.click()}
              >
                {uploadLogo.isPending ? 'Enviando…' : 'Enviar logo ao servidor'}
              </button>
              <input
                ref={logoFileRef}
                id="c-logo-file"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                disabled={uploadLogo.isPending}
                className="company-form__file-input"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  uploadLogo.mutate(file);
                  e.target.value = '';
                }}
              />
              <input
                id="c-logo"
                className="company-form__logo-url-input"
                value={form.logoUrl ?? ''}
                onChange={(e) => update('logoUrl', e.target.value)}
                placeholder="Ou URL pública (opcional)"
                aria-label="URL pública da logo (opcional)"
              />
              {form.logoUrl ? (
                <img
                  key={`${form.logoUrl}-${logoPreviewKey}`}
                  className="company-form__logo-preview"
                  src={resolveCompanyAssetUrl(form.logoUrl)}
                  alt="Pré-visualização do logotipo"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />
              ) : null}
            </div>
            <p className="company-form__hint" style={{ margin: '0.35rem 0 0' }}>
              PNG/JPEG/WebP · até 2 MB. Cada envio substitui a logo anterior e atualiza o menu,
              PDV e impressões na hora. URL pública é alternativa se a imagem já estiver hospedada.
            </p>
          </section>

          <section className="card">
            <h2 className="company-form__h">Emissor NFC-e (servidor)</h2>
            <IssuerEmissorCard />
          </section>

          {feedback && (
            <div className={feedback.kind === 'ok' ? 'alert alert-success' : 'alert alert-error'}>
              {feedback.msg}
            </div>
          )}

          <div className="company-form__actions">
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!touched || save.isPending || !canUpdateCompany}
              title={!canUpdateCompany ? 'Sem permissão para alterar Empresa' : undefined}
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
