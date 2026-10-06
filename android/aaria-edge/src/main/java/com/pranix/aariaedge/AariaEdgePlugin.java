package com.pranix.aariaedge;

import android.Manifest;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONArray;
import org.json.JSONObject;
import android.content.Intent;

@CapacitorPlugin(
    name = "AariaEdge",
    permissions = {
        @Permission(
            alias = "microphone",
            strings = { Manifest.permission.RECORD_AUDIO }
        )
    }
)
public class AariaEdgePlugin extends Plugin {

    private AariaEdge implementation;
    private CommandRecognizer commandRecognizer;
    private ModelStore modelStore;
    private String currentLang = "en";
    private PhraseCache phraseCache;
    private ReplyManager replyManager;
    private boolean autoReply = false;
    private String replyVoiceId = "default";
    private ExecutorService executor;
    private MemoryStore memoryStore;
    private boolean rememberCommands = false;
    private boolean rememberTranscripts = false;

    private int statsHeard = 0;
    private int statsScored = 0;
    private int statsSkipped = 0;
    
    private volatile boolean isListeningPaused = false;
    private volatile String pauseReason = null;
    
    private String manifestUrl = null;
    private String manifestPublicKey = null;
    private ConsentStore consentStore;
    
    public static AariaEdgePlugin instance;
    private WakeWordDetector wakeWordDetector;
    // Read and written from the listening thread and from the app's calls.
    private volatile boolean isWaitingForWakeWord = false;
    private final Object nameLock = new Object();
    private int nameEpoch = 0;
    // "Turn off" and what is sent to the app. offCount goes up when a turn-off begins and again when the
    // recorder has stopped; turningOff is true in between. Speech is remembered with the count at the moment
    // it was heard, and is stale once the count has moved or while a turn-off is under way. Nothing made
    // from stale speech is sent. A turn-off and a send never overlap (sendLock), so nothing can be sent
    // after a turn-off has begun.
    private final java.util.concurrent.atomic.AtomicInteger offCount = new java.util.concurrent.atomic.AtomicInteger();
    private volatile boolean turningOff = false;
    // True from the moment the recorder is told to stop until it is next started. Whatever a stopped
    // recorder still delivers (the tail of what it was hearing, or everything, if it refused to stop) is
    // thrown away.
    private volatile boolean speechUnwanted = false;
    private final Object sendLock = new Object();

    private boolean stale(int offCountWhenHeard) {
        return turningOff || speechUnwanted || offCount.get() != offCountWhenHeard;
    }

    /** After a command: back to waiting for the wake name, unless a turn-off has begun meanwhile. */
    private void rearmIfStillOn(int offCountWhenHeard) {
        synchronized (sendLock) {
            if (!stale(offCountWhenHeard) && isBackgroundListeningInternal()) isWaitingForWakeWord = true;
        }
    }

    /** Sends an event made from speech, unless that speech is stale. Returns false when it was not sent. */
    private boolean sendIfStillOn(int offCountWhenHeard, String eventName, JSObject data) {
        synchronized (sendLock) {
            if (stale(offCountWhenHeard)) return false;
            notifyListeners(eventName, data);
            return true;
        }
    }

    /**
     * The next thing heard must be checked for the wake name. It also overrules a wake that is still being
     * worked out on the listening thread: that one may no longer switch to "the next thing is a command".
     */
    private void waitForNameAgain() {
        synchronized (nameLock) {
            nameEpoch++;
            isWaitingForWakeWord = true;
        }
    }
    private long lastWakeWordTime = 0;

    private int initAttempts = 0;
    private String unavailableReason = null;

    public final ListenController listenController = new ListenController(new ListenController.Recorder() {
        @Override
        public void start() throws Exception {
            NightlySyncWorker.microphoneActive = true;
            try {
                implementation.start(16000, 250, 600);
            } catch (Exception e) {
                NightlySyncWorker.microphoneActive = false;
                throw e;
            }
            speechUnwanted = false;
            // Listening that starts, or comes back after any pause, always waits for the wake name.
            waitForNameAgain();
        }
        @Override
        public void stop() {
            // Set first: speech that arrives while it is stopping, or after, is not used.
            speechUnwanted = true;
            try {
                if (implementation != null) implementation.stop();
            } finally {
                NightlySyncWorker.microphoneActive = false;
            }
        }
        @Override
        public boolean isRunning() {
            return NightlySyncWorker.microphoneActive;
        }
    }, new ListenController.Events() {
        @Override
        public void paused(String reason) {
            AariaEdgePlugin.this.isListeningPaused = true;
            AariaEdgePlugin.this.pauseReason = reason;
            JSObject ev = new JSObject();
            ev.put("reason", reason);
            notifyListeners("listeningPaused", ev);
        }
        @Override
        public void resumed() {
            AariaEdgePlugin.this.isListeningPaused = false;
            AariaEdgePlugin.this.pauseReason = null;
            notifyListeners("listeningResumed", new JSObject());
        }
        @Override
        public void notificationChanged() {
            if (getContext() != null) {
                android.content.Intent intent = new android.content.Intent(getContext(), AariaListenService.class);
                intent.setAction(AariaListenService.ACTION_UPDATE_STATE);
                intent.putExtra("isPaused", AariaEdgePlugin.this.isListeningPaused);
                intent.putExtra("pauseReason", AariaEdgePlugin.this.pauseReason);
                try { getContext().startService(intent); } catch (Exception ignored) {}
            }
        }
    }, () -> android.os.SystemClock.elapsedRealtime());   // counts through sleep; a changed clock does not move it

    private synchronized boolean ensureReady() {
        if (initAttempts > 0 && unavailableReason == null) return true;
        if (initAttempts >= 2) return false;
        
        initAttempts++;
        try {
            if (phraseCache == null) phraseCache = new PhraseCache(new java.io.File(getContext().getFilesDir(), "phrase_cache"));
            if (memoryStore == null) memoryStore = new MemoryStore(
                    new java.io.File(getContext().getNoBackupFilesDir(), "aaria_memory"),
                    new KeystoreKeyProvider(), phraseCache);
            if (consentStore == null) consentStore = new ConsentStore(memoryStore);
            if (replyManager == null) replyManager = new ReplyManager(getContext());
            if (modelStore == null) modelStore = new ModelStore(getContext());
            if (commandRecognizer == null) commandRecognizer = new CommandRecognizer(getContext(), modelStore);
            if (wakeWordDetector == null) loadWakeWordDetector();
            
            if (implementation == null) {
                implementation = new AariaEdge(getContext(), new AariaEdge.EventListener() {
                    @Override
                    public void onSpeechStart(long t) {
                        JSObject ret = new JSObject();
                        ret.put("t", t);
                        notifyListeners("speechStart", ret);
                    }

                    @Override
                    public void onSpeechEnd(long t, long durationMs, short[] audioData) {
                        JSObject ret = new JSObject();
                        ret.put("t", t);
                        ret.put("durationMs", durationMs);
                        notifyListeners("speechEnd", ret);

                        // Speech that arrives while a turn-off is under way, or from a recorder that has been told
                        // to stop, is thrown away here and now, whatever happens before its turn would have come.
                        if (turningOff || speechUnwanted) return;
                        // Speech heard before a turn-off is thrown away when its turn comes.
                        final int offCountWhenHeard = offCount.get();
                        executor.submit(() -> {
                            if (stale(offCountWhenHeard)) return;
                            if (System.currentTimeMillis() - lastWakeWordTime < 1500) return;
                            final int nameEpochAtStart;
                            synchronized (nameLock) { nameEpochAtStart = nameEpoch; }
                            // The app holds the microphone: whatever was still being worked out is dropped.
                            if (listenController.isHeldByApp()) return;
                            statsHeard++;

                            // Read once: a turn-off in the middle must not turn a wake check into a command.
                            final boolean checkForName = isWaitingForWakeWord;
                            if (checkForName) {
                                if (durationMs < 300) {
                                    statsSkipped++;
                                    return;
                                }

                                if (wakeWordDetector != null) {
                                    int wakeSamples = 1500 * 16;
                                    short[] wakeData = audioData;
                                    if (audioData.length > wakeSamples) {
                                        wakeData = new short[wakeSamples];
                                        System.arraycopy(audioData, 0, wakeData, 0, wakeSamples);
                                    }
                                    
                                    statsScored++;
                                    float score = wakeWordDetector.score(wakeData);
                                    if (score >= 0.8f) {
                                        boolean hasCommand = false;
                                        String commandTranscript = "";

                                        if (durationMs > 1500 + 300) {
                                            int maxSamples = 8000 * 16;
                                            short[] cmdData = audioData;
                                            if (audioData.length > maxSamples) {
                                                cmdData = new short[maxSamples];
                                                System.arraycopy(audioData, 0, cmdData, 0, maxSamples);
                                            }

                                            try {
                                                if (commandRecognizer != null) {
                                                    CommandRecognizer.RecognizeResult res = commandRecognizer.recognizeCommand(cmdData, 16000);
                                                    if (res != null && res.transcript != null) {
                                                        JSONObject pref = memoryStore.get("preference", "wake_name");
                                                        // No stored name means the default name, exactly as the wake check assumes.
                                                        {
                                                            try {
                                                                JSONObject value = pref != null ? new JSONObject(pref.getString("value")) : new JSONObject();
                                                                String wakeName = value.optString("name", "Aaria");
                                                                JSONArray aliases = value.optJSONArray("aliases");
                                                                List<String> aList = new ArrayList<>();
                                                                if (aliases != null) {
                                                                    for (int i=0; i<aliases.length(); i++) aList.add(aliases.getString(i));
                                                                }
                                                                
                                                                WakeWordMatcher matcher = new WakeWordMatcher(getPrefixes());
                                                                String stripped = matcher.stripWake(res.transcript, wakeName, aList);
                                                                if (!stripped.isEmpty()) {
                                                                    hasCommand = true;
                                                                    commandTranscript = stripped;
                                                                }
                                                            } catch (Exception ignored) {}
                                                        }
                                                    }
                                                }
                                            } catch (Exception ignored) {}
                                        }

                                        // The app took the microphone, or listening was turned off, while this was being
                                        // worked out: drop it. Nobody is told of a wake after "Turn off".
                                        if (listenController.isHeldByApp() || stale(offCountWhenHeard)) return;

                                        JSObject ev = new JSObject();
                                        ev.put("id", wakeWordDetector.id());
                                        ev.put("score", score);
                                        ev.put("t", t);
                                        ev.put("hasCommand", hasCommand);
                                        // The rest of the sentence with the wake name removed, for an app that acts on a one-breath command itself.
                                        if (hasCommand) ev.put("text", commandTranscript);
                                        // A bare wake: the next thing heard is the command. This is set BEFORE the app is told,
                                        // so an app that answers with holdMicrophone() is not overruled a moment later. And it
                                        // is not set at all if "wait for the name" was asked for while this was being worked out.
                                        if (!hasCommand) {
                                            synchronized (nameLock) {
                                                if (nameEpoch == nameEpochAtStart) isWaitingForWakeWord = false;
                                            }
                                        }
                                        if (!sendIfStillOn(offCountWhenHeard, "wakeWord", ev)) return;
                                        playChime();
                                        lastWakeWordTime = System.currentTimeMillis();

                                        if (hasCommand) {
                                            try {
                                                if (commandRecognizer == null) throw new RuntimeException("no_engine");
                                                com.pranix.aariaedge.CommandMatcher.MatchResult matchResult = commandRecognizer.matchCommand(commandTranscript);
                                                if (matchResult == null) {
                                                    JSObject cmd = new JSObject();
                                                    cmd.put("reason", "no_match");
                                                    cmd.put("durationMs", durationMs);
                                                    cmd.put("transcript", commandTranscript);
                                                    if (!sendIfStillOn(offCountWhenHeard, "needsCloud", cmd)) return;
                                                } else {
                                                    JSObject cmd = new JSObject();
                                                    cmd.put("intent", matchResult.intent);
                                                    cmd.put("confidence", matchResult.confidence);
                                                    cmd.put("transcript", commandTranscript);
                                                    cmd.put("lang", currentLang);
                                                    cmd.put("onDevice", true);
                                                    if (!sendIfStillOn(offCountWhenHeard, "commandRecognized", cmd)) return;
                                                    if (rememberCommands) {
                                                        try {
                                                            String value = "{\"intent\":\"" + matchResult.intent + "\",\"time\":" + System.currentTimeMillis() + "}";
                                                            if (rememberTranscripts) {
                                                                value = "{\"intent\":\"" + matchResult.intent + "\",\"transcript\":\"" + commandTranscript + "\",\"time\":" + System.currentTimeMillis() + "}";
                                                            }
                                                            memoryStore.put("recent_command", matchResult.intent + "_" + System.currentTimeMillis(), value, 7);
                                                        } catch (Exception ignored) {}
                                                    }
                                                }
                                            } catch (Throwable t2) {
                                                JSObject cmd = new JSObject();
                                                cmd.put("reason", "no_engine");
                                                cmd.put("durationMs", durationMs);
                                                if (!sendIfStillOn(offCountWhenHeard, "needsCloud", cmd)) return;
                                            }
                                        }
                                    }
                                }
                                return;
                            }

                            if (durationMs > 3000) {
                                JSObject cmd = new JSObject();
                                cmd.put("reason", "too_long");
                                cmd.put("durationMs", durationMs);
                                if (!sendIfStillOn(offCountWhenHeard, "needsCloud", cmd)) return;
                                rearmIfStillOn(offCountWhenHeard);
                                return;
                            }

                            CommandRecognizer.RecognizeResult result;
                            try {
                                if (commandRecognizer == null) throw new RuntimeException("no_engine");
                                result = commandRecognizer.recognizeCommand(audioData, 16000);
                            } catch (Throwable t2) {
                                JSObject cmd = new JSObject();
                                cmd.put("reason", "no_engine");
                                cmd.put("durationMs", durationMs);
                                if (!sendIfStillOn(offCountWhenHeard, "needsCloud", cmd)) return;
                                rearmIfStillOn(offCountWhenHeard);
                                return;
                            }

                            // Listening was turned off while this was being worked out: nothing is sent to the app,
                            // and what was said goes nowhere.
                            if (stale(offCountWhenHeard)) return;

                            if (result == null) {
                                JSObject cmd = new JSObject();
                                cmd.put("reason", "no_model");
                                cmd.put("durationMs", durationMs);
                                if (!sendIfStillOn(offCountWhenHeard, "needsCloud", cmd)) return;
                                rearmIfStillOn(offCountWhenHeard);
                                return;
                            }

                            if (result.matchResult == null) {
                                JSObject cmd = new JSObject();
                                cmd.put("reason", "no_match");
                                cmd.put("durationMs", durationMs);
                                cmd.put("transcript", result.transcript);
                                if (!sendIfStillOn(offCountWhenHeard, "needsCloud", cmd)) return;
                                rearmIfStillOn(offCountWhenHeard);
                                return;
                            }

                            JSObject cmd = new JSObject();
                            cmd.put("intent", result.matchResult.intent);
                            cmd.put("confidence", result.matchResult.confidence);
                            cmd.put("transcript", result.transcript);
                            cmd.put("lang", currentLang);
                            cmd.put("onDevice", true);
                            if (!sendIfStillOn(offCountWhenHeard, "commandRecognized", cmd)) return;

                            if (rememberCommands) {
                                try {
                                    String value = "{\"intent\":\"" + result.matchResult.intent + "\",\"time\":" + System.currentTimeMillis() + "}";
                                    if (rememberTranscripts) {
                                        value = "{\"intent\":\"" + result.matchResult.intent + "\",\"transcript\":\"" + result.transcript + "\",\"time\":" + System.currentTimeMillis() + "}";
                                    }
                                    memoryStore.put("recent_command", result.matchResult.intent + "_" + System.currentTimeMillis(), value, 7);
                                } catch (Exception ignored) {}
                            }
                            rearmIfStillOn(offCountWhenHeard);
                        });
                    }

                    @Override
                    public void onLevel(double rms) {
                        JSObject ret = new JSObject();
                        ret.put("rms", rms);
                        notifyListeners("level", ret);
                    }
                });
            }
            
            unavailableReason = null;
            return true;
        } catch (Throwable t) {
            try { android.util.Log.e("AariaEdge", "Init failed", t); } catch (Throwable ignored) {}
            unavailableReason = t.getMessage();
            if (unavailableReason == null) unavailableReason = t.getClass().getSimpleName();
            return false;
        }
    }

    @Override
    public void load() {
        try {
            executor = Executors.newSingleThreadExecutor();
            instance = this;
        } catch (Throwable t) {
        }
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        boolean ready = ensureReady();
        JSObject ret = new JSObject();
        ret.put("available", ready);
        ret.put("reason", ready ? null : (unavailableReason != null ? unavailableReason : "unknown_error"));
        ret.put("heard", statsHeard);
        ret.put("scored", statsScored);
        ret.put("skipped", statsSkipped);
        call.resolve(ret);
    }

    /** Really loads the recogniser for the current language. "Ready" on a screen should rest on this, not on files existing. */
    @PluginMethod
    public void checkRecognizer(PluginCall call) {
        if (!ensureReady()) { call.reject("aaria_unavailable"); return; }
        String reason;
        if (implementation == null || !implementation.isSpeechDetectorReady()) {
            reason = "detector_missing";
        } else {
            reason = commandRecognizer == null ? "load_failed" : commandRecognizer.checkReady();
        }
        JSObject ret = new JSObject();
        ret.put("ok", reason == null);
        if (reason != null) ret.put("reason", reason);
        call.resolve(ret);
    }

    @PluginMethod
    public void setLanguage(PluginCall call) {
        if (!ensureReady()) { call.reject("aaria_unavailable"); return; }
        String lang = call.getString("lang", "en");
        currentLang = lang;
        if (commandRecognizer != null) {
            commandRecognizer.setLanguage(lang);
        }
        call.resolve();
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (!ensureReady()) { call.reject("aaria_unavailable"); return; }
        if (!consentStore.hasConsent()) {
            call.reject("consent_required");
            return;
        }
        if (getPermissionState("microphone") != com.getcapacitor.PermissionState.GRANTED) {
            requestPermissionForAlias("microphone", call, "microphonePermsCallback");
        } else {
            startAudio(call);
        }
    }

    @PermissionCallback
    private void microphonePermsCallback(PluginCall call) {
        if (getPermissionState("microphone") == com.getcapacitor.PermissionState.GRANTED) {
            startAudio(call);
        } else {
            call.reject("Permission denied");
        }
    }

    private String replyVoiceGender = "female";

    // ...

    private void startAudio(PluginCall call) {
        JSONObject consent = consentStore.getConsent();
        JSONObject choices = new JSONObject();
        if (consent != null) {
            try {
                JSONObject value = new JSONObject(consent.getString("value"));
                choices = value.optJSONObject("choices");
                if (choices == null) choices = new JSONObject();
            } catch (Exception e) {}
        }

        autoReply = Boolean.TRUE.equals(call.getBoolean("autoReply", false));
        replyVoiceId = call.getString("replyVoiceId", "default");
        replyVoiceGender = call.getString("replyVoiceGender", "female");
        rememberCommands = choices.optBoolean("rememberCommands", false);
        rememberTranscripts = choices.optBoolean("keepTranscripts", false);

        if (!choices.optBoolean("nightlyDownloads", true)) {
            NightlySyncWorker.cancel(getContext());
        }

        int sampleRate = call.getInt("sampleRate", 16000);
        int minSpeechMs = call.getInt("minSpeechMs", 250);
        int minSilenceMs = call.getInt("minSilenceMs", 600);

        try {
            NightlySyncWorker.microphoneActive = true;
            implementation.start(sampleRate, minSpeechMs, minSilenceMs);
            speechUnwanted = false;
            call.resolve();
        } catch (Exception e) {
            NightlySyncWorker.microphoneActive = false;
            call.reject(e.getMessage());
        }
    }

    private void handleAutoReplyNeedsCloud(String reason) {
        if (!autoReply) return;
        String replyId = replyManager.getReplyIdForNeedsCloud(reason);
        doSpeakCached(currentLang, replyId, null, true);
    }

    private void handleAutoReplyCommand(String intent) {
        if (!autoReply) return;
        String replyId = replyManager.getReplyIdForIntent(intent);
        doSpeakCached(currentLang, replyId, null, true);
    }

    private void doSpeakCached(String lang, String replyId, String fallbackText, boolean isAutoReply) {
        String text = null;
        if (replyId != null) {
            String effectiveLang = lang;
            if ("hi".equals(lang) && "male".equals(replyVoiceGender)) effectiveLang = "hi_m";
            text = replyManager.getTextForReplyId(effectiveLang, replyId);
        }
        if (text == null) {
            text = fallbackText;
        }

        JSObject emitEvent = new JSObject();
        if (replyId != null) emitEvent.put("replyId", replyId);

        if (text == null) {
            if (isAutoReply) {
                emitEvent.put("played", false);
                emitEvent.put("reason", "not_cached");
                notifyListeners("replySpoken", emitEvent);
            }
            return;
        }

        PhraseCache.CacheEntry entry = phraseCache.getEntry(replyVoiceId, lang, text);
        if (entry == null) {
            if (isAutoReply) {
                emitEvent.put("played", false);
                emitEvent.put("reason", "not_cached");
                if (text != null) emitEvent.put("text", text);
                notifyListeners("replySpoken", emitEvent);
            }
            return;
        }

        implementation.pause();
        AudioPlayer.PlaybackCallback callback = () -> {
            implementation.resume();
            if (isAutoReply) {
                emitEvent.put("played", true);
                emitEvent.put("key", entry.key);
                notifyListeners("replySpoken", emitEvent);
            }
        };

        if ("OGG".equalsIgnoreCase(entry.format)) {
            java.io.File file = new java.io.File(getContext().getFilesDir(), "phrase_cache/" + entry.key + ".audio");
            AudioPlayer.playOgg(getContext(), file, callback);
        } else {
            AudioPlayer.playWav(entry.bytes, callback);
        }
    }

    @PluginMethod
    public void cachePhrase(PluginCall call) {
        if (!ensureReady()) { call.reject("aaria_unavailable"); return; }
        String voiceId = call.getString("voiceId", "default");
        String lang = call.getString("lang");
        String text = call.getString("text");
        String audioBase64 = call.getString("audioBase64");
        String format = call.getString("format");

        if (lang == null || text == null || audioBase64 == null || format == null) {
            call.reject("Missing required fields");
            return;
        }

        try {
            byte[] audioBytes = android.util.Base64.decode(audioBase64, android.util.Base64.DEFAULT);
            PhraseCache.PutResult result = phraseCache.put(voiceId, lang, text, audioBytes, format);
            JSObject ret = new JSObject();
            ret.put("key", result.key);
            ret.put("bytes", result.bytes);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void speakCached(PluginCall call) {
        if (!ensureReady()) { call.reject("aaria_unavailable"); return; }
        String voiceId = call.getString("voiceId", "default");
        String lang = call.getString("lang", currentLang);
        String replyId = call.getString("replyId");
        String fallbackText = call.getString("text");

        String text = null;
        if (replyId != null) {
            String effectiveLang = lang;
            if ("hi".equals(lang) && "male".equals(replyVoiceGender)) effectiveLang = "hi_m";
            text = replyManager.getTextForReplyId(effectiveLang, replyId);
        }
        if (text == null) {
            text = fallbackText;
        }

        if (text == null) {
            JSObject ret = new JSObject();
            ret.put("played", false);
            ret.put("reason", "not_cached");
            call.resolve(ret);
            return;
        }

        PhraseCache.CacheEntry entry = phraseCache.getEntry(voiceId, lang, text);
        if (entry == null) {
            JSObject ret = new JSObject();
            ret.put("played", false);
            ret.put("reason", "not_cached");
            ret.put("text", text);
            call.resolve(ret);
            return;
        }

        implementation.pause();
        AudioPlayer.PlaybackCallback callback = () -> {
            implementation.resume();
        };

        if ("OGG".equalsIgnoreCase(entry.format)) {
            java.io.File file = new java.io.File(getContext().getFilesDir(), "phrase_cache/" + entry.key + ".audio");
            AudioPlayer.playOgg(getContext(), file, callback);
        } else {
            AudioPlayer.playWav(entry.bytes, callback);
        }

        JSObject ret = new JSObject();
        ret.put("played", true);
        ret.put("key", entry.key);
        call.resolve(ret);
    }

    @PluginMethod
    public void listCached(PluginCall call) {
        if (!ensureReady()) { call.reject("aaria_unavailable"); return; }
        try {
            List<String> list = phraseCache.list();
            JSObject ret = new JSObject();
            JSONArray arr = new JSONArray();
            for (String key : list) {
                arr.put(key);
            }
            ret.put("keys", arr);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void clearCache(PluginCall call) {
        if (!ensureReady()) { call.reject("aaria_unavailable"); return; }
        try {
            phraseCache.clearAll();
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    // ---- Memory methods ----

    @PluginMethod
    public void remember(PluginCall call) {
        if (!ensureReady()) { call.reject("aaria_unavailable"); return; }
        String kind = call.getString("kind");
        String key = call.getString("key");
        String value = call.getString("value");
        Integer ttlDays = call.getInt("ttlDays", 0);

        if (kind == null || key == null || value == null) {
            call.reject("Missing required fields: kind, key, value");
            return;
        }

        try {
            String id = memoryStore.put(kind, key, value, ttlDays);
            JSObject ret = new JSObject();
            ret.put("id", id);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void recall(PluginCall call) {
        if (!ensureReady()) { call.reject("aaria_unavailable"); return; }
        String kind = call.getString("kind");
        String key = call.getString("key");

        if (kind == null || key == null) {
            call.reject("Missing required fields: kind, key");
            return;
        }

        try {
            JSONObject rec = memoryStore.get(kind, key);
            if (rec == null) {
                JSObject ret = new JSObject();
                ret.put("found", false);
                call.resolve(ret);
                return;
            }
            JSObject ret = new JSObject();
            ret.put("found", true);
            ret.put("id", rec.optString("id"));
            ret.put("kind", rec.optString("kind"));
            ret.put("key", rec.optString("key"));
            ret.put("value", rec.optString("value"));
            ret.put("createdAt", rec.optLong("createdAt"));
            ret.put("updatedAt", rec.optLong("updatedAt"));
            ret.put("expiresAt", rec.optLong("expiresAt"));
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void listMemory(PluginCall call) {
        if (!ensureReady()) { call.reject("aaria_unavailable"); return; }
        String kind = call.getString("kind");

        try {
            List<JSONObject> records = memoryStore.list(kind);
            JSObject ret = new JSObject();
            JSONArray arr = new JSONArray();
            for (JSONObject rec : records) {
                JSONObject item = new JSONObject();
                item.put("id", rec.optString("id"));
                item.put("kind", rec.optString("kind"));
                item.put("key", rec.optString("key"));
                item.put("value", rec.optString("value"));
                item.put("createdAt", rec.optLong("createdAt"));
                item.put("updatedAt", rec.optLong("updatedAt"));
                item.put("expiresAt", rec.optLong("expiresAt"));
                arr.put(item);
            }
            ret.put("records", arr);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void forget(PluginCall call) {
        if (!ensureReady()) { call.reject("aaria_unavailable"); return; }
        String id = call.getString("id");
        if (id == null) {
            call.reject("Missing required field: id");
            return;
        }

        try {
            boolean removed = memoryStore.remove(id);
            JSObject ret = new JSObject();
            ret.put("removed", removed);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void exportMemory(PluginCall call) {
        if (!ensureReady()) { call.reject("aaria_unavailable"); return; }
        try {
            JSONArray exported = memoryStore.exportAll();
            JSObject ret = new JSObject();
            ret.put("json", exported.toString());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void wipeEverything(PluginCall call) {
        if (!ensureReady()) { call.reject("aaria_unavailable"); return; }
        try {
            MemoryStore.WipeResult result = memoryStore.wipeEverything();
            JSObject ret = new JSObject();
            ret.put("wiped", true);
            ret.put("memoryRecords", result.memoryRecords);
            ret.put("cachedReplies", result.cachedReplies);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void configureSync(PluginCall call) {
        if (!ensureReady()) { call.reject("aaria_unavailable"); return; }
        String url = call.getString("manifestUrl");
        String pubKey = call.getString("manifestPublicKey");
        if (url == null || url.isEmpty()) {
            call.reject("Missing required field: manifestUrl");
            return;
        }
        this.manifestUrl = url;
        this.manifestPublicKey = pubKey;

        // Set up sync event listener
        NightlySyncWorker.eventListener = new NightlySyncWorker.SyncEventListener() {
            @Override
            public void onProgress(String stage, String lang, long bytesDone, long bytesTotal) {
                JSObject ev = new JSObject();
                ev.put("stage", stage);
                ev.put("lang", lang);
                ev.put("bytesDone", bytesDone);
                ev.put("bytesTotal", bytesTotal);
                notifyListeners("syncProgress", ev);
            }

            @Override
            public void onFinished(boolean ok, List<String> updated,
                                   List<String> skipped, List<String> errors) {
                JSObject ev = new JSObject();
                ev.put("ok", ok);
                ev.put("updated", new JSONArray(updated));
                ev.put("skipped", new JSONArray(skipped));
                ev.put("errors", new JSONArray(errors));
                notifyListeners("syncFinished", ev);
            }
        };

        // Schedule periodic nightly sync
        NightlySyncWorker.schedule(getContext(), manifestUrl,
                currentLang, replyVoiceId, manifestPublicKey);
        call.resolve();
    }

    @PluginMethod
    public void syncNow(PluginCall call) {
        if (!ensureReady()) { call.reject("aaria_unavailable"); return; }
        if (manifestUrl == null || manifestUrl.isEmpty()) {
            call.reject("configureSync must be called first");
            return;
        }
        boolean allowMobileData = Boolean.TRUE.equals(call.getBoolean("allowMobileData", false));
        NightlySyncWorker.syncNow(getContext(), manifestUrl,
                currentLang, replyVoiceId, manifestPublicKey, allowMobileData);
        call.resolve();
    }

    @PluginMethod
    @Override
    protected void handleOnDestroy() {
        super.handleOnDestroy();
        NightlySyncWorker.microphoneActive = false;
        if (executor != null) {
            executor.shutdown();
        }
    }

    @PluginMethod
    public void getNotice(PluginCall call) {
        String lang = call.getString("lang", "en");
        try {
            java.io.InputStream is = getContext().getAssets().open("ui/" + lang + ".json");
            java.util.Scanner s = new java.util.Scanner(is).useDelimiter("\\A");
            String json = s.hasNext() ? s.next() : "";
            JSObject ret = new JSObject();
            ret.put("strings", new JSONObject(json));
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Cannot read ui strings for lang " + lang);
        }
    }

    @PluginMethod
    public void recordConsent(PluginCall call) {
        if (!ensureReady()) { call.reject("aaria_unavailable"); return; }
        String lang = call.getString("lang");
        JSObject choices = call.getObject("choices", new JSObject());
        try {
            consentStore.recordConsent(lang, new JSONObject(choices.toString()));
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void getConsent(PluginCall call) {
        if (!ensureReady()) { call.reject("aaria_unavailable"); return; }
        JSONObject consent = consentStore.getConsent();
        if (consent != null) {
            JSObject ret = new JSObject();
            try {
                ret.put("consent", new JSONObject(consent.getString("value")));
                call.resolve(ret);
            } catch (Exception e) {
                call.reject(e.getMessage());
            }
        } else {
            JSObject ret = new JSObject();
            ret.put("consent", JSONObject.NULL);
            call.resolve(ret);
        }
    }

    public static Runnable stopServiceHook = null;

    @PluginMethod
    public void updateChoices(PluginCall call) {
        if (!ensureReady()) { call.reject("aaria_unavailable"); return; }
        JSObject choices = call.getObject("choices");
        try {
            consentStore.updateChoices(new JSONObject(choices.toString()));
            if (!choices.optBoolean("nightlyDownloads", true)) {
                NightlySyncWorker.cancel(getContext());
            }
            if (!choices.optBoolean("wakeWord", false)) {
                stopListeningInternal();
                stop(null);
            } else {
                // If wakeWord is true, pass the new wakeOnBattery flag to the service if it is running
                if (isWaitingForWakeWord && getContext() != null) {
                    android.content.Intent intent = new android.content.Intent(getContext(), AariaListenService.class);
                    intent.setAction(AariaListenService.ACTION_UPDATE_STATE);
                    intent.putExtra("wakeOnBattery", choices.optBoolean("wakeOnBattery", false));
                    try { getContext().startService(intent); } catch (Exception ignored) {}
                }
            }
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void withdrawConsent(PluginCall call) {
        if (!ensureReady()) { call.reject("aaria_unavailable"); return; }
        boolean deleteData = Boolean.TRUE.equals(call.getBoolean("deleteData", false));
        try {
            if (deleteData) {
                consentStore.withdrawAndDelete();
            } else {
                consentStore.withdrawConsent();
            }
            stopListeningInternal();
            stop(call); // Also stop recording and resolve the call
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void getMyData(PluginCall call) {
        if (!ensureReady()) { call.reject("aaria_unavailable"); return; }
        // ... (unchanged)
        try {
            JSONArray records = memoryStore.exportAll();
            int cachedReplies = phraseCache.list().size();

            java.io.File modelsDir = new java.io.File(getContext().getFilesDir(), "models");
            JSONArray models = new JSONArray();
            if (modelsDir.exists() && modelsDir.isDirectory()) {
                for (java.io.File langDir : modelsDir.listFiles()) {
                    if (langDir.isDirectory()) {
                        long size = 0;
                        for (java.io.File f : langDir.listFiles()) size += f.length();
                        JSONObject m = new JSONObject();
                        m.put("name", langDir.getName());
                        m.put("size", size);
                        models.put(m);
                    }
                }
            }

            JSObject ret = new JSObject();
            ret.put("memoryRecords", records);
            ret.put("cachedReplies", cachedReplies);
            ret.put("downloadedModels", models);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    // Wake Word Methods

    public void emitWakeNameWeak(String reason) {
        JSObject ev = new JSObject();
        ev.put("reason", reason);
        notifyListeners("wakeNameWeak", ev);
    }

    private void playChime() {
        try {
            android.media.ToneGenerator tg = new android.media.ToneGenerator(android.media.AudioManager.STREAM_NOTIFICATION, 100);
            tg.startTone(android.media.ToneGenerator.TONE_PROP_BEEP);
            tg.release();
        } catch (Exception e) {}
    }

    private boolean isBackgroundListeningInternal() {
        JSONObject consent = consentStore.getConsent();
        if (consent != null) {
            try {
                JSONObject value = new JSONObject(consent.getString("value"));
                JSONObject choices = value.optJSONObject("choices");
                return choices != null && choices.optBoolean("wakeWord", false);
            } catch (Exception e) {}
        }
        return false;
    }

    public interface ForegroundCheckHook {
        boolean isInForeground();
    }
    public static ForegroundCheckHook foregroundCheckHook = null;

    private boolean isAppInForeground() {
        if (foregroundCheckHook != null) {
            return foregroundCheckHook.isInForeground();
        }
        if (getActivity() == null) return false;
        if (getBridge() == null || getBridge().getWebView() == null) return false;
        if (getBridge().getWebView().getVisibility() != android.view.View.VISIBLE) return false;
        return true;
    }

    public void onBackgroundListeningStopped() {
        // From this line on, nothing made from speech is sent to the app: what was heard before is stale
        // (the count moved), and what is heard while the recorder is stopping is stale too (turningOff).
        synchronized (sendLock) {
            turningOff = true;
            offCount.incrementAndGet();
            isWaitingForWakeWord = false;
        }
        try {
            listenController.turnOff();
        } catch (RuntimeException e) {
            // The controller is off all the same; the rest of the turn-off must still happen.
            android.util.Log.w("AariaEdge", "The recorder did not stop cleanly at turn-off", e);
        } finally {
            if (appHold != null) appHold.cancel();
            synchronized (sendLock) {
                // The recorder has stopped. Speech heard while it was stopping carries the count from above.
                offCount.incrementAndGet();
                isWaitingForWakeWord = false;
                turningOff = false;
            }
            isListeningPaused = false;
            pauseReason = null;
        }
        
        if (getContext() != null) {
            android.content.SharedPreferences prefs = getContext().getSharedPreferences("aaria_prefs", android.content.Context.MODE_PRIVATE);
            prefs.edit().putBoolean("aaria_listen_was_on", false).apply();
        }
    }

    public void stopListeningInternal() {
        onBackgroundListeningStopped();
        
        if (stopServiceHook != null) {
            stopServiceHook.run();
        }
        
        if (getContext() != null) {
            android.content.Intent intent = new android.content.Intent(getContext(), AariaListenService.class);
            intent.setAction(AariaListenService.ACTION_STOP);
            try { getContext().startService(intent); } catch (Exception ignored) {}
        }
    }

    @PluginMethod
    public void startBackgroundListening(PluginCall call) {
        // Read on the very first line: a "Turn off" at any moment during this call must be noticed at its end.
        final int offCountAtStart = offCount.get();
        if (!ensureReady()) { if(call!=null) call.reject("aaria_unavailable"); return; }
        if (!isBackgroundListeningInternal()) {
            if(call!=null) call.reject("Consent for wake word is not granted");
            return;
        }

        if (getPermissionState("microphone") != com.getcapacitor.PermissionState.GRANTED) {
            if(call!=null) call.reject("microphone_permission_required");
            return;
        }

        if (!isAppInForeground()) {
            if(call!=null) call.reject("not_in_foreground");
            return;
        }

        boolean wakeOnBattery = false;
        JSONObject consent = consentStore.getConsent();
        if (consent != null) {
            try {
                JSONObject value = new JSONObject(consent.getString("value"));
                JSONObject choices = value.optJSONObject("choices");
                if (choices != null) wakeOnBattery = choices.optBoolean("wakeOnBattery", false);
            } catch (Exception ignored) {}
        }
        
        int batteryPct = 100;
        boolean charging = false;
        if (getContext() != null) {
            Intent intent = getContext().registerReceiver(null, new android.content.IntentFilter(android.content.Intent.ACTION_BATTERY_CHANGED));
            if (intent != null) {
                int level = intent.getIntExtra(android.os.BatteryManager.EXTRA_LEVEL, -1);
                int scale = intent.getIntExtra(android.os.BatteryManager.EXTRA_SCALE, -1);
                if (level >= 0 && scale > 0) {
                    batteryPct = (int) (level * 100f / scale);
                }
                int status = intent.getIntExtra(android.os.BatteryManager.EXTRA_STATUS, -1);
                charging = (status == android.os.BatteryManager.BATTERY_STATUS_CHARGING ||
                              status == android.os.BatteryManager.BATTERY_STATUS_FULL);
            }
        }
        boolean powerSave = false;
        int thermalStatus = 0;
        if (getContext() != null) {
            android.os.PowerManager pm = (android.os.PowerManager) getContext().getSystemService(android.content.Context.POWER_SERVICE);
            if (pm != null) {
                powerSave = pm.isPowerSaveMode();
                if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.Q) {
                    thermalStatus = pm.getCurrentThermalStatus();
                }
            }
        }

        DeviceState state = new DeviceState(batteryPct, charging, powerSave, thermalStatus, wakeOnBattery);
        if (appHold != null) appHold.cancel();
        boolean wasOn = listenController.isOn();
        listenController.turnOn(state);
        // Read what is true now from the controller (a battery report may already have changed it).
        String reasonNow = listenController.pauseReason();
        isListeningPaused = (reasonNow != null);
        pauseReason = reasonNow;
        
        // Let the service do the real state-gathering and start
        Intent intent = new Intent(getContext(), AariaListenService.class);
        intent.putExtra("lang", currentLang);
        intent.putExtra("wakeOnBattery", wakeOnBattery);
        try {
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                getContext().startForegroundService(intent);
            } else {
                getContext().startService(intent);
            }
        } catch (Exception e) {
            // Android refused to start the listening service. Listening that was off must not be left
            // recording without its service and its notice: everything is put back to "off". Listening that
            // was already on carries on under the service it has.
            if (!wasOn) onBackgroundListeningStopped();
            // IllegalStateException is how Android says "the app is not on screen".
            if (call != null) call.reject((e instanceof IllegalStateException) ? "not_in_foreground" : "service_start_failed");
            return;
        }
        // "Turn off" may have been pressed while listening was being started. Then it stays off: this call
        // must not say "waiting for the name" or store "was on" on top of that turn-off.
        boolean turnedOffMeanwhile;
        synchronized (sendLock) {
            turnedOffMeanwhile = turningOff || offCount.get() != offCountAtStart;
            if (!turnedOffMeanwhile) {
                waitForNameAgain();
                android.content.SharedPreferences prefs = getContext().getSharedPreferences("aaria_prefs", android.content.Context.MODE_PRIVATE);
                prefs.edit()
                     .putBoolean("aaria_listen_was_on", true)
                     .putString("aaria_lang", currentLang)
                     .apply();
            }
        }
        if (turnedOffMeanwhile) {
            stopListeningInternal();    // also takes down the service this call has just asked for
            if (call != null) call.reject("turned_off");
            return;
        }
        
        // Remove open-app notification if it exists
        android.app.NotificationManager manager = (android.app.NotificationManager) getContext().getSystemService(android.content.Context.NOTIFICATION_SERVICE);
        if (manager != null) manager.cancel(1433);
        
        if (call != null) {
            JSObject ret = new JSObject();
            ret.put("paused", isListeningPaused);
            if (isListeningPaused && pauseReason != null) {
                ret.put("reason", pauseReason);
            }
            call.resolve(ret);
        }
    }

    @PluginMethod
    public void stopBackgroundListening(PluginCall call) {
        if (!ensureReady()) { call.reject("aaria_unavailable"); return; }
        stopListeningInternal();
        call.resolve();
    }


    // ---- The host app needs the microphone ----

    private java.util.concurrent.ScheduledExecutorService holdTimer;
    private volatile AppHold appHold;

    private Runnable scheduleHoldTask(Runnable task, long delayMs) {
        if (holdTimer == null) {
            holdTimer = java.util.concurrent.Executors.newSingleThreadScheduledExecutor(r -> {
                Thread t = new Thread(r, "aaria-hold-timer");
                t.setDaemon(true);
                return t;
            });
        }
        final java.util.concurrent.ScheduledFuture<?> f =
                holdTimer.schedule(task, delayMs, java.util.concurrent.TimeUnit.MILLISECONDS);
        return () -> f.cancel(false);
    }

    /** Made on first use. The rules of a hold (ceiling, undo, wait for the name again) live in AppHold. */
    private synchronized AppHold appHold() {
        if (appHold == null) {
            appHold = new AppHold(
                    () -> listenController,
                    (task, delayMs) -> scheduleHoldTask(task, delayMs),
                    () -> waitForNameAgain());
        }
        return appHold;
    }

    /**
     * The host app is about to listen itself, or to speak. Listening pauses; the listening service and its
     * notice stay, so listening can come back by itself even when the app is not on screen.
     * Resolves held:false when listening is off. Calling it again renews the three-minute ceiling.
     * Rejects with "hold_timer_failed" when that ceiling could not be set, or "hold_failed" when the recorder
     * could not be paused; nothing is held then.
     */
    @PluginMethod
    public void holdMicrophone(PluginCall call) {
        if (!ensureReady()) { call.reject("aaria_unavailable"); return; }
        boolean held;
        try {
            held = appHold().hold();
        } catch (Exception e) {
            call.reject("hold_failed".equals(e.getMessage()) ? "hold_failed" : "hold_timer_failed");
            return;
        }
        JSObject ret = new JSObject();
        ret.put("held", held);
        call.resolve(ret);
    }

    /** The host app is done. Listening starts again by itself if the phone allows it, waiting for the wake name. */
    @PluginMethod
    public void releaseMicrophone(PluginCall call) {
        if (!ensureReady()) { call.reject("aaria_unavailable"); return; }
        appHold().release();
        call.resolve();
    }

    @PluginMethod
    public void isBackgroundListening(PluginCall call) {
        if (!ensureReady()) { call.reject("aaria_unavailable"); return; }
        JSObject ret = new JSObject();
        ret.put("listening", isWaitingForWakeWord); 
        ret.put("paused", isListeningPaused);
        if (pauseReason != null) ret.put("reason", pauseReason);
        call.resolve(ret);
    }

    @PluginMethod
    public void setWakeName(PluginCall call) {
        if (!ensureReady()) { call.reject("aaria_unavailable"); return; }
        String name = call.getString("name", "Aaria");
        if (name == null || name.trim().isEmpty()) {
            call.reject("Wake name cannot be empty");
            return;
        }
        if (name.length() > 24) {
            call.reject("Wake name cannot exceed 24 characters");
            return;
        }
        if (name.matches("\\d+")) {
            call.reject("Wake name cannot be digits only");
            return;
        }

        com.getcapacitor.JSArray aliasesArr = call.getArray("aliases");
        try {
            JSONObject value = new JSONObject();
            value.put("name", name);
            if (aliasesArr != null) {
                JSONArray a = new JSONArray();
                for(int i=0; i<aliasesArr.length(); i++) a.put(aliasesArr.get(i));
                value.put("aliases", a);
            }
            memoryStore.put("preference", "wake_name", value.toString(), 3650);
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    static PcmSource.Factory enrollPcmFactory = PcmSource.defaultFactory;

    private List<String> getPrefixes() {
        List<String> prefixes = new ArrayList<>();
        try {
            try (java.io.InputStream is = getContext().getAssets().open("wakeword/prefixes.json")) {
                byte[] buffer = new byte[is.available()];
                is.read(buffer);
                String json = new String(buffer, java.nio.charset.StandardCharsets.UTF_8);
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
        } catch (Exception e) {}
        return prefixes;
    }

    @PluginMethod
    public void enrollWakeName(PluginCall call) {
        if (!ensureReady()) { call.reject("aaria_unavailable"); return; }
        if (!consentStore.hasConsent()) {
            call.reject("consent_required");
            return;
        }
        if (getPermissionState("microphone") != com.getcapacitor.PermissionState.GRANTED) {
            call.reject("microphone_permission_required");
            return;
        }

        if (!isAppInForeground()) {
            call.reject("not_in_foreground");
            return;
        }

        JSONObject pref = memoryStore.get("preference", "wake_name");
        if (pref == null) {
            call.reject("wake_name_required");
            return;
        }

        String wakeName = "";
        try {
            JSONObject value = new JSONObject(pref.getString("value"));
            wakeName = value.getString("name");
        } catch (Exception e) {
            call.reject("wake_name_required");
            return;
        }
        final String typedName = wakeName;

        executor.submit(() -> {
            boolean wasActive = NightlySyncWorker.microphoneActive;
            if (wasActive) {
                implementation.stop();
                try { Thread.sleep(200); } catch(Exception ignored) {}
            }
            PcmSource pcmSource = null;
            try {
                int samples = call.getInt("samples", 3);
                List<String> heard = new ArrayList<>();
                boolean anyWeak = false;

                pcmSource = enrollPcmFactory.create();
                if (pcmSource == null) {
                    call.reject("mic_busy");
                    return;
                }

                for (int i = 0; i < samples; i++) {
                    short[] audioData = new short[32000];
                    int read = 0;
                    while (read < 32000) {
                        int r = pcmSource.read(audioData, read, 32000 - read);
                        if (r < 0) throw new RuntimeException("Audio read error: " + r);
                        read += r;
                    }

                    String sampleHeard = "";
                    if (commandRecognizer != null) {
                        CommandRecognizer.RecognizeResult result = commandRecognizer.recognizeCommand(audioData, 16000);
                        if (result != null && result.transcript != null) {
                            sampleHeard = result.transcript.trim();
                        }
                    }
                    if (!sampleHeard.isEmpty()) {
                        heard.add(sampleHeard);
                        if (sampleHeard.length() <= 4) anyWeak = true;
                    }
                    
                    JSObject ev = new JSObject(); 
                    ev.put("sample", i + 1);
                    ev.put("heard", sampleHeard);
                    notifyListeners("enrollProgress", ev);

                    Thread.sleep(500);
                }

                pcmSource.close();
                pcmSource = null;

                if (wasActive) {
                    implementation.start(16000, 250, 600);
                    wasActive = false;
                }

                WakeWordMatcher matcher = new WakeWordMatcher(getPrefixes());
                List<String> newAliasesList = matcher.chooseEnrollAliases(typedName, heard);
                JSONArray aliasArray = new JSONArray();
                for (String a : newAliasesList) aliasArray.put(a);

                JSONObject value = new JSONObject(pref.getString("value"));
                value.put("aliases", aliasArray);
                memoryStore.put("preference", "wake_name", value.toString(), 3650);

                JSONArray heardArray = new JSONArray();
                for (String h : heard) heardArray.put(h);

                JSObject ret = new JSObject();
                ret.put("heard", heardArray);
                ret.put("kept", aliasArray);
                ret.put("aliases", aliasArray);
                ret.put("wakeNameWeak", anyWeak);
                call.resolve(ret);

            } catch (Exception e) {
                call.reject(e.getMessage());
            } finally {
                if (pcmSource != null) {
                    try { pcmSource.close(); } catch(Exception ignored) {}
                }
                if (wasActive) {
                    try { implementation.start(16000, 250, 600); } catch(Exception ignored) {}
                }
            }
        });
    }

    private void loadWakeWordDetector() {
        if (modelStore.isAvailable("wake_word")) {
            try {
                String modelPath = modelStore.getModelPath("wake_word");
                java.io.File jsonFile = new java.io.File(modelPath, "model.json");
                if (jsonFile.exists()) {
                    java.io.FileInputStream fis = new java.io.FileInputStream(jsonFile);
                    byte[] data = new byte[(int) jsonFile.length()];
                    fis.read(data);
                    fis.close();
                    JSONObject configJson = new JSONObject(new String(data, "UTF-8"));
                    String type = configJson.optString("type");
                    
                    if ("byop_wakeword".equals(type)) {
                        // In future: wakeWordDetector = new ByopWakeWord(...);
                        // For now we don't have this, so it will fall through
                        // But wait, the test says "unknown type -> clean error, no crash"
                    } else {
                        throw new RuntimeException("Unknown wake word model type: " + type);
                    }
                }
            } catch (Exception e) {
                // Unknown type or parse error -> clean error, no crash
                wakeWordDetector = null;
                return;
            }
        }
        
        // If no custom model loaded, fallback to AsrWakeWord if the name is not "Aaria" or always
        // The rule says: "A trained model (BYOP, after October) is used ONLY when the chosen name is "Aaria"; any other name always uses the name-matching detector below."
        wakeWordDetector = new AsrWakeWord(getContext(), commandRecognizer, memoryStore, this);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        if (!ensureReady()) { if(call!=null) call.reject("aaria_unavailable"); return; }
        NightlySyncWorker.microphoneActive = false;
        // Deliberately no "speech unwanted" mark here: a host that listens in the foreground and stops the
        // microphone as soon as the person has finished speaking must still get that command.
        if (implementation != null) {
            implementation.stop();
        }
        if (call != null) {
            call.resolve();
        }
    }
}
