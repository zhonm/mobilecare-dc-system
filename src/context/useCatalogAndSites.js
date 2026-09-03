import { useState, useEffect } from 'react';
import { supabase } from '../supabase/client';
import dbStorage from '../utils/dbStorage';
import { isUUID } from '../utils/appContextHelpers';
export const DEFAULT_SUPERVISOR_SETTINGS = {
  supervisor_name: '',
  supervisor_title: 'MDC Supervisor of DC',
  guard_on_duty: ''
};

function normalizeSiteCode(rawCode) {
  if (!rawCode) return '';
  const clean = String(rawCode).trim().toUpperCase();
  if (clean === 'APPILO') return 'APP ILO';
  return clean;
}

export function useCatalogAndSites({
  currentUser,
  getCurrentUser,
  showToast,
  broadcastCloudEvent,
  logDeletionAudit,
  enqueueOfflineAction,
  setCloudSyncStatus
}) {
  const [supervisorSettings, setSupervisorSettings] = useState(() => {
    try {
      const saved = localStorage.getItem('mdc_supervisor_settings');
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          ...DEFAULT_SUPERVISOR_SETTINGS,
          ...parsed
        };
      }
      return DEFAULT_SUPERVISOR_SETTINGS;
    } catch {
      return DEFAULT_SUPERVISOR_SETTINGS;
    }
  });

  const [categories, setCategories] = useState(() => {
    try {
      const saved = localStorage.getItem('mdc_categories');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [sites, setSites] = useState(() => {
    try {
      const saved = localStorage.getItem('mdc_sites');
      const parsed = saved ? JSON.parse(saved) : [];
      if (Array.isArray(parsed) && parsed.length > 0) {
        const clean = parsed.filter(s =>
          !String(s.name || '').toUpperCase().includes('SM ILOILO') &&
          !String(s.address || '').toUpperCase().includes('SM ILOILO')
        );
        if (clean.length !== parsed.length) {
          try { localStorage.setItem('mdc_sites', JSON.stringify(clean)); } catch (e) {}
          dbStorage.setItem('mdc_sites', clean);
        }
        return clean.sort((a, b) => (a.code || '').localeCompare(b.code || ''));
      }
      return [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    if (supabase) {
      supabase.from('sites').select('*').then(({ data: dbSites, error }) => {
        if (!error && dbSites && dbSites.length > 0) {
          const authoritative = dbSites
            .filter(s =>
              !String(s.name || '').toUpperCase().includes('SM ILOILO') &&
              !String(s.address || '').toUpperCase().includes('SM ILOILO')
            )
            .map(s => ({
              id: s.id,
              code: normalizeSiteCode(s.code),
              name: s.name,
              region: s.region || 'Metro Manila',
              address: s.address || s.full_address || '',
              full_address: s.full_address || s.address || '',
              contact_person: s.contact_person || '',
              contact_phone: s.contact_phone || '',
              contact_email: s.contact_email || '',
              ship_to: s.ship_to || null,
              sold_to: s.sold_to || null,
              invoice_prefix: s.invoice_prefix || '',
              is_dc: s.is_dc ?? false,
              is_active: s.is_active ?? true
            }))
            .sort((a, b) => (a.code || '').localeCompare(b.code || ''));

          setSites(authoritative);
          try { localStorage.setItem('mdc_sites', JSON.stringify(authoritative)); } catch (e) {}
          dbStorage.setItem('mdc_sites', authoritative);
        }
      }).catch(() => {});
    }
  }, []);

  const [parts, setParts] = useState(() => {
    try {
      const saved = localStorage.getItem('mdc_parts');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const savePart = async (partData) => {
    const cleanPN = String(partData.part_number || '').trim();
    const cleanDesc = String(partData.description || '').trim();

    if (!cleanPN) {
      showToast('Part number cannot be empty', 'error');
      return { success: false, error: 'Empty part number' };
    }

    let savedPartObj = null;

    setParts(prev => {
      const existingIdx = prev.findIndex(p =>
        (partData.id && p.id === partData.id) ||
        (cleanPN && p.part_number === cleanPN)
      );

      let updated;
      if (existingIdx >= 0) {
        const existing = prev[existingIdx];
        savedPartObj = {
          ...existing,
          ...partData,
          part_number: cleanPN,
          description: cleanDesc || existing.description,
          stocking_price: parseFloat(partData.stocking_price ?? existing.stocking_price) || 0,
          exchange_price: parseFloat(partData.exchange_price ?? existing.exchange_price) || 0,
          updated_at: new Date().toISOString()
        };
        updated = [...prev];
        updated[existingIdx] = savedPartObj;
      } else {
        savedPartObj = {
          ...partData,
          id: partData.id || `part-${Date.now()}`,
          part_number: cleanPN,
          description: cleanDesc || 'Service Replacement Part',
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

    if (supabase) {
      if (setCloudSyncStatus) setCloudSyncStatus(prev => ({ ...prev, isSaving: true }));
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
        if (setCloudSyncStatus) setCloudSyncStatus({ isSaving: false, lastSaved: new Date(), isOnline: true });
        if (broadcastCloudEvent) broadcastCloudEvent('PART_SAVED', { partNumber: cleanPN });
      } catch (e) {
        console.error('Supabase part save error:', e.message);
        if (setCloudSyncStatus) setCloudSyncStatus(prev => ({ ...prev, isSaving: false, isOnline: false }));
        if (enqueueOfflineAction) {
          enqueueOfflineAction('PART_UPSERT', {
            part_number: cleanPN,
            description: cleanDesc,
            iphone_model: partData.iphone_model || 'iPhone',
            stocking_price: parseFloat(partData.stocking_price) || 0,
            is_active: partData.is_active ?? true,
            updated_at: new Date().toISOString()
          });
        }
        if (broadcastCloudEvent) broadcastCloudEvent('PART_SAVED', { partNumber: cleanPN });
      }
    } else {
      if (broadcastCloudEvent) broadcastCloudEvent('PART_SAVED', { partNumber: cleanPN });
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
        if (setCloudSyncStatus) setCloudSyncStatus(prev => ({ ...prev, isSaving: true }));
        try {
          if (deletedPart.id && isUUID(deletedPart.id)) {
            const { error } = await supabase.from('parts').delete().eq('id', deletedPart.id);
            if (error) throw error;
          } else if (deletedPart.part_number) {
            const { error } = await supabase.from('parts').delete().eq('part_number', deletedPart.part_number);
            if (error) throw error;
          }
          if (setCloudSyncStatus) setCloudSyncStatus({ isSaving: false, lastSaved: new Date(), isOnline: true });
          if (broadcastCloudEvent) broadcastCloudEvent('PART_DELETED', { partNumber: deletedPart.part_number, id: deletedPart.id });
        } catch (e) {
          console.error('Supabase part delete error:', e.message);
          if (setCloudSyncStatus) setCloudSyncStatus(prev => ({ ...prev, isSaving: false, isOnline: false }));
          if (enqueueOfflineAction) enqueueOfflineAction('PART_DELETE', { id: deletedPart.id, part_number: deletedPart.part_number });
          if (broadcastCloudEvent) broadcastCloudEvent('PART_DELETED', { partNumber: deletedPart.part_number, id: deletedPart.id });
        }
      } else {
        if (broadcastCloudEvent) broadcastCloudEvent('PART_DELETED', { partNumber: deletedPart.part_number, id: deletedPart.id });
      }

      if (typeof logDeletionAudit === 'function') {
        const activeUser = (typeof getCurrentUser === 'function' ? getCurrentUser() : currentUser) || null;
        try {
          await logDeletionAudit({
            entityType: 'Part Catalog',
            entityId: deletedPart.part_number,
            entityLabel: `${deletedPart.part_number} - ${deletedPart.description} (${deletedPart.iphone_model || 'iPhone'})`,
            reason: 'Part permanently removed from catalog by user',
            summary: {
              part_id: deletedPart.id,
              part_number: deletedPart.part_number,
              description: deletedPart.description,
              iphone_model: deletedPart.iphone_model || 'iPhone',
              category_id: deletedPart.category_id,
              stocking_price: deletedPart.stocking_price,
              exchange_price: deletedPart.exchange_price,
              deleted_by: activeUser?.fullName || 'Specialist'
            }
          });
        } catch (auditErr) {
          console.warn('Part deletion audit logging note:', auditErr);
        }
      }

      showToast(`Deleted part ${deletedPart.part_number} (${deletedPart.description}) from catalog`, 'info');
      return { success: true, part: deletedPart };
    }
    return { success: false, error: 'Part not found' };
  };

  const saveSite = async (siteData) => {
    let savedSite = null;
    const cleanCode = normalizeSiteCode(siteData.code);
    if (siteData.id) {
      savedSite = { ...siteData, code: cleanCode };
      setSites(prev => {
        const next = prev.map(s => s.id === siteData.id ? savedSite : s);
        try { localStorage.setItem('mdc_sites', JSON.stringify(next)); } catch (e) {}
        dbStorage.setItem('mdc_sites', next);
        return next;
      });
      showToast(`Updated site ${siteData.name}`, 'success');
    } else {
      savedSite = {
        ...siteData,
        code: cleanCode,
        id: `site-${Date.now()}`,
        is_active: true
      };
      setSites(prev => {
        const next = [...prev.filter(s => normalizeSiteCode(s.code) !== cleanCode), savedSite];
        try { localStorage.setItem('mdc_sites', JSON.stringify(next)); } catch (e) {}
        dbStorage.setItem('mdc_sites', next);
        return next;
      });
      showToast(`Added site ${savedSite.name}`, 'success');
    }

    if (supabase && savedSite) {
      if (setCloudSyncStatus) setCloudSyncStatus(prev => ({ ...prev, isSaving: true }));
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
        if (setCloudSyncStatus) setCloudSyncStatus({ isSaving: false, lastSaved: new Date(), isOnline: true });
        if (broadcastCloudEvent) broadcastCloudEvent('SITE_SAVED', { code: savedSite.code, name: savedSite.name });
      } catch (e) {
        console.error('Supabase site save error:', e.message);
        if (setCloudSyncStatus) setCloudSyncStatus(prev => ({ ...prev, isSaving: false, isOnline: false }));
        if (enqueueOfflineAction) {
          enqueueOfflineAction('SITE_UPSERT', {
            code: savedSite.code,
            name: savedSite.name,
            region: savedSite.region || 'Metro Manila',
            address: savedSite.address || '',
            updated_at: new Date().toISOString()
          });
        }
        if (broadcastCloudEvent) broadcastCloudEvent('SITE_SAVED', { code: savedSite.code, name: savedSite.name });
      }
    } else {
      if (broadcastCloudEvent) broadcastCloudEvent('SITE_SAVED', { code: savedSite?.code, name: savedSite?.name });
    }
    return { success: true, site: savedSite };
  };

  const refreshSitesFromCloud = async () => {
    if (!supabase) return;
    try {
      showToast('Fetching latest site addresses from Supabase...', 'info');
      const { data: dbSites, error } = await supabase.from('sites').select('*');
      if (error) throw error;

      if (dbSites && dbSites.length > 0) {
        const authoritative = dbSites
          .filter(s =>
            !String(s.name || '').toUpperCase().includes('SM ILOILO') &&
            !String(s.address || '').toUpperCase().includes('SM ILOILO')
          )
          .map(s => ({
            id: s.id,
            code: normalizeSiteCode(s.code),
            name: s.name,
            region: s.region || 'Metro Manila',
            address: s.address || s.full_address || '',
            full_address: s.full_address || s.address || '',
            contact_person: s.contact_person || '',
            contact_phone: s.contact_phone || '',
            contact_email: s.contact_email || '',
            ship_to: s.ship_to || null,
            sold_to: s.sold_to || null,
            invoice_prefix: s.invoice_prefix || '',
            is_dc: s.is_dc ?? false,
            is_active: s.is_active ?? true
          }))
          .sort((a, b) => (a.code || '').localeCompare(b.code || ''));

        setSites(authoritative);
        try { localStorage.setItem('mdc_sites', JSON.stringify(authoritative)); } catch (e) {}
        dbStorage.setItem('mdc_sites', authoritative);
        showToast(`Successfully refreshed ${authoritative.length} sites from cloud database!`, 'success');
      }
    } catch (err) {
      console.warn('Supabase site fetch error:', err);
    }
  };

  const deleteSite = async (siteId, siteCode) => {
    const normCode = normalizeSiteCode(siteCode);
    const target = sites.find(s => s.id === siteId || normalizeSiteCode(s.code) === normCode);
    if (!target) return { success: false, error: 'Site not found' };

    if (target.is_dc) {
      showToast('Distribution Center (DC) site cannot be deleted', 'error');
      return { success: false, error: 'Cannot delete DC' };
    }

    const next = sites.filter(s => s.id !== siteId && normalizeSiteCode(s.code) !== normCode);
    setSites(next);
    try { localStorage.setItem('mdc_sites', JSON.stringify(next)); } catch (e) {}
    dbStorage.setItem('mdc_sites', next);

    if (supabase) {
      try {
        if (isUUID(siteId)) {
          await supabase.from('sites').delete().eq('id', siteId);
        } else if (normCode) {
          await supabase.from('sites').delete().ilike('code', normCode);
        }
        if (broadcastCloudEvent) broadcastCloudEvent('SITE_DELETED', { code: normCode, id: siteId });
      } catch (e) {
        console.warn('Supabase site delete error:', e);
      }
    } else {
      if (broadcastCloudEvent) broadcastCloudEvent('SITE_DELETED', { code: normCode, id: siteId });
    }

    if (typeof logDeletionAudit === 'function') {
      const activeUser = (typeof getCurrentUser === 'function' ? getCurrentUser() : currentUser) || null;
      try {
        await logDeletionAudit({
          entityType: 'Service Site',
          entityId: target.code,
          entityLabel: `${target.name} (${target.code})`,
          reason: 'Service site permanently removed from directory by user',
          summary: {
            site_id: target.id,
            site_code: target.code,
            site_name: target.name,
            region: target.region,
            address: target.address || target.full_address,
            contact_person: target.contact_person,
            is_dc: target.is_dc,
            deleted_by: activeUser?.fullName || 'Specialist'
          }
        });
      } catch (auditErr) {
        console.warn('Site deletion audit logging note:', auditErr);
      }
    }

    showToast(`Deleted site ${target.name} (${target.code})`, 'success');
    return { success: true };
  };

  const saveSupervisorSettings = (newSettings) => {
    setSupervisorSettings(prev => {
      const updated = {
        ...prev,
        ...newSettings,
        updated_at: new Date().toISOString()
      };
      try {
        localStorage.setItem('mdc_supervisor_settings', JSON.stringify(updated));
      } catch (e) {}
      dbStorage.setItem('mdc_supervisor_settings', updated);
      return updated;
    });

    if (broadcastCloudEvent) {
      broadcastCloudEvent('SUPERVISOR_SETTINGS_UPDATED', newSettings);
    }
  };

  const applyPmgDirectoryToSites = refreshSitesFromCloud;

  return {
    categories,
    setCategories,
    sites,
    setSites,
    parts,
    setParts,
    supervisorSettings,
    setSupervisorSettings,
    saveSupervisorSettings,
    savePart,
    deletePart,
    saveSite,
    deleteSite,
    refreshSitesFromCloud,
    applyPmgDirectoryToSites
  };
}

