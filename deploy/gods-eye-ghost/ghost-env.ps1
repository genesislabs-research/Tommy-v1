# Shared environment for God's Eye Ghost Edition baseline (portable, no system installs).
$GhostRoot   = 'G:\tommy\donors\gods-eye-ghost'
$GhostDeploy = 'G:\tommy\deploy\gods-eye-ghost'
$GhostLogs   = Join-Path $GhostDeploy 'logs'
$GhostNode   = 'G:\tommy\tools\node'
$GhostPort   = 4173
$GhostHost   = 'localhost'
$GhostPidFile = Join-Path $GhostDeploy 'ghost.pid'

$env:Path = "$GhostNode;$env:Path"
$env:npm_config_cache   = 'G:\tommy\cache\npm'
$env:PUPPETEER_CACHE_DIR = 'G:\tommy\cache\puppeteer'
