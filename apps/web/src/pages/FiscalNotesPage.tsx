/**
 * Módulo Notas Fiscais — listagem NFC-e / NF-e, filtros combináveis, impressões e detalhe.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CrudToolbar } from '../components/CrudToolbar';
import { FormModalBackdrop } from '../components/FormModalBackdrop';
import { ListPagination, LIST_PAGE_SIZE } from '../components/ListPagination';
import { ModuleReportsModal } from '../components/ModuleReportsModal';
import { ReportPrintSticker } from '../components/ReportPrintSticker';
import {
  RecordViewModal,
  RecordViewSections,
  type RecordViewSection,
} from '../components/RecordViewModal';
import { api } from '../lib/api';
import { formatBRL, formatDate } from '../lib/format';

type TabKind = 'NFC_E' | 'NF_E';

type FiscalDocRow = {
  id: string;
  saleId: string;
  kind: TabKind;
  status: string;
  accessKey: string | null;
  protocol: string | null;
  tpEmis: number;
  xmlPath?: string | null;
  lastError: string | null;
  createdAt: string;
  sale: {
    id: string;
    number: number;
    total: string;
    createdAt: string;
    customerId: string | null;
    customer: { id: string; name: string; document: string | null; segment: string | null } | null;
  };
};

type ListResponse = { total: number; take: number; skip: number; items: FiscalDocRow[] };

type CustomerOpt = { id: string; name: string; segment: string | null };
type CategoryOpt = { id: string; name: string };
type ProductOpt = { id: string; name: string };

type Filters = {
  dateFrom: string;
  dateTo: string;
  controlMin: string;
  controlMax: string;
  customerId: string;
  customerSegment: string;
  authorized: boolean;
  contingency: boolean;
};

const EMPTY_FILTERS: Filters = {
  dateFrom: '',
  dateTo: '',
  controlMin: '',
  controlMax: '',
  customerId: '',
  customerSegment: '',
  authorized: false,
  contingency: false,
};

function statusLabel(s: string): string {
  switch (s) {
    case 'AUTHORIZED':
      return 'Autorizada';
    case 'CONTINGENCY':
      return 'Contingência';
    case 'QUEUED':
      return 'Na fila';
    case 'BUILDING_XML':
      return 'Gerando XML';
    case 'SENT':
      return 'Enviada';
    case 'REJECTED':
      return 'Rejeitada';
    case 'ERROR':
      return 'Erro';
    case 'CANCELLED':
      return 'Cancelada';
    default:
      return s;
  }
}

function statusClass(s: string): string {
  switch (s) {
    case 'AUTHORIZED':
      return 'badge badge-success';
    case 'CONTINGENCY':
      return 'badge badge-warn';
    case 'REJECTED':
    case 'ERROR':
      return 'badge badge-danger';
    case 'CANCELLED':
      return 'badge badge-muted';
    default:
      return 'badge';
  }
}

function buildQuery(kind: TabKind, f: Filters, page: number): string {
  const p = new URLSearchParams();
  p.set('kind', kind);
  p.set('take', String(LIST_PAGE_SIZE));
  p.set('skip', String((page - 1) * LIST_PAGE_SIZE));
  if (f.dateFrom) p.set('dateFrom', f.dateFrom);
  if (f.dateTo) p.set('dateTo', f.dateTo);
  if (f.controlMin.trim()) p.set('controlMin', f.controlMin.trim());
  if (f.controlMax.trim()) p.set('controlMax', f.controlMax.trim());
  if (f.customerId) p.set('customerId', f.customerId);
  if (f.customerSegment.trim()) p.set('customerSegment', f.customerSegment.trim());
  if (f.authorized) p.set('authorized', '1');
  if (f.contingency) p.set('contingency', '1');
  return p.toString();
}

export function FiscalNotesPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = (searchParams.get('tab') === 'NF_E' ? 'NF_E' : 'NFC_E') as TabKind;
  const [tab, setTab] = useState<TabKind>(initialTab);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<Filters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [reportsOpen, setReportsOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [viewId, setViewId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const qs = useMemo(() => buildQuery(tab, applied, page), [tab, applied, page]);

  const list = useQuery({
    queryKey: ['fiscal', 'documents', qs],
    queryFn: () => api<ListResponse>(`/fiscal/documents?${qs}`),
  });

  const customers = useQuery({
    queryKey: ['customers', 'fiscal-notes'],
    queryFn: () => api<CustomerOpt[]>('/customers'),
  });

  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: () => api<CategoryOpt[]>('/categories'),
  });

  const products = useQuery({
    queryKey: ['products', 'brief'],
    queryFn: () => api<Array<{ id: string; name: string }>>('/products'),
  });

  const detail = useQuery({
    queryKey: ['fiscal', 'documents', viewId ?? openId],
    queryFn: () => api<FiscalDocRow & { sale: FiscalDocRow['sale'] & { items?: unknown[]; payments?: unknown[] } }>(
      `/fiscal/documents/${viewId ?? openId}`,
    ),
    enabled: Boolean(viewId || openId),
  });

  const sendContingency = useMutation({
    mutationFn: (id: string) =>
      api(`/fiscal/documents/${id}/send-contingency`, { method: 'POST', json: {} }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fiscal', 'documents'] });
    },
  });

  const cancelDoc = useMutation({
    mutationFn: ({ id, xJust }: { id: string; xJust: string }) =>
      api(`/fiscal/documents/${id}/cancel`, {
        method: 'POST',
        json: { xJust },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fiscal', 'documents'] });
      setViewId(null);
      setOpenId(null);
    },
  });

  const inutilizar = useMutation({
    mutationFn: (body: {
      kind: TabKind;
      serie: number;
      nNFIni: number;
      nNFFin: number;
      xJust: string;
    }) => api('/fiscal/documents/inutilizar', { method: 'POST', json: body }),
  });

  const [inutOpen, setInutOpen] = useState(false);
  const [inutForm, setInutForm] = useState({
    serie: '1',
    nNFIni: '',
    nNFFin: '',
    xJust: '',
  });
  const [inutMsg, setInutMsg] = useState<string | null>(null);

  const segments = useMemo(() => {
    const set = new Set<string>();
    for (const c of customers.data ?? []) {
      if (c.segment?.trim()) set.add(c.segment.trim());
    }
    return [...set].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [customers.data]);

  const total = list.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / LIST_PAGE_SIZE));

  function switchTab(next: TabKind) {
    setTab(next);
    setPage(1);
    setSelectedId(null);
    setSearchParams(next === 'NF_E' ? { tab: 'NF_E' } : {}, { replace: true });
  }

  function applyFilters() {
    setApplied({ ...filters });
    setPage(1);
  }

  function clearFilters() {
    setFilters(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
    setPage(1);
  }

  const rows = list.data?.items ?? [];

  return (
    <div className="page print-area">
      <h1 className="page-title">Notas Fiscais</h1>
      <p className="page-desc">
        NFC-e (modelo 65) e NF-e (modelo 55) emitidas a partir das vendas. Use o filtro para combinar período,
        controle, cliente e situação (autorizadas / contingências). Contingências podem ser reenviadas à SEFAZ.
      </p>

      <nav className="stock-subnav no-print" aria-label="Tipo de documento">
        <button
          type="button"
          className={tab === 'NFC_E' ? 'active' : ''}
          onClick={() => switchTab('NFC_E')}
        >
          NFC-e
        </button>
        <button
          type="button"
          className={tab === 'NF_E' ? 'active' : ''}
          onClick={() => switchTab('NF_E')}
        >
          NF-e
        </button>
      </nav>

      <CrudToolbar
        onPrint={() => window.print()}
        onReports={() => setReportsOpen(true)}
        onInclude={() => {
          setInutMsg(null);
          setInutOpen(true);
        }}
        includeLabel="Inutilizar numeração"
        leadingPrimary={
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setFiltersOpen((o) => !o)}
          >
            {filtersOpen ? 'Ocultar filtro' : 'Filtro'}
          </button>
        }
      />

      <ModuleReportsModal
        open={reportsOpen}
        title="Notas Fiscais — Impressões"
        wide
        compactLauncher
        onClose={() => setReportsOpen(false)}
      >
        <FiscalNotesReportsPanel
          kind={tab}
          customers={customers.data ?? []}
          categories={categories.data ?? []}
          products={(products.data ?? []) as ProductOpt[]}
          selectedId={selectedId}
          onClose={() => setReportsOpen(false)}
        />
      </ModuleReportsModal>

      {filtersOpen && (
        <details className="submenu-details no-print" open>
          <summary className="submenu-summary">Filtro</summary>
          <div className="submenu-body">
            <div className="form-row form-row--4">
              <div className="field">
                <label htmlFor="fn-df">Data mín.</label>
                <input
                  id="fn-df"
                  type="date"
                  value={filters.dateFrom}
                  onChange={(e) => setFilters((f) => ({ ...f, dateFrom: e.target.value }))}
                />
              </div>
              <div className="field">
                <label htmlFor="fn-dt">Data máx.</label>
                <input
                  id="fn-dt"
                  type="date"
                  value={filters.dateTo}
                  onChange={(e) => setFilters((f) => ({ ...f, dateTo: e.target.value }))}
                />
              </div>
              <div className="field">
                <label htmlFor="fn-cmin">Controle mín.</label>
                <input
                  id="fn-cmin"
                  type="number"
                  min={1}
                  value={filters.controlMin}
                  onChange={(e) => setFilters((f) => ({ ...f, controlMin: e.target.value }))}
                />
              </div>
              <div className="field">
                <label htmlFor="fn-cmax">Controle máx.</label>
                <input
                  id="fn-cmax"
                  type="number"
                  min={1}
                  value={filters.controlMax}
                  onChange={(e) => setFilters((f) => ({ ...f, controlMax: e.target.value }))}
                />
              </div>
            </div>
            <div className="form-row form-row--2">
              <div className="field">
                <label htmlFor="fn-cli">Cliente</label>
                <select
                  id="fn-cli"
                  value={filters.customerId}
                  onChange={(e) => setFilters((f) => ({ ...f, customerId: e.target.value }))}
                >
                  <option value="">— Todos —</option>
                  {(customers.data ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="fn-grp">Grupo de clientes</label>
                <input
                  id="fn-grp"
                  list="fn-segments"
                  value={filters.customerSegment}
                  onChange={(e) => setFilters((f) => ({ ...f, customerSegment: e.target.value }))}
                  placeholder="Segmento / grupo"
                />
                <datalist id="fn-segments">
                  {segments.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              </div>
            </div>
            <div className="inline-checks" style={{ marginBottom: '0.65rem' }}>
              <label>
                <input
                  type="checkbox"
                  checked={filters.authorized}
                  onChange={(e) => setFilters((f) => ({ ...f, authorized: e.target.checked }))}
                />
                Autorizadas
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={filters.contingency}
                  onChange={(e) => setFilters((f) => ({ ...f, contingency: e.target.checked }))}
                />
                Contingências
              </label>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-primary" onClick={applyFilters}>
                Aplicar filtro
              </button>
              <button type="button" className="btn btn-secondary" onClick={clearFilters}>
                Limpar
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => window.print()}>
                Imprimir resultado
              </button>
            </div>
          </div>
        </details>
      )}

      <ReportPrintSticker
        documentTitle={`Notas Fiscais — ${tab === 'NFC_E' ? 'NFC-e' : 'NF-e'}`}
        documentExtras={
          <p className="print-sub page-desc" style={{ marginBottom: 0 }}>
            {total} registro(s) · filtros aplicados na listagem
          </p>
        }
      />

      {list.isError && (
        <div className="alert alert-error">{(list.error as Error).message}</div>
      )}

      <div className="table-wrap" style={{ marginTop: '0.75rem' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th className="num">Controle</th>
              <th>Data</th>
              <th>Cliente</th>
              <th>Situação</th>
              <th>Chave / protocolo</th>
              <th className="num">Total</th>
              <th className="col-actions no-print">Ações</th>
            </tr>
          </thead>
          <tbody>
            {list.isLoading && (
              <tr>
                <td colSpan={7} className="empty">
                  Carregando…
                </td>
              </tr>
            )}
            {!list.isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={7} className="empty">
                  Nenhuma nota encontrada para {tab === 'NFC_E' ? 'NFC-e' : 'NF-e'} com os filtros atuais.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr
                key={r.id}
                className={selectedId === r.id ? 'is-selected' : undefined}
                onClick={() => setSelectedId(r.id)}
              >
                <td className="num">{r.sale.number}</td>
                <td>{formatDate(r.sale.createdAt)}</td>
                <td>{r.sale.customer?.name ?? 'Consumidor'}</td>
                <td>
                  <span className={statusClass(r.status)}>{statusLabel(r.status)}</span>
                  {r.tpEmis > 1 ? (
                    <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                      tpEmis {r.tpEmis}
                    </div>
                  ) : null}
                </td>
                <td style={{ fontSize: '0.78rem', wordBreak: 'break-all' }}>
                  {r.accessKey ?? '—'}
                  {r.protocol ? <div>Prot. {r.protocol}</div> : null}
                  {r.lastError ? (
                    <div style={{ color: '#b91c1c' }}>{r.lastError.slice(0, 80)}</div>
                  ) : null}
                </td>
                <td className="num">{formatBRL(Number(r.sale.total))}</td>
                <td className="col-actions no-print">
                  <div className="row-record-actions">
                    <button
                      type="button"
                      className="btn btn-secondary btn-compact"
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenId(r.id);
                      }}
                    >
                      Abrir
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-compact"
                      onClick={(e) => {
                        e.stopPropagation();
                        setViewId(r.id);
                      }}
                    >
                      Visualizar
                    </button>
                    {r.status === 'CONTINGENCY' && (
                      <button
                        type="button"
                        className="btn btn-primary btn-compact"
                        disabled={sendContingency.isPending}
                        onClick={(e) => {
                          e.stopPropagation();
                          sendContingency.mutate(r.id);
                        }}
                      >
                        Enviar SEFAZ
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ListPagination
        page={page}
        totalPages={totalPages}
        totalItems={total}
        onPageChange={setPage}
        itemLabel="nota(s)"
      />

      {viewId && !openId && (
        <RecordViewModal
          open
          wide
          title="Nota fiscal — visualização"
          onClose={() => setViewId(null)}
          loading={detail.isLoading}
          error={detail.isError ? (detail.error as Error).message : null}
          sections={detail.data ? fiscalNoteViewSections(detail.data) : []}
        />
      )}

      {openId && (
        <FormModalBackdrop
          className="modal-backdrop--wide"
          onClose={() => {
            setOpenId(null);
          }}
        >
          <div className="modal modal--wide" role="dialog">
            <h2>Cadastro da nota</h2>
            {detail.isLoading && <p>Carregando…</p>}
            {detail.isError && (
              <div className="alert alert-error">{(detail.error as Error).message}</div>
            )}
            {detail.data && (
              <FiscalNoteDetail
                doc={detail.data}
                editable
                onSendContingency={() => sendContingency.mutate(detail.data!.id)}
                sending={sendContingency.isPending}
                onCancel={() => {
                  const xJust = window.prompt(
                    'Justificativa do cancelamento (mín. 15 caracteres):',
                    'Cancelamento solicitado pelo emitente no GestorVend.',
                  );
                  if (!xJust || xJust.trim().length < 15) return;
                  cancelDoc.mutate({ id: detail.data!.id, xJust: xJust.trim() });
                }}
                cancelling={cancelDoc.isPending}
                onPrintSecondCopy={() =>
                  navigate(`/vendas/impressao?id=${encodeURIComponent(detail.data!.saleId)}`)
                }
              />
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setOpenId(null)}
              >
                Fechar
              </button>
              {detail.data && (
                <Link
                  className="btn btn-primary"
                  to={`/vendas`}
                  onClick={() => setOpenId(null)}
                >
                  Ir para Vendas
                </Link>
              )}
            </div>
          </div>
        </FormModalBackdrop>
      )}

      {inutOpen && (
        <FormModalBackdrop onClose={() => setInutOpen(false)}>
          <div className="modal" role="dialog">
            <h2>Inutilizar numeração ({tab === 'NFC_E' ? 'NFC-e' : 'NF-e'})</h2>
            <p className="page-desc">
              Envia inutilização à SEFAZ para faixa não usada. Requer `FISCAL_EMIT_TRANSPORT=soap` e
              certificado A1.
            </p>
            {inutMsg && (
              <div className={inutilizar.isError ? 'alert alert-error' : 'alert alert-success'}>
                {inutMsg}
              </div>
            )}
            <label className="field">
              <span>Série</span>
              <input
                value={inutForm.serie}
                onChange={(e) => setInutForm((f) => ({ ...f, serie: e.target.value }))}
              />
            </label>
            <label className="field">
              <span>Número inicial</span>
              <input
                value={inutForm.nNFIni}
                onChange={(e) => setInutForm((f) => ({ ...f, nNFIni: e.target.value }))}
              />
            </label>
            <label className="field">
              <span>Número final</span>
              <input
                value={inutForm.nNFFin}
                onChange={(e) => setInutForm((f) => ({ ...f, nNFFin: e.target.value }))}
              />
            </label>
            <label className="field">
              <span>Justificativa (mín. 15)</span>
              <textarea
                rows={3}
                value={inutForm.xJust}
                onChange={(e) => setInutForm((f) => ({ ...f, xJust: e.target.value }))}
              />
            </label>
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setInutOpen(false)}>
                Fechar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={inutilizar.isPending}
                onClick={() => {
                  setInutMsg(null);
                  inutilizar.mutate(
                    {
                      kind: tab,
                      serie: Number(inutForm.serie),
                      nNFIni: Number(inutForm.nNFIni),
                      nNFFin: Number(inutForm.nNFFin),
                      xJust: inutForm.xJust.trim(),
                    },
                    {
                      onSuccess: (res) => {
                        setInutMsg(
                          `Inutilização OK${(res as { nProt?: string }).nProt ? ` — prot ${(res as { nProt?: string }).nProt}` : ''}.`,
                        );
                      },
                      onError: (e: Error) => setInutMsg(e.message),
                    },
                  );
                }}
              >
                {inutilizar.isPending ? 'Enviando…' : 'Enviar à SEFAZ'}
              </button>
            </div>
          </div>
        </FormModalBackdrop>
      )}
    </div>
  );
}

function fiscalNoteViewSections(
  doc: FiscalDocRow & {
    sale: FiscalDocRow['sale'] & {
      items?: Array<Record<string, unknown>>;
      payments?: unknown[];
    };
  },
): RecordViewSection[] {
  const items = (doc.sale.items ?? []) as Array<{
    quantity: string;
    unitPrice: string;
    totalLine: string;
    variant?: { sku?: string; product?: { name?: string } };
  }>;

  const sections: RecordViewSection[] = [
    {
      title: 'Dados da nota',
      fields: [
        { label: 'Controle', value: doc.sale.number },
        { label: 'Tipo', value: doc.kind === 'NFC_E' ? 'NFC-e' : 'NF-e' },
        {
          label: 'Situação',
          value: <span className={statusClass(doc.status)}>{statusLabel(doc.status)}</span>,
        },
        { label: 'Cliente', value: doc.sale.customer?.name ?? 'Consumidor' },
        { label: 'Data', value: formatDate(doc.sale.createdAt) },
        { label: 'Total', value: formatBRL(Number(doc.sale.total)) },
        { label: 'Chave', value: doc.accessKey },
        { label: 'Protocolo', value: doc.protocol },
        { label: 'XML', value: doc.xmlPath },
      ],
    },
  ];

  if (items.length > 0) {
    sections.push({
      title: 'Itens',
      columns: [
        'Produto',
        { label: 'Qtd', num: true },
        { label: 'Unit.', num: true },
        { label: 'Total', num: true },
      ],
      rows: items.map((it) => [
        <>
          {it.variant?.product?.name ?? '—'}
          {it.variant?.sku ? (
            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
              {it.variant.sku}
            </div>
          ) : null}
        </>,
        Number(it.quantity).toLocaleString('pt-BR'),
        formatBRL(Number(it.unitPrice)),
        formatBRL(Number(it.totalLine)),
      ]),
    });
  }

  return sections;
}

function FiscalNoteDetail({
  doc,
  editable,
  onSendContingency,
  sending,
  onCancel,
  cancelling,
  onPrintSecondCopy,
}: {
  doc: FiscalDocRow & { sale: FiscalDocRow['sale'] & { items?: Array<Record<string, unknown>>; payments?: unknown[] } };
  editable: boolean;
  onSendContingency: () => void;
  sending: boolean;
  onCancel: () => void;
  cancelling: boolean;
  onPrintSecondCopy: () => void;
}) {
  return (
    <div>
      <RecordViewSections sections={fiscalNoteViewSections(doc)} />

      {editable && (
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.75rem' }}>
          {doc.status === 'CONTINGENCY' && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={sending}
              onClick={onSendContingency}
            >
              {sending ? 'Enfileirando…' : 'Enviar contingência à SEFAZ'}
            </button>
          )}
          {doc.status !== 'CANCELLED' && (
            <button
              type="button"
              className="btn btn-danger"
              disabled={cancelling}
              onClick={onCancel}
            >
              {cancelling ? 'Cancelando…' : 'Cancelar nota'}
            </button>
          )}
          <button type="button" className="btn btn-secondary" onClick={onPrintSecondCopy}>
            Segunda via (cupom)
          </button>
        </div>
      )}
    </div>
  );
}

function FiscalNotesReportsPanel({
  kind,
  customers,
  categories,
  products,
  selectedId,
  onClose,
}: {
  kind: TabKind;
  customers: CustomerOpt[];
  categories: CategoryOpt[];
  products: ProductOpt[];
  selectedId: string | null;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const [printKind, setPrintKind] = useState<
    'customer' | 'product' | 'category' | 'period' | 'cfop' | 'second'
  >('customer');
  const [customerId, setCustomerId] = useState('');
  const [productId, setProductId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [cfop, setCfop] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  function openPrint() {
    const p = new URLSearchParams();
    p.set('kind', kind);
    p.set('report', printKind);
    if (customerId) p.set('customerId', customerId);
    if (productId) p.set('productId', productId);
    if (categoryId) p.set('categoryId', categoryId);
    if (cfop.trim()) p.set('cfop', cfop.trim());
    if (dateFrom) p.set('dateFrom', dateFrom);
    if (dateTo) p.set('dateTo', dateTo);
    if (printKind === 'second') {
      if (!selectedId) {
        window.alert('Selecione uma nota na listagem antes de imprimir a segunda via.');
        return;
      }
      p.set('documentId', selectedId);
    }
    onClose();
    navigate(`/notas-fiscais/impressao?${p.toString()}`);
  }

  return (
    <div>
      <details className="submenu-details" open>
        <summary className="submenu-summary">Impressões</summary>
        <div className="submenu-body">
          <div className="field">
            <label htmlFor="fn-rep">Tipo de impressão</label>
            <select
              id="fn-rep"
              value={printKind}
              onChange={(e) => setPrintKind(e.target.value as typeof printKind)}
            >
              <option value="customer">Notas por cliente</option>
              <option value="product">Por produtos</option>
              <option value="category">Por categoria de produtos</option>
              <option value="period">Por período</option>
              <option value="cfop">Por CFOP</option>
              <option value="second">Segunda via (nota selecionada)</option>
            </select>
          </div>

          {printKind === 'customer' && (
            <div className="field">
              <label htmlFor="fn-rep-cli">Cliente</label>
              <select
                id="fn-rep-cli"
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
              >
                <option value="">— Selecione —</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {printKind === 'product' && (
            <div className="field">
              <label htmlFor="fn-rep-prod">Produto</label>
              <select
                id="fn-rep-prod"
                value={productId}
                onChange={(e) => setProductId(e.target.value)}
              >
                <option value="">— Todos (linhas das notas filtradas) —</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {printKind === 'category' && (
            <div className="field">
              <label htmlFor="fn-rep-cat">Categoria</label>
              <select
                id="fn-rep-cat"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
              >
                <option value="">— Selecione —</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {printKind === 'cfop' && (
            <div className="field">
              <label htmlFor="fn-rep-cfop">CFOP</label>
              <input
                id="fn-rep-cfop"
                value={cfop}
                onChange={(e) => setCfop(e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="Ex.: 5102"
              />
            </div>
          )}

          {(printKind === 'period' ||
            printKind === 'product' ||
            printKind === 'category' ||
            printKind === 'cfop' ||
            printKind === 'customer') && (
            <div className="form-row form-row--2">
              <div className="field">
                <label htmlFor="fn-rep-df">Data mín.</label>
                <input
                  id="fn-rep-df"
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="fn-rep-dt">Data máx.</label>
                <input
                  id="fn-rep-dt"
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                />
              </div>
            </div>
          )}

          {printKind === 'second' && (
            <p className="muted" style={{ fontSize: '0.85rem' }}>
              {selectedId
                ? 'Nota selecionada na listagem será usada na segunda via.'
                : 'Clique numa linha da listagem para selecionar a nota.'}
            </p>
          )}

          <button type="button" className="btn btn-primary" onClick={openPrint}>
            Gerar impressão
          </button>
        </div>
      </details>
    </div>
  );
}
