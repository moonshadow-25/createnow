#!/bin/bash

echo "Starting AI Short Video Generation Platform..."
echo ""

# 检查Python是否安装
if ! command -v python3 &> /dev/null; then
    echo "Error: Python 3 is not installed"
    exit 1
fi

# 检查Node是否安装
if ! command -v node &> /dev/null; then
    echo "Error: Node.js is not installed"
    exit 1
fi

echo "Starting Backend Server..."
cd backend
python3 -m app.main &
BACKEND_PID=$!
cd ..

sleep 3

echo "Starting Frontend..."
cd frontend
npm run dev &
FRONTEND_PID=$!
cd ..

echo ""
echo "Both servers are running!"
echo "Backend: http://localhost:8000"
echo "Frontend: http://localhost:5173"
echo ""
echo "Press Ctrl+C to stop both servers"

# 等待用户中断
trap "echo ''; echo 'Stopping servers...'; kill $BACKEND_PID $FRONTEND_PID; exit 0" INT

wait
