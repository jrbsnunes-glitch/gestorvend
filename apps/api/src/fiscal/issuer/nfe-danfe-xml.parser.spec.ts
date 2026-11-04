import { buildNfceInfNFeXml } from './nfce-xml.builder';
import { parseNfeDanfeXml } from './nfe-danfe-xml.parser';

function sampleNfe55() {
  const nfe = buildNfceInfNFeXml({
    chave44: '13261152604282000130550020000000301255638354',
    cNF: '25563835',
    natOp: 'VENDA DE MERCADORIA',
    tpAmb: 1,
    dhEmiIso: '2026-11-04T07:38:00-04:00',
    crt: 1,
    codMunIbgeFg: '1302504',
    modelo: 55,
    serie: 2,
    nNF: 30,
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
    dest: {
      document: '12345678000195',
      xNome: 'FRIGOPESCA LTDA',
      indIEDest: '1',
      ie: '041234567',
      ender: {
        xLgr: 'Rua A',
        nro: '10',
        xBairro: 'Centro',
        cMun: '1302603',
        xMun: 'Manaus',
        uf: 'AM',
        cep: '69000000',
      },
    },
    items: [
      {
        nItem: 1,
        sku: 'GELO-01',
        description: 'GELO EM ESCAMA',
        ncm: '22019000',
        cfop: '5102',
        uCom: 'KG',
        qCom: 590,
        vUnCom: 2,
        vProd: 1180,
        orig: '0',
        csosn: '102',
      },
    ],
    totals: { vNF: 1180, vProd: 1180, vDesc: 0, vOutro: 0 },
    payments: [{ tPag: '15', vPag: 1180 }],
  }).xmlNfeEnvelope;
  return (
    `<nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">${nfe}` +
    `<protNFe versao="4.00"><infProt><tpAmb>1</tpAmb><chNFe>13261152604282000130550020000000301255638354</chNFe>` +
    `<dhRecbto>2026-11-04T07:40:12-04:00</dhRecbto><nProt>113263872238487</nProt><cStat>100</cStat></infProt></protNFe>` +
    `</nfeProc>`
  );
}

describe('parseNfeDanfeXml', () => {
  it('lê emitente, destinatário com IE, itens, totais e protocolo', () => {
    const d = parseNfeDanfeXml(sampleNfe55());
    expect(d).not.toBeNull();
    expect(d!.ide.nNF).toBe('30');
    expect(d!.ide.serie).toBe('2');
    expect(d!.emit.ie).toBe('054612942');
    expect(d!.dest?.ie).toBe('041234567');
    expect(d!.dest?.ender.xMun).toBe('Manaus');
    expect(d!.items).toHaveLength(1);
    expect(d!.items[0].cst).toBe('0102');
    expect(d!.items[0].qCom).toBe(590);
    expect(d!.tot.vNF).toBe(1180);
    expect(d!.pag[0].tPag).toBe('15');
    expect(d!.prot?.nProt).toBe('113263872238487');
  });

  it('retorna null sem XML', () => {
    expect(parseNfeDanfeXml(null)).toBeNull();
  });
});
