$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

# Prefer a real python executable; the Microsoft Store execution alias can exist even when Python is absent.
$PythonExe = $null
$PythonArgs = @()
$PythonCommand = Get-Command python -ErrorAction SilentlyContinue
if ($PythonCommand) {
  & $PythonCommand.Source --version *> $null
  if ($LASTEXITCODE -eq 0) { $PythonExe = $PythonCommand.Source }
}
if (-not $PythonExe) {
  $PyLauncher = Get-Command py -ErrorAction SilentlyContinue
  if ($PyLauncher) {
    & $PyLauncher.Source -3 --version *> $null
    if ($LASTEXITCODE -eq 0) { $PythonExe = $PyLauncher.Source; $PythonArgs = @("-3") }
  }
}
if (-not $PythonExe) {
  Write-Host "Python 3.10+ is required but was not found." -ForegroundColor Red
  Write-Host "Install: https://www.python.org/downloads/windows/"
  Write-Host "Enable 'Add python.exe to PATH', then reopen PowerShell."
  Read-Host "Press Enter to close"
  exit 1
}

try {
  $null = Invoke-RestMethod "http://127.0.0.1:11434/api/version" -TimeoutSec 2
  Write-Host "Ollama detected." -ForegroundColor Green
} catch {
  Write-Host "Ollama is not responding. Start Ollama before chatting." -ForegroundColor Yellow
}

# Reuse an already-running FALCON server if one is present on the default port.
$Port = 8765
try {
  $Existing = Invoke-RestMethod "http://127.0.0.1:$Port/api/status" -TimeoutSec 2
  if ($Existing.app -eq "FALCON") {
    Write-Host "FALCON is already running on port $Port. Opening it." -ForegroundColor Green
    Start-Process "http://127.0.0.1:$Port"
    exit 0
  }
} catch { }

# If another application owns the default port, find a free local port automatically.
while ($true) {
  $Tcp = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
  try {
    $Tcp.Start()
    $Tcp.Stop()
    break
  } catch {
    try { $Tcp.Stop() } catch { }
    $Port++
    if ($Port -gt 8875) { throw "No free port found between 8765 and 8875." }
  }
}
$env:FALCON_PORT = "$Port"
Write-Host "Starting FALCON at http://127.0.0.1:$Port" -ForegroundColor Cyan
Start-Process "http://127.0.0.1:$Port"
& $PythonExe @PythonArgs "server.py"
if ($LASTEXITCODE -ne 0) {
  Write-Host "FALCON stopped with exit code $LASTEXITCODE" -ForegroundColor Red
  Read-Host "Press Enter to close"
}
