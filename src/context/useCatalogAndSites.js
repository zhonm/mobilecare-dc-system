import { useState, useEffect } from 'react';
import { supabase } from '../supabase/client.js';
import dbStorage from '../utils/dbStorage.js';
import { isUUID } from '../utils/appContextHelpers.js';
import {
  DEFAULT_PART_CATEGORIES,
  resolvePartCategoryId,
  getPartCategory
} from '../utils/categoryFilter.js';
export const DEFAULT_SUPERVISOR_SETTINGS = {
  supervisor_name: 'Anjo Alcazar',
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
      const parsed = saved ? JSON.parse(saved) : [];
      if (Array.isArray(parsed) && parsed.length > 0) {
        const hasOther = parsed.some(c => String(c.code || '').toUpperCase() === 'OTHER');
        if (!hasOther) {
          const otherCat = DEFAULT_PART_CATEGORIES.find(c => c.code === 'OTHER');
          if (otherCat) parsed.push(otherCat);
        }
        return parsed;
      }
      return DEFAULT_PART_CATEGORIES;
    } catch {
      return DEFAULT_PART_CATEGORIES;
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

      // Fetch authoritative categories from Supabase
      supabase.from('part_categories').select('*').then(({ data: dbCats, error }) => {
        if (!error && dbCats && dbCats.length > 0) {
          const authoritativeCats = dbCats.map(c => ({
            id: c.id,
            code: c.code,
            name: c.name,
            has_imei: c.has_imei || false,
            is_serialized: c.is_serialized ?? true,
            sort_order: c.sort_order || 1
          }));
          if (!authoritativeCats.some(c => c.code === 'OTHER')) {
            const otherCat = DEFAULT_PART_CATEGORIES.find(c => c.code === 'OTHER');
            if (otherCat) authoritativeCats.push(otherCat);
          }
          setCategories(authoritativeCats);
          try { localStorage.setItem('mdc_categories', JSON.stringify(authoritativeCats)); } catch (e) {}
          dbStorage.setItem('mdc_categories', authoritativeCats);
        }
      }).catch(() => {});
    }
  }, []);

  const [parts, setParts] = useState(() => {
    try {
      const saved = localStorage.getItem('mdc_parts');
      const parsed = saved ? JSON.parse(saved) : [];
      let activeCats = DEFAULT_PART_CATEGORIES;
      try {
        const rawCats = localStorage.getItem('mdc_categories');
        if (rawCats) activeCats = JSON.parse(rawCats);
      } catch (e) {}

      return parsed.map(p => {
        const cleanPrice = parseFloat(p.stocking_price) > 0 ? parseFloat(p.stocking_price) : 99;
        const { exchange_price: _exchangePrice, ...rest } = p;
        const correctCatId = resolvePartCategoryId(p, activeCats);
        return {
          ...rest,
          stocking_price: cleanPrice,
          category_id: correctCatId
        };
      });
    } catch {
      return [];
    }
  });

  // Auto-heal part categories if any are misassigned to Battery
  useEffect(() => {
    if (!parts || parts.length === 0) return;
    let hasMismatches = false;
    const healed = parts.map(p => {
      const genuineCode = getPartCategory(p);
      const currentCat = categories.find(c => c.id === p.category_id);
      const currentCode = currentCat ? String(currentCat.code || '').toUpperCase() : '';

      if (currentCode !== genuineCode && !(genuineCode === 'OTHER' && (currentCode === 'GEN' || currentCode === 'ACC'))) {
        hasMismatches = true;
        const targetCatId = resolvePartCategoryId(p, categories);
        return { ...p, category_id: targetCatId };
      }
      return p;
    });

    if (hasMismatches) {
      setParts(healed);
      try { localStorage.setItem('mdc_parts', JSON.stringify(healed)); } catch (e) {}
      dbStorage.setItem('mdc_parts', healed);

      if (supabase) {
        const catMap = new Map((categories || []).map(c => [c.code, c.id]));
        const updates = healed
          .filter(p => p.part_number)
          .map(p => {
            const catCode = getPartCategory(p);
            const catId = catMap.get(catCode) || p.category_id;
            return {
              part_number: p.part_number,
              category_id: catId
            };
          });

        (async () => {
          for (let i = 0; i < updates.length; i += 50) {
            const chunk = updates.slice(i, i + 50);
            await supabase.from('parts').upsert(chunk, { onConflict: 'part_number' }).catch(() => {});
          }
        })();
      }
    }
  }, [categories, parts]);

  // Authoritative Supervisor & Declaration Form Settings Cloud / Local Hydration
  useEffect(() => {
    // 1. Asynchronously check IndexedDB
    dbStorage.getItem('mdc_supervisor_settings').then(savedDb => {
      if (savedDb && typeof savedDb === 'object') {
        setSupervisorSettings(prev => ({
          ...DEFAULT_SUPERVISOR_SETTINGS,
          ...prev,
          ...savedDb
        }));
      }
    }).catch(() => {});

    // 2. Query Supabase saved_records for master_supervisor_settings_registry
    if (supabase) {
      supabase
        .from('saved_records')
        .select('snapshot_data, updated_at')
        .eq('id', 'master_supervisor_settings_registry')
        .maybeSingle()
        .then(({ data, error }) => {
          if (!error && data?.snapshot_data && typeof data.snapshot_data === 'object') {
            const cloudSettings = data.snapshot_data;
            setSupervisorSettings(prev => {
              const merged = {
                ...DEFAULT_SUPERVISOR_SETTINGS,
                ...prev,
                ...cloudSettings
              };
              try {
                localStorage.setItem('mdc_supervisor_settings', JSON.stringify(merged));
              } catch (e) {}
              dbStorage.setItem('mdc_supervisor_settings', merged);
              return merged;
            });
          }
        })
        .catch(err => {
          console.warn('Initial supervisor settings fetch note:', err);
        });
    }
  }, []);

  const savePart = async (partData) => {
    if (!['superadmin', 'admin'].includes(currentUser?.role)) {
      showToast('Permission denied: Only Superadmin or Admin can modify the parts catalog.', 'error');
      return { success: false, error: 'Insufficient catalog permissions' };
    }

    const previousParts = parts;
    const cleanPN = String(partData.part_number || '').trim();
    const cleanDesc = String(partData.description || '').trim();

    if (!cleanPN) {
      showToast('Part number cannot be empty', 'error');
      return { success: false, error: 'Empty part number' };
    }

    let savedPartObj = null;
    const resolvedCatId = partData.category_id || resolvePartCategoryId({ part_number: cleanPN, description: cleanDesc }, categories);

    setParts(prev => {
      const existingIdx = prev.findIndex(p =>
        (partData.id && p.id === partData.id) ||
        (cleanPN && p.part_number === cleanPN)
      );

      let updated;
      if (existingIdx >= 0) {
        const existing = prev[existingIdx];
        const sp = parseFloat(partData.stocking_price ?? existing.stocking_price);
        savedPartObj = {
          ...existing,
          ...partData,
          part_number: cleanPN,
          description: cleanDesc || existing.description,
          category_id: partData.category_id || existing.category_id || resolvedCatId,
          stocking_price: sp > 0 ? sp : 99,
          updated_at: new Date().toISOString()
        };
        delete savedPartObj.exchange_price;
        updated = [...prev];
        updated[existingIdx] = savedPartObj;
      } else {
        const sp = parseFloat(partData.stocking_price);
        savedPartObj = {
          ...partData,
          id: partData.id || `part-${Date.now()}`,
          part_number: cleanPN,
          description: cleanDesc || 'Service Replacement Part',
          category_id: resolvedCatId,
          stocking_price: sp > 0 ? sp : 99,
          is_active: partData.is_active ?? true,
          created_at: new Date().toISOString()
        };
        delete savedPartObj.exchange_price;
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

    let persistenceFailed = false;
    if (supabase) {
      if (setCloudSyncStatus) setCloudSyncStatus(prev => ({ ...prev, isSaving: true }));
      try {
        const targetCat = categories.find(c => c.id === (partData.category_id || savedPartObj?.category_id));
        const catCode = targetCat?.code || getPartCategory({ part_number: cleanPN, description: cleanDesc });
        let dbCatId = (targetCat && isUUID(targetCat.id)) ? targetCat.id : null;
        if (!dbCatId) {
          const { data: matchedDbCat } = await supabase.from('part_categories').select('id').eq('code', catCode).maybeSingle();
          dbCatId = matchedDbCat?.id || null;
        }

        const { error } = await supabase.from('parts').upsert({
          ...(partData.id && isUUID(partData.id) ? { id: partData.id } : {}),
          part_number: cleanPN,
          description: cleanDesc,
          iphone_model: partData.iphone_model || 'iPhone',
          stocking_price: parseFloat(partData.stocking_price) || 0,
          is_active: partData.is_active ?? true,
          ...(dbCatId ? { category_id: dbCatId } : {}),
          updated_at: new Date().toISOString()
        }, { onConflict: 'part_number' });

        if (error) throw error;
        if (setCloudSyncStatus) setCloudSyncStatus({ isSaving: false, lastSaved: new Date(), isOnline: true });
        if (broadcastCloudEvent) broadcastCloudEvent('PART_SAVED', { partNumber: cleanPN });
      } catch (e) {
        console.error('Supabase part save error:', e.message);
        persistenceFailed = true;
        setParts(previousParts);
        try { localStorage.setItem('mdc_parts', JSON.stringify(previousParts)); } catch (storageError) {}
        dbStorage.setItem('mdc_parts', previousParts);
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

    if (persistenceFailed) {
      showToast(`Could not persist part ${cleanPN}; the previous catalog state was restored.`, 'error');
      return { success: false, error: 'Parts catalog persistence failed', part: savedPartObj };
    }

    showToast(`Saved part ${cleanPN} (${cleanDesc || 'Standard'}) in catalog`, 'success');
    return { success: true, part: savedPartObj };
  };

  const deletePart = async (partIdOrObj) => {
    if (!['superadmin', 'admin'].includes(currentUser?.role)) {
      showToast('Permission denied: Only Superadmin or Admin can modify the parts catalog.', 'error');
      return { success: false, error: 'Insufficient catalog permissions' };
    }

    const previousParts = parts;
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
      let persistenceFailed = false;
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
          persistenceFailed = true;
          setParts(previousParts);
          try { localStorage.setItem('mdc_parts', JSON.stringify(previousParts)); } catch (storageError) {}
          dbStorage.setItem('mdc_parts', previousParts);
          if (setCloudSyncStatus) setCloudSyncStatus(prev => ({ ...prev, isSaving: false, isOnline: false }));
          if (enqueueOfflineAction) enqueueOfflineAction('PART_DELETE', { id: deletedPart.id, part_number: deletedPart.part_number });
          if (broadcastCloudEvent) broadcastCloudEvent('PART_DELETED', { partNumber: deletedPart.part_number, id: deletedPart.id });
        }
      } else {
        if (broadcastCloudEvent) broadcastCloudEvent('PART_DELETED', { partNumber: deletedPart.part_number, id: deletedPart.id });
      }

      if (persistenceFailed) {
        showToast(`Could not delete part ${deletedPart.part_number}; the previous catalog state was restored.`, 'error');
        return { success: false, error: 'Parts catalog persistence failed', part: deletedPart };
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

  const saveSupervisorSettings = async (newSettings) => {
    const updated = {
      ...DEFAULT_SUPERVISOR_SETTINGS,
      ...supervisorSettings,
      ...newSettings,
      updated_at: new Date().toISOString()
    };

    setSupervisorSettings(updated);

    try {
      localStorage.setItem('mdc_supervisor_settings', JSON.stringify(updated));
    } catch (e) {}

    try {
      await dbStorage.setItem('mdc_supervisor_settings', updated);
    } catch (e) {}

    // Authoritative Cloud Persistence to Supabase saved_records
    if (supabase) {
      try {
        await supabase.from('saved_records').upsert({
          id: 'master_supervisor_settings_registry',
          record_type: 'supervisor_settings',
          period_label: 'Master Supervisor & Declaration Form Directive',
          period_year: new Date().getFullYear(),
          period_month: new Date().getMonth() + 1,
          notes: 'Master MDC Supervisor & Declaration Directive',
          snapshot_data: updated,
          updated_at: new Date().toISOString()
        }, { onConflict: 'id' });
      } catch (err) {
        console.warn('Sync master_supervisor_settings_registry note:', err);
      }
    }

    if (broadcastCloudEvent) {
      broadcastCloudEvent('SUPERVISOR_SETTINGS_UPDATED', updated);
    }

    if (showToast) {
      showToast('Supervisor & Declaration Form details saved successfully!', 'success');
    }

    return { success: true, settings: updated };
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

