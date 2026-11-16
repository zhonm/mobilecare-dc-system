/**
 * GSX Parts Catalog Importer (Idempotent & Non-Destructive)
 *
 * Parses GSX all Parts.csv, enforces an explicit obsolete-device exclusion rule,
 * filters out non-orderable Service Intangible rows, deduplicates by Part Number
 * using Stocking Price as primary cost, and merges idempotently with existing parts
 * without overwriting existing IDs or breaking foreign-key references.
 */

import { DEFAULT_PART_CATEGORIES, resolvePartCategoryId } from './categoryFilter.js';

export const OBSOLETE_DEVICE_EXCLUSION_RULES = {
  prefixes: ['OBS,', 'VIN,', '~VIN,'],
  legacyModels: [
    'iPhone 4S (8GB)',
    'iPhone 7',
    'iPhone 7 Plus',
    'iPhone XR',
    'iPhone XS Max',
    'iPhone XR Smart Battery Case',
    'iPhone Xs Smart Battery Case',
    'iPhone Xs Max Smart Battery Case',
    'iPhone 11 Smart Battery Case',
    'iPhone 11 Pro Smart Battery Case',
    'iPhone 11 Pro Max Smart Battery Case'
  ],
  cutoffNote:
    'Excludes Apple Obsolete (OBS,*), Vintage (VIN,*/~VIN,*), pre-iPhone 11 legacy models (4S, 7, 7 Plus, XR, XS Max), Smart Battery Cases, and blank/0 rows. Keeps iPhone 11, 11 Pro Max, SE (2nd/3rd gen), iPhone 12-17/17e, iPhone Air, and MagSafe accessories.'
};

/**
 * RFC-4180 compliant CSV parser handling quoted fields, embedded commas, and CRLF.
 * @param {string} csvText
 * @returns {Array<Object<string, string>>}
 */
export function parseCsvRecords(csvText) {
  if (!csvText || typeof csvText !== 'string') return [];
  const text = csvText.replace(/^\uFEFF/, '');
  const rows = [];
  let currentRow = [];
  let currentField = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        currentField += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        currentField += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      currentRow.push(currentField);
      currentField = '';
    } else if (ch === '\r' && next === '\n') {
      currentRow.push(currentField);
      rows.push(currentRow);
      currentRow = [];
      currentField = '';
      i++;
    } else if (ch === '\n' || ch === '\r') {
      currentRow.push(currentField);
      rows.push(currentRow);
      currentRow = [];
      currentField = '';
    } else {
      currentField += ch;
    }
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }

  if (rows.length === 0) return [];
  const headers = rows[0].map((h) => String(h || '').trim());
  const records = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.every((cell) => String(cell || '').trim() === '')) continue;
    const obj = {};
    for (let c = 0; c < headers.length; c++) {
      obj[headers[c]] = String(row[c] ?? '').trim();
    }
    records.push(obj);
  }
  return records;
}

/**
 * Determines whether a GSX Product Name represents an obsolete/excluded device.
 * @param {string} productName
 * @returns {{ excluded: boolean, reason: string | null }}
 */
export function classifyGsxDeviceStatus(productName) {
  const clean = String(productName || '').trim();
  if (!clean || clean === '0') {
    return { excluded: true, reason: 'Blank or invalid Product Name' };
  }
  const upper = clean.toUpperCase();
  if (upper.startsWith('OBS,')) {
    return { excluded: true, reason: 'Apple Obsolete (OBS prefix)' };
  }
  if (upper.startsWith('VIN,') || upper.startsWith('~VIN,')) {
    return { excluded: true, reason: 'Apple Vintage (VIN prefix)' };
  }
  if (OBSOLETE_DEVICE_EXCLUSION_RULES.legacyModels.includes(clean)) {
    return {
      excluded: true,
      reason: clean.includes('Smart Battery Case')
        ? 'Legacy Smart Battery Case'
        : 'Pre-iPhone 11 Legacy Model (outside current cutoff)'
    };
  }
  return { excluded: false, reason: null };
}

function getModelPriorityScore(modelName) {
  const m = String(modelName || '');
  const match = m.match(/iPhone\s+(\d+)/i);
  if (match) return parseInt(match[1], 10) * 10 + (m.includes('Pro Max') ? 4 : m.includes('Pro') ? 3 : m.includes('Plus') ? 2 : 1);
  if (/iPhone Air/i.test(m)) return 175;
  if (/SE \(3rd/i.test(m)) return 135;
  if (/SE \(2nd/i.test(m)) return 115;
  return 0;
}

/**
 * Parses GSX all Parts.csv text into deduplicated current parts + exclusion & audit reports.
 * @param {string} csvText
 * @param {Object} options
 * @returns {Object}
 */
export function importGsxCatalogFromCsv(csvText, options = {}) {
  const categories = options.categories || DEFAULT_PART_CATEGORIES;
  const rows = parseCsvRecords(csvText);

  const excludedDevicesMap = new Map();
  const keptDevicesSet = new Set();
  const serviceIntangibleParts = new Map();
  const partsByPn = new Map();
  const allDescriptionsByPn = new Map();

  let totalRows = 0;
  let excludedObsoleteRows = 0;
  let excludedServiceIntangibleRows = 0;
  let blankRows = 0;

  for (const row of rows) {
    totalRows++;
    const productName = String(row['Product Name'] || '').trim();
    const partNumber = String(row['Part Number'] || '').trim().toUpperCase();
    const secondaryPart = String(row['Secondary Part'] || '').trim().toUpperCase();
    const partDesc = String(row['Part Description'] || '').trim();
    const partType = String(row['Part Type'] || '').trim();
    const pricingOption = String(row['Pricing Option'] || '').trim();
    const rawPrice = parseFloat(String(row['Price'] || '0').replace(/,/g, '')) || 0;
    const componentGroup = String(row['Component Group'] || '').trim();
    const substitutePart = String(row['Substitute Part'] || '').trim().toUpperCase();
    const serializedRaw = String(row['Serialized Module'] || '').trim().toUpperCase();
    const serializedModule = serializedRaw === 'Y';

    if (partNumber && partDesc && !allDescriptionsByPn.has(partNumber)) {
      allDescriptionsByPn.set(partNumber, partDesc);
    }

    if (!partNumber) {
      blankRows++;
      continue;
    }

    const deviceCheck = classifyGsxDeviceStatus(productName);
    if (deviceCheck.excluded) {
      excludedObsoleteRows++;
      const existingDev = excludedDevicesMap.get(productName) || {
        product_name: productName || '<BLANK>',
        reason: deviceCheck.reason,
        row_count: 0,
        part_numbers: new Set()
      };
      existingDev.row_count++;
      existingDev.part_numbers.add(partNumber);
      excludedDevicesMap.set(productName, existingDev);
      continue;
    }

    if (partType === 'Service Intangible') {
      excludedServiceIntangibleRows++;
      if (!serviceIntangibleParts.has(partNumber)) {
        serviceIntangibleParts.set(partNumber, {
          part_number: partNumber,
          description: partDesc,
          product_name: productName
        });
      }
      continue;
    }

    keptDevicesSet.add(productName);

    let entry = partsByPn.get(partNumber);
    if (!entry) {
      entry = {
        id: `part-${partNumber.toLowerCase()}`,
        part_number: partNumber,
        description: partDesc || `Apple Part ${partNumber}`,
        iphone_model: productName,
        compatible_models: new Set([productName]),
        category_id: resolvePartCategoryId({ part_number: partNumber, description: partDesc }, categories),
        part_type: partType || 'Other',
        component_group: componentGroup || null,
        serialized_module: serializedModule,
        substitute_part: substitutePart || null,
        secondary_part: secondaryPart || null,
        stocking_price: 0,
        exchange_price: null,
        _fallback_price: 0,
        is_gsx_current: true,
        is_active: true,
        gsx_source: 'GSX all Parts.csv'
      };
      partsByPn.set(partNumber, entry);
    } else {
      entry.compatible_models.add(productName);
      if (getModelPriorityScore(productName) > getModelPriorityScore(entry.iphone_model)) {
        entry.iphone_model = productName;
      }
      if (!entry.description && partDesc) {
        entry.description = partDesc;
        entry.category_id = resolvePartCategoryId({ part_number: partNumber, description: partDesc }, categories);
      }
      if (serializedModule) entry.serialized_module = true;
      if (!entry.substitute_part && substitutePart) entry.substitute_part = substitutePart;
      if (!entry.secondary_part && secondaryPart) entry.secondary_part = secondaryPart;
      if (!entry.component_group && componentGroup) entry.component_group = componentGroup;
    }

    const optLower = pricingOption.toLowerCase();
    if (optLower.includes('stocking')) {
      if (rawPrice > 0 || entry.stocking_price === 0) {
        entry.stocking_price = rawPrice;
      }
    } else if (optLower.includes('exchange')) {
      if (entry.exchange_price === null || rawPrice > 0) {
        entry.exchange_price = rawPrice;
      }
    } else if (rawPrice > 0 && entry._fallback_price === 0) {
      entry._fallback_price = rawPrice;
    }
  }

  const importedParts = Array.from(partsByPn.values())
    .map((item) => {
      const finalStockingPrice = item.stocking_price > 0 ? item.stocking_price : item._fallback_price;
      const models = Array.from(item.compatible_models).sort();
      return {
        id: item.id,
        part_number: item.part_number,
        description: item.description,
        iphone_model: item.iphone_model,
        compatible_models: models,
        category_id: item.category_id,
        part_type: item.part_type,
        component_group: item.component_group,
        serialized_module: item.serialized_module,
        substitute_part: item.substitute_part,
        secondary_part: item.secondary_part,
        stocking_price: finalStockingPrice,
        exchange_price: item.exchange_price,
        is_gsx_current: true,
        is_active: true,
        gsx_source: item.gsx_source
      };
    })
    .sort((a, b) => a.part_number.localeCompare(b.part_number));

  const excludedDevices = Array.from(excludedDevicesMap.values())
    .map((d) => ({
      product_name: d.product_name,
      reason: d.reason,
      row_count: d.row_count,
      unique_part_numbers: d.part_numbers.size
    }))
    .sort((a, b) => a.product_name.localeCompare(b.product_name));

  return {
    parts: importedParts,
    allDescriptionsByPn,
    keptDevices: Array.from(keptDevicesSet).sort(),
    excludedDevices,
    serviceIntangibleCount: serviceIntangibleParts.size,
    stats: {
      totalCsvRows: totalRows,
      blankRows,
      excludedObsoleteRows,
      excludedObsoleteDeviceCount: excludedDevices.length,
      excludedServiceIntangibleRows,
      excludedServiceIntangibleUniquePns: serviceIntangibleParts.size,
      keptDevicesCount: keptDevicesSet.size,
      importedUniquePartsCount: importedParts.length,
      exclusionRule: OBSOLETE_DEVICE_EXCLUSION_RULES.cutoffNote
    }
  };
}

export const GSX_CATALOG_MIN_EXPECTED_PARTS = 4640;
export const FULL_MERGED_CATALOG_MIN_PARTS = 4700;

let _cachedGsxSeedParts = null;
let _gsxSeedLoadPromise = null;

/**
 * Lazily loads and caches the 4,640 current orderable GSX parts from `src/data/gsxPartsCatalog.json`.
 * Subsequent calls resolve immediately from memory.
 *
 * @returns {Promise<Array<Object>>}
 */
export async function loadGsxSeedParts() {
  if (Array.isArray(_cachedGsxSeedParts) && _cachedGsxSeedParts.length > 0) {
    return _cachedGsxSeedParts;
  }
  if (_gsxSeedLoadPromise) {
    return _gsxSeedLoadPromise;
  }
  _gsxSeedLoadPromise = import('../data/gsxPartsCatalog.json', { with: { type: 'json' } })
    .then((mod) => {
      const gsxSeed = mod?.default || mod;
      const seedParts = Array.isArray(gsxSeed?.parts) ? gsxSeed.parts : [];
      if (seedParts.length > 0) {
        _cachedGsxSeedParts = seedParts;
      }
      return seedParts;
    })
    .catch((err) => {
      console.debug('[gsxCatalogImporter] Failed to load gsxPartsCatalog.json:', err?.message);
      return [];
    })
    .finally(() => {
      _gsxSeedLoadPromise = null;
    });
  return _gsxSeedLoadPromise;
}

/**
 * Returns the cached GSX seed parts array synchronously if already loaded, or null.
 * @returns {Array<Object>|null}
 */
export function getCachedGsxSeedParts() {
  return _cachedGsxSeedParts;
}

/**
 * Safely persists the parts catalog to IndexedDB (`dbStorage`) and `localStorage`.
 * If the full JSON (~1.97 MB) exceeds `localStorage` quota alongside inventory caches,
 * falls back to a compact representation (~1.08 MB) and never leaves a stale 514-part
 * entry in `localStorage`.
 *
 * @param {Array<Object>} partsArray
 * @param {Object|null} dbStorageInstance
 */
export function persistPartsCatalog(partsArray, dbStorageInstance = null) {
  if (!Array.isArray(partsArray)) return;

  if (dbStorageInstance && typeof dbStorageInstance.setItem === 'function') {
    dbStorageInstance.setItem('mdc_parts', partsArray, { skipLocalStorage: true }).catch(() => {});
  }

  if (typeof window === 'undefined' || !window.localStorage) return;

  const markMergedFlag = () => {
    if (partsArray.length >= GSX_CATALOG_MIN_EXPECTED_PARTS) {
      try {
        window.localStorage.setItem('mdc_gsx_seed_merged_v1', '1');
      } catch {
        // Ignore quota errors on flag
      }
    }
  };

  try {
    const fullSerialized = JSON.stringify(partsArray);
    try {
      window.localStorage.setItem('mdc_parts', fullSerialized);
      markMergedFlag();
      return;
    } catch {
      window.localStorage.removeItem('mdc_parts');
      window.localStorage.setItem('mdc_parts', fullSerialized);
      markMergedFlag();
      return;
    }
  } catch {
    // Full JSON exceeded remaining 5MB localStorage quota; try compact representation
    try {
      const compactParts = partsArray.map((p) => ({
        id: p.id,
        part_number: p.part_number,
        description: p.description,
        iphone_model: p.iphone_model,
        category_id: p.category_id,
        stocking_price: p.stocking_price,
        is_active: p.is_active ?? true,
        ...(p.is_gsx_current ? { is_gsx_current: true } : {}),
        ...(p.serialized_module ? { serialized_module: true } : {}),
        ...(p.part_type && p.part_type !== 'Other' ? { part_type: p.part_type } : {})
      }));
      window.localStorage.removeItem('mdc_parts');
      window.localStorage.setItem('mdc_parts', JSON.stringify(compactParts));
      markMergedFlag();
    } catch {
      // Ensure stale partial (e.g. 514-part) localStorage cache is removed so IndexedDB + GSX seed govern
      try {
        window.localStorage.removeItem('mdc_parts');
      } catch {
        // Ignore
      }
      markMergedFlag();
    }
  }
}

/**
 * Idempotently merges imported GSX parts into an existing parts array.
 * - Preserves existing `id`, `safety_stock_pct`, and custom non-zero `stocking_price` / `category_id`
 *   so existing `inventory_units` and `po_items` foreign keys are NEVER broken.
 * - Re-running with the same catalog produces zero duplicates and zero unintended mutations.
 * - Deterministically sorts the merged catalog by `part_number` ascending so `localhost` and production
 *   always display identical ordering and counts.
 *
 * @param {Array<Object>} existingParts
 * @param {Array<Object>} gsxParts
 * @param {Array<Object>} categories
 * @returns {{ merged: Array<Object>, addedCount: number, updatedCount: number, unchangedCount: number }}
 */
export function mergeGsxPartsIntoCatalog(existingParts = [], gsxParts = [], categories = DEFAULT_PART_CATEGORIES) {
  const isGenericModel = (m) => !m || /^iphone(\s+model)?$/i.test(String(m).trim());

  const byPn = new Map();
  for (const existing of existingParts || []) {
    const pn = String(existing?.part_number || '').trim().toUpperCase();
    if (!pn) continue;
    if (!byPn.has(pn)) {
      byPn.set(pn, { ...existing, part_number: pn });
    }
  }

  let addedCount = 0;
  let updatedCount = 0;
  let unchangedCount = 0;

  for (const gsx of gsxParts || []) {
    const pn = String(gsx?.part_number || '').trim().toUpperCase();
    if (!pn) continue;

    const existing = byPn.get(pn);
    if (!existing) {
      byPn.set(pn, {
        ...gsx,
        part_number: pn,
        category_id: resolvePartCategoryId(gsx, categories),
        safety_stock_pct: gsx.safety_stock_pct ?? 0.05,
        is_active: gsx.is_active ?? true
      });
      addedCount++;
      continue;
    }

    const existingPrice = parseFloat(existing.stocking_price);
    const gsxPrice = parseFloat(gsx.stocking_price) || 0;
    const isDummyFallbackPrice = existingPrice === 99 && !existing.is_gsx_current && gsxPrice > 0;
    const nextStockingPrice =
      existingPrice > 0 && !isDummyFallbackPrice
        ? existingPrice
        : (gsxPrice > 0 ? gsxPrice : (existingPrice > 0 ? existingPrice : 0));

    const resolvedModel = !isGenericModel(existing.iphone_model)
      ? existing.iphone_model
      : (gsx.iphone_model || existing.iphone_model || 'iPhone');

    const candidate = {
      ...existing,
      // Preserve existing primary key & relationships
      id: existing.id || gsx.id,
      part_number: pn,
      description: existing.description || gsx.description,
      iphone_model: resolvedModel,
      stocking_price: nextStockingPrice,
      category_id: existing.category_id || resolvePartCategoryId({ ...existing, ...gsx }, categories),
      part_type: gsx.part_type || existing.part_type || 'Other',
      component_group: gsx.component_group ?? existing.component_group ?? null,
      serialized_module: gsx.serialized_module ?? existing.serialized_module ?? false,
      substitute_part: gsx.substitute_part ?? existing.substitute_part ?? null,
      secondary_part: gsx.secondary_part ?? existing.secondary_part ?? null,
      exchange_price: gsx.exchange_price ?? existing.exchange_price ?? null,
      compatible_models: Array.isArray(gsx.compatible_models) && gsx.compatible_models.length > 0
        ? gsx.compatible_models
        : (existing.compatible_models || []),
      is_gsx_current: true,
      gsx_source: gsx.gsx_source || existing.gsx_source || 'GSX all Parts.csv'
    };

    const changed =
      existing.part_type !== candidate.part_type ||
      existing.is_gsx_current !== candidate.is_gsx_current ||
      existing.stocking_price !== candidate.stocking_price ||
      existing.iphone_model !== candidate.iphone_model ||
      existing.serialized_module !== candidate.serialized_module ||
      JSON.stringify(existing.compatible_models || []) !== JSON.stringify(candidate.compatible_models || []);

    if (changed) {
      updatedCount++;
    } else {
      unchangedCount++;
    }
    byPn.set(pn, candidate);
  }

  const merged = Array.from(byPn.values()).sort((a, b) =>
    String(a.part_number || '').localeCompare(String(b.part_number || ''))
  );

  return {
    merged,
    addedCount,
    updatedCount,
    unchangedCount
  };
}
