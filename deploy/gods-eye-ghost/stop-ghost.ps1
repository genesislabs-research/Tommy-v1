# Stop the Ghost dev server started by start-ghost.ps1 (and its node child).
. "$PSScriptRoot\ghost-env.ps1"

$stopped = $false
$listener = Get-NetTCPConnection -LocalPort $GhostPort -State Listen -ErrorAction SilentlyContinue
foreach ($c in $listener) {
    $proc = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue
    if ($proc) {
        Write-Host "Stopping PID $($proc.Id) ($($proc.ProcessName)) on port $GhostPort..."
        Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
        $stopped = $true
    }
}
if (Test-Path $GhostPidFile) {
    $wrapper = Get-Content $GhostPidFile -ErrorAction SilentlyContinue
    if ($wrapper) { Stop-Process -Id ([int]$wrapper) -Force -ErrorAction SilentlyContinue }
    Remove-Item $GhostPidFile -Force -ErrorAction SilentlyContinue
}
if ($stopped) { Write-Host "Stopped." -ForegroundColor Green } else { Write-Host "Nothing was listening on port $GhostPort." -ForegroundColor Yellow }
