# Empacota o desktop: limpa saida e gera NSIS.
# O Cursor costuma travar app.asar em pastas de build abertas/indexadas.
$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $root

Write-Host "==> Encerrando GestorVend / electron do desktop..."
Stop-Process -Name "GestorVend" -Force -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
  Where-Object {
    $_.ExecutablePath -like "*\apps\desktop\*\win-unpacked\*" -or
    ($_.Name -match "^(electron|GestorVend)$" -and $_.CommandLine -like "*apps\desktop*")
  } |
  ForEach-Object {
    Write-Host "  kill PID $($_.ProcessId) $($_.Name)"
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }
Start-Sleep -Milliseconds 500

function Try-Clear([string]$path) {
  if (-not (Test-Path -LiteralPath $path)) { return $true }
  try {
    Remove-Item -LiteralPath $path -Recurse -Force -ErrorAction Stop
    return $true
  } catch {
    $bakName = "_stale_" + (Split-Path $path -Leaf) + "_" + (Get-Date -Format "yyyyMMdd_HHmmss")
    try {
      Rename-Item -LiteralPath $path -NewName $bakName -ErrorAction Stop
      Write-Host "  pasta travada renomeada para $bakName"
      return $true
    } catch {
      Write-Host "  aviso: nao limpou $path ($($_.Exception.Message))"
      return $false
    }
  }
}

$outName = "out"
$outPath = Join-Path $root $outName
if (-not (Try-Clear $outPath)) {
  $outName = "out-" + (Get-Date -Format "yyyyMMdd_HHmmss")
  $outPath = Join-Path $root $outName
  Write-Host "==> Usando pasta alternativa: $outName"
}

foreach ($old in @("dist-installer", "release")) {
  [void](Try-Clear (Join-Path $root $old))
}

Write-Host "==> TypeScript..."
npm run build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "==> electron-builder (output=$outName)..."
$env:CSC_IDENTITY_AUTO_DISCOVERY = "false"

# --config substitui o bloco build do package.json: copiar config completa
$pkg = Get-Content (Join-Path $root "package.json") -Raw | ConvertFrom-Json
$build = $pkg.build
$build.directories.output = $outName
$configPath = Join-Path $root ".electron-builder.out.json"
($build | ConvertTo-Json -Depth 30) | Set-Content -Path $configPath -Encoding UTF8

try {
  npx --yes electron-builder --win nsis --x64 --projectDir . --config $configPath
  $code = $LASTEXITCODE
} finally {
  Remove-Item -LiteralPath $configPath -Force -ErrorAction SilentlyContinue
}

if ($code -ne 0) { exit $code }

Write-Host ""
Write-Host "OK - instalador em: $outPath"
Get-ChildItem -LiteralPath $outPath -Filter "*.exe" -ErrorAction SilentlyContinue | ForEach-Object {
  $mb = [math]::Round($_.Length / 1MB, 1)
  Write-Host "  $($_.Name) ($mb MB)"
}
