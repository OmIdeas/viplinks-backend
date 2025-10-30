// /app/supabase.js  (ESM)
import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL) throw new Error('[Supabase] FALTA SUPABASE_URL');

export const supabase = createClient(URL, ANON, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export const supabaseAdmin = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,  // ← Debe usar esta
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// Log seguro (no imprime secretos)
export function logSupabaseKeys() {
  const fmt = (k) => (k ? `${k.slice(0, 8)}… (len:${k.length})` : 'MISSING');
  console.log('[Supabase] URL ok, anon =', fmt(ANON), ' service =', fmt(SERVICE));
}
