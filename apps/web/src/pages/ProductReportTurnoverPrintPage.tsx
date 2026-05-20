import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { StandardReportHeader } from '../components/StandardReportHeader';
import { api } from '../lib/api';
import { formatBRL } from '../lib/format';
import { buildProductTurnoverReportQuery } from '../lib/product-report-format';
import './cash-print.css';

type TurnoverResponse = {
  methodology: string;
  period: { from: string; to: string };
  cadastroMinStockInterval: { from: number; to: number } | null;
  options: {
    useMinControl: boolean;
    useMaxControl: boolean;
    maxStockCeiling: number | null;
    alertsOnly: boolean;
    showNoSale: boolean;
  };
  lines: Array<{
    variantId: string;
    sku: string;
    productName: string;
    minStock: number;
    productInventoryControlMin: number;
    stockOnHand: number;
    belowMinStock: boolean;
    aboveMaxStock: boolean;
    qtySold: number;
    revenue: number;
    avgSalePrice: number;
    avgCostAtSale: number;
    profit: number;
  }>;
};

type TurnDraft = {
  variantId: string;
  minStockCadFrom: string;
  minStockCadTo: string;
  from: string;
  to: string;
  take: string;
  showNoSale: boolean;
  useMinControl: boolean;
  useMaxControl: boolean;
  alertsOnly: boolean;
  maxStockCeiling: string;
};

function parseCadMinBound(raw: string): number | null {
  const s = raw.trim();
  if (s === '') return null;
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function turnDraftFromSearchParams(sp: URLSearchParams): TurnDraft {
  return {
    variantId: sp.get('variantId') ?? '',
    minStockCadFrom: sp.get('minStockCadFrom') ?? '',
    minStockCadTo: sp.get('minStockCadTo') ?? '',
    from: sp.get('from') ?? '',
    to: sp.get('to') ?? '',
    take: sp.get('take') ?? '80',
    showNoSale: sp.get('showNoSale') !== '0',
    useMinControl: sp.get('useMinControl') !== '0',
    useMaxControl: sp.get('useMaxControl') === '1',
    alertsOnly: sp.get('alertsOnly') === '1',
    maxStockCeiling: sp.get('maxStockCeiling') ?? '',
  };
}

export function ProductReportTurnoverPrintPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [draft, setDraft] = useState<TurnDraft>(() => turnDraftFromSearchParams(searchParams));
  const [applyErr, setApplyErr] = useState<string | null>(null);

  const spKey = searchParams.toString();
  useEffect(() => {
    setDraft(turnDraftFromSearchParams(searchParams));
  }, [spKey]);

  const hasVariant = Boolean(draft.variantId.trim());
  const cadFromN = parseCadMinBound(draft.minStockCadFrom);
  const cadToN = parseCadMinBound(draft.minStockCadTo);
  const cadOk =
    !hasVariant &&
    draft.minStockCadFrom.trim() !== '' &&
    draft.minStockCadTo.trim() !== '' &&
    cadFromN !== null &&
    cadToN !== null &&
    cadFromN <= cadToN;
  const cadPartial =
    !hasVariant &&
    (draft.minStockCadFrom.trim() !== '') !== (draft.minStockCadTo.trim() !== '');

  const qs = useMemo(
    () =>
      buildProductTurnoverReportQuery({
        from: draft.from,
        to: draft.to,
        take: draft.take,
        variantId: hasVariant ? draft.variantId : undefined,
        minStockCadFrom: cadOk ? draft.minStockCadFrom : undefined,
        minStockCadTo: cadOk ? draft.minStockCadTo : undefined,
        showNoSale: cadOk || hasVariant ? draft.showNoSale : undefined,
        useMinControl: draft.useMinControl,
        useMaxControl: draft.useMaxControl,
        alertsOnly: draft.alertsOnly,
        maxStockCeiling: draft.maxStockCeiling,
      }),
    [draft, hasVariant, cadOk],
  );

  const enabled = Boolean(draft.from.trim() && draft.to.trim());

  const report = useQuery({
    queryKey: ['reports', 'product-turnover-print', qs],
    queryFn: () => api<TurnoverResponse>(`/reports/product-turnover?${qs}`),
    enabled,
  });

  const data = report.data;

  function applyFilters() {
    setApplyErr(null);
    if (!draft.from.trim() || !draft.to.trim()) {
      setApplyErr('Informe o período (de / até).');
      return;
    }
    if (draft.variantId.trim()) {
      if (draft.minStockCadFrom.trim() !== '' || draft.minStockCadTo.trim() !== '') {
        setApplyErr('Remova o intervalo cadastro ao usar variantId ou deixe variantId em branco.');
        return;
      }
    } else if (cadPartial) {
      setApplyErr('Informe ambos “de” e “até” no controle do produto ou deixe os dois em branco.');
      return;
    } else if (draft.minStockCadFrom.trim() !== '' || draft.minStockCadTo.trim() !== '') {
      if (cadFromN === null || cadToN === null) {
        setApplyErr('Intervalo de controle inválido (use números).');
        return;
      }
      if (cadFromN > cadToN) {
        setApplyErr('“De” não pode ser maior que “até”.');
        return;
      }
    }
    if (draft.useMaxControl && !draft.maxStockCeiling.trim()) {
      setApplyErr('Informe o teto ao usar controle máximo.');
      return;
    }
    if (draft.alertsOnly && !draft.useMinControl && !(draft.useMaxControl && draft.maxStockCeiling.trim())) {
      setApplyErr('Para “somente alertas”, ative o mínimo e/ou o máximo com teto informado.');
      return;
    }
    setSearchParams(
      new URLSearchParams(
        buildProductTurnoverReportQuery({
          from: draft.from,
          to: draft.to,
          take: draft.take,
          variantId: draft.variantId.trim() || undefined,
          minStockCadFrom: cadOk ? draft.minStockCadFrom : undefined,
          minStockCadTo: cadOk ? draft.minStockCadTo : undefined,
          showNoSale: cadOk || hasVariant ? draft.showNoSale : undefined,
          useMinControl: draft.useMinControl,
          useMaxControl: draft.useMaxControl,
          alertsOnly: draft.alertsOnly,
          maxStockCeiling: draft.maxStockCeiling,
        }),
      ),
      { replace: true },
    );
  }

  const headerExtras = data ? (
    <>
      <p className="print-sub">
        Período {data.period.from} a {data.period.to}
        {' · '}
        Top {draft.take.trim() || '80'} por quantidade vendida (vendas concluídas)
        {data.cadastroMinStockInterval
          ? ` · Controle estoque produto (menor mín. SKUs): ${data.cadastroMinStockInterval.from} a ${data.cadastroMinStockInterval.to}`
          : hasVariant
            ? ' · Uma variação (variantId)'
            : null}
        {data.options.alertsOnly ? ' · apenas linhas em alerta de estoque' : ''}
      </p>
      <p className="print-sub" style={{ marginTop: '0.2rem', fontSize: '0.88rem' }}>
        Controles: mín={data.options.useMinControl ? 'sim' : 'não'}
        {', '}máx=
        {data.options.useMaxControl ? `sim (teto ${data.options.maxStockCeiling ?? '—'})` : 'não'}
        {', '}somente alertas={data.options.alertsOnly ? 'sim' : 'não'}
        {data.cadastroMinStockInterval || hasVariant
          ? `, sem venda no período=${data.options.showNoSale ? 'incluir' : 'omitir'}`
          : ''}
        .
      </p>
    </>
  ) : enabled ? (
    <p className="print-sub">Carregando…</p>
  ) : (
    <p className="print-sub">
      Ajuste o período e os filtros abaixo e clique em <strong>Atualizar relatório</strong>.
    </p>
  );

  const showStock = Boolean(data?.options.useMinControl || data?.options.useMaxControl);
  const showMinCol = Boolean(data?.options.useMinControl);
  const showBelow = Boolean(data?.options.useMinControl);
  const showAbove = Boolean(data?.options.useMaxControl);

  return (
    <div className="print-page">
      <div className="print-toolbar no-print">
        <button type="button" className="btn btn-secondary" onClick={() => navigate('/produtos')}>
          ← Voltar
        </button>
        <div style={{ flex: 1 }} />
        <button type="button" className="btn btn-primary" onClick={() => window.print()}>
          Imprimir ou salvar PDF
        </button>
      </div>

      <div
        className="no-print pm-move-filters"
        style={{
          marginBottom: '0.65rem',
          padding: '0.45rem 0.65rem',
          background: '#f8fafc',
          border: '1px solid #cbd5e1',
          borderRadius: 8,
          maxWidth: '100%',
        }}
      >
        <div className="pm-move-filters__title">Parâmetros e controles min / máx</div>
        {applyErr && <div className="alert alert-error pm-move-filters__alert">{applyErr}</div>}
        {hasVariant ? (
          <p className="pm-move-filters__legacy">
            Filtro por <strong style={{ wordBreak: 'break-all' }}>variantId</strong> — intervalo cad. min fica desativado. Para conjunto por
            produto, limpe o campo e use “Cad. min”.
          </p>
        ) : (
          <p className="pm-move-filters__hint">
            <strong>Cad. min</strong> opcional: mesmo critério da movimentação (controle no produto = menor mínimo entre SKUs). Em branco: só
            SKUs com venda no período.
          </p>
        )}

        <div className="pm-move-filters__row">
          <div className="field pm-move-filters__tinyfield" style={{ minWidth: '10rem' }}>
            <label htmlFor="pt-vid">variantId (opc.)</label>
            <input
              id="pt-vid"
              placeholder="UUID"
              value={draft.variantId}
              onChange={(e) => setDraft((d) => ({ ...d, variantId: e.target.value }))}
            />
          </div>
          {!hasVariant && (
            <div className="pm-move-filters__cadgroup" aria-label="Intervalo controle cadastro produto">
              <span className="pm-move-filters__muted-label">Cad. min</span>
              <div className="field pm-move-filters__tinyfield">
                <label htmlFor="pt-cfrom">De</label>
                <input
                  id="pt-cfrom"
                  inputMode="decimal"
                  value={draft.minStockCadFrom}
                  onChange={(e) => setDraft((d) => ({ ...d, minStockCadFrom: e.target.value }))}
                  placeholder="1"
                  style={{ width: '5rem' }}
                />
              </div>
              <div className="field pm-move-filters__tinyfield">
                <label htmlFor="pt-cto">Até</label>
                <input
                  id="pt-cto"
                  inputMode="decimal"
                  value={draft.minStockCadTo}
                  onChange={(e) => setDraft((d) => ({ ...d, minStockCadTo: e.target.value }))}
                  placeholder="10"
                  style={{ width: '5rem' }}
                />
              </div>
            </div>
          )}
          <div className="field pm-move-filters__tinyfield">
            <label htmlFor="pt-from">Período de</label>
            <input id="pt-from" type="date" value={draft.from} onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))} />
          </div>
          <div className="field pm-move-filters__tinyfield">
            <label htmlFor="pt-to">Período até</label>
            <input id="pt-to" type="date" value={draft.to} onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))} />
          </div>
          <div className="field pm-move-filters__tinyfield">
            <label htmlFor="pt-take">Top</label>
            <input
              id="pt-take"
              value={draft.take}
              onChange={(e) => setDraft((d) => ({ ...d, take: e.target.value }))}
              inputMode="numeric"
              style={{ width: '4.5rem' }}
            />
          </div>
        </div>

        <div className="pm-move-filters__row pm-move-filters__row--controls">
          <label className="pm-move-filters__chk">
            <input
              type="checkbox"
              checked={draft.useMaxControl}
              onChange={(e) => setDraft((d) => ({ ...d, useMaxControl: e.target.checked }))}
            />
            Teto máx.
          </label>
          <div className="field pm-move-filters__tinyfield pm-move-filters__teto">
            <label htmlFor="pt-max">Teto</label>
            <input
              id="pt-max"
              inputMode="decimal"
              placeholder="—"
              disabled={!draft.useMaxControl}
              value={draft.maxStockCeiling}
              onChange={(e) => setDraft((d) => ({ ...d, maxStockCeiling: e.target.value }))}
            />
          </div>
          <label className="pm-move-filters__chk">
            <input
              type="checkbox"
              checked={draft.useMinControl}
              onChange={(e) => setDraft((d) => ({ ...d, useMinControl: e.target.checked }))}
            />
            Usar mín. cadastrado
          </label>
          <label className="pm-move-filters__chk">
            <input
              type="checkbox"
              checked={draft.alertsOnly}
              onChange={(e) => setDraft((d) => ({ ...d, alertsOnly: e.target.checked }))}
            />
            Só linhas alerta
          </label>
          <label className="pm-move-filters__chk">
            <input
              type="checkbox"
              checked={draft.showNoSale}
              disabled={!cadOk && !hasVariant}
              onChange={(e) => setDraft((d) => ({ ...d, showNoSale: e.target.checked }))}
            />
            SKUs sem venda
          </label>
          <button type="button" className="btn btn-primary pm-move-filters__submit" onClick={() => applyFilters()}>
            Atualizar
          </button>
        </div>
      </div>

      <div className="print-doc">
        <StandardReportHeader documentTitle="Giro de produtos" documentExtras={headerExtras} />

        {!enabled && (
          <p className="print-empty no-print">
            Informe o período inicial e final acima e clique em <strong>Atualizar relatório</strong>.
          </p>
        )}

        {enabled && report.isLoading && <p>Carregando…</p>}
        {enabled && report.isError && (
          <div className="alert alert-error no-print">
            {(report.error as Error)?.message ?? 'Erro ao carregar relatório.'}
          </div>
        )}

        {data && (
          <>
            {!!data.methodology.trim() && (
              <p
                className="print-sub no-print"
                style={{ marginBottom: '0.75rem', fontSize: '0.82rem', lineHeight: 1.35 }}
              >
                {data.methodology}
              </p>
            )}
            {!data.lines.length ? (
              <p className="print-empty">
                Sem variantes neste relatório — verifique período ou o filtro de alertas de estoque.
              </p>
            ) : (
              <table className="print-table">
                <thead>
                  <tr>
                    <th className="num">Ctr. prod.</th>
                    <th>Produto</th>
                    <th>SKU</th>
                    {showMinCol ? <th className="num">Mín. cad.</th> : null}
                    {showStock ? <th className="num">Estoque atual</th> : null}
                    {showBelow ? <th>&lt; mín</th> : null}
                    {showAbove ? <th>&gt; teto</th> : null}
                    <th className="num">Qtd vendida</th>
                    <th className="num">Receita</th>
                    <th className="num">P. venda médio</th>
                    <th className="num">Custo médio (na venda)</th>
                    <th className="num">Lucro estimado</th>
                  </tr>
                </thead>
                <tbody>
                  {data.lines.map((r, idx) => (
                    <tr key={`${r.variantId}-${idx}`}>
                      <td className="num">
                        {r.productInventoryControlMin.toLocaleString('pt-BR', { maximumFractionDigits: 4 })}
                      </td>
                      <td>{r.productName}</td>
                      <td>{r.sku}</td>
                      {showMinCol ? (
                        <td className="num">
                          {r.minStock.toLocaleString('pt-BR', { maximumFractionDigits: 4 })}
                        </td>
                      ) : null}
                      {showStock ? (
                        <td className="num">
                          {r.stockOnHand.toLocaleString('pt-BR', { maximumFractionDigits: 4 })}
                        </td>
                      ) : null}
                      {showBelow ? <td>{r.belowMinStock ? 'Sim' : '—'}</td> : null}
                      {showAbove ? <td>{r.aboveMaxStock ? 'Sim' : '—'}</td> : null}
                      <td className="num">{r.qtySold.toLocaleString('pt-BR', { maximumFractionDigits: 4 })}</td>
                      <td className="num">{formatBRL(r.revenue)}</td>
                      <td className="num">{formatBRL(r.avgSalePrice)}</td>
                      <td className="num">{formatBRL(r.avgCostAtSale)}</td>
                      <td className="num">{formatBRL(r.profit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <footer className="print-foot" style={{ marginTop: '1.25rem', fontSize: '0.82rem' }}>
              <span>GestorVend · Giro · valores para gestão; não substitui demonstrativos contábeis.</span>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}
