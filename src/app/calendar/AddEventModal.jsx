'use client';

const TITHIS = [
  'Pratipada (1st)', 'Dwitiya (2nd)', 'Tritiya (3rd)', 'Chaturthi (4th)',
  'Panchami (5th)', 'Shashthi (6th)', 'Saptami (7th)', 'Ashtami (8th)',
  'Navami (9th)', 'Dashami (10th)', 'Ekadashi (11th)', 'Dwadashi (12th)',
  'Trayodashi (13th)', 'Chaturdashi (14th)', 'Purnima (Full Moon)', 'Amavasya (New Moon)',
];

const NAKSHATRAS = [
  'Ashwini','Bharani','Krittika','Rohini','Mrigashira','Ardra',
  'Punarvasu','Pushya','Ashlesha','Magha','Purva Phalguni','Uttara Phalguni',
  'Hasta','Chitra','Swati','Vishakha','Anuradha','Jyeshtha',
  'Mula','Purva Ashadha','Uttara Ashadha','Shravana','Dhanishta','Shatabhisha',
  'Purva Bhadrapada','Uttara Bhadrapada','Revati',
];

const TELUGU_MONTHS = ['Chaitra','Vaisakha','Jyeshtha','Ashadha','Shravana','Bhadrapada','Ashwina','Kartika','Margashirsha','Pushya','Magha','Phalguna'];
const TAMIL_MONTHS = ['Chithirai','Vaikasi','Aani','Aadi','Aavani','Purattasi','Aippasi','Karthigai','Margazhi','Thai','Maasi','Panguni'];
const HIJRI_MONTHS = ['Muharram','Safar','Rabi al-Awwal','Rabi al-Thani','Jumada al-Awwal','Jumada al-Thani','Rajab',"Sha'ban",'Ramadan','Shawwal',"Dhu al-Qi'dah",'Dhu al-Hijjah'];

function PanchangSection({ form, setForm }) {
  const ct = form.calendar_type;
  if (!['telugu','hindi','tamil'].includes(ct)) return null;
  const months = ct === 'tamil' ? TAMIL_MONTHS : TELUGU_MONTHS;
  const title = ct === 'telugu' ? '🌸 Telugu Panchangam' : ct === 'hindi' ? '🪔 Hindi Panchang' : '🌺 Tamil Calendar';
  const monthLabel = ct === 'tamil' ? 'TAMIL MONTH' : ct === 'hindi' ? 'HINDI MONTH' : 'TELUGU MONTH';

  const sel = { width:'100%', background:'#12121a', border:'1px solid #333', color:'#fff', padding:'8px 10px', borderRadius:'8px', fontSize:'13px' };
  const lbl = { fontSize:'11px', color:'#888', display:'block', marginBottom:'4px' };

  return (
    <div style={{ background:'#1a1a2e', borderRadius:'12px', padding:'12px', marginBottom:'14px', border:'1px solid #2a2a4e' }}>
      <div style={{ fontSize:'12px', color:'#818cf8', fontWeight:700, marginBottom:'10px' }}>{title}</div>
      <div style={{ marginBottom:'10px' }}>
        <label style={lbl}>TITHI (Lunar Day)</label>
        <select value={form.tithi||''} onChange={e => setForm({...form, tithi:e.target.value})} style={sel}>
          <option value=''>-- Select Tithi --</option>
          {TITHIS.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      <div style={{ marginBottom:'10px' }}>
        <label style={lbl}>NAKSHATRA (Star)</label>
        <select value={form.nakshatra||''} onChange={e => setForm({...form, nakshatra:e.target.value})} style={sel}>
          <option value=''>-- Select Nakshatra --</option>
          {NAKSHATRAS.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>
      <div>
        <label style={lbl}>{monthLabel}</label>
        <select value={form.traditional_month||''} onChange={e => setForm({...form, traditional_month:e.target.value})} style={sel}>
          <option value=''>-- Select Month --</option>
          {months.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>
    </div>
  );
}

function IslamicSection({ form, setForm }) {
  const sel = { width:'100%', background:'#12121a', border:'1px solid #333', color:'#fff', padding:'8px 10px', borderRadius:'8px', fontSize:'12px', boxSizing:'border-box' };
  return (
    <div style={{ background:'#1a2a1a', borderRadius:'12px', padding:'12px', marginBottom:'14px', border:'1px solid #2a4a2a' }}>
      <div style={{ fontSize:'12px', color:'#4ECDC4', fontWeight:700, marginBottom:'10px' }}>☪️ Hijri Calendar</div>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'8px' }}>
        <div>
          <label style={{ fontSize:'11px', color:'#888', display:'block', marginBottom:'4px' }}>HIJRI MONTH</label>
          <select value={form.hijri_month||''} onChange={e => setForm({...form, hijri_month:e.target.value})} style={sel}>
            <option value=''>-- Month --</option>
            {HIJRI_MONTHS.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div>
          <label style={{ fontSize:'11px', color:'#888', display:'block', marginBottom:'4px' }}>HIJRI DAY</label>
          <input type="number" min="1" max="30" value={form.hijri_day||''} onChange={e => setForm({...form, hijri_day:e.target.value})}
            placeholder="1–30" style={sel} />
        </div>
      </div>
    </div>
  );
}

// buildPayload remaps UI-only field "category" → DB column "event_type" before insert
function buildPayload(form) {
  const payload = { ...form };
  if ('category' in payload) {
    if (!payload.event_type) payload.event_type = payload.category;
    delete payload.category;
  }
  return payload;
}

export default function AddEventModal({ form, setForm, onSave, onClose, categories, timezones, calendarTypes }) {
  const canSave = form.event_name?.trim() && form.event_date;
  const inp = { width:'100%', background:'#1e1e2e', border:'1px solid #333', color:'#fff', padding:'10px 12px', borderRadius:'10px', fontSize:'14px', boxSizing:'border-box' };
  const lbl = { fontSize:'12px', color:'#888', display:'block', marginBottom:'6px' };
  const fw = { marginBottom:'14px' };

  // Intercept Save: remap category → event_type before calling parent onSave
  function handleSave() {
    const correctedForm = buildPayload(form);
    setForm(correctedForm);
    onSave(correctedForm);
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.88)', zIndex:100, display:'flex', alignItems:'flex-end' }}>
      <div style={{ background:'#12121a', borderRadius:'20px 20px 0 0', padding:'24px', width:'100%', maxHeight:'90vh', overflowY:'auto', boxSizing:'border-box' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'20px' }}>
          <span style={{ fontSize:'18px', fontWeight:700 }}>Add Event / Reminder</span>
          <button onClick={onClose} style={{ background:'none', border:'none', color:'#888', fontSize:'24px', cursor:'pointer' }}>×</button>
        </div>

        {/* Category grid — form.category is UI-only state; remapped to event_type on save */}
        <div style={fw}>
          <label style={lbl}>TYPE</label>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'8px' }}>
            {categories.map(cat => (
              <button key={cat.id} onClick={() => setForm({...form, category:cat.id})}
                style={{ padding:'8px 4px', borderRadius:'10px', cursor:'pointer', fontSize:'11px', textAlign:'center',
                  border:`2px solid ${form.category===cat.id ? cat.color : 'transparent'}`, background:'#1e1e2e', color:'#fff' }}>
                <div style={{ fontSize:'20px' }}>{cat.emoji}</div>
                <div>{cat.label}</div>
              </button>
            ))}
          </div>
        </div>

        <div style={fw}>
          <label style={lbl}>EVENT NAME *</label>
          <input value={form.event_name||''} onChange={e => setForm({...form, event_name:e.target.value})} placeholder="e.g. Amma's Birthday" style={inp} />
        </div>

        <div style={fw}>
          <label style={lbl}>DATE (Gregorian) *</label>
          <input type="date" value={form.event_date||''} onChange={e => setForm({...form, event_date:e.target.value})} style={inp} />
        </div>

        <div style={fw}>
          <label style={lbl}>CALENDAR TRADITION</label>
          <select value={form.calendar_type||'gregorian'} onChange={e => setForm({...form, calendar_type:e.target.value})} style={{...inp, appearance:'none'}}>
            {calendarTypes.map(ct => <option key={ct.id} value={ct.id}>{ct.emoji} {ct.label}</option>)}
          </select>
        </div>

        <PanchangSection form={form} setForm={setForm} />

        {form.calendar_type === 'islamic' && <IslamicSection form={form} setForm={setForm} />}

        <div style={fw}>
          <label style={lbl}>REMINDER TIME</label>
          <input type="time" value={form.reminder_time||'09:00'} onChange={e => setForm({...form, reminder_time:e.target.value})} style={inp} />
        </div>

        <div style={fw}>
          <label style={lbl}>TIMEZONE</label>
          <select value={form.timezone||'Asia/Kolkata'} onChange={e => setForm({...form, timezone:e.target.value})} style={{...inp, appearance:'none'}}>
            {timezones.map(tz => <option key={tz.value} value={tz.value}>{tz.label}</option>)}
          </select>
        </div>

        <div style={fw}>
          <label style={lbl}>NOTES</label>
          <textarea value={form.description||''} onChange={e => setForm({...form, description:e.target.value})}
            rows={2} placeholder="Optional notes..." style={{...inp, resize:'none'}} />
        </div>

        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px', background:'#1e1e2e', borderRadius:'10px', marginBottom:'20px' }}>
          <div>
            <div style={{ fontSize:'14px', fontWeight:600 }}>🔁 Yearly Reminder</div>
            <div style={{ fontSize:'12px', color:'#888' }}>Repeat every year (birthdays, anniversaries)</div>
          </div>
          <div onClick={() => setForm({...form, is_annual:!form.is_annual})}
            style={{ width:'44px', height:'24px', borderRadius:'12px', cursor:'pointer', position:'relative', transition:'background 0.2s', background:form.is_annual?'#6366f1':'#333', flexShrink:0 }}>
            <div style={{ position:'absolute', top:'2px', left:form.is_annual?'22px':'2px', width:'20px', height:'20px', borderRadius:'50%', background:'#fff', transition:'left 0.2s' }} />
          </div>
        </div>

        <button onClick={handleSave} disabled={!canSave}
          style={{ width:'100%', padding:'14px', border:'none', color:'#fff', borderRadius:'12px', fontSize:'16px', fontWeight:700, cursor:canSave?'pointer':'not-allowed', background:canSave?'#6366f1':'#333' }}>
          Save Event
        </button>
      </div>
    </div>
  );
                  }
