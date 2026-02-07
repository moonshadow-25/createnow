@echo off
REM ========================================
REM CreateNow - Development Launch Script
REM ========================================
REM Uses Python from project root 'env' directory
REM Frontend runs via npm dev with hot reload
REM ========================================

echo.
echo ========================================
echo   AI Short Video Generation Platform
echo   Development Environment
echo ========================================
echo.

REM Check if env exists
if not exist "env\python.exe" (
    echo [ERROR] Python environment not found at .\env\python.exe
    echo Please run install.bat first.
    echo.
    pause
    exit /b 1
)

echo [OK] Using Python: %CD%\env\python.exe
echo.

REM Create a temporary batch file for backend
echo @echo off > backend_start.bat
echo cd /d "%CD%\backend" >> backend_start.bat
echo set PYTHONPATH=%CD%\backend >> backend_start.bat
echo %CD%\env\python.exe app\main.py >> backend_start.bat
echo pause >> backend_start.bat

echo Starting Backend Server (API only)...
start "Backend" cmd /k backend_start.bat

timeout /t 3 /nobreak >nul

echo Starting Frontend (npm dev)...
start "Frontend" cmd /k "cd frontend && npm run dev"

echo.
echo Both servers are starting!
echo   Backend: http://localhost:8001/api
echo   Frontend: http://localhost:5173
echo.
echo Press any key to close this window (servers will continue running)...
pause
