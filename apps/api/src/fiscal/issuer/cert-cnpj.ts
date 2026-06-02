import { loadPfxMaterial } from './load-pfx';

/** OID ICP-Brasil: CNPJ do titular (e-CNPJ). */
const CNPJ_OID = '2.16.76.1.3.3';

function oidHexMarker(oid: string): Buffer {
  const parts = oid.split('.').map(Number);
  const abBinary: number[] = [];
  let bun = 0;
  for (let i = 0; i < parts.length; i++) {
    if (i === 0) {
      bun = 40 * parts[i]!;
    } else if (i === 1) {
      bun += parts[i]!;
      abBinary.push(bun);
    } else {
      xBase128(abBinary, parts[i]!, true);
    }
  }
  const out = Buffer.alloc(2 + abBinary.length);
  out[0] = 0x06;
  out[1] = abBinary.length;
  for (let i = 0; i < abBinary.length; i++) {
    out[2 + i] = abBinary[i]!;
  }
  return out;
}

function xBase128(abIn: number[], qIn: number, flag: boolean): void {
  if (qIn > 127) {
    xBase128(abIn, Math.floor(qIn / 128), false);
  }
  const qIn2 = qIn % 128;
  abIn.push(flag ? qIn2 : 0x80 | qIn2);
}

function getLength(data: Buffer): number {
  let len = data[1]!;
  if (len > 127) {
    const bytes = len & 0x0f;
    len = 0;
    for (let i = 0; i < bytes; i++) {
      len = (len << 8) | data[2 + i]!;
    }
  }
  return len;
}

/** Extrai CNPJ (14 dígitos) do certificado ICP-Brasil em PEM. */
export function extractCnpjFromCertificatePem(certificatePem: string): string | null {
  const b64 = certificatePem
    .replace(/-----BEGIN CERTIFICATE-----/g, '')
    .replace(/-----END CERTIFICATE-----/g, '')
    .replace(/\s/g, '');
  const certder = Buffer.from(b64, 'base64');
  const marker = oidHexMarker(CNPJ_OID);
  const idx = certder.indexOf(marker);
  if (idx < 0) return null;

  const before = certder.subarray(Math.max(0, idx - 4), idx);
  let xcv = before.subarray(-2);
  if (before.length >= 4 && before[0] === 0x30) {
    xcv = before.subarray(-4);
  } else if (before.length >= 4 && before[1] === 0x30) {
    xcv = before.subarray(-3);
  }

  const data = Buffer.concat([xcv, certder.subarray(idx)]);
  const bytes = marker.length;
  const len = getLength(data);
  const oidData = data.subarray(2 + bytes, 2 + bytes + len - bytes);
  const head = oidData.length - xcv.length - 2;
  const raw = oidData.subarray(Math.max(0, oidData.length - head)).toString('binary');
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 14) return null;
  return digits.slice(-14);
}

/** CNPJ do titular a partir do .pfx (OID 2.16.76.1.3.3). */
export function extractCnpjFromPfx(pfxPath: string, password: string): string | null {
  try {
    const { certificatePem } = loadPfxMaterial(pfxPath, password);
    return extractCnpjFromCertificatePem(certificatePem);
  } catch {
    return null;
  }
}
