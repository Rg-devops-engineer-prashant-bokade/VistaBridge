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
goto LAUNCH_SERVER

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

:LAUNCH_SERVER
REM Clear any previous process listening on port 3000
for /f "tokens=5" %%P in ('netstat -a -n -o ^| findstr :3000 ^| findstr LISTENING') do (
    echo [*] Clearing previous process on port 3000 [PID: %%P]...
    taskkill /F /PID %%P >nul 2>&1
)

echo ======================================================================
echo Application Ready:
echo   Local Web URL: http://localhost:3000
echo.
echo [*] Running in production mode [clean errors, high speed]
echo [*] To connect to a different GeoServer, run setup.bat
echo ======================================================================
echo.
echo Starting server and launching browser...
echo.

start "" cmd /c "ping -n 3 127.0.0.1 >nul & start http://localhost:3000"

call npm start
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Server exited with code: %ERRORLEVEL%
    pause
)
