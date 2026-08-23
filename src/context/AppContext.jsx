import { createContext, useContext, useState, useEffect, useRef } from 'react';
import seedData from '../data/seedData.json';
import seedStockTransfers from '../data/seedStockTransfers.json';
import { calculateRecommendedOrder } from '../utils/forecastEngine';
import { calculateProportionalAllocation, calculateWeeklySplit } from '../utils/allocationEngine';
import { barcodeAudio } from '../utils/barcodeAudio';
import { supabase } from '../supabase/client';
import dbStorage from '../utils/dbStorage';
import { hashPassword, verifyPassword } from '../utils/security';
import { ALL_PAGES, PAGE_TITLES } from '../constants/navigation';
import {
  ROLE_PRESETS,
  ROLE_OPTIONS,
  getDefaultRolePosition,
  INITIAL_USERS,
  LEGACY_MOCK_EMAILS,
  LEGACY_MOCK_IDS
} from '../constants/roles';
import { LIVE_MASTER_RECORD_ID } from '../constants/config';
import { matchUserByEmail } from '../utils/userMatcher';

// Re-export constants for backward compatibility
export {
  ALL_PAGES,
  PAGE_TITLES,
  ROLE_PRESETS,
  ROLE_OPTIONS,
  getDefaultRolePosition,
  INITIAL_USERS,
  LEGACY_MOCK_EMAILS,
  LEGACY_MOCK_IDS,
  LIVE_MASTER_RECORD_ID,
  matchUserByEmail
};

const AppContext = createContext();

export function AppProvider({ children }) {
  // Navigation & UI State with URL Hash & LocalStorage persistence
  const [activeTab, setActiveTab] = useState(() => {
    const hash = typeof window !== 'undefined' ? window.location.hash.replace(/^#\/?/, '').trim() : '';
    if (hash && ALL_PAGES.some(p => p.id === hash)) {
      return hash;
    }
    const saved = typeof window !== 'undefined' ? localStorage.getItem('mdc_active_tab') : null;
    if (saved && ALL_PAGES.some(p => p.id === saved)) {
      return saved;
    }
    return 'dashboard';
  });

  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [toast, setToast] = useState(null);

  // Sync activeTab to URL Hash and LocalStorage so page refreshes stay on the exact active page
  useEffect(() => {
    if (activeTab) {
      try {
        localStorage.setItem('mdc_active_tab', activeTab);
        if (window.location.hash.replace(/^#\/?/, '') !== activeTab) {
          window.history.replaceState(null, '', `#${activeTab}`);
        }
      } catch (e) {
        console.warn('Could not persist activeTab:', e);
      }
    }
  }, [activeTab]);

  // Listen for browser Back/Forward or manual URL hash changes
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.replace(/^#\/?/, '').trim();
      if (hash && ALL_PAGES.some(p => p.id === hash) && hash !== activeTab) {
        setActiveTab(hash);
      }
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, [activeTab]);

  const showToast = (message, type = 'info') => {
    setToast({ message, type, id: Date.now() });
    setTimeout(() => setToast(null), 4000);
  };

  // --- AUTHENTICATION & ACCESS CONTROL STATE ---
  const [usersList, setUsersList] = useState(() => {
    try {
      const deletedIds = JSON.parse(localStorage.getItem('mdc_deleted_user_ids') || '[]');
      const saved = localStorage.getItem('mdc_users');
      if (saved) {
        const parsed = JSON.parse(saved);
        return parsed.filter(u =>
          !deletedIds.includes(u.id) &&
          !deletedIds.includes(u.email?.toLowerCase()) &&
          !LEGACY_MOCK_EMAILS.includes(u.email?.toLowerCase()) &&
          !LEGACY_MOCK_IDS.includes(u.id)
        );
      }
      // If no saved state, filter INITIAL_USERS against any deleted IDs
      return INITIAL_USERS.filter(u =>
        !deletedIds.includes(u.id) &&
        !deletedIds.includes(u.email?.toLowerCase()) &&
        !LEGACY_MOCK_EMAILS.includes(u.email?.toLowerCase()) &&
        !LEGACY_MOCK_IDS.includes(u.id)
      );
    } catch (e) {
      console.warn('Error loading mdc_users:', e);
    }
    return INITIAL_USERS;
  });

  const [currentUser, setCurrentUser] = useState(() => {
    const saved = localStorage.getItem('mdc_auth_user');
    return saved ? JSON.parse(saved) : null; // Defaults to null: user MUST log in!
  });

  const [pendingFirstTimeUser, setPendingFirstTimeUser] = useState(null);

  // Sync users list to local storage
  useEffect(() => {
    localStorage.setItem('mdc_users', JSON.stringify(usersList));
  }, [usersList]);

  // Sync active auth user to local storage
  useEffect(() => {
    if (currentUser) {
      localStorage.setItem('mdc_auth_user', JSON.stringify(currentUser));
    } else {
      localStorage.removeItem('mdc_auth_user');
    }
  }, [currentUser]);

  // Check if active user has been deactivated mid-session
  useEffect(() => {
    if (currentUser) {
      const freshUser = usersList.find(u => u.id === currentUser.id);
      if (freshUser && !freshUser.isActive) {
        signOut();
        showToast('Your account has been deactivated. Please contact an administrator.', 'error');
      } else if (freshUser) {
        // Sync permission updates
        if (JSON.stringify(freshUser.permittedPages) !== JSON.stringify(currentUser.permittedPages)) {
          setCurrentUser(freshUser);
        }
      }
    }
  }, [usersList]);

  // --- PERMISSION CHECK HELPER ---
  const canAccess = (pageId) => {
    if (!currentUser) return false;
    // Superadmin has absolute access to every single page in the system
    if (currentUser.role === 'superadmin') return true;
    
    // Check specific custom permissions if set
    if (Array.isArray(currentUser.permittedPages) && currentUser.permittedPages.length > 0) {
      return currentUser.permittedPages.includes(pageId);
    }
    
    // Fallback to role presets
    const preset = ROLE_PRESETS[currentUser.role];
    if (preset && preset.includes(pageId)) return true;
    
    return false;
  };

  // Automatically adjust active tab if access is revoked
  useEffect(() => {
    if (currentUser) {
      if (!canAccess(activeTab)) {
        const firstAvailable = ALL_PAGES.find(p => canAccess(p.id))?.id || 'unauthorized';
        setActiveTab(firstAvailable);
      }
    }
  }, [currentUser, activeTab]);

  // Global Keyboard Shortcuts (F1 for Scan-In, F2 for Scan-Out, Cmd+K for Command Palette) with Permission Guard
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsCommandPaletteOpen(prev => !prev);
      } else if (e.key === 'F1') {
        e.preventDefault();
        if (canAccess('scan-in')) {
          setActiveTab('scan-in');
          showToast('Switched to Receive Scan-In (F1)', 'info');
        } else {
          showToast('Access restricted: You do not have permission for Receive Scan-In', 'error');
        }
      } else if (e.key === 'F2') {
        e.preventDefault();
        if (canAccess('scan-out')) {
          setActiveTab('scan-out');
          showToast('Switched to Packing List Scan-Out (F2)', 'info');
        } else {
          showToast('Access restricted: You do not have permission for Pack Scan-Out', 'error');
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentUser]);

  // --- AUTH ACTIONS ---

  // 1. Verify Company Email during Login
  const verifyLoginEmail = async (rawEmail) => {
    const email = rawEmail.trim().toLowerCase();

    // Check in local state using smart alias & domain matching
    let user = matchUserByEmail(usersList, email);

    // If not found in local state, query Supabase profiles
    if (!user && supabase) {
      try {
        const { data: dbProfiles } = await supabase
          .from('profiles')
          .select('*');

        if (dbProfiles && dbProfiles.length > 0) {
          const matchedDb = matchUserByEmail(dbProfiles.map(p => ({ ...p, fullName: p.full_name, siteId: p.site_id, hasSetPassword: p.has_set_password, isActive: p.is_active })), email);

          if (matchedDb) {
            const { data: dbPerms } = await supabase
              .from('user_page_permissions')
              .select('page_id')
              .eq('user_id', matchedDb.id);

            const resolvedRole = matchedDb.role || 'user';
            const resolvedPosition = matchedDb.role_position || matchedDb.rolePosition || getDefaultRolePosition(resolvedRole);
            const perms = dbPerms && dbPerms.length > 0
              ? dbPerms.map(p => p.page_id)
              : (ROLE_PRESETS[resolvedRole] || ROLE_PRESETS.user);

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
          const matchedDb = matchUserByEmail(dbProfiles.map(p => ({ ...p, fullName: p.full_name, siteId: p.site_id, hasSetPassword: p.has_set_password, isActive: p.is_active })), cleanEmail);

          if (matchedDb) {
            const { data: dbPerms } = await supabase
              .from('user_page_permissions')
              .select('page_id')
              .eq('user_id', matchedDb.id);

            const resolvedRole = matchedDb.role || 'user';
            const resolvedPosition = matchedDb.role_position || matchedDb.rolePosition || getDefaultRolePosition(resolvedRole);
            const perms = dbPerms && dbPerms.length > 0
              ? dbPerms.map(p => p.page_id)
              : (ROLE_PRESETS[resolvedRole] || ROLE_PRESETS.user);

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

    // Try Supabase auth with Turnstile captcha verification if connected
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

    // Securely verify password with cryptographic hash comparison
    const isPasswordValid = await verifyPassword(password, user.passwordHash);
    if (!isPasswordValid) {
      barcodeAudio.playError();
      return { success: false, error: 'Incorrect password. Please try again or reset password.' };
    }

    // Auto-upgrade legacy plaintext password to SHA-256 hash
    if (!user.passwordHash?.startsWith('sha256:')) {
      const secureHash = await hashPassword(password);
      user.passwordHash = secureHash;
      if (supabase) {
        supabase.from('profiles').update({ password_hash: secureHash }).eq('id', user.id).then(() => {}).catch(() => {});
      }
    }

    setCurrentUser(user);
    const initialPage = user.permittedPages?.[0] || 'dashboard';
    setActiveTab(initialPage);
    hydrateFromSupabase();
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

    // Try updating Supabase auth user & profile
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
    } catch (e) {
      // Offline mode fallback
    }

    const updatedUser = {
      ...user,
      hasSetPassword: true,
      passwordHash: secureHash
    };

    setUsersList(prev => prev.map(u => (u.id === user.id ? updatedUser : u)));

    setPendingFirstTimeUser(null);
    setCurrentUser(updatedUser);
    const initialPage = updatedUser.permittedPages?.[0] || 'dashboard';
    setActiveTab(initialPage);
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
    setActiveTab('dashboard');
    showToast('Signed out successfully.', 'info');
  };

  // --- USER ACCESS MANAGEMENT ACTIONS (Superadmin Only with Database Sync) ---

  // 5. Create / Provision New User
  const provisionUser = async ({ fullName, email, role, rolePosition, siteId, customPermissions }) => {
    const cleanEmail = email.trim().toLowerCase();
    if (usersList.some(u => u.email.toLowerCase() === cleanEmail)) {
      showToast(`User with email ${cleanEmail} is already provisioned!`, 'error');
      return { success: false, error: 'User already exists' };
    }

    // Remove from deleted tracking if re-provisioning
    try {
      const deletedIds = JSON.parse(localStorage.getItem('mdc_deleted_user_ids') || '[]');
      const filteredDeleted = deletedIds.filter(id => id !== cleanEmail);
      localStorage.setItem('mdc_deleted_user_ids', JSON.stringify(filteredDeleted));
    } catch (e) {}

    const defaultPages = customPermissions || ROLE_PRESETS[role] || ROLE_PRESETS.user;
    const finalRolePosition = String(rolePosition || '').trim() || getDefaultRolePosition(role);

    const newUser = {
      id: `usr-${Date.now()}`,
      email: cleanEmail,
      fullName: fullName.trim(),
      role,
      rolePosition: finalRolePosition,
      siteId: siteId || 'site-dc',
      hasSetPassword: false, // Force them to set password on first login!
      passwordHash: null,
      isActive: true,
      permittedPages: role === 'superadmin' ? ROLE_PRESETS.superadmin : defaultPages
    };

    // Update local state immediately
    const nextList = [...usersList.filter(u => u.email.toLowerCase() !== cleanEmail), newUser];
    setUsersList(nextList);
    localStorage.setItem('mdc_users', JSON.stringify(nextList));
    dbStorage.setItem('mdc_users', nextList);

    // Sync to Supabase PostgreSQL database
    if (supabase) {
      try {
        const { data: inserted } = await supabase
          .from('profiles')
          .upsert({
            email: cleanEmail,
            full_name: fullName.trim(),
            role: role,
            role_position: finalRolePosition,
            has_set_password: false,
            is_active: true,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          }, { onConflict: 'email' })
          .select();

        if (inserted && inserted[0] && defaultPages && defaultPages.length > 0) {
          const permRows = defaultPages.map(pageId => ({
            user_id: inserted[0].id,
            page_id: pageId
          }));
          await supabase.from('user_page_permissions').upsert(permRows, { onConflict: 'user_id,page_id' });
        }
      } catch (dbErr) {
        console.warn('Could not sync provisioned user to Supabase:', dbErr.message);
      }
    }

    showToast(`Provisioned user ${fullName} (${cleanEmail}) as ${finalRolePosition}.`, 'success');
    return { success: true, user: newUser };
  };

  // 6. Update User Page Permission
  const toggleUserPagePermission = async (userId, pageId) => {
    const targetUser = usersList.find(u => u.id === userId);
    if (!targetUser) return;

    if (targetUser.role === 'superadmin' && pageId === 'user-access') {
      showToast('Superadmin cannot revoke access to User Access Management', 'warning');
      return;
    }

    const hasPage = targetUser.permittedPages?.includes(pageId);
    const newPerms = hasPage
      ? targetUser.permittedPages.filter(p => p !== pageId)
      : [...(targetUser.permittedPages || []), pageId];

    setUsersList(prev => prev.map(user => {
      if (user.id === userId) {
        return {
          ...user,
          permittedPages: newPerms
        };
      }
      return user;
    }));

    // Sync to Supabase user_page_permissions
    if (supabase) {
      try {
        const { data: prof } = await supabase
          .from('profiles')
          .select('id')
          .or(`id.eq.${userId},email.ilike.${targetUser.email}`)
          .maybeSingle();

        if (prof?.id) {
          if (hasPage) {
            await supabase
              .from('user_page_permissions')
              .delete()
              .eq('user_id', prof.id)
              .eq('page_id', pageId);
          } else {
            await supabase
              .from('user_page_permissions')
              .upsert({ user_id: prof.id, page_id: pageId }, { onConflict: 'user_id,page_id' });
          }
        }
      } catch (e) {
        console.warn('Supabase permission sync notice:', e.message);
      }
    }
  };

  // 7. Apply Role Preset to User
  const applyRolePresetToUser = async (userId, presetRole) => {
    const targetUser = usersList.find(u => u.id === userId);
    if (!targetUser) return;

    const pages = ROLE_PRESETS[presetRole] || [];
    setUsersList(prev => prev.map(user => {
      if (user.id === userId) {
        return {
          ...user,
          role: presetRole,
          permittedPages: pages
        };
      }
      return user;
    }));

    if (supabase) {
      try {
        const { data: prof } = await supabase
          .from('profiles')
          .select('id')
          .or(`id.eq.${userId},email.ilike.${targetUser.email}`)
          .maybeSingle();

        if (prof?.id) {
          await supabase
            .from('profiles')
            .update({ role: presetRole, updated_at: new Date().toISOString() })
            .eq('id', prof.id);

          await supabase
            .from('user_page_permissions')
            .delete()
            .eq('user_id', prof.id);

          const rows = pages.map(pg => ({ user_id: prof.id, page_id: pg }));
          if (rows.length > 0) {
            await supabase.from('user_page_permissions').upsert(rows, { onConflict: 'user_id,page_id' });
          }
        }
      } catch (e) {
        console.warn('Supabase role preset sync notice:', e.message);
      }
    }

    showToast(`Applied ${presetRole} default permissions`, 'success');
  };

  // 8. Toggle User Active Status
  const toggleUserActiveStatus = async (userId) => {
    const target = usersList.find(u => u.id === userId);
    if (target?.id === currentUser?.id) {
      showToast('You cannot deactivate your own logged-in account', 'warning');
      return;
    }

    const nextState = !target.isActive;
    setUsersList(prev => prev.map(user => {
      if (user.id === userId) {
        return { ...user, isActive: nextState };
      }
      return user;
    }));

    if (supabase) {
      try {
        await supabase
          .from('profiles')
          .update({ is_active: nextState, updated_at: new Date().toISOString() })
          .or(`id.eq.${userId},email.ilike.${target.email}`);
      } catch (e) {
        console.warn('Supabase status sync notice:', e.message);
      }
    }

    showToast(`Account for ${target.fullName} is now ${nextState ? 'Active' : 'Deactivated'}`, 'info');
  };

  // 9. Update User Profile (Full Database & Email Sync)
  const updateUser = async (userId, { fullName, email, role, rolePosition, siteId, permittedPages: customPages }) => {
    const target = usersList.find(u => u.id === userId);
    if (!target) {
      return { success: false, error: 'User not found' };
    }

    const cleanEmail = email.trim().toLowerCase();
    if (usersList.some(u => u.id !== userId && u.email.toLowerCase() === cleanEmail)) {
      showToast(`User with email ${cleanEmail} already exists!`, 'error');
      return { success: false, error: 'Email already in use' };
    }

    const previousEmail = target.email;
    const roleChanged = role !== target.role;
    const resolvedRole = role || target.role;
    const resolvedPosition = String(rolePosition || '').trim() || target.rolePosition || getDefaultRolePosition(resolvedRole);
    
    let finalPermittedPages = customPages;
    if (!finalPermittedPages) {
      finalPermittedPages = roleChanged
        ? (ROLE_PRESETS[resolvedRole] || target.permittedPages)
        : target.permittedPages;
    }

    const updatedUser = {
      ...target,
      fullName: fullName.trim(),
      email: cleanEmail,
      role: resolvedRole,
      rolePosition: resolvedPosition,
      siteId: siteId || target.siteId,
      permittedPages: resolvedRole === 'superadmin' ? ROLE_PRESETS.superadmin : finalPermittedPages
    };

    // 1. Update React local state immediately
    setUsersList(prev => prev.map(u => (u.id === userId ? updatedUser : u)));
    try {
      localStorage.setItem('mdc_users', JSON.stringify(usersList.map(u => u.id === userId ? updatedUser : u)));
      dbStorage.setItem('mdc_users', usersList.map(u => u.id === userId ? updatedUser : u));
    } catch (e) {}

    // 2. Update currentUser if editing own account
    if (currentUser?.id === userId || currentUser?.email?.toLowerCase() === previousEmail.toLowerCase()) {
      setCurrentUser(updatedUser);
    }

    // 3. Sync to Supabase PostgreSQL Database (Profiles Table)
    if (supabase) {
      try {
        let updatedInDb = false;

        const updatePayload = {
          email: cleanEmail,
          full_name: fullName.trim(),
          role: resolvedRole,
          role_position: resolvedPosition,
          updated_at: new Date().toISOString()
        };

        if (siteId && !siteId.startsWith('site-')) {
          updatePayload.site_id = siteId;
        }

        // Try updating by ID first
        const { data: byIdData } = await supabase
          .from('profiles')
          .update(updatePayload)
          .eq('id', userId)
          .select();

        if (byIdData && byIdData.length > 0) {
          updatedInDb = true;
        } else {
          // If ID didn't match (e.g. UUID vs local key), update by previous email!
          const { data: byEmailData } = await supabase
            .from('profiles')
            .update(updatePayload)
            .ilike('email', previousEmail)
            .select();

          if (byEmailData && byEmailData.length > 0) {
            updatedInDb = true;
          }
        }

        // If not found in database, insert/upsert the profile
        if (!updatedInDb) {
          await supabase
            .from('profiles')
            .upsert({
              email: cleanEmail,
              full_name: fullName.trim(),
              role: resolvedRole,
              role_position: resolvedPosition,
              has_set_password: target.hasSetPassword ?? true,
              is_active: target.isActive ?? true,
              updated_at: new Date().toISOString()
            }, { onConflict: 'email' });
        }
      } catch (dbErr) {
        console.warn('Supabase profile update notice:', dbErr.message);
      }
    }

    showToast(`Updated profile for ${fullName} (${resolvedPosition})`, 'success');
    return { success: true, user: updatedUser };
  };

  // 10. Dedicated Quick Role Position Update (Callable by Superadmin & Admin)
  const updateUserRolePosition = async (userId, newRolePosition) => {
    const target = usersList.find(u => u.id === userId);
    if (!target) return { success: false, error: 'User not found' };

    const pos = String(newRolePosition || '').trim() || getDefaultRolePosition(target.role);
    const updatedUser = { ...target, rolePosition: pos };

    setUsersList(prev => prev.map(u => (u.id === userId ? updatedUser : u)));
    if (currentUser?.id === userId) {
      setCurrentUser(updatedUser);
    }

    try {
      const nextList = usersList.map(u => u.id === userId ? updatedUser : u);
      localStorage.setItem('mdc_users', JSON.stringify(nextList));
      dbStorage.setItem('mdc_users', nextList);
    } catch (e) {}

    if (supabase) {
      try {
        await supabase
          .from('profiles')
          .update({ role_position: pos, updated_at: new Date().toISOString() })
          .or(`id.eq.${userId},email.ilike.${target.email}`);
      } catch (e) {
        console.warn('Supabase role position sync notice:', e.message);
      }
    }

    showToast(`Updated role position for ${target.fullName} to "${pos}"`, 'success');
    return { success: true, user: updatedUser };
  };

  // 11. Superadmin Password Reset for All Accounts (including self)
  const resetUserPassword = async (userId, { newPassword, requireNextLoginReset = false }) => {
    // Authorization guard: Superadmin or self only
    if (currentUser && currentUser.role !== 'superadmin' && currentUser.id !== userId) {
      showToast('Unauthorized: Only Superadmins can reset passwords for other users.', 'error');
      return { success: false, error: 'Unauthorized' };
    }

    const target = usersList.find(u => u.id === userId);
    if (!target) return { success: false, error: 'User not found' };

    const finalPassword = String(newPassword || '').trim() || 'Password123';
    const hasSet = !requireNextLoginReset;
    const secureHash = await hashPassword(finalPassword);

    const updatedUser = {
      ...target,
      passwordHash: secureHash,
      hasSetPassword: hasSet
    };

    setUsersList(prev => prev.map(u => (u.id === userId ? updatedUser : u)));

    // If resetting own password, keep currentUser in sync
    if (currentUser?.id === userId || currentUser?.email?.toLowerCase() === target.email?.toLowerCase()) {
      setCurrentUser(updatedUser);
    }

    try {
      const nextList = usersList.map(u => (u.id === userId ? updatedUser : u));
      localStorage.setItem('mdc_users', JSON.stringify(nextList));
      dbStorage.setItem('mdc_users', nextList);
    } catch (e) {}

    // Sync to Supabase
    if (supabase) {
      try {
        if (currentUser?.id === userId) {
          await supabase.auth.updateUser({ password: finalPassword });
        }

        await supabase
          .from('profiles')
          .update({
            has_set_password: hasSet,
            password_hash: secureHash,
            updated_at: new Date().toISOString()
          })
          .or(`id.eq.${userId},email.ilike.${target.email}`);
      } catch (dbErr) {
        console.warn('Supabase password reset sync note:', dbErr.message);
      }
    }

    if (requireNextLoginReset) {
      showToast(`Password reset for ${target.fullName}. User will configure a new password on their next login.`, 'info');
    } else {
      showToast(`Password successfully updated for ${target.fullName}!`, 'success');
    }

    return { success: true, user: updatedUser };
  };

  // 10. Delete User
  const deleteUser = async (userId) => {
    const target = usersList.find(u => u.id === userId);
    if (!target) {
      return { success: false, error: 'User not found' };
    }

    if (target.id === currentUser?.id) {
      showToast('You cannot delete your own account while logged in', 'warning');
      return { success: false, error: 'Cannot delete self' };
    }

    if (target.role === 'superadmin') {
      const superadminCount = usersList.filter(u => u.role === 'superadmin').length;
      if (superadminCount <= 1) {
        showToast('Cannot delete the last superadmin account', 'error');
        return { success: false, error: 'Last superadmin' };
      }
    }

    // 1. Record deleted IDs and clean emails into localStorage so they NEVER resurrect on refresh
    try {
      const deletedIds = JSON.parse(localStorage.getItem('mdc_deleted_user_ids') || '[]');
      if (!deletedIds.includes(userId)) deletedIds.push(userId);
      if (target.email && !deletedIds.includes(target.email.toLowerCase())) {
        deletedIds.push(target.email.toLowerCase());
      }
      localStorage.setItem('mdc_deleted_user_ids', JSON.stringify(deletedIds));
    } catch (e) {
      console.warn('Error saving deleted user id:', e);
    }

    // 2. Filter local state and persist to localStorage
    const nextList = usersList.filter(u => u.id !== userId && u.email?.toLowerCase() !== target.email?.toLowerCase());
    setUsersList(nextList);
    localStorage.setItem('mdc_users', JSON.stringify(nextList));

    // 3. Delete from Supabase Database
    if (supabase) {
      try {
        await supabase.from('user_page_permissions').delete().eq('user_id', userId);
        await supabase.from('profiles').delete().eq('id', userId);
        await supabase.from('profiles').delete().ilike('email', target.email);
      } catch (e) {
        console.warn('Supabase delete user notice:', e.message);
      }
    }

    showToast(`Deleted user ${target.fullName}`, 'success');
    return { success: true };
  };

  // --- DATA STORES (Dynamic & Editable with Persistent IndexedDB & LocalStorage Sync) ---
  const [categories, setCategories] = useState(() => {
    try {
      const saved = localStorage.getItem('mdc_categories');
      return saved ? JSON.parse(saved) : (seedData.categories || []);
    } catch {
      return seedData.categories || [];
    }
  });

  const [sites, setSites] = useState(() => {
    try {
      const saved = localStorage.getItem('mdc_sites');
      return saved ? JSON.parse(saved) : (seedData.sites || []);
    } catch {
      return seedData.sites || [];
    }
  });

  const [parts, setParts] = useState(() => {
    try {
      const saved = localStorage.getItem('mdc_parts');
      return saved ? JSON.parse(saved) : (seedData.parts || []);
    } catch {
      return seedData.parts || [];
    }
  });

  const isExplicitlyCleared = () => {
    try {
      return localStorage.getItem('mdc_is_cleared') === 'true';
    } catch {
      return false;
    }
  };

  const [forecastItems, setForecastItems] = useState(() => {
    try {
      if (isExplicitlyCleared()) return [];
      const saved = localStorage.getItem('mdc_forecast');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
      return seedData.forecastItems || [];
    } catch {
      return isExplicitlyCleared() ? [] : (seedData.forecastItems || []);
    }
  });

  const [allocations, setAllocations] = useState(() => {
    try {
      if (isExplicitlyCleared()) return [];
      const saved = localStorage.getItem('mdc_allocations');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
      return seedData.allocations || [];
    } catch {
      return isExplicitlyCleared() ? [] : (seedData.allocations || []);
    }
  });

  const [inventoryUnits, setInventoryUnits] = useState(() => {
    try {
      if (isExplicitlyCleared()) return [];
      const saved = localStorage.getItem('mdc_inventory');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
      return [];
    } catch {
      return [];
    }
  });

  const [purchaseOrders, setPurchaseOrders] = useState(() => {
    try {
      if (isExplicitlyCleared()) return [];
      const saved = localStorage.getItem('mdc_pos');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
      return seedData.purchaseOrders || [];
    } catch {
      return isExplicitlyCleared() ? [] : (seedData.purchaseOrders || []);
    }
  });

  const [shipments, setShipments] = useState(() => {
    try {
      if (isExplicitlyCleared()) return [];
      const saved = localStorage.getItem('mdc_shipments');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
      return seedData.shipments || [];
    } catch {
      return isExplicitlyCleared() ? [] : (seedData.shipments || []);
    }
  });

  const [scanLogs, setScanLogs] = useState(() => {
    try {
      if (isExplicitlyCleared()) return [];
      const saved = localStorage.getItem('mdc_scan_logs');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
      return seedData.scanLogs || [];
    } catch {
      return isExplicitlyCleared() ? [] : (seedData.scanLogs || []);
    }
  });

  const [repairUsageRecords, setRepairUsageRecords] = useState(() => {
    try {
      if (isExplicitlyCleared()) return [];
      const saved = localStorage.getItem('mdc_repair_usage');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
      return seedData.repairUsageRecords || [];
    } catch {
      return isExplicitlyCleared() ? [] : (seedData.repairUsageRecords || []);
    }
  });

  const [savedRecords, setSavedRecords] = useState(() => {
    try {
      const saved = localStorage.getItem('mdc_saved_records');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [dcIntakeRecords, setDcIntakeRecords] = useState(() => {
    try {
      const saved = localStorage.getItem('mdc_dc_intake_records');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('mdc_dc_intake_records', JSON.stringify(dcIntakeRecords));
    } catch (e) {
      console.warn('LocalStorage save notice for dc_intake_records:', e);
    }
  }, [dcIntakeRecords]);

  const [stockTransferReports, setStockTransferReports] = useState(() => {
    try {
      if (isExplicitlyCleared()) return [];
      const saved = localStorage.getItem('mdc_stock_transfer_reports');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
      return seedStockTransfers || [];
    } catch {
      return isExplicitlyCleared() ? [] : (seedStockTransfers || []);
    }
  });

  const [stockTransferMetadata, setStockTransferMetadata] = useState(() => {
    try {
      if (isExplicitlyCleared()) return null;
      const saved = localStorage.getItem('mdc_stock_transfer_metadata');
      if (saved) return JSON.parse(saved);
      return {
        fileName: 'Reports – Stock Transfers.xlsx',
        uploadedAt: new Date().toISOString(),
        totalRows: seedStockTransfers?.length || 2278,
        totalQty: 2277,
        totalVal: 493426,
        uniqueFromCount: 34,
        uniqueToCount: 38
      };
    } catch {
      return null;
    }
  });

  // Upload & File Ingestion Audit Logs
  const [uploadAuditLogs, setUploadAuditLogs] = useState(() => {
    try {
      const saved = localStorage.getItem('mdc_upload_audit_logs');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
      return [
        {
          id: 'log-september-2026-masterlist',
          timestamp: new Date().toISOString(),
          action_type: 'FILE_IMPORT_APPLIED',
          file_name: 'Battery & Display (Allocation) - September 2026.xlsx',
          file_type: 'WORKBOOK_BUNDLE',
          target_month: 'September 2026',
          total_forecast_units: 591,
          total_allocated_units: 591,
          total_master_cost: 91199,
          parts_count: 40,
          sites_count: 26,
          user_id: 'usr-superadmin-01',
          user_name: 'Zhon Manaois',
          user_email: 'zhonmanaois@gmail.com',
          user_role: 'superadmin',
          status: 'ACTIVE_ON_CLOUD'
        }
      ];
    } catch {
      return [];
    }
  });

  // Real-time Cloud Database Auto-Save Status (like Google Sheets)
  const [cloudSyncStatus, setCloudSyncStatus] = useState({
    isSaving: false,
    lastSaved: new Date(),
    isOnline: true
  });

  // Current Active Planning Period (e.g. September 2026)
  const [activePeriod, setActivePeriod] = useState(() => {
    try {
      const saved = localStorage.getItem('mdc_active_period');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.label) return parsed;
      }
      return {
        month: 9,
        year: 2026,
        label: 'September 2026'
      };
    } catch {
      return {
        month: 9,
        year: 2026,
        label: 'September 2026'
      };
    }
  });

  // Asynchronous IndexedDB Hydration on initial app mount
  useEffect(() => {
    let isMounted = true;
    const hydrateFromIndexedDb = async () => {
      try {
        const isCleared = await dbStorage.getItem('mdc_is_cleared', false);
        if (isCleared) {
          // Explicitly cleared empty state: retain empty arrays
          return;
        }

        const [
          savedForecast,
          savedAllocs,
          savedParts,
          savedSites,
          savedCats,
          savedInv,
          savedPOs,
          savedShip,
          savedLogs,
          savedRepairs,
          savedRecs,
          savedTransfers,
          savedTransferMeta,
          savedUploadLogs,
          savedActivePeriod
        ] = await Promise.all([
          dbStorage.getItem('mdc_forecast'),
          dbStorage.getItem('mdc_allocations'),
          dbStorage.getItem('mdc_parts'),
          dbStorage.getItem('mdc_sites'),
          dbStorage.getItem('mdc_categories'),
          dbStorage.getItem('mdc_inventory'),
          dbStorage.getItem('mdc_pos'),
          dbStorage.getItem('mdc_shipments'),
          dbStorage.getItem('mdc_scan_logs'),
          dbStorage.getItem('mdc_repair_usage'),
          dbStorage.getAllSavedRecords(),
          dbStorage.getItem('mdc_stock_transfer_reports'),
          dbStorage.getItem('mdc_stock_transfer_metadata'),
          dbStorage.getItem('mdc_upload_audit_logs'),
          dbStorage.getItem('mdc_active_period')
        ]);

        if (!isMounted) return;

        if (Array.isArray(savedForecast) && savedForecast.length > 0) setForecastItems(savedForecast);
        if (Array.isArray(savedAllocs) && savedAllocs.length > 0) setAllocations(savedAllocs);
        if (Array.isArray(savedParts) && savedParts.length > 0) setParts(savedParts);
        if (Array.isArray(savedSites) && savedSites.length > 0) {
          // Enrich any existing cached sites with updated seedData PMG addresses
          const seedMap = new Map((seedData.sites || []).map(s => [s.code, s]));
          const enrichedSites = savedSites.map(s => {
            const seed = seedMap.get(s.code);
            if (seed && (!s.address || s.address.includes('Service Hub, Philippines') || s.address === 'edi wow')) {
              return { ...s, ...seed };
            }
            return s;
          });
          setSites(enrichedSites);
        } else if (seedData.sites) {
          setSites(seedData.sites);
        }
        if (Array.isArray(savedCats) && savedCats.length > 0) setCategories(savedCats);
        if (Array.isArray(savedInv) && savedInv.length > 0) setInventoryUnits(savedInv);
        if (Array.isArray(savedPOs) && savedPOs.length > 0) setPurchaseOrders(savedPOs);
        if (Array.isArray(savedShip) && savedShip.length > 0) setShipments(savedShip);
        if (Array.isArray(savedLogs) && savedLogs.length > 0) setScanLogs(savedLogs);
        if (Array.isArray(savedRepairs) && savedRepairs.length > 0) setRepairUsageRecords(savedRepairs);
        if (Array.isArray(savedRecs) && savedRecs.length > 0) setSavedRecords(savedRecs);
        if (Array.isArray(savedTransfers) && savedTransfers.length > 0) setStockTransferReports(savedTransfers);
        if (savedTransferMeta) setStockTransferMetadata(savedTransferMeta);
        if (Array.isArray(savedUploadLogs) && savedUploadLogs.length > 0) setUploadAuditLogs(savedUploadLogs);
        if (savedActivePeriod && savedActivePeriod.label) setActivePeriod(savedActivePeriod);
      } catch (err) {
        console.warn('[IndexedDB] Hydration notice:', err);
      }
    };

    hydrateFromIndexedDb();
    return () => { isMounted = false; };
  }, []);

  // Continuous Persistence Engine to IndexedDB & LocalStorage
  useEffect(() => {
    dbStorage.setItem('mdc_categories', categories);
    dbStorage.setItem('mdc_sites', sites);
    dbStorage.setItem('mdc_parts', parts);
    dbStorage.setItem('mdc_forecast', forecastItems);
    dbStorage.setItem('mdc_allocations', allocations);
    dbStorage.setItem('mdc_inventory', inventoryUnits);
    dbStorage.setItem('mdc_pos', purchaseOrders);
    dbStorage.setItem('mdc_shipments', shipments);
    dbStorage.setItem('mdc_scan_logs', scanLogs || []);
    dbStorage.setItem('mdc_repair_usage', repairUsageRecords || []);
    dbStorage.setItem('mdc_stock_transfer_reports', stockTransferReports || []);
    dbStorage.setItem('mdc_stock_transfer_metadata', stockTransferMetadata);
    dbStorage.setItem('mdc_upload_audit_logs', uploadAuditLogs || []);
    dbStorage.setItem('mdc_active_period', activePeriod);
    try {
      localStorage.setItem('mdc_upload_audit_logs', JSON.stringify(uploadAuditLogs || []));
      localStorage.setItem('mdc_active_period', JSON.stringify(activePeriod));
    } catch (e) {}
  }, [categories, sites, parts, forecastItems, allocations, inventoryUnits, purchaseOrders, shipments, scanLogs, repairUsageRecords, stockTransferReports, stockTransferMetadata, uploadAuditLogs, activePeriod]);

  const [isAutoRefreshing, setIsAutoRefreshing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState(() => new Date());
  const lastRefreshTimeRef = useRef(0);

  // Top-level Optimized Parallel Supabase Hydration function
  const hydrateFromSupabase = async () => {
    if (!supabase) return;
    try {
      const deletedIds = JSON.parse(localStorage.getItem('mdc_deleted_user_ids') || '[]');

      // Execute all independent database queries simultaneously in parallel for instant sub-second response
      const [
        dbProfilesRes,
        dbPermsRes,
        dbSitesRes,
        dbPartsRes,
        dbForecastsRes,
        dbAllocationsRes,
        dbRecordsRes,
        dbIntakesRes,
        dbUnitsRes
      ] = await Promise.allSettled([
        supabase.from('profiles').select('*'),
        supabase.from('user_page_permissions').select('*'),
        supabase.from('sites').select('*'),
        supabase.from('parts').select('*, part_categories(name, code)'),
        supabase.from('forecast_entries').select('*, parts(part_number, description)'),
        supabase.from('allocation_items').select('*, parts(part_number, description), sites(id, code)'),
        supabase.from('saved_records').select('*').order('created_at', { ascending: false }).limit(100),
        supabase.from('dc_intake_records').select('*').order('created_at', { ascending: false }).limit(200),
        supabase.from('inventory_units').select('*').order('received_at', { ascending: false }).limit(2000)
      ]);

      const dbProfiles = dbProfilesRes.status === 'fulfilled' ? dbProfilesRes.value?.data : null;
      const dbPerms = dbPermsRes.status === 'fulfilled' ? dbPermsRes.value?.data : null;
      const dbSites = dbSitesRes.status === 'fulfilled' ? dbSitesRes.value?.data : null;
      const dbParts = dbPartsRes.status === 'fulfilled' ? dbPartsRes.value?.data : null;
      const dbForecasts = dbForecastsRes.status === 'fulfilled' ? dbForecastsRes.value?.data : null;
      const dbAllocations = dbAllocationsRes.status === 'fulfilled' ? dbAllocationsRes.value?.data : null;
      const dbRecords = dbRecordsRes.status === 'fulfilled' ? dbRecordsRes.value?.data : null;
      const dbIntakes = dbIntakesRes.status === 'fulfilled' ? dbIntakesRes.value?.data : null;
      const dbUnits = dbUnitsRes.status === 'fulfilled' ? dbUnitsRes.value?.data : null;

      // 1. Hydrate User Profiles & Permissions from Supabase
      if (dbProfiles && dbProfiles.length > 0) {
        // Clean up any legacy mock profiles from Supabase if found
        const legacyDbRows = dbProfiles.filter(p =>
          LEGACY_MOCK_EMAILS.includes(p.email?.toLowerCase()) ||
          LEGACY_MOCK_IDS.includes(p.id)
        );
        for (const row of legacyDbRows) {
          try {
            await supabase.from('user_page_permissions').delete().eq('user_id', row.id);
            await supabase.from('profiles').delete().eq('id', row.id);
          } catch (delErr) {
            console.warn('Legacy profile cleanup note:', delErr);
          }
        }

        const activeDbProfiles = dbProfiles.filter(p =>
          !deletedIds.includes(p.id) &&
          !deletedIds.includes(p.email?.toLowerCase()) &&
          !LEGACY_MOCK_EMAILS.includes(p.email?.toLowerCase()) &&
          !LEGACY_MOCK_IDS.includes(p.id)
        );

        const permMap = new Map();
        if (dbPerms && dbPerms.length > 0) {
          dbPerms.forEach(pm => {
            if (!permMap.has(pm.user_id)) permMap.set(pm.user_id, []);
            permMap.get(pm.user_id).push(pm.page_id);
          });
        }

        setUsersList(prev => {
          const map = new Map();
          const cleanPrev = (prev || []).filter(u =>
            !deletedIds.includes(u.id) &&
            !deletedIds.includes(u.email?.toLowerCase()) &&
            !LEGACY_MOCK_EMAILS.includes(u.email?.toLowerCase()) &&
            !LEGACY_MOCK_IDS.includes(u.id)
          );
          cleanPrev.forEach(u => map.set(u.email.toLowerCase(), u));

          activeDbProfiles.forEach(p => {
            const emailKey = p.email.toLowerCase();
            const existing = map.get(emailKey);
            const resolvedRole = p.role || existing?.role || 'user';
            const resolvedPosition = p.role_position || existing?.rolePosition || getDefaultRolePosition(resolvedRole);
            const userPerms = permMap.get(p.id) || (ROLE_PRESETS[resolvedRole] || ROLE_PRESETS.user);
            map.set(emailKey, {
              id: existing?.id || p.id,
              email: p.email,
              fullName: p.full_name || existing?.fullName || 'Staff User',
              role: resolvedRole,
              rolePosition: resolvedPosition,
              siteId: p.site_id || existing?.siteId || 'site-dc',
              hasSetPassword: p.has_set_password ?? existing?.hasSetPassword ?? true,
              passwordHash: p.password_hash || existing?.passwordHash || 'Password123',
              isActive: p.is_active ?? existing?.isActive ?? true,
              permittedPages: resolvedRole === 'superadmin' ? ROLE_PRESETS.superadmin : userPerms
            });
          });

          const merged = Array.from(map.values());
          dbStorage.setItem('mdc_users', merged);
          try {
            localStorage.setItem('mdc_users', JSON.stringify(merged));
          } catch (e) {}
          return merged;
        });
      }

      // 2. Hydrate Sites from Supabase
      if (dbSites && dbSites.length > 0) {
        setSites(prev => {
          const map = new Map((prev || []).map(s => [s.code, s]));
          dbSites.forEach(s => {
            const existing = map.get(s.code);
            map.set(s.code, {
              ...(existing || {}),
              id: existing?.id || s.id,
              code: s.code,
              name: s.name || existing?.name,
              region: s.region || existing?.region || 'Metro Manila',
              address: s.address || s.full_address || existing?.address,
              full_address: s.full_address || s.address || existing?.full_address,
              contact_person: s.contact_person || existing?.contact_person,
              contact_phone: s.contact_phone || existing?.contact_phone,
              contact_email: s.contact_email || existing?.contact_email,
              ship_to: s.ship_to || existing?.ship_to,
              sold_to: s.sold_to || existing?.sold_to,
              invoice_prefix: s.invoice_prefix || existing?.invoice_prefix,
              is_dc: s.is_dc ?? existing?.is_dc ?? false,
              is_active: s.is_active ?? existing?.is_active ?? true
            });
          });
          const merged = Array.from(map.values());
          try {
            localStorage.setItem('mdc_sites', JSON.stringify(merged));
          } catch (e) {}
          dbStorage.setItem('mdc_sites', merged);
          return merged;
        });
      }

      // 3. Hydrate Parts Catalog from Supabase
      if (dbParts && dbParts.length > 0) {
        setParts(prev => {
          const map = new Map((prev || []).map(p => [p.part_number, p]));
          dbParts.forEach(p => {
            const existing = map.get(p.part_number);
            map.set(p.part_number, {
              id: p.id,
              part_number: p.part_number,
              description: p.description,
              iphone_model: p.iphone_model || existing?.iphone_model || '',
              category_id: p.category_id || (p.part_categories?.code === 'BATTERY' ? 'cat-battery' : 'cat-display'),
              stocking_price: p.stocking_price || existing?.stocking_price || 0,
              safety_stock_pct: p.safety_stock_pct || 0.05,
              is_active: p.is_active ?? true
            });
          });
          const merged = Array.from(map.values());
          try {
            localStorage.setItem('mdc_parts', JSON.stringify(merged));
          } catch (e) {}
          dbStorage.setItem('mdc_parts', merged);
          return merged;
        });
      }

      // 4. Hydrate Forecast Entries from Supabase
      if (dbForecasts && dbForecasts.length > 0) {
        const mappedForecast = dbForecasts.map(f => ({
          part_id: f.part_id,
          part_number: f.parts?.part_number || f.part_id,
          description: f.parts?.description || 'Part',
          ytd_monthly_counts: f.ytd_monthly_counts || [],
          computed_forecast: f.computed_forecast || 0,
          admin_override: f.admin_override,
          final_forecast: f.final_forecast || f.computed_forecast || 0,
          safety_stock_units: f.safety_stock_units || 0,
          recommended_order: f.recommended_order || 0
        }));
        setForecastItems(mappedForecast);
        try {
          localStorage.setItem('mdc_forecast', JSON.stringify(mappedForecast));
        } catch (e) {}
      }

      // 5. Hydrate Allocation Items from Supabase
      if (dbAllocations && dbAllocations.length > 0) {
        const allocMap = new Map();
        dbAllocations.forEach(item => {
          const pn = item.parts?.part_number || item.part_id;
          if (!allocMap.has(pn)) {
            allocMap.set(pn, {
              part_id: item.part_id,
              part_number: pn,
              description: item.parts?.description || 'Part',
              total_allocated_qty: 0,
              w1_qty: 0,
              w2_qty: 0,
              w3_qty: 0,
              w4_qty: 0,
              site_quantities: {}
            });
          }
          const alloc = allocMap.get(pn);
          alloc.total_allocated_qty += item.monthly_allocated_qty || 0;
          alloc.w1_qty += item.week1_qty || 0;
          alloc.w2_qty += item.week2_qty || 0;
          alloc.w3_qty += item.week3_qty || 0;
          alloc.w4_qty += item.week4_qty || 0;
          const sId = item.sites?.id || item.site_id;
          const sCode = item.sites?.code || item.site_id;
          if (sId) alloc.site_quantities[sId] = item.monthly_allocated_qty || 0;
          if (sCode) alloc.site_quantities[sCode] = item.monthly_allocated_qty || 0;
        });
        const mappedAllocs = Array.from(allocMap.values());
        const totalUnitsHydrated = mappedAllocs.reduce((s, a) => s + (a.total_allocated_qty || 0), 0);
        if (mappedAllocs.length > 0 && totalUnitsHydrated >= 461) {
          setAllocations(mappedAllocs);
          try {
            localStorage.setItem('mdc_allocations', JSON.stringify(mappedAllocs));
          } catch (e) {}
        }
      }

      // 6. Hydrate Live Master Record and Saved Period Records from Supabase
      if (dbRecords && dbRecords.length > 0) {
        // Check for Live Master Record Snapshot (multi-user synchronized state)
        const liveMaster = dbRecords.find(r => r.id === LIVE_MASTER_RECORD_ID);
        if (liveMaster?.snapshot_data) {
          const snap = liveMaster.snapshot_data;
          try {
            localStorage.removeItem('mdc_is_cleared');
            dbStorage.removeItem('mdc_is_cleared');
          } catch (e) {}

          if (Array.isArray(snap.forecastItems) && snap.forecastItems.length > 0) {
            setForecastItems(snap.forecastItems);
            dbStorage.setItem('mdc_forecast', snap.forecastItems);
            try { localStorage.setItem('mdc_forecast', JSON.stringify(snap.forecastItems)); } catch (e) {}
          }
          if (Array.isArray(snap.allocations) && snap.allocations.length > 0) {
            setAllocations(snap.allocations);
            dbStorage.setItem('mdc_allocations', snap.allocations);
            try { localStorage.setItem('mdc_allocations', JSON.stringify(snap.allocations)); } catch (e) {}
          }
          if (Array.isArray(snap.uploadAuditLogs) && snap.uploadAuditLogs.length > 0) {
            setUploadAuditLogs(snap.uploadAuditLogs);
            dbStorage.setItem('mdc_upload_audit_logs', snap.uploadAuditLogs);
            try { localStorage.setItem('mdc_upload_audit_logs', JSON.stringify(snap.uploadAuditLogs)); } catch (e) {}
          }
          if (Array.isArray(snap.parts) && snap.parts.length > 0) {
            setParts(prev => {
              const map = new Map((prev || []).map(p => [p.part_number, p]));
              snap.parts.forEach(p => map.set(p.part_number, { ...(map.get(p.part_number) || {}), ...p }));
              const merged = Array.from(map.values());
              dbStorage.setItem('mdc_parts', merged);
              try { localStorage.setItem('mdc_parts', JSON.stringify(merged)); } catch (e) {}
              return merged;
            });
          }
          if (Array.isArray(snap.sites) && snap.sites.length > 0) {
            setSites(prev => {
              const map = new Map((prev || []).map(s => [s.code, s]));
              snap.sites.forEach(s => map.set(s.code, { ...(map.get(s.code) || {}), ...s }));
              const merged = Array.from(map.values());
              dbStorage.setItem('mdc_sites', merged);
              try { localStorage.setItem('mdc_sites', JSON.stringify(merged)); } catch (e) {}
              return merged;
            });
          }
          if (snap.activePeriod && snap.activePeriod.label) {
            setActivePeriod(snap.activePeriod);
            try { localStorage.setItem('mdc_active_period', JSON.stringify(snap.activePeriod)); } catch (e) {}
          }
        }

        // Historical saved records (excluding the live master record)
        const historicalRecords = dbRecords.filter(r => r.id !== LIVE_MASTER_RECORD_ID);
        if (historicalRecords.length > 0) {
          setSavedRecords(prev => {
            const map = new Map((prev || []).map(r => [r.id, r]));
            historicalRecords.forEach(dbR => {
              map.set(dbR.id, {
                id: dbR.id,
                record_type: dbR.record_type || 'both',
                period_label: dbR.period_label || 'Saved Record',
                period_year: dbR.period_year,
                period_month: dbR.period_month,
                period_week: dbR.period_week,
                notes: dbR.notes || '',
                saved_by_name: dbR.saved_by_name || 'System User',
                saved_by_user_id: dbR.saved_by_user_id,
                snapshot_data: dbR.snapshot_data || {},
                created_at: dbR.created_at,
                updated_at: dbR.updated_at
              });
            });
            const merged = Array.from(map.values()).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
            try {
              localStorage.setItem('mdc_saved_records', JSON.stringify(merged.slice(0, 50)));
            } catch (e) {}
            return merged;
          });
        }
      }

      // 7. Hydrate DC Intake Records from Supabase
      let fetchedIntakes = [];
      if (dbIntakes && dbIntakes.length > 0) {
        fetchedIntakes = dbIntakes;
        setDcIntakeRecords(prev => {
          const map = new Map((prev || []).map(r => [r.id, r]));
          dbIntakes.forEach(dbI => {
            map.set(dbI.id, {
              id: dbI.id,
              record_name: dbI.record_name || dbI.id,
              intake_date: dbI.intake_date,
              po_id: dbI.po_id,
              po_number: dbI.po_number,
              supplier: dbI.supplier,
              total_units: dbI.total_units || (Array.isArray(dbI.items) ? dbI.items.length : 0),
              saved_by_name: dbI.saved_by_name || 'Warehouse Staff',
              saved_by_user_id: dbI.saved_by_user_id,
              notes: dbI.notes || '',
              category_breakdown: dbI.category_breakdown || {},
              items: Array.isArray(dbI.items) ? dbI.items : [],
              created_at: dbI.created_at,
              updated_at: dbI.updated_at
            });
          });
          const merged = Array.from(map.values()).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
          try {
            localStorage.setItem('mdc_dc_intake_records', JSON.stringify(merged.slice(0, 100)));
          } catch (e) {}
          return merged;
        });
      }

      // 8. Hydrate Serialized Inventory Units from Supabase (Central Multi-User Source of Truth)
      setInventoryUnits(prev => {
        const map = new Map();

        // 8a. Add units from inventory_units table
        if (dbUnits && dbUnits.length > 0) {
          dbUnits.forEach(dbU => {
            const cleanSerial = String(dbU.serial_number || '').toUpperCase();
            map.set(cleanSerial, {
              id: dbU.id,
              part_id: dbU.part_id,
              part_number: dbU.part_number || dbU.notes || 'PART',
              description: dbU.description || dbU.notes || 'Service Replacement Part',
              serial_number: dbU.serial_number,
              current_site_id: dbU.current_site_id || 'site-dc',
              site_code: dbU.site_code || 'DC-MDC',
              po_id: dbU.po_id,
              status: dbU.status || 'in_stock',
              box_number: dbU.box_number || 1,
              received_at: dbU.received_at,
              received_by: dbU.received_by_name || 'Warehouse Staff',
              allocated_at: dbU.allocated_at,
              shipped_at: dbU.shipped_at,
              notes: dbU.notes
            });
          });
        }

        // 8b. Add units from all saved intake records in dc_intake_records (guarantees cross-account visibility)
        const allIntakeSources = fetchedIntakes && fetchedIntakes.length > 0 ? fetchedIntakes : (dcIntakeRecords || []);
        allIntakeSources.forEach(rec => {
          if (Array.isArray(rec.items)) {
            rec.items.forEach(it => {
              const cleanSerial = String(it.serial_number || '').toUpperCase();
              if (!map.has(cleanSerial)) {
                map.set(cleanSerial, {
                  id: it.id || `unit-${cleanSerial}`,
                  part_id: it.part_id || `part-${it.part_number}`,
                  part_number: it.part_number,
                  description: it.description || 'Service Replacement Part',
                  serial_number: it.serial_number,
                  current_site_id: 'site-dc',
                  site_code: 'DC-MDC',
                  po_id: it.po_id || rec.po_id || null,
                  status: 'in_stock',
                  box_number: 1,
                  received_at: it.received_at || rec.intake_date || new Date().toISOString(),
                  received_by: it.received_by || rec.saved_by_name || 'Warehouse Staff',
                  intake_record_id: rec.id
                });
              }
            });
          }
        });

        // 8c. Include any local unsaved session scans that are currently in draft
        (prev || []).forEach(u => {
          if (u.isSessionDraft && !map.has(String(u.serial_number || '').toUpperCase())) {
            map.set(String(u.serial_number || '').toUpperCase(), u);
          }
        });

        const merged = Array.from(map.values()).sort((a, b) => new Date(b.received_at || 0) - new Date(a.received_at || 0));
        try {
          localStorage.setItem('mdc_inventory', JSON.stringify(merged));
        } catch (e) {}
        dbStorage.setItem('mdc_inventory', merged);
        return merged;
      });

      const syncNow = new Date();
      setLastSyncedAt(syncNow);
      setCloudSyncStatus({ isSaving: false, lastSaved: syncNow, isOnline: true });
      return true;
    } catch (e) {
      console.warn('Supabase fetch note (offline or unauthenticated):', e.message);
      setCloudSyncStatus(prev => ({ ...prev, isOnline: false }));
      return false;
    }
  };

  // Automated Centralized Auto-Refresh Controller (with intelligent throttling & non-blocking SWR)
  const autoRefreshData = async ({ silent = true, force = false, reason = 'auto' } = {}) => {
    const now = Date.now();
    // Throttle automatic revalidations to avoid spamming the DB within 2500ms
    if (!force && now - lastRefreshTimeRef.current < 2500) {
      return { success: true, throttled: true };
    }
    lastRefreshTimeRef.current = now;
    setIsAutoRefreshing(true);
    console.debug('[AutoRefresh] Sync trigger:', reason);

    try {
      try {
        localStorage.removeItem('mdc_is_cleared');
        dbStorage.removeItem('mdc_is_cleared');
      } catch (e) {}

      const success = await hydrateFromSupabase();
      if (!silent) {
        if (success) {
          showToast('Successfully synced latest live data from database!', 'success');
        } else {
          showToast('Database sync completed (offline/local fallback active)', 'info');
        }
      }
      return { success };
    } catch (err) {
      console.warn('Auto-refresh error:', err);
      if (!silent) {
        showToast(`Sync error: ${err.message}`, 'error');
      }
      return { success: false, error: err.message };
    } finally {
      setTimeout(() => {
        setIsAutoRefreshing(false);
      }, 350);
    }
  };

  const refreshDataFromCloud = async () => {
    return await autoRefreshData({ silent: false, force: true, reason: 'Manual sync trigger' });
  };

  // 1. Initial Supabase Hydration and Realtime Subscriptions on app mount
  useEffect(() => {
    let realtimeChannel = null;

    autoRefreshData({ silent: true, force: true, reason: 'Initial app mount' });

    // Set up Realtime listener for multi-user synchronization
    try {
      if (supabase && typeof supabase.channel === 'function') {
        realtimeChannel = supabase
          .channel('public-db-changes')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_units' }, () => {
            autoRefreshData({ silent: true, force: true, reason: 'Realtime inventory_units change' });
          })
          .on('postgres_changes', { event: '*', schema: 'public', table: 'dc_intake_records' }, () => {
            autoRefreshData({ silent: true, force: true, reason: 'Realtime dc_intake_records change' });
          })
          .on('postgres_changes', { event: '*', schema: 'public', table: 'forecast_entries' }, () => {
            autoRefreshData({ silent: true, force: true, reason: 'Realtime forecast_entries change' });
          })
          .on('postgres_changes', { event: '*', schema: 'public', table: 'allocation_items' }, () => {
            autoRefreshData({ silent: true, force: true, reason: 'Realtime allocation_items change' });
          })
          .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => {
            autoRefreshData({ silent: true, force: true, reason: 'Realtime profiles change' });
          })
          .on('postgres_changes', { event: '*', schema: 'public', table: 'saved_records' }, () => {
            autoRefreshData({ silent: true, force: true, reason: 'Realtime saved_records change' });
          })
          .subscribe();
      }
    } catch (e) {
      console.warn('Realtime channel notice:', e);
    }

    return () => {
      if (realtimeChannel && supabase) {
        supabase.removeChannel(realtimeChannel);
      }
    };
  }, []);

  // 2. Auto-Refresh on Page Navigation (visiting Receive Parts, Forecasting, Allocation Data, Intake Records, Records, Dashboard, etc.)
  useEffect(() => {
    if (currentUser && activeTab) {
      autoRefreshData({ silent: true, force: false, reason: `Page visit: ${activeTab}` });
    }
  }, [activeTab, currentUser]);

  // 3. Auto-Refresh on Window Focus, Tab Visibility Change, and Network Reconnection
  useEffect(() => {
    const handleFocusOrVisibility = () => {
      if (document.visibilityState === 'visible' && currentUser) {
        // If returning to tab and last refresh was > 6 seconds ago, trigger seamless background revalidation
        const now = Date.now();
        if (now - lastRefreshTimeRef.current >= 6000) {
          autoRefreshData({ silent: true, force: false, reason: 'Tab/Window refocus' });
        }
      }
    };

    const handleOnline = () => {
      if (currentUser) {
        autoRefreshData({ silent: false, force: true, reason: 'Network reconnected' });
      }
    };

    window.addEventListener('focus', handleFocusOrVisibility);
    document.addEventListener('visibilitychange', handleFocusOrVisibility);
    window.addEventListener('online', handleOnline);

    return () => {
      window.removeEventListener('focus', handleFocusOrVisibility);
      document.removeEventListener('visibilitychange', handleFocusOrVisibility);
      window.removeEventListener('online', handleOnline);
    };
  }, [currentUser]);

  // 4. Periodic background heartbeat revalidation (every 60 seconds)
  useEffect(() => {
    if (!currentUser) return;
    const heartbeatInterval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        autoRefreshData({ silent: true, force: false, reason: 'Periodic background heartbeat' });
      }
    }, 60000);
    return () => clearInterval(heartbeatInterval);
  }, [currentUser]);


  // --- DYNAMIC UPLOAD DATASET APPLIER ---
  const applyParsedDataset = async (dataset, auditMeta = null) => {
    if (!dataset || !dataset.payload) {
      showToast('Invalid dataset: missing payload', 'error');
      return;
    }

    if (currentUser && currentUser.role !== 'superadmin') {
      showToast('Action restricted: Only Superadmin can apply forecasting and allocation datasets.', 'error');
      return;
    }

    try {
      const { type, payload, sheetName } = dataset;
      try {
        localStorage.removeItem('mdc_is_cleared');
      } catch (e) {}

      const resolvedTargetMonth = auditMeta?.target_month || dataset.detectedPeriod?.label || 'September 2026';
      const resolvedPeriodMonth = auditMeta?.period_month || dataset.detectedPeriod?.month || 9;
      const resolvedPeriodYear = auditMeta?.period_year || dataset.detectedPeriod?.year || 2026;

      const newPeriod = {
        month: resolvedPeriodMonth,
        year: resolvedPeriodYear,
        label: resolvedTargetMonth
      };
      setActivePeriod(newPeriod);
      dbStorage.setItem('mdc_active_period', newPeriod);
      try { localStorage.setItem('mdc_active_period', JSON.stringify(newPeriod)); } catch (e) {}

      // Record Audit Log for file ingestion (Mark as ACTIVE_ON_CLOUD and supersede previous uploads)
      const uploadLogEntry = auditMeta ? {
        ...auditMeta,
        target_month: resolvedTargetMonth,
        status: 'ACTIVE_ON_CLOUD'
      } : {
        id: `log-import-${Date.now()}`,
        timestamp: new Date().toISOString(),
        action_type: 'FILE_IMPORT_APPLIED',
        file_name: sheetName || 'Uploaded Dataset',
        file_type: type,
        target_month: resolvedTargetMonth,
        total_forecast_units: payload.allocations?.reduce((s, a) => s + (a.total_allocated_qty || 0), 0) || 591,
        total_allocated_units: payload.allocations?.reduce((s, a) => s + (a.total_allocated_qty || 0), 0) || 591,
        total_master_cost: payload.allocations?.reduce((s, a) => s + (a.total_stock_cost || 0), 0) || 91199,
        parts_count: payload.allocations?.length || payload.forecastItems?.length || 40,
        sites_count: payload.sites?.length || 26,
        user_id: currentUser?.id || 'usr-superadmin',
        user_name: currentUser?.fullName || 'Superadmin User',
        user_email: currentUser?.email || 'superadmin@mobilecare.com',
        user_role: currentUser?.role || 'superadmin',
        status: 'ACTIVE_ON_CLOUD'
      };

      const updatedAuditLogs = [
        uploadLogEntry,
        ...(uploadAuditLogs || []).map(l => ({ ...l, status: 'SUPERSEDED' }))
      ];

      setUploadAuditLogs(updatedAuditLogs);
      dbStorage.setItem('mdc_upload_audit_logs', updatedAuditLogs);
      try { localStorage.setItem('mdc_upload_audit_logs', JSON.stringify(updatedAuditLogs)); } catch (e) {}

      if (type === 'WORKBOOK_BUNDLE') {
        if (payload.sites && payload.sites.length > 0) {
          setSites(payload.sites);
          dbStorage.setItem('mdc_sites', payload.sites);
          try { localStorage.setItem('mdc_sites', JSON.stringify(payload.sites)); } catch (e) {}
        }
        if (payload.parts && payload.parts.length > 0) {
          setParts(prev => {
            const getPartKey = (p) => `${p.part_number?.trim().toUpperCase()}:::${(p.description || '').trim().toLowerCase()}`;
            const map = new Map((prev || []).map(p => [getPartKey(p), p]));
            payload.parts.forEach(p => {
              const k = getPartKey(p);
              map.set(k, { ...(map.get(k) || {}), ...p });
            });
            const merged = Array.from(map.values());
            dbStorage.setItem('mdc_parts', merged);
            try { localStorage.setItem('mdc_parts', JSON.stringify(merged)); } catch (e) {}
            return merged;
          });
        }
        if (payload.forecastItems && payload.forecastItems.length > 0) {
          setForecastItems(payload.forecastItems);
          dbStorage.setItem('mdc_forecast', payload.forecastItems);
          try { localStorage.setItem('mdc_forecast', JSON.stringify(payload.forecastItems)); } catch (e) {}
        }
        if (payload.allocations && payload.allocations.length > 0) {
          setAllocations(payload.allocations);
          dbStorage.setItem('mdc_allocations', payload.allocations);
          try { localStorage.setItem('mdc_allocations', JSON.stringify(payload.allocations)); } catch (e) {}
        }
        showToast(`Applied ${payload.forecastItems?.length || 0} forecasts and ${payload.allocations?.length || 0} allocations matching your workbook 100%!`, 'success');
        setActiveTab('forecast');
      } else if (type === 'FORECAST') {
        if (payload.parts && payload.parts.length > 0) {
          setParts(prev => {
            const getPartKey = (p) => `${p.part_number?.trim().toUpperCase()}:::${(p.description || '').trim().toLowerCase()}`;
            const map = new Map((prev || []).map(p => [getPartKey(p), p]));
            payload.parts.forEach(p => {
              const k = getPartKey(p);
              map.set(k, { ...(map.get(k) || {}), ...p });
            });
            const merged = Array.from(map.values());
            dbStorage.setItem('mdc_parts', merged);
            return merged;
          });
        }
        setForecastItems(payload.forecastItems || []);
        dbStorage.setItem('mdc_forecast', payload.forecastItems || []);
        if (payload.allocations && payload.allocations.length > 0) {
          setAllocations(payload.allocations);
          dbStorage.setItem('mdc_allocations', payload.allocations);
        }
        showToast(`Dynamic forecast matrix updated with ${payload.forecastItems?.length || 0} parts and fair allocations from "${sheetName}"!`, 'success');
        setActiveTab('forecast');
      } else if (type === 'ALLOCATION') {
        if (payload.sites && payload.sites.length > 0) {
          setSites(prev => {
            const map = new Map((prev || []).map(s => [s.code, s]));
            payload.sites.forEach(s => map.set(s.code, s));
            const merged = Array.from(map.values());
            dbStorage.setItem('mdc_sites', merged);
            return merged;
          });
        }
        if (payload.parts && payload.parts.length > 0) {
          setParts(prev => {
            const getPartKey = (p) => `${p.part_number?.trim().toUpperCase()}:::${(p.description || '').trim().toLowerCase()}`;
            const map = new Map((prev || []).map(p => [getPartKey(p), p]));
            payload.parts.forEach(p => {
              const k = getPartKey(p);
              map.set(k, { ...(map.get(k) || {}), ...p });
            });
            const merged = Array.from(map.values());
            dbStorage.setItem('mdc_parts', merged);
            return merged;
          });
        }
        setAllocations(payload.allocations || []);
        dbStorage.setItem('mdc_allocations', payload.allocations || []);
        showToast(`Dynamic Master Allocation updated with ${payload.allocations?.length || 0} parts from "${sheetName}"!`, 'success');
        setActiveTab('allocation');
      } else if (type === 'INVENTORY_STOCK') {
        setInventoryUnits(prev => {
          const next = [...(payload.units || []), ...(prev || [])];
          dbStorage.setItem('mdc_inventory', next);
          return next;
        });
        if (payload.parts && payload.parts.length > 0) {
          setParts(prev => {
            const getPartKey = (p) => `${p.part_number?.trim().toUpperCase()}:::${(p.description || '').trim().toLowerCase()}`;
            const map = new Map((prev || []).map(p => [getPartKey(p), p]));
            payload.parts.forEach(p => {
              const k = getPartKey(p);
              map.set(k, { ...(map.get(k) || {}), ...p });
            });
            const merged = Array.from(map.values());
            dbStorage.setItem('mdc_parts', merged);
            return merged;
          });
        }
        showToast(`Imported ${payload.units?.length || 0} inventory units!`, 'success');
        setActiveTab('dashboard');
      } else if (type === 'RAW_USAGE_PIPELINE') {
        if (payload.sites && payload.sites.length > 0) {
          setSites(payload.sites);
          dbStorage.setItem('mdc_sites', payload.sites);
          try { localStorage.setItem('mdc_sites', JSON.stringify(payload.sites)); } catch (e) {}
        }
        if (payload.parts && payload.parts.length > 0) {
          setParts(prev => {
            const getPartKey = (p) => `${p.part_number?.trim().toUpperCase()}:::${(p.description || '').trim().toLowerCase()}`;
            const map = new Map((prev || []).map(p => [getPartKey(p), p]));
            payload.parts.forEach(p => {
              const k = getPartKey(p);
              map.set(k, { ...(map.get(k) || {}), ...p });
            });
            const merged = Array.from(map.values());
            dbStorage.setItem('mdc_parts', merged);
            try { localStorage.setItem('mdc_parts', JSON.stringify(merged)); } catch (e) {}
            return merged;
          });
        }
        if (payload.records && payload.records.length > 0) {
          setRepairUsageRecords(prev => {
            const next = [...payload.records, ...(prev || [])];
            dbStorage.setItem('mdc_repair_usage', next);
            return next;
          });
        }
        if (payload.forecastItems && payload.forecastItems.length > 0) {
          setForecastItems(payload.forecastItems);
          dbStorage.setItem('mdc_forecast', payload.forecastItems);
          try { localStorage.setItem('mdc_forecast', JSON.stringify(payload.forecastItems)); } catch (e) {}
        }
        if (payload.allocations && payload.allocations.length > 0) {
          setAllocations(payload.allocations);
          dbStorage.setItem('mdc_allocations', payload.allocations);
          try { localStorage.setItem('mdc_allocations', JSON.stringify(payload.allocations)); } catch (e) {}
        }
        showToast(`Applied Forecasting & Master Allocation for ${payload.forecastItems?.length || 0} iPhone parts across all sites!`, 'success');
        setActiveTab('allocation');
      } else if (type === 'USAGE_RECORDS') {
        setRepairUsageRecords(prev => {
          const next = [...(payload.records || []), ...(prev || [])];
          dbStorage.setItem('mdc_repair_usage', next);
          return next;
        });
        showToast(`Imported ${payload.records?.length || 0} raw repair usage records!`, 'success');
      }

      // Auto-sync entire master dataset to Supabase Cloud so all users get it immediately
      const fullSyncSnapshot = {
        forecastItems: payload.forecastItems || forecastItems,
        allocations: payload.allocations || allocations,
        parts: payload.parts || parts,
        sites: payload.sites || sites,
        uploadAuditLogs: updatedAuditLogs
      };
      await syncAllDataToCloud(fullSyncSnapshot);
    } catch (err) {
      console.error('Error applying parsed dataset:', err);
      showToast(`Error applying data: ${err.message}`, 'error');
    }
  };

  const resetToDefaultData = () => {
    dbStorage.removeItem('mdc_is_cleared');
    dbStorage.setItem('mdc_forecast', seedData.forecastItems);
    dbStorage.setItem('mdc_allocations', seedData.allocations);
    dbStorage.setItem('mdc_inventory', seedData.inventoryUnits || []);
    dbStorage.setItem('mdc_parts', seedData.parts);
    dbStorage.setItem('mdc_sites', seedData.sites);
    dbStorage.setItem('mdc_categories', seedData.categories);

    try {
      localStorage.removeItem('mdc_is_cleared');
      localStorage.setItem('mdc_forecast', JSON.stringify(seedData.forecastItems));
      localStorage.setItem('mdc_allocations', JSON.stringify(seedData.allocations));
      localStorage.setItem('mdc_inventory', JSON.stringify(seedData.inventoryUnits || []));
      localStorage.setItem('mdc_parts', JSON.stringify(seedData.parts));
      localStorage.setItem('mdc_sites', JSON.stringify(seedData.sites));
      localStorage.setItem('mdc_categories', JSON.stringify(seedData.categories));
    } catch (e) {}

    setCategories(seedData.categories);
    setSites(seedData.sites);
    setParts(seedData.parts);
    setForecastItems(seedData.forecastItems);
    setAllocations(seedData.allocations);
    setInventoryUnits(seedData.inventoryUnits || []);
    setPurchaseOrders([
      {
        id: 'po-202608-01',
        po_number: 'PO-2026-AUG-BATTERY',
        order_date: '2026-08-01',
        expected_date: '2026-08-10',
        status: 'partially_received',
        remarks: 'Monthly Battery replenishment for iPhone 13-17 series',
        items: [
          { part_id: 'part-661-21991', part_number: '661-21991', description: 'Battery, iPhone 13', quantity_ordered: 175, quantity_received: 120, unit_price: 65 },
          { part_id: 'part-661-21996', part_number: '661-21996', description: 'Battery, iPhone 13 Pro', quantity_ordered: 22, quantity_received: 15, unit_price: 75 },
          { part_id: 'part-661-22294', part_number: '661-22294', description: 'Battery, iPhone 13 Pro Max', quantity_ordered: 24, quantity_received: 24, unit_price: 85 }
        ]
      },
      {
        id: 'po-202608-02',
        po_number: 'PO-2026-AUG-DISPLAY',
        order_date: '2026-08-02',
        expected_date: '2026-08-12',
        status: 'submitted',
        remarks: 'Monthly Display replenishment',
        items: [
          { part_id: 'part-661-21993', part_number: '661-21993', description: 'Display, iPhone 13 Pro', quantity_ordered: 3, quantity_received: 0, unit_price: 279 },
          { part_id: 'part-661-30401', part_number: '661-30401', description: 'Display, iPhone 14 Pro Max', quantity_ordered: 6, quantity_received: 0, unit_price: 379 }
        ]
      }
    ]);
    showToast('Loaded sample August 2026 dataset for demonstration', 'info');
  };

  const clearAllData = () => {
    dbStorage.setItem('mdc_is_cleared', true);
    dbStorage.setItem('mdc_forecast', []);
    dbStorage.setItem('mdc_allocations', []);
    dbStorage.setItem('mdc_inventory', []);
    dbStorage.setItem('mdc_pos', []);
    dbStorage.setItem('mdc_shipments', []);
    dbStorage.setItem('mdc_scan_logs', []);
    dbStorage.setItem('mdc_repair_usage', []);

    try {
      localStorage.setItem('mdc_is_cleared', 'true');
      localStorage.setItem('mdc_forecast', '[]');
      localStorage.setItem('mdc_allocations', '[]');
      localStorage.setItem('mdc_inventory', '[]');
      localStorage.setItem('mdc_recent_scans', '[]');
      localStorage.setItem('mdc_pos', '[]');
      localStorage.setItem('mdc_shipments', '[]');
      localStorage.setItem('mdc_scan_logs', '[]');
      localStorage.setItem('mdc_repair_usage', '[]');
    } catch (e) {
      console.warn('LocalStorage clear error:', e);
    }

    setForecastItems([]);
    setAllocations([]);
    setInventoryUnits([]);
    setPurchaseOrders([]);
    setShipments([]);
    setScanLogs([]);
    setRepairUsageRecords([]);
    showToast('Cleared all operational data (Forecasting, Allocation, and Receive Scan-In). Ready for fresh new stocks!', 'info');
  };

  // --- ACTIONS ---

  // 1. Scan-In Unit (Receiving into DC)
  const addScanInUnit = ({ partNumber, serialNumber, poId }) => {
    const cleanPN = partNumber.trim().toUpperCase();
    const cleanSerial = serialNumber.trim().toUpperCase();

    if (!cleanPN || !cleanSerial) {
      barcodeAudio.playError();
      showToast('Scan error: Missing part number or serial number', 'error');
      return { success: false, error: 'Missing part number or serial number' };
    }

    let part = parts.find(p => p.part_number.toUpperCase() === cleanPN);
    if (!part) {
      const newPart = {
        id: `part-${cleanPN}`,
        part_number: cleanPN,
        description: `Replacement Part (${cleanPN})`,
        category_id: 'cat-battery',
        iphone_model: 'iPhone Model',
        stocking_price: 100,
        is_active: true
      };
      setParts(prev => [newPart, ...prev]);
      part = newPart;
    }

    const existingUnit = inventoryUnits.find(u => u.serial_number.toUpperCase() === cleanSerial);
    if (existingUnit) {
      barcodeAudio.playError();
      showToast(`Duplicate Serial: ${cleanSerial} already exists in DC stock!`, 'error');
      logScan('RECEIVE_IN', cleanPN, cleanSerial, false, 'Duplicate serial number');
      return { success: false, error: `Duplicate serial number: ${cleanSerial}` };
    }

    const newUnit = {
      id: `unit-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      part_id: part.id,
      part_number: part.part_number,
      description: part.description,
      serial_number: cleanSerial,
      current_site_id: 'site-dc',
      po_id: poId || null,
      status: 'in_stock',
      box_number: 1,
      received_at: new Date().toISOString(),
      received_by: currentUser?.fullName || 'Warehouse Staff'
    };

    setInventoryUnits(prev => {
      const updated = [newUnit, ...(prev || []).filter(u => u.serial_number !== newUnit.serial_number)];
      try {
        localStorage.removeItem('mdc_is_cleared');
        localStorage.setItem('mdc_inventory', JSON.stringify(updated));
        localStorage.setItem('mdc_parts', JSON.stringify(parts));
        const currentRecent = JSON.parse(localStorage.getItem('mdc_recent_scans') || '[]');
        const updatedRecent = [newUnit, ...currentRecent.filter(u => u.serial_number !== newUnit.serial_number)].slice(0, 300);
        localStorage.setItem('mdc_recent_scans', JSON.stringify(updatedRecent));
      } catch (e) {
        console.warn('LocalStorage save error:', e);
      }
      dbStorage.setItem('mdc_inventory', updated);
      return updated;
    });

    // Direct Cloud Database Auto-Save (Multi-account & Real-time persisted)
    saveUnitsToSupabase([newUnit]);

    if (poId) {
      setPurchaseOrders(prev => prev.map(po => {
        if (po.id === poId) {
          const updatedItems = po.items.map(item => {
            if (item.part_number.toUpperCase() === cleanPN) {
              return { ...item, quantity_received: item.quantity_received + 1 };
            }
            return item;
          });
          const allReceived = updatedItems.every(it => it.quantity_received >= it.quantity_ordered);
          return {
            ...po,
            items: updatedItems,
            status: allReceived ? 'received' : 'partially_received'
          };
        }
        return po;
      }));
    }

    barcodeAudio.playSuccess();
    logScan('RECEIVE_IN', cleanPN, cleanSerial, true);
    showToast(`Received ${part.description} (${cleanSerial})`, 'success');
    return { success: true, unit: newUnit };
  };

  // Dedicated Robust Cloud Unit Persistence (Ensures foreign keys, table rows, and multi-user sync)
  const saveUnitsToSupabase = async (units) => {
    if (!supabase || !units || units.length === 0) return;
    setCloudSyncStatus(prev => ({ ...prev, isSaving: true }));
    try {
      // 1. Get or create part_category
      let defaultCatId = null;
      const { data: dbCats } = await supabase.from('part_categories').select('id').limit(1);
      if (dbCats && dbCats.length > 0) {
        defaultCatId = dbCats[0].id;
      } else {
        const { data: newCat } = await supabase
          .from('part_categories')
          .insert({ code: 'cat-general', name: 'General Parts' })
          .select('id')
          .maybeSingle();
        defaultCatId = newCat?.id || null;
      }

      // 2. Get or create DC Site
      let dcSiteId = null;
      const { data: dcSite } = await supabase.from('sites').select('id').or('is_dc.eq.true,code.eq.DC-MDC,code.eq.DC').limit(1).maybeSingle();
      if (dcSite?.id) {
        dcSiteId = dcSite.id;
      } else {
        const { data: anySite } = await supabase.from('sites').select('id').limit(1).maybeSingle();
        if (anySite?.id) {
          dcSiteId = anySite.id;
        } else {
          const { data: newSite } = await supabase
            .from('sites')
            .insert({ code: 'DC-MDC', name: 'Mobile Care Distribution Center', is_dc: true })
            .select('id')
            .maybeSingle();
          dcSiteId = newSite?.id || null;
        }
      }

      // 3. Upsert parts
      const { data: existingParts } = await supabase.from('parts').select('id, part_number');
      const pMap = new Map((existingParts || []).map(p => [p.part_number.toUpperCase(), p.id]));

      const unitRows = [];
      for (const u of units) {
        const cleanPN = String(u.part_number || '').trim().toUpperCase();
        const cleanSerial = String(u.serial_number || '').trim().toUpperCase();
        if (!cleanPN || !cleanSerial) continue;

        let pId = pMap.get(cleanPN);
        if (!pId) {
          const { data: createdPart } = await supabase.from('parts').upsert({
            part_number: cleanPN,
            description: u.description || `Part ${cleanPN}`,
            ...(defaultCatId ? { category_id: defaultCatId } : {})
          }, { onConflict: 'part_number' }).select('id').maybeSingle();
          pId = createdPart?.id;
          if (pId) pMap.set(cleanPN, pId);
        }

        if (pId && dcSiteId) {
          unitRows.push({
            part_id: pId,
            current_site_id: dcSiteId,
            serial_number: cleanSerial,
            status: u.status || 'in_stock',
            box_number: u.box_number || 1,
            notes: u.description || null,
            received_at: u.received_at || new Date().toISOString()
          });
        }
      }

      if (unitRows.length > 0) {
        await supabase.from('inventory_units').upsert(unitRows, { onConflict: 'serial_number' });
      }

      // 4. Synchronize to dc_intake_records table (under MDC_LIVE_DC_STOCK_INTAKE)
      const liveRecordId = 'MDC_LIVE_DC_STOCK_INTAKE';
      const { data: existingLiveRecord } = await supabase
        .from('dc_intake_records')
        .select('*')
        .eq('id', liveRecordId)
        .maybeSingle();

      const itemsMap = new Map();
      if (existingLiveRecord && Array.isArray(existingLiveRecord.items)) {
        existingLiveRecord.items.forEach(it => itemsMap.set(String(it.serial_number).toUpperCase(), it));
      }
      units.forEach(u => itemsMap.set(String(u.serial_number).toUpperCase(), {
        id: u.id || `unit-${u.serial_number}`,
        part_number: u.part_number,
        description: u.description,
        serial_number: u.serial_number,
        received_at: u.received_at || new Date().toISOString(),
        received_by: u.received_by || currentUser?.fullName || 'Warehouse Staff'
      }));

      const finalItems = Array.from(itemsMap.values());
      await supabase.from('dc_intake_records').upsert({
        id: liveRecordId,
        record_name: 'Live Scanned DC Stock',
        intake_date: new Date().toISOString().split('T')[0],
        total_units: finalItems.length,
        saved_by_name: currentUser?.fullName || 'Warehouse Staff',
        notes: 'Real-time live scanned stock intake pool',
        items: finalItems,
        updated_at: new Date().toISOString()
      }, { onConflict: 'id' });

      setCloudSyncStatus({ isSaving: false, lastSaved: new Date(), isOnline: true });
    } catch (err) {
      console.warn('saveUnitsToSupabase notice:', err.message);
      setCloudSyncStatus(prev => ({ ...prev, isSaving: false }));
    }
  };

  // 1.1 Batch Scan-In Units (from XLSX/CSV file upload)
  const batchAddScanInUnits = (itemsList = [], defaultPoId = null) => {
    if (!itemsList || itemsList.length === 0) {
      return { success: false, error: 'No units provided to import' };
    }

    let currentParts = [...parts];
    const newUnits = [];
    const newLogs = [];
    const newlyCreatedParts = [];
    const poMap = new Map();

    const seenSerials = new Set();
    const existingInventoryMap = new Map((inventoryUnits || []).map(u => [String(u.serial_number || '').toUpperCase(), u]));

    for (const item of itemsList) {
      const cleanPN = String(item.part_number || item.partNumber || '').trim().toUpperCase();
      const cleanSerial = String(item.serial_number || item.serialNumber || '').trim().toUpperCase();

      if (!cleanPN || !cleanSerial) continue;
      // Prevent internal duplicate within the same batch file
      if (seenSerials.has(cleanSerial)) continue;
      seenSerials.add(cleanSerial);

      let part = currentParts.find(p => p.part_number.toUpperCase() === cleanPN);
      if (!part) {
        const newPart = {
          id: `part-${cleanPN}`,
          part_number: cleanPN,
          description: item.description || `Replacement Part (${cleanPN})`,
          category_id: 'cat-battery',
          iphone_model: 'iPhone Model',
          stocking_price: 100,
          is_active: true
        };
        currentParts = [newPart, ...currentParts];
        newlyCreatedParts.push(newPart);
        part = newPart;
      }

      const assignedPoId = item.poId || defaultPoId || null;
      const existingUnit = existingInventoryMap.get(cleanSerial);

      const processedUnit = {
        id: existingUnit?.id || `unit-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
        part_id: part.id,
        part_number: part.part_number,
        description: item.description || part.description,
        serial_number: cleanSerial,
        current_site_id: 'site-dc',
        po_id: assignedPoId || existingUnit?.po_id || null,
        status: 'in_stock',
        box_number: item.boxNumber || existingUnit?.box_number || 1,
        received_at: existingUnit?.received_at || new Date().toISOString(),
        received_by: currentUser?.fullName || 'Warehouse Staff (Import)'
      };

      newUnits.push(processedUnit);

      if (assignedPoId) {
        if (!poMap.has(assignedPoId)) {
          poMap.set(assignedPoId, new Map());
        }
        const pnMap = poMap.get(assignedPoId);
        pnMap.set(cleanPN, (pnMap.get(cleanPN) || 0) + 1);
      }

      newLogs.push({
        id: `log-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
        scan_type: 'RECEIVE_IN_BATCH',
        part_number: cleanPN,
        serial_number: cleanSerial,
        user_name: currentUser?.fullName || 'Warehouse Staff (Import)',
        is_valid: true,
        error_message: null,
        created_at: new Date().toISOString()
      });
    }

    if (newUnits.length === 0) {
      return { success: false, error: 'No valid units found to import' };
    }

    if (newlyCreatedParts.length > 0) {
      setParts(currentParts);
    }

    setInventoryUnits(prev => {
      const existingSerialsMap = new Map((prev || []).map(u => [String(u.serial_number || '').toUpperCase(), u]));
      newUnits.forEach(u => existingSerialsMap.set(String(u.serial_number || '').toUpperCase(), u));
      const updated = Array.from(existingSerialsMap.values());
      try {
        localStorage.removeItem('mdc_is_cleared');
        localStorage.setItem('mdc_inventory', JSON.stringify(updated));
        localStorage.setItem('mdc_parts', JSON.stringify(currentParts));
        const currentRecent = JSON.parse(localStorage.getItem('mdc_recent_scans') || '[]');
        const recentMap = new Map(currentRecent.map(u => [String(u.serial_number || '').toUpperCase(), u]));
        newUnits.forEach(u => recentMap.set(String(u.serial_number || '').toUpperCase(), { ...u, isImported: true }));
        localStorage.setItem('mdc_recent_scans', JSON.stringify(Array.from(recentMap.values()).slice(0, 500)));
      } catch (e) {
        console.warn('LocalStorage batch save error:', e);
      }
      dbStorage.setItem('mdc_inventory', updated);
      return updated;
    });

    // Direct Cloud Database Batch Auto-Save
    saveUnitsToSupabase(newUnits);

    if (poMap.size > 0) {
      setPurchaseOrders(prev => prev.map(po => {
        if (poMap.has(po.id)) {
          const pnIncrements = poMap.get(po.id);
          const updatedItems = po.items.map(it => {
            const inc = pnIncrements.get(it.part_number.toUpperCase()) || 0;
            if (inc > 0) {
              return { ...it, quantity_received: it.quantity_received + inc };
            }
            return it;
          });
          const allReceived = updatedItems.every(it => it.quantity_received >= it.quantity_ordered);
          return {
            ...po,
            items: updatedItems,
            status: allReceived ? 'received' : 'partially_received'
          };
        }
        return po;
      }));
    }

    setScanLogs(prev => [...newLogs, ...prev].slice(0, 200));

    barcodeAudio.playSuccess();
    showToast(`Successfully batch-received ${newUnits.length} parts into DC Inventory!`, 'success');
    return { success: true, count: newUnits.length, units: newUnits };
  };

  // 1.2 Delete / Remove a Received Unit from Inventory & Database (if wrong details scanned)
  const deleteScanInUnit = async (serialNumber) => {
    const cleanSerial = String(serialNumber || '').trim().toUpperCase();
    const existing = inventoryUnits.find(u => String(u.serial_number || '').toUpperCase() === cleanSerial);

    if (!existing) {
      showToast(`Unit #${cleanSerial} not found in inventory`, 'error');
      return { success: false, error: 'Unit not found' };
    }

    // 1. Remove from inventoryUnits state
    const nextUnits = inventoryUnits.filter(u => String(u.serial_number || '').toUpperCase() !== cleanSerial);
    setInventoryUnits(nextUnits);

    // 2. Remove from dcIntakeRecords state & prepare records to sync in DB
    const recordsToUpdateInDb = [];
    setDcIntakeRecords(prev => {
      const nextRecords = (prev || []).map(rec => {
        if (Array.isArray(rec.items) && rec.items.some(it => String(it.serial_number || '').toUpperCase() === cleanSerial)) {
          const filteredItems = rec.items.filter(it => String(it.serial_number || '').toUpperCase() !== cleanSerial);
          const updatedRec = {
            ...rec,
            items: filteredItems,
            total_units: filteredItems.length,
            updated_at: new Date().toISOString()
          };
          recordsToUpdateInDb.push(updatedRec);
          return updatedRec;
        }
        return rec;
      });
      try {
        localStorage.setItem('mdc_dc_intake_records', JSON.stringify(nextRecords.slice(0, 100)));
      } catch (e) {}
      return nextRecords;
    });

    // 3. Remove from LocalStorage and IndexedDB
    try {
      localStorage.setItem('mdc_inventory', JSON.stringify(nextUnits));
      dbStorage.setItem('mdc_inventory', nextUnits);
      const recent = JSON.parse(localStorage.getItem('mdc_recent_scans') || '[]');
      const filteredRecent = recent.filter(u => String(u.serial_number || '').toUpperCase() !== cleanSerial);
      localStorage.setItem('mdc_recent_scans', JSON.stringify(filteredRecent));
    } catch (e) {
      console.warn('LocalStorage delete error:', e);
    }

    // 4. Remove from Supabase Cloud Database tables (inventory_units & dc_intake_records)
    if (supabase) {
      (async () => {
        setCloudSyncStatus(prev => ({ ...prev, isSaving: true }));
        try {
          // Delete from inventory_units
          await supabase.from('inventory_units').delete().eq('serial_number', existing.serial_number);

          // Also remove from MDC_LIVE_DC_STOCK_INTAKE
          const { data: liveRec } = await supabase
            .from('dc_intake_records')
            .select('*')
            .eq('id', 'MDC_LIVE_DC_STOCK_INTAKE')
            .maybeSingle();

          if (liveRec && Array.isArray(liveRec.items)) {
            const filteredLive = liveRec.items.filter(it => String(it.serial_number || '').toUpperCase() !== cleanSerial);
            await supabase.from('dc_intake_records').upsert({
              ...liveRec,
              items: filteredLive,
              total_units: filteredLive.length,
              updated_at: new Date().toISOString()
            });
          }
          
          // Update affected intake records in Supabase
          for (const rec of recordsToUpdateInDb) {
            await supabase.from('dc_intake_records').upsert({
              id: rec.id,
              record_name: rec.record_name,
              intake_date: rec.intake_date,
              po_id: rec.po_id && !String(rec.po_id).startsWith('po-') ? rec.po_id : null,
              po_number: rec.po_number,
              supplier: rec.supplier,
              total_units: rec.total_units,
              saved_by_name: rec.saved_by_name,
              saved_by_user_id: rec.saved_by_user_id,
              notes: rec.notes,
              category_breakdown: rec.category_breakdown,
              items: rec.items,
              updated_at: rec.updated_at
            });
          }
          setCloudSyncStatus({ isSaving: false, lastSaved: new Date(), isOnline: true });
        } catch (dbErr) {
          console.warn('Supabase delete inventory_unit notice:', dbErr.message);
          setCloudSyncStatus(prev => ({ ...prev, isSaving: false }));
        }
      })();
    }

    // 4. If linked to a PO, decrement received quantity on that PO
    if (existing.po_id) {
      setPurchaseOrders(prev => prev.map(po => {
        if (po.id === existing.po_id) {
          const updatedItems = (po.items || []).map(it => {
            if (it.part_number.toUpperCase() === existing.part_number.toUpperCase() && it.quantity_received > 0) {
              return { ...it, quantity_received: it.quantity_received - 1 };
            }
            return it;
          });
          const allReceived = updatedItems.every(it => it.quantity_received >= it.quantity_ordered);
          const anyReceived = updatedItems.some(it => it.quantity_received > 0);
          return {
            ...po,
            items: updatedItems,
            status: allReceived ? 'received' : anyReceived ? 'partially_received' : 'ordered'
          };
        }
        return po;
      }));
    }

    logScan('DELETE_RECEIVED_UNIT', existing.part_number, cleanSerial, true, 'Manually deleted by operator');
    barcodeAudio.playSuccess();
    showToast(`Deleted part ${existing.part_number} (${cleanSerial}) from inventory and database`, 'info');
    return { success: true };
  };

  // 2. Scan-Out Unit (Adding to Packing List)
  const addScanOutUnit = ({ shipmentId, siteId, partNumber, serialNumber, boxNumber = 1 }) => {
    const cleanPN = partNumber.trim().toUpperCase();
    const cleanSerial = serialNumber.trim().toUpperCase();

    const unitIndex = inventoryUnits.findIndex(u => 
      u.serial_number.toUpperCase() === cleanSerial && 
      u.part_number.toUpperCase() === cleanPN
    );

    if (unitIndex === -1) {
      barcodeAudio.playError();
      showToast(`Unit not found in stock: ${cleanPN} / ${cleanSerial}`, 'error');
      logScan('PACK_OUT', cleanPN, cleanSerial, false, 'Unit not found in stock');
      return { success: false, error: 'Unit not found in DC stock' };
    }

    const unit = inventoryUnits[unitIndex];
    if (unit.status !== 'in_stock' && unit.status !== 'allocated') {
      barcodeAudio.playError();
      showToast(`Unit ${cleanSerial} cannot be scanned out (Status: ${unit.status})`, 'error');
      logScan('PACK_OUT', cleanPN, cleanSerial, false, `Invalid status: ${unit.status}`);
      return { success: false, error: `Unit is already ${unit.status}` };
    }

    const updatedUnits = [...inventoryUnits];
    updatedUnits[unitIndex] = {
      ...unit,
      status: 'packed',
      current_site_id: siteId,
      box_number: boxNumber,
      shipped_at: new Date().toISOString(),
      shipped_by: currentUser?.fullName || 'Warehouse Staff'
    };
    setInventoryUnits(updatedUnits);
    try {
      localStorage.setItem('mdc_inventory', JSON.stringify(updatedUnits));
    } catch (e) {
      console.warn('LocalStorage save error in addScanOutUnit:', e);
    }
    dbStorage.setItem('mdc_inventory', updatedUnits);

    if (supabase) {
      (async () => {
        setCloudSyncStatus(prev => ({ ...prev, isSaving: true }));
        try {
          await supabase
            .from('inventory_units')
            .update({
              status: 'packed',
              box_number: boxNumber,
              shipped_at: new Date().toISOString()
            })
            .eq('serial_number', cleanSerial);
          setCloudSyncStatus({ isSaving: false, lastSaved: new Date(), isOnline: true });
        } catch (dbErr) {
          console.warn('Supabase pack unit note:', dbErr.message);
          setCloudSyncStatus(prev => ({ ...prev, isSaving: false }));
        }
      })();
    }

    const itemToAdd = {
      part_number: unit.part_number,
      description: unit.description,
      serial_number: unit.serial_number,
      box_number: boxNumber
    };

    setShipments(prev => prev.map(sh => {
      if (sh.id === shipmentId) {
        return {
          ...sh,
          items: [...(sh.items || []), itemToAdd]
        };
      }
      return sh;
    }));

    barcodeAudio.playSuccess();
    logScan('PACK_OUT', cleanPN, cleanSerial, true);
    showToast(`Packed: ${unit.description} (#${cleanSerial}) into Box ${boxNumber}`, 'success');
    return { success: true, item: itemToAdd };
  };

  // 2.1 Batch Scan-Out Units (from XLSX / CSV file upload)
  const batchAddScanOutUnits = ({ shipmentId, siteId, items }) => {
    if (!items || items.length === 0) {
      return { success: false, error: 'No items to pack' };
    }

    const itemsToAdd = [];
    const newLogs = [];
    const updatedSerialsMap = new Map();

    for (const item of items) {
      const cleanPN = String(item.partNumber || '').trim().toUpperCase();
      const cleanSerial = String(item.serialNumber || '').trim().toUpperCase();
      const box = item.boxNumber || 1;
      const targetSiteId = item.siteId || siteId;

      const unit = inventoryUnits.find(u =>
        u.serial_number.toUpperCase() === cleanSerial &&
        (u.status === 'in_stock' || u.status === 'allocated')
      );

      if (unit) {
        updatedSerialsMap.set(unit.serial_number.toUpperCase(), {
          ...unit,
          status: 'packed',
          current_site_id: targetSiteId,
          box_number: box,
          shipped_at: new Date().toISOString(),
          shipped_by: currentUser?.fullName || 'Warehouse Staff (Import)'
        });

        itemsToAdd.push({
          part_number: unit.part_number,
          description: unit.description,
          serial_number: unit.serial_number,
          box_number: box
        });

        newLogs.push({
          id: `log-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
          scan_type: 'PACK_OUT_BATCH',
          part_number: cleanPN || unit.part_number,
          serial_number: cleanSerial,
          user_name: currentUser?.fullName || 'Warehouse Staff (Import)',
          is_valid: true,
          error_message: null,
          created_at: new Date().toISOString()
        });
      }
    }

    if (itemsToAdd.length === 0) {
      return { success: false, error: 'No matching in-stock units found to pack.' };
    }

    // Update inventoryUnits
    const updatedInventory = inventoryUnits.map(u => {
      const match = updatedSerialsMap.get(u.serial_number.toUpperCase());
      return match ? match : u;
    });
    setInventoryUnits(updatedInventory);
    try {
      localStorage.setItem('mdc_inventory', JSON.stringify(updatedInventory));
    } catch (e) {
      console.warn('LocalStorage save error in batchAddScanOutUnits:', e);
    }
    dbStorage.setItem('mdc_inventory', updatedInventory);

    if (supabase) {
      (async () => {
        setCloudSyncStatus(prev => ({ ...prev, isSaving: true }));
        try {
          const serials = itemsToAdd.map(it => it.serial_number);
          await supabase
            .from('inventory_units')
            .update({ status: 'packed', shipped_at: new Date().toISOString() })
            .in('serial_number', serials);
          setCloudSyncStatus({ isSaving: false, lastSaved: new Date(), isOnline: true });
        } catch (dbErr) {
          console.warn('Supabase batch pack note:', dbErr.message);
          setCloudSyncStatus(prev => ({ ...prev, isSaving: false }));
        }
      })();
    }

    // Update shipments
    let targetShipmentNumber = '';
    setShipments(prev => prev.map(sh => {
      if (sh.id === shipmentId) {
        targetShipmentNumber = sh.invoice_ref || sh.shipment_number;
        return {
          ...sh,
          items: [...(sh.items || []), ...itemsToAdd]
        };
      }
      return sh;
    }));

    // Update logs
    setScanLogs(prev => [...newLogs, ...prev].slice(0, 300));

    barcodeAudio.playSuccess();
    showToast(`Batch packed ${itemsToAdd.length} units into ${targetShipmentNumber || 'Shipment'}!`, 'success');
    return { success: true, count: itemsToAdd.length, items: itemsToAdd };
  };

  // 2.15 Remove single unit from Packing List and return it to DC in_stock inventory
  const removeScanOutUnit = ({ shipmentId, serialNumber }) => {
    const cleanSerial = String(serialNumber || '').trim().toUpperCase();
    if (!cleanSerial) return { success: false };

    let revertedPart = null;
    const updatedInventory = inventoryUnits.map(u => {
      if (u.serial_number && u.serial_number.toUpperCase() === cleanSerial) {
        revertedPart = u;
        return {
          ...u,
          status: 'in_stock',
          current_site_id: 'site-dc',
          box_number: 1,
          shipped_at: null,
          shipped_by: null
        };
      }
      return u;
    });

    setInventoryUnits(updatedInventory);

    setShipments(prev => prev.map(sh => {
      if (sh.id === shipmentId) {
        return {
          ...sh,
          items: (sh.items || []).filter(it => String(it.serial_number || '').toUpperCase() !== cleanSerial)
        };
      }
      return sh;
    }));

    try {
      localStorage.setItem('mdc_inventory', JSON.stringify(updatedInventory));
    } catch (e) {
      console.warn('LocalStorage save error in removeScanOutUnit:', e);
    }
    dbStorage.setItem('mdc_inventory', updatedInventory);

    // Direct Cloud Database Sync
    if (supabase) {
      (async () => {
        setCloudSyncStatus(prev => ({ ...prev, isSaving: true }));
        try {
          let dcSiteId = null;
          const { data: dcSite } = await supabase.from('sites').select('id').or('is_dc.eq.true,code.eq.DC-MDC,code.eq.DC').limit(1).maybeSingle();
          if (dcSite?.id) dcSiteId = dcSite.id;
          else {
            const { data: anySite } = await supabase.from('sites').select('id').limit(1).maybeSingle();
            dcSiteId = anySite?.id;
          }

          if (dcSiteId) {
            await supabase
              .from('inventory_units')
              .update({
                status: 'in_stock',
                current_site_id: dcSiteId,
                box_number: 1,
                shipped_at: null,
                shipped_by: null
              })
              .eq('serial_number', cleanSerial);
          }
          setCloudSyncStatus({ isSaving: false, lastSaved: new Date(), isOnline: true });
        } catch (dbErr) {
          console.warn('Supabase unit revert error:', dbErr.message);
          setCloudSyncStatus(prev => ({ ...prev, isSaving: false }));
        }
      })();
    }

    showToast(`Removed #${cleanSerial} from packing list. Returned to DC In-Stock inventory.`, 'info');
    return { success: true, unit: revertedPart };
  };

  // 2.2 Clear / Unpack Items from a Specific Shipment Draft (Returns all parts back to DC In-Stock inventory)
  const clearShipmentDraftItems = (shipmentIdOrObj, explicitItems = []) => {
    let targetShipmentId = typeof shipmentIdOrObj === 'object' ? (shipmentIdOrObj.shipmentId || shipmentIdOrObj.id) : shipmentIdOrObj;
    let itemsToProcess = [];

    if (Array.isArray(explicitItems) && explicitItems.length > 0) {
      itemsToProcess = explicitItems;
    } else if (typeof shipmentIdOrObj === 'object' && Array.isArray(shipmentIdOrObj.items) && shipmentIdOrObj.items.length > 0) {
      itemsToProcess = shipmentIdOrObj.items;
    } else {
      const targetShipment = shipments.find(s => s.id === targetShipmentId);
      if (targetShipment && Array.isArray(targetShipment.items)) {
        itemsToProcess = targetShipment.items;
      }
    }

    if (!itemsToProcess || itemsToProcess.length === 0) {
      return { success: true, count: 0 };
    }

    const serialsToRevert = new Set(
      itemsToProcess.map(it => String(it.serial_number || it.serialNumber || '').trim().toUpperCase()).filter(Boolean)
    );

    if (serialsToRevert.size === 0) {
      return { success: true, count: 0 };
    }

    // Revert units status back to in_stock
    const updatedInventory = inventoryUnits.map(u => {
      if (serialsToRevert.has(String(u.serial_number || '').toUpperCase())) {
        return {
          ...u,
          status: 'in_stock',
          current_site_id: 'site-dc',
          box_number: 1,
          shipped_at: null,
          shipped_by: null
        };
      }
      return u;
    });

    setInventoryUnits(updatedInventory);
    try {
      localStorage.setItem('mdc_inventory', JSON.stringify(updatedInventory));
      localStorage.removeItem('mdc_active_pack_draft');
    } catch (e) {
      console.warn('LocalStorage save error:', e);
    }
    dbStorage.setItem('mdc_inventory', updatedInventory);

    // If targetShipment was in shipments, remove or clear it
    if (targetShipmentId) {
      const updatedShipments = shipments.filter(s => s.id !== targetShipmentId);
      setShipments(updatedShipments);
      dbStorage.setItem('mdc_shipments', updatedShipments);
      try {
        localStorage.setItem('mdc_shipments', JSON.stringify(updatedShipments));
      } catch (e) {}
    }

    // Direct Cloud Database Reversion
    if (supabase) {
      (async () => {
        setCloudSyncStatus(prev => ({ ...prev, isSaving: true }));
        try {
          const serialsArray = Array.from(serialsToRevert);
          let dcSiteId = null;
          const { data: dcSite } = await supabase.from('sites').select('id').or('is_dc.eq.true,code.eq.DC-MDC,code.eq.DC').limit(1).maybeSingle();
          if (dcSite?.id) {
            dcSiteId = dcSite.id;
          } else {
            const { data: anySite } = await supabase.from('sites').select('id').limit(1).maybeSingle();
            dcSiteId = anySite?.id;
          }

          if (dcSiteId && serialsArray.length > 0) {
            await supabase
              .from('inventory_units')
              .update({
                status: 'in_stock',
                current_site_id: dcSiteId,
                box_number: 1,
                shipped_at: null,
                shipped_by: null
              })
              .in('serial_number', serialsArray);
          }
          setCloudSyncStatus({ isSaving: false, lastSaved: new Date(), isOnline: true });
        } catch (dbErr) {
          console.warn('Supabase inventory revert error:', dbErr.message);
          setCloudSyncStatus(prev => ({ ...prev, isSaving: false }));
        }
      })();
    }

    showToast(`Cleared ${serialsToRevert.size} packed items from draft. Units returned to In-Stock DC inventory!`, 'info');
    return { success: true, count: serialsToRevert.size };
  };

  // 2.2b Explicit Delete of a Saved Shipment from Database History
  const deleteShipment = (shipmentId) => {
    const target = shipments.find(s => s.id === shipmentId);
    if (!target) return { success: false, error: 'Shipment not found' };

    // Revert packed items back to in_stock if not yet delivered
    if (target.items && target.items.length > 0 && target.status !== 'delivered') {
      const serialsToRevert = new Set(target.items.map(it => it.serial_number.toUpperCase()));
      const updatedInventory = inventoryUnits.map(u => {
        if (serialsToRevert.has(u.serial_number.toUpperCase())) {
          return {
            ...u,
            status: 'in_stock',
            current_site_id: 'site-dc',
            box_number: 1,
            shipped_at: null,
            shipped_by: null
          };
        }
        return u;
      });
      setInventoryUnits(updatedInventory);
      dbStorage.setItem('mdc_inventory', updatedInventory);
      try { localStorage.setItem('mdc_inventory', JSON.stringify(updatedInventory)); } catch (e) {}
    }

    const nextList = shipments.filter(s => s.id !== shipmentId);
    setShipments(nextList);
    dbStorage.setItem('mdc_shipments', nextList);
    try { localStorage.setItem('mdc_shipments', JSON.stringify(nextList)); } catch (e) {}

    showToast(`Deleted manifest ${target.invoice_ref || target.shipment_number} from database`, 'info');
    return { success: true };
  };

  // 2.3 Batch Import Shipments / Manifests
  const batchImportShipments = (newShipmentsList) => {
    if (!newShipmentsList || newShipmentsList.length === 0) {
      return { success: false, error: 'No shipments to import' };
    }

    setShipments(prev => [...newShipmentsList, ...prev]);

    // Immediate storage
    try {
      const updated = [...newShipmentsList, ...shipments];
      localStorage.setItem('mdc_shipments', JSON.stringify(updated));
    } catch (e) {
      console.warn('LocalStorage save error:', e);
    }

    showToast(`Successfully imported ${newShipmentsList.length} shipment manifests!`, 'success');
    return { success: true, count: newShipmentsList.length };
  };

  // 2.4 Clear All Shipments & Packing Records
  const clearAllShipmentsData = () => {
    // Revert all packed units back to in_stock
    const updatedInventory = inventoryUnits.map(u => {
      if (u.status === 'packed' || u.status === 'shipped') {
        return {
          ...u,
          status: 'in_stock',
          current_site_id: 'site-dc',
          shipped_at: null,
          shipped_by: null
        };
      }
      return u;
    });
    setInventoryUnits(updatedInventory);
    setShipments([]);

    try {
      localStorage.setItem('mdc_inventory', JSON.stringify(updatedInventory));
      localStorage.removeItem('mdc_shipments');
      localStorage.removeItem('mdc_active_pack_draft');
    } catch (e) {
      console.warn('LocalStorage save error:', e);
    }

    showToast('Cleared all shipment records and restored parts to DC stock.', 'info');
  };

  const logScan = (scanType, partNumber, serialNumber, isValid, errorMessage = null) => {
    const logEntry = {
      id: `log-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      scan_type: scanType,
      part_number: partNumber,
      serial_number: serialNumber,
      user_name: currentUser?.fullName || 'Staff',
      is_valid: isValid,
      error_message: errorMessage,
      created_at: new Date().toISOString()
    };
    setScanLogs(prev => [logEntry, ...prev.slice(0, 199)]);
  };

  const saveShipment = (shipmentData) => {
    if (shipmentData.id && shipments.some(s => s.id === shipmentData.id)) {
      setShipments(prev => prev.map(s => s.id === shipmentData.id ? shipmentData : s));
      showToast(`Shipment ${shipmentData.invoice_ref || shipmentData.shipment_number} updated`, 'success');
    } else {
      const newShipment = {
        ...shipmentData,
        id: shipmentData.id || `ship-${Date.now()}`,
        shipment_number: shipmentData.shipment_number || `SHIP-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(shipments.length + 1).padStart(3, '0')}`,
        created_at: new Date().toISOString()
      };
      setShipments(prev => [newShipment, ...prev]);
      showToast(`Created Packing List Manifest: ${newShipment.shipment_number}`, 'success');
      return newShipment;
    }
  };

  const updateForecastOverride = (partId, overrideVal) => {
    setForecastItems(prev => prev.map(item => {
      if (item.part_id === partId) {
        const override = overrideVal === '' || overrideVal === null ? null : parseInt(overrideVal);
        const finalForecast = override !== null ? override : item.computed_forecast;
        const rec = calculateRecommendedOrder(item.computed_forecast, 0.05, override);
        return {
          ...item,
          admin_override: override,
          final_forecast: finalForecast,
          recommended_order: rec.recommendedOrder
        };
      }
      return item;
    }));
  };

  const updateSiteAllocation = (partId, siteIdOrCode, newQty) => {
    setAllocations(prev => prev.map(item => {
      if (item.part_id === partId || item.part_number === partId) {
        const foundSite = sites.find(s => s.id === siteIdOrCode || s.code === siteIdOrCode);
        const sId = foundSite?.id || siteIdOrCode;
        const sCode = foundSite?.code || siteIdOrCode;
        const val = Math.max(0, parseInt(newQty) || 0);

        const updatedSiteQty = {
          ...(item.site_quantities || {}),
          [sId]: val,
          ...(sCode ? { [sCode]: val } : {})
        };

        const activeServiceSites = (sites || []).filter(s => !s.is_dc);
        const newTotal = activeServiceSites.reduce((sum, s) => {
          return sum + (updatedSiteQty[s.id] ?? updatedSiteQty[s.code] ?? 0);
        }, 0);

        const totalCost = newTotal * (item.stocking_price || 0);
        const split = calculateWeeklySplit(newTotal, totalCost);
        return {
          ...item,
          site_quantities: updatedSiteQty,
          total_allocated_qty: newTotal,
          total_stock_cost: totalCost,
          w1_qty: split.w1_qty,
          w2_qty: split.w2_qty,
          w3_qty: split.w3_qty,
          w4_qty: split.w4_qty,
          w1_cost: split.w1_cost,
          w2_cost: split.w2_cost,
          w3_cost: split.w3_cost,
          w4_cost: split.w4_cost
        };
      }
      return item;
    }));
  };

  const runAutoAllocation = (partId, availableStock) => {
    const part = parts.find(p => p.id === partId);
    if (!part) return;

    const siteDemands = sites.filter(s => !s.is_dc).map(s => {
      const currentAlloc = allocations.find(a => a.part_id === partId);
      const histDemand = currentAlloc?.site_quantities?.[s.id] || 1;
      return {
        siteId: s.id,
        historicalDemand: histDemand
      };
    });

    const allocatedResults = calculateProportionalAllocation(availableStock, siteDemands);
    const siteQuantities = {};
    allocatedResults.forEach(res => {
      siteQuantities[res.siteId] = res.allocatedQty;
    });

    const totalCost = availableStock * (part.stocking_price || 0);
    const split = calculateWeeklySplit(availableStock, totalCost);

    setAllocations(prev => {
      const exists = prev.some(a => a.part_id === partId);
      const newAllocObj = {
        part_id: partId,
        part_number: part.part_number,
        description: part.description,
        category_id: part.category_id,
        stocking_price: part.stocking_price,
        exchange_price: part.exchange_price,
        total_allocated_qty: availableStock,
        total_stock_cost: totalCost,
        w1_qty: split.w1_qty,
        w2_qty: split.w2_qty,
        w3_qty: split.w3_qty,
        w4_qty: split.w4_qty,
        w1_cost: split.w1_cost,
        w2_cost: split.w2_cost,
        w3_cost: split.w3_cost,
        w4_cost: split.w4_cost,
        site_quantities: siteQuantities
      };
      if (exists) {
        return prev.map(a => a.part_id === partId ? newAllocObj : a);
      }
      return [...prev, newAllocObj];
    });

    showToast(`Auto-allocated ${availableStock} units of ${part.description} across ${siteDemands.length} sites`, 'success');
  };

  const savePart = (partData) => {
    const cleanPN = String(partData.part_number || '').trim().toUpperCase();
    const cleanDesc = String(partData.description || '').trim();
    if (!cleanPN) return { success: false, error: 'Missing part number' };

    setParts(prev => {
      let updated;
      // Match by explicit unique ID first, or by BOTH part_number AND description
      const matchIndex = prev.findIndex(p =>
        (partData.id && p.id === partData.id) ||
        (p.part_number?.toUpperCase() === cleanPN && p.description?.trim().toLowerCase() === cleanDesc.toLowerCase())
      );

      if (matchIndex >= 0) {
        const existing = prev[matchIndex];
        const updatedPart = {
          ...existing,
          ...partData,
          id: existing.id || partData.id || `part-${cleanPN}-${Date.now()}`,
          part_number: cleanPN,
          description: cleanDesc || existing.description,
          iphone_model: partData.iphone_model?.trim() || existing.iphone_model || 'iPhone',
          stocking_price: parseFloat(partData.stocking_price) || 0,
          exchange_price: parseFloat(partData.exchange_price) || 0,
          updated_at: new Date().toISOString()
        };
        updated = [...prev];
        updated[matchIndex] = updatedPart;
      } else {
        const newPart = {
          ...partData,
          id: partData.id || `part-${cleanPN}-${Math.random().toString(36).substring(2, 8)}`,
          part_number: cleanPN,
          description: cleanDesc || `Part (${cleanPN})`,
          iphone_model: partData.iphone_model?.trim() || 'iPhone',
          category_id: partData.category_id || 'cat-battery',
          stocking_price: parseFloat(partData.stocking_price) || 0,
          exchange_price: parseFloat(partData.exchange_price) || 0,
          is_active: partData.is_active ?? true,
          created_at: new Date().toISOString()
        };
        updated = [newPart, ...prev];
      }

      try {
        localStorage.setItem('mdc_parts', JSON.stringify(updated));
      } catch (e) {
        console.warn('LocalStorage save error in savePart:', e);
      }

      return updated;
    });

    // Background Supabase sync
    if (supabase) {
      (async () => {
        try {
          await supabase.from('parts').upsert({
            ...(partData.id && !partData.id.startsWith('part-') ? { id: partData.id } : {}),
            part_number: cleanPN,
            description: cleanDesc,
            iphone_model: partData.iphone_model || 'iPhone',
            stocking_price: parseFloat(partData.stocking_price) || 0,
            is_active: partData.is_active ?? true
          });
        } catch (e) {
          console.warn('Supabase part save note:', e.message);
        }
      })();
    }

    showToast(`Saved part ${cleanPN} (${cleanDesc || 'Standard'}) in catalog`, 'success');
    return { success: true };
  };

  const deletePart = (partIdOrObj) => {
    let deletedPart = null;
    setParts(prev => {
      let targetId = typeof partIdOrObj === 'object' ? partIdOrObj.id : partIdOrObj;
      let targetPN = typeof partIdOrObj === 'object' ? partIdOrObj.part_number : null;
      let targetDesc = typeof partIdOrObj === 'object' ? partIdOrObj.description : null;

      const match = prev.find(p =>
        (targetId && p.id === targetId) ||
        (targetPN && targetDesc && p.part_number === targetPN && p.description === targetDesc) ||
        (!targetDesc && targetPN && p.part_number === targetPN)
      );

      if (!match) return prev;
      deletedPart = match;
      const updated = prev.filter(p => p.id !== match.id);

      try {
        localStorage.setItem('mdc_parts', JSON.stringify(updated));
      } catch (e) {
        console.warn('LocalStorage save error in deletePart:', e);
      }

      return updated;
    });

    if (deletedPart) {
      if (supabase) {
        (async () => {
          try {
            if (deletedPart.id && !deletedPart.id.startsWith('part-')) {
              await supabase.from('parts').delete().eq('id', deletedPart.id);
            } else {
              await supabase.from('parts').delete().match({ part_number: deletedPart.part_number, description: deletedPart.description });
            }
          } catch (e) {
            console.warn('Supabase part delete note:', e.message);
          }
        })();
      }
      showToast(`Deleted part ${deletedPart.part_number} (${deletedPart.description}) from catalog`, 'info');
      return { success: true, part: deletedPart };
    }
    return { success: false, error: 'Part not found' };
  };

  const saveSite = (siteData) => {
    if (siteData.id) {
      setSites(prev => prev.map(s => s.id === siteData.id ? siteData : s));
      showToast(`Updated site ${siteData.name}`, 'success');
    } else {
      const newSite = {
        ...siteData,
        id: `site-${Date.now()}`,
        is_active: true
      };
      setSites(prev => [...prev, newSite]);
      showToast(`Added site ${newSite.name}`, 'success');
    }
  };

  const refreshSitesFromCloud = async () => {
    if (!supabase) {
      // If no Supabase connection, apply seed data directory directly
      applyPmgDirectoryToSites();
      return;
    }
    try {
      showToast('Fetching latest site addresses from Supabase...', 'info');
      const { data: dbSites, error } = await supabase.from('sites').select('*');
      if (error) throw error;

      if (dbSites && dbSites.length > 0) {
        setSites(prev => {
          const map = new Map((prev || []).map(s => [s.code, s]));
          dbSites.forEach(s => {
            const existing = map.get(s.code);
            map.set(s.code, {
              ...(existing || {}),
              id: s.id || existing?.id,
              code: s.code,
              name: s.name || existing?.name,
              region: s.region || existing?.region || 'Metro Manila',
              address: s.address || s.full_address || existing?.address,
              full_address: s.full_address || s.address || existing?.full_address,
              contact_person: s.contact_person || existing?.contact_person,
              contact_phone: s.contact_phone || existing?.contact_phone,
              contact_email: s.contact_email || existing?.contact_email,
              ship_to: s.ship_to || existing?.ship_to,
              sold_to: s.sold_to || existing?.sold_to,
              invoice_prefix: s.invoice_prefix || existing?.invoice_prefix,
              is_dc: s.is_dc ?? existing?.is_dc ?? false,
              is_active: s.is_active ?? existing?.is_active ?? true
            });
          });
          const merged = Array.from(map.values());
          try { localStorage.setItem('mdc_sites', JSON.stringify(merged)); } catch (e) {}
          dbStorage.setItem('mdc_sites', merged);
          return merged;
        });
        showToast(`Successfully refreshed ${dbSites.length} sites from cloud database!`, 'success');
      } else {
        applyPmgDirectoryToSites();
      }
    } catch (err) {
      console.warn('Supabase site fetch error:', err);
      applyPmgDirectoryToSites();
    }
  };

  const applyPmgDirectoryToSites = () => {
    const seedMap = new Map((seedData.sites || []).map(s => [s.code, s]));
    setSites(prev => {
      const updated = (prev || []).map(s => {
        const seed = seedMap.get(s.code);
        return seed ? { ...s, ...seed } : s;
      });
      try { localStorage.setItem('mdc_sites', JSON.stringify(updated)); } catch (e) {}
      dbStorage.setItem('mdc_sites', updated);
      return updated;
    });
    showToast('Applied PMG Directory addresses to all branches!', 'success');
  };

  const syncAllDataToCloud = async (overrideData = null) => {
    if (!supabase) {
      showToast('Supabase client is not connected', 'error');
      return { success: false };
    }

    const currentForecast = overrideData?.forecastItems || forecastItems;
    const currentAllocs = overrideData?.allocations || allocations;
    const currentParts = overrideData?.parts || parts;
    const currentSites = overrideData?.sites || sites;
    const currentUploadLogs = overrideData?.uploadAuditLogs || uploadAuditLogs;

    try {
      showToast('Syncing master data to Supabase cloud...', 'info');

      // 1. Sync Live Master Record Snapshot so all users across the system receive it instantly
      try {
        const liveSnapshotPayload = {
          id: LIVE_MASTER_RECORD_ID,
          record_type: 'both',
          period_label: `${activePeriod?.label || 'September 2026'} Live Master State`,
          period_year: activePeriod?.year || 2026,
          period_month: activePeriod?.month || 9,
          saved_by_name: currentUser?.fullName || 'Superadmin User',
          saved_by_user_id: null,
          notes: 'Real-time multi-user synchronized Distribution Center state',
          snapshot_data: {
            forecastItems: currentForecast || [],
            allocations: currentAllocs || [],
            parts: currentParts || [],
            sites: currentSites || [],
            uploadAuditLogs: currentUploadLogs || []
          },
          updated_at: new Date().toISOString()
        };

        await supabase.from('saved_records').upsert([liveSnapshotPayload], { onConflict: 'id' });
      } catch (err) {
        console.warn('Live master snapshot sync notice:', err);
      }

      // 2. Sync Categories
      if (categories && categories.length > 0) {
        try {
          const catRows = categories.map((c, i) => ({
            code: c.code,
            name: c.name,
            has_imei: c.has_imei || false,
            is_serialized: c.is_serialized ?? true,
            sort_order: c.sort_order || i + 1
          }));
          await supabase.from('part_categories').upsert(catRows, { onConflict: 'code' });
        } catch (e) {}
      }

      // 3. Sync Sites
      if (currentSites && currentSites.length > 0) {
        try {
          const siteRows = currentSites.map(s => ({
            code: s.code,
            name: s.name,
            region: s.region || 'Metro Manila',
            address: s.address || '',
            contact_person: s.contact_person || '',
            contact_phone: s.contact_phone || '',
            is_dc: s.is_dc || false,
            is_active: s.is_active ?? true
          }));
          await supabase.from('sites').upsert(siteRows, { onConflict: 'code' });
        } catch (e) {}
      }

      // 4. Sync Parts Catalog
      if (currentParts && currentParts.length > 0) {
        try {
          const { data: dbCats } = await supabase.from('part_categories').select('id, code');
          const catMap = new Map((dbCats || []).map(c => [c.code, c.id]));

          const partRows = currentParts.map(p => {
            const catCode = categories.find(c => c.id === p.category_id)?.code || 'BATTERY';
            const catId = catMap.get(catCode) || null;
            return {
              part_number: p.part_number,
              description: p.description,
              iphone_model: p.iphone_model || '',
              stocking_price: p.stocking_price || 0,
              safety_stock_pct: p.safety_stock_pct || 0.05,
              is_active: p.is_active ?? true,
              ...(catId ? { category_id: catId } : {})
            };
          });
          await supabase.from('parts').upsert(partRows, { onConflict: 'part_number' });
        } catch (e) {}
      }

      // 5. Sync Forecast Cycles & Forecast Entries
      if (currentForecast && currentForecast.length > 0) {
        try {
          const { data: dbCycle } = await supabase
            .from('forecast_cycles')
            .upsert({
              period_year: activePeriod?.year || 2026,
              period_month: activePeriod?.month || 9,
              status: 'active',
              notes: `${activePeriod?.label || 'September 2026'} Demand Forecast Cycle`
            }, { onConflict: 'period_year,period_month' })
            .select('id')
            .maybeSingle();

          if (dbCycle?.id) {
            const { data: dbParts } = await supabase.from('parts').select('id, part_number');
            const pMap = new Map((dbParts || []).map(p => [p.part_number, p.id]));

            const forecastRows = [];
            for (const f of currentForecast) {
              const pId = pMap.get(f.part_number);
              if (pId) {
                forecastRows.push({
                  forecast_cycle_id: dbCycle.id,
                  part_id: pId,
                  ytd_monthly_counts: f.ytd_monthly_counts || [],
                  computed_forecast: f.computed_forecast || 0,
                  admin_override: f.admin_override || null,
                  final_forecast: f.final_forecast || f.computed_forecast || 0,
                  safety_stock_units: f.safety_stock_units || 0,
                  recommended_order: f.recommended_order || 0
                });
              }
            }
            if (forecastRows.length > 0) {
              await supabase.from('forecast_entries').upsert(forecastRows, { onConflict: 'forecast_cycle_id,part_id' });
            }
          }
        } catch (e) {}
      }

      // 6. Sync Allocation Cycles & Allocation Items
      if (currentAllocs && currentAllocs.length > 0) {
        try {
          const { data: dbAllocCycle } = await supabase
            .from('allocation_cycles')
            .upsert({
              period_year: activePeriod?.year || 2026,
              period_month: activePeriod?.month || 9,
              status: 'approved'
            })
            .select('id')
            .maybeSingle();

          if (dbAllocCycle?.id) {
            const { data: dbParts } = await supabase.from('parts').select('id, part_number');
            const { data: dbSites } = await supabase.from('sites').select('id, code');
            const pMap = new Map((dbParts || []).map(p => [p.part_number, p.id]));
            const sMap = new Map((dbSites || []).map(s => [s.code, s.id]));

            const allocRows = [];
            for (const a of currentAllocs) {
              const pId = pMap.get(a.part_number);
              if (pId && a.site_quantities) {
                Object.entries(a.site_quantities).forEach(([siteCode, qty]) => {
                  const sId = sMap.get(siteCode);
                  if (sId) {
                    allocRows.push({
                      allocation_cycle_id: dbAllocCycle.id,
                      part_id: pId,
                      site_id: sId,
                      monthly_allocated_qty: Number(qty) || 0,
                      week1_qty: a.w1_qty || 0,
                      week2_qty: a.w2_qty || 0,
                      week3_qty: a.w3_qty || 0,
                      week4_qty: a.w4_qty || 0
                    });
                  }
                });
              }
            }
            if (allocRows.length > 0) {
              await supabase.from('allocation_items').upsert(allocRows, { onConflict: 'allocation_cycle_id,part_id,site_id' });
            }
          }
        } catch (e) {}
      }

      // 7. Sync Users
      if (usersList && usersList.length > 0) {
        try {
          const deletedIds = JSON.parse(localStorage.getItem('mdc_deleted_user_ids') || '[]');
          const activeUsers = usersList.filter(u =>
            !deletedIds.includes(u.id) &&
            !deletedIds.includes(u.email?.toLowerCase()) &&
            !LEGACY_MOCK_EMAILS.includes(u.email?.toLowerCase()) &&
            !LEGACY_MOCK_IDS.includes(u.id)
          );
          for (const u of activeUsers) {
            const { data: prof } = await supabase.from('profiles').upsert({
              email: u.email.trim().toLowerCase(),
              full_name: u.fullName.trim(),
              role: u.role || 'warehouse_staff',
              has_set_password: u.hasSetPassword ?? true,
              is_active: u.isActive ?? true,
              updated_at: new Date().toISOString()
            }, { onConflict: 'email' }).select();

            if (prof && prof[0] && u.permittedPages && u.permittedPages.length > 0) {
              const perms = u.permittedPages.map(pg => ({ user_id: prof[0].id, page_id: pg }));
              await supabase.from('user_page_permissions').upsert(perms, { onConflict: 'user_id,page_id' });
            }
          }
        } catch (e) {}
      }

      showToast('All master data, forecasts, allocations & audit logs synced to cloud!', 'success');
      return { success: true };
    } catch (err) {
      console.error('Cloud sync error:', err);
      showToast(`Cloud sync error: ${err.message}`, 'error');
      return { success: false, error: err.message };
    }
  };

  // --- PERIOD-BASED SAVED RECORDS (FORECAST & ALLOCATION HISTORICAL SNAPSHOTS) ---

  // 1. Save Current Working Data as a New Labeled Historical Record
  const savePeriodRecord = async ({
    recordType = 'both', // 'forecast' | 'allocation' | 'both'
    periodLabel,
    periodYear,
    periodMonth,
    periodWeek = null,
    notes = ''
  }) => {
    // 1. Validate data availability
    if (recordType === 'forecast' && (!forecastItems || forecastItems.length === 0)) {
      showToast('Cannot save record: Forecast matrix has no items.', 'error');
      return { success: false, error: 'Forecast table is empty' };
    }

    if (recordType === 'allocation' && (!allocations || allocations.length === 0)) {
      showToast('Cannot save record: Allocation matrix has no items.', 'error');
      return { success: false, error: 'Allocation table is empty' };
    }

    if (recordType === 'both' && (!forecastItems || forecastItems.length === 0) && (!allocations || allocations.length === 0)) {
      showToast('Cannot save record: Both Forecast and Allocation tables are empty.', 'error');
      return { success: false, error: 'Both tables are empty' };
    }

    const cleanLabel = (periodLabel || '').trim();
    if (!cleanLabel) {
      showToast('Please provide a name or label for this period record.', 'warning');
      return { success: false, error: 'Missing period label' };
    }

    // 2. Compute Summary Metrics
    const totalForecastUnits = (forecastItems || []).reduce((sum, item) => sum + (item.final_forecast || item.computed_forecast || 0), 0);
    const totalAllocatedUnits = (allocations || []).reduce((sum, item) => sum + (item.total_allocated_qty || 0), 0);
    const activeSitesCount = (sites || []).filter(s => !s.is_dc).length;

    let grandTotalValue = 0;
    (allocations || []).forEach(item => {
      const part = (parts || []).find(p => p.id === item.part_id || p.part_number === item.part_number);
      const price = part?.stocking_price || (item.description?.toLowerCase().includes('display') ? 280 : 150);
      grandTotalValue += (item.total_allocated_qty || 0) * price;
    });

    // 3. Build Self-Contained Snapshot
    const snapshotData = {
      forecastItems: recordType !== 'allocation' ? JSON.parse(JSON.stringify(forecastItems || [])) : [],
      allocations: recordType !== 'forecast' ? JSON.parse(JSON.stringify(allocations || [])) : [],
      parts: JSON.parse(JSON.stringify(parts || [])),
      sites: JSON.parse(JSON.stringify(sites || [])),
      summary: {
        totalForecastUnits,
        totalAllocatedUnits,
        totalForecastParts: recordType !== 'allocation' ? (forecastItems || []).length : 0,
        totalAllocatedParts: recordType !== 'forecast' ? (allocations || []).length : 0,
        totalSites: activeSitesCount,
        grandTotalValue
      }
    };

    const newRecordId = `rec-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    const newRecord = {
      id: newRecordId,
      record_type: recordType,
      period_label: cleanLabel,
      period_year: parseInt(periodYear) || new Date().getFullYear(),
      period_month: parseInt(periodMonth) || (new Date().getMonth() + 1),
      period_week: periodWeek ? parseInt(periodWeek) : null,
      notes: (notes || '').trim(),
      saved_by_name: currentUser?.fullName || 'Warehouse Operations',
      saved_by_user_id: currentUser?.id && !currentUser.id.startsWith('usr-') ? currentUser.id : null,
      snapshot_data: snapshotData,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    // 4. Update Local State immediately & persist permanently to IndexedDB
    setSavedRecords(prev => [newRecord, ...prev]);
    dbStorage.putSavedRecord(newRecord);

    try {
      const currentSaved = [newRecord, ...savedRecords].slice(0, 50);
      localStorage.setItem('mdc_saved_records', JSON.stringify(currentSaved));
    } catch (e) {
      console.warn('LocalStorage save notice for saved records:', e);
    }

    // 5. Cloud Backup to Supabase
    if (supabase) {
      (async () => {
        try {
          const { error } = await supabase.from('saved_records').upsert({
            id: newRecord.id,
            record_type: newRecord.record_type,
            period_label: newRecord.period_label,
            period_year: newRecord.period_year,
            period_month: newRecord.period_month,
            period_week: newRecord.period_week,
            notes: newRecord.notes,
            saved_by_name: newRecord.saved_by_name,
            saved_by_user_id: newRecord.saved_by_user_id,
            snapshot_data: newRecord.snapshot_data,
            created_at: newRecord.created_at,
            updated_at: newRecord.updated_at
          });
          if (error) throw error;
        } catch (dbErr) {
          console.warn('Supabase saved_records cloud sync note (saved locally):', dbErr.message);
        }
      })();
    }

    showToast(`Saved period record: "${newRecord.period_label}" permanently to database`, 'success');
    return { success: true, record: newRecord };
  };

  // 2. Restore a Historical Record into Live Working Tables
  const restorePeriodRecord = (recordId, options = { restoreForecast: true, restoreAllocation: true }) => {
    const record = savedRecords.find(r => r.id === recordId);
    if (!record) {
      showToast('Record not found', 'error');
      return { success: false, error: 'Record not found' };
    }

    dbStorage.removeItem('mdc_is_cleared');
    try { localStorage.removeItem('mdc_is_cleared'); } catch (e) {}

    const snap = record.snapshot_data || {};

    // 1. Safely merge any missing parts from the snapshot catalog
    if (snap.parts && snap.parts.length > 0) {
      setParts(prev => {
        const map = new Map((prev || []).map(p => [p.part_number, p]));
        snap.parts.forEach(p => {
          if (!map.has(p.part_number)) map.set(p.part_number, p);
        });
        const merged = Array.from(map.values());
        dbStorage.setItem('mdc_parts', merged);
        try { localStorage.setItem('mdc_parts', JSON.stringify(merged)); } catch (e) {}
        return merged;
      });
    }

    // 2. Safely merge any missing sites from the snapshot catalog
    if (snap.sites && snap.sites.length > 0) {
      setSites(prev => {
        const map = new Map((prev || []).map(s => [s.code, s]));
        snap.sites.forEach(s => {
          if (!map.has(s.code)) map.set(s.code, s);
        });
        const merged = Array.from(map.values());
        dbStorage.setItem('mdc_sites', merged);
        try { localStorage.setItem('mdc_sites', JSON.stringify(merged)); } catch (e) {}
        return merged;
      });
    }

    let restoredCountDesc = [];

    // 3. Restore Forecast items if requested & present
    if (options.restoreForecast && snap.forecastItems && snap.forecastItems.length > 0) {
      setForecastItems(snap.forecastItems);
      dbStorage.setItem('mdc_forecast', snap.forecastItems);
      try {
        localStorage.setItem('mdc_forecast', JSON.stringify(snap.forecastItems));
      } catch (e) {}
      restoredCountDesc.push(`${snap.forecastItems.length} forecasts`);
    }

    // 4. Restore Allocations if requested & present
    if (options.restoreAllocation && snap.allocations && snap.allocations.length > 0) {
      setAllocations(snap.allocations);
      dbStorage.setItem('mdc_allocations', snap.allocations);
      try {
        localStorage.setItem('mdc_allocations', JSON.stringify(snap.allocations));
      } catch (e) {}
      restoredCountDesc.push(`${snap.allocations.length} allocations`);
    }

    if (record.period_month || record.period_year || record.period_label) {
      const restoredPeriod = {
        month: record.period_month || 9,
        year: record.period_year || 2026,
        label: record.period_label || `Period ${record.period_month || 9} ${record.period_year || 2026}`
      };
      setActivePeriod(restoredPeriod);
      dbStorage.setItem('mdc_active_period', restoredPeriod);
      try { localStorage.setItem('mdc_active_period', JSON.stringify(restoredPeriod)); } catch (e) {}
    }

    const descStr = restoredCountDesc.length > 0 ? ` (${restoredCountDesc.join(', ')})` : '';
    showToast(`Loaded record "${record.period_label}" into live working tables${descStr}!`, 'success');

    // Automatically navigate to appropriate page
    if (options.restoreForecast && !options.restoreAllocation) {
      setActiveTab('forecast');
    } else if (options.restoreAllocation && !options.restoreForecast) {
      setActiveTab('allocation');
    } else if (snap.forecastItems && snap.forecastItems.length > 0) {
      setActiveTab('forecast');
    } else if (snap.allocations && snap.allocations.length > 0) {
      setActiveTab('allocation');
    }

    return { success: true };
  };

  // 3. Delete a Historical Saved Record
  const deletePeriodRecord = async (recordId) => {
    if (currentUser && currentUser.role !== 'superadmin' && currentUser.role !== 'admin') {
      showToast('Unauthorized: Superadmin or Admin privileges required to delete saved records.', 'error');
      return { success: false, error: 'Unauthorized' };
    }

    const record = savedRecords.find(r => r.id === recordId);
    if (!record) {
      return { success: false, error: 'Record not found' };
    }

    const nextList = savedRecords.filter(r => r.id !== recordId);
    setSavedRecords(nextList);
    dbStorage.deleteSavedRecord(recordId);

    try {
      localStorage.setItem('mdc_saved_records', JSON.stringify(nextList.slice(0, 50)));
    } catch (e) {
      console.warn('LocalStorage delete error:', e);
    }

    if (supabase) {
      try {
        await supabase.from('saved_records').delete().eq('id', recordId);
      } catch (dbErr) {
        console.warn('Supabase delete saved_record notice:', dbErr.message);
      }
    }

    showToast(`Permanently deleted record "${record.period_label}"`, 'info');
    return { success: true };
  };

  // --- DC INTAKE BATCH RECORDS (MDC202600015 Format) ---

  // Helper to generate standardized sequential intake record ID e.g. "MDC202600015"
  const generateNextIntakeRecordId = (targetDate = new Date()) => {
    let year = 2026;
    if (targetDate instanceof Date && !isNaN(targetDate)) {
      year = targetDate.getFullYear();
    } else if (typeof targetDate === 'string') {
      const parsed = new Date(targetDate);
      if (!isNaN(parsed)) year = parsed.getFullYear();
    }
    const prefix = `MDC${year}`;

    // Find all existing records matching this year's prefix
    const matching = (dcIntakeRecords || []).filter(r => r.id && String(r.id).toUpperCase().startsWith(prefix));

    let maxSeq = 0;
    matching.forEach(r => {
      const numPart = String(r.id).slice(prefix.length);
      const parsed = parseInt(numPart, 10);
      if (!isNaN(parsed) && parsed > maxSeq) {
        maxSeq = parsed;
      }
    });

    const nextSeq = maxSeq + 1;
    return `${prefix}${String(nextSeq).padStart(5, '0')}`;
  };

  // Save a batch of scanned parts into a permanent DC Intake Record
  const saveIntakeRecord = async ({
    recordId,
    recordName,
    intakeDate,
    poId,
    poNumber,
    supplier,
    notes,
    items = []
  }) => {
    const rawDate = intakeDate ? new Date(intakeDate) : new Date();
    const cleanDateStr = intakeDate || new Date().toISOString().split('T')[0];
    const generatedId = generateNextIntakeRecordId(rawDate);
    const finalId = (recordId || generatedId).trim().toUpperCase();
    const finalName = (recordName || finalId).trim();

    // Group items by category for summary metrics
    const breakdown = {};
    items.forEach(it => {
      const partObj = parts.find(p => p.part_number === it.part_number);
      const cat = partObj?.category_id || 'cat-general';
      const cleanCatName = cat.replace('cat-', '').replace(/^\w/, c => c.toUpperCase());
      breakdown[cleanCatName] = (breakdown[cleanCatName] || 0) + 1;
    });

    const newRecord = {
      id: finalId,
      record_name: finalName,
      intake_date: cleanDateStr,
      po_id: poId || null,
      po_number: poNumber || null,
      supplier: supplier || null,
      total_units: items.length,
      saved_by_name: currentUser?.fullName || 'Warehouse Operations',
      saved_by_user_id: currentUser?.id && !currentUser.id.startsWith('usr-') ? currentUser.id : null,
      notes: (notes || '').trim(),
      category_breakdown: breakdown,
      items: items.map(u => ({
        id: u.id || `unit-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        part_number: u.part_number,
        description: u.description || 'Service Replacement Part',
        serial_number: u.serial_number,
        received_at: u.received_at || new Date().toISOString(),
        received_by: u.received_by || currentUser?.fullName || 'Warehouse Staff',
        po_id: u.po_id || poId || null
      })),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    // 1. Update React Local State & localStorage immediately for intake records and inventory units
    setDcIntakeRecords(prev => [newRecord, ...prev.filter(r => r.id !== finalId)]);
    setInventoryUnits(prev => {
      const map = new Map((prev || []).map(u => [String(u.serial_number || '').toUpperCase(), u]));
      newRecord.items.forEach(u => {
        const cleanSerial = String(u.serial_number || '').toUpperCase();
        if (!map.has(cleanSerial)) {
          map.set(cleanSerial, {
            id: u.id || `unit-${cleanSerial}`,
            part_id: `part-${u.part_number}`,
            part_number: u.part_number,
            description: u.description || 'Service Replacement Part',
            serial_number: u.serial_number,
            current_site_id: 'site-dc',
            site_code: 'DC-MDC',
            po_id: u.po_id || newRecord.po_id || null,
            status: 'in_stock',
            box_number: 1,
            received_at: u.received_at || newRecord.intake_date || new Date().toISOString(),
            received_by: u.received_by || newRecord.saved_by_name || 'Warehouse Staff',
            intake_record_id: newRecord.id
          });
        }
      });
      const updated = Array.from(map.values());
      try {
        localStorage.setItem('mdc_inventory', JSON.stringify(updated));
      } catch (e) {}
      dbStorage.setItem('mdc_inventory', updated);
      return updated;
    });

    try {
      const existing = JSON.parse(localStorage.getItem('mdc_dc_intake_records') || '[]');
      const updated = [newRecord, ...existing.filter(r => r.id !== finalId)].slice(0, 100);
      localStorage.setItem('mdc_dc_intake_records', JSON.stringify(updated));
    } catch (e) {
      console.warn('LocalStorage save error for intake records:', e);
    }

    // 2. Cloud Backup to Supabase PostgreSQL dc_intake_records & inventory_units tables
    if (supabase) {
      (async () => {
        try {
          const { error } = await supabase.from('dc_intake_records').upsert({
            id: newRecord.id,
            record_name: newRecord.record_name,
            intake_date: newRecord.intake_date,
            po_id: newRecord.po_id && !String(newRecord.po_id).startsWith('po-') ? newRecord.po_id : null,
            po_number: newRecord.po_number,
            supplier: newRecord.supplier,
            total_units: newRecord.total_units,
            saved_by_name: newRecord.saved_by_name,
            saved_by_user_id: newRecord.saved_by_user_id,
            notes: newRecord.notes,
            category_breakdown: newRecord.category_breakdown,
            items: newRecord.items,
            created_at: newRecord.created_at,
            updated_at: newRecord.updated_at
          });
          if (error) {
            console.warn('Supabase dc_intake_records sync note (saved locally):', error.message);
          }

          // Also upsert individual units into inventory_units table for deep cross-account sync
          const unitRows = newRecord.items.map(u => ({
            serial_number: u.serial_number,
            part_number: u.part_number,
            description: u.description,
            status: 'in_stock',
            current_site_id: 'site-dc',
            received_at: u.received_at || newRecord.intake_date,
            received_by_name: u.received_by || newRecord.saved_by_name,
            po_id: u.po_id || newRecord.po_id || null,
            notes: `Intake Record ${newRecord.id}`
          }));
          if (unitRows.length > 0) {
            await supabase.from('inventory_units').upsert(unitRows, { onConflict: 'serial_number' });
          }
        } catch (dbErr) {
          console.warn('Supabase dc_intake_records sync exception:', dbErr.message);
        }
      })();
    }

    showToast(`Saved DC Intake Record "${newRecord.record_name}" with ${newRecord.total_units} units to database!`, 'success');
    return { success: true, record: newRecord };
  };

  // Delete a saved intake record
  const deleteIntakeRecord = async (recordId) => {
    if (currentUser && currentUser.role !== 'superadmin' && currentUser.role !== 'admin') {
      showToast('Unauthorized: Superadmin or Admin privileges required to delete intake records.', 'error');
      return { success: false, error: 'Unauthorized' };
    }

    const recordToDelete = dcIntakeRecords.find(r => r.id === recordId);
    const serialsToDelete = (recordToDelete?.items || []).map(u => String(u.serial_number || '').toUpperCase());

    // 1. Remove from dcIntakeRecords state
    setDcIntakeRecords(prev => prev.filter(r => r.id !== recordId));
    try {
      const existing = JSON.parse(localStorage.getItem('mdc_dc_intake_records') || '[]');
      localStorage.setItem('mdc_dc_intake_records', JSON.stringify(existing.filter(r => r.id !== recordId)));
    } catch (e) {}

    // 2. Remove all contained parts from inventoryUnits state and local storage
    if (serialsToDelete.length > 0) {
      setInventoryUnits(prev => {
        const next = (prev || []).filter(u => !serialsToDelete.includes(String(u.serial_number || '').toUpperCase()));
        try {
          localStorage.setItem('mdc_inventory', JSON.stringify(next));
        } catch (e) {}
        dbStorage.setItem('mdc_inventory', next);
        return next;
      });
    }

    // 3. Delete from Supabase tables (dc_intake_records & inventory_units)
    if (supabase) {
      (async () => {
        try {
          await supabase.from('dc_intake_records').delete().eq('id', recordId);
          if (serialsToDelete.length > 0) {
            for (const serial of serialsToDelete) {
              await supabase.from('inventory_units').delete().eq('serial_number', serial);
            }
          }
        } catch (e) {
          console.warn('Supabase deleteIntakeRecord notice:', e.message);
        }
      })();
    }

    showToast(`Deleted Intake Record ${recordId} and removed its parts from inventory and database`, 'info');
    return { success: true };
  };

  // 4. Import Stock Transfers Report
  const importStockTransfersReport = async (records, metadata) => {
    setStockTransferReports(records);
    setStockTransferMetadata(metadata);
    await Promise.all([
      dbStorage.setItem('mdc_stock_transfer_reports', records),
      dbStorage.setItem('mdc_stock_transfer_metadata', metadata)
    ]);
    showToast(`Successfully imported ${records.length.toLocaleString()} stock transfer records`, 'success');
  };

  // 5. Clear Stock Transfers Report
  const clearStockTransfersReport = async () => {
    setStockTransferReports([]);
    setStockTransferMetadata(null);
    await Promise.all([
      dbStorage.setItem('mdc_stock_transfer_reports', []),
      dbStorage.setItem('mdc_stock_transfer_metadata', null)
    ]);
    showToast('Cleared stock transfer reports data', 'info');
  };

  return (
    <AppContext.Provider
      value={{
        // Nav & Filters
        activeTab,
        setActiveTab,
        selectedCategory,
        setSelectedCategory,
        searchQuery,
        setSearchQuery,
        toast,
        showToast,
        activePeriod,
        setActivePeriod,
        cloudSyncStatus,
        // Auth & RBAC
        currentUser,
        usersList,
        pendingFirstTimeUser,
        setPendingFirstTimeUser,
        canAccess,
        verifyLoginEmail,
        signInWithPassword,
        createFirstTimePassword,
        signOut,
        provisionUser,
        updateUser,
        updateUserRolePosition,
        resetUserPassword,
        deleteUser,
        toggleUserPagePermission,
        applyRolePresetToUser,
        toggleUserActiveStatus,
        // Data Stores
        categories,
        sites,
        parts,
        forecastItems,
        allocations,
        inventoryUnits,
        setInventoryUnits,
        purchaseOrders,
        shipments,
        scanLogs,
        repairUsageRecords,
        savedRecords,
        dcIntakeRecords,
        setDcIntakeRecords,
        generateNextIntakeRecordId,
        saveIntakeRecord,
        deleteIntakeRecord,
        stockTransferReports,
        setStockTransferReports,
        stockTransferMetadata,
        setStockTransferMetadata,
        uploadAuditLogs,
        setUploadAuditLogs,
        importStockTransfersReport,
        clearStockTransfersReport,
        savePeriodRecord,
        restorePeriodRecord,
        deletePeriodRecord,
        addScanInUnit,
        deleteScanInUnit,
        batchAddScanInUnits,
        addScanOutUnit,
        removeScanOutUnit,
        batchAddScanOutUnits,
        clearShipmentDraftItems,
        deleteShipment,
        batchImportShipments,
        clearAllShipmentsData,
        saveShipment,
        updateForecastOverride,
        updateSiteAllocation,
        runAutoAllocation,
        savePart,
        deletePart,
        saveSite,
        refreshSitesFromCloud,
        applyPmgDirectoryToSites,
        applyParsedDataset,
        syncAllDataToCloud,
        refreshDataFromCloud,
        isAutoRefreshing,
        lastSyncedAt,
        autoRefreshData,
        resetToDefaultData,
        clearAllData,
        isCommandPaletteOpen,
        setIsCommandPaletteOpen
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
}
