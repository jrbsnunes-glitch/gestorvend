import * as fs from 'fs/promises';
import { FiscalSefazEnvironment } from '../../generated/tenant-client';
import { resolveSefazWebservices } from '../sefaz/sefaz-endpoints';
import { buildNfceQrUrlAm, buildNfceQrUrlV3 } from './nfce-xml.builder';

export type NfceCouponPrint = {
  qrCode: string | null;
  urlChave: string | null;
  serie: number | null;
  nNF: number | null;
};

function decodeXmlText(raw: string): string {
  return raw
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim();
}

function tagText(xml: string, localName: string): string | null {
  const re = new RegExp(
    `<(?:\\w+:)?${localName}\\b[^>]*>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([^<]*))</(?:\\w+:)?${localName}>`,
    'i',
  );
  const m = re.exec(xml);
  if (!m) return null;
  const text = decodeXmlText(m[1] ?? m[2] ?? '');
  return text || null;
}

export async function readNfceAuthorizedXml(xmlPath?: string | null): Promise<string | null> {
  const p = xmlPath?.trim();
  if (!p) return null;
  try {
    return await fs.readFile(p, 'utf8');
  } catch {
    return null;
  }
}

export function parseNfceAccessKey(accessKey: string | null | undefined): {
  serie: number | null;
  nNF: number | null;
} {
  const d = String(accessKey ?? '').replace(/\D/g, '');
  if (d.length !== 44) return { serie: null, nNF: null };
  const serie = Number(d.slice(22, 25));
  const nNF = Number(d.slice(25, 34));
  return {
    serie: Number.isFinite(serie) ? serie : null,
    nNF: Number.isFinite(nNF) ? nNF : null,
  };
}

/** Lê infNFeSupl do XML autorizado (nfeProc / NFe). */
export function extractNfceSuplFromXml(xml: string | null | undefined): {
  qrCode: string | null;
  urlChave: string | null;
} {
  if (!xml?.trim()) return { qrCode: null, urlChave: null };
  return {
    qrCode: tagText(xml, 'qrCode'),
    urlChave: tagText(xml, 'urlChave'),
  };
}

export function resolveNfceCouponPrint(input: {
  xml?: string | null;
  accessKey?: string | null;
  sefazEnvironment?: string | null;
  uf?: string | null;
  cscId?: string | null;
  csc?: string | null;
}): NfceCouponPrint {
  const fromXml = extractNfceSuplFromXml(input.xml);
  const fromKey = parseNfceAccessKey(input.accessKey);
  const accessKey = String(input.accessKey ?? '').replace(/\D/g, '');
  if (fromXml.qrCode) {
    return {
      qrCode: fromXml.qrCode,
      urlChave: fromXml.urlChave,
      ...fromKey,
    };
  }
  if (accessKey.length !== 44) {
    return { qrCode: null, urlChave: fromXml.urlChave, ...fromKey };
  }

  const production =
    String(input.sefazEnvironment ?? '').toUpperCase() === FiscalSefazEnvironment.PRODUCAO;
  const uf = (input.uf ?? '').trim().toUpperCase().slice(0, 2) || 'AM';
  const ws = resolveSefazWebservices({ uf, production, model: '65' });
  const qrBase = ws.nfceQrConsultaBase?.trim() || '';
  const urlChave = fromXml.urlChave || ws.nfceUrlChave || null;
  if (!qrBase) {
    return { qrCode: null, urlChave, ...fromKey };
  }

  const tpAmb: 1 | 2 = production ? 1 : 2;
  const qrVersion = ws.nfceQrVersion ?? '200';
  if (qrVersion === '300') {
    return {
      qrCode: buildNfceQrUrlV3({ chNFe: accessKey, tpAmb, qrBaseUrl: qrBase }),
      urlChave,
      ...fromKey,
    };
  }

  const cscId = input.cscId?.trim() ?? '';
  const csc = input.csc?.trim() ?? '';
  if (!cscId || !csc) {
    return { qrCode: null, urlChave, ...fromKey };
  }
  return {
    qrCode: buildNfceQrUrlAm({
      chNFe: accessKey,
      tpAmb,
      cscId,
      csc,
      qrBaseUrl: qrBase,
    }),
    urlChave,
    ...fromKey,
  };
}
