Add-Type -AssemblyName System.Drawing
$src = [System.Drawing.Bitmap]::FromFile((Resolve-Path "docs/architecture/diagrams/08-despliegue-cloud-gcp.png"))
$crop = New-Object System.Drawing.Bitmap 900, 750
$g = [System.Drawing.Graphics]::FromImage($crop)
$rectSrc = New-Object System.Drawing.Rectangle 7250, 7600, 900, 750
$rectDst = New-Object System.Drawing.Rectangle 0, 0, 900, 750
$g.DrawImage($src, $rectDst, $rectSrc, [System.Drawing.GraphicsUnit]::Pixel)
$g.Dispose()
$src.Dispose()
$crop.Save((Resolve-Path "scratch").Path + "\note_crop.png", [System.Drawing.Imaging.ImageFormat]::Png)
$crop.Dispose()
Write-Host "Cropped note saved"
