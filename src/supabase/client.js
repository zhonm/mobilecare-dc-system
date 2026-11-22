import { createClient } from '@supabase/supabase-js';

const env = (typeof import.meta !== 'undefined' && import.meta.env) ? import.meta.env : (typeof process !== 'undefined' && process.env ? process.env : {});
const supabaseUrl = env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY || '';

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true
      }
    })
  : null;

/**
 * Purges any stale Supabase Auth token entries (e.g. sb-*-auth-token) from
 * browser storage so expired/revoked refresh tokens cannot stall pre-login
 * requests or trigger repeated 400 Invalid Refresh Token loops after auto-logout.
 */
export const clearStaleSupabaseAuthStorage = () => {
  if (typeof window === 'undefined') return;
  const isSupabaseAuthKey = (key) =>
    typeof key === 'string' && (/^sb-.*-auth-token/.test(key) || key === 'supabase.auth.token');

  for (const storage of [window.localStorage, window.sessionStorage]) {
    try {
      if (!storage) continue;
      const keysToRemove = [];
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (isSupabaseAuthKey(key)) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach((key) => storage.removeItem(key));
    } catch {
      // Ignore storage access restrictions
    }
  }
};

export const checkSupabaseConnection = async () => {
  if (!supabase) {
    return {
      connected: false,
      message: 'Supabase credentials not configured in .env file (Running in local/offline storage mode)'
    };
  }
  try {
    const { error } = await supabase.from('parts').select('count', { count: 'exact', head: true });
    if (error) throw error;
    return { connected: true, message: 'Connected to Supabase PostgreSQL' };
  } catch (err) {
    return { connected: false, message: err.message || 'Running in local/offline storage mode' };
  }
};
