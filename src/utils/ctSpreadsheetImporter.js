import * as XLSX from 'xlsx';
import { normalizePartNumber, generateCtId } from './consumablesToolsEngine.js';
import { OFFICIAL_BRANCH_DIRECTORY } from '../constants/branchDirectory.js';

const TOOL_KEYWORDS_REGEX =
  /\b(tool|fixture|jig|torque|driver|opener|press|pocket|heater|station|stand|cutter|tray|dock|carrier|bit|wedge|spudger|wrench|plier|suction|clamp|calibration|gauge|probe|roller|mallet|screwdriver|tweezers|handle|adapter|kit,\s*tool|removal\s+tool|sled)\b/i;

const CONSUMABLE_KEYWORDS_REGEX =
  /\b(adhesive|tape|seal|gasket|glue|thermal|paste|pad|wipe|cloth|alcohol|cleaner|screw\s*kit|cowling|film|label|sticker|refill|pack\s*\(\d+\)|consumable|foam|strip|liner|sheet|glove|swab|sand(?:ing)?\s*block)\b/i;

/**
 * Priority 1: Deterministic Apple GSX 10-digit Ship-To ID -> Canonical Branch mapping.
 */
export const APPLE_GSX_SHIP_TO_MAP = {
  '0001597912': { code: 'ASP NES', label: 'ASP NES', name: 'MOBILECARE - NORTHEAST SQUARE' },
  '0001102538': { code: 'ASP NES', label: 'ASP NES', name: 'MOBILECARE - NORTHEAST SQUARE' },
  '0001102535': { code: 'ASP ABR', label: 'ABREEZA', name: 'MOBILECARE - ABREEZA MALL DAVAO' },
  '0001745440': { code: 'APP MEG', label: 'APP MEGAMALL', name: 'MOBILECARE - SM MEGAMALL' },
  '0001764735': { code: 'APP RM', label: 'APP MAGNOLIA', name: 'MOBILECARE - ROBINSONS MAGNOLIA' },
  '0001102537': { code: 'ASP GL5', label: 'GL5', name: 'MOBILECARE - GLORIETTA 5' },
  '0001815649': { code: 'ASP LAU', label: 'LA UNION', name: 'MOBILECARE - ROBINSONS PLACE LA UNION' },
  '0001272226': { code: 'ASP POD', label: 'PODIUM', name: 'MOBILECARE - THE PODIUM' },
  '0001103790': { code: 'ASP SMS', label: "S'MAISON", name: 'MOBILECARE - S MAISON' },
  '0001128342': { code: 'ASP ZAM', label: 'ZAMBOANGA', name: 'MOBILECARE - KCC MALL DE ZAMBOANGA' },
  '0001754212': { code: 'ASP LIM', label: 'LIMA', name: 'MOBILECARE - LIMA ESTATE' },
  '0001764730': { code: 'APP TRI', label: 'APP TRINOMA', name: 'MOBILECARE - APP TRINOMA' },
  '0001645876': { code: 'APP MOA', label: 'APP MOA', name: 'MOBILECARE - APP MALL OF ASIA' },
  '0001836095': { code: 'APP BHS', label: 'APP BHS', name: 'MOBILECARE - APP BONIFACIO HIGH STREET' },
  '0001836102': { code: 'APP AUR', label: 'APP AURA', name: 'MOBILECARE - APP SM AURA' },
  '0001645879': { code: 'APP GB3', label: 'APP GB3', name: 'MOBILECARE - APP GREENBELT 3' },
  '0001603617': { code: 'APP PPM', label: 'APP PPM', name: 'MOBILECARE - APP POWER PLANT MALL' },
  '0001764718': { code: 'APP ANX', label: 'APP ANNEX', name: 'MOBILECARE - APP THE ANNEX' },
  '0001506282': { code: 'ASP VN', label: 'VERTIS NORTH', name: 'MOBILECARE - VERTIS NORTH' },
  '0001815657': { code: 'APP FES', label: 'APP FESTIVAL', name: 'MOBILECARE - APP FESTIVAL MALL' },
  '0001240088': { code: 'ASP MRK', label: 'SM MARIKINA', name: 'MOBILECARE - SM MARIKINA' },
  '0001196666': { code: 'ASP NPM', label: 'NEWPOINT MALL', name: 'MOBILECARE - NEWPOINT MALL' },
  '0001730389': { code: 'ASP NAG', label: 'NAGA', name: 'MOBILECARE - NAGA' },
  '0001229790': { code: 'ASP ILO', label: 'FESTIVE WALK ILOILO', name: 'MOBILECARE - FESTIVE WALK ILOILO' },
  '0001102534': { code: 'ASP CEB', label: 'CEBU', name: 'MOBILECARE - CEBU' },
  '0001218985': { code: 'ASP CDO', label: 'CAGAYAN DE ORO', name: 'MOBILECARE - CAGAYAN DE ORO' },
  '0001836101': { code: 'APP LAN', label: 'APP SM LANANG', name: 'MOBILECARE - APP SM LANANG' }
};

/**
 * Exact pastel fill + high-contrast badge palette per Site Code (shared between UI & Excel export).
 */
export const SITE_COLOR_PALETTE = {
  'ASP NES': { bg: '#E8EEF5', border: '#93B4D8', text: '#1E3A5F', excelFill: 'FFE8EEF5' },
  'APP RM': { bg: '#EFEAF6', border: '#B9A3DC', text: '#4C1D95', excelFill: 'FFEFEAF6' },
  'APP MAGNOLIA': { bg: '#EFEAF6', border: '#B9A3DC', text: '#4C1D95', excelFill: 'FFEFEAF6' },
  'ASP SMS': { bg: '#E6F4EA', border: '#86C99B', text: '#14532D', excelFill: 'FFE6F4EA' },
  "S'MAISON": { bg: '#E6F4EA', border: '#86C99B', text: '#14532D', excelFill: 'FFE6F4EA' },
  'ASP LAU': { bg: '#FEF3E2', border: '#F5C17A', text: '#92400E', excelFill: 'FFFEF3E2' },
  'LA UNION': { bg: '#FEF3E2', border: '#F5C17A', text: '#92400E', excelFill: 'FFFEF3E2' },
  'ASP VN': { bg: '#E5F3FA', border: '#7FC4E8', text: '#0C4A6E', excelFill: 'FFE5F3FA' },
  'VERTIS NORTH': { bg: '#E5F3FA', border: '#7FC4E8', text: '#0C4A6E', excelFill: 'FFE5F3FA' },
  'ASP GL5': { bg: '#FCE8EC', border: '#EA9EB0', text: '#881337', excelFill: 'FFFCE8EC' },
  'GL5': { bg: '#FCE8EC', border: '#EA9EB0', text: '#881337', excelFill: 'FFFCE8EC' },
  'ASP POD': { bg: '#E4F3F1', border: '#7EC8BE', text: '#115E59', excelFill: 'FFE4F3F1' },
  'PODIUM': { bg: '#E4F3F1', border: '#7EC8BE', text: '#115E59', excelFill: 'FFE4F3F1' },
  'ASP ABR': { bg: '#FDECE4', border: '#F2AE8E', text: '#9A3412', excelFill: 'FFFDECE4' },
  'ABREEZA': { bg: '#FDECE4', border: '#F2AE8E', text: '#9A3412', excelFill: 'FFFDECE4' },
  'APP MEG': { bg: '#EAEBFA', border: '#A3A8E6', text: '#312E81', excelFill: 'FFEAEBFA' },
  'APP MEGAMALL': { bg: '#EAEBFA', border: '#A3A8E6', text: '#312E81', excelFill: 'FFEAEBFA' },
  'SM CITY ILOILO': { bg: '#EDF3E6', border: '#A6C886', text: '#365314', excelFill: 'FFEDF3E6' },
  'ASP ILO': { bg: '#FAF4DF', border: '#DFC77B', text: '#713F12', excelFill: 'FFFAF4DF' },
  'FESTIVE WALK ILOILO': { bg: '#FAF4DF', border: '#DFC77B', text: '#713F12', excelFill: 'FFFAF4DF' },
  'ASP ZAM': { bg: '#F4E8F1', border: '#D49FC7', text: '#701A75', excelFill: 'FFF4E8F1' },
  'ZAMBOANGA': { bg: '#F4E8F1', border: '#D49FC7', text: '#701A75', excelFill: 'FFF4E8F1' },
  'ASP LIM': { bg: '#ECFDF5', border: '#6EE7B7', text: '#065F46', excelFill: 'FFECFDF5' },
  'LIMA': { bg: '#ECFDF5', border: '#6EE7B7', text: '#065F46', excelFill: 'FFECFDF5' },
  'APP TRI': { bg: '#EFF6FF', border: '#93C5FD', text: '#1E40AF', excelFill: 'FFEFF6FF' },
  'APP TRINOMA': { bg: '#EFF6FF', border: '#93C5FD', text: '#1E40AF', excelFill: 'FFEFF6FF' },
  'DC-MDC': { bg: '#F1F5F9', border: '#94A3B8', text: '#0F172A', excelFill: 'FFF1F5F9' }
};

const FALLBACK_PASTEL_PALETTE = [
  { bg: '#E0F2FE', border: '#7DD3FC', text: '#0369A1', excelFill: 'FFE0F2FE' },
  { bg: '#DCFCE7', border: '#86EFAC', text: '#166534', excelFill: 'FFDCFCE7' },
  { bg: '#FEF9C3', border: '#FDE047', text: '#854D0E', excelFill: 'FFFEF9C3' },
  { bg: '#F3E8FF', border: '#D8B4FE', text: '#6B21A8', excelFill: 'FFF3E8FF' },
  { bg: '#FFE4E6', border: '#FDA4AF', text: '#9F1239', excelFill: 'FFFFE4E6' },
  { bg: '#CCFBF1', border: '#5EEAD4', text: '#115E59', excelFill: 'FFCCFBF1' }
];

/**
 * Returns a consistent pastel theme + Excel ARGB fill for any Site Code
 * (uses predefined branch colors first, then a deterministic rotating pastel fallback for future sites).
 */
export function getSiteColorTheme(siteCode = '') {
  const key = String(siteCode || '').trim().toUpperCase();
  if (!key) return { bg: '#F8FAFC', border: '#CBD5E1', text: '#475569', excelFill: 'FFF8FAFC' };
  if (SITE_COLOR_PALETTE[key]) return SITE_COLOR_PALETTE[key];
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return FALLBACK_PASTEL_PALETTE[hash % FALLBACK_PASTEL_PALETTE.length];
}

/**
 * Canonical Tool vs. Consumable classifier shared across Importer, UI, and Excel Exporter.
 * Rule: Explicit Type === "Tool (Asset)" / "Tool" OR Part Number starting with "077-".
 */
export function isCanonicalToolKind(partNumber = '', description = '', explicitType = '') {
  const rawType = String(explicitType || '').trim().toLowerCase();
  if (rawType) {
    if (rawType === 'tool' || rawType === 'tool (asset)' || /\btool\b|\basset\b/.test(rawType)) return true;
    if (rawType === 'consumable' || /\bconsumable\b/.test(rawType)) return false;
  }
  const pn = String(partNumber || '').trim().toUpperCase();
  if (/^077-/.test(pn)) return true;
  const text = `${pn} ${description || ''}`;
  if (CONSUMABLE_KEYWORDS_REGEX.test(text) && !/\btool\b/i.test(text)) return false;
  if (TOOL_KEYWORDS_REGEX.test(text)) return true;
  if (/^076-/.test(pn)) return true;
  return false;
}

/**
 * Infers 'tool' or 'consumable' using the canonical classification rule.
 */
export function inferCtItemKind(partNumber, description = '', explicitType = '') {
  return isCanonicalToolKind(partNumber, description, explicitType) ? 'tool' : 'consumable';
}

/**
 * Computes a SHA-256 hex digest of an ArrayBuffer / Uint8Array.
 */
export async function computeFileSha256(input) {
  const bytes =
    input instanceof Uint8Array
      ? input
      : input instanceof ArrayBuffer
        ? new Uint8Array(input)
        : new TextEncoder().encode(String(input || ''));

  if (typeof globalThis !== 'undefined' && globalThis.crypto?.subtle) {
    const hashBuf = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(hashBuf))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  if (typeof process !== 'undefined' && process?.versions?.node) {
    const cryptoMod = 'node:crypto';
    const nodeCrypto = await import(/* @vite-ignore */ cryptoMod);
    return nodeCrypto.createHash('sha256').update(bytes).digest('hex');
  }

  let hash = 2166136261;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 16777619);
  }
  return `fnv-${(hash >>> 0).toString(16).padStart(8, '0')}-${bytes.length}`;
}

/**
 * Parses a comma/semicolon/slash-separated list of Report Reference / Document Numbers.
 */
export function parseReportRefList(raw = '') {
  const list = Array.isArray(raw) ? raw : [raw];
  return Array.from(
    new Set(
      list
        .flatMap(v => String(v || '').split(/[,;\n/|]+/))
        .map(s => s.trim().toUpperCase())
        .filter(s => s.length >= 3)
    )
  );
}

/**
 * Extracts a fallback Report Reference from a CSV/XLSX filename.
 */
export function extractReportRefFromFilename(filename = '') {
  const base = String(filename || '')
    .replace(/\.(?:csv|xlsx|xls)$/i, '')
    .trim();
  if (!base) return '';

  const codeMatch = base.match(/(?:^|[^A-Z0-9])((?:SG|GS|DN|SO|DO|PL|INV)[A-Z0-9-]{5,18})(?=$|[^A-Z0-9])/i);
  if (codeMatch) return codeMatch[1].toUpperCase();

  const afterDash = base.split(/\s*[-–—]\s*/).pop()?.trim();
  if (afterDash && /^[A-Z0-9_-]{4,24}$/i.test(afterDash)) {
    return afterDash.toUpperCase();
  }

  return base.replace(/\s+/g, '_').slice(0, 40).toUpperCase();
}

/**
 * Parses a price string or number (e.g. "$145.50", "USD 24.10", 22) into a clean number >= 0.
 */
export function parseUsdPrice(raw) {
  if (raw === null || raw === undefined || raw === '') return 0;
  if (typeof raw === 'number') return Number.isFinite(raw) && raw >= 0 ? Math.round(raw * 100) / 100 : 0;
  const cleaned = String(raw).replace(/[^0-9.-]/g, '');
  const val = parseFloat(cleaned);
  return Number.isFinite(val) && val >= 0 ? Math.round(val * 100) / 100 : 0;
}

/**
 * Normalizes a spreadsheet date value (Date object, Excel serial, or DD/MM/YYYY / YYYY-MM-DD string) into ISO YYYY-MM-DD.
 */
export function normalizeSpreadsheetDate(raw) {
  if (!raw) return '';
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return raw.toISOString().slice(0, 10);
  }
  if (typeof raw === 'number' && raw > 25000 && raw < 80000) {
    const utcMs = Math.round((raw - 25569) * 86400 * 1000);
    const d = new Date(utcMs);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  const s = String(raw).trim();
  if (!s) return '';

  let m = s.match(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;

  const months = {
    JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
    JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12'
  };
  m = s.match(/\b(\d{1,2})[\s/-]+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[\s,/-]+(20\d{2})\b/i);
  if (m) {
    const mon = months[m[2].toUpperCase().slice(0, 3)];
    if (mon) return `${m[3]}-${mon}-${m[1].padStart(2, '0')}`;
  }
  m = s.match(/\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[\s]+(\d{1,2}),?[\s]+(20\d{2})\b/i);
  if (m) {
    const mon = months[m[1].toUpperCase().slice(0, 3)];
    if (mon) return `${m[3]}-${mon}-${m[2].padStart(2, '0')}`;
  }
  m = s.match(/\b(\d{1,2})[-/](\d{1,2})[-/](20\d{2})\b/);
  if (m) {
    const a = parseInt(m[1], 10);
    const b = parseInt(m[2], 10);
    // Prefer DD/MM/YYYY (Apple South Asia / PH format: 22/10/2026, 12/11/2026, 17/11/2026)
    if (b >= 1 && b <= 12 && a >= 1 && a <= 31) {
      return `${m[3]}-${String(b).padStart(2, '0')}-${String(a).padStart(2, '0')}`;
    }
    if (a >= 1 && a <= 12 && b >= 1 && b <= 31) {
      return `${m[3]}-${String(a).padStart(2, '0')}-${String(b).padStart(2, '0')}`;
    }
  }
  return '';
}

/**
 * Strips apostrophes, dots, extra whitespace, and punctuation for resilient alias matching.
 * E.g. "S'MAISON" -> "S MAISON", "APP. MAGNOLIA" -> "APP MAGNOLIA".
 */
function normalizeBranchText(str = '') {
  return String(str || '')
    .toUpperCase()
    .replace(/['’`.]/g, ' ')
    .replace(/[^A-Z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Strips Sold-To / Bill-To corporate head-office text so 47 Connecticut / Northeast Square
 * never hijacks another branch's Ship-To assignment.
 */
function stripSoldToText(str = '') {
  return String(str || '').replace(
    /\b(?:SOLD\s*TO|BILL\s*TO)\s*[:#-]?\s*[\s\S]*?(?=\bSHIP\s*TO\b|$)/gi,
    ' '
  );
}

/**
 * Explicit alias dictionary for normalized branch strings -> canonical site code.
 */
const EXPLICIT_BRANCH_ALIASES = {
  'ASP NES': 'ASP NES',
  'NORTHEAST SQUARE': 'ASP NES',
  'ABREEZA': 'ASP ABR',
  'ABREEZA MALL': 'ASP ABR',
  'ABREEZA MALL DAVAO': 'ASP ABR',
  'APP MEGAMALL': 'APP MEG',
  'SM MEGAMALL': 'APP MEG',
  'MEGAMALL': 'APP MEG',
  'APP MAGNOLIA': 'APP RM',
  'ROBINSONS MAGNOLIA': 'APP RM',
  'MAGNOLIA': 'APP RM',
  'GL5': 'ASP GL5',
  'GLORIETTA 5': 'ASP GL5',
  'GLORIETTA': 'ASP GL5',
  'LA UNION': 'ASP LAU',
  'ROBINSONS PLACE LA UNION': 'ASP LAU',
  'PODIUM': 'ASP POD',
  'THE PODIUM': 'ASP POD',
  'S MAISON': 'ASP SMS',
  'SMAISON': 'ASP SMS',
  'VERTIS': 'ASP VN',
  'VERTIS NORTH': 'ASP VN',
  'FESTIVE WALK': 'ASP ILO',
  'FESTIVE WALK MALL': 'ASP ILO',
  'FESTIVE WALK ILOILO': 'ASP ILO',
  'SM ILOILO': 'ASP ILO',
  'SM CITY ILOILO': 'ASP ILO',
  'ZAMBOANGA': 'ASP ZAM',
  'KCC MALL DE ZAMBOANGA': 'ASP ZAM',
  'ASP LIM': 'ASP LIM',
  'ASP LIMA': 'ASP LIM',
  'LIMA': 'ASP LIM',
  'LIMA ESTATE': 'ASP LIM',
  'THE OUTLETS AT LIPA': 'ASP LIM',
  'OUTLETS AT LIPA': 'ASP LIM',
  'LIPA': 'ASP LIM',
  'APP TRI': 'APP TRI',
  'APP TRINOMA': 'APP TRI',
  'TRINOMA MALL': 'APP TRI',
  'TRINOMA': 'APP TRI',
  'APP MOA': 'APP MOA',
  'SM MALL OF ASIA': 'APP MOA',
  'MALL OF ASIA': 'APP MOA',
  'MOA': 'APP MOA',
  'APP BHS': 'APP BHS',
  'BONIFACIO HIGH STREET': 'APP BHS',
  'BHS': 'APP BHS',
  'APP AUR': 'APP AUR',
  'APP-AUR': 'APP AUR',
  'SM AURA PREMIER': 'APP AUR',
  'SM AURA': 'APP AUR',
  'AURA': 'APP AUR',
  'APP GB3': 'APP GB3',
  'GREENBELT 3': 'APP GB3',
  'GREENBELT': 'APP GB3',
  'GB3': 'APP GB3',
  'APP PPM': 'APP PPM',
  'POWER PLANT MALL': 'APP PPM',
  'POWER PLANT': 'APP PPM',
  'ROCKWELL': 'APP PPM',
  'PPM': 'APP PPM',
  'APP ANX': 'APP ANX',
  'THE ANNEX': 'APP ANX',
  'ANNEX': 'APP ANX',
  'SM NORTH EDSA': 'APP ANX',
  'SM CITY NORTH EDSA': 'APP ANX',
  'SMCITY NORTH EDSA': 'APP ANX',
  'APP FES': 'APP FES',
  'FESTIVAL MALL': 'APP FES',
  'FESTIVAL': 'APP FES',
  'ASP MRK': 'ASP MRK',
  'SM CITY MARIKINA': 'ASP MRK',
  'SM MARIKINA': 'ASP MRK',
  'MARIKINA': 'ASP MRK',
  'ASP NPM': 'ASP NPM',
  'NEWPOINT MALL': 'ASP NPM',
  'NEWPOINT': 'ASP NPM',
  'NEPO CENTER': 'ASP NPM',
  'ASP NAG': 'ASP NAG',
  'NAGA': 'ASP NAG',
  'ASP CEB': 'ASP CEB',
  'ROBINSONS GALLERIA CEBU': 'ASP CEB',
  'CEBU': 'ASP CEB',
  'ASP COT': 'ASP COT',
  'KCC MALL OF COTABATO': 'ASP COT',
  'COTABATO': 'ASP COT',
  'ASP CDO': 'ASP CDO',
  'CAGAYAN DE ORO': 'ASP CDO',
  'LIMKETKAI MALL': 'ASP CDO',
  'LIMKETKAI': 'ASP CDO',
  'APP LAN': 'APP LAN',
  'SM LANANG': 'APP LAN',
  'LANANG': 'APP LAN'
};

function getSiteMatchTerms(siteCode, siteName = '') {
  const code = String(siteCode || '').trim().toUpperCase();
  const dirEntry = OFFICIAL_BRANCH_DIRECTORY[code] || null;
  const fullName = normalizeBranchText(siteName || dirEntry?.name || '');

  const parts = fullName.split(/\s*[-–—]\s*/);
  const rawBranch = parts.length > 1 ? parts[parts.length - 1].trim() : fullName;
  const strippedBranch = rawBranch.replace(/^(?:APP|ASP)\s+/i, '').trim();
  const noPrefix = strippedBranch.replace(/^(?:SM|THE|ROBINSONS|KCC\s+MALL\s+DE)\s+/i, '').trim();

  const terms = new Set();
  const codeSuffix = code.replace(/^(?:APP|ASP)[\s-]+/i, '').trim();
  if (codeSuffix.length >= 2) terms.add(codeSuffix);
  if (rawBranch.length >= 4) terms.add(rawBranch);
  if (strippedBranch.length >= 4) terms.add(strippedBranch);
  if (noPrefix.length >= 4) terms.add(noPrefix);

  const dirAddr = normalizeBranchText(dirEntry?.address || '');
  for (const landmark of [
    'ABREEZA', 'ILOILO', 'MAGNOLIA', 'MEGAMALL', 'GLORIETTA', 'PODIUM', 'VERTIS',
    'ZAMBOANGA', 'LA UNION', 'MAISON', 'LIMA', 'LIPA', 'TRINOMA', 'MOA', 'AURA',
    'GREENBELT', 'ROCKWELL', 'ANNEX', 'FESTIVAL', 'MARIKINA', 'NEWPOINT', 'NAGA',
    'CEBU', 'COTABATO', 'LANANG'
  ]) {
    if (dirAddr.includes(landmark) || fullName.includes(landmark)) {
      terms.add(landmark);
    }
  }

  return {
    code,
    shipToId: dirEntry?.ship_to ? String(dirEntry.ship_to).replace(/^0+/, '') : '',
    fullShipToId: dirEntry?.ship_to ? String(dirEntry.ship_to) : '',
    terms: Array.from(terms).sort((a, b) => b.length - a.length)
  };
}

/**
 * Resolves a canonical Site Code using the strict 4-tier priority order:
 *  Priority 1: Apple GSX 10-digit Ship-To ID / Customer No
 *  Priority 2: Explicit Row Columns (Site Code, Receiving Site, Branch, Ship To, Location) — ignoring Sold To
 *  Priority 3: Excel Worksheet Tab Name
 *  Priority 4: Uploaded Filename
 * Dynamically preserves any additional/future system site code found in the data.
 */
export function resolveSiteCodeFromValue(
  rawValue = '',
  sites = [],
  filename = '',
  { shipToId = '', sheetName = '', rawSiteCode = '', rawReceivingSite = '' } = {}
) {
  const knownCodes = new Set(
    (sites || []).map(s => String(s.site_code || s.code || '').trim().toUpperCase()).filter(Boolean)
  );

  // Helper to resolve a Ship-To ID via Priority 1 map + directory
  const resolveByShipToId = (val) => {
    const digits = String(val || '').replace(/\D/g, '');
    if (digits.length < 6) return '';
    const padded = digits.padStart(10, '0');
    if (APPLE_GSX_SHIP_TO_MAP[padded]) {
      const mapped = APPLE_GSX_SHIP_TO_MAP[padded].code;
      return mapped;
    }
    for (const [code, dir] of Object.entries(OFFICIAL_BRANCH_DIRECTORY)) {
      if (dir?.ship_to && (dir.ship_to === padded || dir.ship_to.replace(/^0+/, '') === digits.replace(/^0+/, ''))) {
        return code;
      }
    }
    return '';
  };

  // Priority 1: Explicit Ship-To ID column (most deterministic)
  if (shipToId) {
    const byId = resolveByShipToId(shipToId);
    if (byId) return byId;
  }

  const matchInText = (haystack) => {
    const cleaned = stripSoldToText(haystack);
    const norm = normalizeBranchText(cleaned);
    const compact = norm.replace(/\s+/g, '');
    if (!norm) return '';
    if (/\bDC-MDC\b|\bDISTRIBUTION CENTER\b/.test(norm)) return 'DC-MDC';

    // Check embedded 10-digit Ship-To ID in text
    const idMatch = cleaned.match(/\b(000\d{7})\b/);
    if (idMatch) {
      const byId = resolveByShipToId(idMatch[1]);
      if (byId) return byId;
    }

    // Check explicit normalized aliases (longest first so "SM CITY ILOILO" & "FESTIVE WALK ILOILO" match cleanly)
    const aliasKeys = Object.keys(EXPLICIT_BRANCH_ALIASES).sort((a, b) => b.length - a.length);
    for (const alias of aliasKeys) {
      const aliasNorm = normalizeBranchText(alias);
      if (norm === aliasNorm || compact === aliasNorm.replace(/\s+/g, '')) {
        return EXPLICIT_BRANCH_ALIASES[alias];
      }
      const escaped = aliasNorm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
      if (new RegExp(`(?:^|[^A-Z0-9])${escaped}(?=$|[^A-Z0-9])`).test(norm)) {
        return EXPLICIT_BRANCH_ALIASES[alias];
      }
    }

    const candidates = (sites || [])
      .map(s => getSiteMatchTerms(s.site_code || s.code, s.site_name || s.name))
      .filter(c => c.code && c.code !== 'DC-MDC');

    // Exact site code match against system sites
    for (const c of candidates) {
      const cNorm = normalizeBranchText(c.code);
      if (norm === cNorm) return c.code;
      const escaped = cNorm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '[\\s_-]+');
      if (new RegExp(`(?:^|[^A-Z0-9])${escaped}(?=$|[^A-Z0-9])`).test(norm)) {
        return c.code;
      }
    }

    // Branch name keyword match
    const scored = [];
    for (const c of candidates) {
      for (const term of c.terms) {
        const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '[\\s_.-]+');
        if (new RegExp(`(?:^|[^A-Z0-9])${escaped}(?=$|[^A-Z0-9])`).test(norm)) {
          scored.push({ code: c.code, len: term.length });
          break;
        }
      }
    }
    if (scored.length > 0) {
      scored.sort((a, b) => b.len - a.len);
      return scored[0].code;
    }

    return '';
  };

  // Priority 2: Explicit row columns (Site Code first, then Receiving Site, then combined rawValue)
  if (rawSiteCode) {
    const hit = matchInText(rawSiteCode);
    if (hit) return hit;
  }
  if (rawReceivingSite) {
    const hit = matchInText(rawReceivingSite);
    if (hit) return hit;
  }
  if (rawValue) {
    const hit = matchInText(rawValue);
    if (hit) return hit;
  }

  // Dynamic acceptance for any additional/future system site code present in the CSV/XLSX
  const dynamicCode = String(rawSiteCode || '').trim().toUpperCase();
  if (dynamicCode && knownCodes.has(dynamicCode)) {
    return dynamicCode;
  }

  // Guard: If the row explicitly provided a Site Code or Receiving Site that could not be mapped,
  // do NOT fall back to Sheet Name or Filename (prevents multi-site files like LIMA_AND_APP_TRINOMA
  // from silently misassigning an unmapped branch to another branch named in the filename).
  const hasExplicitRowSite = Boolean(
    String(rawSiteCode || '').trim() ||
    String(rawReceivingSite || '').trim() ||
    String(rawValue || '').trim()
  );
  if (hasExplicitRowSite) {
    return '';
  }

  // Priority 3: Excel Worksheet Tab Name
  if (sheetName) {
    const sheetHit = matchInText(sheetName);
    if (sheetHit) return sheetHit;
  }

  // Priority 4: Uploaded Filename (only when unambiguous — i.e., mentions a single site)
  if (filename) {
    const cleanFile = String(filename)
      .replace(/\.(?:csv|xlsx|xls)$/i, '')
      .replace(/[_.-]+/g, ' ')
      .trim();
    const normFile = normalizeBranchText(cleanFile);
    const fileSites = new Set();
    for (const alias of Object.keys(EXPLICIT_BRANCH_ALIASES)) {
      const aliasNorm = normalizeBranchText(alias);
      const escaped = aliasNorm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
      if (new RegExp(`(?:^|[^A-Z0-9])${escaped}(?=$|[^A-Z0-9])`).test(normFile)) {
        fileSites.add(EXPLICIT_BRANCH_ALIASES[alias]);
      }
    }
    if (fileSites.size === 1) {
      return Array.from(fileSites)[0];
    }
    if (fileSites.size > 1) {
      return '';
    }
    const fileHit = matchInText(cleanFile);
    if (fileHit) return fileHit;
  }

  return '';
}

function normHeader(h = '') {
  return String(h || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

const HEADER_ALIASES = {
  part_number: ['part_number', 'part_no', 'part_num', 'part', 'pn', 'sku', 'item_code', 'apple_part_number', 'apple_pn', 'material'],
  description: ['description', 'item_description', 'part_description', 'desc', 'item_name', 'name', 'product_description'],
  item_kind: ['type', 'item_kind', 'kind', 'item_type', 'category', 'tool_or_consumable', 'classification'],
  quantity: ['qty', 'quantity', 'delivered_qty', 'delivered_quantity', 'received_qty', 'shipped_qty', 'qty_received', 'qty_shipped', 'count', 'units'],
  unit_cost: ['usd_price', 'unit_price', 'unit_price_usd', 'price_usd', 'price', 'unit_cost', 'unit_cost_usd', 'cost', 'stocking_price', 'usd'],
  line_total_usd: ['line_total_usd', 'line_total', 'extended_price', 'extended_price_usd', 'total_usd', 'subtotal_usd'],
  site_code: ['site_code', 'site', 'branch_code'],
  receiving_site: ['receiving_site', 'branch', 'branch_name', 'location', 'ship_to', 'ship_to_site', 'destination'],
  ship_to_id: ['ship_to_id', 'shipto_id', 'ship_to_no', 'apple_ship_to', 'customer_no'],
  report_ref: ['report_ref_doc', 'report_ref_doc_no', 'report_ref', 'report_reference', 'document_number', 'document_no', 'doc_no', 'doc_number', 'doc_ref', 'reference_no', 'reference_number', 'reference', 'invoice_no', 'invoice_number', 'shipment_no'],
  hawb_number: ['hawb', 'hawb_no', 'hawb_number', 'waybill', 'waybill_no'],
  delivery_number: ['delivery', 'delivery_no', 'delivery_number'],
  box_number: ['box', 'box_no', 'box_number', 'carton'],
  po_number: ['linked_po', 'linked_po_no', 'po_number', 'po_no', 'po', 'customer_po', 'customer_po_no', 'purchase_order'],
  document_date: ['document_date', 'date', 'delivery_date', 'ship_date', 'receipt_date', 'invoice_date', 'order_date'],
  supplier: ['supplier', 'vendor', 'from', 'sender'],
  serial_numbers: ['serial_s', 'serial_no_s', 'serial_number', 'serial_numbers', 'serial', 'serials', 's_n', 'sn', 'asset_serial'],
  notes: ['notes', 'remarks', 'comments', 'note']
};

function resolveCellValue(rowObj, fieldKey) {
  const aliases = HEADER_ALIASES[fieldKey] || [fieldKey];
  for (const key of Object.keys(rowObj || {})) {
    const nk = normHeader(key);
    if (aliases.includes(nk)) {
      const val = rowObj[key];
      if (val !== undefined && val !== null && String(val).trim() !== '') {
        return val;
      }
    }
  }
  return '';
}

/**
 * Parses structured CSV / XLSX row objects into a previewable, editable Consumables & Tools import draft.
 * Includes:
 *  - 4-tier per-row site detection (Ship-To ID -> Row Columns -> Sheet Tab -> Filename)
 *  - Composite-key Duplicate Shipment Guard (HAWB+Delivery+PN or Ref+Delivery+PN)
 *  - Line Total USD Pricing Validation (Qty * USD Price !== Line Total USD)
 *  - Missing Invoice Ref (Packing List Only) amber warning detection
 *  - Missing Page Detector for partial multi-page scans (e.g. "Page 1 of 3")
 */
export function parseSpreadsheetRows(rows = [], { filename = '', sheetName = '', catalogItems = [], sites = [] } = {}) {
  const catalogByPn = new Map();
  (catalogItems || []).forEach(c => {
    const pn = normalizePartNumber(c.part_number);
    if (pn) catalogByPn.set(pn, c);
  });

  const collectedRefs = [];
  const detectedSiteSet = new Set();
  const seenShipmentKeys = new Set();
  const duplicateSkippedDetails = [];
  let poNumber = '';
  let documentDate = '';
  let supplier = 'Apple South Asia Pte Ltd';
  let lastSeenSite = '';
  const items = [];

  for (let rowIdx = 0; rowIdx < (rows || []).length; rowIdx++) {
    const rawRow = rows[rowIdx];
    if (!rawRow || typeof rawRow !== 'object') continue;

    const rawPn = String(resolveCellValue(rawRow, 'part_number') || '').trim();
    const rawDesc = String(resolveCellValue(rawRow, 'description') || '').trim();
    const rawType = String(resolveCellValue(rawRow, 'item_kind') || '').trim();
    const rawQty = resolveCellValue(rawRow, 'quantity');
    const rawPrice = resolveCellValue(rawRow, 'unit_cost');
    const rawLineTotal = resolveCellValue(rawRow, 'line_total_usd');
    const rawSiteCode = String(resolveCellValue(rawRow, 'site_code') || '').trim();
    const rawReceivingSite = String(resolveCellValue(rawRow, 'receiving_site') || '').trim();
    const rawShipToId = String(resolveCellValue(rawRow, 'ship_to_id') || '').trim();
    const rawRef = String(resolveCellValue(rawRow, 'report_ref') || '').trim();
    const rawHawb = String(resolveCellValue(rawRow, 'hawb_number') || '').trim();
    const rawDelivery = String(resolveCellValue(rawRow, 'delivery_number') || '').trim();
    const rawBox = String(resolveCellValue(rawRow, 'box_number') || '').trim();
    const rawPo = String(resolveCellValue(rawRow, 'po_number') || '').trim();
    const rawDate = resolveCellValue(rawRow, 'document_date');
    const rawSupplier = String(resolveCellValue(rawRow, 'supplier') || '').trim();
    const rawSerials = String(resolveCellValue(rawRow, 'serial_numbers') || '').trim();
    const rawNotes = String(resolveCellValue(rawRow, 'notes') || '').trim();

    if (!rawPn && !rawDesc) continue;

    const cleanPn = normalizePartNumber(rawPn);

    // Duplicate Shipment Guard: composite key (HAWB + Delivery + PN) or (Ref + Delivery + PN)
    if (cleanPn && rawDelivery) {
      const compositeKey = rawHawb
        ? `HAWB::${rawHawb.toUpperCase()}::${rawDelivery.toUpperCase()}::${cleanPn}`
        : rawRef
          ? `REF::${rawRef.toUpperCase()}::${rawDelivery.toUpperCase()}::${cleanPn}`
          : '';
      if (compositeKey && seenShipmentKeys.has(compositeKey)) {
        duplicateSkippedDetails.push({
          rowNumber: rowIdx + 2,
          partNumber: cleanPn,
          hawb: rawHawb,
          delivery: rawDelivery,
          reportRef: rawRef
        });
        continue;
      }
      if (compositeKey) seenShipmentKeys.add(compositeKey);
    }

    // Track explicit Invoice / Report Ref vs Packing-List-only rows
    const missingInvoiceRef = !rawRef;
    const effectiveRawRef = rawRef || (rawHawb ? `HAWB-${rawHawb}` : rawDelivery);
    const rowRefs = effectiveRawRef ? parseReportRefList(effectiveRawRef) : [];
    if (rawRef) {
      parseReportRefList(rawRef).forEach(r => {
        if (!collectedRefs.includes(r)) collectedRefs.push(r);
      });
    } else if (rawHawb) {
      const hawbRef = `HAWB-${rawHawb.toUpperCase()}`;
      if (!collectedRefs.includes(hawbRef)) collectedRefs.push(hawbRef);
    }

    // 4-tier priority site resolution (Ship-To ID -> Explicit Row Columns -> Sheet Tab -> Filename)
    let resolvedRowSite = resolveSiteCodeFromValue('', sites, filename, {
      shipToId: rawShipToId,
      rawSiteCode,
      rawReceivingSite,
      sheetName: rawRow.__sheetName || sheetName
    });
    if (!resolvedRowSite && !rawSiteCode && !rawReceivingSite && !rawShipToId && lastSeenSite) {
      resolvedRowSite = lastSeenSite;
    }
    if (resolvedRowSite) {
      lastSeenSite = resolvedRowSite;
      detectedSiteSet.add(resolvedRowSite);
    }

    if (!poNumber && rawPo) poNumber = rawPo.toUpperCase();
    const rowDate = normalizeSpreadsheetDate(rawDate);
    if (!documentDate && rowDate) documentDate = rowDate;
    if (rawSupplier && supplier === 'Apple South Asia Pte Ltd') supplier = rawSupplier;

    const catalogMatch = cleanPn ? catalogByPn.get(cleanPn) || null : null;

    // 100% source of truth from uploaded CSV/XLSX
    const description = rawDesc;
    const itemKind = inferCtItemKind(cleanPn, description, rawType);
    const parsedQty = parseInt(String(rawQty ?? '').replace(/[^0-9-]/g, ''), 10);
    const quantity = Number.isInteger(parsedQty) && parsedQty >= 1 ? parsedQty : 1;
    const unitCost = parseUsdPrice(rawPrice);
    const hasLineTotal = rawLineTotal !== '' && rawLineTotal !== null && rawLineTotal !== undefined;
    const lineTotalUsd = hasLineTotal ? parseUsdPrice(rawLineTotal) : Math.round(quantity * unitCost * 100) / 100;
    const expectedLineTotal = Math.round(quantity * unitCost * 100) / 100;
    const priceMismatch = hasLineTotal && Math.abs(expectedLineTotal - lineTotalUsd) > 0.02;

    const serialNumbers = rawSerials
      ? rawSerials
          .split(/[,;\n]+/)
          .map(s => s.trim().toUpperCase())
          .filter(Boolean)
      : [];

    const needsReview = !cleanPn || !description || !resolvedRowSite || missingInvoiceRef || priceMismatch;
    let reviewNote = null;
    if (!resolvedRowSite) {
      reviewNote = rawSiteCode || rawReceivingSite
        ? `Unmapped site "${rawSiteCode || rawReceivingSite}" — select Receiving Site`
        : 'Unmapped site — select Receiving Site';
    } else if (priceMismatch) {
      reviewNote = `Price mismatch: ${quantity} × $${unitCost.toFixed(2)} = $${expectedLineTotal.toFixed(2)} (file shows $${lineTotalUsd.toFixed(2)})`;
    } else if (missingInvoiceRef) {
      reviewNote = 'Missing Invoice Ref (Packing List Only)';
    } else if (!catalogMatch) {
      reviewNote = 'New SKU — will be added to Parts Catalog on save';
    }

    items.push({
      id: generateCtId('ct-xls-row'),
      selected: true,
      part_number: cleanPn,
      description,
      item_kind: itemKind,
      quantity,
      unit_cost: unitCost,
      line_total_usd: lineTotalUsd,
      price_mismatch: priceMismatch,
      missing_invoice_ref: missingInvoiceRef,
      site_code: resolvedRowSite,
      raw_site_label: rawSiteCode || rawReceivingSite || '',
      ship_to_id: rawShipToId,
      report_ref: rawRef ? parseReportRefList(rawRef).join(', ') : '',
      effective_ref: rowRefs.join(', '),
      hawb_number: rawHawb,
      delivery_number: rawDelivery,
      box_number: rawBox,
      po_number: rawPo,
      document_date: rowDate || '',
      serial_numbers: serialNumbers,
      notes: rawNotes,
      catalog_matched: Boolean(catalogMatch),
      needs_review: needsReview,
      review_note: reviewNote
    });
  }

  // Missing Page Detector for Multi-Page Packing Lists (e.g. "Page 1 of 3" with < 21 items)
  const partialScanAlerts = [];
  const shipmentGroups = new Map();
  items.forEach(it => {
    const key = `${it.site_code || 'UNMAPPED'}::${it.hawb_number || it.effective_ref || 'DEFAULT'}`;
    if (!shipmentGroups.has(key)) {
      shipmentGroups.set(key, {
        siteCode: it.site_code || 'UNMAPPED',
        hawb: it.hawb_number || it.effective_ref || '',
        count: 0,
        partialNote: ''
      });
    }
    const g = shipmentGroups.get(key);
    g.count += 1;
    if (!g.partialNote && /page\s*1\s*of\s*[2-9]|pages?\s*2|partial\s*scan/i.test(it.notes || '')) {
      g.partialNote = it.notes;
    }
  });
  for (const g of shipmentGroups.values()) {
    if (g.partialNote && g.count < 21) {
      partialScanAlerts.push({
        siteCode: g.siteCode,
        hawb: g.hawb,
        itemCount: g.count,
        message: `${g.siteCode}${g.hawb ? ` (HAWB ${g.hawb})` : ''}: Partial scan detected (${g.count} items) — check remaining pages before closing shipment.`
      });
    }
  }

  const detectedSites = Array.from(detectedSiteSet);
  const detectedSiteCode = detectedSites.length === 1 ? detectedSites[0] : (detectedSites[0] || '');
  const isMultiSite = detectedSites.length > 1;

  const reportRefs =
    collectedRefs.length > 0
      ? collectedRefs
      : extractReportRefFromFilename(filename)
        ? [extractReportRefFromFilename(filename)]
        : [];

  return {
    reportRef: reportRefs.join(', '),
    reportRefs,
    poNumber,
    documentDate: documentDate || new Date().toISOString().slice(0, 10),
    supplier,
    detectedSiteCode,
    detectedSites,
    isMultiSite,
    duplicateRowsSkipped: duplicateSkippedDetails.length,
    duplicateSkippedDetails,
    partialScanAlerts,
    items,
    rowCount: items.length
  };
}

/**
 * Reads a CSV or Excel (.xlsx / .xls) File in the browser, computes SHA-256 fingerprint,
 * and parses all rows into a structured draft.
 */
export async function parseSpreadsheetFile(file, { catalogItems = [], sites = [] } = {}) {
  if (!file) throw new Error('No CSV or Excel file provided.');
  const filename = file.name || 'Apple_CT_Import.xlsx';
  const fileSize = file.size || 0;
  const arrayBuffer = await file.arrayBuffer();
  const fileBytes = new Uint8Array(arrayBuffer);
  const fileHash = await computeFileSha256(fileBytes);

  const workbook = XLSX.read(fileBytes, { type: 'array', cellDates: true });
  const sheetNames = workbook.SheetNames || [];
  if (sheetNames.length === 0) {
    throw new Error('The uploaded spreadsheet contains no worksheets.');
  }

  const allRows = [];
  for (const name of sheetNames) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    if (Array.isArray(rows) && rows.length > 0) {
      rows.forEach(r => allRows.push({ ...r, __sheetName: name }));
    }
  }

  const parsed = parseSpreadsheetRows(allRows, {
    filename,
    sheetName: sheetNames.length === 1 ? sheetNames[0] : '',
    catalogItems,
    sites
  });

  return {
    fileHash,
    filename,
    fileSize,
    sheetCount: sheetNames.length,
    extractionMethod: filename.toLowerCase().endsWith('.csv') ? 'csv' : 'xlsx',
    fileBytes,
    parsed
  };
}

/**
 * Checks whether a CSV/XLSX report has already been imported.
 */
export function detectDuplicateSpreadsheetImport({
  fileHash = '',
  filename = '',
  reportRef = '',
  existingImports = []
} = {}) {
  const activeImports = (existingImports || []).filter(
    imp => imp && imp.status !== 'failed' && imp.status !== 'duplicate_blocked'
  );

  const cleanHash = String(fileHash || '').trim().toLowerCase();
  const cleanName = String(filename || '').trim().toLowerCase();

  if (cleanHash) {
    const hashHit = activeImports.find(
      imp => String(imp.file_hash || '').trim().toLowerCase() === cleanHash
    );
    if (hashHit) {
      return {
        isDuplicate: true,
        severity: 'exact',
        matchType: 'file_hash',
        existingImport: hashHit,
        message: `Exact duplicate file detected! This file was already imported on ${new Date(hashHit.imported_at).toLocaleString()} by ${hashHit.imported_by_name} (Ref: ${hashHit.report_ref || hashHit.filename}).`
      };
    }
  }

  const incomingRefs = parseReportRefList(reportRef);
  if (incomingRefs.length > 0) {
    for (const imp of activeImports) {
      const existingRefs = parseReportRefList(
        Array.isArray(imp.report_refs) && imp.report_refs.length > 0 ? imp.report_refs : imp.report_ref
      );
      const overlappingRef = incomingRefs.find(r => existingRefs.includes(r));
      if (overlappingRef) {
        return {
          isDuplicate: true,
          severity: 'exact',
          matchType: 'report_ref',
          existingImport: imp,
          message: `Report Reference "${overlappingRef}" was already imported on ${new Date(imp.imported_at).toLocaleString()} by ${imp.imported_by_name} (${imp.filename}).`
        };
      }
    }
  }

  if (cleanName) {
    const nameHit = activeImports.find(
      imp => String(imp.filename || '').trim().toLowerCase() === cleanName
    );
    if (nameHit) {
      return {
        isDuplicate: true,
        severity: 'warning',
        matchType: 'filename',
        existingImport: nameHit,
        message: `A report with filename "${filename}" was previously imported on ${new Date(nameHit.imported_at).toLocaleString()} by ${nameHit.imported_by_name}.`
      };
    }
  }

  return {
    isDuplicate: false,
    severity: 'none',
    matchType: null,
    existingImport: null,
    message: null
  };
}

/**
 * Checks every draft in a multi-file upload batch against both historical imports and earlier drafts.
 */
export function detectBatchDuplicateSpreadsheetImports(drafts = [], existingImports = []) {
  const results = {};
  const seenInBatch = [];

  for (const draft of drafts || []) {
    if (!draft) continue;
    const histCheck = detectDuplicateSpreadsheetImport({
      fileHash: draft.fileHash,
      filename: draft.filename,
      reportRef: draft.reportRef,
      existingImports
    });
    if (histCheck.isDuplicate) {
      results[draft.id] = histCheck;
      continue;
    }

    const batchCheck = detectDuplicateSpreadsheetImport({
      fileHash: draft.fileHash,
      filename: draft.filename,
      reportRef: draft.reportRef,
      existingImports: seenInBatch
    });
    if (batchCheck.isDuplicate) {
      results[draft.id] = {
        ...batchCheck,
        matchType: `batch_${batchCheck.matchType}`,
        message: `Duplicate within this upload batch! Matches earlier queued file "${batchCheck.existingImport?.filename || batchCheck.existingImport?.report_ref}".`
      };
      continue;
    }

    results[draft.id] = histCheck;
    seenInBatch.push({
      id: draft.id,
      filename: draft.filename,
      file_hash: draft.fileHash,
      report_ref: draft.reportRef,
      report_refs: parseReportRefList(draft.reportRef),
      status: 'completed',
      imported_by_name: 'Current Batch',
      imported_at: new Date().toISOString()
    });
  }

  return results;
}

/**
 * Validates all required document-level, pricing, and line-item fields before committing an import.
 */
export function validateSpreadsheetImportDraft({
  reportRef = '',
  siteCode = '',
  documentDate = '',
  items = [],
  duplicateCheck = null,
  existingToolAssets = [],
  allowDuplicateOverride = false
} = {}) {
  const documentErrors = [];
  const rowErrors = {};

  const cleanRef = String(reportRef || '').trim();
  const cleanSite = String(siteCode || '').trim();

  if (!cleanRef) {
    documentErrors.push('Report Reference / Document # is required (e.g. SG02860688).');
  }
  const selectedItems = (items || []).filter(it => it && it.selected !== false);
  const allSelectedHaveRowSite =
    selectedItems.length > 0 && selectedItems.every(it => Boolean(String(it.site_code || '').trim()));
  if (!cleanSite && !allSelectedHaveRowSite) {
    documentErrors.push('Receiving Site is required (set a default site or assign a site to each row).');
  }
  if (documentDate && !/^\d{4}-\d{2}-\d{2}$/.test(String(documentDate).trim())) {
    documentErrors.push('Document Date must be in YYYY-MM-DD format.');
  }

  if (duplicateCheck?.isDuplicate && !allowDuplicateOverride) {
    documentErrors.push(
      duplicateCheck.message || 'Duplicate report detected. Cannot import the same report twice.'
    );
  }

  if (selectedItems.length === 0) {
    documentErrors.push('At least one valid tool or consumable line item must be selected.');
  }

  const existingSerialSet = new Set(
    (existingToolAssets || [])
      .map(a => String(a.serial_number || '').trim().toUpperCase())
      .filter(Boolean)
  );
  const batchSerialSet = new Set();

  let toolCount = 0;
  let consumableQty = 0;

  selectedItems.forEach(item => {
    const errs = [];
    const pn = normalizePartNumber(item.part_number);
    const desc = String(item.description || '').trim();
    const rowSite = String(item.site_code || cleanSite || '').trim();
    const qty = Number(item.quantity);
    const price = Number(item.unit_cost ?? 0);
    const kind = item.item_kind;

    if (!pn) errs.push('Part Number is required.');
    if (!desc) errs.push('Description is required.');
    if (!rowSite) errs.push('Unmapped Site — select a Receiving Site.');
    if (kind !== 'tool' && kind !== 'consumable') errs.push('Type must be Tool or Consumable.');
    if (!Number.isInteger(qty) || qty < 1) errs.push('Quantity must be a whole number >= 1.');
    if (!Number.isFinite(price) || price < 0) errs.push('USD Price must be a valid non-negative number.');
    if (item.price_mismatch) {
      errs.push(`Line Total mismatch (Qty × USD Price ≠ $${Number(item.line_total_usd || 0).toFixed(2)}).`);
    }

    const serials = Array.isArray(item.serial_numbers)
      ? item.serial_numbers.map(s => String(s || '').trim().toUpperCase()).filter(Boolean)
      : String(item.serial_numbers || '')
          .split(/[\n,;]+/)
          .map(s => s.trim().toUpperCase())
          .filter(Boolean);

    if (serials.length > 0 && Number.isInteger(qty) && serials.length > qty) {
      errs.push(`Entered ${serials.length} serials for Qty ${qty}.`);
    }

    for (const sn of serials) {
      if (existingSerialSet.has(sn)) {
        errs.push(`Serial "${sn}" already exists in tracked tool assets.`);
      } else if (batchSerialSet.has(sn)) {
        errs.push(`Duplicate serial "${sn}" within this import.`);
      } else {
        batchSerialSet.add(sn);
      }
    }

    if (errs.length > 0) rowErrors[item.id] = errs;

    if (Number.isInteger(qty) && qty >= 1) {
      if (kind === 'tool') toolCount += qty;
      else consumableQty += qty;
    }
  });

  return {
    valid: documentErrors.length === 0 && Object.keys(rowErrors).length === 0,
    documentErrors,
    rowErrors,
    selectedCount: selectedItems.length,
    toolCount,
    consumableQty
  };
}

/**
 * Generates and downloads a structured Excel (.xlsx) template matching the 18-column MobileCare schema.
 */
export function downloadCtImportTemplateXlsx() {
  const sampleRows = [
    {
      'Receiving Site': 'APP MAGNOLIA — MOBILECARE - ROBINSONS MAGNOLIA',
      'Site Code': 'APP MAGNOLIA',
      'Ship-To ID': '0001764735',
      'Report Ref / Doc #': 'SG02857760',
      'HAWB #': '3022928694',
      'Delivery #': 'QBV2358992',
      'Box #': 'S102291619',
      'Document Date': '12/11/2026',
      'Linked PO #': 'V68 CVL0 Kit',
      'Supplier': 'Apple South Asia Pte Ltd',
      'Part Number': '077-01158',
      'Description': 'SVC, IPHONE DUO, KIT, CVLO FIXTURE',
      'Type': 'Tool (Asset)',
      'Qty': 1,
      'USD Price': 490.0,
      'Line Total USD': 490.0,
      'Serial #(s)': '',
      'Notes': ''
    },
    {
      'Receiving Site': 'APP MAGNOLIA — MOBILECARE - ROBINSONS MAGNOLIA',
      'Site Code': 'APP MAGNOLIA',
      'Ship-To ID': '0001764735',
      'Report Ref / Doc #': 'SG02858846',
      'HAWB #': '3022931542',
      'Delivery #': 'QBV2815763',
      'Box #': 'S102307444',
      'Document Date': '13/11/2026',
      'Linked PO #': 'V68_Non Pilot',
      'Supplier': 'Apple South Asia Pte Ltd',
      'Part Number': '923-15257',
      'Description': 'SVC, IPHONE DUO, ADHESIVE, BTH, 30PK',
      'Type': 'Consumable',
      'Qty': 1,
      'USD Price': 24.3,
      'Line Total USD': 24.3,
      'Serial #(s)': '',
      'Notes': ''
    }
  ];

  const ws = XLSX.utils.json_to_sheet(sampleRows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Tools_Consumables_Import');
  XLSX.writeFile(wb, 'MOBILECARE_CT_IMPORT_TEMPLATE.xlsx');
}
