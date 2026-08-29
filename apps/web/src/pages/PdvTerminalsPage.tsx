import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { FormModalBackdrop } from '../components/FormModalBackdrop';
import { api } from '../lib/api';

type Terminal = {
  id: string;
  number: number;
  name: string;
  mode: 'SELF_SERVICE' | 'OPERATOR';
  isActive: boolean;
  allowedMethods: string[];
  operatorUserId: string | null;
  mpPointTerminalId: string | null;
  lastSeenAt: string | null;
  createdAt: string;
  pairingUrl: string;
};

type MpPointTerminal = {
  id: string;
  label: string;
  operatingMode: string | null;
  storeId: string | null;
  posId: string | null;
};

function formatSeen(iso: string | null): string {
  if (!iso) return 'Nunca';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return 'agora';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min atrás`;
  return new Date(iso).toLocaleString('pt-BR');
}

function formatMpListHint(message: string): string {
  if (message.includes('403') || message.includes('UNAUTHORIZED') || message.includes('permissão')) {
    return `${message} Informe o device_id manualmente no campo abaixo (app Mercado Pago → Point → detalhes do terminal, ou via curl de homologação).`;
  }
  return message;
}

function MpPointCell({
  terminal,
  mpDevices,
  mpLoading,
  onLoadDevices,
  onSave,
  saving,
}: {
  terminal: Terminal;
  mpDevices: MpPointTerminal[] | null;
  mpLoading: boolean;
  onLoadDevices: () => void;
  onSave: (mpPointTerminalId: string | null) => void;
  saving: boolean;
}) {
  const [manualId, setManualId] = useState(terminal.mpPointTerminalId ?? '');

  useEffect(() => {
    setManualId(terminal.mpPointTerminalId ?? '');
  }, [terminal.mpPointTerminalId]);

  const linked = terminal.mpPointTerminalId?.trim() || null;
  const inList = linked && (mpDevices ?? []).some((d) => d.id === linked);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', minWidth: 240 }}>
      {mpDevices && mpDevices.length > 0 ? (
        <select
          value={linked ?? ''}
          onChange={(e) => onSave(e.target.value || null)}
          disabled={saving || mpLoading}
        >
          <option value="">— Sem Point —</option>
          {mpDevices.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
              {d.operatingMode ? ` (${d.operatingMode})` : ''}
            </option>
          ))}
          {linked && !inList ? <option value={linked}>{linked} (vinculado)</option> : null}
        </select>
      ) : null}

      <input
        type="text"
        value={manualId}
        onChange={(e) => setManualId(e.target.value)}
        placeholder="ID Point manual (PAX_A910__…)"
        disabled={saving}
        style={{ fontSize: '0.8rem', fontFamily: 'monospace' }}
      />
      <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={saving || manualId.trim() === (linked ?? '')}
          onClick={() => onSave(manualId.trim() || null)}
        >
          Salvar ID
        </button>
        {!mpDevices && !mpLoading ? (
          <button type="button" className="btn btn-secondary btn-sm" onClick={onLoadDevices}>
            Listar MP
          </button>
        ) : null}
        {mpLoading ? <span style={{ fontSize: '0.8rem', alignSelf: 'center' }}>Carregando…</span> : null}
      </div>
      {linked ? (
        <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
          Point ativo · confirmação automática no kiosk
        </span>
      ) : null}
    </div>
  );
}

export function PdvTerminalsPage() {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [number, setNumber] = useState('');
  const [mode, setMode] = useState<'SELF_SERVICE' | 'OPERATOR'>('SELF_SERVICE');
  const [err, setErr] = useState<string | null>(null);
  const [tokenModal, setTokenModal] = useState<{ name: string; token: string; number: number } | null>(
    null,
  );
  const [mpDevices, setMpDevices] = useState<MpPointTerminal[] | null>(null);
  const [mpDevicesErr, setMpDevicesErr] = useState<string | null>(null);
  const [mpLoading, setMpLoading] = useState(false);

  const terminals = useQuery({
    queryKey: ['pdv-terminals'],
    queryFn: () => api<Terminal[]>('/pdv-terminals'),
  });

  const create = useMutation({
    mutationFn: () =>
      api<Terminal & { token: string }>('/pdv-terminals', {
        method: 'POST',
        json: {
          name: name.trim(),
          mode,
          ...(number.trim() ? { number: Math.floor(Number(number)) } : {}),
        },
      }),
    onSuccess: (row) => {
      setName('');
      setNumber('');
      setErr(null);
      setTokenModal({ name: row.name, token: row.token, number: row.number });
      void qc.invalidateQueries({ queryKey: ['pdv-terminals'] });
    },
    onError: (e: Error) => setErr(e.message),
  });

  const patch = useMutation({
    mutationFn: (body: {
      id: string;
      isActive?: boolean;
      name?: string;
      mpPointTerminalId?: string | null;
    }) =>
      api(`/pdv-terminals/${encodeURIComponent(body.id)}`, {
        method: 'PATCH',
        json: {
          isActive: body.isActive,
          name: body.name,
          mpPointTerminalId: body.mpPointTerminalId,
        },
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['pdv-terminals'] }),
    onError: (e: Error) => setErr(e.message),
  });

  async function loadMpDevices() {
    setMpLoading(true);
    setMpDevicesErr(null);
    try {
      const rows = await api<MpPointTerminal[]>('/payments/mp-point/terminals');
      setMpDevices(rows);
    } catch (e) {
      setMpDevices(null);
      setMpDevicesErr(formatMpListHint(e instanceof Error ? e.message : 'Erro ao listar terminais MP.'));
    } finally {
      setMpLoading(false);
    }
  }

  const rotate = useMutation({
    mutationFn: (id: string) =>
      api<{ token: string }>(`/pdv-terminals/${encodeURIComponent(id)}/rotate-token`, {
        method: 'POST',
      }),
    onSuccess: (row, id) => {
      const t = terminals.data?.find((x) => x.id === id);
      if (t) setTokenModal({ name: t.name, token: row.token, number: t.number });
    },
    onError: (e: Error) => setErr(e.message),
  });

  const del = useMutation({
    mutationFn: (id: string) =>
      api(`/pdv-terminals/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['pdv-terminals'] }),
    onError: (e: Error) => setErr(e.message),
  });

  const pairingBase = useMemo(() => {
    if (typeof window === 'undefined') return '';
    return `${window.location.origin}/auto-atendimento`;
  }, []);

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Terminais PDV</h1>
          <p className="page-subtitle">
            Cadastre PDVs numerados (1, 2, 3…) para autoatendimento ou operador. Cada terminal recebe um
            token de pareamento.
          </p>
        </div>
      </header>

      {err ? <div className="alert alert-error">{err}</div> : null}

      <section className="card" style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ marginTop: 0 }}>Novo terminal</h2>
        <div className="form-grid" style={{ maxWidth: 520 }}>
          <div className="field">
            <label htmlFor="pdv-num">Número (opcional)</label>
            <input
              id="pdv-num"
              type="number"
              min={1}
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              placeholder="Auto (próximo livre)"
            />
          </div>
          <div className="field">
            <label htmlFor="pdv-name">Nome *</label>
            <input
              id="pdv-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex.: Autoatendimento entrada"
            />
          </div>
          <div className="field">
            <label htmlFor="pdv-mode">Modo</label>
            <select id="pdv-mode" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
              <option value="SELF_SERVICE">Autoatendimento (kiosk)</option>
              <option value="OPERATOR">Operador</option>
            </select>
          </div>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!name.trim() || create.isPending}
          onClick={() => create.mutate()}
        >
          {create.isPending ? 'Criando…' : 'Criar PDV'}
        </button>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Terminais cadastrados</h2>
        {terminals.isLoading ? <p>Carregando…</p> : null}
        {terminals.data?.length === 0 ? <p>Nenhum terminal cadastrado.</p> : null}
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>PDV</th>
                <th>Nome</th>
                <th>Modo</th>
                <th>Status</th>
                <th>Point MP</th>
                <th>Último contato</th>
                <th>URL pareamento</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {(terminals.data ?? []).map((t) => (
                <tr key={t.id}>
                  <td>
                    <strong>#{t.number}</strong>
                  </td>
                  <td>{t.name}</td>
                  <td>{t.mode === 'SELF_SERVICE' ? 'Autoatendimento' : 'Operador'}</td>
                  <td>{t.isActive ? 'Ativo' : 'Inativo'}</td>
                  <td>
                    <MpPointCell
                      terminal={t}
                      mpDevices={mpDevices}
                      mpLoading={mpLoading}
                      onLoadDevices={() => void loadMpDevices()}
                      saving={patch.isPending}
                      onSave={(mpPointTerminalId) => patch.mutate({ id: t.id, mpPointTerminalId })}
                    />
                  </td>
                  <td>{formatSeen(t.lastSeenAt)}</td>
                  <td>
                    <code style={{ fontSize: '0.8rem' }}>
                      {pairingBase}?terminal={t.number}
                    </code>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => rotate.mutate(t.id)}
                      >
                        Novo token
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() =>
                          patch.mutate({ id: t.id, isActive: !t.isActive })
                        }
                      >
                        {t.isActive ? 'Desativar' : 'Ativar'}
                      </button>
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        onClick={() => {
                          if (window.confirm(`Excluir PDV ${t.number}?`)) del.mutate(t.id);
                        }}
                      >
                        Excluir
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {mpDevicesErr ? (
          <div className="alert alert-error" style={{ marginTop: '1rem' }}>
            {mpDevicesErr}
          </div>
        ) : null}
        {mpDevices && mpDevices.length === 0 && !mpDevicesErr ? (
          <p style={{ marginTop: '1rem', fontSize: '0.9rem', color: 'var(--color-text-muted)' }}>
            Nenhum terminal Point encontrado na conta Mercado Pago. Verifique credenciais e modo PDV da
            maquininha.
          </p>
        ) : null}
      </section>

      {tokenModal ? (
        <FormModalBackdrop onClose={() => setTokenModal(null)}>
          <div className="modal" role="dialog" onClick={(e) => e.stopPropagation()}>
            <h2>Token — PDV {tokenModal.number}</h2>
            <p>
              <strong>{tokenModal.name}</strong>
            </p>
            <p style={{ fontSize: '0.9rem', color: 'var(--color-text-muted)' }}>
              Copie o token e configure no app Desktop (setup do kiosk) ou cole na tela de pareamento do
              navegador.
            </p>
            <textarea
              readOnly
              rows={3}
              value={tokenModal.token}
              style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.85rem' }}
              onFocus={(e) => e.target.select()}
            />
            <p style={{ fontSize: '0.85rem' }}>
              URL:{' '}
              <code>
                {pairingBase}?terminal={tokenModal.number}
              </code>
            </p>
            <button type="button" className="btn btn-primary" onClick={() => setTokenModal(null)}>
              Fechar
            </button>
          </div>
        </FormModalBackdrop>
      ) : null}
    </div>
  );
}
