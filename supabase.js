import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const anon = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;
const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url) {
  throw new Error('Missing SUPABASE_URL environment variable');
}

if (!svc) {
  throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY environment variable');
}

export const supabase = createClient(url, anon, {
  auth: { persistSession: false, autoRefreshToken: false }
});

export const supabaseAdmin = createClient(url, svc);
