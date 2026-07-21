import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ReportPrintSticker } from '../components/ReportPrintSticker';
import { api } from '../lib/api';
import { formatBRL, formatDate } from '../lib/format';

type DocRow = {
  id: string;
  saleId: string;
  kind: string;
  status: string;
  accessKey: string | null;
  protocol: string | null;
  sale: {
    number: number;
    total: string;
    createdAt: string;
    customer: { name: string } | null;
  };
};

type LineRow = {
  documentId: string;
  saleNumber: number;
  saleDate: string;
  customerName: string | null;
  productName: string;
  sku: string | null;
  categoryName: string | null;
  cfop: string | null;
  quantity: string;
  unitPrice: string;
  totalLine: string;
};

function statusLabel(s: string): string {
  if (s === 'AUTHORIZED') return 'Autorizada';
  if (s === 'CONTINGENCY') return 'Contingência';
  return s;
}

/**
 * Página limpa de impressão dos relatórios do módulo Notas Fiscais.
 */
export function FiscalNotesPrintPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const report = params.get('report') ?? 'period';
  const kind = params.get('kind') === 'NF_E' ? 'NF_E' : 'NFC_E';
  const documentId = params.get('documentId') ?? '';

  const listQs = useMemo(() => {
    const p = new URLSearchParams();
    p.set('kind', kind);
    p.set('take', '500');
    p.set('skip', '0');
    if (params.get('customerId')) p.set('customerId', params.get('customerId')!);
    if (params.get('dateFrom')) p.set('dateFrom', params.get('dateFrom')!);
    if (params.get('dateTo')) p.set('dateTo', params.get('dateTo')!);
    return p.toString();
  }, [kind, params]);

  const linesQs = useMemo(() => {
    const p = new URLSearchParams(listQs);
    if (params.get('productId')) p.set('productId', params.get('productId')!);
    if (params.get('categoryId')) p.set('categoryId', params.get('categoryId')!);
    if (params.get('cfop')) p.set('cfop', params.get('cfop')!);
    return p.toString();
  }, [listQs, params]);

  const list = useQuery({
    queryKey: ['fiscal', 'documents', 'print', listQs],
    queryFn: () => api<{ items: DocRow[] }>(`/fiscal/documents?${listQs}`),
    enabled: report !== 'second' && (report === 'customer' || report === 'period'),
  });

  const lines = useQuery({
    queryKey: ['fiscal', 'documents', 'report-lines', linesQs],
    queryFn: () => api<{ lines: LineRow[] }>(`/fiscal/documents/report-lines?${linesQs}`),
    enabled: report === 'product' || report === 'category' || report === 'cfop',
  });

  const detail = useQuery({
    queryKey: ['fiscal', 'documents', documentId],
    queryFn: () => api<DocRow>(`/fiscal/documents/${documentId}`),
    enabled: report === 'second' && Boolean(documentId),
  });

  useEffect(() => {
    if (report === 'second' && detail.data?.saleId) {
      navigate(`/vendas/impressao?id=${encodeURIComponent(detail.data.saleId)}`, { replace: true });
    }
  }, [report, detail.data, navigate]);

  const title = useMemo(() => {
    switch (report) {
      case 'customer':
        return 'Notas por cliente';
      case 'product':
        return 'Notas por produto';
      case 'category':
        return 'Notas por categoria';
      case 'cfop':
        return 'Notas por CFOP';
      case 'second':
        return 'Segunda via';
      default:
        return 'Notas por período';
    }
  }, [report]);

  return (
    <div className="page print-page print-area">
      <div className="no-print" style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        <Link className="btn btn-secondary" to="/notas-fiscais">
          Voltar
        </Link>
        <button type="button" className="btn btn-primary" onClick={() => window.print()}>
          Imprimir
        </button>
      </div>

      <ReportPrintSticker
        documentTitle={`${title} — ${kind === 'NFC_E' ? 'NFC-e' : 'NF-e'}`}
        documentExtras={
          <p className="print-sub page-desc" style={{ marginBottom: 0 }}>
            Gerado em {formatDate(new Date().toISOString())}
          </p>
        }
      />

      {(list.isError || lines.isError || detail.isError) && (
        <div className="alert alert-error">
          {(list.error as Error)?.message ||
            (lines.error as Error)?.message ||
            (detail.error as Error)?.message}
        </div>
      )}

      {(report === 'customer' || report === 'period') && (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th className="num">Controle</th>
                <th>Data</th>
                <th>Cliente</th>
                <th>Situação</th>
                <th>Chave</th>
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {list.isLoading && (
                <tr>
                  <td colSpan={6} className="empty">
                    Carregando…
                  </td>
                </tr>
              )}
              {(list.data?.items ?? []).map((r) => (
                <tr key={r.id}>
                  <td className="num">{r.sale.number}</td>
                  <td>{formatDate(r.sale.createdAt)}</td>
                  <td>{r.sale.customer?.name ?? 'Consumidor'}</td>
                  <td>{statusLabel(r.status)}</td>
                  <td style={{ fontSize: '0.75rem', wordBreak: 'break-all' }}>{r.accessKey ?? '—'}</td>
                  <td className="num">{formatBRL(Number(r.sale.total))}</td>
                </tr>
              ))}
              {!list.isLoading && !(list.data?.items.length ?? 0) && (
                <tr>
                  <td colSpan={6} className="empty">
                    Nenhum registro.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {(report === 'product' || report === 'category' || report === 'cfop') && (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th className="num">NF</th>
                <th>Data</th>
                <th>Cliente</th>
                <th>Produto</th>
                <th>Categoria</th>
                <th>CFOP</th>
                <th className="num">Qtd</th>
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {lines.isLoading && (
                <tr>
                  <td colSpan={8} className="empty">
                    Carregando…
                  </td>
                </tr>
              )}
              {(lines.data?.lines ?? []).map((r, i) => (
                <tr key={`${r.documentId}-${i}`}>
                  <td className="num">{r.saleNumber}</td>
                  <td>{formatDate(r.saleDate)}</td>
                  <td>{r.customerName ?? '—'}</td>
                  <td>
                    {r.productName}
                    {r.sku ? (
                      <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>{r.sku}</div>
                    ) : null}
                  </td>
                  <td>{r.categoryName ?? '—'}</td>
                  <td>{r.cfop ?? '—'}</td>
                  <td className="num">{Number(r.quantity).toLocaleString('pt-BR')}</td>
                  <td className="num">{formatBRL(Number(r.totalLine))}</td>
                </tr>
              ))}
              {!lines.isLoading && !(lines.data?.lines.length ?? 0) && (
                <tr>
                  <td colSpan={8} className="empty">
                    Nenhum registro.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {report === 'second' && detail.isLoading && <p>Abrindo segunda via…</p>}
    </div>
  );
}
