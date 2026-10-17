package com.pranix.quietkeep.plugins;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattDescriptor;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothProfile;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanResult;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

/**
 * QkObdPlugin — Capacitor plugin for Bluetooth Low Energy (BLE) OBD-II readers (DRV-06).
 * Supports standard ELM327 BLE adapters (e.g. Vgate iCar Pro 2S, vLinker MC+, generic BLE OBD).
 * Classic Bluetooth (SPP) is intentionally out of scope for v1.
 */
@CapacitorPlugin(
    name = "QkObd",
    permissions = {
        @Permission(
            alias = "bluetooth",
            strings = {
                Manifest.permission.BLUETOOTH_SCAN,
                Manifest.permission.BLUETOOTH_CONNECT
            }
        ),
        @Permission(
            alias = "location",
            strings = {
                Manifest.permission.ACCESS_FINE_LOCATION
            }
        )
    }
)
public class QkObdPlugin extends Plugin {
    private static final String TAG = "QK_OBD_PLUGIN";

    // Known BLE ELM327 Service & Characteristic UUIDs
    // Service FFF0 (Vgate / standard BLE OBD)
    private static final UUID UUID_SERVICE_FFF0 = UUID.fromString("0000FFF0-0000-1000-8000-00805F9B34FB");
    private static final UUID UUID_NOTIFY_FFF1  = UUID.fromString("0000FFF1-0000-1000-8000-00805F9B34FB");
    private static final UUID UUID_WRITE_FFF2   = UUID.fromString("0000FFF2-0000-1000-8000-00805F9B34FB");

    // Service 18F0 (Alternative Microchip / BLE OBD)
    private static final UUID UUID_SERVICE_18F0 = UUID.fromString("000018F0-0000-1000-8000-00805F9B34FB");
    private static final UUID UUID_NOTIFY_2AF0  = UUID.fromString("00002AF0-0000-1000-8000-00805F9B34FB");
    private static final UUID UUID_WRITE_2AF1   = UUID.fromString("00002AF1-0000-1000-8000-00805F9B34FB");

    // Standard Client Characteristic Configuration Descriptor (CCCD)
    private static final UUID UUID_CCCD = UUID.fromString("00002902-0000-1000-8000-00805F9B34FB");

    private BluetoothAdapter mBluetoothAdapter;
    private BluetoothGatt mGatt;
    private BluetoothGattCharacteristic mNotifyChar;
    private BluetoothGattCharacteristic mWriteChar;
    private boolean mConnected = false;

    private PluginCall mPendingConnectCall = null;
    private PluginCall mPendingScanCall = null;
    private ScanCallback mActiveScanCallback = null;
    private final Handler mHandler = new Handler(Looper.getMainLooper());

    @Override
    public void load() {
        super.load();
        BluetoothManager bm = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
        if (bm != null) {
            mBluetoothAdapter = bm.getAdapter();
        }
    }

    private boolean checkBlePermissions() {
        if (Build.VERSION.SDK_INT >= 31) { // Android 12+ (API 31+)
            return ContextCompat.checkSelfPermission(getContext(), Manifest.permission.BLUETOOTH_SCAN) == PackageManager.PERMISSION_GRANTED
                && ContextCompat.checkSelfPermission(getContext(), Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED;
        } else { // Android 11 and below (API <= 30)
            return ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
        }
    }

    @PluginMethod
    public void scan(PluginCall call) {
        if (mBluetoothAdapter == null || !mBluetoothAdapter.isEnabled()) {
            call.reject("Bluetooth is disabled or not supported on this device");
            return;
        }

        if (!checkBlePermissions()) {
            mPendingScanCall = call;
            if (Build.VERSION.SDK_INT >= 31) {
                requestPermissionForAlias("bluetooth", call, "scanPermissionCallback");
            } else {
                requestPermissionForAlias("location", call, "scanPermissionCallback");
            }
            return;
        }

        startScanning(call);
    }

    @PermissionCallback
    private void scanPermissionCallback(PluginCall call) {
        if (checkBlePermissions()) {
            startScanning(call);
        } else {
            call.reject("Bluetooth permissions denied");
        }
    }

    private void startScanning(PluginCall call) {
        BluetoothLeScanner scanner = mBluetoothAdapter.getBluetoothLeScanner();
        if (scanner == null) {
            call.reject("Bluetooth LE Scanner not available");
            return;
        }

        final int timeoutMs = call.getInt("timeoutMs", 5000);
        final Map<String, JSObject> discovered = new HashMap<>();

        mActiveScanCallback = new ScanCallback() {
            @Override
            public void onScanResult(int callbackType, ScanResult result) {
                BluetoothDevice device = result.getDevice();
                if (device == null || device.getAddress() == null) return;

                String address = device.getAddress();
                String name = null;
                try {
                    name = device.getName();
                } catch (SecurityException ignored) {}

                if (name == null || name.trim().isEmpty()) {
                    // Try to extract local name from scan record
                    if (result.getScanRecord() != null) {
                        name = result.getScanRecord().getDeviceName();
                    }
                }
                if (name == null) name = "Unknown OBD";

                String lower = name.toLowerCase(Locale.US);
                boolean isCandidate = lower.contains("ios-vlink") || lower.contains("vlinker")
                    || lower.contains("vgate") || lower.contains("obd");

                JSObject devObj = new JSObject();
                devObj.put("address", address);
                devObj.put("name", name);
                devObj.put("isObdCandidate", isCandidate);
                devObj.put("rssi", result.getRssi());

                discovered.put(address, devObj);
                notifyListeners("deviceDiscovered", devObj);
            }

            @Override
            public void onScanFailed(int errorCode) {
                Log.e(TAG, "BLE Scan failed: " + errorCode);
            }
        };

        try {
            scanner.startScan(mActiveScanCallback);
        } catch (SecurityException se) {
            call.reject("SecurityException starting BLE scan: " + se.getMessage());
            return;
        }

        // Stop scanning after timeout
        mHandler.postDelayed(() -> {
            try {
                if (scanner != null && mActiveScanCallback != null) {
                    scanner.stopScan(mActiveScanCallback);
                    mActiveScanCallback = null;
                }
            } catch (Exception ignored) {}

            JSArray list = new JSArray();
            for (JSObject obj : discovered.values()) {
                list.put(obj);
            }
            JSObject ret = new JSObject();
            ret.put("devices", list);
            call.resolve(ret);
        }, timeoutMs);
    }

    @PluginMethod
    public void connect(PluginCall call) {
        String address = call.getString("address");
        if (address == null || address.trim().isEmpty()) {
            call.reject("Device address is required");
            return;
        }

        if (mBluetoothAdapter == null || !mBluetoothAdapter.isEnabled()) {
            call.reject("Bluetooth is disabled or not supported");
            return;
        }

        if (!checkBlePermissions()) {
            mPendingConnectCall = call;
            if (Build.VERSION.SDK_INT >= 31) {
                requestPermissionForAlias("bluetooth", call, "connectPermissionCallback");
            } else {
                requestPermissionForAlias("location", call, "connectPermissionCallback");
            }
            return;
        }

        startConnecting(call);
    }

    @PermissionCallback
    private void connectPermissionCallback(PluginCall call) {
        if (checkBlePermissions()) {
            startConnecting(call);
        } else {
            call.reject("Bluetooth permissions denied");
        }
    }

    private void startConnecting(PluginCall call) {
        String address = call.getString("address");
        disconnectGatt();

        try {
            BluetoothDevice device = mBluetoothAdapter.getRemoteDevice(address);
            mPendingConnectCall = call;

            BluetoothGattCallback callback = new BluetoothGattCallback() {
                @Override
                public void onConnectionStateChange(BluetoothGatt gatt, int status, int newState) {
                    if (newState == BluetoothProfile.STATE_CONNECTED) {
                        Log.d(TAG, "GATT connected, discovering services...");
                        try {
                            gatt.discoverServices();
                        } catch (SecurityException se) {
                            failPendingConnect("SecurityException during service discovery: " + se.getMessage());
                        }
                    } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                        Log.d(TAG, "GATT disconnected");
                        mConnected = false;
                        mNotifyChar = null;
                        mWriteChar = null;
                        if (mPendingConnectCall != null) {
                            failPendingConnect("Disconnected before service discovery completed (status " + status + ")");
                        } else {
                            notifyListeners("disconnected", new JSObject());
                        }
                    }
                }

                @Override
                public void onServicesDiscovered(BluetoothGatt gatt, int status) {
                    if (status != BluetoothGatt.GATT_SUCCESS) {
                        failPendingConnect("Service discovery failed with status " + status);
                        return;
                    }

                    // Discover ELM327 Characteristics
                    boolean found = findElmCharacteristics(gatt);
                    if (!found) {
                        failPendingConnect("Could not find ELM327 serial service or notify/write characteristics");
                        return;
                    }

                    // Enable Notifications on Notify Characteristic
                    try {
                        gatt.setCharacteristicNotification(mNotifyChar, true);
                        BluetoothGattDescriptor descriptor = mNotifyChar.getDescriptor(UUID_CCCD);
                        if (descriptor != null) {
                            descriptor.setValue(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE);
                            gatt.writeDescriptor(descriptor);
                        }
                    } catch (SecurityException se) {
                        failPendingConnect("SecurityException setting notification: " + se.getMessage());
                        return;
                    }

                    mConnected = true;
                    if (mPendingConnectCall != null) {
                        JSObject res = new JSObject();
                        res.put("connected", true);
                        res.put("address", address);
                        try {
                            res.put("name", device.getName());
                        } catch (SecurityException ignored) {
                            res.put("name", "OBD Reader");
                        }
                        mPendingConnectCall.resolve(res);
                        mPendingConnectCall = null;
                    }
                }

                @Override
                public void onCharacteristicChanged(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic) {
                    byte[] data = characteristic.getValue();
                    if (data != null && data.length > 0) {
                        dispatchReceivedData(data);
                    }
                }

                // Android 13+ (API 33+) overload
                public void onCharacteristicChanged(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic, byte[] value) {
                    if (value != null && value.length > 0) {
                        dispatchReceivedData(value);
                    }
                }
            };

            // Android 6 (API 23) vs 7+ (API 24+) connectGatt with TRANSPORT_LE
            if (Build.VERSION.SDK_INT >= 23) {
                mGatt = device.connectGatt(getContext(), false, callback, BluetoothDevice.TRANSPORT_LE);
            } else {
                mGatt = device.connectGatt(getContext(), false, callback);
            }

        } catch (Exception e) {
            failPendingConnect("Failed to connect: " + e.getMessage());
        }
    }

    private void failPendingConnect(String reason) {
        if (mPendingConnectCall != null) {
            mPendingConnectCall.reject(reason);
            mPendingConnectCall = null;
        }
    }

    private boolean findElmCharacteristics(BluetoothGatt gatt) {
        // 1. Try Service FFF0 (FFF1 notify / FFF2 write)
        BluetoothGattService sFFF0 = gatt.getService(UUID_SERVICE_FFF0);
        if (sFFF0 != null) {
            BluetoothGattCharacteristic notify = sFFF0.getCharacteristic(UUID_NOTIFY_FFF1);
            BluetoothGattCharacteristic write = sFFF0.getCharacteristic(UUID_WRITE_FFF2);
            if (notify != null && write != null) {
                mNotifyChar = notify;
                mWriteChar = write;
                Log.d(TAG, "Found ELM327 via Service FFF0 (FFF1 notify / FFF2 write)");
                return true;
            }
        }

        // 2. Try Service 18F0 (2AF0 notify / 2AF1 write)
        BluetoothGattService s18F0 = gatt.getService(UUID_SERVICE_18F0);
        if (s18F0 != null) {
            BluetoothGattCharacteristic notify = s18F0.getCharacteristic(UUID_NOTIFY_2AF0);
            BluetoothGattCharacteristic write = s18F0.getCharacteristic(UUID_WRITE_2AF1);
            if (notify != null && write != null) {
                mNotifyChar = notify;
                mWriteChar = write;
                Log.d(TAG, "Found ELM327 via Service 18F0 (2AF0 notify / 2AF1 write)");
                return true;
            }
        }

        // 3. Fallback: Search all services for a pair with (NOTIFY or INDICATE) + WRITE
        for (BluetoothGattService service : gatt.getServices()) {
            BluetoothGattCharacteristic notifyCandidate = null;
            BluetoothGattCharacteristic writeCandidate = null;

            for (BluetoothGattCharacteristic ch : service.getCharacteristics()) {
                int props = ch.getProperties();
                if ((props & (BluetoothGattCharacteristic.PROPERTY_NOTIFY | BluetoothGattCharacteristic.PROPERTY_INDICATE)) != 0) {
                    if (notifyCandidate == null) notifyCandidate = ch;
                }
                if ((props & (BluetoothGattCharacteristic.PROPERTY_WRITE | BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE)) != 0) {
                    if (writeCandidate == null) writeCandidate = ch;
                }
            }

            if (notifyCandidate != null && writeCandidate != null) {
                mNotifyChar = notifyCandidate;
                mWriteChar = writeCandidate;
                Log.d(TAG, "Found generic NOTIFY/WRITE pair in service: " + service.getUuid());
                return true;
            }
        }

        return false;
    }

    private void dispatchReceivedData(byte[] data) {
        String text = new String(data, StandardCharsets.UTF_8);
        JSObject ret = new JSObject();
        ret.put("text", text);
        notifyListeners("data", ret);
    }

    @PluginMethod
    public void write(PluginCall call) {
        String command = call.getString("command");
        if (command == null) {
            call.reject("command is required");
            return;
        }

        if (mGatt == null || mWriteChar == null || !mConnected) {
            call.reject("Not connected to vehicle OBD reader");
            return;
        }

        // ELM327 commands must terminate with carriage return (\r)
        String cmdToSend = command.endsWith("\r") ? command : command + "\r";
        byte[] bytes = cmdToSend.getBytes(StandardCharsets.US_ASCII);

        try {
            if (Build.VERSION.SDK_INT >= 33) {
                mGatt.writeCharacteristic(mWriteChar, bytes, BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT);
            } else {
                mWriteChar.setValue(bytes);
                mWriteChar.setWriteType(BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT);
                mGatt.writeCharacteristic(mWriteChar);
            }

            JSObject res = new JSObject();
            res.put("sent", true);
            call.resolve(res);
        } catch (SecurityException se) {
            call.reject("SecurityException writing to OBD characteristic: " + se.getMessage());
        } catch (Exception e) {
            call.reject("Failed to write to OBD characteristic: " + e.getMessage());
        }
    }

    @PluginMethod
    public void isConnected(PluginCall call) {
        JSObject res = new JSObject();
        res.put("connected", mConnected && mGatt != null);
        call.resolve(res);
    }

    @PluginMethod
    public void disconnect(PluginCall call) {
        disconnectGatt();
        JSObject res = new JSObject();
        res.put("disconnected", true);
        call.resolve(res);
    }

    private void disconnectGatt() {
        mConnected = false;
        mNotifyChar = null;
        mWriteChar = null;
        if (mGatt != null) {
            try {
                mGatt.disconnect();
                mGatt.close();
            } catch (Exception ignored) {}
            mGatt = null;
        }
    }

    @Override
    protected void handleOnDestroy() {
        disconnectGatt();
        super.handleOnDestroy();
    }
}
