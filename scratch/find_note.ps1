Add-Type -AssemblyName System.Drawing
$bmp = [System.Drawing.Bitmap]::FromFile((Resolve-Path "docs/architecture/diagrams/08-despliegue-cloud-gcp.png"))
Write-Host "Width:" $bmp.Width "Height:" $bmp.Height

$minX = 99999
$maxX = 0
$minY = 99999
$maxY = 0
$count = 0

for ($y = 0; $y -lt $bmp.Height; $y += 20) {
    for ($x = 0; $x -lt $bmp.Width; $x += 20) {
        $c = $bmp.GetPixel($x, $y)
        # Note color #FEFFDD or #FFF9E6
        if ($c.R -gt 245 -and $c.G -gt 245 -and $c.B -lt 225) {
            if ($x -lt $minX) { $minX = $x }
            if ($x -gt $maxX) { $maxX = $x }
            if ($y -lt $minY) { $minY = $y }
            if ($y -gt $maxY) { $maxY = $y }
            $count++
        }
    }
}
$bmp.Dispose()
Write-Host "Count: $count Bounds: X: [$minX, $maxX] Y: [$minY, $maxY]"
