import { formatCpfCnpj } from '../lib/format';

/** Nome da pessoa do relatório, em destaque logo abaixo do cabeçalho. */
export function ReportPartyBanner({
  name,
  document,
}: {
  name: string;
  document?: string | null;
}) {
  const label = name.trim();
  if (!label || label === '—') return null;
  const doc = document?.trim() ? formatCpfCnpj(document) : '';
  return (
    <div className="gv-report-party">
      <p className="gv-report-party__name">{label}</p>
      {doc && doc !== '—' ? <p className="gv-report-party__doc">{doc}</p> : null}
    </div>
  );
}
