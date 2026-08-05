import { useEffect, useState } from 'react';
import {
  companyDisplayName,
  companyLogoSrc,
  companyUsesCustomLogo,
  DEFAULT_APP_LOGO,
  DEFAULT_APP_LOGO_WHITE,
  type CompanyBranding,
  useCompanyBranding,
} from '../lib/company-branding';

type CompanyLogoProps = {
  className?: string;
  /** Quando informado, não dispara fetch (útil se o pai já carregou `/company`). */
  company?: Pick<CompanyBranding, 'logoUrl' | 'tradeName' | 'legalName'> | null;
  alt?: string;
  /** Usa a versão branca do logo padrão (fundos escuros). */
  variant?: 'color' | 'white';
};

/**
 * Logotipo da loja cadastrado em Empresa → Identidade visual.
 * Sem URL válida, usa a marca GestorVend.
 * A `logoUrl` inclui `?v=` após cada upload para forçar atualização no navegador.
 */
export function CompanyLogo({
  className,
  company: companyProp,
  alt,
  variant = 'color',
}: CompanyLogoProps) {
  const query = useCompanyBranding();
  const company = companyProp ?? query.data ?? null;
  const displayAlt = alt ?? companyDisplayName(company);
  const fallback = variant === 'white' && !companyUsesCustomLogo(company)
    ? DEFAULT_APP_LOGO_WHITE
    : DEFAULT_APP_LOGO;
  const resolved = companyUsesCustomLogo(company) ? companyLogoSrc(company) : fallback;
  const [src, setSrc] = useState(resolved);

  useEffect(() => {
    setSrc(resolved);
  }, [resolved]);

  return (
    <img
      key={resolved}
      src={src}
      alt={displayAlt}
      className={
        (className ?? '') +
        (companyUsesCustomLogo(company) ? ' company-logo--tenant' : ' company-logo--default')
      }
      decoding="async"
      onError={() => {
        if (src !== fallback) setSrc(fallback);
      }}
    />
  );
}
