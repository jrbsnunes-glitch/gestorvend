import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FormCadastroModal } from './FormCadastroModal';
import { api } from '../lib/api';
import { isManager } from '../lib/auth';
import { formatBRL } from '../lib/format';

type PreviewItem = {
  saleItemId: string;
  variantId: string;
  name: string;
  sku: string;
  taxUnit: string | null;
  isService: boolean;
  soldQty: number;
  returnedQty: number;
  remainingQty: number;
  unitPrice: number;
  totalLine: number;
};

type Preview = {
  saleId: string;
  saleNumber: number;
  saleTotal: number;
  hasCustomer: boolean;
  items: PreviewItem[];
  payments: Array<{ method: string; amount: number }>;
  fiscal: { message: string; cancelOriginal: boolean; queueReturnNfe: boolean };
};

type ProductHit = {
  variantId: string;
  productName: string;
  sku: string;
  retailPrice: string;
};

type ReplacementLine = {
  variantId: string;
  name: string;
  quantity: string;
  unitPrice: string;
};

function roundQty(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function lineAmount(item: PreviewItem, qty: number): number {
  if (item.soldQty <= 0 || qty <= 0) return 0;
  return Math.round(((item.totalLine * qty) / item.soldQty) * 100) / 100;
}

export function SaleReturnModal({
  saleId,
  saleNumber,
  onClose,
}: {
  saleId: string;
  saleNumber: number;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const manager = isManager();
  const preview = useQuery({
    queryKey: ['sale-return-preview', saleId],
    queryFn: () => api<Preview>(`/sales/${saleId}/return-preview`),
  });
  const [qty, setQty] = useState<Record<string, string>>({});
  const [refundMethod, setRefundMethod] = useState<'CASH' | 'CUSTOMER_CREDIT'>('CASH');
  const [differenceMethod, setDifferenceMethod] = useState<'CASH' | 'PIX' | 'CARD' | 'REQUISITION'>('CASH');
  const [password, setPassword] = useState('');
  const [notes, setNotes] = useState('');
  const [search, setSearch] = useState('');
  const [hits, setHits] = useState<ProductHit[]>([]);
  const [replacements, setReplacements] = useState<ReplacementLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const data = preview.data;
  const returnTotal = useMemo(() => {
    if (!data) return 0;
    return data.items.reduce((sum, it) => {
      const n = Number(String(qty[it.saleItemId] ?? '').replace(',', '.'));
      if (!Number.isFinite(n) || n <= 0) return sum;
      return sum + lineAmount(it, Math.min(n, it.remainingQty));
    }, 0);
  }, [data, qty]);

  const replacementTotal = useMemo(
    () =>
      replacements.reduce((sum, line) => {
        const q = Number(line.quantity.replace(',', '.'));
        const p = Number(line.unitPrice.replace(',', '.'));
        if (!Number.isFinite(q) || !Number.isFinite(p) || q <= 0 || p < 0) return sum;
        return sum + Math.round(q * p * 100) / 100;
      }, 0),
    [replacements],
  );

  async function searchProducts() {
    const q = search.trim();
    if (q.length < 2) return;
    const rows = await api<ProductHit[]>(`/products/search?q=${encodeURIComponent(q)}`);
    setHits(rows.slice(0, 8));
  }

  async function submit() {
    if (!data) return;
    const items = data.items
      .map((it) => {
        const n = Number(String(qty[it.saleItemId] ?? '').replace(',', '.'));
        return { saleItemId: it.saleItemId, quantity: roundQty(n) };
      })
      .filter((it) => it.quantity > 0);
    if (!items.length) {
      setError('Informe a quantidade de pelo menos um item.');
      return;
    }
    const replacementItems = replacements
      .map((line) => ({
        variantId: line.variantId,
        quantity: Number(line.quantity.replace(',', '.')),
        unitPrice: Number(line.unitPrice.replace(',', '.')),
      }))
      .filter((line) => line.quantity > 0 && line.unitPrice >= 0);
    setBusy(true);
    setError(null);
    try {
      const result = await api<{
        fiscalWarning?: string | null;
        replacementError?: string | null;
        replacementSale?: { number: number } | null;
      }>(`/sales/${saleId}/returns`, {
        method: 'POST',
        json: {
          permissionPassword: manager ? undefined : password,
          refundMethod,
          notes: notes.trim() || null,
          items,
          replacementItems,
          differenceMethod,
        },
      });
      await qc.invalidateQueries({ queryKey: ['sales'] });
      const extra = [result.fiscalWarning, result.replacementError].filter(Boolean).join('\n');
      const ok = result.replacementSale
        ? `Devolução registrada. Venda da troca #${result.replacementSale.number}.`
        : 'Devolução registrada.';
      window.alert(extra ? `${ok}\n\n${extra}` : ok);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível registrar a devolução.');
    } finally {
      setBusy(false);
    }
  }

  const exchangeNote =
    replacements.length === 0
      ? null
      : replacementTotal > returnTotal
        ? `Diferença a pagar: ${formatBRL(replacementTotal - returnTotal)}`
        : replacementTotal < returnTotal
          ? `Sobra a devolver: ${formatBRL(returnTotal - replacementTotal)}`
          : 'Troca no mesmo valor da devolução.';

  return (
    <FormCadastroModal
      onClose={onClose}
      size="md"
      dialogLabel={`Devolver ou trocar a venda ${saleNumber}`}
      title={`Devolver / trocar — venda #${saleNumber}`}
      headerExtra={
        data ? <div className="alert alert-info">{data.fiscal.message}</div> : preview.isError ? (
          <div className="alert alert-error">Não foi possível carregar a venda.</div>
        ) : null
      }
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Fechar
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={busy || !data}>
            {busy ? 'Gravando…' : 'Confirmar devolução'}
          </button>
        </>
      }
    >
      {preview.isLoading && <p className="form-cadastro-modal__hint">Carregando itens…</p>}
      {data && (
        <>
          <div className="table-wrap" style={{ marginBottom: '1rem' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="num">Saldo</th>
                  <th className="num">Devolver</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((it) => (
                  <tr key={it.saleItemId}>
                    <td>
                      {it.name}
                      <div style={{ color: 'var(--color-text-muted)', fontSize: '0.78rem' }}>{it.sku}</div>
                    </td>
                    <td className="num">
                      {it.remainingQty.toLocaleString('pt-BR', { maximumFractionDigits: 3 })}
                      {it.taxUnit ? ` ${it.taxUnit}` : ''}
                    </td>
                    <td className="num">
                      <input
                        className="numeric-input"
                        inputMode="decimal"
                        disabled={it.remainingQty <= 0}
                        placeholder="0"
                        aria-label={`Quantidade a devolver de ${it.name}`}
                        value={qty[it.saleItemId] ?? ''}
                        onChange={(e) => setQty((prev) => ({ ...prev, [it.saleItemId]: e.target.value }))}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ marginTop: 0 }}>
            Valor devolvido: <strong>{formatBRL(returnTotal)}</strong>
          </p>
          <div className="field">
            <label htmlFor="sale-return-refund">Sobra em dinheiro ou crédito</label>
            <select
              id="sale-return-refund"
              value={refundMethod}
              onChange={(e) => setRefundMethod(e.target.value as 'CASH' | 'CUSTOMER_CREDIT')}
            >
              <option value="CASH">Dinheiro no caixa aberto</option>
              <option value="CUSTOMER_CREDIT" disabled={!data.hasCustomer}>
                Crédito do cliente
              </option>
            </select>
          </div>

          <h3 className="product-form__section-title">Itens da troca</h3>
          <div className="nfe-field-row">
            <div className="field" style={{ flex: '1 1 16rem' }}>
              <label htmlFor="sale-return-search">Buscar produto</label>
              <input
                id="sale-return-search"
                placeholder="Nome, SKU ou código"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void searchProducts();
                  }
                }}
              />
            </div>
            <button type="button" className="btn btn-secondary" onClick={() => void searchProducts()}>
              Buscar
            </button>
          </div>
          {hits.length > 0 && (
            <div className="table-wrap" style={{ marginBottom: '1rem' }}>
              <table className="data-table">
                <tbody>
                  {hits.map((hit) => (
                    <tr key={hit.variantId}>
                      <td>
                        {hit.productName}
                        <div style={{ color: 'var(--color-text-muted)', fontSize: '0.78rem' }}>{hit.sku}</div>
                      </td>
                      <td className="num">{formatBRL(Number(hit.retailPrice))}</td>
                      <td className="col-actions">
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => {
                            setReplacements((prev) => [
                              ...prev,
                              {
                                variantId: hit.variantId,
                                name: `${hit.productName} (${hit.sku})`,
                                quantity: '1',
                                unitPrice: String(hit.retailPrice),
                              },
                            ]);
                            setHits([]);
                            setSearch('');
                          }}
                        >
                          Incluir
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {replacements.length > 0 && (
            <div className="table-wrap" style={{ marginBottom: '1rem' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th className="num">Qtd</th>
                    <th className="num">Preço</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {replacements.map((line, index) => (
                    <tr key={`${line.variantId}-${index}`}>
                      <td>{line.name}</td>
                      <td className="num">
                        <input
                          className="numeric-input"
                          inputMode="decimal"
                          aria-label={`Quantidade de ${line.name}`}
                          value={line.quantity}
                          onChange={(e) =>
                            setReplacements((prev) =>
                              prev.map((row, i) => (i === index ? { ...row, quantity: e.target.value } : row)),
                            )
                          }
                        />
                      </td>
                      <td className="num">
                        <input
                          className="numeric-input"
                          inputMode="decimal"
                          aria-label={`Preço de ${line.name}`}
                          value={line.unitPrice}
                          onChange={(e) =>
                            setReplacements((prev) =>
                              prev.map((row, i) => (i === index ? { ...row, unitPrice: e.target.value } : row)),
                            )
                          }
                        />
                      </td>
                      <td className="col-actions">
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => setReplacements((prev) => prev.filter((_, i) => i !== index))}
                        >
                          Remover
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {exchangeNote && (
            <p>
              Troca: <strong>{formatBRL(replacementTotal)}</strong>. {exchangeNote}
            </p>
          )}
          {replacements.length > 0 && (
            <div className="field">
              <label htmlFor="sale-return-diff">Diferença a pagar</label>
              <select
                id="sale-return-diff"
                value={differenceMethod}
                onChange={(e) => setDifferenceMethod(e.target.value as typeof differenceMethod)}
              >
                <option value="CASH">Dinheiro</option>
                <option value="PIX">PIX</option>
                <option value="CARD">Cartão</option>
                <option value="REQUISITION" disabled={!data.hasCustomer}>
                  Requisição
                </option>
              </select>
            </div>
          )}
          <div className="field">
            <label htmlFor="sale-return-notes">Observação</label>
            <input id="sale-return-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          {!manager && (
            <div className="field">
              <label htmlFor="sale-return-password">Senha de autorização</label>
              <input
                id="sale-return-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          )}
          {error && <div className="alert alert-error">{error}</div>}
        </>
      )}
    </FormCadastroModal>
  );
}
