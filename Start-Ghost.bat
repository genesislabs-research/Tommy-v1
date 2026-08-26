@echo off
setlocal
title God's Eye View - GHOST EDITION

set "URL=http://localhost:4173"
set "DEPLOY=G:\tommy\deploy\gods-eye-ghost"

REM KIOSK=1 (default): true fullscreen, no window frame or browser UI at all.
REM               Exit with Alt+F4, or Ctrl+W. Alt+Tab still switches away.
REM KIOSK=0     : windowed app mode - no tabs/address bar, but a normal frame.
set "KIOSK=1"

REM Chrome only honours --kiosk / --app= when it owns a separate profile.
REM Without this, launching while your everyday Chrome is open just forwards the
REM URL to that running instance and you get an ordinary tab - kiosk is silently
REM ignored. This profile is dedicated to Ghost Edition; your main one is
REM untouched (so no extensions or logins carry over, which is fine here).
set "APPWIN=G:\tommy\cache\chrome-app-profile"

echo ==================================================
echo    God's Eye View  -  GHOST EDITION
echo    keyless baseline  ^|  localhost only
echo ==================================================
echo.

REM ---- Load secrets from the deployment .env into this shell ----
REM Values set here are inherited by the PowerShell child and by the node
REM process it spawns, and Vite only fills vars that are still undefined
REM (vite.config.js: `if (process.env[key] === undefined)`), so anything set
REM here WINS over the donor's own .env. Nothing is echoed - @echo off is on
REM and the value is never printed.
if exist "%DEPLOY%\.env" (
    for /f "usebackq eol=# tokens=1,* delims==" %%A in ("%DEPLOY%\.env") do (
        if not "%%~A"=="" set "%%~A=%%~B"
    )
    echo   Loaded environment from %DEPLOY%\.env
) else (
    echo   No .env found - starting without an OpenAI key.
)

if "%OPENAI_API_KEY%"=="REPLACE_ME" (
    echo   NOTE: OPENAI_API_KEY is still the placeholder - voice/AI HUD stay off.
)
echo.

REM ---- Start the server (refuses politely if already running) ----
powershell -NoProfile -ExecutionPolicy Bypass -File "%DEPLOY%\start-ghost.ps1"
echo.

REM ---- Wait until the app actually answers, however it got started ----
echo Waiting for %URL% to respond...
set /a TRIES=0

:wait
set /a TRIES+=1
powershell -NoProfile -Command "try{$r=Invoke-WebRequest '%URL%' -UseBasicParsing -TimeoutSec 3; if($r.StatusCode -eq 200){exit 0}; exit 1}catch{exit 1}" >nul 2>&1
if not errorlevel 1 goto ready
if %TRIES% GEQ 30 goto failed
REM `timeout /t` aborts with "Input redirection is not supported" whenever stdin
REM is redirected (scheduled tasks, piped runs). ping is the portable 2s sleep.
ping -n 3 127.0.0.1 >nul
goto wait

:ready
echo.
echo   [OK] Server is up and answering on %URL%
echo.

REM ---- Locate Chrome, then open it as a standalone app window ----
set "CHROME="
if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set "CHROME=%LocalAppData%\Google\Chrome\Application\chrome.exe"

if defined CHROME (
    if "%KIOSK%"=="1" (
        echo   Opening Chrome fullscreen ^(kiosk^) - press Alt+F4 to exit...
        start "" "%CHROME%" --kiosk --new-window "%URL%" --user-data-dir="%APPWIN%"
    ) else (
        echo   Opening Chrome as an app window...
        start "" "%CHROME%" --app="%URL%" --window-size=1600,900 --window-position=80,40 --user-data-dir="%APPWIN%"
    )
) else (
    echo   Chrome not found - opening your default browser instead.
    start "" "%URL%"
)

REM ---- Pop File Explorer with the .env preselected for editing ----
if exist "%DEPLOY%\.env" start "" explorer /select,"%DEPLOY%\.env"

echo.
echo   Ghost Edition is running.
echo     stop   :  %DEPLOY%\stop-ghost.ps1
echo     status :  %DEPLOY%\status-ghost.ps1
echo     logs   :  %DEPLOY%\logs
echo.
echo   Closing this window does NOT stop the server.
echo.
pause
exit /b 0

:failed
echo.
echo   [FAILED] No response from %URL% after 60 seconds.
echo   Check the newest log in: %DEPLOY%\logs
echo.
pause
exit /b 1
