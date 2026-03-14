/**
 * SenseNet - App.js
 * Wired to native Android via window.Android.* JS interface.
 * All audio/ML/BLE runs in Kotlin — this is purely UI.
 */

// ── State ────────────────────────────────────────────────────────────
const State = {
    log: [],
    isFinding: false,
    isAlertActive: false,
    highDuration: 60,
    lowDuration: 20
};

// ── DOM Cache ────────────────────────────────────────────────────────
const DOM = {};
function cacheDom() {
    DOM.header          = document.getElementById('app-header');
    DOM.statusDot       = document.getElementById('status-dot');
    DOM.statusText      = document.getElementById('status-text');
    DOM.soundMeterBar   = document.getElementById('sound-meter-bar');
    DOM.detectedSound   = document.getElementById('detected-sound');
    DOM.confidenceScore = document.getElementById('confidence-score');
    DOM.alertStatusText = document.getElementById('alert-status-text');
    DOM.btnDismiss      = document.getElementById('btn-dismiss');
    DOM.bleStatus       = document.getElementById('ble-status');
    DOM.logList         = document.getElementById('detection-log');
    DOM.highDuration    = document.getElementById('high-duration');
    DOM.highDurVal      = document.getElementById('high-dur-val');
    DOM.lowDuration     = document.getElementById('low-duration');
    DOM.lowDurVal       = document.getElementById('low-dur-val');
    DOM.testResultMsg   = document.getElementById('test-result-msg');
    DOM.btnFindWatch    = document.getElementById('btn-find-watch');
    DOM.overlay         = document.getElementById('error-overlay');
    DOM.errorTitle      = document.getElementById('error-title');
    DOM.errorMsg        = document.getElementById('error-message');
    DOM.navBtns         = document.querySelectorAll('.nav-btn');
    DOM.screens         = document.querySelectorAll('.screen');
}

// ── Initialization ───────────────────────────────────────────────────
function init() {
    cacheDom();
    setupNav();
    setupSettings();
}

function setupNav() {
    DOM.navBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const target = e.currentTarget.getAttribute('data-target');
            DOM.screens.forEach(s => s.classList.remove('active'));
            document.getElementById(target).classList.add('active');
            DOM.navBtns.forEach(b => b.classList.remove('active'));
            e.currentTarget.classList.add('active');
        });
    });
}

function setupSettings() {
    DOM.highDuration.addEventListener('input', (e) => {
        State.highDuration = parseInt(e.target.value);
        DOM.highDurVal.innerText = State.highDuration;
        if (window.Android) window.Android.setHighDuration(State.highDuration);
    });
    DOM.lowDuration.addEventListener('input', (e) => {
        State.lowDuration = parseInt(e.target.value);
        DOM.lowDurVal.innerText = State.lowDuration;
        if (window.Android) window.Android.setLowDuration(State.lowDuration);
    });
}

// ═══════════════════════════════════════════════════════════════════════
// CALLED FROM NATIVE KOTLIN → updates the UI
// ═══════════════════════════════════════════════════════════════════════

/** Live audio data: RMS + top YAMNet categories */
function updateAudioData(rms, categoriesJson) {
    var maxRms = 0.005;
    var pct = Math.min(rms / maxRms, 1.0) * 100;
    DOM.soundMeterBar.style.width = pct + '%';

    try {
        var cats = JSON.parse(categoriesJson);
        if (cats.length > 0) {
            DOM.detectedSound.innerText = cats[0].label;
            DOM.confidenceScore.innerText = cats[0].score.toFixed(2);

            var score = cats[0].score;
            if (score >= 0.5) DOM.confidenceScore.style.color = 'var(--color-alert)';
            else if (score > 0.2) DOM.confidenceScore.style.color = 'var(--color-detection)';
            else DOM.confidenceScore.style.color = 'var(--text-secondary)';
        }
    } catch(e) {}
}

/** Important sound trigger — show in log and update header */
function showTrigger(label, priority) {
    updateSystemState('detection');
    addLogEntry(label, priority);
}

/** Alert started (vibrating ESP32) */
function onAlertStarted(label, priority, durationSec) {
    State.isAlertActive = true;
    updateSystemState('alert');
    DOM.alertStatusText.innerText = '🔴 ' + label + ' (' + priority.toUpperCase() + ')';
    DOM.alertStatusText.className = 'alert-status-text triggered';
    DOM.btnDismiss.style.display = 'block';
    addLogEntry(label + ' → ALARM', priority);
}

/** Alarm countdown tick */
function onAlarmTick(secondsLeft) {
    DOM.alertStatusText.innerText = '⏱ Alert — ' + secondsLeft + 's remaining';
}

/** Alert stopped */
function onAlertStopped() {
    State.isAlertActive = false;
    DOM.alertStatusText.innerText = 'Safe';
    DOM.alertStatusText.className = 'alert-status-text safe';
    DOM.btnDismiss.style.display = 'none';
    updateSystemState('monitoring');
}

/** BLE connection status */
function updateBleStatus(status) {
    DOM.bleStatus.innerText = status;
    if (status === 'Connected') {
        DOM.bleStatus.style.color = 'var(--green-accent)';
    } else if (status.includes('Scanning') || status.includes('Found')) {
        DOM.bleStatus.style.color = 'var(--color-detection)';
    } else {
        DOM.bleStatus.style.color = 'var(--color-alert)';
    }
}

/** System status text */
function updateStatus(msg) {
    DOM.statusText.innerText = msg;
}

/** Error overlay */
function showError(title, message) {
    DOM.errorTitle.innerText = title;
    DOM.errorMsg.innerText = message;
    DOM.overlay.classList.remove('hidden');
}

// ═══════════════════════════════════════════════════════════════════════
// CALLED BY USER TAP → sends to native Kotlin
// ═══════════════════════════════════════════════════════════════════════

function dismissAlarm() {
    if (window.Android) window.Android.dismissAlarm();
    onAlertStopped();
}

function connectWatch() {
    if (window.Android) window.Android.connectWatch();
}

function testAlert() {
    if (window.Android) {
        window.Android.testAlert();
        var msg = DOM.testResultMsg;
        msg.className = 'msg-box';
        msg.innerText = 'Sending test alert…';
    }
}

function toggleFindWatch() {
    State.isFinding = !State.isFinding;
    if (window.Android) {
        if (State.isFinding) {
            window.Android.findWatchStart();
            DOM.btnFindWatch.innerText = '⏹ Stop Finding';
            DOM.btnFindWatch.classList.add('btn-danger');
            DOM.btnFindWatch.classList.remove('btn-primary');
        } else {
            window.Android.findWatchStop();
            DOM.btnFindWatch.innerText = '🔍 Start Finding';
            DOM.btnFindWatch.classList.add('btn-primary');
            DOM.btnFindWatch.classList.remove('btn-danger');
        }
    }
}

function simulateAlert() {
    if (window.Android) window.Android.simulateAlert();
}

function dismissError() {
    DOM.overlay.classList.add('hidden');
}

// ── UI Helpers ───────────────────────────────────────────────────────

function updateSystemState(state) {
    DOM.header.className = '';
    DOM.statusDot.className = 'dot';
    switch (state) {
        case 'monitoring':
            DOM.header.classList.add('state-monitoring');
            DOM.statusDot.classList.add('monitoring');
            DOM.statusText.innerText = 'Monitoring';
            break;
        case 'detection':
            DOM.header.classList.add('state-detection');
            DOM.statusDot.classList.add('detection');
            DOM.statusText.innerText = 'Sound Detected';
            break;
        case 'alert':
            DOM.header.classList.add('state-alert');
            DOM.statusDot.classList.add('alert');
            DOM.statusText.innerText = 'ALERT!';
            break;
    }
}

function addLogEntry(label, priority) {
    var time = new Date().toLocaleTimeString('en-US', { hour12: false });
    State.log.unshift({ time: time, label: label, priority: priority });
    if (State.log.length > 20) State.log.pop();
    renderLog();
}

function renderLog() {
    DOM.logList.innerHTML = '';
    State.log.forEach(function(item) {
        var li = document.createElement('li');
        li.className = 'log-item';
        var color = item.priority === 'high' ? 'color:var(--color-alert)' : 'color:var(--color-detection)';
        li.innerHTML =
            '<span class="log-time">' + item.time + '</span>' +
            '<span class="log-label">' + item.label + '</span>' +
            '<span class="log-conf" style="' + color + '">' + item.priority.toUpperCase() + '</span>';
        DOM.logList.appendChild(li);
    });
}

// ── Boot ─────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', init);
