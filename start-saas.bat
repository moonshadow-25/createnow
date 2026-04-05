@echo off
REM ========================================
REM CreateNow - SaaS Mode Launch Script
REM ========================================
REM 启动 SaaS 模式（DEPLOY_MODE=saas）
REM 依赖：myapi-redis 容器已运行（端口 6380）
REM ========================================

echo.
echo ========================================
echo   AI Short Video Generation Platform
echo   SaaS Mode
echo ========================================
echo.

REM Check if env exists
if not exist "env\python.exe" (
    echo [ERROR] Python environment not found at .\env\python.exe
    echo Please run install.bat first.
    pause
    exit /b 1
)

REM Check if frontend dist exists
if not exist "frontend\dist\index.html" (
    echo [WARNING] Frontend build not found. Running in API-only mode.
    echo Run: cd frontend ^&^& npm run build
    echo.
)

REM Check Redis
echo [CHECK] Checking Redis connection...
docker exec myapi-redis redis-cli -n 1 PING >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Redis not responding. Make sure myapi-redis container is running:
    echo   docker start myapi-redis
    echo.
    pause
    exit /b 1
)
echo [OK] Redis OK

echo [OK] Using Python: %CD%\env\python.exe
echo [OK] Deploy mode: saas
echo [OK] Redis: redis://localhost:6380/1
echo.
echo Starting server...
echo   - API:      https://localhost:8501/api
echo   - Frontend: https://localhost:8501
echo.
echo Press Ctrl+C to stop the server
echo.

REM Open browser after delay
start /min cmd /c "timeout /t 3 /nobreak >nul && start https://localhost:8501"

REM Start server with SAAS mode
cd /d "%CD%\backend"
set PYTHONPATH=%CD%
set SSL_CERT_FILE=%~dp0env\Lib\site-packages\certifi\cacert.pem
set DEPLOY_MODE=saas
set REDIS_URL=redis://localhost:6380/1
%CD%\..\env\python.exe app\main.py --serve-frontend
