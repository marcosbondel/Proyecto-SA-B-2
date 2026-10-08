Add-Type -AssemblyName System.Drawing
$bmp = [System.Drawing.Bitmap]::FromFile((Resolve-Path "docs/architecture/diagrams/08-despliegue-cloud-gcp.png"))

# Look at X=2000, Y=0..2500 to find borders of <<gcpCloud>> and <<vpc>>
for ($y = 100; $y -lt 2500; $y += 50) {
    $c = $bmp.GetPixel(2000, $y)
    if ($c.R -lt 100 -and $c.G -gt 100) { # green border of VPC
        Write-Host "VPC border near Y:" $y "Color:" $c.R $c.G $c.B
    }
}
$bmp.Dispose()
