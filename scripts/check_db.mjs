import { createClient } from '@supabase/supabase-js';
import pkg from '@next/env';
const { loadEnvConfig } = pkg;

// Load Next.js environment variables
loadEnvConfig('C:/Users/ADMIN/OneDrive/Desktop/Antigravity 2.0 Pranix/Quietkeep');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing env vars');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
  const { data: workspaces, error: wsErr } = await supabase.from('business_workspaces').select('*');
  if (wsErr) {
    console.error('ws error:', wsErr);
  } else {
    console.log('Workspaces:');
    workspaces.forEach(w => console.log(`- ID: ${w.id}, Name: "${w.name}", Owner: ${w.owner_user_id}`));
  }

  const { data: profiles, error: pErr } = await supabase.from('profiles').select('*');
  if (pErr) {
    console.error('p error:', pErr);
  } else {
    console.log('Profiles:');
    profiles.forEach(p => console.log(`- ID: ${p.user_id}, Name: "${p.full_name}"`));
  }
}

run();
