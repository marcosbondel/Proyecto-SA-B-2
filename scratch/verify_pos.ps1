Add-Type -AssemblyName System.Drawing
$src = [System.Drawing.Bitmap]::FromFile((Resolve-Path "docs/architecture/diagrams/08-despliegue-cloud-gcp.png"))
$crop = New-Object System.Drawing.Bitmap 1100, 450
$g = [System.Drawing.Graphics]::FromImage($crop)
$rectSrc = New-Object System.Drawing.Rectangle 4000, 400, 2200, 900
$rectDst = New-Object System.Drawing.Rectangle 0, 0, 1100, 450
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.DrawImage($src, $rectDst, $rectSrc, [System.Drawing.GraphicsUnit]::Pixel)
$g.Dispose()
$src.Dispose()
$crop.Save((Resolve-Path "scratch").Path + "\crop_note_pos.png", [System.Drawing.Imaging.ImageFormat]::Png)
$crop.Dispose()
Write-Host "Crop note pos saved"
