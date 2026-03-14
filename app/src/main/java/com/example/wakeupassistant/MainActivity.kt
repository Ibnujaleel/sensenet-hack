package com.example.wakeupassistant

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.CountDownTimer
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.camera.view.PreviewView
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import kotlinx.coroutines.*
import org.json.JSONArray
import org.json.JSONObject

/**
 * ── MainActivity ─────────────────────────────────────────────────────
 *
 * Central orchestrator for the SenseNet wake-up assistant.
 *
 * Test-mode layout:
 *   ┌─────────────────────┐
 *   │  Live Camera Feed   │  ← CameraX PreviewView
 *   │                     │
 *   ├─────────────────────┤
 *   │  Audio Debug + UI   │  ← WebView (index.html)
 *   │  [Dismiss Alarm]    │
 *   └─────────────────────┘
 *
 * In test mode the phone vibrates instead of calling the ESP32.
 */
class MainActivity : AppCompatActivity() {

    companion object {
        private const val TAG = "MainActivity"
        private const val PERMISSION_REQUEST_CODE = 100
        private const val ALARM_TIMEOUT_SECONDS = 60L
    }

    // ── Views ────────────────────────────────────────────────────────

    private lateinit var previewView: PreviewView
    private lateinit var webView: WebView

    // ── Components ───────────────────────────────────────────────────

    private lateinit var audioHelper: AudioClassifierHelper
    private lateinit var imageHelper: ImageDetectionHelper
    private lateinit var esp32Client: Esp32Client
    private lateinit var connectivityMonitor: ConnectivityMonitor
    private lateinit var vibrator: Vibrator

    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())

    @Volatile
    private var isAlarmActive = false
    private var alarmTimer: CountDownTimer? = null

    // ──────────────────────────────────────────────────────────────────
    // Lifecycle
    // ──────────────────────────────────────────────────────────────────

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        // ── 1. Find views ────────────────────────────────────────────
        previewView = findViewById(R.id.previewView)
        webView = findViewById<WebView>(R.id.webView).apply {
            settings.javaScriptEnabled = true
            webViewClient = WebViewClient()
            addJavascriptInterface(WebAppInterface(), "Android")
            loadUrl("file:///android_asset/index.html")
        }

        // ── 2. Vibrator service ──────────────────────────────────────
        vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val vm = getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager
            vm.defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
        }

        // ── 3. Instantiate helpers ───────────────────────────────────
        esp32Client         = Esp32Client()
        audioHelper         = AudioClassifierHelper(this)
        imageHelper         = ImageDetectionHelper(this)
        connectivityMonitor = ConnectivityMonitor(this)

        // ── 4. Wire callbacks ────────────────────────────────────────
        wireAudioCallback()
        wireImageCallback()
        wireConnectivityCallback()

        // Show error in UI if model files are missing
        audioHelper.onModelLoadError = { msg ->
            runOnUiThread {
                Toast.makeText(this, msg, Toast.LENGTH_LONG).show()
                updateWebStatus("❌ $msg")
            }
        }

        // ── 5. Request runtime permissions ───────────────────────────
        requestPermissionsIfNeeded()
    }

    override fun onDestroy() {
        super.onDestroy()
        audioHelper.stopListening()
        imageHelper.shutdown()
        connectivityMonitor.stopMonitoring()
        alarmTimer?.cancel()
        stopVibration()
        scope.cancel()
    }

    // ──────────────────────────────────────────────────────────────────
    // Permissions
    // ──────────────────────────────────────────────────────────────────

    private fun requestPermissionsIfNeeded() {
        val needed = mutableListOf<String>()
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
            != PackageManager.PERMISSION_GRANTED
        ) needed += Manifest.permission.RECORD_AUDIO

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA)
            != PackageManager.PERMISSION_GRANTED
        ) needed += Manifest.permission.CAMERA

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
                Toast.makeText(this, "Mic & Camera permissions are required", Toast.LENGTH_LONG).show()
            }
        }
    }

    private fun onPermissionsGranted() {
        // Start CameraX preview + image capture
        imageHelper.startCamera(this, previewView)

        // Start continuous audio listening
        audioHelper.startListening()

        connectivityMonitor.startMonitoring()
        Log.d(TAG, "Pipeline active – listening + camera preview running")
        updateWebStatus("Listening for sounds…")
    }

    // ──────────────────────────────────────────────────────────────────
    // Callback wiring
    // ──────────────────────────────────────────────────────────────────

    private fun wireAudioCallback() {
        // Live audio data → push to WebView debug panel
        audioHelper.onAudioData = { rms, categories ->
            val jsonArr = JSONArray()
            for ((label, score) in categories) {
                val obj = JSONObject()
                obj.put("label", label)
                obj.put("score", score)
                jsonArr.put(obj)
            }
            val escaped = jsonArr.toString().replace("'", "\\'")
            runOnUiThread {
                webView.evaluateJavascript(
                    "updateAudioData($rms, '$escaped')", null
                )
            }
        }

        // Important sound detected → capture a frame for YOLO (or bypass if model missing)
        audioHelper.onImportantSoundDetected = { label ->
            Log.d(TAG, "Audio trigger: \"$label\"")
            runOnUiThread {
                webView.evaluateJavascript("showTrigger('$label')", null)
            }
            if (!isAlarmActive) {
                if (imageHelper.modelLoaded) {
                    // Full pipeline: capture frame → YOLO → ROI check → alarm
                    runOnUiThread { updateWebStatus("Sound: \"$label\" — verifying with camera…") }
                    imageHelper.captureAndAnalyze()
                } else {
                    // Bypass: no YOLO model → trigger alarm directly from audio
                    Log.w(TAG, "YOLOv8 not loaded — bypassing detection, triggering alarm directly")
                    runOnUiThread {
                        updateWebStatus("⚠️ Sound: \"$label\" — YOLO skipped, alarm!")
                        webView.evaluateJavascript(
                            "updateYoloResult('⏭ Bypassed — yolov8.tflite not loaded')", null
                        )
                    }
                    startAlarm()
                }
            }
        }
    }

    private fun wireImageCallback() {
        imageHelper.onPersonDetectedInROI = {
            Log.d(TAG, "Person confirmed in ROI → starting alarm")
            runOnUiThread {
                updateWebStatus("⚠️ Person detected — alarm!")
                startAlarm()
            }
        }

        imageHelper.onNoPersonDetected = {
            Log.d(TAG, "No person in ROI — false alarm")
            runOnUiThread { updateWebStatus("Listening for sounds…") }
        }

        // Push YOLO detection results to the debug UI
        imageHelper.onDetectionResult = { summary ->
            runOnUiThread {
                webView.evaluateJavascript(
                    "updateYoloResult('${summary.replace("'", "\\'")}')", null
                )
            }
        }
    }

    private fun wireConnectivityCallback() {
        connectivityMonitor.onDisconnected = {
            Log.w(TAG, "Connectivity lost — auto-stopping alarm")
            runOnUiThread {
                stopAlarm()
                updateWebStatus("Disconnected — alarm reset")
            }
        }
    }

    // ──────────────────────────────────────────────────────────────────
    // Alarm management (vibration + ESP32)
    // ──────────────────────────────────────────────────────────────────

    private fun startAlarm() {
        if (isAlarmActive) return
        isAlarmActive = true

        // ── Vibrate the phone (test mode) ────────────────────────────
        startVibration()

        // ── Also try ESP32 (will silently fail if not connected) ─────
        scope.launch {
            esp32Client.sendStart()
        }

        // ── 60-second auto-dismiss timer ─────────────────────────────
        alarmTimer?.cancel()
        alarmTimer = object : CountDownTimer(ALARM_TIMEOUT_SECONDS * 1000, 1000) {
            override fun onTick(millisUntilFinished: Long) {
                val secs = millisUntilFinished / 1000
                updateWebStatus("Alarm active — auto-stop in ${secs}s")
            }
            override fun onFinish() {
                Log.d(TAG, "60s timeout — auto-dismissing alarm")
                stopAlarm()
                updateWebStatus("Alarm auto-dismissed after 60s")
            }
        }.start()
    }

    private fun stopAlarm() {
        if (!isAlarmActive) return
        isAlarmActive = false
        alarmTimer?.cancel()

        stopVibration()

        scope.launch { esp32Client.sendStop() }
        updateWebStatus("Listening for sounds…")
    }

    // ──────────────────────────────────────────────────────────────────
    // Vibration helpers
    // ──────────────────────────────────────────────────────────────────

    private fun startVibration() {
        // Pattern: wait 0ms, vibrate 500ms, pause 300ms — repeat
        val pattern = longArrayOf(0, 500, 300)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            vibrator.vibrate(
                VibrationEffect.createWaveform(pattern, 0 /* repeat from index 0 */)
            )
        } else {
            @Suppress("DEPRECATION")
            vibrator.vibrate(pattern, 0)
        }
        Log.d(TAG, "Vibration started")
    }

    private fun stopVibration() {
        vibrator.cancel()
        Log.d(TAG, "Vibration stopped")
    }

    // ──────────────────────────────────────────────────────────────────
    // WebView JS bridge
    // ──────────────────────────────────────────────────────────────────

    inner class WebAppInterface {
        @JavascriptInterface
        fun dismissAlarm() {
            Log.d(TAG, "Dismiss triggered from WebView")
            runOnUiThread { stopAlarm() }
        }

        /** Direct vibration test – bypasses the entire ML pipeline. */
        @JavascriptInterface
        fun testVibrate() {
            Log.d(TAG, "Test vibrate triggered from WebView")
            runOnUiThread { startAlarm() }
        }

        /** Capture a frame and run YOLO, show results in UI. */
        @JavascriptInterface
        fun testYolo() {
            Log.d(TAG, "Test YOLO triggered from WebView")
            if (!imageHelper.modelLoaded) {
                runOnUiThread {
                    webView.evaluateJavascript(
                        "updateYoloResult('❌ yolov8.tflite not loaded! Place it in assets/')", null
                    )
                }
                return
            }
            imageHelper.captureAndAnalyze()
        }
    }

    private fun updateWebStatus(message: String) {
        webView.evaluateJavascript("updateStatus('$message')", null)
    }
}
