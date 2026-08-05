# Prepara pasta de saida limpa para electron-builder (evita app.asar bloqueado).
$ErrorActionPreference = "Continue"
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
if (-not (Test-Path (Join-Path $PSScriptRoot "..\package.json"))) {
  $root = Resolve-Path (Join-Path $PSScriptRoot "..")
} else {
  $root = Resolve-Path (Join-Path $PSScriptRoot "..")
}

Set-Location $root

# Encerra instancias do app empacotado / electron do desktop
@(
  "GestorVend"
) | ForEach-Object {
  Get-Process -Name $_ -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}

Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
  Where-Object {
    $_.ExecutablePath -like "*\apps\desktop\dist-installer\*" -or
    $_.ExecutablePath -like "*\apps\desktop\release\*" -or
    $_.ExecutablePath -like "*\apps\desktop\out\*" -or
    ($_.Name -eq "electron.exe" -and $_.CommandLine -like "*apps\desktop*")
  } |
  ForEach-Object {
    Write-Host "Killing PID $($_.ProcessId) $($_.Name)"
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }

Start-Sleep -Milliseconds 400

function Move-LockedDir([string]$path) {
  if (-not (Test-Path -LiteralPath $path)) { return }
  $leaf = Split-Path $path -Leaf
  $parent = Split-Path $path -Parent
  $bak = Join-Path $parent ("_stale_" + $leaf + "_" + (Get-Date -Format "yyyyMMdd_HHmmss"))
  try {
    Rename-Item -LiteralPath $path -NewName (Split-Path $bak -Leaf) -ErrorAction Stop
    Write-Host "Moved locked folder to $(Split-Path $bak -Leaf)"
  } catch {
    Write-Host "Could not rename ${path}: $($_.Exception.Message)"
    Write-Host "Will use a fresh output directory instead."
  }
}

Move-LockedDir (Join-Path $root "dist-installer")
Move-LockedDir (Join-Path $root "release")

# Pasta de saida padrao (se a antiga ficou travada, cria nome novo e atualiza via env)
$out = Join-Path $root "dist-installer"
if (Test-Path -LiteralPath $out) {
  # ainda existe (rename falhou) -> usar out-TIMESTAMP
  $stamp = Get-Date -Format "yyyyMMdd_HHmmss"
  $out = Join-Path $root "dist-installer-$stamp"
  Write-Host "Using alternate output: $out"
  $env:GV_DESKTOP_OUT = $out
} else {
  $env:GV_DESKTOP_OUT = $out
}

Write-Host "Output dir ready: $env:GV_DESKTOP_OUT"
