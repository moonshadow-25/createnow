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

REM Check if frontend dist exists
if not exist "frontend\dist\index.html" (
    echo [WARNING] Frontend build not found at frontend\dist\
    echo Please run 'cd frontend && npm run build' first.
    echo Running in API-only mode...
    echo.
)

REM Parse port parameter (optional)
set API_PORT=%1
if "%API_PORT%"=="" set API_PORT=8501

echo [OK] Using Python: %CD%\env\python.exe
echo [OK] Port: %API_PORT%
echo.
echo Starting backend server...
echo   - API: http://localhost:%API_PORT%/api
echo   - Frontend: http://localhost:%API_PORT%
echo.
echo Press Ctrl+C to stop the server
echo.

REM Start server directly without temporary file
cd /d "%CD%\backend"
set PYTHONPATH=%CD%
%CD%\..\env\python.exe app\main.py --serve-frontend
