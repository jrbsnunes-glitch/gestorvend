import * as https from 'https';
import { xmlEscape } from '../utils/xml-escape';
import { signXmlElementById } from '../issuer/sign-xml-by-id';

/** Confirmação da Operação — manifesto conclusivo (mercadoria recebida). */
export const MANIFEST_CONFIRMACAO_OPERACAO = '210200';
/** Ciência da Operação — libera o XML completo na Distribuição DF-e (NT Manifestação). */
export const MANIFEST_CIENCIA_OPERACAO = '210210';
/** Desconhecimento da Operação. */
export const MANIFEST_DESCONHECIMENTO_OPERACAO = '210220';
/** Operação não Realizada — exige justificativa (xJust). */
export const MANIFEST_OPERACAO_NAO_REALIZADA = '210240';

export type ManifestTpEvento =
  | typeof MANIFEST_CONFIRMACAO_OPERACAO
  | typeof MANIFEST_CIENCIA_OPERACAO
  | typeof MANIFEST_DESCONHECIMENTO_OPERACAO
  | typeof MANIFEST_OPERACAO_NAO_REALIZADA;

const MANIFEST_DESC: Record<ManifestTpEvento, string> = {
  [MANIFEST_CONFIRMACAO_OPERACAO]: 'Confirmacao da Operacao',
  [MANIFEST_CIENCIA_OPERACAO]: 'Ciencia da Operacao',
  [MANIFEST_DESCONHECIMENTO_OPERACAO]: 'Desconhecimento da Operacao',
  [MANIFEST_OPERACAO_NAO_REALIZADA]: 'Operacao nao Realizada',
};

/** Eventos que exigem xJust (mín. 15 caracteres na NT). */
export const MANIFEST_REQUIRES_JUSTIFICATION = new Set<string>([
  MANIFEST_DESCONHECIMENTO_OPERACAO,
  MANIFEST_OPERACAO_NAO_REALIZADA,
]);

const PROD_URL =
  'https://www.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx';
const HOMOLOG_URL =
  'https://hom.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx';

export function recepcaoEventoEndpoint(production: boolean): string {
  const override = process.env.FISCAL_INBOUND_RECEPCAO_EVENTO_URL?.trim();
  if (override) return override;
  return production ? PROD_URL : HOMOLOG_URL;
}

function padNSeq(n: number): string {
  return String(Math.max(1, Math.min(20, n))).padStart(2, '0');
}

export function isManifestTpEvento(value: string): value is ManifestTpEvento {
  return value in MANIFEST_DESC;
}

/**
 * Monta e assina evento de manifestação do destinatário.
 * Id do infEvento: ID{tpEvento}{chNFe}{nSeqEvento 2 dígitos}
 */
export function buildManifestacaoEventXml(params: {
  tpAmb: 1 | 2;
  cOrgao: string;
  cnpj14: string;
  chNFe: string;
  tpEvento: ManifestTpEvento;
  nSeqEvento?: number;
  /** Obrigatório para 210220 e 210240 (mín. 15 caracteres). */
  xJust?: string | null;
  privateKeyPem: string;
  certificatePem: string;
}): { eventoXml: string; infEventoId: string } {
  const nSeq = params.nSeqEvento ?? 1;
  const tpEvento = params.tpEvento;
  const infEventoId = `ID${tpEvento}${params.chNFe}${padNSeq(nSeq)}`;
  const dhEvento = formatSefazDateTime(new Date());
  const descEvento = MANIFEST_DESC[tpEvento];
  const needsJust = MANIFEST_REQUIRES_JUSTIFICATION.has(tpEvento);
  const xJust = (params.xJust ?? '').trim();
  if (needsJust && xJust.length < 15) {
    throw new Error(
      `O evento ${tpEvento} exige justificativa (xJust) com no mínimo 15 caracteres.`,
    );
  }

  const detJust = needsJust ? `<xJust>${xmlEscape(xJust.slice(0, 255))}</xJust>` : '';

  const unsigned =
    `<evento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00">` +
    `<infEvento Id="${infEventoId}">` +
    `<cOrgao>${xmlEscape(params.cOrgao)}</cOrgao>` +
    `<tpAmb>${params.tpAmb}</tpAmb>` +
    `<CNPJ>${params.cnpj14}</CNPJ>` +
    `<chNFe>${params.chNFe}</chNFe>` +
    `<dhEvento>${dhEvento}</dhEvento>` +
    `<tpEvento>${tpEvento}</tpEvento>` +
    `<nSeqEvento>${nSeq}</nSeqEvento>` +
    `<verEvento>1.00</verEvento>` +
    `<detEvento versao="1.00">` +
    `<descEvento>${descEvento}</descEvento>` +
    detJust +
    `</detEvento>` +
    `</infEvento>` +
    `</evento>`;

  const eventoXml = signXmlElementById(unsigned, {
    elementId: infEventoId,
    privateKeyPem: params.privateKeyPem,
    certificatePem: params.certificatePem,
  });

  return { eventoXml, infEventoId };
}

/** @deprecated Preferir buildManifestacaoEventXml com tpEvento 210210. */
export function buildCienciaOperacaoEventXml(params: {
  tpAmb: 1 | 2;
  cOrgao: string;
  cnpj14: string;
  chNFe: string;
  nSeqEvento?: number;
  privateKeyPem: string;
  certificatePem: string;
}): { eventoXml: string; infEventoId: string } {
  return buildManifestacaoEventXml({
    ...params,
    tpEvento: MANIFEST_CIENCIA_OPERACAO,
  });
}

export function buildRecepcaoEventoEnvXml(params: {
  tpAmb: 1 | 2;
  idLote: string;
  eventoXml: string;
}): string {
  return (
    `<envEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00">` +
    `<idLote>${xmlEscape(params.idLote)}</idLote>` +
    params.eventoXml +
    `</envEvento>`
  );
}

export function buildRecepcaoEventoSoapEnvelope(envEventoXml: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"` +
    ` xmlns:xsd="http://www.w3.org/2001/XMLSchema"` +
    ` xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">` +
    `<soap12:Body>` +
    `<nfeRecepcaoEvento xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4">` +
    `<nfeDadosMsg>${envEventoXml}</nfeDadosMsg>` +
    `</nfeRecepcaoEvento>` +
    `</soap12:Body>` +
    `</soap12:Envelope>`
  );
}

export function postRecepcaoEvento(
  endpointUrl: string,
  envEventoXml: string,
  agent: https.Agent,
): Promise<string> {
  const soap = buildRecepcaoEventoSoapEnvelope(envEventoXml);
  const u = new URL(endpointUrl);

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        method: 'POST',
        agent,
        headers: {
          'Content-Type':
            'application/soap+xml; charset=utf-8; action="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4/nfeRecepcaoEvento"',
          'Content-Length': Buffer.byteLength(soap),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode} na SEFAZ (recepção evento): ${data.slice(0, 500)}`));
            return;
          }
          resolve(data);
        });
      },
    );
    req.on('error', reject);
    req.write(soap);
    req.end();
  });
}

export type RecepcaoEventoResult =
  | { ok: true; cStat: string; xMotivo?: string; nProt?: string; tpEvento?: string }
  | { ok: false; cStat?: string; xMotivo: string; rawSnippet: string };

/**
 * Interpreta retEnvEvento / retEvento.
 * cStat 135/136 = evento registrado (ou já registrado) com sucesso.
 */
export function parseRecepcaoEventoResponse(soapText: string): RecepcaoEventoResult {
  const rawSnippet = soapText.slice(0, 4000);
  const retEvento =
    soapText.match(/<retEvento[^>]*>[\s\S]*?<\/retEvento>/i)?.[0] ??
    soapText.match(/<retEnvEvento[^>]*>[\s\S]*?<\/retEnvEvento>/i)?.[0] ??
    soapText;

  const cStat =
    retEvento.match(/<infEvento[\s\S]*?<cStat>(\d+)<\/cStat>/i)?.[1] ??
    retEvento.match(/<cStat>(\d+)<\/cStat>/i)?.[1];
  const xMotivo =
    retEvento.match(/<infEvento[\s\S]*?<xMotivo>([^<]*)<\/xMotivo>/i)?.[1]?.trim() ??
    retEvento.match(/<xMotivo>([^<]*)<\/xMotivo>/i)?.[1]?.trim();
  const nProt = retEvento.match(/<nProt>([^<]*)<\/nProt>/i)?.[1]?.trim();
  const tpEvento = retEvento.match(/<tpEvento>([^<]*)<\/tpEvento>/i)?.[1]?.trim();

  if (cStat === '135' || cStat === '136') {
    return { ok: true, cStat, xMotivo, nProt, tpEvento };
  }

  return {
    ok: false,
    cStat,
    xMotivo: xMotivo || `SEFAZ rejeitou o evento (cStat ${cStat ?? 'desconhecido'}).`,
    rawSnippet,
  };
}

/** dhEvento no fuso -03:00 (padrão SEFAZ / NT). */
function formatSefazDateTime(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}-03:00`;
}
