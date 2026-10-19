Add-Type -AssemblyName System.Drawing
$bmp = [System.Drawing.Bitmap]::FromFile((Resolve-Path "docs/architecture/diagrams/08-despliegue-cloud-gcp.png"))
$cBg = $bmp.GetPixel(7500, 7800)
$cBorder = $bmp.GetPixel(7300, 7800)
Write-Host "Bg:" $cBg.R $cBg.G $cBg.B
Write-Host "Border:" $cBorder.R $cBorder.G $cBorder.B

# Check where Cloud NAT or the top area is (e.g. near X=2000..5000, Y=500..2000)
# Let's inspect what is at top right or top left
$bmp.Dispose()
