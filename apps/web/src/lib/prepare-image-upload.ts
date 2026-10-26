/** Limite aceito pela API (logo / foto de produto). */
export const IMAGE_UPLOAD_MAX_BYTES = 2 * 1024 * 1024;
/**
 * Corpo seguro para o Nginx com `client_max_body_size` padrão (1m).
 * Multipart soma cabeçalhos — ficar abaixo de 900 KB evita 413 até o deploy.
 */
const IMAGE_UPLOAD_SAFE_BYTES = 900 * 1024;
const IMAGE_UPLOAD_MAX_EDGE = 1280;

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']);

function isSupportedImage(file: File): boolean {
  if (IMAGE_TYPES.has(file.type.toLowerCase())) return true;
  return /\.(png|jpe?g|webp)$/i.test(file.name);
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Não foi possível gerar a imagem.'))),
      type,
      quality,
    );
  });
}

async function drawToCanvas(
  file: File,
  maxEdge: number,
): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Não foi possível processar a imagem neste computador.');

  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
      canvas.width = Math.max(1, Math.round(bmp.width * scale));
      canvas.height = Math.max(1, Math.round(bmp.height * scale));
      ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
      bmp.close();
      return canvas;
    } catch {
      /* fallback Image */
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Não foi possível ler a imagem.'));
      el.src = url;
    });
    const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function compressImage(file: File): Promise<File> {
  let edge = IMAGE_UPLOAD_MAX_EDGE;
  let last: Blob | null = null;

  for (const quality of [0.88, 0.76, 0.64]) {
    const canvas = await drawToCanvas(file, edge);
    last = await canvasToBlob(canvas, 'image/jpeg', quality);
    if (last.size <= IMAGE_UPLOAD_SAFE_BYTES) break;
    edge = Math.round(edge * 0.75);
  }

  if (!last) throw new Error('Não foi possível reduzir a imagem.');
  if (last.size > IMAGE_UPLOAD_MAX_BYTES) {
    throw new Error(
      'A imagem ficou acima de 2 MB mesmo após reduzir. Escolha um arquivo menor.',
    );
  }

  const base = file.name.replace(/\.[^.]+$/, '') || 'logo';
  return new File([last], `${base}.jpg`, { type: 'image/jpeg' });
}

/**
 * Valida e, se necessário, reduz PNG/JPEG/WebP para caber no upload
 * (API 2 MB e proxy Nginx).
 */
export async function prepareImageUpload(file: File): Promise<File> {
  if (!isSupportedImage(file)) {
    throw new Error('Use um arquivo PNG, JPEG ou WebP.');
  }
  if (file.size <= IMAGE_UPLOAD_SAFE_BYTES) return file;
  return compressImage(file);
}
