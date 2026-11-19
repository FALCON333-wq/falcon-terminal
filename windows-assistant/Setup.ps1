$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root
Write-Host "FALCON Windows Assistant setup" -ForegroundColor Cyan

$PythonCommand = Get-Command python -ErrorAction SilentlyContinue
$PythonOk = $false
if ($PythonCommand) {
  & $PythonCommand.Source --version
  $PythonOk = ($LASTEXITCODE -eq 0)
}
if (-not $PythonOk) {
  $PyLauncher = Get-Command py -ErrorAction SilentlyContinue
  if ($PyLauncher) {
    & $PyLauncher.Source -3 --version
    $PythonOk = ($LASTEXITCODE -eq 0)
  }
}
if (-not $PythonOk) {
  Write-Host "Python 3.10+ is NOT installed or is not available on PATH." -ForegroundColor Red
  Write-Host "Install Python from https://www.python.org/downloads/windows/"
  Write-Host "During installation enable 'Add python.exe to PATH'. Then close and reopen PowerShell."
  exit 1
}

if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) {
  Write-Host "Ollama not detected. Install it from https://ollama.com/download/windows" -ForegroundColor Yellow
} else {
  try { ollama list } catch { Write-Host "Ollama CLI found. Start Ollama before launching FALCON." -ForegroundColor Yellow }
}
Write-Host "Setup checks passed. No Python packages are required." -ForegroundColor Green
Write-Host "Launch with: .\Launch-FALCON.ps1"
