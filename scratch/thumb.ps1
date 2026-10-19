Add-Type -AssemblyName System.Drawing
$src = [System.Drawing.Bitmap]::FromFile((Resolve-Path "docs/architecture/diagrams/08-despliegue-cloud-gcp.png"))
$w = [int]($src.Width / 10)
$h = [int]($src.Height / 10)
$thumb = New-Object System.Drawing.Bitmap $w, $h
$g = [System.Drawing.Graphics]::FromImage($thumb)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.DrawImage($src, 0, 0, $w, $h)
$g.Dispose()
$src.Dispose()
$thumb.Save((Resolve-Path "scratch").Path + "\thumb.png", [System.Drawing.Imaging.ImageFormat]::Png)
$thumb.Dispose()
Write-Host "Thumbnail saved"
