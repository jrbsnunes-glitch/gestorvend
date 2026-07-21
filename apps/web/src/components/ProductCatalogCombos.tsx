import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { api } from '../lib/api';

/** Limites visíveis dos ancestrais com overflow ≠ visible (evita painel cortado em modais). */
function getClipVerticalBounds(el: HTMLElement): { top: number; bottom: number } {
  let top = 0;
  let bottom = window.innerHeight;
  let node: HTMLElement | null = el.parentElement;
  while (node) {
    const s = getComputedStyle(node);
    const oy = s.overflowY;
    const ox = s.overflowX;
    if (
      oy === 'auto' ||
      oy === 'scroll' ||
      oy === 'hidden' ||
      ox === 'auto' ||
      ox === 'scroll' ||
      ox === 'hidden'
    ) {
      const r = node.getBoundingClientRect();
      top = Math.max(top, r.top);
      bottom = Math.min(bottom, r.bottom);
    }
    node = node.parentElement;
  }
  return { top, bottom };
}

const CATALOG_COMBO_PANEL_MAX = 284;

function useCatalogPanelAbove(
  open: boolean,
  wrapRef: RefObject<HTMLDivElement | null>,
  ...remeasureDeps: unknown[]
): boolean {
  const [above, setAbove] = useState(false);

  useLayoutEffect(() => {
    if (!open || !wrapRef.current) {
      setAbove(false);
      return;
    }
    const wrap = wrapRef.current;
    const measure = () => {
      const r = wrap.getBoundingClientRect();
      const { top: clipTop, bottom: clipBottom } = getClipVerticalBounds(wrap);
      const spaceBelow = clipBottom - r.bottom;
      const spaceAbove = r.top - clipTop;
      const preferUp =
        spaceBelow < CATALOG_COMBO_PANEL_MAX &&
        spaceAbove > spaceBelow &&
        spaceAbove >= Math.min(CATALOG_COMBO_PANEL_MAX, 120);
      setAbove(preferUp);
    };
    measure();
    const id = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(id);
  }, [open, ...remeasureDeps]);

  return above;
}

type CategoryRow = { id: string; name: string };

export function CategorySearchCombo({
  id,
  value,
  onChange,
  hintName,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (categoryId: string, pickedName?: string) => void;
  hintName?: string | null;
  disabled?: boolean;
}) {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (hintName && value) setQ(hintName);
    else if (!value) setQ('');
  }, [hintName, value]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const searchQ = useDeferredValue(q);
  const isFiltering = open && q !== searchQ;

  const list = useQuery({
    queryKey: ['categories', 'search', searchQ],
    queryFn: () => api<CategoryRow[]>(`/categories?q=${encodeURIComponent(searchQ)}`),
    enabled: open,
    staleTime: 10_000,
  });

  const create = useMutation({
    mutationFn: (name: string) => api<CategoryRow>('/categories', { method: 'POST', json: { name } }),
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ['categories'] });
      onChange(row.id, row.name);
      setQ(row.name);
      setOpen(false);
    },
  });

  const rows = list.data ?? [];
  const term = q.trim();
  const showLoading = (list.isFetching && rows.length === 0) || isFiltering;
  const canCreate =
    term.length > 0 &&
    !rows.some((c) => c.name.toLowerCase() === term.toLowerCase()) &&
    !create.isPending;

  const panelAbove = useCatalogPanelAbove(
    open,
    wrapRef,
    searchQ,
    rows.length,
    showLoading,
    canCreate,
    term,
    value,
    create.isPending,
  );

  return (
    <div className="catalog-combo" ref={wrapRef}>
      <input
        id={id}
        type="text"
        autoComplete="off"
        disabled={disabled}
        placeholder="Pesquisar ou cadastrar categoria…"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          if (value) onChange('', undefined);
        }}
        onFocus={() => setOpen(true)}
        aria-label="Categoria: pesquisar ou cadastrar"
      />
      {open && (
        <div
          className={
            'catalog-combo-panel catalog-combo-panel--raised' + (panelAbove ? ' catalog-combo-panel--above' : '')
          }
          role="listbox"
        >
          {term.length === 0 && !showLoading && rows.length > 0 && (
            <div className="catalog-combo-hint">Digite para filtrar ou clique em uma categoria abaixo.</div>
          )}
          {showLoading && <div className="catalog-combo-empty">Buscando categorias…</div>}
          {!showLoading &&
            rows.map((c) => (
              <button
                key={c.id}
                type="button"
                className="catalog-combo-option"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(c.id, c.name);
                  setQ(c.name);
                  setOpen(false);
                }}
              >
                {c.name}
              </button>
            ))}
          {!showLoading && !rows.length && term.length > 0 && (
            <div className="catalog-combo-empty">
              Nenhuma categoria para «{term}». Cadastre uma nova com o botão abaixo ou ajuste o termo.
            </div>
          )}
          {!showLoading && !rows.length && term.length === 0 && (
            <div className="catalog-combo-empty">Nenhuma categoria cadastrada ainda. Digite um nome e cadastre.</div>
          )}
          {canCreate && (
            <button
              type="button"
              className="catalog-combo-create"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => create.mutate(term)}
              disabled={create.isPending}
            >
              + Cadastrar &quot;{term}&quot;
            </button>
          )}
          {create.isError && (
            <div className="catalog-combo-error">{(create.error as Error).message}</div>
          )}
        </div>
      )}
      {value && (
        <p className="catalog-combo-foot">
          Selecionada: <strong>{hintName || rows.find((c) => c.id === value)?.name || '—'}</strong>
          <button type="button" className="btn btn-ghost catalog-combo-clear" onClick={() => onChange('', undefined)}>
            Limpar
          </button>
        </p>
      )}
    </div>
  );
}

type CustomerGroupRow = { id: string; name: string };

/**
 * Grupo de clientes — mesma UX da categoria de produtos (pesquisar / + Cadastrar).
 * O valor persistido no cliente é o nome do grupo (`Customer.segment`).
 */
export function CustomerGroupSearchCombo({
  id,
  value,
  onChange,
  disabled,
}: {
  id: string;
  /** Nome do grupo (segmento) selecionado. */
  value: string;
  onChange: (groupName: string) => void;
  disabled?: boolean;
}) {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (value) setQ(value);
    else setQ('');
  }, [value]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const searchQ = useDeferredValue(q);
  const isFiltering = open && q !== searchQ;

  const list = useQuery({
    queryKey: ['customer-groups', 'search', searchQ],
    queryFn: () => api<CustomerGroupRow[]>(`/customer-groups?q=${encodeURIComponent(searchQ)}`),
    enabled: open,
    staleTime: 10_000,
  });

  const create = useMutation({
    mutationFn: (name: string) =>
      api<CustomerGroupRow>('/customer-groups', { method: 'POST', json: { name } }),
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ['customer-groups'] });
      onChange(row.name);
      setQ(row.name);
      setOpen(false);
    },
  });

  const rows = list.data ?? [];
  const term = q.trim();
  const showLoading = (list.isFetching && rows.length === 0) || isFiltering;
  const canCreate =
    term.length > 0 &&
    !rows.some((g) => g.name.toLowerCase() === term.toLowerCase()) &&
    !create.isPending;

  const panelAbove = useCatalogPanelAbove(
    open,
    wrapRef,
    searchQ,
    rows.length,
    showLoading,
    canCreate,
    term,
    value,
    create.isPending,
  );

  return (
    <div className="catalog-combo" ref={wrapRef}>
      <input
        id={id}
        type="text"
        autoComplete="off"
        disabled={disabled}
        placeholder="Pesquisar ou cadastrar grupo…"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          if (value) onChange('');
        }}
        onFocus={() => setOpen(true)}
        aria-label="Grupo de clientes: pesquisar ou cadastrar"
      />
      {open && (
        <div
          className={
            'catalog-combo-panel catalog-combo-panel--raised' + (panelAbove ? ' catalog-combo-panel--above' : '')
          }
          role="listbox"
        >
          {term.length === 0 && !showLoading && rows.length > 0 && (
            <div className="catalog-combo-hint">Digite para filtrar ou clique em um grupo abaixo.</div>
          )}
          {showLoading && <div className="catalog-combo-empty">Buscando grupos…</div>}
          {!showLoading &&
            rows.map((g) => (
              <button
                key={g.id}
                type="button"
                className="catalog-combo-option"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(g.name);
                  setQ(g.name);
                  setOpen(false);
                }}
              >
                {g.name}
              </button>
            ))}
          {!showLoading && !rows.length && term.length > 0 && (
            <div className="catalog-combo-empty">
              Nenhum grupo para «{term}». Cadastre um novo com o botão abaixo ou ajuste o termo.
            </div>
          )}
          {!showLoading && !rows.length && term.length === 0 && (
            <div className="catalog-combo-empty">Nenhum grupo cadastrado ainda. Digite um nome e cadastre.</div>
          )}
          {canCreate && (
            <button
              type="button"
              className="catalog-combo-create"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => create.mutate(term)}
              disabled={create.isPending}
            >
              + Cadastrar &quot;{term}&quot;
            </button>
          )}
          {create.isError && (
            <div className="catalog-combo-error">{(create.error as Error).message}</div>
          )}
        </div>
      )}
      {value && (
        <p className="catalog-combo-foot">
          Selecionado: <strong>{value}</strong>
          <button type="button" className="btn btn-ghost catalog-combo-clear" onClick={() => onChange('')}>
            Limpar
          </button>
        </p>
      )}
    </div>
  );
}

type SupplierRow = {
  id: string;
  legalName: string;
  tradeName: string | null;
  document: string | null;
};

function supplierOptionLabel(s: SupplierRow) {
  const bits: string[] = [s.legalName];
  if (s.tradeName) bits.push(s.tradeName);
  if (s.document) bits.push(s.document);
  return bits.join(' · ');
}

export function SupplierSearchCombo({
  id,
  value,
  onChange,
  hintName,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (supplierId: string, pickedLegalName?: string) => void;
  hintName?: string | null;
  disabled?: boolean;
}) {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Mostra o nome sugerido mesmo sem id (ex.: emitente da NF-e ainda não cadastrado).
    if (hintName) setQ(hintName);
    else if (!value) setQ('');
  }, [hintName, value]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const list = useQuery({
    queryKey: ['suppliers', 'search', q],
    queryFn: () => api<SupplierRow[]>(`/suppliers?q=${encodeURIComponent(q)}`),
    enabled: open,
  });

  const create = useMutation({
    mutationFn: (legalName: string) =>
      api<SupplierRow>('/suppliers', { method: 'POST', json: { legalName } }),
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ['suppliers'] });
      onChange(row.id, row.legalName);
      setQ(supplierOptionLabel(row));
      setOpen(false);
    },
  });

  const rows = list.data ?? [];
  const term = q.trim();
  const canCreate =
    term.length > 0 &&
    !rows.some((s) => s.legalName.toLowerCase() === term.toLowerCase()) &&
    !create.isPending;

  const panelAbove = useCatalogPanelAbove(
    open,
    wrapRef,
    q,
    rows.length,
    list.isLoading,
    canCreate,
    term,
    value,
    create.isPending,
  );

  return (
    <div className="catalog-combo" ref={wrapRef}>
      <input
        id={id}
        type="text"
        autoComplete="off"
        disabled={disabled}
        placeholder="Razão social, fantasia ou CNPJ — pesquisar ou cadastrar…"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          if (value) onChange('', undefined);
        }}
        onFocus={() => setOpen(true)}
        aria-label="Fornecedor: pesquisar ou cadastrar"
      />
      {open && (
        <div
          className={
            'catalog-combo-panel catalog-combo-panel--raised' + (panelAbove ? ' catalog-combo-panel--above' : '')
          }
          role="listbox"
        >
          {list.isLoading && <div className="catalog-combo-empty">Carregando…</div>}
          {!list.isLoading &&
            rows.map((s) => (
              <button
                key={s.id}
                type="button"
                className="catalog-combo-option"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(s.id, s.legalName);
                  setQ(supplierOptionLabel(s));
                  setOpen(false);
                }}
              >
                {supplierOptionLabel(s)}
              </button>
            ))}
          {!list.isLoading && !rows.length && term.length > 0 && (
            <div className="catalog-combo-empty">Nenhum fornecedor encontrado.</div>
          )}
          {canCreate && (
            <button
              type="button"
              className="catalog-combo-create"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => create.mutate(term)}
              disabled={create.isPending}
            >
              + Cadastrar fornecedor &quot;{term}&quot;
            </button>
          )}
          {create.isError && (
            <div className="catalog-combo-error">{(create.error as Error).message}</div>
          )}
        </div>
      )}
      {!value && hintName ? (
        <p className="catalog-combo-foot">
          Sugestão da NF-e: <strong>{hintName}</strong> — ainda não vinculado ao cadastro.
        </p>
      ) : null}
      {value && (
        <p className="catalog-combo-foot">
          Selecionado:{' '}
          <strong>{hintName || rows.find((s) => s.id === value)?.legalName || '—'}</strong>
          <button type="button" className="btn btn-ghost catalog-combo-clear" onClick={() => onChange('', undefined)}>
            Limpar
          </button>
        </p>
      )}
    </div>
  );
}

type NcmRow = { id: string; code: string; description: string | null };
type CestRow = { id: string; code: string; description: string };
type TaxRow = { id: string; code: string; description: string };

export function FiscalCodeSearchCombo({
  kind,
  id,
  label,
  value,
  onChange,
  hintLabel,
  ncmHint,
  disabled,
}: {
  kind: 'ncm' | 'cest' | 'tax-units';
  id: string;
  label: string;
  value: string;
  onChange: (code: string) => void;
  hintLabel?: string | null;
  /** primeiros dígitos do NCM para filtrar CEST */
  ncmHint?: string | null;
  disabled?: boolean;
}) {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [cestDesc, setCestDesc] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Unidades: o valor selecionado fica no rodapé; o campo de busca não deve
    // filtrar a lista pelo código atual (senão só aparece "UN" e parece “vazia”).
    if (kind === 'tax-units') {
      if (!open) {
        setQ(value ? hintLabel || value : '');
      }
      return;
    }
    if (hintLabel && value) setQ(hintLabel);
    else if (!value) setQ('');
  }, [hintLabel, value, kind, open]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const path =
    kind === 'ncm' ? 'ncm' : kind === 'cest' ? 'cest' : 'tax-units';
  const hintParam =
    kind === 'cest' && ncmHint
      ? `&ncmHint=${encodeURIComponent(ncmHint.replace(/\D/g, '').slice(0, 8))}`
      : '';

  const list = useQuery({
    queryKey: ['fiscal-codes', path, q, ncmHint ?? ''],
    queryFn: () =>
      api(`/fiscal-codes/${path}?q=${encodeURIComponent(q)}${hintParam}`) as Promise<
        NcmRow[] | CestRow[] | TaxRow[]
      >,
    enabled: open,
  });

  const create = useMutation({
    mutationFn: () => {
      if (kind === 'ncm') {
        const digits = q.replace(/\D/g, '').slice(0, 8);
        return api<NcmRow>('/fiscal-codes/ncm', {
          method: 'POST',
          json: { code: digits, description: null },
        });
      }
      if (kind === 'cest') {
        const digits = q.replace(/\D/g, '').slice(0, 7);
        const desc = (cestDesc || q.replace(/^\d+\s*/, '').trim()) || `CEST ${digits}`;
        return api<CestRow>('/fiscal-codes/cest', {
          method: 'POST',
          json: {
            code: digits,
            description: desc,
            ncmHint: ncmHint ? ncmHint.replace(/\D/g, '').slice(0, 4) : null,
          },
        });
      }
      const parts = q.trim().split(/\s+/);
      const code = (parts[0] || '').toUpperCase().slice(0, 10);
      const description = parts.slice(1).join(' ').trim() || code;
      return api<TaxRow>('/fiscal-codes/tax-units', {
        method: 'POST',
        json: { code, description },
      });
    },
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ['fiscal-codes', path] });
      onChange(row.code);
      const desc = 'description' in row && row.description ? row.description : '';
      setQ(desc ? `${row.code} — ${desc}` : row.code);
      setCestDesc('');
      setOpen(false);
    },
  });

  const rows = (list.data ?? []) as Array<NcmRow | CestRow | TaxRow>;

  function rowLabel(r: NcmRow | CestRow | TaxRow) {
    const d = 'description' in r ? r.description : null;
    return d ? `${r.code} — ${d}` : r.code;
  }

  const term = q.trim();
  let canCreate = term.length > 0 && !create.isPending;
  if (kind === 'ncm') {
    const d = term.replace(/\D/g, '');
    canCreate = canCreate && d.length === 8 && !rows.some((r) => r.code === d);
  } else if (kind === 'cest') {
    const d = term.replace(/\D/g, '').slice(0, 7);
    const descOk = (cestDesc || term.replace(/^\d+\s*/, '').trim()).length > 0;
    canCreate = canCreate && d.length === 7 && descOk && !rows.some((r) => r.code === d);
  } else {
    const code = term.split(/\s+/)[0]?.toUpperCase() ?? '';
    canCreate = canCreate && code.length > 0 && !rows.some((r) => r.code === code);
  }

  const panelAbove = useCatalogPanelAbove(
    open,
    wrapRef,
    kind,
    q,
    rows.length,
    list.isLoading,
    canCreate,
    term,
    value,
    cestDesc,
    ncmHint,
    create.isPending,
  );

  return (
    <div className="catalog-combo" ref={wrapRef}>
      <input
        id={id}
        type="text"
        autoComplete="off"
        disabled={disabled}
        aria-label={label}
        placeholder={
          kind === 'tax-units'
            ? 'Ex.: UN Unidade'
            : kind === 'ncm'
              ? '8 dígitos ou descrição…'
              : '7 dígitos ou descrição…'
        }
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          if (value) onChange('');
        }}
        onFocus={() => {
          setOpen(true);
          // Ao focar em unidades, abre a lista completa (filtrar digitando).
          if (kind === 'tax-units') setQ('');
        }}
      />
      {kind === 'cest' && open && (
        <div className="field catalog-combo-nested">
          <label htmlFor={`${id}-cest-desc`}>Descrição (para novo CEST)</label>
          <input
            id={`${id}-cest-desc`}
            value={cestDesc}
            onChange={(e) => setCestDesc(e.target.value)}
            placeholder="Obrigatório ao cadastrar novo CEST"
          />
        </div>
      )}
      {open && (
        <div
          className={
            'catalog-combo-panel catalog-combo-panel--raised' + (panelAbove ? ' catalog-combo-panel--above' : '')
          }
          role="listbox"
        >
          {kind === 'tax-units' && !list.isLoading && (
            <div className="catalog-combo-hint">Digite para filtrar ou escolha uma unidade abaixo.</div>
          )}
          {list.isLoading && <div className="catalog-combo-empty">Carregando…</div>}
          {list.isError && (
            <div className="catalog-combo-error">{(list.error as Error).message}</div>
          )}
          {!list.isLoading &&
            !list.isError &&
            rows.map((r) => (
              <button
                key={r.id}
                type="button"
                className="catalog-combo-option"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(r.code);
                  setQ(rowLabel(r));
                  setOpen(false);
                }}
              >
                {rowLabel(r)}
              </button>
            ))}
          {!list.isLoading && !list.isError && !rows.length && (
            <div className="catalog-combo-empty">
              {term.length > 0 ? 'Nenhum registro.' : 'Nenhuma unidade cadastrada.'}
            </div>
          )}
          {canCreate && (
            <button
              type="button"
              className="catalog-combo-create"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => create.mutate()}
              disabled={create.isPending}
            >
              {kind === 'ncm' && `+ Cadastrar NCM ${term.replace(/\D/g, '').slice(0, 8)}`}
              {kind === 'cest' && `+ Cadastrar CEST ${term.replace(/\D/g, '').slice(0, 7)}`}
              {kind === 'tax-units' && '+ Cadastrar unidade'}
            </button>
          )}
          {create.isError && (
            <div className="catalog-combo-error">{(create.error as Error).message}</div>
          )}
        </div>
      )}
      {value && (
        <p className="catalog-combo-foot">
          Código: <strong>{value}</strong>
          <button type="button" className="btn btn-ghost catalog-combo-clear" onClick={() => onChange('')}>
            Limpar
          </button>
        </p>
      )}
    </div>
  );
}

export const FISCAL_ORIGIN_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '0', label: '0 — Nacional' },
  { value: '1', label: '1 — Estrangeira — importação direta' },
  { value: '2', label: '2 — Estrangeira — adquirida no mercado interno' },
  { value: '3', label: '3 — Nacional com mais de 40% de conteúdo estrangeiro' },
  { value: '4', label: '4 — Nacional conforme processos produtivos básicos' },
  { value: '5', label: '5 — Nacional com menos de 40% de conteúdo estrangeiro' },
  { value: '6', label: '6 — Estrangeira — importação direta sem similar nacional' },
  { value: '7', label: '7 — Estrangeira — mercado interno sem similar nacional' },
  { value: '8', label: '8 — Nacional — importação acima de 70%' },
];
