/**
 * Bloco compacto da empresa (razão fantasia / CNPJ / endereço) para papel/PDF.
 * Em relatórios completos, esse bloco faz parte do `<StandardReportHeader />`,
 * junto ao título, carimbo de data/hora e emitente.
 *
 * Sem cadastro na rota `/company`, cai para o identificador "GestorVend".
 */

import { companyDisplayName, resolveCompanyAssetUrl } from '../lib/company-branding';
import { formatCnpj } from '../lib/format';

export type CompanyHeaderData = {
  legalName: string;
  tradeName: string;
  cnpj: string;
  ie?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  logoUrl?: string | null;
} | null;

function joinNonEmpty(parts: Array<string | null | undefined>, sep = ' · '): string {
  return parts.filter((p) => p && String(p).trim().length > 0).join(sep);
}

export function CompanyHeader({ company }: { company: CompanyHeaderData }) {
  if (!company) {
    return (
      <div className="print-company">
        <div className="print-company-text">
          <strong>GestorVend</strong>
        </div>
      </div>
    );
  }

  const cityLine = joinNonEmpty([
    company.city,
    company.state ? `${company.state}` : null,
    company.zip ? `CEP ${company.zip}` : null,
  ]);

  const contactLine = joinNonEmpty([
    company.phone ? `Tel ${company.phone}` : null,
    company.email,
  ]);

  return (
    <div className="print-company">
      {company.logoUrl && (
        <img
          src={resolveCompanyAssetUrl(company.logoUrl)}
          alt={companyDisplayName(company)}
          className="print-company-logo"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = 'none';
          }}
        />
      )}
      <div className="print-company-text">
        {company.tradeName?.trim() ? (
          <>
            <strong>{company.tradeName.trim()}</strong>
            {company.legalName?.trim() && company.legalName.trim() !== company.tradeName.trim() && (
              <span className="print-company-legal">{company.legalName.trim()}</span>
            )}
          </>
        ) : (
          <strong>{company.legalName?.trim() || 'GestorVend'}</strong>
        )}
        <span className="print-company-line">
          CNPJ {company.cnpj ? formatCnpj(company.cnpj) : '—'}
          {company.ie ? ` · IE ${company.ie}` : ''}
        </span>
        {company.address && (
          <span className="print-company-line">{company.address}</span>
        )}
        {cityLine && <span className="print-company-line">{cityLine}</span>}
        {contactLine && <span className="print-company-line">{contactLine}</span>}
      </div>
    </div>
  );
}
