/**
 * Bitmap BGRA → ESC/POS raster (GS v 0).
 * 576 dots = largura útil típica da bobina 80 mm @ 203 dpi.
 */

export const ESCPOS_DOTS_80MM = 576;

function luminance(bgra: Buffer, offset: number): number {
  return 0.114 * bgra[offset] + 0.587 * bgra[offset + 1] + 0.299 * bgra[offset + 2];
}

function isDark(bgra: Buffer, offset: number): boolean {
  return luminance(bgra, offset) < 200;
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

/** Corta branco nas bordas — o residual vira “segunda página” na térmica. */
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
  const colHas = (x: number): boolean => {
    for (let y = 0; y < height; y++) {
      if (isDark(bgra, (y * width + x) * 4)) return true;
    }
    return false;
  };

  let top = 0;
  let bottom = height - 1;
  let left = 0;
  let right = width - 1;
  while (top < height && !rowHas(top)) top += 1;
  while (bottom > top && !rowHas(bottom)) bottom -= 1;
  while (left < width && !colHas(left)) left += 1;
  while (right > left && !colHas(right)) right -= 1;

  top = Math.max(0, top - pad);
  left = Math.max(0, left - pad);
  bottom = Math.min(height - 1, bottom + pad);
  right = Math.min(width - 1, right + pad);

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

export function scaleBgraNearest(
  bgra: Buffer,
  srcW: number,
  srcH: number,
  destW: number,
): { bgra: Buffer; width: number; height: number } {
  const width = Math.max(8, destW - (destW % 8));
  const height = Math.max(8, Math.round((srcH * width) / srcW));
  const out = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    const sy = Math.min(srcH - 1, Math.floor((y * srcH) / height));
    for (let x = 0; x < width; x++) {
      const sx = Math.min(srcW - 1, Math.floor((x * srcW) / width));
      const si = (sy * srcW + sx) * 4;
      const di = (y * width + x) * 4;
      out[di] = bgra[si];
      out[di + 1] = bgra[si + 1];
      out[di + 2] = bgra[si + 2];
      out[di + 3] = bgra[si + 3];
    }
  }
  return { bgra: out, width, height };
}

export function bgraToEscPosRaster(bgra: Buffer, width: number, height: number): Buffer {
  const widthBytes = Math.ceil(width / 8);
  const chunks: Buffer[] = [
    Buffer.from([0x1b, 0x40]), // ESC @
    Buffer.from([0x1b, 0x53]), // ESC S — modo padrão (não “página”)
    Buffer.from([0x1b, 0x43, 0x00]), // ESC C 0 — bobina contínua
    Buffer.from([0x1b, 0x61, 0x00]), // esquerda
  ];

  // Um único GS v 0 evita a térmica tratar cada fatia como página nova.
  const maxRows = 2048;
  for (let y0 = 0; y0 < height; y0 += maxRows) {
    const rows = Math.min(maxRows, height - y0);
    const data = Buffer.alloc(widthBytes * rows, 0);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < width; x++) {
        if (isDark(bgra, ((y0 + y) * width + x) * 4)) {
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

  chunks.push(Buffer.from([0x1b, 0x4a, 0x30])); // ESC J — avança ~3 mm
  chunks.push(Buffer.from([0x1d, 0x56, 0x41, 0x10])); // corte parcial, pouco avanço extra
  return Buffer.concat(chunks);
}
