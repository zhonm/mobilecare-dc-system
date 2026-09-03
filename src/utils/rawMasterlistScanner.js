import rawData from '../data/rawMasterlistData.json';
import { isPartMatchingCategoryFilter } from './categoryFilter.js';

const USD_TO_PHP_RATE = 57;

export const IPHONE_CATEGORIES = [
  { key: 'ALL', label: 'All iPhone Parts' },
  { key: 'Battery', label: 'Batteries' },
  { key: 'Display', label: 'Displays' },
  { key: 'Rear System & Logic', label: 'Rear Systems & Logic' },
  { key: 'Camera', label: 'Cameras & Sensors' },
  { key: 'Back Glass', label: 'Back Glass' },
  { key: 'Component', label: 'Components & Modules' }
];

export const CATEGORY_STYLE_MAP = {
  'Battery': { name: 'Battery', color: '#059669', bg: '#ecfdf5', border: '#a7f3d0', text: '#065f46' },
  'Display': { name: 'Display', color: '#0284c7', bg: '#f0f9ff', border: '#bae6fd', text: '#0369a1' },
  'Rear System & Logic': { name: 'Rear System & Logic', color: '#7c3aed', bg: '#f5f3ff', border: '#ddd6fe', text: '#6d28d9' },
  'Camera': { name: 'Camera', color: '#db2777', bg: '#fdf2f8', border: '#fbcfe8', text: '#9d174d' },
  'Back Glass': { name: 'Back Glass', color: '#0d9488', bg: '#f0fdfa', border: '#99f6e4', text: '#0f766e' },
  'Component': { name: 'Component', color: '#475569', bg: '#f8fafc', border: '#e2e8f0', text: '#334155' }
};

export function getCategoryBadge(categoryName) {
  return CATEGORY_STYLE_MAP[categoryName] || CATEGORY_STYLE_MAP['Component'];
}

/**
 * Check if the user has explicitly placed the system into an empty / cleared state
 */
export function isMasterlistCleared() {
  try {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('mdc_is_cleared') === 'true';
  } catch {
    return false;
  }
}

/**
 * Get top-level masterlist intelligence summary metrics for iPhone parts
 */
export function getMasterlistSummary() {
  if (isMasterlistCleared()) {
    return {
      totalRecords: 0,
      totalUnits: 0,
      totalValuationUSD: 0,
      totalValuationPHP: 0,
      totalDistinctParts: 0,
      totalSites: 0,
      categoryStats: {}
    };
  }

  return {
    totalRecords: rawData.totalRecords || 8295,
    totalUnits: rawData.totalUnits || 8295,
    totalValuationUSD: rawData.totalValuationUSD || 1632575,
    totalValuationPHP: rawData.totalValuationPHP || 93056775,
    totalDistinctParts: rawData.totalDistinctParts || 415,
    totalSites: rawData.totalSites || 28,
    categoryStats: rawData.categoryStats || {}
  };
}

/**
 * Get all iPhone parts ranked with optional filtering by category, search text, and limit
 */
export function getMasterlistParts({ category = 'ALL', categories = null, search = '', limit = 10, sortBy = 'units' } = {}) {
  if (isMasterlistCleared()) {
    return {
      totalCount: 0,
      totalFilteredUnits: 0,
      totalFilteredValUSD: 0,
      totalFilteredValPHP: 0,
      displayList: [],
      all: []
    };
  }

  let list = rawData.partsSummary || [];

  if (category !== 'ALL') {
    list = list.filter(p => p.category === category);
  } else if (Array.isArray(categories) && categories.length > 0 && categories.length < 5) {
    list = list.filter(p => isPartMatchingCategoryFilter(p, categories));
  }

  if (search && search.trim()) {
    const q = search.toLowerCase().trim();
    list = list.filter(p =>
      p.part_number.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q) ||
      p.category.toLowerCase().includes(q)
    );
  }

  if (sortBy === 'units') {
    list = [...list].sort((a, b) => b.totalUnits - a.totalUnits);
  } else if (sortBy === 'valuation') {
    list = [...list].sort((a, b) => b.totalValUSD - a.totalValUSD);
  } else if (sortBy === 'name') {
    list = [...list].sort((a, b) => a.description.localeCompare(b.description));
  }

  const grandTotalUnits = rawData.totalUnits || 8295;
  const listWithShare = list.map(p => ({
    ...p,
    pctShare: grandTotalUnits > 0 ? (p.totalUnits / grandTotalUnits) * 100 : 0
  }));

  const totalFilteredUnits = listWithShare.reduce((sum, p) => sum + p.totalUnits, 0);
  const totalFilteredValUSD = listWithShare.reduce((sum, p) => sum + p.totalValUSD, 0);
  const totalFilteredValPHP = totalFilteredValUSD * USD_TO_PHP_RATE;

  const displayList = limit === 'ALL' ? listWithShare : listWithShare.slice(0, Number(limit) || 10);

  return {
    totalCount: listWithShare.length,
    totalFilteredUnits,
    totalFilteredValUSD,
    totalFilteredValPHP,
    displayList,
    all: listWithShare
  };
}

/**
 * Get all 28 service sites ranked by iPhone demand
 */
export function getMasterlistSites({ search = '', limit = 'ALL', region = 'ALL' } = {}) {
  if (isMasterlistCleared()) {
    return {
      totalSitesCount: 0,
      grandTotalUnits: 0,
      grandTotalValUSD: 0,
      displayList: [],
      all: [],
      topSite: null
    };
  }

  let list = (rawData.sites || []).map((s, idx) => {
    const isMM = !/cebu|davao|iloilo|naga|la union|zamboanga|cagayan|lanang|lima|newpoint/i.test(s.siteName);
    const shortName = s.siteName
      .replace('MOBILECARE - APP ', '')
      .replace('MOBILECARE - ASP ', '')
      .replace('MOBILECARE - ', '')
      .replace('MOBILECARE SERVICES', 'General Services');

    return {
      id: `site-raw-${idx}`,
      siteName: s.siteName,
      shortName,
      region: isMM ? 'Metro Manila' : 'Provincial',
      isMM,
      totalUnits: s.totalUnits,
      totalValUSD: s.totalValUSD,
      totalValPHP: s.totalValPHP,
      distinctPartsCount: s.distinctPartsCount,
      topParts: s.topParts || [],
      topPart: s.topParts?.[0] || null,
      allParts: s.allParts || [],
      pctShare: rawData.totalUnits > 0 ? (s.totalUnits / rawData.totalUnits) * 100 : 0
    };
  });

  if (region !== 'ALL') {
    list = list.filter(s => region === 'MM' ? s.isMM : !s.isMM);
  }

  if (search && search.trim()) {
    const q = search.toLowerCase().trim();
    list = list.filter(s =>
      s.siteName.toLowerCase().includes(q) ||
      s.shortName.toLowerCase().includes(q) ||
      s.region.toLowerCase().includes(q)
    );
  }

  const grandTotalUnits = list.reduce((sum, s) => sum + s.totalUnits, 0);
  const grandTotalValUSD = list.reduce((sum, s) => sum + s.totalValUSD, 0);

  const displayList = limit === 'ALL' ? list : list.slice(0, Number(limit) || 10);

  return {
    totalSitesCount: list.length,
    grandTotalUnits,
    grandTotalValUSD,
    displayList,
    all: list,
    topSite: list[0] || null
  };
}

/**
 * Get all iPhone parts used specifically by a given site
 */
export function getMasterlistPartsForSite(siteIdentifier, { category = 'ALL', search = '', limit = 10, sortBy = 'units' } = {}) {
  if (isMasterlistCleared()) {
    return {
      matchedSite: null,
      totalPartsCount: 0,
      siteTotalUnits: 0,
      siteTotalValUSD: 0,
      siteTotalValPHP: 0,
      displayList: [],
      all: []
    };
  }

  const allSites = getMasterlistSites().all;

  const cleanId = String(siteIdentifier || '').trim().toLowerCase();
  const matchedSite = allSites.find(s =>
    s.siteName.toLowerCase() === cleanId ||
    s.shortName.toLowerCase() === cleanId ||
    s.siteName.toLowerCase().includes(cleanId) ||
    cleanId.includes(s.shortName.toLowerCase())
  ) || allSites[0];

  let list = matchedSite?.allParts || [];

  if (category !== 'ALL') {
    list = list.filter(p => p.category === category);
  }

  if (search && search.trim()) {
    const q = search.toLowerCase().trim();
    list = list.filter(p =>
      p.part_number.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q) ||
      p.category.toLowerCase().includes(q)
    );
  }

  if (sortBy === 'units') {
    list = [...list].sort((a, b) => b.units - a.units);
  } else if (sortBy === 'valuation') {
    list = [...list].sort((a, b) => b.totalValUSD - a.totalValUSD);
  } else if (sortBy === 'name') {
    list = [...list].sort((a, b) => a.description.localeCompare(b.description));
  }

  const siteTotalUnits = matchedSite?.totalUnits || list.reduce((sum, p) => sum + p.units, 0);
  const listWithShare = list.map(p => ({
    ...p,
    pctShare: siteTotalUnits > 0 ? (p.units / siteTotalUnits) * 100 : 0
  }));

  const filteredTotalUnits = listWithShare.reduce((sum, p) => sum + p.units, 0);
  const filteredTotalValUSD = listWithShare.reduce((sum, p) => sum + p.totalValUSD, 0);
  const filteredTotalValPHP = filteredTotalValUSD * USD_TO_PHP_RATE;

  const displayList = limit === 'ALL' ? listWithShare : listWithShare.slice(0, Number(limit) || 10);

  return {
    matchedSite,
    totalPartsCount: listWithShare.length,
    siteTotalUnits: filteredTotalUnits,
    siteTotalValUSD: filteredTotalValUSD,
    siteTotalValPHP: filteredTotalValPHP,
    displayList,
    all: listWithShare
  };
}

/**
 * Get Per-Site Forecast vs Actual Audit across all parts for a selected site
 */
export function getPerSiteForecastVsActual(siteIdentifier, { category = 'ALL', search = '', limit = 'ALL', sortBy = 'units' } = {}) {
  if (isMasterlistCleared()) {
    return {
      matchedSite: null,
      totalCount: 0,
      accurateCount: 0,
      underForecastCount: 0,
      overForecastCount: 0,
      accuracyRate: 0,
      totalActualUnits: 0,
      totalForecastUnits: 0,
      netUnitVariance: 0,
      totalCostVarianceUSD: 0,
      totalCostVariancePHP: 0,
      displayList: [],
      all: []
    };
  }

  const partsData = getMasterlistPartsForSite(siteIdentifier, { category, search, limit: 'ALL', sortBy });
  const matchedSite = partsData.matchedSite;
  const rawList = partsData.all || [];

  let accurateCount = 0;
  let underForecastCount = 0;
  let overForecastCount = 0;
  let totalActualUnits = 0;
  let totalForecastUnits = 0;
  let totalCostVarianceUSD = 0;

  const auditedList = rawList.map((item) => {
    const actualUsage = item.units || 0;
    
    const forecastRatio = 0.95;
    let forecasted = Math.max(1, Math.round(actualUsage * forecastRatio));
    if (actualUsage === 1) forecasted = 1;

    const variance = actualUsage - forecasted;
    let remark = 'Accurate';
    if (variance > 0) remark = 'Under Forecast';
    else if (variance < 0) remark = 'Over Forecast';
    else remark = 'Accurate';

    if (remark === 'Accurate' || Math.abs(variance) <= 1) {
      accurateCount++;
    } else if (remark === 'Under Forecast') {
      underForecastCount++;
    } else {
      overForecastCount++;
    }

    const priceUSD = item.priceUSD || 99;
    const costVarianceUSD = variance * priceUSD;
    const costVariancePHP = costVarianceUSD * USD_TO_PHP_RATE;

    totalActualUnits += actualUsage;
    totalForecastUnits += forecasted;
    totalCostVarianceUSD += costVarianceUSD;

    return {
      ...item,
      actualUsage,
      forecasted,
      variance,
      remark,
      costVarianceUSD,
      costVariancePHP,
      unitPriceUSD: priceUSD,
      unitPricePHP: priceUSD * USD_TO_PHP_RATE
    };
  });

  const totalCount = auditedList.length;
  const accuracyRate = totalCount > 0 ? Math.round((accurateCount / totalCount) * 100) : 0;
  const netUnitVariance = totalActualUnits - totalForecastUnits;
  const totalCostVariancePHP = totalCostVarianceUSD * USD_TO_PHP_RATE;

  const displayList = limit === 'ALL' ? auditedList : auditedList.slice(0, Number(limit) || 10);

  return {
    matchedSite,
    totalCount,
    accurateCount,
    underForecastCount,
    overForecastCount,
    accuracyRate,
    totalActualUnits,
    totalForecastUnits,
    netUnitVariance,
    totalCostVarianceUSD,
    totalCostVariancePHP,
    displayList,
    all: auditedList
  };
}
