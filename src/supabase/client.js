import { createClient } from '@supabase/supabase-js';
import { egressMonitor } from '../utils/egressMonitor.js';

const env = (typeof import.meta !== 'undefined' && import.meta.env) ? import.meta.env : (typeof process !== 'undefined' && process.env ? process.env : {});
const supabaseUrl = env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY || '';

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

// Custom tracked fetch to intercept and log egress bandwidth against Supabase Free-Tier limit
const trackedFetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : (input?.url || '');
  const method = init?.method || 'GET';

  // Calculate approximate outgoing request size (headers + body)
  let requestBytes = 0;
  if (init?.body) {
    try {
      if (typeof init.body === 'string') {
        requestBytes = typeof Blob !== 'undefined' 
          ? new Blob([init.body]).size 
          : (typeof Buffer !== 'undefined' ? Buffer.byteLength(init.body) : init.body.length);
      } else if (typeof Blob !== 'undefined' && init.body instanceof Blob) {
        requestBytes = init.body.size;
      } else if (init.body instanceof ArrayBuffer) {
        requestBytes = init.body.byteLength;
      }
    } catch (e) {
      requestBytes = 0;
    }
  }

  const response = await fetch(input, init);

  // Measure incoming response size (this is Supabase server egress bandwidth)
  try {
    let responseBytes = 0;
    const contentLength = response.headers.get('content-length');
    if (contentLength) {
      responseBytes = parseInt(contentLength, 10) || 0;
    } else {
      // If no Content-Length header, clone response and measure body blob
      const clone = response.clone();
      const blob = await clone.blob();
      responseBytes = blob.size;
    }

    egressMonitor.recordEgress({
      url,
      method,
      requestBytes,
      responseBytes,
      status: response.status
    });
  } catch (err) {
    // Non-blocking telemetry capture
  }

  return response;
};

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true
      },
      global: {
        fetch: trackedFetch
      }
    })
  : null;

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
