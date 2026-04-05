@echo off
setlocal enabledelayedexpansion

set "SOURCE_DIR=%~dp0"
set "OUTPUT_7Z=%SOURCE_DIR%createnow-release-test.7z"
set "TEMP_DIR=%TEMP%\createnow-build-%RANDOM%"
set 7Z=C:\PROGRA~1\7-Zip\7z.exe

echo.
echo ========================================
echo   CreateNow Release Builder (7z TEST)
echo ========================================
echo.
echo Source : %SOURCE_DIR%
echo Output : %OUTPUT_7Z%
echo.

if not exist "%7Z%" (
    echo [ERROR] 7-Zip not found: %7Z%
    pause
    exit /b 1
)

if not exist "%SOURCE_DIR%frontend\dist\index.html" (
    echo [ERROR] Frontend build not found!
    pause
    exit /b 1
)

if not exist "%SOURCE_DIR%env\" (
    echo [ERROR] Python env not found
    pause
    exit /b 1
)

echo [1/5] Creating staging directory...
if exist "%TEMP_DIR%" rmdir /s /q "%TEMP_DIR%"
mkdir "%TEMP_DIR%"
mkdir "%TEMP_DIR%\backend"
mkdir "%TEMP_DIR%\frontend"

echo [2/5] Copying backend code...
xcopy /E /I /Y /Q "%SOURCE_DIR%backend\app" "%TEMP_DIR%\backend\app" >nul
xcopy /E /I /Y /Q "%SOURCE_DIR%backend\config" "%TEMP_DIR%\backend\config" >nul
copy /Y "%SOURCE_DIR%backend\requirements.txt" "%TEMP_DIR%\backend\" >nul
xcopy /E /I /Y /Q "%SOURCE_DIR%env" "%TEMP_DIR%\env" >nul

echo [3/5] Copying frontend build and docs...
xcopy /E /I /Y /Q "%SOURCE_DIR%frontend\dist" "%TEMP_DIR%\frontend\dist" >nul
if exist "%SOURCE_DIR%LICENSE"      copy /Y "%SOURCE_DIR%LICENSE"      "%TEMP_DIR%\" >nul
if exist "%SOURCE_DIR%README.md"    copy /Y "%SOURCE_DIR%README.md"    "%TEMP_DIR%\" >nul
if exist "%SOURCE_DIR%update.bat"   copy /Y "%SOURCE_DIR%update.bat"   "%TEMP_DIR%\" >nul
if exist "%SOURCE_DIR%version.json" copy /Y "%SOURCE_DIR%version.json" "%TEMP_DIR%\" >nul
if exist "%SOURCE_DIR%start.bat"    copy /Y "%SOURCE_DIR%start.bat"    "%TEMP_DIR%\" >nul

echo [4/5] Generating install.bat and .env.example...
echo @echo off > "%TEMP_DIR%\install.bat"
echo # config > "%TEMP_DIR%\backend\.env.example"

echo [5/5] Creating 7z package...
if exist "%OUTPUT_7Z%" del "%OUTPUT_7Z%"

"%7Z%" a -t7z -mx=5 -mmt=on "%OUTPUT_7Z%" "%TEMP_DIR%\*"

if %errorlevel% neq 0 (
    echo [ERROR] 7z failed.
    rmdir /s /q "%TEMP_DIR%"
    pause
    exit /b 1
)

rmdir /s /q "%TEMP_DIR%"

echo.
echo ========================================
echo   Build Complete!
echo ========================================
echo.
echo Package : %OUTPUT_7Z%
for %%A in ("%OUTPUT_7Z%") do (
    set /a SIZE_MB=%%~zA / 1048576
    echo Size : %%~zA bytes ^(!SIZE_MB! MB^)
)
echo.
pause
