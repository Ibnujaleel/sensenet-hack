package com.example.wakeupassistant

import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.net.HttpURLConnection
import java.net.URL

/**
 * ── Esp32Client ──────────────────────────────────────────────────────
 *
 * Lightweight HTTP client that talks to the ESP32 web-server running
 * on the phone's mobile-hotspot subnet.
 *
 * The ESP32 is expected to expose two endpoints:
 *   GET /start   →  begin vibration
 *   GET /stop    →  stop  vibration
 *
 * Adjust [espIpAddress] to match the static IP your friend configures
 * on the ESP32 side (the default Android hotspot gateway is 192.168.43.1,
 * so the ESP32 might be .2, .100, etc.).
 */
class Esp32Client(private val espIpAddress: String = ESP32_DEFAULT_IP) {

    companion object {
        private const val TAG = "Esp32Client"
        /** Change this to match your ESP32's static IP on the hotspot */
        const val ESP32_DEFAULT_IP = "192.168.43.100"
        private const val TIMEOUT_MS = 3_000
    }

    // ── Public API ───────────────────────────────────────────────────

    /** Tell the ESP32 to START vibrating. Returns true on HTTP 200. */
    suspend fun sendStart(): Boolean = httpGet("start")

    /** Tell the ESP32 to STOP  vibrating. Returns true on HTTP 200. */
    suspend fun sendStop(): Boolean = httpGet("stop")

    // ── Internals ────────────────────────────────────────────────────

    private suspend fun httpGet(endpoint: String): Boolean =
        withContext(Dispatchers.IO) {
            try {
                val url = URL("http://$espIpAddress/$endpoint")
                val conn = (url.openConnection() as HttpURLConnection).apply {
                    requestMethod  = "GET"
                    connectTimeout = TIMEOUT_MS
                    readTimeout    = TIMEOUT_MS
                }
                val code = conn.responseCode
                conn.disconnect()
                Log.d(TAG, "GET /$endpoint → $code")
                code == HttpURLConnection.HTTP_OK
            } catch (e: Exception) {
                Log.e(TAG, "GET /$endpoint failed (ESP32 unreachable?)", e)
                false
            }
        }
}
