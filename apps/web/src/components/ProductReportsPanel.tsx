import { useNavigate } from 'react-router-dom';
import { useState, type CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import {
  appendProductReportReturn,
  buildProductMovementReportQuery,
  buildProductTurnoverReportQuery,
  buildProductStockReportQuery,
  productStockReportRoute,
  parseProductCodeBound,
  type ProductStockReportKind,
} from '../lib/product-report-format';
import '../components/crud-toolbar.css';
import '../pages/cash-print.css';

function monthStartISO(): string {
  const d = new Date();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-01`;
}

function todayISO(): string {
  const d = new Date();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function parseCadMinBound(raw: string): number | null {
  return parseProductCodeBound(raw);
}

/** Painel modal: relatórios de movimentação, giro e posição de estoque. */
export function ProductReportsPanel({ onClose }: { onClose?: () => void }) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<'move' | 'turnover' | 'financial' | 'physical' | 'minimum'>('move');

  const [movCadFrom, setMovCadFrom] = useState('');
  const [movCadTo, setMovCadTo] = useState('');
  const [movFrom, setMovFrom] = useState(monthStartISO);
  const [movTo, setMovTo] = useState(todayISO);
  const [movLocation, setMovLocation] = useState('');
  const [movCategory, setMovCategory] = useState('');
  const [movMaxCeiling, setMovMaxCeiling] = useState('');
  const [movUseMin, setMovUseMin] = useState(true);
  const [movUseMax, setMovUseMax] = useState(false);
  const [movAlertsOnly, setMovAlertsOnly] = useState(false);
  const [movShowNoMovement, setMovShowNoMovement] = useState(true);
  const [movErr, setMovErr] = useState<string | null>(null);

  const [turnFrom, setTurnFrom] = useState(monthStartISO());
  const [turnTo, setTurnTo] = useState(todayISO());
  const [turnTake, setTurnTake] = useState('80');
  const [turnCadFrom, setTurnCadFrom] = useState('');
  const [turnCadTo, setTurnCadTo] = useState('');
  const [turnCategory, setTurnCategory] = useState('');
  const [turnShowNoSale, setTurnShowNoSale] = useState(true);
  const [turnMaxCeiling, setTurnMaxCeiling] = useState('');
  const [turnUseMin, setTurnUseMin] = useState(true);
  const [turnUseMax, setTurnUseMax] = useState(false);
  const [turnAlertsOnly, setTurnAlertsOnly] = useState(false);
  const [turnShowPeakSalesPeriod, setTurnShowPeakSalesPeriod] = useState(false);
  const [turnErr, setTurnErr] = useState<string | null>(null);

  const [stkCadFrom, setStkCadFrom] = useState('');
  const [stkCadTo, setStkCadTo] = useState('');
  const [stkFrom, setStkFrom] = useState(monthStartISO());
  const [stkTo, setStkTo] = useState(todayISO());
  const [stkLocation, setStkLocation] = useState('');
  const [stkCategory, setStkCategory] = useState('');
  const [stkErr, setStkErr] = useState<string | null>(null);

  const locations = useQuery({
    queryKey: ['stock-locations'],
    queryFn: () => api<Array<{ id: string; code: string; name: string }>>('/stock-locations'),
  });

  const categories = useQuery({
    queryKey: ['categories', 'product-reports'],
    queryFn: () => api<Array<{ id: string; name: string }>>('/categories?q='),
  });

  const cadFromNum = parseCadMinBound(movCadFrom);
  const cadToNum = parseCadMinBound(movCadTo);
  const intervalOk =
    movCadFrom.trim() !== '' &&
    movCadTo.trim() !== '' &&
    cadFromNum !== null &&
    cadToNum !== null &&
    cadFromNum <= cadToNum;

  const canRunMovement = Boolean(movFrom && movTo && intervalOk);

  const turnCadFromNum = parseCadMinBound(turnCadFrom);
  const turnCadToNum = parseCadMinBound(turnCadTo);
  const turnCadHasFrom = turnCadFrom.trim() !== '';
  const turnCadHasTo = turnCadTo.trim() !== '';
  const turnCadPartial = turnCadHasFrom !== turnCadHasTo;
  const turnCadOk =
    turnCadFrom.trim() !== '' &&
    turnCadTo.trim() !== '' &&
    turnCadFromNum !== null &&
    turnCadToNum !== null &&
    turnCadFromNum <= turnCadToNum;
  /** Sem intervalo cadastro: ranking só de quem vendeu; com intervalo: mesmo conjunto da movimentação. */
  const canRunTurnover = Boolean(turnFrom && turnTo && !turnCadPartial);

  function openMovementReport() {
    setMovErr(null);
    const fromN = cadFromNum;
    const toN = cadToNum;
    if (movCadFrom.trim() === '' || movCadTo.trim() === '') {
      setMovErr('Informe o intervalo de código do produto (“de” e “até”).');
      return;
    }
    if (fromN === null || toN === null) {
      setMovErr('Intervalo inválido: use códigos inteiros positivos (ex.: 1 ou 150).');
      return;
    }
    if (fromN > toN) {
      setMovErr('“De” não pode ser maior que “até” no intervalo de código.');
      return;
    }
    if (!movFrom || !movTo) {
      setMovErr('Informe as datas inicial e final do período.');
      return;
    }
    if (movUseMax && !movMaxCeiling.trim()) {
      setMovErr('Informe o teto de estoque para usar o controle máximo.');
      return;
    }
    if (movAlertsOnly && !movUseMin && !(movUseMax && movMaxCeiling.trim())) {
      setMovErr('Para “somente alertas”, use controle mínimo e/ou máximo com teto informado.');
      return;
    }
    const qs = buildProductMovementReportQuery({
      minStockCadFrom: movCadFrom,
      minStockCadTo: movCadTo,
      categoryId: movCategory || undefined,
      from: movFrom,
      to: movTo,
      locationId: movLocation || undefined,
      useMinControl: movUseMin,
      useMaxControl: movUseMax,
      alertsOnly: movAlertsOnly,
      showNoMovement: movShowNoMovement,
      maxStockCeiling: movMaxCeiling,
    });
    onClose?.();
    navigate(`/produtos/relatorio/movimentacao?${appendProductReportReturn(qs)}`);
  }

  function openTurnoverReport() {
    setTurnErr(null);
    if (!turnFrom.trim() || !turnTo.trim()) {
      setTurnErr('Informe as datas inicial e final.');
      return;
    }
    if (turnCadPartial) {
      setTurnErr('Informe ambos “de” e “até” no intervalo de código ou deixe os dois em branco.');
      return;
    }
    if (turnCadFrom.trim() !== '' || turnCadTo.trim() !== '') {
      if (turnCadFromNum === null || turnCadToNum === null) {
        setTurnErr('Intervalo de código inválido: use números inteiros positivos.');
        return;
      }
      if (turnCadFromNum > turnCadToNum) {
        setTurnErr('“De” não pode ser maior que “até” no intervalo de código.');
        return;
      }
    }
    if (turnUseMax && !turnMaxCeiling.trim()) {
      setTurnErr('Informe o teto de estoque para usar o controle máximo.');
      return;
    }
    if (turnAlertsOnly && !turnUseMin && !(turnUseMax && turnMaxCeiling.trim())) {
      setTurnErr('Para “somente alertas”, use controle mínimo e/ou máximo com teto informado.');
      return;
    }
    const qs = buildProductTurnoverReportQuery({
      from: turnFrom,
      to: turnTo,
      take: turnTake,
      minStockCadFrom: turnCadOk ? turnCadFrom : undefined,
      minStockCadTo: turnCadOk ? turnCadTo : undefined,
      categoryId: turnCategory || undefined,
      showNoSale: turnCadOk ? turnShowNoSale : undefined,
      useMinControl: turnUseMin,
      useMaxControl: turnUseMax,
      alertsOnly: turnAlertsOnly,
      maxStockCeiling: turnMaxCeiling,
      showPeakSalesPeriod: turnShowPeakSalesPeriod,
    });
    onClose?.();
    navigate(`/produtos/relatorio/giro?${appendProductReportReturn(qs)}`);
  }

  function openStockReport(kind: ProductStockReportKind) {
    setStkErr(null);
    if (!stkFrom.trim() || !stkTo.trim()) {
      setStkErr('Informe as datas inicial e final.');
      return;
    }
    const hasFrom = stkCadFrom.trim() !== '';
    const hasTo = stkCadTo.trim() !== '';
    if (hasFrom !== hasTo) {
      setStkErr('Informe ambos os campos de código (de / até) ou deixe os dois em branco.');
      return;
    }
    if (hasFrom && hasTo) {
      const a = parseCadMinBound(stkCadFrom);
      const b = parseCadMinBound(stkCadTo);
      if (a === null || b === null) {
        setStkErr('Intervalo de código inválido (use inteiros positivos).');
        return;
      }
      if (a > b) {
        setStkErr('Código “de” não pode ser maior que “até”.');
        return;
      }
    }
    const qs = buildProductStockReportQuery({
      from: stkFrom,
      to: stkTo,
      locationId: stkLocation || undefined,
      categoryId: stkCategory || undefined,
      minStockCadFrom: stkCadFrom || undefined,
      minStockCadTo: stkCadTo || undefined,
    });
    onClose?.();
    navigate(`${productStockReportRoute(kind)}?${appendProductReportReturn(qs)}`);
  }

  const narrow: CSSProperties = { maxWidth: '420px', width: '100%' };
  const compactGap: CSSProperties = { display: 'flex', flexDirection: 'column', gap: '0.45rem' };
  const checkRow: CSSProperties = {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '0.5rem 0.85rem',
    fontSize: '0.82rem',
  };
  const checkLabel: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.3rem',
  };

  return (
    <div className="product-reports-panel" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      <nav className="stock-subnav" aria-label="Tipo de relatório de produtos">
        <button type="button" className={tab === 'move' ? 'active' : ''} onClick={() => setTab('move')}>
          Movimentação
        </button>
        <button type="button" className={tab === 'turnover' ? 'active' : ''} onClick={() => setTab('turnover')}>
          Giro
        </button>
        <button type="button" className={tab === 'financial' ? 'active' : ''} onClick={() => setTab('financial')}>
          Est. financeiro
        </button>
        <button type="button" className={tab === 'physical' ? 'active' : ''} onClick={() => setTab('physical')}>
          Est. físico
        </button>
        <button type="button" className={tab === 'minimum' ? 'active' : ''} onClick={() => setTab('minimum')}>
          Est. mínimo
        </button>
      </nav>

      {tab === 'move' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', alignItems: 'flex-start' }}>
          <details style={{ fontSize: '0.78rem', color: 'var(--color-text-secondary)', maxWidth: '100%' }}>
            <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Sobre controles min / máx / alertas</summary>
            <p style={{ margin: '0.4rem 0 0', lineHeight: 1.35 }}>
              Informe um <strong>intervalo de código sequencial do produto</strong> (1ª coluna da listagem). Entram todas as variantes
              dos produtos nesse intervalo. Nos limites por movimento, o mínimo continua sendo o da variação em questão; o{' '}
              <strong>máximo</strong> usa o <strong>teto</strong> que você informar abaixo. “Só linhas em alerta” mantém apenas
              movimentações em que o saldo após o evento ficou abaixo do mínimo da variação ou acima do teto (quando estiver marcado).
              Por padrão o painel abre com <strong>Incluir sem movimento no período</strong> marcado para listar todas as variações do
              conjunto mesmo sem lançamentos no intervalo — desmarque se quiser só quem efetivamente movimentou.
            </p>
          </details>
          {movErr && <div className="alert alert-error">{movErr}</div>}
          <div style={narrow}>
            <p style={{ margin: '0 0 0.35rem', fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
              Produtos cujo código sequencial está entre “de” e “até” (inclusive)
            </p>
            <p style={{ margin: '0 0 0.45rem', fontSize: '0.72rem', color: 'var(--color-text-muted)', lineHeight: 1.35 }}>
              O filtro usa o <strong>código do produto</strong> e inclui <strong>todas as variantes</strong> desses produtos. Para
              conferir apenas uma SKU, use um link direto por <strong>variantId</strong>.
            </p>
            <div className="form-row" style={{ flexWrap: 'wrap', gap: '0.65rem', alignItems: 'flex-end' }}>
              <div className="field" style={{ minWidth: '7rem' }}>
                <label htmlFor="pr-mov-cfrom">Código de</label>
                <input
                  id="pr-mov-cfrom"
                  inputMode="numeric"
                  placeholder="1"
                  value={movCadFrom}
                  onChange={(e) => setMovCadFrom(e.target.value)}
                />
              </div>
              <div className="field" style={{ minWidth: '7rem' }}>
                <label htmlFor="pr-mov-cto">Código até</label>
                <input
                  id="pr-mov-cto"
                  inputMode="numeric"
                  placeholder="100"
                  value={movCadTo}
                  onChange={(e) => setMovCadTo(e.target.value)}
                />
              </div>
            </div>
          </div>
          <div style={narrow}>
            <div className="field" style={{ marginBottom: '0.65rem' }}>
              <label htmlFor="pr-mov-cat">Categoria</label>
              <select id="pr-mov-cat" value={movCategory} onChange={(e) => setMovCategory(e.target.value)}>
                <option value="">Todas</option>
                {(categories.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <p style={{ margin: '0 0 0.35rem', fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>Período</p>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '0.65rem',
                alignItems: 'flex-end',
                marginBottom: '0.65rem',
              }}
            >
              <div className="field" style={{ flex: '1 1 9rem', minWidth: '8.5rem', maxWidth: '11rem', marginBottom: 0 }}>
                <label htmlFor="pr-mov-from">De</label>
                <input
                  id="pr-mov-from"
                  type="date"
                  value={movFrom}
                  style={{ width: '100%', boxSizing: 'border-box' }}
                  onChange={(e) => setMovFrom(e.target.value)}
                />
              </div>
              <div className="field" style={{ flex: '1 1 9rem', minWidth: '8.5rem', maxWidth: '11rem', marginBottom: 0 }}>
                <label htmlFor="pr-mov-to">Até</label>
                <input
                  id="pr-mov-to"
                  type="date"
                  value={movTo}
                  style={{ width: '100%', boxSizing: 'border-box' }}
                  onChange={(e) => setMovTo(e.target.value)}
                />
              </div>
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="pr-mov-loc">Local</label>
              <select id="pr-mov-loc" value={movLocation} onChange={(e) => setMovLocation(e.target.value)}>
                <option value="">Todos</option>
                {(locations.data ?? []).map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.code}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.85rem' }}>
            <input type="checkbox" checked={movUseMax} onChange={(e) => setMovUseMax(e.target.checked)} />
            Controle por teto máximo
          </label>
          <div style={narrow}>
            <div className="field">
              <label htmlFor="pr-mov-max">Teto (se marcado)</label>
              <input
                id="pr-mov-max"
                inputMode="decimal"
                placeholder="—"
                value={movMaxCeiling}
                disabled={!movUseMax}
                onChange={(e) => setMovMaxCeiling(e.target.value)}
              />
            </div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.85rem', fontSize: '0.85rem' }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
              <input type="checkbox" checked={movUseMin} onChange={(e) => setMovUseMin(e.target.checked)} />
              Usar estoque mínimo cadastrado
            </label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
              <input type="checkbox" checked={movAlertsOnly} onChange={(e) => setMovAlertsOnly(e.target.checked)} />
              Só linhas em alerta
            </label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
              <input
                type="checkbox"
                checked={movShowNoMovement}
                onChange={(e) => setMovShowNoMovement(e.target.checked)}
              />
              Incluir sem movimento no período
            </label>
          </div>
          <div className="print-mode-actions">
            <div style={{ flex: 1 }} />
            <button
              type="button"
              className="btn btn-primary"
              disabled={!canRunMovement}
              onClick={() => openMovementReport()}
            >
              Gerar relatório
            </button>
          </div>
        </div>
      )}

      {tab === 'turnover' && (
        <div style={compactGap}>
          <p style={{ margin: 0, fontSize: '0.76rem', color: 'var(--color-text-muted)', lineHeight: 1.3 }}>
            Ranking por qtd. vendida. Código opcional = conjunto da movimentação; vazio = só quem vendeu.
          </p>
          <details style={{ fontSize: '0.74rem', color: 'var(--color-text-secondary)' }}>
            <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Min / máx / alertas</summary>
            <p style={{ margin: '0.25rem 0 0', lineHeight: 1.3 }}>
              Mín. por SKU; teto opcional. Com intervalo de código, <strong>Incluir sem venda</strong> mantém qtd. 0.
            </p>
          </details>
          {turnErr && <div className="alert alert-error">{turnErr}</div>}
          <div style={narrow}>
            <p style={{ margin: '0 0 0.35rem', fontSize: '0.76rem', color: 'var(--color-text-muted)' }}>
              Código do produto (opcional)
            </p>
            <div className="form-row" style={{ flexWrap: 'wrap', gap: '0.65rem', alignItems: 'flex-end' }}>
              <div className="field" style={{ minWidth: '7rem' }}>
                <label htmlFor="pr-turn-cfrom">De</label>
                <input
                  id="pr-turn-cfrom"
                  inputMode="numeric"
                  placeholder="ex.: 1"
                  value={turnCadFrom}
                  onChange={(e) => setTurnCadFrom(e.target.value)}
                />
              </div>
              <div className="field" style={{ minWidth: '7rem' }}>
                <label htmlFor="pr-turn-cto">Até</label>
                <input
                  id="pr-turn-cto"
                  inputMode="numeric"
                  placeholder="ex.: 100"
                  value={turnCadTo}
                  onChange={(e) => setTurnCadTo(e.target.value)}
                />
              </div>
            </div>
            <div className="field" style={{ marginTop: '0.4rem', marginBottom: 0 }}>
              <label htmlFor="pr-turn-cat">Categoria</label>
              <select id="pr-turn-cat" value={turnCategory} onChange={(e) => setTurnCategory(e.target.value)}>
                <option value="">Todas</option>
                {(categories.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="form-row" style={{ flexWrap: 'wrap', gap: '0.65rem', alignItems: 'flex-end' }}>
            <div className="field">
              <label htmlFor="pr-t-from">De</label>
              <input id="pr-t-from" type="date" value={turnFrom} onChange={(e) => setTurnFrom(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="pr-t-to">Até</label>
              <input id="pr-t-to" type="date" value={turnTo} onChange={(e) => setTurnTo(e.target.value)} />
            </div>
            <div className="field" style={{ width: '5.5rem' }}>
              <label htmlFor="pr-t-take">Top</label>
              <input id="pr-t-take" value={turnTake} onChange={(e) => setTurnTake(e.target.value)} inputMode="numeric" />
            </div>
          </div>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.85rem' }}>
            <input type="checkbox" checked={turnUseMax} onChange={(e) => setTurnUseMax(e.target.checked)} />
            Controle por teto máximo
          </label>
          <div style={narrow}>
            <div className="field">
              <label htmlFor="pr-t-max">Teto (se marcado)</label>
              <input
                id="pr-t-max"
                inputMode="decimal"
                placeholder="—"
                value={turnMaxCeiling}
                disabled={!turnUseMax}
                onChange={(e) => setTurnMaxCeiling(e.target.value)}
              />
            </div>
          </div>
          <div style={checkRow}>
            <label style={checkLabel}>
              <input type="checkbox" checked={turnUseMin} onChange={(e) => setTurnUseMin(e.target.checked)} />
              Estoque mínimo
            </label>
            <label style={checkLabel}>
              <input type="checkbox" checked={turnAlertsOnly} onChange={(e) => setTurnAlertsOnly(e.target.checked)} />
              Só alertas
            </label>
            <label style={{ ...checkLabel, opacity: turnCadOk ? 1 : 0.55 }}>
              <input
                type="checkbox"
                checked={turnShowNoSale}
                disabled={!turnCadOk}
                onChange={(e) => setTurnShowNoSale(e.target.checked)}
              />
              Incluir sem venda
            </label>
            <label style={checkLabel} title="Horário de pico no relatório (fuso de Manaus)">
              <input
                type="checkbox"
                checked={turnShowPeakSalesPeriod}
                onChange={(e) => setTurnShowPeakSalesPeriod(e.target.checked)}
              />
              Pico de movimento no dia
            </label>
          </div>
          <div className="print-mode-actions">
            <div style={{ flex: 1 }} />
            <button
              type="button"
              className="btn btn-primary"
              disabled={!canRunTurnover}
              onClick={() => openTurnoverReport()}
            >
              Gerar relatório
            </button>
          </div>
        </div>
      )}

      {(tab === 'financial' || tab === 'physical' || tab === 'minimum') && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', alignItems: 'flex-start' }}>
          <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--color-text-muted)', maxWidth: '28rem', lineHeight: 1.35 }}>
            {tab === 'financial' &&
              'Valor do estoque ao custo médio e lucro bruto potencial (preço varejo − custo) × quantidade. Posição na data final.'}
            {tab === 'physical' &&
              'Quantidades em estoque e valor de face (quantidade × preço varejo). Total geral ao final do relatório.'}
            {tab === 'minimum' &&
              'Variações com saldo na data final igual ou abaixo do estoque mínimo cadastrado da SKU.'}
          </p>
          {stkErr && <div className="alert alert-error">{stkErr}</div>}
          <div style={narrow}>
            <p style={{ margin: '0 0 0.35rem', fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
              Código do produto — opcional
            </p>
            <div className="form-row" style={{ flexWrap: 'wrap', gap: '0.65rem', alignItems: 'flex-end' }}>
              <div className="field" style={{ minWidth: '7rem' }}>
                <label htmlFor="pr-stk-cfrom">De</label>
                <input
                  id="pr-stk-cfrom"
                  inputMode="numeric"
                  placeholder="opc."
                  value={stkCadFrom}
                  onChange={(e) => setStkCadFrom(e.target.value)}
                />
              </div>
              <div className="field" style={{ minWidth: '7rem' }}>
                <label htmlFor="pr-stk-cto">Até</label>
                <input
                  id="pr-stk-cto"
                  inputMode="numeric"
                  placeholder="opc."
                  value={stkCadTo}
                  onChange={(e) => setStkCadTo(e.target.value)}
                />
              </div>
            </div>
          </div>
          <div style={narrow}>
            <div className="field" style={{ marginBottom: '0.65rem' }}>
              <label htmlFor="pr-stk-cat">Categoria</label>
              <select id="pr-stk-cat" value={stkCategory} onChange={(e) => setStkCategory(e.target.value)}>
                <option value="">Todos</option>
                {(categories.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field" style={{ marginBottom: '0.65rem' }}>
              <label htmlFor="pr-stk-loc">Local de estoque</label>
              <select id="pr-stk-loc" value={stkLocation} onChange={(e) => setStkLocation(e.target.value)}>
                <option value="">Todos</option>
                {(locations.data ?? []).map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.code}
                  </option>
                ))}
              </select>
            </div>
            <p style={{ margin: '0 0 0.35rem', fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>Período</p>
            <div className="form-row" style={{ flexWrap: 'wrap', gap: '0.65rem', alignItems: 'flex-end' }}>
              <div className="field" style={{ minWidth: '8.5rem' }}>
                <label htmlFor="pr-stk-from">Data inicial</label>
                <input id="pr-stk-from" type="date" value={stkFrom} onChange={(e) => setStkFrom(e.target.value)} />
              </div>
              <div className="field" style={{ minWidth: '8.5rem' }}>
                <label htmlFor="pr-stk-to">Data final</label>
                <input id="pr-stk-to" type="date" value={stkTo} onChange={(e) => setStkTo(e.target.value)} />
              </div>
            </div>
          </div>
          <div className="print-mode-actions">
            <div style={{ flex: 1 }} />
            <button
              type="button"
              className="btn btn-primary"
              disabled={!stkFrom || !stkTo}
              onClick={() =>
                openStockReport(tab === 'financial' ? 'financial' : tab === 'physical' ? 'physical' : 'minimum')
              }
            >
              Gerar relatório
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
