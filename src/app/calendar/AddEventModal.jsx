'use client';

export default function AddEventModal({ form, setForm, onSave, onClose, categories, timezones, calendarTypes }) {
  const canSave = form.event_name.trim() && form.event_date;

  const inputStyle = {
    width: '100%', background: '#1e1e2e', border: '1px solid #333', color: '#fff',
    padding: '10px 12px', borderRadius: '10px', fontSize: '14px', boxSizing: 'border-box',
  };
  const labelStyle = { fontSize: '12px', color: '#888', display: 'block', marginBottom: '6px' };
  const fieldWrap = { marginBottom: '14px' };

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.85)', zIndex:100, display:'flex', alignItems:'flex-end' }}>
      <div style={{ background:'#12121a', borderRadius:'20px 20px 0 0', padding:'24px', width:'100%', maxHeight:'88vh', overflowY:'auto', boxSizing:'border-box' }}>

        {/* Title */}
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'20px' }}>
          <span style={{ fontSize:'18px', fontWeight:700 }}>Add Event / Reminder</span>
          <button onClick={onClose} style={{ background:'none', border:'none', color:'#888', fontSize:'24px', cursor:'pointer' }}>×</button>
        </div>

        {/* Category grid */}
        <div style={fieldWrap}>
          <label style={labelStyle}>TYPE</label>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'8px' }}>
            {categories.map(cat => (
              <button key={cat.id} onClick={() => setForm({ ...form, category: cat.id })}
                style={{ padding:'8px 4px', borderRadius:'10px', cursor:'pointer', fontSize:'11px', textAlign:'center',
                  border: `2px solid ${form.category===cat.id ? cat.color : 'transparent'}`,
                  background:'#1e1e2e', color:'#fff' }}>
                <div style={{ fontSize:'20px' }}>{cat.emoji}</div>
                <div>{cat.label}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Event name */}
        <div style={fieldWrap}>
          <label style={labelStyle}>EVENT NAME *</label>
          <input value={form.event_name} onChange={e => setForm({ ...form, event_name: e.target.value })}
            placeholder="e.g. Amma's Birthday" style={inputStyle} />
        </div>

        {/* Date */}
        <div style={fieldWrap}>
          <label style={labelStyle}>DATE *</label>
          <input type="date" value={form.event_date} onChange={e => setForm({ ...form, event_date: e.target.value })} style={inputStyle} />
        </div>

        {/* Reminder time */}
        <div style={fieldWrap}>
          <label style={labelStyle}>REMINDER TIME</label>
          <input type="time" value={form.reminder_time} onChange={e => setForm({ ...form, reminder_time: e.target.value })} style={inputStyle} />
        </div>

        {/* Timezone */}
        <div style={fieldWrap}>
          <label style={labelStyle}>TIMEZONE</label>
          <select value={form.timezone} onChange={e => setForm({ ...form, timezone: e.target.value })} style={{ ...inputStyle, appearance:'none' }}>
            {timezones.map(tz => <option key={tz.value} value={tz.value}>{tz.label}</option>)}
          </select>
        </div>

        {/* Calendar type */}
        <div style={fieldWrap}>
          <label style={labelStyle}>CALENDAR</label>
          <select value={form.calendar_type} onChange={e => setForm({ ...form, calendar_type: e.target.value })} style={{ ...inputStyle, appearance:'none' }}>
            {calendarTypes.map(ct => <option key={ct.id} value={ct.id}>{ct.emoji} {ct.label}</option>)}
          </select>
        </div>

        {/* Notes */}
        <div style={fieldWrap}>
          <label style={labelStyle}>NOTES</label>
          <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
            rows={2} placeholder="Optional notes..."
            style={{ ...inputStyle, resize:'none' }} />
        </div>

        {/* Yearly toggle */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px', background:'#1e1e2e', borderRadius:'10px', marginBottom:'20px' }}>
          <div>
            <div style={{ fontSize:'14px', fontWeight:600 }}>🔁 Yearly Reminder</div>
            <div style={{ fontSize:'12px', color:'#888' }}>Repeat every year (birthdays, anniversaries)</div>
          </div>
          <div onClick={() => setForm({ ...form, is_annual: !form.is_annual })}
            style={{ width:'44px', height:'24px', borderRadius:'12px', cursor:'pointer', position:'relative', transition:'background 0.2s',
              background: form.is_annual ? '#6366f1' : '#333' }}>
            <div style={{ position:'absolute', top:'2px', left: form.is_annual ? '22px' : '2px', width:'20px', height:'20px', borderRadius:'50%', background:'#fff', transition:'left 0.2s' }} />
          </div>
        </div>

        {/* Save button */}
        <button onClick={onSave} disabled={!canSave}
          style={{ width:'100%', padding:'14px', border:'none', color:'#fff', borderRadius:'12px', fontSize:'16px', fontWeight:700, cursor: canSave ? 'pointer' : 'not-allowed',
            background: canSave ? '#6366f1' : '#333' }}>
          Save Event
        </button>
      </div>
    </div>
  );
      }
