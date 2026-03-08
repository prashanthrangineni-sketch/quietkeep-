// ═══════════════════════════════════════════════════════════════
// EMERGENCY PAGE — SOS WRITE-BACK PATCH
// Apply to: src/app/emergency/page.jsx  (was BLOCK1 + BLOCK2)
//
// TWO exact string replacements in the file:
//
// ── REPLACEMENT 1 ──
// Find this in shareViaWhatsApp():
//   window.open(wa, '_blank');
//   setSentTo(prev => [...prev, contact.id]);
//
// Replace with:
//   window.open(wa, '_blank');
//   setSentTo(prev => {
//     const next = [...prev, contact.id];
//     writeSosEvent(next.length, 'whatsapp');
//     return next;
//   });
//
// ── REPLACEMENT 2 ──
// Find this in shareViaSMS():
//   window.location.href = `sms:${contact.phone}?body=${encodeURIComponent(msg)}`;
//   setSentTo(prev => [...prev, contact.id]);
//
// Replace with:
//   window.location.href = `sms:${contact.phone}?body=${encodeURIComponent(msg)}`;
//   setSentTo(prev => {
//     const next = [...prev, contact.id];
//     writeSosEvent(next.length, 'sms');
//     return next;
//   });
//
// ── ADD THIS NEW FUNCTION ── (paste between shareViaSMS and startSosHold)
// ═══════════════════════════════════════════════════════════════

  // Write SOS event to sos_events table
  async function writeSosEvent(contactsNotified, channel) {
    if (!user) return;
    try {
      await supabase.from('sos_events').insert({
        user_id: user.id,
        triggered_at: new Date().toISOString(),
        latitude: location?.lat ?? null,
        longitude: location?.lng ?? null,
        location_accuracy: location?.acc ?? null,
        contacts_notified: contactsNotified,
        channel: channel,       // 'whatsapp' | 'sms'
        is_resolved: false,
        notes: `SOS triggered via ${channel}. Location: ${location ? `${location.lat.toFixed(5)},${location.lng.toFixed(5)}` : 'unavailable'}`,
      });
    } catch (e) {
      // Non-blocking — SOS still works even if DB write fails
      console.error('[SOS write-back]', e);
    }
  }

// ═══════════════════════════════════════════════════════════════
// FULL PATCHED FUNCTIONS (copy-paste ready):
// ═══════════════════════════════════════════════════════════════

  // Share location via WhatsApp deep link — PATCHED
  function shareViaWhatsApp(contact) {
    if (!location) return;
    const mapsUrl = `https://maps.google.com/?q=${location.lat},${location.lng}`;
    const msg = `🚨 EMERGENCY — I need help!\nMy location: ${mapsUrl}\nAccuracy: ~${location.acc}m\nSent from QuietKeep`;
    const wa = `https://wa.me/${contact.phone.replace(/\D/g, '')}?text=${encodeURIComponent(msg)}`;
    window.open(wa, '_blank');
    setSentTo(prev => {
      const next = [...prev, contact.id];
      writeSosEvent(next.length, 'whatsapp');
      return next;
    });
  }

  // Share via SMS fallback — PATCHED
  function shareViaSMS(contact) {
    if (!location) return;
    const mapsUrl = `https://maps.google.com/?q=${location.lat},${location.lng}`;
    const msg = `EMERGENCY — I need help! My location: ${mapsUrl} (accuracy ~${location.acc}m) — Sent from QuietKeep`;
    window.location.href = `sms:${contact.phone}?body=${encodeURIComponent(msg)}`;
    setSentTo(prev => {
      const next = [...prev, contact.id];
      writeSosEvent(next.length, 'sms');
      return next;
    });
  }

  // Write SOS event to sos_events table — NEW
  async function writeSosEvent(contactsNotified, channel) {
    if (!user) return;
    try {
      await supabase.from('sos_events').insert({
        user_id: user.id,
        triggered_at: new Date().toISOString(),
        latitude: location?.lat ?? null,
        longitude: location?.lng ?? null,
        location_accuracy: location?.acc ?? null,
        contacts_notified: contactsNotified,
        channel: channel,
        is_resolved: false,
        notes: `SOS triggered via ${channel}. Location: ${location ? `${location.lat.toFixed(5)},${location.lng.toFixed(5)}` : 'unavailable'}`,
      });
    } catch (e) {
      console.error('[SOS write-back]', e);
    }
  }
