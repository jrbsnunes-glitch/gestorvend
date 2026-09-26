import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ManufacturingStatusChip } from '../components/ManufacturingStatusChip';
import { StandardReportHeader } from '../components/StandardReportHeader';
import { api } from '../lib/api';
import { formatBRL, formatCalendarDate } from '../lib/format';
import {
  MFG_DELIVERY_SITUATION_LABEL,
  type MfgDeliverySituation,
} from '../lib/manufacturing-labels';
import {
  MFG_PROJECT_REPORT_KINDS,
  type MfgProjectReportDateField,
  type MfgProjectReportKind,
  type MfgProjectReportResponse,
  mfgProjectReportQueryString,
  mfgReportsModalSearch,
} from '../lib/manufacturing-project-reports';
import './manufacturing-reports.css';

const VALID_REPORTS = new Set<MfgProjectReportKind>(
  MFG_PROJECT_REPORT_KINDS.map((k) => k.id),
);

function deliveryTagClass(s: MfgDeliverySituation): string {
  if (s === 'on_track' || s === 'delivered_on_time') return 'mfg-reports-tag mfg-reports-tag--ok';
  if (s === 'overdue' || s === 'delivered_late') return 'mfg-reports-tag mfg-reports-tag--bad';
  return 'mfg-reports-tag mfg-reports-tag--muted';
}

export function ManufacturingProjectReportsPrintPage() {
  const [params] = useSearchParams();
  const reportParam = params.get('report') ?? 'on_time';
  const report: MfgProjectReportKind = VALID_REPORTS.has(reportParam as MfgProjectReportKind)
    ? (reportParam as MfgProjectReportKind)
    : 'on_time';
  const dateField = (params.get('dateField') ?? 'promisedAt') as MfgProjectReportDateField;
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const customerId = params.get('customerId') ?? '';

  const qs = useMemo(
    () =>
      mfgProjectReportQueryString({
        report,
        dateField,
        from,
        to,
        customerId: customerId || undefined,
      }),
    [report, dateField, from, to, customerId],
  );

  const query = useQuery({
    queryKey: ['manufacturing', 'reports', 'print', qs],
    queryFn: () => api<MfgProjectReportResponse>(`/manufacturing/reports/projects?${qs}`),
    enabled: Boolean(from && to),
  });

  useEffect(() => {
    if (query.isSuccess) {
      const t = window.setTimeout(() => window.print(), 400);
      return () => window.clearTimeout(t);
    }
  }, [query.isSuccess]);

  const err =
    !from || !to
      ? 'Informe o período (de/até) para gerar o relatório.'
      : query.isError
        ? (query.error as Error).message
        : null;

  const data = query.data;
  const title = data?.reportLabel ?? 'Projetos de fabricação';
  const backFiltersHref = `/fabrica?${mfgReportsModalSearch({
    report,
    dateField,
    from,
    to,
    customerId: customerId || undefined,
  })}`;

  return (
    <div className="page print-area gv-report-sheet">
      <StandardReportHeader
        documentTitle={`Fábrica — ${title}`}
        documentExtras={
          <p className="print-sub page-desc no-print" style={{ marginBottom: 0 }}>
            <Link to={backFiltersHref}>← Voltar aos filtros</Link>
          </p>
        }
      />

      {query.isLoading && <p>Carregando relatório…</p>}
      {err && <div className="alert alert-error">{err}</div>}

      {data ? (
        <>
          <p className="page-desc">
            Período ({data.period.dateFieldLabel}):{' '}
            <strong>
              {formatCalendarDate(data.period.from)} — {formatCalendarDate(data.period.to)}
            </strong>
            {report === 'by_customer' ? (
              <>
                {' '}
                · Clientes: <strong>{data.summary.customerCount ?? 0}</strong>
              </>
            ) : (
              <>
                {' '}
                · Projetos: <strong>{data.summary.projectCount}</strong>
                {data.summary.totalInPeriod != null &&
                data.summary.totalInPeriod !== data.summary.projectCount ? (
                  <> (de {data.summary.totalInPeriod} no período)</>
                ) : null}
              </>
            )}
            {data.summary.quotedTotal != null && data.summary.quotedTotal > 0 ? (
              <>
                {' '}
                · Soma orçamentos: <strong>{formatBRL(data.summary.quotedTotal)}</strong>
              </>
            ) : null}
            {data.summary.truncated ? (
              <> · Limite de 1.500 projetos — refine o período.</>
            ) : null}
          </p>

          {report === 'by_customer' ? (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th className="num">Projetos</th>
                  <th className="num">No prazo</th>
                  <th className="num">Atrasados</th>
                  <th className="num">Total orçado</th>
                </tr>
              </thead>
              <tbody>
                {data.groups.length === 0 ? (
                  <tr>
                    <td colSpan={5}>Nenhum projeto no período.</td>
                  </tr>
                ) : (
                  data.groups.map((g) => (
                    <tr key={g.customerId}>
                      <td>{g.customerName}</td>
                      <td className="num">{g.projectCount}</td>
                      <td className="num">{g.onTimeCount}</td>
                      <td className="num">{g.overdueCount}</td>
                      <td className="num">{formatBRL(g.quotedTotal)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Cliente</th>
                  <th>Produto</th>
                  <th>Status</th>
                  <th>Prazo</th>
                  <th className="num">Orçamento</th>
                  <th>Situação</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.length === 0 ? (
                  <tr>
                    <td colSpan={7}>Nenhum projeto neste recorte.</td>
                  </tr>
                ) : (
                  data.rows.map((r) => (
                    <tr key={r.id}>
                      <td>{r.number}</td>
                      <td>{r.customer.name}</td>
                      <td>
                        {r.finishedVariant.product.name}
                        <span className="sub"> · {r.finishedVariant.sku}</span>
                      </td>
                      <td>
                        <ManufacturingStatusChip status={r.status} />
                      </td>
                      <td>{r.promisedAt ? formatCalendarDate(r.promisedAt) : '—'}</td>
                      <td className="num">{r.quoteTotal ? formatBRL(r.quoteTotal) : '—'}</td>
                      <td>
                        <span className={deliveryTagClass(r.deliverySituation)}>
                          {MFG_DELIVERY_SITUATION_LABEL[r.deliverySituation]}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </>
      ) : null}
    </div>
  );
}
