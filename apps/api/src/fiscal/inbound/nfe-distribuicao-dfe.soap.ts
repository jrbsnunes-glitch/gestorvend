import * as https from 'https';
import { gunzipSync } from 'zlib';

const PROD_URL =
  'https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx';
/** Ambiente Nacional — não usar URL SVRS (/ws/...) para Distribuição DF-e */
const HOMOLOG_URL =
  'https://hom.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx';

export function distribuicaoDfeEndpoint(production: boolean): string {
  const override = process.env.FISCAL_INBOUND_DISTRIBUICAO_URL?.trim();
  if (override) return override;
  return production ? PROD_URL : HOMOLOG_URL;
}

export function buildDistDFeIntXml(params: {
  tpAmb: 1 | 2;
  cUFAutor: string;
  cnpj14: string;
  chNFe: string;
}): string {
  // XML compacto, sem declaração — schema distDFeInt_v1.01
  return (
    `<distDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01">` +
    `<tpAmb>${params.tpAmb}</tpAmb>` +
    `<cUFAutor>${params.cUFAutor}</cUFAutor>` +
    `<CNPJ>${params.cnpj14}</CNPJ>` +
    `<consChNFe><chNFe>${params.chNFe}</chNFe></consChNFe>` +
    `</distDFeInt>`
  );
}

export function buildDistribuicaoSoapEnvelope(distDFeIntXml: string): string {
  // distDFeInt deve ser filho de nfeDadosMsg (sem CDATA) — CDATA causa cStat 243
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"` +
    ` xmlns:xsd="http://www.w3.org/2001/XMLSchema"` +
    ` xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">` +
    `<soap12:Body>` +
    `<nfeDistDFeInteresse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe">` +
    `<nfeDadosMsg>${distDFeIntXml}</nfeDadosMsg>` +
    `</nfeDistDFeInteresse>` +
    `</soap12:Body>` +
    `</soap12:Envelope>`
  );
}

export function postDistribuicaoDfe(
  endpointUrl: string,
  distDFeIntXml: string,
  agent: https.Agent,
): Promise<string> {
  const soap = buildDistribuicaoSoapEnvelope(distDFeIntXml);
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
            'application/soap+xml; charset=utf-8; action="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe/nfeDistDFeInteresse"',
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
            reject(new Error(`HTTP ${res.statusCode} na SEFAZ: ${data.slice(0, 500)}`));
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

export type DistribuicaoDfeResult =
  | { ok: true; xml: string; nsu?: string; cStat: string; xMotivo?: string }
  | { ok: false; cStat?: string; xMotivo: string; rawSnippet: string };

export function parseDistribuicaoDfeResponse(soapText: string): DistribuicaoDfeResult {
  const rawSnippet = soapText.slice(0, 4000);
  const inner =
    soapText.match(/<retDistDFeInt[^>]*>([\s\S]*?)<\/retDistDFeInt>/i)?.[0] ?? soapText;
  const cStat = inner.match(/<cStat>(\d+)<\/cStat>/)?.[1];
  const xMotivo = inner.match(/<xMotivo>([^<]*)<\/xMotivo>/)?.[1]?.trim();
  const nsu = inner.match(/<NSU>(\d+)<\/NSU>/)?.[1];
  const docZipB64 = inner.match(/<docZip[^>]*>([^<]+)<\/docZip>/i)?.[1]?.trim();

  if (cStat === '138' && docZipB64) {
    try {
      const xml = gunzipSync(Buffer.from(docZipB64, 'base64')).toString('utf8');
      return { ok: true, xml, nsu, cStat, xMotivo };
    } catch (e) {
      return {
        ok: false,
        cStat,
        xMotivo: `Falha ao descompactar docZip: ${(e as Error).message}`,
        rawSnippet,
      };
    }
  }

  return {
    ok: false,
    cStat,
    xMotivo: xMotivo || `SEFAZ retornou cStat ${cStat ?? 'desconhecido'}.`,
    rawSnippet,
  };
}
