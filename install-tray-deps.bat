@echo off
chcp 65001 >nul
echo 安装托盘依赖 (pystray)...
"%~dp0env\python.exe" -m pip install pystray
echo.
echo 完成！
pause
