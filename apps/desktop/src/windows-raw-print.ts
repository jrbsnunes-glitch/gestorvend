import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * Envia bytes RAW (ESC/POS) à impressora do Windows via winspool WritePrinter.
 * O driver GDI/Chromium é ignorado — é o que a térmica de PDV espera.
 */
export async function sendRawToWindowsPrinter(
  printerName: string,
  payload: Buffer,
): Promise<void> {
  const name = printerName.trim();
  if (!name) throw new Error('Impressora do PDV não informada.');
  if (!payload.length) throw new Error('Cupom vazio — nada para enviar à impressora.');

  const stamp = `${process.pid}-${Date.now()}`;
  const dir = os.tmpdir();
  const binPath = path.join(dir, `gv-escpos-${stamp}.bin`);
  const jobPath = path.join(dir, `gv-escpos-${stamp}.json`);
  const scriptPath = path.join(dir, `gv-escpos-${stamp}.ps1`);

  const script = `
$ErrorActionPreference = 'Stop'
$job = Get-Content -LiteralPath $args[0] -Encoding UTF8 | ConvertFrom-Json
$printerName = [string]$job.printer
$binPath = [string]$job.bin
$bytes = [System.IO.File]::ReadAllBytes($binPath)
if ($bytes.Length -lt 8) { throw 'Arquivo ESC/POS vazio.' }

if (-not ([System.Management.Automation.PSTypeName]'GvRawPrinter57').Type) {
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class GvRawPrinter57 {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
  public class DOCINFOA {
    [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
  }
  [DllImport("winspool.drv", CharSet = CharSet.Ansi, SetLastError = true)]
  public static extern bool OpenPrinter(string szPrinter, out IntPtr hPrinter, IntPtr pd);
  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool ClosePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", CharSet = CharSet.Ansi, SetLastError = true)]
  public static extern bool StartDocPrinter(IntPtr hPrinter, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);
  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);

  public static string Send(string printer, byte[] data) {
    IntPtr h;
    if (!OpenPrinter(printer, out h, IntPtr.Zero)) {
      return "OpenPrinter falhou (Win32 " + Marshal.GetLastWin32Error() + "). Confira o nome da impressora.";
    }
    var di = new DOCINFOA();
    di.pDocName = "GestorVend Cupom";
    di.pDataType = "RAW";
    if (!StartDocPrinter(h, 1, di)) {
      var err = Marshal.GetLastWin32Error();
      ClosePrinter(h);
      return "StartDocPrinter falhou (Win32 " + err + ").";
    }
    IntPtr p = Marshal.AllocHGlobal(data.Length);
    try {
      Marshal.Copy(data, 0, p, data.Length);
      int written;
      if (!WritePrinter(h, p, data.Length, out written) || written != data.Length) {
        EndDocPrinter(h);
        ClosePrinter(h);
        return "WritePrinter escreveu " + written + " de " + data.Length + " bytes.";
      }
    } finally {
      Marshal.FreeHGlobal(p);
    }
    EndDocPrinter(h);
    ClosePrinter(h);
    return "OK";
  }
}
"@
}

$result = [GvRawPrinter57]::Send($printerName, $bytes)
if ($result -ne 'OK') { throw $result }
Write-Output $result
`;

  fs.writeFileSync(binPath, payload);
  fs.writeFileSync(jobPath, JSON.stringify({ printer: name, bin: binPath }), 'utf8');
  fs.writeFileSync(scriptPath, script, 'utf8');

  try {
    const { stdout, stderr } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, jobPath],
      {
        windowsHide: true,
        timeout: 30_000,
        maxBuffer: 2 * 1024 * 1024,
        encoding: 'utf8',
      },
    );
    const out = `${stdout || ''} ${stderr || ''}`.trim();
    if (!/\bOK\b/.test(out)) {
      throw new Error(out.slice(0, 400) || 'Falha ao enviar RAW à impressora.');
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(msg.replace(/\s+/g, ' ').trim().slice(0, 400));
  } finally {
    for (const p of [binPath, jobPath, scriptPath]) {
      try {
        fs.unlinkSync(p);
      } catch {
        /* ignore */
      }
    }
  }
}
