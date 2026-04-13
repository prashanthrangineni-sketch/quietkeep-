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

  return (
    <div style={{ background: 'var(--primary-dim)', borderRadius: 12, padding: 12, marginBottom: 14, border: '1px solid var(--primary-glow)' }}>
      <div style={{ fontSize: 12, color: 'var(--primary)', fontWeight: 700, marginBottom: 10 }}>{title}</div>
      <div style={{ marginBottom: 10 }}>
        <label className="qk-lbl">TITHI (Lunar Day)</label>
        <select value={form.tithi||''} onChange={e => setForm({...form, tithi:e.target.value})} className="qk-form-inp">
          <option value=''>-- Select Tithi --</option>
          {TITHIS.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      <div style={{ marginBottom: 10 }}>
        <label className="qk-lbl">NAKSHATRA (Star)</label>
        <select value={form.nakshatra||''} onChange={e => setForm({...form, nakshatra:e.target.value})} className="qk-form-inp">
          <option value=''>-- Select Nakshatra --</option>
          {NAKSHATRAS.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>
      <div>
        <label className="qk-lbl">{monthLabel}</label>
        <select value={form.traditional_month||''} onChange={e => setForm({...form, traditional_month:e.target.value})} className="qk-form-inp">
          <option value=''>-- Select Month --</option>
          {months.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>
    </div>
  );
}

function IslamicSection({ form, setForm }) {
  return (
    <div style={{ background: 'var(--accent-dim)', borderRadius: 12, padding: 12, marginBottom: 14, border: '1px solid rgba(5,150,105,0.2)' }}>
      <div style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 700, marginBottom: 10 }}>☪️ Hijri Calendar</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div>
          <label className="qk-lbl">HIJRI MONTH</label>
          <select value={form.hijri_month||''} onChange={e => setForm({...form, hijri_month:e.target.value})} className="qk-form-inp">
            <option value=''>-- Month --</option>
            {HIJRI_MONTHS.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className="qk-lbl">HIJRI DAY</label>
          <input type="number" min="1" max="30" value={form.hijri_day||''} onChange={e => setForm({...form, hijri_day:e.target.value})}
            placeholder="1–30" className="qk-form-inp" />
        </div>
      </div>
    </div>
  );
}

function buildPayload(form) {
  const payload = { ...form };
  if ('category' in payload) {
    if (!payload.event_type) payload.event_type = payload.category;
    delete payload.category;
  }
  return payload;
}

export default function AddEventModal({ form, setForm, onSave, onClose, categories, timezones, calendarTypes, isEditing }) {
  const canSave = form.event_name?.trim() && form.event_date;

  function handleSave() {
    const correctedForm = buildPayload(form);
    setForm(correctedForm);
    onSave(correctedForm);
  }

  return (
    // z-index 600 — above navbar (1000 is navbar, but modal overlay covers it via inset:0)
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 600, display: 'flex', alignItems: 'flex-end' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{
        background: 'var(--bg-raised)', borderRadius: '20px 20px 0 0',
        padding: '20px 20px',
        paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 24px)',
        width: '100%', maxWidth: 520, margin: '0 auto',
        maxHeight: '90dvh', overflowY: 'auto',
        boxSizing: 'border-box',
        border: '1px solid var(--border)', borderBottom: 'none',
        boxShadow: '0 -8px 40px rgba(0,0,0,0.12)',
        animation: 'qk-sheet-in 0.25s cubic-bezier(0.34,1.2,0.64,1)',
      }}>
        {/* Drag handle */}
        <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--border-strong)', margin: '0 auto 18px' }} />

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <span style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)' }}>
            {isEditing ? '✏️ Edit Event' : '+ Add Event'}
          </span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 22, cursor: 'pointer', lineHeight: 1, padding: '0 4px' }}>×</button>
        </div>

        {/* Category grid */}
        <div style={{ marginBottom: 14 }}>
          <label className="qk-lbl">TYPE</label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 }}>
            {categories.map(cat => (
              <button key={cat.id} onClick={() => setForm({...form, category: cat.id})}
                style={{
                  padding: '8px 4px', borderRadius: 10, cursor: 'pointer', fontSize: 11, textAlign: 'center',
                  border: `2px solid ${form.category === cat.id ? cat.color : 'var(--border)'}`,
                  background: form.category === cat.id ? `${cat.color}15` : 'var(--surface)',
                  color: 'var(--text)', fontFamily: 'inherit',
                }}>
                <div style={{ fontSize: 20 }}>{cat.emoji}</div>
                <div style={{ marginTop: 2 }}>{cat.label}</div>
              </button>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label className="qk-lbl">EVENT NAME *</label>
          <input value={form.event_name||''} onChange={e => setForm({...form, event_name: e.target.value})}
            placeholder="e.g. Amma's Birthday" className="qk-input" autoFocus />
        </div>

        <div style={{ marginBottom: 14 }}>
          <label className="qk-lbl">DATE (Gregorian) *</label>
          <input type="date" value={form.event_date||''} onChange={e => setForm({...form, event_date: e.target.value})} className="qk-input" />
        </div>

        <div style={{ marginBottom: 14 }}>
          <label className="qk-lbl">CALENDAR TRADITION</label>
          <select value={form.calendar_type||'gregorian'} onChange={e => setForm({...form, calendar_type: e.target.value})} className="qk-input">
            {calendarTypes.map(ct => <option key={ct.id} value={ct.id}>{ct.emoji} {ct.label}</option>)}
          </select>
        </div>

        <PanchangSection form={form} setForm={setForm} />
        {form.calendar_type === 'islamic' && <IslamicSection form={form} setForm={setForm} />}

        <div style={{ marginBottom: 14 }}>
          <label className="qk-lbl">REMINDER TIME</label>
          <input type="time" value={form.reminder_time||'09:00'} onChange={e => setForm({...form, reminder_time: e.target.value})} className="qk-input" />
        </div>

        <div style={{ marginBottom: 14 }}>
          <label className="qk-lbl">TIMEZONE</label>
          <select value={form.timezone||'Asia/Kolkata'} onChange={e => setForm({...form, timezone: e.target.value})} className="qk-input">
            {timezones.map(tz => <option key={tz.value} value={tz.value}>{tz.label}</option>)}
          </select>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label className="qk-lbl">NOTES</label>
          <textarea value={form.description||''} onChange={e => setForm({...form, description: e.target.value})}
            rows={2} placeholder="Optional notes..." className="qk-input" style={{ resize: 'none' }} />
        </div>

        {/* Yearly toggle */}
        <div onClick={() => setForm({...form, is_annual: !form.is_annual})}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: 12, background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 10, marginBottom: 20, cursor: 'pointer',
          }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>🔁 Yearly Reminder</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Repeat every year (birthdays, anniversaries)</div>
          </div>
          <div style={{
            width: 44, height: 24, borderRadius: 12, cursor: 'pointer', position: 'relative',
            transition: 'background 0.2s', background: form.is_annual ? 'var(--primary)' : 'var(--border-strong)', flexShrink: 0,
          }}>
            <div style={{
              position: 'absolute', top: 3, width: 18, height: 18, borderRadius: '50%', background: '#fff',
              left: form.is_annual ? 23 : 3, transition: 'left 0.2s', boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
            }} />
          </div>
        </div>

        <button onClick={handleSave} disabled={!canSave}
          className="qk-btn qk-btn-primary"
          style={{ width: '100%', justifyContent: 'center', padding: 14, fontSize: 15 }}>
          {isEditing ? '✓ Save Changes' : '+ Save Event'}
        </button>
      </div>
    </div>
  );
}
