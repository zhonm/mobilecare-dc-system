const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const EXPECTED_ACTION = 'login';

/**
 * Extract the client IP address from Vercel / proxy request headers.
 * @param {import('http').IncomingMessage} req
 * @returns {string}
 */
function getClientIp(req) {
  const forwarded = req.headers?.['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  const realIp = req.headers?.['x-real-ip'];
  if (typeof realIp === 'string' && realIp.length > 0) {
    return realIp.trim();
  }
  return req.socket?.remoteAddress || '';
}

/**
 * Parse the Turnstile token from the incoming request body.
 * Supports both JSON `{ token }` and form/JSON `{ "cf-turnstile-response": ... }`.
 * @param {any} body
 * @returns {string}
 */
function extractToken(body) {
  let parsed = body;
  if (typeof body === 'string') {
    try {
      parsed = JSON.parse(body);
    } catch {
      return '';
    }
  }
  if (!parsed || typeof parsed !== 'object') {
    return '';
  }
  const candidate = parsed.token ?? parsed['cf-turnstile-response'];
  return typeof candidate === 'string' ? candidate : '';
}

/**
 * Vercel Serverless Function for server-side Cloudflare Turnstile siteverify.
 * Validates token, expected action ("login"), and approved frontend hostnames.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'method_not_allowed' });
  }

  const secret = process.env.TURNSTILE_SECRET || '';
  const expectedHostnames = new Set(
    (process.env.TURNSTILE_HOSTNAMES ?? '')
      .split(',')
      .map((hostname) => hostname.trim())
      .filter(Boolean)
  );

  const token = extractToken(req.body);

  if (
    !secret ||
    typeof token !== 'string' ||
    token.length === 0 ||
    token.length > 2048 ||
    expectedHostnames.size === 0
  ) {
    return res.status(403).json({ success: false, error: 'forbidden' });
  }

  const params = new URLSearchParams({
    secret,
    response: token
  });

  const clientIp = getClientIp(req);
  if (clientIp) {
    params.set('remoteip', clientIp);
  }

  let result;
  try {
    const response = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(10_000),
      body: params
    });
    if (!response.ok) {
      throw new Error(`siteverify ${response.status}`);
    }
    result = await response.json();
  } catch {
    return res.status(403).json({ success: false, error: 'forbidden' });
  }

  if (
    !result?.success ||
    result.action !== EXPECTED_ACTION ||
    !expectedHostnames.has(result.hostname)
  ) {
    return res.status(403).json({ success: false, error: 'forbidden' });
  }

  return res.status(200).json({ success: true });
}
