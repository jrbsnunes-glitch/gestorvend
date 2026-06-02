export type InboundNfeItemDto = {
  lineNumber: number;
  supplierCode: string | null;
  ean: string | null;
  description: string;
  ncm: string | null;
  cfop: string | null;
  unit: string | null;
  quantity: number;
  unitCost: number;
  total: number;
};

export type InboundNfePreviewDto = {
  accessKey: string;
  documentNumber: string | null;
  series: string | null;
  issueDate: string | null;
  natureOperation: string | null;
  totalValue: number | null;
  emitter: { cnpj: string; name: string };
  recipient: { cnpj: string; name: string };
  items: InboundNfeItemDto[];
};

function textOf(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([^<]*)<\\/${tag}>`, 'i'));
  return m?.[1]?.trim() ?? null;
}

function blockOf(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return m?.[1] ?? null;
}

/**
 * Extrai dados de NF-e modelo 55 (nfeProc/NFe) para preview de entrada.
 */
export function parseInboundNfeXml(xml: string, accessKey: string): InboundNfePreviewDto {
  const nfeBlock = blockOf(xml, 'NFe') ?? xml;
  const inf = blockOf(nfeBlock, 'infNFe') ?? nfeBlock;
  const ide = blockOf(inf, 'ide') ?? '';
  const emit = blockOf(inf, 'emit') ?? '';
  const dest = blockOf(inf, 'dest') ?? '';
  const total = blockOf(inf, 'total') ?? '';
  const icmsTot = blockOf(total, 'ICMSTot') ?? total;

  const detMatches = [...inf.matchAll(/<det\b[^>]*\bnItem="(\d+)"[^>]*>([\s\S]*?)<\/det>/gi)];
  const items: InboundNfeItemDto[] = detMatches.map((m) => {
    const det = m[2];
    const prod = blockOf(det, 'prod') ?? det;
    const qCom = parseFloat(textOf(prod, 'qCom') ?? '0') || 0;
    const vUnCom = parseFloat(textOf(prod, 'vUnCom') ?? '0') || 0;
    const vProd = parseFloat(textOf(prod, 'vProd') ?? '0') || qCom * vUnCom;
    return {
      lineNumber: parseInt(m[1], 10) || 0,
      supplierCode: textOf(prod, 'cProd'),
      ean: textOf(prod, 'cEAN'),
      description: textOf(prod, 'xProd') ?? '',
      ncm: textOf(prod, 'NCM'),
      cfop: textOf(prod, 'CFOP'),
      unit: textOf(prod, 'uCom'),
      quantity: qCom,
      unitCost: vUnCom,
      total: vProd,
    };
  });

  const dhEmi = textOf(ide, 'dhEmi') ?? textOf(ide, 'dEmi');
  let issueDate: string | null = null;
  if (dhEmi) {
    const d = new Date(dhEmi);
    issueDate = Number.isNaN(d.getTime()) ? dhEmi.slice(0, 10) : d.toISOString();
  }

  const emitCnpj = (textOf(emit, 'CNPJ') ?? textOf(emit, 'CPF') ?? '').replace(/\D/g, '');
  const destCnpj = (textOf(dest, 'CNPJ') ?? textOf(dest, 'CPF') ?? '').replace(/\D/g, '');

  return {
    accessKey,
    documentNumber: textOf(ide, 'nNF'),
    series: textOf(ide, 'serie'),
    issueDate,
    natureOperation: textOf(ide, 'natOp'),
    totalValue: parseFloat(textOf(icmsTot, 'vNF') ?? '') || null,
    emitter: {
      cnpj: emitCnpj,
      name: textOf(emit, 'xNome') ?? textOf(emit, 'xFant') ?? '',
    },
    recipient: {
      cnpj: destCnpj,
      name: textOf(dest, 'xNome') ?? '',
    },
    items,
  };
}
