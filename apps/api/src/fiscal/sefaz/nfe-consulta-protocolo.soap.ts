import * as https from 'https';
import { xmlEscape } from '../utils/xml-escape';

export type ConsultaProtocoloResult =
  | {
      ok: true;
      accessKey: string;
      protocol?: string;
      protNFeXml?: string;
      cStat: string;
    }
  | { ok: false; motive: string; cStat?: string; notFound?: boolean };

export function buildConsSitNFeXml(params: { tpAmb: 1 | 2; chNFe: string }): string {
  const ch = params.chNFe.replace(/\D/g, '');
  if (ch.length !== 44) {
    throw new Error('Chave NF-e deve ter 44 dígitos para consulta de protocolo.');
  }
  return (
    `<consSitNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">` +
    `<tpAmb>${params.tpAmb}</tpAmb>` +
    `<xServ>CONSULTAR</xServ>` +
    `<chNFe>${xmlEscape(ch)}</chNFe>` +
    `</consSitNFe>`
  );
}

export function buildNfeConsultaProtocoloEnvelope(consSitNFeXml: string): string {
  const cdata = `<![CDATA[${consSitNFeXml.replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:xsd="http://www.w3.org/2001/XMLSchema"
  xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">
  <soap12:Body>
    <nfeConsultaNF xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeConsultaProtocolo4">
      <nfeDadosMsg>${cdata}</nfeDadosMsg>
    </nfeConsultaNF>
  </soap12:Body>
</soap12:Envelope>`;
}

/**
 * Interpreta retConsSitNFe — cStat 100/150 = autorizado; 217 = inexistente.
 */
export function parseNfeConsultaProtocoloResponse(xmlText: string): ConsultaProtocoloResult {
  const block =
    xmlText.match(/<retConsSitNFe[\s\S]*?<\/retConsSitNFe>/i)?.[0] ?? xmlText;
  const cStat = block.match(/<cStat>(\d+)<\/cStat>/i)?.[1] ?? '';
  const motivos = [...xmlText.matchAll(/<xMotivo>([^<]*)<\/xMotivo>/gi)].map((m) => m[1].trim());
  const xMotivo = motivos[motivos.length - 1] || motivos[0] || '';

  if (cStat === '217') {
    return { ok: false, cStat, notFound: true, motive: xMotivo || 'NF-e não consta na base da SEFAZ (217).' };
  }

  const protBlock = block.match(/<protNFe[\s\S]*?<\/protNFe>/i)?.[0];
  const infProt = protBlock?.match(/<infProt[\s\S]*?<\/infProt>/i)?.[0] ?? protBlock ?? block;
  const chNFe = infProt.match(/<chNFe>(\d{44})<\/chNFe>/i)?.[1];
  const nProt = infProt.match(/<nProt>([^<]+)<\/nProt>/i)?.[1]?.trim();
  const cStatProt = infProt.match(/<cStat>(\d+)<\/cStat>/i)?.[1] ?? cStat;

  if ((cStatProt === '100' || cStatProt === '150') && chNFe) {
    return {
      ok: true,
      accessKey: chNFe,
      protocol: nProt,
      protNFeXml: protBlock,
      cStat: cStatProt,
    };
  }

  return {
    ok: false,
    cStat: cStatProt || cStat || undefined,
    motive: `${cStatProt || cStat || 'SEM_CSTAT'}: ${xMotivo || 'Consulta sem autorização'}`,
  };
}

export function postNfeConsultaProtocolo(
  endpointUrl: string,
  consSitNFeXml: string,
  agent?: https.Agent,
): Promise<string> {
  const soap = buildNfeConsultaProtocoloEnvelope(consSitNFeXml);
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
            'application/soap+xml; charset=utf-8; action="http://www.portalfiscal.inf.br/nfe/wsdl/NFeConsultaProtocolo4/nfeConsultaNF"',
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
            reject(new Error(`HTTP ${res.statusCode} na consulta SEFAZ: ${data.slice(0, 500)}`));
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

const DEFAULT_NFCE_CONSULTA_HOM =
  'https://nfce-homologacao.svrs.rs.gov.br/ws/NFeConsultaProtocolo/NFeConsultaProtocolo4.asmx';
const DEFAULT_NFCE_CONSULTA_PROD =
  'https://nfce.svrs.rs.gov.br/ws/NFeConsultaProtocolo/NFeConsultaProtocolo4.asmx';
const DEFAULT_NFE_CONSULTA_HOM =
  'https://nfe-homologacao.svrs.rs.gov.br/ws/NFeConsultaProtocolo/NFeConsultaProtocolo4.asmx';
const DEFAULT_NFE_CONSULTA_PROD =
  'https://nfe.svrs.rs.gov.br/ws/NFeConsultaProtocolo/NFeConsultaProtocolo4.asmx';

export function defaultConsultaProtocoloEndpoint(isNfce: boolean, production: boolean): string {
  if (isNfce) {
    return production ? DEFAULT_NFCE_CONSULTA_PROD : DEFAULT_NFCE_CONSULTA_HOM;
  }
  return production ? DEFAULT_NFE_CONSULTA_PROD : DEFAULT_NFE_CONSULTA_HOM;
}
