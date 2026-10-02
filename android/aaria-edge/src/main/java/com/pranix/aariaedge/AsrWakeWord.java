package com.pranix.aariaedge;

import android.content.Context;
import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

public class AsrWakeWord implements WakeWordDetector {
    private final CommandRecognizer recognizer;
    private final Context context;
    private final MemoryStore memoryStore;
    private final List<String> prefixes = new ArrayList<>();
    private final AariaEdgePlugin plugin;

    public AsrWakeWord(Context context, CommandRecognizer recognizer, MemoryStore memoryStore, AariaEdgePlugin plugin) {
        this.context = context;
        this.recognizer = recognizer;
        this.memoryStore = memoryStore;
        this.plugin = plugin;
        loadPrefixes();
    }

    private void loadPrefixes() {
        try {
            try (InputStream is = context.getAssets().open("wakeword/prefixes.json")) {
                byte[] buffer = new byte[is.available()];
                is.read(buffer);
                String json = new String(buffer, StandardCharsets.UTF_8);
                JSONObject obj = new JSONObject(json);
                String[] langs = {"en", "hi", "te"};
                for (String l : langs) {
                    if (obj.has(l)) {
                        JSONArray arr = obj.getJSONArray(l);
                        for (int i = 0; i < arr.length(); i++) {
                            prefixes.add(WakeWordMatcher.transliterateToLatin(arr.getString(i).toLowerCase()));
                        }
                    }
                }
            }
        } catch (Exception e) {
            prefixes.add("hey");
            prefixes.add("hi");
            prefixes.add("hello");
        }
    }

    @Override
    public void load(File modelDir) {
        // AsrWakeWord uses existing CommandRecognizer, so load does nothing.
    }

    @Override
    public String id() {
        return "asr_wakeword";
    }

    @Override
    public float score(short[] frame16k) {
        if (recognizer == null) return 0.0f;
        CommandRecognizer.RecognizeResult result = recognizer.recognizeCommand(frame16k, 16000);
        if (result == null || result.transcript == null || result.transcript.trim().isEmpty()) {
            return 0.0f;
        }

        String rawTranscript = result.transcript;

        String wakeName = "Aaria";
        List<String> aliases = new ArrayList<>();
        try {
            JSONObject pref = memoryStore.get("preference", "wake_name");
            if (pref != null) {
                JSONObject value = new JSONObject(pref.getString("value"));
                wakeName = value.optString("name", "Aaria");
                JSONArray arr = value.optJSONArray("aliases");
                if (arr != null) {
                    for (int i = 0; i < arr.length(); i++) {
                        aliases.add(arr.getString(i));
                    }
                }
            }
        } catch (Exception e) {}

        WakeWordMatcher matcher = new WakeWordMatcher(prefixes);
        WakeWordMatcher.MatchResult matchResult = matcher.match(rawTranscript, wakeName, aliases);

        if (matchResult.isMatch) {
            if (matchResult.isShort && plugin != null) {
                plugin.emitWakeNameWeak("too_short");
            }
            return matchResult.score;
        }

        return 0.0f;
    }
}
