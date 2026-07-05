#!/bin/bash
# ============ MeetLink Quick Start Script ============

echo "================================================"
echo "  🚀 MeetLink - Neon Video Call + Telegram Logger"
echo "================================================"
echo ""

# Check Python
if ! command -v python3 &> /dev/null; then
    echo "❌ Python3 not found! Please install Python3 first."
    exit 1
fi

echo "📦 Installing dependencies..."
pip3 install flask flask-cors requests gunicorn --quiet

# Check config
if grep -q "YOUR_BOT_TOKEN_HERE" server/config.py; then
    echo ""
    echo "⚠️  TELEGRAM BOT NOT CONFIGURED!"
    echo "   Edit server/config.py with your bot token & channel"
    echo "   Starting server anyway (Telegram logging disabled)..."
    echo ""
fi

echo "🌐 Starting backend server on port 8080..."
cd server
python3 server.py &
SERVER_PID=$!
cd ..

echo "🌐 Starting frontend server on port 8000..."
echo ""
echo "✅ Open this URL in your browser:"
echo "   👉 http://localhost:8000"
echo ""
echo "Press Ctrl+C to stop both servers"

trap "kill $SERVER_PID 2>/dev/null; exit" INT TERM

python3 -m http.server 8000
