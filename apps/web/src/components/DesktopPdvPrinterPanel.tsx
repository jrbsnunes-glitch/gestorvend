import { useEffect, useState } from 'react';
import {
  getDesktopApi,
  isGestorVendDesktop,
  type DesktopPrinter,
} from '../lib/desktop-bridge';

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

  function resolvePrinter(): string | undefined {
    const m = manual.trim();
    if (m) return m;
    return selected.trim() || undefined;
  }

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
    setHint(`${list.length} impressora(s). Use bobina 80 mm para cupom e NFC-e.`);
  }

  async function load() {
    let current: string | null = null;
    try {
      const cfg = await api?.getPdvPrinter?.();
      current = cfg?.printer ?? null;
      setSavedPrinter(current);
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
      const res = await api.savePdvPrinter({ printer: device });
      if (!res.ok) {
        onMessage?.(res.error || 'Falha ao salvar impressora do PDV.', false);
        return;
      }
      setSavedPrinter(res.printer ?? null);
      onMessage?.(
        res.printer
          ? `Impressora do PDV: ${res.printer} (térmica 80 mm).`
          : 'Impressora do PDV removida — usará o diálogo do sistema.',
        true,
      );
    } finally {
      setBusy(false);
    }
  }

  async function testPrint() {
    if (!api?.testStationPrint) return;
    setBusy(true);
    try {
      const res = await api.testStationPrint(resolvePrinter());
      onMessage?.(
        res.ok ? 'Teste 80 mm enviado à impressora.' : res.error || 'Falha no teste.',
        res.ok,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="card"
      style={{ marginBottom: '1rem', border: '2px solid var(--color-primary, #2563eb)' }}
    >
      <h2 style={{ marginTop: 0, fontSize: '1.1rem' }}>Impressora do PDV (este PC)</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Cupons de venda e NFC-e saem em silêncio nesta térmica <strong>80 mm</strong>, sem diálogo
        do Windows. Independente da fila da cozinha.
      </p>
      {savedPrinter ? (
        <p className="alert alert-success" style={{ padding: '0.5rem 0.75rem' }}>
          Atual: <strong>{savedPrinter}</strong>
        </p>
      ) : (
        <p className="muted" style={{ fontSize: '0.85rem' }}>
          Nenhuma impressora salva — o PDV abrirá o diálogo Imprimir.
        </p>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'end' }}>
        <label style={{ flex: '1 1 240px' }}>
          Impressora térmica 80 mm
          <select
            value={selected}
            onChange={(e) => {
              setSelected(e.target.value);
              if (e.target.value) setManual('');
            }}
            style={{ width: '100%' }}
          >
            <option value="">(escolha ou digite abaixo)</option>
            {printers.map((p) => (
              <option key={p.name} value={p.name}>
                {p.displayName || p.name}
                {p.isDefault ? ' (padrão Windows)' : ''}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={busy}
          onClick={() => void refreshPrinters(resolvePrinter())}
        >
          Atualizar lista
        </button>
      </div>
      <p className="muted" style={{ fontSize: '0.82rem', margin: '0.25rem 0 0.75rem' }}>
        {hint}
      </p>

      <label>
        Ou digite o nome exato no Windows
        <input
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          placeholder="Ex.: MP-4200 TH / Elgin i9"
        />
      </label>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.5rem' }}>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}>
          {busy ? 'Salvando…' : 'Salvar impressora do PDV'}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={busy}
          onClick={() => void testPrint()}
        >
          Imprimir teste 80 mm
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
