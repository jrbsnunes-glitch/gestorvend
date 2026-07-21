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

export type DistDFeQuery =
  | { kind: 'consChNFe'; chNFe: string }
  | { kind: 'distNSU'; ultNSU: string }
  | { kind: 'consNSU'; nsu: string };

export function buildDistDFeIntXml(params: {
  tpAmb: 1 | 2;
  cUFAutor: string;
  cnpj14: string;
  query: DistDFeQuery;
}): string {
  let queryXml: string;
  if (params.query.kind === 'consChNFe') {
    queryXml = `<consChNFe><chNFe>${params.query.chNFe}</chNFe></consChNFe>`;
  } else if (params.query.kind === 'distNSU') {
    const ult = params.query.ultNSU.replace(/\D/g, '') || '0';
    queryXml = `<distNSU><ultNSU>${ult}</ultNSU></distNSU>`;
  } else {
    const nsu = params.query.nsu.replace(/\D/g, '');
    queryXml = `<consNSU><NSU>${nsu}</NSU></consNSU>`;
  }

  return (
    `<distDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01">` +
    `<tpAmb>${params.tpAmb}</tpAmb>` +
    `<cUFAutor>${params.cUFAutor}</cUFAutor>` +
    `<CNPJ>${params.cnpj14}</CNPJ>` +
    queryXml +
    `</distDFeInt>`
  );
}

/** @deprecated Prefer buildDistDFeIntXml with query.kind = consChNFe */
export function buildDistDFeIntXmlByKey(params: {
  tpAmb: 1 | 2;
  cUFAutor: string;
  cnpj14: string;
  chNFe: string;
}): string {
  return buildDistDFeIntXml({
    tpAmb: params.tpAmb,
    cUFAutor: params.cUFAutor,
    cnpj14: params.cnpj14,
    query: { kind: 'consChNFe', chNFe: params.chNFe },
  });
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

export type DistDocKind = 'procNFe' | 'resNFe' | 'resEvento' | 'procEventoNFe' | 'unknown';

export type DistDocZip = {
  nsu?: string;
  schema?: string;
  kind: DistDocKind;
  xml: string;
  accessKey?: string;
};

export type DistribuicaoDfeBatchResult =
  | {
      ok: true;
      cStat: string;
      xMotivo?: string;
      ultNSU?: string;
      maxNSU?: string;
      docs: DistDocZip[];
    }
  | { ok: false; cStat?: string; xMotivo: string; rawSnippet: string };

/** Compatível com o fluxo por chave (um único XML completo). */
export type DistribuicaoDfeResult =
  | { ok: true; xml: string; nsu?: string; cStat: string; xMotivo?: string; kind: DistDocKind }
  | { ok: false; cStat?: string; xMotivo: string; rawSnippet: string; isSummaryOnly?: boolean };

function classifyDocKind(schema: string | undefined, xml: string): DistDocKind {
  const s = (schema ?? '').toLowerCase();
  if (s.includes('resnfe')) return 'resNFe';
  if (s.includes('procnfe') || s.includes('nfeproc')) return 'procNFe';
  if (s.includes('resevento')) return 'resEvento';
  if (s.includes('procevento')) return 'procEventoNFe';
  if (/<nfeProc\b/i.test(xml) || /<NFe\b/i.test(xml)) return 'procNFe';
  if (/<resNFe\b/i.test(xml)) return 'resNFe';
  if (/<resEvento\b/i.test(xml)) return 'resEvento';
  if (/<procEventoNFe\b/i.test(xml)) return 'procEventoNFe';
  return 'unknown';
}

function extractAccessKey(xml: string): string | undefined {
  const ch =
    xml.match(/<chNFe>(\d{44})<\/chNFe>/i)?.[1] ??
    xml.match(/\bId="NFe(\d{44})"/i)?.[1] ??
    xml.match(/<infNFe[^>]*Id="NFe(\d{44})"/i)?.[1];
  return ch;
}

function decompressDocZip(b64: string): string {
  return gunzipSync(Buffer.from(b64, 'base64')).toString('utf8');
}

/**
 * Parser completo da Distribuição DF-e (um ou vários docZip).
 * cStat 138 = documento(s) localizado(s); 137 = nenhum documento.
 */
export function parseDistribuicaoDfeBatch(soapText: string): DistribuicaoDfeBatchResult {
  const rawSnippet = soapText.slice(0, 4000);
  const inner =
    soapText.match(/<retDistDFeInt[^>]*>([\s\S]*?)<\/retDistDFeInt>/i)?.[0] ?? soapText;
  const cStat = inner.match(/<cStat>(\d+)<\/cStat>/)?.[1];
  const xMotivo = inner.match(/<xMotivo>([^<]*)<\/xMotivo>/)?.[1]?.trim();
  const ultNSU = inner.match(/<ultNSU>(\d+)<\/ultNSU>/)?.[1];
  const maxNSU = inner.match(/<maxNSU>(\d+)<\/maxNSU>/)?.[1];

  if (cStat === '137') {
    return { ok: true, cStat, xMotivo, ultNSU, maxNSU, docs: [] };
  }

  if (cStat !== '138') {
    return {
      ok: false,
      cStat,
      xMotivo: xMotivo || `SEFAZ retornou cStat ${cStat ?? 'desconhecido'}.`,
      rawSnippet,
    };
  }

  const docs: DistDocZip[] = [];
  const zipRe = /<docZip\b([^>]*)>([^<]+)<\/docZip>/gi;
  let m: RegExpExecArray | null;
  while ((m = zipRe.exec(inner)) !== null) {
    const attrs = m[1] ?? '';
    const b64 = m[2]?.trim();
    if (!b64) continue;
    const nsu = attrs.match(/\bNSU="(\d+)"/i)?.[1];
    const schema = attrs.match(/\bschema="([^"]+)"/i)?.[1];
    try {
      const xml = decompressDocZip(b64);
      const kind = classifyDocKind(schema, xml);
      docs.push({
        nsu,
        schema,
        kind,
        xml,
        accessKey: extractAccessKey(xml),
      });
    } catch (e) {
      return {
        ok: false,
        cStat,
        xMotivo: `Falha ao descompactar docZip: ${(e as Error).message}`,
        rawSnippet,
      };
    }
  }

  if (!docs.length) {
    return {
      ok: false,
      cStat,
      xMotivo: xMotivo || 'SEFAZ retornou cStat 138 sem docZip utilizável.',
      rawSnippet,
    };
  }

  return { ok: true, cStat, xMotivo, ultNSU, maxNSU, docs };
}

/**
 * Compatível com consulta por chave: preferir procNFe; se só houver resNFe, sinaliza summary.
 */
export function parseDistribuicaoDfeResponse(soapText: string): DistribuicaoDfeResult {
  const batch = parseDistribuicaoDfeBatch(soapText);
  if (!batch.ok) {
    return {
      ok: false,
      cStat: batch.cStat,
      xMotivo: batch.xMotivo,
      rawSnippet: batch.rawSnippet,
    };
  }

  if (!batch.docs.length) {
    return {
      ok: false,
      cStat: batch.cStat,
      xMotivo: batch.xMotivo || 'Nenhum documento retornado pela SEFAZ.',
      rawSnippet: soapText.slice(0, 4000),
    };
  }

  const full = batch.docs.find((d) => d.kind === 'procNFe');
  if (full) {
    return {
      ok: true,
      xml: full.xml,
      nsu: full.nsu,
      cStat: batch.cStat,
      xMotivo: batch.xMotivo,
      kind: 'procNFe',
    };
  }

  const summary = batch.docs.find((d) => d.kind === 'resNFe');
  if (summary) {
    return {
      ok: false,
      cStat: batch.cStat,
      xMotivo:
        batch.xMotivo ||
        'SEFAZ retornou apenas o resumo da NF-e. É necessário registrar Ciência da Operação para liberar o XML completo.',
      rawSnippet: soapText.slice(0, 4000),
      isSummaryOnly: true,
    };
  }

  // Fallback: devolve o primeiro doc como XML (pode ser evento)
  const first = batch.docs[0];
  return {
    ok: true,
    xml: first.xml,
    nsu: first.nsu,
    cStat: batch.cStat,
    xMotivo: batch.xMotivo,
    kind: first.kind,
  };
}

/** Extrai metadados básicos de um resNFe (sem itens). */
export function parseResNFeSummary(xml: string): {
  accessKey: string | null;
  emitterCnpj: string | null;
  emitterName: string | null;
  documentNumber: string | null;
  issueDate: string | null;
  totalValue: number | null;
} {
  const accessKey = extractAccessKey(xml) ?? null;
  const emitterCnpj = (xml.match(/<CNPJ>(\d+)<\/CNPJ>/i)?.[1] ?? '').replace(/\D/g, '') || null;
  const emitterName = xml.match(/<xNome>([^<]*)<\/xNome>/i)?.[1]?.trim() ?? null;
  const documentNumber = xml.match(/<nNF>([^<]*)<\/nNF>/i)?.[1]?.trim() ?? null;
  const dhEmi = xml.match(/<dhEmi>([^<]*)<\/dhEmi>/i)?.[1]?.trim() ?? null;
  const vNF = parseFloat(xml.match(/<vNF>([^<]*)<\/vNF>/i)?.[1] ?? '');
  return {
    accessKey,
    emitterCnpj,
    emitterName,
    documentNumber,
    issueDate: dhEmi,
    totalValue: Number.isFinite(vNF) ? vNF : null,
  };
}
