/**
 * MDC SYSTEM: Chunk Load Error Recovery & Resilient Dynamic Imports
 *
 * Solves the issue: "Importing a module script failed." / "Failed to fetch dynamically imported module"
 * which occurs in Safari / Chromium when the site is left inactive for a long time.
 *
 * Root causes handled:
 * 1. New production deployment (Vercel) invalidates older chunk hashes, returning 404 for stale imports.
 * 2. Inactive background tab suspension and sleep/wake network reconnection lag in macOS/iOS Safari.
 * 3. Vite dev server restart or temporary dependency cache re-optimization on localhost.
 */

export const CHUNK_RELOAD_GUARD_KEY = 'mdc_chunk_reload_guard';
export const CHUNK_RELOAD_COOLDOWN_MS = 15000; // 15 seconds cooldown to prevent reload loops

/**
 * Checks whether an error or event is caused by a failed dynamic module / chunk script fetch.
 *
 * @param {Error|Event|string|any} error
 * @returns {boolean}
 */
export function isModuleLoadError(error) {
  if (!error) return false;

  const rawMessage = (
    typeof error === 'string'
      ? error
      : (error.message || error.reason?.message || error.name || error.detail?.message || '')
  ) + '';

  const patterns = [
    /importing a module script failed/i,          // Safari / WebKit native module error
    /failed to fetch dynamically imported module/i, // Chromium / Edge native module error
    /error loading dynamically imported module/i,  // Firefox native module error
    /chunkloaderror/i,                            // Webpack / Rollup chunk error
    /loading chunk .* failed/i,                   // Standard chunk load failure
    /failed to resolve module specifier/i,        // Module resolution error
    /mime type of ["']?text\/html["']?/i,         // Server returned SPA index.html 404 fallback instead of JS
    /unexpected token '<'/i,                      // Executed HTML as JavaScript from 404 rewrite
    /vite:preloaderror/i                          // Vite preload error identifier
  ];

  return patterns.some(pattern => pattern.test(rawMessage));
}

/**
 * Automatically triggers a reload to fetch the latest application bundle assets
 * when a stale chunk / module import error is detected.
 *
 * Protected with a 15-second cooldown via sessionStorage to prevent infinite reload loops
 * if the user's device is completely offline.
 *
 * @param {any} error
 * @returns {boolean} true if a page reload was initiated; false if suppressed by cooldown
 */
export function handleChunkLoadError(error) {
  if (typeof window === 'undefined') return false;

  console.warn('[ChunkLoadRecovery] Dynamic module script import failure detected:', error);

  try {
    const raw = sessionStorage.getItem(CHUNK_RELOAD_GUARD_KEY);
    const lastReload = raw ? parseInt(raw, 10) : 0;
    const now = Date.now();

    if (!lastReload || (now - lastReload) > CHUNK_RELOAD_COOLDOWN_MS) {
      sessionStorage.setItem(CHUNK_RELOAD_GUARD_KEY, String(now));
      console.info('[ChunkLoadRecovery] Synchronizing with latest version: refreshing application...');
      window.location.reload();
      return true;
    } else {
      console.warn('[ChunkLoadRecovery] Auto-reload suppressed by 15s loop guard.');
      return false;
    }
  } catch (err) {
    console.error('[ChunkLoadRecovery] sessionStorage access failed, forcing single reload:', err);
    window.location.reload();
    return true;
  }
}

/**
 * Resilient wrapper around dynamic import() that automatically retries upon
 * transient sleep/wake reconnection drops, and triggers a clean reload if the chunk is stale.
 *
 * @param {() => Promise<any>} importer Function executing import(...)
 * @param {number} [retries=2] Number of retries before invoking reload
 * @param {number} [delayMs=1000] Delay between retries in milliseconds
 * @returns {Promise<any>}
 */
export function lazyWithRetry(importer, retries = 2, delayMs = 1000) {
  return new Promise((resolve, reject) => {
    function attempt(remainingRetries) {
      importer()
        .then((module) => {
          // On successful load, clear the reload guard so subsequent updates can reload cleanly
          try {
            sessionStorage.removeItem(CHUNK_RELOAD_GUARD_KEY);
          } catch {}
          resolve(module);
        })
        .catch((error) => {
          if (!isModuleLoadError(error)) {
            // Non-chunk runtime errors should bubble up immediately
            return reject(error);
          }

          if (remainingRetries > 0) {
            // Potential sleep-wake or temporary network lag: wait and retry
            setTimeout(() => {
              attempt(remainingRetries - 1);
            }, delayMs);
          } else {
            // Exhausted retries: chunk has likely been replaced by a new deployment
            const reloaded = handleChunkLoadError(error);
            if (!reloaded) {
              // Reload was already performed within cooldown; forward to ErrorBoundary
              reject(error);
            }
          }
        });
    }

    attempt(retries);
  });
}

/**
 * Registers global window listeners for Vite dynamic import preload errors
 * and unhandled module script promise rejections.
 */
export function setupChunkLoadErrorListeners() {
  if (typeof window === 'undefined') return;

  // 1. Vite's native preload error event
  window.addEventListener('vite:preloadError', (event) => {
    console.warn('[ChunkLoadRecovery] vite:preloadError event intercepted:', event);
    if (typeof event.preventDefault === 'function') {
      event.preventDefault();
    }
    handleChunkLoadError(event.payload || event);
  });

  // 2. Global unhandled promise rejections (catches Safari's "Importing a module script failed.")
  window.addEventListener('unhandledrejection', (event) => {
    if (isModuleLoadError(event.reason)) {
      console.warn('[ChunkLoadRecovery] Global unhandledrejection module script failure caught:', event.reason);
      if (typeof event.preventDefault === 'function') {
        event.preventDefault();
      }
      handleChunkLoadError(event.reason);
    }
  });
}
