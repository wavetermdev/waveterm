$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$repoRoot = Split-Path -Parent $PSScriptRoot

Write-Host "[verify] repo root: $repoRoot"

Push-Location $repoRoot
try {
    Write-Host "[verify] running git diff --check"
    git diff --check

    Write-Host "[verify] running npm.cmd run build:dev"
    npm.cmd run build:dev

    Write-Host "[verify] success"
} finally {
    Pop-Location
}
