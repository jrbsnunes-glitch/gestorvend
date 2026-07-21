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
  vDesc?: number;
  vOutro?: number;
  orig: string;
  csosn: string;
};

export type DestInput = {
  /** CPF 11 ou CNPJ 14; vazio = consumidor não identificado (NFC-e). */
  document?: string | null;
  xNome?: string | null;
  email?: string | null;
  indIEDest?: '1' | '2' | '9';
  ie?: string | null;
  ender?: {
    xLgr: string;
    nro: string;
    xBairro: string;
    cMun: string;
    xMun: string;
    uf: string;
    cep: string;
  } | null;
};

function buildIcmsSnXml(orig: string, csosn: string): string {
  const o = onlyDigits(orig, 1) || '0';
  const c = onlyDigits(csosn, 3).padStart(3, '0');
  // Grupos mais comuns do Simples — demais caem em 102 (tributada sem crédito).
  if (c === '101') {
    return `<ICMS><ICMSSN101><orig>${o}</orig><CSOSN>101</CSOSN><pCredSN>0.00</pCredSN><vCredICMSSN>0.00</vCredICMSSN></ICMSSN101></ICMS>`;
  }
  if (c === '102' || c === '103' || c === '300' || c === '400') {
    return `<ICMS><ICMSSN102><orig>${o}</orig><CSOSN>${c}</CSOSN></ICMSSN102></ICMS>`;
  }
  if (c === '500') {
    return (
      `<ICMS><ICMSSN500><orig>${o}</orig><CSOSN>500</CSOSN>` +
      `<vBCSTRet>0.00</vBCSTRet><pST>0.00</pST><vICMSSTRet>0.00</vICMSSTRet></ICMSSN500></ICMS>`
    );
  }
  if (c === '900') {
    return (
      `<ICMS><ICMSSN900><orig>${o}</orig><CSOSN>900</CSOSN>` +
      `<modBC>3</modBC><vBC>0.00</vBC><pRedBC>0.00</pRedBC><pICMS>0.00</pICMS><vICMS>0.00</vICMS></ICMSSN900></ICMS>`
    );
  }
  return `<ICMS><ICMSSN102><orig>${o}</orig><CSOSN>${c}</CSOSN></ICMSSN102></ICMS>`;
}

function buildDestXml(dest: DestInput | undefined, modelo: number): string {
  const doc = onlyDigits(dest?.document ?? '', 14);
  const nome = (dest?.xNome ?? '').trim();
  if (!doc || doc.replace(/0/g, '') === '') {
    // NFC-e permite consumidor não identificado; NF-e exige destinatário.
    if (modelo === 55) {
      throw new Error('NF-e modelo 55 exige destinatário com CPF/CNPJ cadastrado na venda.');
    }
    return (
      `<dest>` +
      `<CPF>00000000000</CPF>` +
      `<xNome>CONSUMIDOR NAO IDENTIFICADO</xNome>` +
      `<indIEDest>9</indIEDest>` +
      `</dest>`
    );
  }
  const isCnpj = doc.length > 11;
  const xNome = xmlEscape((nome || (isCnpj ? 'DESTINATARIO' : 'CONSUMIDOR')).slice(0, 60));
  const indIE = dest?.indIEDest ?? (isCnpj ? '9' : '9');
  let body =
    `<dest>` +
    (isCnpj ? `<CNPJ>${doc.padStart(14, '0').slice(-14)}</CNPJ>` : `<CPF>${doc.padStart(11, '0').slice(-11)}</CPF>`) +
    `<xNome>${xNome}</xNome>`;
  if (dest?.ender) {
    const e = dest.ender;
    body +=
      `<enderDest>` +
      `<xLgr>${xmlEscape(e.xLgr)}</xLgr>` +
      `<nro>${xmlEscape(e.nro)}</nro>` +
      `<xBairro>${xmlEscape(e.xBairro)}</xBairro>` +
      `<cMun>${onlyDigits(e.cMun, 7).padStart(7, '0')}</cMun>` +
      `<xMun>${xmlEscape(e.xMun)}</xMun>` +
      `<UF>${xmlEscape(e.uf)}</UF>` +
      `<CEP>${onlyDigits(e.cep, 8).padStart(8, '0')}</CEP>` +
      `<cPais>1058</cPais><xPais>BRASIL</xPais>` +
      `</enderDest>`;
  }
  body += `<indIEDest>${indIE}</indIEDest>`;
  if (indIE === '1' && dest?.ie) {
    body += `<IE>${onlyDigits(dest.ie, 14)}</IE>`;
  }
  if (dest?.email) body += `<email>${xmlEscape(dest.email.slice(0, 60))}</email>`;
  body += `</dest>`;
  return body;
}

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
  dest?: DestInput;
  items: NfceItemInput[];
  totals: { vNF: number; vProd: number; vDesc: number; vOutro: number };
  payments: Array<{ tPag: string; vPag: number }>;
  modelo: number;
  serie: number;
  nNF: number;
  /** 1=normal; 9=contingência off-line (NFC-e). */
  tpEmis?: number;
  dhContIso?: string | null;
  xJustCont?: string | null;
}): { xmlNfeEnvelope: string; infNFeId: string } {
  const ch = onlyDigits(opts.chave44, 44);
  if (ch.length !== 44) {
    throw new Error('Chave inválida (44 dígitos esperados).');
  }
  const infNFeId = `NFe${ch}`;
  const cNF8 = onlyDigits(opts.cNF, 8).padStart(8, '0').slice(-8);
  const tpEmis = Math.max(1, Math.min(9, opts.tpEmis ?? 1));
  const modelo = opts.modelo;
  const tpImp = modelo === 65 ? 4 : 1;

  const detXml = opts.items
    .map((it) => {
      const vprod = fmt2(it.vProd);
      const vDesc = Math.max(0, Number(it.vDesc ?? 0));
      const vOutro = Math.max(0, Number(it.vOutro ?? 0));
      return (
        `<det nItem="${it.nItem}">` +
        `<prod>` +
        `<cProd>${xmlEscape(onlyDigits(it.sku, 60) || String(it.nItem))}</cProd>` +
        `<cEAN>SEM GTIN</cEAN>` +
        `<xProd>${xmlEscape(it.description.slice(0, 120))}</xProd>` +
        `<NCM>${onlyDigits(it.ncm, 8).padStart(8, '0')}</NCM>` +
        `<CFOP>${onlyDigits(it.cfop, 4).padStart(4, '0')}</CFOP>` +
        `<uCom>${xmlEscape(it.uCom || 'UN')}</uCom>` +
        `<qCom>${it.qCom.toFixed(4)}</qCom>` +
        `<vUnCom>${it.vUnCom.toFixed(4)}</vUnCom>` +
        `<vProd>${vprod}</vProd>` +
        `<cEANTrib>SEM GTIN</cEANTrib>` +
        `<uTrib>${xmlEscape(it.uCom || 'UN')}</uTrib>` +
        `<qTrib>${it.qCom.toFixed(4)}</qTrib>` +
        `<vUnTrib>${it.vUnCom.toFixed(4)}</vUnTrib>` +
        (vDesc > 0 ? `<vDesc>${fmt2(vDesc)}</vDesc>` : '') +
        (vOutro > 0 ? `<vOutro>${fmt2(vOutro)}</vOutro>` : '') +
        `<indTot>1</indTot>` +
        `</prod>` +
        `<imposto>` +
        `<vTotTrib>0.00</vTotTrib>` +
        buildIcmsSnXml(it.orig, it.csosn) +
        `<PIS><PISOutr><CST>49</CST><vBC>0.00</vBC><pPIS>0.00</pPIS><vPIS>0.00</vPIS></PISOutr></PIS>` +
        `<COFINS><COFINSOutr><CST>49</CST><vBC>0.00</vBC><pCOFINS>0.00</pCOFINS><vCOFINS>0.00</vCOFINS></COFINSOutr></COFINS>` +
        `</imposto>` +
        `</det>`
      );
    })
    .join('');

  const pagXml = opts.payments
    .map((p) => `<detPag><tPag>${p.tPag}</tPag><vPag>${fmt2(p.vPag)}</vPag></detPag>`)
    .join('');

  const emit = opts.emit;
  const contXml =
    tpEmis !== 1 && opts.dhContIso && opts.xJustCont
      ? `<dhCont>${opts.dhContIso}</dhCont><xJust>${xmlEscape(opts.xJustCont.slice(0, 256))}</xJust>`
      : '';

  const infNFe =
    `<infNFe xmlns="${NS}" Id="${infNFeId}" versao="4.00">` +
    `<ide>` +
    `<cUF>${onlyDigits(ch.slice(0, 2), 2)}</cUF>` +
    `<cNF>${cNF8}</cNF>` +
    `<natOp>${xmlEscape(opts.natOp ?? 'VENDA')}</natOp>` +
    `<mod>${modelo}</mod>` +
    `<serie>${opts.serie}</serie>` +
    `<nNF>${opts.nNF}</nNF>` +
    `<dhEmi>${opts.dhEmiIso}</dhEmi>` +
    `<tpNF>1</tpNF>` +
    `<idDest>1</idDest>` +
    `<cMunFG>${onlyDigits(opts.codMunIbgeFg, 7).padStart(7, '0')}</cMunFG>` +
    `<tpImp>${tpImp}</tpImp>` +
    `<tpEmis>${tpEmis}</tpEmis>` +
    `<cDV>${ch.slice(43)}</cDV>` +
    `<tpAmb>${opts.tpAmb}</tpAmb>` +
    `<finNFe>1</finNFe>` +
    `<indFinal>1</indFinal>` +
    `<indPres>1</indPres>` +
    `<procEmi>0</procEmi>` +
    `<verProc>GestorVend-1.0</verProc>` +
    contXml +
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
    buildDestXml(opts.dest, modelo) +
    detXml +
    `<total>` +
    `<ICMSTot>` +
    `<vBC>0.00</vBC><vICMS>0.00</vICMS><vICMSDeson>0.00</vICMSDeson><vFCP>0.00</vFCP>` +
    `<vBCST>0.00</vBCST><vST>0.00</vST><vFCPST>0.00</vFCPST><vFCPSTRet>0.00</vFCPSTRet>` +
    `<vProd>${fmt2(opts.totals.vProd)}</vProd>` +
    `<vFrete>0.00</vFrete><vSeg>0.00</vSeg>` +
    `<vDesc>${fmt2(opts.totals.vDesc)}</vDesc>` +
    `<vII>0.00</vII><vIPI>0.00</vIPI><vIPIDevol>0.00</vIPIDevol>` +
    `<vPIS>0.00</vPIS><vCOFINS>0.00</vCOFINS>` +
    `<vOutro>${fmt2(opts.totals.vOutro)}</vOutro>` +
    `<vNF>${fmt2(opts.totals.vNF)}</vNF>` +
    `<vTotTrib>0.00</vTotTrib>` +
    `</ICMSTot>` +
    `</total>` +
    `<transp><modFrete>9</modFrete></transp>` +
    `<pag>${pagXml}<vTroco>0.00</vTroco></pag>` +
    `<infAdic><infCpl>Documento emitido pelo GestorVend.</infCpl></infAdic>` +
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

export function appendInfNFeSupl(nfeSignedXml: string, qrUrl: string, urlChave?: string): string {
  const safe = qrUrl.replace(/]]>/g, '');
  const chaveUrl =
    urlChave?.trim() ||
    'http://www.fazenda.sp.gov.br/nfce/consulta';
  const supl =
    `<infNFeSupl xmlns="${NS}">` +
    `<qrCode><![CDATA[${safe}]]></qrCode>` +
    `<urlChave>${xmlEscape(chaveUrl)}</urlChave>` +
    `</infNFeSupl>`;
  return nfeSignedXml.replace(/<\/NFe>\s*$/u, `${supl}</NFe>`);
}
