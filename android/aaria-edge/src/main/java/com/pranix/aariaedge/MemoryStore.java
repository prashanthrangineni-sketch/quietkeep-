package com.pranix.aariaedge;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

import javax.crypto.Cipher;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Private on-phone memory store. One encrypted file per record, AES-256-GCM.
 * Thread-safe (all public methods synchronized). Never calls any cloud service.
 *
 * <p>Keeps a decrypted in-RAM map so that get/list/export never touch the
 * keystore or disk after the first load — critical for speed on cheap phones
 * that would otherwise need seconds to decrypt 500 files through the keystore.</p>
 */
public class MemoryStore {

    /** Injectable clock for testing. */
    public interface Clock {
        long currentTimeMillis();
    }

    /** Thrown when keyProvider.getKey() fails (temporary keystore hiccup).
     *  Callers must NOT delete any files when this happens. */
    public static class KeyUnavailableException extends RuntimeException {
        public KeyUnavailableException(String message, Throwable cause) {
            super(message, cause);
        }
    }

    private static final Clock SYSTEM_CLOCK = System::currentTimeMillis;
    private static final int GCM_IV_LENGTH = 12;
    private static final int GCM_TAG_BITS = 128;
    private static final int MAX_VALUE_BYTES = 2048; // 2 KB
    private static final int MAX_RECORDS = 500;
    private static final Set<String> VALID_KINDS = new HashSet<>(Arrays.asList(
            "profile", "contact", "preference", "recent_command", "note"
    ));
    private static final long DAY_MS = 86_400_000L;
    private static final Pattern UUID_PATTERN = Pattern.compile(
            "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}",
            Pattern.CASE_INSENSITIVE);

    private final File rootFolder;
    private final KeyProvider keyProvider;
    private final Clock clock;
    private final PhraseCache phraseCache; // for wipeEverything

    // In-RAM cache: id → decrypted JSONObject.  Loaded once on first use.
    private Map<String, JSONObject> cache;
    private boolean loaded = false;

    public MemoryStore(File rootFolder, KeyProvider keyProvider, PhraseCache phraseCache) {
        this(rootFolder, keyProvider, phraseCache, SYSTEM_CLOCK);
    }

    public MemoryStore(File rootFolder, KeyProvider keyProvider, PhraseCache phraseCache, Clock clock) {
        this.rootFolder = rootFolder;
        this.keyProvider = keyProvider;
        this.phraseCache = phraseCache;
        this.clock = clock;
        if (!rootFolder.exists()) {
            rootFolder.mkdirs();
        }
    }

    // ================================================================
    //  Public API
    // ================================================================

    public synchronized String put(String kind, String key, String value, int ttlDays) {
        ensureLoaded();
        validateKind(kind);
        if (value == null) throw new IllegalArgumentException("value must not be null");
        if (value.getBytes(StandardCharsets.UTF_8).length > MAX_VALUE_BYTES) {
            throw new IllegalArgumentException("Value exceeds 2 KB limit");
        }
        if (ttlDays <= 0) {
            ttlDays = defaultTtl(kind);
        }

        // Look for existing record with same kind+key in cache
        String existingId = null;
        long existingCreatedAt = 0;
        for (Map.Entry<String, JSONObject> entry : cache.entrySet()) {
            JSONObject rec = entry.getValue();
            if (kind.equals(rec.optString("kind")) && key.equals(rec.optString("key"))) {
                existingId = entry.getKey();
                existingCreatedAt = rec.optLong("createdAt");
                break;
            }
        }

        String id = existingId != null ? existingId : UUID.randomUUID().toString();
        long now = clock.currentTimeMillis();

        try {
            JSONObject record = new JSONObject();
            record.put("id", id);
            record.put("kind", kind);
            record.put("key", key);
            record.put("value", value);
            record.put("createdAt", existingId != null ? existingCreatedAt : now);
            record.put("updatedAt", now);
            record.put("expiresAt", now + (long) ttlDays * DAY_MS);

            byte[] plaintext = record.toString().getBytes(StandardCharsets.UTF_8);
            byte[] encrypted = encrypt(plaintext, id);

            File target = new File(rootFolder, id + ".mem");
            File tmp = new File(rootFolder, id + ".mem.tmp");
            try (FileOutputStream fos = new FileOutputStream(tmp)) {
                fos.write(encrypted);
            }
            Files.move(tmp.toPath(), target.toPath(), StandardCopyOption.REPLACE_EXISTING);

            cache.put(id, record);
            enforceRecordLimit();
            return id;
        } catch (KeyUnavailableException e) {
            throw e;
        } catch (IllegalArgumentException e) {
            throw e;
        } catch (Exception e) {
            throw new RuntimeException("Failed to write memory record", e);
        }
    }

    public synchronized JSONObject get(String kind, String key) {
        ensureLoaded();
        validateKind(kind);
        purgeExpiredInternal();
        for (JSONObject rec : cache.values()) {
            if (kind.equals(rec.optString("kind")) && key.equals(rec.optString("key"))) {
                try {
                    return new JSONObject(rec.toString());
                } catch (Exception e) {
                    return rec; // fallback: return the cached reference
                }
            }
        }
        return null;
    }

    public synchronized List<JSONObject> list(String kind) {
        ensureLoaded();
        purgeExpiredInternal();
        List<JSONObject> results = new ArrayList<>();
        for (JSONObject rec : cache.values()) {
            if (kind == null || kind.equals(rec.optString("kind"))) {
                try {
                    results.add(new JSONObject(rec.toString()));
                } catch (Exception e) {
                    results.add(rec);
                }
            }
        }
        return results;
    }

    public synchronized boolean remove(String id) {
        validateId(id);
        ensureLoaded();
        File f = new File(rootFolder, id + ".mem");
        boolean deleted = f.exists() && f.delete();
        cache.remove(id);
        return deleted;
    }

    public synchronized int purgeExpired() {
        ensureLoaded();
        return purgeExpiredInternal();
    }

    public synchronized JSONArray exportAll() {
        ensureLoaded();
        purgeExpiredInternal();
        JSONArray arr = new JSONArray();
        for (JSONObject rec : cache.values()) {
            try {
                arr.put(new JSONObject(rec.toString()));
            } catch (Exception e) {
                arr.put(rec);
            }
        }
        return arr;
    }

    public synchronized int clearAll() {
        File[] files = rootFolder.listFiles();
        int count = 0;
        if (files != null) {
            for (File f : files) {
                if (f.isFile()) {
                    if (f.getName().endsWith(".mem")) count++;
                    f.delete();
                }
            }
        }
        cache = new LinkedHashMap<>();
        loaded = true;
        return count;
    }

    /** One-tap delete: clear all memory + destroy key + clear phrase cache.
     *  Works even if the keystore is temporarily unavailable. */
    public synchronized WipeResult wipeEverything() {
        int memoryRecords = listMemFiles().length;
        int cachedReplies = 0;
        if (phraseCache != null) {
            cachedReplies = phraseCache.list().size();
            phraseCache.clearAll();
        }
        // Delete all files directly — no need to decrypt
        File[] files = rootFolder.listFiles();
        if (files != null) {
            for (File f : files) {
                if (f.isFile()) f.delete();
            }
        }
        cache = new LinkedHashMap<>();
        loaded = true;
        keyProvider.destroyKey();
        return new WipeResult(memoryRecords, cachedReplies);
    }

    public static class WipeResult {
        public final int memoryRecords;
        public final int cachedReplies;
        public WipeResult(int memoryRecords, int cachedReplies) {
            this.memoryRecords = memoryRecords;
            this.cachedReplies = cachedReplies;
        }
    }

    // ================================================================
    //  Internal helpers
    // ================================================================

    private void validateKind(String kind) {
        if (kind == null || !VALID_KINDS.contains(kind)) {
            throw new IllegalArgumentException("Invalid kind: " + kind + ". Must be one of " + VALID_KINDS);
        }
    }

    /** Reject anything that is not a UUID to prevent path traversal (e.g. "../something"). */
    private void validateId(String id) {
        if (id == null || !UUID_PATTERN.matcher(id).matches()) {
            throw new IllegalArgumentException("Invalid record id: must be a UUID");
        }
    }

    private int defaultTtl(String kind) {
        switch (kind) {
            case "recent_command": return 7;
            case "note": return 90;
            default: return 365;
        }
    }

    private File[] listMemFiles() {
        File[] files = rootFolder.listFiles((dir, name) -> name.endsWith(".mem") && !name.endsWith(".tmp"));
        return files != null ? files : new File[0];
    }

    // ---- cache loading ----

    /**
     * Load all records from disk into the in-RAM cache on first use.
     * If a file is corrupted (bad decrypt / bad JSON), delete it.
     * If the key itself cannot be loaded, throw KeyUnavailableException and
     * leave all files intact.
     */
    private void ensureLoaded() {
        if (loaded) return;
        cache = new LinkedHashMap<>();
        File[] files = listMemFiles();
        for (File f : files) {
            String id = f.getName().replace(".mem", "");
            try {
                byte[] data = Files.readAllBytes(f.toPath());
                JSONObject rec = decryptData(data, id);
                if (rec != null) {
                    cache.put(id, rec);
                } else {
                    // Corrupted data — delete the file
                    f.delete();
                }
            } catch (KeyUnavailableException e) {
                // Key cannot be loaded — do NOT delete anything, re-throw
                throw e;
            } catch (Exception e) {
                // IO error reading file — delete the broken file
                f.delete();
            }
        }
        loaded = true;
        purgeExpiredInternal(); // "purgeExpired() runs on every start"
    }

    // ---- expiry ----

    private int purgeExpiredInternal() {
        long now = clock.currentTimeMillis();
        int count = 0;
        Iterator<Map.Entry<String, JSONObject>> it = cache.entrySet().iterator();
        while (it.hasNext()) {
            Map.Entry<String, JSONObject> entry = it.next();
            if (entry.getValue().optLong("expiresAt", Long.MAX_VALUE) <= now) {
                new File(rootFolder, entry.getKey() + ".mem").delete();
                it.remove();
                count++;
            }
        }
        return count;
    }

    // ---- record-limit eviction ----

    private void enforceRecordLimit() {
        while (cache.size() > MAX_RECORDS) {
            String toRemoveId = findOldestId("recent_command");
            if (toRemoveId == null) toRemoveId = findOldestId("note");
            if (toRemoveId == null) toRemoveId = findOldestId(null);
            if (toRemoveId == null) break;

            new File(rootFolder, toRemoveId + ".mem").delete();
            cache.remove(toRemoveId);
        }
    }

    private String findOldestId(String kind) {
        String oldestId = null;
        long oldestTime = Long.MAX_VALUE;
        for (Map.Entry<String, JSONObject> entry : cache.entrySet()) {
            JSONObject rec = entry.getValue();
            if (kind != null && !kind.equals(rec.optString("kind"))) continue;
            long created = rec.optLong("createdAt", Long.MAX_VALUE);
            if (created < oldestTime) {
                oldestTime = created;
                oldestId = entry.getKey();
            }
        }
        return oldestId;
    }

    // ---- crypto ----

    /**
     * Encrypt plaintext with AES-256-GCM.
     * Does NOT pass a caller-provided IV — Android Keystore forbids that.
     * Instead lets the Cipher generate the IV and reads it back.
     */
    private byte[] encrypt(byte[] plaintext, String associatedData) {
        SecretKey secretKey;
        try {
            secretKey = keyProvider.getKey();
        } catch (Exception e) {
            throw new KeyUnavailableException("Cannot load encryption key for write", e);
        }
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            // Let the provider pick the IV (required by Android Keystore)
            cipher.init(Cipher.ENCRYPT_MODE, secretKey);
            cipher.updateAAD(associatedData.getBytes(StandardCharsets.UTF_8));
            byte[] ciphertext = cipher.doFinal(plaintext);
            byte[] iv = cipher.getIV();

            // File format: [12-byte IV][ciphertext+tag]
            byte[] result = new byte[iv.length + ciphertext.length];
            System.arraycopy(iv, 0, result, 0, iv.length);
            System.arraycopy(ciphertext, 0, result, iv.length, ciphertext.length);
            return result;
        } catch (Exception e) {
            throw new RuntimeException("Encryption failed", e);
        }
    }

    /**
     * Decrypt data with AES-256-GCM.
     * @return decrypted JSONObject, or null if data is corrupted / wrong key.
     * @throws KeyUnavailableException if keyProvider.getKey() itself fails.
     */
    private JSONObject decryptData(byte[] data, String associatedData) {
        SecretKey secretKey;
        try {
            secretKey = keyProvider.getKey();
        } catch (Exception e) {
            throw new KeyUnavailableException("Cannot load encryption key for read", e);
        }
        try {
            if (data.length < GCM_IV_LENGTH) return null;
            byte[] iv = Arrays.copyOfRange(data, 0, GCM_IV_LENGTH);
            byte[] ciphertext = Arrays.copyOfRange(data, GCM_IV_LENGTH, data.length);

            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            GCMParameterSpec spec = new GCMParameterSpec(GCM_TAG_BITS, iv);
            cipher.init(Cipher.DECRYPT_MODE, secretKey, spec);
            cipher.updateAAD(associatedData.getBytes(StandardCharsets.UTF_8));
            byte[] plaintext = cipher.doFinal(ciphertext);

            return new JSONObject(new String(plaintext, StandardCharsets.UTF_8));
        } catch (Exception e) {
            return null; // AEADBadTagException, bad JSON, etc.
        }
    }
}
