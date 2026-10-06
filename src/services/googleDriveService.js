/**
 * Google Drive Storage Integration Service for MDC DC System
 * 
 * Provides automated file archiving, document backups, and cold-storage offloading
 * using the company's Google Workspace Shared Drive ("MDC DC System Archive").
 * 
 * Utilizes standard RS256 JWT assertion with Web Crypto (crypto.subtle),
 * completely dependency-free and compatible across both Browser and Node.js.
 */

// Dynamic & safe resolution of local credentials module (prevents build failure when git-ignored)
let EMBEDDED_KEY = null;
try {
  // Vite static glob analysis (works in browser & Vite build)
  const credsMods = import.meta.glob('../config/googleDriveCredentials.js', { eager: true });
  for (const k in credsMods) {
    if (credsMods[k]?.GOOGLE_SERVICE_ACCOUNT_KEY) {
      EMBEDDED_KEY = credsMods[k].GOOGLE_SERVICE_ACCOUNT_KEY;
      break;
    }
  }
} catch (_) {}

// Node.js runtime fallback (testing & CLI scripts)
if (!EMBEDDED_KEY && typeof process !== 'undefined' && process?.versions?.node) {
  try {
    const fs = await import(/* @vite-ignore */ 'node:fs');
    const path = await import(/* @vite-ignore */ 'node:path');
    const credPath = path.resolve(process.cwd(), 'src/config/googleDriveCredentials.js');
    if (fs.existsSync(credPath)) {
      const mod = await import(`file://${credPath}`);
      EMBEDDED_KEY = mod.GOOGLE_SERVICE_ACCOUNT_KEY;
    }
  } catch (_) {}
}

/**
 * Retrieves a credentials field from browser localStorage override
 */
export function getLocalStorageCredential(field) {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const stored = window.localStorage.getItem('mdc_google_service_account_key');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (field in parsed) return parsed[field];
        if (field === 'private_key' && parsed.private_key) return parsed.private_key;
      }
    } catch (_) {
      const raw = window.localStorage.getItem('mdc_google_service_account_key');
      if (field === 'private_key' && raw && raw.includes('BEGIN PRIVATE KEY')) {
        return raw;
      }
    }
  }
  return null;
}

/**
 * Allows Superadmin to persist service account credentials directly in browser storage
 */
export function setGoogleDriveCredentialsOverride(credentials) {
  if (typeof window === 'undefined') return;
  if (!credentials) {
    localStorage.removeItem('mdc_google_service_account_key');
  } else if (typeof credentials === 'string') {
    localStorage.setItem('mdc_google_service_account_key', credentials);
  } else {
    localStorage.setItem('mdc_google_service_account_key', JSON.stringify(credentials));
  }
  cachedAccessToken = null;
  cachedPrivateKeyObj = null;
}

// Credentials fallback chain:
// 1. Deployment environment variables (VITE_GOOGLE_SERVICE_ACCOUNT_KEY / EMAIL)
// 2. Embedded credentials module (src/config/googleDriveCredentials.js)
// 3. Browser localStorage override (set via Superadmin Settings)
// 4. Global / Node.js runtime globals (testing & CLI scripts)
export const GOOGLE_SERVICE_ACCOUNT_KEY = {
  get client_email() {
    return (
      import.meta?.env?.VITE_GOOGLE_SERVICE_ACCOUNT_EMAIL ||
      EMBEDDED_KEY?.client_email ||
      getLocalStorageCredential('client_email') ||
      'mdc-dc-storage-bot@lateral-journey-510307-f7.iam.gserviceaccount.com'
    );
  },
  get private_key() {
    return resolvePrivateKeyPem() || '';
  }
};

// Shared Drive & Folder Configurations
export const GOOGLE_DRIVE_CONFIG = {
  sharedDriveId: import.meta?.env?.VITE_GOOGLE_DRIVE_SHARED_DRIVE_ID || '0AEWZPge3zfLtUk9PVA',
  folders: {
    shipments: import.meta?.env?.VITE_GOOGLE_DRIVE_SHIPMENTS_FOLDER_ID || '1hdXoQ-qDbkPlniwIExFcqdqIcgRqYbka',
    reports: import.meta?.env?.VITE_GOOGLE_DRIVE_REPORTS_FOLDER_ID || '1iuMo1jEWRdguyGQ24EaQfYir2D_LWS08',
    snapshots: import.meta?.env?.VITE_GOOGLE_DRIVE_SNAPSHOTS_FOLDER_ID || '1ZATES0O0caRM3qT4rMwNBSZyWrUh-9eF',
    backups: import.meta?.env?.VITE_GOOGLE_DRIVE_BACKUPS_FOLDER_ID || '1Lc0DxynivRqC_jWUvzv0S19U8YquIRkY',
    allocation: import.meta?.env?.VITE_GOOGLE_DRIVE_ALLOCATION_FOLDER_ID || '16FSYolhBC1LENl3JXz89l5E0NRgLXjhX',
    forecasting: import.meta?.env?.VITE_GOOGLE_DRIVE_FORECASTING_FOLDER_ID || '1VI7qpWMPwH0oR8niHnpoijtVQWge-IVr',
    pmg_signed_pl: import.meta?.env?.VITE_GOOGLE_DRIVE_PMG_SIGNED_PL_FOLDER_ID || '1ltAwtMav9hGaJTvEJpVqnv72_S41ODaW'
  },
  get clientEmail() {
    return (
      import.meta?.env?.VITE_GOOGLE_SERVICE_ACCOUNT_EMAIL ||
      EMBEDDED_KEY?.client_email ||
      getLocalStorageCredential('client_email') ||
      'mdc-dc-storage-bot@lateral-journey-510307-f7.iam.gserviceaccount.com'
    );
  }
};

let cachedAccessToken = null;
let tokenExpiresAt = 0;
let cachedPrivateKeyObj = null;
const DRIVE_REQUEST_TIMEOUT_MS = 30_000;

async function fetchDrive(url, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DRIVE_REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: options.signal || controller.signal });
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error(
        `Google Drive request timed out after ${DRIVE_REQUEST_TIMEOUT_MS / 1000} seconds`,
        { cause: err }
      );
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Returns whether Google Drive integration is available
 */
export function isGoogleDriveConfigured() {
  const pem = resolvePrivateKeyPem();
  return Boolean(GOOGLE_DRIVE_CONFIG.sharedDriveId && GOOGLE_DRIVE_CONFIG.clientEmail && pem);
}

/**
 * Helper to resolve the private key string from env, module, localStorage, or globals
 */
export function resolvePrivateKeyPem() {
  // 1. Env variable override (if configured in Vercel or .env)
  const envKey = import.meta?.env?.VITE_GOOGLE_SERVICE_ACCOUNT_KEY;
  if (envKey && typeof envKey === 'string' && envKey.trim()) {
    return envKey.replace(/\\n/g, '\n');
  }

  // 2. Embedded credentials module (src/config/googleDriveCredentials.js)
  if (EMBEDDED_KEY?.private_key) {
    return EMBEDDED_KEY.private_key.replace(/\\n/g, '\n');
  }

  // 3. LocalStorage override / configuration (Superadmin key setup)
  const localKey = getLocalStorageCredential('private_key');
  if (localKey && typeof localKey === 'string' && localKey.trim()) {
    return localKey.replace(/\\n/g, '\n');
  }

  // 4. Global object fallback (Node.js runtime or window)
  if (typeof globalThis !== 'undefined' && globalThis.__GOOGLE_SERVICE_KEY__?.private_key) {
    return globalThis.__GOOGLE_SERVICE_KEY__.private_key.replace(/\\n/g, '\n');
  }

  // 5. Node.js process.env fallback
  if (typeof process !== 'undefined' && process.env?.GOOGLE_PRIVATE_KEY) {
    return process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n');
  }

  return null;
}

/**
 * Converts ArrayBuffer / binary to URL-safe Base64
 */
function arrayBufferToBase64Url(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = (typeof btoa === 'function') 
    ? btoa(binary) 
    : Buffer.from(binary, 'binary').toString('base64');
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Converts string to URL-safe Base64
 */
function stringToBase64Url(str) {
  const bytes = new TextEncoder().encode(str);
  return arrayBufferToBase64Url(bytes.buffer);
}

/**
 * Imports PKCS#8 PEM private key into SubtleCrypto
 */
async function getCryptoPrivateKey(pem) {
  if (cachedPrivateKeyObj) return cachedPrivateKeyObj;

  const cryptoSubtle = globalThis?.crypto?.subtle || window?.crypto?.subtle;
  if (!cryptoSubtle) {
    throw new Error('Web Crypto API (crypto.subtle) is not supported in this runtime.');
  }

  const cleanPem = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/[\r\n\s]+/g, '');

  let binaryDer;
  if (typeof Buffer !== 'undefined') {
    const buf = Buffer.from(cleanPem, 'base64');
    binaryDer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  } else {
    const raw = atob(cleanPem.replace(/[^A-Za-z0-9+/=]/g, ''));
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) {
      bytes[i] = raw.charCodeAt(i);
    }
    binaryDer = bytes.buffer;
  }

  cachedPrivateKeyObj = await cryptoSubtle.importKey(
    'pkcs8',
    binaryDer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  return cachedPrivateKeyObj;
}

/**
 * Obtains an OAuth2 access token using RS256 JWT Bearer grant
 */
export async function getGoogleDriveAccessToken(forceRefresh = false) {
  const nowSec = Math.floor(Date.now() / 1000);
  if (!forceRefresh && cachedAccessToken && tokenExpiresAt > nowSec + 60) {
    return cachedAccessToken;
  }

  const pem = resolvePrivateKeyPem();
  if (!pem) {
    throw new Error('Google Service Account private key is not configured.');
  }

  const privateKey = await getCryptoPrivateKey(pem);
  const cryptoSubtle = globalThis?.crypto?.subtle || window?.crypto?.subtle;

  const header = stringToBase64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claimSet = stringToBase64Url(JSON.stringify({
    iss: GOOGLE_DRIVE_CONFIG.clientEmail,
    scope: 'https://www.googleapis.com/auth/drive',
    aud: 'https://oauth2.googleapis.com/token',
    exp: nowSec + 3600,
    iat: nowSec
  }));

  const unsignedToken = `${header}.${claimSet}`;
  const signatureBuffer = await cryptoSubtle.sign(
    'RSASSA-PKCS1-v1_5',
    privateKey,
    new TextEncoder().encode(unsignedToken)
  );

  const signature = arrayBufferToBase64Url(signatureBuffer);
  const jwt = `${unsignedToken}.${signature}`;

  const res = await fetchDrive('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    })
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Google token exchange failed: ${data.error_description || data.error || 'Unknown error'}`);
  }

  cachedAccessToken = data.access_token;
  tokenExpiresAt = nowSec + (data.expires_in || 3600);
  return cachedAccessToken;
}

const pad = (n) => String(n).padStart(2, '0');

export function getLocalDateString(d = new Date()) {
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  return `${yyyy}-${mm}-${dd}`;
}

const dateFolderCache = new Map();

export function clearDateFolderCache() {
  dateFolderCache.clear();
}

/**
 * Resolves or automatically creates a named subfolder inside a designated parent folder in Google Drive.
 * If the folder already exists, returns its ID.
 * Caches resolved folders in memory to prevent duplicate API lookups and race conditions.
 * 
 * @param {string} parentFolderId - Target parent folder ID in Google Drive
 * @param {string} folderName - Subfolder name (e.g. "LIMA", "2026-10-02")
 * @param {string} [customAccessToken] - Optional access token
 * @returns {Promise<string>} The ID of the folder
 */
export async function getOrCreateFolder(parentFolderId, folderName, customAccessToken = null) {
  if (!parentFolderId || !folderName) return parentFolderId;
  const cleanName = String(folderName).trim();
  const cacheKey = `${parentFolderId}_${cleanName}`;

  if (dateFolderCache.has(cacheKey)) {
    return await dateFolderCache.get(cacheKey);
  }

  const token = customAccessToken || await getGoogleDriveAccessToken();

  const fetchPromise = (async () => {
    // 1. Search for existing folder with name = cleanName inside parentFolderId
    const query = `mimeType = 'application/vnd.google-apps.folder' and name = '${cleanName.replace(/'/g, "\\'")}' and '${parentFolderId}' in parents and trashed = false`;
    const searchUrl = `https://www.googleapis.com/drive/v3/files?corpora=drive&driveId=${GOOGLE_DRIVE_CONFIG.sharedDriveId}&includeItemsFromAllDrives=true&supportsAllDrives=true&q=${encodeURIComponent(query)}&fields=files(id,name)`;

    const searchRes = await fetchDrive(searchUrl, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (searchRes.ok) {
      const searchData = await searchRes.json();
      if (searchData.files && searchData.files.length > 0) {
        return searchData.files[0].id;
      }
    }

    // 2. Folder does not exist, create it inside parentFolderId
    const createRes = await fetchDrive('https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id,name', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: cleanName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentFolderId]
      })
    });

    const createData = await createRes.json();
    if (!createRes.ok) {
      throw new Error(createData.error?.message || `Failed to create folder "${cleanName}" in Google Drive`);
    }

    return createData.id;
  })();

  dateFolderCache.set(cacheKey, fetchPromise);
  try {
    const id = await fetchPromise;
    return id;
  } catch (err) {
    dateFolderCache.delete(cacheKey);
    throw err;
  }
}

/**
 * Resolves or automatically creates a date subfolder (e.g. "2026-10-01") inside the designated parent folder.
 * If the date folder already exists, returns its ID.
 * 
 * @param {string} parentFolderId - Target parent folder ID in Google Drive
 * @param {string} [dateString] - Date string (defaults to today in YYYY-MM-DD)
 * @param {string} [customAccessToken] - Optional access token
 * @returns {Promise<string>} The ID of the date folder
 */
export async function getOrCreateDateFolder(parentFolderId, dateString = getLocalDateString(), customAccessToken = null) {
  return getOrCreateFolder(parentFolderId, dateString || getLocalDateString(), customAccessToken);
}

/**
 * Uploads a file to Google Shared Drive inside a designated folder and date subfolder
 * 
 * @param {Object} params
 * @param {string} params.name - File name (e.g. "PackingList_DC01.pdf")
 * @param {string} params.mimeType - MIME type (e.g. "application/pdf", "application/json")
 * @param {Blob|ArrayBuffer|string} params.data - File content
 * @param {'shipments'|'reports'|'snapshots'|'backups'|'allocation'|'forecasting'} [params.folderType] - Named folder
 * @param {string} [params.folderId] - Explicit target folder ID (defaults to folderType or Shared Drive root)
 * @param {boolean} [params.useDateFolder=true] - Whether to organize files inside a date subfolder (e.g. "2026-10-01")
/**
 * Converts various data types (string, Blob, ArrayBuffer, Uint8Array, Object) to Uint8Array
 */
export async function normalizeToFileBytes(data) {
  if (typeof data === 'string') {
    return new TextEncoder().encode(data);
  } else if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  } else if (data instanceof Uint8Array) {
    return data;
  } else if (typeof Blob !== 'undefined' && data instanceof Blob) {
    const buf = await data.arrayBuffer();
    return new Uint8Array(buf);
  } else {
    return new TextEncoder().encode(JSON.stringify(data));
  }
}

/**
 * Resumable Chunked Upload to Google Drive (Feature C)
 * Ideal for files > 5MB, poor connectivity, and large system backups.
 * Chunks are transferred in 2MB blocks (multiples of 256KB) with automatic progress reporting.
 * 
 * @param {Object} params
 * @param {string} params.name - Target file name
 * @param {string} [params.mimeType] - File MIME type
 * @param {Blob|ArrayBuffer|Uint8Array|string|Object} params.data - File data
 * @param {'shipments'|'reports'|'snapshots'|'backups'|'allocation'|'forecasting'|'pmg_signed_pl'} [params.folderType]
 * @param {string} [params.folderId] - Explicit folder ID
 * @param {boolean} [params.useDateFolder=true] - Whether to organize into date subfolder
 * @param {string} [params.dateString] - Date string for subfolder
 * @param {number} [params.chunkSize] - Chunk size in bytes (must be multiple of 256KB, default 2MB)
 * @param {Function} [params.onProgress] - Progress callback: ({ uploadedBytes, totalBytes, percent })
 * @returns {Promise<{ success: boolean, fileId?: string, name?: string, webViewLink?: string, webContentLink?: string, parentFolderId?: string, isResumable?: boolean, error?: string }>}
 */
export async function uploadResumableToGoogleDrive({
  name,
  mimeType = 'application/octet-stream',
  data,
  folderType = 'shipments',
  folderId,
  useDateFolder = true,
  dateString,
  chunkSize = 2 * 1024 * 1024, // 2MB default (multiple of 256KB)
  onProgress
}) {
  try {
    const accessToken = await getGoogleDriveAccessToken();
    const designatedFolder = folderId || GOOGLE_DRIVE_CONFIG.folders[folderType] || GOOGLE_DRIVE_CONFIG.sharedDriveId;

    let targetFolder = designatedFolder;
    let resolvedDateFolderName = null;

    if (useDateFolder && designatedFolder) {
      const todayDateStr = dateString || getLocalDateString();
      resolvedDateFolderName = todayDateStr;
      targetFolder = await getOrCreateDateFolder(designatedFolder, todayDateStr, accessToken);
    }

    const fileBytes = await normalizeToFileBytes(data);
    const totalBytes = fileBytes.length;

    // 1. Initiate Resumable Upload Session
    const metadata = {
      name,
      parents: targetFolder ? [targetFolder] : [GOOGLE_DRIVE_CONFIG.sharedDriveId]
    };

    const initRes = await fetchDrive(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': mimeType,
          'X-Upload-Content-Length': String(totalBytes)
        },
        body: JSON.stringify(metadata)
      }
    );

    if (!initRes.ok) {
      const errBody = await initRes.text();
      throw new Error(`Failed to initiate resumable upload session: ${initRes.status} ${errBody}`);
    }

    const sessionUrl = initRes.headers.get('Location') || initRes.headers.get('location');
    if (!sessionUrl) {
      throw new Error('Google Drive API did not return a resumable session URI (Location header missing)');
    }

    // Ensure chunkSize is a positive multiple of 256KB (262,144 bytes)
    const UNIT = 256 * 1024;
    const cleanChunkSize = Math.max(UNIT, Math.floor(chunkSize / UNIT) * UNIT);

    let offset = 0;
    let uploadResult = null;

    while (offset < totalBytes) {
      const end = Math.min(offset + cleanChunkSize, totalBytes);
      const chunkSlice = fileBytes.subarray(offset, end);
      const isLastChunk = end === totalBytes;

      let chunkSuccess = false;
      let attempts = 0;
      const maxAttempts = 3;

      while (!chunkSuccess && attempts < maxAttempts) {
        attempts++;
        try {
          const chunkRes = await fetchDrive(sessionUrl, {
            method: 'PUT',
            headers: {
              'Content-Length': String(chunkSlice.length),
              'Content-Range': `bytes ${offset}-${end - 1}/${totalBytes}`,
              'Content-Type': mimeType
            },
            body: chunkSlice
          });

          if (isLastChunk && (chunkRes.status === 200 || chunkRes.status === 201)) {
            uploadResult = await chunkRes.json();
            chunkSuccess = true;
            offset = end;
            if (onProgress) {
              onProgress({ uploadedBytes: totalBytes, totalBytes, percent: 100 });
            }
          } else if (!isLastChunk && chunkRes.status === 308) {
            // Chunk accepted, resume incomplete
            chunkSuccess = true;
            offset = end;
            if (onProgress) {
              onProgress({
                uploadedBytes: end,
                totalBytes,
                percent: Math.min(99, Math.round((end / totalBytes) * 100))
              });
            }
          } else if (chunkRes.status >= 500 || chunkRes.status === 408) {
            // Transient server error, retry with delay
            await new Promise((r) => setTimeout(r, 1000 * attempts));
          } else {
            const errTxt = await chunkRes.text();
            throw new Error(`Chunk upload failed with status ${chunkRes.status}: ${errTxt}`);
          }
        } catch (fetchErr) {
          if (attempts >= maxAttempts) throw fetchErr;
          await new Promise((r) => setTimeout(r, 1000 * attempts));
        }
      }
    }

    return {
      success: true,
      fileId: uploadResult?.id,
      name: uploadResult?.name || name,
      webViewLink: uploadResult?.webViewLink || `https://drive.google.com/file/d/${uploadResult?.id}/view`,
      webContentLink: uploadResult?.webContentLink,
      parentFolderId: targetFolder,
      dateFolder: resolvedDateFolderName,
      isResumable: true
    };
  } catch (err) {
    console.error(`[Google Drive] Resumable upload failed for ${name}:`, err);
    return {
      success: false,
      error: err.message
    };
  }
}

/**
 * Uploads a file to Google Shared Drive inside a designated folder and date subfolder.
 * Automatically delegates to resumable chunked upload if file size exceeds 5MB (Feature C).
 * 
 * @param {Object} params
 * @param {string} params.name - File name (e.g. "PackingList_DC01.pdf")
 * @param {string} params.mimeType - MIME type (e.g. "application/pdf", "application/json")
 * @param {Blob|ArrayBuffer|string} params.data - File content
 * @param {'shipments'|'reports'|'snapshots'|'backups'|'allocation'|'forecasting'|'pmg_signed_pl'} [params.folderType] - Named folder
 * @param {string} [params.folderId] - Explicit target folder ID (defaults to folderType or Shared Drive root)
 * @param {boolean} [params.useDateFolder=true] - Whether to organize files inside a date subfolder (e.g. "2026-10-01")
 * @param {string} [params.dateString] - Custom date string for subfolder (defaults to today YYYY-MM-DD)
 * @param {Function} [params.onProgress] - Optional progress callback
 * @returns {Promise<{ success: boolean, fileId: string, name: string, webViewLink: string, webContentLink: string, parentFolderId?: string, dateFolder?: string, isResumable?: boolean }>}
 */
export async function uploadToGoogleDrive({
  name,
  mimeType = 'application/octet-stream',
  data,
  folderType = 'shipments',
  folderId,
  useDateFolder = true,
  dateString,
  onProgress
}) {
  try {
    const fileBytes = await normalizeToFileBytes(data);

    // Feature C: Auto-route files larger than 5MB to Resumable Chunked Upload protocol
    const FIVE_MEGABYTES = 5 * 1024 * 1024;
    if (fileBytes.length > FIVE_MEGABYTES) {
      return await uploadResumableToGoogleDrive({
        name,
        mimeType,
        data: fileBytes,
        folderType,
        folderId,
        useDateFolder,
        dateString,
        onProgress
      });
    }

    const accessToken = await getGoogleDriveAccessToken();
    const designatedFolder = folderId || GOOGLE_DRIVE_CONFIG.folders[folderType] || GOOGLE_DRIVE_CONFIG.sharedDriveId;

    let targetFolder = designatedFolder;
    let resolvedDateFolderName = null;

    if (useDateFolder && designatedFolder) {
      const todayDateStr = dateString || getLocalDateString();
      resolvedDateFolderName = todayDateStr;
      targetFolder = await getOrCreateDateFolder(designatedFolder, todayDateStr, accessToken);
    }

    const metadata = {
      name,
      parents: targetFolder ? [targetFolder] : [GOOGLE_DRIVE_CONFIG.sharedDriveId]
    };

    const boundary = '-------mdc_boundary_' + Math.random().toString(36).substring(2);
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelim = `\r\n--${boundary}--`;

    // Build multipart body with metadata and binary
    const metaPart = `${delimiter}Content-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}`;
    const mediaHeader = `${delimiter}Content-Type: ${mimeType}\r\n\r\n`;

    const metaBytes = new TextEncoder().encode(metaPart);
    const mediaHeaderBytes = new TextEncoder().encode(mediaHeader);
    const closeBytes = new TextEncoder().encode(closeDelim);

    const totalLen = metaBytes.length + mediaHeaderBytes.length + fileBytes.length + closeBytes.length;
    const combined = new Uint8Array(totalLen);
    let offset = 0;

    combined.set(metaBytes, offset); offset += metaBytes.length;
    combined.set(mediaHeaderBytes, offset); offset += mediaHeaderBytes.length;
    combined.set(fileBytes, offset); offset += fileBytes.length;
    combined.set(closeBytes, offset);

    const uploadRes = await fetchDrive(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,webViewLink,webContentLink',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': `multipart/related; boundary=${boundary}`
        },
        body: combined
      }
    );

    const result = await uploadRes.json();
    if (!uploadRes.ok) {
      throw new Error(result.error?.message || 'Google Drive upload failed');
    }

    if (onProgress) {
      onProgress({ uploadedBytes: fileBytes.length, totalBytes: fileBytes.length, percent: 100 });
    }

    return {
      success: true,
      fileId: result.id,
      name: result.name,
      webViewLink: result.webViewLink,
      webContentLink: result.webContentLink,
      parentFolderId: targetFolder,
      dateFolder: resolvedDateFolderName,
      isResumable: false
    };
  } catch (err) {
    console.error(`[Google Drive] Failed to upload ${name}:`, err);
    return {
      success: false,
      error: err.message
    };
  }
}

/**
 * Fetches file content from Google Drive by file ID
 */
export async function downloadFromGoogleDrive(fileId) {
  const accessToken = await getGoogleDriveAccessToken();
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`,
    {
      headers: { Authorization: `Bearer ${accessToken}` }
    }
  );

  if (!res.ok) {
    throw new Error(`Failed to download file from Google Drive (${res.status} ${res.statusText})`);
  }

  return res;
}

/**
 * Downloads and parses JSON file directly from Google Drive
 */
export async function downloadJsonFromGoogleDrive(fileId) {
  const res = await downloadFromGoogleDrive(fileId);
  return await res.json();
}

/**
 * Lists files in a designated folder and its date subfolders
 */
export async function listFilesInDriveFolder(folderType = 'shipments', pageSize = 50) {
  try {
    const accessToken = await getGoogleDriveAccessToken();
    const folderId = GOOGLE_DRIVE_CONFIG.folders[folderType] || GOOGLE_DRIVE_CONFIG.sharedDriveId;

    // Discover any subfolders (such as date folders) inside the designated folder
    const subQuery = `mimeType = 'application/vnd.google-apps.folder' and '${folderId}' in parents and trashed = false`;
    const subUrl = `https://www.googleapis.com/drive/v3/files?corpora=drive&driveId=${GOOGLE_DRIVE_CONFIG.sharedDriveId}&includeItemsFromAllDrives=true&supportsAllDrives=true&q=${encodeURIComponent(subQuery)}&fields=files(id,name)`;
    
    let parentIds = [folderId];
    try {
      const subRes = await fetch(subUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (subRes.ok) {
        const subData = await subRes.json();
        if (subData.files && subData.files.length > 0) {
          parentIds.push(...subData.files.map(f => f.id));
        }
      }
    } catch (_) {}

    const parentClauses = parentIds.map(id => `'${id}' in parents`).join(' or ');
    const query = `(${parentClauses}) and trashed = false and mimeType != 'application/vnd.google-apps.folder'`;
    const url = `https://www.googleapis.com/drive/v3/files?corpora=drive&driveId=${GOOGLE_DRIVE_CONFIG.sharedDriveId}&includeItemsFromAllDrives=true&supportsAllDrives=true&q=${encodeURIComponent(query)}&pageSize=${pageSize}&fields=files(id,name,mimeType,size,createdTime,webViewLink,parents)&orderBy=createdTime desc`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const data = await res.json();
    return data.files || [];
  } catch (err) {
    console.error('[Google Drive] Failed to list folder files:', err);
    return [];
  }
}

/**
 * Trashes a file in Google Shared Drive
 */
export async function trashFileInDrive(fileId) {
  try {
    const accessToken = await getGoogleDriveAccessToken();
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?supportsAllDrives=true`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ trashed: true })
    });
    return res.ok;
  } catch (err) {
    console.error(`[Google Drive] Error trashing file ${fileId}:`, err);
    return false;
  }
}
