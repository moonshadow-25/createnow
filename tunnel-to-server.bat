@echo off
REM ========================================
REM SSH 反向隧道 - CreateNow 映射脚本
REM ========================================

echo.
echo ========================================
echo   CreateNow SSH Tunnel
echo ========================================
echo.

REM 配置区域
set SERVER_USER=root
set SERVER_IP=47.117.182.216
set SSH_PORT=22
set SSH_KEY=%~dp047.117.182.216_id_ed25519
set LOCAL_PORT=8501
set REMOTE_PORT=8001

echo [配置信息]
echo 服务器地址: %SERVER_USER%@%SERVER_IP%:%SSH_PORT%
echo SSH密钥: %SSH_KEY%
echo 本地端口: %LOCAL_PORT%
echo 隧道端口: %REMOTE_PORT% (仅服务器内部)
echo 公网访问: http://%SERVER_IP%:8002 (Nginx代理)
echo.

REM 检查本地服务是否运行
echo [1/3] 检查本地服务...
netstat -an | findstr ":%LOCAL_PORT%" >nul
if %errorlevel% neq 0 (
    echo [ERROR] 本地端口 %LOCAL_PORT% 没有服务运行！
    echo 请先启动 CreateNow 服务：start.bat
    echo.
    pause
    exit /b 1
)
echo [OK] 本地服务运行正常
echo.

REM 检查SSH客户端
echo [2/4] 检查SSH客户端...
where ssh >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] 未找到 SSH 客户端！
    echo 请安装 OpenSSH 客户端：
    echo 设置 ^> 应用 ^> 可选功能 ^> OpenSSH 客户端
    echo.
    pause
    exit /b 1
)
echo [OK] SSH 客户端已安装
echo.

REM 检查SSH密钥文件
echo [3/4] 检查SSH密钥...
if not exist "%SSH_KEY%" (
    echo [ERROR] SSH密钥文件不存在！
    echo 路径: %SSH_KEY%
    echo 请确认密钥文件是否正确
    echo.
    pause
    exit /b 1
)
echo [OK] SSH密钥文件存在
echo.

REM 建立隧道
echo [4/4] 建立 SSH 隧道...
echo.
echo ========================================
echo   隧道已启动！
echo ========================================
echo.
echo 访问地址: http://%SERVER_IP%:%REMOTE_PORT%
echo.
echo 提示：
echo - 保持此窗口打开，隧道才会持续生效
echo - 使用密钥认证，无需输入密码
echo - 按 Ctrl+C 可关闭隧道
echo.
echo ========================================
echo.

REM 启动SSH隧道（带自动重连）
:reconnect
ssh -4 -N -i "%SSH_KEY%" -p %SSH_PORT% -o ServerAliveInterval=60 -o ServerAliveCountMax=3 -o StrictHostKeyChecking=no -R %REMOTE_PORT%:127.0.0.1:%LOCAL_PORT% %SERVER_USER%@%SERVER_IP%

REM 如果断开，询问是否重连
echo.
echo [WARNING] SSH 隧道已断开
choice /C YN /M "是否重新连接"
if errorlevel 2 goto end
if errorlevel 1 goto reconnect

:end
echo.
echo 隧道已关闭
pause
