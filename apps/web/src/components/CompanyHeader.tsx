/**
 * Cabeçalho de impressão padronizado com os dados da empresa.
 * Aparece no topo de todos os relatórios (Caixa, Itens, Estoque…).
 *
 * Se a empresa ainda não foi cadastrada, renderiza só o logotipo/título "GestorVend"
 * para o documento não ficar quebrado.
 */

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
          src={company.logoUrl}
          alt=""
          className="print-company-logo"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = 'none';
          }}
        />
      )}
      <div className="print-company-text">
        <strong>{company.tradeName || company.legalName}</strong>
        {company.legalName && company.legalName !== company.tradeName && (
          <span className="print-company-legal">{company.legalName}</span>
        )}
        <span className="print-company-line">
          CNPJ {company.cnpj || '—'}
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
