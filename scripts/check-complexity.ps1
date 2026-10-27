<#
.SYNOPSIS
    Runs complexity analysis for Python (Radon) and JavaScript in Lunabria.
.DESCRIPTION
    Audits cyclomatic complexity, maintainability index, and checks thresholds.
    Accepts --fail-on-threshold to act as a quality gate in CI or pre-commit.
#>

param(
    [switch]$FailOnThreshold,
    [switch]$Json
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$RepoRoot = Split-Path -Parent $ScriptDir
Set-Location $RepoRoot

$Candidates = @(
    (Join-Path $RepoRoot "backend\venv\Scripts\python.exe"),
    (Join-Path $RepoRoot "backend\.venv\Scripts\python.exe"),
    (Join-Path $RepoRoot "..\..\..\backend\.venv\Scripts\python.exe"),
    "python"
)
$PyExe = "python"
foreach ($Cand in $Candidates) {
    if ($Cand -ne "python" -and (Test-Path $Cand)) {
        $PyExe = (Resolve-Path $Cand).Path
        break
    }
}

Write-Host "================================================================================" -ForegroundColor Cyan
Write-Host "                  LUNABRIA COMPLEXITY & MAINTAINABILITY AUDIT                   " -ForegroundColor Cyan
Write-Host "================================================================================" -ForegroundColor Cyan

# 1. PYTHON BACKEND COMPLEXITY
Write-Host "`n[1/3] Backend Python - Cyclomatic Complexity (Radon CC)" -ForegroundColor Yellow
& $PyExe -m radon cc backend/app -a -s

Write-Host "`n[2/3] Backend Python - Maintainability Index (Radon MI)" -ForegroundColor Yellow
& $PyExe -m radon mi backend/app -s

# 2. FRONTEND JAVASCRIPT COMPLEXITY
Write-Host "`n[3/3] Frontend JavaScript - Cyclomatic & Maintainability Metrics" -ForegroundColor Yellow
if ($Json) {
    node scripts/js-complexity.cjs frontend/js --json
} else {
    node scripts/js-complexity.cjs frontend/js
}

# 3. THRESHOLD GUARDIAN (Xenon)
if ($FailOnThreshold) {
    Write-Host "`n[Quality Gate] Validating Python thresholds with Xenon..." -ForegroundColor Yellow
    # Enforce average complexity grade A and absolute ceiling
    & $PyExe -m xenon --max-absolute F --max-modules F --max-average A backend/app
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Quality Gate Failed: Python complexity exceeded allowed thresholds."
        exit 1
    }
    Write-Host "[Quality Gate Passed] All complexity thresholds are satisfied." -ForegroundColor Green
}

Write-Host "`nAudit complete." -ForegroundColor Green
