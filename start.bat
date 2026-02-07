@echo off
REM ========================================
REM CreateNow - Production Launch Script
REM ========================================
REM This script starts the backend server which serves both:
REM - API endpoints at /api/*
REM - Frontend static files from frontend/dist
REM Uses Python from project root 'env' directory
REM ========================================

echo.
echo ========================================
echo   AI Short Video Generation Platform
echo   Production Environment
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

REM Check if frontend dist exists
if not exist "frontend\dist\index.html" (
    echo [WARNING] Frontend build not found at frontend\dist\
    echo Please run 'cd frontend && npm run build' first.
    echo Running in API-only mode...
    echo.
)

echo Starting backend server...
echo   - API: http://localhost:8501/api
echo   - Frontend: http://localhost:8501
echo.
echo Press Ctrl+C to stop the server
echo.

REM Create a temporary batch file for backend
echo @echo off > backend_start.bat
echo cd /d "%CD%\backend" >> backend_start.bat
echo set PYTHONPATH=%CD%\backend >> backend_start.bat
echo %CD%\env\python.exe app\main.py --serve-frontend >> backend_start.bat

cmd /k backend_start.bat
