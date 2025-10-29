// supabase.js
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL           = process.env.SUPABASE_URL;
const SUPABASE_ANON_OR_KEY   = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;
const SUPABASE_SERVICE_ROLE  = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL) throw new Error('Missing SUPABASE_URL');
// Los siguientes pueden no estar en dev; solo avisamos si faltan
if (!SUPABASE_ANON_OR_KEY)   console.warn('[supabase] Missing SUPABASE_ANON_KEY / SUPABASE_KEY');
if (!SUPABASE_SERVICE_ROLE)  console.warn('[supabase] Missing SUPABASE_SERVICE_ROLE_KEY');

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_OR_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

export const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false }
});
