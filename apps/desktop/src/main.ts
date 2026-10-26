import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  shell,
  type WebContents,
  type WebContentsPrintOptions,
} from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import {
  readConfig,
  writeConfig,
  writeStationConfig,
  writePdvConfig,
  type DesktopConfig,
  type StationConfig,
} from './config';
import { checkLicense, hasValidLicenseCache, REVALIDATE_MS } from './license';
import {
  getPrintAgentStatus,
  printTestTicket,
  restartPrintAgent,
  startPrintAgent,
  stopPrintAgent,
} from './print-agent';
import { listSystemPrinters } from './printers';
import { fetchDesktopRelease, isSemverGreater } from './desktop-update';
import {
  THERMAL_WINDOW_WIDTH_PX,
  buildThermalPrintOptions,
  prepareSaleReceiptForThermalPrint,
} from './thermal-print';

let mainWindow: BrowserWindow | null = null;
let mainWindowPartition: string | undefined;
let revalidateTimer: NodeJS.Timeout | null = null;

// PDV: janela não “dorme” atrás de outro app.
// Evitar ignore-gpu-blocklist / zero-copy — em PCs de PDV isso derruba o
// renderer (ícone pisca e a janela nunca aparece).
if (!app.isReady()) {
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
  // Sem cache HTTP: o front muda no servidor (update.sh) e o atalho antigo
  // continuava mostrando v1.1.25 / CSS velho.
  app.commandLine.appendSwitch('disable-http-cache');
}

const gotSingleInstance = app.requestSingleInstanceLock();
if (!gotSingleInstance) {
  app.quit();
}

function forceShowWindow(win: BrowserWindow | null) {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  try {
    win.maximize();
  } catch {
    /* ignore */
  }
  win.show();
  win.focus();
}

function attachWindowLifecycle(win: BrowserWindow) {
  const reveal = () => forceShowWindow(win);
  win.once('ready-to-show', reveal);
  // ready-to-show às vezes não dispara após loadURL remoto / troca de partition.
  setTimeout(reveal, 2500);

  win.webContents.on('did-fail-load', (_ev, code, desc, url, isMainFrame) => {
    if (!isMainFrame || win.isDestroyed()) return;
    if (code === -3) return; // aborted
    const safeDesc = (desc || 'Falha ao carregar').replace(/[<>&]/g, '');
    const safeUrl = (url || '').replace(/[<>&]/g, '').slice(0, 240);
    void win.loadURL(
      'data:text/html;charset=utf-8,' +
        encodeURIComponent(`<!doctype html><html><head><meta charset="utf-8">
<title>GestorVend</title>
<style>
  body{font-family:Segoe UI,sans-serif;background:#0b1220;color:#e2e8f0;margin:0;padding:2.5rem;line-height:1.5}
  h1{font-size:1.25rem;margin:0 0 .75rem} p{color:#94a3b8} code{color:#f8fafc}
  button{margin-top:1rem;padding:.55rem 1rem;border:0;border-radius:8px;background:#2563eb;color:#fff;cursor:pointer}
</style></head><body>
<h1>Não foi possível abrir o sistema</h1>
<p>${safeDesc} (código ${code})</p>
<p><code>${safeUrl}</code></p>
<p>Confira se o servidor está no ar e se a URL configurada está correta. Use o menu GestorVend → Reconfigurar servidor.</p>
<button onclick="location.reload()">Tentar de novo</button>
</body></html>`),
    );
    forceShowWindow(win);
  });

  win.webContents.on('render-process-gone', (_ev, details) => {
    console.error('[desktop] render-process-gone', details.reason, details.exitCode);
    if (win.isDestroyed()) return;
    forceShowWindow(win);
    if (details.reason !== 'clean-exit') {
      setTimeout(() => {
        if (!win.isDestroyed()) win.webContents.reload();
      }, 400);
    }
  });
}

function appWebPrefs(partition?: string): Electron.WebPreferences {
  return {
    ...(partition ? { partition } : {}),
    preload: path.join(__dirname, 'preload.js'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: false,
    backgroundThrottling: false,
    spellcheck: false,
    autoplayPolicy: 'no-user-gesture-required',
    v8CacheOptions: 'bypassHeatCheck',
  };
}

function rendererPath(file: string): string {
  return path.join(__dirname, '..', 'renderer', file);
}

function withCacheBust(url: string): string {
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}_gv=${Date.now()}`;
}

async function refreshRemoteCache(win: BrowserWindow): Promise<void> {
  try {
    await win.webContents.session.clearCache();
  } catch {
    /* ignore */
  }
}

function appIconPath(): string {
  const ico = path.join(__dirname, '..', 'resources', 'icon.ico');
  if (fs.existsSync(ico)) return ico;
  return rendererPath('logo.png');
}

function sessionPartitionFor(tenantSlug: string): string {
  const safe =
    tenantSlug
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '_')
      .slice(0, 48) || 'default';
  return `persist:gestorvend-${safe}`;
}

type WebContentsWithNavGuard = WebContents & { __gvNavGuard?: boolean };

function attachPdvNavGuard(win: BrowserWindow, allowPath: (pathname: string) => boolean) {
  const wc = win.webContents as WebContentsWithNavGuard;
  if (wc.__gvNavGuard) return;
  wc.__gvNavGuard = true;

  win.webContents.on('will-navigate', (ev, url) => {
    try {
      const u = new URL(url);
      if (!allowPath(u.pathname)) ev.preventDefault();
    } catch {
      ev.preventDefault();
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const current = win.webContents.getURL();
      const base = current && current !== 'about:blank' ? current : url;
      const u = new URL(url, base);
      if (allowPath(u.pathname)) {
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            autoHideMenuBar: true,
            backgroundColor: '#0b1220',
            icon: appIconPath(),
            webPreferences: appWebPrefs(),
          },
        };
      }
    } catch {
      /* deny */
    }
    return { action: 'deny' };
  });
}

function createWindow(partition?: string): BrowserWindow {
  mainWindowPartition = partition;
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    autoHideMenuBar: false,
    backgroundColor: '#0b1220',
    title: 'GestorVend',
    icon: appIconPath(),
    webPreferences: appWebPrefs(partition),
  });
  win.webContents.session.setSpellCheckerEnabled(false);
  attachWindowLifecycle(win);

  // Mesma origem (páginas de impressão do app): permitir nova janela.
  // URLs externas: abrir no navegador do sistema.
  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const current = win.webContents.getURL();
      if (current && current !== 'about:blank') {
        const base = new URL(current);
        const target = new URL(url, base);
        if (target.origin === base.origin) {
          return {
            action: 'allow',
            overrideBrowserWindowOptions: {
              autoHideMenuBar: false,
              backgroundColor: '#0b1220',
              icon: appIconPath(),
              webPreferences: appWebPrefs(),
            },
          };
        }
      }
    } catch {
      /* fall through */
    }
    if (/^https?:\/\//i.test(url)) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  return win;
}

function leaveExclusiveFullscreen(win: BrowserWindow) {
  try {
    if (win.isKiosk()) win.setKiosk(false);
  } catch {
    /* ignore */
  }
  try {
    if (win.isFullScreen()) win.setFullScreen(false);
  } catch {
    /* ignore */
  }
  win.setAutoHideMenuBar(false);
  win.setMenuBarVisibility(true);
  buildMenu();
}

function showSetup(win: BrowserWindow) {
  leaveExclusiveFullscreen(win);
  forceShowWindow(win);
  void win.loadFile(rendererPath('setup.html'));
}

function showBlocked(win: BrowserWindow, message: string) {
  const q = new URLSearchParams({ message });
  void win.loadFile(rendererPath('blocked.html'), { search: q.toString() });
}

function showStation(win: BrowserWindow) {
  leaveExclusiveFullscreen(win);
  void win.loadFile(rendererPath('station.html'));
}

function ensureMainWindowForTenant(cfg: DesktopConfig): BrowserWindow {
  const part = sessionPartitionFor(cfg.tenantSlug);
  if (mainWindow && !mainWindow.isDestroyed() && mainWindowPartition === part) {
    return mainWindow;
  }
  const previous = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
  const next = createWindow(part);
  mainWindow = next;
  forceShowWindow(next);
  if (previous) {
    // Só destrói a janela antiga depois que a nova já está visível —
    // destruir antes era o “pisca e não abre” após configurar o servidor.
    const dispose = () => {
      if (!previous.isDestroyed()) previous.destroy();
    };
    next.once('ready-to-show', dispose);
    setTimeout(dispose, 4000);
  }
  return next;
}

async function openApp(_win: BrowserWindow, cfg: DesktopConfig) {
  const win = ensureMainWindowForTenant(cfg);

  const cachedOk = hasValidLicenseCache(cfg);
  if (!cachedOk) {
    const result = await checkLicense(cfg);
    if (!result.ok) {
      showBlocked(win, result.message);
      return;
    }
  } else {
    void checkLicense(cfg).then((r) => {
      if (!r.ok && mainWindow && !mainWindow.isDestroyed()) {
        showBlocked(mainWindow, r.message);
      }
    });
  }

  const isKiosk = cfg.pdvTerminal?.mode === 'self_service';
  const isOperatorPdv =
    cfg.pdvTerminal?.mode === 'operator' &&
    cfg.pdvTerminal.number != null &&
    cfg.pdvTerminal.number >= 1;

  buildMenu();
  if (isKiosk) {
    win.setAutoHideMenuBar(true);
    win.setMenuBarVisibility(false);
    win.setKiosk(true);
    win.setFullScreen(true);
    win.setTitle('GestorVend — Autoatendimento');
  } else {
    win.setKiosk(false);
    win.setFullScreen(false);
    win.setAutoHideMenuBar(false);
    win.setMenuBarVisibility(true);
    if (isOperatorPdv) {
      win.setTitle(`GestorVend — PDV ${cfg.pdvTerminal!.number}`);
    } else {
      win.setTitle('GestorVend');
    }
  }

  const base = cfg.serverUrl.replace(/\/$/, '');
  // Operador: PDV em tela cheia (mesmo visual do PDV normal).
  // Kiosk: autoatendimento. Sem kiosk e sem terminal: sistema completo.
  const target = isKiosk
    ? `${base}/auto-atendimento?terminal=${cfg.pdvTerminal!.number}`
    : isOperatorPdv
      ? `${base}/vendas?terminal=${cfg.pdvTerminal!.number}`
      : `${base}/`;

  if (isKiosk) {
    attachPdvNavGuard(
      win,
      (pathname) =>
        pathname.startsWith('/auto-atendimento') || pathname.startsWith('/vendas/impressao'),
    );
    win.webContents.setWindowOpenHandler(({ url }) => {
      try {
        const u = new URL(url, target);
        const allowPath = (pathname: string) =>
          pathname.startsWith('/auto-atendimento') || pathname.startsWith('/vendas/impressao');
        if (allowPath(u.pathname)) {
          return {
            action: 'allow',
            overrideBrowserWindowOptions: {
              kiosk: true,
              fullscreen: true,
              autoHideMenuBar: true,
              backgroundColor: '#0b1220',
              icon: appIconPath(),
              webPreferences: appWebPrefs(),
            },
          };
        }
      } catch {
        /* deny */
      }
      return { action: 'deny' };
    });
  } else if (isOperatorPdv) {
    attachPdvNavGuard(
      win,
      (pathname) =>
        pathname.startsWith('/vendas') || pathname.startsWith('/vendas/impressao'),
    );
  }

  await refreshRemoteCache(win);
  void win.loadURL(withCacheBust(target));
  forceShowWindow(win);

  if (revalidateTimer) clearInterval(revalidateTimer);
  revalidateTimer = setInterval(() => {
    void checkLicense(cfg).then((r) => {
      if (!r.ok && mainWindow && !mainWindow.isDestroyed()) {
        showBlocked(mainWindow, r.message);
      }
    });
  }, REVALIDATE_MS);

  restartPrintAgent();
}

async function boot(win: BrowserWindow) {
  forceShowWindow(win);
  const cfg = readConfig();
  if (!cfg) {
    showSetup(win);
    return;
  }
  await openApp(win, cfg);
}

async function checkForDesktopUpdates(): Promise<{
  ok: boolean;
  updateAvailable: boolean;
  localVersion: string;
  remoteVersion?: string;
  downloadUrl?: string;
  notes?: string;
  message: string;
}> {
  const localVersion = app.getVersion();
  const cfg = readConfig();
  if (!cfg?.serverUrl) {
    return {
      ok: false,
      updateAvailable: false,
      localVersion,
      message: 'Configure o servidor antes de verificar atualizações.',
    };
  }
  try {
    const remote = await fetchDesktopRelease(cfg.serverUrl);
    if (!remote.version) {
      return {
        ok: false,
        updateAvailable: false,
        localVersion,
        message: 'Servidor não informou a versão do Desktop.',
      };
    }
    const updateAvailable = isSemverGreater(remote.version, localVersion);
    if (!updateAvailable) {
      return {
        ok: true,
        updateAvailable: false,
        localVersion,
        remoteVersion: remote.version,
        downloadUrl: remote.downloadUrl || undefined,
        notes: remote.notes || undefined,
        message: `Desktop atualizado (v${localVersion}).`,
      };
    }
    return {
      ok: true,
      updateAvailable: true,
      localVersion,
      remoteVersion: remote.version,
      downloadUrl: remote.downloadUrl || undefined,
      notes: remote.notes || undefined,
      message: `Há uma nova versão do Desktop: v${remote.version} (você tem v${localVersion}).`,
    };
  } catch (err) {
    return {
      ok: false,
      updateAvailable: false,
      localVersion,
      message: err instanceof Error ? err.message : 'Falha ao verificar atualizações.',
    };
  }
}

async function showUpdateDialog() {
  const result = await checkForDesktopUpdates();
  if (!result.ok) {
    await dialog.showMessageBox({
      type: 'warning',
      title: 'Atualizações',
      message: 'Não foi possível verificar',
      detail: result.message,
      buttons: ['OK'],
    });
    return;
  }
  if (!result.updateAvailable) {
    await dialog.showMessageBox({
      type: 'info',
      title: 'Atualizações',
      message: result.message,
      detail: result.notes || undefined,
      buttons: ['OK'],
    });
    return;
  }
  const buttons = result.downloadUrl
    ? ['Baixar instalador', 'Recarregar sistema', 'Agora não']
    : ['Recarregar sistema', 'OK'];
  const { response } = await dialog.showMessageBox({
    type: 'info',
    title: 'Atualização do Desktop',
    message: result.message,
    detail:
      (result.notes ? `${result.notes}\n\n` : '') +
      'O sistema web (telas, PDV, salão) atualiza só com pull no servidor + Recarregar — sem novo Setup.\n' +
      (result.downloadUrl
        ? 'Este aviso é do app Desktop (shell). Baixe o instalador para atualizar impressão nativa e recursos locais.'
        : 'Se a mudança for só visual/web, Recarregar basta. Novo Setup só quando o shell Electron mudar (impressoras, agent, etc.).'),
    buttons,
    defaultId: 0,
    cancelId: buttons.length - 1,
  });
  if (result.downloadUrl && response === 0) {
    await shell.openExternal(result.downloadUrl);
    return;
  }
  const reloadIdx = result.downloadUrl ? 1 : 0;
  if (response === reloadIdx && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.reload();
  }
}

function buildMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'GestorVend',
      submenu: [
        {
          label: 'Estação de impressão…',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) showStation(mainWindow);
          },
        },
        {
          label: 'Verificar atualizações…',
          click: () => {
            void showUpdateDialog();
          },
        },
        {
          label: 'Reconfigurar servidor…',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) showSetup(mainWindow);
          },
        },
        { type: 'separator' },
        { role: 'quit', label: 'Sair', accelerator: 'CmdOrCtrl+Q' },
      ],
    },
    {
      label: 'Exibir',
      submenu: [
        { role: 'reload', label: 'Recarregar' },
        { role: 'toggleDevTools', label: 'Ferramentas de desenvolvedor' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Zoom padrão' },
        { role: 'zoomIn', label: 'Aumentar zoom' },
        { role: 'zoomOut', label: 'Diminuir zoom' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function registerDesktopShortcuts() {
  globalShortcut.unregisterAll();
  globalShortcut.register('CommandOrControl+Shift+S', () => {
    if (mainWindow && !mainWindow.isDestroyed()) showSetup(mainWindow);
  });
  globalShortcut.register('CommandOrControl+Q', () => {
    app.quit();
  });
}

function registerIpc() {
  ipcMain.handle('config:get', () => readConfig());

  ipcMain.handle('shell:getVersion', () => ({ version: app.getVersion() }));

  ipcMain.on('shell:isKiosk', (ev) => {
    const cfg = readConfig();
    ev.returnValue = cfg?.pdvTerminal?.mode === 'self_service';
  });

  ipcMain.handle('desktop:checkUpdates', async () => checkForDesktopUpdates());

  ipcMain.handle('config:save', async (_e, body: DesktopConfig) => {
    try {
      if (!body?.serverUrl?.trim() || !body?.tenantSlug?.trim()) {
        return { ok: false, error: 'Informe a URL do servidor e a abreviatura da empresa.' };
      }
      let serverUrl = body.serverUrl.trim().replace(/\/$/, '');
      if (!/^https?:\/\//i.test(serverUrl)) {
        serverUrl = `https://${serverUrl}`;
      }
      const prev = readConfig();
      const cfg: DesktopConfig = {
        serverUrl,
        tenantSlug: body.tenantSlug.trim().toLowerCase(),
        station: body.station ?? prev?.station,
        pdv: body.pdv ?? prev?.pdv,
        pdvTerminal: body.pdvTerminal ?? prev?.pdvTerminal,
      };
      writeConfig(cfg);
      if (mainWindow && !mainWindow.isDestroyed()) {
        await openApp(mainWindow, cfg);
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Erro ao salvar.' };
    }
  });

  ipcMain.handle('license:retry', async () => {
    const cfg = readConfig();
    if (!cfg) return { ok: false, message: 'Configure o servidor primeiro.' };
    const result = await checkLicense(cfg);
    if (result.ok && mainWindow && !mainWindow.isDestroyed()) {
      await openApp(mainWindow, cfg);
    }
    return { ok: result.ok, message: result.message };
  });

  ipcMain.handle(
    'print:url',
    async (
      _e,
      body?: { url?: string; deviceName?: string; pageSize?: '80mm' | 'A4' },
    ) => {
      const rawUrl = typeof body?.url === 'string' ? body.url.trim() : '';
      if (!rawUrl) {
        return { ok: false, error: 'URL de impressão inválida.' };
      }
      let target = rawUrl;
      if (target.startsWith('/')) {
        const cfg = readConfig();
        if (!cfg?.serverUrl) {
          return { ok: false, error: 'Configure o servidor antes de imprimir.' };
        }
        target = `${cfg.serverUrl.replace(/\/$/, '')}${target}`;
      }
      if (!/^https?:\/\//i.test(target)) {
        return { ok: false, error: 'URL de impressão inválida.' };
      }

      const device =
        typeof body?.deviceName === 'string' && body.deviceName.trim()
          ? body.deviceName.trim()
          : readConfig()?.pdv?.printer?.trim();
      if (!device) {
        return {
          ok: false,
          error: 'Defina a impressora do PDV em Configurações → Impressão.',
        };
      }

      const win = new BrowserWindow({
        width: THERMAL_WINDOW_WIDTH_PX,
        height: 900,
        show: false,
        backgroundColor: '#ffffff',
        icon: appIconPath(),
        webPreferences: appWebPrefs(mainWindowPartition),
      });

      try {
        await win.loadURL(target);
        // Pronto quando o cupom tem título da empresa (novo ou legado) ou article após carga.
        const ready = await new Promise<boolean>((resolve) => {
          let tries = 0;
          const tick = async () => {
            if (win.isDestroyed()) {
              resolve(false);
              return;
            }
            try {
              const ok = await win.webContents.executeJavaScript(`
                (() => {
                  const article = document.querySelector('article.sale-receipt-doc, article.cash-close-doc');
                  if (!article) return false;
                  // Build novo: só pronto após blindar estilos e embutir a logo.
                  if (article.getAttribute('data-receipt-ready') === '1') return true;
                  // Build antigo do web: cabeçalho da empresa já renderizado.
                  if (${tries} >= 12 && article.querySelector('.sale-receipt-title')) return true;
                  return false;
                })()
              `);
              if (ok) {
                resolve(true);
                return;
              }
            } catch {
              /* ignore */
            }
            tries += 1;
            if (tries >= 80) {
              resolve(false);
              return;
            }
            setTimeout(() => {
              void tick();
            }, 100);
          };
          void tick();
        });
        if (!ready) {
          return {
            ok: false,
            error:
              'Cupom não carregou a tempo (venda/empresa). Atualize o servidor e tente de novo.',
          };
        }
        await new Promise((r) => setTimeout(r, 200));

        const contentHeightPx = await prepareSaleReceiptForThermalPrint(win.webContents);
        const pageSize = body?.pageSize ?? '80mm';
        const opts = buildThermalPrintOptions({
          deviceName: device,
          pageSize,
          contentHeightPx,
        });

        await new Promise<void>((resolve, reject) => {
          win.webContents.print(opts, (success, failureReason) => {
            if (success) resolve();
            else reject(new Error(failureReason || 'Falha na impressão silenciosa'));
          });
        });
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'Erro ao imprimir.' };
      } finally {
        if (!win.isDestroyed()) win.destroy();
      }
    },
  );

  ipcMain.handle(
    'print:silent',
    async (
      event,
      body?: { deviceName?: string; pageSize?: '80mm' | 'A4'; printBackground?: boolean },
    ) => {
      try {
        const wc = event.sender;
        const pageSize = body?.pageSize ?? '80mm';
        const device =
          typeof body?.deviceName === 'string' && body.deviceName.trim()
            ? body.deviceName.trim()
            : readConfig()?.pdv?.printer?.trim();

        let contentHeightPx: number | undefined;
        if (pageSize === '80mm') {
          const isReceipt = await wc
            .executeJavaScript(`Boolean(document.querySelector('article.sale-receipt-doc'))`)
            .catch(() => false);
          if (isReceipt) {
            contentHeightPx = await prepareSaleReceiptForThermalPrint(wc);
          }
        }

        const opts = buildThermalPrintOptions({
          deviceName: device,
          pageSize,
          contentHeightPx,
        });
        if (body?.printBackground === false) {
          opts.printBackground = false;
        }

        await new Promise<void>((resolve, reject) => {
          wc.print(opts, (success, failureReason) => {
            if (success) resolve();
            else reject(new Error(failureReason || 'Falha na impressão'));
          });
        });
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'Erro ao imprimir.' };
      }
    },
  );

  ipcMain.handle('pdv:get', () => {
    const cfg = readConfig();
    return {
      printer: cfg?.pdv?.printer ?? null,
      receiptScale: cfg?.pdv?.receiptScale ?? 1,
    };
  });

  ipcMain.handle(
    'pdv:save',
    (_e, body: { printer?: string | null; receiptScale?: number | null }) => {
      try {
        const printer =
          typeof body?.printer === 'string' && body.printer.trim() ? body.printer.trim() : null;
        const receiptScale =
          typeof body?.receiptScale === 'number' && Number.isFinite(body.receiptScale)
            ? body.receiptScale
            : undefined;
        const prev = readConfig()?.pdv;
        const updated = writePdvConfig(
          printer || receiptScale != null || prev
            ? {
                printer: printer ?? prev?.printer,
                receiptScale: receiptScale ?? prev?.receiptScale ?? 1,
              }
            : null,
        );
        if (!updated) {
          return { ok: false, error: 'Configure o servidor antes de definir a impressora do PDV.' };
        }
        return {
          ok: true,
          printer: updated.pdv?.printer ?? null,
          receiptScale: updated.pdv?.receiptScale ?? 1,
        };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'Erro ao salvar.' };
      }
    },
  );
  ipcMain.handle('shell:openExternal', async (_e, url: string) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
      await shell.openExternal(url);
    }
  });

  ipcMain.handle('printers:list', async (event) => {
    try {
      const { printers, error, detail } = await listSystemPrinters([
        event.sender,
        mainWindow?.webContents,
      ]);
      console.log(`[printers:list] count=${printers.length} ${detail ?? ''}`);
      if (!printers.length) {
        return {
          ok: false,
          error: error || 'Nenhuma impressora encontrada.',
          detail,
          printers: [],
        };
      }
      return { ok: true, printers, detail };
    } catch (err) {
      console.error('[printers:list] failed', err);
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Falha ao listar impressoras.',
        printers: [],
      };
    }
  });

  ipcMain.handle('station:get', () => {
    const cfg = readConfig();
    return {
      config: cfg,
      agent: getPrintAgentStatus(),
    };
  });

  ipcMain.handle('station:save', async (_e, body: StationConfig) => {
    try {
      if (!body?.token?.trim()) {
        return { ok: false, error: 'Cole o token gerado em Configurações → Impressão.' };
      }
      const printers: Record<string, string> = {};
      if (body.printers && typeof body.printers === 'object') {
        for (const [k, v] of Object.entries(body.printers)) {
          if (typeof v === 'string' && v.trim()) {
            printers[k.trim().toUpperCase()] = v.trim();
          }
        }
      }
      const updated = writeStationConfig({
        token: body.token.trim(),
        name: body.name?.trim() || undefined,
        pollMs: body.pollMs,
        printers,
      });
      if (!updated) {
        return { ok: false, error: 'Configure o servidor antes de parear a estação.' };
      }
      restartPrintAgent();
      return { ok: true, agent: getPrintAgentStatus() };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Erro ao salvar estação.' };
    }
  });

  ipcMain.handle('station:clear', () => {
    writeStationConfig(null);
    stopPrintAgent();
    return { ok: true };
  });

  ipcMain.handle('station:test', async (_e, deviceName?: string) => {
    return printTestTicket(typeof deviceName === 'string' ? deviceName : undefined);
  });

  ipcMain.handle('station:openApp', async () => {
    const cfg = readConfig();
    if (!cfg) {
      if (mainWindow && !mainWindow.isDestroyed()) showSetup(mainWindow);
      return { ok: false };
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      await openApp(mainWindow, cfg);
    }
    return { ok: true };
  });

  ipcMain.handle('station:openUi', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      showStation(mainWindow);
      return { ok: true };
    }
    return { ok: false, error: 'Janela principal indisponível.' };
  });

  ipcMain.handle('station:status', () => getPrintAgentStatus());
}

app.on('second-instance', () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createWindow();
    void boot(mainWindow);
    return;
  }
  forceShowWindow(mainWindow);
});

app.whenReady().then(() => {
  if (!gotSingleInstance) return;
  app.setAppUserModelId('br.com.gestorvend.desktop');
  buildMenu();
  registerDesktopShortcuts();
  registerIpc();
  mainWindow = createWindow();
  void boot(mainWindow);
  startPrintAgent();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
      void boot(mainWindow);
    }
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (revalidateTimer) clearInterval(revalidateTimer);
  stopPrintAgent();
  if (process.platform !== 'darwin') app.quit();
});
