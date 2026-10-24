import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { A4ReportPages, type A4Item } from '../components/A4ReportPages';
import { StandardReportHeader } from '../components/StandardReportHeader';
import { api } from '../lib/api';
import './cash-print.css';
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
    if (report !== 'second' || !detail.data) return;
    if (detail.data.kind === 'NF_E') {
      navigate(`/notas-fiscais/danfe/${encodeURIComponent(detail.data.id)}`, { replace: true });
      return;
    }
    if (detail.data.saleId) {
      const returnTo = encodeURIComponent('/notas-fiscais?tab=NFC_E');
      navigate(
        `/vendas/impressao?id=${encodeURIComponent(detail.data.saleId)}&returnTo=${returnTo}`,
        { replace: true },
      );
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

  const reportItems = useMemo((): A4Item[] => {
    if (report === 'second') {
      return [{ kind: 'block', key: 'second', node: <p>Abrindo segunda via…</p> }];
    }
    if (report === 'customer' || report === 'period') {
      const items = list.data?.items ?? [];
      return [
        {
          kind: 'table',
          key: 'docs',
          tableClassName: 'data-table',
          head: (
            <tr>
              <th className="num">Controle</th>
              <th>Data</th>
              <th>Cliente</th>
              <th>Situação</th>
              <th>Chave</th>
              <th className="num">Total</th>
            </tr>
          ),
          rows: items.map((r) => (
            <tr key={r.id}>
              <td className="num">{r.sale.number}</td>
              <td>{formatDate(r.sale.createdAt)}</td>
              <td>{r.sale.customer?.name ?? 'Consumidor'}</td>
              <td>{statusLabel(r.status)}</td>
              <td style={{ fontSize: '0.75rem', wordBreak: 'break-all' }}>{r.accessKey ?? '—'}</td>
              <td className="num">{formatBRL(Number(r.sale.total))}</td>
            </tr>
          )),
          empty: (
            <tr>
              <td colSpan={6} className="empty">
                {list.isLoading ? 'Carregando…' : 'Nenhum registro.'}
              </td>
            </tr>
          ),
        },
      ];
    }
    const rows = lines.data?.lines ?? [];
    return [
      {
        kind: 'table',
        key: 'lines',
        tableClassName: 'data-table',
        head: (
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
        ),
        rows: rows.map((r, i) => (
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
        )),
        empty: (
          <tr>
            <td colSpan={8} className="empty">
              {lines.isLoading ? 'Carregando…' : 'Nenhum registro.'}
            </td>
          </tr>
        ),
      },
    ];
  }, [report, list.data, list.isLoading, lines.data, lines.isLoading]);

  return (
    <div className="page print-page print-area">
      <div className="no-print" style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        <Link
          className="btn btn-secondary"
          to={kind === 'NF_E' ? '/notas-fiscais?tab=NF_E' : '/notas-fiscais?tab=NFC_E'}
        >
          Voltar
        </Link>
        <button type="button" className="btn btn-primary" onClick={() => window.print()}>
          Imprimir
        </button>
      </div>

      {(list.isError || lines.isError || detail.isError) && (
        <div className="alert alert-error no-print" style={{ width: '210mm', maxWidth: '100%', margin: '0 auto 0.75rem' }}>
          {(list.error as Error)?.message ||
            (lines.error as Error)?.message ||
            (detail.error as Error)?.message}
        </div>
      )}

      <A4ReportPages
        header={
          <StandardReportHeader
            documentTitle={`${title} — ${kind === 'NFC_E' ? 'NFC-e' : 'NF-e'}`}
            documentExtras={
              <p className="print-sub" style={{ marginBottom: 0 }}>
                Gerado em {formatDate(new Date().toISOString())}
              </p>
            }
          />
        }
        items={reportItems}
        layoutKey={`fiscal:${report}:${kind}:${list.data?.items.length ?? 0}:${lines.data?.lines.length ?? 0}:${list.isLoading}:${lines.isLoading}`}
      />
    </div>
  );
}
