package com.pranix.aariaedge;

import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

public class PhraseCache {
    private final File rootFolder;
    private final long maxSize;
    private static final long DEFAULT_MAX_SIZE = 20 * 1024 * 1024; // 20 MB

    public PhraseCache(File rootFolder) {
        this(rootFolder, DEFAULT_MAX_SIZE);
    }

    public PhraseCache(File rootFolder, long maxSize) {
        this.rootFolder = rootFolder;
        this.maxSize = maxSize;
        if (!rootFolder.exists()) {
            rootFolder.mkdirs();
        }
    }

    private String getHash(String input) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(input.getBytes(StandardCharsets.UTF_8));
            StringBuilder hexString = new StringBuilder(2 * hash.length);
            for (byte b : hash) {
                String hex = Integer.toHexString(0xff & b);
                if (hex.length() == 1) {
                    hexString.append('0');
                }
                hexString.append(hex);
            }
            return hexString.toString();
        } catch (NoSuchAlgorithmException e) {
            throw new RuntimeException(e);
        }
    }

    private String getHashBytes(byte[] input) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(input);
            StringBuilder hexString = new StringBuilder(2 * hash.length);
            for (byte b : hash) {
                String hex = Integer.toHexString(0xff & b);
                if (hex.length() == 1) {
                    hexString.append('0');
                }
                hexString.append(hex);
            }
            return hexString.toString();
        } catch (NoSuchAlgorithmException e) {
            throw new RuntimeException(e);
        }
    }

    private String normalizeAndGenerateKey(String voiceId, String lang, String text) {
        String normalizedText = text.trim().toLowerCase().replaceAll("\\s+", " ");
        return getHash(voiceId + "|" + lang + "|" + normalizedText);
    }

    public static class PutResult {
        public String key;
        public long bytes;
        public PutResult(String key, long bytes) {
            this.key = key;
            this.bytes = bytes;
        }
    }

    public synchronized PutResult put(String voiceId, String lang, String text, byte[] audio, String format) throws Exception {
        if (audio.length > 512 * 1024) {
            throw new IllegalArgumentException("Audio size exceeds 512 KB");
        }
        if (!"WAV".equalsIgnoreCase(format) && !"OGG".equalsIgnoreCase(format)) {
            throw new IllegalArgumentException("Invalid format. Only WAV and OGG are accepted.");
        }
        
        // validate header
        if ("WAV".equalsIgnoreCase(format)) {
            if (audio.length < 12 || audio[0] != 'R' || audio[1] != 'I' || audio[2] != 'F' || audio[3] != 'F' ||
                audio[8] != 'W' || audio[9] != 'A' || audio[10] != 'V' || audio[11] != 'E') {
                throw new IllegalArgumentException("Invalid WAV header");
            }
        } else if ("OGG".equalsIgnoreCase(format)) {
            if (audio.length < 4 || audio[0] != 'O' || audio[1] != 'g' || audio[2] != 'g' || audio[3] != 'S') {
                throw new IllegalArgumentException("Invalid OGG header");
            }
        }

        String key = normalizeAndGenerateKey(voiceId, lang, text);
        long now = System.currentTimeMillis();
        String sha256 = getHashBytes(audio);
        
        JSONObject index = new JSONObject();
        index.put("key", key);
        index.put("lang", lang);
        index.put("voiceId", voiceId);
        index.put("text", text);
        index.put("format", format);
        index.put("bytes", audio.length);
        index.put("sha256", sha256);
        index.put("createdAt", now);
        index.put("lastUsedAt", now);
        
        File audioFile = new File(rootFolder, key + ".audio");
        File indexFile = new File(rootFolder, key + ".json");
        
        File tempAudioFile = new File(rootFolder, key + ".audio.tmp");
        File tempIndexFile = new File(rootFolder, key + ".json.tmp");
        
        try (FileOutputStream fos = new FileOutputStream(tempAudioFile)) {
            fos.write(audio);
        }
        
        try (FileOutputStream fos = new FileOutputStream(tempIndexFile)) {
            fos.write(index.toString().getBytes(StandardCharsets.UTF_8));
        }
        
        Files.move(tempAudioFile.toPath(), audioFile.toPath(), StandardCopyOption.REPLACE_EXISTING);
        Files.move(tempIndexFile.toPath(), indexFile.toPath(), StandardCopyOption.REPLACE_EXISTING);
        
        enforceSizeCap();
        
        return new PutResult(key, audio.length);
    }
    
    public synchronized byte[] get(String voiceId, String lang, String text) {
        CacheEntry entry = getEntry(voiceId, lang, text);
        return entry != null ? entry.bytes : null;
    }
    
    public synchronized CacheEntry getEntry(String voiceId, String lang, String text) {
        String key = normalizeAndGenerateKey(voiceId, lang, text);
        File audioFile = new File(rootFolder, key + ".audio");
        File indexFile = new File(rootFolder, key + ".json");
        
        if (!audioFile.exists() || !indexFile.exists()) {
            return null;
        }
        
        try {
            byte[] indexBytes = Files.readAllBytes(indexFile.toPath());
            JSONObject index = new JSONObject(new String(indexBytes, StandardCharsets.UTF_8));
            
            byte[] audioBytes = Files.readAllBytes(audioFile.toPath());
            String expectedSha256 = index.getString("sha256");
            String actualSha256 = getHashBytes(audioBytes);
            
            if (!expectedSha256.equals(actualSha256)) {
                // damaged file
                remove(key);
                return null;
            }
            
            index.put("lastUsedAt", System.currentTimeMillis());
            File tempIndexFile = new File(rootFolder, key + ".json.tmp");
            try (FileOutputStream fos = new FileOutputStream(tempIndexFile)) {
                fos.write(index.toString().getBytes(StandardCharsets.UTF_8));
            }
            Files.move(tempIndexFile.toPath(), indexFile.toPath(), StandardCopyOption.REPLACE_EXISTING);
            
            return new CacheEntry(key, index.getString("format"), audioBytes);
            
        } catch (Exception e) {
            remove(key);
            return null;
        }
    }
    
    public static class CacheEntry {
        public String key;
        public String format;
        public byte[] bytes;
        public CacheEntry(String key, String format, byte[] bytes) {
            this.key = key;
            this.format = format;
            this.bytes = bytes;
        }
    }
    
    public synchronized void remove(String key) {
        File audioFile = new File(rootFolder, key + ".audio");
        File indexFile = new File(rootFolder, key + ".json");
        if (audioFile.exists()) audioFile.delete();
        if (indexFile.exists()) indexFile.delete();
    }
    
    public synchronized void clearAll() {
        if (rootFolder.exists()) {
            File[] files = rootFolder.listFiles();
            if (files != null) {
                for (File f : files) {
                    f.delete();
                }
            }
        }
    }
    
    public synchronized List<String> list() {
        List<String> keys = new ArrayList<>();
        if (rootFolder.exists()) {
            File[] files = rootFolder.listFiles((dir, name) -> name.endsWith(".json"));
            if (files != null) {
                for (File f : files) {
                    keys.add(f.getName().replace(".json", ""));
                }
            }
        }
        return keys;
    }
    
    private void enforceSizeCap() {
        File[] files = rootFolder.listFiles((dir, name) -> name.endsWith(".json"));
        if (files == null) return;
        
        long totalSize = 0;
        List<IndexMeta> metas = new ArrayList<>();
        
        for (File f : files) {
            try {
                byte[] indexBytes = Files.readAllBytes(f.toPath());
                JSONObject index = new JSONObject(new String(indexBytes, StandardCharsets.UTF_8));
                long bytes = index.getLong("bytes");
                long lastUsedAt = index.getLong("lastUsedAt");
                String key = index.getString("key");
                
                totalSize += bytes;
                metas.add(new IndexMeta(key, bytes, lastUsedAt));
            } catch (Exception e) {
                // ignore
            }
        }
        
        if (totalSize > maxSize) {
            metas.sort(Comparator.comparingLong(a -> a.lastUsedAt));
            for (IndexMeta meta : metas) {
                remove(meta.key);
                totalSize -= meta.bytes;
                if (totalSize <= maxSize) {
                    break;
                }
            }
        }
    }
    
    private static class IndexMeta {
        String key;
        long bytes;
        long lastUsedAt;
        IndexMeta(String key, long bytes, long lastUsedAt) {
            this.key = key;
            this.bytes = bytes;
            this.lastUsedAt = lastUsedAt;
        }
    }
}
