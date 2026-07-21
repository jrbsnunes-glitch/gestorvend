/**
 * Inutilização de numeração NF-e/NFC-e (NFeInutilizacao4) — faixa não usada.
 */
import * as https from 'https';
import { xmlEscape } from '../utils/xml-escape';
import { signXmlElementById } from '../issuer/sign-xml-by-id';

const PROD_URL = 'https://nfe.svrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx';
const HOMOLOG_URL =
  'https://nfe-homologacao.svrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx';

export function inutilizacaoEndpoint(production: boolean): string {
  const override = process.env.FISCAL_SEFAZ_INUTILIZACAO_URL?.trim();
  if (override) return override;
  return production ? PROD_URL : HOMOLOG_URL;
}

export function buildInutilizacaoXml(params: {
  tpAmb: 1 | 2;
  cUF: string;
  ano2: string;
  cnpj14: string;
  mod: '55' | '65';
  serie: number;
  nNFIni: number;
  nNFFin: number;
  xJust: string;
  privateKeyPem: string;
  certificatePem: string;
}): string {
  const just = params.xJust.trim();
  if (just.length < 15) {
    throw new Error('Justificativa de inutilização deve ter no mínimo 15 caracteres.');
  }
  const serie = String(params.serie);
  const nIni = String(params.nNFIni);
  const nFin = String(params.nNFFin);
  const id =
    `ID${params.cUF}${params.ano2}${params.cnpj14}${params.mod}` +
    `${serie.padStart(3, '0')}${nIni.padStart(9, '0')}${nFin.padStart(9, '0')}`;

  const unsigned =
    `<inutNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">` +
    `<infInut Id="${id}">` +
    `<tpAmb>${params.tpAmb}</tpAmb>` +
    `<xServ>INUTILIZAR</xServ>` +
    `<cUF>${params.cUF}</cUF>` +
    `<ano>${params.ano2}</ano>` +
    `<CNPJ>${params.cnpj14}</CNPJ>` +
    `<mod>${params.mod}</mod>` +
    `<serie>${serie}</serie>` +
    `<nNFIni>${nIni}</nNFIni>` +
    `<nNFFin>${nFin}</nNFFin>` +
    `<xJust>${xmlEscape(just.slice(0, 255))}</xJust>` +
    `</infInut>` +
    `</inutNFe>`;

  return signXmlElementById(unsigned, {
    elementId: id,
    privateKeyPem: params.privateKeyPem,
    certificatePem: params.certificatePem,
  });
}

function buildSoap(inutXml: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"` +
    ` xmlns:xsd="http://www.w3.org/2001/XMLSchema"` +
    ` xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">` +
    `<soap12:Body>` +
    `<nfeInutilizacaoNF xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeInutilizacao4">` +
    `<nfeDadosMsg><![CDATA[${inutXml.replace(/]]>/g, ']]]]><![CDATA[>')}]]></nfeDadosMsg>` +
    `</nfeInutilizacaoNF>` +
    `</soap12:Body>` +
    `</soap12:Envelope>`
  );
}

export type InutilizacaoResult =
  | { ok: true; cStat: string; nProt?: string; xMotivo?: string }
  | { ok: false; cStat?: string; xMotivo: string };

export function parseInutilizacaoResponse(soapText: string): InutilizacaoResult {
  const cStat = soapText.match(/<infInut[\s\S]*?<cStat>(\d+)<\/cStat>/i)?.[1];
  const xMotivo =
    soapText.match(/<infInut[\s\S]*?<xMotivo>([^<]*)<\/xMotivo>/i)?.[1]?.trim() ??
    soapText.match(/<xMotivo>([^<]*)<\/xMotivo>/i)?.[1]?.trim();
  const nProt = soapText.match(/<nProt>([^<]*)<\/nProt>/i)?.[1]?.trim();
  if (cStat === '102') {
    return { ok: true, cStat, nProt, xMotivo };
  }
  return {
    ok: false,
    cStat,
    xMotivo: xMotivo || `Inutilização rejeitada (cStat ${cStat ?? '?'})`,
  };
}

export function postInutilizacao(
  endpointUrl: string,
  inutXml: string,
  agent: https.Agent,
): Promise<string> {
  const soap = buildSoap(inutXml);
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
            'application/soap+xml; charset=utf-8; action="http://www.portalfiscal.inf.br/nfe/wsdl/NFeInutilizacao4/nfeInutilizacaoNF"',
          'Content-Length': Buffer.byteLength(soap),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => {
          data += c;
        });
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode} inutilização: ${data.slice(0, 500)}`));
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
