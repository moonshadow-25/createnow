@echo off
REM ========================================
REM CreateNow - Build Release Package
REM ========================================
REM 将项目打包成发布 zip，供用户下载部署
REM 支持两种模式：
REM   1) Full Package: 含 env
REM   2) Dist Package: 不含 env（目标机已有 env）
REM ========================================

setlocal enabledelayedexpansion

set "SOURCE_DIR=%~dp0"
set "TEMP_DIR=%TEMP%\createnow-build-%RANDOM%"
set "OUTPUT_ZIP_FULL=%SOURCE_DIR%createnow-release.zip"
set "OUTPUT_ZIP_DIST=%SOURCE_DIR%createnow-release.zip"

echo.
echo ========================================
echo   CreateNow Release Builder
echo ========================================
echo.
echo Source : %SOURCE_DIR%
echo.

echo Select package mode:
echo   [1] Full Package ^(include env^)
echo   [2] Dist Package ^(exclude env^)
choice /C 12 /N /M "Choose mode (1/2): "
set "PACKAGE_MODE=full"
set "OUTPUT_ZIP=%OUTPUT_ZIP_FULL%"
if errorlevel 2 (
    set "PACKAGE_MODE=dist"
    set "OUTPUT_ZIP=%OUTPUT_ZIP_DIST%"
)

echo Output : %OUTPUT_ZIP%
echo.

if /I "%PACKAGE_MODE%"=="full" (
    if not exist "%SOURCE_DIR%env\" (
        echo [ERROR] Python environment not found: %SOURCE_DIR%env\
        pause
        exit /b 1
    )
)

REM ── 自增版本号 ────────────────────────────────────────────
echo Updating version.json...
powershell -NoProfile -Command "$f = '%SOURCE_DIR%version.json'; $v = (Get-Content $f -Raw -Encoding UTF8 | ConvertFrom-Json); $today = Get-Date -Format 'yyyy.M.d'; $parts = $v.version -split '\.'; if ($parts.Length -eq 4 -and ($parts[0]+'.'+$parts[1]+'.'+$parts[2]) -eq $today) { $n = [int]$parts[3] + 1 } else { $n = 1 }; $v.version = $today + '.' + $n; $v.release_date = Get-Date -Format 'yyyy-MM-dd'; $json = $v | ConvertTo-Json; [System.IO.File]::WriteAllText($f, $json, [System.Text.UTF8Encoding]::new($false)); Write-Host ('  Version: ' + $v.version)"

REM ── 构建前端（必须在版本号更新后执行）────────────────────
echo Building frontend...
pushd "%SOURCE_DIR%frontend"
call npm run build
if errorlevel 1 (
    echo [ERROR] Frontend build failed!
    popd
    pause
    exit /b 1
)
popd

REM ── 检查前端构建产物 ─────────────────────────────────────
if not exist "%SOURCE_DIR%frontend\dist\index.html" (
    echo [ERROR] Frontend build output not found!
    pause
    exit /b 1
)

REM ── Step 1: 创建临时暂存目录 ──────────────────────────────
echo [1/5] Creating staging directory...
if exist "%TEMP_DIR%" rmdir /s /q "%TEMP_DIR%"
mkdir "%TEMP_DIR%"
mkdir "%TEMP_DIR%\backend"
mkdir "%TEMP_DIR%\frontend"

REM ── Step 2: 复制后端代码 ──────────────────────────────────
echo [2/5] Copying backend code...
xcopy /E /I /Y /Q "%SOURCE_DIR%backend\app" "%TEMP_DIR%\backend\app" >nul
xcopy /E /I /Y /Q "%SOURCE_DIR%backend\config" "%TEMP_DIR%\backend\config" >nul
copy /Y "%SOURCE_DIR%backend\requirements.txt" "%TEMP_DIR%\backend\" >nul

if /I "%PACKAGE_MODE%"=="full" (
    if exist "%SOURCE_DIR%backend\bin" xcopy /E /I /Y /Q "%SOURCE_DIR%backend\bin" "%TEMP_DIR%\backend\bin" >nul
    xcopy /E /I /Y /Q "%SOURCE_DIR%env" "%TEMP_DIR%\env" >nul
)

REM ── Step 3: 复制前端、文档、脚本 ──────────────────────────
echo [3/5] Copying frontend build and docs...
xcopy /E /I /Y /Q "%SOURCE_DIR%frontend\dist" "%TEMP_DIR%\frontend\dist" >nul
if exist "%SOURCE_DIR%LICENSE" copy /Y "%SOURCE_DIR%LICENSE" "%TEMP_DIR%\" >nul
if exist "%SOURCE_DIR%README.md" copy /Y "%SOURCE_DIR%README.md" "%TEMP_DIR%\" >nul
if exist "%SOURCE_DIR%update.bat" copy /Y "%SOURCE_DIR%update.bat" "%TEMP_DIR%\" >nul
if exist "%SOURCE_DIR%version.json" copy /Y "%SOURCE_DIR%version.json" "%TEMP_DIR%\" >nul
if exist "%SOURCE_DIR%start-saas.bat" copy /Y "%SOURCE_DIR%start-saas.bat" "%TEMP_DIR%\" >nul
if exist "%SOURCE_DIR%start-server-saas.bat" copy /Y "%SOURCE_DIR%start-server-saas.bat" "%TEMP_DIR%\" >nul

REM ── Step 4: 生成部署辅助文件 ──────────────────────────────
echo [4/5] Generating deployment scripts...

REM install.bat
if /I "%PACKAGE_MODE%"=="full" (
    (
    echo @echo off
    echo REM ========================================
    echo REM CreateNow - Install
    echo REM ========================================
    echo.
    echo echo [OK] Python environment: ready ^(included in package^)
    echo echo [OK] Backend code: ready
    echo echo [OK] Frontend build: ready
    echo echo.
    echo echo Next steps:
    echo echo   1. Copy backend\.env.example to backend\.env
    echo echo   2. Edit backend\.env and fill in your API keys
    echo echo   3. Run start.bat to launch the server
    echo echo.
    echo pause
    ) > "%TEMP_DIR%\install.bat"
) else (
    (
    echo @echo off
    echo REM ========================================
    echo REM CreateNow Dist - Install
    echo REM ========================================
    echo.
    echo if not exist env mkdir env
    echo python -m venv env
    echo if errorlevel 1 ^(
    echo   echo [ERROR] Failed to create venv. Ensure python is installed.
    echo   pause
    echo   exit /b 1
    echo ^)
    echo call env\Scripts\activate.bat
    echo python -m pip install --upgrade pip
    echo pip install -r backend\requirements.txt
    echo echo.
    echo echo [OK] Dist dependencies installed.
    echo echo Run start.bat to launch the server.
    echo pause
    ) > "%TEMP_DIR%\install.bat"
)

REM .env.example
(
echo # CreateNow Configuration
echo API_HOST=0.0.0.0
echo API_PORT=8001
echo CORS_ORIGINS=http://localhost:5173,http://localhost:3000
echo.
echo # LLM ^(OpenAI-compatible^)
echo DEFAULT_LLM_API_URL=https://api.openai.com/v1
echo DEFAULT_LLM_API_KEY=your-api-key-here
echo DEFAULT_LLM_MODEL=gpt-4
echo.
echo # Text-to-Image ^(OpenAI-compatible^)
echo DEFAULT_IMAGE_API_URL=https://api.openai.com/v1
echo DEFAULT_IMAGE_API_KEY=your-api-key-here
echo DEFAULT_IMAGE_MODEL=dall-e-3
echo.
echo # Image-to-Video ^(OpenAI-compatible^)
echo DEFAULT_VIDEO_API_URL=https://api.openai.com/v1
echo DEFAULT_VIDEO_API_KEY=your-api-key-here
echo DEFAULT_VIDEO_MODEL=sora
) > "%TEMP_DIR%\backend\.env.example"

REM ── Step 5: 打包 ──────────────────────────────────────────
echo [5/5] Creating zip package with tar...
if exist "%OUTPUT_ZIP%" del "%OUTPUT_ZIP%"

tar -a -c -f "%OUTPUT_ZIP%" -C "%TEMP_DIR%" .

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] tar failed.
    rmdir /s /q "%TEMP_DIR%"
    pause
    exit /b 1
)

REM ── 清理暂存目录 ──────────────────────────────────────────
rmdir /s /q "%TEMP_DIR%"

REM ── 显示结果 ──────────────────────────────────────────────
echo.
echo ========================================
echo   Build Complete!
echo ========================================
echo.
echo Package : %OUTPUT_ZIP%
echo Mode    : %PACKAGE_MODE%
for %%A in ("%OUTPUT_ZIP%") do (
    set /a SIZE_MB=%%~zA / 1048576
    echo Size    : %%~zA bytes ^(!SIZE_MB! MB^)
)
echo.

REM ── 上传到服务器 ──────────────────────────────────────────
echo ========================================
echo   Uploading to release server...
echo ========================================
echo.

set "SSH_KEY=%~dp047.116.221.35_id_ed25519"
set "REMOTE=root@47.116.221.35:/www/wwwroot/linglonghome/minipc-website/download/createnow/"

echo [1/2] Uploading package...
scp -i "%SSH_KEY%" -o StrictHostKeyChecking=no "%OUTPUT_ZIP%" "%REMOTE%"
if %errorlevel% neq 0 (
    echo [ERROR] Failed to upload package
    pause
    exit /b 1
)
echo   Done.

echo [2/2] Uploading version.json...
scp -i "%SSH_KEY%" -o StrictHostKeyChecking=no "%~dp0version.json" "%REMOTE%"
if %errorlevel% neq 0 (
    echo [ERROR] Failed to upload version.json
    pause
    exit /b 1
)
echo   Done.

echo.
echo ========================================
echo   Upload Complete!
echo ========================================
echo.
pause
