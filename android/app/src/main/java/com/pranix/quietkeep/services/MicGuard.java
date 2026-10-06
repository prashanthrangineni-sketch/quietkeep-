package com.pranix.quietkeep.services;

import android.content.Context;
import android.content.Intent;
import android.util.Log;

/**
 * Microphone hand-off between QuietKeep's own voice capture (VoiceService) and Aaria's wake-word listening.
 * The two must not hold the microphone together.
 *
 * Before: VoiceService turned Aaria's listening OFF before every capture, and nothing turned it on again until
 * QuietKeep was next opened. So one tap on the dashboard microphone silently ended hands-free listening.
 *
 * Now: VoiceService says "I need the microphone" and "it is free" with the same two signals the web page already
 * uses (qk_mic_claim / qk_mic_release). The wake bridge in the page (MainActivity, block 2c) acts on them: Aaria
 * pauses, keeps its notice, and comes back by itself afterwards.
 *
 *  - While the capture goes on, the request is repeated every minute, because the bridge and the engine both end
 *    a pause that nobody renews after three minutes.
 *  - If the capture ends without telling us (the microphone was lost, the screen went off), the next repeat
 *    notices and says "it is free".
 *  - If there is no page to tell, or the page has no wake bridge, the old behaviour is kept: Aaria's listening is
 *    turned off, and QuietKeep turns it on again the next time it loads.
 */
public class MicGuard {

    private static final String TAG = "QK_MIC_GUARD";
    static final String CLAIM = "qk_mic_claim";
    static final String RELEASE = "qk_mic_release";
    static final long RENEW_MS = 60000L;

    /** How the page is told. */
    public interface Web {
        /**
         * Sends a signal to the wake bridge in QuietKeep's page.
         * Returns false at once when there is no page at all. Otherwise returns true, and runs ifNotTaken later
         * (when it is not null) if the page turned out to have no wake bridge or could not be reached.
         */
        boolean tell(String signal, Runnable ifNotTaken);
    }

    /** Runs a task once, later. */
    public interface Later {
        Object after(long ms, Runnable task);
        void cancel(Object token);
    }

    /** Whether VoiceService is recording right now. */
    public interface Capture {
        boolean active();
    }

    /** What is done when the page cannot take the request. */
    public interface Fallback {
        void turnListeningOff(Context context);
    }

    static Web web = new PageWeb();
    static Later later = new MainThreadLater();
    static Capture capture = () -> VoiceService.captureActive;
    static Fallback fallback = MicGuard::stopAariaListenService;

    // True from a request the page was given until "it is free" has been said (or the fallback was used).
    private static boolean claimed = false;
    private static Object tick = null;
    // Goes up with every new capture and every "it is free". Anything left over from an older turn does nothing.
    private static long turn = 0;

    /** Call just before the microphone is opened. Safe to call again while capturing. */
    public static synchronized void beforeCapture(Context context) {
        turn++;
        cancelTick();
        ask(context, turn);
    }

    /** Call when the microphone has been closed. Safe to call when nothing was asked for. */
    public static synchronized void afterCapture(Context context) {
        if (!claimed) return;
        turn++;
        claimed = false;
        cancelTick();
        sayFree();
    }

    private static void ask(final Context context, final long mine) {
        // Set first: a page that answers "no wake bridge" at once must find the request it is refusing.
        claimed = true;
        boolean told;
        try {
            told = web.tell(CLAIM, () -> notTaken(context, mine));
        } catch (RuntimeException e) {
            Log.w(TAG, "the page could not be told that the microphone is needed");
            told = false;
        }
        if (!told) {
            // Nobody to ask, so nobody would give the microphone back either: turn listening off, as before.
            if (!claimed) return;      // already refused, and the fallback already used
            claimed = false;
            Log.w(TAG, "no page to ask for the microphone; turning Aaria's listening off for this capture");
            useFallback(context);
            return;
        }
        if (!claimed) return;          // refused at once: the fallback has been used, nothing to repeat
        try {
            tick = later.after(RENEW_MS, () -> onTick(context, mine));
        } catch (RuntimeException e) {
            // Without the repeat a long capture outlives the three-minute pause. Say so; the capture goes on.
            tick = null;
            Log.w(TAG, "the request for the microphone cannot be repeated; a pause ends after three minutes");
        }
    }

    private static synchronized void notTaken(Context context, long mine) {
        if (mine != turn || !claimed) return;
        claimed = false;
        cancelTick();
        Log.w(TAG, "the page has no wake bridge; turning Aaria's listening off for this capture");
        useFallback(context);
    }

    private static synchronized void onTick(Context context, long mine) {
        if (mine != turn || !claimed) return;
        tick = null;
        boolean recording;
        try { recording = capture.active(); }
        catch (RuntimeException e) { Log.w(TAG, "could not tell whether the capture is still going; taking it as ended"); recording = false; }
        if (!recording) {
            // The capture ended without telling us.
            turn++;
            claimed = false;
            sayFree();
            return;
        }
        ask(context, mine);
    }

    private static void sayFree() {
        try {
            // If nobody is there, there is nobody to give the microphone back to: the pause ends by itself.
            if (!web.tell(RELEASE, null)) Log.w(TAG, "no page to tell that the microphone is free");
        } catch (RuntimeException e) {
            Log.w(TAG, "the page could not be told that the microphone is free");
        }
    }

    private static void useFallback(Context context) {
        try { fallback.turnListeningOff(context); }
        catch (RuntimeException e) { Log.w(TAG, "Aaria's listening could not be turned off"); }
    }

    private static void cancelTick() {
        Object t = tick;
        tick = null;
        if (t != null) {
            // If it fires all the same, it checks the turn and does nothing.
            try { later.cancel(t); } catch (RuntimeException e) { Log.w(TAG, "a waiting repeat could not be cancelled"); }
        }
    }

    /** For tests: back to the state at start-up. */
    static synchronized void resetForTest() {
        claimed = false;
        tick = null;
        turn = 0;
    }

    /**
     * Turns Aaria's listening off. Listening comes back when the web engine calls startHotword again
     * (QuietKeep does that each time it loads).
     */
    public static void stopAariaListenService(Context context) {
        if (context == null) return;
        try {
            Intent stopIntent = new Intent();
            stopIntent.setClassName(context, "com.pranix.aariaedge.AariaListenService");
            stopIntent.setAction("com.pranix.aariaedge.STOP_LISTENING");
            context.startService(stopIntent);
        } catch (Exception e) {
            Log.w(TAG, "Aaria's listening service could not be told to stop");
        }
    }

    /** Runs the signal in QuietKeep's page, if the page has the wake bridge (it sets window.__qkEdgeMicBridge). */
    static class PageWeb implements Web {
        @Override
        public boolean tell(final String signal, final Runnable ifNotTaken) {
            final String js = script(signal);
            if (js == null) return false;
            final android.app.Activity act = com.pranix.quietkeep.MainActivity.LotusWakeBridgeHolder.sActivity;
            if (!pageIsThere(act)) return false;
            final android.os.Handler main = new android.os.Handler(android.os.Looper.getMainLooper());
            boolean posted = main.post(() -> {
                try {
                    com.getcapacitor.Bridge bridge = ((com.getcapacitor.BridgeActivity) act).getBridge();
                    android.webkit.WebView view = bridge != null ? bridge.getWebView() : null;
                    if (view == null) { run(ifNotTaken); return; }
                    view.evaluateJavascript(js, answer -> { if (!taken(answer)) run(ifNotTaken); });
                } catch (Exception e) {
                    Log.w(TAG, "the page could not be reached with " + signal);
                    run(ifNotTaken);
                }
            });
            return posted;
        }

        /** The script for one of the two signals; null for anything else, so nothing else can reach the page. */
        static String script(String signal) {
            if (!CLAIM.equals(signal) && !RELEASE.equals(signal)) return null;
            return "(function(){ if (window.__qkEdgeMicBridge !== true) return 0;"
                + " window.dispatchEvent(new CustomEvent('" + signal + "')); return 1; })()";
        }

        /** Whether there is a page to tell at all. */
        static boolean pageIsThere(android.app.Activity act) {
            return act instanceof com.getcapacitor.BridgeActivity && !act.isFinishing() && !act.isDestroyed();
        }

        /** What the script answers when the page had the wake bridge and was given the signal. */
        static boolean taken(String answer) {
            return "1".equals(answer);
        }

        private static void run(Runnable r) {
            if (r == null) return;
            try { r.run(); } catch (RuntimeException e) { Log.w(TAG, "the fallback failed"); }
        }
    }

    static class MainThreadLater implements Later {
        private android.os.Handler main = null;
        private synchronized android.os.Handler main() {
            if (main == null) main = new android.os.Handler(android.os.Looper.getMainLooper());
            return main;
        }
        @Override public Object after(long ms, Runnable task) {
            if (!main().postDelayed(task, ms)) throw new IllegalStateException("not scheduled");
            return task;
        }
        @Override public void cancel(Object token) {
            if (token instanceof Runnable) main().removeCallbacks((Runnable) token);
        }
    }
}
