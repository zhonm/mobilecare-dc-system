/**
 * ============================================================================
 * TEST SUITE: Server-Side Cloudflare Turnstile Siteverify Integration
 * File: src/tests/test_turnstile_siteverify.js
 * ============================================================================
 */

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import handler from '../../api/verify-turnstile.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function createMockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(key, val) {
      this.headers[key] = val;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
  return res;
}

async function runTests() {
  console.log('====================================================================');
  console.log('TEST SUITE: Server-Side Cloudflare Turnstile Siteverify');
  console.log('====================================================================');

  const originalFetch = globalThis.fetch;
  const originalSecret = process.env.TURNSTILE_SECRET;
  const originalHostnames = process.env.TURNSTILE_HOSTNAMES;

  try {
    // 1. Rejects non-POST
    {
      const req = { method: 'GET', headers: {} };
      const res = createMockRes();
      await handler(req, res);
      assert.strictEqual(res.statusCode, 405);
      assert.strictEqual(res.headers.Allow, 'POST');
      console.log('  ✓ PASS: Rejects non-POST requests with 405');
    }

    // 2. Rejects when TURNSTILE_SECRET or TURNSTILE_HOSTNAMES is missing
    {
      delete process.env.TURNSTILE_SECRET;
      process.env.TURNSTILE_HOSTNAMES = 'mobilecare-dc-system.vercel.app';
      const req = { method: 'POST', headers: {}, body: { token: 'valid-token' } };
      const res = createMockRes();
      await handler(req, res);
      assert.strictEqual(res.statusCode, 403);

      process.env.TURNSTILE_SECRET = 'test-secret';
      delete process.env.TURNSTILE_HOSTNAMES;
      const res2 = createMockRes();
      await handler(req, res2);
      assert.strictEqual(res2.statusCode, 403);
      console.log('  ✓ PASS: Fails closed (403) when TURNSTILE_SECRET or TURNSTILE_HOSTNAMES is unset');
    }

    // 3. Rejects empty or oversized tokens
    {
      process.env.TURNSTILE_SECRET = 'test-secret';
      process.env.TURNSTILE_HOSTNAMES = 'mobilecare-dc-system.vercel.app';

      for (const badToken of ['', null, undefined, 'x'.repeat(2049)]) {
        const req = { method: 'POST', headers: {}, body: { token: badToken } };
        const res = createMockRes();
        await handler(req, res);
        assert.strictEqual(res.statusCode, 403);
      }
      console.log('  ✓ PASS: Rejects missing, empty, or oversized tokens with 403');
    }

    // 4. Rejects failed siteverify, action mismatch, and hostname mismatch
    {
      process.env.TURNSTILE_SECRET = 'test-secret';
      process.env.TURNSTILE_HOSTNAMES = 'mobilecare-dc-system.vercel.app';

      const failureCases = [
        { success: false, action: 'login', hostname: 'mobilecare-dc-system.vercel.app' },
        { success: true, action: 'signup', hostname: 'mobilecare-dc-system.vercel.app' },
        { success: true, action: 'login', hostname: 'localhost' },
        { success: true, action: 'login', hostname: 'evil.example.com' }
      ];

      for (const mockReply of failureCases) {
        globalThis.fetch = async () => ({
          ok: true,
          json: async () => mockReply
        });
        const req = {
          method: 'POST',
          headers: { 'x-forwarded-for': '203.0.113.10' },
          body: { token: 'sample-token' }
        };
        const res = createMockRes();
        await handler(req, res);
        assert.strictEqual(res.statusCode, 403);
        assert.deepStrictEqual(res.body, { success: false, error: 'forbidden' });
      }
      console.log('  ✓ PASS: Rejects siteverify failure, action mismatch, and unapproved hostnames');
    }

    // 5. Accepts valid siteverify response and sends canonical form-urlencoded payload
    {
      process.env.TURNSTILE_SECRET = 'test-secret';
      process.env.TURNSTILE_HOSTNAMES = 'mobilecare-dc-system.vercel.app';

      let capturedUrl = '';
      let capturedOptions = null;

      globalThis.fetch = async (url, options) => {
        capturedUrl = url;
        capturedOptions = options;
        return {
          ok: true,
          json: async () => ({
            success: true,
            action: 'login',
            hostname: 'mobilecare-dc-system.vercel.app'
          })
        };
      };

      const req = {
        method: 'POST',
        headers: { 'x-forwarded-for': '198.51.100.42, 10.0.0.1' },
        body: { token: 'valid-turnstile-token' }
      };
      const res = createMockRes();
      await handler(req, res);

      assert.strictEqual(res.statusCode, 200);
      assert.deepStrictEqual(res.body, { success: true });
      assert.strictEqual(capturedUrl, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
      assert.strictEqual(capturedOptions.method, 'POST');
      assert.strictEqual(capturedOptions.headers['Content-Type'], 'application/x-www-form-urlencoded');

      const bodyParams = new URLSearchParams(capturedOptions.body.toString());
      assert.strictEqual(bodyParams.get('secret'), 'test-secret');
      assert.strictEqual(bodyParams.get('response'), 'valid-turnstile-token');
      assert.strictEqual(bodyParams.get('remoteip'), '198.51.100.42');
      console.log('  ✓ PASS: Accepts valid siteverify response and sends canonical form-urlencoded payload');
    }

    // 6. Verify frontend + auth wiring
    {
      const loginContent = fs.readFileSync(path.resolve(__dirname, '../components/Login.jsx'), 'utf8');
      const useAuthContent = fs.readFileSync(path.resolve(__dirname, '../context/useAuth.js'), 'utf8');

      const signInSection = useAuthContent.slice(useAuthContent.indexOf('const signInWithPassword ='));
      assert(loginContent.includes("action: 'login'"), 'Login.jsx must set Turnstile action to login');
      assert(signInSection.includes('/api/verify-turnstile'), 'useAuth.js signInWithPassword must call /api/verify-turnstile');
      assert(
        signInSection.indexOf('/api/verify-turnstile') < signInSection.indexOf('verify_login_credentials'),
        'useAuth.js must verify Turnstile before verify_login_credentials'
      );
      console.log('  ✓ PASS: Login.jsx and useAuth.js wire action and server-side gate before credential checks');
    }

    console.log('\nALL TURNSTILE SITEVERIFY TESTS PASSED (100%)\n');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalSecret === undefined) delete process.env.TURNSTILE_SECRET;
    else process.env.TURNSTILE_SECRET = originalSecret;
    if (originalHostnames === undefined) delete process.env.TURNSTILE_HOSTNAMES;
    else process.env.TURNSTILE_HOSTNAMES = originalHostnames;
  }
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
