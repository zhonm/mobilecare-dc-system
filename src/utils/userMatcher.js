/**
 * Helper to normalize and match users across domain variations and aliases
 */
export const matchUserByEmail = (users, rawInputEmail) => {
  if (!rawInputEmail || !users || users.length === 0) return null;
  const input = rawInputEmail.trim().toLowerCase();

  // 1. Exact email match
  let matched = users.find(u => u.email && u.email.trim().toLowerCase() === input);
  if (matched) return matched;

  // 2. Extract local part and domain
  const [inputUser] = input.split('@');
  if (!inputUser) return null;

  const cleanInputUser = inputUser.replace(/[._-]/g, '');

  matched = users.find(u => {
    if (!u.email) return false;
    const [uUser] = u.email.trim().toLowerCase().split('@');
    const cleanUUser = (uUser || '').replace(/[._-]/g, '');

    if (inputUser === uUser || cleanInputUser === cleanUUser) return true;

    // Recognize name handles
    const isZhon = (cleanInputUser.includes('zhon') || cleanInputUser.includes('manaois')) && (cleanUUser.includes('zhon') || cleanUUser.includes('manaois'));
    const isJoshua = (cleanInputUser.includes('joshua') || cleanInputUser.includes('juvida')) && (cleanUUser.includes('joshua') || cleanUUser.includes('juvida'));

    return isZhon || isJoshua;
  });

  return matched || null;
};

export default matchUserByEmail;
