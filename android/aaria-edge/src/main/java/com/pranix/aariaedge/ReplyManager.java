package com.pranix.aariaedge;

import android.content.Context;
import org.json.JSONObject;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

public class ReplyManager {
    private final Context context;
    private final Map<String, JSONObject> replies = new HashMap<>();
    private JSONObject intentReplies;

    public ReplyManager(Context context) {
        this.context = context;
        loadIntentReplies();
    }

    private void loadIntentReplies() {
        try {
            InputStream is = context.getAssets().open("replies/intent_replies.json");
            byte[] buffer = new byte[is.available()];
            is.read(buffer);
            is.close();
            intentReplies = new JSONObject(new String(buffer, StandardCharsets.UTF_8));
        } catch (Exception e) {
            intentReplies = new JSONObject();
        }
    }

    public JSONObject getLanguageReplies(String lang) {
        if (replies.containsKey(lang)) {
            return replies.get(lang);
        }
        try {
            InputStream is = context.getAssets().open("replies/" + lang + ".json");
            byte[] buffer = new byte[is.available()];
            is.read(buffer);
            is.close();
            JSONObject langReplies = new JSONObject(new String(buffer, StandardCharsets.UTF_8));
            replies.put(lang, langReplies);
            return langReplies;
        } catch (Exception e) {
            JSONObject empty = new JSONObject();
            replies.put(lang, empty);
            return empty;
        }
    }

    public String getReplyIdForIntent(String intent) {
        if (intentReplies.has(intent)) {
            return intentReplies.optString(intent);
        }
        return "ok"; // Default fallback
    }
    
    public String getReplyIdForNeedsCloud(String reason) {
        if ("no_match".equals(reason) || "too_long".equals(reason)) {
            return "didnt_catch";
        }
        return "checking_online";
    }

    public String getTextForReplyId(String lang, String replyId) {
        JSONObject langReplies = getLanguageReplies(lang);
        if (langReplies.has(replyId)) {
            return langReplies.optString(replyId);
        }
        return null;
    }
}
