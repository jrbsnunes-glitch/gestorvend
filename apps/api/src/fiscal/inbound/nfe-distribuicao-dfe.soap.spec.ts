import { gzipSync } from 'zlib';
import { buildNfceAccessKey } from '../utils/nfe-access-key';
import {
  buildDistDFeIntXml,
  parseDistribuicaoDfeResponse,
} from './nfe-distribuicao-dfe.soap';

const SAMPLE_KEY = buildNfceAccessKey({
  codUf: '35',
  aammEmissao: '2509',
  cnpj14: '12345678000190',
  serie3: 1,
  nNF9: 12,
  tpEmis: 1,
  codigoNumerico8: 1,
  modelo: 55,
});

describe('nfe-distribuicao-dfe.soap', () => {
  it('buildDistDFeIntXml monta consChNFe com 44 dígitos', () => {
    const xml = buildDistDFeIntXml({
      tpAmb: 1,
      cUFAutor: '35',
      cnpj14: '12345678000190',
      query: { kind: 'consChNFe', chNFe: SAMPLE_KEY },
    });
    expect(xml).toContain('versao="1.01"');
    expect(xml).toContain('<consChNFe>');
    expect(xml).toContain(`<chNFe>${SAMPLE_KEY}</chNFe>`);
    expect(xml).toContain('<CNPJ>12345678000190</CNPJ>');
    expect(SAMPLE_KEY).toHaveLength(44);
    expect(SAMPLE_KEY.slice(20, 22)).toBe('55');
  });

  it('cStat 137 (nenhum documento) não é tratado como sucesso de XML', () => {
    const soap = `
      <retDistDFeInt>
        <tpAmb>1</tpAmb>
        <cStat>137</cStat>
        <xMotivo>Nenhum documento localizado</xMotivo>
        <ultNSU>000000000000000</ultNSU>
        <maxNSU>000000000000000</maxNSU>
      </retDistDFeInt>`;
    const r = parseDistribuicaoDfeResponse(soap);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.cStat).toBe('137');
      expect(r.xMotivo).toMatch(/nenhum documento/i);
    }
  });

  it('cStat 138 com resNFe sinaliza resumo (XML completo ainda não veio)', () => {
    const b64 = gzipSync(
      Buffer.from(`<resNFe><chNFe>${SAMPLE_KEY}</chNFe></resNFe>`, 'utf8'),
    ).toString('base64');
    const soap = `
      <retDistDFeInt>
        <cStat>138</cStat>
        <xMotivo>Documento localizado</xMotivo>
        <loteDistDFeInt>
          <docZip NSU="1" schema="resNFe_v1.01.xsd">${b64}</docZip>
        </loteDistDFeInt>
      </retDistDFeInt>`;
    const r = parseDistribuicaoDfeResponse(soap);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.isSummaryOnly).toBe(true);
      expect(r.xMotivo).toMatch(/resumo/i);
    }
  });
});
