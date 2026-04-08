@echo off
REM EarlyGod.ai Startup Script for Windows
REM This script starts both backend and frontend services

echo 🎮 Starting EarlyGod.ai...
echo.

REM Check if Node.js is installed
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Node.js is not installed. Please install Node.js 16+ to continue.
    pause
    exit /b 1
)

REM Check if environment files exist
if not exist "early-god-backend\.env" (
    echo ⚠️  Backend .env file not found. Creating template...
    (
        echo # OpenAI Configuration
        echo OPENAI_API_KEY=your_openai_api_key_here
        echo OPENAI_ORGANIZATION=your_openai_org_id_here
        echo.
        echo # YouTube Data API Configuration
        echo YOUTUBE_API_KEY=your_youtube_api_key_here
        echo.
        echo # Neon Postgres Configuration
        echo NEON_DATABASE_API=postgresql://username:password@hostname/database?sslmode=require
        echo.
        echo # Server Configuration
        echo PORT=3001
        echo NODE_ENV=development
        echo.
        echo # Electron Overlay Configuration
        echo OVERLAY_HOTKEY=F12
        echo OVERLAY_POSITION=top-right
    ) > early-god-backend\.env
    echo ✅ Created early-god-backend/.env template. Please fill in your API keys.
)

if not exist "frontend\.env" (
    echo ⚠️  Frontend .env file not found. Creating template...
    (
        echo # OpenAI Configuration (same as backend)
        echo OPENAI_API_KEY=your_openai_api_key_here
        echo OPENAI_ORGANIZATION=your_openai_org_id_here
        echo.
        echo # Overlay Configuration
        echo OVERLAY_HOTKEY=F12
        echo OVERLAY_POSITION=top-right
    ) > frontend\.env
    echo ✅ Created frontend/.env template. Please fill in your API keys.
)

echo.
echo 📋 Make sure your API keys are configured in the .env files:
echo    📄 early-god-backend\.env (OpenAI, YouTube, Database)
echo    📄 frontend\.env (OpenAI)
echo.

echo 🚀 Starting EarlyGod.ai...
echo.

REM Start backend server in background
echo 📡 Starting backend server...
cd early-god-backend
start /B npm start
set BACKEND_PID=%!
cd ..

REM Wait for backend to start
echo ⏳ Waiting for backend to initialize...
timeout /t 3 /nobreak >nul

REM Check if backend is running
curl -s http://localhost:3001/api/health >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Backend server failed to start. Check the logs above.
    taskkill /PID %BACKEND_PID% /F >nul 2>&1
    echo.
    pause
    exit /b 1
)
echo ✅ Backend server is running on http://localhost:3001

REM Start frontend application
echo 🖥️  Starting Electron application...
cd frontend
start /B npm start
set FRONTEND_PID=%!
cd ..

echo.
echo ✅ EarlyGod.ai is now running!
echo.
echo 🌐 Backend API: http://localhost:3001
echo 🖥️  Frontend: Electron application window
echo 🎮 Overlay hotkey: F12 (configurable in .env)
echo.
echo 📖 Usage:
echo    1. Open the Electron app
echo    2. Paste a YouTube gaming guide URL
echo    3. Click "Process Guide"
echo    4. Press F12 to toggle in-game overlay
echo    5. Use arrow keys or buttons to navigate steps
echo.
echo 🔧 Development commands:
echo    - Stop backend: taskkill /PID %BACKEND_PID% /F
echo    - Stop frontend: taskkill /PID %FRONTEND_PID% /F
echo    - Restart backend: cd early-god-backend ^&^& npm run dev
echo    - Restart frontend: cd frontend ^&^& npm run dev
echo.
echo ⚠️  Make sure your game is running in windowed or borderless mode for overlay visibility
echo.

pause
