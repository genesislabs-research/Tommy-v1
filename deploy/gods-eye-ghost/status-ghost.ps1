# Report whether the Ghost baseline is up, on which interface, and whether it answers.
. "$PSScriptRoot\ghost-env.ps1"

Write-Host "God's Eye Ghost Edition - status" -ForegroundColor Cyan
Write-Host "  Donor : $GhostRoot"
Write-Host "  Node  : $(& (Join-Path $GhostNode 'node.exe') -v)"

$listener = Get-NetTCPConnection -LocalPort $GhostPort -State Listen -ErrorAction SilentlyContinue
if (-not $listener) { Write-Host "  State : STOPPED (nothing listening on $GhostPort)" -ForegroundColor Yellow; exit 1 }

foreach ($c in $listener) {
    $proc = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue
    Write-Host "  State : LISTENING on $($c.LocalAddress):$($c.LocalPort) (PID $($proc.Id) $($proc.ProcessName))" -ForegroundColor Green
    if ($c.LocalAddress -notin @('127.0.0.1','::1')) {
        Write-Host "  WARNING: bound beyond loopback - this is LAN-exposed." -ForegroundColor Red
    }
}
try {
    $r = Invoke-WebRequest "http://$GhostHost`:$GhostPort" -UseBasicParsing -TimeoutSec 5
    Write-Host "  HTTP  : $($r.StatusCode) ($($r.RawContentLength) bytes)" -ForegroundColor Green
} catch { Write-Host "  HTTP  : no response - $($_.Exception.Message.Split([char]10)[0])" -ForegroundColor Yellow }
