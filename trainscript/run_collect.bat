@echo off
setlocal EnableExtensions
title CreateNow Train Data Collector

rem ============================================================
rem  CreateNow Train Data Collector - double click to run.
rem  Collects AIGC generation data into the spec layout.
rem  Edit the SET lines below to change collection parameters.
rem  See README.md for all options.
rem ============================================================

set "SCRIPT_DIR=%~dp0"

rem ---- Config (edit here) ----
set "SRC_DIR="
set "OUT_DIR="
set "VIDEO_COUNT=30"
set "DURATION=15"
set "PRIMARY_ONLY=1"
set "BY_PROJECT=1"
set "IMG_COUNTS=10,10,10"
set "AUDIO_COUNT=10"
set "EXTRA_ARGS="

rem ---- Locate Python: prefer project venv, then system python ----
set "PYTHON_EXE="
if exist "%SCRIPT_DIR%..\env\python.exe" set "PYTHON_EXE=%SCRIPT_DIR%..\env\python.exe"
if not defined PYTHON_EXE if exist "%SCRIPT_DIR%python.exe" set "PYTHON_EXE=%SCRIPT_DIR%python.exe"

if not defined PYTHON_EXE (
    set "PYTHON_EXE=python"
    where python >nul 2>nul
    if errorlevel 1 set "PYTHON_EXE=py"
)

if not defined PYTHON_EXE (
    echo [ERROR] Python not found. Install Python 3 or place a venv.
    pause
    exit /b 1
)

rem ---- Build arguments ----
set "FLAGS=--video-count %VIDEO_COUNT% --duration %DURATION% --audio-count %AUDIO_COUNT% --image-count %IMG_COUNTS%"
if "%PRIMARY_ONLY%"=="1" set "FLAGS=%FLAGS% --primary-only"
if "%PRIMARY_ONLY%"=="0" set "FLAGS=%FLAGS% --no-primary-only"
if "%BY_PROJECT%"=="1" set "FLAGS=%FLAGS% --by-project"
if "%BY_PROJECT%"=="0" set "FLAGS=%FLAGS% --global-random"
if not "%SRC_DIR%"=="" set "FLAGS=%FLAGS% --src %SRC_DIR%"
if not "%OUT_DIR%"=="" set "FLAGS=%FLAGS% --out %OUT_DIR%"
if not "%EXTRA_ARGS%"=="" set "FLAGS=%FLAGS% %EXTRA_ARGS%"

echo ============================================================
echo  CreateNow Train Data Collector
echo  Videos:  %VIDEO_COUNT%   Duration: %DURATION%s
echo  Python:  %PYTHON_EXE%
echo ============================================================
echo.

"%PYTHON_EXE%" "%SCRIPT_DIR%collect_traindata.py" %FLAGS%
set "RC=%ERRORLEVEL%"

echo.
if %RC%==0 (
    echo [OK] Collection finished. See output directory.
) else (
    echo [FAIL] Collection failed with code %RC%.
)
pause
exit /b %RC%
