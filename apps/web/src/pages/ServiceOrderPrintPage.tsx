import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { StandardReportHeader } from '../components/StandardReportHeader';
import { api } from '../lib/api';
import { formatBRL } from '../lib/format';
import './cash-print.css';

type StatusHistoryRow = {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  note: string | null;
  createdAt: string;
  userId?: string | null;
  userName?: string | null;
};

type PrintData = {
  company: {
    legalName: string;
    tradeName: string;
    cnpj: string;
    phone: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
    termsText: string | null;
  };
  order: {
    number: number;
    status: string;
    type: string;
    openedAt: string;
    promisedAt: string | null;
    problemReport: string | null;
    diagnosis: string | null;
    internalNotes: string | null;
    assetDescription: string | null;
    depositAmount: string;
    itemsTotal: number;
    balanceDue: number;
    customer: { name: string; document: string | null; phone: string | null };
    equipment: {
      label: string;
      brand: string | null;
      model: string | null;
      serialNumber: string | null;
      plateOrTag: string | null;
    } | null;
    assignedTo: { name: string } | null;
    openedBy?: { name: string } | null;
    items: Array<{
      kind: string;
      description: string | null;
      quantity: string;
      unitPrice: string;
      discount: string;
      totalLine: string;
      variant?: { product: { name: string } } | null;
    }>;
    intakeChecklist?: Array<{ label: string; checked?: boolean }> | null;
    statusHistory?: StatusHistoryRow[];
  };
};

type SummaryReport = {
  from: string | null;
  to: string | null;
  totalOrders: number;
  billedCount: number;
  billedTotal: number;
  ticketAverage: number;
  byTechnician: Array<{ name: string; count: number; total: number }>;
  aging: Array<{
    number: number;
    status: string;
    customerName: string;
    daysOpen: number;
    overdue: boolean;
  }>;
  orders: Array<{
    number: number;
    status: string;
    openedAt: string;
    customerName: string;
    assignedToName: string | null;
    itemsTotal: number;
    saleNumber: number | null;
  }>;
};

type PrintView = 'espelho' | 'tech' | 'history';

const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Rascunho',
  QUOTE: 'Orçamento',
  APPROVED: 'Aprovada',
  IN_PROGRESS: 'Em andamento',
  WAITING_PARTS: 'Aguardando peça',
  READY: 'Pronta',
  DELIVERED: 'Entregue',
  BILLED: 'Faturada',
  CANCELLED: 'Cancelada',
};

const TYPE_LABEL: Record<string, string> = {
  CORRECTIVE: 'Corretiva',
  PREVENTIVE: 'Preventiva',
  WARRANTY: 'Garantia',
  INSTALLATION: 'Instalação',
  INSPECTION: 'Vistoria',
  OTHER: 'Outro',
};

const KIND_LABEL: Record<string, string> = {
  PART: 'Peça',
  SERVICE: 'Serviço',
  LABOR: 'Mão de obra',
  OTHER: 'Outro',
};

function equipmentLabel(order: PrintData['order']): string {
  if (order.equipment) {
    return [
      order.equipment.label,
      order.equipment.brand,
      order.equipment.model,
      order.equipment.serialNumber ? `S/N ${order.equipment.serialNumber}` : null,
      order.equipment.plateOrTag,
    ]
      .filter(Boolean)
      .join(' · ');
  }
  return order.assetDescription || '—';
}

function statusLabel(code: string | null | undefined): string {
  if (!code) return '—';
  return STATUS_LABEL[code] ?? code;
}

export function ServiceOrderPrintPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const id = params.get('id') ?? '';
  const report = params.get('report') ?? '';
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const isSummary = report === 'summary';

  const viewParam = params.get('view') ?? 'espelho';
  const view: PrintView =
    viewParam === 'tech' || viewParam === 'history' ? viewParam : 'espelho';

  const setView = (next: PrintView) => {
    const qs = new URLSearchParams(params);
    if (next === 'espelho') qs.delete('view');
    else qs.set('view', next);
    setParams(qs, { replace: true });
  };

  const printQ = useQuery({
    queryKey: ['service-orders', 'print', id],
    queryFn: () => api<PrintData>(`/service-orders/${id}/print-data`),
    enabled: Boolean(id) && !isSummary,
  });

  const summaryQ = useQuery({
    queryKey: ['service-orders', 'summary', from, to],
    queryFn: () => {
      const qs = new URLSearchParams();
      if (from) qs.set('from', from);
      if (to) qs.set('to', to);
      return api<SummaryReport>(`/service-orders/report/summary?${qs}`);
    },
    enabled: isSummary,
  });

  useEffect(() => {
    if ((!isSummary && printQ.data) || (isSummary && summaryQ.data)) {
      window.scrollTo({ top: 0 });
    }
  }, [isSummary, printQ.data, summaryQ.data]);

  const title = useMemo(() => {
    if (isSummary) return 'Serviços realizados';
    if (!printQ.data) return 'Ordem de Serviço';
    const n = printQ.data.order.number;
    if (view === 'tech') return `OS #${n} — Via do técnico`;
    if (view === 'history') return `OS #${n} — Histórico`;
    return `Ordem de Serviço #${n}`;
  }, [isSummary, printQ.data, view]);

  const order = printQ.data?.order;
  const history = order?.statusHistory ?? [];

  return (
    <div className="print-page print-page--compact">
      <div className="print-toolbar no-print">
        <button type="button" className="btn btn-secondary" onClick={() => navigate('/ordens-servico')}>
          ← Voltar
        </button>
        {id && !isSummary ? (
          <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              className={`btn btn-secondary btn-sm${view === 'espelho' ? ' is-active' : ''}`}
              onClick={() => setView('espelho')}
            >
              Espelho
            </button>
            <button
              type="button"
              className={`btn btn-secondary btn-sm${view === 'tech' ? ' is-active' : ''}`}
              onClick={() => setView('tech')}
            >
              Via do técnico
            </button>
            <button
              type="button"
              className={`btn btn-secondary btn-sm${view === 'history' ? ' is-active' : ''}`}
              onClick={() => setView('history')}
            >
              Histórico
            </button>
          </div>
        ) : null}
        <div style={{ flex: 1 }} />
        <button type="button" className="btn btn-primary" onClick={() => window.print()}>
          Imprimir
        </button>
      </div>

      <div className="print-doc">
        <StandardReportHeader documentTitle={title} />

        {isSummary ? (
          <>
            {summaryQ.isLoading && <p>Carregando…</p>}
            {summaryQ.isError && (
              <div className="alert alert-error">{(summaryQ.error as Error).message}</div>
            )}
            {summaryQ.data && (
              <>
                <section className="print-section">
                  <h2>Resumo</h2>
                  <p className="print-summary-line">
                    Ordens: {summaryQ.data.totalOrders} · Faturadas: {summaryQ.data.billedCount} ·
                    Faturamento: {formatBRL(summaryQ.data.billedTotal)} · Ticket médio:{' '}
                    {formatBRL(summaryQ.data.ticketAverage)}
                  </p>
                </section>
                <section className="print-section">
                  <h2>Por técnico</h2>
                  <table className="print-table print-table-compact">
                    <thead>
                      <tr>
                        <th>Técnico</th>
                        <th className="num">OS</th>
                        <th className="num">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summaryQ.data.byTechnician.map((t) => (
                        <tr key={t.name}>
                          <td>{t.name}</td>
                          <td className="num">{t.count}</td>
                          <td className="num">{formatBRL(t.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
                <section className="print-section">
                  <h2>Aging (abertas)</h2>
                  <table className="print-table print-table-compact">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Cliente</th>
                        <th>Status</th>
                        <th className="num">Dias</th>
                        <th>Atraso</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summaryQ.data.aging.map((a) => (
                        <tr key={a.number}>
                          <td>#{a.number}</td>
                          <td>{a.customerName}</td>
                          <td>{statusLabel(a.status)}</td>
                          <td className="num">{a.daysOpen}</td>
                          <td>{a.overdue ? 'Sim' : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
                <section className="print-section">
                  <h2>Listagem</h2>
                  <table className="print-table print-table-compact">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Abertura</th>
                        <th>Cliente</th>
                        <th>Status</th>
                        <th>Técnico</th>
                        <th className="num">Total</th>
                        <th className="num">Venda</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summaryQ.data.orders.map((o) => (
                        <tr key={o.number}>
                          <td>#{o.number}</td>
                          <td>{new Date(o.openedAt).toLocaleString('pt-BR')}</td>
                          <td>{o.customerName}</td>
                          <td>{statusLabel(o.status)}</td>
                          <td>{o.assignedToName ?? '—'}</td>
                          <td className="num">{formatBRL(o.itemsTotal)}</td>
                          <td className="num">{o.saleNumber ? `#${o.saleNumber}` : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              </>
            )}
          </>
        ) : (
          <>
            {!id && (
              <p className="print-empty">
                Informe <code>?id=</code> da OS ou abra pelo botão Espelho.
              </p>
            )}
            {printQ.isLoading && <p>Carregando…</p>}
            {printQ.isError && (
              <div className="alert alert-error">{(printQ.error as Error).message}</div>
            )}
            {order && view === 'espelho' && (
              <>
                <section className="print-section">
                  <p className="print-summary-line">
                    Status: {statusLabel(order.status)} · Tipo:{' '}
                    {TYPE_LABEL[order.type] ?? order.type} · Abertura:{' '}
                    {new Date(order.openedAt).toLocaleString('pt-BR')}
                    {order.promisedAt
                      ? ` · Prazo: ${new Date(order.promisedAt).toLocaleDateString('pt-BR')}`
                      : ''}
                    {order.assignedTo ? ` · Técnico: ${order.assignedTo.name}` : ''}
                  </p>
                  <p>
                    <strong>Cliente:</strong> {order.customer.name}
                    {order.customer.document ? ` · Doc. ${order.customer.document}` : ''}
                    {order.customer.phone ? ` · Tel. ${order.customer.phone}` : ''}
                  </p>
                  <p>
                    <strong>Equipamento:</strong> {equipmentLabel(order)}
                  </p>
                  {order.problemReport ? (
                    <p>
                      <strong>Defeito / solicitação:</strong> {order.problemReport}
                    </p>
                  ) : null}
                  {order.diagnosis ? (
                    <p>
                      <strong>Diagnóstico:</strong> {order.diagnosis}
                    </p>
                  ) : null}
                </section>

                {order.intakeChecklist?.length ? (
                  <section className="print-section">
                    <h2>Checklist de entrada</h2>
                    <ul>
                      {order.intakeChecklist.map((c, i) => (
                        <li key={i}>
                          [{c.checked ? 'X' : ' '}] {c.label}
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                <section className="print-section">
                  <h2>Itens</h2>
                  <table className="print-table print-table-compact">
                    <thead>
                      <tr>
                        <th>Descrição</th>
                        <th>Tipo</th>
                        <th className="num">Qtd</th>
                        <th className="num">Unit.</th>
                        <th className="num">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {order.items.map((it, i) => (
                        <tr key={i}>
                          <td>{it.variant?.product.name ?? it.description ?? '—'}</td>
                          <td>{KIND_LABEL[it.kind] ?? it.kind}</td>
                          <td className="num">{it.quantity}</td>
                          <td className="num">{formatBRL(it.unitPrice)}</td>
                          <td className="num">{formatBRL(it.totalLine)}</td>
                        </tr>
                      ))}
                      {!order.items.length ? (
                        <tr>
                          <td colSpan={5} className="muted">
                            Sem itens.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                    <tfoot>
                      <tr>
                        <th colSpan={4}>Total</th>
                        <th className="num">{formatBRL(order.itemsTotal)}</th>
                      </tr>
                      <tr>
                        <th colSpan={4}>Sinal</th>
                        <th className="num">{formatBRL(order.depositAmount)}</th>
                      </tr>
                      <tr>
                        <th colSpan={4}>Saldo</th>
                        <th className="num">{formatBRL(order.balanceDue)}</th>
                      </tr>
                    </tfoot>
                  </table>
                </section>

                {printQ.data!.company.termsText ? (
                  <section className="print-section">
                    <h2>Termos</h2>
                    <p style={{ whiteSpace: 'pre-wrap', fontSize: '0.72rem' }}>
                      {printQ.data!.company.termsText}
                    </p>
                  </section>
                ) : null}

                <section className="print-section">
                  <p style={{ marginTop: '2rem' }}>
                    _________________________________
                    <br />
                    Assinatura do cliente
                  </p>
                </section>
              </>
            )}

            {order && view === 'tech' && (
              <>
                <section className="print-section">
                  <p className="print-summary-line">
                    <strong>Status:</strong> {statusLabel(order.status)} · <strong>Tipo:</strong>{' '}
                    {TYPE_LABEL[order.type] ?? order.type}
                  </p>
                  <p className="print-summary-line">
                    <strong>Abertura:</strong> {new Date(order.openedAt).toLocaleString('pt-BR')}
                    {order.promisedAt
                      ? ` · Prazo: ${new Date(order.promisedAt).toLocaleDateString('pt-BR')}`
                      : ''}
                  </p>
                  <p>
                    <strong>Técnico responsável:</strong>{' '}
                    {order.assignedTo?.name ?? '— (não atribuído)'}
                  </p>
                  <p>
                    <strong>Cliente:</strong> {order.customer.name}
                    {order.customer.phone ? ` · Tel. ${order.customer.phone}` : ''}
                  </p>
                  <p>
                    <strong>Equipamento:</strong> {equipmentLabel(order)}
                  </p>
                </section>

                <section className="print-section">
                  <h2>Solicitação / defeito</h2>
                  <p style={{ whiteSpace: 'pre-wrap', minHeight: '2.5rem' }}>
                    {order.problemReport || '—'}
                  </p>
                </section>

                <section className="print-section">
                  <h2>Diagnóstico</h2>
                  <p style={{ whiteSpace: 'pre-wrap', minHeight: '2.5rem' }}>
                    {order.diagnosis || '—'}
                  </p>
                </section>

                <section className="print-section">
                  <h2>Notas internas</h2>
                  <p style={{ whiteSpace: 'pre-wrap', minHeight: '2rem' }}>
                    {order.internalNotes || '—'}
                  </p>
                </section>

                {order.intakeChecklist?.length ? (
                  <section className="print-section">
                    <h2>Checklist de entrada</h2>
                    <ul>
                      {order.intakeChecklist.map((c, i) => (
                        <li key={i}>
                          [{c.checked ? 'X' : ' '}] {c.label}
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                <section className="print-section">
                  <h2>Peças / serviços previstos</h2>
                  <table className="print-table print-table-compact">
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th>Tipo</th>
                        <th className="num">Qtd</th>
                      </tr>
                    </thead>
                    <tbody>
                      {order.items.map((it, i) => (
                        <tr key={i}>
                          <td>{it.variant?.product.name ?? it.description ?? '—'}</td>
                          <td>{KIND_LABEL[it.kind] ?? it.kind}</td>
                          <td className="num">{it.quantity}</td>
                        </tr>
                      ))}
                      {!order.items.length ? (
                        <tr>
                          <td colSpan={3}>Nenhum item lançado ainda.</td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </section>

                <section className="print-section">
                  <h2>Serviço executado / observações do técnico</h2>
                  <div
                    style={{
                      border: '1px solid #94a3b8',
                      minHeight: '7rem',
                      marginTop: '0.35rem',
                      borderRadius: '4px',
                    }}
                  />
                  <p style={{ marginTop: '0.75rem', fontSize: '0.78rem' }}>
                    Peças utilizadas (além das previstas):
                    _______________________________________________
                  </p>
                  <p style={{ fontSize: '0.78rem' }}>
                    _______________________________________________________________________________
                  </p>
                </section>

                <section className="print-section">
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      gap: '2rem',
                      marginTop: '1.5rem',
                    }}
                  >
                    <p>
                      _________________________________
                      <br />
                      Assinatura do técnico
                      <br />
                      Data: ____/____/________
                    </p>
                    <p>
                      _________________________________
                      <br />
                      Conferência / responsável
                    </p>
                  </div>
                </section>
              </>
            )}

            {order && view === 'history' && (
              <>
                <section className="print-section">
                  <p className="print-summary-line">
                    Status atual: {statusLabel(order.status)} · Abertura:{' '}
                    {new Date(order.openedAt).toLocaleString('pt-BR')}
                    {order.assignedTo ? ` · Técnico: ${order.assignedTo.name}` : ''}
                  </p>
                  <p>
                    <strong>Cliente:</strong> {order.customer.name}
                  </p>
                  <p>
                    <strong>Equipamento:</strong> {equipmentLabel(order)}
                  </p>
                </section>

                <section className="print-section">
                  <h2>Histórico de status</h2>
                  <table className="print-table print-table-compact">
                    <thead>
                      <tr>
                        <th>Data / hora</th>
                        <th>De</th>
                        <th>Para</th>
                        <th>Usuário</th>
                        <th>Observação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((h) => (
                        <tr key={h.id}>
                          <td>{new Date(h.createdAt).toLocaleString('pt-BR')}</td>
                          <td>{statusLabel(h.fromStatus)}</td>
                          <td>{statusLabel(h.toStatus)}</td>
                          <td>{h.userName ?? '—'}</td>
                          <td>{h.note ?? '—'}</td>
                        </tr>
                      ))}
                      {!history.length ? (
                        <tr>
                          <td colSpan={5}>Nenhuma movimentação registrada.</td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                  <p style={{ marginTop: '0.75rem', fontSize: '0.78rem' }}>
                    Total de registros: {history.length}
                  </p>
                </section>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
