import * as https from 'https';
import { xmlEscape } from '../utils/xml-escape';

export type StatusServicoResult =
  | { ok: true; cStat: string; message: string }
  | { ok: false; cStat?: string; message: string };

export function buildConsStatServXml(params: { tpAmb: 1 | 2; cUF: string }): string {
  const cUF = params.cUF.replace(/\D/g, '').padStart(2, '0').slice(-2);
  return (
    `<consStatServ versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">` +
    `<tpAmb>${params.tpAmb}</tpAmb>` +
    `<cUF>${xmlEscape(cUF)}</cUF>` +
    `<xServ>STATUS</xServ>` +
    `</consStatServ>`
  );
}

export function buildNfeStatusServicoEnvelope(consStatServXml: string): string {
  const cdata = `<![CDATA[${consStatServXml.replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:xsd="http://www.w3.org/2001/XMLSchema"
  xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">
  <soap12:Body>
    <nfeStatusServicoNF xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeStatusServico4">
      <nfeDadosMsg>${cdata}</nfeDadosMsg>
    </nfeStatusServicoNF>
  </soap12:Body>
</soap12:Envelope>`;
}

export function parseNfeStatusServicoResponse(xmlText: string): StatusServicoResult {
  const fault = xmlText.match(/<(?:soap(?:12)?:)?Fault[\s\S]*?<\/(?:soap(?:12)?:)?Fault>/i)?.[0];
  if (fault) {
    const reason =
      fault.match(/<(?:soap(?:12)?:)?Text[^>]*>([^<]+)/i)?.[1] ??
      fault.match(/<faultstring>([^<]+)/i)?.[1] ??
      'Falha SOAP na SEFAZ';
    return { ok: false, message: reason.trim() };
  }

  const block =
    xmlText.match(/<retConsStatServ[\s\S]*?<\/retConsStatServ>/i)?.[0] ?? xmlText;
  const cStat = block.match(/<cStat>(\d+)<\/cStat>/i)?.[1] ?? '';
  const motivos = [...xmlText.matchAll(/<xMotivo>([^<]*)<\/xMotivo>/gi)].map((m) => m[1].trim());
  const xMotivo = motivos[motivos.length - 1] || motivos[0] || '';

  if (cStat === '107') {
    return { ok: true, cStat, message: xMotivo || 'Serviço em operação' };
  }
  if (cStat === '108') {
    return { ok: true, cStat, message: xMotivo || 'Serviço paralisado momentaneamente (108)' };
  }

  return {
    ok: false,
    cStat: cStat || undefined,
    message: cStat ? `${cStat}: ${xMotivo || 'Resposta SEFAZ'}` : xMotivo || 'Resposta SEFAZ inválida',
  };
}

export function postNfeStatusServico(
  endpointUrl: string,
  consStatServXml: string,
  agent?: https.Agent,
): Promise<string> {
  const soap = buildNfeStatusServicoEnvelope(consStatServXml);
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
            'application/soap+xml; charset=utf-8; action="http://www.portalfiscal.inf.br/nfe/wsdl/NFeStatusServico4/nfeStatusServicoNF"',
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
            reject(new Error(`HTTP ${res.statusCode} no status SEFAZ: ${data.slice(0, 500)}`));
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
