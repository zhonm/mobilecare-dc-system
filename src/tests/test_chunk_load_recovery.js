import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isModuleLoadError,
  handleChunkLoadError,
  lazyWithRetry,
  CHUNK_RELOAD_GUARD_KEY,
  CHUNK_RELOAD_COOLDOWN_MS
} from '../utils/chunkLoadRecovery.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../..');

console.log('====================================================');
console.log('TEST SUITE: Chunk Load Error Recovery & Safari Module Import Fix');
console.log('====================================================\n');

// ----------------------------------------------------
// 1. Module Error Pattern Detection Across Browsers
// ----------------------------------------------------
console.log('--- 1. Module Error Pattern Detection ---');

// Safari / WebKit native error
const safariError = new TypeError('Importing a module script failed.');
assert.strictEqual(isModuleLoadError(safariError), true, 'Must detect Safari "Importing a module script failed."');

// Safari error without Error object (string)
assert.strictEqual(isModuleLoadError('Importing a module script failed.'), true, 'Must detect Safari string error');

// Chromium / Edge native error
const chromeError = new TypeError('Failed to fetch dynamically imported module: https://mobilecare-dc-system.vercel.app/assets/ScanInReceiving-CwP_XYZ.js');
assert.strictEqual(isModuleLoadError(chromeError), true, 'Must detect Chromium "Failed to fetch dynamically imported module"');

// Firefox error
const firefoxError = new TypeError('error loading dynamically imported module');
assert.strictEqual(isModuleLoadError(firefoxError), true, 'Must detect Firefox dynamic module error');

// Standard ChunkLoadError
const chunkLoadError = new Error('ChunkLoadError: Loading chunk 45 failed');
assert.strictEqual(isModuleLoadError(chunkLoadError), true, 'Must detect ChunkLoadError');

// HTML fallback rewrite error (404 returning index.html)
const htmlMimeError = new TypeError('Failed to load module script: Expected a JavaScript module script but the server responded with a MIME type of "text/html".');
assert.strictEqual(isModuleLoadError(htmlMimeError), true, 'Must detect MIME type text/html mismatch error');

// Vite preload error
const vitePreloadError = new Error('vite:preloadError');
assert.strictEqual(isModuleLoadError(vitePreloadError), true, 'Must detect Vite preload error');

// Non-chunk errors MUST NOT be flagged as chunk errors
const syntaxErr = new SyntaxError('Unexpected identifier foo');
assert.strictEqual(isModuleLoadError(syntaxErr), false, 'Normal syntax error must NOT be flagged as module load error');

const nullRefErr = new TypeError("Cannot read properties of undefined (reading 'map')");
assert.strictEqual(isModuleLoadError(nullRefErr), false, 'Null reference error must NOT be flagged as module load error');

console.log('  ✓ PASS: Successfully detects Safari, Chrome, Firefox, and Vite module loading errors while ignoring unrelated runtime errors');

// ----------------------------------------------------
// 2. Constants & Storage Key Integrity
// ----------------------------------------------------
console.log('\n--- 2. Constants & Loop Cooldown Protection ---');
assert.strictEqual(CHUNK_RELOAD_GUARD_KEY, 'mdc_chunk_reload_guard', 'Storage guard key is configured');
assert.strictEqual(CHUNK_RELOAD_COOLDOWN_MS, 15000, 'Cooldown is set to 15 seconds (15,000 ms)');
console.log('  ✓ PASS: Cooldown loop guard constants verified');

// ----------------------------------------------------
// 3. Auto-Reload Execution & Loop Throttling
// ----------------------------------------------------
console.log('\n--- 3. handleChunkLoadError Loop Guard & Auto-Reload ---');
let reloadCount = 0;
const mockSessionStorage = new Map();

global.window = {
  location: {
    reload: () => { reloadCount++; }
  }
};
global.sessionStorage = {
  getItem: (key) => mockSessionStorage.get(key) || null,
  setItem: (key, val) => mockSessionStorage.set(key, String(val)),
  removeItem: (key) => mockSessionStorage.delete(key)
};

// First call: should reload
const firstResult = handleChunkLoadError(safariError);
assert.strictEqual(firstResult, true, 'First chunk error triggers reload');
assert.strictEqual(reloadCount, 1, 'Reload was executed once');
assert.ok(mockSessionStorage.get(CHUNK_RELOAD_GUARD_KEY), 'Session storage key was written');

// Immediate second call: should be blocked by cooldown
const secondResult = handleChunkLoadError(safariError);
assert.strictEqual(secondResult, false, 'Immediate second call is suppressed to prevent loop');
assert.strictEqual(reloadCount, 1, 'Reload count remains 1');

// After cooldown passes: should allow reload again
const expiredTime = Date.now() - CHUNK_RELOAD_COOLDOWN_MS - 5000;
mockSessionStorage.set(CHUNK_RELOAD_GUARD_KEY, String(expiredTime));
const thirdResult = handleChunkLoadError(safariError);
assert.strictEqual(thirdResult, true, 'Call after cooldown expiration allows reload');
assert.strictEqual(reloadCount, 2, 'Reload count incremented to 2');

console.log('  ✓ PASS: handleChunkLoadError safely triggers reload while preventing rapid infinite reload loops');

// ----------------------------------------------------
// 4. lazyWithRetry Resilient Loader Verification
// ----------------------------------------------------
console.log('\n--- 4. lazyWithRetry Resilient Loader ---');

// 4a. Immediate success
let test1Resolved = false;
await lazyWithRetry(() => Promise.resolve({ default: 'MyComponent' }))
  .then((res) => {
    assert.strictEqual(res.default, 'MyComponent');
    test1Resolved = true;
  });
assert.ok(test1Resolved, 'Immediate success promise resolves correctly');

// 4b. Non-chunk errors fail immediately without retry
let nonChunkAttempts = 0;
let caughtNonChunk = false;
try {
  await lazyWithRetry(() => {
    nonChunkAttempts++;
    return Promise.reject(new Error('Normal application error'));
  }, 3, 10);
} catch (err) {
  caughtNonChunk = true;
  assert.strictEqual(err.message, 'Normal application error');
}
assert.strictEqual(nonChunkAttempts, 1, 'Non-chunk error must not trigger retries');
assert.ok(caughtNonChunk, 'Non-chunk error was propagated');

// 4c. Transient failure then success on retry (e.g. waking from sleep)
let retryAttempts = 0;
const transientResult = await lazyWithRetry(() => {
  retryAttempts++;
  if (retryAttempts === 1) {
    return Promise.reject(safariError);
  }
  return Promise.resolve({ default: 'RecoveredComponent' });
}, 2, 20);
assert.strictEqual(retryAttempts, 2, 'Transient failure retried once');
assert.strictEqual(transientResult.default, 'RecoveredComponent', 'Succeeded after retry');

console.log('  ✓ PASS: lazyWithRetry handles instant resolution, avoids retrying non-chunk errors, and rescues transient connection drops');

// ----------------------------------------------------
// 5. Codebase Wiring Verification: App.jsx & main.jsx
// ----------------------------------------------------
console.log('\n--- 5. Codebase Integration Verification ---');

const appJsxCode = fs.readFileSync(path.join(projectRoot, 'src/App.jsx'), 'utf-8');
const mainJsxCode = fs.readFileSync(path.join(projectRoot, 'src/main.jsx'), 'utf-8');

// 5a. App.jsx imports and wraps lazy with lazyWithRetry
assert.ok(appJsxCode.includes("import { lazyWithRetry, isModuleLoadError, handleChunkLoadError, CHUNK_RELOAD_GUARD_KEY } from './utils/chunkLoadRecovery';"), 'App.jsx imports chunk recovery utilities');
assert.ok(appJsxCode.includes('const lazy = (importer) => reactLazy(() => lazyWithRetry(importer));'), 'App.jsx wraps lazy with lazyWithRetry');

// 5b. App.jsx ErrorBoundary auto-recovery
assert.ok(appJsxCode.includes('if (isModuleLoadError(error)) {'), 'ErrorBoundary checks isModuleLoadError');
assert.ok(appJsxCode.includes('handleChunkLoadError(error);'), 'ErrorBoundary invokes handleChunkLoadError');
assert.ok(appJsxCode.includes('isChunkError ? \'System Update Available\' : \'Something went wrong\''), 'ErrorBoundary displays user-friendly recovery title');
assert.ok(appJsxCode.includes('isChunkError ? \'Update & Reload Application\' : \'Reload Application\''), 'ErrorBoundary displays clear recovery action');

// 5c. main.jsx global listeners
assert.ok(mainJsxCode.includes("import { setupChunkLoadErrorListeners } from './utils/chunkLoadRecovery'"), 'main.jsx imports setupChunkLoadErrorListeners');
assert.ok(mainJsxCode.includes('setupChunkLoadErrorListeners()'), 'main.jsx invokes setupChunkLoadErrorListeners()');

console.log('  ✓ PASS: App.jsx and main.jsx properly wired with multi-layered auto-recovery and user-facing resiliency');

console.log('\n====================================================');
console.log('ALL CHUNK LOAD RECOVERY TESTS PASSED (100%)');
console.log('====================================================\n');
