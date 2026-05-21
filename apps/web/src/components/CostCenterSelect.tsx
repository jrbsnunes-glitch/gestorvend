import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

type Row = { id: string; code: string; description: string; sourceVersion: string };

export function CostCenterSelect(props: {
  /** IN=receitas; OUT=todas exceto receitas (pagamentos); EXPENSE=só 4/5 (caixa). */
  flow: 'IN' | 'OUT' | 'EXPENSE';
  id: string;
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  allowEmpty?: boolean;
  label?: string;
  emptyLabel?: string;
}) {
  const {
    flow,
    id,
    value,
    onChange,
    disabled,
    allowEmpty = true,
    label = 'Centro de custo',
    emptyLabel = '— Opcional —',
  } = props;
  const q = useQuery({
    queryKey: ['financial-overview', 'cost-centers', flow],
    queryFn: () => api<Row[]>(`/financial-overview/cost-centers?flow=${flow}`),
    staleTime: 60_000,
  });
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        value={value}
        disabled={disabled || q.isLoading}
        onChange={(e) => onChange(e.target.value)}
      >
        {allowEmpty && <option value="">{emptyLabel}</option>}
        {(q.data ?? []).map((r) => (
          <option key={r.id} value={r.id}>
            {r.code} — {r.description}
          </option>
        ))}
      </select>
      {q.isError && (
        <small style={{ color: 'var(--color-danger, #b91c1c)' }}>
          {(q.error as Error).message}
        </small>
      )}
    </div>
  );
}
