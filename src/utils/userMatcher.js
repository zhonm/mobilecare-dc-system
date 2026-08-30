/**
 * Helper to normalize and match users across domain variations and aliases.
 * Enforces internal company email domain verification.
 */

export const ALLOWED_COMPANY_DOMAINS = [
  'mobilecareph.com',
  'mobilecare.com.ph',
  'mobilecare.com'
];

/**
 * Validates whether an email belongs to an authorized internal corporate domain.
 */
export const isAllowedCompanyEmail = (email) => {
  if (!email || typeof email !== 'string') return false;
  const clean = email.trim().toLowerCase();
  const atIdx = clean.lastIndexOf('@');
  if (atIdx === -1) return false;
  const domain = clean.slice(atIdx + 1);
  return ALLOWED_COMPANY_DOMAINS.includes(domain);
};

export const matchUserByEmail = (users, rawInputEmail) => {
  if (!rawInputEmail || !users || users.length === 0) return null;
  const input = rawInputEmail.trim().toLowerCase();

  // Strict exact email match
  const matched = users.find(u => u.email && u.email.trim().toLowerCase() === input);
  return matched || null;
};

export default matchUserByEmail;
