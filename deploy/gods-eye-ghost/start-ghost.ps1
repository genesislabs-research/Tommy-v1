# Start the Ghost Edition dev server on loopback only. Refuses to start a duplicate.
. "$PSScriptRoot\ghost-env.ps1"
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path $GhostLogs | Out-Null

$listener = Get-NetTCPConnection -LocalPort $GhostPort -State Listen -ErrorAction SilentlyContinue
if ($listener) {
    $owner = Get-Process -Id ($listener | Select-Object -First 1).OwningProcess -ErrorAction SilentlyContinue
    Write-Host "REFUSING TO START: port $GhostPort is already in use by PID $($owner.Id) ($($owner.ProcessName))." -ForegroundColor Yellow
    Write-Host "Run status-ghost.ps1, or stop-ghost.ps1 if that is this service."
    exit 1
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$out = Join-Path $GhostLogs "dev-$stamp.out.log"
$err = Join-Path $GhostLogs "dev-$stamp.err.log"

# Note: these logs fill lazily - npm/Vite buffer their output, so the files can
# sit at 0 bytes for a while after a healthy start. An empty log here is not
# evidence of a failed launch; check status-ghost.ps1 or the port instead.
$p = Start-Process -FilePath (Join-Path $GhostNode 'npm.cmd') `
    -ArgumentList @('run','dev','--','--host',$GhostHost,'--port',"$GhostPort") `
    -WorkingDirectory $GhostRoot -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput $out -RedirectStandardError $err

$p.Id | Set-Content -Path $GhostPidFile -Encoding ascii
Write-Host "Started God's Eye Ghost Edition (PID $($p.Id))." -ForegroundColor Green
Write-Host "  URL  : http://$GhostHost`:$GhostPort   (loopback only)"
Write-Host "  Logs : $out"

for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 750
    try {
        $r = Invoke-WebRequest "http://$GhostHost`:$GhostPort" -UseBasicParsing -TimeoutSec 3
        if ($r.StatusCode -eq 200) { Write-Host "Ready: HTTP 200." -ForegroundColor Green; exit 0 }
    } catch { }
}
Write-Host "Process started but no HTTP 200 yet - check the log above." -ForegroundColor Yellow
exit 1
