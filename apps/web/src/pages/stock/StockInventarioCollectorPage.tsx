/**
 * Coletor mobile de inventário: bip (câmera / leitor / teclado) → quantidade → próximo.
 * Reutiliza POST /stock-inventories/:id/items com barcode/sku e onDuplicate.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import './inventory-collector.css';

type InventoryItem = {
  id: string;
  systemQty: string;
  countedQty: string | null;
  variant: {
    id: string;
    sku: string;
    barcode: string | null;
    product: { id: string; name: string; controlNumber?: number };
  };
};

type InventoryDetail = {
  id: string;
  controlNumber: number;
  status: 'DRAFT' | 'POSTED' | 'CANCELLED';
  location: { id: string; code: string; name: string };
  items: InventoryItem[];
};

type PendingProduct = {
  code: string;
  name: string;
  sku: string;
  barcode: string | null;
  variantId: string;
  currentCounted: string;
  systemQty: string;
};

type BarcodeDetectorLike = {
  detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue?: string }>>;
};

function playBeep(ok: boolean) {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = ok ? 880 : 220;
    gain.gain.value = 0.08;
    osc.start();
    osc.stop(ctx.currentTime + (ok ? 0.08 : 0.2));
    window.setTimeout(() => void ctx.close(), 300);
  } catch {
    /* ignore */
  }
}

function hasBarcodeDetector(): boolean {
  return typeof window !== 'undefined' && 'BarcodeDetector' in window;
}

export function StockInventarioCollectorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const scanRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectingRef = useRef(false);
  const lastScanRef = useRef<{ code: string; at: number }>({ code: '', at: 0 });

  const [scanValue, setScanValue] = useState('');
  const [mode, setMode] = useState<'increment' | 'qty'>('increment');
  const [err, setErr] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingProduct | null>(null);
  const [qtyInput, setQtyInput] = useState('1');
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraHint, setCameraHint] = useState<string | null>(null);

  const detail = useQuery({
    queryKey: ['stock-inventories', id],
    queryFn: () => api<InventoryDetail>(`/stock-inventories/${id}`),
    enabled: Boolean(id),
    refetchInterval: 15_000,
  });

  const inv = detail.data;

  const focusScan = useCallback(() => {
    window.setTimeout(() => scanRef.current?.focus(), 50);
  }, []);

  useEffect(() => {
    focusScan();
  }, [focusScan, pending, mode]);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  const scanMut = useMutation({
    mutationFn: (args: {
      code?: string;
      variantId?: string;
      onDuplicate: 'increment' | 'set';
      countedQty?: string;
    }) => {
      const json: Record<string, unknown> = {
        onDuplicate: args.onDuplicate,
      };
      if (args.countedQty !== undefined) json.countedQty = args.countedQty;
      if (args.variantId) {
        json.variantId = args.variantId;
      } else {
        const code = (args.code ?? '').trim();
        // Cascata no backend: barcode → sku → controlNumber
        json.barcode = code;
        json.sku = code;
        if (/^\d{1,8}$/.test(code)) json.controlNumber = code;
      }
      return api<InventoryDetail>(`/stock-inventories/${id}/items`, {
        method: 'POST',
        json,
      });
    },
    onSuccess: (row, vars) => {
      setErr(null);
      qc.setQueryData(['stock-inventories', id], row);
      playBeep(true);
      const code = (vars.code ?? '').trim();
      const item = row.items.find(
        (it) =>
          (vars.variantId && it.variant.id === vars.variantId) ||
          it.variant.barcode === code ||
          it.variant.sku.toLowerCase() === code.toLowerCase() ||
          String(it.variant.product.controlNumber) === code,
      );
      const label = item?.variant.product.name ?? (code || 'OK');
      const qty = item?.countedQty ?? vars.countedQty ?? '?';
      setFlash(`${label} → ${qty}`);
      window.setTimeout(() => setFlash(null), 1800);
      setScanValue('');
      setPending(null);
      focusScan();
    },
    onError: (e: Error) => {
      playBeep(false);
      setErr(e.message);
      focusScan();
    },
  });

  /** Resolve produto sem gravar (modo quantidade): busca via scan com set qty atual. */
  const resolveForQty = useMutation({
    mutationFn: async (code: string) => {
      // Usa search da API de produtos
      const rows = await api<
        Array<{
          variantId: string;
          sku: string;
          barcode: string | null;
          productName: string;
          productControlNumber?: number;
        }>
      >(`/products/search?q=${encodeURIComponent(code)}`);
      if (!rows.length) throw new Error(`Produto não encontrado: ${code}`);
      const row = rows[0]!;
      const current = inv?.items.find((it) => it.variant.id === row.variantId);
      return {
        code,
        name: row.productName,
        sku: row.sku,
        barcode: row.barcode,
        variantId: row.variantId,
        currentCounted: current?.countedQty ?? '',
        systemQty: current?.systemQty ?? '0',
      } satisfies PendingProduct;
    },
    onSuccess: (p) => {
      setErr(null);
      setPending(p);
      setQtyInput(p.currentCounted !== '' ? p.currentCounted : '1');
      playBeep(true);
      setScanValue('');
    },
    onError: (e: Error) => {
      playBeep(false);
      setErr(e.message);
      focusScan();
    },
  });

  function submitCode(raw: string) {
    const code = raw.trim();
    if (!code || !id) return;
    const now = Date.now();
    if (lastScanRef.current.code === code && now - lastScanRef.current.at < 900) {
      setScanValue('');
      return;
    }
    lastScanRef.current = { code, at: now };

    if (inv?.status !== 'DRAFT') {
      setErr('Inventário não está em rascunho.');
      return;
    }

    if (mode === 'increment') {
      scanMut.mutate({ code, onDuplicate: 'increment', countedQty: '1' });
    } else {
      resolveForQty.mutate(code);
    }
  }

  function confirmQty() {
    if (!pending) return;
    const n = Number(qtyInput.replace(',', '.'));
    if (!Number.isFinite(n) || n < 0) {
      setErr('Quantidade inválida.');
      return;
    }
    scanMut.mutate({
      variantId: pending.variantId,
      code: pending.code,
      onDuplicate: 'set',
      countedQty: String(n),
    });
  }

  async function toggleCamera() {
    if (cameraOn) {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setCameraOn(false);
      setCameraHint(null);
      focusScan();
      return;
    }
    if (!hasBarcodeDetector()) {
      setCameraHint(
        'Câmera com leitura automática disponível no Chrome/Android. Use o campo de código ou um leitor Bluetooth.',
      );
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      streamRef.current = stream;
      setCameraOn(true);
      setCameraHint(null);
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play();
      }
    } catch {
      setCameraHint('Não foi possível acessar a câmera. Verifique a permissão.');
      setCameraOn(false);
    }
  }

  useEffect(() => {
    if (!cameraOn || !hasBarcodeDetector()) return;
    let cancelled = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Detector = (window as any).BarcodeDetector as new (opts: {
      formats: string[];
    }) => BarcodeDetectorLike;
    let detector: BarcodeDetectorLike;
    try {
      detector = new Detector({
        formats: ['ean_13', 'ean_8', 'code_128', 'upc_a', 'upc_e', 'qr_code'],
      });
    } catch {
      setCameraHint('BarcodeDetector indisponível neste navegador.');
      return;
    }

    const tick = async () => {
      if (cancelled || detectingRef.current) {
        if (!cancelled) requestAnimationFrame(() => void tick());
        return;
      }
      const video = videoRef.current;
      if (video && video.readyState >= 2) {
        detectingRef.current = true;
        try {
          const codes = await detector.detect(video);
          const raw = codes[0]?.rawValue?.trim();
          if (raw) submitCode(raw);
        } catch {
          /* frame skip */
        } finally {
          detectingRef.current = false;
        }
      }
      if (!cancelled) {
        window.setTimeout(() => requestAnimationFrame(() => void tick()), 280);
      }
    };
    void tick();
    return () => {
      cancelled = true;
    };
    // submitCode is stable enough via closure; avoid re-binding camera loop each render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraOn, mode, id, inv?.status]);

  const recent = (inv?.items ?? [])
    .slice()
    .reverse()
    .filter((it) => it.countedQty != null)
    .slice(0, 12);

  if (!id) {
    return <p className="alert alert-error">Inventário inválido.</p>;
  }

  return (
    <div className="inv-collector">
      <header className="inv-collector__head">
        <Link to="/estoque/inventario" className="inv-collector__back">
          ← Voltar
        </Link>
        <div>
          <h2 className="inv-collector__title">
            Coletor #{inv?.controlNumber ?? '…'}
          </h2>
          <p className="inv-collector__sub">
            {inv
              ? `${inv.location.code} — ${inv.location.name}`
              : 'Carregando…'}
            {inv && inv.status !== 'DRAFT' ? ` · ${inv.status}` : ''}
          </p>
        </div>
        <button
          type="button"
          className="btn btn-secondary btn-compact"
          onClick={() => navigate(`/estoque/inventario`)}
        >
          Lista
        </button>
      </header>

      {flash && <div className="inv-collector__flash" role="status">{flash}</div>}
      {err && <div className="alert alert-error inv-collector__err">{err}</div>}
      {cameraHint && <div className="alert inv-collector__hint">{cameraHint}</div>}

      <div className="inv-collector__modes" role="group" aria-label="Modo de contagem">
        <button
          type="button"
          className={mode === 'increment' ? 'active' : ''}
          onClick={() => {
            setMode('increment');
            setPending(null);
            focusScan();
          }}
        >
          Somar +1 a cada bip
        </button>
        <button
          type="button"
          className={mode === 'qty' ? 'active' : ''}
          onClick={() => {
            setMode('qty');
            focusScan();
          }}
        >
          Informar quantidade
        </button>
      </div>

      <div className="inv-collector__scan" onClick={() => scanRef.current?.focus()}>
        <label htmlFor="inv-scan-input">Código / EAN / SKU</label>
        <input
          id="inv-scan-input"
          ref={scanRef}
          className="inv-collector__input"
          inputMode="text"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="Bipe ou digite e Enter"
          value={scanValue}
          disabled={inv?.status !== 'DRAFT' || scanMut.isPending || resolveForQty.isPending}
          onChange={(e) => setScanValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submitCode(scanValue);
            }
          }}
        />
        <div className="inv-collector__scan-actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={!scanValue.trim() || inv?.status !== 'DRAFT'}
            onClick={() => submitCode(scanValue)}
          >
            Confirmar código
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => void toggleCamera()}>
            {cameraOn ? 'Fechar câmera' : 'Câmera'}
          </button>
        </div>
      </div>

      {cameraOn && (
        <div className="inv-collector__camera">
          <video ref={videoRef} playsInline muted autoPlay />
        </div>
      )}

      {pending && mode === 'qty' && (
        <div className="inv-collector__pending">
          <strong>{pending.name}</strong>
          <span className="muted">
            SKU {pending.sku}
            {pending.barcode ? ` · EAN ${pending.barcode}` : ''}
            {pending.currentCounted !== '' ? ` · atual: ${pending.currentCounted}` : ''}
          </span>
          <label htmlFor="inv-qty">Quantidade contada</label>
          <input
            id="inv-qty"
            className="inv-collector__qty"
            inputMode="decimal"
            value={qtyInput}
            autoFocus
            onChange={(e) => setQtyInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                confirmQty();
              }
            }}
          />
          <div className="inv-collector__scan-actions">
            <button type="button" className="btn btn-primary" onClick={confirmQty}>
              Salvar quantidade
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setPending(null);
                focusScan();
              }}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      <section className="inv-collector__recent">
        <h3>
          Contados ({inv?.items.filter((i) => i.countedQty != null).length ?? 0}/
          {inv?.items.length ?? 0})
        </h3>
        <ul>
          {recent.length === 0 && <li className="muted">Nenhuma contagem ainda.</li>}
          {recent.map((it) => (
            <li key={it.id}>
              <span className="inv-collector__name">{it.variant.product.name}</span>
              <span className="inv-collector__qty-badge">{it.countedQty}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
