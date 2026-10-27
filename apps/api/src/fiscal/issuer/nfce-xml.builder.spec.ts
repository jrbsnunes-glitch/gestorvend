import {
  buildNfceInfNFeXml,
  buildNfceQrUrlAm,
  buildNfceQrUrlV3,
  sanitizeTString,
} from './nfce-xml.builder';
import { buildNfceAutorizacaoEnvelope } from '../sefaz/nfce-autorizacao-soap';

const item = {
  nItem: 1,
  sku: 'HOMOLOG-FISCAL-TEST',
  description: 'NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL',
  ncm: '04072100',
  cfop: '5102',
  uCom: 'UN',
  qCom: 1,
  vUnCom: 1,
  vProd: 1,
  orig: '0',
  csosn: '102',
};

function sampleXml(dest?: { document: string }) {
  return buildNfceInfNFeXml({
    chave44: '13261052604282000130650010000000011123456782',
    cNF: '12345678',
    natOp: 'VENDA DE MERCADORIA',
    tpAmb: 2,
    dhEmiIso: '2026-10-23T10:00:00-04:00',
    crt: 1,
    codMunIbgeFg: '1302504',
    modelo: 65,
    serie: 1,
    nNF: 1,
    emit: {
      cnpj: '52604282000130',
      ie: '054612942',
      xNome: 'NAUTICA BALBY LTDA',
      xLgr: 'Rua Solimoes',
      nro: '1725',
      xBairro: 'Correnteza',
      cMun: '1302504',
      xMun: 'Manacapuru',
      uf: 'AM',
      cep: '69400064',
    },
    dest: dest ? { document: dest.document, xNome: 'CONSUMIDOR' } : undefined,
    items: [item],
    totals: { vNF: 1, vProd: 1, vDesc: 0, vOutro: 0 },
    payments: [{ tPag: '01', vPag: 1 }],
  }).xmlNfeEnvelope;
}

describe('nfce-xml.builder', () => {
  it('omite dest na NFC-e sem consumidor identificado', () => {
    const xml = sampleXml();
    expect(xml).not.toContain('<dest>');
    expect(xml).toContain('<cProd>HOMOLOG-FISCAL-TEST</cProd>');
    expect(xml).not.toContain('<vTroco>');
    expect(xml).not.toContain('<IPI>');
  });

  it('não envia CPF zerado como destinatário', () => {
    const xml = sampleXml({ document: '00000000000' });
    expect(xml).not.toContain('<dest>');
  });

  it('monta QR v3 on-line sem CSC', () => {
    const url = buildNfceQrUrlV3({
      chNFe: '13261052604282000130650010000000011123456782',
      tpAmb: 2,
      qrBaseUrl: 'https://sistemas.sefaz.am.gov.br/nfceweb-hom/consultarNFCe.jsp',
    });
    expect(url).toBe(
      'https://sistemas.sefaz.am.gov.br/nfceweb-hom/consultarNFCe.jsp?p=13261052604282000130650010000000011123456782|3|2',
    );
  });

  it('monta QR v2 com CSC sem zeros à esquerda no id', () => {
    const url = buildNfceQrUrlAm({
      chNFe: '13261052604282000130650010000000011123456782',
      tpAmb: 2,
      cscId: '000001',
      csc: 'TOKEN',
      qrBaseUrl: 'https://sistemas.sefaz.am.gov.br/nfceweb/consultarNFCe.jsp',
    });
    expect(url).toMatch(
      /^https:\/\/sistemas\.sefaz\.am\.gov\.br\/nfceweb\/consultarNFCe\.jsp\?p=13261052604282000130650010000000011123456782\|2\|2\|1\|[A-F0-9]{40}$/,
    );
  });

  it('SOAP de autorização é document/literal (nfeDadosMsg direto no Body)', () => {
    const envi =
      `<enviNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">` +
      `<idLote>1</idLote><indSinc>1</indSinc>${sampleXml()}</enviNFe>`;
    const soap = buildNfceAutorizacaoEnvelope(envi);
    expect(soap).toContain('<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4">');
    expect(soap).not.toContain('<nfeAutorizacaoLote');
    expect(soap).not.toContain('<![CDATA[');
  });

  it('informa IBSCBS no Simples quando a situação tem CST e cClassTrib', () => {
    const xml = buildNfceInfNFeXml({
      chave44: '13261052604282000130650010000000011123456782',
      cNF: '12345678',
      natOp: 'VENDA',
      tpAmb: 2,
      dhEmiIso: '2026-10-23T10:00:00-04:00',
      crt: 1,
      codMunIbgeFg: '1302504',
      modelo: 65,
      serie: 1,
      nNF: 1,
      emit: {
        cnpj: '52604282000130',
        ie: '054612942',
        xNome: 'NAUTICA BALBY LTDA',
        xLgr: 'Rua Teste',
        nro: '1',
        xBairro: 'Centro',
        cMun: '1302504',
        xMun: 'Manacapuru',
        uf: 'AM',
        cep: '69400064',
      },
      items: [{ ...item, cstIbsCbs: '000', cClassTrib: '000001', ibsRate: 0.1, cbsRate: 0.9 }],
      totals: { vNF: 1, vProd: 1, vDesc: 0, vOutro: 0 },
      payments: [{ tPag: '01', vPag: 1 }],
    }).xmlNfeEnvelope;
    expect(xml).toContain('<IBSCBS><CST>000</CST><cClassTrib>000001</cClassTrib>');
    expect(xml).toContain('<pIBSUF>0.1000</pIBSUF>');
    expect(xml).toContain('<pCBS>0.9000</pCBS>');
    expect(xml).toContain('<IBSCBSTot><vBCIBSCBS>1.00</vBCIBSCBS>');
    expect(xml).toContain('<vCBS>0.01</vCBS>');
  });

  it('envia xPag só quando tPag é 99', () => {
    const withX = buildNfceInfNFeXml({
      chave44: '13261052604282000130650010000000011123456782',
      cNF: '12345678',
      natOp: 'VENDA',
      tpAmb: 2,
      dhEmiIso: '2026-10-23T10:00:00-04:00',
      crt: 1,
      codMunIbgeFg: '1302504',
      modelo: 65,
      serie: 1,
      nNF: 1,
      emit: {
        cnpj: '52604282000130',
        ie: '054612942',
        xNome: 'NAUTICA BALBY LTDA',
        xLgr: 'Rua Teste',
        nro: '1',
        xBairro: 'Centro',
        cMun: '1302504',
        xMun: 'Manacapuru',
        uf: 'AM',
        cep: '69400064',
      },
      items: [item],
      totals: { vNF: 1, vProd: 1, vDesc: 0, vOutro: 0 },
      payments: [{ tPag: '99', vPag: 1, xPag: 'Vale funcionario', indPag: 0 }],
    }).xmlNfeEnvelope;
    expect(withX).toContain('<tPag>99</tPag><xPag>Vale funcionario</xPag><vPag>1.00</vPag>');

    const cash = sampleXml();
    expect(cash).toContain('<tPag>01</tPag><vPag>1.00</vPag>');
    expect(cash).not.toContain('<xPag>');
  });

  it('sanitizeTString remove caracteres fora do Latin-1', () => {
    expect(sanitizeTString('Rua Solimões', 60)).toBe('Rua Solimões');
    expect(sanitizeTString('  ABC  ', 60)).toBe('ABC');
    expect(sanitizeTString('A\u2014B', 60)).toBe('A B');
  });
});
