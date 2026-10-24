import { appendInfNFeSupl } from './nfce-xml.builder';
import { extractNfceSuplFromXml, parseNfceAccessKey, resolveNfceCouponPrint } from './nfce-print-supl';

const CHAVE = '13261052604282000130650010000000011622372428';

describe('nfce-print-supl', () => {
  it('lê série e número da chave de 44 dígitos', () => {
    expect(parseNfceAccessKey(CHAVE)).toEqual({ serie: 1, nNF: 1 });
  });

  it('extrai qrCode e urlChave do XML (texto e CDATA)', () => {
    const qr =
      'https://sistemas.sefaz.am.gov.br/nfceweb-hom/consultarNFCe.jsp?p=' + CHAVE + '|3|2';
    const withText = appendInfNFeSupl('<NFe></NFe>', qr, 'www.sefaz.am.gov.br/nfce/consulta');
    expect(extractNfceSuplFromXml(withText)).toEqual({
      qrCode: qr,
      urlChave: 'www.sefaz.am.gov.br/nfce/consulta',
    });

    const withCdata =
      `<NFe><infNFeSupl><qrCode><![CDATA[${qr}]]></qrCode>` +
      `<urlChave>www.sefaz.am.gov.br/nfce/consulta</urlChave></infNFeSupl></NFe>`;
    expect(extractNfceSuplFromXml(withCdata).qrCode).toBe(qr);
  });

  it('prioriza o QR do XML e, na falta, reconstrói v3 em homologação AM', () => {
    const fromXml = resolveNfceCouponPrint({
      xml: appendInfNFeSupl('<NFe></NFe>', 'https://exemplo/qr', 'www.sefaz.am.gov.br/nfce/consulta'),
      accessKey: CHAVE,
      sefazEnvironment: 'HOMOLOGACAO',
      uf: 'AM',
    });
    expect(fromXml.qrCode).toBe('https://exemplo/qr');

    const rebuilt = resolveNfceCouponPrint({
      accessKey: CHAVE,
      sefazEnvironment: 'HOMOLOGACAO',
      uf: 'AM',
    });
    expect(rebuilt.qrCode).toBe(
      `https://sistemas.sefaz.am.gov.br/nfceweb-hom/consultarNFCe.jsp?p=${CHAVE}|3|2`,
    );
    expect(rebuilt.urlChave).toBe('www.sefaz.am.gov.br/nfce/consulta');
    expect(rebuilt.serie).toBe(1);
    expect(rebuilt.nNF).toBe(1);
  });
});
