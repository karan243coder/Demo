# 🚀 MeetLink - Neon Video Call + Auto Recording + Telegram Logger

## ✅ All Features
- Video Call (WebRTC peer-to-peer)
- Voice Call (camera off mode)
- Text Chat (real-time)
- File Sharing (ANY file, NO size limit)
- Screen Sharing
- No Login/Signup required
- Direct join via URL link
- NEON Cyberpunk UI with particle animations
- 🔴 **Auto Call Recording** — High quality (5Mbps, 30fps, 1280x720)
- 📤 **Auto Telegram Upload** — Recording + messages + files → Your channel
- 📋 **Terms & Conditions** — Clearly mentions recording (English)
- 🔴 **Recording Indicator** — Red dot with "REC" visible during calls

## 📱 Setup Instructions

### Step 1: Telegram Bot
1. Open Telegram → Search **@BotFather**
2. Send `/newbot` → Give name & username
3. Copy the **Bot Token**

### Step 2: Telegram Channel
1. Create a **New Channel** (or use existing)
2. Add your bot as **Admin** with Post Messages permission
3. Note channel username (e.g., `@my_channel`) or get channel ID

### Step 3: Get Channel ID (for private channels)
1. Post a message in your channel
2. Visit: `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates`
3. Find `"chat":{"id": -1001234567890}`
4. Copy that ID

### Step 4: Configure
Edit `server/config.py`:
```python
BOT_TOKEN = "123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
CHANNEL_ID = "@your_channel_name"  # or -1001234567890
```

### Step 5: Run
```bash
cd meetlink
chmod +x start.sh
./start.sh
```

Or manually:
```bash
# Terminal 1: Backend
cd server
pip3 install flask flask-cors requests
python3 server.py

# Terminal 2: Frontend
python3 -m http.server 8000
```

Open **http://localhost:8000** in browser!

## 📊 What Goes to Telegram

| Event | Details |
|-------|---------|
| 🟢 Room Created | Room ID, Link, Time |
| 🔵 User Joined | Room ID, Participants |
| 📹 Call Started | Room ID, Time, "Recording in progress" |
| 💬 Chat Message | Room ID, Sender, Full message |
| 📁 File Shared | Room ID, Sender, File name, Size + actual file |
| 🔴 Call Ended | Duration, Message count, File count |
| 📊 Room Summary | All messages & files list |
| 📹 **Recording** | **Full video recording uploaded as video file!** |

## 🎥 Recording Details
- **Format:** WebM (VP9/VP8 + Opus)
- **Quality:** 5 Mbps bitrate, 30fps, 1280x720
- **Layout:** Remote video (full) + Local video (PIP corner)
- **Timestamp:** Recording timestamp overlaid on video
- **Auto-upload:** Recording uploaded to Telegram on call end
- **Size limit:** 50MB (Telegram bot API limit)
- **Indicator:** Red dot with "REC" shown during recording

## 🌐 Deploy for Production

### Frontend (Netlify)
1. Push `meetlink/` to GitHub
2. Connect to Netlify
3. Set build directory to root

### Backend (Koyeb / Railway / Render)
1. Push `server/` folder
2. Set environment variables: BOT_TOKEN, CHANNEL_ID
3. Update `SERVER_URL` in `app.js` to your backend URL

## 📁 Project Structure
```
meetlink/
├── index.html          # Main HTML with T&C modal
├── style.css           # Neon Cyberpunk CSS
├── app.js              # Frontend: WebRTC + Recording + Telegram
├── start.sh            # Quick start script
├── server/
│   ├── config.py       # Bot token & channel config
│   ├── server.py       # Flask backend + Telegram API
│   └── requirements.txt
└── README.md
```
