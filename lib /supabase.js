// lib/supabase.js
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const anon = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;
const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !svc) {
  console.error('Missing Supabase environment variables');
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
}

export const supabase = createClient(url, anon, {
  auth: { persistSession: false, autoRefreshToken: false }
});

export const supabaseAdmin = createClient(url, svc);
