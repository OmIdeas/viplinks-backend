// supabase.js
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;

// Cliente público (ANON) – solo para operaciones sin privilegios
const anon = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;
export const supabase = createClient(url, anon, {
  auth: { persistSession: false, autoRefreshToken: false }
});

// Cliente admin (SERVICE ROLE) – salta RLS en el servidor
const service = process.env.SUPABASE_SERVICE_ROLE_KEY; // ⚠️ ESTE debe existir en Railway
export const supabaseAdmin = createClient(url, service, {
  auth: { persistSession: false, autoRefreshToken: false }
});

export const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});
