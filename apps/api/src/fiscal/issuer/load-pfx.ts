import * as fs from 'fs';
import * as https from 'https';
import * as tls from 'tls';
import * as forge from 'node-forge';
import { formatPfxLoadError } from './pfx.errors';

export type PfxMaterial = { privateKeyPem: string; certificatePem: string };

function createMutualTlsAgentFromPem(certificatePem: string, privateKeyPem: string): https.Agent {
  return new https.Agent({
    cert: certificatePem,
    key: privateKeyPem,
    rejectUnauthorized: true,
    minVersion: 'TLSv1.2',
  });
}

/** Tenta PKCS#12 nativo (Node/OpenSSL); se falhar, usa node-forge (PFX legado ICP-Brasil). */
export function createMutualTlsAgentFromPfx(pfxPath: string, password: string): https.Agent {
  if (!fs.existsSync(pfxPath)) {
    throw Object.assign(new Error(`ENOENT: ${pfxPath}`), { code: 'ENOENT' });
  }

  const pfx = fs.readFileSync(pfxPath);
  try {
    const secureContext = tls.createSecureContext({ pfx, passphrase: password });
    return new https.Agent({
      secureContext,
      rejectUnauthorized: true,
      minVersion: 'TLSv1.2',
    });
  } catch (nativeErr) {
    const nativeMsg = nativeErr instanceof Error ? nativeErr.message : String(nativeErr);
    const lower = nativeMsg.toLowerCase();
    const forgeFallback =
      lower.includes('unsupported pkcs12') ||
      lower.includes('pkcs12') ||
      lower.includes('mac verify') ||
      lower.includes('bad decrypt') ||
      lower.includes('not enough data');

    if (!forgeFallback) {
      throw new Error(formatPfxLoadError(nativeErr, pfxPath));
    }

    try {
      const { certificatePem, privateKeyPem } = loadPfxMaterial(pfxPath, password);
      return createMutualTlsAgentFromPem(certificatePem, privateKeyPem);
    } catch (forgeErr) {
      throw new Error(formatPfxLoadError(forgeErr, pfxPath));
    }
  }
}

/**
 * Carrega certificado A1 a partir do buffer PKCS#12 e devolve chave + cert em PEM.
 */
export function loadPfxMaterialFromBuffer(pfxBuffer: Buffer, password: string): PfxMaterial {
  const raw = pfxBuffer.toString('binary');
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
    const bags = Object.values(keyBags).flat();
    for (const b of bags as Array<{ key?: forge.pki.PrivateKey }>) {
      if (b?.key) {
        privateKey = b.key;
        break;
      }
    }
  }

  const certBagEntries = certBags[forge.pki.oids.certBag] ?? [];
  const certChain: forge.pki.Certificate[] = [];
  for (const entry of certBagEntries) {
    if (entry && 'cert' in entry && entry.cert) {
      certChain.push(entry.cert as forge.pki.Certificate);
    }
  }

  const cert = certChain[0];
  if (!cert) {
    throw new Error('PFX não contém certificado público esperado.');
  }
  if (!privateKey) {
    throw new Error('PFX não contém chave privada PKCS#8 / keyBag esperada.');
  }

  const privateKeyPem = forge.pki.privateKeyToPem(privateKey);
  const certificatePem = certChain.map((c) => forge.pki.certificateToPem(c)).join('');
  return { privateKeyPem, certificatePem };
}

/**
 * Carrega certificado A1 (.pfx/.p12) e devolve chave + certificado em PEM.
 */
export function loadPfxMaterial(pfxPath: string, password: string): PfxMaterial {
  try {
    if (!fs.existsSync(pfxPath)) {
      throw Object.assign(new Error(`ENOENT: ${pfxPath}`), { code: 'ENOENT' });
    }
    const buf = fs.readFileSync(pfxPath);
    return loadPfxMaterialFromBuffer(buf, password);
  } catch (e) {
    throw new Error(formatPfxLoadError(e, pfxPath));
  }
}
