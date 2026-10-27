import { extractAccessKeyFromXml } from './nfe-inbound-xml.parser';
import { buildNfceAccessKey } from '../utils/nfe-access-key';

const KEY = buildNfceAccessKey({
  codUf: '35',
  aammEmissao: '2509',
  cnpj14: '12345678000190',
  serie3: 1,
  nNF9: 12,
  tpEmis: 1,
  codigoNumerico8: 1,
  modelo: 55,
});

describe('extractAccessKeyFromXml', () => {
  it('lê chNFe simples', () => {
    expect(extractAccessKeyFromXml(`<nfeProc><chNFe>${KEY}</chNFe></nfeProc>`)).toBe(KEY);
  });

  it('lê chNFe com prefixo de namespace', () => {
    expect(
      extractAccessKeyFromXml(`<nfe:nfeProc><nfe:chNFe>${KEY}</nfe:chNFe></nfe:nfeProc>`),
    ).toBe(KEY);
  });

  it('lê Id="NFe…" na infNFe', () => {
    expect(extractAccessKeyFromXml(`<infNFe Id="NFe${KEY}"></infNFe>`)).toBe(KEY);
  });
});
