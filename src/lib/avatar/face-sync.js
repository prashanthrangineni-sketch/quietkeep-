// src/lib/avatar/face-sync.js
// Keep a person's face choice with their account, so it follows them to a new
// phone. Uses one column, profiles.aaria_face (jsonb), which the privacy and
// database thread adds (docs/handoffs/aaria-face-account-thread3.md). Until
// that column exists every read fails quietly and the choice simply stays on
// the phone, exactly as today.
import { useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { isFaceOn, setFaceOn, readChosenFace, saveChosenFace, onFaceChange, normaliseChosenFace } from './face-pref.js';

/** Pure: what is stored on the account. Only these four fields, nothing else. */
export function toAccountValue(on, choice) {
  const c = normaliseChosenFace(choice?.style, choice?.who, choice?.look);
  return { on: !!on, style: c.style, who: c.who, look: c.look };
}
/** Pure: a stored value made safe, or null if it is not one of ours. */
export function fromAccountValue(v) {
  if (!v || typeof v !== 'object' || typeof v.on !== 'boolean') return null;
  return toAccountValue(v.on, v);
}
/** Pure: what to do when the phone and the account are compared once at sign-in. */
export function decideSync(local, account, phoneHasChoice) {
  if (account && !phoneHasChoice) return 'use_account';      // new phone: take the account's
  if (!account && phoneHasChoice) return 'save_phone';        // first time: save the phone's
  if (account && phoneHasChoice && JSON.stringify(account) !== JSON.stringify(local)) return 'save_phone'; // this phone was changed last
  return 'nothing';
}

function phoneHasChoice() {
  try { return localStorage.getItem('qk_aaria_face') !== null; } catch { return false; }
}

/** Mounted once (in the dock). userId: the signed-in person, or null. */
export function useFaceAccountSync(userId) {
  useEffect(() => {
    if (!userId) return undefined;
    let stopped = false; let working = false; let timer = null; let applying = false;
    const local = () => toAccountValue(isFaceOn(), readChosenFace());
    const save = async () => {
      if (!working || stopped) return;
      try { await supabase.from('profiles').update({ aaria_face: local() }).eq('user_id', userId); } catch { }
    };
    (async () => {
      try {
        const { data, error } = await supabase.from('profiles').select('aaria_face').eq('user_id', userId).maybeSingle();
        if (error || stopped) return;                         // column not there yet: stay on the phone only
        working = true;
        const account = fromAccountValue(data?.aaria_face);
        const step = decideSync(local(), account, phoneHasChoice());
        if (step === 'use_account') {
          applying = true;
          saveChosenFace(account); setFaceOn(account.on);
          applying = false;
        } else if (step === 'save_phone') await save();
      } catch { }
    })();
    const off = onFaceChange(() => {
      if (applying || !working) return;
      clearTimeout(timer); timer = setTimeout(save, 1500);  // one write after the person stops changing
    });
    return () => { stopped = true; clearTimeout(timer); off(); };
  }, [userId]);
}
