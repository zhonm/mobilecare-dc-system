import { useState, useEffect, useRef } from 'react';
import { supabase } from '../supabase/client.js';
import dbStorage from '../utils/dbStorage.js';
import { isUUID } from '../utils/appContextHelpers.js';
import {
  DEFAULT_PART_CATEGORIES,
  isDefaultCategoryCode,
  normalizeCategoryCode,
  mergeWithDefaultCategories,
  resolvePartCategoryId,
  resolvePartCategoryUUID,
  getPartCategory
} from '../utils/categoryFilter.js';
import { resolveSafeRegion } from '../constants/config.js';
import { OFFICIAL_BRANCH_DIRECTORY, enrichSiteWithDirectory } from '../constants/branchDirectory.js';
import {
  importGsxCatalogFromCsv,
  mergeGsxPartsIntoCatalog,
  loadGsxSeedParts,
  persistPartsCatalog,
  GSX_CATALOG_MIN_EXPECTED_PARTS,
  FULL_MERGED_CATALOG_MIN_PARTS
} from '../utils/gsxCatalogImporter.js';
import { buildAutoRegisteredParts } from '../utils/partsCatalogAutoRegister.js';

export const DEFAULT_SUPERVISOR_SETTINGS = {
  supervisor_name: 'Anjo Alcazar',
  supervisor_title: 'MDC Supervisor of DC',
  guard_on_duty: ''
};

function canManagePartsCatalog(user) {
  const role = String(user?.role || '').trim().toLowerCase().replace(/[-\s]+/g, '_');
  const isSuperadminRole = role === 'superadmin' || role === 'super_admin' ||
    (role.includes('super') && role.includes('admin'));
  const hasSuperadminPermissions = Array.isArray(user?.permittedPages) && user.permittedPages.includes('user-access');
  return user?.isSuperAdmin === true || isSuperadminRole || hasSuperadminPermissions || role === 'admin';
}

function getCatalogUser(currentUser, getCurrentUser) {
  return currentUser || (typeof getCurrentUser === 'function' ? getCurrentUser() : null);
}

function normalizeSiteCode(rawCode) {
  if (!rawCode) return '';
  const clean = String(rawCode).trim().toUpperCase();
  if (clean === 'APPILO') return 'APP ILO';
  if (clean === 'DC') return 'DC-MDC';
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
        return mergeWithDefaultCategories(parsed);
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
      const sourceList = Array.isArray(parsed) && parsed.length > 0
        ? parsed
        : Object.keys(OFFICIAL_BRANCH_DIRECTORY).map((code, idx) => ({
            id: `site-${idx + 1}`,
            code,
            ...OFFICIAL_BRANCH_DIRECTORY[code]
          }));

      const clean = sourceList
        .filter(s =>
          !String(s.name || '').toUpperCase().includes('SM ILOILO') &&
          !String(s.address || '').toUpperCase().includes('SM ILOILO') &&
          (s.code || '').toUpperCase() !== 'APP ILO'
        )
        .map(s => enrichSiteWithDirectory({
          ...s,
          region: resolveSafeRegion(s.code, s.region)
        }));

      try { localStorage.setItem('mdc_sites', JSON.stringify(clean)); } catch (e) {}
      dbStorage.setItem('mdc_sites', clean);
      return clean.sort((a, b) => (a.code || '').localeCompare(b.code || ''));
    } catch {
      return Object.keys(OFFICIAL_BRANCH_DIRECTORY).map((code, idx) => ({
        id: `site-${idx + 1}`,
        code,
        ...OFFICIAL_BRANCH_DIRECTORY[code]
      }));
    }
  });

  const hasEnrichedSitesRef = useRef(false);

  useEffect(() => {
    if (supabase) {
      supabase.from('sites').select('*').then(async ({ data: dbSites, error }) => {
        if (!error && dbSites && dbSites.length > 0) {
          const authoritative = dbSites
            .filter(s =>
              !String(s.name || '').toUpperCase().includes('SM ILOILO') &&
              !String(s.address || '').toUpperCase().includes('SM ILOILO') &&
              (s.code || '').toUpperCase() !== 'APP ILO'
            )
            .map(s => enrichSiteWithDirectory({
              id: s.id,
              code: normalizeSiteCode(s.code),
              name: s.name,
              region: resolveSafeRegion(s.code, s.region),
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

          // Auto-heal / sync missing GSX Ship-To or supervisor contacts back to Supabase in background (at most once per app session)
          const needsSync = !hasEnrichedSitesRef.current && authoritative.some(s => s.ship_to && !dbSites.find(d => d.code === s.code)?.ship_to);
          if (needsSync) {
            hasEnrichedSitesRef.current = true;
            try {
              const rowsToUpsert = authoritative.map(s => ({
                code: s.code,
                name: s.name,
                region: s.region,
                address: s.address,
                full_address: s.full_address,
                contact_person: s.contact_person,
                contact_phone: s.contact_phone,
                contact_email: s.contact_email,
                ship_to: s.ship_to,
                sold_to: s.sold_to,
                invoice_prefix: s.invoice_prefix,
                is_dc: Boolean(s.is_dc),
                is_active: s.is_active !== false
              }));
              await supabase.from('sites').upsert(rowsToUpsert, { onConflict: 'code' });
            } catch (syncErr) {
              console.warn('Silent sites directory cloud enrichment note:', syncErr);
            }
          }
        }
      }).catch(() => {});

      // Fetch authoritative categories from Supabase
      supabase.from('part_categories').select('*').then(async ({ data: dbCats, error }) => {
        if (!error && dbCats && dbCats.length > 0) {
          const mappedDbCats = dbCats.map(c => ({
            id: c.id,
            code: c.code,
            name: c.name,
            has_imei: c.has_imei || false,
            is_serialized: c.is_serialized ?? true,
            sort_order: c.sort_order || 1
          }));
          const dbCodes = new Set(mappedDbCats.map(c => normalizeCategoryCode(c.code)));
          const missingDefaults = DEFAULT_PART_CATEGORIES.filter(def => !dbCodes.has(def.code));
          let authoritativeCats = mergeWithDefaultCategories(mappedDbCats);

          if (missingDefaults.length > 0) {
            try {
              const rowsToSeed = missingDefaults.map(def => ({
                code: def.code,
                name: def.name,
                has_imei: Boolean(def.has_imei),
                is_serialized: Boolean(def.is_serialized),
                sort_order: def.sort_order
              }));
              const { data: seededRows, error: seedErr } = await supabase
                .from('part_categories')
                .upsert(rowsToSeed, { onConflict: 'code' })
                .select('*');
              if (!seedErr && Array.isArray(seededRows) && seededRows.length > 0) {
                authoritativeCats = mergeWithDefaultCategories([...mappedDbCats, ...seededRows]);
              }
            } catch (seedNote) {
              console.warn('Silent default part_categories seed note:', seedNote);
            }
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
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.slice().sort((a, b) =>
            String(a.part_number || '').localeCompare(String(b.part_number || ''))
          );
        }
      }
      return [];
    } catch {
      return [];
    }
  });

  const categoriesRef = useRef(categories);
  useEffect(() => {
    categoriesRef.current = categories;
  }, [categories]);

  const partsRef = useRef(parts);
  useEffect(() => {
    partsRef.current = parts;
  }, [parts]);

  const isUnmountedRef = useRef(false);
  useEffect(() => {
    isUnmountedRef.current = false;
    return () => {
      isUnmountedRef.current = true;
    };
  }, []);

  const cloudDbPartsCacheRef = useRef([]);
  const hasAttemptedCloudPartsFetchRef = useRef(false);
  const isMergingGsxCatalogRef = useRef(false);

  // Hydrate & merge authoritative Parts Master Catalog (IndexedDB + 4,640 GSX seed parts + 514 Supabase cloud parts = 4,711 parts)
  // NOTE: Do NOT include `categories` in the dependency array or cancel in-flight merges when `categories` or `parts.length` updates;
  // cancelling a pending timer on state update was the root cause of localhost remaining stuck at 514 parts.
  useEffect(() => {
    if (isMergingGsxCatalogRef.current) return;
    const needsGsxSeed = parts.length < GSX_CATALOG_MIN_EXPECTED_PARTS;
    const needsCloudSupplement = parts.length < FULL_MERGED_CATALOG_MIN_PARTS && !hasAttemptedCloudPartsFetchRef.current;
    if (!needsGsxSeed && !needsCloudSupplement) {
      return;
    }

    isMergingGsxCatalogRef.current = true;

    const hydrateAndMergeCatalog = async () => {
      try {
        const [idbParts, seedParts] = await Promise.all([
          dbStorage.getItem('mdc_parts').catch(() => null),
          loadGsxSeedParts()
        ]);
        if (isUnmountedRef.current) return;

        const applyCatalogMerge = (extraCloudParts = []) => {
          const activeCats = categoriesRef.current || DEFAULT_PART_CATEGORIES;
          setParts(prev => {
            const combinedExistingMap = new Map();
            const ingestList = (list) => {
              if (!Array.isArray(list)) return;
              for (const item of list) {
                const pn = String(item?.part_number || '').trim().toUpperCase();
                if (!pn) continue;
                const prior = combinedExistingMap.get(pn);
                combinedExistingMap.set(pn, prior ? { ...prior, ...item, part_number: pn } : { ...item, part_number: pn });
              }
            };

            // Layer IndexedDB cache, current React state, and authoritative Supabase cloud rows
            ingestList(idbParts);
            ingestList(prev);
            ingestList(cloudDbPartsCacheRef.current);
            ingestList(extraCloudParts);

            const normalizedExisting = Array.from(combinedExistingMap.values()).map(p => {
              const rawPrice = parseFloat(p.stocking_price);
              const { exchange_price: _exchangePrice, ...rest } = p;
              const correctCatId = resolvePartCategoryId(p, activeCats);
              return {
                ...rest,
                stocking_price: rawPrice > 0 ? rawPrice : 99,
                category_id: correctCatId
              };
            });

            const merged = mergeGsxPartsIntoCatalog(normalizedExisting, seedParts, activeCats).merged;
            persistPartsCatalog(merged, dbStorage);
            return merged;
          });
        };

        // 1. Immediately merge local/IndexedDB parts with the 4,640 GSX seed parts
        if (seedParts.length > 0 || (Array.isArray(idbParts) && idbParts.length > parts.length)) {
          applyCatalogMerge([]);
        }

        // 2. Ensure ALL Supabase public.parts rows (paginated past PostgREST 1,000-row cap) are merged for full parity
        if (supabase && !hasAttemptedCloudPartsFetchRef.current) {
          hasAttemptedCloudPartsFetchRef.current = true;
          const allDbParts = [];
          const pageSize = 1000;
          let fetchErr = null;
          for (let offset = 0; ; offset += pageSize) {
            const { data: page, error } = await supabase
              .from('parts')
              .select('*')
              .order('part_number', { ascending: true })
              .range(offset, offset + pageSize - 1);
            if (error) {
              fetchErr = error;
              break;
            }
            if (!page || page.length === 0) break;
            allDbParts.push(...page);
            if (page.length < pageSize) break;
          }
          if (isUnmountedRef.current) return;
          if (!fetchErr && allDbParts.length > 0) {
            cloudDbPartsCacheRef.current = allDbParts;
            applyCatalogMerge(allDbParts);
          }
        }
      } catch (e) {
        console.debug('[useCatalogAndSites] GSX catalog hydration note:', e?.message);
      } finally {
        isMergingGsxCatalogRef.current = false;
      }
    };

    hydrateAndMergeCatalog();
  }, [parts.length]);

  // Auto-heal part categories in the background (deferred so it never blocks initial render/navigation)
  const healedCatsSignatureRef = useRef('');
  useEffect(() => {
    if (!parts || parts.length === 0 || !categories || categories.length === 0) return;
    const catSig = `${categories.map(c => c.id).join(',')}|${parts.length}`;
    if (healedCatsSignatureRef.current === catSig) return;

    let cancelled = false;
    const runAutoHeal = () => {
      if (cancelled) return;
      healedCatsSignatureRef.current = catSig;
      const catById = new Map(categories.map(c => [c.id, c]));
      let hasMismatches = false;
      const changedIndexes = new Set();
      const healed = parts.map((p, idx) => {
        const genuineCode = getPartCategory(p);
        const currentCat = catById.get(p.category_id);
        const currentCode = currentCat ? String(currentCat.code || '').toUpperCase() : '';

        if (currentCode !== genuineCode && !(genuineCode === 'OTHER' && (currentCode === 'GEN' || currentCode === 'ACC'))) {
          hasMismatches = true;
          changedIndexes.add(idx);
          const targetCatId = resolvePartCategoryId(p, categories);
          return { ...p, category_id: targetCatId };
        }
        return p;
      });

      if (hasMismatches && !cancelled) {
        setParts(healed);
        persistPartsCatalog(healed, dbStorage);

        if (supabase) {
          (async () => {
            let liveDbCats = [];
            try {
              const { data } = await supabase.from('part_categories').select('id, code');
              if (data && data.length > 0) liveDbCats = data;
            } catch (e) {}

            const updates = healed
              .filter((p, idx) => p.part_number && changedIndexes.has(idx))
              .map(p => {
                const catUuid = resolvePartCategoryUUID(p, liveDbCats.length > 0 ? liveDbCats : categories);
                return {
                  part_number: p.part_number,
                  ...(catUuid && isUUID(catUuid) ? { category_id: catUuid } : {})
                };
              });

            for (let i = 0; i < updates.length; i += 50) {
              const chunk = updates.slice(i, i + 50);
              await supabase.from('parts').upsert(chunk, { onConflict: 'part_number' }).catch(() => {});
            }
          })();
        }
      }
    };

    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      const idleId = window.requestIdleCallback(runAutoHeal, { timeout: 2500 });
      return () => { cancelled = true; window.cancelIdleCallback(idleId); };
    }
    const timer = setTimeout(runAutoHeal, 2000);
    return () => { cancelled = true; clearTimeout(timer); };
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
    if (!canManagePartsCatalog(getCatalogUser(currentUser, getCurrentUser))) {
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

      persistPartsCatalog(updated, dbStorage);
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
          dbCatId = (matchedDbCat?.id && isUUID(matchedDbCat.id)) ? matchedDbCat.id : null;
        }
        if (!dbCatId || !isUUID(dbCatId)) {
          dbCatId = resolvePartCategoryUUID({ part_number: cleanPN, description: cleanDesc }, categories);
        }

        const { error } = await supabase.from('parts').upsert({
          ...(partData.id && isUUID(partData.id) ? { id: partData.id } : {}),
          part_number: cleanPN,
          description: cleanDesc,
          iphone_model: partData.iphone_model || 'iPhone',
          stocking_price: parseFloat(partData.stocking_price) || 0,
          is_active: partData.is_active ?? true,
          ...(dbCatId && isUUID(dbCatId) ? { category_id: dbCatId } : {}),
          updated_at: new Date().toISOString()
        }, { onConflict: 'part_number' });

        if (error) throw error;
        if (setCloudSyncStatus) setCloudSyncStatus({ isSaving: false, lastSaved: new Date(), isOnline: true });
        if (broadcastCloudEvent) broadcastCloudEvent('PART_SAVED', { partNumber: cleanPN });
      } catch (e) {
        console.error('Supabase part save error:', e.message);
        persistenceFailed = true;
        setParts(previousParts);
        persistPartsCatalog(previousParts, dbStorage);
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

  const deletePart = async (partIdOrObj, reason = 'Part permanently removed from catalog by user') => {
    if (!canManagePartsCatalog(getCatalogUser(currentUser, getCurrentUser))) {
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
        (targetPN && p.part_number === targetPN)
      );
      if (match) deletedPart = match;

      const next = prev.filter(p => {
        if (targetId && p.id === targetId) return false;
        if (targetPN && targetDesc && p.part_number === targetPN && p.description === targetDesc) return false;
        if (targetPN && !targetDesc && !targetId && p.part_number === targetPN) return false;
        return true;
      });
      persistPartsCatalog(next, dbStorage);
      return next;
    });

    if (!deletedPart) {
      return { success: false, error: 'Part not found' };
    }

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
        persistPartsCatalog(previousParts, dbStorage);
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
          entityLabel: `${deletedPart.description} (${deletedPart.iphone_model || 'iPhone'})`,
          reason: reason || 'Part permanently removed from catalog by user',
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
  };

  const saveSite = async (siteData) => {
    let savedSite = null;
    const cleanCode = normalizeSiteCode(siteData.code);
    const cleanRegion = resolveSafeRegion(cleanCode, siteData.region);
    const cleanAddress = (siteData.address || siteData.full_address || '').trim();

    if (siteData.id) {
      savedSite = {
        ...siteData,
        code: cleanCode,
        name: (siteData.name || '').trim(),
        region: cleanRegion,
        address: cleanAddress,
        full_address: cleanAddress,
        contact_person: (siteData.contact_person || '').trim(),
        contact_phone: (siteData.contact_phone || '').trim(),
        contact_email: (siteData.contact_email || '').trim(),
        ship_to: (siteData.ship_to || '').trim() || null,
        sold_to: (siteData.sold_to || '').trim() || null
      };
      setSites(prev => {
        const next = prev.map(s => (s.id === siteData.id || normalizeSiteCode(s.code) === cleanCode) ? savedSite : s);
        try { localStorage.setItem('mdc_sites', JSON.stringify(next)); } catch (e) {}
        dbStorage.setItem('mdc_sites', next);
        return next;
      });
      showToast(`Updated site ${savedSite.name}`, 'success');
    } else {
      savedSite = {
        ...siteData,
        code: cleanCode,
        name: (siteData.name || '').trim(),
        region: cleanRegion,
        address: cleanAddress,
        full_address: cleanAddress,
        contact_person: (siteData.contact_person || '').trim(),
        contact_phone: (siteData.contact_phone || '').trim(),
        contact_email: (siteData.contact_email || '').trim(),
        ship_to: (siteData.ship_to || '').trim() || null,
        sold_to: (siteData.sold_to || '').trim() || null,
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
          address: savedSite.address || '',
          full_address: savedSite.full_address || savedSite.address || '',
          contact_person: savedSite.contact_person || '',
          contact_phone: savedSite.contact_phone || '',
          contact_email: savedSite.contact_email || '',
          ship_to: savedSite.ship_to || null,
          sold_to: savedSite.sold_to || null,
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
            full_address: savedSite.full_address || savedSite.address || '',
            contact_person: savedSite.contact_person || '',
            contact_phone: savedSite.contact_phone || '',
            contact_email: savedSite.contact_email || '',
            ship_to: savedSite.ship_to || null,
            sold_to: savedSite.sold_to || null,
            invoice_prefix: savedSite.invoice_prefix || '',
            is_dc: savedSite.is_dc ?? false,
            is_active: savedSite.is_active ?? true,
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
            !String(s.address || '').toUpperCase().includes('SM ILOILO') &&
            (s.code || '').toUpperCase() !== 'APP ILO'
          )
          .map(s => enrichSiteWithDirectory({
            id: s.id,
            code: normalizeSiteCode(s.code),
            name: s.name,
            region: resolveSafeRegion(s.code, s.region),
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

        // Sync complete directory details to Supabase Cloud
        try {
          const rowsToUpsert = authoritative.map(s => ({
            code: s.code,
            name: s.name,
            region: s.region,
            address: s.address,
            full_address: s.full_address,
            contact_person: s.contact_person,
            contact_phone: s.contact_phone,
            contact_email: s.contact_email,
            ship_to: s.ship_to,
            sold_to: s.sold_to,
            invoice_prefix: s.invoice_prefix,
            is_dc: Boolean(s.is_dc),
            is_active: s.is_active !== false
          }));
          await supabase.from('sites').upsert(rowsToUpsert, { onConflict: 'code' });
        } catch (syncErr) {
          console.warn('Supabase site upsert notice:', syncErr);
        }

        showToast(`Successfully refreshed ${authoritative.length} sites from cloud database!`, 'success');
      }
    } catch (err) {
      console.warn('Supabase site fetch error:', err);
    }
  };

  const deleteSite = async (siteId, siteCode, reason = 'Service site permanently removed from directory by user') => {
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
          reason: reason || 'Service site permanently removed from directory by user',
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

  const refreshGsxCatalogFromCsv = async (csvText, options = {}) => {
    const imported = importGsxCatalogFromCsv(csvText, options);
    const mergeResult = mergeGsxPartsIntoCatalog(parts, imported.parts, categories);
    const merged = mergeResult.merged;

    setParts(merged);
    persistPartsCatalog(merged, dbStorage);

    if (showToast) {
      showToast(
        `GSX Catalog refreshed: ${imported.parts.length.toLocaleString()} current parts (${mergeResult.addedCount} new added, ${imported.stats.excludedObsoleteDeviceCount} obsolete device groups excluded)`,
        'success'
      );
    }

    return {
      success: true,
      importedCount: imported.parts.length,
      addedCount: mergeResult.addedCount,
      updatedCount: mergeResult.updatedCount,
      totalCatalogCount: merged.length,
      stats: imported.stats,
      excludedDevicesReport: imported.excludedDevices
    };
  };

  const autoRegisterPartsToCatalog = async (candidateItems = [], options = {}) => {
    const { silent = false } = options || {};
    if (!Array.isArray(candidateItems) || candidateItems.length === 0) {
      return { success: true, addedCount: 0, addedParts: [] };
    }

    const activeCategories = categoriesRef.current || categories;
    const { nextParts, addedParts, addedCount } = buildAutoRegisteredParts(
      partsRef.current || parts,
      candidateItems,
      activeCategories
    );

    if (addedCount === 0) {
      return { success: true, addedCount: 0, addedParts: [] };
    }

    partsRef.current = nextParts;
    setParts(nextParts);
    persistPartsCatalog(nextParts, dbStorage);

    // Best-effort cloud sync (non-blocking so CSV uploads always succeed even offline or for non-admin uploaders)
    if (supabase) {
      try {
        const dbRows = addedParts.map(p => ({
          part_number: p.part_number,
          description: p.description,
          iphone_model: p.iphone_model || 'iPhone',
          stocking_price: parseFloat(p.stocking_price) || 0,
          is_active: true,
          category_id: resolvePartCategoryUUID(p, activeCategories),
          updated_at: p.updated_at || new Date().toISOString()
        }));
        const { error } = await supabase.from('parts').upsert(dbRows, { onConflict: 'part_number' });
        if (!error && broadcastCloudEvent) {
          broadcastCloudEvent('PART_SAVED', { count: addedCount, autoRegistered: true });
        }
      } catch (cloudErr) {
        console.warn('[PartsCatalog] Non-blocking cloud upsert note for auto-registered parts:', cloudErr?.message || cloudErr);
      }
    } else if (broadcastCloudEvent) {
      broadcastCloudEvent('PART_SAVED', { count: addedCount, autoRegistered: true });
    }

    if (!silent && showToast) {
      showToast(
        `Auto-registered ${addedCount} new part number${addedCount === 1 ? '' : 's'} to the Parts Catalog.`,
        'info'
      );
    }

    return { success: true, addedCount, addedParts };
  };

  const saveCategory = async (categoryData) => {
    const activeUser = getCatalogUser(currentUser, getCurrentUser);
    if (!canManagePartsCatalog(activeUser)) {
      const error = 'Only administrators can create or modify part categories.';
      showToast?.(error, 'error');
      return { success: false, error };
    }

    const cleanName = String(categoryData?.name || '').trim();
    if (!cleanName) {
      const error = 'Category name is required.';
      showToast?.(error, 'error');
      return { success: false, error };
    }

    const activeList = Array.isArray(categoriesRef.current) ? categoriesRef.current : DEFAULT_PART_CATEGORIES;
    const isEditing = Boolean(categoryData?.id);
    const existingTarget = isEditing
      ? activeList.find(c => c.id === categoryData.id || normalizeCategoryCode(c.code) === normalizeCategoryCode(categoryData.originalCode || categoryData.code))
      : null;

    const lockedDefaultCode = existingTarget && isDefaultCategoryCode(existingTarget.code)
      ? normalizeCategoryCode(existingTarget.code)
      : null;

    const normalizedCode = lockedDefaultCode || normalizeCategoryCode(categoryData?.code || cleanName);
    if (!normalizedCode) {
      const error = 'Category code must contain letters or numbers.';
      showToast?.(error, 'error');
      return { success: false, error };
    }

    const duplicate = activeList.find(c =>
      normalizeCategoryCode(c.code) === normalizedCode &&
      (!existingTarget || c.id !== existingTarget.id)
    );
    if (duplicate) {
      const error = `A category with code "${normalizedCode}" already exists (${duplicate.name}).`;
      showToast?.(error, 'error');
      return { success: false, error };
    }

    const maxSort = activeList.reduce((max, c) => Math.max(max, Number(c.sort_order) || 0), 0);
    const parsedSort = Number(categoryData?.sort_order);
    const sortOrder = Number.isFinite(parsedSort) && parsedSort > 0
      ? Math.round(parsedSort)
      : (existingTarget?.sort_order || maxSort + 1);

    const savedCategory = {
      id: existingTarget?.id || `cat-${normalizedCode.toLowerCase().replace(/_/g, '-')}-${Date.now().toString(36)}`,
      code: normalizedCode,
      name: cleanName,
      is_serialized: Boolean(categoryData?.is_serialized),
      has_imei: Boolean(categoryData?.has_imei),
      sort_order: sortOrder
    };

    const nextList = mergeWithDefaultCategories(
      existingTarget
        ? activeList.map(c => (c.id === existingTarget.id ? savedCategory : c))
        : [...activeList, savedCategory]
    );

    categoriesRef.current = nextList;
    setCategories(nextList);
    try { localStorage.setItem('mdc_categories', JSON.stringify(nextList)); } catch (e) {}
    dbStorage.setItem('mdc_categories', nextList);

    if (supabase) {
      try {
        const dbPayload = {
          code: savedCategory.code,
          name: savedCategory.name,
          is_serialized: savedCategory.is_serialized,
          has_imei: savedCategory.has_imei,
          sort_order: savedCategory.sort_order
        };
        let dbResult = null;
        if (existingTarget && isUUID(existingTarget.id)) {
          const { data, error } = await supabase
            .from('part_categories')
            .update(dbPayload)
            .eq('id', existingTarget.id)
            .select('*')
            .maybeSingle();
          if (error) throw error;
          dbResult = data;
        } else {
          const { data, error } = await supabase
            .from('part_categories')
            .upsert(dbPayload, { onConflict: 'code' })
            .select('*')
            .maybeSingle();
          if (error) throw error;
          dbResult = data;
        }

        if (dbResult && dbResult.id && dbResult.id !== savedCategory.id) {
          const syncedCategory = { ...savedCategory, id: dbResult.id };
          const syncedList = mergeWithDefaultCategories(
            categoriesRef.current.map(c => (c.code === savedCategory.code ? syncedCategory : c))
          );
          categoriesRef.current = syncedList;
          setCategories(syncedList);
          try { localStorage.setItem('mdc_categories', JSON.stringify(syncedList)); } catch (e) {}
          dbStorage.setItem('mdc_categories', syncedList);
        }
      } catch (err) {
        console.warn('Supabase part_categories save note:', err);
        if (enqueueOfflineAction) {
          enqueueOfflineAction('UPSERT_CATEGORY', {
            code: savedCategory.code,
            name: savedCategory.name,
            is_serialized: savedCategory.is_serialized,
            has_imei: savedCategory.has_imei,
            sort_order: savedCategory.sort_order
          });
        }
      }
    }

    if (broadcastCloudEvent) {
      broadcastCloudEvent('CATEGORY_SAVED', { code: savedCategory.code, name: savedCategory.name });
    }
    showToast?.(
      existingTarget
        ? `Updated category "${savedCategory.name}" (${savedCategory.code})`
        : `Created custom category "${savedCategory.name}" (${savedCategory.code})`,
      'success'
    );
    return { success: true, category: savedCategory };
  };

  const deleteCategory = async (categoryId, categoryCode) => {
    const activeUser = getCatalogUser(currentUser, getCurrentUser);
    if (!canManagePartsCatalog(activeUser)) {
      const error = 'Only administrators can delete part categories.';
      showToast?.(error, 'error');
      return { success: false, error };
    }

    const activeList = Array.isArray(categoriesRef.current) ? categoriesRef.current : DEFAULT_PART_CATEGORIES;
    const normCode = normalizeCategoryCode(categoryCode);
    const target = activeList.find(c => c.id === categoryId || (normCode && normalizeCategoryCode(c.code) === normCode));
    if (!target) {
      return { success: false, error: 'Category not found.' };
    }

    if (isDefaultCategoryCode(target.code)) {
      const error = `Default system category "${target.name}" (${target.code}) cannot be deleted.`;
      showToast?.(error, 'error');
      return { success: false, error };
    }

    const assignedPartsCount = (partsRef.current || []).filter(p =>
      p.category_id === target.id ||
      normalizeCategoryCode(p.category_code || p.category) === normalizeCategoryCode(target.code)
    ).length;

    if (assignedPartsCount > 0) {
      const error = `Cannot delete "${target.name}" because ${assignedPartsCount} part${assignedPartsCount === 1 ? ' is' : 's are'} currently assigned to it. Reassign those parts first.`;
      showToast?.(error, 'error');
      return { success: false, error };
    }

    const nextList = activeList.filter(c => c.id !== target.id && normalizeCategoryCode(c.code) !== normalizeCategoryCode(target.code));
    categoriesRef.current = nextList;
    setCategories(nextList);
    try { localStorage.setItem('mdc_categories', JSON.stringify(nextList)); } catch (e) {}
    dbStorage.setItem('mdc_categories', nextList);

    if (supabase) {
      try {
        if (isUUID(target.id)) {
          await supabase.from('part_categories').delete().eq('id', target.id);
        } else {
          await supabase.from('part_categories').delete().eq('code', target.code);
        }
      } catch (err) {
        console.warn('Supabase part_categories delete note:', err);
      }
    }

    if (typeof logDeletionAudit === 'function') {
      try {
        await logDeletionAudit({
          entityType: 'Part Category',
          entityId: target.code,
          entityLabel: `${target.name} (${target.code})`,
          reason: 'Custom part category removed by administrator',
          summary: {
            category_id: target.id,
            code: target.code,
            name: target.name,
            is_serialized: target.is_serialized,
            has_imei: target.has_imei,
            deleted_by: activeUser?.fullName || 'Administrator'
          }
        });
      } catch (auditErr) {
        console.warn('Category deletion audit note:', auditErr);
      }
    }

    if (broadcastCloudEvent) {
      broadcastCloudEvent('CATEGORY_DELETED', { code: target.code, id: target.id });
    }
    showToast?.(`Deleted custom category "${target.name}" (${target.code})`, 'success');
    return { success: true };
  };

  return {
    categories,
    setCategories,
    saveCategory,
    deleteCategory,
    sites,
    setSites,
    parts,
    setParts,
    supervisorSettings,
    setSupervisorSettings,
    saveSupervisorSettings,
    savePart,
    autoRegisterPartsToCatalog,
    deletePart,
    saveSite,
    deleteSite,
    refreshSitesFromCloud,
    applyPmgDirectoryToSites,
    refreshGsxCatalogFromCsv
  };
}

