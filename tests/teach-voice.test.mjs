// tests/teach-voice.test.mjs
// Verification for Card AG-V4: "Teach Aaria your voice" screen
//
// Requirements:
// 1. Screen calls plugin's enrollWakeName with exact signature
// 2. Handles enrollProgress updates cleanly (e.g. "Say it 3 of 5")
// 3. Clips are saved only when consent is ON (and not when OFF)
// 4. No network/upload call anywhere in this feature
// 5. Works gracefully when plugin is missing (web build): friendly message, never crash
// 6. Reachable from existing voice settings page

import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

import {
  DEFAULT_SAMPLES_COUNT,
  CONSENT_STORAGE_KEY,
  CLIPS_STORAGE_KEY,
  CONSENT_SWITCH_LABEL,
  getTeachConsent,
  setTeachConsent,
  getTeachVoiceClips,
  saveTeachVoiceClips,
  clearTeachVoiceClips,
  formatProgressText,
  enrollVoiceSession,
} from '../src/lib/teach-voice.js';

function createMockStorage() {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, val) => data.set(key, String(val)),
    removeItem: (key) => data.delete(key),
    clear: () => data.clear(),
  };
}

function createMockPlugin({
  samplesCount = 5,
  heardWords = ['Aaria', 'Aria', 'Aaria', 'Aria', 'Aaria'],
  shouldReject = null,
} = {}) {
  const listeners = new Map();
  let enrollWakeNameCalledWith = null;

  const plugin = {
    addListener: async (event, callback) => {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(callback);
      return {
        remove: async () => {
          const list = listeners.get(event) || [];
          const idx = list.indexOf(callback);
          if (idx >= 0) list.splice(idx, 1);
        },
      };
    },
    enrollWakeName: async (options) => {
      enrollWakeNameCalledWith = options;

      if (shouldReject) {
        throw new Error(shouldReject);
      }

      // Simulate step-by-step progress events
      const count = options?.samples || samplesCount;
      const progressListeners = listeners.get('enrollProgress') || [];

      for (let i = 1; i <= count; i++) {
        const heard = heardWords[i - 1] || 'Aaria';
        for (const cb of [...progressListeners]) {
          cb({ sample: i, heard });
        }
      }

      return {
        heard: heardWords.slice(0, count),
        kept: ['aaria', 'aria'],
        aliases: ['aaria', 'aria'],
        wakeNameWeak: false,
      };
    },
    getEnrollCall: () => enrollWakeNameCalledWith,
    getListenerCount: (event) => (listeners.get(event) || []).length,
  };

  return plugin;
}

test('formatProgressText formats cleanly as "Say it X of Y"', () => {
  assert.equal(formatProgressText(1, 5), 'Say it 1 of 5');
  assert.equal(formatProgressText(3, 5), 'Say it 3 of 5');
  assert.equal(formatProgressText(5, 5), 'Say it 5 of 5');
  assert.equal(formatProgressText(0, 5), 'Say it 1 of 5');
  assert.equal(formatProgressText(6, 5), 'Say it 5 of 5');
});

test('consent switch is OFF by default', () => {
  const storage = createMockStorage();
  assert.equal(getTeachConsent(storage), false);
  assert.deepEqual(getTeachVoiceClips(storage), []);
});

test('screen calls enrollWakeName with the exact { samples } signature', async () => {
  const plugin = createMockPlugin({ samplesCount: 5 });
  const storage = createMockStorage();

  const outcome = await enrollVoiceSession({
    plugin,
    samples: 5,
    wakeName: 'Aaria',
    consent: false,
    storage,
  });

  assert.equal(outcome.ok, true);
  assert.deepEqual(plugin.getEnrollCall(), { samples: 5 });
  assert.equal(plugin.getListenerCount('enrollProgress'), 0, 'listeners cleaned up after completion');
});

test('handles enrollProgress updates and formats progress text', async () => {
  const plugin = createMockPlugin({
    samplesCount: 5,
    heardWords: ['Aaria', 'Aria', 'Aaria', 'Aria', 'Aaria'],
  });
  const storage = createMockStorage();
  const progressEvents = [];

  const outcome = await enrollVoiceSession({
    plugin,
    samples: 5,
    wakeName: 'Aaria',
    consent: false,
    storage,
    onProgress: (p) => progressEvents.push(p),
  });

  assert.equal(outcome.ok, true);
  assert.equal(progressEvents.length, 5);
  assert.equal(progressEvents[0].sample, 1);
  assert.equal(progressEvents[0].progressText, 'Say it 1 of 5');
  assert.equal(progressEvents[2].sample, 3);
  assert.equal(progressEvents[2].progressText, 'Say it 3 of 5');
  assert.equal(progressEvents[4].sample, 5);
  assert.equal(progressEvents[4].progressText, 'Say it 5 of 5');
});

test('clips are NOT saved when consent is OFF', async () => {
  const plugin = createMockPlugin({ samplesCount: 5 });
  const storage = createMockStorage();

  // Explicitly ensure consent is OFF
  setTeachConsent(false, storage);
  assert.equal(getTeachConsent(storage), false);

  const outcome = await enrollVoiceSession({
    plugin,
    samples: 5,
    wakeName: 'Aaria',
    consent: false,
    storage,
  });

  assert.equal(outcome.ok, true);
  assert.equal(outcome.clipsSaved, false);
  assert.equal(outcome.clipsCount, 0);

  // Storage must contain NO clips
  const savedClips = getTeachVoiceClips(storage);
  assert.deepEqual(savedClips, []);
  assert.equal(storage.getItem(CLIPS_STORAGE_KEY), null);
});

test('clips ARE saved on the phone when consent is ON', async () => {
  const plugin = createMockPlugin({
    samplesCount: 5,
    heardWords: ['Aaria', 'Aria', 'Aaria', 'Aria', 'Aaria'],
  });
  const storage = createMockStorage();

  // Turn consent ON
  setTeachConsent(true, storage);
  assert.equal(getTeachConsent(storage), true);

  const outcome = await enrollVoiceSession({
    plugin,
    samples: 5,
    wakeName: 'Aaria',
    consent: true,
    storage,
  });

  assert.equal(outcome.ok, true);
  assert.equal(outcome.clipsSaved, true);
  assert.equal(outcome.clipsCount, 5);

  // Verify saved clips in local storage
  const savedClips = getTeachVoiceClips(storage);
  assert.equal(savedClips.length, 5);
  assert.equal(savedClips[0].sample, 1);
  assert.equal(savedClips[0].heard, 'Aaria');
  assert.equal(savedClips[0].wakeName, 'Aaria');
  assert.equal(typeof savedClips[0].timestamp, 'number');

  assert.equal(savedClips[2].sample, 3);
  assert.equal(savedClips[4].sample, 5);

  // Turning consent OFF clears previously stored clips
  setTeachConsent(false, storage);
  assert.equal(getTeachConsent(storage), false);
  assert.deepEqual(getTeachVoiceClips(storage), []);
});

test('NO network/upload call is made during the entire feature flow', async () => {
  let networkCallCount = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    networkCallCount++;
    throw new Error('Network call prohibited in Teach Aaria your voice');
  };

  try {
    const plugin = createMockPlugin({ samplesCount: 5 });
    const storage = createMockStorage();

    // 1. Consent OFF run
    await enrollVoiceSession({
      plugin,
      samples: 5,
      wakeName: 'Aaria',
      consent: false,
      storage,
    });

    // 2. Consent ON run
    setTeachConsent(true, storage);
    await enrollVoiceSession({
      plugin,
      samples: 5,
      wakeName: 'Aaria',
      consent: true,
      storage,
    });

    // 3. Error run
    const failingPlugin = createMockPlugin({ shouldReject: 'mic_busy' });
    await enrollVoiceSession({
      plugin: failingPlugin,
      samples: 5,
      wakeName: 'Aaria',
      consent: true,
      storage,
    });

    assert.equal(networkCallCount, 0, 'No fetch/upload call was made');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('works gracefully when plugin is missing (web build): friendly message, never crashes', async () => {
  const storage = createMockStorage();

  // Missing plugin / web build
  const outcome = await enrollVoiceSession({
    plugin: null,
    samples: 5,
    wakeName: 'Aaria',
    consent: false,
    storage,
  });

  assert.equal(outcome.ok, false);
  assert.equal(outcome.reason, 'plugin_missing');
  assert.equal(outcome.message, 'Available on the phone app');
});

test('handles cancel and error states cleanly', async () => {
  const plugin = createMockPlugin({ shouldReject: 'microphone_permission_required' });
  const storage = createMockStorage();
  let state = null;

  const outcome = await enrollVoiceSession({
    plugin,
    samples: 5,
    wakeName: 'Aaria',
    consent: true,
    storage,
    onStateChange: (s) => { state = s; },
  });

  assert.equal(outcome.ok, false);
  assert.equal(outcome.reason, 'enroll_error');
  assert.equal(outcome.message, 'microphone_permission_required');
  assert.equal(state, 'error');
  assert.equal(plugin.getListenerCount('enrollProgress'), 0);
});

test('Settings Voice page links directly to /settings/voice/teach', () => {
  const voicePagePath = path.resolve('src/app/settings/voice/page.jsx');
  const content = fs.readFileSync(voicePagePath, 'utf8');

  assert.match(content, /\/settings\/voice\/teach/, 'voice settings links to /settings/voice/teach');
  assert.match(content, /Teach Aaria your voice/, 'contains "Teach Aaria your voice" entry');
});

test('exact consent label is present in both teach-voice.js and page.jsx', () => {
  assert.equal(CONSENT_SWITCH_LABEL, 'Keep my recordings on this phone to help Aaria learn my voice');

  const teachPagePath = path.resolve('src/app/settings/voice/teach/page.jsx');
  const pageContent = fs.readFileSync(teachPagePath, 'utf8');
  assert.match(pageContent, /CONSENT_SWITCH_LABEL/, 'teach page uses exact consent switch label');
});
