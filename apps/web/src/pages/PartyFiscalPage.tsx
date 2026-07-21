import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { ReportPrintSticker } from '../components/ReportPrintSticker';
import { api } from '../lib/api';
import { formatBRL, formatDate } from '../lib/format';

type SaleRow = {
  id: string;
  number: number;
  status: string;
  total: string;
  createdAt: string;
  customer: { name: string } | null;
  fiscalDocument?: {
    kind: string;
    status: string;
    accessKey: string | null;
  } | null;
};

type GoodsReceiptRow = {
  id: string;
  controlNumber: number;
  mode: string;
  createdAt: string;
  documentNumber: string | null;
  series: string | null;
  issueDate: string | null;
  nfeAccessKey: string | null;
  totalValue: string | null;
  supplier: { legalName: string } | null;
};

function fiscalKindPt(kind: string): string {
  if (kind === 'NFC_E') return 'NFC-e';
  if (kind === 'NF_E') return 'NF-e';
  return kind;
}

function fiscalStatusPt(status: string): string {
  switch (status) {
    case 'AUTHORIZED':
      return 'Autorizada';
    case 'CONTINGENCY':
      return 'Contingência';
    case 'PENDING':
      return 'Pendente';
    case 'REJECTED':
      return 'Rejeitada';
    case 'CANCELLED':
      return 'Cancelada';
    default:
      return status;
  }
}

function saleStatusPt(status: string): string {
  switch (status) {
    case 'COMPLETED':
      return 'Concluída';
    case 'CANCELLED':
      return 'Cancelada';
    case 'DRAFT':
      return 'Rascunho';
    default:
      return status;
  }
}

export function PartyFiscalPage() {
  const [params] = useSearchParams();
  const customerId = params.get('customerId')?.trim() ?? '';
  const supplierId = params.get('supplierId')?.trim() ?? '';
  const partyName = params.get('partyName')?.trim() ?? '';
  const isCustomer = Boolean(customerId);
  const isSupplier = Boolean(supplierId);

  const sales = useQuery({
    queryKey: ['sales', 'party-fiscal', customerId],
    queryFn: () =>
      api<SaleRow[]>(`/sales?customerId=${encodeURIComponent(customerId)}`),
    enabled: isCustomer,
  });

  const receipts = useQuery({
    queryKey: ['goods-receipts', 'party-fiscal', supplierId],
    queryFn: () =>
      api<GoodsReceiptRow[]>(`/goods-receipts?supplierId=${encodeURIComponent(supplierId)}`),
    enabled: isSupplier,
  });

  const backLink = isCustomer ? '/clientes' : isSupplier ? '/fornecedores' : '/';
  const title = isCustomer
    ? 'Notas fiscais — cliente'
    : isSupplier
      ? 'Notas fiscais — fornecedor'
      : 'Notas fiscais';

  return (
    <div className="page print-area">
      <ReportPrintSticker documentTitle={title} />

      <h1 className="page-title">{title}</h1>
      <p className="page-desc">
        {partyName ? (
          <>
            Documentos fiscais relacionados a <strong>{partyName}</strong>.
          </>
        ) : (
          'Selecione um cliente ou fornecedor no cadastro para filtrar os documentos.'
        )}
      </p>

      <div className="toolbar no-print">
        <Link to={backLink} className="btn btn-secondary">
          ← Voltar ao cadastro
        </Link>
        {isCustomer && (
          <Link
            to={`/financeiro?tab=receber&customerId=${encodeURIComponent(customerId)}&partyName=${encodeURIComponent(partyName)}`}
            className="btn btn-ghost"
          >
            Contas a receber
          </Link>
        )}
        {isSupplier && (
          <Link
            to={`/financeiro?tab=pagar&supplierId=${encodeURIComponent(supplierId)}&partyName=${encodeURIComponent(partyName)}`}
            className="btn btn-ghost"
          >
            Contas a pagar
          </Link>
        )}
      </div>

      {!isCustomer && !isSupplier && (
        <div className="alert alert-info">
          Informe um cliente ou fornecedor pela seleção no cadastro ou pela URL (
          <code>customerId</code> / <code>supplierId</code>).
        </div>
      )}

      {isCustomer && (
        <>
          {sales.isError && (
            <div className="alert alert-error">{(sales.error as Error).message}</div>
          )}
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Venda</th>
                  <th>Data</th>
                  <th>Total</th>
                  <th>Status venda</th>
                  <th>DFe</th>
                  <th>Chave</th>
                </tr>
              </thead>
              <tbody>
                {sales.isLoading && (
                  <tr>
                    <td colSpan={6} className="empty">
                      Carregando…
                    </td>
                  </tr>
                )}
                {!sales.isLoading && !sales.data?.length && (
                  <tr>
                    <td colSpan={6} className="empty">
                      Nenhuma venda encontrada para este cliente.
                    </td>
                  </tr>
                )}
                {sales.data?.map((s) => (
                  <tr key={s.id}>
                    <td>#{s.number}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatDate(s.createdAt)}</td>
                    <td>{formatBRL(s.total)}</td>
                    <td>{saleStatusPt(s.status)}</td>
                    <td>
                      {s.fiscalDocument ? (
                        <>
                          {fiscalKindPt(s.fiscalDocument.kind)} ·{' '}
                          {fiscalStatusPt(s.fiscalDocument.status)}
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td style={{ fontSize: '0.82rem', fontFamily: 'monospace' }}>
                      {s.fiscalDocument?.accessKey?.trim()
                        ? `${s.fiscalDocument.accessKey.trim().slice(0, 12)}…`
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {isSupplier && (
        <>
          {receipts.isError && (
            <div className="alert alert-error">{(receipts.error as Error).message}</div>
          )}
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Entrada</th>
                  <th>Emissão</th>
                  <th>Nº doc.</th>
                  <th>Série</th>
                  <th>Modo</th>
                  <th>Valor</th>
                  <th>Chave NF-e</th>
                </tr>
              </thead>
              <tbody>
                {receipts.isLoading && (
                  <tr>
                    <td colSpan={7} className="empty">
                      Carregando…
                    </td>
                  </tr>
                )}
                {!receipts.isLoading && !receipts.data?.length && (
                  <tr>
                    <td colSpan={7} className="empty">
                      Nenhuma entrada de mercadorias para este fornecedor.
                    </td>
                  </tr>
                )}
                {receipts.data?.map((r) => (
                  <tr key={r.id}>
                    <td>#{r.controlNumber}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {r.issueDate ? formatDate(r.issueDate) : formatDate(r.createdAt)}
                    </td>
                    <td>{r.documentNumber ?? '—'}</td>
                    <td>{r.series ?? '—'}</td>
                    <td>{r.mode === 'WITH_NFE_KEY' ? 'Com chave NF-e' : 'Manual'}</td>
                    <td>{r.totalValue != null ? formatBRL(r.totalValue) : '—'}</td>
                    <td style={{ fontSize: '0.82rem', fontFamily: 'monospace' }}>
                      {r.nfeAccessKey?.trim() ? `${r.nfeAccessKey.trim().slice(0, 12)}…` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="page-desc no-print" style={{ marginTop: '1rem' }}>
            Para incluir ou editar entradas, use{' '}
            <Link to="/estoque/entrada">Estoque → Entrada de mercadorias</Link>.
          </p>
        </>
      )}
    </div>
  );
}
