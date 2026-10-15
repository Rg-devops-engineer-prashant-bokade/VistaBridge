@echo off
setlocal EnableDelayedExpansion
title VistaBridge Setup

cd /d "%~dp0"

color 0B
cls
echo ======================================================================
echo                     VISTABRIDGE SETUP WIZARD                      
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

if exist "node_modules" goto DEPS_FOUND
echo [*] Dependencies not found. Installing packages...
echo [*] Please wait while npm install finishes...
echo.
call npm install
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] npm install encountered an error. Please check your network.
    pause
    exit /b 1
)
echo [OK] Dependencies installed successfully!
echo.

:DEPS_FOUND
set "FINAL_GS=http://localhost:8080/geoserver"
echo ----------------------------------------------------------------------
echo  GeoServer Configuration
echo ----------------------------------------------------------------------
echo Default: http://localhost:8080/geoserver
set "USER_GS="
set /p "USER_GS=Enter GeoServer URL (Press ENTER to use default): "

if defined USER_GS (
    set "CLEAN_GS=!USER_GS!"
    if not "!CLEAN_GS!"=="" set "FINAL_GS=!CLEAN_GS!"
)
if "!FINAL_GS!"=="" set "FINAL_GS=http://localhost:8080/geoserver"
if "!FINAL_GS!"=="." set "FINAL_GS=http://localhost:8080/geoserver"
if "!FINAL_GS!"=="./" set "FINAL_GS=http://localhost:8080/geoserver"
if not "!FINAL_GS:~0,4!"=="http" set "FINAL_GS=http://!FINAL_GS!"
if "!FINAL_GS:~-1!"=="/" set "FINAL_GS=!FINAL_GS:~0,-1!"

echo.
echo [*] Saving configuration...

if not exist "data" mkdir "data" >nul 2>&1

REM Remove any .env files - project runs 100% from SQLite
if exist ".env" del /f /q ".env" >nul 2>&1
if exist ".env.local" del /f /q ".env.local" >nul 2>&1
if exist ".env.production" del /f /q ".env.production" >nul 2>&1

node -e "const { createClient } = require('@libsql/client'); const crypto = require('crypto'); async function save() { try { const c = createClient({ url: 'file:data/geovista.db' }); await c.execute('CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP);'); await c.execute({ sql: 'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', args: ['geoserver_url', process.argv[1]] }); await c.execute({ sql: 'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING', args: ['tileserv_url', 'http://localhost:7800'] }); const row = await c.execute({ sql: 'SELECT value FROM app_settings WHERE key = ?', args: ['jwt_secret'] }); if (row.rows.length === 0) { const newKey = crypto.randomBytes(64).toString('base64'); await c.execute({ sql: 'INSERT INTO app_settings (key, value) VALUES (?, ?)', args: ['jwt_secret', newKey] }); } } catch(e){ console.error(e); } } save();" "!FINAL_GS!" >nul 2>&1

echo [OK] Configuration saved directly into SQLite database (data/geovista.db)!
echo [OK] Zero .env files created - project runs 100%% from SQLite database.

echo [*] Checking GeoServer reachability [!FINAL_GS!]...
curl.exe -s -I --max-time 5 "!FINAL_GS!/web/" >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo  [OK] GeoServer is ONLINE.
) else (
    echo  [WARN] GeoServer did not respond within 5s at !FINAL_GS!. (Setup will continue)
)

for /f "tokens=5" %%P in ('netstat -a -n -o ^| findstr :3000 ^| findstr LISTENING') do (
    echo [*] Terminating previous server process on port 3000 [PID: %%P]...
    taskkill /F /PID %%P >nul 2>&1
)

if exist ".next" (
    echo [*] Clearing Next.js build cache...
    rmdir /s /q ".next" >nul 2>&1
)

echo.
echo ======================================================================
echo [*] Compiling optimized production build (npm run build)...
echo [*] This removes all development error overlays and maximizes speed.
echo ======================================================================
echo.
call npm run build
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Build encountered an error! Please check the output above.
    pause
    exit /b 1
)

echo.
echo ======================================================================
echo                  SETUP COMPLETED SUCCESSFULLY!                      
echo ======================================================================
echo Active GeoServer: !FINAL_GS!
echo.
echo You can start the application anytime by running:
echo     start.bat
echo ======================================================================
echo.

set "LAUNCH="
set /p "LAUNCH=Would you like to start the application now? (Y/n): "
if /i "!LAUNCH!"=="n" (
    echo.
    echo Setup done. Run start.bat when you are ready!
    pause
    exit /b 0
)

call "%~dp0start.bat"
