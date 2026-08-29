import * as crypto from 'crypto';
import { xmlEscape } from '../utils/xml-escape';

const NS = 'http://www.portalfiscal.inf.br/nfe';

function fmt2(n: number): string {
  return n.toFixed(2);
}

function fmt4(n: number): string {
  return n.toFixed(4);
}

function itemBaseValue(it: NfceItemInput): number {
  const vDesc = Math.max(0, Number(it.vDesc ?? 0));
  const vOutro = Math.max(0, Number(it.vOutro ?? 0));
  return Math.max(0, it.vProd - vDesc + vOutro);
}

export type ItemTaxBreakdown = {
  vBC: number;
  vICMS: number;
  vPIS: number;
  vCOFINS: number;
  vIPI: number;
  vFCP: number;
};

function computePisCofinsValue(vBc: number, cst: string | undefined, aliq: number): number {
  const c = onlyDigits(cst ?? '49', 2).padStart(2, '0') || '49';
  if (['01', '02'].includes(c) && aliq > 0) {
    return vBc * (aliq / 100);
  }
  return 0;
}

function computeIpiValue(vBc: number, cst: string | null | undefined, aliq: number): number {
  if (!cst?.trim()) return 0;
  const c = onlyDigits(cst, 2).padStart(2, '0');
  if (['52', '53', '54', '55'].includes(c)) return 0;
  return vBc * (Math.max(0, aliq) / 100);
}

function computeIcmsValues(
  crt: number,
  cstIcms: string | null | undefined,
  vBc: number,
  aliqIcms: number,
  redBcIcms: number,
  aliqFcp: number,
): { vBC: number; vICMS: number; vFCP: number } {
  if (crt === 1 || crt === 2) {
    return { vBC: 0, vICMS: 0, vFCP: 0 };
  }
  const c = onlyDigits(cstIcms ?? '00', 2).padStart(2, '0');
  if (['40', '41', '50'].includes(c)) {
    return { vBC: 0, vICMS: 0, vFCP: 0 };
  }
  const pRed = Math.max(0, Math.min(100, redBcIcms));
  const base = Math.max(0, vBc * (1 - pRed / 100));
  const vIcms = base * (Math.max(0, aliqIcms) / 100);
  const vFcp = base * (Math.max(0, aliqFcp) / 100);
  return { vBC: base, vICMS: vIcms, vFCP: vFcp };
}

export function computeItemTaxBreakdown(it: NfceItemInput, crt: number): ItemTaxBreakdown {
  const vBc = itemBaseValue(it);
  const icms = computeIcmsValues(
    crt,
    it.cstIcms,
    vBc,
    it.aliqIcms ?? 0,
    it.redBcIcms ?? 0,
    it.aliqFcp ?? 0,
  );
  return {
    vBC: icms.vBC,
    vICMS: icms.vICMS,
    vPIS: computePisCofinsValue(vBc, it.cstPis, it.aliqPis ?? 0),
    vCOFINS: computePisCofinsValue(vBc, it.cstCofins, it.aliqCofins ?? 0),
    vIPI: computeIpiValue(vBc, it.cstIpi, it.aliqIpi ?? 0),
    vFCP: icms.vFCP,
  };
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
  /** Simples Nacional — CSOSN (CRT 1). */
  csosn: string;
  /** Regime normal — CST ICMS (CRT 3). */
  cstIcms?: string | null;
  aliqIcms?: number;
  modBcIcms?: string | null;
  redBcIcms?: number;
  cstPis?: string;
  cstCofins?: string;
  aliqPis?: number;
  aliqCofins?: number;
  cstIpi?: string | null;
  aliqIpi?: number;
  ipiEnquadramento?: string | null;
  cest?: string | null;
  exTipi?: string | null;
  codBeneficio?: string | null;
  ean?: string | null;
  cstIbsCbs?: string | null;
  cClassTrib?: string | null;
  ibsRate?: number;
  cbsRate?: number;
  aliqFcp?: number;
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

function buildIcmsNormalXml(
  orig: string,
  cst: string,
  vBc: number,
  aliq: number,
  modBc: string,
  redBc: number,
): string {
  const o = onlyDigits(orig, 1) || '0';
  const c = onlyDigits(cst, 2).padStart(2, '0');
  const mod = onlyDigits(modBc, 1) || '3';
  const pRed = Math.max(0, Math.min(100, redBc));
  const base = Math.max(0, vBc * (1 - pRed / 100));
  const pIcms = Math.max(0, aliq);
  const vIcms = base * (pIcms / 100);
  if (['40', '41', '50'].includes(c)) {
    return `<ICMS><ICMS${c}><orig>${o}</orig><CST>${c}</CST></ICMS${c}></ICMS>`;
  }
  return (
    `<ICMS><ICMS00><orig>${o}</orig><CST>${c}</CST>` +
    `<modBC>${mod}</modBC><vBC>${fmt2(base)}</vBC>` +
    (pRed > 0 ? `<pRedBC>${fmt2(pRed)}</pRedBC>` : '') +
    `<pICMS>${fmt2(pIcms)}</pICMS><vICMS>${fmt2(vIcms)}</vICMS></ICMS00></ICMS>`
  );
}

function buildIcmsXml(
  crt: number,
  orig: string,
  csosn: string,
  cstIcms: string | null | undefined,
  vBc: number,
  aliqIcms: number,
  modBcIcms: string | null | undefined,
  redBcIcms: number,
): string {
  if (crt === 1 || crt === 2) {
    return buildIcmsSnXml(orig, csosn);
  }
  return buildIcmsNormalXml(orig, cstIcms ?? '00', vBc, aliqIcms, modBcIcms ?? '3', redBcIcms);
}

function buildPisXml(vBc: number, cst: string, aliq: number): string {
  const c = onlyDigits(cst, 2).padStart(2, '0') || '49';
  if (['01', '02'].includes(c) && aliq > 0) {
    const vPis = vBc * (aliq / 100);
    return `<PIS><PISAliq><CST>${c}</CST><vBC>${fmt2(vBc)}</vBC><pPIS>${fmt2(aliq)}</pPIS><vPIS>${fmt2(vPis)}</vPIS></PISAliq></PIS>`;
  }
  if (['04', '05', '06', '07', '08', '09'].includes(c)) {
    return `<PIS><PISNT><CST>${c}</CST></PISNT></PIS>`;
  }
  return `<PIS><PISOutr><CST>${c}</CST><vBC>0.00</vBC><pPIS>0.00</pPIS><vPIS>0.00</vPIS></PISOutr></PIS>`;
}

function buildCofinsXml(vBc: number, cst: string, aliq: number): string {
  const c = onlyDigits(cst, 2).padStart(2, '0') || '49';
  if (['01', '02'].includes(c) && aliq > 0) {
    const vCof = vBc * (aliq / 100);
    return `<COFINS><COFINSAliq><CST>${c}</CST><vBC>${fmt2(vBc)}</vBC><pCOFINS>${fmt2(aliq)}</pCOFINS><vCOFINS>${fmt2(vCof)}</vCOFINS></COFINSAliq></COFINS>`;
  }
  if (['04', '05', '06', '07', '08', '09'].includes(c)) {
    return `<COFINS><COFINSNT><CST>${c}</CST></COFINSNT></COFINS>`;
  }
  return `<COFINS><COFINSOutr><CST>${c}</CST><vBC>0.00</vBC><pCOFINS>0.00</pCOFINS><vCOFINS>0.00</vCOFINS></COFINSOutr></COFINS>`;
}

function buildIpiXml(vBc: number, cst: string | null | undefined, aliq: number, cEnq: string | null | undefined): string {
  if (!cst?.trim()) return '';
  const c = onlyDigits(cst, 2).padStart(2, '0');
  const enq = onlyDigits(cEnq ?? '999', 3).padStart(3, '0');
  if (['52', '53', '54', '55'].includes(c)) {
    return `<IPI><cEnq>${enq}</cEnq><IPINT><CST>${c}</CST></IPINT></IPI>`;
  }
  const vIpi = vBc * (Math.max(0, aliq) / 100);
  return `<IPI><cEnq>${enq}</cEnq><IPITrib><CST>${c}</CST><vBC>${fmt2(vBc)}</vBC><pIPI>${fmt2(aliq)}</pIPI><vIPI>${fmt2(vIpi)}</vIPI></IPITrib></IPI>`;
}

/** Grupo UB (NT 2025.002) — CST, cClassTrib e gIBSCBS com bases/alíquotas de teste. */
function buildIbsCbsXml(
  cst: string | null | undefined,
  cClassTrib: string | null | undefined,
  vBc: number,
  ibsRate = 0,
  cbsRate = 0,
): string {
  if (!cst?.trim() || !cClassTrib?.trim()) return '';
  const c = onlyDigits(cst, 3).padStart(3, '0');
  const cl = onlyDigits(cClassTrib, 6).padStart(6, '0');
  const pIbsUf = Math.max(0, ibsRate);
  const pIbsMun = 0;
  const pCbs = Math.max(0, cbsRate);
  const vIbsUf = vBc * (pIbsUf / 100);
  const vIbsMun = 0;
  const vIbs = vIbsUf + vIbsMun;
  const vCbs = vBc * (pCbs / 100);
  return (
    `<IBSCBS><CST>${c}</CST><cClassTrib>${cl}</cClassTrib>` +
    `<gIBSCBS>` +
    `<vBC>${fmt2(vBc)}</vBC>` +
    `<gIBSUF><pIBSUF>${fmt4(pIbsUf)}</pIBSUF><vIBSUF>${fmt2(vIbsUf)}</vIBSUF></gIBSUF>` +
    `<gIBSMun><pIBSMun>${fmt4(pIbsMun)}</pIBSMun><vIBSMun>${fmt2(vIbsMun)}</vIBSMun></gIBSMun>` +
    `<vIBS>${fmt2(vIbs)}</vIBS>` +
    `<gCBS><pCBS>${fmt4(pCbs)}</pCBS><vCBS>${fmt2(vCbs)}</vCBS></gCBS>` +
    `</gIBSCBS></IBSCBS>`
  );
}

function formatGtin(ean: string | null | undefined): string {
  const digits = onlyDigits(ean ?? '', 14);
  if (digits.length >= 8 && digits.length <= 14) return digits;
  return 'SEM GTIN';
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
  totals: { vNF: number; vProd: number; vDesc: number; vOutro: number; vFrete?: number };
  payments: Array<{ tPag: string; vPag: number }>;
  modelo: number;
  serie: number;
  nNF: number;
  /** 1=normal; 9=contingência off-line (NFC-e). */
  tpEmis?: number;
  dhContIso?: string | null;
  xJustCont?: string | null;
  /** modFrete SEFAZ (0 emitente, 1 destinatário, 9 sem frete…). */
  modFrete?: number;
  deliveryVehiclePlate?: string | null;
  deliveryDriverName?: string | null;
  infCplExtra?: string | null;
  /** 1=operação interna; 2=interestadual; 3=exterior. */
  idDest?: number;
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

  const taxTotals = opts.items.reduce(
    (acc, it) => {
      const t = computeItemTaxBreakdown(it, opts.crt);
      acc.vBC += t.vBC;
      acc.vICMS += t.vICMS;
      acc.vPIS += t.vPIS;
      acc.vCOFINS += t.vCOFINS;
      acc.vIPI += t.vIPI;
      acc.vFCP += t.vFCP;
      return acc;
    },
    { vBC: 0, vICMS: 0, vPIS: 0, vCOFINS: 0, vIPI: 0, vFCP: 0 },
  );

  const detXml = opts.items
    .map((it) => {
      const vprod = fmt2(it.vProd);
      const vDesc = Math.max(0, Number(it.vDesc ?? 0));
      const vOutro = Math.max(0, Number(it.vOutro ?? 0));
      const vBc = itemBaseValue(it);
      const cest = onlyDigits(it.cest ?? '', 7);
      const exTipi = (it.exTipi ?? '').trim();
      const cBenef = (it.codBeneficio ?? '').trim();
      const ean = formatGtin(it.ean);
      const ipiXml = buildIpiXml(vBc, it.cstIpi, it.aliqIpi ?? 0, it.ipiEnquadramento);
      const ibsXml = buildIbsCbsXml(it.cstIbsCbs, it.cClassTrib, vBc, it.ibsRate ?? 0, it.cbsRate ?? 0);
      return (
        `<det nItem="${it.nItem}">` +
        `<prod>` +
        `<cProd>${xmlEscape(onlyDigits(it.sku, 60) || String(it.nItem))}</cProd>` +
        `<cEAN>${ean}</cEAN>` +
        `<xProd>${xmlEscape(it.description.slice(0, 120))}</xProd>` +
        `<NCM>${onlyDigits(it.ncm, 8).padStart(8, '0')}</NCM>` +
        (exTipi ? `<EXTIPI>${xmlEscape(exTipi.slice(0, 3))}</EXTIPI>` : '') +
        (cest.length === 7 ? `<CEST>${cest}</CEST>` : '') +
        `<CFOP>${onlyDigits(it.cfop, 4).padStart(4, '0')}</CFOP>` +
        `<uCom>${xmlEscape(it.uCom || 'UN')}</uCom>` +
        `<qCom>${it.qCom.toFixed(4)}</qCom>` +
        `<vUnCom>${it.vUnCom.toFixed(4)}</vUnCom>` +
        `<vProd>${vprod}</vProd>` +
        `<cEANTrib>${ean}</cEANTrib>` +
        `<uTrib>${xmlEscape(it.uCom || 'UN')}</uTrib>` +
        `<qTrib>${it.qCom.toFixed(4)}</qTrib>` +
        `<vUnTrib>${it.vUnCom.toFixed(4)}</vUnTrib>` +
        (vDesc > 0 ? `<vDesc>${fmt2(vDesc)}</vDesc>` : '') +
        (vOutro > 0 ? `<vOutro>${fmt2(vOutro)}</vOutro>` : '') +
        `<indTot>1</indTot>` +
        (cBenef ? `<cBenef>${xmlEscape(cBenef.slice(0, 10))}</cBenef>` : '') +
        `</prod>` +
        `<imposto>` +
        `<vTotTrib>0.00</vTotTrib>` +
        buildIcmsXml(
          opts.crt,
          it.orig,
          it.csosn,
          it.cstIcms,
          vBc,
          it.aliqIcms ?? 0,
          it.modBcIcms,
          it.redBcIcms ?? 0,
        ) +
        ipiXml +
        buildPisXml(vBc, it.cstPis ?? '49', it.aliqPis ?? 0) +
        buildCofinsXml(vBc, it.cstCofins ?? '49', it.aliqCofins ?? 0) +
        ibsXml +
        `</imposto>` +
        `</det>`
      );
    })
    .join('');

  const pagXml = opts.payments
    .map((p) => `<detPag><tPag>${p.tPag}</tPag><vPag>${fmt2(p.vPag)}</vPag></detPag>`)
    .join('');

  const vFrete = Math.max(0, Number(opts.totals.vFrete ?? 0));
  const modFrete = [0, 1, 2, 3, 4, 9].includes(Number(opts.modFrete))
    ? Number(opts.modFrete)
    : 9;
  const plate = (opts.deliveryVehiclePlate ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const driver = (opts.deliveryDriverName ?? '').trim();
  let transpXml = `<transp><modFrete>${modFrete}</modFrete>`;
  if (plate || driver) {
    transpXml += `<veicTransp>`;
    if (plate) transpXml += `<placa>${xmlEscape(plate.slice(0, 7))}</placa>`;
    transpXml += `</veicTransp>`;
    if (driver) {
      transpXml += `<vol><qVol>0</qVol></vol>`;
      // Nome do motorista em info complementar se não houver tag dedicada simples
    }
  }
  transpXml += `</transp>`;

  const cplParts = [
    'Documento emitido pelo GestorVend.',
    driver ? `Motorista: ${driver}` : '',
    plate ? `Placa: ${plate}` : '',
    (opts.infCplExtra ?? '').trim(),
  ].filter(Boolean);
  const infCpl = xmlEscape(cplParts.join(' | ').slice(0, 5000));

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
    `<idDest>${[1, 2, 3].includes(Number(opts.idDest)) ? Number(opts.idDest) : 1}</idDest>` +
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
    `<vBC>${fmt2(taxTotals.vBC)}</vBC><vICMS>${fmt2(taxTotals.vICMS)}</vICMS><vICMSDeson>0.00</vICMSDeson><vFCP>${fmt2(taxTotals.vFCP)}</vFCP>` +
    `<vBCST>0.00</vBCST><vST>0.00</vST><vFCPST>0.00</vFCPST><vFCPSTRet>0.00</vFCPSTRet>` +
    `<vProd>${fmt2(opts.totals.vProd)}</vProd>` +
    `<vFrete>${fmt2(vFrete)}</vFrete><vSeg>0.00</vSeg>` +
    `<vDesc>${fmt2(opts.totals.vDesc)}</vDesc>` +
    `<vII>0.00</vII><vIPI>${fmt2(taxTotals.vIPI)}</vIPI><vIPIDevol>0.00</vIPIDevol>` +
    `<vPIS>${fmt2(taxTotals.vPIS)}</vPIS><vCOFINS>${fmt2(taxTotals.vCOFINS)}</vCOFINS>` +
    `<vOutro>${fmt2(opts.totals.vOutro)}</vOutro>` +
    `<vNF>${fmt2(opts.totals.vNF)}</vNF>` +
    `<vTotTrib>0.00</vTotTrib>` +
    `</ICMSTot>` +
    `</total>` +
    transpXml +
    `<pag>${pagXml}<vTroco>0.00</vTroco></pag>` +
    `<infAdic><infCpl>${infCpl}</infCpl></infAdic>` +
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
