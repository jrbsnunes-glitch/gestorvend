import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import './restaurant.css';
import './kitchen-print.css';

type Tab = {
  number: number;
  table: { code: string; label: string | null; area: { name: string } } | null;
  items: Array<{
    id: string;
    quantity: string | number;
    notes: string | null;
    status: string;
    kitchenPrintedAt?: string | null;
    printSector?: string | null;
    variant: { product: { name: string; taxUnit: string | null } };
  }>;
};

function closePrintTab() {
  try {
    window.close();
  } catch {
    /* ignore — navegador pode bloquear se a aba não foi aberta por script */
  }
}

export function RestaurantKitchenPrintPage() {
  const { tabId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const printedRef = useRef(false);
  const onlyIds = useMemo(() => {
    const raw = searchParams.get('itens') ?? searchParams.get('ids') ?? '';
    return new Set(
      raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );
  }, [searchParams]);

  const tabQ = useQuery({
    queryKey: ['restaurant', 'tab', tabId, 'kitchen'],
    queryFn: () => api<Tab>(`/restaurant/tabs/${encodeURIComponent(tabId)}`),
    enabled: Boolean(tabId),
  });

  const runPrint = useCallback(() => {
    window.print();
  }, []);

  useEffect(() => {
    function onAfterPrint() {
      closePrintTab();
    }
    window.addEventListener('afterprint', onAfterPrint);
    return () => window.removeEventListener('afterprint', onAfterPrint);
  }, []);

  const tab = tabQ.data;
  const items = useMemo(() => {
    const active = (tab?.items ?? []).filter((i) => i.status !== 'CANCELLED');
    if (onlyIds.size > 0) {
      return active.filter((i) => onlyIds.has(i.id));
    }
    // Fallback: só o que ainda não tinha sido impresso (ou recém marcado).
    return active.filter((i) => !i.kitchenPrintedAt);
  }, [tab?.items, onlyIds]);

  useEffect(() => {
    if (!tabQ.data || printedRef.current) return;
    if (items.length === 0) return;
    printedRef.current = true;
    const t = window.setTimeout(() => {
      runPrint();
    }, 400);
    return () => window.clearTimeout(t);
  }, [tabQ.data, items.length, runPrint]);

  return (
    <div>
      <div className="kitchen-print-toolbar no-print">
        <button type="button" className="btn btn-primary" onClick={runPrint} disabled={items.length === 0}>
          Imprimir
        </button>
        <button type="button" className="btn btn-secondary" onClick={closePrintTab}>
          Fechar
        </button>
        <span style={{ fontSize: '0.85rem', color: '#64748b', alignSelf: 'center' }}>
          {onlyIds.size > 0
            ? 'Ticket com itens novos desta impressão.'
            : 'Após imprimir (ou cancelar o diálogo), esta aba fecha automaticamente.'}
        </span>
      </div>
      <div className="kitchen-ticket">
        <header>
          <h1>COZINHA</h1>
          {tab && (
            <>
              <p>
                {tab.table ? (
                  <>
                    MESA <strong>{tab.table.label || tab.table.code}</strong>
                    {` · ${tab.table.area.name} · Comanda #${tab.number}`}
                  </>
                ) : (
                  <>
                    Comanda <strong>#{tab.number}</strong>
                  </>
                )}
              </p>
              <p className="kitchen-ticket__time">{new Date().toLocaleString('pt-BR')}</p>
              {onlyIds.size > 0 ? (
                <p style={{ fontSize: '0.9rem', fontWeight: 700 }}>*** PEDIDO ADICIONAL ***</p>
              ) : null}
            </>
          )}
        </header>
        {items.length === 0 ? (
          <p>Nenhum item novo para imprimir.</p>
        ) : (
          <ul>
            {items.map((it) => (
              <li key={it.id}>
                <strong>
                  {Number(it.quantity).toLocaleString('pt-BR', { maximumFractionDigits: 3 })}
                  {it.variant.product.taxUnit ? ` ${it.variant.product.taxUnit}` : '×'}
                </strong>{' '}
                {it.variant.product.name}
                {it.notes ? <div className="kitchen-ticket__notes">Obs: {it.notes}</div> : null}
                {it.printSector ? <div className="muted">{it.printSector}</div> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
