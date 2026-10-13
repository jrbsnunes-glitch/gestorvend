import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { A4ReportPages, type A4Item } from '../components/A4ReportPages';
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
import './cash-print.css';
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

  const printed = useRef(false);
  const onReady = useCallback((count: number) => {
    if (printed.current || count < 1 || !query.isSuccess) return;
    printed.current = true;
    window.setTimeout(() => window.print(), 400);
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

  const reportItems = useMemo((): A4Item[] => {
    if (query.isLoading) return [{ kind: 'block', key: 'loading', node: <p>Carregando relatório…</p> }];
    if (!data) return [];
    const intro: A4Item = {
      kind: 'block',
      key: 'intro',
      node: (
        <p className="print-sub">
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
              {data.summary.totalInPeriod != null && data.summary.totalInPeriod !== data.summary.projectCount ? (
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
          {data.summary.truncated ? <> · Limite de 1.500 projetos — refine o período.</> : null}
        </p>
      ),
    };
    if (report === 'by_customer') {
      return [
        intro,
        {
          kind: 'table',
          key: 'groups',
          tableClassName: 'data-table',
          head: (
            <tr>
              <th>Cliente</th>
              <th className="num">Projetos</th>
              <th className="num">No prazo</th>
              <th className="num">Atrasados</th>
              <th className="num">Total orçado</th>
            </tr>
          ),
          rows: data.groups.map((g) => (
            <tr key={g.customerId}>
              <td>{g.customerName}</td>
              <td className="num">{g.projectCount}</td>
              <td className="num">{g.onTimeCount}</td>
              <td className="num">{g.overdueCount}</td>
              <td className="num">{formatBRL(g.quotedTotal)}</td>
            </tr>
          )),
          empty: (
            <tr>
              <td colSpan={5}>Nenhum projeto no período.</td>
            </tr>
          ),
        },
      ];
    }
    return [
      intro,
      {
        kind: 'table',
        key: 'rows',
        tableClassName: 'data-table',
        head: (
          <tr>
            <th>#</th>
            <th>Cliente</th>
            <th>Produto</th>
            <th>Status</th>
            <th>Prazo</th>
            <th className="num">Orçamento</th>
            <th>Situação</th>
          </tr>
        ),
        rows: data.rows.map((r) => (
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
        )),
        empty: (
          <tr>
            <td colSpan={7}>Nenhum projeto neste recorte.</td>
          </tr>
        ),
      },
    ];
  }, [data, query.isLoading, report]);

  return (
    <div className="print-page">
      <div className="print-toolbar no-print">
        <Link className="btn btn-secondary" to={backFiltersHref}>
          ← Voltar aos filtros
        </Link>
        <div style={{ flex: 1 }} />
        <button type="button" className="btn btn-primary" onClick={() => window.print()}>
          Imprimir
        </button>
      </div>
      {err && (
        <div className="alert alert-error no-print" style={{ width: '210mm', maxWidth: '100%', margin: '0 auto 0.75rem' }}>
          {err}
        </div>
      )}
      <A4ReportPages
        header={<StandardReportHeader documentTitle={`Fábrica — ${title}`} />}
        items={reportItems}
        layoutKey={`mfg:${report}:${data?.rows.length ?? 0}:${data?.groups.length ?? 0}:${query.status}`}
        onReady={onReady}
      />
    </div>
  );
}
