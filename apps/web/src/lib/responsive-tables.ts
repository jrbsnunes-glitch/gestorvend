/**
 * Tabelas `.data-table` no mobile: preenche `data-label` a partir do `<thead>`
 * para o CSS de cards (rótulos por célula). Preferível a User-Agent.
 *
 * Opt-out: `data-table--no-cards`, `table-wrap--no-cards`, `data-no-table-cards`.
 * Células com `data-label-locked` não são sobrescritas.
 */

const SKIP_CLOSEST =
  '.data-table--no-cards, .table-wrap--no-cards, [data-no-table-cards], .pos-root, .pos-screen, .cash-session-detail';

function headerLabels(table: HTMLTableElement): string[] {
  return Array.from(table.querySelectorAll('thead th')).map((th) =>
    (th.textContent ?? '').replace(/\s+/g, ' ').trim(),
  );
}

function shouldSkipTable(table: HTMLTableElement): boolean {
  if (table.classList.contains('data-table--no-cards')) return true;
  return Boolean(table.closest(SKIP_CLOSEST));
}

export function syncDataTableCardLabels(root: ParentNode = document): void {
  const tables = root.querySelectorAll?.('table.data-table') ?? [];
  tables.forEach((node) => {
    const table = node as HTMLTableElement;
    if (shouldSkipTable(table)) return;

    const headers = headerLabels(table);
    table.querySelectorAll('tbody tr').forEach((tr) => {
      const cells = Array.from(
        tr.querySelectorAll(':scope > td'),
      ) as HTMLTableCellElement[];
      if (cells.length === 0) return;

      const onlyColspan =
        cells.length === 1 && (cells[0]!.hasAttribute('colspan') || cells[0]!.colSpan > 1);
      if (onlyColspan) {
        tr.classList.add('data-table-empty-row');
        tr.classList.remove('data-table-card-row');
        return;
      }

      tr.classList.add('data-table-card-row');
      tr.classList.remove('data-table-empty-row');

      cells.forEach((td, i) => {
        if (td.hasAttribute('data-label-locked')) return;
        const header = headers[i] ?? '';
        if (td.classList.contains('col-actions')) {
          td.setAttribute('data-label', header || '');
          return;
        }
        td.setAttribute('data-label', header);
      });
    });
  });
}

/** Observa o DOM e re-sincroniza labels quando listagens mudam (React Query, etc.). */
export function startDataTableCardLabelsObserver(): () => void {
  if (typeof document === 'undefined') return () => undefined;

  let timer: ReturnType<typeof setTimeout> | null = null;
  const run = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      // Só sincroniza em viewport estreita (cards mobile); evita trabalho no desktop.
      if (window.matchMedia('(max-width: 900px)').matches) {
        syncDataTableCardLabels(document);
      }
    }, 200);
  };

  run();

  const obs = new MutationObserver((mutations) => {
    // Ignora mudanças triviais de atributos/texto sem tabela envolvida.
    for (const m of mutations) {
      const t = m.target;
      if (t instanceof Element && (t.closest('table.data-table') || t.querySelector?.('table.data-table'))) {
        run();
        return;
      }
      if (m.addedNodes.length || m.removedNodes.length) {
        for (const n of m.addedNodes) {
          if (
            n instanceof Element &&
            (n.matches?.('table.data-table') || n.querySelector?.('table.data-table'))
          ) {
            run();
            return;
          }
        }
        for (const n of m.removedNodes) {
          if (n instanceof Element && n.matches?.('table.data-table')) {
            run();
            return;
          }
        }
      }
    }
  });
  obs.observe(document.body, {
    childList: true,
    subtree: true,
  });

  const onResize = () => run();
  window.addEventListener('resize', onResize);

  return () => {
    if (timer) clearTimeout(timer);
    obs.disconnect();
    window.removeEventListener('resize', onResize);
  };
}
