import { useNavigate } from 'react-router-dom';
import { useState, type CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { buildProductMovementReportQuery, buildProductTurnoverReportQuery } from '../lib/product-report-format';

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
  const s = raw.trim();
  if (s === '') return null;
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** Painel modal: relatórios de movimentação (por intervalo de estoque mínimo cadastro) e giro. */
export function ProductReportsPanel() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<'move' | 'turnover'>('move');

  const [movCadFrom, setMovCadFrom] = useState('');
  const [movCadTo, setMovCadTo] = useState('');
  const [movFrom, setMovFrom] = useState(monthStartISO);
  const [movTo, setMovTo] = useState(todayISO);
  const [movLocation, setMovLocation] = useState('');
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
  const [turnShowNoSale, setTurnShowNoSale] = useState(true);
  const [turnMaxCeiling, setTurnMaxCeiling] = useState('');
  const [turnUseMin, setTurnUseMin] = useState(true);
  const [turnUseMax, setTurnUseMax] = useState(false);
  const [turnAlertsOnly, setTurnAlertsOnly] = useState(false);
  const [turnErr, setTurnErr] = useState<string | null>(null);

  const locations = useQuery({
    queryKey: ['stock-locations'],
    queryFn: () => api<Array<{ id: string; code: string; name: string }>>('/stock-locations'),
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
      setMovErr('Informe o intervalo de controle de estoque do produto (“de” e “até”, menor mínimo entre SKUs).');
      return;
    }
    if (fromN === null || toN === null) {
      setMovErr('Intervalo inválido: use números válidos (ex.: 0 ou 15,5).');
      return;
    }
    if (fromN > toN) {
      setMovErr('“De” não pode ser maior que “até” no intervalo de controle de estoque ao nível do produto.');
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
      from: movFrom,
      to: movTo,
      locationId: movLocation || undefined,
      useMinControl: movUseMin,
      useMaxControl: movUseMax,
      alertsOnly: movAlertsOnly,
      showNoMovement: movShowNoMovement,
      maxStockCeiling: movMaxCeiling,
    });
    navigate(`/produtos/relatorio/movimentacao?${qs}`);
  }

  function openTurnoverReport() {
    setTurnErr(null);
    if (!turnFrom.trim() || !turnTo.trim()) {
      setTurnErr('Informe as datas inicial e final.');
      return;
    }
    if (turnCadPartial) {
      setTurnErr('Informe ambos “de” e “até” no intervalo de controle do produto ou deixe os dois em branco.');
      return;
    }
    if (turnCadFrom.trim() !== '' || turnCadTo.trim() !== '') {
      if (turnCadFromNum === null || turnCadToNum === null) {
        setTurnErr('Intervalo de controle inválido: use números válidos.');
        return;
      }
      if (turnCadFromNum > turnCadToNum) {
        setTurnErr('“De” não pode ser maior que “até” no controle de estoque ao nível do produto.');
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
      showNoSale: turnCadOk ? turnShowNoSale : undefined,
      useMinControl: turnUseMin,
      useMaxControl: turnUseMax,
      alertsOnly: turnAlertsOnly,
      maxStockCeiling: turnMaxCeiling,
    });
    navigate(`/produtos/relatorio/giro?${qs}`);
  }

  const narrow: CSSProperties = { maxWidth: '420px', width: '100%' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <div role="tablist" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
        <button
          type="button"
          className={tab === 'move' ? 'btn btn-primary' : 'btn btn-secondary'}
          onClick={() => setTab('move')}
        >
          Movimentação
        </button>
        <button
          type="button"
          className={tab === 'turnover' ? 'btn btn-primary' : 'btn btn-secondary'}
          onClick={() => setTab('turnover')}
        >
          Giro
        </button>
      </div>

      {tab === 'move' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', alignItems: 'flex-start' }}>
          <details style={{ fontSize: '0.78rem', color: 'var(--color-text-secondary)', maxWidth: '100%' }}>
            <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Sobre controles min / máx / alertas</summary>
            <p style={{ margin: '0.4rem 0 0', lineHeight: 1.35 }}>
              Informe um <strong>intervalo sobre o controle de estoque do produto no cadastro</strong>: esse valor corresponde ao{' '}
              <strong>menor estoque mínimo entre as variantes</strong> (SKU) do produto, gravado ao salvar. Entram todas as variantes desses
              produtos — mesmo que alguma SKU tenha mínimo fora do intervalo. Nos limites por movimento, o mínimo continua sendo o da
              variação em questão; o <strong>máximo</strong> usa o <strong>teto</strong> que você informar abaixo. “Só linhas em alerta”
              mantém apenas movimentações em que o saldo após o evento ficou abaixo do mínimo da variação ou acima do teto (quando
              estiver marcado).               Por padrão o painel abre com <strong>Incluir sem movimento no período</strong> marcado para listar todas as
              variações do conjunto mesmo sem lançamentos no intervalo — desmarque se quiser só quem efetivamente movimentou.
            </p>
          </details>
          {movErr && <div className="alert alert-error">{movErr}</div>}
          <div style={narrow}>
            <p style={{ margin: '0 0 0.35rem', fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
              Produtos cujo controle de estoque (menor mínimo entre SKUs) está entre “de” e “até” (inclusive)
            </p>
            <p style={{ margin: '0 0 0.45rem', fontSize: '0.72rem', color: 'var(--color-text-muted)', lineHeight: 1.35 }}>
              O filtro usa o controle gravado no <strong>produto</strong> — o mínimo da variante com menor reposição configurada — e inclui{' '}
              <strong>todas as variantes</strong> desses produtos. Ex.: intervalo iniciando em 1 <strong>exclui</strong> produtos cujo
              menor mínimo entre variantes for <strong>0</strong> (nem que outra SKU tenha mínimo maior). Para conferir apenas uma SKU, use
              um link direto por <strong>variantId</strong>.
            </p>
            <div className="form-row" style={{ flexWrap: 'wrap', gap: '0.65rem', alignItems: 'flex-end' }}>
              <div className="field" style={{ minWidth: '7rem' }}>
                <label htmlFor="pr-mov-cfrom">De</label>
                <input
                  id="pr-mov-cfrom"
                  inputMode="decimal"
                  placeholder="0"
                  value={movCadFrom}
                  onChange={(e) => setMovCadFrom(e.target.value)}
                />
              </div>
              <div className="field" style={{ minWidth: '7rem' }}>
                <label htmlFor="pr-mov-cto">Até</label>
                <input
                  id="pr-mov-cto"
                  inputMode="decimal"
                  placeholder="10"
                  value={movCadTo}
                  onChange={(e) => setMovCadTo(e.target.value)}
                />
              </div>
            </div>
          </div>
          <div style={narrow}>
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
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!canRunMovement}
              onClick={() => openMovementReport()}
            >
              Abrir relatório
            </button>
          </div>
        </div>
      )}

      {tab === 'turnover' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
          <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--color-text-muted)', maxWidth: '26rem', lineHeight: 1.35 }}>
            Ranking por qtd. vendida no período. <strong>Cad. min</strong> opcional = mesmo filtro da movimentação; em branco, só quem
            vendeu.
          </p>
          <details style={{ fontSize: '0.76rem', color: 'var(--color-text-secondary)', maxWidth: '100%' }}>
            <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Min / máx / alertas</summary>
            <p style={{ margin: '0.35rem 0 0', lineHeight: 1.35 }}>
              Mínimo por SKU; teto opcional. Estoque atual somado nos locais. Com intervalo cad., marque <strong>Incluir sem venda</strong> para
              linhas com qtd. 0. “Só alertas” usa o saldo atual.
            </p>
          </details>
          {turnErr && <div className="alert alert-error">{turnErr}</div>}
          <div style={narrow}>
            <p style={{ margin: '0 0 0.35rem', fontSize: '0.76rem', color: 'var(--color-text-muted)' }}>
              Cad. min (controle no produto = menor mínimo entre SKUs)
            </p>
            <div className="form-row" style={{ flexWrap: 'wrap', gap: '0.65rem', alignItems: 'flex-end' }}>
              <div className="field" style={{ minWidth: '7rem' }}>
                <label htmlFor="pr-turn-cfrom">De</label>
                <input
                  id="pr-turn-cfrom"
                  inputMode="decimal"
                  placeholder="ex.: 1"
                  value={turnCadFrom}
                  onChange={(e) => setTurnCadFrom(e.target.value)}
                />
              </div>
              <div className="field" style={{ minWidth: '7rem' }}>
                <label htmlFor="pr-turn-cto">Até</label>
                <input
                  id="pr-turn-cto"
                  inputMode="decimal"
                  placeholder="ex.: 10"
                  value={turnCadTo}
                  onChange={(e) => setTurnCadTo(e.target.value)}
                />
              </div>
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
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.85rem', fontSize: '0.85rem' }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
              <input type="checkbox" checked={turnUseMin} onChange={(e) => setTurnUseMin(e.target.checked)} />
              Usar estoque mínimo cadastrado
            </label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
              <input type="checkbox" checked={turnAlertsOnly} onChange={(e) => setTurnAlertsOnly(e.target.checked)} />
              Só linhas em alerta
            </label>
            <label
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
                opacity: turnCadOk ? 1 : 0.55,
              }}
            >
              <input
                type="checkbox"
                checked={turnShowNoSale}
                disabled={!turnCadOk}
                onChange={(e) => setTurnShowNoSale(e.target.checked)}
              />
              Incluir sem venda
            </label>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!canRunTurnover}
              onClick={() => openTurnoverReport()}
            >
              Abrir relatório
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
