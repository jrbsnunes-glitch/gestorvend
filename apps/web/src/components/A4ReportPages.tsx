import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  packA4,
  type MeasuredItem,
  type PageSlice,
} from '../lib/a4-report-pages';

export type A4Block = {
  kind: 'block';
  key: string;
  node: ReactNode;
};

export type A4Table = {
  kind: 'table';
  key: string;
  className?: string;
  tableClassName?: string;
  title?: ReactNode;
  head: ReactNode;
  rows: ReactNode[];
  foot?: ReactNode;
  empty?: ReactNode;
};

export type A4Item = A4Block | A4Table;

function tableRows(item: A4Table): ReactNode[] {
  if (item.rows.length) return item.rows;
  if (item.empty) return [item.empty];
  return [];
}

function outerHeight(el: HTMLElement): number {
  const style = getComputedStyle(el);
  const margin =
    (parseFloat(style.marginTop) || 0) + (parseFloat(style.marginBottom) || 0);
  return Math.ceil(el.getBoundingClientRect().height + margin);
}

function readItems(root: HTMLElement): MeasuredItem[] {
  const nodes = [...root.querySelectorAll<HTMLElement>(':scope > [data-a4-key]')];
  return nodes.map((el) => {
    const key = el.getAttribute('data-a4-key') || '';
    if (el.getAttribute('data-a4-kind') === 'table') {
      const title = el.querySelector<HTMLElement>(':scope > [data-a4-title]');
      const thead = el.querySelector<HTMLElement>('thead');
      const tfoot = el.querySelector<HTMLElement>('tfoot');
      const style = getComputedStyle(el);
      const extra =
        (parseFloat(style.marginTop) || 0) +
        (parseFloat(style.marginBottom) || 0) +
        (parseFloat(style.paddingTop) || 0) +
        (parseFloat(style.paddingBottom) || 0);
      const rows = [...el.querySelectorAll<HTMLElement>('tbody > tr')];
      return {
        kind: 'table' as const,
        key,
        titleHeight: (title ? outerHeight(title) : 0) + extra,
        headHeight: thead ? outerHeight(thead) + 1 : 0,
        rowHeights: rows.map((row) => Math.ceil(row.getBoundingClientRect().height) + 1),
        footHeight: tfoot ? outerHeight(tfoot) + 1 : 0,
      };
    }
    return { kind: 'block' as const, key, height: outerHeight(el) };
  });
}

function sliceSignature(pages: PageSlice[][]): string {
  return pages
    .map((page) =>
      page
        .map((slice) =>
          slice.kind === 'block' ? `b:${slice.key}` : `t:${slice.key}:${slice.from}-${slice.to}:${slice.showFoot ? 1 : 0}`,
        )
        .join(','),
    )
    .join('|');
}

function FlowItem({ item }: { item: A4Item }) {
  if (item.kind === 'block') {
    return (
      <div data-a4-key={item.key} data-a4-kind="block" className="gv-a4-flow">
        {item.node}
      </div>
    );
  }
  const rows = tableRows(item);
  return (
    <div
      data-a4-key={item.key}
      data-a4-kind="table"
      className={item.className ? `gv-a4-flow ${item.className}` : 'gv-a4-flow'}
    >
      {item.title ? <div data-a4-title>{item.title}</div> : null}
      <table
        className={['gv-a4-table', 'data-table--no-cards', item.tableClassName].filter(Boolean).join(' ')}
      >
        <thead>{item.head}</thead>
        <tbody>{rows}</tbody>
        {item.foot ? <tfoot>{item.foot}</tfoot> : null}
      </table>
    </div>
  );
}

function TableSliceView({ item, slice }: { item: A4Table; slice: Extract<PageSlice, { kind: 'table' }> }) {
  const rows = tableRows(item).slice(slice.from, slice.to);
  return (
    <div className={item.className ? `gv-a4-flow ${item.className}` : 'gv-a4-flow'}>
      {slice.showTitle && item.title ? <div data-a4-title>{item.title}</div> : null}
      <table
        className={['gv-a4-table', 'data-table--no-cards', item.tableClassName].filter(Boolean).join(' ')}
      >
        <thead>{item.head}</thead>
        <tbody>{rows}</tbody>
        {slice.showFoot && item.foot ? <tfoot>{item.foot}</tfoot> : null}
      </table>
    </div>
  );
}

export function A4ReportPages({
  header,
  items,
  layoutKey,
  onReady,
}: {
  header: ReactNode;
  items: A4Item[];
  /** Muda quando o conteúdo medido muda (quantidade de linhas, filtros, título). */
  layoutKey: string;
  onReady?: (pageCount: number) => void;
}) {
  const measureRef = useRef<HTMLDivElement>(null);
  const [packed, setPacked] = useState<{ key: string; signature: string; pages: PageSlice[][] } | null>(
    null,
  );

  useLayoutEffect(() => {
    const root = measureRef.current;
    if (!root) return;

    const measure = () => {
      const body = root.querySelector<HTMLElement>('[data-a4-body]');
      const head = root.querySelector<HTMLElement>('[data-a4-header]');
      if (!body || !head) return;
      const available = body.clientHeight;
      if (available < 40) return;
      const pages = packA4(readItems(body), available, outerHeight(head));
      const signature = sliceSignature(pages);
      setPacked((prev) => {
        if (prev && prev.key === layoutKey && prev.signature === signature) return prev;
        return { key: layoutKey, signature, pages };
      });
    };

    measure();
    const observer = new ResizeObserver(() => measure());
    observer.observe(root);
    const fonts = document.fonts?.ready.then(() => measure());
    root.querySelectorAll('img').forEach((img) => {
      if (!img.complete) img.addEventListener('load', measure, { once: true });
    });
    return () => {
      observer.disconnect();
      void fonts;
    };
  }, [layoutKey]);

  const pages = packed?.key === layoutKey ? packed.pages : null;

  useEffect(() => {
    if (pages) onReady?.(pages.length);
  }, [pages, onReady]);

  const byKey = new Map(items.map((item) => [item.key, item]));

  const renderPageBody = (slices: PageSlice[]) =>
    slices.map((slice) => {
      const item = byKey.get(slice.key);
      if (!item) return null;
      if (slice.kind === 'block' && item.kind === 'block') {
        return (
          <div key={item.key} className="gv-a4-flow">
            {item.node}
          </div>
        );
      }
      if (slice.kind === 'table' && item.kind === 'table') {
        return <TableSliceView key={`${item.key}-${slice.from}`} item={item} slice={slice} />;
      }
      return null;
    });

  return (
    <div className="gv-a4-root">
      <div className="gv-a4-measure" aria-hidden ref={measureRef}>
        <article className="gv-a4-sheet print-doc">
          <div className="gv-a4-sheet__body" data-a4-body>
            <div data-a4-header>{header}</div>
            {items.map((item) => (
              <FlowItem key={item.key} item={item} />
            ))}
          </div>
          <footer className="gv-a4-sheet__foot">
            <span>GestorVend</span>
            <span>Página 1 de 1</span>
          </footer>
        </article>
      </div>

      {pages ? (
        <>
          <p className="gv-a4-pagecount no-print">
            {pages.length} {pages.length === 1 ? 'página A4' : 'páginas A4'}
          </p>
          <div className="gv-a4-stack">
            {pages.map((slices, index) => (
              <article className="gv-a4-sheet print-doc" key={`${layoutKey}-${index}`}>
                <div className="gv-a4-sheet__body">
                  <div data-a4-header>{header}</div>
                  {renderPageBody(slices)}
                </div>
                <footer className="gv-a4-sheet__foot">
                  <span>GestorVend</span>
                  <span>
                    Página {index + 1} de {pages.length}
                  </span>
                </footer>
              </article>
            ))}
          </div>
        </>
      ) : (
        <article className="gv-a4-sheet print-doc">
          <div className="gv-a4-sheet__body">
            <div data-a4-header>{header}</div>
            <p className="print-sub">Organizando páginas…</p>
          </div>
        </article>
      )}
    </div>
  );
}
