$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Write-Host "FALCON Windows Assistant setup" -ForegroundColor Cyan
if (-not (Get-Command python -ErrorAction SilentlyContinue)) { throw "Python 3.10+ is required. Install Python and enable Add Python to PATH." }
python --version
if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) { Write-Host "Ollama not detected. Install it from https://ollama.com/download/windows" -ForegroundColor Yellow }
else {
  try { ollama list } catch { Write-Host "Start Ollama once, then run: ollama pull qwen3:4b" -ForegroundColor Yellow }
}
Write-Host "Setup complete. No Python packages are required." -ForegroundColor Green
Write-Host "Launch with: .\Launch-FALCON.ps1"
