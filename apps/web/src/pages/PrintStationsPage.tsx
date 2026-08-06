import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { DesktopPrintStationPanel } from '../components/DesktopPrintStationPanel';
import { DesktopPdvPrinterPanel } from '../components/DesktopPdvPrinterPanel';
import { FormModalBackdrop } from '../components/FormModalBackdrop';
import { api } from '../lib/api';
import { getDesktopApi, isGestorVendDesktop } from '../lib/desktop-bridge';
import { checkDesktopUpdate } from '../lib/desktop-update';
import {
  isLocalPrintStation,
  setLocalPrintStation,
} from '../lib/print-station';

type Station = {
  id: string;
  name: string;
  sectors: string[];
  enabled: boolean;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type PrintJob = {
  id: string;
  kind: string;
  sector: string;
  status: string;
  attempts: number;
  error: string | null;
  createdAt: string;
  claimedAt: string | null;
  printedAt: string | null;
  station: { id: string; name: string } | null;
};

function formatSeen(iso: string | null): string {
  if (!iso) return 'Nunca';
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  if (diff < 60_000) return 'agora';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min atrás`;
  return new Date(iso).toLocaleString('pt-BR');
}

function looksLikeElectronShell(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Electron/i.test(navigator.userAgent);
}

export function PrintStationsPage() {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [sectors, setSectors] = useState('COZINHA');
  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [tokenModal, setTokenModal] = useState<{ name: string; token: string } | null>(null);
  const [pairToken, setPairToken] = useState<string | null>(null);
  const [localStation, setLocalStation] = useState(isLocalPrintStation);
  const [jobFilter, setJobFilter] = useState<string>('PENDING');

  const [updateChecking, setUpdateChecking] = useState(false);

  const stations = useQuery({
    queryKey: ['printing', 'stations'],
    queryFn: () => api<Station[]>('/printing/stations'),
  });

  const jobs = useQuery({
    queryKey: ['printing', 'jobs', jobFilter],
    queryFn: () =>
      api<PrintJob[]>(
        `/printing/jobs?take=40${jobFilter ? `&status=${encodeURIComponent(jobFilter)}` : ''}`,
      ),
    refetchInterval: 15_000,
  });

  const create = useMutation({
    mutationFn: () =>
      api<Station & { token: string }>('/printing/stations', {
        method: 'POST',
        json: { name, sectors },
      }),
    onSuccess: (row) => {
      setName('');
      setSectors('COZINHA');
      setErr(null);
      setTokenModal({ name: row.name, token: row.token });
      setPairToken(row.token);
      void qc.invalidateQueries({ queryKey: ['printing', 'stations'] });
    },
    onError: (e: Error) => setErr(e.message),
  });

  const patch = useMutation({
    mutationFn: (body: { id: string; enabled?: boolean; name?: string; sectors?: string }) =>
      api(`/printing/stations/${encodeURIComponent(body.id)}`, {
        method: 'PATCH',
        json: {
          enabled: body.enabled,
          name: body.name,
          sectors: body.sectors,
        },
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['printing', 'stations'] }),
    onError: (e: Error) => setErr(e.message),
  });

  const rotate = useMutation({
    mutationFn: (id: string) =>
      api<{ id: string; token: string }>(`/printing/stations/${encodeURIComponent(id)}/rotate-token`, {
        method: 'POST',
      }),
    onSuccess: (row, id) => {
      const st = stations.data?.find((s) => s.id === id);
      setTokenModal({ name: st?.name ?? 'Estação', token: row.token });
      setPairToken(row.token);
    },
    onError: (e: Error) => setErr(e.message),
  });

  const testPrint = useMutation({
    mutationFn: (id: string) =>
      api(`/printing/stations/${encodeURIComponent(id)}/test`, { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['printing', 'jobs'] }),
    onError: (e: Error) => setErr(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) =>
      api(`/printing/stations/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['printing', 'stations'] }),
    onError: (e: Error) => setErr(e.message),
  });

  const retry = useMutation({
    mutationFn: (id: string) =>
      api(`/printing/jobs/${encodeURIComponent(id)}/retry`, { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['printing', 'jobs'] }),
    onError: (e: Error) => setErr(e.message),
  });

  const pendingCount = useMemo(
    () => (jobs.data ?? []).filter((j) => j.status === 'PENDING' || j.status === 'CLAIMED').length,
    [jobs.data],
  );

  const desktopApi = getDesktopApi();
  const inDesktop = isGestorVendDesktop();
  const electronShell = looksLikeElectronShell();
  const canPairHere = Boolean(desktopApi?.saveStation && desktopApi?.listPrinters);

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Impressão</h1>
          <p className="muted">
            Cadastre a estação da cozinha (token), a impressora do PDV (cupom/NFC-e 80 mm) e
            acompanhe a fila. No Desktop, as impressoras físicas são escolhidas abaixo.
          </p>
        </div>
        {inDesktop ? (
          <button
            type="button"
            className="btn btn-secondary"
            disabled={updateChecking}
            onClick={() => {
              setUpdateChecking(true);
              void checkDesktopUpdate()
                .then((r) => {
                  if (!r.ok) {
                    setErr(r.message);
                    setOkMsg(null);
                    return;
                  }
                  if (r.updateAvailable) {
                    setOkMsg(r.message + (r.notes ? ` — ${r.notes}` : ''));
                    setErr(null);
                    if (r.downloadUrl) {
                      const api = getDesktopApi();
                      if (api?.openExternal) void api.openExternal(r.downloadUrl);
                      else window.open(r.downloadUrl, '_blank', 'noopener,noreferrer');
                    }
                  } else {
                    setOkMsg(r.message);
                    setErr(null);
                  }
                })
                .finally(() => setUpdateChecking(false));
            }}
          >
            {updateChecking ? 'Verificando…' : 'Verificar atualizações'}
          </button>
        ) : null}
      </header>

      {err && (
        <div className="alert alert-error" style={{ marginBottom: '1rem' }}>
          {err}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setErr(null)}>
            Fechar
          </button>
        </div>
      )}
      {okMsg && (
        <div className="alert alert-success" style={{ marginBottom: '1rem' }}>
          {okMsg}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOkMsg(null)}>
            Fechar
          </button>
        </div>
      )}

      {canPairHere ? (
        <>
          <DesktopPdvPrinterPanel
            onMessage={(msg, ok) => {
              if (ok === false) setErr(msg);
              else {
                setOkMsg(msg);
                setErr(null);
              }
            }}
          />
          <DesktopPrintStationPanel
            suggestedToken={pairToken}
            onMessage={(msg, ok) => {
              if (ok) {
                setOkMsg(msg);
                setErr(null);
                void qc.invalidateQueries({ queryKey: ['printing'] });
              } else {
                setErr(msg);
                setOkMsg(null);
              }
            }}
          />
        </>
      ) : electronShell || inDesktop ? (
        <div className="alert alert-error" style={{ marginBottom: '1rem' }}>
          <p style={{ margin: 0 }}>
            Você está no GestorVend Desktop, mas esta versão <strong>não expõe</strong> a API de
            impressoras (<code>window.gestorvend.listPrinters</code>). Feche o app, atualize o
            Desktop (<code>npm run desktop:dev</code> ou reinstale o .exe) e abra de
            novo. O menu <strong>GestorVend → Estação de impressão…</strong> também deve aparecer na
            barra superior.
          </p>
        </div>
      ) : (
        <div className="alert alert-warn" style={{ marginBottom: '1rem' }}>
          Para listar impressoras do Windows use o <strong>app Desktop</strong> nesta página (painel
          verde) ou o menu <strong>GestorVend → Estação de impressão…</strong>.
        </div>
      )}

      {(stations.data ?? []).some((st) => st.enabled && !st.lastSeenAt) && (
        <div className="alert alert-warn" style={{ marginBottom: '1rem' }}>
          Estação ativa com <strong>Último contato: Nunca</strong> — o token ainda não foi salvo
          neste PC. Use o painel <em>Estação de impressão deste PC</em> acima.
        </div>
      )}

      <section className="card" style={{ marginBottom: '1rem' }}>
        <h2 style={{ marginTop: 0, fontSize: '1.05rem' }}>Nova estação</h2>
        <div className="form-row" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'end' }}>
          <label style={{ flex: '1 1 180px' }}>
            Nome
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex.: Cozinha principal"
            />
          </label>
          <label style={{ flex: '1 1 160px' }}>
            Setores (CSV)
            <input
              value={sectors}
              onChange={(e) => setSectors(e.target.value)}
              placeholder="COZINHA,BAR"
            />
          </label>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!name.trim() || create.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending ? 'Criando…' : 'Criar e gerar token'}
          </button>
        </div>
      </section>

      <section className="card" style={{ marginBottom: '1rem' }}>
        <h2 style={{ marginTop: 0, fontSize: '1.05rem' }}>Estações</h2>
        {stations.isLoading && <p className="muted">Carregando…</p>}
        {!stations.isLoading && !(stations.data?.length) && (
          <p className="muted">Nenhuma estação cadastrada.</p>
        )}
        {(stations.data ?? []).length > 0 && (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Setores</th>
                  <th>Status</th>
                  <th>Último contato</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {(stations.data ?? []).map((st) => (
                  <tr key={st.id}>
                    <td>{st.name}</td>
                    <td>{st.sectors.join(', ')}</td>
                    <td>{st.enabled ? 'Ativa' : 'Desativada'}</td>
                    <td>{formatSeen(st.lastSeenAt)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => patch.mutate({ id: st.id, enabled: !st.enabled })}
                      >
                        {st.enabled ? 'Desativar' : 'Ativar'}
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => testPrint.mutate(st.id)}
                        disabled={testPrint.isPending}
                      >
                        Teste
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => {
                          if (
                            window.confirm(
                              'Gerar novo token? O token anterior deixa de funcionar neste PC.',
                            )
                          ) {
                            rotate.mutate(st.id);
                          }
                        }}
                      >
                        Novo token
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => {
                          if (window.confirm(`Remover estação "${st.name}"?`)) {
                            remove.mutate(st.id);
                          }
                        }}
                      >
                        Remover
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card" style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center' }}>
          <h2 style={{ margin: 0, fontSize: '1.05rem', flex: 1 }}>Fila de impressão</h2>
          <label>
            Status{' '}
            <select value={jobFilter} onChange={(e) => setJobFilter(e.target.value)}>
              <option value="">Todos</option>
              <option value="PENDING">PENDING</option>
              <option value="CLAIMED">CLAIMED</option>
              <option value="DONE">DONE</option>
              <option value="ERROR">ERROR</option>
            </select>
          </label>
          {pendingCount > 0 && jobFilter === 'PENDING' && (
            <span className="badge">{pendingCount} na fila</span>
          )}
        </div>
        {jobs.isLoading && <p className="muted">Carregando…</p>}
        {(jobs.data ?? []).length === 0 && !jobs.isLoading && (
          <p className="muted" style={{ marginTop: '0.75rem' }}>
            Nenhum job neste filtro.
          </p>
        )}
        {(jobs.data ?? []).length > 0 && (
          <div className="table-wrap" style={{ marginTop: '0.75rem' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Quando</th>
                  <th>Setor</th>
                  <th>Status</th>
                  <th>Estação</th>
                  <th>Erro</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {(jobs.data ?? []).map((j) => (
                  <tr key={j.id}>
                    <td>{new Date(j.createdAt).toLocaleString('pt-BR')}</td>
                    <td>{j.sector}</td>
                    <td>{j.status}</td>
                    <td>{j.station?.name ?? '—'}</td>
                    <td style={{ maxWidth: 220, wordBreak: 'break-word' }}>{j.error ?? '—'}</td>
                    <td>
                      {(j.status === 'ERROR' || j.status === 'DONE' || j.status === 'PENDING') && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => retry.mutate(j.id)}
                        >
                          {j.status === 'DONE' ? 'Reimprimir' : 'Reenviar'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0, fontSize: '1.05rem' }}>Fallback neste navegador</h2>
        <p className="muted">
          Só use se não houver agente desktop. No celular do garçom deixe desmarcado.
        </p>
        <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={localStation}
            onChange={(e) => {
              setLocalPrintStation(e.target.checked);
              setLocalStation(e.target.checked);
            }}
          />
          Este navegador é estação de impressão (permite diálogo de impressão)
        </label>
      </section>

      {tokenModal && (
        <FormModalBackdrop onClose={() => setTokenModal(null)}>
          <div className="modal" role="dialog" aria-labelledby="print-token-title">
            <h2 id="print-token-title">Token de pareamento</h2>
            <p>
              Estação <strong>{tokenModal.name}</strong>. Cole no painel{' '}
              <em>Estação de impressão deste PC</em> (acima) e escolha a impressora.
            </p>
            <textarea
              readOnly
              value={tokenModal.token}
              rows={3}
              style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.85rem' }}
              onFocus={(e) => e.target.select()}
            />
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  void navigator.clipboard?.writeText(tokenModal.token);
                  setPairToken(tokenModal.token);
                  setTokenModal(null);
                }}
              >
                Copiar e usar neste PC
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setTokenModal(null)}>
                Fechar
              </button>
            </div>
          </div>
        </FormModalBackdrop>
      )}
    </div>
  );
}
