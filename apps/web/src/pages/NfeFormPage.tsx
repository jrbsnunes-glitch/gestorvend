/**
 * Formulário completo de inclusão/edição de NF-e modelo 55.
 * Cria venda com source=NFE_FORM e enfileira documento NF_E (PDV permanece disponível).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { validateDocumentIfCpf } from '../lib/cpf';
import { formatBRL, formatCpfCnpj } from '../lib/format';

type CustomerRow = {
  id: string;
  name: string;
  document: string | null;
};

type ProductSearchRow = {
  productName: string;
  variantId: string;
  sku: string;
  retailPrice: string;
  taxUnit?: string | null;
};

type NatureRow = {
  id: string;
  code: string;
  description: string;
  cfop: string;
  isActive: boolean;
};

type Line = {
  key: string;
  variantId: string;
  label: string;
  sku: string;
  quantity: number;
  unitPrice: number;
};

type FiscalDetail = {
  id: string;
  saleId: string;
  status: string;
  kind: string;
  sale: {
    id: string;
    customerId: string | null;
    notes: string | null;
    discount: string;
    surcharge: string;
    freightAmount?: string;
    freightMod?: number;
    operationNatureId?: string | null;
    deliveryVehiclePlate?: string | null;
    deliveryDriverName?: string | null;
    deductStock?: boolean;
    items: Array<{
      variantId: string;
      quantity: string;
      unitPrice: string;
      variant?: { sku?: string; product?: { name?: string } };
    }>;
  };
};

const DELETABLE = new Set(['QUEUED', 'ERROR', 'REJECTED', 'BUILDING_XML']);

export function NfeFormPage() {
  const { documentId } = useParams<{ documentId?: string }>();
  const isEdit = Boolean(documentId);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [customerId, setCustomerId] = useState('');
  const [customerQ, setCustomerQ] = useState('');
  const [showCustomerQuick, setShowCustomerQuick] = useState(false);
  const [customerQuick, setCustomerQuick] = useState({ name: '', document: '' });
  const [productQ, setProductQ] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [discount, setDiscount] = useState('0');
  const [surcharge, setSurcharge] = useState('0');
  const [freightMod, setFreightMod] = useState<0 | 1 | 9>(9);
  const [freightAmount, setFreightAmount] = useState('0');
  const [natureId, setNatureId] = useState('');
  const [natureQuick, setNatureQuick] = useState({ code: '', description: '', cfop: '' });
  const [showNatureQuick, setShowNatureQuick] = useState(false);
  const [plate, setPlate] = useState('');
  const [driver, setDriver] = useState('');
  const [deductStock, setDeductStock] = useState(true);
  const [notes, setNotes] = useState('');
  const [payMethod, setPayMethod] = useState<'CASH' | 'PIX' | 'CARD' | 'CREDIT' | 'OTHER'>('CASH');
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const existing = useQuery({
    queryKey: ['fiscal', 'documents', documentId],
    queryFn: () => api<FiscalDetail>(`/fiscal/documents/${documentId}`),
    enabled: isEdit && !!documentId,
  });

  const natures = useQuery({
    queryKey: ['operation-natures'],
    queryFn: () => api<NatureRow[]>('/operation-natures'),
  });

  useEffect(() => {
    const d = existing.data;
    if (!d) return;
    if (!DELETABLE.has(d.status)) {
      setErr('Esta nota não pode ser editada (já enviada/autorizada). Exclua só se ainda não enviada.');
    }
    setCustomerId(d.sale.customerId ?? '');
    setNotes(d.sale.notes ?? '');
    setDiscount(String(d.sale.discount ?? '0'));
    setSurcharge(String(d.sale.surcharge ?? '0'));
    setFreightAmount(String(d.sale.freightAmount ?? '0'));
    const fm = Number(d.sale.freightMod ?? 9);
    setFreightMod(fm === 0 || fm === 1 ? fm : 9);
    setNatureId(d.sale.operationNatureId ?? '');
    setPlate(d.sale.deliveryVehiclePlate ?? '');
    setDriver(d.sale.deliveryDriverName ?? '');
    setDeductStock(d.sale.deductStock !== false);
    setLines(
      (d.sale.items ?? []).map((it, i) => ({
        key: `${it.variantId}-${i}`,
        variantId: it.variantId,
        label: it.variant?.product?.name ?? 'Produto',
        sku: it.variant?.sku ?? '',
        quantity: Number(it.quantity),
        unitPrice: Number(it.unitPrice),
      })),
    );
  }, [existing.data]);

  const customers = useQuery({
    queryKey: ['customers', 'nfe-form'],
    queryFn: () => api<CustomerRow[]>('/customers'),
  });

  const customerHits = useMemo(() => {
    const q = customerQ.trim().toLowerCase();
    const all = customers.data ?? [];
    if (!q) return all.slice(0, 40);
    return all
      .filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          (c.document ?? '').includes(q.replace(/\D/g, '')),
      )
      .slice(0, 40);
  }, [customers.data, customerQ]);

  const selectedCustomer = (customers.data ?? []).find((c) => c.id === customerId) ?? null;
  const activeNatures = (natures.data ?? []).filter((n) => n.isActive);

  const productSearch = useQuery({
    queryKey: ['products', 'search', productQ],
    queryFn: () =>
      api<ProductSearchRow[]>(`/products/search?q=${encodeURIComponent(productQ.trim())}`),
    enabled: productQ.trim().length >= 1,
  });

  const subtotal = lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
  const disc = Number(String(discount).replace(',', '.')) || 0;
  const sur = Number(String(surcharge).replace(',', '.')) || 0;
  const freight =
    freightMod === 9 ? 0 : Number(String(freightAmount).replace(',', '.')) || 0;
  const total = Math.max(0, Math.round((subtotal - disc + sur + freight) * 100) / 100);

  function addProduct(p: ProductSearchRow) {
    setLines((prev) => {
      const found = prev.find((l) => l.variantId === p.variantId);
      if (found) {
        return prev.map((l) =>
          l.variantId === p.variantId ? { ...l, quantity: l.quantity + 1 } : l,
        );
      }
      return [
        ...prev,
        {
          key: `${p.variantId}-${Date.now()}`,
          variantId: p.variantId,
          label: p.productName,
          sku: p.sku,
          quantity: 1,
          unitPrice: Number(p.retailPrice) || 0,
        },
      ];
    });
    setProductQ('');
  }

  const createNatureQuick = useMutation({
    mutationFn: () =>
      api<NatureRow>('/operation-natures', {
        method: 'POST',
        json: {
          code: natureQuick.code,
          description: natureQuick.description,
          cfop: natureQuick.cfop,
          isActive: true,
        },
      }),
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ['operation-natures'] });
      setNatureId(row.id);
      setShowNatureQuick(false);
      setNatureQuick({ code: '', description: '', cfop: '' });
      setInfo(`Natureza “${row.code}” incluída.`);
    },
    onError: (e: Error) => setErr(e.message),
  });

  const createCustomerQuick = useMutation({
    mutationFn: () => {
      const docErr = validateDocumentIfCpf(customerQuick.document);
      if (docErr) throw new Error(docErr);
      const name = customerQuick.name.trim();
      if (!name) throw new Error('Informe o nome do cliente.');
      const digits = customerQuick.document.replace(/\D/g, '');
      if (digits.length !== 11 && digits.length !== 14) {
        throw new Error('NF-e exige CPF (11) ou CNPJ (14 dígitos).');
      }
      return api<CustomerRow>('/customers', {
        method: 'POST',
        json: {
          name,
          document: digits,
        },
      });
    },
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ['customers'] });
      setCustomerId(row.id);
      setCustomerQ(row.name);
      setShowCustomerQuick(false);
      setCustomerQuick({ name: '', document: '' });
      setInfo(`Cliente “${row.name}” incluído e selecionado.`);
    },
    onError: (e: Error) => setErr(e.message),
  });

  const saveMut = useMutation({
    mutationFn: async (andEmit: boolean) => {
      if (!customerId) throw new Error('Selecione o destinatário (cliente com CPF/CNPJ).');
      const cust = (customers.data ?? []).find((c) => c.id === customerId);
      const docDigits = (cust?.document ?? '').replace(/\D/g, '');
      if (docDigits.length !== 11 && docDigits.length !== 14) {
        throw new Error('NF-e exige cliente com CPF ou CNPJ válido no cadastro.');
      }
      if (!natureId) throw new Error('Selecione a natureza da operação.');
      if (!lines.length) throw new Error('Inclua ao menos um item.');
      if (total <= 0) throw new Error('Total da nota deve ser maior que zero.');

      if (isEdit && documentId && existing.data && DELETABLE.has(existing.data.status)) {
        await api(`/fiscal/documents/${documentId}/delete-unsent`, {
          method: 'POST',
          json: {},
        });
      } else if (isEdit && existing.data && !DELETABLE.has(existing.data.status)) {
        throw new Error('Não é possível alterar nota já enviada/autorizada.');
      }

      const sale = await api<{ id: string }>('/sales', {
        method: 'POST',
        json: {
          customerId,
          notes: notes || null,
          discount: disc,
          surcharge: sur,
          freightAmount: freight,
          freightMod,
          operationNatureId: natureId,
          deliveryVehiclePlate: plate || null,
          deliveryDriverName: driver || null,
          deductStock,
          source: 'NFE_FORM',
          items: lines.map((l) => ({
            variantId: l.variantId,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
          })),
          payments: [{ method: payMethod, amount: total }],
        },
      });

      const doc = await api<{ id: string }>('/fiscal/documents/queue', {
        method: 'POST',
        json: { saleId: sale.id, kind: 'NF_E' },
      });

      return { docId: doc.id, andEmit };
    },
    onSuccess: ({ docId, andEmit }) => {
      qc.invalidateQueries({ queryKey: ['fiscal', 'documents'] });
      if (andEmit) {
        window.open(`/notas-fiscais/danfe/${encodeURIComponent(docId)}`, '_blank', 'noopener');
      }
      navigate(`/notas-fiscais?tab=NF_E`);
    },
    onError: (e: Error) => setErr(e.message),
  });

  return (
    <div className="page">
      <h1 className="page-title">{isEdit ? 'Editar NF-e' : 'Incluir NF-e'}</h1>
      <p className="page-desc">
        Formulário completo de NF-e modelo 55. A emissão via PDV continua disponível em Vendas.
      </p>
      <p className="no-print">
        <Link to="/notas-fiscais?tab=NF_E">← Voltar à listagem</Link>
      </p>

      {err && <div className="alert alert-error">{err}</div>}
      {info && <div className="alert alert-success">{info}</div>}
      {existing.isLoading && isEdit && <p>Carregando nota…</p>}

      <section className="card" style={{ marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '1rem', marginTop: 0 }}>Destinatário</h2>
        <div className="nfe-field-row">
          <div className="field field--grow">
            <label htmlFor="nfe-cli-q">Buscar cliente</label>
            <input
              id="nfe-cli-q"
              value={customerQ}
              onChange={(e) => setCustomerQ(e.target.value)}
              placeholder="Nome ou CPF/CNPJ"
            />
          </div>
          <div className="field field--grow-lg">
            <label htmlFor="nfe-cli">Cliente *</label>
            <select id="nfe-cli" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">— Selecione —</option>
              {customerHits.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.document ? ` — ${formatCpfCnpj(c.document)}` : ' (sem documento)'}
                </option>
              ))}
            </select>
          </div>
          <div className="field field--action">
            <span className="field-label-spacer" aria-hidden="true">
              Incluir
            </span>
            <button
              id="nfe-cli-add"
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setShowCustomerQuick((v) => !v);
                if (!showCustomerQuick && customerQ.trim()) {
                  const digits = customerQ.replace(/\D/g, '');
                  setCustomerQuick((d) => ({
                    name: digits.length >= 11 ? d.name : customerQ.trim(),
                    document: digits.length >= 11 ? formatCpfCnpj(digits) : d.document,
                  }));
                }
              }}
            >
              {showCustomerQuick ? 'Fechar inclusão' : '+ Incluir cliente'}
            </button>
          </div>
        </div>
        {selectedCustomer && (
          <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: 0 }}>
            Selecionado: <strong>{selectedCustomer.name}</strong>
            {selectedCustomer.document
              ? ` · ${formatCpfCnpj(selectedCustomer.document)}`
              : ''}
          </p>
        )}
        {showCustomerQuick && (
          <div
            style={{
              marginTop: '0.75rem',
              padding: '0.75rem',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              background: 'var(--color-surface-elevated, transparent)',
            }}
          >
            <p className="page-desc" style={{ marginTop: 0, marginBottom: '0.55rem' }}>
              Cadastro rápido na própria tela (nome + CPF/CNPJ). Depois você pode completar o endereço
              em Clientes.
            </p>
            <div className="nfe-field-row" style={{ marginBottom: 0 }}>
              <div className="field field--grow">
                <label htmlFor="cq-name">Nome *</label>
                <input
                  id="cq-name"
                  value={customerQuick.name}
                  onChange={(e) => setCustomerQuick((d) => ({ ...d, name: e.target.value }))}
                />
              </div>
              <div className="field field--grow">
                <label htmlFor="cq-doc">CPF/CNPJ *</label>
                <input
                  id="cq-doc"
                  value={customerQuick.document}
                  onChange={(e) =>
                    setCustomerQuick((d) => ({ ...d, document: formatCpfCnpj(e.target.value) }))
                  }
                  inputMode="numeric"
                />
              </div>
              <div className="field field--action">
                <span className="field-label-spacer" aria-hidden="true">
                  Salvar
                </span>
                <button
                  id="cq-save"
                  type="button"
                  className="btn btn-primary"
                  disabled={createCustomerQuick.isPending}
                  onClick={() => {
                    setErr(null);
                    createCustomerQuick.mutate();
                  }}
                >
                  {createCustomerQuick.isPending ? 'Salvando…' : 'Salvar cliente'}
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

      <section className="card" style={{ marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '1rem', marginTop: 0 }}>Natureza da operação *</h2>
        <div className="nfe-field-row">
          <div className="field field--grow">
            <label htmlFor="nfe-nat">Natureza</label>
            <select id="nfe-nat" value={natureId} onChange={(e) => setNatureId(e.target.value)}>
              <option value="">— Selecione —</option>
              {activeNatures.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.code} · CFOP {n.cfop} — {n.description}
                </option>
              ))}
            </select>
          </div>
          <div className="field field--action">
            <span className="field-label-spacer" aria-hidden="true">
              Incluir
            </span>
            <button
              id="nfe-nat-add"
              type="button"
              className="btn btn-secondary"
              onClick={() => setShowNatureQuick((v) => !v)}
            >
              {showNatureQuick ? 'Fechar inclusão' : '+ Incluir natureza'}
            </button>
          </div>
        </div>
        {showNatureQuick && (
          <div
            style={{
              marginTop: '0.75rem',
              padding: '0.75rem',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              background: 'var(--color-surface-elevated, transparent)',
            }}
          >
            <p className="page-desc" style={{ marginTop: 0, marginBottom: '0.55rem' }}>
              Inclusão rápida (também em Cadastros Gerais → Natureza da Operação).
            </p>
            <div className="nfe-field-row" style={{ marginBottom: 0 }}>
              <div className="field field--md">
                <label htmlFor="nq-code">Código</label>
                <input
                  id="nq-code"
                  value={natureQuick.code}
                  onChange={(e) => setNatureQuick((d) => ({ ...d, code: e.target.value }))}
                />
              </div>
              <div className="field field--sm">
                <label htmlFor="nq-cfop">CFOP</label>
                <input
                  id="nq-cfop"
                  value={natureQuick.cfop}
                  onChange={(e) =>
                    setNatureQuick((d) => ({
                      ...d,
                      cfop: e.target.value.replace(/\D/g, '').slice(0, 4),
                    }))
                  }
                />
              </div>
              <div className="field field--grow">
                <label htmlFor="nq-desc">Descrição (natOp)</label>
                <input
                  id="nq-desc"
                  maxLength={60}
                  value={natureQuick.description}
                  onChange={(e) => setNatureQuick((d) => ({ ...d, description: e.target.value }))}
                />
              </div>
              <div className="field field--action">
                <span className="field-label-spacer" aria-hidden="true">
                  Salvar
                </span>
                <button
                  id="nq-save"
                  type="button"
                  className="btn btn-primary"
                  disabled={createNatureQuick.isPending}
                  onClick={() => {
                    setErr(null);
                    createNatureQuick.mutate();
                  }}
                >
                  {createNatureQuick.isPending ? 'Salvando…' : 'Salvar natureza'}
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

      <section className="card" style={{ marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '1rem', marginTop: 0, marginBottom: '0.65rem' }}>Itens</h2>
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '0.55rem',
            marginBottom: '0.85rem',
            padding: '0.55rem 0.7rem',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            background: 'var(--color-surface-elevated, transparent)',
            maxWidth: '36rem',
          }}
        >
          <input
            id="nfe-deduct-stock"
            type="checkbox"
            checked={deductStock}
            onChange={(e) => setDeductStock(e.target.checked)}
            style={{ marginTop: '0.2rem' }}
          />
          <label htmlFor="nfe-deduct-stock" style={{ margin: 0, cursor: 'pointer' }}>
            <strong style={{ display: 'block', fontSize: '0.9rem' }}>Baixar estoque</strong>
            <span
              style={{
                display: 'block',
                fontSize: '0.8rem',
                color: 'var(--color-text-muted)',
                lineHeight: 1.35,
                marginTop: '0.15rem',
              }}
            >
              Marque para debitar os itens do saldo e registrar a saída nos movimentos de estoque
              (igual ao PDV). Desmarcado = só emite a NF, sem alterar estoque.
            </span>
          </label>
        </div>
        <div className="field">
          <label htmlFor="nfe-prod">Produto (busca)</label>
          <input
            id="nfe-prod"
            value={productQ}
            onChange={(e) => setProductQ(e.target.value)}
            placeholder="Nome, SKU ou código de barras"
          />
        </div>
        {productSearch.data && productSearch.data.length > 0 && (
          <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 0.75rem' }}>
            {productSearch.data.slice(0, 12).map((p) => (
              <li key={p.variantId} style={{ marginBottom: '0.25rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-compact"
                  onClick={() => addProduct(p)}
                >
                  + {p.productName} ({p.sku}) — {formatBRL(p.retailPrice)}
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="table-wrap">
          <table className="data-table data-table--no-cards">
            <thead>
              <tr>
                <th>Produto</th>
                <th className="num">Qtd</th>
                <th className="num">Unit.</th>
                <th className="num">Total</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {!lines.length && (
                <tr>
                  <td colSpan={5} className="empty">
                    Nenhum item.
                  </td>
                </tr>
              )}
              {lines.map((l) => (
                <tr key={l.key}>
                  <td>
                    <strong>{l.label}</strong>
                    <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>{l.sku}</div>
                  </td>
                  <td className="num">
                    <input
                      style={{ width: '4.5rem', textAlign: 'right' }}
                      value={l.quantity}
                      onChange={(e) => {
                        const n = Number(String(e.target.value).replace(',', '.')) || 0;
                        setLines((prev) =>
                          prev.map((x) => (x.key === l.key ? { ...x, quantity: n } : x)),
                        );
                      }}
                    />
                  </td>
                  <td className="num">
                    <input
                      style={{ width: '6rem', textAlign: 'right' }}
                      value={l.unitPrice}
                      onChange={(e) => {
                        const n = Number(String(e.target.value).replace(',', '.')) || 0;
                        setLines((prev) =>
                          prev.map((x) => (x.key === l.key ? { ...x, unitPrice: n } : x)),
                        );
                      }}
                    />
                  </td>
                  <td className="num">{formatBRL(l.quantity * l.unitPrice)}</td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-danger btn-compact"
                      onClick={() => setLines((prev) => prev.filter((x) => x.key !== l.key))}
                    >
                      Remover
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="form-row form-row--3" style={{ marginTop: '0.75rem' }}>
          <div className="field">
            <label htmlFor="nfe-disc">Desconto (R$)</label>
            <input id="nfe-disc" value={discount} onChange={(e) => setDiscount(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="nfe-sur">Acréscimo (R$)</label>
            <input id="nfe-sur" value={surcharge} onChange={(e) => setSurcharge(e.target.value)} />
          </div>
          <div className="field">
            <label>Total (produtos − desc. + acrésc. + frete)</label>
            <div style={{ fontWeight: 700, fontSize: '1.1rem', paddingTop: '0.35rem' }}>
              {formatBRL(total)}
            </div>
          </div>
        </div>
      </section>

      <section className="card" style={{ marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '1rem', marginTop: 0 }}>Frete</h2>
        <div className="form-row form-row--2">
          <div className="field">
            <label htmlFor="nfe-fmod">Por conta de</label>
            <select
              id="nfe-fmod"
              value={freightMod}
              onChange={(e) => {
                const v = Number(e.target.value) as 0 | 1 | 9;
                setFreightMod(v);
                if (v === 9) setFreightAmount('0');
              }}
            >
              <option value={9}>Sem frete (modFrete 9)</option>
              <option value={0}>Emitente / CIF (modFrete 0)</option>
              <option value={1}>Destinatário / FOB (modFrete 1)</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="nfe-fval">Valor do frete (vFrete)</label>
            <input
              id="nfe-fval"
              value={freightAmount}
              disabled={freightMod === 9}
              onChange={(e) => setFreightAmount(e.target.value)}
            />
          </div>
        </div>
        <p className="page-desc" style={{ marginBottom: 0, fontSize: '0.8rem' }}>
          O valor entra no total da NF (vNF = produtos − desconto + frete + outras despesas), conforme
          leiaute NF-e.
        </p>
      </section>

      <section className="card" style={{ marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '1rem', marginTop: 0 }}>Entrega / transporte</h2>
        <div className="form-row form-row--2">
          <div className="field">
            <label htmlFor="nfe-plate">Placa do veículo</label>
            <input
              id="nfe-plate"
              value={plate}
              onChange={(e) => setPlate(e.target.value.toUpperCase())}
              maxLength={10}
              placeholder="ABC1D23"
            />
          </div>
          <div className="field">
            <label htmlFor="nfe-driver">Nome do motorista</label>
            <input
              id="nfe-driver"
              value={driver}
              onChange={(e) => setDriver(e.target.value)}
              maxLength={120}
            />
          </div>
        </div>
      </section>

      <section className="card" style={{ marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '1rem', marginTop: 0 }}>Pagamento e observações</h2>
        <div className="field">
          <label htmlFor="nfe-pay">Forma</label>
          <select
            id="nfe-pay"
            value={payMethod}
            onChange={(e) => setPayMethod(e.target.value as typeof payMethod)}
          >
            <option value="CASH">Dinheiro</option>
            <option value="PIX">Pix</option>
            <option value="CARD">Cartão</option>
            <option value="CREDIT">Crediário</option>
            <option value="OTHER">Outro</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="nfe-notes">Observações</label>
          <textarea
            id="nfe-notes"
            rows={5}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            style={{ width: '100%', minHeight: '7rem' }}
            placeholder="Informações complementares da nota (infCpl)…"
          />
        </div>
      </section>

      <div className="modal-actions" style={{ justifyContent: 'flex-start' }}>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => navigate('/notas-fiscais?tab=NF_E')}
        >
          Cancelar
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={saveMut.isPending}
          onClick={() => {
            setErr(null);
            setInfo(null);
            saveMut.mutate(false);
          }}
        >
          {saveMut.isPending ? 'Salvando…' : 'Salvar (fila)'}
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={saveMut.isPending}
          onClick={() => {
            setErr(null);
            setInfo('Abrindo DANFE em nova aba…');
            saveMut.mutate(true);
          }}
        >
          Salvar e emitir (DANFE)
        </button>
      </div>
    </div>
  );
}
