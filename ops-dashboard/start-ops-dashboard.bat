@echo off
chcp 65001 >nul
setlocal

set SCRIPT_DIR=%~dp0
set PROJECT_ROOT=%SCRIPT_DIR%..
set PYTHON_EXE=%PROJECT_ROOT%env\python.exe
set OPS_PORT=%1
if "%OPS_PORT%"=="" set OPS_PORT=8518

if not exist "%PYTHON_EXE%" (
    echo [ERROR] Python environment not found: %PYTHON_EXE%
    echo Please run the main project install.bat first.
    pause
    exit /b 1
)

echo.
echo ========================================
echo   CreateNow Ops Dashboard
echo ========================================
echo.
echo URL : http://localhost:%OPS_PORT%
echo Port: %OPS_PORT%
echo.
echo Press Ctrl+C to stop.
echo.

start "" "http://localhost:%OPS_PORT%"
cd /d "%SCRIPT_DIR%"
"%PYTHON_EXE%" -m uvicorn app:app --host 127.0.0.1 --port %OPS_PORT%
