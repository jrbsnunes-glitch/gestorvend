import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import type { WebContents } from 'electron';

const execFileAsync = promisify(execFile);

export type ListedPrinter = {
  name: string;
  displayName: string;
  isDefault: boolean;
  status: number;
  source: 'electron' | 'windows' | 'registry';
  /** Driver do Windows — "Generic / Text Only" imprime só texto (sem logo/formatação). */
  driverName?: string;
  portName?: string;
};

function mapElectronPrinters(
  list: Array<{ name: string; displayName?: string; isDefault?: boolean; status?: number }>,
): ListedPrinter[] {
  return list
    .filter((p) => typeof p?.name === 'string' && p.name.trim())
    .map((p) => ({
      name: p.name,
      displayName: (p.displayName || p.name).trim(),
      isDefault: Boolean(p.isDefault),
      status: typeof p.status === 'number' ? p.status : 0,
      source: 'electron' as const,
    }));
}

function parsePrinterJson(raw: string): ListedPrinter[] {
  const text = raw.replace(/^\uFEFF/, '').trim();
  if (!text) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Às vezes o PowerShell mistura warning antes do JSON
    const start = text.indexOf('[');
    const startObj = text.indexOf('{');
    const i =
      start >= 0 && (startObj < 0 || start < startObj)
        ? start
        : startObj;
    if (i < 0) return [];
    try {
      parsed = JSON.parse(text.slice(i));
    } catch {
      return [];
    }
  }
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  const out: ListedPrinter[] = [];
  for (const row of rows) {
    const r = row as {
      Name?: string;
      name?: string;
      Default?: boolean;
      isDefault?: boolean;
      PrinterStatus?: number;
      status?: number;
      DriverName?: string;
      PortName?: string;
    };
    const name = String(r.Name ?? r.name ?? '').trim();
    if (!name) continue;
    const driverName = String(r.DriverName ?? '').trim();
    const portName = String(r.PortName ?? '').trim();
    out.push({
      name,
      displayName: name,
      isDefault: Boolean(r.Default ?? r.isDefault),
      status: typeof r.PrinterStatus === 'number' ? r.PrinterStatus : Number(r.status) || 0,
      source: 'windows',
      ...(driverName ? { driverName } : {}),
      ...(portName ? { portName } : {}),
    });
  }
  return out;
}

/** Inventário via PowerShell (arquivo temp — evita problemas de aspas/encoding). */
async function listPrintersPowerShell(): Promise<ListedPrinter[]> {
  const script = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding
$rows = @(Get-CimInstance -ClassName Win32_Printer | ForEach-Object {
  [PSCustomObject]@{
    Name = $_.Name
    Default = [bool]$_.Default
    PrinterStatus = [int]$_.PrinterStatus
    DriverName = [string]$_.DriverName
    PortName = [string]$_.PortName
  }
})
if ($rows.Count -eq 0) {
  $rows = @(Get-Printer -ErrorAction SilentlyContinue | ForEach-Object {
    [PSCustomObject]@{
      Name = $_.Name
      Default = [bool]($_.Default -eq $true)
      PrinterStatus = 0
      DriverName = [string]$_.DriverName
      PortName = [string]$_.PortName
    }
  })
}
$rows | ConvertTo-Json -Compress
`;
  const tmp = path.join(os.tmpdir(), `gv-printers-${process.pid}-${Date.now()}.ps1`);
  fs.writeFileSync(tmp, script, { encoding: 'utf8' });
  try {
    const { stdout, stderr } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', tmp],
      {
        windowsHide: true,
        timeout: 25_000,
        maxBuffer: 4 * 1024 * 1024,
        encoding: 'utf8',
      },
    );
    const list = parsePrinterJson(stdout || '');
    if (list.length) return list;
    if (stderr?.trim()) {
      throw new Error(stderr.trim().slice(0, 300));
    }
    return [];
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}

/** Fallback sem PowerShell: nomes das chaves do Registry. */
async function listPrintersRegistry(): Promise<ListedPrinter[]> {
  const { stdout } = await execFileAsync(
    'reg.exe',
    ['query', 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Print\\Printers'],
    { windowsHide: true, timeout: 10_000, encoding: 'utf8' },
  );
  const out: ListedPrinter[] = [];
  for (const line of (stdout || '').split(/\r?\n/)) {
    const m = line.match(/\\Print\\Printers\\(.+)\s*$/i);
    if (!m?.[1]) continue;
    const name = m[1].trim();
    if (!name || name.includes('\\')) continue;
    out.push({
      name,
      displayName: name,
      isDefault: false,
      status: 0,
      source: 'registry',
    });
  }
  return out;
}

async function listPrintersWindows(): Promise<ListedPrinter[]> {
  try {
    const viaPs = await listPrintersPowerShell();
    if (viaPs.length) return viaPs;
  } catch (e) {
    // tenta registry
    const msg = e instanceof Error ? e.message : String(e);
    try {
      const viaReg = await listPrintersRegistry();
      if (viaReg.length) return viaReg;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  try {
    return await listPrintersRegistry();
  } catch {
    return [];
  }
}

/** No Windows prioriza inventário do SO; Electron costuma falhar em file://. */
export async function listSystemPrinters(
  candidates: Array<WebContents | null | undefined>,
): Promise<{ printers: ListedPrinter[]; error?: string; detail?: string }> {
  const seen = new Set<string>();
  const merged: ListedPrinter[] = [];
  const notes: string[] = [];

  const addAll = (list: ListedPrinter[]) => {
    for (const p of list) {
      const key = p.name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(p);
    }
  };

  if (process.platform === 'win32') {
    try {
      const winList = await listPrintersWindows();
      addAll(winList);
      notes.push(`windows=${winList.length}`);
    } catch (err) {
      notes.push(`windows_err=${err instanceof Error ? err.message : String(err)}`);
    }
  }

  for (const wc of candidates) {
    if (!wc || wc.isDestroyed()) continue;
    try {
      const list = await wc.getPrintersAsync();
      const mapped = mapElectronPrinters(list);
      addAll(mapped);
      notes.push(`electron=${mapped.length}/${list?.length ?? 0}`);
    } catch (err) {
      notes.push(`electron_err=${err instanceof Error ? err.message : String(err)}`);
    }
  }

  merged.sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    return a.displayName.localeCompare(b.displayName, 'pt-BR');
  });

  if (!merged.length) {
    return {
      printers: [],
      error:
        'Nenhuma impressora encontrada. Confira em Configurações do Windows → Impressoras e scanners, ou digite o nome exato no campo manual.',
      detail: notes.join(' | '),
    };
  }

  return { printers: merged, detail: notes.join(' | ') };
}
