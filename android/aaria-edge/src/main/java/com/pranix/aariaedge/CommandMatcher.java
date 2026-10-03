package com.pranix.aariaedge;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.ArrayList;
import java.util.Map;

public class CommandMatcher {

    public static class MatchResult {
        public String intent;
        public double confidence;
        public Map<String, String> slots;

        public MatchResult(String intent, double confidence, Map<String, String> slots) {
            this.intent = intent;
            this.confidence = confidence;
            this.slots = slots;
        }
    }

    private Map<String, List<String>> intentToPhrases = new HashMap<>();

    private String normalize(String text) {
        if (text == null) return "";
        return text.toLowerCase().replaceAll("[\\p{P}\\u0964\\u0965]+", "").trim().replaceAll("\\s+", " ");
    }

    public CommandMatcher(String jsonContent) {
        try {
            // Remove // comments at the beginning of the file if any
            String[] lines = jsonContent.split("\n");
            StringBuilder cleanJson = new StringBuilder();
            for (String line : lines) {
                if (!line.trim().startsWith("//")) {
                    cleanJson.append(line).append("\n");
                }
            }
            
            JSONObject obj = new JSONObject(cleanJson.toString());
            Iterator<String> keys = obj.keys();
            while (keys.hasNext()) {
                String intent = keys.next();
                JSONArray phrasesArr = obj.getJSONArray(intent);
                List<String> phrases = new ArrayList<>();
                for (int i = 0; i < phrasesArr.length(); i++) {
                    phrases.add(normalize(phrasesArr.getString(i)));
                }
                intentToPhrases.put(intent, phrases);
            }
        } catch (JSONException e) {
            e.printStackTrace();
        }
    }

    public MatchResult match(String transcript) {
        String normalizedTranscript = normalize(transcript);
        if (normalizedTranscript.isEmpty()) {
            return null;
        }
        
        MatchResult bestMatch = null;
        int maxPhraseLength = -1;

        // Exact match
        for (Map.Entry<String, List<String>> entry : intentToPhrases.entrySet()) {
            for (String phrase : entry.getValue()) {
                if (normalizedTranscript.equals(phrase)) {
                    if (phrase.length() > maxPhraseLength) {
                        maxPhraseLength = phrase.length();
                        bestMatch = new MatchResult(entry.getKey(), 1.0, new HashMap<>());
                    }
                }
            }
        }
        if (bestMatch != null) return bestMatch;
        
        // Contains match (only if <= 4 words)
        String[] words = normalizedTranscript.split("\\s+");
        if (words.length > 4) {
            return null;
        }

        String paddedTranscript = " " + normalizedTranscript + " ";
        maxPhraseLength = -1;
        for (Map.Entry<String, List<String>> entry : intentToPhrases.entrySet()) {
            for (String phrase : entry.getValue()) {
                if (paddedTranscript.contains(" " + phrase + " ")) {
                    if (phrase.length() > maxPhraseLength) {
                        maxPhraseLength = phrase.length();
                        bestMatch = new MatchResult(entry.getKey(), 0.8, new HashMap<>());
                    }
                }
            }
        }

        return bestMatch;
    }
}
