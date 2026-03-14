package com.example.wakeupassistant

import android.Manifest
import android.annotation.SuppressLint
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.CountDownTimer
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject

/**
 * ── MainActivity ─────────────────────────────────────────────────────
 *
 * Central orchestrator for SenseNet.
 *
 *  Audio (YAMNet) → classify → important? → priority (high/low)
 *       ↓ (if YOLO loaded)
 *  Camera (YOLOv8) → person in ROI?
 *       ↓
 *  BLE → write '1' to ESP32 → motor vibrates for [duration]s
 *       ↓
 *  Dismiss / timeout → write '0' to ESP32
 */
class MainActivity : AppCompatActivity() {

    companion object {
        private const val TAG = "MainActivity"
        private const val PERMISSION_REQUEST_CODE = 100
    }

    // ── Views ────────────────────────────────────────────────────────
    private lateinit var webView: WebView

    // ── Components ───────────────────────────────────────────────────
    private lateinit var audioHelper: AudioClassifierHelper
    private lateinit var imageHelper: ImageDetectionHelper
    private lateinit var bleManager: BleWatchManager
    private lateinit var connectivityMonitor: ConnectivityMonitor

    // ── Alert state ──────────────────────────────────────────────────
    @Volatile private var isAlarmActive = false
    private var alarmTimer: CountDownTimer? = null

    // ── User-configurable durations (seconds) ────────────────────────
    private var highPriorityDuration = 60L
    private var lowPriorityDuration  = 20L

    // ──────────────────────────────────────────────────────────────────
    // Lifecycle
    // ──────────────────────────────────────────────────────────────────

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        // ── 1. WebView ───────────────────────────────────────────────
        webView = findViewById<WebView>(R.id.webView).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            webViewClient = WebViewClient()
            addJavascriptInterface(WebAppInterface(), "Android")
            loadUrl("file:///android_asset/index.html")
        }

        // ── 2. Helpers ───────────────────────────────────────────────
        audioHelper         = AudioClassifierHelper(this)
        imageHelper         = ImageDetectionHelper(this)
        bleManager          = BleWatchManager(this)
        connectivityMonitor = ConnectivityMonitor(this)

        // ── 3. Wire callbacks ────────────────────────────────────────
        wireAudioCallbacks()
        wireImageCallbacks()
        wireBleCallbacks()
        wireConnectivityCallback()

        // Show error if model files are missing
        audioHelper.onModelLoadError = { msg ->
            runOnUiThread {
                Toast.makeText(this, msg, Toast.LENGTH_LONG).show()
                evalJs("showError('Model Error', '$msg')")
            }
        }

        // ── 4. Request permissions ───────────────────────────────────
        requestPermissionsIfNeeded()
    }

    override fun onDestroy() {
        super.onDestroy()
        audioHelper.stopListening()
        imageHelper.shutdown()
        bleManager.disconnect()
        connectivityMonitor.stopMonitoring()
        alarmTimer?.cancel()
    }

    // ──────────────────────────────────────────────────────────────────
    // Permissions
    // ──────────────────────────────────────────────────────────────────

    private fun requestPermissionsIfNeeded() {
        val needed = mutableListOf<String>()

        // Mic + Camera
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
            != PackageManager.PERMISSION_GRANTED) needed += Manifest.permission.RECORD_AUDIO
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA)
            != PackageManager.PERMISSION_GRANTED) needed += Manifest.permission.CAMERA

        // BLE (Android 12+)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_SCAN)
                != PackageManager.PERMISSION_GRANTED) needed += Manifest.permission.BLUETOOTH_SCAN
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_CONNECT)
                != PackageManager.PERMISSION_GRANTED) needed += Manifest.permission.BLUETOOTH_CONNECT
        } else {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
                != PackageManager.PERMISSION_GRANTED) needed += Manifest.permission.ACCESS_FINE_LOCATION
        }

        if (needed.isNotEmpty()) {
            ActivityCompat.requestPermissions(this, needed.toTypedArray(), PERMISSION_REQUEST_CODE)
        } else {
            onPermissionsGranted()
        }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int, permissions: Array<out String>, grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == PERMISSION_REQUEST_CODE) {
            if (grantResults.all { it == PackageManager.PERMISSION_GRANTED }) {
                onPermissionsGranted()
            } else {
                Toast.makeText(this, "All permissions are required", Toast.LENGTH_LONG).show()
            }
        }
    }

    private fun onPermissionsGranted() {
        // Start audio
        audioHelper.startListening()
        connectivityMonitor.startMonitoring()

        // Start BLE scan
        if (bleManager.hasPermissions()) {
            bleManager.startScan()
        }

        // Start camera (headless — no preview, just for YOLO capture)
        imageHelper.startCamera(this, null)

        Log.d(TAG, "Pipeline active")
        evalJs("updateStatus('Monitoring')")
        evalJs("updateSystemState('monitoring')")
    }

    // ──────────────────────────────────────────────────────────────────
    // Callback wiring
    // ──────────────────────────────────────────────────────────────────

    private fun wireAudioCallbacks() {
        // Live audio data → WebView
        audioHelper.onAudioData = { rms, categories ->
            val jsonArr = JSONArray()
            for ((label, score) in categories) {
                val obj = JSONObject()
                obj.put("label", label)
                obj.put("score", score)
                jsonArr.put(obj)
            }
            val escaped = jsonArr.toString().replace("'", "\\'")
            runOnUiThread { evalJs("updateAudioData($rms, '$escaped')") }
        }

        // Important sound → camera capture or direct alarm
        audioHelper.onImportantSoundDetected = { label, priority ->
            Log.d(TAG, "Audio trigger: \"$label\" (priority=$priority)")
            runOnUiThread { evalJs("showTrigger('${esc(label)}', '$priority')") }

            if (!isAlarmActive) {
                if (priority == "high") {
                    // HIGH priority → skip person detection, alarm immediately
                    Log.d(TAG, "HIGH priority — skipping YOLO, triggering alarm directly")
                    runOnUiThread { startAlarm(label, priority) }
                } else if (imageHelper.modelLoaded) {
                    // LOW priority → verify with camera first
                    runOnUiThread { evalJs("updateStatus('Verifying with camera…')") }
                    pendingAlertLabel = label
                    pendingAlertPriority = priority
                    imageHelper.captureAndAnalyze()
                } else {
                    // No YOLO model — trigger directly
                    runOnUiThread { startAlarm(label, priority) }
                }
            }
        }
    }

    // Temp storage for label/priority between audio trigger and YOLO result
    @Volatile private var pendingAlertLabel = ""
    @Volatile private var pendingAlertPriority = "low"

    private fun wireImageCallbacks() {
        imageHelper.onPersonDetectedInROI = {
            Log.d(TAG, "Person in ROI → alarm")
            runOnUiThread { startAlarm(pendingAlertLabel, pendingAlertPriority) }
        }

        imageHelper.onNoPersonDetected = {
            Log.d(TAG, "No person in ROI — false alarm")
            runOnUiThread { evalJs("updateStatus('Monitoring')") }
        }

        imageHelper.onDetectionResult = { summary ->
            Log.d(TAG, "YOLO: $summary")
        }
    }

    private fun wireBleCallbacks() {
        bleManager.onConnected = {
            Log.d(TAG, "BLE connected")
            runOnUiThread { evalJs("updateBleStatus('Connected')") }
        }
        bleManager.onDisconnected = {
            Log.d(TAG, "BLE disconnected")
            runOnUiThread { evalJs("updateBleStatus('Disconnected')") }
        }
        bleManager.onError = { msg ->
            Log.e(TAG, "BLE error: $msg")
            runOnUiThread { evalJs("updateBleStatus('${esc(msg)}')") }
        }
        bleManager.onScanStatus = { msg ->
            Log.d(TAG, "BLE scan: $msg")
            runOnUiThread { evalJs("updateBleStatus('${esc(msg)}')") }
        }
    }

    private fun wireConnectivityCallback() {
        connectivityMonitor.onDisconnected = {
            Log.w(TAG, "Connectivity lost")
            runOnUiThread {
                stopAlarm()
                evalJs("updateStatus('Disconnected')")
            }
        }
    }

    // ──────────────────────────────────────────────────────────────────
    // Alarm management
    // ──────────────────────────────────────────────────────────────────

    private fun startAlarm(label: String, priority: String) {
        if (isAlarmActive) return
        isAlarmActive = true

        val duration = if (priority == "high") highPriorityDuration else lowPriorityDuration

        // Send 'H' or 'L' to ESP32 via BLE
        bleManager.triggerAlert(priority)

        // Update UI
        evalJs("onAlertStarted('${esc(label)}', '$priority', $duration)")

        // Auto-dismiss timer
        alarmTimer?.cancel()
        alarmTimer = object : CountDownTimer(duration * 1000, 1000) {
            override fun onTick(millisUntilFinished: Long) {
                val secs = millisUntilFinished / 1000
                evalJs("onAlarmTick($secs)")
            }
            override fun onFinish() {
                Log.d(TAG, "Timer finished — auto-dismissing")
                stopAlarm()
            }
        }.start()
    }

    private fun stopAlarm() {
        if (!isAlarmActive) return
        isAlarmActive = false
        alarmTimer?.cancel()

        // Send '0' to ESP32 via BLE
        bleManager.stopAlert()

        evalJs("onAlertStopped()")
        evalJs("updateStatus('Monitoring')")
    }

    // ──────────────────────────────────────────────────────────────────
    // WebView JS bridge
    // ──────────────────────────────────────────────────────────────────

    inner class WebAppInterface {

        @JavascriptInterface
        fun dismissAlarm() {
            Log.d(TAG, "JS: dismissAlarm")
            runOnUiThread { stopAlarm() }
        }

        @JavascriptInterface
        fun connectWatch() {
            Log.d(TAG, "JS: connectWatch")
            if (bleManager.hasPermissions()) {
                bleManager.startScan()
            } else {
                runOnUiThread {
                    Toast.makeText(this@MainActivity, "BLE permissions needed", Toast.LENGTH_SHORT).show()
                }
            }
        }

        @JavascriptInterface
        fun testAlert() {
            Log.d(TAG, "JS: testAlert")
            bleManager.triggerAlert("high") // Test always uses high priority
            // Auto-stop after 3 seconds
            runOnUiThread {
                android.os.Handler(mainLooper).postDelayed({
                    bleManager.stopAlert()
                    evalJs("document.getElementById('test-result-msg').className='msg-box msg-success'")
                    evalJs("document.getElementById('test-result-msg').innerText='Test alert sent!'")
                }, 3000)
            }
        }

        @JavascriptInterface
        fun findWatchStart() {
            Log.d(TAG, "JS: findWatchStart")
            bleManager.findWatch()
        }

        @JavascriptInterface
        fun findWatchStop() {
            Log.d(TAG, "JS: findWatchStop")
            bleManager.stopFind()
        }

        @JavascriptInterface
        fun simulateAlert() {
            Log.d(TAG, "JS: simulateAlert")
            runOnUiThread { startAlarm("Fire Alarm (Demo)", "high") }
        }

        @JavascriptInterface
        fun setHighDuration(seconds: Int) {
            highPriorityDuration = seconds.toLong()
            Log.d(TAG, "High priority duration set to ${seconds}s")
        }

        @JavascriptInterface
        fun setLowDuration(seconds: Int) {
            lowPriorityDuration = seconds.toLong()
            Log.d(TAG, "Low priority duration set to ${seconds}s")
        }
    }

    // ──────────────────────────────────────────────────────────────────
    // Helpers
    // ──────────────────────────────────────────────────────────────────

    private fun evalJs(js: String) {
        webView.evaluateJavascript(js, null)
    }

    /** Escape single quotes for safe JS string injection */
    private fun esc(s: String) = s.replace("'", "\\'")
}
