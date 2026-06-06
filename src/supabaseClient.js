import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in environment.');
}

// Privileged client — bypasses RLS. Use ONLY for background tasks and session management.
export const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

// Default client — uses anon key if configured (recommended with RLS policies),
// otherwise falls back to service key. Set SUPABASE_ANON_KEY for stricter access.
const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY ?? SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false } }
);

export default supabase;
