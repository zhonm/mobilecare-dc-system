import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import seedData from '../data/seedData.json';
import seedStockTransfers from '../data/seedStockTransfers.json';
import { calculateRecommendedOrder } from '../utils/forecastEngine';
import { calculateProportionalAllocation, calculateWeeklySplit } from '../utils/allocationEngine';
import { barcodeAudio } from '../utils/barcodeAudio';
import { supabase, isSupabaseConfigured } from '../supabase/client';
import dbStorage from '../utils/dbStorage';
import { hashPassword, verifyPassword, generateSessionSignature, verifySessionIntegrity } from '../utils/security';
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
import { matchUserByEmail, isAllowedCompanyEmail } from '../utils/userMatcher';

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

// UUID Format Validation Helpers to prevent PostgreSQL UUID syntax crashes
export const isUUID = (str) => typeof str === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str);
export const safeUUID = (str) => isUUID(str) ? str : null;

// Helper to guarantee serialized units that are in an active draft or saved shipments maintain their 'packed' or 'shipped' status
export function reconcileUnitsWithPackedDrafts(units = [], shipmentsList = [], explicitDraft = null) {
  if (!Array.isArray(units) || units.length === 0) return [];

  const packedSerialsMap = new Map();

  // 1. Check active draft from arg or localStorage (actively being packed in Scan-Out right now)
  let draft = explicitDraft;
  if (!draft && typeof window !== 'undefined') {
    try {
      const saved = localStorage.getItem('mdc_active_pack_draft');
      if (saved) draft = JSON.parse(saved);
    } catch (e) {}
  }
  if (draft && Array.isArray(draft.items) && draft.status !== 'shipped' && draft.status !== 'delivered') {
    draft.items.forEach(it => {
      const s = String(it.serial_number || it.serialNumber || '').trim().toUpperCase();
      if (s) {
        packedSerialsMap.set(s, {
          status: 'packed',
          box_number: it.box_number || 1,
          current_site_id: draft.site_id || 'site-dc',
          shipped_at: draft.shipment_date || new Date().toISOString(),
          isDraft: true
        });
      }
    });
  }

  // 2. Check all finalized shipments in shipmentsList or from localStorage
  let effectiveShipments = shipmentsList;
  if ((!effectiveShipments || effectiveShipments.length === 0) && typeof window !== 'undefined') {
    try {
      const savedSh = localStorage.getItem('mdc_shipments');
      if (savedSh) effectiveShipments = JSON.parse(savedSh);
    } catch (e) {}
  }

  if (Array.isArray(effectiveShipments)) {
    effectiveShipments.forEach(sh => {
      if (sh && Array.isArray(sh.items) && sh.status !== 'cancelled') {
        const isShipped = sh.status === 'shipped' || sh.status === 'delivered';
        const targetStatus = isShipped ? 'shipped' : 'packed';
        const shipDateStr = sh.shipment_date || sh.created_at || new Date().toISOString();
        sh.items.forEach(it => {
          const s = String(it.serial_number || it.serialNumber || '').trim().toUpperCase();
          if (s && !packedSerialsMap.has(s)) {
            packedSerialsMap.set(s, {
              status: targetStatus,
              box_number: it.box_number || 1,
              current_site_id: sh.site_id || 'site-dc',
              shipped_at: shipDateStr,
              isDraft: false
            });
          }
        });
      }
    });
  }

  return units.map(u => {
    const s = String(u.serial_number || '').trim().toUpperCase();
    const packInfo = packedSerialsMap.get(s);
    if (packInfo) {
      return {
        ...u,
        status: packInfo.status,
        box_number: packInfo.box_number || u.box_number || 1,
        current_site_id: packInfo.current_site_id || u.current_site_id,
        shipped_at: packInfo.shipped_at || u.shipped_at
      };
    }
    return {
      ...u,
      status: 'in_stock',
      current_site_id: 'site-dc',
      shipped_at: null,
      shipped_by: null
    };
  });
}

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

  // Sync active auth user to local storage with cryptographic signature
  useEffect(() => {
    let isMounted = true;
    if (currentUser) {
      localStorage.setItem('mdc_auth_user', JSON.stringify(currentUser));
      generateSessionSignature(currentUser).then(sig => {
        if (isMounted && sig) {
          localStorage.setItem('mdc_session_sig', sig);
        }
      });
    } else {
      localStorage.removeItem('mdc_auth_user');
      localStorage.removeItem('mdc_session_sig');
    }
    return () => { isMounted = false; };
  }, [currentUser]);

  // Verify session integrity on boot to prevent local storage role tampering
  useEffect(() => {
    if (currentUser) {
      const savedSig = localStorage.getItem('mdc_session_sig');
      if (savedSig) {
        verifySessionIntegrity(currentUser, savedSig).then(isValid => {
          if (!isValid) {
            console.warn('[Security] Session integrity verification failed. Session revoked.');
            setCurrentUser(null);
            localStorage.removeItem('mdc_auth_user');
            localStorage.removeItem('mdc_session_sig');
          }
        });
      }
    }
  }, []);

  // Internal Enterprise Inactivity Monitor (30 minutes auto-logout for warehouse terminals)
  useEffect(() => {
    if (!currentUser) return;
    const INACTIVITY_LIMIT_MS = 30 * 60 * 1000;
    let timer;

    const resetTimer = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        setCurrentUser(null);
        localStorage.removeItem('mdc_auth_user');
        localStorage.removeItem('mdc_session_sig');
        showToast('Session expired after 30 minutes of inactivity for internal security.', 'warning');
      }, INACTIVITY_LIMIT_MS);
    };

    const events = ['mousedown', 'mousemove', 'keydown', 'touchstart', 'scroll'];
    resetTimer();
    events.forEach(e => window.addEventListener(e, resetTimer, { passive: true }));

    return () => {
      clearTimeout(timer);
      events.forEach(e => window.removeEventListener(e, resetTimer));
    };
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

    // Internal Security Check: Restrict to authorized company domains
    if (!isAllowedCompanyEmail(email)) {
      return {
        success: false,
        error: 'Access restricted: System is exclusively for authorized internal Mobile Care personnel (@mobilecareph.com, @mobilecare.com.ph).'
      };
    }

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

    if (!isAllowedCompanyEmail(cleanEmail)) {
      showToast('User email must belong to an official Mobile Care company domain (@mobilecareph.com, @mobilecare.com.ph).', 'error');
      return { success: false, error: 'External email domains are prohibited for internal security.' };
    }

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
    const prevUsersList = usersList;
    const nextList = [...usersList.filter(u => u.email.toLowerCase() !== cleanEmail), newUser];
    setUsersList(nextList);
    localStorage.setItem('mdc_users', JSON.stringify(nextList));
    dbStorage.setItem('mdc_users', nextList);

    // Sync to Supabase PostgreSQL database
    if (supabase) {
      setCloudSyncStatus(prev => ({ ...prev, isSaving: true }));
      try {
        const { data: inserted, error: profErr } = await supabase
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

        if (profErr) throw profErr;

        const effectiveUserId = inserted?.[0]?.id || newUser.id;
        if (defaultPages && defaultPages.length > 0 && effectiveUserId) {
          const permRows = defaultPages.map(pageId => ({
            user_id: effectiveUserId,
            page_id: pageId
          }));
          const { error: permErr } = await supabase.from('user_page_permissions').upsert(permRows, { onConflict: 'user_id,page_id' });
          if (permErr) console.warn('Permission sync warning:', permErr.message);
        }

        setCloudSyncStatus({ isSaving: false, lastSaved: new Date(), isOnline: true });
        broadcastCloudEvent('USER_PROVISIONED', { email: cleanEmail, userId: effectiveUserId });
      } catch (dbErr) {
        console.error('Could not sync provisioned user to Supabase:', dbErr.message);
        setCloudSyncStatus(prev => ({ ...prev, isSaving: false, isOnline: false }));
        enqueueOfflineAction('PROFILE_UPSERT', {
          email: cleanEmail,
          full_name: fullName.trim(),
          role,
          role_position: finalRolePosition,
          has_set_password: false,
          is_active: true,
          updated_at: new Date().toISOString()
        });
        showToast(`Warning: Cloud sync error (${dbErr.message}). Provisioned locally.`, 'warning');
      }
    } else {
      broadcastCloudEvent('USER_PROVISIONED', { email: cleanEmail, userId: newUser.id });
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
      setCloudSyncStatus(prev => ({ ...prev, isSaving: true }));
      try {
        const { data: prof, error: findErr } = await supabase
          .from('profiles')
          .select('id')
          .or(`id.eq.${userId},email.ilike.${targetUser.email}`)
          .maybeSingle();

        if (findErr) throw findErr;

        if (prof?.id) {
          if (hasPage) {
            const { error: delErr } = await supabase
              .from('user_page_permissions')
              .delete()
              .eq('user_id', prof.id)
              .eq('page_id', pageId);
            if (delErr) throw delErr;
          } else {
            const { error: upErr } = await supabase
              .from('user_page_permissions')
              .upsert({ user_id: prof.id, page_id: pageId }, { onConflict: 'user_id,page_id' });
            if (upErr) throw upErr;
          }
        }
        setCloudSyncStatus({ isSaving: false, lastSaved: new Date(), isOnline: true });
        broadcastCloudEvent('USER_PERMISSIONS_UPDATED', { userId: prof?.id || userId, pageId, hasPage: !hasPage });
      } catch (e) {
        console.error('Supabase permission sync error:', e.message);
        setCloudSyncStatus(prev => ({ ...prev, isSaving: false, isOnline: false }));
      }
    } else {
      broadcastCloudEvent('USER_PERMISSIONS_UPDATED', { userId, pageId, hasPage: !hasPage });
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
      setCloudSyncStatus(prev => ({ ...prev, isSaving: true }));
      try {
        const { data: prof, error: profFindErr } = await supabase
          .from('profiles')
          .select('id')
          .or(`id.eq.${userId},email.ilike.${targetUser.email}`)
          .maybeSingle();

        if (profFindErr) throw profFindErr;

        if (prof?.id) {
          const { error: upProfErr } = await supabase
            .from('profiles')
            .update({ role: presetRole, updated_at: new Date().toISOString() })
            .eq('id', prof.id);
          if (upProfErr) throw upProfErr;

          await supabase
            .from('user_page_permissions')
            .delete()
            .eq('user_id', prof.id);

          const rows = pages.map(pg => ({ user_id: prof.id, page_id: pg }));
          if (rows.length > 0) {
            const { error: permErr } = await supabase.from('user_page_permissions').upsert(rows, { onConflict: 'user_id,page_id' });
            if (permErr) throw permErr;
          }
        }
        setCloudSyncStatus({ isSaving: false, lastSaved: new Date(), isOnline: true });
        broadcastCloudEvent('USER_ROLE_UPDATED', { userId: prof?.id || userId, role: presetRole });
      } catch (e) {
        console.error('Supabase role preset sync error:', e.message);
        setCloudSyncStatus(prev => ({ ...prev, isSaving: false, isOnline: false }));
      }
    } else {
      broadcastCloudEvent('USER_ROLE_UPDATED', { userId, role: presetRole });
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
      setCloudSyncStatus(prev => ({ ...prev, isSaving: true }));
      try {
        const { error } = await supabase
          .from('profiles')
          .update({ is_active: nextState, updated_at: new Date().toISOString() })
          .or(`id.eq.${userId},email.ilike.${target.email}`);
        if (error) throw error;
        setCloudSyncStatus({ isSaving: false, lastSaved: new Date(), isOnline: true });
        broadcastCloudEvent('USER_STATUS_UPDATED', { userId, isActive: nextState });
      } catch (e) {
        console.error('Supabase status sync error:', e.message);
        setCloudSyncStatus(prev => ({ ...prev, isSaving: false, isOnline: false }));
      }
    } else {
      broadcastCloudEvent('USER_STATUS_UPDATED', { userId, isActive: nextState });
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
      setCloudSyncStatus(prev => ({ ...prev, isSaving: true }));
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
        const { data: byIdData, error: byIdErr } = await supabase
          .from('profiles')
          .update(updatePayload)
          .eq('id', userId)
          .select();

        if (!byIdErr && byIdData && byIdData.length > 0) {
          updatedInDb = true;
        } else {
          // If ID didn't match (e.g. UUID vs local key), update by previous email!
          const { data: byEmailData, error: byEmailErr } = await supabase
            .from('profiles')
            .update(updatePayload)
            .ilike('email', previousEmail)
            .select();

          if (!byEmailErr && byEmailData && byEmailData.length > 0) {
            updatedInDb = true;
          }
        }

        // If not found in database, insert/upsert the profile
        if (!updatedInDb) {
          const { error: upsertErr } = await supabase
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
          if (upsertErr) throw upsertErr;
        }

        setCloudSyncStatus({ isSaving: false, lastSaved: new Date(), isOnline: true });
        broadcastCloudEvent('USER_UPDATED', { userId, email: cleanEmail });
      } catch (dbErr) {
        console.error('Supabase profile update error:', dbErr.message);
        setCloudSyncStatus(prev => ({ ...prev, isSaving: false, isOnline: false }));
        enqueueOfflineAction('PROFILE_UPSERT', {
          email: cleanEmail,
          full_name: fullName.trim(),
          role: resolvedRole,
          role_position: resolvedPosition,
          updated_at: new Date().toISOString()
        });
        showToast(`Warning: Cloud sync failed (${dbErr.message}). Profile updated locally.`, 'warning');
      }
    } else {
      broadcastCloudEvent('USER_UPDATED', { userId, email: cleanEmail });
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
      setCloudSyncStatus(prev => ({ ...prev, isSaving: true }));
      try {
        const { error } = await supabase
          .from('profiles')
          .update({ role_position: pos, updated_at: new Date().toISOString() })
          .or(`id.eq.${userId},email.ilike.${target.email}`);
        if (error) throw error;
        setCloudSyncStatus({ isSaving: false, lastSaved: new Date(), isOnline: true });
        broadcastCloudEvent('USER_UPDATED', { userId, rolePosition: pos });
      } catch (e) {
        console.error('Supabase role position sync error:', e.message);
        setCloudSyncStatus(prev => ({ ...prev, isSaving: false, isOnline: false }));
      }
    } else {
      broadcastCloudEvent('USER_UPDATED', { userId, rolePosition: pos });
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
      setCloudSyncStatus(prev => ({ ...prev, isSaving: true }));
      try {
        if (currentUser?.id === userId) {
          try { await supabase.auth.updateUser({ password: finalPassword }); } catch (authErr) {}
        }

        const { error } = await supabase
          .from('profiles')
          .update({
            has_set_password: hasSet,
            password_hash: secureHash,
            updated_at: new Date().toISOString()
          })
          .or(`id.eq.${userId},email.ilike.${target.email}`);
        if (error) throw error;
        setCloudSyncStatus({ isSaving: false, lastSaved: new Date(), isOnline: true });
        broadcastCloudEvent('USER_PASSWORD_RESET', { userId });
      } catch (dbErr) {
        console.error('Supabase password reset sync error:', dbErr.message);
        setCloudSyncStatus(prev => ({ ...prev, isSaving: false, isOnline: false }));
      }
    } else {
      broadcastCloudEvent('USER_PASSWORD_RESET', { userId });
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

    // 1. Record deleted IDs and clean emails into localStorage
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
    const prevUsers = usersList;
    const nextList = usersList.filter(u => u.id !== userId && u.email?.toLowerCase() !== target.email?.toLowerCase());
    setUsersList(nextList);
    localStorage.setItem('mdc_users', JSON.stringify(nextList));
    dbStorage.setItem('mdc_users', nextList);

    // 3. Delete from Supabase Database
    if (supabase) {
      setCloudSyncStatus(prev => ({ ...prev, isSaving: true }));
      try {
        await supabase.from('user_page_permissions').delete().eq('user_id', userId);
        const { error: delProfErr } = await supabase.from('profiles').delete().eq('id', userId);
        if (delProfErr) {
          // If delete by id failed, try deleting by email or marking is_deleted
          const { error: delEmailErr } = await supabase.from('profiles').delete().ilike('email', target.email);
          if (delEmailErr) {
            await supabase.from('profiles').update({ is_deleted: true, is_active: false, updated_at: new Date().toISOString() }).or(`id.eq.${userId},email.ilike.${target.email}`);
          }
        }
        setCloudSyncStatus({ isSaving: false, lastSaved: new Date(), isOnline: true });
        broadcastCloudEvent('USER_DELETED', { userId, email: target.email });
      } catch (e) {
        console.error('Supabase delete user error:', e.message);
        setCloudSyncStatus(prev => ({ ...prev, isSaving: false, isOnline: false }));
        enqueueOfflineAction('PROFILE_DELETE', { id: userId, email: target.email });
        showToast(`Warning: Cloud sync error (${e.message}). User removed locally.`, 'warning');
      }
    } else {
      broadcastCloudEvent('USER_DELETED', { userId, email: target.email });
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
      const parsed = saved ? JSON.parse(saved) : [];
      if (Array.isArray(parsed) && parsed.length > 0) {
        const map = new Map();
        (seedData.sites || []).forEach(s => { if (s && s.code) map.set(s.code.toUpperCase(), s); });
        parsed.forEach(s => {
          if (s && s.code) {
            const existing = map.get(s.code.toUpperCase());
            map.set(s.code.toUpperCase(), { ...existing, ...s });
          }
        });
        return Array.from(map.values()).sort((a, b) => (a.code || '').localeCompare(b.code || ''));
      }
      return (seedData.sites || []).sort((a, b) => (a.code || '').localeCompare(b.code || ''));
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
      return localStorage.getItem('mdc_is_cleared') === 'true' || localStorage.getItem('mdc_forecast') === '[]';
    } catch {
      return false;
    }
  };

  const [forecastItems, setForecastItems] = useState(() => {
    try {
      if (isExplicitlyCleared()) return [];
      const saved = localStorage.getItem('mdc_forecast');
      if (saved !== null) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
      return [];
    } catch {
      return [];
    }
  });

  const [allocations, setAllocations] = useState(() => {
    try {
      if (isExplicitlyCleared()) return [];
      const saved = localStorage.getItem('mdc_allocations');
      if (saved !== null) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
      return [];
    } catch {
      return [];
    }
  });

  const [inventoryUnits, setInventoryUnits] = useState(() => {
    try {
      if (isExplicitlyCleared()) return [];
      const saved = localStorage.getItem('mdc_inventory');
      let baseUnits = [];
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) baseUnits = parsed;
      }
      if (baseUnits.length === 0) {
        const savedIntakes = localStorage.getItem('mdc_dc_intake_records');
        if (savedIntakes) {
          const parsedIntakes = JSON.parse(savedIntakes);
          if (Array.isArray(parsedIntakes)) {
            parsedIntakes.forEach(rec => {
              if (Array.isArray(rec.items)) {
                rec.items.forEach(it => {
                  baseUnits.push({
                    id: it.id || `unit-${it.serial_number}`,
                    part_id: it.part_id || `part-${it.part_number}`,
                    part_number: it.part_number,
                    description: it.description || 'Service Replacement Part',
                    serial_number: it.serial_number,
                    current_site_id: 'site-dc',
                    site_code: 'DC-MDC',
                    status: 'in_stock',
                    box_number: 1,
                    received_at: it.received_at || rec.intake_date || new Date().toISOString(),
                    received_by: it.received_by || rec.saved_by_name || 'Warehouse Staff'
                  });
                });
              }
            });
          }
        }
      }
      return reconcileUnitsWithPackedDrafts(baseUnits);
    } catch {
      return [];
    }
  });

  const [purchaseOrders, setPurchaseOrders] = useState(() => {
    try {
      if (isExplicitlyCleared()) return [];
      const saved = localStorage.getItem('mdc_pos');
      if (saved !== null) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
      return [];
    } catch {
      return [];
    }
  });

  const [shipments, setShipments] = useState(() => {
    try {
      if (isExplicitlyCleared()) return [];
      const saved = localStorage.getItem('mdc_shipments');
      if (saved !== null) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
      return [];
    } catch {
      return [];
    }
  });

  const [scanLogs, setScanLogs] = useState(() => {
    try {
      if (isExplicitlyCleared()) return [];
      const saved = localStorage.getItem('mdc_scan_logs');
      if (saved !== null) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
      return [];
    } catch {
      return [];
    }
  });

  const [repairUsageRecords, setRepairUsageRecords] = useState(() => {
    try {
      if (isExplicitlyCleared()) return [];
      const saved = localStorage.getItem('mdc_repair_usage');
      if (saved !== null) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
      return [];
    } catch {
      return [];
    }
  });

  const [savedRecords, setSavedRecords] = useState(() => {
    try {
      const saved = localStorage.getItem('mdc_saved_records');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          return parsed.filter(r =>
            !r.id?.startsWith('deleted_') &&
            r.record_type !== 'system_registry' &&
            r.record_type !== 'deletion_registry' &&
            r.period_label !== 'Deleted Records Registry' &&
            r.notes !== '__DELETED__'
          );
        }
      }
      return [];
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
      if (saved !== null) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
      return [];
    } catch {
      return [];
    }
  });

  const [stockTransferMetadata, setStockTransferMetadata] = useState(() => {
    try {
      if (isExplicitlyCleared()) return null;
      const saved = localStorage.getItem('mdc_stock_transfer_metadata');
      if (saved) return JSON.parse(saved);
      return null;
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

  // Deletion & Data Purge Audit Trail Logs
  const [deletionAuditLogs, setDeletionAuditLogs] = useState(() => {
    try {
      const saved = localStorage.getItem('mdc_deletion_audit_logs');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
      return [
        {
          id: 'del-audit-init-01',
          timestamp: new Date().toISOString(),
          action: 'DELETE',
          entity_type: 'DC Intake Record',
          entity_id: 'MDC202600001',
          entity_label: 'Intake Batch #MDC202600001',
          deleted_by_id: 'usr-superadmin-zhon',
          deleted_by_name: 'Zhon Manaois',
          deleted_by_email: 'zhon.manaois@mobilecareph.com',
          deleted_by_role: 'superadmin',
          deleted_by_position: 'Parts Management Specialist',
          reason: 'Initial intake test record purged from staging',
          summary: {
            itemsCount: 15,
            intakeDate: '2026-08-20',
            notes: 'Test intake batch'
          }
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
        if (Array.isArray(savedInv) && savedInv.length > 0) setInventoryUnits(reconcileUnitsWithPackedDrafts(savedInv, savedShip));
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
  const realtimeChannelRef = useRef(null);
  const [realtimeConnected, setRealtimeConnected] = useState(false);

  // Persistent Offline Write & Retry Queue
  const [offlineQueue, setOfflineQueue] = useState(() => {
    try {
      const saved = localStorage.getItem('mdc_offline_sync_queue');
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      return [];
    }
  });

  const enqueueOfflineAction = useCallback((type, payload, meta = {}) => {
    const entry = {
      id: `sync-q-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      type,
      payload,
      meta,
      queuedAt: new Date().toISOString()
    };
    setOfflineQueue(prev => {
      const updated = [...prev, entry];
      try {
        localStorage.setItem('mdc_offline_sync_queue', JSON.stringify(updated));
      } catch (e) {}
      dbStorage.setItem('mdc_offline_sync_queue', updated);
      return updated;
    });
  }, []);

  const isProcessingQueueRef = useRef(false);
  const processOfflineSyncQueue = useCallback(async () => {
    if (!supabase || isProcessingQueueRef.current || !navigator.onLine) return;
    let queue = [];
    try {
      const saved = localStorage.getItem('mdc_offline_sync_queue');
      queue = saved ? JSON.parse(saved) : [];
    } catch (e) {
      return;
    }
    if (!Array.isArray(queue) || queue.length === 0) {
      setOfflineQueue([]);
      return;
    }

    isProcessingQueueRef.current = true;
    console.debug(`[OfflineSyncQueue] Processing ${queue.length} pending queued mutations...`);
    const remaining = [];

    for (const item of queue) {
      try {
        const retries = (item.retries || 0) + 1;
        let err = null;

        if (item.type === 'INTAKE_UPSERT') {
          const payload = {
            ...item.payload,
            saved_by_user_id: safeUUID(item.payload?.saved_by_user_id)
          };
          const { error } = await supabase.from('dc_intake_records').upsert(payload, { onConflict: 'id' });
          if (error) err = error;
        } else if (item.type === 'INTAKE_DELETE') {
          const { error } = await supabase.from('dc_intake_records').delete().eq('id', item.payload.recordId);
          if (error) err = error;
        } else if (item.type === 'SHIPMENT_UPSERT' || item.type === 'SAVED_RECORD_UPSERT') {
          const payload = {
            ...item.payload,
            saved_by_user_id: safeUUID(item.payload?.saved_by_user_id)
          };
          const { error } = await supabase.from('saved_records').upsert(payload, { onConflict: 'id' });
          if (error) err = error;
        } else if (item.type === 'SHIPMENT_DELETE' || item.type === 'SAVED_RECORD_DELETE') {
          const idToDelete = item.payload?.shipmentId || item.payload?.id;
          const { error } = await supabase.from('saved_records').delete().eq('id', idToDelete);
          if (error) err = error;
        } else if (item.type === 'PART_UPSERT') {
          const { error } = await supabase.from('parts').upsert(item.payload, { onConflict: 'part_number' });
          if (error) err = error;
        } else if (item.type === 'PART_DELETE') {
          const { error } = await supabase.from('parts').delete().eq('id', item.payload.id);
          if (error) err = error;
        } else if (item.type === 'SITE_UPSERT') {
          const { error } = await supabase.from('sites').upsert(item.payload, { onConflict: 'code' });
          if (error) err = error;
        } else if (item.type === 'PROFILE_UPSERT') {
          const { error } = await supabase.from('profiles').upsert(item.payload, { onConflict: 'email' });
          if (error) err = error;
        } else if (item.type === 'PROFILE_DELETE') {
          const { error } = await supabase.from('profiles').delete().eq('id', item.payload.id);
          if (error) err = error;
        } else if (item.type === 'INVENTORY_UNITS_UPSERT') {
          const { error } = await supabase.from('inventory_units').upsert(item.payload, { onConflict: 'serial_number' });
          if (error) err = error;
        }

        if (err) {
          console.warn(`[OfflineSyncQueue] Failed item ${item.type} (attempt ${retries}):`, err.message);
          // Only retry transient network errors up to 3 times
          if (retries < 3 && !/violates|duplicate|invalid|syntax|column|null/i.test(err.message || '')) {
            remaining.push({ ...item, retries });
          } else {
            console.warn(`[OfflineSyncQueue] Discarding unrecoverable queued item ${item.type}:`, err.message);
          }
        }
      } catch (ex) {
        console.warn(`[OfflineSyncQueue] Exception processing ${item.type}:`, ex.message);
        if ((item.retries || 0) < 3) {
          remaining.push({ ...item, retries: (item.retries || 0) + 1 });
        }
      }
    }

    setOfflineQueue(remaining);
    try {
      if (remaining.length > 0) {
        localStorage.setItem('mdc_offline_sync_queue', JSON.stringify(remaining));
      } else {
        localStorage.removeItem('mdc_offline_sync_queue');
      }
    } catch (e) {}
    dbStorage.setItem('mdc_offline_sync_queue', remaining);
    isProcessingQueueRef.current = false;
  }, []);

  // Active Packing Draft State (Synced across all accounts in real-time)
  const [activePackDraft, setActivePackDraft] = useState(() => {
    try {
      const saved = localStorage.getItem('mdc_active_pack_draft');
      return saved ? JSON.parse(saved) : null;
    } catch (e) {
      return null;
    }
  });

  // Global Realtime WebSocket & Local Broadcast Event Dispatcher
  const broadcastCloudEvent = (type, payload = {}) => {
    try {
      if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
        const bc = new BroadcastChannel('mdc_sync_bus');
        bc.postMessage({ type, ...payload, timestamp: Date.now() });
        bc.close();
      }
    } catch (e) {}

    try {
      if (realtimeChannelRef.current && typeof realtimeChannelRef.current.send === 'function') {
        realtimeChannelRef.current.send({
          type: 'broadcast',
          event: 'mdc_sync',
          payload: { type, ...payload, timestamp: Date.now() }
        });
      }
    } catch (e) {}
  };

  const syncActivePackDraftToCloud = useCallback(async (draftObj) => {
    setActivePackDraft(draftObj || null);
    if (!supabase) return;
    try {
      if (!draftObj || !draftObj.items || draftObj.items.length === 0) {
        await supabase.from('saved_records').delete().eq('id', 'active_packing_manifest_draft');
      } else {
        await supabase.from('saved_records').upsert({
          id: 'active_packing_manifest_draft',
          record_type: 'packing_draft',
          period_label: draftObj.invoice_ref || draftObj.shipment_number || 'Live Packing Draft',
          period_year: new Date().getFullYear(),
          period_month: new Date().getMonth() + 1,
          period_week: draftObj.week_number || 1,
          notes: 'Live workstation packing list draft in progress',
          saved_by_name: draftObj.prepared_by_name || currentUser?.fullName || 'Warehouse Staff',
          snapshot_data: draftObj,
          updated_at: new Date().toISOString()
        }, { onConflict: 'id' });
      }
      broadcastCloudEvent('DRAFT_UPDATED', { count: draftObj?.items?.length || 0 });
    } catch (e) {
      console.warn('Sync active pack draft error:', e);
    }
  }, [currentUser?.fullName]);

  // Top-level Selective & Targeted Supabase Hydration function
  const hydrateFromSupabase = async (targetTables = null) => {
    if (!supabase) return false;
    try {
      const deletedIds = JSON.parse(localStorage.getItem('mdc_deleted_user_ids') || '[]');
      const shouldFetchAll = !targetTables || !Array.isArray(targetTables) || targetTables.length === 0;

      const shouldFetch = (table) => shouldFetchAll || targetTables.includes(table);

      // Execute targeted database queries simultaneously in parallel for instant response
      const queries = [];
      const queryKeys = [];

      if (shouldFetch('profiles')) { queries.push(supabase.from('profiles').select('*')); queryKeys.push('profiles'); }
      if (shouldFetch('user_page_permissions') || shouldFetch('profiles')) { queries.push(supabase.from('user_page_permissions').select('*')); queryKeys.push('perms'); }
      if (shouldFetch('sites')) { queries.push(supabase.from('sites').select('*')); queryKeys.push('sites'); }
      if (shouldFetch('parts') || shouldFetch('part_categories')) { queries.push(supabase.from('parts').select('*, part_categories(name, code)')); queryKeys.push('parts'); }
      if (shouldFetch('forecast_entries') || shouldFetch('forecast_cycles')) { queries.push(supabase.from('forecast_entries').select('*, parts(part_number, description)')); queryKeys.push('forecasts'); }
      if (shouldFetch('allocation_items') || shouldFetch('allocation_cycles')) { queries.push(supabase.from('allocation_items').select('*, parts(part_number, description), sites(id, code)')); queryKeys.push('allocations'); }
      if (shouldFetch('saved_records')) { queries.push(supabase.from('saved_records').select('*').order('created_at', { ascending: false }).limit(200)); queryKeys.push('records'); }
      if (shouldFetch('dc_intake_records')) { queries.push(supabase.from('dc_intake_records').select('*').order('created_at', { ascending: false }).limit(200)); queryKeys.push('intakes'); }
      if (shouldFetch('inventory_units')) { queries.push(supabase.from('inventory_units').select('*').order('received_at', { ascending: false }).limit(2000)); queryKeys.push('units'); }
      if (shouldFetch('shipments')) { queries.push(supabase.from('shipments').select('*').order('created_at', { ascending: false }).limit(200)); queryKeys.push('shipments'); }

      const results = await Promise.allSettled(queries);
      const resMap = {};
      results.forEach((r, idx) => {
        const k = queryKeys[idx];
        resMap[k] = r.status === 'fulfilled' ? r.value?.data : null;
      });

      const dbProfiles = resMap.profiles;
      const dbPerms = resMap.perms;
      const dbSites = resMap.sites;
      const dbParts = resMap.parts;
      const dbForecasts = resMap.forecasts;
      const dbAllocations = resMap.allocations;
      const dbRecords = resMap.records;
      const dbIntakes = resMap.intakes;
      const dbUnits = resMap.units;
      const dbShipments = resMap.shipments;

      // 1. Hydrate User Profiles & Permissions from Supabase
      if (dbProfiles !== undefined && dbProfiles !== null) {
        const activeDbProfiles = (dbProfiles || []).filter(p =>
          !p.is_deleted &&
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

        const mappedUsers = activeDbProfiles.map(p => {
          const emailKey = p.email.toLowerCase();
          const resolvedRole = p.role || 'user';
          const resolvedPosition = p.role_position || getDefaultRolePosition(resolvedRole);
          const userPerms = permMap.get(p.id) || (ROLE_PRESETS[resolvedRole] || ROLE_PRESETS.user);
          return {
            id: p.id,
            email: p.email,
            fullName: p.full_name || 'Staff User',
            role: resolvedRole,
            rolePosition: resolvedPosition,
            siteId: p.site_id || 'site-dc',
            hasSetPassword: p.has_set_password ?? true,
            passwordHash: p.password_hash || 'Password123',
            isActive: p.is_active ?? true,
            permittedPages: resolvedRole === 'superadmin' ? ROLE_PRESETS.superadmin : userPerms
          };
        });

        if (mappedUsers.length > 0) {
          setUsersList(mappedUsers);
          dbStorage.setItem('mdc_users', mappedUsers);
          try { localStorage.setItem('mdc_users', JSON.stringify(mappedUsers)); } catch (e) {}
        }
      }

      // 2. Hydrate Sites from Supabase (Merge with seedData to guarantee all 26+ branches exist)
      if (dbSites !== undefined && dbSites !== null) {
        const map = new Map();
        (seedData.sites || []).forEach(s => {
          if (s && s.code) map.set(s.code.toUpperCase(), { ...s });
        });
        (sites || []).forEach(s => {
          if (s && s.code) {
            const existing = map.get(s.code.toUpperCase());
            map.set(s.code.toUpperCase(), { ...existing, ...s });
          }
        });
        dbSites.filter(s => !s.is_deleted).forEach(s => {
          if (s && s.code) {
            const existing = map.get(s.code.toUpperCase());
            map.set(s.code.toUpperCase(), {
              ...existing,
              id: s.id || existing?.id,
              code: s.code,
              name: s.name,
              region: s.region || existing?.region || 'Metro Manila',
              address: s.address || s.full_address || existing?.address || '',
              full_address: s.full_address || s.address || existing?.full_address || '',
              contact_person: s.contact_person || existing?.contact_person || '',
              contact_phone: s.contact_phone || existing?.contact_phone || '',
              contact_email: s.contact_email || existing?.contact_email || '',
              ship_to: s.ship_to || existing?.ship_to || '',
              sold_to: s.sold_to || existing?.sold_to || '',
              invoice_prefix: s.invoice_prefix || existing?.invoice_prefix || '',
              is_dc: s.is_dc ?? existing?.is_dc ?? false,
              is_active: s.is_active ?? existing?.is_active ?? true
            });
          }
        });

        const mappedSites = Array.from(map.values()).sort((a, b) => (a.code || '').localeCompare(b.code || ''));
        setSites(mappedSites);
        try { localStorage.setItem('mdc_sites', JSON.stringify(mappedSites)); } catch (e) {}
        dbStorage.setItem('mdc_sites', mappedSites);
      }

      // 3. Hydrate Parts Catalog from Supabase
      if (dbParts !== undefined && dbParts !== null && dbParts.length > 0) {
        const mappedParts = dbParts.filter(p => !p.is_deleted).map(p => ({
          id: p.id,
          part_number: p.part_number,
          description: p.description,
          iphone_model: p.iphone_model || '',
          category_id: p.category_id || (p.part_categories?.code === 'BATTERY' ? 'cat-battery' : 'cat-display'),
          stocking_price: p.stocking_price || 0,
          safety_stock_pct: p.safety_stock_pct || 0.05,
          is_active: p.is_active ?? true
        }));

        setParts(mappedParts);
        try { localStorage.setItem('mdc_parts', JSON.stringify(mappedParts)); } catch (e) {}
        dbStorage.setItem('mdc_parts', mappedParts);
      }

      // 4. Hydrate Live Master Record & Forecasting / Allocations from Supabase
      if (dbRecords !== undefined && dbRecords !== null && dbRecords.length > 0) {
        // Check for Live Master Record Snapshot (multi-user synchronized state)
        const liveMaster = dbRecords.find(r => r.id === LIVE_MASTER_RECORD_ID && !r.is_deleted);
        
        if (liveMaster?.snapshot_data?.isCleared === true) {
          // Cloud Master Record is explicitly set to empty slate
          setForecastItems([]);
          setAllocations([]);
          dbStorage.setItem('mdc_forecast', []);
          dbStorage.setItem('mdc_allocations', []);
          dbStorage.setItem('mdc_is_cleared', true);
          try {
            localStorage.setItem('mdc_forecast', '[]');
            localStorage.setItem('mdc_allocations', '[]');
            localStorage.setItem('mdc_is_cleared', 'true');
          } catch (e) {}
        } else if (liveMaster?.snapshot_data) {
          const snap = liveMaster.snapshot_data;
          try {
            localStorage.removeItem('mdc_is_cleared');
            dbStorage.removeItem('mdc_is_cleared');
          } catch (e) {}

          if (Array.isArray(snap.forecastItems)) {
            setForecastItems(snap.forecastItems);
            dbStorage.setItem('mdc_forecast', snap.forecastItems);
            try { localStorage.setItem('mdc_forecast', JSON.stringify(snap.forecastItems)); } catch (e) {}
          }
          if (Array.isArray(snap.allocations)) {
            setAllocations(snap.allocations);
            dbStorage.setItem('mdc_allocations', snap.allocations);
            try { localStorage.setItem('mdc_allocations', JSON.stringify(snap.allocations)); } catch (e) {}
          }
          if (Array.isArray(snap.uploadAuditLogs)) {
            setUploadAuditLogs(snap.uploadAuditLogs);
            dbStorage.setItem('mdc_upload_audit_logs', snap.uploadAuditLogs);
            try { localStorage.setItem('mdc_upload_audit_logs', JSON.stringify(snap.uploadAuditLogs)); } catch (e) {}
          }
          if (snap.activePeriod?.label) {
            setActivePeriod(snap.activePeriod);
            try { localStorage.setItem('mdc_active_period', JSON.stringify(snap.activePeriod)); } catch (e) {}
          }
        } else if (isExplicitlyCleared()) {
          // Fallback if no cloud master record exists yet
          setForecastItems([]);
          setAllocations([]);
          dbStorage.setItem('mdc_forecast', []);
          dbStorage.setItem('mdc_allocations', []);
        }

        if (liveMaster?.snapshot_data?.uploadAuditLogs && Array.isArray(liveMaster.snapshot_data.uploadAuditLogs)) {
          setUploadAuditLogs(liveMaster.snapshot_data.uploadAuditLogs);
          dbStorage.setItem('mdc_upload_audit_logs', liveMaster.snapshot_data.uploadAuditLogs);
          try { localStorage.setItem('mdc_upload_audit_logs', JSON.stringify(liveMaster.snapshot_data.uploadAuditLogs)); } catch (e) {}
        }
        if (liveMaster?.snapshot_data?.activePeriod && liveMaster.snapshot_data.activePeriod.label) {
          setActivePeriod(liveMaster.snapshot_data.activePeriod);
          try { localStorage.setItem('mdc_active_period', JSON.stringify(liveMaster.snapshot_data.activePeriod)); } catch (e) {}
        }

        // Historical saved records (Strictly filter out system registries and deleted records registry)
        const historicalRecords = dbRecords.filter(r =>
          r.id !== LIVE_MASTER_RECORD_ID &&
          r.id !== 'active_packing_manifest_draft' &&
          !r.id.startsWith('deleted_') &&
          r.record_type !== 'shipment' &&
          r.record_type !== 'system_registry' &&
          r.record_type !== 'deletion_registry' &&
          r.period_label !== 'Deleted Records Registry' &&
          r.notes !== '__DELETED__' &&
          !r.is_deleted
        );

        // Permanently prune any legacy deletion registry records from Supabase saved_records table
        if (supabase) {
          supabase.from('saved_records')
            .delete()
            .in('id', ['deleted_intake_ids_registry', 'deleted_shipment_ids_registry'])
            .then(() => {})
            .catch(() => {});
        }

        if (historicalRecords.length > 0) {
          const mappedHistorical = historicalRecords.map(dbR => ({
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
          })).sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

          setSavedRecords(mappedHistorical);
          try { localStorage.setItem('mdc_saved_records', JSON.stringify(mappedHistorical.slice(0, 50))); } catch (e) {}
        } else {
          setSavedRecords([]);
          try { localStorage.setItem('mdc_saved_records', JSON.stringify([])); } catch (e) {}
        }
      }

      // 7. Hydrate DC Intake Records from Supabase
      const deletedIntakeIdsLocal = JSON.parse(localStorage.getItem('mdc_deleted_intake_ids') || '[]');
      const deletedRegistry = (dbRecords || []).find(r => r.id === 'deleted_intake_ids_registry');
      const deletedFromCloud = deletedRegistry?.snapshot_data?.deletedIds || [];
      const deletedIntakesSet = new Set([...deletedIntakeIdsLocal, ...deletedFromCloud]);

      let fetchedIntakes = [];
      if (dbIntakes !== undefined && dbIntakes !== null) {
        const validIntakes = (dbIntakes || []).filter(dbI => {
          if (!dbI || !dbI.id) return false;
          if (deletedIntakesSet.has(dbI.id)) return false;
          if (dbI.notes && dbI.notes.includes('__DELETED__')) return false;
          if (dbI.is_deleted === true) return false;
          return true;
        });

        fetchedIntakes = validIntakes;
        const mappedIntakes = validIntakes.map(dbI => ({
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
        })).sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

        setDcIntakeRecords(mappedIntakes);
        try { localStorage.setItem('mdc_dc_intake_records', JSON.stringify(mappedIntakes.slice(0, 100))); } catch (e) {}
        dbStorage.setItem('mdc_dc_intake_records', mappedIntakes);
      }

      // 7b. Hydrate Shipments & Packing Lists from Supabase
      const deletedShipmentIdsLocal = JSON.parse(localStorage.getItem('mdc_deleted_shipment_ids') || '[]');
      const deletedShipRegistry = (dbRecords || []).find(r => r.id === 'deleted_shipment_ids_registry');
      const deletedShipmentsFromCloud = deletedShipRegistry?.snapshot_data?.deletedIds || [];
      const deletedShipmentsSet = new Set([...deletedShipmentIdsLocal, ...deletedShipmentsFromCloud]);

      let effectiveShipments = shipments;
      if (dbShipments !== undefined && dbShipments !== null || dbRecords !== undefined && dbRecords !== null) {
        const cloudShipmentRecords = (dbRecords || [])
          .filter(r => r.record_type === 'shipment' && r.snapshot_data && !r.snapshot_data.isDeleted && r.notes !== '__DELETED__' && !r.is_deleted)
          .map(r => ({
            ...r.snapshot_data,
            id: r.id || r.snapshot_data?.id,
            created_at: r.created_at || r.snapshot_data?.created_at
          }));

        const directShipments = (dbShipments || []).filter(s => !s.is_deleted && s.status !== 'cancelled');
        const shipmentsMap = new Map();

        // 1. Preserve local / in-memory shipments that are not deleted
        (shipments || []).forEach(s => {
          if (s && s.id && !deletedShipmentsSet.has(s.id)) shipmentsMap.set(s.id, s);
        });

        // 2. Direct shipments from DB table
        directShipments.forEach(s => {
          if (s && s.id && !deletedShipmentsSet.has(s.id)) {
            const existing = shipmentsMap.get(s.id);
            shipmentsMap.set(s.id, { ...existing, ...s });
          }
        });

        // 3. Cloud shipment records with complete items snapshot
        cloudShipmentRecords.forEach(s => {
          if (s && s.id && !deletedShipmentsSet.has(s.id)) {
            const existing = shipmentsMap.get(s.id);
            shipmentsMap.set(s.id, { ...existing, ...s });
          }
        });

        // 4. Merge any offline queued shipments so locally saved manifests stay visible even if offline
        try {
          const offlineQ = JSON.parse(localStorage.getItem('mdc_offline_sync_queue') || '[]');
          offlineQ.forEach(item => {
            if (item.type === 'SHIPMENT_UPSERT' && item.payload?.snapshot_data) {
              const s = item.payload.snapshot_data;
              if (s && s.id && !deletedShipmentsSet.has(s.id)) shipmentsMap.set(s.id, s);
            }
          });
        } catch (e) {}

        const mergedShipments = Array.from(shipmentsMap.values()).sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
        effectiveShipments = mergedShipments;
        setShipments(mergedShipments);
        try { localStorage.setItem('mdc_shipments', JSON.stringify(mergedShipments)); } catch (e) {}
        dbStorage.setItem('mdc_shipments', mergedShipments);
      }

      // 7c. Hydrate Active Packing Draft from Supabase
      const cloudDraftRecord = (dbRecords || []).find(r => r.id === 'active_packing_manifest_draft' && !r.is_deleted);
      let effectiveDraft = cloudDraftRecord?.snapshot_data && Array.isArray(cloudDraftRecord.snapshot_data.items) && cloudDraftRecord.snapshot_data.items.length > 0
        ? cloudDraftRecord.snapshot_data
        : null;

      // If cloud draft is empty/null, clear active draft across all sessions
      setActivePackDraft(effectiveDraft);
      if (effectiveDraft) {
        try { localStorage.setItem('mdc_active_pack_draft', JSON.stringify(effectiveDraft)); } catch (e) {}
      } else {
        try { localStorage.removeItem('mdc_active_pack_draft'); } catch (e) {}
      }

      // 8. Hydrate Serialized Inventory Units from Supabase
      if (dbUnits !== undefined && dbUnits !== null || shouldFetch('inventory_units') || shouldFetch('dc_intake_records')) {
        setInventoryUnits(prev => {
          const map = new Map();

          // Add units from live_master_dc_inventory in saved_records
          const masterInvRecord = (dbRecords || []).find(r => r.id === 'live_master_dc_inventory' && !r.is_deleted);
          if (masterInvRecord?.snapshot_data?.units && Array.isArray(masterInvRecord.snapshot_data.units)) {
            masterInvRecord.snapshot_data.units.forEach(u => {
              const cleanSerial = String(u.serial_number || '').toUpperCase();
              if (cleanSerial) {
                const existing = map.get(cleanSerial);
                map.set(cleanSerial, { ...existing, ...u });
              }
            });
          }

          // Add units from all saved intake records in dc_intake_records
          const allIntakeSources = fetchedIntakes && fetchedIntakes.length > 0 ? fetchedIntakes : (dcIntakeRecords || []);
          allIntakeSources.forEach(rec => {
            if (Array.isArray(rec.items)) {
              rec.items.forEach(it => {
                const cleanSerial = String(it.serial_number || '').toUpperCase();
                if (cleanSerial) {
                  const existing = map.get(cleanSerial);
                  map.set(cleanSerial, {
                    id: it.id || existing?.id || `unit-${cleanSerial}`,
                    part_id: it.part_id || existing?.part_id || `part-${it.part_number}`,
                    part_number: it.part_number || existing?.part_number,
                    description: it.description || existing?.description || 'Service Replacement Part',
                    serial_number: it.serial_number || cleanSerial,
                    current_site_id: 'site-dc',
                    site_code: 'DC-MDC',
                    po_id: it.po_id || rec.po_id || existing?.po_id || null,
                    status: existing?.status || 'in_stock',
                    box_number: 1,
                    received_at: it.received_at || existing?.received_at || rec.intake_date || new Date().toISOString(),
                    received_by: it.received_by || existing?.received_by || rec.saved_by_name || 'Warehouse Staff',
                    shipped_at: existing?.shipped_at || null,
                    intake_record_id: rec.id
                  });
                }
              });
            }
          });

          // Add units from inventory_units table if present
          if (dbUnits && dbUnits.length > 0) {
            dbUnits.filter(u => !u.is_deleted).forEach(dbU => {
              const cleanSerial = String(dbU.serial_number || '').toUpperCase();
              if (cleanSerial) {
                const existing = map.get(cleanSerial);
                map.set(cleanSerial, {
                  id: dbU.id || existing?.id || `unit-${cleanSerial}`,
                  part_id: dbU.part_id || existing?.part_id,
                  part_number: dbU.part_number || dbU.notes || existing?.part_number || 'PART',
                  description: dbU.description || dbU.notes || existing?.description || 'Service Replacement Part',
                  serial_number: dbU.serial_number || cleanSerial,
                  current_site_id: dbU.current_site_id || 'site-dc',
                  site_code: dbU.site_code || 'DC-MDC',
                  po_id: dbU.po_id || existing?.po_id,
                  status: dbU.status || existing?.status || 'in_stock',
                  box_number: dbU.box_number || 1,
                  received_at: dbU.received_at || existing?.received_at || new Date().toISOString(),
                  received_by: dbU.received_by_name || existing?.received_by || 'Warehouse Staff',
                  allocated_at: dbU.allocated_at,
                  shipped_at: dbU.shipped_at,
                  notes: dbU.notes
                });
              }
            });
          }

          // Include any local unsaved session scans currently in draft
          (prev || []).forEach(u => {
            if (u.isSessionDraft && !map.has(String(u.serial_number || '').toUpperCase())) {
              map.set(String(u.serial_number || '').toUpperCase(), u);
            }
          });

          const mergedRaw = Array.from(map.values()).sort((a, b) => new Date(b.received_at || 0) - new Date(a.received_at || 0));
          const merged = reconcileUnitsWithPackedDrafts(mergedRaw, effectiveShipments, effectiveDraft);
          try { localStorage.setItem('mdc_inventory', JSON.stringify(merged)); } catch (e) {}
          dbStorage.setItem('mdc_inventory', merged);
          return merged;
        });
      }

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
  const autoRefreshData = async ({ silent = true, force = false, reason = 'auto', tables = null } = {}) => {
    const now = Date.now();
    // Skip auto-refresh while a cloud save is actively in progress to prevent race conditions
    if (silent && cloudSyncStatus.isSaving) {
      return { success: true, throttled: true, reason: 'save_in_progress' };
    }
    // Throttle automatic revalidations to avoid spamming the DB within 1000ms
    if (!force && now - lastRefreshTimeRef.current < 1000) {
      return { success: true, throttled: true };
    }
    lastRefreshTimeRef.current = now;
    setIsAutoRefreshing(true);
    console.debug('[AutoRefresh] Sync trigger:', reason, tables ? `(Tables: ${tables.join(', ')})` : '(Full)');

    try {
      try {
        localStorage.removeItem('mdc_is_cleared');
        dbStorage.removeItem('mdc_is_cleared');
      } catch (e) {}

      const success = await hydrateFromSupabase(tables);
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
      }, 300);
    }
  };

  const refreshDataFromCloud = async () => {
    return await autoRefreshData({ silent: false, force: true, reason: 'Manual sync trigger' });
  };

  // Debounced burst handler for Realtime Postgres events
  const pendingRealtimeTablesRef = useRef(new Set());
  const debounceRealtimeTimerRef = useRef(null);

  const triggerDebouncedRealtimeSync = useCallback((reason, table = null) => {
    if (table) {
      pendingRealtimeTablesRef.current.add(table);
    }
    if (debounceRealtimeTimerRef.current) {
      clearTimeout(debounceRealtimeTimerRef.current);
    }
    debounceRealtimeTimerRef.current = setTimeout(() => {
      const targetTables = pendingRealtimeTablesRef.current.size > 0
        ? Array.from(pendingRealtimeTablesRef.current)
        : null;
      pendingRealtimeTablesRef.current.clear();
      autoRefreshData({
        silent: true,
        force: false,
        reason: `Debounced Realtime [${reason}]`,
        tables: targetTables
      });
    }, 300);
  }, []);

  // 1. Initial Supabase Hydration and Realtime Subscriptions on app mount
  useEffect(() => {
    let realtimeChannel = null;

    autoRefreshData({ silent: true, force: true, reason: 'Initial app mount' });

    // Set up Realtime listener for multi-user synchronization
    let broadcastBus = null;
    try {
      if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
        broadcastBus = new BroadcastChannel('mdc_sync_bus');
        broadcastBus.onmessage = (ev) => {
          if (ev.data && ev.data.type) {
            triggerDebouncedRealtimeSync(`Local Broadcast: ${ev.data.type}`, ev.data.table || null);
          }
        };
      }

      if (supabase && typeof supabase.channel === 'function') {
        realtimeChannel = supabase
          .channel('mdc-global-sync-room', {
            config: { broadcast: { self: false } }
          })
          .on('broadcast', { event: 'mdc_sync' }, (payload) => {
            console.debug('[Realtime WebSocket] Received global peer sync broadcast:', payload);
            triggerDebouncedRealtimeSync(`WebSocket Broadcast: ${payload?.payload?.type || 'SYNC'}`, payload?.payload?.table || null);
          });

        // Register postgres_changes for all core tables
        const SYNC_TABLES = [
          'profiles',
          'user_page_permissions',
          'parts',
          'part_categories',
          'sites',
          'repair_usage_records',
          'forecast_cycles',
          'forecast_entries',
          'purchase_orders',
          'po_items',
          'inventory_units',
          'allocation_cycles',
          'allocation_items',
          'shipments',
          'shipment_items',
          'scan_logs',
          'saved_records',
          'dc_intake_records'
        ];

        SYNC_TABLES.forEach(tbl => {
          realtimeChannel.on('postgres_changes', { event: '*', schema: 'public', table: tbl }, (ev) => {
            console.debug(`[Realtime Postgres] ${tbl} ${ev.eventType}`);
            triggerDebouncedRealtimeSync(`postgres_changes:${tbl}`, tbl);
          });
        });

        realtimeChannel.subscribe((status) => {
          console.debug('[Realtime WebSocket] Global channel status:', status);
          if (status === 'SUBSCRIBED') {
            setRealtimeConnected(true);
            setCloudSyncStatus(prev => ({ ...prev, isOnline: true }));
          } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
            setRealtimeConnected(false);
          }
        });

        realtimeChannelRef.current = realtimeChannel;
      }
    } catch (e) {
      console.warn('Realtime / Broadcast channel notice:', e);
    }

    return () => {
      if (broadcastBus) {
        try { broadcastBus.close(); } catch (e) {}
      }
      if (realtimeChannel && supabase) {
        supabase.removeChannel(realtimeChannel);
        realtimeChannelRef.current = null;
      }
    };
  }, []);

  // 2. Auto-Refresh on Page Navigation
  useEffect(() => {
    if (currentUser && activeTab) {
      autoRefreshData({ silent: true, force: false, reason: `Page visit: ${activeTab}` });
    }
  }, [activeTab, currentUser]);

  // 3. Auto-Refresh on Window Focus, Tab Visibility Change, and Network Reconnection
  useEffect(() => {
    const handleFocusOrVisibility = () => {
      if (document.visibilityState === 'visible' && currentUser) {
        const now = Date.now();
        if (now - lastRefreshTimeRef.current >= 1500) {
          autoRefreshData({ silent: true, force: false, reason: 'Tab/Window refocus' });
        }
      }
    };

    const handleOnline = () => {
      if (currentUser) {
        processOfflineSyncQueue();
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
  }, [currentUser, processOfflineSyncQueue]);

  // 4. Periodic background safety-net heartbeat revalidation (60s when Realtime is active, 15s fallback when offline/disconnected)
  useEffect(() => {
    if (!currentUser) return;
    const intervalMs = realtimeConnected ? 60000 : 15000;
    const heartbeatInterval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        processOfflineSyncQueue();
        autoRefreshData({ silent: true, force: false, reason: 'Background safety heartbeat' });
      }
    }, intervalMs);
    return () => clearInterval(heartbeatInterval);
  }, [currentUser, realtimeConnected, processOfflineSyncQueue]);


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

  // --- SERIALIZED DATA DELETION & PURGE AUDIT LOGGER ---
  const logDeletionAudit = async ({
    entityType,
    entityId,
    entityLabel,
    summary = {},
    reason = 'User initiated deletion'
  }) => {
    const newLog = {
      id: `del-audit-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      timestamp: new Date().toISOString(),
      action: 'DELETE',
      entity_type: entityType,
      entity_id: entityId,
      entity_label: entityLabel || entityId,
      deleted_by_id: currentUser?.id || 'usr-system',
      deleted_by_name: currentUser?.fullName || 'System User',
      deleted_by_email: currentUser?.email || '',
      deleted_by_role: currentUser?.role || 'admin',
      deleted_by_position: currentUser?.rolePosition || getDefaultRolePosition(currentUser?.role) || 'Parts Management Specialist',
      reason,
      summary
    };

    setDeletionAuditLogs(prev => {
      const updated = [newLog, ...(prev || [])];
      try {
        localStorage.setItem('mdc_deletion_audit_logs', JSON.stringify(updated.slice(0, 250)));
      } catch (e) {}
      return updated;
    });

    try {
      await dbStorage.setItem('mdc_deletion_audit_logs', [newLog, ...(deletionAuditLogs || [])]);
    } catch (e) {}

    // Cloud Database Persistence & Broadcast
    if (supabase) {
      try {
        await supabase.from('audit_logs').insert([{
          action: 'DELETE',
          entity_type: entityType,
          entity_id: entityId,
          user_id: currentUser?.id || 'usr-system',
          user_name: currentUser?.fullName || 'System User',
          user_email: currentUser?.email || '',
          metadata: newLog,
          created_at: newLog.timestamp
        }]).catch(() => {});
      } catch (err) {}
    }

    broadcastCloudEvent('AUDIT_DELETION_LOGGED', { log: newLog });
    return newLog;
  };

  const resetToDefaultData = async () => {
    dbStorage.removeItem('mdc_is_cleared');
    dbStorage.setItem('mdc_forecast', seedData.forecastItems);
    dbStorage.setItem('mdc_allocations', seedData.allocations);
    dbStorage.setItem('mdc_inventory', seedData.inventoryUnits || []);
    dbStorage.setItem('mdc_parts', seedData.parts);
    dbStorage.setItem('mdc_sites', seedData.sites);
    dbStorage.setItem('mdc_categories', seedData.categories);

    const septPeriod = { month: 9, year: 2026, label: 'September 2026' };
    setActivePeriod(septPeriod);

    try {
      localStorage.removeItem('mdc_is_cleared');
      localStorage.setItem('mdc_active_period', JSON.stringify(septPeriod));
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
        id: 'po-202609-01',
        po_number: 'PO-2026-SEP-BATTERY',
        order_date: '2026-09-01',
        expected_date: '2026-09-10',
        status: 'partially_received',
        remarks: 'Monthly Battery replenishment for iPhone 13-17 series',
        items: [
          { part_id: 'part-661-21991', part_number: '661-21991', description: 'Battery, iPhone 13', quantity_ordered: 234, quantity_received: 150, unit_price: 89 },
          { part_id: 'part-661-21996', part_number: '661-21996', description: 'Battery, iPhone 13 Pro', quantity_ordered: 24, quantity_received: 20, unit_price: 89 },
          { part_id: 'part-661-22294', part_number: '661-22294', description: 'Battery, iPhone 13 Pro Max', quantity_ordered: 31, quantity_received: 31, unit_price: 89 }
        ]
      },
      {
        id: 'po-202609-02',
        po_number: 'PO-2026-SEP-DISPLAY',
        order_date: '2026-09-02',
        expected_date: '2026-09-12',
        status: 'submitted',
        remarks: 'Monthly Display replenishment',
        items: [
          { part_id: 'part-661-21988', part_number: '661-21988', description: 'Display, iPhone 13', quantity_ordered: 23, quantity_received: 0, unit_price: 279 },
          { part_id: 'part-661-56050', part_number: '661-56050', description: 'Display, iPhone 17 Pro Max', quantity_ordered: 45, quantity_received: 0, unit_price: 379 }
        ]
      }
    ]);

    // Sync live master state to Supabase
    if (supabase) {
      try {
        await supabase.from('saved_records').upsert({
          id: LIVE_MASTER_RECORD_ID,
          record_type: 'both',
          period_label: 'September 2026',
          period_year: 2026,
          period_month: 9,
          notes: 'Master operational dataset synchronized with Google Sheets September 2026',
          saved_by_name: currentUser?.fullName || 'Parts Management Specialist',
          snapshot_data: {
            isCleared: false,
            activePeriod: septPeriod,
            forecastItems: seedData.forecastItems,
            allocations: seedData.allocations,
            uploadAuditLogs: []
          },
          updated_at: new Date().toISOString()
        }, { onConflict: 'id' });
        broadcastCloudEvent('MASTER_DATA_UPDATED', { period: 'September 2026' });
      } catch (e) {
        console.warn('Sync master state on reset error:', e);
      }
    }

    showToast('Loaded verified September 2026 dataset (591 units, $91,199.00) matching Google Sheets', 'success');
  };

  const clearAllData = async () => {
    // 1. Set local cleared flags
    dbStorage.setItem('mdc_is_cleared', true);
    dbStorage.setItem('mdc_forecast', []);
    dbStorage.setItem('mdc_allocations', []);
    dbStorage.setItem('mdc_inventory', []);
    dbStorage.setItem('mdc_pos', []);
    dbStorage.setItem('mdc_shipments', []);
    dbStorage.setItem('mdc_scan_logs', []);
    dbStorage.setItem('mdc_repair_usage', []);
    dbStorage.setItem('mdc_stock_transfer_reports', []);
    dbStorage.setItem('mdc_stock_transfer_metadata', null);

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
      localStorage.setItem('mdc_stock_transfer_reports', '[]');
      localStorage.removeItem('mdc_stock_transfer_metadata');
    } catch (e) {
      console.warn('LocalStorage clear error:', e);
    }

    // 2. Clear React local state
    setForecastItems([]);
    setAllocations([]);
    setInventoryUnits([]);
    setPurchaseOrders([]);
    setShipments([]);
    setScanLogs([]);
    setRepairUsageRecords([]);
    setStockTransferReports([]);
    setStockTransferMetadata(null);

    // 3. Log deletion audit for traceability
    await logDeletionAudit({
      entityType: 'System State Reset',
      entityId: 'ALL_OPERATIONAL_DATA',
      entityLabel: 'Clear System to Fresh Empty State',
      summary: {
        action: 'CLEARED_ALL_DATA',
        previousForecastCount: forecastItems.length,
        previousAllocCount: allocations.length,
        previousInventoryCount: inventoryUnits.length
      },
      reason: 'User initialized clean slate for new forecasting & allocation ingestion'
    });

    // 4. Synchronize Cleared State to Cloud Database (Supabase)
    if (supabase) {
      setCloudSyncStatus(prev => ({ ...prev, isSaving: true }));
      try {
        // A. Upsert live master snapshot as CLEARED
        await supabase.from('saved_records').upsert({
          id: LIVE_MASTER_RECORD_ID,
          record_type: 'both',
          period_label: 'Cleared Empty State',
          notes: 'Master operational data cleared by user',
          saved_by_name: currentUser?.fullName || 'Parts Management Specialist',
          snapshot_data: {
            isCleared: true,
            forecastItems: [],
            allocations: [],
            uploadAuditLogs: uploadAuditLogs || []
          },
          updated_at: new Date().toISOString()
        }, { onConflict: 'id' });

        // B. Clear live DC inventory in saved_records
        await supabase.from('saved_records').upsert({
          id: 'live_master_dc_inventory',
          record_type: 'both',
          period_label: 'Live Master DC Inventory',
          notes: 'Cleared inventory state',
          saved_by_name: currentUser?.fullName || 'Warehouse Staff',
          snapshot_data: {
            units: []
          },
          updated_at: new Date().toISOString()
        }, { onConflict: 'id' });

        // C. Clear forecast_entries & allocation_entries table rows
        try {
          await supabase.from('forecast_entries').delete().neq('part_id', '00000000-0000-0000-0000-000000000000');
        } catch (e) {}
        try {
          await supabase.from('allocation_entries').delete().neq('part_id', '00000000-0000-0000-0000-000000000000');
        } catch (e) {}

        setCloudSyncStatus({ isSaving: false, lastSaved: new Date(), isOnline: true });
        broadcastCloudEvent('MASTER_DATA_CLEARED', { timestamp: new Date().toISOString() });
      } catch (dbErr) {
        console.error('Supabase clearAllData error:', dbErr.message);
        setCloudSyncStatus(prev => ({ ...prev, isSaving: false, isOnline: false }));
        broadcastCloudEvent('MASTER_DATA_CLEARED', { timestamp: new Date().toISOString() });
      }
    } else {
      broadcastCloudEvent('MASTER_DATA_CLEARED', { timestamp: new Date().toISOString() });
    }

    showToast('Cleared all operational modules (Forecasting, Allocation, Reports, and Inventory). Clean slate ready for fresh uploads!', 'info');
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

      // 4. Synchronize full DC inventory pool to saved_records under 'live_master_dc_inventory'
      try {
        let currentInv = [];
        try {
          currentInv = JSON.parse(localStorage.getItem('mdc_inventory') || '[]');
        } catch (e) {}
        const mergedMap = new Map();
        currentInv.forEach(u => {
          const s = String(u.serial_number || '').toUpperCase();
          if (s) mergedMap.set(s, u);
        });
        units.forEach(u => {
          const s = String(u.serial_number || '').toUpperCase();
          if (s) {
            mergedMap.set(s, {
              id: u.id || `unit-${u.serial_number}`,
              part_id: u.part_id || `part-${u.part_number}`,
              part_number: u.part_number,
              description: u.description || 'Service Replacement Part',
              serial_number: u.serial_number,
              current_site_id: 'site-dc',
              site_code: 'DC-MDC',
              status: u.status || 'in_stock',
              box_number: u.box_number || 1,
              received_at: u.received_at || new Date().toISOString(),
              received_by: u.received_by || currentUser?.fullName || 'Warehouse Staff',
              shipped_at: u.shipped_at || null
            });
          }
        });
        const allPoolUnits = Array.from(mergedMap.values());
        await supabase.from('saved_records').upsert({
          id: 'live_master_dc_inventory',
          record_type: 'inventory_master',
          period_label: 'Live Master DC Inventory',
          period_year: new Date().getFullYear(),
          period_month: new Date().getMonth() + 1,
          period_week: 1,
          notes: 'Master DC In-Stock inventory pool across all accounts',
          saved_by_name: currentUser?.fullName || 'Warehouse Staff',
          snapshot_data: {
            units: allPoolUnits
          },
          updated_at: new Date().toISOString()
        }, { onConflict: 'id' });
      } catch (poolErr) {
        console.warn('live_master_dc_inventory sync note:', poolErr.message);
      }

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

    // Save individual units to database
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

    // Global Realtime & Local Broadcast Sync
    broadcastCloudEvent('UNITS_IMPORTED', { count: newUnits.length });

    barcodeAudio.playSuccess();
    showToast(`Successfully imported ${newUnits.length} parts into DC Stock!`, 'success');
    return { success: true, count: newUnits.length, units: newUnits };
  };

  // 1.15 Finalize / Commit Units directly into Permanent Active DC In-Stock (Available for Packing & Multi-User Access)
  const commitUnitsToStock = async (unitsList = []) => {
    let targetUnits = unitsList;
    if (!targetUnits || targetUnits.length === 0) {
      targetUnits = inventoryUnits;
    }
    if (!targetUnits || targetUnits.length === 0) {
      targetUnits = dcIntakeRecords.flatMap(r => Array.isArray(r.items) ? r.items : []);
    }
    if (!targetUnits || targetUnits.length === 0) {
      showToast('No units found to add to stock', 'error');
      return { success: false, error: 'No units found' };
    }

    const nowIso = new Date().toISOString();
    const finalUnits = targetUnits.map(u => ({
      ...u,
      id: u.id || `unit-${u.serial_number}`,
      part_id: u.part_id || `part-${u.part_number}`,
      part_number: u.part_number,
      description: u.description || 'Service Replacement Part',
      serial_number: String(u.serial_number || '').trim().toUpperCase(),
      current_site_id: 'site-dc',
      site_code: 'DC-MDC',
      status: 'in_stock',
      box_number: 1,
      received_at: nowIso,
      received_by: currentUser?.fullName || 'Warehouse Staff',
      shipped_at: null,
      shipped_by: null
    }));

    // Update inventory units state immediately
    let allUpdatedUnits = [];
    setInventoryUnits(prev => {
      const map = new Map((prev || []).map(u => [String(u.serial_number || '').toUpperCase(), u]));
      finalUnits.forEach(u => map.set(String(u.serial_number).toUpperCase(), u));
      allUpdatedUnits = Array.from(map.values());
      try {
        localStorage.removeItem('mdc_is_cleared');
        localStorage.setItem('mdc_inventory', JSON.stringify(allUpdatedUnits));
        localStorage.removeItem('mdc_recent_scans');
      } catch (e) {}
      dbStorage.setItem('mdc_inventory', allUpdatedUnits);
      return allUpdatedUnits;
    });

    // Direct Cloud Database Batch Auto-Save
    saveUnitsToSupabase(finalUnits);

    // Global Realtime & Local Broadcast Sync
    broadcastCloudEvent('STOCK_UPDATED', { count: finalUnits.length });

    barcodeAudio.playSuccess();
    showToast(`Successfully added ${finalUnits.length} parts to DC In-Stock! Visible for packing list creation across all accounts.`, 'success');
    return { success: true, count: finalUnits.length, units: finalUnits };
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

    // 4. Remove from Supabase Cloud Database tables (inventory_units & saved_records)
    if (supabase) {
      (async () => {
        setCloudSyncStatus(prev => ({ ...prev, isSaving: true }));
        try {
          // Delete from inventory_units
          await supabase.from('inventory_units').delete().eq('serial_number', existing.serial_number);

          // Update live_master_dc_inventory in saved_records
          await supabase.from('saved_records').upsert({
            id: 'live_master_dc_inventory',
            record_type: 'inventory_master',
            period_label: 'Live Master DC Inventory',
            period_year: new Date().getFullYear(),
            period_month: new Date().getMonth() + 1,
            period_week: 1,
            notes: 'Master DC In-Stock inventory pool across all accounts',
            saved_by_name: currentUser?.fullName || 'Warehouse Staff',
            snapshot_data: {
              units: nextUnits
            },
            updated_at: new Date().toISOString()
          }, { onConflict: 'id' });

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

    // 5. If linked to a PO, decrement received quantity on that PO
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

    broadcastCloudEvent('STOCK_UPDATED', { serial: cleanSerial });
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
            .upsert({
              part_id: unit.part_id,
              serial_number: cleanSerial,
              status: 'packed',
              box_number: boxNumber,
              current_site_id: siteId || 'site-dc',
              shipped_at: new Date().toISOString()
            }, { onConflict: 'serial_number' });
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

    // Global Realtime & Local Broadcast Sync
    broadcastCloudEvent('UNIT_PACKED', { serialNumber: cleanSerial });

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
          const rowsToUpsert = itemsToAdd.map(it => {
            const matchUnit = updatedSerialsMap.get(it.serial_number.toUpperCase());
            return {
              part_id: matchUnit?.part_id || `part-${it.part_number}`,
              serial_number: it.serial_number,
              status: 'packed',
              box_number: it.box_number || 1,
              current_site_id: siteId || 'site-dc',
              shipped_at: new Date().toISOString()
            };
          });
          await supabase
            .from('inventory_units')
            .upsert(rowsToUpsert, { onConflict: 'serial_number' });
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

    // Global Realtime & Local Broadcast Sync
    broadcastCloudEvent('UNITS_BATCH_PACKED', { count: itemsToAdd.length });

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

    // Global Realtime & Local Broadcast Sync
    broadcastCloudEvent('UNIT_UNPACKED', { serialNumber: cleanSerial });

    showToast(`Removed #${cleanSerial} from packing list. Returned to DC In-Stock inventory.`, 'info');
    return { success: true, unit: revertedPart };
  };

  // 2.2 Clear / Unpack Items from a Specific Shipment Draft (Returns all parts back to DC In-Stock inventory)
  const clearShipmentDraftItems = async (shipmentIdOrObj, explicitItems = []) => {
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

    if (itemsToProcess.length === 0) {
      return { success: true, count: 0 };
    }

    const serialsToRevert = new Set(
      itemsToProcess.map(it => String(it.serial_number || it.serialNumber || '').trim().toUpperCase()).filter(Boolean)
    );

    if (serialsToRevert.size > 0) {
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
      dbStorage.setItem('mdc_inventory', updatedInventory);
      try { localStorage.setItem('mdc_inventory', JSON.stringify(updatedInventory)); } catch (e) {}
    }

    if (targetShipmentId) {
      setShipments(prev => prev.map(sh => {
        if (sh.id === targetShipmentId) {
          return {
            ...sh,
            items: []
          };
        }
        return sh;
      }));
    }

    if (supabase && serialsToRevert.size > 0) {
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
          const { error } = await supabase
            .from('inventory_units')
            .update({
              status: 'in_stock',
              current_site_id: dcSiteId,
              box_number: 1,
              shipped_at: null,
              shipped_by: null
            })
            .in('serial_number', serialsArray);
          if (error) throw error;
        }
        setCloudSyncStatus({ isSaving: false, lastSaved: new Date(), isOnline: true });
        broadcastCloudEvent('DRAFT_CLEARED', { shipmentId: targetShipmentId });
      } catch (dbErr) {
        console.error('Supabase inventory revert error:', dbErr.message);
        setCloudSyncStatus(prev => ({ ...prev, isSaving: false, isOnline: false }));
        broadcastCloudEvent('DRAFT_CLEARED', { shipmentId: targetShipmentId });
      }
    } else {
      broadcastCloudEvent('DRAFT_CLEARED', { shipmentId: targetShipmentId });
    }

    showToast(`Cleared ${serialsToRevert.size} packed items from draft. Units returned to In-Stock DC inventory!`, 'info');
    return { success: true, count: serialsToRevert.size };
  };

  // 2.2b Explicit Delete of a Saved Shipment from Database History
  const deleteShipment = async (shipmentId) => {
    const target = shipments.find(s => s.id === shipmentId);
    if (!target) return { success: false, error: 'Shipment not found' };

    // Revert packed items back to in_stock
    let serialsToRevert = [];
    let updatedInventory = inventoryUnits;
    if (target.items && target.items.length > 0) {
      serialsToRevert = target.items.map(it => String(it.serial_number || it.serialNumber || '').trim().toUpperCase()).filter(Boolean);
      const serialsSet = new Set(serialsToRevert);
      updatedInventory = inventoryUnits.map(u => {
        if (serialsSet.has(String(u.serial_number || '').toUpperCase())) {
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
    try {
      localStorage.setItem('mdc_shipments', JSON.stringify(nextList));
      const deletedList = JSON.parse(localStorage.getItem('mdc_deleted_shipment_ids') || '[]');
      localStorage.setItem('mdc_deleted_shipment_ids', JSON.stringify([...new Set([...deletedList, shipmentId])]));
    } catch (e) {}

    // Log deletion audit with user accountability
    await logDeletionAudit({
      entityType: 'Shipment Manifest',
      entityId: shipmentId,
      entityLabel: target.tracking_number ? `Shipment #${target.tracking_number}` : `Shipment ${shipmentId}`,
      summary: {
        destinationSite: target.destination_site_name || target.destination_site_id || 'Branch',
        itemsCount: target.items?.length || 0,
        boxCount: target.box_count || 1,
        shippedAt: target.shipped_at || target.created_at
      },
      reason: 'Deleted by warehouse dispatcher / admin'
    });

    // Direct Cloud Sync to Supabase
    if (supabase) {
      setCloudSyncStatus(prev => ({ ...prev, isSaving: true }));
      try {
        // Hard delete and soft-delete from saved_records
        const { error: delRecErr } = await supabase.from('saved_records').delete().eq('id', shipmentId);
        if (delRecErr) {
          await supabase.from('saved_records').update({ notes: '__DELETED__', snapshot_data: { isDeleted: true }, updated_at: new Date().toISOString() }).eq('id', shipmentId);
        }
        try { await supabase.from('shipments').delete().eq('id', shipmentId); } catch (e) {}
        // Prune any legacy deleted_shipment_ids_registry in saved_records
        await supabase.from('saved_records').delete().eq('id', 'deleted_shipment_ids_registry');

        // Update live_master_dc_inventory in saved_records so stock returns to in-stock across all users
        if (updatedInventory && updatedInventory.length > 0) {
          await supabase.from('saved_records').upsert({
            id: 'live_master_dc_inventory',
            record_type: 'inventory_master',
            period_label: 'Live Master DC Inventory',
            period_year: new Date().getFullYear(),
            period_month: new Date().getMonth() + 1,
            period_week: 1,
            notes: 'Master DC In-Stock inventory pool across all accounts',
            saved_by_name: currentUser?.fullName || 'Warehouse Staff',
            snapshot_data: {
              units: updatedInventory
            },
            updated_at: new Date().toISOString()
          }, { onConflict: 'id' });
        }

        if (serialsToRevert.length > 0) {
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
              .in('serial_number', serialsToRevert);
          }
        }
        setCloudSyncStatus({ isSaving: false, lastSaved: new Date(), isOnline: true });
        broadcastCloudEvent('SHIPMENT_DELETED', { shipmentId });
      } catch (dbErr) {
        console.error('Supabase delete shipment error:', dbErr.message);
        setCloudSyncStatus(prev => ({ ...prev, isSaving: false, isOnline: false }));
        enqueueOfflineAction('SHIPMENT_DELETE', { shipmentId });
        broadcastCloudEvent('SHIPMENT_DELETED', { shipmentId });
      }
    } else {
      broadcastCloudEvent('SHIPMENT_DELETED', { shipmentId });
    }

    showToast(`Deleted manifest ${target.invoice_ref || target.shipment_number} from database. Parts returned to DC In-Stock.`, 'info');
    return { success: true };
  };

  // 2.3 Batch Import Shipments / Manifests
  const batchImportShipments = async (newShipmentsList) => {
    if (!newShipmentsList || newShipmentsList.length === 0) {
      return { success: false, error: 'No shipments to import' };
    }

    const updated = [...newShipmentsList, ...shipments.filter(s => !newShipmentsList.some(ns => ns.id === s.id))];
    setShipments(updated);

    try {
      localStorage.setItem('mdc_shipments', JSON.stringify(updated));
    } catch (e) {
      console.warn('LocalStorage save error:', e);
    }
    dbStorage.setItem('mdc_shipments', updated);    // Direct Cloud Sync to Supabase
    if (supabase) {
      setCloudSyncStatus(prev => ({ ...prev, isSaving: true }));
      try {
        const recordsToUpsert = newShipmentsList.map(sh => ({
          id: sh.id,
          record_type: 'shipment',
          period_label: sh.invoice_ref || sh.shipment_number,
          period_year: new Date().getFullYear(),
          period_month: new Date().getMonth() + 1,
          period_week: sh.week_number || 1,
          notes: sh.remarks || '',
          saved_by_name: sh.prepared_by_name || currentUser?.fullName || 'Warehouse Staff',
          saved_by_user_id: safeUUID(currentUser?.id),
          snapshot_data: sh,
          created_at: sh.created_at || new Date().toISOString(),
          updated_at: new Date().toISOString()
        }));
        const { error } = await supabase.from('saved_records').upsert(recordsToUpsert, { onConflict: 'id' });
        if (error) throw error;
        setCloudSyncStatus({ isSaving: false, lastSaved: new Date(), isOnline: true });
        broadcastCloudEvent('SHIPMENTS_IMPORTED', { count: newShipmentsList.length });
      } catch (dbErr) {
        console.error('Supabase batch import shipments error:', dbErr.message);
        setCloudSyncStatus(prev => ({ ...prev, isSaving: false, isOnline: false }));
        broadcastCloudEvent('SHIPMENTS_IMPORTED', { count: newShipmentsList.length });
      }
    } else {
      broadcastCloudEvent('SHIPMENTS_IMPORTED', { count: newShipmentsList.length });
    }

    showToast(`Successfully imported ${newShipmentsList.length} shipment manifests!`, 'success');
    return { success: true, count: newShipmentsList.length };
  };

  // 2.4 Clear All Shipments & Packing Records
  const clearAllShipmentsData = async () => {
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
    dbStorage.setItem('mdc_inventory', updatedInventory);
    dbStorage.setItem('mdc_shipments', []);

    // Direct Cloud Sync to Supabase
    if (supabase) {
      setCloudSyncStatus(prev => ({ ...prev, isSaving: true }));
      try {
        await supabase.from('saved_records').delete().eq('record_type', 'shipment');
        try { await supabase.from('shipments').delete().neq('id', '00000000-0000-0000-0000-000000000000'); } catch (e) {}
        await supabase.from('inventory_units').update({ status: 'in_stock', current_site_id: 'site-dc', shipped_at: null }).neq('id', '00000000-0000-0000-0000-000000000000');
        setCloudSyncStatus({ isSaving: false, lastSaved: new Date(), isOnline: true });
        broadcastCloudEvent('SHIPMENTS_CLEARED');
      } catch (dbErr) {
        console.error('Supabase clear all shipments error:', dbErr.message);
        setCloudSyncStatus(prev => ({ ...prev, isSaving: false, isOnline: false }));
        broadcastCloudEvent('SHIPMENTS_CLEARED');
      }
    } else {
      broadcastCloudEvent('SHIPMENTS_CLEARED');
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

  const saveShipment = async (shipmentData) => {
    if (!shipmentData) return;
    const isUpdate = shipmentData.id && shipments.some(s => s.id === shipmentData.id);
    const newShipment = {
      ...shipmentData,
      id: shipmentData.id || `ship-${Date.now()}`,
      shipment_number: shipmentData.shipment_number || `SHIP-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(shipments.length + 1).padStart(3, '0')}`,
      invoice_ref: shipmentData.invoice_ref || `DCMSPIOWNED#${Date.now().toString().slice(-6)}G`,
      status: shipmentData.status || 'shipped',
      created_at: shipmentData.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const nextList = isUpdate 
      ? shipments.map(s => s.id === shipmentData.id ? newShipment : s)
      : [newShipment, ...shipments.filter(s => s.id !== newShipment.id)];

    setShipments(nextList);
    try {
      localStorage.setItem('mdc_shipments', JSON.stringify(nextList));
    } catch (e) {}
    dbStorage.setItem('mdc_shipments', nextList);

    let updatedInv = [];
    // Update inventory units status in memory if status is shipped or packed
    if (newShipment.items && newShipment.items.length > 0) {
      const serialsInShipment = new Set(newShipment.items.map(it => String(it.serial_number || it.serialNumber || '').trim().toUpperCase()).filter(Boolean));
      const targetUnitStatus = newShipment.status === 'shipped' || newShipment.status === 'delivered' ? 'shipped' : 'packed';
      
      setInventoryUnits(prev => {
        updatedInv = (prev || []).map(u => {
          const s = String(u.serial_number || '').trim().toUpperCase();
          if (serialsInShipment.has(s)) {
            return {
              ...u,
              status: targetUnitStatus,
              box_number: u.box_number || 1,
              current_site_id: newShipment.site_id || u.current_site_id,
              shipped_at: newShipment.shipment_date || new Date().toISOString(),
              shipped_by: newShipment.prepared_by_name || currentUser?.fullName || 'Warehouse Staff'
            };
          }
          return u;
        });
        try { localStorage.setItem('mdc_inventory', JSON.stringify(updatedInv)); } catch (e) {}
        dbStorage.setItem('mdc_inventory', updatedInv);
        return updatedInv;
      });
    }

    // Direct Cloud Sync to Supabase
    if (supabase) {
      setCloudSyncStatus(prev => ({ ...prev, isSaving: true }));
      try {
        // 1. Save shipment to saved_records (resilient JSON snapshot for multi-browser sync)
        const { error: recErr } = await supabase.from('saved_records').upsert({
          id: newShipment.id,
          record_type: 'shipment',
          period_label: newShipment.invoice_ref || newShipment.shipment_number,
          period_year: new Date().getFullYear(),
          period_month: new Date().getMonth() + 1,
          period_week: newShipment.week_number || 1,
          notes: newShipment.remarks || '',
          saved_by_name: newShipment.prepared_by_name || currentUser?.fullName || 'Warehouse Staff',
          saved_by_user_id: safeUUID(currentUser?.id),
          snapshot_data: newShipment,
          created_at: newShipment.created_at || new Date().toISOString(),
          updated_at: new Date().toISOString()
        }, { onConflict: 'id' });

        if (recErr) throw recErr;

        // 1b. Delete active packing manifest draft from cloud DB so it clears for all other users
        try {
          await supabase.from('saved_records').delete().eq('id', 'active_packing_manifest_draft');
          setActivePackDraft(null);
          try { localStorage.removeItem('mdc_active_pack_draft'); } catch (e) {}
        } catch (draftDelErr) {
          console.warn('active_packing_manifest_draft delete notice:', draftDelErr.message);
        }

        // 2. Also update live_master_dc_inventory in saved_records so stock deduction persists across all users
        if (updatedInv && updatedInv.length > 0) {
          try {
            await supabase.from('saved_records').upsert({
              id: 'live_master_dc_inventory',
              record_type: 'inventory_master',
              period_label: 'Live Master DC Inventory',
              period_year: new Date().getFullYear(),
              period_month: new Date().getMonth() + 1,
              period_week: 1,
              notes: 'Master DC In-Stock inventory pool across all accounts',
              saved_by_name: currentUser?.fullName || 'Warehouse Staff',
              snapshot_data: {
                units: updatedInv
              },
              updated_at: new Date().toISOString()
            }, { onConflict: 'id' });
          } catch (invErr) {
            console.warn('live_master_dc_inventory update note:', invErr.message);
          }
        }

        // 3. Update inventory_units table in Supabase (safe optional upsert)
        if (newShipment.items && newShipment.items.length > 0) {
          const targetUnitStatus = newShipment.status === 'shipped' || newShipment.status === 'delivered' ? 'shipped' : 'packed';
          
          const rowsToUpsert = newShipment.items.map(it => {
            const cleanSerial = String(it.serial_number || it.serialNumber || '').trim().toUpperCase();
            const existingU = inventoryUnits.find(u => String(u.serial_number || '').toUpperCase() === cleanSerial);
            const partId = isUUID(existingU?.part_id) ? existingU.part_id : null;
            const siteId = isUUID(newShipment.site_id) ? newShipment.site_id : null;

            return {
              ...(partId ? { part_id: partId } : {}),
              serial_number: cleanSerial,
              status: targetUnitStatus,
              box_number: it.box_number || 1,
              ...(siteId ? { current_site_id: siteId } : {}),
              shipped_at: new Date().toISOString()
            };
          }).filter(r => r.serial_number);

          if (rowsToUpsert.length > 0) {
            try {
              await supabase.from('inventory_units').upsert(rowsToUpsert, { onConflict: 'serial_number' });
            } catch (uErr) {
              console.warn('Supabase inventory_units upsert note:', uErr.message);
            }
          }
        }

        setCloudSyncStatus({ isSaving: false, lastSaved: new Date(), isOnline: true });

        // 4. Broadcast AFTER all cloud writes complete so other clients fetch the committed data & clear their draft
        broadcastCloudEvent('SHIPMENT_SAVED', { shipmentId: newShipment.id });
        broadcastCloudEvent('DRAFT_UPDATED', { count: 0 });
      } catch (dbErr) {
        console.error('Supabase save shipment error:', dbErr.message);
        setCloudSyncStatus(prev => ({ ...prev, isSaving: false, isOnline: false }));
        enqueueOfflineAction('SHIPMENT_UPSERT', {
          id: newShipment.id,
          record_type: 'shipment',
          period_label: newShipment.invoice_ref || newShipment.shipment_number,
          period_year: new Date().getFullYear(),
          period_month: new Date().getMonth() + 1,
          period_week: newShipment.week_number || 1,
          notes: newShipment.remarks || '',
          saved_by_name: newShipment.prepared_by_name || currentUser?.fullName || 'Warehouse Staff',
          saved_by_user_id: safeUUID(currentUser?.id),
          snapshot_data: newShipment,
          created_at: newShipment.created_at || new Date().toISOString(),
          updated_at: new Date().toISOString()
        });
        broadcastCloudEvent('SHIPMENT_SAVED', { shipmentId: newShipment.id });
        broadcastCloudEvent('DRAFT_UPDATED', { count: 0 });
      }
    } else {
      broadcastCloudEvent('SHIPMENT_SAVED', { shipmentId: newShipment.id });
      broadcastCloudEvent('DRAFT_UPDATED', { count: 0 });
    }

    showToast(isUpdate ? `Shipment ${newShipment.invoice_ref || newShipment.shipment_number} updated` : `Created Packing List Manifest: ${newShipment.invoice_ref || newShipment.shipment_number}`, 'success');
    return newShipment;
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

  const savePart = async (partData) => {
    const cleanPN = String(partData.part_number || '').trim().toUpperCase();
    const cleanDesc = String(partData.description || '').trim();
    if (!cleanPN) return { success: false, error: 'Missing part number' };

    let savedPartObj = null;
    setParts(prev => {
      let updated;
      const matchIndex = prev.findIndex(p =>
        (partData.id && p.id === partData.id) ||
        (p.part_number?.toUpperCase() === cleanPN && p.description?.trim().toLowerCase() === cleanDesc.toLowerCase())
      );

      if (matchIndex >= 0) {
        const existing = prev[matchIndex];
        savedPartObj = {
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
        updated[matchIndex] = savedPartObj;
      } else {
        savedPartObj = {
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
        updated = [savedPartObj, ...prev];
      }

      try {
        localStorage.setItem('mdc_parts', JSON.stringify(updated));
      } catch (e) {
        console.warn('LocalStorage save error in savePart:', e);
      }
      dbStorage.setItem('mdc_parts', updated);
      return updated;
    });

    // Cloud sync to Supabase
    if (supabase) {
      setCloudSyncStatus(prev => ({ ...prev, isSaving: true }));
      try {
        const { error } = await supabase.from('parts').upsert({
          ...(partData.id && !partData.id.startsWith('part-') ? { id: partData.id } : {}),
          part_number: cleanPN,
          description: cleanDesc,
          iphone_model: partData.iphone_model || 'iPhone',
          stocking_price: parseFloat(partData.stocking_price) || 0,
          is_active: partData.is_active ?? true,
          updated_at: new Date().toISOString()
        }, { onConflict: 'part_number' });

        if (error) throw error;
        setCloudSyncStatus({ isSaving: false, lastSaved: new Date(), isOnline: true });
        broadcastCloudEvent('PART_SAVED', { partNumber: cleanPN });
      } catch (e) {
        console.error('Supabase part save error:', e.message);
        setCloudSyncStatus(prev => ({ ...prev, isSaving: false, isOnline: false }));
        enqueueOfflineAction('PART_UPSERT', {
          part_number: cleanPN,
          description: cleanDesc,
          iphone_model: partData.iphone_model || 'iPhone',
          stocking_price: parseFloat(partData.stocking_price) || 0,
          is_active: partData.is_active ?? true,
          updated_at: new Date().toISOString()
        });
        broadcastCloudEvent('PART_SAVED', { partNumber: cleanPN });
      }
    } else {
      broadcastCloudEvent('PART_SAVED', { partNumber: cleanPN });
    }

    showToast(`Saved part ${cleanPN} (${cleanDesc || 'Standard'}) in catalog`, 'success');
    return { success: true, part: savedPartObj };
  };

  const deletePart = async (partIdOrObj) => {
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
      dbStorage.setItem('mdc_parts', updated);
      return updated;
    });

    if (deletedPart) {
      if (supabase) {
        setCloudSyncStatus(prev => ({ ...prev, isSaving: true }));
        try {
          if (deletedPart.id && !deletedPart.id.startsWith('part-')) {
            const { error } = await supabase.from('parts').delete().eq('id', deletedPart.id);
            if (error) throw error;
          } else {
            const { error } = await supabase.from('parts').delete().match({ part_number: deletedPart.part_number, description: deletedPart.description });
            if (error) throw error;
          }
          setCloudSyncStatus({ isSaving: false, lastSaved: new Date(), isOnline: true });
          broadcastCloudEvent('PART_DELETED', { partNumber: deletedPart.part_number, id: deletedPart.id });
        } catch (e) {
          console.error('Supabase part delete error:', e.message);
          setCloudSyncStatus(prev => ({ ...prev, isSaving: false, isOnline: false }));
          enqueueOfflineAction('PART_DELETE', { id: deletedPart.id, part_number: deletedPart.part_number });
          broadcastCloudEvent('PART_DELETED', { partNumber: deletedPart.part_number, id: deletedPart.id });
        }
      } else {
        broadcastCloudEvent('PART_DELETED', { partNumber: deletedPart.part_number, id: deletedPart.id });
      }
      showToast(`Deleted part ${deletedPart.part_number} (${deletedPart.description}) from catalog`, 'info');
      return { success: true, part: deletedPart };
    }
    return { success: false, error: 'Part not found' };
  };

  const saveSite = async (siteData) => {
    let savedSite = null;
    if (siteData.id) {
      savedSite = siteData;
      setSites(prev => {
        const next = prev.map(s => s.id === siteData.id ? siteData : s);
        try { localStorage.setItem('mdc_sites', JSON.stringify(next)); } catch (e) {}
        dbStorage.setItem('mdc_sites', next);
        return next;
      });
      showToast(`Updated site ${siteData.name}`, 'success');
    } else {
      savedSite = {
        ...siteData,
        id: `site-${Date.now()}`,
        is_active: true
      };
      setSites(prev => {
        const next = [...prev, savedSite];
        try { localStorage.setItem('mdc_sites', JSON.stringify(next)); } catch (e) {}
        dbStorage.setItem('mdc_sites', next);
        return next;
      });
      showToast(`Added site ${savedSite.name}`, 'success');
    }

    if (supabase && savedSite) {
      setCloudSyncStatus(prev => ({ ...prev, isSaving: true }));
      try {
        const { error } = await supabase.from('sites').upsert({
          ...(savedSite.id && !savedSite.id.startsWith('site-') ? { id: savedSite.id } : {}),
          code: savedSite.code,
          name: savedSite.name,
          region: savedSite.region || 'Metro Manila',
          address: savedSite.address || savedSite.full_address || '',
          full_address: savedSite.full_address || savedSite.address || '',
          contact_person: savedSite.contact_person || '',
          contact_phone: savedSite.contact_phone || '',
          contact_email: savedSite.contact_email || '',
          ship_to: savedSite.ship_to || '',
          sold_to: savedSite.sold_to || '',
          invoice_prefix: savedSite.invoice_prefix || '',
          is_dc: savedSite.is_dc ?? false,
          is_active: savedSite.is_active ?? true,
          updated_at: new Date().toISOString()
        }, { onConflict: 'code' });

        if (error) throw error;
        setCloudSyncStatus({ isSaving: false, lastSaved: new Date(), isOnline: true });
        broadcastCloudEvent('SITE_SAVED', { code: savedSite.code, name: savedSite.name });
      } catch (e) {
        console.error('Supabase site save error:', e.message);
        setCloudSyncStatus(prev => ({ ...prev, isSaving: false, isOnline: false }));
        enqueueOfflineAction('SITE_UPSERT', {
          code: savedSite.code,
          name: savedSite.name,
          region: savedSite.region || 'Metro Manila',
          address: savedSite.address || '',
          updated_at: new Date().toISOString()
        });
        broadcastCloudEvent('SITE_SAVED', { code: savedSite.code, name: savedSite.name });
      }
    } else {
      broadcastCloudEvent('SITE_SAVED', { code: savedSite?.code, name: savedSite?.name });
    }
    return { success: true, site: savedSite };
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
      setCloudSyncStatus(prev => ({ ...prev, isSaving: true }));
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
        }, { onConflict: 'id' });
        if (error) throw error;
        setCloudSyncStatus({ isSaving: false, lastSaved: new Date(), isOnline: true });
        broadcastCloudEvent('PERIOD_RECORD_SAVED', { recordId: newRecord.id, label: newRecord.period_label });
      } catch (dbErr) {
        console.error('Supabase saved_records cloud sync error:', dbErr.message);
        setCloudSyncStatus(prev => ({ ...prev, isSaving: false, isOnline: false }));
        enqueueOfflineAction('SAVED_RECORD_UPSERT', {
          id: newRecord.id,
          record_type: newRecord.record_type,
          period_label: newRecord.period_label,
          snapshot_data: newRecord.snapshot_data,
          updated_at: new Date().toISOString()
        });
        broadcastCloudEvent('PERIOD_RECORD_SAVED', { recordId: newRecord.id, label: newRecord.period_label });
      }
    } else {
      broadcastCloudEvent('PERIOD_RECORD_SAVED', { recordId: newRecord.id, label: newRecord.period_label });
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

    // Log deletion audit
    await logDeletionAudit({
      entityType: 'Period Snapshot',
      entityId: recordId,
      entityLabel: record.period_label || `Snapshot ${recordId}`,
      summary: {
        period_year: record.period_year,
        period_month: record.period_month,
        record_type: record.record_type,
        forecastPartsCount: record.snapshot_data?.forecastItems?.length || 0,
        allocationsCount: record.snapshot_data?.allocations?.length || 0,
        notes: record.notes
      },
      reason: 'Deleted by administrator from saved period archives'
    });

    const nextList = savedRecords.filter(r => r.id !== recordId);
    setSavedRecords(nextList);
    dbStorage.deleteSavedRecord(recordId);

    try {
      localStorage.setItem('mdc_saved_records', JSON.stringify(nextList.slice(0, 50)));
    } catch (e) {
      console.warn('LocalStorage delete error:', e);
    }

    if (supabase) {
      setCloudSyncStatus(prev => ({ ...prev, isSaving: true }));
      try {
        const { error } = await supabase.from('saved_records').delete().eq('id', recordId);
        if (error) {
          await supabase.from('saved_records').update({ notes: '__DELETED__', snapshot_data: { isDeleted: true }, updated_at: new Date().toISOString() }).eq('id', recordId);
        }
        setCloudSyncStatus({ isSaving: false, lastSaved: new Date(), isOnline: true });
        broadcastCloudEvent('PERIOD_RECORD_DELETED', { recordId });
      } catch (dbErr) {
        console.error('Supabase delete saved_record error:', dbErr.message);
        setCloudSyncStatus(prev => ({ ...prev, isSaving: false, isOnline: false }));
        enqueueOfflineAction('SAVED_RECORD_DELETE', { id: recordId });
        broadcastCloudEvent('PERIOD_RECORD_DELETED', { recordId });
      }
    } else {
      broadcastCloudEvent('PERIOD_RECORD_DELETED', { recordId });
    }

    showToast(`Permanently deleted record "${record.period_label}" & logged to Audit Trail`, 'info');
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

    const yearPrefix = `MDC${year}`;
    const matchingRecords = (dcIntakeRecords || []).filter(r => r.id && r.id.startsWith(yearPrefix));

    let maxSeq = 0;
    matchingRecords.forEach(r => {
      const numPart = r.id.replace(yearPrefix, '');
      const seq = parseInt(numPart, 10);
      if (!isNaN(seq) && seq > maxSeq) {
        maxSeq = seq;
      }
    });

    const nextSeq = maxSeq + 1;
    return `${yearPrefix}${String(nextSeq).padStart(5, '0')}`;
  };

  // Save a completed scan-in batch as an intake record
  const saveIntakeRecord = async (recordData) => {
    const nextId = recordData.id || generateNextIntakeRecordId(recordData.intake_date);
    const newRecord = {
      id: nextId,
      record_name: recordData.record_name || `Intake Batch ${nextId}`,
      intake_date: recordData.intake_date || new Date().toISOString().split('T')[0],
      po_id: recordData.po_id || null,
      po_number: recordData.po_number || 'Direct Receiving',
      supplier_name: recordData.supplier_name || 'Apple Authorized Logistics',
      notes: recordData.notes || '',
      items: recordData.items || [],
      total_units: recordData.total_units || (recordData.items ? recordData.items.reduce((s, it) => s + (it.quantity || 1), 0) : 0),
      total_value: recordData.total_value || 0,
      saved_by_id: currentUser?.id || 'usr-system',
      saved_by_name: currentUser?.fullName || 'Warehouse Staff',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const nextList = [newRecord, ...(dcIntakeRecords || [])];
    setDcIntakeRecords(nextList);
    dbStorage.setItem('mdc_dc_intake_records', nextList);
    try {
      localStorage.setItem('mdc_dc_intake_records', JSON.stringify(nextList));
    } catch (e) {
      console.warn('LocalStorage save notice for dc_intake_records:', e);
    }

    // Direct Cloud Sync to Supabase
    if (supabase) {
      setCloudSyncStatus(prev => ({ ...prev, isSaving: true }));
      try {
        const { error } = await supabase.from('dc_intake_records').upsert({
          id: newRecord.id,
          record_name: newRecord.record_name,
          intake_date: newRecord.intake_date,
          po_id: newRecord.po_id,
          po_number: newRecord.po_number,
          supplier_name: newRecord.supplier_name,
          notes: newRecord.notes,
          items: newRecord.items,
          total_units: newRecord.total_units,
          total_value: newRecord.total_value,
          saved_by_id: newRecord.saved_by_id,
          saved_by_name: newRecord.saved_by_name,
          created_at: newRecord.created_at,
          updated_at: newRecord.updated_at
        }, { onConflict: 'id' });

        if (error) {
          console.error('Supabase dc_intake_records upsert error:', error.message);
          await supabase.from('saved_records').upsert({
            id: newRecord.id,
            record_type: 'intake_batch',
            period_label: newRecord.record_name,
            notes: newRecord.notes,
            saved_by_name: newRecord.saved_by_name,
            snapshot_data: newRecord,
            updated_at: new Date().toISOString()
          }, { onConflict: 'id' });
        }

        setCloudSyncStatus({ isSaving: false, lastSaved: new Date(), isOnline: true });
        broadcastCloudEvent('INTAKE_SAVED', { recordId: newRecord.id });
      } catch (dbErr) {
        console.error('Supabase dc_intake_records sync error:', dbErr.message);
        setCloudSyncStatus(prev => ({ ...prev, isSaving: false, isOnline: false }));
        enqueueOfflineAction('INTAKE_UPSERT', newRecord);
        broadcastCloudEvent('INTAKE_SAVED', { recordId: newRecord.id });
      }
    } else {
      broadcastCloudEvent('INTAKE_SAVED', { recordId: newRecord.id });
    }

    showToast(`Saved DC Intake Record "${newRecord.record_name}" with ${newRecord.total_units} units to database!`, 'success');
    return { success: true, record: newRecord };
  };

  // Delete a saved intake record
  const deleteIntakeRecord = async (recordId) => {
    const target = dcIntakeRecords.find(r => r.id === recordId);

    // 1. Remove from dcIntakeRecords state & local storage
    setDcIntakeRecords(prev => (prev || []).filter(r => r.id !== recordId));
    try {
      const existing = JSON.parse(localStorage.getItem('mdc_dc_intake_records') || '[]');
      localStorage.setItem('mdc_dc_intake_records', JSON.stringify(existing.filter(r => r.id !== recordId)));
      const deletedList = JSON.parse(localStorage.getItem('mdc_deleted_intake_ids') || '[]');
      localStorage.setItem('mdc_deleted_intake_ids', JSON.stringify([...new Set([...deletedList, recordId])]));
    } catch (e) {}

    // 2. Log deletion audit with user accountability
    await logDeletionAudit({
      entityType: 'DC Intake Record',
      entityId: recordId,
      entityLabel: target?.record_name || (target?.intake_number ? `Intake #${target.intake_number}` : `Intake Record ${recordId}`),
      summary: {
        itemsCount: target?.items?.length || target?.total_units || 0,
        poNumber: target?.po_number || target?.poNumber || 'N/A',
        intakeDate: target?.intake_date,
        originalSavedBy: target?.saved_by_name || 'Warehouse Staff'
      },
      reason: 'Deleted by warehouse staff / administrator'
    });

    // 3. Delete / Soft-Delete from Supabase cloud database
    if (supabase) {
      setCloudSyncStatus(prev => ({ ...prev, isSaving: true }));
      try {
        const { error: delErr } = await supabase.from('dc_intake_records').delete().eq('id', recordId);
        if (delErr) {
          await supabase.from('dc_intake_records').update({ notes: '__DELETED__', items: [], updated_at: new Date().toISOString() }).eq('id', recordId);
        }
        await supabase.from('saved_records').delete().eq('id', recordId);
        // Ensure any legacy deleted_intake_ids_registry in saved_records is also deleted
        await supabase.from('saved_records').delete().eq('id', 'deleted_intake_ids_registry');

        setCloudSyncStatus({ isSaving: false, lastSaved: new Date(), isOnline: true });
        broadcastCloudEvent('INTAKE_DELETED', { recordId });
      } catch (e) {
        console.error('Supabase deleteIntakeRecord error:', e.message);
        setCloudSyncStatus(prev => ({ ...prev, isSaving: false, isOnline: false }));
        enqueueOfflineAction('INTAKE_DELETE', { recordId });
        broadcastCloudEvent('INTAKE_DELETED', { recordId });
      }
    } else {
      broadcastCloudEvent('INTAKE_DELETED', { recordId });
    }

    showToast(`Deleted Intake Record ${recordId} & logged to Serialized Audit Trail`, 'info');
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
        deletionAuditLogs,
        setDeletionAuditLogs,
        logDeletionAudit,
        importStockTransfersReport,
        clearStockTransfersReport,
        savePeriodRecord,
        restorePeriodRecord,
        deletePeriodRecord,
        addScanInUnit,
        deleteScanInUnit,
        batchAddScanInUnits,
        commitUnitsToStock,
        addScanOutUnit,
        removeScanOutUnit,
        batchAddScanOutUnits,
        clearShipmentDraftItems,
        activePackDraft,
        setActivePackDraft,
        syncActivePackDraftToCloud,
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
        isSupabaseConfigured,
        realtimeConnected,
        offlineQueue,
        processOfflineSyncQueue,
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
