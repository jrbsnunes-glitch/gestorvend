# Gera resources/icon.ico a partir de renderer/logo.png (NSIS exige .ico, nao .png).
$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$png = Join-Path $root "renderer\logo.png"
$outDir = Join-Path $root "resources"
$ico = Join-Path $outDir "icon.ico"

if (-not (Test-Path -LiteralPath $png)) {
  throw "Logo nao encontrado: $png"
}

New-Item -ItemType Directory -Force -Path $outDir | Out-Null
Add-Type -AssemblyName System.Drawing

function New-BitmapSquare([System.Drawing.Image]$src, [int]$size) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.Clear([System.Drawing.Color]::Transparent)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.DrawImage($src, 0, 0, $size, $size)
  $g.Dispose()
  return $bmp
}

function Get-PngBytes([System.Drawing.Bitmap]$bmp) {
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $bytes = $ms.ToArray()
  $ms.Dispose()
  return $bytes
}

$src = [System.Drawing.Image]::FromFile($png)
try {
  $sizes = @(16, 32, 48, 64, 128, 256)
  $images = New-Object System.Collections.Generic.List[object]
  foreach ($s in $sizes) {
    $bmp = New-BitmapSquare $src $s
    $pngBytes = Get-PngBytes $bmp
    $bmp.Dispose()
    $images.Add([pscustomobject]@{ Size = $s; Bytes = $pngBytes }) | Out-Null
  }

  $ms = New-Object System.IO.MemoryStream
  $bw = New-Object System.IO.BinaryWriter $ms

  $bw.Write([uint16]0)
  $bw.Write([uint16]1)
  $bw.Write([uint16]$images.Count)

  $offset = 6 + (16 * $images.Count)
  foreach ($img in $images) {
    $s = [int]$img.Size
    $len = $img.Bytes.Length
    $w = 0
    if ($s -lt 256) { $w = $s }
    $bw.Write([byte]$w)
    $bw.Write([byte]$w)
    $bw.Write([byte]0)
    $bw.Write([byte]0)
    $bw.Write([uint16]1)
    $bw.Write([uint16]32)
    $bw.Write([uint32]$len)
    $bw.Write([uint32]$offset)
    $offset += $len
  }
  foreach ($img in $images) {
    $bw.Write([byte[]]$img.Bytes)
  }
  $bw.Flush()
  [IO.File]::WriteAllBytes($ico, $ms.ToArray())
  $bw.Dispose()
  $ms.Dispose()
} finally {
  $src.Dispose()
}

Write-Host "Gerado: $ico ($((Get-Item $ico).Length) bytes)"
