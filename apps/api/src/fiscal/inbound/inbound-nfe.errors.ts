export type SefazCallContext = {
  tenantSlug: string;
  accessKey: string;
  ambiente: 'PRODUCAO' | 'HOMOLOGACAO';
  tpAmb: 1 | 2;
  endpoint: string;
  uf: string;
  cUFAutor: string;
  cnpj14: string;
  certPath: string;
};

export function maskCnpj(cnpj14: string): string {
  const d = cnpj14.replace(/\D/g, '');
  if (d.length !== 14) return '**************';
  return `${d.slice(0, 4)}******${d.slice(10)}`;
}

export function formatSefazCallLog(ctx: SefazCallContext): string {
  return [
    `tenant=${ctx.tenantSlug}`,
    `ambiente=${ctx.ambiente}`,
    `tpAmb=${ctx.tpAmb}`,
    `endpoint=${ctx.endpoint}`,
    `uf=${ctx.uf}`,
    `cUFAutor=${ctx.cUFAutor}`,
    `cnpj=${maskCnpj(ctx.cnpj14)}`,
    `chNFe=${ctx.accessKey}`,
    `cert=${ctx.certPath}`,
  ].join(' | ');
}

/** Mensagem amigável para falhas HTTPS/SOAP com a SEFAZ */
export function formatSefazTransportError(err: unknown, ctx: SefazCallContext): string {
  const raw = err instanceof Error ? err.message : String(err);
  const code =
    err instanceof Error && 'code' in err ? String((err as NodeJS.ErrnoException).code ?? '') : '';
  const lower = `${code} ${raw}`.toLowerCase();
  const ambLabel = ctx.ambiente === 'PRODUCAO' ? 'Produção' : 'Homologação';

  if (
    lower.includes('econnreset') ||
    lower.includes('econnrefused') ||
    lower.includes('etimedout') ||
    lower.includes('enotfound') ||
    lower.includes('socket hang up')
  ) {
    return (
      `A SEFAZ encerrou ou recusou a conexão (${code || raw}) ao consultar a NF-e. ` +
      `Ambiente configurado: ${ambLabel}. Confira: (1) se a nota é do mesmo ambiente (nota real exige Produção); ` +
      `(2) certificado A1 válido do CNPJ da empresa; (3) rede/firewall liberando HTTPS para ${ctx.endpoint}. ` +
      'Detalhes foram registrados no log da API.'
    );
  }

  if (
    lower.includes('certificate') ||
    lower.includes('ssl') ||
    lower.includes('tls') ||
    lower.includes('unable to verify')
  ) {
    return (
      `Falha de segurança (TLS) ao contactar a SEFAZ (${ambLabel}). ` +
      'Verifique se o certificado A1 está válido, é ICP-Brasil e pertence ao CNPJ cadastrado na Empresa.'
    );
  }

  if (/HTTP\s403/i.test(raw) || lower.includes('403 forbidden') || lower.includes('access is denied')) {
    const homologHint =
      ctx.ambiente === 'HOMOLOGACAO'
        ? ' Notas fiscais reais (emitidas em produção) só podem ser consultadas com ambiente Produção em Empresa → Emissor fiscal.'
        : '';
    return (
      `Acesso negado (HTTP 403) ao serviço NFeDistribuicaoDFe (${ambLabel}). ` +
      'A SEFAZ recusou a conexão mTLS antes de processar a consulta — normalmente por certificado A1 inválido, expirado, revogado, senha incorreta ou CNPJ do certificado diferente do cadastrado na empresa.' +
      homologHint +
      ` Confira o .pfx em Empresa → Emissor fiscal e o endpoint ${ctx.endpoint}.`
    );
  }

  if (raw.startsWith('HTTP ')) {
    const snippet = raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
    return `A SEFAZ respondeu com erro (${ambLabel}): ${snippet}`;
  }

  return `Erro ao consultar a SEFAZ (${ambLabel}): ${raw}`;
}

/** Enriquece retorno da SEFAZ quando cStat ≠ 138 */
export function formatSefazBusinessError(
  xMotivo: string,
  cStat: string | undefined,
  ctx: SefazCallContext,
): string {
  const ambLabel = ctx.ambiente === 'PRODUCAO' ? 'Produção' : 'Homologação';
  const hint =
    cStat === '489'
      ? ' O CNPJ enviado na consulta deve ser o do titular do certificado A1 (e-CNPJ), com dígitos verificadores válidos. Atualize o CNPJ em Empresa.'
      : cStat === '243'
      ? ' Verifique se o XML da consulta está conforme o schema distDFeInt (consChNFe).'
      : cStat === '632'
      ? ' A SEFAZ só mantém o XML disponível por ~90 dias após receber a NF-e no Ambiente Nacional. Notas antigas não podem mais ser baixadas por este serviço — peça o XML ao fornecedor, use backup interno ou lance a entrada manualmente (sem chave).'
      : cStat === '633'
      ? ' É necessário manifestação do destinatário (Ciência ou Confirmação da Operação) antes do download do XML completo.'
      : cStat === '137'
        ? ' Nenhum documento localizado — confira se a chave está correta e se o ambiente SEFAZ (' +
          `${ambLabel}) corresponde à nota.`
        : '';
  return `${xMotivo}${hint} (cStat ${cStat ?? '?'}, ambiente ${ambLabel})`;
}
