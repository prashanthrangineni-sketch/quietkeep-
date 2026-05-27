  async function updateState(id, state) {
    try {
      const { data: result, error } = await safeFetch(`/api/keeps/${id}/transition`, {
        method: 'POST',
        body: JSON.stringify({ new_state: state }),
        token: accessToken || '',
      });
      if (error) {
        showToast('Transition failed: ' + error);
        return;
      }
      // Schedule local SW notification if this keep has a reminder
      if (result?.keep?.reminder_at) {
        const fireAt = new Date(result.keep.reminder_at).getTime();
        if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
          navigator.serviceWorker.controller.postMessage({
            type: 'SCHEDULE_REMINDER',
            id: result.keep.id,
            text: content.trim(),
            fireAt,
          });
        }
      }
      if (!result?.success) {
        showToast('Transition failed: ' + (result?.error || 'unknown'));
        return;
      }
    } catch {
      await supabase.from('keeps').update({ status: state }).eq('id', id);
      supabase.from('audit_log').insert({ user_id: user.id, action: 'keep_status_updated', intent_id: id, service: 'dashboard', details: { status: state } }).then(() => {});
    }
    showToast(state === 'closed' ? '✓ Marked done!' : 'Moved to ' + state);
    await loadIntents(user.id);
  }
