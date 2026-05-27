import { SignedXml } from 'xml-crypto';

/**
 * Assina o primeiro elemento `infNFe` dentro de `<NFe ...>` segundo padrão XMLDSig (referência pelo atributo Id).
 */
export function signNfeSignatureSibling(xmlInner: string, opts: {
  infNFeId: string;
  privateKeyPem: string;
  certificatePem: string;
}): string {
  const sig = new SignedXml({
    privateKey: opts.privateKeyPem,
    publicCert: opts.certificatePem,
    canonicalizationAlgorithm: 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
    signatureAlgorithm: 'http://www.w3.org/2000/09/xmldsig#rsa-sha1',
  });
  sig.addReference({
    xpath: `//*[@Id='${opts.infNFeId}']`,
    digestAlgorithm: 'http://www.w3.org/2000/09/xmldsig#sha1',
    transforms: [
      'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
      'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
    ],
    uri: '#' + opts.infNFeId,
  });
  sig.computeSignature(xmlInner);
  return sig.getSignedXml();
}

/** Extrai primeira DigestValue (base64) do XML assinado — usada no QR da NFC-e. */
export function extractFirstDigestValueB64(signedXml: string): string | null {
  const m = signedXml.match(/<DigestValue>([^<]+)<\/DigestValue>/);
  return m?.[1]?.trim() ?? null;
}
