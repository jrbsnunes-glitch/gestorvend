/**
 * Carta de correção eletrônica — CC-e (tpEvento 110110).
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

export const EVENTO_CCE = '110110';

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

export function buildCceEventXml(params: {
  tpAmb: 1 | 2;
  cOrgao: string;
  cnpj14: string;
  chNFe: string;
  correction: string;
  nSeqEvento: number;
  privateKeyPem: string;
  certificatePem: string;
}): { eventoXml: string; infEventoId: string } {
  const text = params.correction.trim();
  if (text.length < 15) {
    throw new Error('Texto da carta de correção deve ter no mínimo 15 caracteres.');
  }
  const nSeq = params.nSeqEvento;
  const tpEvento = EVENTO_CCE;
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
    `<descEvento>Carta de Correcao</descEvento>` +
    `<xCorrecao>${xmlEscape(text.slice(0, 1000))}</xCorrecao>` +
    `<xCondUso>A Carta de Correcao e disciplinada pelo paragrafo 1o-A do art. 7o do Convenio S/N, de 15 de dezembro de 1970 e pode ser utilizada para regularizacao de erro ocorrido na emissao de documento fiscal, desde que o erro nao esteja relacionado com: I - as variaveis que determinam o valor do imposto tais como: base de calculo, aliquota, diferenca de preco, quantidade, valor da operacao ou da prestacao; II - a correcao de dados cadastrais que implique mudanca do remetente ou do destinatario; III - a data de emissao ou de saida.</xCondUso>` +
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

export async function postCceNfe(params: {
  production: boolean;
  tpAmb: 1 | 2;
  cOrgao: string;
  cnpj14: string;
  chNFe: string;
  correction: string;
  nSeqEvento: number;
  privateKeyPem: string;
  certificatePem: string;
  agent: https.Agent;
  recepcaoEventoUrl?: string;
}): Promise<RecepcaoEventoResult> {
  const { eventoXml } = buildCceEventXml({
    tpAmb: params.tpAmb,
    cOrgao: params.cOrgao,
    cnpj14: params.cnpj14,
    chNFe: params.chNFe,
    correction: params.correction,
    nSeqEvento: params.nSeqEvento,
    privateKeyPem: params.privateKeyPem,
    certificatePem: params.certificatePem,
  });
  const envXml = buildRecepcaoEventoEnvXml({
    tpAmb: params.tpAmb,
    idLote: String(Date.now()).slice(-15),
    eventoXml,
  });
  const endpoint = params.recepcaoEventoUrl?.trim() || recepcaoEventoEndpoint(params.production);
  const soap = await postRecepcaoEvento(endpoint, envXml, params.agent);
  return parseRecepcaoEventoResponse(soap);
}
