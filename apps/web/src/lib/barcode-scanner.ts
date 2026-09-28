/**
 * Leitura contínua de código de barras no coletor de inventário.
 * - Chrome/Android: BarcodeDetector nativo quando confiável
 * - iPhone (Safari, Chrome/CriOS, etc. — todos WebKit): ZXing + getUserMedia no toque do botão
 * - Fallback: frames do <video> decodificados via canvas
 *
 * iOS: HTTPS, permissão de câmera no app do navegador; getUserMedia fora do gesto do usuário falha.
 */

import { BrowserMultiFormatReader } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType, NotFoundException } from '@zxing/library';

export type BarcodeScanEngine = 'native' | 'zxing';

const NATIVE_FORMATS = ['ean_13', 'ean_8', 'code_128', 'upc_a', 'upc_e', 'qr_code'] as const;

const SCAN_INTERVAL_MS = 220;

type BarcodeDetectorLike = {
  detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue?: string }>>;
};

export function isSecureCameraContext(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext;
}

export function isLikelyIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/i.test(ua)) return true;
  if (/CriOS|FxiOS|EdgiOS/i.test(ua)) return true;
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}

/** Onde o usuário libera câmera no iOS (Chrome no iPhone usa WebKit, permissão no app Chrome). */
export function iosCameraPermissionHint(): string {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  if (/CriOS/i.test(ua)) return 'Ajustes → Chrome → Câmera → permitir para este site';
  if (/FxiOS/i.test(ua)) return 'Ajustes → Firefox → Câmera';
  if (/EdgiOS/i.test(ua)) return 'Ajustes → Edge → Câmera';
  return 'Ajustes → Safari → Câmera → permitir para este site';
}

export function hasNativeBarcodeDetector(): boolean {
  return typeof window !== 'undefined' && 'BarcodeDetector' in window;
}

/** Safari iOS expõe BarcodeDetector com feature flag, mas a detecção não funciona — usar ZXing. */
export function preferNativeInventoryBarcode(): boolean {
  return hasNativeBarcodeDetector() && !isLikelyIos();
}

export function canUseInventoryCamera(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    isSecureCameraContext()
  );
}

/** Mensagem quando a câmera não pode ser usada (ex.: HTTP em iPhone). */
export function inventoryCameraBlockedMessage(): string | null {
  if (!navigator.mediaDevices?.getUserMedia) {
    return 'Câmera indisponível neste navegador. Use o campo de código ou um leitor Bluetooth.';
  }
  if (!isSecureCameraContext()) {
    return isLikelyIos()
      ? 'No iPhone a câmera só funciona em HTTPS. Abra o GestorVend pelo endereço seguro (https://…) do servidor, não por IP http.'
      : 'A câmera exige conexão segura (HTTPS ou localhost).';
  }
  return null;
}

const VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  facingMode: { ideal: 'environment' },
  width: { ideal: 1280, min: 640 },
  height: { ideal: 720, min: 480 },
};

/** iOS rejeita `min` em resolução com frequência — constraints mais simples. */
const IOS_VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  facingMode: { ideal: 'environment' },
};

function applyIosVideoElementAttrs(video: HTMLVideoElement): void {
  video.muted = true;
  video.playsInline = true;
  video.setAttribute('playsinline', 'true');
  video.setAttribute('webkit-playsinline', 'true');
  video.autoplay = true;
}

async function bindStreamAndPlay(video: HTMLVideoElement, stream: MediaStream): Promise<void> {
  applyIosVideoElementAttrs(video);
  video.srcObject = stream;
  await new Promise<void>((resolve) => {
    if (video.readyState >= 1) {
      resolve();
      return;
    }
    video.addEventListener('loadedmetadata', () => resolve(), { once: true });
  });
  await video.play().catch(() => {
    /* Safari pode exigir gesto do usuário — o coletor pede toque na área do vídeo */
  });
}

async function waitForVideoFrames(video: HTMLVideoElement, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (video.videoWidth > 0 && video.videoHeight > 0 && video.readyState >= 2) {
      return;
    }
    await new Promise<void>((r) => window.setTimeout(r, 40));
  }
}

const CAMERA_OPEN_TIMEOUT_MS = 18_000;

function acquireInventoryCameraStream(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    return Promise.reject(new Error('NO_GET_USER_MEDIA'));
  }

  const attempts: MediaStreamConstraints[] = isLikelyIos()
    ? [
        { video: IOS_VIDEO_CONSTRAINTS, audio: false },
        { video: { facingMode: 'environment' }, audio: false },
        { video: true, audio: false },
      ]
    : [
        { video: VIDEO_CONSTRAINTS, audio: false },
        { video: { facingMode: 'environment' }, audio: false },
        { video: true, audio: false },
      ];

  const tryNext = async (index: number, lastErr: unknown): Promise<MediaStream> => {
    if (index >= attempts.length) {
      if (lastErr instanceof DOMException) throw lastErr;
      throw new Error('NO_CAMERA');
    }
    try {
      return await navigator.mediaDevices.getUserMedia(attempts[index]!);
    } catch (e) {
      return tryNext(index + 1, e);
    }
  };

  return tryNext(0, null);
}

/** Abre câmera traseira quando possível (iOS/Android). */
export async function openInventoryCamera(): Promise<MediaStream> {
  return openInventoryCameraWithTimeout();
}

export async function openInventoryCameraWithTimeout(
  timeoutMs = CAMERA_OPEN_TIMEOUT_MS,
): Promise<MediaStream> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<MediaStream>((_, reject) => {
    timer = window.setTimeout(() => {
      reject(new DOMException('Tempo esgotado aguardando a câmera.', 'TimeoutError'));
    }, timeoutMs);
  });
  try {
    return await Promise.race([acquireInventoryCameraStream(), timeout]);
  } finally {
    if (timer !== undefined) window.clearTimeout(timer);
  }
}

/**
 * Chame no pointerdown/touchstart do botão Câmera (mesmo turno do gesto no iOS).
 * O clique posterior usa a mesma Promise via startInventoryCameraSession({ streamPromise }).
 */
export function beginInventoryCameraFromUserGesture(): Promise<MediaStream> {
  return openInventoryCameraWithTimeout();
}

export function stopMediaStream(stream: MediaStream | null | undefined): void {
  stream?.getTracks().forEach((t) => t.stop());
}

export type InventoryBarcodeSession = {
  engine: BarcodeScanEngine;
  stream: MediaStream | null;
  stop: () => void;
};

/**
 * Abre a câmera (se necessário), liga ao <video> e inicia decode contínuo.
 * Preferir este método no coletor — no iPhone o ZXing abre a câmera via decodeFromConstraints.
 */
export type InventoryCameraSessionOptions = {
  /** Promise criada no pointerdown/touchstart — obrigatória no iOS para popup de permissão. */
  streamPromise?: Promise<MediaStream>;
};

export async function startInventoryCameraSession(
  video: HTMLVideoElement,
  onCode: (raw: string) => void,
  isPaused: () => boolean,
  opts?: InventoryCameraSessionOptions,
): Promise<InventoryBarcodeSession> {
  const resolveStream = () => opts?.streamPromise ?? openInventoryCameraWithTimeout();

  if (preferNativeInventoryBarcode()) {
    const stream = await resolveStream();
    await bindStreamAndPlay(video, stream);
    const scan = startNativeScan(video, onCode, isPaused);
    return {
      engine: scan.engine,
      stream,
      stop: () => {
        scan.stop();
        stopMediaStream(stream);
        video.srcObject = null;
      },
    };
  }
  return startZxingCameraSession(video, onCode, isPaused, opts);
}

export type InventoryBarcodeSessionLegacy = {
  engine: BarcodeScanEngine;
  stop: () => void;
};

/** @deprecated Use startInventoryCameraSession — decode com stream já aberto. */
export async function startInventoryBarcodeScan(
  video: HTMLVideoElement,
  onCode: (raw: string) => void,
  isPaused: () => boolean,
): Promise<InventoryBarcodeSessionLegacy> {
  if (preferNativeInventoryBarcode()) {
    return startNativeScan(video, onCode, isPaused);
  }
  const session = await startZxingCameraSession(video, onCode, isPaused);
  return { engine: session.engine, stop: session.stop };
}

function startNativeScan(
  video: HTMLVideoElement,
  onCode: (raw: string) => void,
  isPaused: () => boolean,
): InventoryBarcodeSessionLegacy {
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
    if (!isPaused() && video.readyState >= 2 && video.videoWidth > 0 && !detecting) {
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

type ZxingScanResult = { getText: () => string };

async function startZxingCameraSession(
  video: HTMLVideoElement,
  onCode: (raw: string) => void,
  isPaused: () => boolean,
  opts?: InventoryCameraSessionOptions,
): Promise<InventoryBarcodeSession> {
  const ios = isLikelyIos();
  const reader = new BrowserMultiFormatReader(undefined, {
    delayBetweenScanAttempts: ios ? 240 : 500,
    delayBetweenScanSuccess: ios ? 1400 : 500,
    tryPlayVideoTimeout: ios ? 12_000 : 5000,
  });
  reader.possibleFormats = [
    BarcodeFormat.EAN_13,
    BarcodeFormat.EAN_8,
    BarcodeFormat.CODE_128,
    BarcodeFormat.UPC_A,
    BarcodeFormat.UPC_E,
    BarcodeFormat.QR_CODE,
  ];
  reader.hints.set(DecodeHintType.TRY_HARDER, true);

  applyIosVideoElementAttrs(video);

  let cancelled = false;
  let controls: { stop: () => void } | null = null;
  let manualStop: (() => void) | null = null;

  const onResult = (result: ZxingScanResult | undefined, error: unknown) => {
    if (cancelled || isPaused()) return;
    if (result) {
      const raw = result.getText()?.trim();
      if (raw) onCode(raw);
      return;
    }
    if (error instanceof NotFoundException) return;
  };

  /** iOS (Chrome/Safari WebKit): decodeFromVideoElement trava ou falha — só loop canvas. */
  if (ios) {
    const stream = await (opts?.streamPromise ?? openInventoryCameraWithTimeout());
    await bindStreamAndPlay(video, stream);
    await waitForVideoFrames(video);
    manualStop = startZxingCanvasLoop(reader, video, onCode, isPaused).stop;
    return {
      engine: 'zxing',
      stream,
      stop: () => {
        cancelled = true;
        manualStop?.();
        stopMediaStream(stream);
        video.srcObject = null;
      },
    };
  }

  let stream: MediaStream | null = null;

  const startScanOnOpenStream = async (): Promise<void> => {
    if (!stream) {
      stream = await (opts?.streamPromise ?? openInventoryCameraWithTimeout());
      await bindStreamAndPlay(video, stream);
      await waitForVideoFrames(video);
    }
    controls = await reader.decodeFromVideoElement(video, onResult);
  };

  try {
    if (opts?.streamPromise) {
      await startScanOnOpenStream();
    } else {
      try {
        controls = await reader.decodeFromConstraints(
          { video: VIDEO_CONSTRAINTS, audio: false },
          video,
          onResult,
        );
        stream = (video.srcObject as MediaStream | null) ?? null;
      } catch {
        await startScanOnOpenStream();
      }
    }
  } catch {
    stream = await (opts?.streamPromise ?? openInventoryCameraWithTimeout());
    await bindStreamAndPlay(video, stream);
    await waitForVideoFrames(video);
    manualStop = startZxingCanvasLoop(reader, video, onCode, isPaused).stop;
    return {
      engine: 'zxing',
      stream,
      stop: () => {
        cancelled = true;
        manualStop?.();
        controls?.stop();
        stopMediaStream(stream);
        video.srcObject = null;
      },
    };
  }

  const boundStream = stream ?? (video.srcObject as MediaStream | null);

  return {
    engine: 'zxing',
    stream: boundStream,
    stop: () => {
      cancelled = true;
      controls?.stop();
      stopMediaStream(boundStream);
      video.srcObject = null;
    },
  };
}

/** Decodifica frames via canvas — funciona quando decodeFromVideoElement falha no iOS. */
function startZxingCanvasLoop(
  reader: BrowserMultiFormatReader,
  video: HTMLVideoElement,
  onCode: (raw: string) => void,
  isPaused: () => boolean,
): { stop: () => void } {
  let cancelled = false;
  let detecting = false;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  const tick = async () => {
    if (cancelled) return;
    if (
      !isPaused() &&
      ctx &&
      video.readyState >= 2 &&
      video.videoWidth > 0 &&
      video.videoHeight > 0 &&
      !detecting
    ) {
      detecting = true;
      try {
        const vw = video.videoWidth;
        const vh = video.videoHeight;
        const maxEdge = isLikelyIos() ? 720 : Math.max(vw, vh);
        const scale = Math.min(1, maxEdge / Math.max(vw, vh));
        const w = Math.max(1, Math.round(vw * scale));
        const h = Math.max(1, Math.round(vh * scale));
        if (canvas.width !== w) canvas.width = w;
        if (canvas.height !== h) canvas.height = h;
        ctx.drawImage(video, 0, 0, w, h);
        const result = reader.decodeFromCanvas(canvas);
        const raw = result.getText()?.trim();
        if (raw) onCode(raw);
      } catch {
        /* sem código legível neste frame */
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
    stop: () => {
      cancelled = true;
    },
  };
}
