// supabase.js
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const anon = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anon) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY');
}

// Cliente público (respeta RLS)
export const supabase = createClient(url, anon, {
  auth: { persistSession: false, autoRefreshToken: false }
});

// Cliente ADMIN (omite RLS). Si falta la SERVICE ROLE, aviso.
export const supabaseAdmin = service
  ? createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } })
  : (() => {
      console.warn('⚠️  SUPABASE_SERVICE_ROLE_KEY no está seteada: las operaciones admin fallarán y verás errores RLS.');
      return createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
    })();
