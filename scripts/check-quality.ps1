param(
    [string]$PythonExecutable
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$RepoRoot = Split-Path -Parent $ScriptDir
$OriginalPythonPath = $env:PYTHONPATH
$OriginalPythonIoEncoding = $env:PYTHONIOENCODING
$OriginalPythonUtf8 = $env:PYTHONUTF8
Push-Location $RepoRoot

try {
    if (-not $PythonExecutable) {
        $PythonExecutable = $env:LUNABRIA_PYTHON
    }
    if (-not $PythonExecutable) {
        $Candidates = @(
            (Join-Path $RepoRoot "backend\venv\Scripts\python.exe"),
            (Join-Path $RepoRoot "backend\.venv\Scripts\python.exe"),
            (Join-Path $RepoRoot "..\..\..\backend\.venv\Scripts\python.exe"),
            "python"
        )
        foreach ($Cand in $Candidates) {
            if ($Cand -ne "python" -and (Test-Path $Cand)) {
                $PythonExecutable = (Resolve-Path $Cand).Path
                break
            }
        }
        if (-not $PythonExecutable) {
            $PythonExecutable = "python"
        }
    }

    $env:PYTHONPATH = Join-Path $RepoRoot "backend"
    $env:PYTHONIOENCODING = "utf-8"
    $env:PYTHONUTF8 = "1"
    $Npm = (Get-Command npm.cmd -ErrorAction Stop).Source

    $Checks = @(
        @{ Name = "Ruff lint"; Executable = $PythonExecutable; Arguments = @("-m", "ruff", "check", "backend/") },
        @{ Name = "Mypy"; Executable = $PythonExecutable; Arguments = @("-m", "mypy") },
        @{ Name = "Biome"; Executable = $Npm; Arguments = @("run", "lint") },
        @{ Name = "JavaScript types"; Executable = $Npm; Arguments = @("run", "typecheck") },
        @{ Name = "Frontend tests"; Executable = $Npm; Arguments = @("test") },
        @{ Name = "Backend tests"; Executable = $PythonExecutable; Arguments = @("-m", "unittest", "discover", "-s", "backend/tests", "-v") }
    )

    foreach ($Check in $Checks) {
        Write-Host "`n=== $($Check.Name) ===" -ForegroundColor Cyan
        $Arguments = $Check.Arguments
        & $Check.Executable @Arguments
        $ExitCode = $LASTEXITCODE
        if ($ExitCode -ne 0) {
            Write-Error "$($Check.Name) failed with exit code $ExitCode."
            exit $ExitCode
        }
    }

    Write-Host "`nAll quality checks passed." -ForegroundColor Green
}
finally {
    $env:PYTHONPATH = $OriginalPythonPath
    $env:PYTHONIOENCODING = $OriginalPythonIoEncoding
    $env:PYTHONUTF8 = $OriginalPythonUtf8
    Pop-Location
}
