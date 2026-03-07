import { NextResponse } from 'next/server';

// PARSE ONLY — never inserts into keeps table.
// The dashboard does the single insert. This route caused duplicate rows.

function parseDateTime(text) {
  const t = text.toLowerCase();
  const now = new Date();
  let date = null;

  if (/\btoday\b/.test(t)) { date = new Date(now); }
  else if (/\btomorrow\b/.test(t)) { date = new Date(now); date.setDate(date.getDate() + 1); }
  else if (/\bday after tomorrow\b/.test(t)) { date = new Date(now); date.setDate(date.getDate() + 2); }
  else if (/\bnext week\b/.test(t)) { date = new Date(now); date.setDate(date.getDate() + 7); }

  const days = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  for (let i = 0; i < days.length; i++) {
    if (new RegExp('\\b' + days[i] + '\\b').test(t)) {
      date = new Date(now); const diff = (i - now.getDay() + 7) % 7 || 7; date.setDate(date.getDate() + diff); break;
    }
  }
  const monthNames = ['january','february','march','april','may','june','july','august','september','october','november','december'];
  for (let m = 0; m < monthNames.length; m++) {
    const re1 = new RegExp('(\\d{1,2})(?:st|nd|rd|th)?\\s+' + monthNames[m]);
    const re2 = new RegExp(monthNames[m] + '\\s+(\\d{1,2})');
    const match = t.match(re1) || t.match(re2);
    if (match) { date = new Date(now.getFullYear(), m, parseInt(match[1])); if (date < now) date.setFullYear(date.getFullYear() + 1); break; }
  }
  if (!date) { const nd = t.match(/(\d{1,2})[\/\-](\d{1,2})/); if (nd) { date = new Date(now.getFullYear(), parseInt(nd[2]) - 1, parseInt(nd[1])); if (date < now) date.setFullYear(date.getFullYear() + 1); } }
  if (!date) return null;

  let hours = 9, minutes = 0;
  // Explicit am/pm wins over everything
  const ap = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  if (ap) { hours = parseInt(ap[1]); minutes = ap[2] ? parseInt(ap[2]) : 0; if (ap[3]==='pm' && hours<12) hours+=12; if (ap[3]==='am' && hours===12) hours=0; }
  else { const pt = t.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\b/); if (pt) { hours=parseInt(pt[1]); minutes=pt[2]?parseInt(pt[2]):0; if(hours<7)hours+=12; } else if (/\bmidnight\b/.test(t)){hours=0;minutes=0;} else if (/\bnoon\b|\bmidday\b/.test(t)){hours=12;} else if (/\bmorning\b/.test(t)){hours=9;} else if (/\bafternoon\b/.test(t)){hours=14;} else if (/\bevening\b/.test(t)){hours=18;} else if (/\bnight\b/.test(t)){hours=20;} }

  date.setHours(hours, minutes, 0, 0);
  const pad = n => String(n).padStart(2,'0');
  return date.getFullYear()+'-'+pad(date.getMonth()+1)+'-'+pad(date.getDate())+'T'+pad(hours)+':'+pad(minutes);
}

function detectIntentType(text) {
  const t = text.toLowerCase();
  if (/call|ring|phone|contact|whatsapp|message/.test(t)) return { type:'contact', confidence:0.85 };
  if (/buy|order|get|purchase|pick up|shop/.test(t)) return { type:'purchase', confidence:0.85 };
  if (/meet|meeting|appointment|doctor|dentist|interview|conference|seminar/.test(t)) return { type:'reminder', confidence:0.9 };
  if (/remind|remember|don.t forget/.test(t)) return { type:'reminder', confidence:0.8 };
  if (/pay|bill|expense|spent|cost/.test(t)) return { type:'expense', confidence:0.85 };
  if (/travel|trip|flight|hotel/.test(t)) return { type:'trip', confidence:0.8 };
  return { type:'note', confidence:0.6 };
}

export async function POST(req) {
  try {
    const { text } = await req.json();
    if (!text?.trim()) return NextResponse.json({ error:'No text' }, { status:400 });
    const reminder_at = parseDateTime(text);
    const { type: intent_type, confidence } = detectIntentType(text);
    // Return parsed result only — dashboard does the insert
    return NextResponse.json({ intent_type, confidence, reminder_at, parsed:true });
  } catch (err) {
    console.error('parse-intent error:', err);
    return NextResponse.json({ error:'Parse failed' }, { status:500 });
  }
}
