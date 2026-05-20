import { useEffect, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CompanyHeader, type CompanyHeaderData } from './CompanyHeader';
import { api } from '../lib/api';
import { getIdentity } from '../lib/auth';

type Me = { name: string; email: string };

/** Mesmo contrato persistido para `CompanyHeader` (sem null). */
type CompanyPayload = NonNullable<CompanyHeaderData>;

function formatGeneratedAt(at: Date): string {
  return at.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'medium' });
}

function issuerFromMe(me: Me | undefined): string {
  const name = me?.name?.trim();
  const email = me?.email?.trim();
  const fallback = getIdentity()?.email?.trim();

  if (name && email) return `${name} (${email})`;
  if (name) return name;
  if (email) return email;
  if (fallback) return fallback;
  return '—';
}

export function StandardReportHeader({
  documentTitle,
  documentExtras,
  /** Instantâneo de auditoria (opcional; sem valor, atualiza ao abrir o fluxo de impressão). */
  anchoredAt,
}: {
  documentTitle: string;
  documentExtras?: ReactNode;
  anchoredAt?: Date | null;
}) {
  const [generatedAt, setGeneratedAt] = useState<Date>(() =>
    anchoredAt != null ? anchoredAt : new Date(),
  );

  useEffect(() => {
    if (anchoredAt != null) setGeneratedAt(anchoredAt);
  }, [anchoredAt]);

  useEffect(() => {
    if (anchoredAt != null) return undefined;
    const onBeforePrint = () => setGeneratedAt(new Date());
    window.addEventListener('beforeprint', onBeforePrint);
    return () => window.removeEventListener('beforeprint', onBeforePrint);
  }, [anchoredAt]);

  const company = useQuery({
    queryKey: ['company'],
    queryFn: () => api<CompanyPayload>('/company'),
    staleTime: 10 * 60_000,
  });

  const me = useQuery({
    queryKey: ['users', 'me'],
    queryFn: () => api<Me>('/users/me'),
    staleTime: 5 * 60_000,
  });

  return (
    <div className="gv-report-standard-top">
      <CompanyHeader company={company.data ?? null} />
      <header className="gv-report-doc-head">
        <div>
          <h1>{documentTitle}</h1>
          {documentExtras}
        </div>
        <div className="gv-report-meta" aria-label="Rastreabilidade do relatório">
          <div>
            <span className="gv-report-meta-label">Gerado em</span>
            <strong>{formatGeneratedAt(generatedAt)}</strong>
          </div>
          <div>
            <span className="gv-report-meta-label">Emitido por</span>
            <strong>{issuerFromMe(me.data)}</strong>
          </div>
          <div>
            <span className="gv-report-meta-label">Sistema</span>
            <strong>GestorVend · ambiente autorizado</strong>
          </div>
        </div>
      </header>
    </div>
  );
}
