@echo off
REM ========================================
REM CreateNow - Build Release Package
REM ========================================
REM 将项目打包成发布 zip，供用户下载部署
REM 包含：后端代码、前端编译产物、Python 环境(env/)、配置文件
REM 不含：用户数据(data/)、密钥(.env)
REM ========================================

setlocal enabledelayedexpansion

set "SOURCE_DIR=%~dp0"
set "OUTPUT_ZIP=%SOURCE_DIR%createnow-release.zip"
set "TEMP_DIR=%TEMP%\createnow-build-%RANDOM%"

echo.
echo ========================================
echo   CreateNow Release Builder
echo ========================================
echo.
echo Source : %SOURCE_DIR%
echo Output : %OUTPUT_ZIP%
echo.

REM ── 检查前端是否已编译 ─────────────────────────────────────
if not exist "%SOURCE_DIR%frontend\dist\index.html" (
    echo [ERROR] Frontend build not found!
    echo Please run: cd frontend ^&^& npm run build
    echo.
    pause
    exit /b 1
)

REM ── 自增版本号 ────────────────────────────────────────────
echo Updating version.json...
powershell -NoProfile -Command "$f = '%SOURCE_DIR%version.json'; $v = (Get-Content $f -Raw -Encoding UTF8 | ConvertFrom-Json); $today = Get-Date -Format 'yyyy.M.d'; $parts = $v.version -split '\.'; if ($parts.Length -eq 4 -and ($parts[0]+'.'+$parts[1]+'.'+$parts[2]) -eq $today) { $n = [int]$parts[3] + 1 } else { $n = 1 }; $v.version = $today + '.' + $n; $v.release_date = Get-Date -Format 'yyyy-MM-dd'; $json = $v | ConvertTo-Json; [System.IO.File]::WriteAllText($f, $json, [System.Text.UTF8Encoding]::new($false)); Write-Host ('  Version: ' + $v.version)"

REM ── Step 1: 创建临时暂存目录 ──────────────────────────────
echo [1/5] Creating staging directory...
if exist "%TEMP_DIR%" rmdir /s /q "%TEMP_DIR%"
mkdir "%TEMP_DIR%"
mkdir "%TEMP_DIR%\backend"
mkdir "%TEMP_DIR%\frontend"

if not exist "%SOURCE_DIR%env\" (
    echo [ERROR] Python environment not found: %SOURCE_DIR%env\
    pause
    exit /b 1
)

REM ── Step 2: 复制后端代码 ──────────────────────────────────
echo [2/5] Copying backend code...
xcopy /E /I /Y /Q "%SOURCE_DIR%backend\app" "%TEMP_DIR%\backend\app" >nul
xcopy /E /I /Y /Q "%SOURCE_DIR%backend\config" "%TEMP_DIR%\backend\config" >nul
copy /Y "%SOURCE_DIR%backend\requirements.txt" "%TEMP_DIR%\backend\" >nul
xcopy /E /I /Y /Q "%SOURCE_DIR%env" "%TEMP_DIR%\env" >nul

REM ── Step 3: 复制前端、文档、update.bat ───────────────────
echo [3/5] Copying frontend build and docs...
xcopy /E /I /Y /Q "%SOURCE_DIR%frontend\dist" "%TEMP_DIR%\frontend\dist" >nul
if exist "%SOURCE_DIR%LICENSE"    copy /Y "%SOURCE_DIR%LICENSE"    "%TEMP_DIR%\" >nul
if exist "%SOURCE_DIR%README.md"  copy /Y "%SOURCE_DIR%README.md"  "%TEMP_DIR%\" >nul
if exist "%SOURCE_DIR%update.bat" copy /Y "%SOURCE_DIR%update.bat" "%TEMP_DIR%\" >nul
if exist "%SOURCE_DIR%version.json" copy /Y "%SOURCE_DIR%version.json" "%TEMP_DIR%\" >nul

REM ── Step 4: 生成部署辅助文件 ──────────────────────────────
echo [4/5] Generating deployment scripts...

REM start.bat - 直接复制根目录的 start.bat
if not exist "%SOURCE_DIR%start.bat" (
    echo [ERROR] start.bat not found in project root!
    pause
    exit /b 1
)
copy /Y "%SOURCE_DIR%start.bat" "%TEMP_DIR%\" >nul

REM install.bat
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

REM ── Step 5: 用 tar 打包（全部从暂存目录）────────────────
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
for %%A in ("%OUTPUT_ZIP%") do (
    set /a SIZE_MB=%%~zA / 1048576
    echo Size    : %%~zA bytes ^(!SIZE_MB! MB^)
)
echo.
echo Contents:
echo   backend/app/        - Python source code
echo   backend/config/     - Default prompt templates
echo   backend/requirements.txt
echo   env/                - Python virtual environment
echo   frontend/dist/      - Compiled frontend
echo   install.bat         - First-time setup
echo   start.bat           - Launch server ^(auto-opens browser^)
echo   update.bat          - Self-update script
echo   .env.example        - Config template
echo.
echo Upload %OUTPUT_ZIP% to your release server,
echo then update the URL in update.bat.
echo.
pause
