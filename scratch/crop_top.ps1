Add-Type -AssemblyName System.Drawing
$src = [System.Drawing.Bitmap]::FromFile((Resolve-Path "docs/architecture/diagrams/08-despliegue-cloud-gcp.png"))
$crop = New-Object System.Drawing.Bitmap 1000, 600
$g = [System.Drawing.Graphics]::FromImage($crop)
$rectSrc = New-Object System.Drawing.Rectangle 3500, 1400, 2000, 1200
$rectDst = New-Object System.Drawing.Rectangle 0, 0, 1000, 600
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.DrawImage($src, $rectDst, $rectSrc, [System.Drawing.GraphicsUnit]::Pixel)
$g.Dispose()
$src.Dispose()
$crop.Save((Resolve-Path "scratch").Path + "\crop_top.png", [System.Drawing.Imaging.ImageFormat]::Png)
$crop.Dispose()
Write-Host "Crop top saved"
