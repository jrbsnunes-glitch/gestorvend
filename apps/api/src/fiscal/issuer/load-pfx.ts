import * as fs from 'fs';
import * as forge from 'node-forge';

export type PfxMaterial = { privateKeyPem: string; certificatePem: string };

/**
 * Carrega certificado A1 (.pfx/.p12) e devolve chave + certificado em PEM.
 */
export function loadPfxMaterial(pfxPath: string, password: string): PfxMaterial {
  const raw = fs.readFileSync(pfxPath, 'binary');
  const der = forge.util.createBuffer(raw);
  const asn1 = forge.asn1.fromDer(der);
  const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, password);

  const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
  const plainKeyBags = p12.getBags({ bagType: forge.pki.oids.keyBag });
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });

  const keyEntry =
    keyBags[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0] ??
    plainKeyBags[forge.pki.oids.keyBag]?.[0];

  let privateKey =
    keyEntry && 'key' in keyEntry
      ? (keyEntry.key as forge.pki.PrivateKey | undefined)
      : undefined;

  if (!privateKey) {
    // Alguns PACs gravam apenas certBag — tenta PKCS#12 genérico
    const bags = Object.values(keyBags).flat();
    for (const b of bags as Array<{ key?: forge.pki.PrivateKey }>) {
      if (b?.key) {
        privateKey = b.key;
        break;
      }
    }
  }

  const certBag = certBags[forge.pki.oids.certBag]?.[0];
  let cert =
    certBag && 'cert' in certBag
      ? ((certBag as { cert: forge.pki.Certificate }).cert as forge.pki.Certificate | undefined)
      : undefined;

  if (!cert) {
    throw new Error('PFX não contém certificado público esperado.');
  }
  if (!privateKey) {
    throw new Error('PFX não contém chave privada PKCS#8 / keyBag esperada.');
  }

  const privateKeyPem = forge.pki.privateKeyToPem(privateKey);
  const certificatePem = forge.pki.certificateToPem(cert);
  return { privateKeyPem, certificatePem };
}
