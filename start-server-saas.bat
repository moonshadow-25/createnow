@echo off
chcp 65001 >nul
REM ========================================
REM CreateNow - SaaS Mode + SSH Tunnel
REM ========================================
REM 功能：后台启动 SaaS 服务(8501) + SSH隧道(18666)
REM 依赖：myapi-redis 容器已运行（端口 6380）
REM 访问：http://47.117.182.216:18666

setlocal enabledelayedexpansion

echo.
echo ========================================
echo   CreateNow SaaS Server Startup
echo ========================================
echo.

REM 配置区域
set SERVER_USER=root
set SERVER_IP=47.117.182.216
set SSH_PORT=22
set SSH_KEY=%~dp047.117.182.216_id_ed25519
set LOCAL_PORT=8501
set REMOTE_PORT=18666
set SCRIPT_DIR=%~dp0

echo [配置信息]
echo 本地服务端口: %LOCAL_PORT%
echo 部署模式: saas
echo 服务器地址: %SERVER_USER%@%SERVER_IP%:%SSH_PORT%
echo 公网访问: http://%SERVER_IP%:%REMOTE_PORT%
echo.

REM ========================================
REM 步骤1：检查环境
REM ========================================
echo [1/5] 检查环境...

if not exist "%SCRIPT_DIR%env\python.exe" (
    echo [ERROR] Python环境不存在！请先运行 install.bat
    pause & exit /b 1
)
echo   [OK] Python环境存在

where ssh >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] 未找到SSH客户端！请安装 OpenSSH 客户端
    pause & exit /b 1
)
echo   [OK] SSH客户端已安装

if not exist "%SSH_KEY%" (
    echo [ERROR] SSH密钥不存在: %SSH_KEY%
    pause & exit /b 1
)
echo   [OK] SSH密钥文件存在

REM ========================================
REM 步骤2：检查 Redis
REM ========================================
echo [2/5] 检查 Redis...
docker exec myapi-redis redis-cli -n 1 PING >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Redis not responding. Make sure myapi-redis container is running:
    echo   docker start myapi-redis
    echo.
    pause & exit /b 1
)
echo   [OK] Redis OK
echo.

REM ========================================
REM 步骤3：检查SSH连接
REM ========================================
echo [3/5] 检查SSH连接...
ssh -i "%SSH_KEY%" -p %SSH_PORT% -o ConnectTimeout=5 -o StrictHostKeyChecking=no %SERVER_USER%@%SERVER_IP% "echo ok" >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] SSH连接失败！请检查网络和服务器状态
    pause & exit /b 1
)
echo   [OK] SSH连接测试成功
echo.

REM ========================================
REM 步骤4：启动本地 SaaS 服务（独立窗口）
REM ========================================
echo [4/5] 启动本地 SaaS 服务...

netstat -ano | findstr ":%LOCAL_PORT%" | findstr "LISTENING" >nul 2>&1
if %errorlevel% equ 0 (
    echo   [SKIP] 端口 %LOCAL_PORT% 已有服务运行
    goto service_ready
)

REM 独立窗口启动 SaaS 模式
set SSL_CERT_FILE=%SCRIPT_DIR%env\Lib\site-packages\certifi\cacert.pem
start "CreateNow SaaS Server" cmd /k "cd /d "%SCRIPT_DIR%backend" && set PYTHONPATH=%SCRIPT_DIR%backend && set SSL_CERT_FILE=%SSL_CERT_FILE% && set DEPLOY_MODE=saas && set REDIS_URL=redis://localhost:6380/1 && "%SCRIPT_DIR%env\python.exe" app\main.py --serve-frontend"

echo   [OK] SaaS 服务启动中，日志显示在独立窗口
echo   等待服务就绪...

set /a count=0
:wait_service
timeout /t 1 /nobreak >nul
set /a count+=1
netstat -ano | findstr ":%LOCAL_PORT%" | findstr "LISTENING" >nul 2>&1
if %errorlevel% equ 0 goto service_ready
if !count! geq 15 (
    echo   [WARNING] 服务启动超时，继续尝试...
    goto service_ready
)
goto wait_service

:service_ready
echo   [OK] 本地 SaaS 服务已就绪
echo.

REM ========================================
REM 步骤5：建立SSH隧道（占用当前窗口）
REM ========================================
echo [5/5] 建立SSH隧道...
echo.
echo ========================================
echo   已就绪！
echo ========================================
echo.
echo 本地服务: https://localhost:%LOCAL_PORT%
echo 公网访问: http://%SERVER_IP%:%REMOTE_PORT%
echo 部署模式: saas (Redis: localhost:6380)
echo.
echo 按 Ctrl+C 关闭隧道
echo ========================================
echo.

:reconnect
ssh -4 -N -i "%SSH_KEY%" -p %SSH_PORT% -o ServerAliveInterval=60 -o ServerAliveCountMax=3 -o StrictHostKeyChecking=no -o ExitOnForwardFailure=yes -R %REMOTE_PORT%:127.0.0.1:%LOCAL_PORT% %SERVER_USER%@%SERVER_IP%

echo.
echo [WARNING] SSH隧道已断开
choice /C YN /M "是否重新连接隧道"
if errorlevel 2 goto cleanup
if errorlevel 1 goto reconnect

:cleanup
echo.
echo 正在关闭本地服务...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":%LOCAL_PORT%" ^| findstr "LISTENING"') do (
    taskkill /PID %%p /F >nul 2>&1
)
echo 本地服务已关闭
echo.
pause
