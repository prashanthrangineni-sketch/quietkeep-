package com.pranix.aariaedge;

import org.json.JSONObject;

public class ConsentStore {

    public static final int NOTICE_VERSION = 1;

    private final MemoryStore memoryStore;
    private final MemoryStore.Clock clock;

    public ConsentStore(MemoryStore memoryStore) {
        this(memoryStore, System::currentTimeMillis);
    }

    public ConsentStore(MemoryStore memoryStore, MemoryStore.Clock clock) {
        this.memoryStore = memoryStore;
        this.clock = clock;
    }

    public JSONObject getConsent() {
        return memoryStore.get("preference", "consent");
    }

    public boolean hasConsent() {
        JSONObject consent = getConsent();
        if (consent == null) return false;
        try {
            JSONObject value = new JSONObject(consent.getString("value"));
            int version = value.optInt("noticeVersion", 0);
            return version >= NOTICE_VERSION;
        } catch (Exception e) {
            return false;
        }
    }

    public void recordConsent(String lang, JSONObject choices) {
        try {
            JSONObject value = new JSONObject();
            value.put("noticeVersion", NOTICE_VERSION);
            value.put("lang", lang);
            value.put("acceptedAt", clock.currentTimeMillis());
            value.put("choices", choices);
            memoryStore.put("preference", "consent", value.toString(), 3650); 
        } catch (Exception e) {
            throw new RuntimeException("Failed to record consent", e);
        }
    }

    public void updateChoices(JSONObject choices) {
        JSONObject consent = getConsent();
        if (consent != null) {
            try {
                JSONObject value = new JSONObject(consent.getString("value"));
                value.put("choices", choices);
                memoryStore.put("preference", "consent", value.toString(), 3650);
            } catch (Exception e) {
                throw new RuntimeException("Failed to update choices", e);
            }
        }
    }

    public void withdrawConsent() {
        String id = getConsentId();
        if (id != null) {
            memoryStore.remove(id);
        }
    }

    private String getConsentId() {
        JSONObject consent = getConsent();
        return consent != null ? consent.optString("id") : null;
    }

    public MemoryStore.WipeResult withdrawAndDelete() {
        withdrawConsent();
        return memoryStore.wipeEverything();
    }
}
