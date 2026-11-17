// tests/t13-reply-spoken-language.test.mjs
// Card T13: Aaria replies in the language the person SPOKE, in ONE voice the user chooses
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildExecutionTTS,
  computeReminderAt,
  scriptOf,
} from '../src/lib/intent-executor.js';
import {
  getSpeakerForChoice,
  getGenderOfSpeaker,
  SUPPORTED_VOICE_CHOICES,
} from '../src/lib/speaker-map.js';

test('1. Spoken language detection from script', async () => {
  const { detectSpokenLanguage } = await import('../src/lib/spoken-language.js');
  // Telugu script -> 'te'
  assert.equal(detectSpokenLanguage('రేపు ఉదయం 10 గంటలకి గుర్తు చేయి', 'en-IN'), 'te');
  // Hindi script -> 'hi'
  assert.equal(detectSpokenLanguage('कल सुबह 10 बजे याद दिलाओ', 'en-IN'), 'hi');
  // English script -> 'en'
  assert.equal(detectSpokenLanguage('Remind me tomorrow at 10 am', 'en-IN'), 'en');
  // Settings=en + Telugu speech -> 'te'
  assert.equal(detectSpokenLanguage('ఉదయం 9 గంటలకి నాకు గుర్తు చేయి', 'en-US'), 'te');
  // Fallback when no Indic script present -> settings if en-family or 'en'
  assert.equal(detectSpokenLanguage('Call Mom', 'en-IN'), 'en');
});

test('2. Confirmations in the spoken language (te / hi / en)', () => {
  // Base instant: tomorrow at 10:00 AM IST
  const tomorrow10am = new Date(Date.now() + 24 * 3600 * 1000);
  tomorrow10am.setHours(10, 0, 0, 0);

  // Telugu reminder confirmation
  const parsedTe = {
    type: 'reminder',
    subject: 'రేపు ఉదయం 10 గంటలకి గుర్తు చేయి',
    content: 'రేపు ఉదయం 10 గంటలకి గుర్తు చేయి',
    entities: { names: [], dates: ['tomorrow'], times: ['10:00 am'] },
  };
  const ttsTe = buildExecutionTTS(parsedTe, null, tomorrow10am, null);
  assert.match(ttsTe, /గుర్తు చేస్తాను/);
  assert.doesNotMatch(ttsTe, /Got it — I'll remind you/);

  // Hindi reminder confirmation
  const parsedHi = {
    type: 'reminder',
    subject: 'कल सुबह 10 बजे याद दिलाओ',
    content: 'कल सुबह 10 बजे याद दिलाओ',
    entities: { names: [], dates: ['tomorrow'], times: ['10:00 am'] },
  };
  const ttsHi = buildExecutionTTS(parsedHi, null, tomorrow10am, null);
  assert.match(ttsHi, /याद दिलाऊँगा/);
  assert.doesNotMatch(ttsHi, /Got it — I'll remind you/);

  // English reminder confirmation
  const parsedEn = {
    type: 'reminder',
    subject: 'remind me to call John tomorrow at 10 am',
    content: 'remind me to call John tomorrow at 10 am',
    entities: { names: ['John'], dates: ['tomorrow'], times: ['10:00 am'] },
  };
  const ttsEn = buildExecutionTTS(parsedEn, null, tomorrow10am, null);
  assert.match(ttsEn, /Got it — I'll remind you/);

  // Call confirmation in Telugu
  const parsedCallTe = {
    type: 'note',
    subject: 'సురేష్ కి కాల్ చేయి',
    content: 'సురేష్ కి కాల్ చేయి',
    entities: { names: ['Suresh'] },
  };
  const contactTe = { single: { name: 'Suresh', phone: '+919876543210' } };
  const callTtsTe = buildExecutionTTS(parsedCallTe, contactTe, tomorrow10am, null);
  assert.match(callTtsTe, /కాల్ చేస్తాను/);

  // Call confirmation in Hindi
  const parsedCallHi = {
    type: 'note',
    subject: 'सुरेश को कॉल करो',
    content: 'सुरेश को कॉल करो',
    entities: { names: ['Suresh'] },
  };
  const callTtsHi = buildExecutionTTS(parsedCallHi, contactTe, tomorrow10am, null);
  assert.match(callTtsHi, /कॉल करूँगा/);
});

test('3. One voice choice: same-gender speaker across English and Telugu', () => {
  assert.ok(SUPPORTED_VOICE_CHOICES.includes('aaria_f'));
  assert.ok(SUPPORTED_VOICE_CHOICES.includes('aaria_m'));

  // Choice: Aaria female (aaria_f)
  const enFemaleSpeaker = getSpeakerForChoice('aaria_f', 'en-IN');
  const teFemaleSpeaker = getSpeakerForChoice('aaria_f', 'te-IN');
  const hiFemaleSpeaker = getSpeakerForChoice('aaria_f', 'hi-IN');

  assert.equal(getGenderOfSpeaker(enFemaleSpeaker), 'female');
  assert.equal(getGenderOfSpeaker(teFemaleSpeaker), 'female');
  assert.equal(getGenderOfSpeaker(hiFemaleSpeaker), 'female');

  // Choice: Aaria male (aaria_m)
  const enMaleSpeaker = getSpeakerForChoice('aaria_m', 'en-IN');
  const teMaleSpeaker = getSpeakerForChoice('aaria_m', 'te-IN');
  const hiMaleSpeaker = getSpeakerForChoice('aaria_m', 'hi-IN');

  assert.equal(getGenderOfSpeaker(enMaleSpeaker), 'male');
  assert.equal(getGenderOfSpeaker(teMaleSpeaker), 'male');
  assert.equal(getGenderOfSpeaker(hiMaleSpeaker), 'male');

  // Founder's pick: Telugu male speaker must be Tarun (tarun_te_narration / tarun)
  assert.match(teMaleSpeaker.toLowerCase(), /tarun/);
});

test('4. Time parsing: Telugu / Hindi / English morning/evening/night hours (no 9:30 PM bug)', () => {
  // "ఉదయం 9 గంటలకి నాకు గుర్తు చేయి" MUST parse to 09:00 AM (NOT 09:30 PM)
  const dtTeMorning = computeReminderAt(
    { dates: [], times: [] },
    'Asia/Kolkata',
    'ఉదయం 9 గంటలకి నాకు గుర్తు చేయి'
  );
  assert.ok(dtTeMorning, 'Must resolve an instant');
  const teHours = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).format(dtTeMorning);
  assert.equal(teHours, '09:00', 'ఉదయం 9 గంటలకి must resolve to 09:00 (not 21:30)');

  // Telugu evening: "సాయంత్రం 5 గంటలకి గుర్తు చేయి" -> 17:00 (5:00 PM)
  const dtTeEvening = computeReminderAt(
    { dates: [], times: [] },
    'Asia/Kolkata',
    'సాయంత్రం 5 గంటలకి గుర్తు చేయి'
  );
  assert.ok(dtTeEvening);
  const teEveHours = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).format(dtTeEvening);
  assert.equal(teEveHours, '17:00', 'సాయంత్రం 5 గంటలకి must resolve to 17:00');

  // Telugu night: "రాత్రి 8 గంటలకి గుర్తు చేయి" -> 20:00 (8:00 PM)
  const dtTeNight = computeReminderAt(
    { dates: [], times: [] },
    'Asia/Kolkata',
    'రాత్రి 8 గంటలకి గుర్తు చేయి'
  );
  assert.ok(dtTeNight);
  const teNightHours = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).format(dtTeNight);
  assert.equal(teNightHours, '20:00', 'రాత్రి 8 గంటలకి must resolve to 20:00');

  // Hindi morning: "कल सुबह 9 बजे याद दिलाओ" -> 09:00
  const dtHiMorning = computeReminderAt(
    { dates: [], times: [] },
    'Asia/Kolkata',
    'कल सुबह 9 बजे याद दिलाओ'
  );
  assert.ok(dtHiMorning);
  const hiMorningHours = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).format(dtHiMorning);
  assert.equal(hiMorningHours, '09:00', 'कल सुबह 9 बजे must resolve to 09:00');

  // Hindi evening: "शाम 6 बजे याद दिलाओ" -> 18:00
  const dtHiEvening = computeReminderAt(
    { dates: [], times: [] },
    'Asia/Kolkata',
    'शाम 6 बजे याद दिलाओ'
  );
  assert.ok(dtHiEvening);
  const hiEveHours = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).format(dtHiEvening);
  assert.equal(hiEveHours, '18:00', 'शाम 6 बजे must resolve to 18:00');

  // English morning: "remind me at 9 in the morning" -> 09:00
  const dtEnMorning = computeReminderAt(
    { dates: [], times: [] },
    'Asia/Kolkata',
    'remind me at 9 in the morning'
  );
  assert.ok(dtEnMorning);
  const enMorningHours = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).format(dtEnMorning);
  assert.equal(enMorningHours, '09:00', 'remind me at 9 in the morning must resolve to 09:00');

  // English evening: "remind me at 6 in the evening" -> 18:00
  const dtEnEvening = computeReminderAt(
    { dates: [], times: [] },
    'Asia/Kolkata',
    'remind me at 6 in the evening'
  );
  assert.ok(dtEnEvening);
  const enEveHours = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).format(dtEnEvening);
  assert.equal(enEveHours, '18:00', 'remind me at 6 in the evening must resolve to 18:00');

  // English night: "remind me at 9 at night" -> 21:00
  const dtEnNight = computeReminderAt(
    { dates: [], times: [] },
    'Asia/Kolkata',
    'remind me at 9 at night'
  );
  assert.ok(dtEnNight);
  const enNightHours = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).format(dtEnNight);
  assert.equal(enNightHours, '21:00', 'remind me at 9 at night must resolve to 21:00');
});

test('5. Keep deduplication guard: same user + same text + within 60s is one keep', async () => {
  const { isDuplicateKeep } = await import('../src/lib/keep-dedup.js');

  const now = new Date();
  const existingKeeps = [
    {
      id: 'keep-1',
      user_id: 'user-123',
      voice_text: 'రేపు ఉదయం 10 గంటలకి గుర్తు చేయి',
      content: 'రేపు ఉదయం 10 గంటలకి గుర్తు చేయి',
      created_at: new Date(now.getTime() - 15000).toISOString(), // 15s ago
      reminder_at: new Date(now.getTime() + 86400000).toISOString(),
    },
  ];

  // Exact same user, text, within 60s -> duplicate!
  const dup = isDuplicateKeep({
    userId: 'user-123',
    text: 'రేపు ఉదయం 10 గంటలకి గుర్తు చేయి',
    reminderAt: new Date(now.getTime() + 86400000),
    recentKeeps: existingKeeps,
    windowMs: 60000,
  });
  assert.equal(dup?.id, 'keep-1', 'Must match existing keep within 60s window');

  // Different user -> not duplicate
  const diffUser = isDuplicateKeep({
    userId: 'user-456',
    text: 'రేపు ఉదయం 10 గంటలకి గుర్తు చేయి',
    reminderAt: new Date(now.getTime() + 86400000),
    recentKeeps: existingKeeps,
    windowMs: 60000,
  });
  assert.equal(diffUser, null, 'Different user must not be marked duplicate');

  // Different text -> not duplicate
  const diffText = isDuplicateKeep({
    userId: 'user-123',
    text: 'సాయంత్రం 5 గంటలకి గుర్తు చేయి',
    reminderAt: new Date(now.getTime() + 86400000),
    recentKeeps: existingKeeps,
    windowMs: 60000,
  });
  assert.equal(diffText, null, 'Different text must not be marked duplicate');

  // Older than 60s -> not duplicate
  const oldKeeps = [
    {
      ...existingKeeps[0],
      created_at: new Date(now.getTime() - 75000).toISOString(), // 75s ago
    },
  ];
  const oldDup = isDuplicateKeep({
    userId: 'user-123',
    text: 'రేపు ఉదయం 10 గంటలకి గుర్తు చేయి',
    reminderAt: new Date(now.getTime() + 86400000),
    recentKeeps: oldKeeps,
    windowMs: 60000,
  });
  assert.equal(oldDup, null, 'Keep older than 60s must not be marked duplicate');
});

test('6. Card T13b: Safe voice choices (full IDs, strict gender consistency, retry fallback)', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');

  // A. Full Sarvam IDs only: (<name>_<lang>_<style>)
  const expectedMale = {
    te: 'tarun_te_narration',
    hi: 'tarun_hi_conversational',
    en: 'tarun_hi_conversational',
  };
  const expectedFemale = {
    te: 'kavitha_te_conversation',
    hi: 'ishita_enhi_customer',
    en: 'ishita_en_customer',
  };

  for (const [lang, expectedId] of Object.entries(expectedMale)) {
    const id = getSpeakerForChoice('aaria_m', lang);
    assert.equal(id, expectedId, `Male speaker for ${lang} must match ${expectedId}`);
    assert.ok(id.includes('_'), `Speaker ID ${id} must be a full ID containing underscores`);
    assert.match(id, /^[a-z]+_[a-z]+_[a-z]+$/, `Speaker ID ${id} must follow <name>_<lang>_<style>`);
    assert.equal(getGenderOfSpeaker(id), 'male', `Speaker ${id} must map to male`);
  }

  for (const [lang, expectedId] of Object.entries(expectedFemale)) {
    const id = getSpeakerForChoice('aaria_f', lang);
    assert.equal(id, expectedId, `Female speaker for ${lang} must match ${expectedId}`);
    assert.ok(id.includes('_'), `Speaker ID ${id} must be a full ID containing underscores`);
    assert.match(id, /^[a-z]+_[a-z]+_[a-z]+$/, `Speaker ID ${id} must follow <name>_<lang>_<style>`);
    assert.equal(getGenderOfSpeaker(id), 'female', `Speaker ${id} must map to female`);
  }

  // B. Every other language returns null (engine default)
  const unmappedLangs = ['ta', 'kn', 'ml', 'mr', 'gu', 'bn', 'pa', 'or', 'fr', 'es', 'de'];
  for (const lang of unmappedLangs) {
    assert.equal(getSpeakerForChoice('aaria_m', lang), null, `Male speaker for unmapped ${lang} must be null`);
    assert.equal(getSpeakerForChoice('aaria_f', lang), null, `Female speaker for unmapped ${lang} must be null`);
  }

  // C. Male never maps to a female ID, and female never maps to a male ID
  const testLangs = ['te', 'te-IN', 'hi', 'hi-IN', 'en', 'en-IN', 'en-US', 'ta', 'kn', 'ml', 'mr', 'gu', 'bn'];
  for (const lang of testLangs) {
    const m = getSpeakerForChoice('aaria_m', lang);
    if (m !== null) {
      assert.equal(getGenderOfSpeaker(m), 'male', `Male choice in ${lang} must never return female gender`);
      assert.notEqual(getGenderOfSpeaker(m), 'female');
    }
    const f = getSpeakerForChoice('aaria_f', lang);
    if (f !== null) {
      assert.equal(getGenderOfSpeaker(f), 'female', `Female choice in ${lang} must never return male gender`);
      assert.notEqual(getGenderOfSpeaker(f), 'male');
    }
  }

  // Prefix check for getGenderOfSpeaker (prefix before the first '_')
  assert.equal(getGenderOfSpeaker('tarun_te_narration'), 'male');
  assert.equal(getGenderOfSpeaker('tarun_hi_conversational'), 'male');
  assert.equal(getGenderOfSpeaker('kavitha_te_conversation'), 'female');
  assert.equal(getGenderOfSpeaker('ishita_enhi_customer'), 'female');
  assert.equal(getGenderOfSpeaker('ishita_en_customer'), 'female');
  assert.equal(getGenderOfSpeaker(null), 'female');

  // D. Retry-without-speaker path exists in route source
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const routePath = path.resolve(__dirname, '../src/app/api/voice/tts/route.js');
  const routeSrc = fs.readFileSync(routePath, 'utf8');

  assert.ok(
    routeSrc.includes('speaker_fallback: true'),
    'Route must include speaker_fallback: true in JSON response'
  );
  assert.ok(
    /if\s*\(!res\.ok\s*&&\s*chosenSpeaker\)/.test(routeSrc),
    'Route must check !res.ok && chosenSpeaker for retry'
  );
  assert.ok(
    /speaker:\s*null/.test(routeSrc),
    'Route retry must send payload with speaker: null'
  );
});
