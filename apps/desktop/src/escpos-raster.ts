/**
 * Bitmap BGRA → ESC/POS raster (GS v 0).
 * 80 mm @ 203 dpi ≈ 512 dots. 384 cabia tudo, mas o cupom saía miúdo.
 * O corte da direita era captura com zoom 2, não falta de pontos.
 */

export const ESCPOS_DOTS_80MM = 512;
/** ~1 mm de cada lado @ 203 dpi — usa a largura da bobina sem cortar a borda. */
export const ESCPOS_RASTER_SIDE_PAD = 8;

function luminance(bgra: Buffer, offset: number): number {
  return 0.114 * bgra[offset] + 0.587 * bgra[offset + 1] + 0.299 * bgra[offset + 2];
}

/** Mais baixo = traço mais grosso (cinza da antialias vira preto). */
const DARK_LUMA = 168;

function isDark(bgra: Buffer, offset: number): boolean {
  const b = bgra[offset];
  const g = bgra[offset + 1];
  const r = bgra[offset + 2];
  const luma = 0.114 * b + 0.587 * g + 0.299 * r;
  const sat = Math.max(r, g, b) - Math.min(r, g, b);
  // Ciano da logo: se só usar luma, o “C” some e sobra um quadrado preto.
  if (sat > 40 && luma < 190) return true;
  return luma < DARK_LUMA;
}

export function darkPixelRatio(bgra: Buffer, width: number, height: number): number {
  const n = width * height;
  if (n <= 0) return 0;
  let dark = 0;
  for (let i = 0; i < n; i++) {
    if (isDark(bgra, i * 4)) dark += 1;
  }
  return dark / n;
}

/** HiDPI: toBitmap() pode ter mais pixels do que getSize(). */
export function resolveBitmapSize(
  bgra: Buffer,
  dipW: number,
  dipH: number,
): { width: number; height: number } {
  const pixels = Math.floor(bgra.length / 4);
  if (dipW > 0 && dipH > 0 && pixels === dipW * dipH) {
    return { width: dipW, height: dipH };
  }
  if (dipH > 0 && pixels % dipH === 0) {
    const w = pixels / dipH;
    if (w >= 8) return { width: w, height: dipH };
  }
  if (dipW > 0 && pixels % dipW === 0) {
    const h = pixels / dipW;
    if (h >= 8) return { width: dipW, height: h };
  }
  return { width: Math.max(1, dipW), height: Math.max(1, dipH) };
}

/** Corta só o branco de cima/baixo. Nas laterais a margem da NFC-e precisa ficar. */
export function trimBgra(
  bgra: Buffer,
  width: number,
  height: number,
  pad = 4,
): { bgra: Buffer; width: number; height: number } {
  const rowHas = (y: number): boolean => {
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      if (isDark(bgra, row + x * 4)) return true;
    }
    return false;
  };

  let top = 0;
  let bottom = height - 1;
  const left = 0;
  const right = width - 1;
  while (top < height && !rowHas(top)) top += 1;
  while (bottom > top && !rowHas(bottom)) bottom -= 1;

  top = Math.max(0, top - pad);
  bottom = Math.min(height - 1, bottom + pad);

  const w = right - left + 1;
  const h = bottom - top + 1;
  if (w <= 0 || h <= 0 || (w === width && h === height && top === 0 && left === 0)) {
    return { bgra, width, height };
  }

  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    const src = ((top + y) * width + left) * 4;
    bgra.copy(out, y * w * 4, src, src + w * 4);
  }
  return { bgra: out, width: w, height: h };
}

/**
 * Redimensiona com bilinear. O vizinho-mais-próximo duplicava colunas
 * (Vendada, ITENSENS, TOTALL) e deixava a letra ilegível.
 */
export function scaleBgraBilinear(
  bgra: Buffer,
  srcW: number,
  srcH: number,
  destW: number,
): { bgra: Buffer; width: number; height: number } {
  const width = Math.max(8, destW - (destW % 8));
  if (srcW <= 0 || srcH <= 0) return { bgra, width: srcW, height: srcH };
  if (srcW === width) {
    return { bgra, width: srcW, height: srcH };
  }
  const height = Math.max(8, Math.round((srcH * width) / srcW));
  const out = Buffer.alloc(width * height * 4);
  const xRatio = srcW > 1 && width > 1 ? (srcW - 1) / (width - 1) : 0;
  const yRatio = srcH > 1 && height > 1 ? (srcH - 1) / (height - 1) : 0;
  for (let y = 0; y < height; y++) {
    const fy = y * yRatio;
    const y0 = Math.floor(fy);
    const y1 = Math.min(srcH - 1, y0 + 1);
    const wy = fy - y0;
    for (let x = 0; x < width; x++) {
      const fx = x * xRatio;
      const x0 = Math.floor(fx);
      const x1 = Math.min(srcW - 1, x0 + 1);
      const wx = fx - x0;
      const di = (y * width + x) * 4;
      for (let c = 0; c < 4; c++) {
        const p00 = bgra[(y0 * srcW + x0) * 4 + c];
        const p10 = bgra[(y0 * srcW + x1) * 4 + c];
        const p01 = bgra[(y1 * srcW + x0) * 4 + c];
        const p11 = bgra[(y1 * srcW + x1) * 4 + c];
        out[di + c] = Math.round(
          p00 * (1 - wx) * (1 - wy) + p10 * wx * (1 - wy) + p01 * (1 - wx) * wy + p11 * wx * wy,
        );
      }
    }
  }
  return { bgra: out, width, height };
}

/** Encaixa o bitmap em 512 dots com a mesma margem lateral da NFC-e (1,5 mm + 1,5 mm). */
export function fitBgraToEscPosWidth(
  bgra: Buffer,
  width: number,
  height: number,
  destW = ESCPOS_DOTS_80MM,
  sidePad = ESCPOS_RASTER_SIDE_PAD,
): { bgra: Buffer; width: number; height: number } {
  const outW = Math.max(8, destW - (destW % 8));
  const side = Math.max(0, Math.min(sidePad, Math.floor((outW - 8) / 2)));
  const contentW = Math.max(8, outW - side * 2);
  const scaled = scaleBgraBilinear(bgra, width, height, contentW);
  if (side === 0 && scaled.width === outW) return scaled;
  const out = Buffer.alloc(outW * scaled.height * 4, 255);
  const copyW = Math.min(scaled.width, outW - side);
  for (let y = 0; y < scaled.height; y++) {
    scaled.bgra.copy(
      out,
      (y * outW + side) * 4,
      y * scaled.width * 4,
      y * scaled.width * 4 + copyW * 4,
    );
  }
  return { bgra: out, width: outW, height: scaled.height };
}

/** Engrossa 1 px (vizinhos N/S/L/O) depois do limiar — letra mais visível na térmica. */
export function dilateMono(mono: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(mono);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (mono[i]) continue;
      if (
        (x > 0 && mono[i - 1]) ||
        (x + 1 < width && mono[i + 1]) ||
        (y > 0 && mono[i - width]) ||
        (y + 1 < height && mono[i + width])
      ) {
        out[i] = 1;
      }
    }
  }
  return out;
}

/** Limiar duro some com o “C” da logo; dither mantém o desenho e a letra nítida. */
function bgraToMono(bgra: Buffer, width: number, height: number): Uint8Array {
  const carry = new Float32Array(width * height);
  const mono = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const old = luminance(bgra, i * 4) + carry[i];
      const black = old < 152;
      mono[i] = black ? 1 : 0;
      const err = old - (black ? 0 : 255);
      if (x + 1 < width) carry[i + 1] += (err * 7) / 16;
      if (y + 1 < height) {
        if (x > 0) carry[i + width - 1] += (err * 3) / 16;
        carry[i + width] += (err * 5) / 16;
        if (x + 1 < width) carry[i + width + 1] += (err * 1) / 16;
      }
    }
  }
  return mono;
}

export function bgraToEscPosRaster(bgra: Buffer, width: number, height: number): Buffer {
  const mono = bgraToMono(bgra, width, height);
  const widthBytes = Math.ceil(width / 8);
  const chunks: Buffer[] = [
    Buffer.from([0x1b, 0x40]),
    Buffer.from([0x1b, 0x61, 0x00]),
  ];

  const maxRows = 2048;
  for (let y0 = 0; y0 < height; y0 += maxRows) {
    const rows = Math.min(maxRows, height - y0);
    const data = Buffer.alloc(widthBytes * rows, 0);
    for (let y = 0; y < rows; y++) {
      const row = (y0 + y) * width;
      for (let x = 0; x < width; x++) {
        if (mono[row + x]) {
          data[y * widthBytes + (x >> 3)] |= 0x80 >> (x & 7);
        }
      }
    }
    chunks.push(
      Buffer.from([
        0x1d,
        0x76,
        0x30,
        0x00,
        widthBytes & 0xff,
        (widthBytes >> 8) & 0xff,
        rows & 0xff,
        (rows >> 8) & 0xff,
      ]),
      data,
    );
  }

  chunks.push(Buffer.from([0x1b, 0x4a, 0x30]));
  chunks.push(Buffer.from([0x1d, 0x56, 0x41, 0x10]));
  return Buffer.concat(chunks);
}
