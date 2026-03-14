package com.example.wakeupassistant

import android.content.Context
import android.media.AudioRecord
import android.util.Log
import kotlin.math.sqrt
import org.tensorflow.lite.task.audio.classifier.AudioClassifier
import org.tensorflow.lite.task.core.BaseOptions

/**
 * ── AudioClassifierHelper ────────────────────────────────────────────
 *
 * Continuously records audio through the device mic and classifies
 * environmental sounds using a YAMNet TFLite model.
 *
 * Pipeline:
 *   1. Record a short audio window via the TFLite Audio Task API
 *   2. Compute volume (RMS) – skip quiet frames to save battery
 *   3. Run YAMNet inference → list of (label, score) pairs
 *   4. Check [isSoundImportant] against a curated list
 *   5. Fire [onImportantSoundDetected] callback if criteria met
 *
 * Test-mode addition:
 *   [onAudioData] fires every cycle with live RMS + top classifications
 *   so the UI can display them in real time.
 *
 * ─── Model file ──────────────────────────────────────────────────────
 * Place the YAMNet model at:
 *   app/src/main/assets/yamnet.tflite
 */
class AudioClassifierHelper(private val context: Context) {

    companion object {
        private const val TAG = "AudioClassifier"
        private const val MODEL_FILE = "yamnet.tflite"

        const val VOLUME_THRESHOLD = 0.001f  // Very low for testing – catches any sound
        private const val MIN_CONFIDENCE = 0.2f  // Lowered for testing
        private const val POLL_INTERVAL_MS = 500L
        private const val COOLDOWN_MS = 2_000L
    }

    // ── State ────────────────────────────────────────────────────────

    private var audioClassifier: AudioClassifier? = null
    private var audioRecord: AudioRecord? = null

    @Volatile
    var isListening = false
        private set

    /** Fired on a background thread when an important sound is classified. */
    var onImportantSoundDetected: ((label: String) -> Unit)? = null

    /** Fired every classification cycle with live audio data for the debug UI. */
    var onAudioData: ((rms: Float, categories: List<Pair<String, Float>>) -> Unit)? = null

    /** Fired if the model fails to load — use to show an error in the UI. */
    var onModelLoadError: ((error: String) -> Unit)? = null

    /** True if yamnet.tflite was loaded successfully. */
    var modelLoaded = false
        private set

    // ── Initialization ───────────────────────────────────────────────

    init { loadModel() }

    private fun loadModel() {
        try {
            val baseOpts = BaseOptions.builder().build()
            val opts = AudioClassifier.AudioClassifierOptions.builder()
                .setBaseOptions(baseOpts)
                .setMaxResults(5)
                .build()
            audioClassifier =
                AudioClassifier.createFromFileAndOptions(context, MODEL_FILE, opts)
            modelLoaded = true
            Log.d(TAG, "YAMNet model loaded successfully")
        } catch (e: Exception) {
            modelLoaded = false
            val msg = "YAMNet model not found! Place yamnet.tflite in app/src/main/assets/"
            Log.e(TAG, msg, e)
            onModelLoadError?.invoke(msg)
        }
    }

    // ── Public API ───────────────────────────────────────────────────

    fun startListening() {
        val classifier = audioClassifier
        if (classifier == null) {
            val msg = "Cannot start – yamnet.tflite not loaded. Place it in assets/"
            Log.e(TAG, msg)
            onModelLoadError?.invoke(msg)
            return
        }
        if (isListening) return

        val tensorAudio = classifier.createInputTensorAudio()
        audioRecord = classifier.createAudioRecord()
        audioRecord?.startRecording()
        isListening = true

        Thread(Runnable {
            Log.d(TAG, "Listening thread started")
            while (isListening) {
                try {
                    tensorAudio.load(audioRecord!!)

                    // ── 1. Compute volume ─────────────────────────
                    val samples = tensorAudio.tensorBuffer.floatArray
                    val rms = computeRMS(samples)

                    // ── 2. Classify (always, so we can show debug data) ──
                    val results = classifier.classify(tensorAudio)
                    val categoryPairs = if (results.isNotEmpty()) {
                        results[0].categories.map { it.label to it.score }
                    } else {
                        emptyList()
                    }

                    // ── 3. Push live data to debug UI ─────────────
                    onAudioData?.invoke(rms, categoryPairs)

                    // ── 4. Volume gate for important-sound trigger ─
                    if (rms >= VOLUME_THRESHOLD && results.isNotEmpty()) {
                        for (category in results[0].categories) {
                            if (category.score >= MIN_CONFIDENCE &&
                                isSoundImportant(category.label)
                            ) {
                                Log.i(TAG,
                                    "⚡ Important sound: \"${category.label}\" " +
                                    "(conf=${category.score}, rms=$rms)"
                                )
                                onImportantSoundDetected?.invoke(category.label)
                                Thread.sleep(COOLDOWN_MS)
                                break
                            }
                        }
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Classification loop error", e)
                }
                Thread.sleep(POLL_INTERVAL_MS)
            }
            Log.d(TAG, "Listening thread stopped")
        }, "AudioClassifier-Thread").start()
    }

    fun stopListening() {
        isListening = false
        try {
            audioRecord?.stop()
            audioRecord?.release()
        } catch (_: Exception) { }
        audioRecord = null
    }

    // ── Helpers ──────────────────────────────────────────────────────

    private fun computeRMS(samples: FloatArray): Float {
        if (samples.isEmpty()) return 0f
        var sumSq = 0.0
        for (s in samples) sumSq += (s * s)
        return sqrt(sumSq / samples.size).toFloat()
    }

    fun isSoundImportant(category: String): Boolean {
        val importantKeywords = listOf(
            "speech", "talking", "conversation",   // Added for testing
            "knock", "door", "siren", "fire alarm", "smoke detector",
            "alarm", "emergency vehicle", "screaming", "glass breaking",
            "gunshot", "explosion", "bell", "buzzer", "doorbell"
        )
        val lower = category.lowercase()
        return importantKeywords.any { lower.contains(it) }
    }
}
