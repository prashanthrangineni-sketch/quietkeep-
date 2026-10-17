# QuietKeep Voice-Based Fatigue Check (v1)

TASK CARD: DRV-04  
Status: Implemented on `drive/drv-04-fatigue`  
Primary Modules: `src/lib/fatigue-voice.js`, `src/lib/ride-care.js`, `src/lib/ride-guard.js`

---

## 1. Overview & Purpose

On a long or late ride, the QuietKeep stay-awake companion (`src/lib/ride-care.js`) periodically speaks a brief break-reminder line. With DRV-04, the companion now appends a short, low-effort check question:
1. *"Quick check: say how you are feeling."*
2. *"Quick check: what is the next town?"*
3. *"Quick check: say your favourite tea."*

Based on how the rider answers, QuietKeep assesses whether they sound alert, watchful, or drowsy. When drowsy, QuietKeep halves the companion interval and switches to firmer, direct stop-and-rest nudges.

---

## 2. What It Measures

The detector relies entirely on pure temporal and lexical features from the turn-taking event:

1. **Reply Latency (`latencyMs`)**:
   Elapsed time between when the companion finishes asking the question and when the rider starts speaking.
2. **Utterance Length (`words`)**:
   Word count split across whitespace on trimmed transcript text. Works consistently for English, romanised Indic, and native Indic scripts (Telugu, Hindi).
3. **Speech Rate / Cadence (`wordsPerSec`)**:
   Speaking speed over multi-word utterances: $\text{words} / \text{duration in seconds}$.
4. **Filler Monosyllables (`fillers`)**:
   Checks whether the utterance consists entirely of hesitation or stalling sounds (`umm`, `hmm`, `uh`, `haan`, `ha`, `aa`, `em`, `emo`, `achha`, `ok`, and Telugu/Hindi script variants).
5. **Confusion / Repetition Requests (`repeatAsk`)**:
   Identifies whether the rider failed to process the question and asked to repeat (`what`, `sorry`, `again`, `kya`, `enti`, `em annav`, `phir se`, `malli`, etc.).

---

## 3. Every Threshold and Why

All thresholds are exposed in `CONSTANTS` in `src/lib/fatigue-voice.js`:

| Rule / Threshold | Value | Penalty Points | Reason Code | Rationale |
|---|---|---|---|---|
| **Missed Timeout** | `> 8000 ms` or null | **3 points** | `no_reply` | 8 seconds of complete silence following a direct question indicates cognitive disengagement, inattention, or severe fatigue. |
| **Slow Reply** | `> 3000 ms` | **2 points** | `slow_reply` | Normal conversational turn-taking happens in under 1200 ms. A delay over 3 seconds represents pronounced lethargy or sluggish processing. |
| **Late Reply** | `1800 ms – 3000 ms` | **1 point** | `late_reply` | Moderate delay in initiating speech; noticeably slower than alert reaction times. |
| **One Word / Terse** | `<= 1 word` | **1 point** | `one_word` | Single-word answers ("fine", "ok") indicate reduced communicative effort and mental tiredness compared to full answers. |
| **Slow Speech Rate** | `< 1.2 wps` (for $\ge 2$ words) | **1 point** | `slow_speech` | Natural speech typically exceeds 2.0–3.5 words/second. Speaking under 1.2 words/second indicates slow, dragged-out, or slurred motor speech. |
| **Filler-Only** | Only fillers | **1 point** | `filler_only` | Murmuring only "umm", "hmm", "emo" shows difficulty accessing lexical recall or formulating responses. |
| **Asked to Repeat** | Repeat phrase detected | **2 points** | `asked_repeat` | Asking "what?", "kya?", "enti?" signals that the rider failed to comprehend or remember the sentence just spoken. |

### Classification Window & Thresholds

- QuietKeep evaluates the **last 3 scored replies** in a rolling window:
  - **`alert`**: Sum of points $\le 1$.
  - **`watch`**: Sum of points $2 – 3$.
  - **`drowsy`**: Sum of points $\ge 4$, **OR** any 2 `no_reply` occurrences in the last 3 turns.

### Companion Nudge Adaptations

When classified as **`drowsy`**:
- **Halved Repeat Interval**:
  - Daytime repeat drops from 30 minutes to **15 minutes**.
  - Nighttime repeat drops from 20 minutes to **10 minutes**.
- **Firmer Direct Interventions**:
  - *"You sound tired. Please pull over at the next safe place and rest."*
  - *"Your replies are slow. Stop now, have tea or water, and rest ten minutes."*

---

## 4. What It Does NOT Do

- **No Camera / No Ocular Tracking**: Does not use camera feeds, eye tracking, PERCLOS, head-pose estimation, or facial landmark models.
- **No Medical / Diagnostic Claims**: Does not claim to detect or diagnose medical conditions, intoxication, or sleep disorders. It is solely an in-ride behavioral safety nudge.
- **No Audio Recording or Storage**: Raw microphone audio is never saved, never buffered to disk, and never transmitted over the network. Only ephemeral speech recognition events and timestamps are used.
- **No Third-Party AI / LLM Calls**: Evaluated purely by deterministic JavaScript rules on-device with zero latency, zero cloud cost, and zero external network dependencies.

---

## 5. NOTE for Intent Layer Owner (STAY_AWAKE Intent)

> [!IMPORTANT]
> **To the Intent Layer / Aaria Routing Owner:**  
> Do **NOT** edit, intercept, or reroute the `STAY_AWAKE` intent in the Intent Router or LLM planner.  
> 
> The fatigue check loop runs natively inside `src/lib/ride-guard.js` and `src/lib/ride-care.js` directly within the Drive Mode execution lifecycle. Routing stay-awake checks through external LLM turns would introduce network latency, audio contention, and override the deterministic 8-second response windows.
