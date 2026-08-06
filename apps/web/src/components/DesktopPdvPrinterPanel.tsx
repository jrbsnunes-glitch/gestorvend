import { useEffect, useState } from 'react';
import {
  getDesktopApi,
  isGestorVendDesktop,
  type DesktopPrinter,
} from '../lib/desktop-bridge';
import { tryDesktopPrintUrl } from '../lib/desktop-print';
import './desktop-print-panels.css';

type Props = {
  onMessage?: (msg: string, ok?: boolean) => void;
};

/**
 * Define a impressora térmica padrão deste PC para cupons do PDV e NFC-e (80 mm).
 */
export function DesktopPdvPrinterPanel({ onMessage }: Props) {
  const api = getDesktopApi();
  const desktop = isGestorVendDesktop();
  const [printers, setPrinters] = useState<DesktopPrinter[]>([]);
  const [selected, setSelected] = useState('');
  const [manual, setManual] = useState('');
  const [hint, setHint] = useState('Carregando impressoras…');
  const [busy, setBusy] = useState(false);
  const [savedPrinter, setSavedPrinter] = useState<string | null>(null);
  const [receiptScale, setReceiptScale] = useState(1.2);

  function resolvePrinter(): string | undefined {
    const m = manual.trim();
    if (m) return m;
    return selected.trim() || undefined;
  }

  const currentName = (savedPrinter ?? resolvePrinter() ?? '').trim().toLowerCase();
  const currentDriver =
    printers.find((p) => p.name.trim().toLowerCase() === currentName)?.driverName?.trim() ?? '';
  /** "Generic / Text Only" e similares descartam gráficos no próprio spooler. */
  const textOnlyDriver = /generic|text only|somente texto|texto/i.test(currentDriver);

  async function refreshPrinters(prefer?: string | null) {
    if (!api?.listPrinters) {
      setHint('App desktop desatualizado — reinstale para listar impressoras.');
      return;
    }
    setHint('Consultando impressoras do Windows…');
    const res = await api.listPrinters();
    const list = res.printers ?? [];
    setPrinters(list);
    const preferName = prefer?.trim();
    if (preferName) {
      if (list.some((p) => p.name === preferName)) {
        setSelected(preferName);
        setManual('');
      } else {
        setManual(preferName);
        setSelected('');
      }
    } else if (!selected && list.length) {
      const def = list.find((p) => p.isDefault) ?? list[0];
      if (def) setSelected(def.name);
    }
    if (!list.length) {
      setHint(
        (res.error || 'Nenhuma impressora listada.') +
          ' Digite o nome manual da térmica 80 mm.',
      );
      return;
    }
    setHint(`${list.length} impressora(s) · bobina 80 mm para cupom e NFC-e`);
  }

  async function load() {
    let current: string | null = null;
    try {
      const cfg = await api?.getPdvPrinter?.();
      current = cfg?.printer ?? null;
      setSavedPrinter(current);
      if (typeof cfg?.receiptScale === 'number' && Number.isFinite(cfg.receiptScale)) {
        setReceiptScale(cfg.receiptScale);
      }
    } catch {
      /* ignore */
    }
    await refreshPrinters(current);
  }

  useEffect(() => {
    if (!desktop) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desktop]);

  if (!desktop) return null;

  async function save() {
    if (!api?.savePdvPrinter) {
      onMessage?.('App desktop desatualizado. Reinstale o GestorVend Desktop.', false);
      return;
    }
    setBusy(true);
    try {
      const device = resolvePrinter() ?? null;
      const res = await api.savePdvPrinter({ printer: device, receiptScale });
      if (!res.ok) {
        onMessage?.(res.error || 'Falha ao salvar impressora do PDV.', false);
        return;
      }
      setSavedPrinter(res.printer ?? null);
      if (typeof res.receiptScale === 'number') setReceiptScale(res.receiptScale);
      onMessage?.(
        res.printer
          ? `Impressora do PDV: ${res.printer} (escala ${receiptScale}).`
          : 'Impressora do PDV removida — usará o diálogo do sistema.',
        true,
      );
    } finally {
      setBusy(false);
    }
  }

  /**
   * Imprime um cupom-modelo pelo mesmo caminho de uma venda real: valida logo,
   * CNPJ e formatação. O antigo teste usava o ticket de cozinha, que sai sem o
   * layout da empresa e dava a impressão de que o cupom estava "genérico".
   */
  async function testPrint() {
    setBusy(true);
    try {
      const nonce = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
      const ok = await tryDesktopPrintUrl(
        `/vendas/impressao?demo=1&_np=${encodeURIComponent(nonce)}`,
        '80mm',
      );
      if (ok) {
        onMessage?.('Cupom-modelo enviado à impressora do PDV.', true);
        return;
      }
      const w = window.open(
        `/vendas/impressao?demo=1&autoprint=1&close=1&_np=${encodeURIComponent(nonce)}`,
        'gv_sale_receipt_demo',
        'width=420,height=720',
      );
      onMessage?.(
        w
          ? 'Abrindo cupom-modelo para impressão…'
          : 'Não foi possível enviar o cupom-modelo. Confira a impressora do PDV.',
        Boolean(w),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="desktop-print-panel desktop-print-panel--pdv">
      <div className="desktop-print-panel__head">
        <h2 className="desktop-print-panel__title">Impressora do PDV (este PC)</h2>
      </div>
      <p className="desktop-print-panel__lead">
        Cupons e NFC-e saem em silêncio nesta térmica <strong>80 mm</strong>, sem diálogo do
        Windows.
      </p>
      {savedPrinter ? (
        <p className="desktop-print-panel__status alert alert-success">
          Atual: <strong>{savedPrinter}</strong>
          {currentDriver ? <> · driver {currentDriver}</> : null}
        </p>
      ) : (
        <p className="desktop-print-panel__lead" style={{ marginTop: '-0.25rem' }}>
          Nenhuma salva — o PDV abrirá o diálogo Imprimir.
        </p>
      )}

      {textOnlyDriver ? (
        <p className="desktop-print-panel__status alert alert-warning">
          O driver <strong>{currentDriver}</strong> imprime <strong>somente texto</strong>: o Windows
          descarta logotipo, linhas e negrito antes de chegar na bobina — o cupom sai genérico
          independente do sistema. Instale o driver do fabricante da térmica (Elgin, Bematech, Epson
          TM, etc.) e selecione-o aqui.
        </p>
      ) : null}

      <div className="desktop-print-panel__grid">
        <label className="desktop-print-panel__field">
          <span>Impressora térmica 80 mm</span>
          <select
            value={selected}
            onChange={(e) => {
              setSelected(e.target.value);
              if (e.target.value) setManual('');
            }}
          >
            <option value="">(escolha ou digite ao lado)</option>
            {printers.map((p) => (
              <option key={p.name} value={p.name}>
                {p.displayName || p.name}
                {p.isDefault ? ' (padrão Windows)' : ''}
                {p.driverName?.trim() ? ` — ${p.driverName.trim()}` : ''}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="btn btn-secondary desktop-print-panel__refresh"
          disabled={busy}
          onClick={() => void refreshPrinters(resolvePrinter())}
        >
          Atualizar lista
        </button>

        <label className="desktop-print-panel__field" style={{ gridColumn: '1 / -1' }}>
          <span>Nome exato no Windows (opcional)</span>
          <input
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            placeholder="Ex.: MP-4200 TH / Elgin i9"
          />
        </label>

        <label className="desktop-print-panel__field" style={{ gridColumn: '1 / -1' }}>
          <span>Tamanho do cupom na bobina</span>
          <select
            value={String(receiptScale)}
            onChange={(e) => setReceiptScale(Number(e.target.value))}
          >
            <option value="0.9">Compacto (0,9)</option>
            <option value="1">Normal mercado (1,0)</option>
            <option value="1.2">Padrão recomendado (1,2)</option>
            <option value="1.4">Grande (1,4)</option>
            <option value="1.6">Extra grande (1,6)</option>
          </select>
        </label>
        <p className="desktop-print-panel__hint">{hint}</p>
      </div>

      <div className="desktop-print-panel__actions">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}>
          {busy ? 'Salvando…' : 'Salvar'}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={busy}
          onClick={() => void testPrint()}
        >
          Testar cupom 80 mm
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={busy || !savedPrinter}
          onClick={() => {
            setSelected('');
            setManual('');
            void (async () => {
              setBusy(true);
              try {
                await api?.savePdvPrinter?.({ printer: null });
                setSavedPrinter(null);
                onMessage?.('Impressora do PDV removida.', true);
              } finally {
                setBusy(false);
              }
            })();
          }}
        >
          Remover
        </button>
      </div>
    </section>
  );
}
