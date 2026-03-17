@echo off
chcp 65001
REM ========================================
REM CreateNow - 一键启动服务器映射
REM ========================================
REM 功能：启动本地服务(8001) + SSH隧道 + Nginx代理(8002)
REM 访问：http://47.117.182.216:8002

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
set LOCAL_PORT=8001
set REMOTE_PORT=8001

echo [配置信息]
echo 本地服务端口: %LOCAL_PORT%
echo 服务器地址: %SERVER_USER%@%SERVER_IP%:%SSH_PORT%
echo 公网访问: http://%SERVER_IP%:8002
echo.

REM ========================================
REM 步骤1：检查环境
REM ========================================
echo [1/4] 检查环境...

REM 检查Python环境
if not exist "env\python.exe" (
    echo [ERROR] Python环境不存在！
    echo 请先运行 install.bat
    echo.
    pause
    exit /b 1
)
echo   [OK] Python环境存在

REM 检查前端编译产物
if not exist "frontend\dist\index.html" (
    echo [WARNING] 前端未编译，将以API模式运行
)

REM 检查SSH客户端
where ssh >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] 未找到SSH客户端！
    echo 请安装 OpenSSH 客户端
    echo.
    pause
    exit /b 1
)
echo   [OK] SSH客户端已安装

REM 检查SSH密钥
if not exist "%SSH_KEY%" (
    echo [ERROR] SSH密钥不存在: %SSH_KEY%
    echo.
    pause
    exit /b 1
)
echo   [OK] SSH密钥文件存在

REM 测试SSH连接
ssh -i "%SSH_KEY%" -p %SSH_PORT% -o ConnectTimeout=5 -o StrictHostKeyChecking=no %SERVER_USER%@%SERVER_IP% "echo 连接测试" >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] SSH连接失败！请检查网络和服务器状态
    echo.
    pause
    exit /b 1
)
echo   [OK] SSH连接测试成功
echo.

REM ========================================
REM 步骤2：启动本地服务
REM ========================================
echo [2/4] 启动本地服务...

REM 检查端口是否被占用
netstat -ano | findstr ":%LOCAL_PORT%" | findstr "LISTENING" >nul 2>&1
if %errorlevel% equ 0 (
    echo [WARNING] 端口 %LOCAL_PORT% 已被占用
    choice /C YN /M "是否继续（假设服务已启动）"
    if errorlevel 2 (
        echo 操作已取消
        pause
        exit /b 1
    )
    echo   [SKIP] 跳过服务启动
) else (
    REM 在新窗口启动本地服务
    start "CreateNow Local Service (Port %LOCAL_PORT%)" cmd /c "cd /d "%CD%" && set API_PORT=%LOCAL_PORT% && start.bat"

    echo   [OK] 服务启动中...
    echo   等待服务启动完成（10秒）...

    REM 等待服务启动并验证
    set /a count=0
    :wait_service
    timeout /t 1 /nobreak >nul
    set /a count+=1

    netstat -ano | findstr ":%LOCAL_PORT%" | findstr "LISTENING" >nul 2>&1
    if %errorlevel% equ 0 (
        echo   [OK] 服务已成功启动
        goto service_ready
    )

    if !count! geq 10 (
        echo   [WARNING] 服务启动超时，但继续尝试连接...
        goto service_ready
    )

    goto wait_service
)

:service_ready
echo.

REM ========================================
REM 步骤3：验证本地服务
REM ========================================
echo [3/4] 验证本地服务...

REM 测试本地服务响应
curl -s -I --max-time 3 http://localhost:%LOCAL_PORT% >nul 2>&1
if %errorlevel% equ 0 (
    echo   [OK] 本地服务响应正常
) else (
    echo   [WARNING] 本地服务可能未完全启动，继续尝试...
)
echo.

REM ========================================
REM 步骤4：建立SSH隧道
REM ========================================
echo [4/4] 建立SSH隧道...
echo.
echo ========================================
echo   隧道启动成功！
echo ========================================
echo.
echo 本地服务: http://localhost:%LOCAL_PORT%
echo 公网访问: http://%SERVER_IP%:8002
echo.
echo 提示：
echo - 本地服务窗口和隧道窗口都需要保持运行
echo - 关闭此窗口将断开隧道，但本地服务继续运行
echo - 按 Ctrl+C 可关闭隧道
echo.
echo ========================================
echo.

REM 启动SSH隧道（占用当前窗口）
:reconnect
ssh -4 -N -i "%SSH_KEY%" -p %SSH_PORT% -o ServerAliveInterval=60 -o ServerAliveCountMax=3 -o StrictHostKeyChecking=no -o ExitOnForwardFailure=yes -R %REMOTE_PORT%:127.0.0.1:%LOCAL_PORT% %SERVER_USER%@%SERVER_IP%

REM 隧道断开处理
echo.
echo ========================================
echo [WARNING] SSH隧道已断开
echo ========================================
echo.
choice /C YN /M "是否重新连接隧道"
if errorlevel 2 goto cleanup
if errorlevel 1 goto reconnect

:cleanup
echo.
echo 隧道已关闭
echo.
echo 注意：本地服务仍在运行（独立窗口）
echo 如需关闭，请找到标题为 "CreateNow Local Service" 的窗口并关闭
echo.
pause
