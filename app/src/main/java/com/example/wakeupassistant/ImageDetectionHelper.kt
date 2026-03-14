package com.example.wakeupassistant

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.RectF
import android.util.Log
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import org.tensorflow.lite.Interpreter
import java.io.FileInputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.channels.FileChannel
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * ── ImageDetectionHelper ─────────────────────────────────────────────
 *
 * CameraX-based helper that supports:
 *   1. Live camera preview  → bound to a [PreviewView] in the layout
 *   2. On-demand still capture → decoded & run through YOLOv8 TFLite
 *
 * Model file: app/src/main/assets/yolov8.tflite
 */
class ImageDetectionHelper(private val context: Context) {

    companion object {
        private const val TAG = "ImageDetection"
        private const val MODEL_FILE = "yolov8.tflite"
        private const val INPUT_SIZE = 640
        private const val NUM_CLASSES = 80
        private const val NUM_VALUES = 4 + NUM_CLASSES
        private const val NUM_DETECTIONS = 8400
        private const val PERSON_CONFIDENCE = 0.5f
        private const val PERSON_CLASS = 0

        /** IoU threshold for Non-Maximum Suppression – boxes overlapping
         *  more than this are considered duplicates of the same person. */
        private const val NMS_IOU_THRESHOLD = 0.5f
    }

    // ── State ────────────────────────────────────────────────────────

    private var interpreter: Interpreter? = null
    private var imageCapture: ImageCapture? = null
    private val cameraExecutor: ExecutorService = Executors.newSingleThreadExecutor()

    var onPersonDetectedInROI: (() -> Unit)? = null
    var onNoPersonDetected: (() -> Unit)? = null

    /** Fired with a human-readable summary of what YOLO detected (for debug UI). */
    var onDetectionResult: ((summary: String) -> Unit)? = null

    /** True if yolov8.tflite was loaded successfully. */
    var modelLoaded = false
        private set

    /**
     * Region of Interest in the 640×640 model-coordinate space.
     * Full frame = detect anyone within ~3m of the camera.
     * Shrink this if you want to target a specific area (bed, door, etc.).
     */
    var roi: RectF = RectF(0f, 0f, 640f, 640f)

    // ── Initialization ───────────────────────────────────────────────

    init { loadModel() }

    private fun loadModel() {
        try {
            val fd = context.assets.openFd(MODEL_FILE)
            val input = FileInputStream(fd.fileDescriptor)
            val channel = input.channel
            val model = channel.map(
                FileChannel.MapMode.READ_ONLY, fd.startOffset, fd.declaredLength
            )
            interpreter = Interpreter(model)
            modelLoaded = true
            Log.d(TAG, "YOLOv8 model loaded")
        } catch (e: Exception) {
            modelLoaded = false
            Log.e(TAG, "Failed to load $MODEL_FILE — is it in assets/?", e)
            onDetectionResult?.invoke("❌ YOLOv8 model not found! Place yolov8.tflite in assets/")
        }
    }

    /**
     * Bind CameraX use-cases.
     * @param previewView if non-null, shows a live preview; if null, runs headless (capture only)
     */
    fun startCamera(lifecycleOwner: LifecycleOwner, previewView: PreviewView?) {
        val cameraProviderFuture = ProcessCameraProvider.getInstance(context)
        cameraProviderFuture.addListener({
            val provider = cameraProviderFuture.get()

            // ImageCapture use-case → for on-demand still frames
            imageCapture = ImageCapture.Builder()
                .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
                .build()

            val cameraSelector = CameraSelector.DEFAULT_BACK_CAMERA

            try {
                provider.unbindAll()
                if (previewView != null) {
                    // Preview + capture
                    val preview = Preview.Builder().build().also {
                        it.setSurfaceProvider(previewView.surfaceProvider)
                    }
                    provider.bindToLifecycle(
                        lifecycleOwner, cameraSelector, preview, imageCapture
                    )
                    Log.d(TAG, "CameraX bound – preview + capture")
                } else {
                    // Headless: capture only
                    provider.bindToLifecycle(
                        lifecycleOwner, cameraSelector, imageCapture!!
                    )
                    Log.d(TAG, "CameraX bound – headless capture only")
                }
            } catch (e: Exception) {
                Log.e(TAG, "CameraX bind failed", e)
            }
        }, ContextCompat.getMainExecutor(context))
    }

    // ── Public API ───────────────────────────────────────────────────

    /**
     * Capture a single frame and run YOLO inference on it.
     * The camera stays open (preview continues).
     */
    fun captureAndAnalyze() {
        val capture = imageCapture
        if (capture == null) {
            Log.e(TAG, "ImageCapture not initialised yet")
            onNoPersonDetected?.invoke()
            return
        }

        capture.takePicture(cameraExecutor, object : ImageCapture.OnImageCapturedCallback() {
            override fun onCaptureSuccess(imageProxy: ImageProxy) {
                val bitmap = imageProxyToBitmap(imageProxy)
                imageProxy.close()

                if (bitmap != null) {
                    val resized = Bitmap.createScaledBitmap(bitmap, INPUT_SIZE, INPUT_SIZE, true)
                    runInference(resized)
                } else {
                    Log.e(TAG, "Failed to convert captured image")
                    onNoPersonDetected?.invoke()
                }
            }

            override fun onError(exception: ImageCaptureException) {
                Log.e(TAG, "Capture failed", exception)
                onNoPersonDetected?.invoke()
            }
        })
    }

    fun shutdown() {
        cameraExecutor.shutdown()
    }

    // ── Image conversion ─────────────────────────────────────────────

    private fun imageProxyToBitmap(imageProxy: ImageProxy): Bitmap? {
        val buffer = imageProxy.planes[0].buffer
        val bytes = ByteArray(buffer.remaining())
        buffer.get(bytes)
        return BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
    }

    // ── YOLOv8 inference ─────────────────────────────────────────────

    private fun runInference(bitmap: Bitmap) {
        val model = interpreter
        if (model == null) {
            Log.e(TAG, "Interpreter not loaded")
            onNoPersonDetected?.invoke()
            return
        }

        val inputBuffer = ByteBuffer.allocateDirect(1 * INPUT_SIZE * INPUT_SIZE * 3 * 4)
            .order(ByteOrder.nativeOrder())

        val pixels = IntArray(INPUT_SIZE * INPUT_SIZE)
        bitmap.getPixels(pixels, 0, INPUT_SIZE, 0, 0, INPUT_SIZE, INPUT_SIZE)
        for (px in pixels) {
            inputBuffer.putFloat(((px shr 16) and 0xFF) / 255f)
            inputBuffer.putFloat(((px shr 8) and 0xFF) / 255f)
            inputBuffer.putFloat((px and 0xFF) / 255f)
        }

        val output = Array(1) { Array(NUM_VALUES) { FloatArray(NUM_DETECTIONS) } }

        try {
            model.run(inputBuffer, output)
        } catch (e: Exception) {
            Log.e(TAG, "YOLOv8 inference error", e)
            onNoPersonDetected?.invoke()
            return
        }

        // ── Collect raw person detections ─────────────────────────────
        val rawDetections = mutableListOf<Detection>()

        for (i in 0 until NUM_DETECTIONS) {
            val conf = output[0][4 + PERSON_CLASS][i]
            if (conf < PERSON_CONFIDENCE) continue

            val cx = output[0][0][i]
            val cy = output[0][1][i]
            val w = output[0][2][i]
            val h = output[0][3][i]
            val box = RectF(cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2)
            rawDetections.add(Detection(box, conf))
        }

        // ── Non-Maximum Suppression (NMS) ─────────────────────────────
        // Remove overlapping boxes that are detecting the same person
        val nmsDetections = applyNMS(rawDetections)

        // ── Check ROI and build summary ───────────────────────────────
        var personInRoiFound = false
        var bestConf = 0f

        for (det in nmsDetections) {
            if (det.conf > bestConf) bestConf = det.conf
            if (isPersonInROI(det.box)) {
                Log.i(TAG, "✅ Person in ROI (conf=${det.conf}, box=${det.box})")
                personInRoiFound = true
            }
        }

        val summary = if (nmsDetections.isNotEmpty()) {
            "👤 ${nmsDetections.size} person(s) detected (best: ${String.format("%.0f", bestConf * 100)}%) | " +
                if (personInRoiFound) "✅ IN ROI → alarm!" else "⬜ Outside ROI"
        } else {
            "No person detected"
        }
        onDetectionResult?.invoke(summary)

        if (personInRoiFound) onPersonDetectedInROI?.invoke()
        else {
            Log.d(TAG, summary)
            onNoPersonDetected?.invoke()
        }
    }

    fun isPersonInROI(boundingBox: RectF): Boolean =
        RectF.intersects(roi, boundingBox)

    // ── Non-Maximum Suppression ──────────────────────────────────────

    private data class Detection(val box: RectF, val conf: Float)

    /**
     * Filters overlapping bounding boxes, keeping only the highest-confidence
     * detection per physical person.
     */
    private fun applyNMS(detections: List<Detection>): List<Detection> {
        if (detections.isEmpty()) return emptyList()

        // Sort by confidence descending
        val sorted = detections.sortedByDescending { it.conf }.toMutableList()
        val kept = mutableListOf<Detection>()

        while (sorted.isNotEmpty()) {
            val best = sorted.removeAt(0)
            kept.add(best)

            // Remove all remaining boxes that overlap too much with `best`
            sorted.removeAll { other -> computeIoU(best.box, other.box) > NMS_IOU_THRESHOLD }
        }
        return kept
    }

    /** Compute Intersection-over-Union between two rectangles. */
    private fun computeIoU(a: RectF, b: RectF): Float {
        val interLeft   = maxOf(a.left, b.left)
        val interTop    = maxOf(a.top, b.top)
        val interRight  = minOf(a.right, b.right)
        val interBottom = minOf(a.bottom, b.bottom)

        val interArea = maxOf(0f, interRight - interLeft) * maxOf(0f, interBottom - interTop)
        if (interArea == 0f) return 0f

        val aArea = (a.right - a.left) * (a.bottom - a.top)
        val bArea = (b.right - b.left) * (b.bottom - b.top)
        return interArea / (aArea + bArea - interArea)
    }
}
