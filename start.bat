@echo off
setlocal EnableDelayedExpansion
title VistaBridge Launcher

cd /d "%~dp0"

color 0B
cls
echo ======================================================================
echo                  VISTABRIDGE APPLICATION LAUNCHER                      
echo ======================================================================
echo.

where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Node.js is not found in your system PATH!
    echo Please install Node.js v18 or higher from https://nodejs.org
    echo.
    pause
    exit /b 1
)

if not exist "data\geovista.db" goto NEED_SETUP
if not exist "node_modules" goto NEED_SETUP
if not exist ".next" goto NEED_BUILD
goto READ_PORT

:NEED_SETUP
echo [!] Configuration or dependencies missing.
echo [*] Launching setup wizard first...
echo.
call "%~dp0setup.bat"
exit /b 0

:NEED_BUILD
echo [*] Production build not found. Running build now...
call npm run build
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Production build failed.
    pause
    exit /b 1
)

:READ_PORT
REM Read port from SQLite database (default 3000 if not set)
set "APP_PORT=3000"
for /f "usebackq delims=" %%V in (`node -e "const { createClient } = require('@libsql/client'); async function get() { try { const c = createClient({ url: 'file:data/geovista.db' }); const r = await c.execute({ sql: 'SELECT value FROM app_settings WHERE key = ?', args: ['app_port'] }); console.log(r.rows.length ? r.rows[0].value : '3000'); } catch(e) { console.log('3000'); } } get();" 2^>nul`) do (
    set "APP_PORT=%%V"
)
if "!APP_PORT!"=="" set "APP_PORT=3000"

REM Check if port is already busy (by something else)
set "PORT_BUSY=0"
for /f "tokens=5" %%P in ('netstat -a -n -o ^| findstr :!APP_PORT! ^| findstr LISTENING 2^>nul') do (
    set "PORT_BUSY=1"
    set "BUSY_PID=%%P"
)

if "!PORT_BUSY!"=="1" (
    echo [WARN] Port !APP_PORT! is currently in use ^(PID: !BUSY_PID!^).
    echo.
    echo   [1] Kill the process and use port !APP_PORT!
    echo   [2] Enter a different port for this session
    echo.
    set "PORT_CHOICE="
    set /p "PORT_CHOICE=Your choice (1 or 2): "
    if "!PORT_CHOICE!"=="1" (
        echo [*] Terminating process on port !APP_PORT! [PID: !BUSY_PID!]...
        taskkill /F /PID !BUSY_PID! >nul 2>&1
        echo [OK] Port !APP_PORT! is now free.
    ) else (
        set "NEW_PORT="
        set /p "NEW_PORT=Enter port number: "
        if defined NEW_PORT set "APP_PORT=!NEW_PORT!"
    )
)

:LAUNCH_SERVER
echo ======================================================================
echo Application Ready:
echo   Local Web URL: http://localhost:!APP_PORT!
echo.
echo [*] Running in production mode [clean errors, high speed]
echo [*] To connect to a different GeoServer, run setup.bat
echo ======================================================================
echo.
echo Starting server and launching browser...
echo.

start "" cmd /c "ping -n 3 127.0.0.1 >nul & start http://localhost:!APP_PORT!"

call npx next start -p !APP_PORT!
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Server exited with code: %ERRORLEVEL%
    pause
)
