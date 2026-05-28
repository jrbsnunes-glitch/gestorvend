import { useQuery } from '@tanstack/react-query';
import { api } from './api';

/** Logo padrão do produto quando a loja não cadastrou identidade visual. */
export const DEFAULT_APP_LOGO = '/gestor-venda-logo.png';
export const DEFAULT_APP_NAME = 'GestorVend';

export type CompanyBranding = {
  legalName: string;
  tradeName: string;
  logoUrl?: string | null;
};

export function companyDisplayName(
  company: Pick<CompanyBranding, 'tradeName' | 'legalName'> | null | undefined,
): string {
  if (!company) return DEFAULT_APP_NAME;
  const trade = company.tradeName?.trim();
  const legal = company.legalName?.trim();
  return trade || legal || DEFAULT_APP_NAME;
}

export function companyLogoSrc(
  company: Pick<CompanyBranding, 'logoUrl'> | null | undefined,
): string {
  const url = company?.logoUrl?.trim();
  if (!url) return DEFAULT_APP_LOGO;
  return resolveCompanyAssetUrl(url);
}

/** Converte caminho relativo `/api/...` em URL absoluta quando o front aponta direto para a API. */
export function resolveCompanyAssetUrl(pathOrUrl: string): string {
  const url = pathOrUrl.trim();
  if (/^https?:\/\//i.test(url) || url.startsWith('data:')) return url;
  if (url.startsWith('/')) {
    const raw = import.meta.env.VITE_API_BASE_URL as string | undefined;
    const base = typeof raw === 'string' ? raw.trim() : '';
    if (base) return `${base.replace(/\/$/, '')}${url}`;
    return url;
  }
  return url;
}

export function companyUsesCustomLogo(
  company: Pick<CompanyBranding, 'logoUrl'> | null | undefined,
): boolean {
  return Boolean(company?.logoUrl?.trim());
}

export function useCompanyBranding() {
  return useQuery({
    queryKey: ['company'],
    queryFn: () => api<CompanyBranding>('/company'),
    staleTime: 10 * 60_000,
  });
}
