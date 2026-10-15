@echo off
setlocal enabledelayedexpansion
title VistaBridge Stop Utility

color 0C
cls
echo ======================================================================
echo                     VISTABRIDGE STOP UTILITY                          
echo ======================================================================
echo.

cd /d "%~dp0"

REM Read configured port from SQLite database (default 3000)
set "APP_PORT=3000"
where node >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    if exist "data\geovista.db" (
        for /f "usebackq delims=" %%V in (`node -e "const { createClient } = require('@libsql/client'); async function get() { try { const c = createClient({ url: 'file:data/geovista.db' }); const r = await c.execute({ sql: 'SELECT value FROM app_settings WHERE key = ?', args: ['app_port'] }); console.log(r.rows.length ? r.rows[0].value : '3000'); } catch(e) { console.log('3000'); } } get();" 2^>nul`) do (
            set "APP_PORT=%%V"
        )
    )
)
if "!APP_PORT!"=="" set "APP_PORT=3000"

set "FOUND=0"

for /f "tokens=5" %%P in ('netstat -a -n -o ^| findstr :!APP_PORT! ^| findstr LISTENING') do (
    set "FOUND=1"
    echo [*] Terminating VistaBridge process with PID: %%P on port !APP_PORT!...
    taskkill /F /PID %%P >nul 2>&1
)

if "!FOUND!"=="1" (
    echo.
    echo ======================================================================
    echo [OK] VistaBridge application on port !APP_PORT! has been stopped successfully!
    echo ======================================================================
) else (
    echo [INFO] No active VistaBridge server found running on port !APP_PORT!.
)

echo.
pause
