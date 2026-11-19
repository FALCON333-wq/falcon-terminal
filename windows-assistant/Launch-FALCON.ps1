$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root
$Python = Get-Command python -ErrorAction SilentlyContinue
if (-not $Python) { Write-Host "Python 3 is required. Install it from https://www.python.org/downloads/" -ForegroundColor Red; Read-Host "Press Enter"; exit 1 }
try { $null = Invoke-RestMethod "http://127.0.0.1:11434/api/version" -TimeoutSec 2; Write-Host "Ollama detected." -ForegroundColor Green }
catch { Write-Host "Ollama is not responding. Start Ollama before chatting." -ForegroundColor Yellow }
$Port = 8765
$Listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($Listener) { Write-Host "Port $Port is already in use. Close the other app or change FALCON_PORT."; Read-Host "Press Enter"; exit 1 }
Start-Process "http://127.0.0.1:$Port"
python server.py
