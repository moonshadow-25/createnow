@echo off
REM ========================================
REM CreateNow - Setup
REM ========================================

setlocal enabledelayedexpansion

set "DEFAULT_UPDATE_URL=https://www.firstarpc.com/download/createnow/createnow-release.zip"
set "INSTALL_DIR=%~dp0createnow"
set "TEMP_ZIP=%TEMP%\createnow-update-%RANDOM%.zip"

echo.
echo ========================================
echo   CreateNow - Setup
echo ========================================
echo.
echo Install dir : %INSTALL_DIR%
echo.

REM ── Step 1: Download ──────────────────────────────────────────
echo [1/4] Downloading package...
powershell -NoProfile -Command "Invoke-WebRequest -Uri '%DEFAULT_UPDATE_URL%' -OutFile '%TEMP_ZIP%' -UseBasicParsing"

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Download failed.
    timeout /t 10 /nobreak >nul
    exit /b 1
)
echo   Download complete.
echo.

REM ── Step 2: Extract ───────────────────────────────────────────
echo [2/4] Extracting files...
if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"
tar -x -f "%TEMP_ZIP%" -C "%INSTALL_DIR%"

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Extraction failed.
    del "%TEMP_ZIP%" 2>nul
    timeout /t 10 /nobreak >nul
    exit /b 1
)
echo   Extraction complete.
echo.

REM ── Step 3: Cleanup ───────────────────────────────────────────
echo [3/4] Cleaning up...
del "%TEMP_ZIP%" 2>nul
echo   Done.
echo.

echo ========================================
echo   Setup Complete!
echo ========================================
echo.
echo Location: %INSTALL_DIR%
echo.
echo Before starting:
echo   1. Edit backend\.env and fill in your API keys
echo   2. Run start.bat to launch
echo.
pause
