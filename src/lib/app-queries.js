// src/lib/app-queries.js
// Handles voice queries for app data and connectors.
// Questions are answered aloud from the user's data; they NEVER create a keep.

import { detectSpokenLanguage } from './spoken-language.js';
import { say } from './reply-phrases.js';

const QUERY_PATTERNS = [
  { type: 'weather',   pattern: /(?:^|\P{L})(?:weather|vatavaranam|vaathavaranam|mausam|వెదర్|వెధర్|వెథర్|వెదరు|వాతావరణం|వాతావరణ|मौसम|हवामान)(?:\P{L}|$)|weather\s+ela\s+undi/iu },
  { type: 'tithi',     pattern: /(?:^|\P{L})(?:thithi|tithi|తిథి|పంచాంగం|panchangam|panchanga|तिथि|पंचांग)(?:\P{L}|$)/iu },
  { type: 'documents', pattern: /(?:^|\P{L})(?:పత్రాలు|పత్రం|documents?|patralu|docs?|files?|దస్తావేజులు|दस्तावेज़|दस्तावेज)(?:\P{L}|$)/iu },
  { type: 'tasks',     pattern: /(?:^|\P{L})(?:పనులు|పని|tasks?|reminders?|work|panulu|to-?dos?|काम|कार्य)(?:\P{L}|$)|ఏమేం\s*పనులు/iu },
  { type: 'memories',  pattern: /(?:^|\P{L})(?:జ్ఞాపకాలు|జ్ఞాపకం|memories|memory|keeps?|notes?|gnapakalu|यादें|याद)(?:\P{L}|$)/iu },
  { type: 'warranties',pattern: /(?:^|\P{L})(?:వారంటీ|వారంటీస్|warrant(?:y|ies)|guarantee|वारंटी)(?:\P{L}|$)/iu },
  { type: 'contacts',  pattern: /(?:^|\P{L})(?:contacts?|contacts\s*lo|kontacts|కాంటాక్ట్స్|కాంటాక్ట్|कॉन्टैक्ट्स|कॉन्टैक्ट|संपर्क)(?:\P{L}|$)/iu },
  { type: 'expenses',  pattern: /(?:^|\P{L})(?:expenses?|kharchu|kharchulu|kharcha|kharche|spent|spend|spending|expenses?\s*anni|ఖర్చులు|ఖర్చు|all\s+expenses?|expenses?\s+this\s+month|how\s+much\s+did\s+i\s+spend|what\s+did\s+i\s+spend|खर्च|खर्चा)(?:\P{L}|$)/iu },
];

// A QUESTION, NOT A COMMAND (T24, 19 Nov 2026).
//
// The patterns above name a SUBJECT ("tasks", "notes", "reminder", "work",
// "expenses"). On their own they also match commands: "set a reminder for 5 pm",
// "save a note: demo went well", "remind me to finish my work" — and those were
// being answered as questions and never saved. So a pattern only counts when
// the sentence is asked (a question mark or a question word) and is not an
// instruction to save, remind or call.
const QUESTION_CUE = /[?？]|(?:^|\P{L})(?:what|what's|whats|which|how|who|any|show|list|tell|read|do\s+i\s+have|all|enti|entha|enni|emiti|emi|evi|em|emunnayi|unnaya|unnayi|unnai|undi|unda|ela|cheppu|chupinchu|anni|kya|kitna|kitne|kaun|kaunse|batao|dikhao|sab|ఏంటి|ఏమిటి|ఏమి|ఏం|ఏమేం|ఎంత|ఎన్ని|ఏవి|ఉన్నాయి|ఉన్నాయా|ఉందా|ఉంది|ఎలా|చెప్పు|చెప్పండి|చూపించు|అన్ని|ఏమున్నాయి|क्या|कितना|कितने|कौन|कौनसे|बताओ|बताइए|दिखाओ|सब)(?:\P{L}|$)/iu;
const SAVE_CUE = /(?:^|\P{L})(?:remind\s+me|set\s+(?:a\s+)?reminder|add\s+(?:a\s+)?reminder|save\s+(?:a|an|this|that|it|my)|note\s+(?:down|this|that)|make\s+a\s+note|add\s+(?:an?\s+)?(?:expense|note|task)|gurthu\s*chey\w*|gurtu\s*chey\w*|guruthu\s*chey\w*|save\s+chey\w*|note\s+chey\w*|yaad\s+dila\w*|గుర్తు\s*చేయి|గుర్తు\s*చేయండి|గుర్తు\s*చెయ్యి|గుర్తు\s*చేస్తావా|సేవ్\s*చెయ్యి|సేవ్\s*చేయి|సేవ్\s*చేయండి|నోట్\s*చేయి|నోట్\s*చెయ్యి|याद\s*दिला\w*|सेव\s*कर\w*|नोट\s*कर\w*)(?:\P{L}|$)/iu;
const CALL_CUE = /(?:^|\P{L})(?:call|ring|dial)(?:\P{L}|$)|కాల్|ఫోన్\s*చే|कॉल|फ़ोन\s*कर|फोन\s*कर/iu;

export function isQueryUtterance(text = '', llmIntent = null) {
  const str = String(text || '').trim();
  if (!str) return false;
  // An instruction to save, remind or call is never answered as a question,
  // whatever the brain or the patterns say.
  if (SAVE_CUE.test(str) || CALL_CUE.test(str)) return false;
  if (llmIntent === 'query') return true;
  if (!QUESTION_CUE.test(str)) return false;
  return QUERY_PATTERNS.some(q => q.pattern.test(str));
}

// Weather words in the three languages Aaria answers in. Unknown conditions
// are read out as the provider wrote them in English, never replaced.
function describeSky(desc) {
  const d = String(desc || '').toLowerCase().trim();
  if (!d) return { te: '', hi: '', en: '' };
  const table = [
    [/thunder/, 'ఉరుములతో వర్షం', 'गरज के साथ बारिश'],
    [/drizzle|light rain/, 'చిరుజల్లులు', 'हल्की बारिश'],
    [/rain|shower/, 'వర్షం', 'बारिश'],
    [/clear/, 'ఆకాశం నిర్మలంగా ఉంది', 'आसमान साफ़ है'],
    [/few clouds|scattered|partly/, 'అక్కడక్కడ మేఘాలు', 'हल्के बादल'],
    [/broken|overcast|cloud/, 'మేఘావృతం', 'बादल छाए हैं'],
    [/haze|mist|fog|smoke/, 'పొగమంచు', 'धुंध'],
  ];
  for (const [re, te, hi] of table) if (re.test(d)) return { te, hi, en: d };
  return { te: d, hi: d, en: d };
}

export function detectQueryType(text = '', llmAssist = null) {
  const str = String(text || '').trim();
  for (const q of QUERY_PATTERNS) {
    if (q.pattern.test(str)) return q.type;
  }
  // Check entities or hint from LLM
  if (llmAssist?.entities?.item) {
    const item = String(llmAssist.entities.item).toLowerCase();
    for (const q of QUERY_PATTERNS) {
      if (q.pattern.test(item)) return q.type;
    }
  }
  return 'general';
}

/**
 * Resolves a query against app data or connectors and returns spoken response in the user's language.
 */
export async function resolveAppQuery({ text = '', language = 'en', supabase, userId, llmAssist = null }) {
  const queryType = detectQueryType(text, llmAssist);
  const lang = detectSpokenLanguage(text, language);

  switch (queryType) {
    case 'weather': {
      // Real numbers only. Until 19 Nov this answered "28 degrees, partly
      // cloudy" whenever nothing was stored, and always said "partly cloudy"
      // in Telugu and Hindi whatever the sky was. A made-up forecast is worse
      // than none.
      let w = null;
      try {
        if (supabase) {
          const { data: row } = await supabase
            .from('connector_values')
            .select('value')
            .eq('scope', 'weather')
            .limit(1)
            .maybeSingle();
          if (row?.value && (row.value.temp != null || row.value.temperature != null)) w = row.value;
        }
      } catch { }

      let tts;
      if (!w) {
        if (lang === 'te') tts = 'క్షమించండి, ఇప్పుడు వాతావరణ సమాచారం అందుబాటులో లేదు.';
        else if (lang === 'hi') tts = 'माफ़ कीजिए, अभी मौसम की जानकारी उपलब्ध नहीं है।';
        else tts = say('weather_none', lang, {}) ?? "Sorry, I don't have today's weather right now.";
        return { handled: true, queryType: 'weather', tts, language: lang };
      }
      const temp = Math.round(Number(w.temp ?? w.temperature));
      const { te, hi, en } = describeSky(w.description);
      if (lang === 'te') tts = `ఈరోజు వాతావరణం ${temp} డిగ్రీలు${te ? `, ${te}` : ''}.`;
      else if (lang === 'hi') tts = `आज मौसम ${temp} डिग्री है${hi ? `, ${hi}` : ''}।`;
      else tts = say('weather_now', lang, { temp }) ?? `Today's weather is ${temp}°C${en ? ` and ${en}` : ''}.`;
      return { handled: true, queryType: 'weather', tts, language: lang };
    }

    case 'contacts': {
      let total = 0;
      let names = [];
      try {
        if (supabase && userId) {
          const { data: rows } = await supabase
            .from('contacts')
            .select('name')
            .eq('user_id', userId)
            .limit(200);
          if (rows?.length) {
            total = rows.length;
            names = rows.map(r => r.name).filter(Boolean).slice(0, 5);
          }
        }
      } catch { }
      let tts;
      if (!total) {
        if (lang === 'te') tts = 'QuietKeep లో ఇంకా కాంటాక్ట్స్ లేవు. Contacts తెరిచి Sync నొక్కండి, అప్పుడు నేను కాల్ చేయగలను.';
        else if (lang === 'hi') tts = 'QuietKeep में अभी कोई कॉन्टैक्ट नहीं है। Contacts खोलकर Sync दबाइए, फिर मैं कॉल कर पाऊँगी।';
        else tts = say('contacts_none', lang, {}) ?? "You don't have any contacts in QuietKeep yet. Open Contacts and tap Sync, then I can call people for you.";
      } else {
        const list = names.join(', ');
        if (lang === 'te') tts = `మీకు ${total} కాంటాక్ట్స్ ఉన్నాయి. ఉదాహరణకు: ${list}.`;
        else if (lang === 'hi') tts = `आपके ${total} कॉन्टैक्ट हैं। जैसे: ${list}।`;
        else tts = say('contacts_count', lang, { total, list }) ?? `You have ${total} contacts, for example ${list}.`;
      }
      return { handled: true, queryType: 'contacts', tts, language: lang };
    }

    case 'tithi': {
      let tithiFound = null;
      try {
        if (supabase) {
          const todayDate = new Date().toISOString().split('T')[0];
          const { data: calEvent } = await supabase
            .from('calendar_events')
            .select('tithi,nakshatra,paksha')
            .eq('event_date', todayDate)
            .not('tithi', 'is', null)
            .limit(1)
            .maybeSingle();
          if (calEvent?.tithi) {
            tithiFound = calEvent.tithi;
          }
        }
      } catch { }

      let tts;
      if (tithiFound) {
        if (lang === 'te') tts = `ఈరోజు తిథి: ${tithiFound}.`;
        else if (lang === 'hi') tts = `आज की तिथि: ${tithiFound}।`;
        else tts = say('tithi_now', lang, { tithi: tithiFound }) ?? `Today's tithi is ${tithiFound}.`;
      } else {
        // Source not in repo / DB -> state plainly it cannot yet
        if (lang === 'te') {
          tts = 'క్షమించండి, ప్రస్తుతం తెలుగు పంచాంగం తిథి వివరాలు అందుబాటులో లేవు.';
        } else if (lang === 'hi') {
          tts = 'माफ़ कीजिए, अभी तेलुगु पंचांग तिथि विवरण उपलब्ध नहीं हैं।';
        } else {
          tts = say('tithi_none', lang, {}) ?? 'Sorry, Telugu calendar tithi details are not available yet.';
        }
      }

      return { handled: true, queryType: 'tithi', tts, language: lang };
    }

    case 'documents': {
      let docNames = [];
      try {
        if (supabase && userId) {
          const { data: docs } = await supabase
            .from('documents')
            .select('title,name,doc_name,doc_type')
            .eq('user_id', userId)
            .limit(10);
          if (docs?.length) {
            docNames = docs.map(d => d.title || d.name || d.doc_name || d.doc_type).filter(Boolean);
          } else {
            // Check keeps of type document
            const { data: keepDocs } = await supabase
              .from('keeps')
              .select('content')
              .eq('user_id', userId)
              .eq('intent_type', 'document')
              .neq('status', 'closed')
              .limit(10);
            if (keepDocs?.length) {
              docNames = keepDocs.map(k => k.content?.slice(0, 40)).filter(Boolean);
            }
          }
        }
      } catch { }

      let tts;
      if (docNames.length > 0) {
        const top = docNames.slice(0, 3).join(', ');
        if (lang === 'te') tts = `మీ ఫోన్లో ${docNames.length} పత్రాలు సేవ్ చేయబడి ఉన్నాయి: ${top}.`;
        else if (lang === 'hi') tts = `आपके फ़ोन में ${docNames.length} दस्तावेज़ सहेजे गए हैं: ${top}।`;
        else tts = say('docs_count', lang, { n: docNames.length, top }) ?? `You have ${docNames.length} documents saved: ${top}.`;
      } else {
        if (lang === 'te') tts = 'మీ ఫోన్లో పత్రాలేవీ సేవ్ చేయబడలేదు.';
        else if (lang === 'hi') tts = 'आपके फ़ोन में कोई दस्तावेज़ सहेजे नहीं गए हैं।';
        else tts = say('docs_none', lang, {}) ?? 'No documents are saved on your phone.';
      }

      return { handled: true, queryType: 'documents', tts, language: lang };
    }

    case 'tasks': {
      let taskItems = [];
      try {
        if (supabase && userId) {
          const today = new Date();
          const start = new Date(today); start.setHours(0, 0, 0, 0);
          const end = new Date(today); end.setHours(23, 59, 59, 999);

          const [{ data: rems }, { data: keeps }] = await Promise.all([
            supabase.from('reminders')
              .select('reminder_text')
              .eq('user_id', userId)
              .eq('is_active', true)
              .gte('scheduled_for', start.toISOString())
              .lte('scheduled_for', end.toISOString())
              .limit(5)
              .then(r => r.error ? { data: [] } : r),
            supabase.from('keeps')
              .select('content')
              .eq('user_id', userId)
              .in('intent_type', ['reminder', 'task'])
              .neq('status', 'closed')
              .gte('reminder_at', start.toISOString())
              .lte('reminder_at', end.toISOString())
              .limit(5)
              .then(r => r.error ? { data: [] } : r),
          ]);

          const seen = new Set();
          for (const r of (rems || [])) {
            if (r.reminder_text && !seen.has(r.reminder_text)) {
              seen.add(r.reminder_text);
              taskItems.push(r.reminder_text.slice(0, 40));
            }
          }
          for (const k of (keeps || [])) {
            if (k.content && !seen.has(k.content)) {
              seen.add(k.content);
              taskItems.push(k.content.slice(0, 40));
            }
          }
        }
      } catch { }

      let tts;
      if (taskItems.length > 0) {
        const top = taskItems.slice(0, 3).join(', ');
        if (lang === 'te') tts = `ఈరోజు మీకు ${taskItems.length} పనులు ఉన్నాయి: ${top}.`;
        else if (lang === 'hi') tts = `आज आपके ${taskItems.length} काम हैं: ${top}।`;
        else tts = say('tasks_count', lang, { n: taskItems.length, top }) ?? `You have ${taskItems.length} tasks scheduled for today: ${top}.`;
      } else {
        if (lang === 'te') tts = 'ఈరోజు మీకు ఎలాంటి పనులు లేవు. మీరు ప్రశాంతంగా ఉండవచ్చు!';
        else if (lang === 'hi') tts = 'आज आपका कोई काम नहीं है।';
        else tts = say('tasks_none', lang, {}) ?? 'You have no tasks scheduled for today. All clear!';
      }

      return { handled: true, queryType: 'tasks', tts, language: lang };
    }

    case 'memories': {
      let memoryItems = [];
      try {
        if (supabase && userId) {
          const { data: keeps } = await supabase
            .from('keeps')
            .select('content')
            .eq('user_id', userId)
            .neq('status', 'closed')
            .order('created_at', { ascending: false })
            .limit(5);
          if (keeps?.length) {
            memoryItems = keeps.map(k => k.content?.slice(0, 40)).filter(Boolean);
          }
        }
      } catch { }

      let tts;
      if (memoryItems.length > 0) {
        const top = memoryItems.slice(0, 3).join(', ');
        if (lang === 'te') tts = `మీ ఫోన్లో ${memoryItems.length} జ్ఞాపకాలు ఉన్నాయి: ${top}.`;
        else if (lang === 'hi') tts = `आपके फ़ोन में ${memoryItems.length} यादें सहेजी गई हैं: ${top}।`;
        else tts = say('memories_count', lang, { n: memoryItems.length, top }) ?? `You have ${memoryItems.length} memories saved: ${top}.`;
      } else {
        if (lang === 'te') tts = 'మీ ఫోన్లో జ్ఞాపకాలేవీ సేవ్ చేయబడలేదు.';
        else if (lang === 'hi') tts = 'आपके फ़ोन में कोई यादें सहेजी नहीं गई हैं।';
        else tts = say('memories_none', lang, {}) ?? 'You have no memories saved.';
      }

      return { handled: true, queryType: 'memories', tts, language: lang };
    }

    case 'warranties': {
      let productNames = [];
      try {
        if (supabase && userId) {
          const { data: products } = await supabase
            .from('products')
            .select('name,warranty_expiry')
            .eq('user_id', userId)
            .order('warranty_expiry', { ascending: true })
            .limit(5);
          if (products?.length) {
            productNames = products.map(p => p.name).filter(Boolean);
          }
        }
      } catch { }

      let tts;
      if (productNames.length > 0) {
        const top = productNames.slice(0, 3).join(', ');
        if (lang === 'te') tts = `మీ వద్ద ${productNames.length} వారంటీలు ఉన్నాయి: ${top}.`;
        else if (lang === 'hi') tts = `आपके पास ${productNames.length} वारंटी हैं: ${top}।`;
        else tts = say('warranties_count', lang, { n: productNames.length, top }) ?? `You have ${productNames.length} warranties in your wallet: ${top}.`;
      } else {
        if (lang === 'te') tts = 'యాక్టివ్ వారంటీలేవీ లేవు.';
        else if (lang === 'hi') tts = 'कोई सक्रिय वारंटी नहीं है।';
        else tts = 'You have no active warranties.';
      }

      return { handled: true, queryType: 'warranties', tts, language: lang };
    }

    case 'expenses': {
      let total = 0;
      let topItems = [];
      try {
        if (supabase && userId) {
          const startOfMonth = new Date();
          startOfMonth.setDate(1);
          startOfMonth.setHours(0, 0, 0, 0);

          const { data: expRows } = await supabase
            .from('expenses')
            .select('amount,category,description')
            .eq('user_id', userId)
            .gte('created_at', startOfMonth.toISOString());

          if (expRows?.length) {
            const sorted = [...expRows].sort((a, b) => (parseFloat(b.amount) || 0) - (parseFloat(a.amount) || 0));
            total = sorted.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
            topItems = sorted.slice(0, 3).map(e => `${e.description || e.category || 'Expense'} ₹${Math.round(parseFloat(e.amount) || 0)}`);
          } else {
            // Also check keeps of type expense
            const { data: keepExps } = await supabase
              .from('keeps')
              .select('content')
              .eq('user_id', userId)
              .eq('intent_type', 'expense')
              .gte('created_at', startOfMonth.toISOString());
            // Only keeps that carry an amount are spending. A sentence like
            // "ee nela expenses anni" (a question once saved by mistake) is
            // not an expense and was being read back as one, next to "₹0".
            const withAmount = (keepExps || []).filter(k => /\d/.test(String(k.content || '')));
            for (const k of withAmount) {
              const m = String(k.content).replace(/,/g, '').match(/(?:₹|rs\.?|inr)?\s*(\d+(?:\.\d+)?)/i);
              if (m) total += parseFloat(m[1]) || 0;
            }
            topItems = withAmount.slice(0, 3).map(k => k.content?.slice(0, 30)).filter(Boolean);
          }
        }
      } catch { }

      let tts;
      if (total > 0 || topItems.length > 0) {
        const topStr = topItems.join(', ');
        if (lang === 'te') tts = `ఈ నెల మొత్తం ఖర్చులు ₹${Math.round(total)}. ప్రధాన ఖర్చులు: ${topStr}.`;
        else if (lang === 'hi') tts = `इस महीने का कुल खर्च ₹${Math.round(total)} है। मुख्य खर्च: ${topStr}।`;
        else tts = `This month's total expenses are ₹${Math.round(total)}. Top items: ${topStr}.`;
      } else {
        if (lang === 'te') tts = 'ఈ నెల ఖర్చులేవీ నమోదు కాలేదు.';
        else if (lang === 'hi') tts = 'इस महीने कोई खर्च दर्ज नहीं हुआ है।';
        else tts = 'No expenses recorded this month.';
      }

      return { handled: true, queryType: 'expenses', tts, language: lang };
    }

    default: {
      let tts;
      if (lang === 'te') tts = 'మీరు అడిగిన సమాచారం ప్రస్తుతం అందుబాటులో లేదు.';
      else if (lang === 'hi') tts = 'यह जानकारी अभी उपलब्ध नहीं है।';
      else tts = 'This information is not currently available.';
      return { handled: true, queryType: 'general', tts, language: lang };
    }
  }
}
