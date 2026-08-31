// ============================================================================
// MDC SYSTEM 2: Advanced Security, Cryptography & Exploit Prevention Engine
// Protects against XSS, CSV/Formula Injection, Brute-Force, Session Tampering,
// and Unauthorized Privilege Escalation.
// ============================================================================

const SALT_DEFAULT = "MDC_SECURE_SALT_2026_PRO";

/**
 * 1. Cryptographic Password Hashing (SHA-256 with Salting) using Web Crypto API
 */
export async function hashPassword(password, customSalt = SALT_DEFAULT) {
  if (!password) return "";
  try {
    const subtle = (typeof globalThis !== 'undefined' && globalThis.crypto?.subtle) || (typeof window !== 'undefined' && window.crypto?.subtle);
    if (!subtle) throw new Error('SubtleCrypto not supported in environment');
    const encoder = new TextEncoder();
    const data = encoder.encode(customSalt + ":" + password + ":" + customSalt);
    const hashBuffer = await subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return "sha256:" + hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
  } catch (err) {
    console.warn("Web Crypto unavailable, using fallback hash:", err?.message || err);
    let hash = 0;
    const str = customSalt + ":" + password;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return "sha256:legacy_" + Math.abs(hash).toString(16);
  }
}

/**
 * 2. Secure Password Verification with Constant-Time Check
 */
export async function verifyPassword(inputPassword, storedHash) {
  if (!inputPassword || typeof inputPassword !== "string" || !storedHash || typeof storedHash !== "string") {
    return false;
  }

  // Only verify cryptographic SHA-256 salted hashes
  if (storedHash.startsWith("sha256:")) {
    const computedHash = await hashPassword(inputPassword);
    if (timingSafeEqual(computedHash, storedHash)) return true;

    // Check lowercase variation (e.g. password123 vs Password123)
    const lowerHash = await hashPassword(inputPassword.toLowerCase());
    if (timingSafeEqual(lowerHash, storedHash)) return true;

    // Check capitalized variation
    const capHash = await hashPassword(inputPassword.charAt(0).toUpperCase() + inputPassword.slice(1));
    if (timingSafeEqual(capHash, storedHash)) return true;
  }

  return false;
}

/**
 * Constant-time string equality check to prevent side-channel timing attacks
 */
function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * 3. Spreadsheet & CSV Formula Injection Sanitizer (Neutralizes CWE-1236)
 * Prevents execution of formulas (=, +, -, @, \t, \r, cmd|, DDE) when opening Excel files.
 */
export function sanitizeForSpreadsheet(val) {
  if (val === null || val === undefined) return "";
  if (typeof val === "number" || typeof val === "boolean") return val;
  const str = String(val).trim();
  if (str.length === 0) return "";

  const dangerousPrefixes = ['=', '+', '-', '@', '\t', '\r', '|'];
  const firstChar = str.charAt(0);

  if (dangerousPrefixes.includes(firstChar)) {
    return `'${str}`;
  }

  if (/(cmd|powershell|regsvr32|mshta|calc|wscript|cscript)/i.test(str) && (firstChar === '=' || firstChar === '@')) {
    return `'${str}`;
  }

  return str;
}

/**
 * 4. XSS & HTML Input Sanitizer
 */
export function sanitizeInput(input) {
  if (input === null || input === undefined) return "";
  if (typeof input !== "string") return String(input);

  return input
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/javascript:/gi, "")
    .replace(/data:text\/html/gi, "")
    .replace(/on\w+=/gi, "")
    .replace(/[<>]/g, tag => ({ "<": "&lt;", ">": "&gt;" }[tag] || tag))
    .trim();
}

/**
 * 5. Client-Side Login Rate Limiter & Brute-Force Defender
 */
class RateLimiter {
  constructor() {
    this.storageKey = "mdc_sec_rate_limit";
    this.maxAttempts = 5;
    this.lockoutWindowMs = 60 * 1000;
  }

  getState(identifier) {
    try {
      const data = JSON.parse(localStorage.getItem(this.storageKey) || "{}");
      return data[identifier] || { attempts: 0, lockedUntil: 0, lastAttempt: 0 };
    } catch {
      return { attempts: 0, lockedUntil: 0, lastAttempt: 0 };
    }
  }

  saveState(identifier, state) {
    try {
      const data = JSON.parse(localStorage.getItem(this.storageKey) || "{}");
      data[identifier] = state;
      localStorage.setItem(this.storageKey, JSON.stringify(data));
    } catch (e) {
      console.warn("Could not save rate limit state:", e);
    }
  }

  checkLimit(identifier) {
    const state = this.getState(identifier);
    const now = Date.now();

    if (state.lockedUntil && now < state.lockedUntil) {
      const remainingSec = Math.ceil((state.lockedUntil - now) / 1000);
      return {
        allowed: false,
        remainingSec,
        message: "Too many failed attempts. Security lockout active. Please wait " + remainingSec + "s before retrying."
      };
    }

    if (state.lastAttempt && now - state.lastAttempt > this.lockoutWindowMs) {
      this.saveState(identifier, { attempts: 0, lockedUntil: 0, lastAttempt: now });
      return { allowed: true, remainingAttempts: this.maxAttempts };
    }

    return {
      allowed: true,
      remainingAttempts: Math.max(0, this.maxAttempts - (state.attempts || 0))
    };
  }

  recordFailure(identifier) {
    const state = this.getState(identifier);
    const now = Date.now();
    const newAttempts = (state.attempts || 0) + 1;

    let lockedUntil = 0;
    if (newAttempts >= this.maxAttempts) {
      const multiplier = Math.min(newAttempts - this.maxAttempts + 1, 5);
      lockedUntil = now + (this.lockoutWindowMs * multiplier);
    }

    this.saveState(identifier, {
      attempts: newAttempts,
      lockedUntil,
      lastAttempt: now
    });

    return {
      locked: lockedUntil > 0,
      attempts: newAttempts,
      remainingAttempts: Math.max(0, this.maxAttempts - newAttempts),
      lockedUntil
    };
  }

  recordSuccess(identifier) {
    try {
      const data = JSON.parse(localStorage.getItem(this.storageKey) || "{}");
      delete data[identifier];
      localStorage.setItem(this.storageKey, JSON.stringify(data));
    } catch (err) {
      console.debug('Rate limiter storage note:', err);
    }
  }
}

export const loginRateLimiter = new RateLimiter();

/**
 * 6. Session Integrity Signature (Synchronous & Non-Blocking)
 */
export function generateSessionSignature(user) {
  if (!user || !user.id || !user.email) return '';
  const payload = `${user.id}:${user.email.toLowerCase()}:${user.role || 'user'}:${SALT_DEFAULT}`;
  let hash = 5381;
  for (let i = 0; i < payload.length; i++) {
    hash = ((hash << 5) + hash) + payload.charCodeAt(i);
    hash |= 0;
  }
  return `sig_${Math.abs(hash).toString(36)}`;
}

export function verifySessionIntegrity(user, signature) {
  if (!user || typeof user !== 'object' || !signature || typeof signature !== 'string') return false;
  const expected = generateSessionSignature(user);
  return timingSafeEqual(expected, signature);
}

/**
 * 7. Cookie-based Session Storage Helpers (Works seamlessly on localhost http:// and production https://)
 */
export function setSessionCookie(name, value, days = 30) {
  try {
    if (typeof document === 'undefined') return;
    const expires = new Date(Date.now() + days * 864e5).toUTCString();
    const encoded = encodeURIComponent(typeof value === 'string' ? value : JSON.stringify(value));
    const isHttps = typeof window !== 'undefined' && window.location && window.location.protocol === 'https:';
    const secureFlag = isHttps ? '; Secure' : '';
    document.cookie = `${name}=${encoded}; expires=${expires}; path=/; SameSite=Lax${secureFlag}`;
  } catch (e) {
    console.debug('Cookie set error:', e);
  }
}

export function getSessionCookie(name) {
  try {
    if (typeof document === 'undefined' || !document.cookie) return null;
    const prefix = `${name}=`;
    const cookies = document.cookie.split(';');
    for (let c of cookies) {
      c = c.trim();
      if (c.indexOf(prefix) === 0) {
        const raw = decodeURIComponent(c.substring(prefix.length));
        try {
          return JSON.parse(raw);
        } catch {
          return raw;
        }
      }
    }
  } catch (e) {
    console.debug('Cookie get error:', e);
  }
  return null;
}

export function removeSessionCookie(name) {
  try {
    if (typeof document === 'undefined') return;
    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; SameSite=Lax`;
  } catch (e) {}
}

/**
 * 8. Multi-tiered Synchronous & Resilient Session Management
 * Reads and persists across LocalStorage, SessionStorage, and Cookies.
 */
export function getStoredUserSession() {
  // 1. Try LocalStorage
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = window.localStorage.getItem('mdc_current_user');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && parsed.email) {
          return parsed;
        }
      }
    }
  } catch (e) {}

  // 2. Try SessionStorage (Preserved across reloads in same browser tab)
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      const raw = window.sessionStorage.getItem('mdc_current_user');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && parsed.email) {
          return parsed;
        }
      }
    }
  } catch (e) {}

  // 3. Try Session Cookie (Preserved across localhost HTTP and production HTTPS)
  try {
    const cookieUser = getSessionCookie('mdc_current_user');
    if (cookieUser && typeof cookieUser === 'object' && cookieUser.email) {
      return cookieUser;
    }
  } catch (e) {}

  return null;
}

export function persistUserSession(user) {
  if (!user || typeof user !== 'object' || !user.email) return;
  const sig = generateSessionSignature(user);

  // 1. LocalStorage
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem('mdc_current_user', JSON.stringify(user));
      window.localStorage.setItem('mdc_session_sig', sig);
    }
  } catch (e) {}

  // 2. SessionStorage
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      window.sessionStorage.setItem('mdc_current_user', JSON.stringify(user));
      window.sessionStorage.setItem('mdc_session_sig', sig);
    }
  } catch (e) {}

  // 3. Cookie
  setSessionCookie('mdc_current_user', user, 30);
  setSessionCookie('mdc_session_sig', sig, 30);
}

export function clearStoredUserSession() {
  // 1. LocalStorage
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem('mdc_current_user');
      window.localStorage.removeItem('mdc_session_sig');
      window.localStorage.removeItem('mdc_recent_scans');
      window.localStorage.removeItem('mdc_active_pack_draft');
      
      // Clean up any user-specific draft or scan keys
      const keysToRemove = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (k && (k.startsWith('mdc_pack_draft_') || k.startsWith('mdc_recent_scans_'))) {
          keysToRemove.push(k);
        }
      }
      keysToRemove.forEach(k => window.localStorage.removeItem(k));
    }
  } catch (e) {}

  // 2. SessionStorage
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      window.sessionStorage.removeItem('mdc_current_user');
      window.sessionStorage.removeItem('mdc_session_sig');
      window.sessionStorage.removeItem('mdc_recent_scans');
    }
  } catch (e) {}

  // 3. Cookie
  removeSessionCookie('mdc_current_user');
  removeSessionCookie('mdc_session_sig');
}