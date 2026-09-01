import { useState, useEffect } from 'react';
import { supabase } from '../supabase/client';
import dbStorage from '../utils/dbStorage';
import {
  hashPassword,
  verifyPassword,
  getStoredUserSession,
  persistUserSession,
  clearStoredUserSession
} from '../utils/security';
import { isAllowedCompanyEmail, matchUserByEmail } from '../utils/userMatcher';
import { ROLE_PRESETS, getDefaultRolePosition } from '../constants/roles';
import { barcodeAudio } from '../utils/barcodeAudio';
import { clearOperationalLocalStorage } from '../utils/cacheManager';
import { isUUID, toValidUUID } from '../utils/appContextHelpers';

export function useAuth({
  usersList,
  setUsersList,
  showToast,
  hydrateFromSupabase,
  broadcastCloudEvent,
  syncMasterUsersRegistry,
  setActiveTab
}) {
  // Synchronous multi-tier session resolution (LocalStorage + SessionStorage + Cookie)
  const [currentUser, setCurrentUser] = useState(() => {
    try {
      const savedUser = getStoredUserSession();
      if (savedUser && typeof savedUser === 'object' && savedUser.email) {
        if (savedUser.role === 'parts_management') {
          savedUser.permittedPages = ROLE_PRESETS.parts_management || ['request-parts', 'scan-in', 'all-stocks'];
        }
        return savedUser;
      }
    } catch (e) {
      console.warn('Error loading user session:', e);
    }
    return null;
  });

  const [pendingFirstTimeUser, setPendingFirstTimeUser] = useState(null);
  const [isInitialSyncing, setIsInitialSyncing] = useState(false);

  // Asynchronous safety-net recovery from IndexedDB (dbStorage) and active Supabase Auth session on app mount
  useEffect(() => {
    let isMounted = true;

    const recoverPersistedSession = async () => {
      // If already resolved synchronously, ensure all storage tiers are aligned
      if (currentUser) {
        persistUserSession(currentUser);
        dbStorage.setItem('mdc_current_user', currentUser);
        return;
      }

      // 1. Recover from Supabase Auth active cloud session if available
      if (supabase) {
        try {
          const { data: sessionData } = await supabase.auth.getSession();
          const authEmail = sessionData?.session?.user?.email;
          if (isMounted && authEmail) {
            const cleanAuthEmail = authEmail.trim().toLowerCase();
            const { data: dbProf } = await supabase
              .from('profiles')
              .select('*')
              .ilike('email', cleanAuthEmail)
              .maybeSingle();

            if (isMounted && dbProf) {
              const { data: dbPerms } = await supabase
                .from('user_page_permissions')
                .select('page_id')
                .eq('user_id', dbProf.id);

              const resolvedRole = dbProf.role || 'user';
              const resolvedPosition = dbProf.role_position || getDefaultRolePosition(resolvedRole);
              const perms = (dbPerms && dbPerms.length > 0)
                ? dbPerms.map(p => p.page_id)
                : (resolvedRole === 'superadmin' ? ROLE_PRESETS.superadmin : (ROLE_PRESETS[resolvedRole] || ROLE_PRESETS.user));

              const recoveredUser = {
                id: dbProf.id,
                email: dbProf.email,
                fullName: dbProf.full_name || cleanAuthEmail.split('@')[0],
                role: resolvedRole,
                rolePosition: resolvedPosition,
                siteId: dbProf.site_id || 'site-dc',
                hasSetPassword: Boolean(dbProf.has_set_password || dbProf.password_hash),
                passwordHash: dbProf.password_hash || null,
                isActive: dbProf.is_active ?? true,
                permittedPages: perms
              };

              persistUserSession(recoveredUser);
              dbStorage.setItem('mdc_current_user', recoveredUser);
              setCurrentUser(recoveredUser);
              return;
            }

            const matched = matchUserByEmail(usersList, cleanAuthEmail);
            if (isMounted && matched) {
              persistUserSession(matched);
              dbStorage.setItem('mdc_current_user', matched);
              setCurrentUser(matched);
              return;
            }
          }
        } catch (e) {
          console.debug('Supabase session recovery note:', e);
        }
      }

      // 2. Recover from IndexedDB if in local mode or offline dev
      try {
        const dbUser = await dbStorage.getItem('mdc_current_user');
        if (isMounted && dbUser && typeof dbUser === 'object' && dbUser.email) {
          // If Supabase is connected, verify we have an active backend session before trusting stale local storage
          if (supabase) {
            const { data: sessionData } = await supabase.auth.getSession();
            if (!sessionData?.session?.user) {
              // Stale unauthenticated session; clear and require fresh login
              clearStoredUserSession();
              return;
            }
          }
          if (dbUser.role === 'parts_management') {
            dbUser.permittedPages = ROLE_PRESETS.parts_management || ['request-parts', 'scan-in', 'all-stocks'];
          }
          persistUserSession(dbUser);
          setCurrentUser(dbUser);
          return;
        }
      } catch (e) {
        console.debug('IndexedDB session recovery note:', e);
      }
    };

    recoverPersistedSession();

    return () => {
      isMounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync currentUser session to LocalStorage, SessionStorage, Cookie, & IndexedDB
  useEffect(() => {
    if (currentUser && typeof currentUser === 'object' && currentUser.email) {
      try {
        persistUserSession(currentUser);
        dbStorage.setItem('mdc_current_user', currentUser);
      } catch (e) {
        console.warn('Could not persist currentUser session:', e);
      }
    }
  }, [currentUser]);

  // Keep currentUser in sync with latest usersList updates from cloud/peers without infinite re-render loops
  useEffect(() => {
    if (currentUser && Array.isArray(usersList) && usersList.length > 0) {
      const match = usersList.find(u =>
        u.id === currentUser.id ||
        (u.email && currentUser.email && u.email.toLowerCase() === currentUser.email.toLowerCase())
      );
      if (match) {
        const permsMatch = Array.isArray(match.permittedPages) && Array.isArray(currentUser.permittedPages)
          ? match.permittedPages.length === currentUser.permittedPages.length && match.permittedPages.every((p, i) => p === currentUser.permittedPages[i])
          : JSON.stringify(match.permittedPages) === JSON.stringify(currentUser.permittedPages);

        const hasDiff =
          (match.fullName && match.fullName !== currentUser.fullName) ||
          (match.role && match.role !== currentUser.role) ||
          (match.rolePosition && match.rolePosition !== currentUser.rolePosition) ||
          (match.siteId && match.siteId !== currentUser.siteId) ||
          (match.isActive !== undefined && match.isActive !== currentUser.isActive) ||
          !permsMatch;

        if (hasDiff) {
          setCurrentUser(prev => {
            if (!prev) return null;
            return {
              ...prev,
              ...match,
              passwordHash: match.passwordHash || prev.passwordHash
            };
          });
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usersList, currentUser?.id, currentUser?.email, currentUser?.role, currentUser?.isActive, currentUser?.rolePosition]);

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

    // 5. Parts Management (PMG) role: Allow all pages in ROLE_PRESETS.parts_management
    if (currentUser.role === 'parts_management') {
      return (ROLE_PRESETS.parts_management || ['request-parts', 'scan-in', 'all-stocks']).includes(pageId);
    }

    // 6. Check explicit permitted pages assigned by Superadmin for admin accounts
    if (Array.isArray(currentUser.permittedPages)) {
      return currentUser.permittedPages.includes(pageId);
    }

    // 7. Fallback preset if permittedPages is not set on legacy user
    const fallbackPreset = ROLE_PRESETS[currentUser.role] || ROLE_PRESETS.user;
    return fallbackPreset.includes(pageId) && pageId !== 'user-access';
  };

  // 1. Verify Company Email during Login (Authoritative Database First)
  const verifyLoginEmail = async (rawEmail) => {
    const email = rawEmail.trim().toLowerCase();

    if (!isAllowedCompanyEmail(email)) {
      return {
        success: false,
        error: 'Access restricted: System is exclusively for authorized internal Mobile Care personnel.'
      };
    }

    let user = null;

    // 1. Query live Supabase Database as PRIMARY source of truth
    if (supabase) {
      try {
        const { data: dbProf, error: profErr } = await supabase
          .from('profiles')
          .select('*')
          .ilike('email', email)
          .maybeSingle();

        if (!profErr && dbProf) {
          const { data: dbPerms } = await supabase
            .from('user_page_permissions')
            .select('page_id')
            .eq('user_id', dbProf.id);

          const resolvedRole = dbProf.role || 'user';
          const resolvedPosition = dbProf.role_position || getDefaultRolePosition(resolvedRole);
          const perms = (dbPerms && dbPerms.length > 0)
            ? dbPerms.map(p => p.page_id)
            : (resolvedRole === 'superadmin' ? ROLE_PRESETS.superadmin : (ROLE_PRESETS[resolvedRole] || ROLE_PRESETS.user));

          const hasPasswordSet = Boolean(dbProf.has_set_password || dbProf.password_hash);

          user = {
            id: dbProf.id,
            email: dbProf.email,
            fullName: dbProf.full_name || email.split('@')[0],
            role: resolvedRole,
            rolePosition: resolvedPosition,
            siteId: dbProf.site_id || 'site-dc',
            hasSetPassword: hasPasswordSet,
            passwordHash: dbProf.password_hash || null,
            isActive: dbProf.is_active ?? true,
            permittedPages: perms
          };
        }

        // Check authoritative master_users_registry from saved_records as fallback or enhancement
        const { data: regDoc } = await supabase
          .from('saved_records')
          .select('snapshot_data')
          .eq('id', 'master_users_registry')
          .maybeSingle();

        if (regDoc?.snapshot_data?.users && Array.isArray(regDoc.snapshot_data.users)) {
          const matchedFromReg = matchUserByEmail(regDoc.snapshot_data.users, email);
          if (matchedFromReg) {
            const hasRegPass = Boolean(matchedFromReg.hasSetPassword || matchedFromReg.passwordHash);
            if (!user) {
              user = {
                ...matchedFromReg,
                hasSetPassword: hasRegPass,
                passwordHash: matchedFromReg.passwordHash || null
              };
            } else {
              user = {
                ...user,
                ...matchedFromReg,
                hasSetPassword: user.hasSetPassword || hasRegPass,
                passwordHash: user.passwordHash || matchedFromReg.passwordHash || null,
                permittedPages: user.permittedPages || matchedFromReg.permittedPages
              };
            }
          }
        }
      } catch (e) {
        console.warn('Supabase real-time email verification note:', e.message);
      }
    }

    // 2. Fallback to local memory / storage if Supabase returned nothing or offline
    if (!user) {
      user = matchUserByEmail(usersList, email);
      if (!user) {
        try {
          const localUsers = JSON.parse(localStorage.getItem('mdc_users') || sessionStorage.getItem('mdc_users') || '[]');
          user = matchUserByEmail(localUsers, email);
        } catch (e) {}
      }
    }

    if (!user) {
      return {
        success: false,
        error: 'This email is not registered. Contact your administrator to provision your account.'
      };
    }

    // Keep client state & storage updated with the authoritative user record
    setUsersList(prev => {
      const next = [...(prev || []).filter(u => u.id !== user.id && u.email?.toLowerCase() !== email), user];
      try {
        localStorage.setItem('mdc_users', JSON.stringify(next));
        sessionStorage.setItem('mdc_users', JSON.stringify(next));
        dbStorage.setItem('mdc_users', next);
      } catch (e) {}
      return next;
    });

    if (!user.isActive) {
      return {
        success: false,
        error: 'This account has been deactivated. Contact your administrator.'
      };
    }

    const hasSet = Boolean(user.hasSetPassword || user.passwordHash);

    return {
      success: true,
      user,
      hasSetPassword: hasSet
    };
  };

  // 2. Authenticate Returning User with Password (Authoritative Database First)
  const signInWithPassword = async (rawEmail, password, captchaToken = null) => {
    const cleanEmail = (rawEmail || '').trim().toLowerCase();
    const cleanPassword = (password || '').trim();
    let user = null;

    // 1. Authoritative real-time database lookup first
    if (supabase) {
      try {
        const { data: dbProf, error: profErr } = await supabase
          .from('profiles')
          .select('*')
          .ilike('email', cleanEmail)
          .maybeSingle();

        if (!profErr && dbProf) {
          const { data: dbPerms } = await supabase
            .from('user_page_permissions')
            .select('page_id')
            .eq('user_id', dbProf.id);

          const resolvedRole = dbProf.role || 'user';
          const resolvedPosition = dbProf.role_position || getDefaultRolePosition(resolvedRole);
          const perms = (dbPerms && dbPerms.length > 0)
            ? dbPerms.map(p => p.page_id)
            : (resolvedRole === 'superadmin' ? ROLE_PRESETS.superadmin : (ROLE_PRESETS[resolvedRole] || ROLE_PRESETS.user));

          const hasPasswordSet = Boolean(dbProf.has_set_password || dbProf.password_hash);

          user = {
            id: dbProf.id,
            email: dbProf.email,
            fullName: dbProf.full_name || cleanEmail.split('@')[0],
            role: resolvedRole,
            rolePosition: resolvedPosition,
            siteId: dbProf.site_id || 'site-dc',
            hasSetPassword: hasPasswordSet,
            passwordHash: dbProf.password_hash || null,
            isActive: dbProf.is_active ?? true,
            permittedPages: perms
          };
        }

        const { data: regDoc } = await supabase
          .from('saved_records')
          .select('snapshot_data')
          .eq('id', 'master_users_registry')
          .maybeSingle();

        if (regDoc?.snapshot_data?.users && Array.isArray(regDoc.snapshot_data.users)) {
          const matchedFromReg = matchUserByEmail(regDoc.snapshot_data.users, cleanEmail);
          if (matchedFromReg) {
            const hasRegPass = Boolean(matchedFromReg.hasSetPassword || matchedFromReg.passwordHash);
            if (!user) {
              user = {
                ...matchedFromReg,
                hasSetPassword: hasRegPass,
                passwordHash: matchedFromReg.passwordHash || null
              };
            } else {
              user = {
                ...user,
                ...matchedFromReg,
                hasSetPassword: user.hasSetPassword || hasRegPass,
                passwordHash: user.passwordHash || matchedFromReg.passwordHash || null,
                permittedPages: user.permittedPages || matchedFromReg.permittedPages
              };
            }
          }
        }
      } catch (e) {
        console.warn('Supabase sign-in profile lookup note:', e.message);
      }
    }

    if (!user) {
      user = matchUserByEmail(usersList, cleanEmail);
    }
    if (!user) {
      try {
        const localUsers = JSON.parse(localStorage.getItem('mdc_users') || sessionStorage.getItem('mdc_users') || '[]');
        user = matchUserByEmail(localUsers, cleanEmail);
      } catch (e) {}
    }

    if (!user) {
      return { success: false, error: 'User not found' };
    }

    if (!user.isActive) {
      return { success: false, error: 'Account is deactivated' };
    }

    // 1. Authoritative Supabase Auth Verification
    let authPassed = false;
    let authErrorMessage = null;

    if (supabase) {
      try {
        const authPayload = {
          email: user.email,
          password: cleanPassword,
          ...(captchaToken ? { options: { captchaToken } } : {})
        };
        const { data: authData, error: authError } = await supabase.auth.signInWithPassword(authPayload);
        if (!authError && authData?.session) {
          authPassed = true;
        } else if (authError) {
          authErrorMessage = authError.message;
        }
      } catch (e) {
        authErrorMessage = e?.message;
      }
    }

    // 2. Cryptographic Salted SHA-256 Hash Verification (checks user's configured passwordHash from database)
    if (!authPassed) {
      if (user.passwordHash) {
        const isPasswordValid = await verifyPassword(cleanPassword, user.passwordHash);
        if (isPasswordValid) {
          authPassed = true;
        }
      }
    }

    if (!authPassed) {
      barcodeAudio.playError();
      return {
        success: false,
        error: authErrorMessage && !authErrorMessage.includes('schema') && !authErrorMessage.includes('credentials')
          ? authErrorMessage
          : 'Incorrect password. Please try again or reset password.'
      };
    }

    // Update client state & storage with latest authenticated credentials
    setUsersList(prev => {
      const next = [...(prev || []).filter(u => u.id !== user.id && u.email?.toLowerCase() !== cleanEmail), user];
      try {
        localStorage.setItem('mdc_users', JSON.stringify(next));
        sessionStorage.setItem('mdc_users', JSON.stringify(next));
        dbStorage.setItem('mdc_users', next);
      } catch (e) {}
      return next;
    });

    // Persist immediately across all tiers (LocalStorage, SessionStorage, Cookies, and IndexedDB)
    persistUserSession(user);
    dbStorage.setItem('mdc_current_user', user);

    // Check data ownership marker against the logging-in user
    const localDataOwner = localStorage.getItem('mdc_local_data_owner');
    const isOwnerMatch = localDataOwner && (
      localDataOwner === user.id ||
      (user.email && localDataOwner.toLowerCase() === user.email.toLowerCase())
    );

    if (!isOwnerMatch) {
      await clearOperationalLocalStorage({ keepSession: true });
      setIsInitialSyncing(true);
    } else {
      if (typeof hydrateFromSupabase === 'function') {
        hydrateFromSupabase();
      }
    }

    setCurrentUser(user);
    const initialPage = user.permittedPages?.[0] || 'dashboard';
    if (typeof setActiveTab === 'function') setActiveTab(initialPage);
    showToast(`Welcome back, ${user.fullName}!`, 'success');
    return { success: true, user };
  };

  // 3. First-Time Password Creation & Activation
  const createFirstTimePassword = async (rawEmail, newPassword) => {
    const cleanEmail = rawEmail.trim().toLowerCase();
    let user = matchUserByEmail(usersList, cleanEmail);

    if (!user) {
      try {
        const localUsers = JSON.parse(localStorage.getItem('mdc_users') || sessionStorage.getItem('mdc_users') || '[]');
        user = matchUserByEmail(localUsers, cleanEmail);
      } catch (e) {}
    }

    if (!user && pendingFirstTimeUser && pendingFirstTimeUser.email?.toLowerCase() === cleanEmail) {
      user = pendingFirstTimeUser;
    }

    if (!user && supabase) {
      try {
        const { data: regDoc } = await supabase
          .from('saved_records')
          .select('snapshot_data')
          .eq('id', 'master_users_registry')
          .maybeSingle();

        if (regDoc?.snapshot_data?.users && Array.isArray(regDoc.snapshot_data.users)) {
          user = matchUserByEmail(regDoc.snapshot_data.users, cleanEmail);
        }

        if (!user) {
          const { data: prof } = await supabase
            .from('profiles')
            .select('*')
            .ilike('email', cleanEmail)
            .maybeSingle();

          if (prof) {
            const resolvedRole = prof.role || 'user';
            user = {
              id: prof.id,
              email: prof.email,
              fullName: prof.full_name || cleanEmail.split('@')[0],
              role: resolvedRole,
              rolePosition: prof.role_position || getDefaultRolePosition(resolvedRole),
              siteId: prof.site_id || 'site-dc',
              hasSetPassword: false,
              passwordHash: null,
              isActive: prof.is_active ?? true,
              permittedPages: resolvedRole === 'superadmin' ? ROLE_PRESETS.superadmin : (ROLE_PRESETS[resolvedRole] || ROLE_PRESETS.user)
            };
          }
        }
      } catch (e) {
        console.warn('createFirstTimePassword Supabase lookup note:', e);
      }
    }

    if (!user) {
      return { success: false, error: 'User profile not found. Please contact Superadmin.' };
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
    persistUserSession(updatedUser);
    dbStorage.setItem('mdc_current_user', updatedUser);

    // Check data ownership marker against the newly activated user
    const localDataOwner = localStorage.getItem('mdc_local_data_owner');
    const isOwnerMatch = localDataOwner && (
      localDataOwner === updatedUser.id ||
      (updatedUser.email && localDataOwner.toLowerCase() === updatedUser.email.toLowerCase())
    );

    if (!isOwnerMatch) {
      await clearOperationalLocalStorage({ keepSession: true });
      setIsInitialSyncing(true);
    } else {
      if (typeof hydrateFromSupabase === 'function') {
        hydrateFromSupabase();
      }
    }

    setCurrentUser(updatedUser);

    try {
      localStorage.setItem('mdc_users', JSON.stringify(nextList));
      sessionStorage.setItem('mdc_users', JSON.stringify(nextList));
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
        const isIdUUID = isUUID(user.id);
        const updateQuery = isIdUUID
          ? supabase
              .from('profiles')
              .update({
                has_set_password: true,
                password_hash: secureHash,
                updated_at: new Date().toISOString()
              })
              .or(`id.eq.${user.id},email.ilike.${user.email}`)
          : supabase
              .from('profiles')
              .update({
                has_set_password: true,
                password_hash: secureHash,
                updated_at: new Date().toISOString()
              })
              .ilike('email', user.email);
        await updateQuery;
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
    try {
      clearStoredUserSession();
      await dbStorage.removeItem('mdc_current_user');
    } catch (e) {}
    try {
      await clearOperationalLocalStorage({ keepSession: false });
    } catch (e) {
      console.warn('Error clearing operational storage on signOut:', e);
    }
    setCurrentUser(null);
    setPendingFirstTimeUser(null);
    setIsInitialSyncing(false);
    if (typeof setActiveTab === 'function') setActiveTab('dashboard');
    showToast('Signed out successfully.', 'info');
  };

  const canEdit = currentUser?.role === 'superadmin' || currentUser?.role === 'admin';
  const isReadOnly = !canEdit;

  return {
    currentUser,
    setCurrentUser,
    isInitialSyncing,
    setIsInitialSyncing,
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
