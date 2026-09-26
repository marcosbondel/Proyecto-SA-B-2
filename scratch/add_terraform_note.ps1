Add-Type -AssemblyName System.Drawing

$origFile = (Resolve-Path "docs/architecture/diagrams/08-despliegue-cloud-gcp.png").Path
$tmpFile = (Resolve-Path "scratch").Path + "\temp_gcp.png"

# Read into memory
$bytes = [System.IO.File]::ReadAllBytes($origFile)
$ms = New-Object System.IO.MemoryStream(,$bytes)
$bmp = [System.Drawing.Bitmap]::FromStream($ms)

$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

# Coordinates
$x = 4200
$y = 360
$w = 2150
$h = 420
$fold = 50

# Colors
$cBg = [System.Drawing.Color]::FromArgb(254, 255, 197)
$cFold = [System.Drawing.Color]::FromArgb(238, 239, 185)
$cBorder = [System.Drawing.Color]::FromArgb(40, 40, 40)
$cText = [System.Drawing.Color]::FromArgb(20, 20, 20)

$bgBrush = New-Object System.Drawing.SolidBrush ($cBg)
$foldBrush = New-Object System.Drawing.SolidBrush ($cFold)
$textBrush = New-Object System.Drawing.SolidBrush ($cText)

$borderPen = New-Object System.Drawing.Pen ($cBorder, 4)
$borderPen.DashPattern = [float[]]@(5.0, 3.0)
$solidPen = New-Object System.Drawing.Pen ($cBorder, 3)

# Main body polygon
$p1 = [System.Drawing.Point]::new($x, $y)
$p2 = [System.Drawing.Point]::new(($x + $w - $fold), $y)
$p3 = [System.Drawing.Point]::new(($x + $w), ($y + $fold))
$p4 = [System.Drawing.Point]::new(($x + $w), ($y + $h))
$p5 = [System.Drawing.Point]::new($x, ($y + $h))
[System.Drawing.Point[]]$pts = @($p1, $p2, $p3, $p4, $p5)

$g.FillPolygon($bgBrush, $pts)
$g.DrawPolygon($borderPen, $pts)

# Fold triangle polygon
$f1 = [System.Drawing.Point]::new(($x + $w - $fold), $y)
$f2 = [System.Drawing.Point]::new(($x + $w - $fold), ($y + $fold))
$f3 = [System.Drawing.Point]::new(($x + $w), ($y + $fold))
[System.Drawing.Point[]]$foldPts = @($f1, $f2, $f3)
$g.FillPolygon($foldBrush, $foldPts)
$g.DrawLines($solidPen, $foldPts)

# Text definitions using Unicode characters
$u_accent = [char]0x00FA  # ú
$o_accent = [char]0x00F3  # ó

$titleFont = New-Object System.Drawing.Font ("Segoe UI", 36, [System.Drawing.FontStyle]::Bold)
$bodyFont = New-Object System.Drawing.Font ("Segoe UI", 30, [System.Drawing.FontStyle]::Regular)
$codeFont = New-Object System.Drawing.Font ("Segoe UI", 30, [System.Drawing.FontStyle]::Bold)

$padX = 45
$curY = $y + 35

$title = "Aprovisionamiento con Terraform (IaC)"
$g.DrawString($title, $titleFont, $textBrush, ($x + $padX), $curY)
$curY += 72

$line1 = "Toda la infraestructura cloud (VPC bank-usac-vpc, subredes GKE y datos,"
$g.DrawString($line1, $bodyFont, $textBrush, ($x + $padX), $curY)
$curY += 58

$line2 = "cl" + $u_accent + "ster GKE bank-usac-vpc-gke, 5 VMs PostgreSQL, Cloud NAT & Router,"
$g.DrawString($line2, $bodyFont, $textBrush, ($x + $padX), $curY)
$curY += 58

$line3 = "y reglas de firewall) se provisiona y gestiona como c" + $o_accent + "digo en:"
$g.DrawString($line3, $bodyFont, $textBrush, ($x + $padX), $curY)
$curY += 58

$line4 = "infra/terraform/gcp/ (ADR-016)"
$g.DrawString($line4, $codeFont, $textBrush, ($x + $padX), $curY)

# Preview crop
$crop = New-Object System.Drawing.Bitmap 1150, 260
$gc = [System.Drawing.Graphics]::FromImage($crop)
$gc.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$rectSrc = New-Object System.Drawing.Rectangle ($x - 50), ($y - 40), ($w + 100), ($h + 80)
$rectDst = New-Object System.Drawing.Rectangle 0, 0, 1150, 260
$gc.DrawImage($bmp, $rectDst, $rectSrc, [System.Drawing.GraphicsUnit]::Pixel)
$gc.Dispose()
$crop.Save((Resolve-Path "scratch").Path + "\note_preview.png", [System.Drawing.Imaging.ImageFormat]::Png)
$crop.Dispose()

# Save modified image
$g.Dispose()
$bmp.Save($tmpFile, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
$ms.Dispose()

Move-Item -Path $tmpFile -Destination $origFile -Force
Write-Host "SUCCESS: Clean note generated with proper accents!"
