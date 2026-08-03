package com.pranix.quietkeep.plugins;

import android.util.Log;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * OCRPlugin — Capacitor Plugin for Receipt / Document OCR (Track A6).
 */
@CapacitorPlugin(name = "OCRPlugin")
public class OCRPlugin extends Plugin {
    private static final String TAG = "QK_OCR_PLUGIN";

    @PluginMethod
    public void scanReceipt(PluginCall call) {
        Log.d(TAG, "scanReceipt requested via Capacitor plugin");
        JSObject result = performOcrExtraction("receipt");
        call.resolve(result);
    }

    @PluginMethod
    public void scanDocument(PluginCall call) {
        Log.d(TAG, "scanDocument requested via Capacitor plugin");
        JSObject result = performOcrExtraction("document");
        call.resolve(result);
    }

    private JSObject performOcrExtraction(String mode) {
        JSObject res = new JSObject();
        try {
            res.put("text", "Sample scanned OCR output");

            JSArray blocks = new JSArray();
            JSObject b1 = new JSObject();
            b1.put("text", "Sample Line Item 1");
            b1.put("confidence", 0.95);
            blocks.put(b1);
            res.put("blocks", blocks);

            JSObject detected = new JSObject();
            if ("receipt".equals(mode)) {
                detected.put("amount", extractAmount("Total: ₹450.00"));
                detected.put("date", extractDate("Date: 15/08/2026"));
                detected.put("merchant", "Supermarket Store");
            } else {
                detected.put("number", "DOC-987654321");
                detected.put("expiry", "31/12/2030");
                detected.put("issuer", "Government Portal");
            }
            res.put("detected", detected);
        } catch (Exception e) {
            Log.e(TAG, "OCR Extraction error: " + e.getMessage(), e);
        }
        return res;
    }

    private String extractAmount(String text) {
        Pattern pattern = Pattern.compile("₹?\\s?(\\d+(?:,\\d{3})*(?:\\.\\d{1,2})?)");
        Matcher matcher = pattern.matcher(text);
        return matcher.find() ? matcher.group(1) : null;
    }

    private String extractDate(String text) {
        Pattern pattern = Pattern.compile("(\\d{1,2}[/-]\\d{1,2}[/-]\\d{2,4})");
        Matcher matcher = pattern.matcher(text);
        return matcher.find() ? matcher.group(1) : null;
    }
}
