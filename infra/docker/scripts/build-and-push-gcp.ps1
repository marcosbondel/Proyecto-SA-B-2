# ==============================================================================
# Script de PowerShell para Construir y Publicar Imágenes Docker en GCP Artifact Registry
# ==============================================================================
param(
    [string]$ProjectId = "project-0d3c28c7-a4e0-44ad-a4e",
    [string]$Region = "us-central1",
    [string]$RepoName = "bank-images",
    [string]$Tag = ""
)

$ErrorActionPreference = "Stop"

$RepoRoot = Resolve-Path "$PSScriptRoot\..\..\.."
Set-Location $RepoRoot

if ([string]::IsNullOrWhiteSpace($Tag)) {
    $Tag = (git rev-parse --short HEAD).Trim()
}

$Registry = "$Region-docker.pkg.dev/$ProjectId/$RepoName"

Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "Iniciando compilacion y publicacion en Google Cloud Artifact Registry" -ForegroundColor Cyan
Write-Host "Registro : $Registry" -ForegroundColor Yellow
Write-Host "Etiqueta : $Tag y latest" -ForegroundColor Yellow
Write-Host "======================================================================" -ForegroundColor Cyan

# Autenticar Docker con el repositorio de Artifact Registry
gcloud auth configure-docker "$Region-docker.pkg.dev" --quiet

$Components = @(
    @{ Name = "gateway";                    Dockerfile = "apps/gateway/Dockerfile" },
    @{ Name = "customer-service";           Dockerfile = "apps/services/customer-service/Dockerfile" },
    @{ Name = "account-service";            Dockerfile = "apps/services/account-service/Dockerfile" },
    @{ Name = "transaction-service";        Dockerfile = "apps/services/transaction-service/Dockerfile" },
    @{ Name = "payment-service";            Dockerfile = "apps/services/payment-service/Dockerfile" },
    @{ Name = "notification-audit-service"; Dockerfile = "apps/services/notification-audit-service/Dockerfile" },
    @{ Name = "web";                        Dockerfile = "apps/web/Dockerfile" }
)

foreach ($comp in $Components) {
    $imageTag = "$Registry/$($comp.Name):$Tag"
    $imageLatest = "$Registry/$($comp.Name):latest"

    Write-Host "`n>>> Construyendo $($comp.Name)..." -ForegroundColor Green
    docker build `
        --file $comp.Dockerfile `
        --tag $imageTag `
        --tag $imageLatest `
        --build-arg "IMAGE_VERSION=$Tag" `
        --build-arg "GIT_COMMIT=$Tag" `
        $RepoRoot

    Write-Host ">>> Publicando $imageTag..." -ForegroundColor Cyan
    docker push $imageTag

    Write-Host ">>> Publicando $imageLatest..." -ForegroundColor Cyan
    docker push $imageLatest
}

Write-Host "`n======================================================================" -ForegroundColor Green
Write-Host "Todas las imagenes se construyeron y publicaron exitosamente en GCP!" -ForegroundColor Green
Write-Host "======================================================================" -ForegroundColor Green
