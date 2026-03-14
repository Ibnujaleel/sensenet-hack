package com.example.wakeupassistant

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.util.Log

/**
 * ── ConnectivityMonitor ──────────────────────────────────────────────
 *
 * Watches the device's WiFi connectivity (which is the mobile-hotspot
 * link to the ESP32). When the link drops, [onDisconnected] fires so
 * that the caller can gracefully reset the alarm state.
 */
class ConnectivityMonitor(context: Context) {

    companion object {
        private const val TAG = "ConnectivityMonitor"
    }

    /** Called on the main thread when WiFi connectivity is lost. */
    var onDisconnected: (() -> Unit)? = null

    private val connectivityManager =
        context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager

    private val networkCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onLost(network: Network) {
            Log.w(TAG, "WiFi / hotspot connection lost")
            onDisconnected?.invoke()
        }

        override fun onUnavailable() {
            Log.w(TAG, "WiFi / hotspot unavailable")
            onDisconnected?.invoke()
        }
    }

    /** Start monitoring WiFi transport. */
    fun startMonitoring() {
        val request = NetworkRequest.Builder()
            .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
            .build()
        try {
            connectivityManager.registerNetworkCallback(request, networkCallback)
            Log.d(TAG, "Network monitoring started")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to register network callback", e)
        }
    }

    /** Stop monitoring – call in onDestroy(). */
    fun stopMonitoring() {
        try {
            connectivityManager.unregisterNetworkCallback(networkCallback)
        } catch (_: Exception) { /* already unregistered */ }
    }
}
