import { SignedXml } from 'xml-crypto';

/** Usa só o primeiro certificado PEM (folha). Cadeia completa quebra o KeyInfo da assinatura. */
function leafCertificatePem(pem: string): string {
  const m = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/);
  return m?.[0] ?? pem;
}

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
  const cert = leafCertificatePem(opts.certificatePem);
  const sig = new SignedXml({
    privateKey: opts.privateKeyPem,
    publicCert: cert,
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
  sig.computeSignature(xmlInner, {
    location: { reference: `//*[@Id='${opts.elementId}']`, action: 'after' },
  });
  return sig.getSignedXml();
}
