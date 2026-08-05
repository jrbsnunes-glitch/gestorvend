import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  shell,
  type WebContentsPrintOptions,
} from 'electron';
import * as path from 'path';
import { readConfig, writeConfig, type DesktopConfig } from './config';
import { checkLicense, REVALIDATE_MS } from './license';

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
    autoHideMenuBar: true,
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

  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
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
}

async function boot(win: BrowserWindow) {
  const cfg = readConfig();
  if (!cfg) {
    showSetup(win);
    return;
  }
  await openApp(win, cfg);
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
      const cfg: DesktopConfig = {
        serverUrl,
        tenantSlug: body.tenantSlug.trim().toLowerCase(),
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
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  registerIpc();
  mainWindow = createWindow();
  void boot(mainWindow);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
      void boot(mainWindow);
    }
  });
});

app.on('window-all-closed', () => {
  if (revalidateTimer) clearInterval(revalidateTimer);
  if (process.platform !== 'darwin') app.quit();
});
