/**
 * Intelligent Apple Part Number, Serial Number Validator & Barcode Security System
 */
import { defaultPartsCatalog } from '../data/defaultCatalog.js';

/**
 * Validates if a given string is a legitimate Apple Serial Number
 * @param {string} rawSerial - The serial number string to validate
 * @param {string} currentPn - The currently selected or scanned Part Number (to check for duplicates)
 * @param {Array} partsCatalog - Catalog of parts to verify the serial is not actually a part name/number
 * @returns {{ isValid: boolean, error?: string, cleanSerial?: string, isPartNumber?: boolean }}
 */
export function validateAppleSerialNumber(rawSerial, currentPn = '', partsCatalog = []) {
  if (!rawSerial) {
    return { isValid: false, error: 'Serial Number cannot be empty.' };
  }

  let str = String(rawSerial).trim();

  // Strip standard barcode GS1 prefixes 'S' or '1S' if length >= 11 (e.g. SF8Y6234C9AR231LB3 -> F8Y6234C9AR231LB3)
  if (/^1?S[A-Za-z0-9]{10,24}$/i.test(str) && str.length >= 11) {
    str = str.replace(/^1?S/i, '');
  }

  // Strip GS1 control characters
  str = str.replace(/[\x1d\x1e\x06\r\n]/g, '').trim();

  const cleanSerial = str.toUpperCase();
  const cleanPn = String(currentPn || '').trim().toUpperCase();

  // 1. Security Check: Serial Number cannot equal Part Number
  if (cleanPn && (cleanSerial === cleanPn || cleanSerial.replace(/[^A-Z0-9]/g, '') === cleanPn.replace(/[^A-Z0-9]/g, ''))) {
    return {
      isValid: false,
      isPartNumber: true,
      error: `Invalid Serial Number: The serial number cannot be identical to the Part Number (${cleanSerial}).`,
      cleanSerial
    };
  }

  // 2. Security Check: Reject standard Apple Part Number patterns (661-xxxxx, 660-xxxxx, 668-xxxxx, P661-xxxxx, 661xxxxx)
  if (/^(?:ZP|PP|Z|1P|P|S|1S)?66[0-9]-?\d{4,6}$/i.test(cleanSerial) || /^\d{3}-\d{4,6}$/.test(cleanSerial)) {
    return {
      isValid: false,
      isPartNumber: true,
      error: `"${cleanSerial}" is an Apple Part Number (P/N), not a Serial Number. Please scan the component's unique Serial Number barcode.`,
      cleanSerial
    };
  }

  // 3. Security Check: Reject if input matches any part description in catalog (e.g., "Battery, iPhone 14")
  const matchedPart = resolvePartInfo(cleanSerial, partsCatalog);
  if (matchedPart && (cleanSerial.includes('661') || cleanSerial.includes('660') || cleanSerial.includes('668') || cleanSerial.includes('Battery') || cleanSerial.includes('Display') || cleanSerial.length < 10)) {
    return {
      isValid: false,
      isPartNumber: true,
      error: `"${cleanSerial}" is a Part Description/SKU (${matchedPart.part_number}). Please scan the part's unique Serial Number barcode.`,
      cleanSerial
    };
  }

  // 4. Security Check: Alphanumeric format check (Apple serials contain only letters and digits, no hyphens, spaces, or symbols)
  if (!/^[A-Z0-9]{8,26}$/.test(cleanSerial)) {
    if (/[^A-Z0-9]/i.test(cleanSerial)) {
      return {
        isValid: false,
        error: `Invalid Serial Format: Serial contains illegal characters. Apple serial numbers contain only uppercase letters and digits.`,
        cleanSerial
      };
    }
    if (cleanSerial.length < 8) {
      return {
        isValid: false,
        error: `Serial Number too short (${cleanSerial.length} chars). Apple serial numbers must be at least 8-10 alphanumeric characters.`,
        cleanSerial
      };
    }
    if (cleanSerial.length > 26) {
      return {
        isValid: false,
        error: `Serial Number too long (${cleanSerial.length} chars). Maximum allowed is 26 characters.`,
        cleanSerial
      };
    }
  }

  // 5. Security Check: Reject generic dummy test words
  const genericWords = ['UNKNOWN', 'SERIAL', 'SERIALNUMBER', 'TEST1234', 'SAMPLE123', 'BATTERY', 'DISPLAY', 'IPHONE14', 'IPHONE15', 'IPHONE13', 'DEFAULT'];
  if (genericWords.includes(cleanSerial)) {
    return {
      isValid: false,
      error: `Invalid Serial Number: "${cleanSerial}" is a placeholder and not a genuine Apple component serial.`,
      cleanSerial
    };
  }

  return {
    isValid: true,
    cleanSerial
  };
}

/**
 * Intelligently resolves raw barcode, scanned text, SKU, or typo input to genuine Apple Part catalog entry
 * Canonicalizes 660-xxxxx, 668-xxxxx, 662-xxxxx, and "Replacement Part (66x-xxxxx)" to canonical "661-xxxxx"
 */
export function resolvePartInfo(rawInput, partsCatalog = []) {
  if (!rawInput) return null;
  let str = String(rawInput).trim();
  if (!str) return null;

  // 1. Clean GS1 Datamatrix / QR code control characters & prefixes
  if (str.startsWith('[)>') || str.includes('06\x1d') || str.includes('\x1d') || str.includes('\x1e')) {
    const pMatch = str.match(/P([0-9]{3}-?[0-9]{4,6})/i);
    if (pMatch) str = pMatch[1];
  }
  
  // Clean P / 1P / ZP / PP prefixes for Apple barcodes (e.g. P661-30373 -> 661-30373, ZP661-30373 -> 661-30373)
  if (/^(?:1?P|ZP|PP|Z)[0-9]{3}-?[0-9]{4,6}$/i.test(str)) {
    str = str.replace(/^(?:1?P|ZP|PP|Z)/i, '');
  }

  // Format 8-digit or 9-digit string 66130373 -> 661-30373, 66030373 -> 660-30373, 66830373 -> 668-30373
  if (/^[0-9]{3}[0-9]{4,6}$/.test(str)) {
    str = `${str.slice(0, 3)}-${str.slice(3)}`;
  }

  // Extract from "Replacement Part (660-30373)" or "Replacement Part (668-30373)" or "Part 661-30373"
  const embeddedPnMatch = str.match(/(?:66[0-9]|923|605|670)-[0-9]{4,6}/i);
  if (embeddedPnMatch) {
    str = embeddedPnMatch[0];
  }

  const clean = str.toUpperCase();
  const normalizedInput = str.toLowerCase().replace(/[^a-z0-9]/g, '');

  // Combined catalog prioritizing real parts over placeholder/dummy parts
  const fullCatalog = [...(partsCatalog || []), ...(defaultPartsCatalog || [])];
  const genuineParts = fullCatalog.filter(p => p.description && !p.description.includes('Replacement Part ('));
  const allParts = [...genuineParts, ...fullCatalog];

  // A. Canonicalize 660-xxxxx, 668-xxxxx, 662-xxxxx to canonical Apple 661-xxxxx
  if (/^66[0-9]-([0-9]{4,6})$/i.test(clean)) {
    const suffix = clean.match(/^66[0-9]-([0-9]{4,6})$/i)[1];
    const canonicalPn = `661-${suffix}`;
    const foundCanonical = allParts.find(p => p.part_number && p.part_number.toUpperCase() === canonicalPn);
    if (foundCanonical) return foundCanonical;
  }

  // B. Exact Match on part_number in genuine catalog first
  let found = genuineParts.find(p => p.part_number && p.part_number.toUpperCase() === clean);
  if (found) return found;

  // C. Match without hyphens or prefix variations (e.g. "66130373", "66030373", "66830373")
  const digitsOnly = clean.replace(/[^0-9]/g, '');
  if (digitsOnly.length >= 7 && digitsOnly.startsWith('66')) {
    const suffix = digitsOnly.slice(3);
    found = allParts.find(p => p.part_number && p.part_number.replace(/[^0-9]/g, '').endsWith(suffix));
    if (found) return found;
  }

  // D. Match by 4-6 digit numeric suffix (e.g. "30373" -> "661-30373")
  if (/^[0-9]{4,6}$/.test(clean)) {
    found = allParts.find(p => p.part_number && (p.part_number.endsWith(`-${clean}`) || p.part_number.endsWith(clean)));
    if (found) return found;
  }

  // E. Exact Match on description (e.g. "Battery, iPhone 14")
  found = genuineParts.find(p => p.description && p.description.trim().toLowerCase() === str.toLowerCase());
  if (found) return found;

  // F. Normalized description match (ignoring spaces, punctuation, commas)
  found = genuineParts.find(p => {
    if (!p.description) return false;
    const normDesc = p.description.toLowerCase().replace(/[^a-z0-9]/g, '');
    return normDesc === normalizedInput;
  });
  if (found) return found;

  // G. Keyword & Model Matching (e.g. "Battery, iPhone 14", "iPhone 14 battery", "Display 16 Pro Max", etc.)
  const isBattery = /battery/i.test(str);
  const isDisplay = /display|screen|oled/i.test(str);
  const isCamera = /camera/i.test(str);
  const isBackGlass = /back\s*glass|rear\s*glass/i.test(str);

  const modelRegexes = [
    /iphone\s*16\s*pro\s*max/i,
    /iphone\s*16\s*pro/i,
    /iphone\s*16\s*plus/i,
    /iphone\s*16/i,
    /iphone\s*15\s*pro\s*max/i,
    /iphone\s*15\s*pro/i,
    /iphone\s*15\s*plus/i,
    /iphone\s*15/i,
    /iphone\s*14\s*pro\s*max/i,
    /iphone\s*14\s*pro/i,
    /iphone\s*14\s*plus/i,
    /iphone\s*14/i,
    /iphone\s*13\s*pro\s*max/i,
    /iphone\s*13\s*pro/i,
    /iphone\s*13\s*mini/i,
    /iphone\s*13/i,
    /iphone\s*12\s*pro\s*max/i,
    /iphone\s*12\s*pro/i,
    /iphone\s*12\s*mini/i,
    /iphone\s*12/i,
    /iphone\s*11\s*pro\s*max/i,
    /iphone\s*11\s*pro/i,
    /iphone\s*11/i,
    /iphone\s*se/i
  ];

  for (const reg of modelRegexes) {
    if (reg.test(str)) {
      found = genuineParts.find(p => {
        const pModel = (p.iphone_model || '').toLowerCase();
        const pDesc = (p.description || '').toLowerCase();
        const matchModel = reg.test(pModel) || reg.test(pDesc);
        if (!matchModel) return false;
        if (isBattery && (pDesc.includes('battery') || p.category_id === 'cat-battery')) return true;
        if (isDisplay && (pDesc.includes('display') || pDesc.includes('screen') || p.category_id === 'cat-display')) return true;
        if (isCamera && (pDesc.includes('camera') || p.category_id === 'cat-camera')) return true;
        if (isBackGlass && (pDesc.includes('back glass') || pDesc.includes('rear') || p.category_id === 'cat-backglass')) return true;
        return false;
      });
      if (found) return found;
    }
  }

  // H. Partial substring match in genuine catalog
  found = genuineParts.find(p => {
    if (!p.description) return false;
    const pDesc = p.description.toLowerCase();
    const sLower = str.toLowerCase();
    return pDesc.includes(sLower) || sLower.includes(pDesc);
  });
  if (found) return found;

  // I. Fallback to any exact match in catalog
  found = allParts.find(p => p.part_number && p.part_number.toUpperCase() === clean);
  if (found) return found;

  return null;
}

/**
 * Normalizes all inventory units to ensure part_number is always a genuine Apple 661-xxxxx Part Number
 * Automatically heals corrupted units (e.g. 660-30373 -> 661-30373 Battery, iPhone 14)
 * AND purges invalid units where serial number was erroneously saved as a part number.
 */
export function normalizeInventoryUnits(units = [], partsCatalog = []) {
  if (!Array.isArray(units)) return [];
  const fullCatalog = [...(partsCatalog || []), ...(defaultPartsCatalog || [])];

  return units
    .filter(u => {
      const s = String(u.serial_number || '').trim().toUpperCase();
      const pn = String(u.part_number || '').trim().toUpperCase();
      // Security Filter: Reject units where serial number is the part number or invalid
      if (!s || s === pn) return false;
      if (/^(?:ZP|PP|Z|1P|P|S|1S)?66[0-9]-?\d{4,6}$/i.test(s) || /^\d{3}-\d{4,6}$/.test(s)) return false;
      if (fullCatalog && fullCatalog.some(p => p.part_number && p.part_number.toUpperCase() === s)) return false;
      if (s.length < 8) return false;
      return true;
    })
    .map(u => {
      const rawPn = u.part_number || '';
      const rawDesc = u.description || '';
      const rawNotes = u.notes || '';
      const rawAssignment = u.intake_assignment || (rawNotes.includes('CRBR') ? 'DC - CRBR' : 'MDC - Forecasting');
      const intakeAssignment = String(rawAssignment).includes('CRBR') ? 'DC - CRBR' : 'MDC - Forecasting';
      const notes = rawNotes || intakeAssignment;

      // 1. Resolve canonical Apple Genuine Part info (handles 660-xxxxx, 668-xxxxx, 661-xxxxx, 5-digit suffixes, barcodes, descriptions)
      const resolved = resolvePartInfo(rawPn, fullCatalog) || resolvePartInfo(rawDesc, fullCatalog);
      if (resolved) {
        return {
          ...u,
          part_id: resolved.id || u.part_id,
          part_number: resolved.part_number,
          description: resolved.description,
          category_id: resolved.category_id || u.category_id,
          intake_assignment: intakeAssignment,
          notes: notes,
          stocking_price: resolved.stocking_price || u.stocking_price || 99
        };
      }

      // 2. Exact match in catalog
      const exactPart = fullCatalog.find(p => p.part_number && p.part_number.toUpperCase() === rawPn.toUpperCase());
      if (exactPart) {
        return {
          ...u,
          part_id: exactPart.id || u.part_id,
          part_number: exactPart.part_number,
          description: exactPart.description,
          category_id: exactPart.category_id || u.category_id,
          intake_assignment: intakeAssignment,
          notes: notes,
          stocking_price: exactPart.stocking_price || u.stocking_price || 99
        };
      }

      // 3. Fallback extraction of 4-6 digit numeric suffix (e.g., from "660-30373", "668-30373" or "Replacement Part (660-30373)")
      const numMatch = `${rawPn} ${rawDesc}`.match(/(\d{4,6})/);
      if (numMatch) {
        const suffix = numMatch[1];
        const matchBySuffix = fullCatalog.find(p => p.part_number && p.part_number.endsWith(suffix));
        if (matchBySuffix) {
          return {
            ...u,
            part_id: matchBySuffix.id || u.part_id,
            part_number: matchBySuffix.part_number,
            description: matchBySuffix.description,
            category_id: matchBySuffix.category_id || u.category_id,
            intake_assignment: intakeAssignment,
            notes: notes,
            stocking_price: matchBySuffix.stocking_price || u.stocking_price || 99
          };
        }
      }

      return {
        ...u,
        intake_assignment: intakeAssignment,
        notes: notes
      };
    });
}
