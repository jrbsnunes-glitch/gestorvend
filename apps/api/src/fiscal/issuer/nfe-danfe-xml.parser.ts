/**
 * Lê o XML autorizado (nfeProc/NFe modelo 55) e devolve os campos do DANFE A4
 * (leiaute retrato no padrão ACBr). O DANFE deve refletir o XML, não a venda.
 */

export type DanfeXmlAddress = {
  xLgr: string | null;
  nro: string | null;
  xCpl: string | null;
  xBairro: string | null;
  xMun: string | null;
  uf: string | null;
  cep: string | null;
  fone: string | null;
};

export type DanfeXmlItem = {
  nItem: number;
  cProd: string | null;
  xProd: string;
  ncm: string | null;
  cfop: string | null;
  uCom: string | null;
  qCom: number;
  vUnCom: number;
  vProd: number;
  vDesc: number;
  /** origem + CST/CSOSN (ex.: 0102, 000). */
  cst: string | null;
  vBC: number;
  pICMS: number;
  vICMS: number;
  pIPI: number;
  vIPI: number;
  infAdProd: string | null;
};

export type DanfeXmlData = {
  ide: {
    natOp: string | null;
    serie: string | null;
    nNF: string | null;
    dhEmi: string | null;
    dhSaiEnt: string | null;
    tpNF: string | null;
    tpAmb: string | null;
  };
  emit: {
    doc: string | null;
    xNome: string | null;
    xFant: string | null;
    ie: string | null;
    iest: string | null;
    im: string | null;
    ender: DanfeXmlAddress;
  };
  dest: {
    doc: string | null;
    xNome: string | null;
    ie: string | null;
    email: string | null;
    ender: DanfeXmlAddress;
  } | null;
  items: DanfeXmlItem[];
  tot: {
    vBC: number;
    vICMS: number;
    vBCST: number;
    vST: number;
    vProd: number;
    vFrete: number;
    vSeg: number;
    vDesc: number;
    vOutro: number;
    vIPI: number;
    vPIS: number;
    vCOFINS: number;
    vNF: number;
    vTotTrib: number;
  };
  issqn: { vServ: number; vBC: number; vISS: number };
  transp: {
    modFrete: string | null;
    xNome: string | null;
    doc: string | null;
    ie: string | null;
    xEnder: string | null;
    xMun: string | null;
    uf: string | null;
    placa: string | null;
    ufPlaca: string | null;
    rntc: string | null;
    vol: {
      qVol: string | null;
      esp: string | null;
      marca: string | null;
      nVol: string | null;
      pesoL: number | null;
      pesoB: number | null;
    } | null;
  };
  cobr: {
    fat: { nFat: string | null; vOrig: number; vDesc: number; vLiq: number } | null;
    dup: Array<{ nDup: string | null; dVenc: string | null; vDup: number }>;
  };
  pag: Array<{ tPag: string | null; xPag: string | null; vPag: number }>;
  infAdic: { infCpl: string | null; infAdFisco: string | null };
  prot: { nProt: string | null; dhRecbto: string | null } | null;
};

function textOf(xml: string | null | undefined, tag: string): string | null {
  if (!xml) return null;
  const m = xml.match(
    new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*>([^<]*)<\\/(?:\\w+:)?${tag}\\s*>`, 'i'),
  );
  const v = m?.[1]?.trim();
  return v ? decodeXml(v) : null;
}

function blockOf(xml: string | null | undefined, tag: string): string | null {
  if (!xml) return null;
  const m = xml.match(
    new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${tag}\\s*>`, 'i'),
  );
  return m?.[1] ?? null;
}

function blocksOf(xml: string | null | undefined, tag: string): string[] {
  if (!xml) return [];
  const re = new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${tag}\\s*>`, 'gi');
  return [...xml.matchAll(re)].map((m) => m[1]);
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function num(xml: string | null | undefined, tag: string): number {
  const v = textOf(xml, tag);
  const n = v != null ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
}

function numOrNull(xml: string | null | undefined, tag: string): number | null {
  const v = textOf(xml, tag);
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function address(block: string | null): DanfeXmlAddress {
  return {
    xLgr: textOf(block, 'xLgr'),
    nro: textOf(block, 'nro'),
    xCpl: textOf(block, 'xCpl'),
    xBairro: textOf(block, 'xBairro'),
    xMun: textOf(block, 'xMun'),
    uf: textOf(block, 'UF'),
    cep: textOf(block, 'CEP'),
    fone: textOf(block, 'fone'),
  };
}

function docOf(block: string | null): string | null {
  return textOf(block, 'CNPJ') ?? textOf(block, 'CPF');
}

function parseItem(nItem: number, det: string): DanfeXmlItem {
  const prod = blockOf(det, 'prod') ?? det;
  const imposto = blockOf(det, 'imposto') ?? '';
  const icms = blockOf(imposto, 'ICMS') ?? '';
  const ipi = blockOf(imposto, 'IPI') ?? '';
  const ipiTrib = blockOf(ipi, 'IPITrib') ?? '';
  const orig = textOf(icms, 'orig') ?? '';
  const cstRaw = textOf(icms, 'CSOSN') ?? textOf(icms, 'CST');
  return {
    nItem,
    cProd: textOf(prod, 'cProd'),
    xProd: textOf(prod, 'xProd') ?? '',
    ncm: textOf(prod, 'NCM'),
    cfop: textOf(prod, 'CFOP'),
    uCom: textOf(prod, 'uCom'),
    qCom: num(prod, 'qCom'),
    vUnCom: num(prod, 'vUnCom'),
    vProd: num(prod, 'vProd'),
    vDesc: num(prod, 'vDesc'),
    cst: cstRaw ? `${orig}${cstRaw}` : null,
    vBC: num(icms, 'vBC'),
    pICMS: num(icms, 'pICMS'),
    vICMS: num(icms, 'vICMS'),
    pIPI: num(ipiTrib, 'pIPI'),
    vIPI: num(ipiTrib, 'vIPI'),
    infAdProd: textOf(det, 'infAdProd'),
  };
}

export function parseNfeDanfeXml(xml: string | null | undefined): DanfeXmlData | null {
  if (!xml || !/<(?:\w+:)?infNFe\b/i.test(xml)) return null;
  const nfe = blockOf(xml, 'NFe') ?? xml;
  const inf = blockOf(nfe, 'infNFe') ?? nfe;
  const ide = blockOf(inf, 'ide');
  const emit = blockOf(inf, 'emit');
  const dest = blockOf(inf, 'dest');
  const total = blockOf(inf, 'total');
  const icmsTot = blockOf(total, 'ICMSTot');
  const issqnTot = blockOf(total, 'ISSQNtot');
  const transp = blockOf(inf, 'transp');
  const transporta = blockOf(transp, 'transporta');
  const veic = blockOf(transp, 'veicTransp');
  const vol = blockOf(transp, 'vol');
  const cobr = blockOf(inf, 'cobr');
  const fat = blockOf(cobr, 'fat');
  const pag = blockOf(inf, 'pag');
  const infAdic = blockOf(inf, 'infAdic');
  const infProt = blockOf(blockOf(xml, 'protNFe'), 'infProt');

  const items = [...inf.matchAll(/<(?:\w+:)?det\b[^>]*\bnItem="(\d+)"[^>]*>([\s\S]*?)<\/(?:\w+:)?det>/gi)].map(
    (m) => parseItem(parseInt(m[1], 10) || 0, m[2]),
  );

  return {
    ide: {
      natOp: textOf(ide, 'natOp'),
      serie: textOf(ide, 'serie'),
      nNF: textOf(ide, 'nNF'),
      dhEmi: textOf(ide, 'dhEmi'),
      dhSaiEnt: textOf(ide, 'dhSaiEnt'),
      tpNF: textOf(ide, 'tpNF'),
      tpAmb: textOf(ide, 'tpAmb'),
    },
    emit: {
      doc: docOf(emit),
      xNome: textOf(emit, 'xNome'),
      xFant: textOf(emit, 'xFant'),
      ie: textOf(emit, 'IE'),
      iest: textOf(emit, 'IEST'),
      im: textOf(emit, 'IM'),
      ender: address(blockOf(emit, 'enderEmit')),
    },
    dest: dest
      ? {
          doc: docOf(dest),
          xNome: textOf(dest, 'xNome'),
          ie: textOf(dest, 'IE'),
          email: textOf(dest, 'email'),
          ender: address(blockOf(dest, 'enderDest')),
        }
      : null,
    items,
    tot: {
      vBC: num(icmsTot, 'vBC'),
      vICMS: num(icmsTot, 'vICMS'),
      vBCST: num(icmsTot, 'vBCST'),
      vST: num(icmsTot, 'vST'),
      vProd: num(icmsTot, 'vProd'),
      vFrete: num(icmsTot, 'vFrete'),
      vSeg: num(icmsTot, 'vSeg'),
      vDesc: num(icmsTot, 'vDesc'),
      vOutro: num(icmsTot, 'vOutro'),
      vIPI: num(icmsTot, 'vIPI'),
      vPIS: num(icmsTot, 'vPIS'),
      vCOFINS: num(icmsTot, 'vCOFINS'),
      vNF: num(icmsTot, 'vNF'),
      vTotTrib: num(icmsTot, 'vTotTrib'),
    },
    issqn: {
      vServ: num(issqnTot, 'vServ'),
      vBC: num(issqnTot, 'vBC'),
      vISS: num(issqnTot, 'vISS'),
    },
    transp: {
      modFrete: textOf(transp, 'modFrete'),
      xNome: textOf(transporta, 'xNome'),
      doc: docOf(transporta),
      ie: textOf(transporta, 'IE'),
      xEnder: textOf(transporta, 'xEnder'),
      xMun: textOf(transporta, 'xMun'),
      uf: textOf(transporta, 'UF'),
      placa: textOf(veic, 'placa'),
      ufPlaca: textOf(veic, 'UF'),
      rntc: textOf(veic, 'RNTC'),
      vol: vol
        ? {
            qVol: textOf(vol, 'qVol'),
            esp: textOf(vol, 'esp'),
            marca: textOf(vol, 'marca'),
            nVol: textOf(vol, 'nVol'),
            pesoL: numOrNull(vol, 'pesoL'),
            pesoB: numOrNull(vol, 'pesoB'),
          }
        : null,
    },
    cobr: {
      fat: fat
        ? {
            nFat: textOf(fat, 'nFat'),
            vOrig: num(fat, 'vOrig'),
            vDesc: num(fat, 'vDesc'),
            vLiq: num(fat, 'vLiq'),
          }
        : null,
      dup: blocksOf(cobr, 'dup').map((d) => ({
        nDup: textOf(d, 'nDup'),
        dVenc: textOf(d, 'dVenc'),
        vDup: num(d, 'vDup'),
      })),
    },
    pag: blocksOf(pag, 'detPag').map((p) => ({
      tPag: textOf(p, 'tPag'),
      xPag: textOf(p, 'xPag'),
      vPag: num(p, 'vPag'),
    })),
    infAdic: {
      infCpl: textOf(infAdic, 'infCpl'),
      infAdFisco: textOf(infAdic, 'infAdFisco'),
    },
    prot: infProt
      ? { nProt: textOf(infProt, 'nProt'), dhRecbto: textOf(infProt, 'dhRecbto') }
      : null,
  };
}
