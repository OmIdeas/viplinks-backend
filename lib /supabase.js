// lib/supabase.js
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
// Usa ANON para cliente normal si te hace falta en otros módulos
const supabaseAnon = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;
export const supabase = createClient(supabaseUrl, supabaseAnon, {
  auth: { persistSession: false, autoRefreshToken: false }
});

// Admin (Service Role) para RPCs y lecturas de dashboard
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
export const supabaseAdmin = createClient(supabaseUrl, serviceRole);
