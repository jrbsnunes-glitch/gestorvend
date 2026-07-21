/**
 * Evento de cancelamento de NF-e/NFC-e (tpEvento 110111) via NFeRecepcaoEvento4.
 */
import * as https from 'https';
import { xmlEscape } from '../utils/xml-escape';
import { signXmlElementById } from '../issuer/sign-xml-by-id';
import {
  buildRecepcaoEventoEnvXml,
  parseRecepcaoEventoResponse,
  postRecepcaoEvento,
  recepcaoEventoEndpoint,
  type RecepcaoEventoResult,
} from '../inbound/nfe-recepcao-evento.soap';

export const EVENTO_CANCELAMENTO = '110111';

function padNSeq(n: number): string {
  return String(Math.max(1, Math.min(20, n))).padStart(2, '0');
}

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

export function buildCancelamentoEventXml(params: {
  tpAmb: 1 | 2;
  cOrgao: string;
  cnpj14: string;
  chNFe: string;
  nProt: string;
  xJust: string;
  nSeqEvento?: number;
  privateKeyPem: string;
  certificatePem: string;
}): { eventoXml: string; infEventoId: string } {
  const just = params.xJust.trim();
  if (just.length < 15) {
    throw new Error('Justificativa de cancelamento deve ter no mínimo 15 caracteres.');
  }
  const nSeq = params.nSeqEvento ?? 1;
  const tpEvento = EVENTO_CANCELAMENTO;
  const infEventoId = `ID${tpEvento}${params.chNFe}${padNSeq(nSeq)}`;
  const dhEvento = formatSefazDateTime(new Date());

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
    `<descEvento>Cancelamento</descEvento>` +
    `<nProt>${xmlEscape(params.nProt)}</nProt>` +
    `<xJust>${xmlEscape(just.slice(0, 255))}</xJust>` +
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

export async function postCancelamentoNfe(params: {
  production: boolean;
  tpAmb: 1 | 2;
  cOrgao: string;
  cnpj14: string;
  chNFe: string;
  nProt: string;
  xJust: string;
  privateKeyPem: string;
  certificatePem: string;
  agent: https.Agent;
}): Promise<RecepcaoEventoResult> {
  const { eventoXml } = buildCancelamentoEventXml({
    tpAmb: params.tpAmb,
    cOrgao: params.cOrgao,
    cnpj14: params.cnpj14,
    chNFe: params.chNFe,
    nProt: params.nProt,
    xJust: params.xJust,
    privateKeyPem: params.privateKeyPem,
    certificatePem: params.certificatePem,
  });
  const envXml = buildRecepcaoEventoEnvXml({
    tpAmb: params.tpAmb,
    idLote: String(Date.now()).slice(-15),
    eventoXml,
  });
  const endpoint = recepcaoEventoEndpoint(params.production);
  const soap = await postRecepcaoEvento(endpoint, envXml, params.agent);
  return parseRecepcaoEventoResponse(soap);
}
