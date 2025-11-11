// /app/supabase.js
import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL) throw new Error('[Supabase] FALTA SUPABASE_URL');
if (!SERVICE) { console.error('[Supabase] FALTA SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }

// Cliente público (no se usa para inserts del backend)
export const supabase = createClient(URL, ANON, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Cliente admin (este es el que DEBE usarse en el backend)
export const supabaseAdmin = createClient(URL, SERVICE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

export function logSupabaseKeys() {
  const fmt = k => (k ? `${k.slice(0, 8)}… (len:${k.length})` : 'MISSING');
  console.log('[Supabase] URL ok, anon =', fmt(ANON), ' service =', fmt(SERVICE));
}
