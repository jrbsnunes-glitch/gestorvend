# Gera resources/icon.ico (atalho, .exe, janela) a partir do monograma oficial GV.
$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$pngCandidates = @(
  (Join-Path $root "resources\icon-source.png"),
  (Join-Path $root "renderer\logo.png")
)
$png = $pngCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
$outDir = Join-Path $root "resources"
$ico = Join-Path $outDir "icon.ico"

if (-not $png) {
  throw "Logo nao encontrado (resources/icon-source.png ou renderer/logo.png)"
}

New-Item -ItemType Directory -Force -Path $outDir | Out-Null
Add-Type -AssemblyName System.Drawing

function Remove-LightBackground([System.Drawing.Bitmap]$bmp) {
  $rect = New-Object System.Drawing.Rectangle 0, 0, $bmp.Width, $bmp.Height
  $data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadWrite, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  try {
    $stride = $data.Stride
    $ptr = $data.Scan0
    $len = [Math]::Abs($stride) * $bmp.Height
    $bytes = New-Object byte[] $len
    [Runtime.InteropServices.Marshal]::Copy($ptr, $bytes, 0, $len)
    for ($y = 0; $y -lt $bmp.Height; $y++) {
      $row = $y * $stride
      for ($x = 0; $x -lt $bmp.Width; $x++) {
        $i = $row + ($x * 4)
        $b = $bytes[$i]
        $g = $bytes[$i + 1]
        $r = $bytes[$i + 2]
        if ($r -gt 232 -and $g -gt 232 -and $b -gt 232) {
          $bytes[$i + 3] = 0
        }
      }
    }
    [Runtime.InteropServices.Marshal]::Copy($bytes, 0, $ptr, $len)
  } finally {
    $bmp.UnlockBits($data)
  }
}

function Get-ContentRect([System.Drawing.Bitmap]$bmp) {
  $rect = New-Object System.Drawing.Rectangle 0, 0, $bmp.Width, $bmp.Height
  $data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  try {
    $minX = $bmp.Width
    $minY = $bmp.Height
    $maxX = -1
    $maxY = -1
    $stride = $data.Stride
    $ptr = $data.Scan0
    $len = [Math]::Abs($stride) * $bmp.Height
    $bytes = New-Object byte[] $len
    [Runtime.InteropServices.Marshal]::Copy($ptr, $bytes, 0, $len)
    for ($y = 0; $y -lt $bmp.Height; $y++) {
      $row = $y * $stride
      for ($x = 0; $x -lt $bmp.Width; $x++) {
        $i = $row + ($x * 4)
        $a = $bytes[$i + 3]
        $b = $bytes[$i]
        $g = $bytes[$i + 1]
        $r = $bytes[$i + 2]
        $isBg = ($a -lt 16) -or ($r -gt 248 -and $g -gt 248 -and $b -gt 248)
        if (-not $isBg) {
          if ($x -lt $minX) { $minX = $x }
          if ($y -lt $minY) { $minY = $y }
          if ($x -gt $maxX) { $maxX = $x }
          if ($y -gt $maxY) { $maxY = $y }
        }
      }
    }
    if ($maxX -lt 0) {
      return New-Object System.Drawing.Rectangle 0, 0, $bmp.Width, $bmp.Height
    }
    return New-Object System.Drawing.Rectangle $minX, $minY, ($maxX - $minX + 1), ($maxY - $minY + 1)
  } finally {
    $bmp.UnlockBits($data)
  }
}

function New-BitmapSquare([System.Drawing.Image]$src, [System.Drawing.Rectangle]$crop, [int]$size) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $navy = [System.Drawing.Color]::FromArgb(255, 20, 33, 89)
  $g.Clear($navy)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $pad = [Math]::Max(2, [int]($size * 0.10))
  $box = $size - (2 * $pad)
  $scale = [Math]::Min($box / [double]$crop.Width, $box / [double]$crop.Height)
  $w = [Math]::Max(1, [int]($crop.Width * $scale))
  $h = [Math]::Max(1, [int]($crop.Height * $scale))
  $x = [int](($size - $w) / 2)
  $y = [int](($size - $h) / 2)
  $g.DrawImage($src, (New-Object System.Drawing.Rectangle $x, $y, $w, $h), $crop, [System.Drawing.GraphicsUnit]::Pixel)
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

$fileBmp = [System.Drawing.Bitmap]::FromFile($png)
$srcBmp = New-Object System.Drawing.Bitmap $fileBmp.Width, $fileBmp.Height, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$copyG = [System.Drawing.Graphics]::FromImage($srcBmp)
$copyG.DrawImage($fileBmp, 0, 0, $fileBmp.Width, $fileBmp.Height)
$copyG.Dispose()
$fileBmp.Dispose()
Remove-LightBackground $srcBmp
try {
  $crop = Get-ContentRect $srcBmp
  $sizes = @(16, 24, 32, 48, 64, 128, 256)
  $images = New-Object System.Collections.Generic.List[object]
  foreach ($s in $sizes) {
    $bmp = New-BitmapSquare $srcBmp $crop $s
    if ($s -eq 256) {
      $preview = Join-Path $outDir "icon-preview-256.png"
      $bmp.Save($preview, [System.Drawing.Imaging.ImageFormat]::Png)
    }
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
  $srcBmp.Dispose()
}

Write-Host "Gerado: $ico ($((Get-Item $ico).Length) bytes) a partir de $(Split-Path $png -Leaf)"
