import { useEffect, useState } from 'react';
import {
  getDesktopApi,
  type DesktopAgentStatus,
  type DesktopPrinter,
} from '../lib/desktop-bridge';
import './desktop-print-panels.css';

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
      <section className="desktop-print-panel desktop-print-panel--error">
        <h2 className="desktop-print-panel__title">Estação de impressão deste PC</h2>
        <p className="desktop-print-panel__lead">
          App Desktop desatualizado. Feche o GestorVend, rode <code>npm run desktop:dev</code> ou
          reinstale o .exe.
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
    <section className="desktop-print-panel desktop-print-panel--station">
      <div className="desktop-print-panel__head">
        <h2 className="desktop-print-panel__title">Estação de impressão deste PC</h2>
      </div>
      <p className="desktop-print-panel__lead">
        Pareie o token e escolha a impressora. Jobs PENDING só saem depois disso.
      </p>

      <p
        className={
          'desktop-print-panel__status ' +
          (agent?.lastError ? 'alert alert-error' : 'alert alert-success')
        }
      >
        {agentLabel}
      </p>

      <div className="desktop-print-panel__grid">
        <label className="desktop-print-panel__field" style={{ gridColumn: '1 / -1' }}>
          <span>Token de pareamento</span>
          <textarea
            value={token}
            onChange={(e) => setToken(e.target.value)}
            rows={2}
            placeholder="Cole o token (id.secret) gerado em Novo token"
          />
        </label>

        <label className="desktop-print-panel__field" style={{ gridColumn: '1 / -1' }}>
          <span>Nome local (opcional)</span>
          <input
            value={localName}
            onChange={(e) => setLocalName(e.target.value)}
            placeholder="Ex.: PC Cozinha"
          />
        </label>

        <label className="desktop-print-panel__field">
          <span>Impressora — COZINHA</span>
          <select
            value={printerCozinha}
            onChange={(e) => setPrinterCozinha(e.target.value)}
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
          className="btn btn-secondary desktop-print-panel__refresh"
          disabled={busy}
          onClick={() => void refreshPrinters(resolvePrinter())}
        >
          Atualizar lista
        </button>

        <label className="desktop-print-panel__field" style={{ gridColumn: '1 / -1' }}>
          <span>Nome exato da impressora (opcional)</span>
          <input
            value={printerManual}
            onChange={(e) => setPrinterManual(e.target.value)}
            placeholder="Ex.: MP-4200 TH"
          />
        </label>
        <p className="desktop-print-panel__hint">{printerHint}</p>
      </div>

      <div className="desktop-print-panel__actions">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}>
          {busy ? 'Salvando…' : 'Salvar e iniciar agente'}
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
