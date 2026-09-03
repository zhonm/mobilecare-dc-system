/**
 * Category Filter & Classification Helpers
 */

export const DEFAULT_SELECTED_CATEGORIES = ['BATTERY', 'DISPLAY'];

export const HARDWARE_CATEGORIES = [
  { code: 'BATTERY', id: 'cat-battery', name: 'Battery', color: '#059669', bg: '#ecfdf5', border: '#a7f3d0' },
  { code: 'DISPLAY', id: 'cat-display', name: 'Display', color: '#0284c7', bg: '#f0f9ff', border: '#bae6fd' },
  { code: 'CAMERA', id: 'cat-camera', name: 'Camera', color: '#db2777', bg: '#fdf2f8', border: '#fbcfe8' },
  { code: 'BACK_GLASS', id: 'cat-backglass', name: 'Back Glass', color: '#0d9488', bg: '#f0fdfa', border: '#99f6e4' },
  { code: 'MID_REAR', id: 'cat-midrear', name: 'Mid/Rear System', color: '#7c3aed', bg: '#f5f3ff', border: '#ddd6fe' }
];

// Common component disqualifiers that prevent accessories, consumables, and sub-modules from being misclassified
const UNRELATED_COMPONENT_TERMS = [
  'microphone',
  'mic,',
  ', mic',
  'speaker',
  'earpiece',
  'receiver',
  'taptic',
  'vibrat',
  'sim tray',
  'sim-tray',
  'tray,',
  'screw',
  'bracket',
  'adhesive',
  'tape',
  'shim',
  'cushion',
  'gasket',
  'antenna',
  'flex cable'
];

/**
 * Resolves the genuine hardware category for any iPhone part by inspecting
 * both its description and its stored category_id.
 *
 * Guaranteed Categories:
 *   - 'DISPLAY'
 *   - 'BATTERY'
 *   - 'CAMERA'
 *   - 'BACK_GLASS'
 *   - 'MID_REAR'
 *   - 'OTHER'
 *
 * @param {Object|string} itemOrDesc - Part object or description string
 * @returns {'DISPLAY'|'BATTERY'|'CAMERA'|'BACK_GLASS'|'MID_REAR'|'OTHER'}
 */
export function getPartCategory(itemOrDesc) {
  if (!itemOrDesc) return 'OTHER';
  const desc = typeof itemOrDesc === 'string'
    ? itemOrDesc.toLowerCase().trim()
    : String(itemOrDesc.description || itemOrDesc.part_name || itemOrDesc.name || '').toLowerCase().trim();

  const cat = typeof itemOrDesc === 'object'
    ? String(itemOrDesc.category_id || itemOrDesc.category || '').toLowerCase().trim()
    : '';

  // Check if description has an unrelated component term (e.g. microphone, speaker, screw, bracket)
  const hasUnrelatedTerm = UNRELATED_COMPONENT_TERMS.some(term => desc.includes(term)) ||
    desc.startsWith('mic ') ||
    desc.startsWith('main microphone') ||
    desc.includes('pSIM tray');

  // 1. DISPLAY: screens, displays, front panels
  // MUST have 'display' or 'screen' in description.
  const hasDisplayKeyword = desc.includes('display') || desc.includes('screen');
  if (hasDisplayKeyword && !hasUnrelatedTerm) {
    const isDisplayDisqualified =
      desc.includes('battery') ||
      desc.includes('camera') ||
      desc.includes('back glass') ||
      desc.includes('rear glass') ||
      desc.includes('enclosure') ||
      desc.includes('rear system') ||
      desc.includes('housing') ||
      desc.includes('chassis') ||
      desc.includes('logic board');

    if (!isDisplayDisqualified) {
      return 'DISPLAY';
    }
  }

  // 2. BATTERY: must genuinely be a battery cell / assembly
  // MUST explicitly contain 'battery' or word-boundary 'batt' in description.
  const hasBatteryKeyword = desc.includes('battery') || /\bbatt\b/.test(desc) || desc.startsWith('battery');

  if (hasBatteryKeyword && !hasUnrelatedTerm) {
    const isBatteryDisqualified =
      desc.includes('speaker') ||
      desc.includes('enclosure') ||
      desc.includes('rear system') ||
      desc.includes('camera') ||
      desc.includes('glass') ||
      desc.includes('display') ||
      desc.includes('screen') ||
      desc.includes('housing') ||
      desc.includes('chassis') ||
      desc.includes('logic board');

    if (!isBatteryDisqualified) {
      return 'BATTERY';
    }
  }

  // 3. CAMERA: cameras, TrueDepth, sensors, LiDAR
  const hasCameraKeyword = desc.includes('camera') ||
    desc.includes('sensor') ||
    desc.includes('truedepth') ||
    desc.includes('face id') ||
    desc.includes('lidar');

  if (hasCameraKeyword && !hasUnrelatedTerm) {
    if (!desc.includes('battery') && !desc.includes('display') && !desc.includes('screen') && !desc.includes('microphone') && !desc.includes('speaker') && !desc.includes('screw') && !desc.includes('adhesive')) {
      return 'CAMERA';
    }
  }

  // 4. BACK GLASS: rear glass, back glass
  const hasGlassKeyword = desc.includes('back glass') ||
    desc.includes('rear glass') ||
    desc.includes('back-glass') ||
    desc.includes('rear-glass');

  if (hasGlassKeyword && !hasUnrelatedTerm) {
    if (!desc.includes('battery') && !desc.includes('display') && !desc.includes('screen') && !desc.includes('camera') && !desc.includes('microphone') && !desc.includes('speaker') && !desc.includes('screw')) {
      return 'BACK_GLASS';
    }
  }

  // 5. MID_REAR SYSTEM: rear systems, logic boards, enclosures, housings, chassis, and storage/color enclosure units (e.g. 128GB, Desert Titanium, ROW, CI/AR)
  const isMidRearCandidate =
    desc.includes('rear system') ||
    desc.includes('mid/rear') ||
    desc.includes('mid rear') ||
    desc.includes('mid-rear') ||
    desc.includes('logic board') ||
    desc.includes('main logic') ||
    desc.includes('enclosure') ||
    desc.includes('housing') ||
    desc.includes('chassis') ||
    desc.includes('rear cover') ||
    /\b(64\s*gb|128\s*gb|256\s*gb|512\s*gb|1\s*tb)\b/i.test(desc) ||
    desc.includes('ci/ar') ||
    cat === 'cat-midrear' ||
    cat === 'cat-logic-mid' ||
    cat === 'cat-rearsystem';

  if (isMidRearCandidate && !hasUnrelatedTerm) {
    if (!desc.includes('battery') && !desc.includes('display') && !desc.includes('screen') && !desc.includes('camera') && !desc.includes('microphone') && !desc.includes('speaker') && !desc.includes('screw') && !desc.includes('adhesive')) {
      return 'MID_REAR';
    }
  }

  return 'OTHER';
}

/**
 * Checks if a part or forecast/allocation item matches the active category selection.
 * When the user selects ['BATTERY', 'DISPLAY'], strictly genuine Displays and Batteries match.
 *
 * @param {Object} item - Item with category_id / category and description / name
 * @param {Array<string>} selectedCats - Array of active category codes (e.g. ['BATTERY', 'DISPLAY'])
 * @returns {boolean}
 */
export function isPartMatchingCategoryFilter(item, selectedCats = DEFAULT_SELECTED_CATEGORIES) {
  if (!item) return false;
  if (!Array.isArray(selectedCats) || selectedCats.length === 0) return true;

  // Explicit 'ALL' or 'ALL_PARTS' bypasses filter
  if (selectedCats.includes('ALL') || selectedCats.includes('ALL_PARTS')) return true;

  const partCat = getPartCategory(item);

  // If part is recognized in the 5 main categories
  if (['DISPLAY', 'BATTERY', 'CAMERA', 'BACK_GLASS', 'MID_REAR'].includes(partCat)) {
    return selectedCats.includes(partCat);
  }

  // For unclassified 'OTHER' parts (microphones, speakers, trays, screws, brackets)
  // Only include if explicitly requested via 'OTHER' category
  return selectedCats.includes('OTHER');
}

/**
 * Returns badge styling and human label for a category
 */
export function getCategoryBadgeStyle(categoryCode) {
  switch (categoryCode) {
    case 'DISPLAY':
      return { label: 'DISPLAY', bg: '#e0f2fe', color: '#0369a1', border: '#bae6fd' };
    case 'BATTERY':
      return { label: 'BATTERY', bg: '#dcfce7', color: '#15803d', border: '#bbf7d0' };
    case 'CAMERA':
      return { label: 'CAMERA', bg: '#fdf2f8', color: '#9d174d', border: '#fbcfe8' };
    case 'BACK_GLASS':
      return { label: 'BACK GLASS', bg: '#f0fdfa', color: '#0f766e', border: '#99f6e4' };
    case 'MID_REAR':
      return { label: 'MID/REAR', bg: '#f5f3ff', color: '#6d28d9', border: '#ddd6fe' };
    default:
      return { label: 'OTHER', bg: '#f1f5f9', color: '#475569', border: '#e2e8f0' };
  }
}
