@echo off
REM ========================================
REM CreateNow - Self Update Script
REM ========================================

setlocal enabledelayedexpansion

REM ── 从 version.json 读取下载地址 ──────────────────────────
for /f "delims=" %%A in ('powershell -NoProfile -Command "(Get-Content '%~dp0version.json' | ConvertFrom-Json).update_url"') do set "UPDATE_URL=%%A"
if "%UPDATE_URL%"=="" (
    echo [ERROR] version.json 中未找到 update_url 字段
    timeout /t 10 /nobreak >nul
    exit /b 1
)

REM %~dp0 末尾带反斜杠，tar -C 需要去掉，否则 \" 会破坏引号
set "INSTALL_DIR=%~dp0"
set "INSTALL_DIR=%INSTALL_DIR:~0,-1%"
set "TEMP_ZIP=%TEMP%\createnow-update-%RANDOM%.zip"

echo.
echo ========================================
echo   CreateNow Self-Update
echo ========================================
echo.
echo Update URL  : %UPDATE_URL%
echo Install dir : %INSTALL_DIR%
echo.

REM ── Step 1: Download（主进程在此期间已自杀，文件锁已释放）──
echo [1/3] Downloading update package...
powershell -NoProfile -Command "Invoke-WebRequest -Uri '%UPDATE_URL%' -OutFile '%TEMP_ZIP%' -UseBasicParsing"

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Download failed.
    timeout /t 10 /nobreak >nul
    exit /b 1
)
echo   Download complete.
echo.

REM ── Step 2: Extract ───────────────────────────────────────
echo [2/3] Extracting files...
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

REM ── Step 3: Cleanup & Restart ─────────────────────────────
echo [3/3] Cleaning up and restarting...
del "%TEMP_ZIP%" 2>nul

echo.
echo ========================================
echo   Update Complete! Starting service...
echo ========================================
echo.

start "" "%INSTALL_DIR%\start.bat"
