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
