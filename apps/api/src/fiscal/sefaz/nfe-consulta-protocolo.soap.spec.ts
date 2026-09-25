import {
  buildConsSitNFeXml,
  parseNfeConsultaProtocoloResponse,
} from './nfe-consulta-protocolo.soap';

describe('nfe-consulta-protocolo.soap', () => {
  it('buildConsSitNFeXml monta chave', () => {
    const xml = buildConsSitNFeXml({
      tpAmb: 2,
      chNFe: '35250912345678000190550010000000011000000012',
    });
    expect(xml).toContain('<xServ>CONSULTAR</xServ>');
    expect(xml).toContain('35250912345678000190550010000000011000000012');
  });

  it('parse autorizado cStat 100', () => {
    const sample = `
      <retConsSitNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
        <tpAmb>2</tpAmb>
        <verAplic>SVRS</verAplic>
        <cStat>100</cStat>
        <xMotivo>Autorizado o uso da NF-e</xMotivo>
        <protNFe versao="4.00">
          <infProt>
            <tpAmb>2</tpAmb>
            <chNFe>35250912345678000190550010000000011000000012</chNFe>
            <dhRecbto>2025-09-16T10:00:00-03:00</dhRecbto>
            <nProt>135250000000001</nProt>
            <digVal>abc=</digVal>
            <cStat>100</cStat>
            <xMotivo>Autorizado o uso da NF-e</xMotivo>
          </infProt>
        </protNFe>
      </retConsSitNFe>`;
    const r = parseNfeConsultaProtocoloResponse(sample);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.accessKey).toBe('35250912345678000190550010000000011000000012');
      expect(r.protocol).toBe('135250000000001');
      expect(r.protNFeXml).toContain('<protNFe');
    }
  });

  it('parse cStat 217 notFound', () => {
    const r = parseNfeConsultaProtocoloResponse(
      '<retConsSitNFe><cStat>217</cStat><xMotivo>NF-e não consta na base</xMotivo></retConsSitNFe>',
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.notFound).toBe(true);
      expect(r.cStat).toBe('217');
    }
  });
});
