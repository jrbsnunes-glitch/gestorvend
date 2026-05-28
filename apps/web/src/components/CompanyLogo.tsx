import { useEffect, useState } from 'react';
import {
  companyDisplayName,
  companyLogoSrc,
  companyUsesCustomLogo,
  DEFAULT_APP_LOGO,
  type CompanyBranding,
  useCompanyBranding,
} from '../lib/company-branding';

type CompanyLogoProps = {
  className?: string;
  /** Quando informado, não dispara fetch (útil se o pai já carregou `/company`). */
  company?: Pick<CompanyBranding, 'logoUrl' | 'tradeName' | 'legalName'> | null;
  alt?: string;
};

/**
 * Logotipo da loja cadastrado em Empresa → Identidade visual.
 * Sem URL válida, usa a marca GestorVend.
 */
export function CompanyLogo({ className, company: companyProp, alt }: CompanyLogoProps) {
  const query = useCompanyBranding();
  const company = companyProp ?? query.data ?? null;
  const displayAlt = alt ?? companyDisplayName(company);
  const [src, setSrc] = useState(() => companyLogoSrc(company));

  useEffect(() => {
    setSrc(companyLogoSrc(company));
  }, [company?.logoUrl]);

  return (
    <img
      src={src}
      alt={displayAlt}
      className={
        (className ?? '') +
        (companyUsesCustomLogo(company) ? ' company-logo--tenant' : ' company-logo--default')
      }
      decoding="async"
      onError={() => {
        if (src !== DEFAULT_APP_LOGO) setSrc(DEFAULT_APP_LOGO);
      }}
    />
  );
}
