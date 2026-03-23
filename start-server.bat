@echo off
chcp 65001 >nul
REM ========================================
REM CreateNow - 一键启动服务器映射（单窗口）
REM ========================================
REM 功能：后台启动本地服务(8501) + 前台SSH隧道
REM 访问：http://47.117.182.216:8102

setlocal enabledelayedexpansion

echo.
echo ========================================
echo   CreateNow Server Startup
echo ========================================
echo.

REM 配置区域
set SERVER_USER=root
set SERVER_IP=47.117.182.216
set SSH_PORT=22
set SSH_KEY=%~dp047.117.182.216_id_ed25519
set LOCAL_PORT=8501
set REMOTE_PORT=8102
set SCRIPT_DIR=%~dp0

echo [配置信息]
echo 本地服务端口: %LOCAL_PORT%
echo 服务器地址: %SERVER_USER%@%SERVER_IP%:%SSH_PORT%
echo 公网访问: http://%SERVER_IP%:8102
echo.

REM ========================================
REM 步骤1：检查环境
REM ========================================
echo [1/4] 检查环境...

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

ssh -i "%SSH_KEY%" -p %SSH_PORT% -o ConnectTimeout=5 -o StrictHostKeyChecking=no %SERVER_USER%@%SERVER_IP% "echo ok" >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] SSH连接失败！请检查网络和服务器状态
    pause & exit /b 1
)
echo   [OK] SSH连接测试成功
echo.

REM ========================================
REM 步骤2：启动本地服务（后台）
REM ========================================
echo [2/4] 启动本地服务...

netstat -ano | findstr ":%LOCAL_PORT%" | findstr "LISTENING" >nul 2>&1
if %errorlevel% equ 0 (
    echo   [SKIP] 端口 %LOCAL_PORT% 已有服务运行
    goto service_ready
)

REM 后台启动，日志写入 server.log
start /b cmd /c "cd /d "%SCRIPT_DIR%backend" && set PYTHONPATH=%SCRIPT_DIR%backend && "%SCRIPT_DIR%env\python.exe" app\main.py --serve-frontend > "%SCRIPT_DIR%server.log" 2>&1"

echo   [OK] 服务启动中，日志写入 server.log
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
echo   [OK] 本地服务已就绪
echo.

REM ========================================
REM 步骤3：验证本地服务
REM ========================================
echo [3/4] 验证本地服务...
curl -s -I --max-time 3 http://localhost:%LOCAL_PORT% >nul 2>&1
if %errorlevel% equ 0 (
    echo   [OK] 本地服务响应正常
) else (
    echo   [WARNING] 服务可能未完全启动，继续...
)
echo.

REM ========================================
REM 步骤4：建立SSH隧道（占用当前窗口）
REM ========================================
echo [4/4] 建立SSH隧道...
echo.
echo ========================================
echo   已就绪！
echo ========================================
echo.
echo 本地服务: http://localhost:%LOCAL_PORT%
echo 公网访问: http://%SERVER_IP%:8102
echo 服务日志: server.log
echo.
echo 按 Ctrl+C 关闭隧道（本地服务也会随之停止）
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
