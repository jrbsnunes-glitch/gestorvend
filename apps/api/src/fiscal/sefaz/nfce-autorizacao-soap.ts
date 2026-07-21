import * as https from 'https';

/**
 * Cliente SOAP 1.2 para lote de autorização NF-e/NFC-e (NFeAutorizacao4).
 * Em produção/homologação real a SEFAZ exige mTLS (certificado A1).
 */
export function buildNfceAutorizacaoEnvelope(enviNFeXml: string): string {
  const cdata = `<![CDATA[${enviNFeXml.replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:xsd="http://www.w3.org/2001/XMLSchema"
  xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">
  <soap12:Body>
    <nfeAutorizacaoLote xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4">
      <nfeDadosMsg>${cdata}</nfeDadosMsg>
    </nfeAutorizacaoLote>
  </soap12:Body>
</soap12:Envelope>`;
}

export type SoapAutorizacaoResult =
  | { ok: true; accessKey: string; protocol?: string; protNFeXml?: string; cStat: string }
  | { ok: false; motive: string; rawSnippet: string; cStat?: string };

/**
 * Interpreta retEnviNFe / protNFe.
 * cStat 100/150 = autorizado; lote 104 com protNFe interno também é sucesso.
 */
export function parseSefazAutorizacaoResponse(xmlText: string): SoapAutorizacaoResult {
  const rawSnippet = xmlText.slice(0, 4000);

  const protBlock =
    xmlText.match(/<protNFe[\s\S]*?<\/protNFe>/i)?.[0] ??
    xmlText.match(/<retEnviNFe[\s\S]*?<\/retEnviNFe>/i)?.[0] ??
    xmlText;

  const infProt = protBlock.match(/<infProt[\s\S]*?<\/infProt>/i)?.[0] ?? protBlock;

  const cStatInf = infProt.match(/<cStat>(\d+)<\/cStat>/i)?.[1];
  const cStatLote = xmlText.match(/<retEnviNFe[\s\S]*?<cStat>(\d+)<\/cStat>/i)?.[1];
  const chNFe = infProt.match(/<chNFe>(\d{44})<\/chNFe>/i)?.[1];
  const nProt = infProt.match(/<nProt>([^<]+)<\/nProt>/i)?.[1]?.trim();
  const motivos = [...xmlText.matchAll(/<xMotivo>([^<]*)<\/xMotivo>/gi)].map((m) => m[1].trim());
  const lastMotivo = motivos[motivos.length - 1];

  const authStat = cStatInf ?? '';
  if ((authStat === '100' || authStat === '150') && chNFe) {
    const protNFeXml = xmlText.match(/<protNFe[\s\S]*?<\/protNFe>/i)?.[0];
    return {
      ok: true,
      accessKey: chNFe,
      protocol: nProt,
      protNFeXml,
      cStat: authStat,
    };
  }

  // Lote processado (104) sem protNFe útil
  if (cStatLote === '104' && !chNFe) {
    return {
      ok: false,
      cStat: '104',
      motive: lastMotivo || 'Lote processado sem protocolo de autorização (104).',
      rawSnippet,
    };
  }

  const code = authStat || cStatLote || 'SEM_CSTAT';
  return {
    ok: false,
    cStat: code,
    motive: `${code}: ${lastMotivo || motivos[0] || 'Sem motivo textual'}`,
    rawSnippet,
  };
}

export function postNfceAutorizacaoLote(
  endpointUrl: string,
  enviNFeXml: string,
  agent?: https.Agent,
): Promise<string> {
  const soap = buildNfceAutorizacaoEnvelope(enviNFeXml);
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
            'application/soap+xml; charset=utf-8; action="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4/nfeAutorizacaoLote"',
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

/** Monta nfeProc (XML autorizado) a partir da NFe assinada + protNFe. */
export function buildNfeProcXml(nfeSignedXml: string, protNFeXml: string): string {
  const nfe = nfeSignedXml.replace(/^<\?xml[^>]*>\s*/i, '').trim();
  const prot = protNFeXml.trim();
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">` +
    nfe +
    prot +
    `</nfeProc>`
  );
}
