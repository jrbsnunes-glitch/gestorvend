import { useEffect, useState } from 'react';
import {
  getDesktopApi,
  type DesktopAgentStatus,
  type DesktopPrinter,
} from '../lib/desktop-bridge';

type Props = {
  /** Token sugerido (ex.: acabou de gerar / Novo token). */
  suggestedToken?: string | null;
  onMessage?: (msg: string, ok?: boolean) => void;
};

export function DesktopPrintStationPanel({ suggestedToken, onMessage }: Props) {
  const api = getDesktopApi();
  const [token, setToken] = useState('');
  const [localName, setLocalName] = useState('');
  const [printers, setPrinters] = useState<DesktopPrinter[]>([]);
  const [printerCozinha, setPrinterCozinha] = useState('');
  const [printerManual, setPrinterManual] = useState('');
  const [printerHint, setPrinterHint] = useState('Carregando impressoras…');
  const [agent, setAgent] = useState<DesktopAgentStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [apiMissing, setApiMissing] = useState(false);

  async function refreshPrinters(selected?: string) {
    if (!api?.listPrinters) {
      setApiMissing(true);
      setPrinterHint('App desktop desatualizado — reinstale ou rode npm run desktop:dev.');
      return;
    }
    setPrinterHint('Consultando impressoras do Windows…');
    const res = await api.listPrinters();
    const list = res.printers ?? [];
    setPrinters(list);
    if (selected) {
      if (list.some((p) => p.name === selected)) setPrinterCozinha(selected);
      else setPrinterManual(selected);
    }
    if (!list.length) {
      setPrinterHint(
        (res.error || 'Nenhuma impressora listada.') +
          (res.detail ? ` [${res.detail}]` : '') +
          ' Digite o nome manual (ex.: MP-4200 TH).',
      );
      return;
    }
    setPrinterHint(
      `${list.length} impressora(s): ${list
        .slice(0, 4)
        .map((p) => p.name)
        .join(', ')}${list.length > 4 ? '…' : ''}`,
    );
    if (!selected && !printerCozinha) {
      const def = list.find((p) => p.isDefault) ?? list[0];
      if (def) setPrinterCozinha(def.name);
    }
  }

  async function refreshAll() {
    if (!api?.getStation) {
      setApiMissing(true);
      return;
    }
    const data = await api.getStation();
    setAgent(data.agent);
    const st = data.config?.station;
    if (st?.token) setToken(st.token);
    if (st?.name) setLocalName(st.name);
    await refreshPrinters(st?.printers?.COZINHA);
  }

  useEffect(() => {
    void refreshAll();
    const t = window.setInterval(() => {
      void api?.stationStatus?.().then((s) => setAgent(s));
    }, 4000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (suggestedToken?.trim()) setToken(suggestedToken.trim());
  }, [suggestedToken]);

  function resolvePrinter(): string | undefined {
    const manual = printerManual.trim();
    if (manual) return manual;
    return printerCozinha.trim() || undefined;
  }

  async function save() {
    if (!api?.saveStation) {
      onMessage?.('App desktop desatualizado.', false);
      return;
    }
    if (!token.trim()) {
      onMessage?.('Cole o token da estação (gere com Novo token se não tiver).', false);
      return;
    }
    setBusy(true);
    try {
      const device = resolvePrinter();
      const printersMap: Record<string, string> = {};
      if (device) printersMap.COZINHA = device;
      const res = await api.saveStation({
        token: token.trim(),
        name: localName.trim() || undefined,
        pollMs: 3000,
        printers: printersMap,
      });
      if (!res.ok) {
        onMessage?.(res.error || 'Falha ao salvar estação neste PC.', false);
        return;
      }
      if (res.agent) setAgent(res.agent);
      onMessage?.('Estação salva neste PC. Agente iniciado.', true);
      await refreshAll();
    } finally {
      setBusy(false);
    }
  }

  async function testPrint() {
    if (!api?.testStationPrint) return;
    setBusy(true);
    try {
      const res = await api.testStationPrint(resolvePrinter());
      onMessage?.(
        res.ok ? 'Teste enviado à impressora.' : res.error || 'Falha no teste.',
        res.ok,
      );
    } finally {
      setBusy(false);
    }
  }

  if (apiMissing && !api?.listPrinters && !api?.saveStation) {
    return (
      <section className="card" style={{ marginBottom: '1rem', borderColor: 'var(--color-danger, #b91c1c)' }}>
        <h2 style={{ marginTop: 0, fontSize: '1.05rem' }}>Estação de impressão deste PC</h2>
        <p className="muted">
          O app Desktop está desatualizado e não expõe a API de impressoras. Feche o GestorVend,
          rode <code>npm run desktop:dev</code> (ou reinstale o .exe) e abra de novo.
        </p>
      </section>
    );
  }

  const agentLabel = agent
    ? `Agente ${agent.running ? 'ativo' : 'parado'}${
        agent.stationName ? ` · ${agent.stationName}` : ''
      }${
        agent.lastPollAt
          ? ` · último poll ${new Date(agent.lastPollAt).toLocaleTimeString('pt-BR')}`
          : ''
      }${agent.lastError ? ` · erro: ${agent.lastError}` : ''}`
    : 'Agente: —';

  return (
    <section
      className="card"
      style={{ marginBottom: '1rem', border: '2px solid var(--color-accent, #4ade9f)' }}
    >
      <h2 style={{ marginTop: 0, fontSize: '1.1rem' }}>Estação de impressão deste PC</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Pareie o token da estação e escolha a impressora do Windows. O job PENDING só sai depois
        disso.
      </p>

      <p
        className={agent?.lastError ? 'alert alert-error' : 'alert alert-success'}
        style={{ marginBottom: '0.75rem', padding: '0.5rem 0.75rem' }}
      >
        {agentLabel}
      </p>

      <label>
        Token de pareamento
        <textarea
          value={token}
          onChange={(e) => setToken(e.target.value)}
          rows={2}
          placeholder="Cole o token (id.secret) gerado em Novo token"
          style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.85rem' }}
        />
      </label>

      <label>
        Nome local (opcional)
        <input
          value={localName}
          onChange={(e) => setLocalName(e.target.value)}
          placeholder="Ex.: PC Cozinha"
        />
      </label>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'end' }}>
        <label style={{ flex: '1 1 240px' }}>
          Impressora — COZINHA
          <select
            value={printerCozinha}
            onChange={(e) => setPrinterCozinha(e.target.value)}
            style={{ width: '100%' }}
          >
            <option value="">(padrão do Windows)</option>
            {printers.map((p) => (
              <option key={p.name} value={p.name}>
                {p.displayName || p.name}
                {p.isDefault ? ' (padrão)' : ''}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={busy}
          onClick={() => void refreshPrinters(resolvePrinter())}
        >
          Atualizar lista
        </button>
      </div>
      <p className="muted" style={{ fontSize: '0.82rem', margin: '0.25rem 0 0.75rem' }}>
        {printerHint}
      </p>

      <label>
        Ou digite o nome exato da impressora
        <input
          value={printerManual}
          onChange={(e) => setPrinterManual(e.target.value)}
          placeholder="Ex.: MP-4200 TH"
        />
      </label>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.5rem' }}>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}>
          {busy ? 'Salvando…' : 'Salvar e iniciar agente neste PC'}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={busy}
          onClick={() => void testPrint()}
        >
          Imprimir teste
        </button>
      </div>
    </section>
  );
}
