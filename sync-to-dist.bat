@echo off
REM ========================================
REM CreateNow - Sync to Distribution
REM ========================================
REM 将编译完成的代码同步到发行版目录
REM 支持两种模式：
REM   1) Full Sync: 含 env
REM   2) Dist Incremental Sync: 不含 env（目标机已有 env）
REM ========================================

setlocal enabledelayedexpansion

set "DIST_DIR=C:\createnow_dist"
set "SOURCE_DIR=%~dp0"
pushd "%SOURCE_DIR%" >nul

echo.
echo ========================================
echo   CreateNow Distribution Sync
echo ========================================
echo.
echo Source: %SOURCE_DIR%
echo Target: %DIST_DIR%
echo.

REM 检查前端是否已编译
if not exist "frontend\dist\index.html" (
    echo [ERROR] Frontend build not found!
    echo Please run: cd frontend ^&^& npm run build
    echo.
    pause
    exit /b 1
)

echo Select sync mode:
echo   [1] Full Sync ^(include env^)
echo   [2] Dist Incremental Sync ^(exclude env^)
choice /C 12 /N /M "Choose mode (1/2): "
set "SYNC_MODE=full"
if errorlevel 2 set "SYNC_MODE=dist"

echo.
echo [1/5] Creating distribution directory structure...
if not exist "%DIST_DIR%" mkdir "%DIST_DIR%"
if not exist "%DIST_DIR%\backend" mkdir "%DIST_DIR%\backend"
if not exist "%DIST_DIR%\backend\app" mkdir "%DIST_DIR%\backend\app"
if not exist "%DIST_DIR%\backend\config" mkdir "%DIST_DIR%\backend\config"
if not exist "%DIST_DIR%\frontend" mkdir "%DIST_DIR%\frontend"
if /I "%SYNC_MODE%"=="full" (
    if not exist "%DIST_DIR%\data" mkdir "%DIST_DIR%\data"
    if not exist "%DIST_DIR%\data\projects" mkdir "%DIST_DIR%\data\projects"
)

echo [2/5] Syncing backend code...
xcopy /E /I /Y /Q "backend\app" "%DIST_DIR%\backend\app" >nul
xcopy /E /I /Y /Q "backend\config" "%DIST_DIR%\backend\config" >nul
copy /Y "backend\requirements.txt" "%DIST_DIR%\backend\" >nul

REM 同步 .env 配置文件（如果存在）
if exist "backend\.env" (
    echo     Syncing backend/.env configuration...
    copy /Y "backend\.env" "%DIST_DIR%\backend\" >nul
)

echo [3/5] Syncing frontend build...
xcopy /E /I /Y /Q "frontend\dist" "%DIST_DIR%\frontend\dist" >nul

if /I "%SYNC_MODE%"=="full" (
    echo [4/5] Syncing Python virtual environment...
    echo     This may take a while...
    xcopy /E /I /Y /Q "env" "%DIST_DIR%\env" >nul
) else (
    echo [4/5] Dist mode selected: skipping env sync.
)

echo [5/5] Syncing scripts and docs...
if exist "LICENSE" copy /Y "LICENSE" "%DIST_DIR%\" >nul
if exist "README.md" copy /Y "README.md" "%DIST_DIR%\" >nul
if exist "start.bat" copy /Y "start.bat" "%DIST_DIR%\" >nul
if exist "start-saas.bat" copy /Y "start-saas.bat" "%DIST_DIR%\" >nul
if exist "start-server-saas.bat" copy /Y "start-server-saas.bat" "%DIST_DIR%\" >nul
if exist "version.json" copy /Y "version.json" "%DIST_DIR%\" >nul

echo.
echo ========================================
echo   Sync Complete!
echo ========================================
echo.
echo Distribution location: %DIST_DIR%
echo Sync mode: %SYNC_MODE%
echo.
echo Synced:
echo   - backend/app/
echo   - backend/config/
echo   - backend/requirements.txt
echo   - backend/.env ^(if exists^)
echo   - frontend/dist/
echo   - start*.bat ^(if exists^)
echo   - LICENSE/README/version.json ^(if exists^)
if /I "%SYNC_MODE%"=="full" (
    echo   - env/
)
echo.
echo Ready.
echo.
popd >nul
pause
