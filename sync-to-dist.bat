@echo off
REM ========================================
REM CreateNow - Sync to Distribution
REM ========================================
REM 将编译完成的代码同步到发行版目录
REM 发行版端口: 8001
REM ========================================

setlocal enabledelayedexpansion

set "DIST_DIR=C:\Users\xh\wk\createnow_dist"
set "SOURCE_DIR=%CD%"

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

echo [1/9] Creating distribution directory structure...
if not exist "%DIST_DIR%" mkdir "%DIST_DIR%"
if not exist "%DIST_DIR%\backend" mkdir "%DIST_DIR%\backend"
if not exist "%DIST_DIR%\backend\app" mkdir "%DIST_DIR%\backend\app"
if not exist "%DIST_DIR%\backend\config" mkdir "%DIST_DIR%\backend\config"
if not exist "%DIST_DIR%\frontend" mkdir "%DIST_DIR%\frontend"
if not exist "%DIST_DIR%\data" mkdir "%DIST_DIR%\data"
if not exist "%DIST_DIR%\data\projects" mkdir "%DIST_DIR%\data\projects"

echo [2/9] Syncing backend code...
xcopy /E /I /Y /Q "backend\app" "%DIST_DIR%\backend\app" >nul
xcopy /E /I /Y /Q "backend\config" "%DIST_DIR%\backend\config" >nul
copy /Y "backend\requirements.txt" "%DIST_DIR%\backend\" >nul

REM 同步 .env 配置文件（如果存在）
if exist "backend\.env" (
    echo     Syncing backend/.env configuration...
    copy /Y "backend\.env" "%DIST_DIR%\backend\" >nul
)

echo [3/9] Syncing Python virtual environment...
echo     This may take a while...
xcopy /E /I /Y /Q "env" "%DIST_DIR%\env" >nul

echo [4/9] Syncing frontend build...
xcopy /E /I /Y /Q "frontend\dist" "%DIST_DIR%\frontend\dist" >nul

echo [5/9] Syncing documentation...
copy /Y "LICENSE" "%DIST_DIR%\" >nul
copy /Y "README.md" "%DIST_DIR%\" >nul

echo [6/9] Creating distribution config files...

REM 创建 .env.example (端口 8001)
(
echo # API配置 - 发行版端口
echo API_HOST=0.0.0.0
echo API_PORT=8001
echo CORS_ORIGINS=http://localhost:5173,http://localhost:3000
echo.
echo # LLM配置 ^(OpenAI兼容^)
echo DEFAULT_LLM_API_URL=https://api.openai.com/v1
echo DEFAULT_LLM_API_KEY=your-api-key-here
echo DEFAULT_LLM_MODEL=gpt-4
echo.
echo # 文生图配置 ^(OpenAI兼容^)
echo DEFAULT_IMAGE_API_URL=https://api.openai.com/v1
echo DEFAULT_IMAGE_API_KEY=your-api-key-here
echo DEFAULT_IMAGE_MODEL=dall-e-3
echo.
echo # 图生视频配置 ^(OpenAI兼容^)
echo DEFAULT_VIDEO_API_URL=https://api.openai.com/v1
echo DEFAULT_VIDEO_API_KEY=your-api-key-here
echo DEFAULT_VIDEO_MODEL=sora
) > "%DIST_DIR%\backend\.env.example"

REM 创建 .gitignore
(
echo # 发行版 .gitignore
echo env/
echo backend/.env
echo data/
echo *.log
echo __pycache__/
echo *.pyc
) > "%DIST_DIR%\.gitignore"

echo [7/9] Creating distribution install script...

REM 创建简化的 install.bat（已配置好）
(
echo @echo off
echo REM ========================================
echo REM CreateNow Distribution - Ready to Use
echo REM ========================================
echo.
echo echo.
echo echo ========================================
echo echo   CreateNow Distribution
echo echo   Port: 8001
echo echo ========================================
echo echo.
echo.
echo echo [OK] Python environment: ready
echo echo [OK] Backend configuration: ready
echo echo [OK] Frontend build: ready
echo echo.
echo echo All set! Run start.bat to launch the server.
echo echo.
echo pause
) > "%DIST_DIR%\install.bat"

echo [8/9] Creating distribution start script...

REM 创建 start.bat (固定端口 8001，无需检查 .env)
(
echo @echo off
echo REM ========================================
echo REM CreateNow Distribution - Start
echo REM Port: 8001
echo REM ========================================
echo.
echo echo.
echo echo ========================================
echo echo   AI Short Video Generation Platform
echo echo   Distribution ^(Port 8001^)
echo echo ========================================
echo echo.
echo.
echo echo [OK] Starting server...
echo echo   - API: http://localhost:8001/api
echo echo   - Frontend: http://localhost:8001
echo echo.
echo echo Press Ctrl+C to stop
echo echo.
echo.
echo REM Set port via environment variable
echo set API_PORT=8001
echo.
echo REM Start server
echo cd /d "%%CD%%\backend"
echo set PYTHONPATH=%%CD%%
echo %%CD%%\..\env\python.exe app\main.py --serve-frontend
) > "%DIST_DIR%\start.bat"

echo [9/9] Creating README for distribution...

REM 创建发行版 README
(
echo # CreateNow - AI短片生成软件 ^(发行版^)
echo.
echo **内部使用版本 - 端口 8001**
echo.
echo ## 快速开始
echo.
echo ### 直接启动
echo ```batch
echo start.bat
echo ```
echo.
echo 访问: http://localhost:8001
echo.
echo ## 说明
echo.
echo - 本版本为**内部发行版**，端口固定为 **8001**
echo - Python 虚拟环境已同步，无需安装
echo - API 配置已在项目中设置
echo - 数据保存在独立的 `data/` 目录下
echo.
echo ## 项目结构
echo.
echo ```
echo createnow_dist/
echo ├── backend/
echo │   ├── app/              # 后端代码
echo │   ├── .env              # API 配置 ^(已同步^)
echo │   └── requirements.txt
echo ├── frontend/
echo │   └── dist/             # 前端编译产物
echo ├── data/                 # 数据目录 ^(独立^)
echo ├── env/                  # Python 虚拟环境 ^(已同步^)
echo └── start.bat             # 启动脚本 ^(端口 8001^)
echo ```
echo.
echo ## 更新发行版
echo.
echo 在开发版目录运行:
echo ```batch
echo sync-to-dist.bat
echo ```
echo.
echo ## 许可证
echo.
echo 详见 [LICENSE](LICENSE) 文件。
) > "%DIST_DIR%\README_DIST.md"

echo.
echo ========================================
echo   Sync Complete!
echo ========================================
echo.
echo Distribution location: %DIST_DIR%
echo.
echo Files synced:
echo   - Backend code: backend/app/
echo   - Backend config: backend/config/ ^(prompt templates^)
echo   - Backend env: backend/.env ^(if exists^)
echo   - Frontend build: frontend/dist/
echo   - Python environment: env/ ^(ready to use^)
echo   - Requirements: backend/requirements.txt
echo   - Documentation: LICENSE, README.md
echo.
echo Created:
echo   - install.bat ^(info only^)
echo   - start.bat ^(Port 8001^)
echo   - backend/.env.example ^(Port 8001^)
echo   - data/ directory structure
echo   - README_DIST.md
echo.
echo Ready to use! Just run:
echo   cd %DIST_DIR%
echo   start.bat
echo.
pause
