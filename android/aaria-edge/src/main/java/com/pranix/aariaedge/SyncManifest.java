package com.pranix.aariaedge;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;

/**
 * Parses and validates the sync manifest JSON fetched from a host-configured URL.
 * Rejects unknown versions, missing sha256, path traversal file names, non-https URLs,
 * single files over 400 MB, and model totals over 600 MB.
 */
public class SyncManifest {

    private static final long MAX_SINGLE_FILE_BYTES = 400L * 1024 * 1024; // 400 MB
    private static final long MAX_MODEL_TOTAL_BYTES = 600L * 1024 * 1024; // 600 MB

    public final int version;
    public final Map<String, ModelGroup> models;       // lang → ModelGroup
    public final Map<String, Map<String, List<ReplyFile>>> replies; // voiceId → lang → files

    public SyncManifest(int version, Map<String, ModelGroup> models,
                        Map<String, Map<String, List<ReplyFile>>> replies) {
        this.version = version;
        this.models = models;
        this.replies = replies;
    }

    public static class ModelGroup {
        public final String type;
        public final List<ManifestFile> files;

        public ModelGroup(String type, List<ManifestFile> files) {
            this.type = type;
            this.files = files;
        }
    }

    public static class ManifestFile {
        public final String name;
        public final String url;
        public final long bytes;
        public final String sha256;

        public ManifestFile(String name, String url, long bytes, String sha256) {
            this.name = name;
            this.url = url;
            this.bytes = bytes;
            this.sha256 = sha256;
        }
    }

    public static class ReplyFile {
        public final String text;
        public final String url;
        public final long bytes;
        public final String sha256;
        public final String format;

        public ReplyFile(String text, String url, long bytes, String sha256, String format) {
            this.text = text;
            this.url = url;
            this.bytes = bytes;
            this.sha256 = sha256;
            this.format = format;
        }
    }

    /**
     * Parse and validate a manifest JSON string.
     *
     * @param json raw JSON from the manifest URL
     * @return validated SyncManifest
     * @throws IllegalArgumentException on any validation failure
     */
    public static SyncManifest parse(String json) {
        try {
            JSONObject root = new JSONObject(json);

            // Version check
            int version = root.getInt("version");
            if (version != 1) {
                throw new IllegalArgumentException("Unknown manifest version: " + version);
            }

            // Parse models
            Map<String, ModelGroup> models = new HashMap<>();
            long modelTotalBytes = 0;

            if (root.has("models")) {
                JSONObject modelsObj = root.getJSONObject("models");
                Iterator<String> langs = modelsObj.keys();
                while (langs.hasNext()) {
                    String lang = langs.next();
                    JSONObject modelObj = modelsObj.getJSONObject(lang);
                    String type = modelObj.optString("type", "");
                    JSONArray filesArr = modelObj.getJSONArray("files");

                    List<ManifestFile> files = new ArrayList<>();
                    for (int i = 0; i < filesArr.length(); i++) {
                        JSONObject fObj = filesArr.getJSONObject(i);
                        ManifestFile mf = parseManifestFile(fObj);
                        modelTotalBytes += mf.bytes;
                        files.add(mf);
                    }
                    models.put(lang, new ModelGroup(type, files));
                }
            }

            if (modelTotalBytes > MAX_MODEL_TOTAL_BYTES) {
                throw new IllegalArgumentException(
                        "Model total exceeds 600 MB: " + modelTotalBytes);
            }

            // Parse replies
            Map<String, Map<String, List<ReplyFile>>> replies = new HashMap<>();

            if (root.has("replies")) {
                JSONObject repliesObj = root.getJSONObject("replies");
                Iterator<String> voiceIds = repliesObj.keys();
                while (voiceIds.hasNext()) {
                    String voiceId = voiceIds.next();
                    JSONObject voiceObj = repliesObj.getJSONObject(voiceId);
                    Map<String, List<ReplyFile>> langMap = new HashMap<>();

                    Iterator<String> langs = voiceObj.keys();
                    while (langs.hasNext()) {
                        String lang = langs.next();
                        JSONArray arr = voiceObj.getJSONArray(lang);
                        List<ReplyFile> replyFiles = new ArrayList<>();
                        for (int i = 0; i < arr.length(); i++) {
                            JSONObject rObj = arr.getJSONObject(i);
                            replyFiles.add(parseReplyFile(rObj));
                        }
                        langMap.put(lang, replyFiles);
                    }
                    replies.put(voiceId, langMap);
                }
            }

            return new SyncManifest(version, models, replies);

        } catch (IllegalArgumentException e) {
            throw e;
        } catch (Exception e) {
            throw new IllegalArgumentException("Invalid manifest JSON: " + e.getMessage(), e);
        }
    }

    private static ManifestFile parseManifestFile(JSONObject obj) {
        String name = obj.optString("name", null);
        String url = obj.optString("url", null);
        String sha256 = obj.optString("sha256", null);

        if (name == null || name.isEmpty()) {
            throw new IllegalArgumentException("Missing file name");
        }
        validateFileName(name);

        if (url == null || url.isEmpty()) {
            throw new IllegalArgumentException("Missing file url");
        }
        validateUrl(url);

        if (sha256 == null || sha256.isEmpty()) {
            throw new IllegalArgumentException("Missing sha256 for file: " + name);
        }

        long bytes = obj.optLong("bytes", -1);
        if (bytes < 0) {
            throw new IllegalArgumentException("Missing or negative bytes for file: " + name);
        }
        if (bytes > MAX_SINGLE_FILE_BYTES) {
            throw new IllegalArgumentException("File exceeds 400 MB: " + name + " (" + bytes + " bytes)");
        }

        return new ManifestFile(name, url, bytes, sha256);
    }

    private static ReplyFile parseReplyFile(JSONObject obj) {
        String text = obj.optString("text", null);
        String url = obj.optString("url", null);
        String sha256 = obj.optString("sha256", null);
        String format = obj.optString("format", null);

        if (text == null || text.isEmpty()) {
            throw new IllegalArgumentException("Missing reply text");
        }
        if (url == null || url.isEmpty()) {
            throw new IllegalArgumentException("Missing reply url");
        }
        validateUrl(url);

        if (sha256 == null || sha256.isEmpty()) {
            throw new IllegalArgumentException("Missing sha256 for reply: " + text);
        }
        if (format == null || format.isEmpty()) {
            throw new IllegalArgumentException("Missing format for reply: " + text);
        }

        long bytes = obj.optLong("bytes", -1);
        if (bytes < 0) {
            throw new IllegalArgumentException("Missing or negative bytes for reply: " + text);
        }
        if (bytes > MAX_SINGLE_FILE_BYTES) {
            throw new IllegalArgumentException("Reply file exceeds 400 MB: " + text);
        }

        return new ReplyFile(text, url, bytes, sha256, format);
    }

    static void validateFileName(String name) {
        if (name.contains("/") || name.contains("\\")) {
            throw new IllegalArgumentException("File name contains path separator: " + name);
        }
        if (name.contains("..")) {
            throw new IllegalArgumentException("File name contains '..': " + name);
        }
    }

    static void validateUrl(String url) {
        if (!url.toLowerCase().startsWith("https://")) {
            throw new IllegalArgumentException("Non-https URL: " + url);
        }
    }
}
