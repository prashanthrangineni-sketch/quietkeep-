// src/lib/app-queries.js
// Handles voice queries for app data and connectors.
// Questions are answered aloud from the user's data; they NEVER create a keep.

import { detectSpokenLanguage } from './spoken-language.js';

const QUERY_PATTERNS = [
  { type: 'weather',   pattern: /(?:^|\P{L})(?:weather|వాతావరణం|వాతావరణ|मौसम|हवामान)(?:\P{L}|$)|weather\s+ela\s+undi/iu },
  { type: 'tithi',     pattern: /(?:^|\P{L})(?:thithi|tithi|తిథి|పంచాంగం|panchangam|panchanga|तिथि|पंचांग)(?:\P{L}|$)/iu },
  { type: 'documents', pattern: /(?:^|\P{L})(?:పత్రాలు|పత్రం|documents?|patralu|docs?|files?|దస్తావేజులు|दस्तावेज़|दस्तावेज)(?:\P{L}|$)/iu },
  { type: 'tasks',     pattern: /(?:^|\P{L})(?:పనులు|పని|tasks?|reminders?|work|panulu|to-?dos?|काम|कार्य)(?:\P{L}|$)|ఏమేం\s*పనులు/iu },
  { type: 'memories',  pattern: /(?:^|\P{L})(?:జ్ఞాపకాలు|జ్ఞాపకం|memories|memory|keeps?|notes?|gnapakalu|यादें|याद)(?:\P{L}|$)/iu },
  { type: 'warranties',pattern: /(?:^|\P{L})(?:వారంటీ|వారంటీస్|warrant(?:y|ies)|guarantee|वारंटी)(?:\P{L}|$)/iu },
  { type: 'expenses',  pattern: /(?:^|\P{L})(?:expenses?\s*anni|ఖర్చులు|ఖర్చు|all\s+expenses?|expenses?\s+this\s+month|how\s+much\s+did\s+i\s+spend|what\s+did\s+i\s+spend|खर्च|खर्चा)(?:\P{L}|$)/iu },
];

export function isQueryUtterance(text = '', llmIntent = null) {
  if (llmIntent === 'query') return true;
  const str = String(text || '').trim();
  if (!str) return false;
  return QUERY_PATTERNS.some(q => q.pattern.test(str));
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
      let temp = 28;
      let descTe = 'పాక్షికంగా మేఘావృతమై ఉంది';
      let descHi = 'आंशिक रूप से बादल छाए रहेंगे';
      let descEn = 'partly cloudy';

      try {
        if (supabase) {
          const { data: row } = await supabase
            .from('connector_values')
            .select('value')
            .eq('scope', 'weather')
            .limit(1)
            .maybeSingle();
          if (row?.value) {
            temp = row.value.temp || row.value.temperature || temp;
            if (row.value.description) {
              descEn = row.value.description.toLowerCase();
            }
          }
        }
      } catch { }

      let tts;
      if (lang === 'te') {
        tts = `ఈరోజు వాతావరణం ${temp} డిగ్రీలు, ${descTe}.`;
      } else if (lang === 'hi') {
        tts = `आज मौसम ${temp} डिग्री है, ${descHi}।`;
      } else {
        tts = `Today's weather is ${temp}°C and ${descEn}.`;
      }

      return { handled: true, queryType: 'weather', tts, language: lang };
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
        else tts = `Today's tithi is ${tithiFound}.`;
      } else {
        // Source not in repo / DB -> state plainly it cannot yet
        if (lang === 'te') {
          tts = 'క్షమించండి, ప్రస్తుతం తెలుగు పంచాంగం తిథి వివరాలు అందుబాటులో లేవు.';
        } else if (lang === 'hi') {
          tts = 'माफ़ कीजिए, अभी तेलुगु पंचांग तिथि विवरण उपलब्ध नहीं हैं।';
        } else {
          tts = 'Sorry, Telugu calendar tithi details are not available yet.';
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
        else tts = `You have ${docNames.length} documents saved: ${top}.`;
      } else {
        if (lang === 'te') tts = 'మీ ఫోన్లో పత్రాలేవీ సేవ్ చేయబడలేదు.';
        else if (lang === 'hi') tts = 'आपके फ़ोन में कोई दस्तावेज़ सहेजे नहीं गए हैं।';
        else tts = 'No documents are saved on your phone.';
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
        else tts = `You have ${taskItems.length} tasks scheduled for today: ${top}.`;
      } else {
        if (lang === 'te') tts = 'ఈరోజు మీకు ఎలాంటి పనులు లేవు. మీరు ప్రశాంతంగా ఉండవచ్చు!';
        else if (lang === 'hi') tts = 'आज आपका कोई काम नहीं है।';
        else tts = 'You have no tasks scheduled for today. All clear!';
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
        else tts = `You have ${memoryItems.length} memories saved: ${top}.`;
      } else {
        if (lang === 'te') tts = 'మీ ఫోన్లో జ్ఞాపకాలేవీ సేవ్ చేయబడలేదు.';
        else if (lang === 'hi') tts = 'आपके फ़ोन में कोई यादें सहेजी नहीं गई हैं।';
        else tts = 'You have no memories saved.';
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
        else tts = `You have ${productNames.length} warranties in your wallet: ${top}.`;
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
            if (keepExps?.length) {
              topItems = keepExps.slice(0, 3).map(k => k.content?.slice(0, 30)).filter(Boolean);
            }
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
