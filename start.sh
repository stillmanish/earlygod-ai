#!/bin/bash

# EarlyGod.ai Startup Script
# This script starts both backend and frontend services

echo "🎮 Starting EarlyGod.ai..."

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 16+ to continue."
    exit 1
fi

# Check if environment files exist
if [ ! -f "early-god-backend/.env" ]; then
    echo "⚠️  Backend .env file not found. Creating template..."
    cat > early-god-backend/.env << EOL
# OpenAI Configuration
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_ORGANIZATION=your_openai_org_id_here

# YouTube Data API Configuration
YOUTUBE_API_KEY=your_youtube_api_key_here

# Neon Postgres Configuration
NEON_DATABASE_API=postgresql://username:password@hostname/database?sslmode=require

# Server Configuration
PORT=3001
NODE_ENV=development

# Electron Overlay Configuration
OVERLAY_HOTKEY=F12
OVERLAY_POSITION=top-right
EOL
    echo "✅ Created early-god-backend/.env template. Please fill in your API keys."
fi

if [ ! -f "frontend/.env" ]; then
    echo "⚠️  Frontend .env file not found. Creating template..."
    cat > frontend/.env << EOL
# OpenAI Configuration (same as backend)
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_ORGANIZATION=your_openai_org_id_here

# Overlay Configuration
OVERLAY_HOTKEY=F12
OVERLAY_POSITION=top-right
EOL
    echo "✅ Created frontend/.env template. Please fill in your API keys."
fi

echo "📋 Make sure your API keys are configured in the .env files:"
echo "   📄 early-god-backend/.env (OpenAI, YouTube, Database)"
echo "   📄 frontend/.env (OpenAI)"
echo ""

echo "🚀 Starting EarlyGod.ai..."

# Start backend server in background
echo "📡 Starting backend server..."
cd early-god-backend
npm start &
BACKEND_PID=$!
cd ..

# Wait for backend to start
echo "⏳ Waiting for backend to initialize..."
sleep 3

# Check if backend is running
if curl -s http://localhost:3001/api/health > /dev/null; then
    echo "✅ Backend server is running on http://localhost:3001"
else
    echo "❌ Backend server failed to start. Check the logs above."
    kill $BACKEND_PID 2>/dev/null
    exit 1
fi

# Start frontend application
echo "🖥️  Starting Electron application..."
cd frontend
npm start &
FRONTEND_PID=$!
cd ..

echo "✅ EarlyGod.ai is now running!"
echo ""
echo "🌐 Backend API: http://localhost:3001"
echo "🖥️  Frontend: Electron application window"
echo "🎮 Overlay hotkey: F12 (configurable in .env)"
echo ""
echo "📖 Usage:"
echo "   1. Open the Electron app"
echo "   2. Paste a YouTube gaming guide URL"
echo "   3. Click 'Process Guide'"
echo "   4. Press F12 to toggle in-game overlay"
echo "   5. Use arrow keys or buttons to navigate steps"
echo ""
echo "🔧 Development commands:"
echo "   - Stop backend: kill $BACKEND_PID"
echo "   - Stop frontend: kill $FRONTEND_PID"
echo "   - Restart backend: cd early-god-backend && npm run dev"
echo "   - Restart frontend: cd frontend && npm run dev"
echo ""
echo "⚠️  Make sure your game is running in windowed or borderless mode for overlay visibility"

# Wait for user to stop the script
echo ""
read -p "Press Enter to stop all services..."
echo "🛑 Stopping services..."

kill $BACKEND_PID 2>/dev/null
kill $FRONTEND_PID 2>/dev/null

echo "✅ All services stopped. Goodbye! 👋"
