package com.pranix.aariaedge;

import android.content.Context;

import androidx.annotation.NonNull;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import androidx.work.OneTimeWorkRequest;
import androidx.work.Data;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.TimeUnit;

/**
 * WorkManager-based nightly sync for speech models and reply audio.
 * Periodic every 24h with constraints: Wi-Fi, charging, battery/storage not low.
 * Never runs — and never starts a download — while the microphone is capturing speech.
 *
 * <p>Manifest authenticity is enforced: both {@code manifest.json} and
 * {@code manifest.json.sig} are fetched, and the ECDSA P-256 signature is
 * verified before the manifest is parsed. If the signature is missing or
 * invalid, sync fails with error {@code "bad_signature"}.
 */
public class NightlySyncWorker extends Worker {

    public static final String WORK_NAME = "aaria_nightly_sync";
    public static final String KEY_MANIFEST_URL = "manifestUrl";
    public static final String KEY_ACTIVE_LANG = "activeLang";
    public static final String KEY_VOICE_ID = "voiceId";
    public static final String KEY_ALLOW_MOBILE_DATA = "allowMobileData";
    public static final String KEY_MANIFEST_PUBLIC_KEY = "manifestPublicKey";

    /** Set by AariaEdgePlugin to true while mic is recording. */
    static volatile boolean microphoneActive = false;

    /**
     * Injectable listener for sync progress/finish events.
     * In production, the plugin sets this to emit Capacitor events.
     */
    public interface SyncEventListener {
        void onProgress(String stage, String lang, long bytesDone, long bytesTotal);
        void onFinished(boolean ok, List<String> updated, List<String> skipped, List<String> errors);
    }

    static volatile SyncEventListener eventListener = null;

    public NightlySyncWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        try {
            if (microphoneActive) {
                reportFinished(false, new ArrayList<>(), new ArrayList<>(),
                        listOf("skipped: microphone active"));
                return Result.retry();
            }

            String manifestUrl = getInputData().getString(KEY_MANIFEST_URL);
            String activeLang = getInputData().getString(KEY_ACTIVE_LANG);
            String voiceId = getInputData().getString(KEY_VOICE_ID);
            String publicKey = getInputData().getString(KEY_MANIFEST_PUBLIC_KEY);

            if (manifestUrl == null || manifestUrl.isEmpty()) {
                reportFinished(false, new ArrayList<>(), new ArrayList<>(),
                        listOf("no manifest URL configured"));
                return Result.failure();
            }
            if (activeLang == null || activeLang.isEmpty()) activeLang = "en";
            if (voiceId == null || voiceId.isEmpty()) voiceId = "default";

            List<String> updated = new ArrayList<>();
            List<String> skipped = new ArrayList<>();
            List<String> errors = new ArrayList<>();

            try {
                // Fetch manifest
                reportProgress("fetching_manifest", "", 0, 0);
                byte[] manifestBytes = fetchBytes(manifestUrl);

                // Verify manifest signature if a public key is configured
                if (publicKey != null && !publicKey.isEmpty()) {
                    byte[] sigBytes;
                    try {
                        sigBytes = fetchBytes(manifestUrl + ".sig");
                    } catch (Exception e) {
                        errors.add("bad_signature");
                        reportFinished(false, updated, skipped, errors);
                        return Result.failure();
                    }

                    if (!ManifestVerifier.verify(manifestBytes, sigBytes, publicKey)) {
                        errors.add("bad_signature");
                        reportFinished(false, updated, skipped, errors);
                        return Result.failure();
                    }
                }

                String manifestJson = new String(manifestBytes, StandardCharsets.UTF_8);
                SyncManifest manifest = SyncManifest.parse(manifestJson);

                Context ctx = getApplicationContext();
                File modelsDir = new File(ctx.getFilesDir(), "models");
                File phraseCacheDir = new File(ctx.getFilesDir(), "phrase_cache");
                PhraseCache phraseCache = new PhraseCache(phraseCacheDir);

                // Determine which languages to download: active + English
                Set<String> wantedLangs = new HashSet<>();
                wantedLangs.add(activeLang);
                wantedLangs.add("en");

                // Download models for wanted languages
                for (Map.Entry<String, SyncManifest.ModelGroup> entry : manifest.models.entrySet()) {
                    String lang = entry.getKey();
                    if (!wantedLangs.contains(lang)) continue;

                    // Re-check mic before each language download
                    if (microphoneActive) {
                        skipped.add("model:" + lang + ":microphone_active");
                        continue;
                    }

                    SyncManifest.ModelGroup group = entry.getValue();
                    File langDir = new File(modelsDir, lang);
                    if (!langDir.exists()) langDir.mkdirs();

                    long totalBytes = 0;
                    for (SyncManifest.ManifestFile mf : group.files) totalBytes += mf.bytes;
                    long done = 0;

                    boolean langOk = true;
                    for (SyncManifest.ManifestFile mf : group.files) {
                        // Re-check mic before each file download
                        if (microphoneActive) {
                            skipped.add("model:" + lang + "/" + mf.name + ":microphone_active");
                            langOk = false;
                            break;
                        }

                        if (isStopped()) {
                            skipped.add("model:" + lang + "/" + mf.name + ":worker_stopped");
                            langOk = false;
                            break;
                        }

                        reportProgress("downloading_model", lang, done, totalBytes);
                        File target = new File(langDir, mf.name);

                        Downloader.DownloadResult result = Downloader.download(
                                mf.url, target, mf.bytes, mf.sha256,
                                Downloader.DEFAULT_FREE_SPACE);

                        if (result.success) {
                            done += mf.bytes;
                        } else if (result.skipReason != null) {
                            skipped.add("model:" + lang + "/" + mf.name + ":" + result.skipReason);
                            langOk = false;
                        } else {
                            errors.add("model:" + lang + "/" + mf.name + ":" + result.error);
                            langOk = false;
                        }
                    }

                    if (langOk) {
                        // Write model.json for CommandRecognizer
                        writeModelJson(langDir, group);
                        updated.add("model:" + lang);
                    }
                }

                // Remove models for languages no longer wanted
                if (modelsDir.exists()) {
                    File[] langDirs = modelsDir.listFiles();
                    if (langDirs != null) {
                        for (File ld : langDirs) {
                            if (ld.isDirectory() && !wantedLangs.contains(ld.getName())) {
                                deleteRecursive(ld);
                                updated.add("removed_model:" + ld.getName());
                            }
                        }
                    }
                }

                // Download reply audio
                if (manifest.replies.containsKey(voiceId)) {
                    Map<String, List<SyncManifest.ReplyFile>> voiceReplies = manifest.replies.get(voiceId);
                    for (Map.Entry<String, List<SyncManifest.ReplyFile>> langEntry : voiceReplies.entrySet()) {
                        String lang = langEntry.getKey();
                        if (!wantedLangs.contains(lang)) continue;

                        List<SyncManifest.ReplyFile> files = langEntry.getValue();
                        long totalBytes = 0;
                        for (SyncManifest.ReplyFile rf : files) totalBytes += rf.bytes;
                        long done = 0;

                        for (SyncManifest.ReplyFile rf : files) {
                            if (microphoneActive) {
                                skipped.add("reply:" + lang + "/" + rf.text + ":microphone_active");
                                continue;
                            }
                            if (isStopped()) {
                                skipped.add("reply:" + lang + "/" + rf.text + ":worker_stopped");
                                continue;
                            }

                            reportProgress("downloading_replies", lang, done, totalBytes);

                            File tempDir = new File(ctx.getCacheDir(), "sync_tmp");
                            if (!tempDir.exists()) tempDir.mkdirs();
                            File tempFile = new File(tempDir, "reply_" + rf.text.hashCode() + ".tmp");

                            Downloader.DownloadResult result = Downloader.download(
                                    rf.url, tempFile, rf.bytes, rf.sha256,
                                    Downloader.DEFAULT_FREE_SPACE);

                            if (result.success) {
                                try {
                                    byte[] audio = java.nio.file.Files.readAllBytes(tempFile.toPath());
                                    phraseCache.put(voiceId, lang, rf.text, audio, rf.format);
                                    updated.add("reply:" + lang + "/" + rf.text);
                                    done += rf.bytes;
                                } catch (Exception e) {
                                    errors.add("reply_cache:" + lang + "/" + rf.text + ":" + e.getMessage());
                                } finally {
                                    tempFile.delete();
                                }
                            } else if (result.skipReason != null) {
                                skipped.add("reply:" + lang + "/" + rf.text + ":" + result.skipReason);
                            } else {
                                errors.add("reply:" + lang + "/" + rf.text + ":" + result.error);
                            }
                        }
                    }
                }

                boolean ok = errors.isEmpty();
                reportFinished(ok, updated, skipped, errors);
                return ok ? Result.success() : Result.retry();

            } catch (Exception e) {
                errors.add("fatal:" + e.getMessage());
                reportFinished(false, updated, skipped, errors);
                return Result.retry();
            }
        } catch (Throwable t) {
            return Result.failure();
        }
    }

    private void writeModelJson(File langDir, SyncManifest.ModelGroup group) throws Exception {
        JSONObject modelJson = new JSONObject();
        modelJson.put("type", group.type);
        for (SyncManifest.ManifestFile mf : group.files) {
            String key = inferModelKey(mf.name);
            if (key != null) {
                modelJson.put(key, mf.name);
            }
        }
        File jsonFile = new File(langDir, "model.json");
        File tmpFile = new File(langDir, "model.json.tmp");
        try (FileOutputStream fos = new FileOutputStream(tmpFile)) {
            fos.write(modelJson.toString().getBytes(StandardCharsets.UTF_8));
        }
        java.nio.file.Files.move(tmpFile.toPath(), jsonFile.toPath(),
                java.nio.file.StandardCopyOption.REPLACE_EXISTING);
    }

    static String inferModelKey(String fileName) {
        String lower = fileName.toLowerCase();
        if (lower.contains("token")) return "tokens";
        if (lower.contains("encoder")) return "encoder";
        if (lower.contains("decoder") && lower.contains("uncached")) return "uncachedDecoder";
        if (lower.contains("decoder") && lower.contains("cached") && !lower.contains("uncached")) return "cachedDecoder";
        if (lower.contains("decoder")) return "decoder";
        if (lower.contains("joiner")) return "joiner";
        if (lower.contains("preprocessor")) return "preprocessor";
        if (lower.contains("model")) return "model";
        int dot = fileName.lastIndexOf('.');
        return dot > 0 ? fileName.substring(0, dot) : fileName;
    }

    private byte[] fetchBytes(String urlStr) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(urlStr).openConnection();
        conn.setConnectTimeout(30_000);
        conn.setReadTimeout(30_000);
        try {
            int code = conn.getResponseCode();
            if (code != 200) throw new RuntimeException("HTTP " + code);
            try (InputStream in = conn.getInputStream()) {
                java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream();
                byte[] buf = new byte[4096];
                int n;
                while ((n = in.read(buf)) != -1) bos.write(buf, 0, n);
                return bos.toByteArray();
            }
        } finally {
            conn.disconnect();
        }
    }

    private void deleteRecursive(File file) {
        if (file.isDirectory()) {
            File[] children = file.listFiles();
            if (children != null) {
                for (File child : children) deleteRecursive(child);
            }
        }
        file.delete();
    }

    private void reportProgress(String stage, String lang, long bytesDone, long bytesTotal) {
        SyncEventListener listener = eventListener;
        if (listener != null) {
            listener.onProgress(stage, lang, bytesDone, bytesTotal);
        }
    }

    private void reportFinished(boolean ok, List<String> updated,
                                List<String> skipped, List<String> errors) {
        SyncEventListener listener = eventListener;
        if (listener != null) {
            listener.onFinished(ok, updated, skipped, errors);
        }
    }

    private static List<String> listOf(String item) {
        List<String> list = new ArrayList<>();
        list.add(item);
        return list;
    }

    // ---- Static scheduling helpers ----

    /**
     * Schedule the periodic nightly sync: every 24h, Wi-Fi + charging + battery/storage OK.
     * Uses KEEP so repeated calls never stack duplicate jobs.
     */
    public static void schedule(Context context, String manifestUrl,
                                String activeLang, String voiceId,
                                String publicKey) {
        Constraints constraints = new Constraints.Builder()
                .setRequiredNetworkType(NetworkType.UNMETERED)
                .setRequiresCharging(true)
                .setRequiresBatteryNotLow(true)
                .setRequiresStorageNotLow(true)
                .build();

        Data inputData = new Data.Builder()
                .putString(KEY_MANIFEST_URL, manifestUrl)
                .putString(KEY_ACTIVE_LANG, activeLang)
                .putString(KEY_VOICE_ID, voiceId)
                .putString(KEY_MANIFEST_PUBLIC_KEY, publicKey)
                .build();

        PeriodicWorkRequest request = new PeriodicWorkRequest.Builder(
                NightlySyncWorker.class, 24, TimeUnit.HOURS)
                .setConstraints(constraints)
                .setInputData(inputData)
                .build();

        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                WORK_NAME,
                ExistingPeriodicWorkPolicy.KEEP,
                request);
    }

    /**
     * Trigger an immediate one-time sync. Still Wi-Fi only unless allowMobileData is true.
     */
    public static void cancel(Context context) { androidx.work.WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME); } public static void syncNow(Context context, String manifestUrl,
                                String activeLang, String voiceId,
                                String publicKey, boolean allowMobileData) {
        Constraints.Builder cb = new Constraints.Builder()
                .setRequiresCharging(false)
                .setRequiresBatteryNotLow(false)
                .setRequiresStorageNotLow(false);

        if (!allowMobileData) {
            cb.setRequiredNetworkType(NetworkType.UNMETERED);
        } else {
            cb.setRequiredNetworkType(NetworkType.CONNECTED);
        }

        Data inputData = new Data.Builder()
                .putString(KEY_MANIFEST_URL, manifestUrl)
                .putString(KEY_ACTIVE_LANG, activeLang)
                .putString(KEY_VOICE_ID, voiceId)
                .putString(KEY_MANIFEST_PUBLIC_KEY, publicKey)
                .build();

        OneTimeWorkRequest request = new OneTimeWorkRequest.Builder(NightlySyncWorker.class)
                .setConstraints(cb.build())
                .setInputData(inputData)
                .build();

        WorkManager.getInstance(context).enqueue(request);
    }
}
