/**
 * SenseNet - Assistive Safety UI Controller
 * Core interactions, media handling, and logic.
 */

// --- Global State ---
const State = {
    isMonitoring: false,
    espIP: '',
    threshold: 0.75,
    cameraStream: null,
    audioContext: null,
    analyser: null,
    microphone: null,
    log: []
};

// --- DOM Elements ---
const DOM = {
    // Navigation
    navBtns: document.querySelectorAll('.nav-btn'),
    screens: document.querySelectorAll('.screen'),
    
    // Header
    header: document.getElementById('app-header'),
    statusDot: document.getElementById('status-dot'),
    statusText: document.getElementById('status-text'),
    
    // Monitoring Screen
    soundMeterBar: document.getElementById('sound-meter-bar'),
    detectedSound: document.getElementById('detected-sound'),
    confidenceScore: document.getElementById('confidence-score'),
    cameraCanvas: document.getElementById('camera-canvas'),
    cameraPlaceholder: document.getElementById('camera-placeholder'),
    alertStatusText: document.getElementById('alert-status-text'),
    logList: document.getElementById('detection-log'),
    
    // Settings Screen
    espIpInput: document.getElementById('esp32-ip'),
    sensitivityInput: document.getElementById('sensitivity'),
    sensitivityVal: document.getElementById('sensitivity-val'),
    btnTestAlert: document.getElementById('btn-test-alert'),
    btnSimulateAlert: document.getElementById('btn-simulate-alert'),
    testResultMsg: document.getElementById('test-result-msg'),
    
    // Error Overlay
    overlay: document.getElementById('error-overlay'),
    errorTitle: document.getElementById('error-title'),
    errorMsg: document.getElementById('error-message'),
    btnDismissError: document.getElementById('btn-dismiss-error')
};

// --- Initialization ---
function init() {
    loadSettings();
    setupEventListeners();
    
    // Auto-start monitoring if permissions are already granted or request them
    startAudioMonitoring();
}

function loadSettings() {
    const savedIP = localStorage.getItem('sensenet_esp_ip');
    const savedThreshold = localStorage.getItem('sensenet_threshold');

    if (savedIP) {
        State.espIP = savedIP;
        DOM.espIpInput.value = savedIP;
    }
    
    if (savedThreshold) {
        State.threshold = parseFloat(savedThreshold);
        DOM.sensitivityInput.value = savedThreshold;
        DOM.sensitivityVal.innerText = State.threshold.toFixed(2);
    }
}

function setupEventListeners() {
    // Navigation
    DOM.navBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const targetId = e.currentTarget.getAttribute('data-target');
            switchScreen(targetId);
            
            // Update active state on buttons
            DOM.navBtns.forEach(b => b.classList.remove('active'));
            e.currentTarget.classList.add('active');
        });
    });

    // Settings
    DOM.espIpInput.addEventListener('input', (e) => {
        State.espIP = e.target.value.trim();
        localStorage.setItem('sensenet_esp_ip', State.espIP);
    });

    DOM.sensitivityInput.addEventListener('input', (e) => {
        State.threshold = parseFloat(e.target.value);
        DOM.sensitivityVal.innerText = State.threshold.toFixed(2);
        localStorage.setItem('sensenet_threshold', State.threshold);
    });

    // Testing / Demo
    DOM.btnTestAlert.addEventListener('click', testEspAlert);
    DOM.btnSimulateAlert.addEventListener('click', simulateDangerDetection);

    // Errors
    DOM.btnDismissError.addEventListener('click', () => {
        DOM.overlay.classList.add('hidden');
    });
}

// --- Navigation ---
function switchScreen(screenId) {
    DOM.screens.forEach(screen => {
        screen.classList.remove('active');
    });
    document.getElementById(screenId).classList.add('active');
}

// --- Core Media & Audio Logic ---
async function startAudioMonitoring() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        
        State.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        State.analyser = State.audioContext.createAnalyser();
        State.analyser.fftSize = 256;
        
        State.microphone = State.audioContext.createMediaStreamSource(stream);
        State.microphone.connect(State.analyser);
        
        State.isMonitoring = true;
        updateSystemState('monitoring');
        
        // Start meter loop
        updateSoundMeter();
        
        // Note: For a real hackathon, this is where you'd connect to TensorFlow.js (YAMNet)
        // e.g. runInference(State.audioContext, stream);
        
    } catch (error) {
        console.error("Audio Access Error:", error);
        showError("Microphone Required", "Microphone access is required for real-time monitoring. Please check browser permissions.");
        updateSystemState('error');
    }
}

function updateSoundMeter() {
    if (!State.isMonitoring) return;
    
    const dataArray = new Uint8Array(State.analyser.frequencyBinCount);
    State.analyser.getByteFrequencyData(dataArray);
    
    // Calculate RMS
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i] * dataArray[i];
    }
    const rms = Math.sqrt(sum / dataArray.length);
    
    // Map RMS (0-255) to percentage (0-100)
    // Enhancing lower volumes for better visibility
    const percentage = Math.min(100, (rms / 128) * 100);
    
    DOM.soundMeterBar.style.width = percentage + "%";
    
    requestAnimationFrame(updateSoundMeter);
}

// --- Detection Flow Logic ---
async function handleDetectionResult(label, score) {
    // 1. Update Detection Display
    DOM.detectedSound.innerText = label;
    DOM.confidenceScore.innerText = score.toFixed(2);
    
    // Change color based on confidence to provide visual feedback
    if (score >= State.threshold) {
        DOM.confidenceScore.style.color = "var(--color-alert)";
    } else if (score > 0.4) {
        DOM.confidenceScore.style.color = "var(--color-detection)";
    } else {
        DOM.confidenceScore.style.color = "var(--text-secondary)";
    }

    // 2. Log Detection
    addLogEntry(label, score);

    // 3. Process Danger Action
    if (score >= State.threshold) {
        await triggerDangerFlow(label);
    } else {
        // Reset state after a short delay if it was just a low-confidence sound
        setTimeout(() => {
            if (DOM.statusText.innerText !== 'Alert Triggered') {
                updateSystemState('monitoring');
            }
        }, 1000);
    }
}

async function triggerDangerFlow(label) {
    updateSystemState('detection');
    
    try {
        // Step A: Capture Camera Frame
        await captureCameraFrame();
        
        // Step B: Send Alert to ESP32
        updateSystemState('alert');
        DOM.alertStatusText.innerText = "Alert Sent to Wristband";
        DOM.alertStatusText.className = "alert-status-text triggered";
        
        await sendEspAlert(label);
        
    } catch (e) {
        console.error("Danger flow interrupted", e);
    } finally {
        // Revert to monitoring after 5 seconds
        setTimeout(() => {
            resetAlertState();
        }, 5000);
    }
}

// --- Camera Capture Logic ---
async function captureCameraFrame() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        const video = document.createElement('video');
        video.srcObject = stream;
        
        // Wait for video to be ready
        await new Promise((resolve) => {
            video.onloadedmetadata = () => {
                video.play();
                resolve();
            };
        });

        // Small timeout to allow camera auto-exposure to adjust
        await new Promise(r => setTimeout(r, 300));

        // Draw to Canvas
        DOM.cameraCanvas.width = video.videoWidth;
        DOM.cameraCanvas.height = video.videoHeight;
        const ctx = DOM.cameraCanvas.getContext('2d');
        ctx.drawImage(video, 0, 0, DOM.cameraCanvas.width, DOM.cameraCanvas.height);
        
        // Show canvas, hide placeholder
        DOM.cameraCanvas.style.display = 'block';
        DOM.cameraPlaceholder.style.display = 'none';

        // Stop camera tracks to save battery/privacy
        stream.getTracks().forEach(track => track.stop());

    } catch (error) {
        console.error("Camera Array Exception:", error);
        showError("Camera Access Failed", "Camera access is required to capture visual context of the danger.");
    }
}

// --- ESP32 Integration (Fetch) ---
async function sendEspAlert(reason) {
    if (!State.espIP) {
        console.warn("No ESP IP Address Configured.");
        return { success: false, error: "No IP Configured" };
    }

    const url = `http://${State.espIP}/alert`;
    
    try {
        // Note: Using fetch with no-cors or simple GET depending on the ESP32 server implementation
        const response = await fetch(url, {
            method: 'GET',
            mode: 'cors', // Can change to 'no-cors' if ESP doesn't send CORS headers
            cache: 'no-cache'
        });
        
        console.log("ESP32 Alert Sent via HTTP", response.status);
        return { success: true };
    } catch (error) {
        console.error("ESP32 HTTP Error:", error);
        showError("ESP32 Connection Failed", `Unable to reach ESP32 device at ${State.espIP}. Check your WiFi connection.`);
        return { success: false, error };
    }
}

// --- System State UI Updates ---
function updateSystemState(state) {
    // Reset classes
    DOM.header.className = '';
    DOM.statusDot.className = 'dot';
    
    switch (state) {
        case 'monitoring':
            DOM.header.classList.add('state-monitoring');
            DOM.statusDot.classList.add('monitoring');
            DOM.statusText.innerText = 'Monitoring Audio';
            break;
        case 'detection':
            DOM.header.classList.add('state-detection');
            DOM.statusDot.classList.add('detection');
            DOM.statusText.innerText = 'Analyzing Danger...';
            break;
        case 'alert':
            DOM.header.classList.add('state-alert');
            DOM.statusDot.classList.add('alert');
            DOM.statusText.innerText = 'Alert Triggered!';
            break;
        case 'error':
            DOM.header.classList.add('state-alert');
            DOM.statusDot.classList.add('alert');
            DOM.statusText.innerText = 'System Error';
            break;
    }
}

function resetAlertState() {
    updateSystemState('monitoring');
    DOM.alertStatusText.innerText = "Safe";
    DOM.alertStatusText.className = "alert-status-text safe";
    DOM.detectedSound.innerText = "None";
    DOM.confidenceScore.innerText = "0.00";
    DOM.confidenceScore.style.color = "var(--text-secondary)";
}

// --- Historical Logging ---
function addLogEntry(label, score) {
    const timeString = new Date().toLocaleTimeString('en-US', { hour12: false });
    const logItem = { time: timeString, label, score };
    
    State.log.unshift(logItem); // Add to beginning
    
    // Truncate to 20 max
    if (State.log.length > 20) {
        State.log.pop();
    }
    
    renderLog();
}

function renderLog() {
    DOM.logList.innerHTML = '';
    State.log.forEach(item => {
        const li = document.createElement('li');
        li.className = 'log-item';
        
        const isHighConf = item.score >= State.threshold;
        const colorClass = isHighConf ? 'style="color: var(--color-alert)"' : '';

        li.innerHTML = `
            <span class="log-time">${item.time}</span>
            <span class="log-label">${item.label}</span>
            <span class="log-conf" ${colorClass}>(${item.score.toFixed(2)})</span>
        `;
        DOM.logList.appendChild(li);
    });
}

// --- Utility & Error Handling ---
function showError(title, message) {
    DOM.errorTitle.innerText = title;
    DOM.errorMsg.innerText = message;
    DOM.overlay.classList.remove('hidden');
}

// --- Testing / Demo Features ---
async function testEspAlert() {
    DOM.testResultMsg.className = 'msg-box';
    DOM.testResultMsg.innerText = "Sending request...";
    
    const result = await sendEspAlert("Hardware Test");
    
    if (result.success) {
        DOM.testResultMsg.classList.add('msg-success');
        DOM.testResultMsg.innerText = "Success: Alert sent to ESP32.";
    } else {
        DOM.testResultMsg.classList.add('msg-error');
        DOM.testResultMsg.innerText = "Error: Check IP and Network.";
    }
}

function simulateDangerDetection() {
    // Switch to monitoring screen
    switchScreen('screen-monitoring');
    DOM.navBtns.forEach(b => b.classList.remove('active'));
    DOM.navBtns[0].classList.add('active'); // Monitor tab

    // Force a detection event
    const demoLabel = "Fire Alarm";
    const demoScore = 0.95;
    
    handleDetectionResult(demoLabel, demoScore);
}

// Ignite application on load
window.addEventListener('DOMContentLoaded', init);
