import { useState, useEffect } from 'react';
import { supabase } from '../supabase/client';
import { hashPassword, verifyPassword, generateSessionSignature, verifySessionIntegrity } from '../utils/security';
import { isAllowedCompanyEmail, matchUserByEmail } from '../utils/userMatcher';
import { ROLE_PRESETS, getDefaultRolePosition } from '../constants/roles';
import { barcodeAudio } from '../utils/barcodeAudio';

export function useAuth({
  usersList,
  setUsersList,
  showToast,
  hydrateFromSupabase,
  setActiveTab
}) {
  const [currentUser, setCurrentUser] = useState(() => {
    try {
      const savedUser = localStorage.getItem('mdc_current_user');
      const savedSig = localStorage.getItem('mdc_session_sig');
      if (savedUser && savedSig) {
        const parsed = JSON.parse(savedUser);
        if (verifySessionIntegrity(parsed, savedSig)) {
          return parsed;
        }
        localStorage.removeItem('mdc_current_user');
        localStorage.removeItem('mdc_session_sig');
      }
    } catch (e) {
      console.warn('Error loading mdc_current_user:', e);
    }
    return null;
  });

  const [pendingFirstTimeUser, setPendingFirstTimeUser] = useState(null);

  // Sync currentUser session signature
  useEffect(() => {
    if (currentUser) {
      try {
        localStorage.setItem('mdc_current_user', JSON.stringify(currentUser));
        localStorage.setItem('mdc_session_sig', generateSessionSignature(currentUser));
      } catch (e) {
        console.warn('Could not persist currentUser session:', e);
      }
    } else {
      try {
        localStorage.removeItem('mdc_current_user');
        localStorage.removeItem('mdc_session_sig');
      } catch (e) {
        console.warn('Could not remove currentUser session:', e);
      }
    }
  }, [currentUser]);

  // Keep currentUser in sync with latest usersList updates from cloud/peers
  useEffect(() => {
    if (currentUser && Array.isArray(usersList)) {
      const match = usersList.find(u =>
        u.id === currentUser.id ||
        (u.email && currentUser.email && u.email.toLowerCase() === currentUser.email.toLowerCase())
      );
      if (match) {
        const hasDiff =
          match.fullName !== currentUser.fullName ||
          match.role !== currentUser.role ||
          match.rolePosition !== currentUser.rolePosition ||
          match.siteId !== currentUser.siteId ||
          match.isActive !== currentUser.isActive ||
          JSON.stringify(match.permittedPages) !== JSON.stringify(currentUser.permittedPages);
        if (hasDiff) {
          setCurrentUser(prev => ({ ...prev, ...match }));
        }
      }
    }
  }, [usersList, currentUser]);

  // Strict Permission Check Helper
  const canAccess = (pageId) => {
    if (!currentUser) return false;
    // 1. Superadmin has full unrestricted access to all modules
    if (currentUser.role === 'superadmin') return true;

    // 2. User Access Management is strictly restricted to Superadmin
    if (pageId === 'user-access') return false;

    // 3. Deactivated accounts have zero access
    if (currentUser.isActive === false) return false;

    // 4. Check explicit permitted pages assigned by Superadmin
    if (Array.isArray(currentUser.permittedPages)) {
      return currentUser.permittedPages.includes(pageId);
    }

    // 5. Fallback preset if permittedPages is not set on legacy user
    const fallbackPreset = ROLE_PRESETS[currentUser.role] || ROLE_PRESETS.user;
    return fallbackPreset.includes(pageId) && pageId !== 'user-access';
  };

  // 1. Verify Company Email during Login
  const verifyLoginEmail = async (rawEmail) => {
    const email = rawEmail.trim().toLowerCase();

    if (!isAllowedCompanyEmail(email)) {
      return {
        success: false,
        error: 'Access restricted: System is exclusively for authorized internal Mobile Care personnel (@mobilecareph.com, @mobilecare.com.ph).'
      };
    }

    let user = matchUserByEmail(usersList, email);

    if (!user && supabase) {
      try {
        const { data: dbProfiles } = await supabase
          .from('profiles')
          .select('*');

        if (dbProfiles && dbProfiles.length > 0) {
          const matchedDb = matchUserByEmail(
            dbProfiles.map(p => ({
              ...p,
              fullName: p.full_name,
              siteId: p.site_id,
              hasSetPassword: p.has_set_password,
              isActive: p.is_active
            })),
            email
          );

          if (matchedDb) {
            const { data: dbPerms } = await supabase
              .from('user_page_permissions')
              .select('page_id')
              .eq('user_id', matchedDb.id);

            const resolvedRole = matchedDb.role || 'user';
            const resolvedPosition = matchedDb.role_position || matchedDb.rolePosition || getDefaultRolePosition(resolvedRole);
            const perms = matchedDb.permittedPages || (dbPerms && dbPerms.length > 0
              ? dbPerms.map(p => p.page_id)
              : (resolvedRole === 'superadmin' ? ROLE_PRESETS.superadmin : (ROLE_PRESETS[resolvedRole] || ROLE_PRESETS.user)));

            user = {
              id: matchedDb.id,
              email: matchedDb.email,
              fullName: matchedDb.full_name || matchedDb.fullName,
              role: resolvedRole,
              rolePosition: resolvedPosition,
              siteId: matchedDb.site_id || 'site-dc',
              hasSetPassword: matchedDb.has_set_password ?? true,
              passwordHash: matchedDb.password_hash || 'Password123',
              isActive: matchedDb.is_active ?? true,
              permittedPages: resolvedRole === 'superadmin' ? ROLE_PRESETS.superadmin : perms
            };

            setUsersList(prev => [...prev.filter(u => u.id !== user.id), user]);
          }
        }
      } catch (e) {
        console.warn('Supabase email verification lookup note:', e.message);
      }
    }

    if (!user) {
      return {
        success: false,
        error: 'This email is not registered. Contact your administrator to provision your account.'
      };
    }

    if (!user.isActive) {
      return {
        success: false,
        error: 'This account has been deactivated. Contact your administrator.'
      };
    }

    return {
      success: true,
      user,
      hasSetPassword: user.hasSetPassword
    };
  };

  // 2. Authenticate Returning User with Password
  const signInWithPassword = async (rawEmail, password, captchaToken = null) => {
    const cleanEmail = rawEmail.trim().toLowerCase();
    let user = matchUserByEmail(usersList, cleanEmail);

    if (!user && supabase) {
      try {
        const { data: dbProfiles } = await supabase
          .from('profiles')
          .select('*');

        if (dbProfiles && dbProfiles.length > 0) {
          const matchedDb = matchUserByEmail(
            dbProfiles.map(p => ({
              ...p,
              fullName: p.full_name,
              siteId: p.site_id,
              hasSetPassword: p.has_set_password,
              isActive: p.is_active
            })),
            cleanEmail
          );

          if (matchedDb) {
            const { data: dbPerms } = await supabase
              .from('user_page_permissions')
              .select('page_id')
              .eq('user_id', matchedDb.id);

            const resolvedRole = matchedDb.role || 'user';
            const resolvedPosition = matchedDb.role_position || matchedDb.rolePosition || getDefaultRolePosition(resolvedRole);
            const perms = matchedDb.permittedPages || (dbPerms && dbPerms.length > 0
              ? dbPerms.map(p => p.page_id)
              : (resolvedRole === 'superadmin' ? ROLE_PRESETS.superadmin : (ROLE_PRESETS[resolvedRole] || ROLE_PRESETS.user)));

            user = {
              id: matchedDb.id,
              email: matchedDb.email,
              fullName: matchedDb.full_name || matchedDb.fullName,
              role: resolvedRole,
              rolePosition: resolvedPosition,
              siteId: matchedDb.site_id || 'site-dc',
              hasSetPassword: matchedDb.has_set_password ?? true,
              passwordHash: matchedDb.password_hash || 'Password123',
              isActive: matchedDb.is_active ?? true,
              permittedPages: resolvedRole === 'superadmin' ? ROLE_PRESETS.superadmin : perms
            };

            setUsersList(prev => [...prev.filter(u => u.id !== user.id), user]);
          }
        }
      } catch (e) {
        console.warn('Supabase login profile lookup note:', e.message);
      }
    }

    if (!user) {
      return { success: false, error: 'User not found' };
    }

    if (!user.isActive) {
      return { success: false, error: 'Account is deactivated' };
    }

    try {
      if (supabase) {
        const authPayload = {
          email: user.email,
          password,
          ...(captchaToken ? { options: { captchaToken } } : {})
        };
        await supabase.auth.signInWithPassword(authPayload);
      }
    } catch (e) {
      console.warn('Supabase Auth sign-in response:', e?.message || e);
    }

    const isPasswordValid = await verifyPassword(password, user.passwordHash);
    if (!isPasswordValid) {
      barcodeAudio.playError();
      return { success: false, error: 'Incorrect password. Please try again or reset password.' };
    }

    if (!user.passwordHash?.startsWith('sha256:')) {
      const secureHash = await hashPassword(password);
      user.passwordHash = secureHash;
      if (supabase) {
        supabase.from('profiles').update({ password_hash: secureHash }).eq('id', user.id).then(() => {}).catch(() => {});
      }
    }

    setCurrentUser(user);
    const initialPage = user.permittedPages?.[0] || 'dashboard';
    if (typeof setActiveTab === 'function') setActiveTab(initialPage);
    if (typeof hydrateFromSupabase === 'function') hydrateFromSupabase();
    showToast(`Welcome back, ${user.fullName}!`, 'success');
    return { success: true, user };
  };

  // 3. First-Time Password Creation
  const createFirstTimePassword = async (rawEmail, newPassword) => {
    const cleanEmail = rawEmail.trim().toLowerCase();
    const user = matchUserByEmail(usersList, cleanEmail);

    if (!user) {
      return { success: false, error: 'User profile not found' };
    }

    const secureHash = await hashPassword(newPassword);

    try {
      if (supabase) {
        await supabase.auth.updateUser({ password: newPassword });
        await supabase
          .from('profiles')
          .update({
            has_set_password: true,
            password_hash: secureHash,
            updated_at: new Date().toISOString()
          })
          .or(`id.eq.${user.id},email.ilike.${user.email}`);
      }
    } catch (e) {}

    const updatedUser = {
      ...user,
      hasSetPassword: true,
      passwordHash: secureHash
    };

    setUsersList(prev => prev.map(u => (u.id === user.id ? updatedUser : u)));
    setPendingFirstTimeUser(null);
    setCurrentUser(updatedUser);
    const initialPage = updatedUser.permittedPages?.[0] || 'dashboard';
    if (typeof setActiveTab === 'function') setActiveTab(initialPage);
    showToast(`Password successfully configured! Welcome to DC System, ${updatedUser.fullName}.`, 'success');
    return { success: true, user: updatedUser };
  };

  // 4. Sign Out
  const signOut = async () => {
    try {
      if (supabase) await supabase.auth.signOut();
    } catch (e) {}
    setCurrentUser(null);
    setPendingFirstTimeUser(null);
    if (typeof setActiveTab === 'function') setActiveTab('dashboard');
    showToast('Signed out successfully.', 'info');
  };

  return {
    currentUser,
    setCurrentUser,
    pendingFirstTimeUser,
    setPendingFirstTimeUser,
    canAccess,
    verifyLoginEmail,
    signInWithPassword,
    createFirstTimePassword,
    signOut
  };
}
