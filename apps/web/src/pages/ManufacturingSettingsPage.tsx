import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { isManager } from '../lib/auth';

type CompanyFactoryFields = {
  factoryStockLocationId: string | null;
  factoryIssuePctAtStart: string | number;
  factoryIssuePctDevelopment: string | number;
};

type StockLocation = {
  id: string;
  code: string;
  name: string;
  isDefault: boolean;
};

export function ManufacturingSettingsPage() {
  const qc = useQueryClient();
  const canEdit = isManager();
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const [factoryStockLocationId, setFactoryStockLocationId] = useState('');
  const [factoryIssuePctAtStart, setFactoryIssuePctAtStart] = useState(0);
  const [factoryIssuePctDevelopment, setFactoryIssuePctDevelopment] = useState(0);

  const companyQ = useQuery({
    queryKey: ['company'],
    queryFn: () => api<CompanyFactoryFields>('/company'),
  });

  const locationsQ = useQuery({
    queryKey: ['stock-locations'],
    queryFn: () => api<StockLocation[]>('/stock-locations'),
  });

  useEffect(() => {
    const c = companyQ.data;
    if (!c) return;
    setFactoryStockLocationId(c.factoryStockLocationId ?? '');
    setFactoryIssuePctAtStart(Number(c.factoryIssuePctAtStart ?? 0));
    setFactoryIssuePctDevelopment(Number(c.factoryIssuePctDevelopment ?? 0));
  }, [companyQ.data]);

  const effectiveLocationLabel = useMemo(() => {
    const locs = locationsQ.data ?? [];
    if (factoryStockLocationId) {
      const sel = locs.find((l) => l.id === factoryStockLocationId);
      return sel ? `${sel.code} — ${sel.name}` : 'Local selecionado (cadastro removido?)';
    }
    const def = locs.find((l) => l.isDefault) ?? locs[0];
    return def
      ? `Padrão do sistema: ${def.code} — ${def.name}`
      : 'Padrão do sistema (cadastre um local em Estoque → Locais)';
  }, [factoryStockLocationId, locationsQ.data]);

  const saveMut = useMutation({
    mutationFn: () =>
      api<CompanyFactoryFields>('/company', {
        method: 'PATCH',
        json: {
          factoryStockLocationId: factoryStockLocationId.trim() || null,
          factoryIssuePctAtStart,
          factoryIssuePctDevelopment,
        },
      }),
    onSuccess: (data) => {
      qc.setQueryData(['company'], data);
      setFeedback({ kind: 'ok', msg: 'Configurações de estoque da fábrica salvas.' });
    },
    onError: (e: Error) => setFeedback({ kind: 'err', msg: e.message }),
  });

  return (
    <div className="page">
      <h1>Configurações da fábrica</h1>
      <p className="page-desc">
        Todos os projetos usam o mesmo depósito para reservar insumos, baixar material e dar entrada
        no produto acabado. Se nenhum local for escolhido, vale o{' '}
        <strong>local de estoque padrão</strong> do sistema.
      </p>

      {feedback ? (
        <div className={`alert alert-${feedback.kind === 'ok' ? 'success' : 'error'}`}>
          {feedback.msg}
        </div>
      ) : null}

      {companyQ.isLoading || locationsQ.isLoading ? <p className="muted">Carregando…</p> : null}

      <section className="card" style={{ marginTop: '1rem', maxWidth: '40rem' }}>
        <h2 className="company-form__h" style={{ marginTop: 0 }}>
          Local de estoque
        </h2>
        <p className="muted" style={{ fontSize: '0.88rem', marginBottom: '0.75rem' }}>
          Em uso agora: <strong>{effectiveLocationLabel}</strong>
        </p>
        <div className="field">
          <label htmlFor="mfg-set-loc">Depósito da fábrica</label>
          <select
            id="mfg-set-loc"
            value={factoryStockLocationId}
            disabled={!canEdit}
            onChange={(e) => setFactoryStockLocationId(e.target.value)}
          >
            <option value="">Usar padrão do sistema</option>
            {(locationsQ.data ?? []).map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.code} — {loc.name}
                {loc.isDefault ? ' (padrão)' : ''}
              </option>
            ))}
          </select>
          <p className="sub" style={{ marginTop: '0.35rem' }}>
            Crie depósitos em{' '}
            <Link to="/estoque/locais">Estoque → Locais</Link> (ex.: &quot;FAB&quot; — Oficina).
          </p>
        </div>

        <h2 className="company-form__h">Baixa automática por fase</h2>
        <p className="muted" style={{ fontSize: '0.88rem' }}>
          Complementa a opção &quot;100% início&quot; em cada linha da BOM. Baixa manual no projeto
          funciona em qualquer fase.
        </p>
        <div className="form-row form-row--2">
          <div className="field">
            <label htmlFor="mfg-set-pct-start">Início (% do BOM com scrap)</label>
            <input
              id="mfg-set-pct-start"
              type="number"
              min={0}
              max={100}
              step="0.01"
              disabled={!canEdit}
              value={factoryIssuePctAtStart}
              onChange={(e) =>
                setFactoryIssuePctAtStart(parseFloat(e.target.value.replace(',', '.')) || 0)
              }
            />
          </div>
          <div className="field">
            <label htmlFor="mfg-set-pct-dev">Em desenvolvimento (% do BOM)</label>
            <input
              id="mfg-set-pct-dev"
              type="number"
              min={0}
              max={100}
              step="0.01"
              disabled={!canEdit}
              value={factoryIssuePctDevelopment}
              onChange={(e) =>
                setFactoryIssuePctDevelopment(parseFloat(e.target.value.replace(',', '.')) || 0)
              }
            />
          </div>
        </div>

        {canEdit ? (
          <div className="modal-actions" style={{ justifyContent: 'flex-start', marginTop: '0.75rem' }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={saveMut.isPending}
              onClick={() => saveMut.mutate()}
            >
              {saveMut.isPending ? 'Salvando…' : 'Salvar'}
            </button>
          </div>
        ) : (
          <p className="muted" style={{ marginTop: '0.75rem', fontSize: '0.85rem' }}>
            Apenas gerente ou administrador pode alterar. Você pode consultar o depósito em uso acima.
          </p>
        )}

        <p className="muted" style={{ marginTop: '1rem', fontSize: '0.85rem' }}>
          Ativação do módulo, termos do orçamento PDF e demais dados da empresa:{' '}
          <Link to="/empresa">Cadastro da empresa → aba Fábrica</Link>.
        </p>
      </section>
    </div>
  );
}
