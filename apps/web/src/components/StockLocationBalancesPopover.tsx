import { useEffect, useId, useMemo, useRef, useState, type MouseEvent } from 'react';
import { formatStockQty } from '../lib/format';

export type StockLocationBalanceRow = {
  locationId: string;
  locationCode: string;
  locationName: string;
  quantity: string;
};

type Props = {
  locations: StockLocationBalanceRow[];
  /** Rótulo curto no gatilho; padrão deriva dos locais com saldo. */
  triggerLabel?: string;
};

function qtyNum(q: string) {
  const n = Number(q);
  return Number.isFinite(n) ? n : 0;
}

export function StockLocationBalancesPopover({ locations, triggerLabel }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const [panelPos, setPanelPos] = useState<{ top: number; left: number } | null>(null);

  const sorted = useMemo(() => {
    return [...locations].sort((a, b) => {
      const az = qtyNum(a.quantity) <= 0;
      const bz = qtyNum(b.quantity) <= 0;
      if (az !== bz) return az ? 1 : -1;
      return a.locationCode.localeCompare(b.locationCode, 'pt-BR');
    });
  }, [locations]);

  const withStock = sorted.filter((l) => qtyNum(l.quantity) > 1e-9);
  const zeroCount = sorted.length - withStock.length;

  const label =
    triggerLabel ??
    (withStock.length > 0
      ? `${withStock.length} local${withStock.length === 1 ? '' : 'is'}`
      : sorted.length > 0
        ? 'Ver locais'
        : 'Sem locais');

  function toggleOpen(e: MouseEvent<HTMLButtonElement>) {
    e.stopPropagation();
    if (open) {
      setOpen(false);
      return;
    }
    const el = triggerRef.current;
    if (el) {
      const r = el.getBoundingClientRect();
      const panelW = 300;
      const left = Math.max(8, Math.min(r.left, window.innerWidth - panelW - 8));
      setPanelPos({ top: r.bottom + 6, left });
    }
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onScroll = () => setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  if (!sorted.length) {
    return <span className="stock-loc-popover__none muted">Sem locais</span>;
  }

  return (
    <div className="stock-loc-popover" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="stock-loc-popover__trigger btn btn-ghost btn-compact"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={toggleOpen}
      >
        {label}
      </button>
      {open && panelPos ? (
        <div
          id={panelId}
          className="stock-loc-popover__panel stock-loc-popover__panel--fixed"
          role="dialog"
          aria-label="Saldos por local de estoque"
          style={{ top: panelPos.top, left: panelPos.left }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="stock-loc-popover__panel-head">
            <strong>Saldos por local</strong>
            <button
              type="button"
              className="btn btn-ghost btn-compact stock-loc-popover__close"
              aria-label="Fechar"
              onClick={() => setOpen(false)}
            >
              ×
            </button>
          </div>
          <div className="stock-loc-popover__table-wrap">
            <table className="stock-loc-popover__table">
              <thead>
                <tr>
                  <th>Cód.</th>
                  <th>Depósito</th>
                  <th className="num">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((l) => {
                  const zero = qtyNum(l.quantity) <= 1e-9;
                  return (
                    <tr key={l.locationId} className={zero ? 'is-zero' : undefined}>
                      <td>
                        <code className="stock-loc-popover__code">{l.locationCode}</code>
                      </td>
                      <td title={l.locationName}>{l.locationName}</td>
                      <td className="num">{formatStockQty(l.quantity)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {zeroCount > 0 && withStock.length === 0 ? (
            <p className="stock-loc-popover__foot muted">Saldo zero em todos os depósitos.</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
