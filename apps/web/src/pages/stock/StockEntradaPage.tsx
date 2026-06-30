import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, useMemo, useState } from 'react';
import { CrudToolbar } from '../../components/CrudToolbar';
import { ModuleReportsModal } from '../../components/ModuleReportsModal';
import { SupplierSearchCombo } from '../../components/ProductCatalogCombos';
import { ProductSearchModal, type ProductSearchRow } from '../../components/ProductSearchModal';
import { api, ApiHttpError } from '../../lib/api';
import { formatConversionHint } from '../../lib/product-conversion';

type Line = {
  lineNumber?: number;
  variantId: string;
  variantLabel: string;
  supplierProductCode: string;
  invoiceUnit: string;
  invoiceQuantity: string;
  quantity: string;
  unitCost: string;
  ncm: string;
  cfop: string;
  description: string;
  fromNfe: boolean;
  pendingResolution: boolean;
};

function emptyLine(): Line {
  return {
    variantId: '',
    variantLabel: '',
    supplierProductCode: '',
    invoiceUnit: '',
    invoiceQuantity: '1',
    quantity: '1',
    unitCost: '0',
    ncm: '',
    cfop: '1102',
    description: '',
    fromNfe: false,
    pendingResolution: false,
  };
}

type GoodsReceiptRow = {
  id: string;
  controlNumber: number;
  mode: string;
  createdAt: string;
  documentNumber: string | null;
  series: string | null;
  issueDate: string | null;
  natureOperation: string | null;
  notes: string | null;
  totalValue: string | null;
  supplier: { id: string; legalName: string } | null;
  supplierId: string | null;
  items: Array<{
    id: string;
    quantity: string;
    unitCost: string;
    description: string | null;
    variant: { sku: string; product: { name: string } };
  }>;
};

type InboundFetchResponse = {
  duplicate: false;
  cached: boolean;
  preview: {
    accessKey: string;
    documentNumber: string | null;
    series: string | null;
    issueDate: string | null;
    natureOperation: string | null;
    totalValue: number | null;
    emitter: { cnpj: string; name: string };
    recipient: { cnpj: string; name: string };
    items: Array<{
      lineNumber: number;
      supplierCode: string | null;
      ean: string | null;
      description: string;
      ncm: string | null;
      cfop: string | null;
      unit: string | null;
      quantity: number;
      unitCost: number;
      total: number;
    }>;
  };
  suggestedMatches: Array<{
    lineNumber: number;
    variantId: string | null;
    sku: string | null;
    label: string | null;
    confidence: string;
    supplierProductCode: string | null;
  }>;
  supplierId: string | null;
  supplierName: string | null;
  warnings: string[];
};

type DuplicateReceiptInfo = {
  controlNumber: number;
  goodsReceiptId: string;
  message: string;
};

function modeLabel(mode: string): string {
  return mode === 'WITH_NFE_KEY' ? 'Com chave NF-e' : 'Sem chave';
}

export function StockEntradaPage() {
  const qc = useQueryClient();
  const [includeOpen, setIncludeOpen] = useState(false);
  const [reportsOpen, setReportsOpen] = useState(false);
  const [viewing, setViewing] = useState<GoodsReceiptRow | null>(null);
  const [editing, setEditing] = useState<GoodsReceiptRow | null>(null);
  const [mode, setMode] = useState<'WITH_NFE_KEY' | 'WITHOUT_NFE'>('WITHOUT_NFE');
  const [nfeKey, setNfeKey] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [supplierNameHint, setSupplierNameHint] = useState('');
  const [locationId, setLocationId] = useState('');
  const [documentNumber, setDocumentNumber] = useState('');
  const [series, setSeries] = useState('');
  const [issueDate, setIssueDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [natureOperation, setNatureOperation] = useState('Compra para comercialização');
  const [totalValue, setTotalValue] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  // Geração de contas a pagar a partir desta entrada.
  const [genPayable, setGenPayable] = useState(false);
  const [payInstallments, setPayInstallments] = useState(1);
  const [payIntervalDays, setPayIntervalDays] = useState(30);
  const [payFirstDue, setPayFirstDue] = useState(() =>
    new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
  );
  const [err, setErr] = useState<string | null>(null);
  const [duplicateInfo, setDuplicateInfo] = useState<DuplicateReceiptInfo | null>(null);
  const [nfeWarnings, setNfeWarnings] = useState<string[]>([]);
  const [nfeFetchMsg, setNfeFetchMsg] = useState<string | null>(null);
  const [productSearchLine, setProductSearchLine] = useState<number | null>(null);
  const [creatingLine, setCreatingLine] = useState<number | null>(null);

  const receipts = useQuery({
    queryKey: ['goods-receipts'],
    queryFn: () => api<GoodsReceiptRow[]>('/goods-receipts'),
  });

  const locations = useQuery({
    queryKey: ['stock-locations'],
    queryFn: () => api<Array<{ id: string; code: string; name: string }>>('/stock-locations'),
  });

  const products = useQuery({
    queryKey: ['products'],
    queryFn: () =>
      api<
        Array<{
          name: string;
          ncm: string | null;
          conversion: string | null;
          variants: Array<{ id: string; sku: string }>;
        }>
      >('/products'),
  });

  const conversionByVariant = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const p of products.data ?? []) {
      for (const v of p.variants) {
        map.set(v.id, p.conversion ?? null);
      }
    }
    return map;
  }, [products.data]);

  const ncmByVariant = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of products.data ?? []) {
      for (const v of p.variants) {
        map.set(v.id, p.ncm ?? '');
      }
    }
    return map;
  }, [products.data]);

  const hasUnresolvedLines = lines.some((l) => l.pendingResolution && !l.variantId);

  const recentReceipts = useMemo(() => (receipts.data ?? []).slice(0, 50), [receipts.data]);

  function resetEntradaForm() {
    setMode('WITHOUT_NFE');
    setNfeKey('');
    setSupplierId('');
    setSupplierNameHint('');
    setLocationId('');
    setDocumentNumber('');
    setSeries('');
    setIssueDate(new Date().toISOString().slice(0, 10));
    setNatureOperation('Compra para comercialização');
    setTotalValue('');
    setNotes('');
    setLines([emptyLine()]);
    setGenPayable(false);
    setPayInstallments(1);
    setPayIntervalDays(30);
    setPayFirstDue(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
    setErr(null);
    setDuplicateInfo(null);
    setNfeWarnings([]);
    setNfeFetchMsg(null);
  }

  function applyInboundPreview(data: InboundFetchResponse) {
    const p = data.preview;
    setMode('WITH_NFE_KEY');
    setNfeKey(p.accessKey);
    setDocumentNumber(p.documentNumber ?? '');
    setSeries(p.series ?? '');
    if (p.issueDate) {
      setIssueDate(p.issueDate.slice(0, 10));
    }
    setNatureOperation(p.natureOperation ?? 'Compra para comercialização');
    setTotalValue(p.totalValue != null ? String(p.totalValue) : '');
    if (data.supplierId) {
      setSupplierId(data.supplierId);
      setSupplierNameHint(data.supplierName ?? '');
    } else if (data.supplierName) {
      setSupplierNameHint(data.supplierName);
    }
    const matchByLine = new Map(data.suggestedMatches.map((m) => [m.lineNumber, m]));
    setLines(
      p.items.length > 0
        ? p.items.map((item) => {
            const match = matchByLine.get(item.lineNumber);
            const supplierCode = match?.supplierProductCode ?? item.supplierCode ?? '';
            const unresolved = !match?.variantId && !!supplierCode;
            return {
              lineNumber: item.lineNumber,
              variantId: match?.variantId ?? '',
              variantLabel: match?.label ?? '',
              supplierProductCode: supplierCode,
              invoiceUnit: item.unit ?? '',
              invoiceQuantity: String(item.quantity),
              quantity: String(item.quantity),
              unitCost: String(item.unitCost),
              ncm: item.ncm ?? '',
              cfop: item.cfop ?? '1102',
              description: item.description,
              fromNfe: true,
              pendingResolution: unresolved,
            };
          })
        : [emptyLine()],
    );
  }

  const fetchNfe = useMutation({
    mutationFn: () =>
      api<InboundFetchResponse>('/fiscal/inbound/fetch-by-key', {
        method: 'POST',
        json: { accessKey: nfeKey.replace(/\D/g, '') },
      }),
    onSuccess: (data) => {
      setDuplicateInfo(null);
      setErr(null);
      applyInboundPreview(data);
      setNfeWarnings(data.warnings);
      setNfeFetchMsg(data.cached ? 'NF-e carregada do cache local.' : 'NF-e baixada da SEFAZ.');
    },
    onError: (e: Error) => {
      if (e instanceof ApiHttpError && e.status === 409 && e.payload && typeof e.payload === 'object') {
        const body = e.payload as {
          message?: { message?: string; duplicate?: { controlNumber: number; goodsReceiptId: string } };
        };
        const dup = body.message?.duplicate;
        if (dup) {
          setDuplicateInfo({
            controlNumber: dup.controlNumber,
            goodsReceiptId: dup.goodsReceiptId,
            message: body.message?.message ?? e.message,
          });
          setErr(body.message?.message ?? e.message);
          return;
        }
      }
      setDuplicateInfo(null);
      setErr(e.message);
    },
  });

  const submit = useMutation({
    mutationFn: () =>
      api('/goods-receipts', {
        method: 'POST',
        json: {
          mode,
          nfeAccessKey: mode === 'WITH_NFE_KEY' ? nfeKey.replace(/\D/g, '') : null,
          supplierId: supplierId || null,
          locationId,
          documentNumber: documentNumber || null,
          series: series || null,
          issueDate: issueDate ? new Date(issueDate).toISOString() : null,
          natureOperation: natureOperation || null,
          totalValue: totalValue ? parseFloat(totalValue.replace(',', '.')) : null,
          notes: notes || null,
          items: lines
            .filter((l) => l.variantId)
            .map((l) => {
              const rawQty = parseFloat((l.invoiceQuantity || l.quantity).replace(',', '.')) || 0;
              return {
                variantId: l.variantId,
                quantity: rawQty,
                invoiceQuantity: rawQty,
                unitCost: parseFloat(l.unitCost.replace(',', '.')) || 0,
                ncm: l.ncm || null,
                cfop: l.cfop || null,
                description: l.description || null,
                supplierProductCode: l.supplierProductCode.trim() || null,
                invoiceUnit: l.invoiceUnit.trim() || null,
              };
            }),
          payable: genPayable
            ? {
                enabled: true,
                installments: payInstallments,
                intervalDays: payIntervalDays,
                firstDueDate: payFirstDue ? new Date(payFirstDue).toISOString() : null,
              }
            : null,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stock-movements'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['reports', 'stock-position'] });
      qc.invalidateQueries({ queryKey: ['goods-receipts'] });
      qc.invalidateQueries({ queryKey: ['payables'] });
      qc.invalidateQueries({ queryKey: ['suppliers'] });
      setErr(null);
      setIncludeOpen(false);
      resetEntradaForm();
      alert('Entrada registrada com sucesso.');
    },
    onError: (e: Error) => {
      if (e instanceof ApiHttpError && e.status === 409 && e.payload && typeof e.payload === 'object') {
        const body = e.payload as {
          message?: { message?: string; duplicate?: { controlNumber: number; goodsReceiptId: string } };
        };
        const dup = body.message?.duplicate;
        if (dup) {
          setDuplicateInfo({
            controlNumber: dup.controlNumber,
            goodsReceiptId: dup.goodsReceiptId,
            message: body.message?.message ?? e.message,
          });
          setErr(body.message?.message ?? e.message);
          return;
        }
      }
      setErr(e.message);
    },
  });

  const updateHeader = useMutation({
    mutationFn: (payload: {
      id: string;
      supplierId: string | null;
      documentNumber: string | null;
      series: string | null;
      issueDate: string | null;
      natureOperation: string | null;
      notes: string | null;
    }) =>
      api(`/goods-receipts/${payload.id}`, {
        method: 'PATCH',
        json: {
          supplierId: payload.supplierId,
          documentNumber: payload.documentNumber,
          series: payload.series,
          issueDate: payload.issueDate,
          natureOperation: payload.natureOperation,
          notes: payload.notes,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['goods-receipts'] });
      setEditing(null);
    },
  });

  function setLine(i: number, p: Partial<Line>) {
    setLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...p } : l)));
  }

  function pickProductForLine(i: number, row: ProductSearchRow) {
    setLine(i, {
      variantId: row.variantId,
      variantLabel: `${row.sku} — ${row.productName}`,
      pendingResolution: false,
      ncm: lines[i]?.ncm || ncmByVariant.get(row.variantId) || '',
    });
  }

  const createProductFromLine = useMutation({
    mutationFn: (lineIndex: number) => {
      const l = lines[lineIndex];
      if (!l) throw new Error('Linha inválida');
      return api<{
        variants: Array<{ id: string; sku: string; product?: { name: string } }>;
        name: string;
      }>('/products/from-inbound-line', {
        method: 'POST',
        json: {
          name: l.description.trim() || l.supplierProductCode.trim() || 'Produto NF-e',
          description: l.description.trim() || null,
          ncm: l.ncm.trim() || null,
          taxUnit: l.invoiceUnit.trim() || null,
          unitCost: parseFloat(l.unitCost.replace(',', '.')) || 0,
          supplierId: supplierId || null,
          supplierProductCode: l.supplierProductCode.trim() || null,
        },
      });
    },
    onSuccess: (product, lineIndex) => {
      const v = product.variants[0];
      if (v) {
        pickProductForLine(lineIndex, {
          productId: '',
          productName: product.name,
          variantId: v.id,
          sku: v.sku,
          barcode: null,
          retailPrice: '0',
          costAverage: '0',
          stockTotal: '0',
        });
      }
      qc.invalidateQueries({ queryKey: ['products'] });
      setCreatingLine(null);
    },
    onError: (e: Error) => {
      setCreatingLine(null);
      setErr(e.message);
    },
  });

  return (
    <div>
      <CrudToolbar
        onInclude={() => {
          resetEntradaForm();
          setIncludeOpen(true);
        }}
        onPrint={() => window.print()}
        onReports={() => setReportsOpen(true)}
      />

      <ModuleReportsModal
        open={reportsOpen}
        title="Entrada de produtos"
        onClose={() => setReportsOpen(false)}
      >
        <ul style={{ margin: 0, paddingLeft: '1.2rem' }}>
          <li>Lista de entradas por período (a implementar)</li>
          <li>Conferência NF-e × estoque recebido</li>
          <li>Exportação para contabilidade</li>
        </ul>
      </ModuleReportsModal>

      <div className="card">
        <h2 className="page-title" style={{ fontSize: '1.05rem', marginBottom: '0.75rem' }}>
          Últimas entradas de mercadorias
        </h2>
        <p className="page-desc" style={{ marginBottom: '1rem' }}>
          Lançamentos via esta tela (recebimentos registrados). Use <strong>Incluir</strong> para nova entrada.
        </p>
        {receipts.isError && (
          <div className="alert alert-error">{(receipts.error as Error).message}</div>
        )}
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 80 }}>Controle</th>
                <th>Data</th>
                <th>Modo</th>
                <th>Documento</th>
                <th>Fornecedor</th>
                <th>Itens</th>
                <th>Resumo</th>
                <th style={{ width: 180, textAlign: 'right' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {receipts.isLoading && (
                <tr>
                  <td colSpan={8} className="empty">
                    Carregando…
                  </td>
                </tr>
              )}
              {!receipts.isLoading && !recentReceipts.length && (
                <tr>
                  <td colSpan={8} className="empty">
                    Nenhuma entrada registrada. Clique em Incluir para lançar.
                  </td>
                </tr>
              )}
              {recentReceipts.map((r) => (
                <tr key={r.id}>
                  <td>
                    <span
                      style={{
                        display: 'inline-block',
                        padding: '0.15rem 0.5rem',
                        background: '#eef2ff',
                        color: '#3730a3',
                        borderRadius: 6,
                        fontWeight: 700,
                        fontSize: '0.8rem',
                      }}
                    >
                      #{r.controlNumber}
                    </span>
                  </td>
                  <td style={{ whiteSpace: 'nowrap', fontSize: '0.85rem' }}>
                    {new Date(r.createdAt).toLocaleString('pt-BR')}
                  </td>
                  <td>{modeLabel(r.mode)}</td>
                  <td>{r.documentNumber ?? '—'}</td>
                  <td>{r.supplier?.legalName ?? '—'}</td>
                  <td>{r.items.length}</td>
                  <td style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>
                    {r.items
                      .slice(0, 2)
                      .map((it) => `${it.variant.sku} (${it.quantity})`)
                      .join(' · ')}
                    {r.items.length > 2 ? '…' : ''}
                  </td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ fontSize: '0.8rem' }}
                      onClick={() => setViewing(r)}
                    >
                      Visualizar
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ fontSize: '0.8rem', marginLeft: '0.25rem' }}
                      onClick={() => setEditing(r)}
                    >
                      Editar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {viewing && (
        <div className="modal-backdrop" role="presentation" onClick={() => setViewing(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 'min(820px, 96vw)' }}>
            <h2>
              Entrada #{viewing.controlNumber}
              <span
                style={{
                  marginLeft: '0.5rem',
                  fontSize: '0.75rem',
                  fontWeight: 500,
                  color: 'var(--color-text-muted)',
                }}
              >
                ({modeLabel(viewing.mode)})
              </span>
            </h2>
            <dl style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem 1.25rem' }}>
              <div>
                <dt style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Data</dt>
                <dd style={{ margin: 0 }}>{new Date(viewing.createdAt).toLocaleString('pt-BR')}</dd>
              </div>
              <div>
                <dt style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Documento</dt>
                <dd style={{ margin: 0 }}>
                  {viewing.documentNumber ?? '—'}
                  {viewing.series ? ` (série ${viewing.series})` : ''}
                </dd>
              </div>
              <div>
                <dt style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Fornecedor</dt>
                <dd style={{ margin: 0 }}>{viewing.supplier?.legalName ?? '—'}</dd>
              </div>
              <div>
                <dt style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Natureza</dt>
                <dd style={{ margin: 0 }}>{viewing.natureOperation ?? '—'}</dd>
              </div>
              <div>
                <dt style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Valor total</dt>
                <dd style={{ margin: 0 }}>{viewing.totalValue ? `R$ ${viewing.totalValue}` : '—'}</dd>
              </div>
            </dl>
            {viewing.notes && (
              <p style={{ margin: '0.75rem 0 0', fontSize: '0.85rem' }}>
                <strong>Observações:</strong> {viewing.notes}
              </p>
            )}
            <h3 style={{ marginTop: '1rem', fontSize: '0.92rem' }}>Itens</h3>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Produto (SKU)</th>
                    <th>Descrição</th>
                    <th style={{ textAlign: 'right' }}>Qtd</th>
                    <th style={{ textAlign: 'right' }}>Custo unit.</th>
                    <th style={{ textAlign: 'right' }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {viewing.items.map((it) => (
                    <tr key={it.id}>
                      <td>{it.variant.sku} — {it.variant.product.name}</td>
                      <td>{it.description ?? '—'}</td>
                      <td style={{ textAlign: 'right' }}>{it.quantity}</td>
                      <td style={{ textAlign: 'right' }}>R$ {it.unitCost}</td>
                      <td style={{ textAlign: 'right' }}>
                        R$ {(Number(it.quantity) * Number(it.unitCost)).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setViewing(null)}>
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {editing && (
        <EditReceiptModal
          receipt={editing}
          onCancel={() => setEditing(null)}
          onSubmit={(values) => updateHeader.mutate({ id: editing.id, ...values })}
          isPending={updateHeader.isPending}
        />
      )}

      {includeOpen && (
        <div
          className="modal-backdrop modal-backdrop--wide no-print"
          role="presentation"
          onClick={() => {
            setIncludeOpen(false);
            setErr(null);
          }}
        >
          <div
            className="modal modal--wide entrada-receipt-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="entrada-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="entrada-modal-title">Nova entrada de produtos</h2>
            {err && <div className="alert alert-error">{err}</div>}

            <div className="entrada-receipt-modal__scroll">
              <p className="entrada-receipt-lead">
                Lançamento espelhando NF-e (com ou sem chave). Informe o documento, o fornecedor quando houver, o local
                de estoque e os itens recebidos — o mesmo padrão visual do cadastro de produtos. O{' '}
                <strong>custo unitário</strong> de cada item atualiza o <strong>custo médio</strong> da variação no
                cadastro (média ponderada pelo estoque); quando o custo médio mudar, o valor anterior fica no{' '}
                <strong>histórico de preços</strong> do produto (origem “Entrada NF”).
              </p>

              <div className="entrada-receipt-header-grid">
                <details className="submenu-details entrada-receipt-header-grid__doc" open>
                  <summary className="submenu-summary">Dados da entrada / NF-e (espelho)</summary>
                    <div className="submenu-body">
                      <div className="field">
                        <label htmlFor="ent-mod">Tipo de entrada</label>
                        <select
                          id="ent-mod"
                          value={mode}
                          onChange={(e) => setMode(e.target.value as typeof mode)}
                        >
                          <option value="WITH_NFE_KEY">Entrada com chave de acesso da NF-e (44 dígitos)</option>
                          <option value="WITHOUT_NFE">Entrada sem chave (documento não eletrônico / conferência)</option>
                        </select>
                      </div>
                      {mode === 'WITH_NFE_KEY' && (
                        <div className="field">
                          <label htmlFor="ent-key">Chave de acesso</label>
                          <div className="entrada-nfe-key-row">
                            <input
                              id="ent-key"
                              value={nfeKey}
                              onChange={(e) => {
                                setNfeKey(e.target.value.replace(/\D/g, '').slice(0, 44));
                                setDuplicateInfo(null);
                                setNfeFetchMsg(null);
                              }}
                              placeholder="44 dígitos"
                              maxLength={44}
                            />
                            <button
                              type="button"
                              className="btn btn-secondary"
                              disabled={nfeKey.replace(/\D/g, '').length !== 44 || fetchNfe.isPending}
                              onClick={() => fetchNfe.mutate()}
                            >
                              {fetchNfe.isPending ? 'Buscando…' : 'Buscar NF-e'}
                            </button>
                          </div>
                          <p className="muted entrada-nfe-key-hint">
                            Informe a chave e clique em <strong>Buscar NF-e</strong> para baixar o XML na SEFAZ e
                            preencher os campos automaticamente.
                          </p>
                          {nfeFetchMsg && (
                            <p className="alert alert-success" style={{ marginTop: '0.5rem' }}>
                              {nfeFetchMsg}
                            </p>
                          )}
                          {nfeWarnings.map((w) => (
                            <p key={w} className="alert alert-warn" style={{ marginTop: '0.5rem' }}>
                              {w}
                            </p>
                          ))}
                          {duplicateInfo && (
                            <div className="alert alert-error" style={{ marginTop: '0.5rem' }}>
                              {duplicateInfo.message}
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                style={{ marginLeft: '0.5rem' }}
                                onClick={() => {
                                  const row = receipts.data?.find((r) => r.id === duplicateInfo.goodsReceiptId);
                                  if (row) {
                                    setIncludeOpen(false);
                                    setViewing(row);
                                  }
                                }}
                              >
                                Ver entrada #{duplicateInfo.controlNumber}
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                      <div className="form-row">
                        <div className="field">
                          <label htmlFor="ent-num">Número do documento</label>
                          <input
                            id="ent-num"
                            value={documentNumber}
                            onChange={(e) => setDocumentNumber(e.target.value)}
                          />
                        </div>
                        <div className="field">
                          <label htmlFor="ent-ser">Série</label>
                          <input id="ent-ser" value={series} onChange={(e) => setSeries(e.target.value)} />
                        </div>
                        <div className="field">
                          <label htmlFor="ent-dt">Data emissão</label>
                          <input id="ent-dt" type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
                        </div>
                      </div>
                      <div className="field">
                        <label htmlFor="ent-nat">Natureza da operação</label>
                        <input id="ent-nat" value={natureOperation} onChange={(e) => setNatureOperation(e.target.value)} />
                      </div>
                    </div>
                  </details>

                <details className="submenu-details entrada-receipt-header-grid__emit" open>
                  <summary className="submenu-summary">Emitente (fornecedor)</summary>
                  <div className="submenu-body">
                    <div className="field">
                      <span className="field-label-text">Pesquisar ou incluir fornecedor (opcional)</span>
                      <SupplierSearchCombo
                        id="ent-forn"
                        value={supplierId}
                        onChange={(id, picked) => {
                          setSupplierId(id);
                          if (picked) setSupplierNameHint(picked);
                          if (!id) setSupplierNameHint('');
                        }}
                        hintName={supplierNameHint}
                      />
                    </div>
                  </div>
                </details>

                <details className="submenu-details entrada-receipt-header-grid__dest" open>
                  <summary className="submenu-summary">Destinatário (seu estabelecimento)</summary>
                  <div className="submenu-body">
                    <p className="muted entrada-receipt-dest-hint">
                      Local onde a mercadoria será lançada ao confirmar.
                    </p>
                    <div className="field">
                      <label htmlFor="ent-loc">Local de recebimento *</label>
                      <select id="ent-loc" value={locationId} onChange={(e) => setLocationId(e.target.value)} required>
                        <option value="">— Selecione —</option>
                        {locations.data?.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.code} — {l.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </details>
              </div>

              <details className="submenu-details entrada-receipt-section-full" open>
                <summary className="submenu-summary">Produtos / serviços (itens)</summary>
                <div className="submenu-body">
                  <p style={{ margin: '0 0 1rem', fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
                    Campos NCM e CFOP seguem a estrutura do leiaute NF-e (produto). CFOP padrão sugerido: 1102. O custo
                    unitário informado aqui entra no cadastro do produto mediante recálculo do custo médio (e gera
                    histórico se houver alteração).
                  </p>
                  <div className="table-wrap">
                    <table className="data-table entrada-items-table">
                      <thead>
                        <tr>
                          <th>Cód. fornecedor</th>
                          <th>Produto (interno)</th>
                          <th>Descrição NF</th>
                          <th>Un. NF</th>
                          <th>NCM</th>
                          <th>CFOP</th>
                          <th>Qtd NF</th>
                          <th>Custo unit.</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {lines.map((l, i) => {
                          const convHint =
                            l.variantId && l.invoiceUnit
                              ? formatConversionHint(
                                  parseFloat(l.invoiceQuantity.replace(',', '.')) || 0,
                                  l.invoiceUnit,
                                  conversionByVariant.get(l.variantId) ?? null,
                                )
                              : null;
                          return (
                            <Fragment key={i}>
                              <tr key={i}>
                                <td>
                                  <input
                                    value={l.supplierProductCode}
                                    onChange={(e) =>
                                      setLine(i, { supplierProductCode: e.target.value })
                                    }
                                    placeholder="cProd NF-e"
                                    title="Código do produto no fornecedor — usado para identificar automaticamente nas próximas entradas"
                                  />
                                </td>
                                <td>
                                  <div className="entrada-product-pick">
                                    <span
                                      className={
                                        l.variantLabel
                                          ? 'entrada-product-pick__label'
                                          : 'entrada-product-pick__label entrada-product-pick__label--empty'
                                      }
                                    >
                                      {l.variantLabel || '— não vinculado —'}
                                    </span>
                                    <button
                                      type="button"
                                      className="btn btn-secondary btn-sm"
                                      onClick={() => setProductSearchLine(i)}
                                    >
                                      Pesquisar
                                    </button>
                                    {l.variantId && (
                                      <button
                                        type="button"
                                        className="btn btn-ghost btn-sm"
                                        title="Remover vínculo"
                                        onClick={() =>
                                          setLine(i, {
                                            variantId: '',
                                            variantLabel: '',
                                            pendingResolution: l.fromNfe && !!l.supplierProductCode,
                                          })
                                        }
                                      >
                                        ✕
                                      </button>
                                    )}
                                  </div>
                                </td>
                                <td>
                                  <input
                                    value={l.description}
                                    onChange={(e) => setLine(i, { description: e.target.value })}
                                    placeholder="Descrição no documento"
                                  />
                                </td>
                                <td>
                                  <input
                                    value={l.invoiceUnit}
                                    onChange={(e) => setLine(i, { invoiceUnit: e.target.value.toUpperCase() })}
                                    placeholder="UN"
                                    style={{ width: '4rem' }}
                                  />
                                </td>
                                <td>
                                  <input value={l.ncm} onChange={(e) => setLine(i, { ncm: e.target.value })} />
                                </td>
                                <td>
                                  <input value={l.cfop} onChange={(e) => setLine(i, { cfop: e.target.value })} />
                                </td>
                                <td>
                                  <input
                                    value={l.invoiceQuantity}
                                    onChange={(e) =>
                                      setLine(i, {
                                        invoiceQuantity: e.target.value,
                                        quantity: e.target.value,
                                      })
                                    }
                                  />
                                  {convHint && (
                                    <span className="entrada-conversion-hint" title={convHint}>
                                      → estoque
                                    </span>
                                  )}
                                </td>
                                <td>
                                  <input
                                    value={l.unitCost}
                                    onChange={(e) => setLine(i, { unitCost: e.target.value })}
                                  />
                                </td>
                                <td>
                                  <button
                                    type="button"
                                    className="btn btn-secondary"
                                    disabled={lines.length <= 1}
                                    onClick={() => setLines((p) => p.filter((_, j) => j !== i))}
                                  >
                                    ✕
                                  </button>
                                </td>
                              </tr>
                              {l.pendingResolution && !l.variantId && (
                                <tr key={`${i}-resolve`} className="entrada-unresolved-row">
                                  <td colSpan={9}>
                                    <div className="alert alert-warn entrada-unresolved-banner">
                                      <strong>Produto sem vínculo com o fornecedor.</strong>{' '}
                                      Deseja vincular a um produto existente ou incluir um novo com os dados
                                      da nota?
                                      <div className="entrada-unresolved-actions">
                                        <button
                                          type="button"
                                          className="btn btn-secondary btn-sm"
                                          onClick={() => setProductSearchLine(i)}
                                        >
                                          Pesquisar produto existente
                                        </button>
                                        <button
                                          type="button"
                                          className="btn btn-primary btn-sm"
                                          disabled={createProductFromLine.isPending && creatingLine === i}
                                          onClick={() => {
                                            setCreatingLine(i);
                                            createProductFromLine.mutate(i);
                                          }}
                                        >
                                          {createProductFromLine.isPending && creatingLine === i
                                            ? 'Criando…'
                                            : 'Incluir novo produto'}
                                        </button>
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                              )}
                              {convHint && l.variantId && (
                                <tr key={`${i}-conv`} className="entrada-conversion-row">
                                  <td colSpan={9}>
                                    <span className="muted" style={{ fontSize: '0.82rem' }}>
                                      Conversão: {convHint}
                                    </span>
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ marginTop: '0.5rem' }}
                    onClick={() => setLines((p) => [...p, emptyLine()])}
                  >
                    + Item
                  </button>
                </div>
              </details>

              <div className="entrada-receipt-footer-split">
              <details className="submenu-details" open>
                <summary className="submenu-summary">Totais / observações</summary>
                <div className="submenu-body">
                  <div className="form-row">
                    <div className="field">
                      <label htmlFor="ent-tot">Valor total informado no documento (opcional)</label>
                      <input
                        id="ent-tot"
                        value={totalValue}
                        onChange={(e) => setTotalValue(e.target.value)}
                        type="number"
                        step="0.01"
                      />
                    </div>
                  </div>
                  <div className="field">
                    <label htmlFor="ent-notes">Informações complementares</label>
                    <textarea id="ent-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
                  </div>
                </div>
              </details>

              <details className="submenu-details" open>
                <summary className="submenu-summary">Contas a pagar (opcional)</summary>
                <div className="submenu-body">
                  <label
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      fontSize: '0.92rem',
                      marginBottom: '0.75rem',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={genPayable}
                      onChange={(e) => setGenPayable(e.target.checked)}
                    />
                    <span>
                      <strong>Gerar contas a pagar a partir desta entrada</strong>
                    </span>
                  </label>
                  {genPayable && (
                    <>
                      <p style={{ margin: '0 0 0.75rem', fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>
                        Será criado um título em <strong>Financeiro → A pagar</strong> vinculado ao fornecedor e à
                        entrada, com o valor total dividido em parcelas iguais.
                      </p>
                      <div className="form-row">
                        <div className="field">
                          <label htmlFor="ent-pay-n">Parcelas</label>
                          <input
                            id="ent-pay-n"
                            type="number"
                            min={1}
                            max={60}
                            value={payInstallments}
                            onChange={(e) =>
                              setPayInstallments(Math.max(1, Math.min(60, Number(e.target.value) || 1)))
                            }
                          />
                        </div>
                        <div className="field">
                          <label htmlFor="ent-pay-int">Intervalo (dias)</label>
                          <input
                            id="ent-pay-int"
                            type="number"
                            min={1}
                            max={180}
                            value={payIntervalDays}
                            onChange={(e) =>
                              setPayIntervalDays(Math.max(1, Math.min(180, Number(e.target.value) || 30)))
                            }
                          />
                        </div>
                        <div className="field">
                          <label htmlFor="ent-pay-due">Primeiro vencimento</label>
                          <input
                            id="ent-pay-due"
                            type="date"
                            value={payFirstDue}
                            onChange={(e) => setPayFirstDue(e.target.value)}
                          />
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </details>
              </div>
            </div>

            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setIncludeOpen(false);
                  setErr(null);
                }}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={
                  !locationId ||
                  !lines.some((x) => x.variantId) ||
                  hasUnresolvedLines ||
                  submit.isPending
                }
                onClick={() => submit.mutate()}
              >
                Confirmar recebimento / lançar estoque
              </button>
            </div>
          </div>
        </div>
      )}

      <ProductSearchModal
        open={productSearchLine != null}
        onClose={() => setProductSearchLine(null)}
        onPick={(row) => {
          if (productSearchLine != null) pickProductForLine(productSearchLine, row);
        }}
      />
    </div>
  );
}

type EditValues = {
  supplierId: string | null;
  documentNumber: string | null;
  series: string | null;
  issueDate: string | null;
  natureOperation: string | null;
  notes: string | null;
};

function EditReceiptModal({
  receipt,
  onCancel,
  onSubmit,
  isPending,
}: {
  receipt: GoodsReceiptRow;
  onCancel: () => void;
  onSubmit: (values: EditValues) => void;
  isPending: boolean;
}) {
  const [supplierId, setSupplierId] = useState(receipt.supplierId ?? '');
  const [supplierHint, setSupplierHint] = useState(receipt.supplier?.legalName ?? '');
  const [documentNumber, setDocumentNumber] = useState(receipt.documentNumber ?? '');
  const [series, setSeries] = useState(receipt.series ?? '');
  const [issueDate, setIssueDate] = useState(
    receipt.issueDate ? new Date(receipt.issueDate).toISOString().slice(0, 10) : '',
  );
  const [natureOperation, setNatureOperation] = useState(receipt.natureOperation ?? '');
  const [notes, setNotes] = useState(receipt.notes ?? '');

  return (
    <div className="modal-backdrop" role="presentation" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 'min(620px, 96vw)' }}>
        <h2>Editar entrada #{receipt.controlNumber}</h2>
        <p style={{ margin: '0 0 0.75rem', fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>
          Você pode ajustar apenas os campos do <strong>cabeçalho</strong>. Itens já lançados não podem ser
          alterados para preservar estoque e custo médio.
        </p>
        <div className="field">
          <span className="field-label-text">Fornecedor</span>
          <SupplierSearchCombo
            id={`ent-edit-forn-${receipt.id}`}
            value={supplierId}
            hintName={supplierHint}
            onChange={(id, picked) => {
              setSupplierId(id);
              if (picked) setSupplierHint(picked);
              if (!id) setSupplierHint('');
            }}
          />
        </div>
        <div className="form-row">
          <div className="field">
            <label htmlFor="edit-doc">Documento</label>
            <input id="edit-doc" value={documentNumber} onChange={(e) => setDocumentNumber(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="edit-ser">Série</label>
            <input id="edit-ser" value={series} onChange={(e) => setSeries(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="edit-dt">Emissão</label>
            <input id="edit-dt" type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="edit-nat">Natureza da operação</label>
          <input id="edit-nat" value={natureOperation} onChange={(e) => setNatureOperation(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="edit-notes">Observações</label>
          <textarea id="edit-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={isPending}
            onClick={() =>
              onSubmit({
                supplierId: supplierId || null,
                documentNumber: documentNumber || null,
                series: series || null,
                issueDate: issueDate ? new Date(issueDate).toISOString() : null,
                natureOperation: natureOperation || null,
                notes: notes || null,
              })
            }
          >
            Salvar alterações
          </button>
        </div>
      </div>
    </div>
  );
}
