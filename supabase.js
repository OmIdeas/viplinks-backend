// /app/supabase.js (ESM) - VERSIÓN CORREGIDA
import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL) throw new Error('[Supabase] FALTA SUPABASE_URL');

// Cliente público (frontend)
export const supabase = createClient(URL, ANON, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Cliente admin (backend) - ✅ CORREGIDO
export const supabaseAdmin = createClient(
  URL,      // ✅ Usar URL (la variable definida arriba)
  SERVICE,  // ✅ Usar SERVICE (la variable definida arriba)
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// Log seguro (no imprime secretos)
export function logSupabaseKeys() {
  const fmt = (k) => (k ? `${k.slice(0, 8)}… (len:${k.length})` : 'MISSING');
  console.log('[Supabase] URL ok, anon =', fmt(ANON), ' service =', fmt(SERVICE));
}
