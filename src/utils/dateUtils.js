/**
 * System-Wide 12-Hour Date & Time Formatting Utilities
 * Converts timestamps, ISO strings, Date objects, and 24-hour time strings
 * to clear, professional 12-hour format with AM/PM notation.
 */

/**
 * Formats any time representation (ISO date string, Date object, timestamp,
 * or 24-hour time string like "14:45:08") into standard 12-hour format (e.g. "02:45:08 PM").
 *
 * @param {string|number|Date} input - The time input to format
 * @param {boolean} [includeSeconds=true] - Whether to include seconds in output
 * @returns {string} Formatted 12-hour time string (e.g., "02:45:08 PM" or "02:45 PM")
 */
export function formatTo12HourTime(input, includeSeconds = true) {
  if (input === null || input === undefined || input === '') {
    return '';
  }

  // If already a Date object
  if (input instanceof Date) {
    if (isNaN(input.getTime())) return '';
    return input.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      ...(includeSeconds ? { second: '2-digit' } : {}),
      hour12: true
    });
  }

  // If input is a number (epoch milliseconds)
  if (typeof input === 'number') {
    const d = new Date(input);
    if (isNaN(d.getTime())) return String(input);
    return d.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      ...(includeSeconds ? { second: '2-digit' } : {}),
      hour12: true
    });
  }

  const str = String(input).trim();
  if (!str) return '';

  // Check if string is already in 12-hour format (e.g., "02:45:08 PM" or "2:45 PM")
  const twelveHourMatch = str.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if (twelveHourMatch) {
    const [, hStr, mStr, sStr, periodRaw] = twelveHourMatch;
    const h = parseInt(hStr, 10);
    const m = mStr;
    const s = sStr;
    const period = periodRaw.toUpperCase();
    const pad = (n) => String(n).padStart(2, '0');
    if (includeSeconds && s !== undefined) {
      return `${pad(h)}:${m}:${s} ${period}`;
    } else if (includeSeconds && s === undefined) {
      return `${pad(h)}:${m}:00 ${period}`;
    } else {
      return `${pad(h)}:${m} ${period}`;
    }
  }

  // Check if string is a 24-hour time representation like "14:45:08", "14:45", "00:15:30"
  const twentyFourHourMatch = str.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (twentyFourHourMatch) {
    const [, hStr, mStr, sStr] = twentyFourHourMatch;
    const h = parseInt(hStr, 10);
    const m = parseInt(mStr, 10);
    const s = sStr !== undefined ? parseInt(sStr, 10) : 0;
    
    if (h >= 0 && h < 24 && m >= 0 && m < 60 && s >= 0 && s < 60) {
      const period = h >= 12 ? 'PM' : 'AM';
      const h12 = h % 12 || 12;
      const pad = (n) => String(n).padStart(2, '0');
      
      if (includeSeconds && sStr !== undefined) {
        return `${pad(h12)}:${pad(m)}:${pad(s)} ${period}`;
      } else if (includeSeconds && sStr === undefined) {
        return `${pad(h12)}:${pad(m)}:00 ${period}`;
      } else {
        return `${pad(h12)}:${pad(m)} ${period}`;
      }
    }
  }

  // Check if string is a pure date string (YYYY-MM-DD or MM/DD/YYYY) without time
  if (/^\d{4}-\d{2}-\d{2}$/.test(str) || /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(str)) {
    return '';
  }

  // Check if string is ISO UTC midnight / zero time artifact (e.g. "2026-08-01T00:00:00Z", "2026-11-07T00:00:00+00:00", or "2026-08-01T08:00:00Z")
  if (
    /[T ]00:00:00(?:\.\d+)?(?:Z|[+-]00(?::?00)?)?$/i.test(str) ||
    /[T ]08:00:00(?:\.\d+)?(?:Z|[+-]00(?::?00)?)?$/i.test(str) ||
    /[T ]12:00:00\.000(?:Z|[+-]00(?::?00)?)?$/i.test(str)
  ) {
    return '';
  }

  // Try parsing as ISO date string or RFC date with real time
  try {
    const d = new Date(str);
    if (!isNaN(d.getTime())) {
      return d.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        ...(includeSeconds ? { second: '2-digit' } : {}),
        hour12: true
      });
    }
  } catch (e) {}

  return str;
}

/**
 * Formats any date/time representation into standard 12-hour datetime (e.g. "Sep 9, 2026, 02:45:08 PM").
 * If the input is date-only (or UTC midnight artifact), formats as clean date (e.g. "Sep 9, 2026")
 * without generating a misleading "08:00 AM" timestamp.
 *
 * @param {string|number|Date} input - The date/time input to format
 * @param {boolean} [includeSeconds=true] - Whether to include seconds in output
 * @returns {string} Formatted 12-hour date & time string or clean date
 */
export function formatTo12HourDateTime(input, includeSeconds = true) {
  if (input === null || input === undefined || input === '') {
    return '';
  }

  const str = typeof input === 'string' ? input.trim() : '';

  // Check if string is pure date without time or UTC midnight / synthetic time artifact
  const isDateOnly = str && (
    /^\d{4}-\d{2}-\d{2}$/.test(str) ||
    /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(str) ||
    /[T ]00:00:00(?:\.\d+)?(?:Z|[+-]00(?::?00)?)?$/i.test(str) ||
    /[T ]08:00:00(?:\.\d+)?(?:Z|[+-]00(?::?00)?)?$/i.test(str) ||
    /[T ]12:00:00\.000(?:Z|[+-]00(?::?00)?)?$/i.test(str)
  );

  try {
    const d = input instanceof Date ? input : new Date(input);
    if (isNaN(d.getTime())) return String(input);

    if (isDateOnly) {
      const isoDateMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
      const cleanDateObj = isoDateMatch
        ? new Date(parseInt(isoDateMatch[1], 10), parseInt(isoDateMatch[2], 10) - 1, parseInt(isoDateMatch[3], 10))
        : d;
      return cleanDateObj.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });
    }

    const datePart = d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
    const timePart = d.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      ...(includeSeconds ? { second: '2-digit' } : {}),
      hour12: true
    });
    return `${datePart}, ${timePart}`;
  } catch (e) {
    return String(input);
  }
}

/**
 * Smart Formatter for Part Intake Dates (Date Only)
 * Extracts and displays ONLY the date (e.g., "2026-09-15"),
 * strictly removing any time component (hours, minutes, seconds, AM/PM)
 * to align with system-wide inventory date standards.
 *
 * @param {Object|string|number|Date} input - Part unit object or raw timestamp/date string
 * @returns {string} Clean date string (e.g. "2026-09-15") or "Recent"
 */
export function formatPartDate(input) {
  if (input === null || input === undefined || input === '') {
    return 'Recent';
  }

  const isPlainObj = typeof input === 'object' && !(input instanceof Date);
  const rawDate = isPlainObj
    ? (input.received_at || input.dateReceived || input.lastReceivedDate || input.dateKey || input.created_at || input.timestamp)
    : input;

  if (!rawDate) {
    return 'Recent';
  }

  if (typeof rawDate === 'string') {
    const trimmed = rawDate.trim();
    if (!trimmed) return 'Recent';
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return trimmed;
    }
    const isoDateMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);
    if (isoDateMatch) {
      return isoDateMatch[1];
    }
    const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (slashMatch) {
      const [, m, d, y] = slashMatch;
      return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
  }

  try {
    const d = rawDate instanceof Date ? rawDate : new Date(rawDate);
    if (!isNaN(d.getTime())) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    }
  } catch {}

  return String(rawDate);
}

// Keep formatPartTimestamp as an alias to formatPartDate to guarantee date-only output everywhere
export const formatPartTimestamp = formatPartDate;
