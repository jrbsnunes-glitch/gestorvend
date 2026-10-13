/** Item já medido, pronto para distribuir em folhas A4. */
export type MeasuredBlock = {
  kind: 'block';
  key: string;
  height: number;
};

export type MeasuredTable = {
  kind: 'table';
  key: string;
  titleHeight: number;
  headHeight: number;
  rowHeights: number[];
  footHeight: number;
};

export type MeasuredItem = MeasuredBlock | MeasuredTable;

export type PageSlice =
  | { kind: 'block'; key: string }
  | {
      kind: 'table';
      key: string;
      from: number;
      to: number;
      showTitle: boolean;
      showFoot: boolean;
    };

/**
 * Distribui blocos e linhas de tabela na altura útil de cada folha.
 * O cabeçalho de página já entra em `headerHeight` / `nextHeaderHeight`.
 * `limit` é a altura do miolo (sem o rodapé de numeração).
 */
export function packA4(
  items: MeasuredItem[],
  available: number,
  headerHeight: number,
  nextHeaderHeight = headerHeight,
): PageSlice[][] {
  const slack = 6;
  const limit = Math.max(available - slack, 1);
  const pages: PageSlice[][] = [];
  let page: PageSlice[] = [];
  let pageIndex = 0;
  const headerFor = (index: number) => (index === 0 ? headerHeight : nextHeaderHeight);
  let used = headerFor(0);

  const flush = () => {
    if (!page.length) return;
    pages.push(page);
    page = [];
    pageIndex += 1;
    used = headerFor(pageIndex);
  };

  for (const item of items) {
    if (item.kind === 'block') {
      if (item.height <= 0) continue;
      if (page.length && used + item.height > limit) flush();
      page.push({ kind: 'block', key: item.key });
      used += item.height;
      if (used > limit) flush();
      continue;
    }

    const rows = item.rowHeights;
    const chrome = item.titleHeight + item.headHeight;

    if (!rows.length) {
      const h = chrome + item.footHeight;
      if (page.length && used + h > limit) flush();
      page.push({
        kind: 'table',
        key: item.key,
        from: 0,
        to: 0,
        showTitle: item.titleHeight > 0,
        showFoot: item.footHeight > 0,
      });
      used += h;
      continue;
    }

    let index = 0;
    while (index < rows.length) {
      if (page.length && used + chrome + rows[index] > limit) flush();
      const start = index;
      let sliceUsed = used + chrome;
      while (index < rows.length) {
        const rowH = rows[index];
        const atEnd = index === rows.length - 1;
        const reserve = atEnd ? item.footHeight : 0;
        if (index > start && sliceUsed + rowH + reserve > limit) break;
        sliceUsed += rowH;
        index += 1;
        if (index === rows.length) sliceUsed += item.footHeight;
      }
      if (index === start) {
        sliceUsed += rows[start];
        index += 1;
        if (index === rows.length) sliceUsed += item.footHeight;
      }
      page.push({
        kind: 'table',
        key: item.key,
        from: start,
        to: index,
        showTitle: true,
        showFoot: index === rows.length && item.footHeight > 0,
      });
      used = sliceUsed;
      if (index < rows.length) flush();
    }
  }

  if (page.length) pages.push(page);
  if (!pages.length) pages.push([]);
  return pages;
}
