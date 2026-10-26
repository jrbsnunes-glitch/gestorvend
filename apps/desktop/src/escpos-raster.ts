/**
 * Converte um bitmap BGRA (Electron NativeImage.toBitmap) em ESC/POS raster.
 * A térmica 80 mm mais comum aceita 512 dots de largura (GS v 0).
 */

export const ESCPOS_DOTS_80MM = 512;

export function darkPixelRatio(bgra: Buffer, width: number, height: number): number {
  const n = width * height;
  if (n <= 0) return 0;
  let dark = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const lum = 0.114 * bgra[o] + 0.587 * bgra[o + 1] + 0.299 * bgra[o + 2];
    if (lum < 200) dark += 1;
  }
  return dark / n;
}

export function bgraToEscPosRaster(
  bgra: Buffer,
  width: number,
  height: number,
): Buffer {
  const widthBytes = Math.ceil(width / 8);
  const chunks: Buffer[] = [
    Buffer.from([0x1b, 0x40]), // ESC @
    Buffer.from([0x1b, 0x61, 0x00]), // alinhado à esquerda
  ];

  const maxRows = 200;
  for (let y0 = 0; y0 < height; y0 += maxRows) {
    const rows = Math.min(maxRows, height - y0);
    const data = Buffer.alloc(widthBytes * rows, 0);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < width; x++) {
        const i = ((y0 + y) * width + x) * 4;
        const lum = 0.114 * bgra[i] + 0.587 * bgra[i + 1] + 0.299 * bgra[i + 2];
        if (lum < 200) {
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

  chunks.push(Buffer.from([0x1b, 0x64, 0x06])); // avança 6 linhas
  chunks.push(Buffer.from([0x1d, 0x56, 0x42, 0x00])); // corte parcial
  return Buffer.concat(chunks);
}
