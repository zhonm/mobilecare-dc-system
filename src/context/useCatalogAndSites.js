import { useState } from 'react';
import seedData from '../data/seedData.json';
import { supabase } from '../supabase/client';
import dbStorage from '../utils/dbStorage';
import { DEFAULT_SUPERVISOR_SIGNATURE_BASE64 } from '../assets/supervisorSignatureBase64.js';

export const DEFAULT_SUPERVISOR_SETTINGS = {
  supervisor_name: 'Anjo Alcazar',
  supervisor_title: 'MDC Supervisor of DC',
  signature_image: DEFAULT_SUPERVISOR_SIGNATURE_BASE64,
  guard_on_duty: ''
};

function normalizeSiteCode(rawCode) {
  if (!rawCode) return '';
  const clean = String(rawCode).trim().toUpperCase();
  if (clean === 'APPILO') return 'APP ILO';
  return clean;
}

export function useCatalogAndSites({
  showToast,
  broadcastCloudEvent,
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
          ...parsed,
          signature_image: parsed.signature_image || DEFAULT_SUPERVISOR_SIGNATURE_BASE64
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
      return saved ? JSON.parse(saved) : (seedData.categories || []);
    } catch {
      return seedData.categories || [];
    }
  });

  const [sites, setSites] = useState(() => {
    try {
      const saved = localStorage.getItem('mdc_sites');
      const parsed = saved ? JSON.parse(saved) : [];
      const map = new Map();
      (seedData.sites || []).forEach(s => {
        if (s && s.code) {
          const normCode = normalizeSiteCode(s.code);
          map.set(normCode, { ...s, code: normCode });
        }
      });
      if (Array.isArray(parsed) && parsed.length > 0) {
        parsed.forEach(s => {
          if (s && s.code) {
            const normCode = normalizeSiteCode(s.code);
            const existing = map.get(normCode);
            map.set(normCode, { ...existing, ...s, code: normCode });
          }
        });
      }
      return Array.from(map.values()).sort((a, b) => (a.code || '').localeCompare(b.code || ''));
    } catch {
      return (seedData.sites || []).sort((a, b) => (a.code || '').localeCompare(b.code || ''));
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
          if (deletedPart.id && !deletedPart.id.startsWith('part-')) {
            const { error } = await supabase.from('parts').delete().eq('id', deletedPart.id);
            if (error) throw error;
          } else {
            const { error } = await supabase.from('parts').delete().match({ part_number: deletedPart.part_number, description: deletedPart.description });
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

  const refreshSitesFromCloud = async () => {
    if (!supabase) {
      applyPmgDirectoryToSites();
      return;
    }
    try {
      showToast('Fetching latest site addresses from Supabase...', 'info');
      const { data: dbSites, error } = await supabase.from('sites').select('*');
      if (error) throw error;

      if (dbSites && dbSites.length > 0) {
        setSites(prev => {
          const map = new Map((prev || []).map(s => [normalizeSiteCode(s.code), s]));
          dbSites.forEach(s => {
            const normCode = normalizeSiteCode(s.code);
            const existing = map.get(normCode);
            map.set(normCode, {
              ...(existing || {}),
              id: s.id || existing?.id,
              code: normCode,
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
    showToast('Supervisor & Declaration Form settings updated', 'success');
  };

  const resetSupervisorSignature = () => {
    saveSupervisorSettings({
      signature_image: DEFAULT_SUPERVISOR_SIGNATURE_BASE64
    });
    showToast('Supervisor signature reset to default official signature', 'info');
  };

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
    resetSupervisorSignature,
    savePart,
    deletePart,
    saveSite,
    refreshSitesFromCloud,
    applyPmgDirectoryToSites
  };
}

