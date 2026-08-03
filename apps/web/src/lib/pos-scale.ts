/**
 * Camada única de captura de peso no PDV / self-service.
 * Modos: MANUAL | SERIAL_DIRECT (Web Serial) | AGENT (localhost) | BARCODE_LABEL.
 */

export type ScaleMode = 'MANUAL' | 'SERIAL_DIRECT' | 'AGENT' | 'BARCODE_LABEL';
export type ScaleStatus = 'idle' | 'connecting' | 'online' | 'unstable' | 'offline' | 'unsupported';

export type ScaleReading = {
  weightKg: number | null;
  stable: boolean;
  tareKg: number;
  status: ScaleStatus;
  mode: ScaleMode;
  lastError?: string | null;
};

const STATION_KEY = 'gv-scale-station';

export type ScaleStationConfig = {
  agentUrl?: string;
  baudRate?: number;
};

export function readScaleStationConfig(): ScaleStationConfig {
  try {
    const raw = localStorage.getItem(STATION_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as ScaleStationConfig;
  } catch {
    return {};
  }
}

export function writeScaleStationConfig(cfg: ScaleStationConfig): void {
  try {
    localStorage.setItem(STATION_KEY, JSON.stringify(cfg));
  } catch {
    /* ignore */
  }
}

/** Parser genérico: extrai o primeiro número decimal de um frame serial. */
export function parseScaleFrame(raw: string): { weightKg: number; stable: boolean } | null {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  const unstable = /[US?]|^S\s/i.test(text) && !/\bST\b|\bstable\b/i.test(text);
  const m = text.replace(',', '.').match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  if (!Number.isFinite(n)) return null;
  // Heurística: valores > 100 provavelmente estão em gramas.
  const weightKg = n > 100 ? n / 1000 : n;
  return { weightKg: Math.round(weightKg * 1000) / 1000, stable: !unstable };
}

/**
 * EAN-13 com peso (prefixo 2): padrão configurável.
 * Default `2PPPPPWWWWWC` → PLU 5 dígitos + peso 5 dígitos (ggggg → kg = /1000) + check.
 */
export function parseBarcodeWeight(
  code: string,
  pattern = '2PPPPPWWWWWC',
): { plu: string; weightKg: number } | null {
  const digits = String(code ?? '').replace(/\D/g, '');
  if (digits.length !== 13 || !digits.startsWith('2')) return null;
  const pat = (pattern || '2PPPPPWWWWWC').toUpperCase();
  if (pat.length !== 13) return null;
  let plu = '';
  let weightRaw = '';
  for (let i = 0; i < 13; i++) {
    const c = pat[i]!;
    const d = digits[i]!;
    if (c === 'P') plu += d;
    else if (c === 'W') weightRaw += d;
  }
  if (!plu || !weightRaw) return null;
  const weightKg = Math.round((Number(weightRaw) / 1000) * 1000) / 1000;
  if (!Number.isFinite(weightKg) || weightKg <= 0) return null;
  return { plu, weightKg };
}

type SerialPortLike = {
  open: (opts: { baudRate: number }) => Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
  close: () => Promise<void>;
};

declare global {
  interface Navigator {
    serial?: {
      requestPort: () => Promise<SerialPortLike>;
      getPorts: () => Promise<SerialPortLike[]>;
    };
  }
}

export type UsePosScaleOptions = {
  mode: ScaleMode;
  autoConfirmMs?: number;
  agentUrl?: string;
  baudRate?: number;
  enabled?: boolean;
};

export type UsePosScaleResult = ScaleReading & {
  connectSerial: () => Promise<void>;
  disconnect: () => Promise<void>;
  request: () => Promise<number | null>;
  setManualWeight: (kg: number | null) => void;
};

/**
 * Hook leve (sem React import no tipo exportado — implementação em use-pos-scale.ts com React).
 * Preferir `usePosScale` do arquivo com hooks.
 */
export function createScaleController(opts: UsePosScaleOptions) {
  let status: ScaleStatus = opts.mode === 'MANUAL' ? 'idle' : 'offline';
  let weightKg: number | null = null;
  let stable = false;
  let tareKg = 0;
  let lastError: string | null = null;
  let port: SerialPortLike | null = null;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let closed = false;
  let buffer = '';
  const listeners = new Set<() => void>();

  function emit() {
    for (const l of listeners) l();
  }

  function snapshot(): ScaleReading {
    return { weightKg, stable, tareKg, status, mode: opts.mode, lastError };
  }

  async function disconnect() {
    closed = true;
    try {
      await reader?.cancel();
    } catch {
      /* ignore */
    }
    reader = null;
    try {
      await port?.close();
    } catch {
      /* ignore */
    }
    port = null;
    status = opts.mode === 'MANUAL' ? 'idle' : 'offline';
    emit();
  }

  async function connectSerial() {
    if (!navigator.serial) {
      status = 'unsupported';
      lastError = 'Web Serial não disponível neste navegador (use Chrome/Edge no desktop).';
      emit();
      return;
    }
    status = 'connecting';
    lastError = null;
    emit();
    try {
      port = await navigator.serial.requestPort();
      await port.open({ baudRate: opts.baudRate ?? 9600 });
      closed = false;
      status = 'online';
      emit();
      const textDecoder = new TextDecoderStream();
      const readable = port.readable?.pipeThrough(textDecoder);
      if (!readable) throw new Error('Porta sem stream legível.');
      reader = readable.getReader() as unknown as ReadableStreamDefaultReader<Uint8Array>;
      // Leitura contínua via TextDecoder — rebind tipado frouxo
      const r = (readable as ReadableStream<string>).getReader();
      (async () => {
        try {
          while (!closed) {
            const { value, done } = await r.read();
            if (done) break;
            buffer += value ?? '';
            const parts = buffer.split(/[\r\n]+/);
            buffer = parts.pop() ?? '';
            for (const line of parts) {
              const parsed = parseScaleFrame(line);
              if (!parsed) continue;
              weightKg = parsed.weightKg;
              stable = parsed.stable;
              status = parsed.stable ? 'online' : 'unstable';
              emit();
            }
          }
        } catch (e) {
          lastError = e instanceof Error ? e.message : 'Erro na leitura serial';
          status = 'offline';
          emit();
        }
      })();
    } catch (e) {
      lastError = e instanceof Error ? e.message : 'Falha ao conectar balança';
      status = 'offline';
      emit();
    }
  }

  async function pollAgent(): Promise<number | null> {
    const url = (opts.agentUrl || readScaleStationConfig().agentUrl || 'http://127.0.0.1:17890/weight').trim();
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Agente HTTP ${res.status}`);
      const data = (await res.json()) as { weightKg?: number; stable?: boolean; tare?: number };
      weightKg = typeof data.weightKg === 'number' ? data.weightKg : null;
      stable = Boolean(data.stable ?? true);
      if (typeof data.tare === 'number') tareKg = data.tare;
      status = weightKg == null ? 'offline' : stable ? 'online' : 'unstable';
      lastError = null;
      emit();
      return weightKg;
    } catch (e) {
      lastError = e instanceof Error ? e.message : 'Agente indisponível';
      status = 'offline';
      emit();
      return null;
    }
  }

  async function request(): Promise<number | null> {
    if (opts.mode === 'AGENT') return pollAgent();
    if (opts.mode === 'SERIAL_DIRECT') return weightKg;
    return weightKg;
  }

  function setManualWeight(kg: number | null) {
    weightKg = kg;
    stable = kg != null && kg > 0;
    status = 'idle';
    emit();
  }

  function subscribe(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  return {
    snapshot,
    subscribe,
    connectSerial,
    disconnect,
    request,
    setManualWeight,
    pollAgent,
  };
}
