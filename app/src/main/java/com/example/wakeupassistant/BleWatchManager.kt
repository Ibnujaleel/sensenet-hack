package com.example.wakeupassistant

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.*
import android.bluetooth.le.*
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.core.content.ContextCompat
import java.util.UUID

/**
 * ── BleWatchManager ──────────────────────────────────────────────────
 *
 * Manages the entire BLE lifecycle for communicating with the
 * SenseNet ESP32 wristwatch:
 *
 *   1. Scan for device named "SenseNet_Watch"
 *   2. Connect via GATT
 *   3. Discover service & characteristic
 *   4. Write single-char commands:
 *        '1' → Emergency (motor + LED)
 *        'F' → Find Watch (LED flash)
 *        '0' → Stop all alerts
 *
 * ── ESP32 BLE UUIDs ──────────────────────────────────────────────────
 * Service:        4fafc201-1fb5-459e-8fcc-c5c9c331914b
 * Characteristic: beb5483e-36e1-4688-b7f5-ea07361b26a8
 */
@SuppressLint("MissingPermission")
class BleWatchManager(private val context: Context) {

    companion object {
        private const val TAG = "BleWatchManager"
        private const val DEVICE_NAME = "SenseNet_Watch"
        private const val SCAN_TIMEOUT_MS = 15_000L

        private val SERVICE_UUID =
            UUID.fromString("4fafc201-1fb5-459e-8fcc-c5c9c331914b")
        private val CHARACTERISTIC_UUID =
            UUID.fromString("beb5483e-36e1-4688-b7f5-ea07361b26a8")

        // Single-char commands matching sensenet.ino
        private const val CMD_HIGH = "H"
        private const val CMD_LOW  = "L"
        private const val CMD_STOP = "0"
        private const val CMD_FIND = "F"
    }

    // ── State ────────────────────────────────────────────────────────

    private val adapter: BluetoothAdapter? =
        (context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter

    private var scanner: BluetoothLeScanner? = null
    private var gatt: BluetoothGatt? = null
    private var characteristic: BluetoothGattCharacteristic? = null
    private val handler = Handler(Looper.getMainLooper())

    @Volatile var isConnected = false; private set
    @Volatile var isScanning  = false; private set

    // ── Callbacks for the Activity ───────────────────────────────────

    var onConnected:    (() -> Unit)? = null
    var onDisconnected: (() -> Unit)? = null
    var onError:        ((msg: String) -> Unit)? = null
    var onScanStatus:   ((msg: String) -> Unit)? = null

    // ── Permission check ─────────────────────────────────────────────

    fun hasPermissions(): Boolean {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            return ContextCompat.checkSelfPermission(
                context, Manifest.permission.BLUETOOTH_SCAN
            ) == PackageManager.PERMISSION_GRANTED &&
            ContextCompat.checkSelfPermission(
                context, Manifest.permission.BLUETOOTH_CONNECT
            ) == PackageManager.PERMISSION_GRANTED
        }
        // Pre-Android 12 only needs location
        return ContextCompat.checkSelfPermission(
            context, Manifest.permission.ACCESS_FINE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED
    }

    // ── Scan ─────────────────────────────────────────────────────────

    fun startScan() {
        if (isConnected) {
            onScanStatus?.invoke("Already connected")
            return
        }
        if (isScanning) return

        val bt = adapter
        if (bt == null || !bt.isEnabled) {
            onError?.invoke("Bluetooth is OFF — enable it in Settings")
            return
        }

        scanner = bt.bluetoothLeScanner
        if (scanner == null) {
            onError?.invoke("BLE scanner unavailable — is Location ON?")
            return
        }

        isScanning = true
        onScanStatus?.invoke("Scanning for $DEVICE_NAME…")
        Log.d(TAG, "BLE scan started")

        // Use low latency for fast discovery
        val settings = ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
            .build()

        scanner?.startScan(null, settings, scanCallback)

        // Auto-stop scan after timeout
        handler.postDelayed({
            if (isScanning) {
                stopScan()
                if (!isConnected) {
                    onError?.invoke("$DEVICE_NAME not found — check: 1) ESP32 powered on 2) Bluetooth ON 3) Location ON")
                }
            }
        }, SCAN_TIMEOUT_MS)
    }

    fun stopScan() {
        if (!isScanning) return
        isScanning = false
        try { scanner?.stopScan(scanCallback) } catch (_: Exception) {}
        Log.d(TAG, "BLE scan stopped")
    }

    private val scanCallback = object : ScanCallback() {
        override fun onScanResult(callbackType: Int, result: ScanResult) {
            // Check BOTH sources — device.name is often null on Android
            val deviceName = result.device?.name
                ?: result.scanRecord?.deviceName
                ?: return

            Log.d(TAG, "Found BLE device: \"$deviceName\" (${result.device.address})")

            if (deviceName == DEVICE_NAME) {
                Log.d(TAG, "✅ Found $DEVICE_NAME — connecting…")
                stopScan()
                onScanStatus?.invoke("Found $DEVICE_NAME — connecting…")
                connectToDevice(result.device)
            }
        }

        override fun onScanFailed(errorCode: Int) {
            isScanning = false
            Log.e(TAG, "BLE scan failed: errorCode=$errorCode")
            val msg = when (errorCode) {
                SCAN_FAILED_ALREADY_STARTED -> "Scan already running"
                SCAN_FAILED_APPLICATION_REGISTRATION_FAILED -> "App registration failed — restart Bluetooth"
                SCAN_FAILED_FEATURE_UNSUPPORTED -> "BLE scanning not supported on this device"
                SCAN_FAILED_INTERNAL_ERROR -> "Internal BLE error — toggle Bluetooth OFF/ON"
                else -> "BLE scan failed (error $errorCode)"
            }
            onError?.invoke(msg)
        }
    }

    // ── GATT Connection ──────────────────────────────────────────────

    private fun connectToDevice(device: BluetoothDevice) {
        gatt = device.connectGatt(context, false, gattCallback, BluetoothDevice.TRANSPORT_LE)
    }

    private val gattCallback = object : BluetoothGattCallback() {

        override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) {
            when (newState) {
                BluetoothProfile.STATE_CONNECTED -> {
                    Log.d(TAG, "GATT connected — discovering services")
                    g.discoverServices()
                }
                BluetoothProfile.STATE_DISCONNECTED -> {
                    Log.d(TAG, "GATT disconnected")
                    isConnected = false
                    characteristic = null
                    handler.post { onDisconnected?.invoke() }
                }
            }
        }

        override fun onServicesDiscovered(g: BluetoothGatt, status: Int) {
            if (status != BluetoothGatt.GATT_SUCCESS) {
                Log.e(TAG, "Service discovery failed: $status")
                handler.post { onError?.invoke("Service discovery failed") }
                return
            }

            val service = g.getService(SERVICE_UUID)
            if (service == null) {
                Log.e(TAG, "Target service not found on device")
                handler.post { onError?.invoke("SenseNet service not found on watch") }
                return
            }

            characteristic = service.getCharacteristic(CHARACTERISTIC_UUID)
            if (characteristic == null) {
                Log.e(TAG, "Target characteristic not found")
                handler.post { onError?.invoke("SenseNet characteristic not found") }
                return
            }

            isConnected = true
            Log.d(TAG, "✅ Ready — service & characteristic discovered")
            handler.post { onConnected?.invoke() }
        }
    }

    // ── Public Commands ──────────────────────────────────────────────

    /** Send 'H' or 'L' → ESP32 starts servo + LED based on priority */
    fun triggerAlert(priority: String) {
        writeCommand(if (priority == "high") CMD_HIGH else CMD_LOW)
    }

    /** Send '0' → ESP32 stops motor + LED, LCD "System Active" */
    fun stopAlert() = writeCommand(CMD_STOP)

    /** Send 'F' → ESP32 flashes red LED rapidly */
    fun findWatch() = writeCommand(CMD_FIND)

    /** Send '0' → ESP32 stops find mode (same as stopAlert) */
    fun stopFind() = writeCommand(CMD_STOP)

    // ── Disconnect / Cleanup ─────────────────────────────────────────

    fun disconnect() {
        try {
            gatt?.disconnect()
            gatt?.close()
        } catch (_: Exception) {}
        gatt = null
        characteristic = null
        isConnected = false
    }

    // ── Internal write helper ────────────────────────────────────────

    private fun writeCommand(cmd: String) {
        val char = characteristic
        val g = gatt

        if (g == null || char == null || !isConnected) {
            Log.w(TAG, "Cannot write '$cmd' — not connected (gatt=$g, char=$char, connected=$isConnected)")
            onError?.invoke("Watch not connected")
            return
        }

        Log.d(TAG, "Writing command: '$cmd' to ${char.uuid}")

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            // Android 13+ API
            val result = g.writeCharacteristic(
                char, cmd.toByteArray(Charsets.UTF_8),
                BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
            )
            Log.d(TAG, "writeCharacteristic (API 33+) result: $result")
        } else {
            // Legacy API — must set writeType explicitly
            @Suppress("DEPRECATION")
            char.writeType = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
            @Suppress("DEPRECATION")
            char.value = cmd.toByteArray(Charsets.UTF_8)
            @Suppress("DEPRECATION")
            val result = g.writeCharacteristic(char)
            Log.d(TAG, "writeCharacteristic (legacy) result: $result")
        }
    }
}
