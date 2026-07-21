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

/** Partes úteis da chave NF-e (44 dígitos) para diagnóstico vs Portal. */
export function parseNfeAccessKeyParts(accessKey: string): {
  key: string;
  emitCnpj: string;
  model: string;
  serie: string;
  number: string;
} | null {
  const key = accessKey.replace(/\D/g, '');
  if (key.length !== 44) return null;
  return {
    key,
    emitCnpj: key.slice(6, 20),
    model: key.slice(20, 22),
    serie: key.slice(22, 25).replace(/^0+/, '') || '0',
    number: key.slice(25, 34).replace(/^0+/, '') || '0',
  };
}

/** Enriquece retorno da SEFAZ quando cStat ≠ 138 */
export function formatSefazBusinessError(
  xMotivo: string,
  cStat: string | undefined,
  ctx: SefazCallContext,
): string {
  const ambLabel = ctx.ambiente === 'PRODUCAO' ? 'Produção' : 'Homologação';
  const parts = parseNfeAccessKeyParts(ctx.accessKey);
  const emitHint = parts
    ? ` Emitente na chave: CNPJ ${parts.emitCnpj} · NF ${parts.number}/${parts.serie}.`
    : '';
  const hint =
    cStat === '489'
      ? ' O CNPJ enviado na consulta deve ser o do titular do certificado A1 (e-CNPJ), com dígitos verificadores válidos. Atualize o CNPJ em Empresa.'
      : cStat === '243'
      ? ' Verifique se o XML da consulta está conforme o schema distDFeInt (consChNFe).'
      : cStat === '632'
      ? ' A SEFAZ só mantém o XML disponível por ~90 dias após receber a NF-e no Ambiente Nacional. Notas antigas não podem mais ser baixadas por este serviço — peça o XML ao fornecedor, use backup interno ou lance a entrada manualmente (sem chave).'
      : cStat === '633'
      ? ' É necessário manifestação do destinatário (Ciência ou Confirmação da Operação) antes do download do XML completo.'
      : cStat === '640'
        ? ' O CNPJ do certificado A1 não é destinatário, transportador nem autorizado (autXML) desta NF-e — o webservice bloqueia a consulta.' +
          emitHint +
          ' Abra o Portal Nacional da NF-e, cole a chave, baixe o XML (com certificado no navegador, se o Portal exigir) e use Importar XML na Entrada.'
      : cStat === '137'
        ? ' Nenhum documento no webservice NFeDistribuicaoDFe para o CNPJ do certificado nesta consulta.' +
          emitHint +
          ` Confira: (1) ambiente SEFAZ = ${ambLabel} (nota real exige Produção);` +
          ` (2) sua empresa é o destinatário (ou autXML) da NF-e;` +
          ` (3) certificado A1 do CNPJ ${maskCnpj(ctx.cnpj14)};` +
          ` (4) nota ainda na janela de ~90 dias do Ambiente Nacional.` +
          ' Se o Portal Nacional baixar o XML, use Importar XML na Entrada — o site e o WS compartilham a mesma base, mas a consulta por chave só devolve documentos de interesse do CNPJ autenticado.'
        : '';
  return `${xMotivo}${hint} (cStat ${cStat ?? '?'}, ambiente ${ambLabel}, consulta CNPJ ${maskCnpj(ctx.cnpj14)})`;
}
