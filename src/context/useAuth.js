import { useState, useEffect } from 'react';
import { supabase } from '../supabase/client';
import dbStorage from '../utils/dbStorage';
import { hashPassword, verifyPassword, generateSessionSignature, verifySessionIntegrity } from '../utils/security';
import { isAllowedCompanyEmail, matchUserByEmail } from '../utils/userMatcher';
import { ROLE_PRESETS, getDefaultRolePosition } from '../constants/roles';
import { barcodeAudio } from '../utils/barcodeAudio';

export function useAuth({
  usersList,
  setUsersList,
  showToast,
  hydrateFromSupabase,
  broadcastCloudEvent,
  syncMasterUsersRegistry,
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

    // 4. Regular users (role: 'user') only have view & export access to Planning & Reports modules (excluding operations)
    if (currentUser.role === 'user') {
      return ROLE_PRESETS.user.includes(pageId);
    }

    // 5. Check explicit permitted pages assigned by Superadmin for admin accounts
    if (Array.isArray(currentUser.permittedPages)) {
      return currentUser.permittedPages.includes(pageId);
    }

    // 6. Fallback preset if permittedPages is not set on legacy user
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

    if (!user) {
      try {
        const localUsers = JSON.parse(localStorage.getItem('mdc_users') || '[]');
        user = matchUserByEmail(localUsers, email);
      } catch (e) {}
    }

    if (!user && supabase) {
      try {
        // 1. Check authoritative master_users_registry first
        const { data: regDoc } = await supabase
          .from('saved_records')
          .select('snapshot_data')
          .eq('id', 'master_users_registry')
          .maybeSingle();

        if (regDoc?.snapshot_data?.users && Array.isArray(regDoc.snapshot_data.users)) {
          const matchedFromReg = matchUserByEmail(regDoc.snapshot_data.users, email);
          if (matchedFromReg) {
            user = matchedFromReg;
            setUsersList(prev => [...(prev || []).filter(u => u.id !== user.id), user]);
          }
        }

        // 2. Fallback to profiles table
        if (!user) {
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
                hasSetPassword: matchedDb.has_set_password ?? (resolvedRole === 'superadmin'),
                passwordHash: matchedDb.password_hash || (resolvedRole === 'superadmin' ? 'Password123' : null),
                isActive: matchedDb.is_active ?? true,
                permittedPages: resolvedRole === 'superadmin' ? ROLE_PRESETS.superadmin : perms
              };

              setUsersList(prev => [...(prev || []).filter(u => u.id !== user.id), user]);
            }
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

    const hasSet = user.hasSetPassword === true || (user.hasSetPassword !== false && Boolean(user.passwordHash));

    return {
      success: true,
      user,
      hasSetPassword: hasSet
    };
  };

  // 2. Authenticate Returning User with Password
  const signInWithPassword = async (rawEmail, password, captchaToken = null) => {
    const cleanEmail = rawEmail.trim().toLowerCase();
    let user = matchUserByEmail(usersList, cleanEmail);

    if (!user) {
      try {
        const localUsers = JSON.parse(localStorage.getItem('mdc_users') || '[]');
        user = matchUserByEmail(localUsers, cleanEmail);
      } catch (e) {}
    }

    if (!user && supabase) {
      try {
        const { data: regDoc } = await supabase
          .from('saved_records')
          .select('snapshot_data')
          .eq('id', 'master_users_registry')
          .maybeSingle();

        if (regDoc?.snapshot_data?.users && Array.isArray(regDoc.snapshot_data.users)) {
          const matchedFromReg = matchUserByEmail(regDoc.snapshot_data.users, cleanEmail);
          if (matchedFromReg) {
            user = matchedFromReg;
            setUsersList(prev => [...(prev || []).filter(u => u.id !== user.id), user]);
          }
        }

        if (!user) {
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
                hasSetPassword: matchedDb.has_set_password ?? (resolvedRole === 'superadmin'),
                passwordHash: matchedDb.password_hash || (resolvedRole === 'superadmin' ? 'Password123' : null),
                isActive: matchedDb.is_active ?? true,
                permittedPages: resolvedRole === 'superadmin' ? ROLE_PRESETS.superadmin : perms
              };

              setUsersList(prev => [...(prev || []).filter(u => u.id !== user.id), user]);
            }
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
      user.hasSetPassword = true;
      if (supabase) {
        supabase.from('profiles').update({ password_hash: secureHash, has_set_password: true }).eq('id', user.id).then(() => {}).catch(() => {});
      }
    }

    setCurrentUser(user);
    const initialPage = user.permittedPages?.[0] || 'dashboard';
    if (typeof setActiveTab === 'function') setActiveTab(initialPage);
    if (typeof hydrateFromSupabase === 'function') hydrateFromSupabase();
    showToast(`Welcome back, ${user.fullName}!`, 'success');
    return { success: true, user };
  };

  // 3. First-Time Password Creation & Activation
  const createFirstTimePassword = async (rawEmail, newPassword) => {
    const cleanEmail = rawEmail.trim().toLowerCase();
    let user = matchUserByEmail(usersList, cleanEmail);

    if (!user) {
      try {
        const localUsers = JSON.parse(localStorage.getItem('mdc_users') || '[]');
        user = matchUserByEmail(localUsers, cleanEmail);
      } catch (e) {}
    }

    if (!user) {
      return { success: false, error: 'User profile not found' };
    }

    const secureHash = await hashPassword(newPassword);

    const updatedUser = {
      ...user,
      hasSetPassword: true,
      passwordHash: secureHash
    };

    const nextList = (usersList || []).map(u => (u.id === user.id || u.email?.toLowerCase() === cleanEmail ? updatedUser : u));
    if (!nextList.some(u => u.id === updatedUser.id || u.email?.toLowerCase() === cleanEmail)) {
      nextList.push(updatedUser);
    }

    setUsersList(nextList);
    setPendingFirstTimeUser(null);
    setCurrentUser(updatedUser);

    try {
      localStorage.setItem('mdc_users', JSON.stringify(nextList));
      localStorage.setItem('mdc_current_user', JSON.stringify(updatedUser));
      localStorage.setItem('mdc_session_sig', generateSessionSignature(updatedUser));
      dbStorage.setItem('mdc_users', nextList);
    } catch (e) {}

    if (typeof syncMasterUsersRegistry === 'function') {
      await syncMasterUsersRegistry(nextList);
    } else if (supabase) {
      try {
        const deleted = JSON.parse(localStorage.getItem('mdc_deleted_user_ids') || '[]');
        await supabase.from('saved_records').upsert({
          id: 'master_users_registry',
          record_type: 'users_registry',
          period_label: 'Master Users Registry',
          period_year: new Date().getFullYear(),
          period_month: new Date().getMonth() + 1,
          notes: 'Master Provisioned Accounts & Permissions Registry',
          snapshot_data: {
            users: nextList,
            deletedUserIds: deleted,
            updatedAt: new Date().toISOString()
          },
          updated_at: new Date().toISOString()
        }, { onConflict: 'id' });
      } catch (e) {}
    }

    if (supabase) {
      try {
        await supabase.auth.updateUser({ password: newPassword }).catch(() => {});
        await supabase
          .from('profiles')
          .update({
            has_set_password: true,
            password_hash: secureHash,
            updated_at: new Date().toISOString()
          })
          .or(`id.eq.${user.id},email.ilike.${user.email}`);
      } catch (e) {}
    }

    if (typeof broadcastCloudEvent === 'function') {
      broadcastCloudEvent('USER_REGISTRY_UPDATED', { email: cleanEmail, userId: updatedUser.id, table: 'saved_records' });
    }

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

  const canEdit = currentUser?.role === 'superadmin' || currentUser?.role === 'admin';
  const isReadOnly = !canEdit;

  return {
    currentUser,
    setCurrentUser,
    pendingFirstTimeUser,
    setPendingFirstTimeUser,
    canAccess,
    canEdit,
    isReadOnly,
    verifyLoginEmail,
    signInWithPassword,
    createFirstTimePassword,
    signOut
  };
}
