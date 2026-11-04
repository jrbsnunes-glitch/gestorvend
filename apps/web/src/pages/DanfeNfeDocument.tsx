/**
 * DANFE NF-e A4 retrato — leiaute no padrão ACBr (canhoto, quadros e colunas
 * do Manual de Orientação do Contribuinte). Fonte preferencial: XML autorizado.
 */
import type { CSSProperties, ReactNode } from 'react';
import { CompanyLogo } from '../components/CompanyLogo';
import { Code128Barcode } from '../lib/code128-barcode';
import { formatCep, formatCpfCnpj } from '../lib/format';
import { fiscalPaymentLabel } from '../lib/nfce-payment';
import { formatNfceAccessKey } from '../lib/nfce-qr';

type XmlAddress = {
  xLgr: string | null;
  nro: string | null;
  xCpl: string | null;
  xBairro: string | null;
  xMun: string | null;
  uf: string | null;
  cep: string | null;
  fone: string | null;
};

/** Espelha `DanfeXmlData` da API (`nfe-danfe-xml.parser.ts`). */
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
    ender: XmlAddress;
  };
  dest: {
    doc: string | null;
    xNome: string | null;
    ie: string | null;
    email: string | null;
    ender: XmlAddress;
  } | null;
  items: Array<{
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
    cst: string | null;
    vBC: number;
    pICMS: number;
    vICMS: number;
    pIPI: number;
    vIPI: number;
    infAdProd: string | null;
  }>;
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

export type DanfeNfePayload = {
  preview?: boolean;
  document: {
    status: string;
    accessKey: string | null;
    protocol: string | null;
    sefazEnvironment?: string | null;
    lastError: string | null;
    sale: {
      number: number;
      total: string;
      discount: string;
      surcharge: string;
      freightAmount?: string;
      freightMod?: number;
      deliveryVehiclePlate?: string | null;
      deliveryDriverName?: string | null;
      notes?: string | null;
      createdAt: string;
      customer: {
        name: string;
        document: string | null;
        ie?: string | null;
        street?: string | null;
        number?: string | null;
        complement?: string | null;
        district?: string | null;
        city?: string | null;
        state?: string | null;
        zip?: string | null;
        phone?: string | null;
        email?: string | null;
      } | null;
      operationNature?: { code: string; description: string; cfop: string } | null;
      payments?: Array<{
        method: string;
        amount: string;
        cardOperation?: string | null;
        paymentForm?: { name?: string | null } | null;
        tPag?: string | null;
        xPag?: string | null;
        fiscalLabel?: string | null;
      }>;
      items?: Array<{
        quantity: string;
        unitPrice: string;
        totalLine: string;
        discount?: string;
        variant?: {
          sku?: string;
          product?: {
            name?: string;
            ncm?: string | null;
            taxUnit?: string | null;
            fiscalSituation?: {
              cstIbsCbs?: string | null;
              cClassTrib?: string | null;
              cstIcms?: string | null;
              csosn?: string | null;
              cfopInternal?: string | null;
              cfopInterstate?: string | null;
              aliqIcms?: string | number | null;
            } | null;
          };
        };
      }>;
    };
  };
  nfe?: { serie: number | null; nNF: number | null } | null;
  xmlData?: DanfeXmlData | null;
  rtc?: {
    crt: number;
    totals: { cbs: string; ibsUf: string; ibsMun: string; is: string };
  };
  company: {
    legalName: string;
    tradeName: string;
    cnpj: string;
    ie: string | null;
    im?: string | null;
    address: string | null;
    addressNumber?: string | null;
    district?: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
    phone: string | null;
    email?: string | null;
    logoUrl?: string | null;
  } | null;
};

type ViewItem = DanfeXmlData['items'][number];

type DanfeView = {
  emit: {
    name: string;
    fant: string;
    doc: string;
    ie: string;
    iest: string;
    im: string;
    lines: string[];
  };
  tpNF: string;
  nNF: string;
  serie: string;
  natOp: string;
  protocol: string;
  dhEmi: string | null;
  dhSaiEnt: string | null;
  dest: {
    name: string;
    doc: string;
    ie: string;
    street: string;
    district: string;
    cep: string;
    city: string;
    uf: string;
    fone: string;
  };
  items: ViewItem[];
  tot: DanfeXmlData['tot'];
  issqn: DanfeXmlData['issqn'];
  transp: DanfeXmlData['transp'];
  dups: DanfeXmlData['cobr']['dup'];
  pays: Array<{ label: string; value: number }>;
  infCpl: string;
  infFisco: string;
};

const MOD_FRETE: Record<string, string> = {
  '0': '0-POR CONTA DO EMIT',
  '1': '1-POR CONTA DO DEST',
  '2': '2-POR CONTA DE TERCEIROS',
  '3': '3-PRÓPRIO POR CONTA DO REM',
  '4': '4-PRÓPRIO POR CONTA DO DEST',
  '9': '9-SEM TRANSPORTE',
};

const T_PAG: Record<string, string> = {
  '01': 'Dinheiro',
  '02': 'Cheque',
  '03': 'Cartão de crédito',
  '04': 'Cartão de débito',
  '05': 'Crédito loja',
  '10': 'Vale alimentação',
  '11': 'Vale refeição',
  '12': 'Vale presente',
  '13': 'Vale combustível',
  '15': 'Boleto bancário',
  '16': 'Depósito bancário',
  '17': 'PIX',
  '18': 'Transferência',
  '19': 'Fidelidade / cashback',
  '90': 'Sem pagamento',
  '99': 'Outros',
};

function n2(v: number | string | null | undefined): string {
  const n = Number(v ?? 0);
  return (Number.isFinite(n) ? n : 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function n4(v: number | string | null | undefined): string {
  const n = Number(v ?? 0);
  return (Number.isFinite(n) ? n : 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
}

/** "2026-11-04T07:38:00-04:00" → data/hora como gravados no XML (sem converter fuso). */
function splitIso(iso: string | null | undefined): { date: string; time: string } {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(String(iso ?? ''));
  if (!m) return { date: '', time: '' };
  return {
    date: `${m[3]}/${m[2]}/${m[1]}`,
    time: m[4] ? `${m[4]}:${m[5]}:${m[6] ?? '00'}` : '',
  };
}

function localIso(d: Date): string {
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function formatNNF(n: string | number | null | undefined): string {
  const d = String(n ?? '').replace(/\D/g, '');
  if (!d) return '—';
  const p = d.padStart(9, '0');
  return `${p.slice(0, 3)}.${p.slice(3, 6)}.${p.slice(6)}`;
}

function formatSerie(s: string | number | null | undefined): string {
  const d = String(s ?? '').replace(/\D/g, '');
  return d ? d.padStart(3, '0') : '—';
}

function formatFone(raw: string | null | undefined): string {
  const d = String(raw ?? '').replace(/\D/g, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return raw?.trim() ?? '';
}

function formatKeyGroups(key: string | null | undefined): string {
  const d = String(key ?? '').replace(/\D/g, '');
  if (d.length !== 44) return key ?? '';
  return formatNfceAccessKey(d);
}

function joinParts(parts: Array<string | null | undefined>, sep = ', '): string {
  return parts.map((p) => (p ?? '').trim()).filter(Boolean).join(sep);
}

function fromXml(data: DanfeNfePayload, x: DanfeXmlData): DanfeView {
  const company = data.company;
  const e = x.emit.ender;
  const d = x.dest?.ender;
  const prot = x.prot;
  const recb = splitIso(prot?.dhRecbto);
  return {
    emit: {
      name: x.emit.xNome ?? company?.legalName ?? '',
      fant: x.emit.xFant ?? company?.tradeName ?? '',
      doc: x.emit.doc ?? company?.cnpj ?? '',
      ie: x.emit.ie ?? '',
      iest: x.emit.iest ?? '',
      im: x.emit.im ?? company?.im ?? '',
      lines: [
        joinParts([e.xLgr, e.nro, e.xCpl]),
        joinParts([e.xBairro, e.cep ? `CEP ${formatCep(e.cep)}` : null], ' - '),
        joinParts([e.xMun, e.uf], ' - '),
        joinParts([e.fone ? `Fone: ${formatFone(e.fone)}` : null, company?.email], '  '),
      ].filter(Boolean),
    },
    tpNF: x.ide.tpNF ?? '1',
    nNF: x.ide.nNF ?? '',
    serie: x.ide.serie ?? '',
    natOp: x.ide.natOp ?? '',
    protocol: prot?.nProt ? joinParts([prot.nProt, joinParts([recb.date, recb.time], ' ')], ' - ') : '',
    dhEmi: x.ide.dhEmi,
    dhSaiEnt: x.ide.dhSaiEnt,
    dest: {
      name: x.dest?.xNome ?? '',
      doc: x.dest?.doc ?? '',
      ie: x.dest?.ie ?? '',
      street: joinParts([d?.xLgr, d?.nro, d?.xCpl]),
      district: d?.xBairro ?? '',
      cep: d?.cep ? formatCep(d.cep) : '',
      city: d?.xMun ?? '',
      uf: d?.uf ?? '',
      fone: formatFone(d?.fone),
    },
    items: x.items,
    tot: x.tot,
    issqn: x.issqn,
    transp: x.transp,
    dups: x.cobr.dup,
    pays: x.pag.map((p) => ({
      label: p.xPag?.trim() || T_PAG[p.tPag ?? ''] || `Forma ${p.tPag ?? ''}`,
      value: p.vPag,
    })),
    infCpl: x.infAdic.infCpl ?? '',
    infFisco: x.infAdic.infAdFisco ?? '',
  };
}

/** Rascunho / pré-visualização: ainda sem XML — usa os dados da venda. */
function fromSale(data: DanfeNfePayload): DanfeView {
  const doc = data.document;
  const sale = doc.sale;
  const company = data.company;
  const c = sale.customer;
  const nature = sale.operationNature;
  const disc = Number(sale.discount) || 0;
  const freight = Number(sale.freightAmount) || 0;
  const surcharge = Number(sale.surcharge) || 0;
  const total = Number(sale.total) || 0;
  const items: ViewItem[] = (sale.items ?? []).map((it, i) => {
    const p = it.variant?.product;
    const fs = p?.fiscalSituation;
    const cst = (fs?.csosn || fs?.cstIcms || '').trim();
    return {
      nItem: i + 1,
      cProd: it.variant?.sku ?? String(i + 1),
      xProd: p?.name ?? '—',
      ncm: (p?.ncm ?? '').replace(/\D/g, '') || null,
      cfop: (nature?.cfop || fs?.cfopInternal || '').trim() || null,
      uCom: p?.taxUnit || 'UN',
      qCom: Number(it.quantity) || 0,
      vUnCom: Number(it.unitPrice) || 0,
      vProd: (Number(it.totalLine) || 0) + (Number(it.discount) || 0),
      vDesc: Number(it.discount) || 0,
      cst: cst ? `0${cst}` : null,
      vBC: 0,
      pICMS: 0,
      vICMS: 0,
      pIPI: 0,
      vIPI: 0,
      infAdProd: null,
    };
  });
  const vProd = items.reduce((s, i) => s + i.vProd, 0);
  const itemDisc = items.reduce((s, i) => s + i.vDesc, 0);
  return {
    emit: {
      name: company?.legalName ?? '',
      fant: company?.tradeName ?? '',
      doc: company?.cnpj ?? '',
      ie: company?.ie ?? '',
      iest: '',
      im: company?.im ?? '',
      lines: [
        joinParts([company?.address, company?.addressNumber]),
        joinParts([company?.district, company?.zip ? `CEP ${formatCep(company.zip)}` : null], ' - '),
        joinParts([company?.city, company?.state], ' - '),
        joinParts([company?.phone ? `Fone: ${formatFone(company.phone)}` : null, company?.email], '  '),
      ].filter(Boolean),
    },
    tpNF: '1',
    nNF: data.nfe?.nNF != null ? String(data.nfe.nNF) : '',
    serie: data.nfe?.serie != null ? String(data.nfe.serie) : '',
    natOp: nature?.description ?? 'VENDA',
    protocol: doc.protocol ?? '',
    dhEmi: localIso(new Date(sale.createdAt)),
    dhSaiEnt: null,
    dest: {
      name: c?.name ?? '',
      doc: c?.document ?? '',
      ie: c?.ie ?? '',
      street: joinParts([c?.street, c?.number, c?.complement]),
      district: c?.district ?? '',
      cep: c?.zip ? formatCep(c.zip) : '',
      city: c?.city ?? '',
      uf: c?.state ?? '',
      fone: formatFone(c?.phone),
    },
    items,
    tot: {
      vBC: 0,
      vICMS: 0,
      vBCST: 0,
      vST: 0,
      vProd: vProd || Math.max(0, total - freight + disc - surcharge),
      vFrete: freight,
      vSeg: 0,
      vDesc: disc + itemDisc,
      vOutro: surcharge,
      vIPI: 0,
      vPIS: 0,
      vCOFINS: 0,
      vNF: total,
      vTotTrib: 0,
    },
    issqn: { vServ: 0, vBC: 0, vISS: 0 },
    transp: {
      modFrete: String(sale.freightMod ?? 9),
      xNome: sale.deliveryDriverName ?? null,
      doc: null,
      ie: null,
      xEnder: null,
      xMun: null,
      uf: null,
      placa: sale.deliveryVehiclePlate ?? null,
      ufPlaca: null,
      rntc: null,
      vol: null,
    },
    dups: [],
    pays: (sale.payments ?? []).map((p) => ({ label: fiscalPaymentLabel(p), value: Number(p.amount) || 0 })),
    infCpl: sale.notes?.trim() ?? '',
    infFisco: '',
  };
}

function Box({
  label,
  value,
  className,
  colSpan,
  rowSpan,
  style,
}: {
  label: string;
  value?: ReactNode;
  className?: string;
  colSpan?: number;
  rowSpan?: number;
  style?: CSSProperties;
}) {
  return (
    <td className={className} colSpan={colSpan} rowSpan={rowSpan} style={style}>
      <span className="lbl">{label}</span>
      <span className="val">{value === '' || value == null ? '\u00a0' : value}</span>
    </td>
  );
}

export function DanfeNfeDocument({ data }: { data: DanfeNfePayload }) {
  const doc = data.document;
  const v = data.xmlData ? fromXml(data, data.xmlData) : fromSale(data);
  const crt = data.rtc?.crt ?? 1;
  const simples = crt === 1 || crt === 2 || crt === 4;
  const homolog = data.xmlData?.ide.tpAmb ? data.xmlData.ide.tpAmb === '2' : doc.sefazEnvironment !== 'PRODUCAO';
  const authorized = doc.status === 'AUTHORIZED';
  const emi = splitIso(v.dhEmi);
  const sai = splitIso(v.dhSaiEnt);
  const printed = splitIso(localIso(new Date()));
  const t = v.tot;
  const tr = v.transp;
  const vol = tr.vol;
  const emitDocFmt = v.emit.doc ? formatCpfCnpj(v.emit.doc) : '';
  const firstPageItems = 18;
  const otherPageItems = 48;
  const pages =
    v.items.length <= firstPageItems
      ? 1
      : 1 + Math.ceil((v.items.length - firstPageItems) / otherPageItems);

  const watermark = data.preview
    ? 'PRÉ-VISUALIZAÇÃO — SEM VALOR FISCAL'
    : !authorized
      ? 'NF-e NÃO AUTORIZADA — SEM VALOR FISCAL'
      : homolog
        ? 'EMITIDA EM AMBIENTE DE HOMOLOGAÇÃO — SEM VALOR FISCAL'
        : '';

  const infCpl = [
    v.infCpl,
    simples && !data.xmlData
      ? 'DOCUMENTO EMITIDO POR ME OU EPP OPTANTE PELO SIMPLES NACIONAL.'
      : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <article className="danfe-nfe">
      {/* Canhoto */}
      <table className="danfe-canhoto">
        <colgroup>
          <col style={{ width: '20%' }} />
          <col style={{ width: '63%' }} />
          <col style={{ width: '17%' }} />
        </colgroup>
        <tbody>
          <tr>
            <td colSpan={2} className="danfe-canhoto-text">
              RECEBEMOS DE {v.emit.name.toUpperCase() || 'EMITENTE'} OS PRODUTOS E/OU SERVIÇOS CONSTANTES DA NOTA
              FISCAL ELETRÔNICA INDICADA ABAIXO. EMISSÃO: {emi.date || '—'} VALOR TOTAL: R$ {n2(t.vNF)}{' '}
              DESTINATÁRIO: {v.dest.name.toUpperCase()}
              {v.dest.street ? ` - ${v.dest.street.toUpperCase()}` : ''}
              {v.dest.city ? ` ${v.dest.district ? `${v.dest.district.toUpperCase()} ` : ''}${v.dest.city.toUpperCase()}-${v.dest.uf}` : ''}
            </td>
            <td rowSpan={2} className="danfe-canhoto-nf">
              <strong>NF-e</strong>
              <div>Nº {formatNNF(v.nNF)}</div>
              <div>Série {formatSerie(v.serie)}</div>
            </td>
          </tr>
          <tr>
            <Box label="Data de recebimento" style={{ height: '9mm' }} />
            <Box label="Identificação e assinatura do recebedor" />
          </tr>
        </tbody>
      </table>
      <div className="danfe-cut" />

      {watermark ? <div className="danfe-watermark">{watermark}</div> : null}

      {/* Cabeçalho */}
      <table className="danfe-head">
        <colgroup>
          <col style={{ width: '40%' }} />
          <col style={{ width: '17%' }} />
          <col style={{ width: '43%' }} />
        </colgroup>
        <tbody>
          <tr>
            <td rowSpan={2} className="danfe-emit">
              <span className="lbl">Identificação do emitente</span>
              <div className="danfe-emit-body">
                {data.company?.logoUrl ? (
                  <CompanyLogo
                    className="danfe-logo"
                    company={{
                      logoUrl: data.company.logoUrl,
                      tradeName: data.company.tradeName,
                      legalName: data.company.legalName,
                    }}
                  />
                ) : null}
                <div className="danfe-emit-text">
                  <div className="danfe-emit-name">{v.emit.name}</div>
                  {v.emit.lines.map((l, i) => (
                    <div key={i}>{l}</div>
                  ))}
                </div>
              </div>
            </td>
            <td rowSpan={2} className="danfe-title">
              <div className="danfe-title-main">DANFE</div>
              <div className="danfe-title-sub">
                Documento Auxiliar da
                <br />
                Nota Fiscal Eletrônica
              </div>
              <div className="danfe-tpnf">
                <div>
                  0 - ENTRADA
                  <br />1 - SAÍDA
                </div>
                <span className="danfe-tpnf-box">{v.tpNF}</span>
              </div>
              <div className="danfe-title-num">Nº {formatNNF(v.nNF)}</div>
              <div className="danfe-title-num">SÉRIE {formatSerie(v.serie)}</div>
              <div className="danfe-title-folha">FOLHA 1/{pages}</div>
            </td>
            <td className="danfe-barcode-cell">
              {doc.accessKey ? (
                <Code128Barcode value={doc.accessKey} className="danfe-barcode" height={40} />
              ) : (
                <div className="danfe-nokey">Chave de acesso ainda não gerada</div>
              )}
            </td>
          </tr>
          <tr>
            <td>
              <span className="lbl">Chave de acesso</span>
              <div className="danfe-key">{formatKeyGroups(doc.accessKey) || '—'}</div>
              <div className="danfe-consulta">
                Consulta de autenticidade no portal nacional da NF-e www.nfe.fazenda.gov.br/portal ou no site da
                Sefaz Autorizadora
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      <table>
        <tbody>
          <tr>
            <Box label="Natureza da operação" value={v.natOp.toUpperCase()} style={{ width: '57%' }} />
            <Box label="Protocolo de autorização de uso" value={v.protocol} className="center" />
          </tr>
        </tbody>
      </table>
      <table>
        <tbody>
          <tr>
            <Box label="Inscrição estadual" value={v.emit.ie} style={{ width: '33%' }} />
            <Box label="Inscrição estadual do subst. trib." value={v.emit.iest} style={{ width: '34%' }} />
            <Box label="CNPJ" value={emitDocFmt} />
          </tr>
        </tbody>
      </table>

      {/* Destinatário */}
      <div className="danfe-sec">Destinatário / remetente</div>
      <table>
        <colgroup>
          <col style={{ width: '40%' }} />
          <col style={{ width: '20%' }} />
          <col style={{ width: '11%' }} />
          <col style={{ width: '17%' }} />
          <col style={{ width: '12%' }} />
        </colgroup>
        <tbody>
          <tr>
            <Box label="Nome / razão social" value={v.dest.name.toUpperCase()} colSpan={3} />
            <Box label="CNPJ / CPF" value={v.dest.doc ? formatCpfCnpj(v.dest.doc) : ''} className="center" />
            <Box label="Data da emissão" value={emi.date} className="center" />
          </tr>
          <tr>
            <Box label="Endereço" value={v.dest.street.toUpperCase()} />
            <Box label="Bairro / distrito" value={v.dest.district.toUpperCase()} />
            <Box label="CEP" value={v.dest.cep} className="center" />
            <Box label="Data da saída / entrada" value={sai.date} className="center" colSpan={2} />
          </tr>
          <tr>
            <Box label="Município" value={v.dest.city.toUpperCase()} />
            <Box label="Fone / fax" value={v.dest.fone} />
            <Box label="UF" value={v.dest.uf} className="center" />
            <Box label="Inscrição estadual" value={v.dest.ie} />
            <Box label="Hora da saída" value={sai.time} className="center" />
          </tr>
        </tbody>
      </table>

      {/* Fatura / duplicatas */}
      {v.dups.length > 0 || v.pays.length > 0 ? (
        <>
          <div className="danfe-sec">{v.dups.length > 0 ? 'Fatura / duplicatas' : 'Pagamento'}</div>
          <div className="danfe-dups">
            {v.dups.length > 0
              ? v.dups.map((d, i) => (
                  <div key={i} className="danfe-dup">
                    <div>
                      <span>Núm.:</span> {d.nDup ?? i + 1}
                    </div>
                    <div>
                      <span>Venc.:</span> {splitIso(d.dVenc).date}
                    </div>
                    <div>
                      <span>Valor:</span> {n2(d.vDup)}
                    </div>
                  </div>
                ))
              : v.pays.map((p, i) => (
                  <div key={i} className="danfe-dup">
                    <div>{p.label}</div>
                    <div>
                      <span>Valor:</span> {n2(p.value)}
                    </div>
                  </div>
                ))}
          </div>
        </>
      ) : null}

      {/* Cálculo do imposto */}
      <div className="danfe-sec">Cálculo do imposto</div>
      <table className="danfe-nums">
        <tbody>
          <tr>
            <Box label="Base de cálc. do ICMS" value={n2(t.vBC)} />
            <Box label="Valor do ICMS" value={n2(t.vICMS)} />
            <Box label="Base de cálc. ICMS S.T." value={n2(t.vBCST)} />
            <Box label="Valor do ICMS subst." value={n2(t.vST)} />
            <Box label="V. aprox. tributos" value={n2(t.vTotTrib)} />
            <Box label="Valor total dos produtos" value={n2(t.vProd)} />
          </tr>
          <tr>
            <Box label="Valor do frete" value={n2(t.vFrete)} />
            <Box label="Valor do seguro" value={n2(t.vSeg)} />
            <Box label="Desconto" value={n2(t.vDesc)} />
            <Box label="Outras despesas" value={n2(t.vOutro)} />
            <Box label="Valor total do IPI" value={n2(t.vIPI)} />
            <Box label="Valor total da nota" value={n2(t.vNF)} className="danfe-vnf" />
          </tr>
        </tbody>
      </table>

      {/* Transportador */}
      <div className="danfe-sec">Transportador / volumes transportados</div>
      <table>
        <tbody>
          <tr>
            <Box label="Nome / razão social" value={tr.xNome?.toUpperCase()} style={{ width: '30%' }} />
            <Box label="Frete" value={MOD_FRETE[tr.modFrete ?? '9'] ?? tr.modFrete} style={{ width: '17%' }} />
            <Box label="Código ANTT" value={tr.rntc} />
            <Box label="Placa do veículo" value={tr.placa} />
            <Box label="UF" value={tr.ufPlaca} className="center" style={{ width: '5%' }} />
            <Box label="CNPJ / CPF" value={tr.doc ? formatCpfCnpj(tr.doc) : ''} style={{ width: '16%' }} />
          </tr>
          <tr>
            <Box label="Endereço" value={tr.xEnder?.toUpperCase()} colSpan={2} />
            <Box label="Município" value={tr.xMun?.toUpperCase()} colSpan={2} />
            <Box label="UF" value={tr.uf} className="center" />
            <Box label="Inscrição estadual" value={tr.ie} />
          </tr>
        </tbody>
      </table>
      <table className="danfe-nums">
        <tbody>
          <tr>
            <Box label="Quantidade" value={vol?.qVol} />
            <Box label="Espécie" value={vol?.esp} className="left" />
            <Box label="Marca" value={vol?.marca} className="left" />
            <Box label="Numeração" value={vol?.nVol} className="left" />
            <Box label="Peso bruto" value={vol?.pesoB != null ? n4(vol.pesoB) : ''} />
            <Box label="Peso líquido" value={vol?.pesoL != null ? n4(vol.pesoL) : ''} />
          </tr>
        </tbody>
      </table>

      {/* Produtos */}
      <div className="danfe-sec">Dados dos produtos / serviços</div>
      <table className="danfe-items">
        <colgroup>
          <col style={{ width: '8%' }} />
          <col style={{ width: '24%' }} />
          <col style={{ width: '6.5%' }} />
          <col style={{ width: '4.5%' }} />
          <col style={{ width: '4.5%' }} />
          <col style={{ width: '3.5%' }} />
          <col style={{ width: '6.5%' }} />
          <col style={{ width: '7%' }} />
          <col style={{ width: '7%' }} />
          <col style={{ width: '5.5%' }} />
          <col style={{ width: '6%' }} />
          <col style={{ width: '5.5%' }} />
          <col style={{ width: '4.5%' }} />
          <col style={{ width: '3.5%' }} />
          <col style={{ width: '3.5%' }} />
        </colgroup>
        <thead>
          <tr>
            <th>Código</th>
            <th>Descrição do produto / serviço</th>
            <th>NCM/SH</th>
            <th>{simples ? 'O/CSOSN' : 'O/CST'}</th>
            <th>CFOP</th>
            <th>UN</th>
            <th>Quant.</th>
            <th>Valor unit.</th>
            <th>Valor total</th>
            <th>Valor desc.</th>
            <th>B.cálc. ICMS</th>
            <th>Valor ICMS</th>
            <th>Valor IPI</th>
            <th>Alíq. ICMS</th>
            <th>Alíq. IPI</th>
          </tr>
        </thead>
        <tbody>
          {v.items.length === 0 ? (
            <tr>
              <td colSpan={15} className="center">
                Sem itens
              </td>
            </tr>
          ) : (
            v.items.map((it) => (
              <tr key={it.nItem}>
                <td>{it.cProd}</td>
                <td className="left">
                  {it.xProd}
                  {it.infAdProd ? <div className="danfe-infadprod">{it.infAdProd}</div> : null}
                </td>
                <td className="center">{it.ncm}</td>
                <td className="center">{it.cst}</td>
                <td className="center">{it.cfop}</td>
                <td className="center">{it.uCom}</td>
                <td className="right">{n4(it.qCom)}</td>
                <td className="right">{n4(it.vUnCom)}</td>
                <td className="right">{n2(it.vProd)}</td>
                <td className="right">{n2(it.vDesc)}</td>
                <td className="right">{n2(it.vBC)}</td>
                <td className="right">{n2(it.vICMS)}</td>
                <td className="right">{n2(it.vIPI)}</td>
                <td className="right">{n2(it.pICMS)}</td>
                <td className="right">{n2(it.pIPI)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      {/* ISSQN */}
      <div className="danfe-sec">Cálculo do ISSQN</div>
      <table className="danfe-nums">
        <tbody>
          <tr>
            <Box label="Inscrição municipal" value={v.emit.im} className="left" />
            <Box label="Valor total dos serviços" value={n2(v.issqn.vServ)} />
            <Box label="Base de cálculo do ISSQN" value={n2(v.issqn.vBC)} />
            <Box label="Valor do ISSQN" value={n2(v.issqn.vISS)} />
          </tr>
        </tbody>
      </table>

      {/* Dados adicionais */}
      <div className="danfe-sec">Dados adicionais</div>
      <table>
        <tbody>
          <tr>
            <td className="danfe-adic" style={{ width: '64%' }}>
              <span className="lbl">Informações complementares</span>
              <div className="danfe-adic-text">
                {infCpl || '\u00a0'}
                {!authorized && doc.lastError ? <div className="danfe-err">{doc.lastError}</div> : null}
              </div>
            </td>
            <td className="danfe-adic">
              <span className="lbl">Reservado ao fisco</span>
              <div className="danfe-adic-text">{v.infFisco || '\u00a0'}</div>
            </td>
          </tr>
        </tbody>
      </table>
      <div className="danfe-foot">
        <span>
          DATA E HORA DA IMPRESSÃO: {printed.date} {printed.time}
        </span>
        <span>GestorVend · Controle interno #{doc.sale.number}</span>
      </div>
    </article>
  );
}
