import * as crypto from 'crypto';
import { xmlEscape } from '../utils/xml-escape';

const NS = 'http://www.portalfiscal.inf.br/nfe';

function fmt2(n: number): string {
  return n.toFixed(2);
}

function onlyDigits(s: string, max: number): string {
  return s.replace(/\D/g, '').slice(0, max);
}

/** Método pagamento Gestor → tPag NFC-e/NF-e. */
export function paymentMethodToTPag(method: string): string {
  const m = method.toUpperCase();
  switch (m) {
    case 'CASH':
      return '01';
    case 'CARD':
      return '03';
    case 'PIX':
      return '17';
    case 'CREDIT':
      return '05';
    default:
      return '99';
  }
}

export type NfceItemInput = {
  nItem: number;
  sku: string;
  description: string;
  ncm: string;
  cfop: string;
  uCom: string;
  qCom: number;
  vUnCom: number;
  vProd: number;
  orig: string;
  csosn: string;
};

export function buildNfceInfNFeXml(opts: {
  chave44: string;
  cNF: string;
  natOp?: string;
  tpAmb: 1 | 2;
  dhEmiIso: string;
  crt: number;
  codMunIbgeFg: string;
  emit: {
    cnpj: string;
    ie?: string | null;
    xNome: string;
    xFant?: string | null;
    xLgr: string;
    nro: string;
    xBairro: string;
    cMun: string;
    xMun: string;
    uf: string;
    cep: string;
  };
  items: NfceItemInput[];
  totals: { vNF: number; vProd: number; vDesc: number };
  payments: Array<{ tPag: string; vPag: number }>;
  modelo: number;
  serie: number;
  nNF: number;
}): { xmlNfeEnvelope: string; infNFeId: string } {
  const ch = onlyDigits(opts.chave44, 44);
  if (ch.length !== 44) {
    throw new Error('Chave NFC-e inválida (44 dígitos esperados).');
  }
  const infNFeId = `NFe${ch}`;
  const cNF8 = onlyDigits(opts.cNF, 8).padStart(8, '0').slice(-8);

  const detXml = opts.items
    .map((it) => {
      const vprod = fmt2(it.vProd);
      return (
        `<det nItem="${it.nItem}">` +
        `<prod>` +
        `<cProd>${xmlEscape(onlyDigits(it.sku, 20) || String(it.nItem))}</cProd>` +
        `<cEAN/>` +
        `<xProd>${xmlEscape(it.description.slice(0, 120))}</xProd>` +
        `<NCM>${onlyDigits(it.ncm, 8).padStart(8, '0')}</NCM>` +
        `<CFOP>${onlyDigits(it.cfop, 4).padStart(4, '0')}</CFOP>` +
        `<uCom>${xmlEscape(it.uCom || 'UN')}</uCom>` +
        `<qCom>${it.qCom.toFixed(4)}</qCom>` +
        `<vUnCom>${it.vUnCom.toFixed(4)}</vUnCom>` +
        `<vProd>${vprod}</vProd>` +
        `<cEANTrib/>` +
        `<uTrib>${xmlEscape(it.uCom || 'UN')}</uTrib>` +
        `<qTrib>${it.qCom.toFixed(4)}</qTrib>` +
        `<vUnTrib>${it.vUnCom.toFixed(4)}</vUnTrib>` +
        `<indTot>1</indTot>` +
        `</prod>` +
        `<imposto>` +
        `<vTotTrib>0.00</vTotTrib>` +
        `<ICMS><ICMSSN102><orig>${onlyDigits(it.orig, 1) || '0'}</orig>` +
        `<CSOSN>${onlyDigits(it.csosn, 3).padStart(3, '0')}</CSOSN></ICMSSN102></ICMS>` +
        `<PIS><PISOutr><CST>49</CST><vBC>0.00</vBC><pPIS>0.00</pPIS><vPIS>0.00</vPIS></PISOutr></PIS>` +
        `<COFINS><COFINSOutr><CST>49</CST><vBC>0.00</vBC><pCOFINS>0.00</pCOFINS><vCOFINS>0.00</vCOFINS></COFINSOutr></COFINS>` +
        `</imposto>` +
        `</det>`
      );
    })
    .join('');

  const pagXml = opts.payments
    .map(
      (p) =>
        `<detPag><tPag>${p.tPag}</tPag><vPag>${fmt2(p.vPag)}</vPag></detPag>`,
    )
    .join('');

  const emit = opts.emit;

  const infNFe =
    `<infNFe xmlns="${NS}" Id="${infNFeId}" versao="4.00">` +
    `<ide>` +
    `<cUF>${onlyDigits(ch.slice(0, 2), 2)}</cUF>` +
    `<cNF>${cNF8}</cNF>` +
    `<natOp>${xmlEscape(opts.natOp ?? 'VENDA')}</natOp>` +
    `<mod>${opts.modelo}</mod>` +
    `<serie>${opts.serie}</serie>` +
    `<nNF>${opts.nNF}</nNF>` +
    `<dhEmi>${opts.dhEmiIso}</dhEmi>` +
    `<tpNF>1</tpNF>` +
    `<idDest>1</idDest>` +
    `<cMunFG>${onlyDigits(opts.codMunIbgeFg, 7).padStart(7, '0')}</cMunFG>` +
    `<tpImp>4</tpImp>` +
    `<tpEmis>1</tpEmis>` +
    `<cDV>${ch.slice(43)}</cDV>` +
    `<tpAmb>${opts.tpAmb}</tpAmb>` +
    `<finNFe>1</finNFe>` +
    `<indFinal>1</indFinal>` +
    `<indPres>1</indPres>` +
    `<procEmi>0</procEmi>` +
    `<verProc>GestorVend-API-0.1</verProc>` +
    `</ide>` +
    `<emit>` +
    `<CNPJ>${onlyDigits(emit.cnpj, 14)}</CNPJ>` +
    `<xNome>${xmlEscape(emit.xNome)}</xNome>` +
    (emit.xFant ? `<xFant>${xmlEscape(emit.xFant)}</xFant>` : '') +
    `<enderEmit>` +
    `<xLgr>${xmlEscape(emit.xLgr)}</xLgr>` +
    `<nro>${xmlEscape(emit.nro)}</nro>` +
    `<xBairro>${xmlEscape(emit.xBairro)}</xBairro>` +
    `<cMun>${onlyDigits(emit.cMun, 7).padStart(7, '0')}</cMun>` +
    `<xMun>${xmlEscape(emit.xMun)}</xMun>` +
    `<UF>${xmlEscape(emit.uf)}</UF>` +
    `<CEP>${onlyDigits(emit.cep, 8).padStart(8, '0')}</CEP>` +
    `<cPais>1058</cPais>` +
    `<xPais>BRASIL</xPais>` +
    `</enderEmit>` +
    (emit.ie ? `<IE>${onlyDigits(emit.ie, 14)}</IE>` : `<IE>ISENTO</IE>`) +
    `<CRT>${opts.crt}</CRT>` +
    `</emit>` +
    `<dest>` +
    `<CPF>00000000000</CPF>` +
    `<xNome>CONSUMIDOR NAO IDENTIFICADO</xNome>` +
    `<indIEDest>9</indIEDest>` +
    `</dest>` +
    detXml +
    `<total>` +
    `<ICMSTot>` +
    `<vBC>0.00</vBC>` +
    `<vICMS>0.00</vICMS>` +
    `<vICMSDeson>0.00</vICMSDeson>` +
    `<vFCP>0.00</vFCP>` +
    `<vBCST>0.00</vBCST>` +
    `<vST>0.00</vST>` +
    `<vFCPST>0.00</vFCPST>` +
    `<vFCPSTRet>0.00</vFCPSTRet>` +
    `<vProd>${fmt2(opts.totals.vProd)}</vProd>` +
    `<vFrete>0.00</vFrete>` +
    `<vSeg>0.00</vSeg>` +
    `<vDesc>${fmt2(opts.totals.vDesc)}</vDesc>` +
    `<vII>0.00</vII>` +
    `<vIPI>0.00</vIPI>` +
    `<vIPIDevol>0.00</vIPIDevol>` +
    `<vPIS>0.00</vPIS>` +
    `<vCOFINS>0.00</vCOFINS>` +
    `<vOutro>0.00</vOutro>` +
    `<vNF>${fmt2(opts.totals.vNF)}</vNF>` +
    `<vTotTrib>0.00</vTotTrib>` +
    `</ICMSTot>` +
    `</total>` +
    `<transp><modFrete>9</modFrete></transp>` +
    `<pag>` +
    pagXml +
    `<vTroco>0.00</vTroco>` +
    `</pag>` +
    `<infAdic><infCpl>Documento NFC-e preparado pelo GestorVend (layout educacional; valide contra manual NT vigente).</infCpl></infAdic>` +
    `</infNFe>`;

  const xmlNfeEnvelope = `<NFe xmlns="${NS}">` + infNFe + `</NFe>`;
  return { xmlNfeEnvelope, infNFeId };
}

export function buildNfceQrUrl(input: {
  qrBaseUrl: string;
  chNFe: string;
  tpAmb: number;
  versaoQr: string;
  cscId: string;
  csc: string;
  digestValueB64: string | null;
}): string {
  const ch = onlyDigits(input.chNFe, 44);
  const digest = (input.digestValueB64 ?? '').trim();
  const seq = [ch, input.versaoQr, String(input.tpAmb), digest, input.cscId].join('|');
  const hash = crypto
    .createHash('sha1')
    .update(seq + input.csc, 'utf8')
    .digest('hex')
    .toUpperCase();
  const u = new URL(input.qrBaseUrl);
  u.searchParams.set('chNFe', ch);
  u.searchParams.set('nVersao', input.versaoQr);
  u.searchParams.set('tpAmb', String(input.tpAmb));
  u.searchParams.set('cIdToken', input.cscId.replace(/\D/g, ''));
  u.searchParams.set('cHashQRCode', hash);
  return u.toString();
}

export function appendInfNFeSupl(nfeSignedXml: string, qrUrl: string): string {
  const safe = qrUrl.replace(/]]>/g, '');
  const supl = `<infNFeSupl xmlns="${NS}"><qrCode><![CDATA[${safe}]]></qrCode></infNFeSupl>`;
  return nfeSignedXml.replace(/<\/NFe>\s*$/u, `${supl}</NFe>`);
}
