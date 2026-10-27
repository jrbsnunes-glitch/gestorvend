export type FiscalEmitTransport = 'dry-run' | 'soap';

/** Valor bruto de `FISCAL_EMIT_TRANSPORT` (padrão: simulação). */
export function envFiscalEmitTransport(raw: string | undefined | null): FiscalEmitTransport {
  return (raw ?? 'dry-run').toLowerCase() === 'soap' ? 'soap' : 'dry-run';
}

/**
 * Transporte efetivo da emissão.
 * Produção nunca simula: CSC/certificado sem SOAP gerava protocolo DRY-RUN
 * mesmo com ambiente SEFAZ = Produção. Homologação continua respeitando o .env.
 */
export function resolveFiscalEmitTransport(params: {
  envTransport?: string | null;
  sefazEnvironment?: string | null;
}): FiscalEmitTransport {
  if ((params.sefazEnvironment ?? '').toUpperCase() === 'PRODUCAO') return 'soap';
  return envFiscalEmitTransport(params.envTransport);
}
