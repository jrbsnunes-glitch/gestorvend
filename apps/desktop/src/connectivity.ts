import { dialog, type BrowserWindow } from 'electron';
import { readConfig } from './config';
import { snapshotAgeMs, snapshotIsFresh } from './offline-store';
import { refreshSnapshot } from './offline-sync';

const PROBE_MS = 20_000;
const PROBE_TIMEOUT_MS = 4_000;
const ASK_COOLDOWN_MS = 5 * 60_000;

let timer: NodeJS.Timeout | null = null;
let failStreak = 0;
let lastAskAt = 0;
let announcedUp = false;
let asking = false;

export async function probeServer(serverUrl: string): Promise<boolean> {
  const ctrl = new AbortController();
  const timerId = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(`${serverUrl.replace(/\/$/, '')}/api/health`, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timerId);
  }
}

export function startConnectivityWatch(opts: {
  getWindow: () => BrowserWindow | null;
  isLocal: () => boolean;
  enterLocal: () => Promise<void>;
  readToken: () => Promise<string | null>;
}): void {
  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    void tick(opts);
  }, PROBE_MS);
  void tick(opts);
}

let refreshing = false;

async function tick(opts: {
  getWindow: () => BrowserWindow | null;
  isLocal: () => boolean;
  enterLocal: () => Promise<void>;
  readToken: () => Promise<string | null>;
}): Promise<void> {
  const cfg = readConfig();
  const win = opts.getWindow();
  if (!cfg || !win || win.isDestroyed()) return;
  const ok = await probeServer(cfg.serverUrl);
  if (ok) {
    failStreak = 0;
    if (opts.isLocal()) {
      if (!announcedUp) {
        announcedUp = true;
        if (!win.isDestroyed()) win.webContents.send('offline:server-reachable');
      }
    } else {
      announcedUp = false;
      const age = await snapshotAgeMs();
      if (!refreshing && (age == null || age > 10 * 60 * 1000)) {
        refreshing = true;
        void refreshSnapshot(opts.readToken).finally(() => {
          refreshing = false;
        });
      }
    }
    return;
  }
  announcedUp = false;
  if (opts.isLocal()) return;
  failStreak += 1;
  if (failStreak < 2) return;
  if (Date.now() - lastAskAt < ASK_COOLDOWN_MS) return;
  await offerLocalMode(win, opts.enterLocal);
}

/** Pergunta uma vez. Não troca o modo sozinho. */
export async function offerLocalMode(
  win: BrowserWindow,
  enterLocal: () => Promise<void>,
): Promise<'entered' | 'declined' | 'unavailable'> {
  if (asking) return 'declined';
  asking = true;
  lastAskAt = Date.now();
  try {
    const fresh = await snapshotIsFresh();
    if (!fresh) {
      await dialog.showMessageBox(win, {
        type: 'warning',
        title: 'GestorVend',
        message: 'Sem conexão com o servidor.',
        detail:
          'A cópia local deste computador está ausente ou tem mais de 24 horas. As vendas neste computador não estão disponíveis até o servidor voltar.',
        buttons: ['OK'],
      });
      return 'unavailable';
    }
    const choice = await dialog.showMessageBox(win, {
      type: 'question',
      title: 'GestorVend',
      message: 'Sem conexão com o servidor. Continuar as vendas neste computador?',
      detail:
        'Preços e estoque são os da última cópia (até 24 horas). A nota fiscal sai quando a internet voltar. Use um caixa offline por loja.',
      buttons: ['Continuar neste computador', 'Agora não'],
      defaultId: 0,
      cancelId: 1,
    });
    if (choice.response !== 0) return 'declined';
    await enterLocal();
    return 'entered';
  } finally {
    asking = false;
  }
}
