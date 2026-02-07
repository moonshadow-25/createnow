@echo off
echo Installing dependencies for AI Short Video Generation Platform...
echo.

echo Installing Python dependencies...
cd backend
pip install -r requirements.txt
cd ..

echo.
echo Installing Node.js dependencies...
cd frontend
npm install
cd ..

echo.
echo Installation complete!
echo.
echo Next steps:
echo 1. Copy backend\.env.example to backend\.env
echo 2. Edit backend\.env and configure your API keys
echo 3. Run start.bat to start the application
echo.
pause
