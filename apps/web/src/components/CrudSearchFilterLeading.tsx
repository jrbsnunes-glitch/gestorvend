/** Botões Pesquisar + Filtros (padrão do menu Produtos) para `CrudToolbar.leadingPrimary`. */
export function CrudSearchFilterLeading({
  onSearch,
  onFilters,
  filtersActive = false,
  searchLabel = 'Pesquisar',
  filtersLabel = 'Filtros',
  filtersTitle,
}: {
  onSearch: () => void;
  onFilters: () => void;
  filtersActive?: boolean;
  searchLabel?: string;
  filtersLabel?: string;
  filtersTitle?: string;
}) {
  return (
    <>
      <button type="button" className="btn btn-secondary" onClick={onSearch}>
        {searchLabel}
      </button>
      <button
        type="button"
        className={filtersActive ? 'btn btn-primary' : 'btn btn-secondary'}
        onClick={onFilters}
        title={
          filtersTitle ??
          (filtersActive ? 'Filtros ativos — clique para alterar' : 'Filtrar listagem')
        }
      >
        {filtersLabel}
        {filtersActive ? ' ●' : ''}
      </button>
    </>
  );
}
