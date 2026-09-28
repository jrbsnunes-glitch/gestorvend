/**
 * Coletor mobile de inventário: bip → pede quantidade → grava → próximo.
 * Câmera: BarcodeDetector (Chrome/Android) ou ZXing decodeFromConstraints (Safari/iPhone). HTTPS obrigatório no iPhone.
 * POST /stock-inventories/:id/items com barcode/sku e onDuplicate.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  beginInventoryCameraFromUserGesture,
  inventoryCameraBlockedMessage,
  iosCameraPermissionHint,
  isLikelyIos,
  openInventoryCameraWithTimeout,
  startInventoryCameraSession,
  type BarcodeScanEngine,
  type InventoryBarcodeSession,
} from '../../lib/barcode-scanner';
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

function playBeep(ok: boolean) {
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
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

export function StockInventarioCollectorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const scanRef = useRef<HTMLInputElement>(null);
  const qtyRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanSessionRef = useRef<InventoryBarcodeSession | null>(null);
  const cameraStreamPromiseRef = useRef<Promise<MediaStream> | null>(null);
  const lastScanRef = useRef<{ code: string; at: number }>({ code: '', at: 0 });
  const pendingRef = useRef(false);
  const submitCodeRef = useRef<(raw: string) => void>(() => {});

  const [scanValue, setScanValue] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingProduct | null>(null);
  const [qtyInput, setQtyInput] = useState('');
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraHint, setCameraHint] = useState<string | null>(null);
  const [scanEngine, setScanEngine] = useState<BarcodeScanEngine | null>(null);
  const [cameraBusy, setCameraBusy] = useState(false);

  const detail = useQuery({
    queryKey: ['stock-inventories', id],
    queryFn: () => api<InventoryDetail>(`/stock-inventories/${id}`),
    enabled: Boolean(id),
    refetchInterval: 15_000,
  });

  const inv = detail.data;

  useEffect(() => {
    pendingRef.current = pending != null;
  }, [pending]);

  const focusScan = useCallback(() => {
    window.setTimeout(() => scanRef.current?.focus(), 50);
  }, []);

  const focusQty = useCallback(() => {
    window.setTimeout(() => {
      qtyRef.current?.focus();
      qtyRef.current?.select();
    }, 50);
  }, []);

  useEffect(() => {
    if (pending) focusQty();
    else focusScan();
  }, [pending, focusQty, focusScan]);

  useEffect(() => {
    return () => {
      scanSessionRef.current?.stop();
      scanSessionRef.current = null;
      streamRef.current = null;
    };
  }, []);

  const saveQtyMut = useMutation({
    mutationFn: (args: { variantId: string; code: string; countedQty: string }) =>
      api<InventoryDetail>(`/stock-inventories/${id}/items`, {
        method: 'POST',
        json: {
          variantId: args.variantId,
          countedQty: args.countedQty,
          onDuplicate: 'set',
        },
      }),
    onSuccess: (row, vars) => {
      setErr(null);
      qc.setQueryData(['stock-inventories', id], row);
      playBeep(true);
      const item = row.items.find((it) => it.variant.id === vars.variantId);
      const label = item?.variant.product.name ?? vars.code;
      setFlash(`${label} → ${vars.countedQty}`);
      window.setTimeout(() => setFlash(null), 1800);
      setPending(null);
      setQtyInput('');
      setScanValue('');
      focusScan();
    },
    onError: (e: Error) => {
      playBeep(false);
      setErr(e.message);
      focusQty();
    },
  });

  /** Após o bip: resolve o produto e abre o campo de quantidade. */
  const resolveAfterScan = useMutation({
    mutationFn: async (code: string) => {
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
      const normalized = code.trim().toLowerCase();
      const row =
        rows.find((r) => (r.barcode ?? '').trim().toLowerCase() === normalized) ??
        rows.find((r) => String(r.productControlNumber ?? '') === code.trim()) ??
        rows.find((r) => (r.sku ?? '').trim().toLowerCase() === normalized) ??
        rows[0]!;
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
      setQtyInput(p.currentCounted !== '' ? p.currentCounted : '');
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
    if (pendingRef.current) return;

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

    resolveAfterScan.mutate(code);
  }

  submitCodeRef.current = submitCode;

  function confirmQty() {
    if (!pending) return;
    const n = Number(String(qtyInput).replace(',', '.'));
    if (!Number.isFinite(n) || n < 0 || String(qtyInput).trim() === '') {
      setErr('Informe a quantidade contada.');
      focusQty();
      return;
    }
    setErr(null);
    saveQtyMut.mutate({
      variantId: pending.variantId,
      code: pending.code,
      countedQty: String(n),
    });
  }

  function formatCameraError(e: unknown): string {
    const dom = e instanceof DOMException ? e.name : '';
    const detail =
      dom === 'NotAllowedError'
        ? 'Permissão da câmera negada ou bloqueada.'
        : dom === 'NotFoundError'
          ? 'Nenhuma câmera encontrada.'
          : dom === 'TimeoutError'
            ? 'O sistema não respondeu (sem popup de permissão).'
            : e instanceof Error && e.message === 'NO_GET_USER_MEDIA'
              ? 'Este navegador não expõe câmera (use HTTPS).'
              : '';
    const secure = typeof window !== 'undefined' && window.isSecureContext ? 'HTTPS ok' : 'sem HTTPS';
    return isLikelyIos()
      ? `Câmera indisponível${detail ? `: ${detail}` : ''}. ${secure}. ${iosCameraPermissionHint()}. Toque e segure «Câmera» ou use o campo de código.`
      : `Não foi possível acessar a câmera${detail ? ` (${detail})` : ''}. ${secure}. Verifique a permissão do navegador.`;
  }

  function onCameraButtonPointerDown() {
    if (cameraOn || cameraBusy) return;
    if (inventoryCameraBlockedMessage()) return;
    if (!cameraStreamPromiseRef.current) {
      cameraStreamPromiseRef.current = beginInventoryCameraFromUserGesture();
    }
  }

  function closeCamera() {
    scanSessionRef.current?.stop();
    scanSessionRef.current = null;
    streamRef.current = null;
    cameraStreamPromiseRef.current = null;
    setCameraOn(false);
    setCameraHint(null);
    setScanEngine(null);
    setCameraBusy(false);
    if (!pending) focusScan();
  }

  async function openCameraFromClick() {
    const blocked = inventoryCameraBlockedMessage();
    if (blocked) {
      setCameraHint(blocked);
      return;
    }

    const video = videoRef.current;
    if (!video) {
      setCameraHint('Não foi possível iniciar a câmera. Recarregue a página e tente de novo.');
      return;
    }

    const streamPromise =
      cameraStreamPromiseRef.current ?? openInventoryCameraWithTimeout();
    cameraStreamPromiseRef.current = null;

    flushSync(() => {
      setCameraHint(null);
      setCameraOn(true);
      setCameraBusy(true);
    });

    scanSessionRef.current?.stop();
    scanSessionRef.current = null;

    try {
      const session = await startInventoryCameraSession(
        video,
        (raw) => submitCodeRef.current(raw),
        () => pendingRef.current,
        { streamPromise },
      );
      scanSessionRef.current = session;
      streamRef.current = session.stream;
      setScanEngine(session.engine);
      setCameraHint(null);
    } catch (e) {
      cameraStreamPromiseRef.current = null;
      setCameraHint(formatCameraError(e));
      scanSessionRef.current?.stop();
      scanSessionRef.current = null;
      streamRef.current = null;
      setCameraOn(false);
      setScanEngine(null);
    } finally {
      setCameraBusy(false);
    }
  }

  function toggleCamera() {
    if (cameraOn) {
      closeCamera();
      return;
    }
    void openCameraFromClick();
  }

  const recent = (inv?.items ?? [])
    .slice()
    .reverse()
    .filter((it) => it.countedQty != null)
    .slice(0, 12);

  const busy = resolveAfterScan.isPending || saveQtyMut.isPending;

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
            {inv ? `${inv.location.code} — ${inv.location.name}` : 'Carregando…'}
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

      <p className="inv-collector__hint-flow">
        1. Bipe o código → 2. Informe a quantidade → Enter → próximo
      </p>

      {flash && (
        <div className="inv-collector__flash" role="status">
          {flash}
        </div>
      )}
      {err && <div className="alert alert-error inv-collector__err">{err}</div>}
      {cameraHint && <div className="alert inv-collector__hint">{cameraHint}</div>}

      {pending ? (
        <div className="inv-collector__pending" role="dialog" aria-label="Informar quantidade">
          <p className="inv-collector__pending-step">Produto identificado — informe a contagem</p>
          <strong>{pending.name}</strong>
          <span className="muted">
            SKU {pending.sku}
            {pending.barcode ? ` · EAN ${pending.barcode}` : ''}
            {pending.currentCounted !== ''
              ? ` · já contado: ${pending.currentCounted}`
              : ''}
            {pending.systemQty !== '' ? ` · saldo sist.: ${Number(pending.systemQty)}` : ''}
          </span>
          <label htmlFor="inv-qty">Quantidade contada *</label>
          <input
            id="inv-qty"
            ref={qtyRef}
            className="inv-collector__qty"
            inputMode="decimal"
            autoComplete="off"
            placeholder="Ex.: 12"
            value={qtyInput}
            disabled={busy}
            onChange={(e) => setQtyInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                confirmQty();
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                setPending(null);
                setQtyInput('');
                setErr(null);
                focusScan();
              }
            }}
          />
          <div className="inv-collector__scan-actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || String(qtyInput).trim() === ''}
              onClick={confirmQty}
            >
              {saveQtyMut.isPending ? 'Salvando…' : 'Salvar e próximo'}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busy}
              onClick={() => {
                setPending(null);
                setQtyInput('');
                setErr(null);
                focusScan();
              }}
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : (
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
            disabled={inv?.status !== 'DRAFT' || busy}
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
              disabled={!scanValue.trim() || inv?.status !== 'DRAFT' || busy}
              onClick={() => submitCode(scanValue)}
            >
              {resolveAfterScan.isPending ? 'Buscando…' : 'Confirmar código'}
            </button>
            <button
              type="button"
              className="btn btn-secondary inv-collector__camera-btn"
              disabled={cameraBusy}
              onPointerDown={onCameraButtonPointerDown}
              onTouchStart={onCameraButtonPointerDown}
              onClick={() => toggleCamera()}
            >
              {cameraBusy ? 'Abrindo…' : cameraOn ? 'Fechar câmera' : 'Câmera'}
            </button>
          </div>
        </div>
      )}

      <div
        className={`inv-collector__camera${!cameraOn && !cameraBusy ? ' inv-collector__camera--off' : ''}${pending ? ' inv-collector__camera--off' : ''}`}
        onClick={() => {
          if (!cameraOn && !cameraBusy) return;
          const v = videoRef.current;
          if (!v) return;
          void v.play().catch(() => {
            setCameraHint('Toque na imagem se o vídeo estiver preto.');
          });
        }}
      >
        <video ref={videoRef} playsInline muted autoPlay />
        {(cameraOn || cameraBusy) && !pending && (
          <>
            {cameraBusy && (
              <p className="inv-collector__camera-status" role="status">
                Aguardando permissão da câmera…
              </p>
            )}
            <span className="inv-collector__camera-badge" aria-hidden>
              {scanEngine === 'native'
                ? 'Leitor nativo'
                : scanEngine === 'zxing'
                  ? isLikelyIos()
                    ? 'iOS · ZXing'
                    : 'ZXing'
                  : cameraBusy
                    ? 'Abrindo…'
                    : '…'}
            </span>
          </>
        )}
      </div>

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
