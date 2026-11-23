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

let lastWarmupAt = 0;

/**
 * Sends lightweight, zero-egress health/HEAD pings to Supabase Auth and PostgREST
 * so a cold-starting Free-tier project wakes up while the user is typing their
 * credentials on the Login screen instead of timing out on Sign In.
 */
export const warmSupabaseConnection = () => {
  if (!isSupabaseConfigured || typeof fetch !== 'function') return;
  const now = Date.now();
  if (now - lastWarmupAt < 30000) return;
  lastWarmupAt = now;

  const base = supabaseUrl.replace(/\/+$/, '');
  const headers = { apikey: supabaseAnonKey };

  const ping = (url, method = 'GET') => {
    try {
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), 10000) : null;
      fetch(url, {
        method,
        headers,
        signal: controller?.signal
      })
        .catch(() => {})
        .finally(() => {
          if (timer) clearTimeout(timer);
        });
    } catch {
      // Non-blocking best-effort warmup
    }
  };

  ping(`${base}/auth/v1/health`, 'GET');
  ping(`${base}/rest/v1/`, 'HEAD');
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
