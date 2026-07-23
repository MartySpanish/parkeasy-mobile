import { createClient } from '@supabase/supabase-js';

// These come from your Supabase project (Settings → API). They are injected at
// build time via Vite env vars (and GitHub Actions secrets in production).
// The anon key is safe to expose in the browser — it only allows the access
// you grant via Row Level Security in Supabase.
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// When the keys aren't set yet, the app gracefully falls back to the simple
// "remember my name on this device" flow instead of crashing.
export const isSupabaseEnabled = Boolean(url && anonKey);

export const supabase = isSupabaseEnabled
  ? createClient(url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;

// Turn a Supabase auth session into the lightweight user object the app uses.
export const sessionToUser = (session, fallbackName) => {
  const u = session?.user;
  if (!u) return null;
  const name =
    u.user_metadata?.name ||
    fallbackName ||
    (u.email ? u.email.split('@')[0] : 'Member');
  return {
    id: u.id,
    email: u.email,
    name,
    joined: u.created_at || new Date().toISOString(),
    spotsAdded: 0,
  };
};
