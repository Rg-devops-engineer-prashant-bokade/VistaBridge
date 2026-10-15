@echo off
setlocal enabledelayedexpansion
title GeoVista Stop Utility

color 0C
cls
echo ======================================================================
echo                     GEOVISTA STOP UTILITY                             
echo ======================================================================
echo.

set "FOUND=0"

for /f "tokens=5" %%P in ('netstat -a -n -o ^| findstr :3000 ^| findstr LISTENING') do (
    set "FOUND=1"
    echo [*] Terminating GeoVista process with PID: %%P on port 3000...
    taskkill /F /PID %%P >nul 2>&1
)

if "!FOUND!"=="1" (
    echo.
    echo ======================================================================
    echo [OK] GeoVista application on port 3000 has been stopped successfully!
    echo ======================================================================
) else (
    echo [INFO] No active GeoVista server found running on port 3000.
)

echo.
pause
