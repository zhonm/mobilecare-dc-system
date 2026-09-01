import { useState, useEffect } from 'react';
import { supabase } from '../supabase/client';
import dbStorage from '../utils/dbStorage';
import { hashPassword } from '../utils/security';
import { isAllowedCompanyEmail } from '../utils/userMatcher';
import {
  INITIAL_USERS,
  ROLE_PRESETS,
  getDefaultRolePosition,
  LEGACY_MOCK_EMAILS,
  LEGACY_MOCK_IDS
} from '../constants/roles';
import { isUUID, toValidUUID } from '../utils/appContextHelpers';

export function useUserManagement({
  currentUser,
  setCurrentUser,
  showToast,
  broadcastCloudEvent,
  enqueueOfflineAction,
  setCloudSyncStatus
}) {
  const [usersList, setUsersList] = useState(() => {
    try {
      const deletedIds = JSON.parse(localStorage.getItem('mdc_deleted_user_ids') || '[]');
      let saved = null;
      try {
        saved = localStorage.getItem('mdc_users') || sessionStorage.getItem('mdc_users');
      } catch (e) {}

      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const parsedEmails = new Set(parsed.map(u => u.email?.toLowerCase()).filter(Boolean));
          const parsedIds = new Set(parsed.map(u => u.id?.toLowerCase()).filter(Boolean));
          const activeKnownEmails = new Set([...parsedEmails, ...INITIAL_USERS.map(u => u.email?.toLowerCase())]);
          const activeKnownIds = new Set([...parsedIds, ...INITIAL_USERS.map(u => u.id?.toLowerCase())]);
          const cleanDeleted = deletedIds.filter(id => !activeKnownEmails.has(id?.toLowerCase()) && !activeKnownIds.has(id?.toLowerCase()));
          try { localStorage.setItem('mdc_deleted_user_ids', JSON.stringify(cleanDeleted)); } catch (e) {}

          return parsed
            .filter(u =>
              !cleanDeleted.includes(u.id?.toLowerCase()) &&
              !cleanDeleted.includes(u.email?.toLowerCase()) &&
              !LEGACY_MOCK_EMAILS.includes(u.email?.toLowerCase()) &&
              !LEGACY_MOCK_IDS.includes(u.id)
            )
            .map(u => {
              if (u.role === 'parts_management') {
                return {
                  ...u,
                  permittedPages: ROLE_PRESETS.parts_management || ['request-parts', 'scan-in', 'all-stocks']
                };
              }
              return u;
            });
        }
      }
      return INITIAL_USERS.filter(u =>
        !deletedIds.includes(u.id?.toLowerCase()) &&
        !deletedIds.includes(u.email?.toLowerCase()) &&
        !LEGACY_MOCK_EMAILS.includes(u.email?.toLowerCase()) &&
        !LEGACY_MOCK_IDS.includes(u.id)
      );
    } catch (e) {
      console.warn('Error loading mdc_users:', e);
    }
    return INITIAL_USERS;
  });

  // Asynchronous recovery for usersList from IndexedDB on startup
  useEffect(() => {
    let isMounted = true;
    const recoverUsersFromDb = async () => {
      try {
        const dbUsers = await dbStorage.getItem('mdc_users');
        if (isMounted && Array.isArray(dbUsers) && dbUsers.length > 0) {
          const deletedIds = JSON.parse(localStorage.getItem('mdc_deleted_user_ids') || '[]');
          const activeEmails = new Set(dbUsers.map(u => u.email?.toLowerCase()).filter(Boolean));
          const activeIds = new Set(dbUsers.map(u => u.id?.toLowerCase()).filter(Boolean));
          const activeKnownEmails = new Set([...activeEmails, ...INITIAL_USERS.map(u => u.email?.toLowerCase())]);
          const activeKnownIds = new Set([...activeIds, ...INITIAL_USERS.map(u => u.id?.toLowerCase())]);
          const cleanDeleted = deletedIds.filter(id => !activeKnownEmails.has(id?.toLowerCase()) && !activeKnownIds.has(id?.toLowerCase()));

          const filtered = dbUsers.filter(u =>
            !cleanDeleted.includes(u.id?.toLowerCase()) &&
            !cleanDeleted.includes(u.email?.toLowerCase()) &&
            !LEGACY_MOCK_EMAILS.includes(u.email?.toLowerCase()) &&
            !LEGACY_MOCK_IDS.includes(u.id)
          );
          if (filtered.length > 0) {
            setUsersList(prev => {
              if (prev && prev.length > filtered.length) return prev;
              return filtered;
            });
            try {
              localStorage.setItem('mdc_users', JSON.stringify(filtered));
              sessionStorage.setItem('mdc_users', JSON.stringify(filtered));
              localStorage.setItem('mdc_deleted_user_ids', JSON.stringify(cleanDeleted));
            } catch (e) {}
          }
        }
      } catch (e) {
        console.debug('IndexedDB users recovery note:', e);
      }
    };
    recoverUsersFromDb();
    return () => {
      isMounted = false;
    };
  }, []);

  // Helper to persist authoritative users registry to cloud
  const syncMasterUsersRegistry = async (usersListToSync, deletedIdsToSync = null) => {
    if (!supabase) return;
    try {
      const rawDeleted = deletedIdsToSync || JSON.parse(localStorage.getItem('mdc_deleted_user_ids') || '[]');
      const activeEmails = new Set((usersListToSync || []).map(u => u.email?.toLowerCase()).filter(Boolean));
      const activeIds = new Set((usersListToSync || []).map(u => u.id?.toLowerCase()).filter(Boolean));
      const deleted = rawDeleted.filter(id => !activeEmails.has(id?.toLowerCase()) && !activeIds.has(id?.toLowerCase()));

      try {
        localStorage.setItem('mdc_deleted_user_ids', JSON.stringify(deleted));
      } catch (e) {}

      await supabase.from('saved_records').upsert({
        id: 'master_users_registry',
        record_type: 'users_registry',
        period_label: 'Master Users Registry',
        period_year: new Date().getFullYear(),
        period_month: new Date().getMonth() + 1,
        notes: 'Master Provisioned Accounts & Permissions Registry',
        snapshot_data: {
          users: usersListToSync,
          deletedUserIds: deleted,
          updatedAt: new Date().toISOString()
        },
        updated_at: new Date().toISOString()
      }, { onConflict: 'id' });
    } catch (err) {
      console.warn('Sync master_users_registry notice:', err);
    }
  };

  // 1. Create / Provision New User
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

    const validUserId = toValidUUID(`usr-${Date.now()}-${cleanEmail}`);

    const newUser = {
      id: validUserId,
      email: cleanEmail,
      fullName: fullName.trim(),
      role,
      rolePosition: String(rolePosition || '').trim() || getDefaultRolePosition(role),
      siteId: siteId || 'site-dc',
      hasSetPassword: false,
      passwordHash: null,
      isActive: true,
      permittedPages: role === 'superadmin' ? ROLE_PRESETS.superadmin : (customPermissions || ROLE_PRESETS[role] || ROLE_PRESETS.user)
    };

    try {
      const deletedIds = JSON.parse(localStorage.getItem('mdc_deleted_user_ids') || '[]');
      const filteredDeleted = deletedIds.filter(id => id?.toLowerCase() !== cleanEmail && id?.toLowerCase() !== newUser.id.toLowerCase());
      localStorage.setItem('mdc_deleted_user_ids', JSON.stringify(filteredDeleted));
    } catch (e) {}

    const defaultPages = newUser.permittedPages;
    const finalRolePosition = newUser.rolePosition;

    const nextList = [...usersList.filter(u => u.email.toLowerCase() !== cleanEmail), newUser];
    setUsersList(nextList);
    try {
      localStorage.setItem('mdc_users', JSON.stringify(nextList));
      sessionStorage.setItem('mdc_users', JSON.stringify(nextList));
      dbStorage.setItem('mdc_users', nextList);
    } catch (e) {}

    await syncMasterUsersRegistry(nextList);

    if (supabase) {
      if (setCloudSyncStatus) setCloudSyncStatus(prev => ({ ...prev, isSaving: true }));
      try {
        const { data: inserted, error: profErr } = await supabase
          .from('profiles')
          .upsert({
            id: validUserId,
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

        if (profErr) console.warn('Supabase profile upsert warning:', profErr.message);

        const effectiveUserId = (inserted?.[0]?.id && isUUID(inserted[0].id)) ? inserted[0].id : validUserId;
        if (defaultPages && defaultPages.length > 0 && isUUID(effectiveUserId)) {
          const permRows = defaultPages.map(pageId => ({
            user_id: effectiveUserId,
            page_id: pageId
          }));
          const { error: permErr } = await supabase.from('user_page_permissions').upsert(permRows, { onConflict: 'user_id,page_id' });
          if (permErr) console.warn('Permission sync warning:', permErr.message);
        }

        if (setCloudSyncStatus) setCloudSyncStatus({ isSaving: false, lastSaved: new Date(), isOnline: true });
        if (broadcastCloudEvent) broadcastCloudEvent('USER_REGISTRY_UPDATED', { email: cleanEmail, userId: effectiveUserId, table: 'saved_records' });
      } catch (dbErr) {
        console.error('Could not sync provisioned user to Supabase:', dbErr.message);
        if (setCloudSyncStatus) setCloudSyncStatus(prev => ({ ...prev, isSaving: false, isOnline: false }));
        if (enqueueOfflineAction) {
          enqueueOfflineAction('PROFILE_UPSERT', {
            id: validUserId,
            email: cleanEmail,
            full_name: fullName.trim(),
            role,
            role_position: finalRolePosition,
            has_set_password: false,
            is_active: true,
            updated_at: new Date().toISOString()
          });
        }
        if (broadcastCloudEvent) broadcastCloudEvent('USER_REGISTRY_UPDATED', { email: cleanEmail, userId: validUserId, table: 'saved_records' });
      }
    } else {
      if (broadcastCloudEvent) broadcastCloudEvent('USER_REGISTRY_UPDATED', { email: cleanEmail, userId: validUserId, table: 'saved_records' });
    }

    showToast(`Provisioned user ${fullName} (${cleanEmail}) as ${finalRolePosition}.`, 'success');
    return { success: true, user: newUser };
  };

  // 2. Update User Page Permission
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

    const nextUsersList = usersList.map(user => {
      if (user.id === userId) {
        return {
          ...user,
          permittedPages: newPerms
        };
      }
      return user;
    });

    setUsersList(nextUsersList);
    try {
      localStorage.setItem('mdc_users', JSON.stringify(nextUsersList));
      sessionStorage.setItem('mdc_users', JSON.stringify(nextUsersList));
      dbStorage.setItem('mdc_users', nextUsersList);
    } catch (e) {}

    await syncMasterUsersRegistry(nextUsersList);

    if (supabase) {
      if (setCloudSyncStatus) setCloudSyncStatus(prev => ({ ...prev, isSaving: true }));
      try {
        const profQuery = isUUID(userId)
          ? supabase.from('profiles').select('id').or(`id.eq.${userId},email.ilike.${targetUser.email}`).maybeSingle()
          : supabase.from('profiles').select('id').ilike('email', targetUser.email).maybeSingle();
        const { data: prof, error: findErr } = await profQuery;

        if (findErr) throw findErr;

        const effectiveProfId = (prof?.id && isUUID(prof.id)) ? prof.id : (isUUID(userId) ? userId : null);
        if (effectiveProfId) {
          if (hasPage) {
            const { error: delErr } = await supabase
              .from('user_page_permissions')
              .delete()
              .eq('user_id', effectiveProfId)
              .eq('page_id', pageId);
            if (delErr) throw delErr;
          } else {
            const { error: upErr } = await supabase
              .from('user_page_permissions')
              .upsert({ user_id: effectiveProfId, page_id: pageId }, { onConflict: 'user_id,page_id' });
            if (upErr) throw upErr;
          }
        }
        if (setCloudSyncStatus) setCloudSyncStatus({ isSaving: false, lastSaved: new Date(), isOnline: true });
        if (broadcastCloudEvent) broadcastCloudEvent('USER_REGISTRY_UPDATED', { userId: prof?.id || userId, pageId, hasPage: !hasPage, table: 'saved_records' });
      } catch (e) {
        console.error('Supabase permission sync error:', e.message);
        if (setCloudSyncStatus) setCloudSyncStatus(prev => ({ ...prev, isSaving: false, isOnline: false }));
        if (broadcastCloudEvent) broadcastCloudEvent('USER_REGISTRY_UPDATED', { userId, pageId, hasPage: !hasPage, table: 'saved_records' });
      }
    } else {
      if (broadcastCloudEvent) broadcastCloudEvent('USER_REGISTRY_UPDATED', { userId, pageId, hasPage: !hasPage, table: 'saved_records' });
    }
  };

  // 3. Apply Role Preset to User
  const applyRolePresetToUser = async (userId, presetRole) => {
    const targetUser = usersList.find(u => u.id === userId);
    if (!targetUser) return;

    const pages = ROLE_PRESETS[presetRole] || [];
    const nextUsersList = usersList.map(user => {
      if (user.id === userId) {
        return {
          ...user,
          role: presetRole,
          permittedPages: pages
        };
      }
      return user;
    });

    setUsersList(nextUsersList);
    try {
      localStorage.setItem('mdc_users', JSON.stringify(nextUsersList));
      sessionStorage.setItem('mdc_users', JSON.stringify(nextUsersList));
      dbStorage.setItem('mdc_users', nextUsersList);
    } catch (e) {}

    await syncMasterUsersRegistry(nextUsersList);

    if (supabase) {
      if (setCloudSyncStatus) setCloudSyncStatus(prev => ({ ...prev, isSaving: true }));
      try {
        const profQuery = isUUID(userId)
          ? supabase.from('profiles').select('id').or(`id.eq.${userId},email.ilike.${targetUser.email}`).maybeSingle()
          : supabase.from('profiles').select('id').ilike('email', targetUser.email).maybeSingle();
        const { data: prof, error: profFindErr } = await profQuery;

        if (profFindErr) throw profFindErr;

        const effectiveProfId = (prof?.id && isUUID(prof.id)) ? prof.id : (isUUID(userId) ? userId : null);
        if (effectiveProfId) {
          const { error: upProfErr } = await supabase
            .from('profiles')
            .update({ role: presetRole, updated_at: new Date().toISOString() })
            .eq('id', effectiveProfId);
          if (upProfErr) throw upProfErr;

          await supabase
            .from('user_page_permissions')
            .delete()
            .eq('user_id', effectiveProfId);

          const rows = pages.map(pg => ({ user_id: effectiveProfId, page_id: pg }));
          if (rows.length > 0) {
            const { error: permErr } = await supabase.from('user_page_permissions').upsert(rows, { onConflict: 'user_id,page_id' });
            if (permErr) throw permErr;
          }
        }
        if (setCloudSyncStatus) setCloudSyncStatus({ isSaving: false, lastSaved: new Date(), isOnline: true });
        if (broadcastCloudEvent) broadcastCloudEvent('USER_REGISTRY_UPDATED', { userId: prof?.id || userId, role: presetRole, table: 'saved_records' });
      } catch (e) {
        console.error('Supabase role preset sync error:', e.message);
        if (setCloudSyncStatus) setCloudSyncStatus(prev => ({ ...prev, isSaving: false, isOnline: false }));
        if (broadcastCloudEvent) broadcastCloudEvent('USER_REGISTRY_UPDATED', { userId, role: presetRole, table: 'saved_records' });
      }
    } else {
      if (broadcastCloudEvent) broadcastCloudEvent('USER_REGISTRY_UPDATED', { userId, role: presetRole, table: 'saved_records' });
    }

    showToast(`Applied ${presetRole} default permissions`, 'success');
  };

  // 4. Toggle User Active Status
  const toggleUserActiveStatus = async (userId) => {
    const target = usersList.find(u => u.id === userId);
    if (target?.id === currentUser?.id) {
      showToast('You cannot deactivate your own logged-in account', 'warning');
      return;
    }

    const nextState = !target.isActive;
    const nextUsersList = usersList.map(user => {
      if (user.id === userId) {
        return { ...user, isActive: nextState };
      }
      return user;
    });

    setUsersList(nextUsersList);
    try {
      localStorage.setItem('mdc_users', JSON.stringify(nextUsersList));
      sessionStorage.setItem('mdc_users', JSON.stringify(nextUsersList));
      dbStorage.setItem('mdc_users', nextUsersList);
    } catch (e) {}

    await syncMasterUsersRegistry(nextUsersList);

    if (supabase) {
      if (setCloudSyncStatus) setCloudSyncStatus(prev => ({ ...prev, isSaving: true }));
      try {
        const statusUpdateQuery = isUUID(userId)
          ? supabase.from('profiles').update({ is_active: nextState, updated_at: new Date().toISOString() }).or(`id.eq.${userId},email.ilike.${target.email}`)
          : supabase.from('profiles').update({ is_active: nextState, updated_at: new Date().toISOString() }).ilike('email', target.email);
        const { error } = await statusUpdateQuery;
        if (error) throw error;
        if (setCloudSyncStatus) setCloudSyncStatus({ isSaving: false, lastSaved: new Date(), isOnline: true });
        if (broadcastCloudEvent) broadcastCloudEvent('USER_REGISTRY_UPDATED', { userId, isActive: nextState, table: 'saved_records' });
      } catch (e) {
        console.error('Supabase status sync error:', e.message);
        if (setCloudSyncStatus) setCloudSyncStatus(prev => ({ ...prev, isSaving: false, isOnline: false }));
        if (broadcastCloudEvent) broadcastCloudEvent('USER_REGISTRY_UPDATED', { userId, isActive: nextState, table: 'saved_records' });
      }
    } else {
      if (broadcastCloudEvent) broadcastCloudEvent('USER_REGISTRY_UPDATED', { userId, isActive: nextState, table: 'saved_records' });
    }

    showToast(`Account for ${target.fullName} is now ${nextState ? 'Active' : 'Deactivated'}`, 'info');
  };

  // 5. Update User Profile
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

    const nextList = usersList.map(u => (u.id === userId ? updatedUser : u));
    setUsersList(nextList);
    try {
      localStorage.setItem('mdc_users', JSON.stringify(nextList));
      sessionStorage.setItem('mdc_users', JSON.stringify(nextList));
      dbStorage.setItem('mdc_users', nextList);
    } catch (e) {}

    await syncMasterUsersRegistry(nextList);

    if (currentUser?.id === userId || currentUser?.email?.toLowerCase() === previousEmail.toLowerCase()) {
      if (setCurrentUser) setCurrentUser(updatedUser);
    }

    if (supabase) {
      if (setCloudSyncStatus) setCloudSyncStatus(prev => ({ ...prev, isSaving: true }));
      try {
        let updatedInDb = false;

        const updatePayload = {
          email: cleanEmail,
          full_name: fullName.trim(),
          role: resolvedRole,
          updated_at: new Date().toISOString()
        };

        if (siteId && isUUID(siteId)) {
          updatePayload.site_id = siteId;
        }

        if (isUUID(userId)) {
          const { data: byIdData, error: byIdErr } = await supabase
            .from('profiles')
            .update(updatePayload)
            .eq('id', userId)
            .select();

          if (!byIdErr && byIdData && byIdData.length > 0) {
            updatedInDb = true;
          }
        }

        if (!updatedInDb) {
          const { data: byEmailData, error: byEmailErr } = await supabase
            .from('profiles')
            .update(updatePayload)
            .ilike('email', previousEmail)
            .select();

          if (!byEmailErr && byEmailData && byEmailData.length > 0) {
            updatedInDb = true;
          }
        }

        if (!updatedInDb) {
          const validProfId = isUUID(userId) ? userId : toValidUUID(`usr-${Date.now()}-${cleanEmail}`);
          const { error: upsertErr } = await supabase
            .from('profiles')
            .upsert({
              id: validProfId,
              email: cleanEmail,
              full_name: fullName.trim(),
              role: resolvedRole,
              has_set_password: target.hasSetPassword ?? true,
              is_active: target.isActive ?? true,
              updated_at: new Date().toISOString()
            }, { onConflict: 'email' });
          if (upsertErr) console.warn('Supabase profile upsert note:', upsertErr.message);
        }

        if (setCloudSyncStatus) setCloudSyncStatus({ isSaving: false, lastSaved: new Date(), isOnline: true });
        if (broadcastCloudEvent) broadcastCloudEvent('USER_REGISTRY_UPDATED', { userId, email: cleanEmail, table: 'saved_records' });
      } catch (dbErr) {
        console.error('Supabase profile update error:', dbErr.message);
        if (setCloudSyncStatus) setCloudSyncStatus(prev => ({ ...prev, isSaving: false, isOnline: false }));
        if (enqueueOfflineAction) {
          enqueueOfflineAction('PROFILE_UPSERT', {
            id: isUUID(userId) ? userId : toValidUUID(`usr-${Date.now()}-${cleanEmail}`),
            email: cleanEmail,
            full_name: fullName.trim(),
            role: resolvedRole,
            updated_at: new Date().toISOString()
          });
        }
        if (broadcastCloudEvent) broadcastCloudEvent('USER_REGISTRY_UPDATED', { userId, email: cleanEmail, table: 'saved_records' });
      }
    } else {
      if (broadcastCloudEvent) broadcastCloudEvent('USER_REGISTRY_UPDATED', { userId, email: cleanEmail, table: 'saved_records' });
    }

    showToast(`Updated profile for ${fullName} (${resolvedPosition})`, 'success');
    return { success: true, user: updatedUser };
  };

  // 6. Update Role Position
  const updateUserRolePosition = async (userId, newRolePosition) => {
    const target = usersList.find(u => u.id === userId);
    if (!target) return { success: false, error: 'User not found' };

    const pos = String(newRolePosition || '').trim() || getDefaultRolePosition(target.role);
    const updatedUser = { ...target, rolePosition: pos };

    const nextList = usersList.map(u => u.id === userId ? updatedUser : u);
    setUsersList(nextList);
    if (currentUser?.id === userId && setCurrentUser) {
      setCurrentUser(updatedUser);
    }

    try {
      localStorage.setItem('mdc_users', JSON.stringify(nextList));
      sessionStorage.setItem('mdc_users', JSON.stringify(nextList));
      dbStorage.setItem('mdc_users', nextList);
    } catch (e) {}

    await syncMasterUsersRegistry(nextList);

    if (supabase) {
      if (setCloudSyncStatus) setCloudSyncStatus({ isSaving: false, lastSaved: new Date(), isOnline: true });
      if (broadcastCloudEvent) broadcastCloudEvent('USER_REGISTRY_UPDATED', { userId, rolePosition: pos, table: 'saved_records' });
    } else {
      if (broadcastCloudEvent) broadcastCloudEvent('USER_REGISTRY_UPDATED', { userId, rolePosition: pos, table: 'saved_records' });
    }

    showToast(`Updated role position for ${target.fullName} to "${pos}"`, 'success');
    return { success: true, user: updatedUser };
  };

  // 7. Reset User Password
  const resetUserPassword = async (userId, { newPassword, requireNextLoginReset = false }) => {
    if (currentUser && currentUser.role !== 'superadmin' && currentUser.id !== userId) {
      showToast('Unauthorized: Only Superadmins can reset passwords for other users.', 'error');
      return { success: false, error: 'Unauthorized' };
    }

    const target = usersList.find(u => u.id === userId);
    if (!target) return { success: false, error: 'User not found' };
    const finalPassword = String(newPassword || '').trim();
    const hasSet = Boolean(finalPassword && !requireNextLoginReset);
    const secureHash = finalPassword ? await hashPassword(finalPassword) : null;

    const updatedUser = {
      ...target,
      passwordHash: secureHash,
      hasSetPassword: hasSet
    };

    const nextList = usersList.map(u => (u.id === userId ? updatedUser : u));
    setUsersList(nextList);

    if (currentUser?.id === userId || currentUser?.email?.toLowerCase() === target.email?.toLowerCase()) {
      if (setCurrentUser) setCurrentUser(updatedUser);
    }

    try {
      localStorage.setItem('mdc_users', JSON.stringify(nextList));
      sessionStorage.setItem('mdc_users', JSON.stringify(nextList));
      dbStorage.setItem('mdc_users', nextList);
    } catch (e) {}

    await syncMasterUsersRegistry(nextList);

    if (supabase) {
      if (setCloudSyncStatus) setCloudSyncStatus(prev => ({ ...prev, isSaving: true }));
      try {
        if (currentUser?.id === userId) {
          try { await supabase.auth.updateUser({ password: finalPassword }); } catch (authErr) {}
        }

        const passUpdateQuery = isUUID(userId)
          ? supabase
              .from('profiles')
              .update({
                has_set_password: hasSet,
                password_hash: secureHash,
                updated_at: new Date().toISOString()
              })
              .or(`id.eq.${userId},email.ilike.${target.email}`)
          : supabase
              .from('profiles')
              .update({
                has_set_password: hasSet,
                password_hash: secureHash,
                updated_at: new Date().toISOString()
              })
              .ilike('email', target.email);

        const { error } = await passUpdateQuery;
        if (error) throw error;
        if (setCloudSyncStatus) setCloudSyncStatus({ isSaving: false, lastSaved: new Date(), isOnline: true });
        if (broadcastCloudEvent) broadcastCloudEvent('USER_REGISTRY_UPDATED', { userId, table: 'saved_records' });
      } catch (dbErr) {
        console.error('Supabase password reset sync error:', dbErr.message);
        if (setCloudSyncStatus) setCloudSyncStatus(prev => ({ ...prev, isSaving: false, isOnline: false }));
        if (broadcastCloudEvent) broadcastCloudEvent('USER_REGISTRY_UPDATED', { userId, table: 'saved_records' });
      }
    } else {
      if (broadcastCloudEvent) broadcastCloudEvent('USER_REGISTRY_UPDATED', { userId, table: 'saved_records' });
    }

    if (requireNextLoginReset) {
      showToast(`Password reset for ${target.fullName}. User will configure a new password on their next login.`, 'info');
    } else {
      showToast(`Password successfully updated for ${target.fullName}!`, 'success');
    }

    return { success: true, user: updatedUser };
  };

  // 8. Delete User
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

    const deletedIds = JSON.parse(localStorage.getItem('mdc_deleted_user_ids') || '[]');
    if (!deletedIds.includes(userId)) deletedIds.push(userId);
    if (target.email && !deletedIds.includes(target.email.toLowerCase())) {
      deletedIds.push(target.email.toLowerCase());
    }
    try {
      localStorage.setItem('mdc_deleted_user_ids', JSON.stringify(deletedIds));
    } catch (e) {
      console.warn('Error saving deleted user id:', e);
    }

    const nextList = usersList.filter(u => u.id !== userId && u.email?.toLowerCase() !== target.email?.toLowerCase());
    setUsersList(nextList);
    try {
      localStorage.setItem('mdc_users', JSON.stringify(nextList));
      sessionStorage.setItem('mdc_users', JSON.stringify(nextList));
      dbStorage.setItem('mdc_users', nextList);
    } catch (e) {}

    await syncMasterUsersRegistry(nextList, deletedIds);

    if (supabase) {
      if (setCloudSyncStatus) setCloudSyncStatus(prev => ({ ...prev, isSaving: true }));
      try {
        if (isUUID(userId)) {
          await supabase.from('user_page_permissions').delete().eq('user_id', userId);
          await supabase.from('profiles').delete().eq('id', userId);
        }
        if (target.email) {
          await supabase.from('profiles').delete().ilike('email', target.email);
        }
        if (setCloudSyncStatus) setCloudSyncStatus({ isSaving: false, lastSaved: new Date(), isOnline: true });
        if (broadcastCloudEvent) broadcastCloudEvent('USER_REGISTRY_UPDATED', { userId, email: target.email, table: 'saved_records' });
      } catch (e) {
        console.error('Supabase delete user error:', e.message);
        if (setCloudSyncStatus) setCloudSyncStatus(prev => ({ ...prev, isSaving: false, isOnline: false }));
        if (enqueueOfflineAction) enqueueOfflineAction('PROFILE_DELETE', { id: userId, email: target.email });
        if (broadcastCloudEvent) broadcastCloudEvent('USER_REGISTRY_UPDATED', { userId, email: target.email, table: 'saved_records' });
      }
    } else {
      if (broadcastCloudEvent) broadcastCloudEvent('USER_REGISTRY_UPDATED', { userId, email: target.email, table: 'saved_records' });
    }

    showToast(`Deleted user ${target.fullName}`, 'success');
    return { success: true };
  };

  return {
    usersList,
    setUsersList,
    provisionUser,
    updateUser,
    updateUserRolePosition,
    resetUserPassword,
    deleteUser,
    toggleUserPagePermission,
    applyRolePresetToUser,
    toggleUserActiveStatus,
    syncMasterUsersRegistry
  };
}
