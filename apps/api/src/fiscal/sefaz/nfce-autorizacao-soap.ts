/**
 * Cliente mínimo SOAP 1.2 para lote de autorização NFC-e (NFeAutorizacao4).
 * A URL deve apontar ao .asmx publicado pelo autorizador (ex.: SVRS homologação).
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
  | { ok: true; accessKey?: string; protocol?: string }
  | { ok: false; motive: string; rawSnippet: string };

export function parseSefazAutorizacaoResponse(xmlText: string): SoapAutorizacaoResult {
  const rawSnippet = xmlText.slice(0, 4000);
  const cStat = xmlText.match(/<cStat>(\d+)<\/cStat>/);
  const chNFe = xmlText.match(/<chNFe>(\d{44})<\/chNFe>/);
  const nProt = xmlText.match(/<nProt>(\d+)<\/nProt>/);
  const motivoBlocks = [...xmlText.matchAll(/<xMotivo>([^<]*)<\/xMotivo>/g)].map((m) => m[1]);
  const lastMotivo = motivoBlocks[motivoBlocks.length - 1];
  const code = cStat?.[1];

  if (code === '100' && chNFe?.[1]) {
    return { ok: true, accessKey: chNFe[1], protocol: nProt?.[1] };
  }
  if (code === '104') {
    return { ok: false, motive: lastMotivo || 'Lote em processamento (104).', rawSnippet };
  }
  return {
    ok: false,
    motive: `${code ?? 'SEM_CSTAT'}: ${lastMotivo || motivoBlocks[0] || 'Sem motivo textual'}`,
    rawSnippet,
  };
}

export async function postNfceAutorizacaoLote(endpointUrl: string, enviNFeXml: string): Promise<string> {
  const soap = buildNfceAutorizacaoEnvelope(enviNFeXml);
  const res = await fetch(endpointUrl, {
    method: 'POST',
    headers: {
      'Content-Type':
        'application/soap+xml; charset=utf-8; action="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4/nfeAutorizacaoLote"',
    },
    body: soap,
  });
  const txt = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} na SEFAZ: ${txt.slice(0, 500)}`);
  }
  return txt;
}
