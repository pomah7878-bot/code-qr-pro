param([string]$JsonPath)
Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = 'Stop'
$job = Get-Content -Raw -Encoding UTF8 $JsonPath | ConvertFrom-Json
$dpi = [int]$job.dpi
$wPx = [int][math]::Round($job.widthMm / 25.4 * $dpi)
$hPx = [int][math]::Round($job.heightMm / 25.4 * $dpi)
$bmp = New-Object System.Drawing.Bitmap $wPx, $hPx
$bmp.SetResolution($dpi, $dpi)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.Clear([System.Drawing.Color]::White)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias
$mmToPx = $dpi / 25.4
foreach ($el in $job.elements) {
  $x = [int]($el.x * $mmToPx); $y = [int]($el.y * $mmToPx)
  $w = [int]($el.w * $mmToPx); $h = [int]($el.h * $mmToPx)
  if ($w -le 0 -or $h -le 0) { continue }
  if ($el.pngBase64) {
    $bytes = [Convert]::FromBase64String($el.pngBase64)
    $ms = New-Object System.IO.MemoryStream(,$bytes)
    $img = [System.Drawing.Image]::FromStream($ms)
    $g.DrawImage($img, $x, $y, $w, $h)
    $img.Dispose(); $ms.Dispose()
  } elseif ($el.text) {
    $font = New-Object System.Drawing.Font('Arial', [single]$el.fontSize, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Point)
    $sf = New-Object System.Drawing.StringFormat
    if ($el.align -eq 'center') { $sf.Alignment = [System.Drawing.StringAlignment]::Center }
    elseif ($el.align -eq 'right') { $sf.Alignment = [System.Drawing.StringAlignment]::Far }
    $rect = New-Object System.Drawing.RectangleF $x, $y, $w, $h
    $g.DrawString($el.text, $font, [System.Drawing.Brushes]::Black, $rect, $sf)
    $font.Dispose(); $sf.Dispose()
  }
}
$g.Dispose()
if ($job.savePng) {
  $out = Join-Path (Split-Path $JsonPath) 'preview.png'
  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Output 'PREVIEW_OK'
  exit 0
}
$copies = [int]$job.copies
if ($copies -lt 1) { $copies = 1 }
$pd = New-Object System.Drawing.Printing.PrintDocument
$pd.PrinterSettings.PrinterName = $job.printer
if (-not $pd.PrinterSettings.IsValid) {
  $bmp.Dispose()
  Write-Error "Принтер не найден: $($job.printer)"
  exit 1
}
$pd.DefaultPageSettings.PaperSize = New-Object System.Drawing.Printing.PaperSize('Label', [int]($job.widthMm / 25.4 * 100), [int]($job.heightMm / 25.4 * 100))
$pd.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0, 0, 0, 0)
$pd.add_PrintPage({
  param($s, $e)
  $e.Graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
  $e.Graphics.DrawImage($bmp, 0, 0, $e.PageBounds.Width, $e.PageBounds.Height)
  $e.HasMorePages = $false
})
for ($i = 0; $i -lt $copies; $i++) { $pd.Print() }
$bmp.Dispose()
Write-Output 'PRINT_OK'
