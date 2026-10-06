package com.pranix.quietkeep.services;

import android.content.Context;
import android.content.Intent;

import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.mockito.Mockito;

import java.util.ArrayList;
import java.util.List;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

public class MicGuardTest {

    /** A pretend page. */
    static class FakeWeb implements MicGuard.Web {
        boolean page = true;            // is there a page at all
        boolean bridge = true;          // does the page have the wake bridge
        boolean answerAtOnce = false;   // "no wake bridge" is answered inside tell(), not later
        boolean breaks = false;
        final List<String> told = new ArrayList<>();
        final List<Runnable> refusals = new ArrayList<>();
        @Override public boolean tell(String signal, Runnable ifNotTaken) {
            if (breaks) throw new IllegalStateException("page broke");
            if (!page) return false;
            told.add(signal);
            if (!bridge && ifNotTaken != null) {
                if (answerAtOnce) ifNotTaken.run(); else refusals.add(ifNotTaken);
            }
            return true;
        }
        void answer() { List<Runnable> r = new ArrayList<>(refusals); refusals.clear(); for (Runnable x : r) x.run(); }
    }

    /** Timers that run only when the test says so. */
    static class FakeLater implements MicGuard.Later {
        final List<Runnable> waiting = new ArrayList<>();
        final List<Long> delays = new ArrayList<>();
        boolean breaks = false;
        boolean cancelBreaks = false;
        @Override public Object after(long ms, Runnable task) {
            if (breaks) throw new IllegalStateException("no timers");
            waiting.add(task); delays.add(ms); return task;
        }
        @Override public void cancel(Object token) {
            if (cancelBreaks) throw new IllegalStateException("cannot cancel");
            waiting.remove(token);
        }
        void aMinutePasses() { List<Runnable> r = new ArrayList<>(waiting); waiting.clear(); for (Runnable x : r) x.run(); }
    }

    private FakeWeb web;
    private FakeLater later;
    private boolean recording;
    private int turnedOff;
    private final Context context = Mockito.mock(Context.class);

    private MicGuard.Web oldWeb; private MicGuard.Later oldLater; private MicGuard.Capture oldCapture; private MicGuard.Fallback oldFallback;

    @Before
    public void setUp() {
        oldWeb = MicGuard.web; oldLater = MicGuard.later; oldCapture = MicGuard.capture; oldFallback = MicGuard.fallback;
        web = new FakeWeb(); later = new FakeLater(); recording = true; turnedOff = 0;
        MicGuard.web = web; MicGuard.later = later;
        MicGuard.capture = () -> recording;
        MicGuard.fallback = (c) -> turnedOff++;
        MicGuard.resetForTest();
    }

    @After
    public void tearDown() {
        MicGuard.web = oldWeb; MicGuard.later = oldLater; MicGuard.capture = oldCapture; MicGuard.fallback = oldFallback;
        MicGuard.resetForTest();
    }

    private int count(String signal) { int n = 0; for (String s : web.told) if (s.equals(signal)) n++; return n; }

    @Test
    public void testCapture_asksThePageAndDoesNotTurnListeningOff() {
        MicGuard.beforeCapture(context);
        assertEquals(1, count("qk_mic_claim"));
        assertEquals("listening is paused by the bridge, not turned off", 0, turnedOff);
        assertEquals("the request will be repeated", 1, later.waiting.size());
        assertEquals(Long.valueOf(60000L), later.delays.get(0));
    }

    @Test
    public void testCaptureEnds_saysFreeOnce() {
        MicGuard.beforeCapture(context);
        MicGuard.afterCapture(context);
        assertEquals(1, count("qk_mic_release"));
        assertEquals("no repeat is left waiting", 0, later.waiting.size());
        MicGuard.afterCapture(context);
        assertEquals("a second end says nothing more", 1, count("qk_mic_release"));
        assertEquals(0, turnedOff);
    }

    @Test
    public void testEndWithoutCapture_saysNothing() {
        MicGuard.afterCapture(context);
        assertEquals(0, web.told.size());
        assertEquals(0, turnedOff);
    }

    @Test
    public void testLongCapture_theRequestIsRepeatedEveryMinute() {
        MicGuard.beforeCapture(context);
        later.aMinutePasses();
        later.aMinutePasses();
        assertEquals("asked at the start and after each minute", 3, count("qk_mic_claim"));
        assertEquals("and one more repeat is waiting", 1, later.waiting.size());
        assertEquals(0, count("qk_mic_release"));
    }

    @Test
    public void testCaptureEndedWithoutTellingUs_theRepeatSaysFree() {
        MicGuard.beforeCapture(context);
        recording = false;                 // the microphone was lost; nobody called afterCapture
        later.aMinutePasses();
        assertEquals(1, count("qk_mic_claim"));
        assertEquals(1, count("qk_mic_release"));
        assertEquals("nothing repeats after that", 0, later.waiting.size());
        MicGuard.afterCapture(context);
        assertEquals("a late end does not say free twice", 1, count("qk_mic_release"));
    }

    @Test
    public void testNoPage_listeningIsTurnedOffAsBefore() {
        web.page = false;
        MicGuard.beforeCapture(context);
        assertEquals(1, turnedOff);
        assertEquals(0, later.waiting.size());
        MicGuard.afterCapture(context);
        assertEquals("nothing was asked of a page, so nothing is given back", 0, web.told.size());
    }

    @Test
    public void testPageWithoutWakeBridge_listeningIsTurnedOffAsBefore() {
        web.bridge = false;
        MicGuard.beforeCapture(context);
        assertEquals("not until the page has answered", 0, turnedOff);
        web.answer();
        assertEquals(1, turnedOff);
        assertEquals("no repeat is left waiting", 0, later.waiting.size());
        MicGuard.afterCapture(context);
        assertEquals("and no 'free' is sent for a request nobody took", 0, count("qk_mic_release"));
    }

    @Test
    public void testPageWithoutWakeBridge_answeringAtOnce() {
        web.bridge = false; web.answerAtOnce = true;
        MicGuard.beforeCapture(context);
        assertEquals(1, turnedOff);
        assertEquals(0, later.waiting.size());
    }

    @Test
    public void testAnAnswerFromAnOlderCaptureDoesNothing() {
        web.bridge = false;
        MicGuard.beforeCapture(context);       // capture one: the page will say "no wake bridge", late
        MicGuard.afterCapture(context);        // capture one ends
        web.bridge = true;
        MicGuard.beforeCapture(context);       // capture two: taken by the bridge
        web.answer();                          // the late answer for capture one arrives now
        assertEquals("listening is not turned off under capture two", 0, turnedOff);
        assertEquals("and capture two still has its repeat", 1, later.waiting.size());
    }

    @Test
    public void testPageLosesItsBridgeDuringACapture_listeningIsTurnedOff() {
        MicGuard.beforeCapture(context);
        web.bridge = false;                    // the page was replaced by one without the bridge
        later.aMinutePasses();
        web.answer();
        assertEquals(1, turnedOff);
        assertEquals(0, later.waiting.size());
    }

    @Test
    public void testPageGoesAwayDuringACapture_listeningIsTurnedOff() {
        MicGuard.beforeCapture(context);
        web.page = false;
        later.aMinutePasses();
        assertEquals(1, turnedOff);
        assertEquals(0, later.waiting.size());
    }

    @Test
    public void testStartedTwice_oneRepeatOnly() {
        MicGuard.beforeCapture(context);
        MicGuard.beforeCapture(context);
        assertEquals(2, count("qk_mic_claim"));
        assertEquals(1, later.waiting.size());
        MicGuard.afterCapture(context);
        assertEquals(1, count("qk_mic_release"));
    }

    @Test
    public void testARepeatLeftOverFromAnOlderCaptureDoesNothing() {
        MicGuard.beforeCapture(context);
        Runnable old = later.waiting.get(0);
        MicGuard.afterCapture(context);
        old.run();                             // it fires although it was cancelled
        assertEquals(1, count("qk_mic_claim"));
        assertEquals(1, count("qk_mic_release"));
    }

    @Test
    public void testThePageBreaks_listeningIsTurnedOffAndNothingIsThrown() {
        web.breaks = true;
        MicGuard.beforeCapture(context);
        assertEquals(1, turnedOff);
        MicGuard.afterCapture(context);        // must not throw either
    }

    @Test
    public void testNoTimers_theCaptureStillGetsTheMicrophone() {
        later.breaks = true;
        MicGuard.beforeCapture(context);
        assertEquals(1, count("qk_mic_claim"));
        assertEquals(0, turnedOff);
        MicGuard.afterCapture(context);
        assertEquals(1, count("qk_mic_release"));
    }

    @Test
    public void testSayingFreeBreaks_nothingIsThrown() {
        MicGuard.beforeCapture(context);
        web.breaks = true;
        MicGuard.afterCapture(context);
        web.breaks = false;
        MicGuard.beforeCapture(context);
        assertEquals("and the next capture works", 2, count("qk_mic_claim"));
    }

    @Test
    public void testTheRealPage_onlyTheTwoSignalsBecomeAScript() {
        assertNull(MicGuard.PageWeb.script("alert(1)"));
        assertNull(MicGuard.PageWeb.script("qk_mic_claim'));alert(1);(('"));
        assertNull(MicGuard.PageWeb.script(null));
        assertEquals("(function(){ if (window.__qkEdgeMicBridge !== true) return 0; window.dispatchEvent(new CustomEvent('qk_mic_claim')); return 1; })()",
            MicGuard.PageWeb.script("qk_mic_claim"));
        assertEquals("(function(){ if (window.__qkEdgeMicBridge !== true) return 0; window.dispatchEvent(new CustomEvent('qk_mic_release')); return 1; })()",
            MicGuard.PageWeb.script("qk_mic_release"));
    }

    @Test
    public void testAsShipped_thePageAndTheTimerAreTheRealOnes() {
        assertTrue(oldWeb instanceof MicGuard.PageWeb);
        assertTrue(oldLater instanceof MicGuard.MainThreadLater);
    }

    @Test
    public void testAsShipped_whetherItIsRecordingIsVoiceServicesOwnAnswer() {
        boolean before = VoiceService.captureActive;
        try {
            VoiceService.captureActive = true;
            assertTrue(oldCapture.active());
            VoiceService.captureActive = false;
            assertFalse(oldCapture.active());
        } finally {
            VoiceService.captureActive = before;
        }
    }

    @Test
    public void testTheRealPage_onlyAOneMeansTheBridgeTookIt() {
        assertTrue(MicGuard.PageWeb.taken("1"));
        assertFalse(MicGuard.PageWeb.taken("0"));
        assertFalse(MicGuard.PageWeb.taken("null"));
        assertFalse(MicGuard.PageWeb.taken(null));
        assertFalse(MicGuard.PageWeb.taken(""));
    }

    @Test
    public void testTheRealPage_noActivityMeansNoPage() {
        assertFalse(MicGuard.PageWeb.pageIsThere(null));
    }

    @Test
    public void testStartedAgain_theOlderRepeatDoesNothing() {
        MicGuard.beforeCapture(context);
        Runnable older = later.waiting.get(0);
        MicGuard.beforeCapture(context);       // started again (a retry) with no end in between
        older.run();                           // the older repeat fires although it was cancelled
        assertEquals("no extra request", 2, count("qk_mic_claim"));
        assertEquals("and still one repeat only", 1, later.waiting.size());
    }

    @Test
    public void testEndedAndStartedAgain_theOlderRepeatDoesNothing() {
        MicGuard.beforeCapture(context);
        Runnable older = later.waiting.get(0);
        MicGuard.afterCapture(context);
        MicGuard.beforeCapture(context);       // a newer capture is running
        older.run();
        assertEquals("no extra request under the newer capture", 2, count("qk_mic_claim"));
        assertEquals(1, later.waiting.size());
        assertEquals(1, count("qk_mic_release"));
    }

    @Test
    public void testStartedAgain_aLateRefusalForTheOlderStartDoesNothing() {
        web.bridge = false;
        MicGuard.beforeCapture(context);       // the page will say "no wake bridge", late
        web.bridge = true;
        MicGuard.beforeCapture(context);       // started again; this time the bridge takes it
        web.answer();                          // the late answer for the first start
        assertEquals("listening is not turned off under the capture the bridge took", 0, turnedOff);
        assertEquals(1, later.waiting.size());
    }

    @Test
    public void testNoPage_thenThePageAppears_noFreeIsSentForARequestNobodyTook() {
        web.page = false;
        MicGuard.beforeCapture(context);
        web.page = true;                       // the page is there by the time the capture ends
        MicGuard.afterCapture(context);
        assertEquals(0, web.told.size());
        assertEquals(1, turnedOff);
    }

    @Test
    public void testTwoRefusalsForOneCapture_listeningIsTurnedOffOnce() {
        web.bridge = false;
        MicGuard.beforeCapture(context);       // refusal one is on its way
        later.aMinutePasses();                 // the answer is over a minute late: the request is repeated
        web.answer();                          // both refusals arrive
        assertEquals(1, turnedOff);
        assertEquals(0, later.waiting.size());
    }

    @Test
    public void testAfterARefusal_aRepeatThatStillFiresDoesNothing() {
        web.bridge = false;
        MicGuard.beforeCapture(context);
        Runnable repeat = later.waiting.get(0);
        web.answer();                          // refused: the fallback is used and the repeat is cancelled
        repeat.run();                          // it fires all the same
        assertEquals("no new request after the fallback", 1, count("qk_mic_claim"));
        assertEquals(1, turnedOff);
        assertEquals(0, later.waiting.size());
    }

    @Test
    public void testTheFallbackBreaks_nothingIsThrown() {
        MicGuard.fallback = (c) -> { throw new IllegalStateException("cannot stop the service"); };
        web.page = false;
        MicGuard.beforeCapture(context);       // must not throw into VoiceService
        web.page = true; web.bridge = false;
        MicGuard.beforeCapture(context);
        web.answer();                          // nor into the page's callback
        MicGuard.afterCapture(context);
    }

    @Test
    public void testCancellingBreaks_nothingIsThrownAndFreeIsStillSaid() {
        MicGuard.beforeCapture(context);
        later.cancelBreaks = true;
        MicGuard.afterCapture(context);
        assertEquals(1, count("qk_mic_release"));
        MicGuard.beforeCapture(context);       // and a new capture can still start
        assertEquals(2, count("qk_mic_claim"));
    }

    @Test
    public void testCannotTellWhetherStillRecording_takenAsEnded() {
        MicGuard.beforeCapture(context);
        MicGuard.capture = () -> { throw new IllegalStateException("no answer"); };
        later.aMinutePasses();
        assertEquals(1, count("qk_mic_release"));
        assertEquals(0, later.waiting.size());
    }

    @Test
    public void testNoActivity_theRealPageSaysThereIsNoPage() {
        assertFalse(new MicGuard.PageWeb().tell("qk_mic_claim", null));
    }

    // The fallback as shipped is the old "turn listening off".
    @Test
    public void testAsShipped_theFallbackTurnsAariasListeningOff() {
        Context context = Mockito.mock(Context.class);
        try (org.mockito.MockedConstruction<Intent> mocked = Mockito.mockConstruction(Intent.class)) {
            oldFallback.turnListeningOff(context);

            assertEquals(1, mocked.constructed().size());
            Intent startedIntent = mocked.constructed().get(0);
            Mockito.verify(startedIntent).setClassName(context, "com.pranix.aariaedge.AariaListenService");
            Mockito.verify(startedIntent).setAction("com.pranix.aariaedge.STOP_LISTENING");
            Mockito.verify(context).startService(startedIntent);
        }
    }

    // The fallback itself: unchanged from before.
    @Test
    public void testStopAariaListenService() {
        Context context = Mockito.mock(Context.class);
        Mockito.when(context.getPackageName()).thenReturn("com.pranix.quietkeep");

        try (org.mockito.MockedConstruction<Intent> mocked = Mockito.mockConstruction(Intent.class)) {
            MicGuard.stopAariaListenService(context);

            assertEquals(1, mocked.constructed().size());
            Intent startedIntent = mocked.constructed().get(0);

            Mockito.verify(startedIntent).setClassName(context, "com.pranix.aariaedge.AariaListenService");
            Mockito.verify(startedIntent).setAction("com.pranix.aariaedge.STOP_LISTENING");
            Mockito.verify(context).startService(startedIntent);
        }
    }
}
