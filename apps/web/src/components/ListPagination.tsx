/** Paginação padrão das telas de listagem (30 registros por página). */
export const LIST_PAGE_SIZE = 30;

type ListPaginationProps = {
  page: number;
  totalPages: number;
  totalItems: number;
  pageSize?: number;
  onPageChange: (page: number) => void;
  itemLabel?: string;
};

export function ListPagination({
  page,
  totalPages,
  totalItems,
  pageSize = LIST_PAGE_SIZE,
  onPageChange,
  itemLabel = 'registro(s)',
}: ListPaginationProps) {
  if (totalItems <= pageSize) return null;

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, totalItems);

  const pages = buildPageNumbers(page, totalPages);

  return (
    <nav className="list-pagination no-print" aria-label="Paginação da listagem">
      <span className="list-pagination__summary">
        {from}–{to} de {totalItems} {itemLabel}
      </span>
      <div className="list-pagination__controls">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          aria-label="Página anterior"
        >
          ‹ Anterior
        </button>
        <span className="list-pagination__pages" role="group" aria-label="Números de página">
          {pages.map((p, i) =>
            p === '…' ? (
              <span key={`ellipsis-${i}`} className="list-pagination__ellipsis" aria-hidden>
                …
              </span>
            ) : (
              <button
                key={p}
                type="button"
                className={`btn btn-sm ${p === page ? 'btn-primary' : 'btn-secondary'}`}
                aria-current={p === page ? 'page' : undefined}
                onClick={() => onPageChange(p)}
              >
                Pág. {p}
              </button>
            ),
          )}
        </span>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          aria-label="Próxima página"
        >
          Próxima ›
        </button>
      </div>
    </nav>
  );
}

/** Gera números de página com reticências para listas longas. */
function buildPageNumbers(current: number, total: number): Array<number | '…'> {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const pages: Array<number | '…'> = [1];
  if (current > 3) pages.push('…');
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  for (let p = start; p <= end; p += 1) pages.push(p);
  if (current < total - 2) pages.push('…');
  pages.push(total);
  return pages;
}
