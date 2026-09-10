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

  // Try parsing as ISO date string or RFC date
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
 *
 * @param {string|number|Date} input - The date/time input to format
 * @param {boolean} [includeSeconds=true] - Whether to include seconds in output
 * @returns {string} Formatted 12-hour date & time string
 */
export function formatTo12HourDateTime(input, includeSeconds = true) {
  if (input === null || input === undefined || input === '') {
    return '';
  }

  try {
    const d = input instanceof Date ? input : new Date(input);
    if (isNaN(d.getTime())) return String(input);

    return d.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      ...(includeSeconds ? { second: '2-digit' } : {}),
      hour12: true
    });
  } catch (e) {
    return String(input);
  }
}
