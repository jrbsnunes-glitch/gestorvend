import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  shell,
  type WebContentsPrintOptions,
} from 'electron';
import * as path from 'path';
import {
  readConfig,
  writeConfig,
  writeStationConfig,
  type DesktopConfig,
  type StationConfig,
} from './config';
import { checkLicense, REVALIDATE_MS } from './license';
import {
  getPrintAgentStatus,
  printTestTicket,
  restartPrintAgent,
  startPrintAgent,
  stopPrintAgent,
} from './print-agent';
import { listSystemPrinters } from './printers';

let mainWindow: BrowserWindow | null = null;
let revalidateTimer: NodeJS.Timeout | null = null;

function rendererPath(file: string): string {
  return path.join(__dirname, '..', 'renderer', file);
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    autoHideMenuBar: false,
    title: 'GestorVend',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.once('ready-to-show', () => {
    win.maximize();
    win.show();
  });

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
              autoHideMenuBar: true,
              webPreferences: {
                preload: path.join(__dirname, 'preload.js'),
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: false,
              },
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

function showSetup(win: BrowserWindow) {
  void win.loadFile(rendererPath('setup.html'));
}

function showBlocked(win: BrowserWindow, message: string) {
  const q = new URLSearchParams({ message });
  void win.loadFile(rendererPath('blocked.html'), { search: q.toString() });
}

function showStation(win: BrowserWindow) {
  void win.loadFile(rendererPath('station.html'));
}

async function openApp(win: BrowserWindow, cfg: DesktopConfig) {
  const result = await checkLicense(cfg);
  if (!result.ok) {
    showBlocked(win, result.message);
    return;
  }
  const target = cfg.serverUrl.replace(/\/$/, '') + '/';
  void win.loadURL(target);

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
  const cfg = readConfig();
  if (!cfg) {
    showSetup(win);
    return;
  }
  await openApp(win, cfg);
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
          label: 'Reconfigurar servidor…',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) showSetup(mainWindow);
          },
        },
        { type: 'separator' },
        { role: 'quit', label: 'Sair' },
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

function registerIpc() {
  ipcMain.handle('config:get', () => readConfig());

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

  ipcMain.handle('print:silent', async (event) => {
    try {
      const wc = event.sender;
      const opts: WebContentsPrintOptions = {
        silent: true,
        printBackground: true,
      };
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
  });

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

app.whenReady().then(() => {
  buildMenu();
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

app.on('window-all-closed', () => {
  if (revalidateTimer) clearInterval(revalidateTimer);
  stopPrintAgent();
  if (process.platform !== 'darwin') app.quit();
});
