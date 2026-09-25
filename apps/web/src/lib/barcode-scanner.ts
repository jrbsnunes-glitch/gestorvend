/**
 * Leitura contínua de código de barras no coletor de inventário.
 * - Chrome/Android: BarcodeDetector (nativo)
 * - Safari/iPhone: @zxing/browser (import dinâmico)
 */

export type BarcodeScanEngine = 'native' | 'zxing';

const NATIVE_FORMATS = ['ean_13', 'ean_8', 'code_128', 'upc_a', 'upc_e', 'qr_code'] as const;

const SCAN_INTERVAL_MS = 280;

type BarcodeDetectorLike = {
  detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue?: string }>>;
};

export function hasNativeBarcodeDetector(): boolean {
  return typeof window !== 'undefined' && 'BarcodeDetector' in window;
}

export function canUseInventoryCamera(): boolean {
  return typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
}

/** Abre câmera traseira quando possível (iOS/Android). */
export async function openInventoryCamera(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('NO_GET_USER_MEDIA');
  }
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false,
    });
  } catch {
    try {
      return await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      });
    } catch {
      return await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    }
  }
}

export function stopMediaStream(stream: MediaStream | null | undefined): void {
  stream?.getTracks().forEach((t) => t.stop());
}

export type InventoryBarcodeSession = {
  engine: BarcodeScanEngine;
  stop: () => void;
};

/**
 * Inicia decode contínuo a partir de um <video> já com srcObject/stream.
 * `isPaused` — ex.: enquanto o modal de quantidade está aberto.
 */
export async function startInventoryBarcodeScan(
  video: HTMLVideoElement,
  onCode: (raw: string) => void,
  isPaused: () => boolean,
): Promise<InventoryBarcodeSession> {
  if (hasNativeBarcodeDetector()) {
    return startNativeScan(video, onCode, isPaused);
  }
  return startZxingScan(video, onCode, isPaused);
}

function startNativeScan(
  video: HTMLVideoElement,
  onCode: (raw: string) => void,
  isPaused: () => boolean,
): InventoryBarcodeSession {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Detector = (window as any).BarcodeDetector as new (opts: {
    formats: string[];
  }) => BarcodeDetectorLike;
  let detector: BarcodeDetectorLike;
  try {
    detector = new Detector({ formats: [...NATIVE_FORMATS] });
  } catch {
    throw new Error('BARCODE_DETECTOR_INIT');
  }

  let cancelled = false;
  let detecting = false;

  const tick = async () => {
    if (cancelled) return;
    if (!isPaused() && video.readyState >= 2 && !detecting) {
      detecting = true;
      try {
        const codes = await detector.detect(video);
        const raw = codes[0]?.rawValue?.trim();
        if (raw) onCode(raw);
      } catch {
        /* frame skip */
      } finally {
        detecting = false;
      }
    }
    if (!cancelled) {
      window.setTimeout(() => requestAnimationFrame(() => void tick()), SCAN_INTERVAL_MS);
    }
  };
  void tick();

  return {
    engine: 'native',
    stop: () => {
      cancelled = true;
    },
  };
}

async function startZxingScan(
  video: HTMLVideoElement,
  onCode: (raw: string) => void,
  isPaused: () => boolean,
): Promise<InventoryBarcodeSession> {
  const [{ BrowserMultiFormatReader }, { BarcodeFormat }] = await Promise.all([
    import('@zxing/browser'),
    import('@zxing/library'),
  ]);

  const reader = new BrowserMultiFormatReader();
  reader.possibleFormats = [
    BarcodeFormat.EAN_13,
    BarcodeFormat.EAN_8,
    BarcodeFormat.CODE_128,
    BarcodeFormat.UPC_A,
    BarcodeFormat.UPC_E,
    BarcodeFormat.QR_CODE,
  ];

  let controls: { stop: () => void } | null = null;
  let cancelled = false;

  try {
    controls = await reader.decodeFromVideoElement(video, (result) => {
      if (cancelled || isPaused() || !result) return;
      const raw = result.getText()?.trim();
      if (raw) onCode(raw);
    });
  } catch {
    // Fallback: decode manual por frame (alguns iOS com stream já anexado)
    let detecting = false;
    const tick = async () => {
      if (cancelled) return;
      if (!isPaused() && video.readyState >= 2 && !detecting) {
        detecting = true;
        try {
          const result = reader.decode(video);
          const raw = result.getText()?.trim();
          if (raw) onCode(raw);
        } catch {
          /* sem código no frame */
        } finally {
          detecting = false;
        }
      }
      if (!cancelled) {
        window.setTimeout(() => requestAnimationFrame(() => void tick()), SCAN_INTERVAL_MS);
      }
    };
    void tick();
    return {
      engine: 'zxing',
      stop: () => {
        cancelled = true;
      },
    };
  }

  return {
    engine: 'zxing',
    stop: () => {
      cancelled = true;
      controls?.stop();
    },
  };
}
