import { SignedXml } from 'xml-crypto';

/**
 * Assina o elemento com atributo Id informado (XMLDSig enveloped) — usado em
 * `infNFe` e `infEvento` (manifestação do destinatário).
 */
export function signXmlElementById(
  xmlInner: string,
  opts: {
    elementId: string;
    privateKeyPem: string;
    certificatePem: string;
  },
): string {
  const sig = new SignedXml({
    privateKey: opts.privateKeyPem,
    publicCert: opts.certificatePem,
    canonicalizationAlgorithm: 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
    signatureAlgorithm: 'http://www.w3.org/2000/09/xmldsig#rsa-sha1',
  });
  sig.addReference({
    xpath: `//*[@Id='${opts.elementId}']`,
    digestAlgorithm: 'http://www.w3.org/2000/09/xmldsig#sha1',
    transforms: [
      'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
      'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
    ],
    uri: '#' + opts.elementId,
  });
  sig.computeSignature(xmlInner);
  return sig.getSignedXml();
}
