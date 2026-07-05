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
pip3 install flask flask-cors requests --quiet

# Check config
if grep -q "YOUR_BOT_TOKEN_HERE" server/config.py; then
    echo ""
    echo "⚠️  ============================================"
    echo "⚠️  TELEGRAM BOT NOT CONFIGURED!"
    echo "⚠️  ============================================"
    echo ""
    echo "Steps to set up:"
    echo "1. Open Telegram, search @BotFather"
    echo "2. Send /newbot and follow instructions"
    echo "3. Copy the bot token you receive"
    echo "4. Create a Telegram channel (or use existing)"
    echo "5. Add your bot as admin to the channel"
    echo "6. Edit server/config.py with your token & channel"
    echo ""
    echo "Starting server anyway (logging will be disabled)..."
    echo ""
fi

echo "🌐 Starting backend server on port 3000..."
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

# Handle shutdown
trap "kill $SERVER_PID 2>/dev/null; exit" INT TERM

python3 -m http.server 8000
