/**
 * Google Drive Storage Integration Service for MDC DC System
 * 
 * Provides automated file archiving, document backups, and cold-storage offloading
 * using the company's Google Workspace Shared Drive ("MDC DC Logistics Archive").
 * 
 * Utilizes standard RS256 JWT assertion with Web Crypto (crypto.subtle),
 * completely dependency-free and compatible across both Browser and Node.js.
 */

// Dynamic & safe resolution of local credentials module (prevents build failure when git-ignored)
let EMBEDDED_KEY = null;
if (typeof import.meta !== 'undefined' && typeof import.meta.glob === 'function') {
  try {
    const credsMods = import.meta.glob('../config/googleDriveCredentials.js', { eager: true });
    EMBEDDED_KEY = credsMods['../config/googleDriveCredentials.js']?.GOOGLE_SERVICE_ACCOUNT_KEY || null;
  } catch (_) {}
} else if (typeof process !== 'undefined' && process?.versions?.node) {
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

// Credentials fallback chain:
// 1. Deployment environment variables (VITE_GOOGLE_SERVICE_ACCOUNT_KEY / EMAIL)
// 2. Embedded credentials module (src/config/googleDriveCredentials.js, git-ignored)
// 3. Global / Node.js runtime globals (testing & CLI scripts)
const GOOGLE_SERVICE_ACCOUNT_KEY = {
  client_email: import.meta?.env?.VITE_GOOGLE_SERVICE_ACCOUNT_EMAIL || EMBEDDED_KEY?.client_email || 'mdc-dc-storage-bot@lateral-journey-510307-f7.iam.gserviceaccount.com',
  private_key: import.meta?.env?.VITE_GOOGLE_SERVICE_ACCOUNT_KEY || EMBEDDED_KEY?.private_key || ''
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
  clientEmail: import.meta?.env?.VITE_GOOGLE_SERVICE_ACCOUNT_EMAIL || GOOGLE_SERVICE_ACCOUNT_KEY?.client_email || 'mdc-dc-storage-bot@lateral-journey-510307-f7.iam.gserviceaccount.com'
};

let cachedAccessToken = null;
let tokenExpiresAt = 0;
let cachedPrivateKeyObj = null;

/**
 * Returns whether Google Drive integration is available
 */
export function isGoogleDriveConfigured() {
  const pem = resolvePrivateKeyPem();
  return Boolean(GOOGLE_DRIVE_CONFIG.sharedDriveId && GOOGLE_DRIVE_CONFIG.clientEmail && pem);
}

/**
 * Helper to resolve the private key string from env or credentials
 */
function resolvePrivateKeyPem() {
  // 1. Env variable override (if configured in Vercel or .env)
  const envKey = import.meta?.env?.VITE_GOOGLE_SERVICE_ACCOUNT_KEY;
  if (envKey && typeof envKey === 'string' && envKey.trim()) {
    return envKey.replace(/\\n/g, '\n');
  }

  // 2. Resolved service account key (env or embedded)
  if (GOOGLE_SERVICE_ACCOUNT_KEY?.private_key) {
    return GOOGLE_SERVICE_ACCOUNT_KEY.private_key.replace(/\\n/g, '\n');
  }

  // 3. Embedded credentials config direct
  if (EMBEDDED_KEY?.private_key) {
    return EMBEDDED_KEY.private_key.replace(/\\n/g, '\n');
  }

  // 4. Node.js fallback during testing or script runs
  if (typeof process !== 'undefined' && process.env?.GOOGLE_PRIVATE_KEY) {
    return process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n');
  }

  // 5. Check if credentials JSON is in local memory / global
  if (typeof globalThis !== 'undefined' && globalThis.__GOOGLE_SERVICE_KEY__?.private_key) {
    return globalThis.__GOOGLE_SERVICE_KEY__.private_key.replace(/\\n/g, '\n');
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

  const res = await fetch('https://oauth2.googleapis.com/token', {
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

    const searchRes = await fetch(searchUrl, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (searchRes.ok) {
      const searchData = await searchRes.json();
      if (searchData.files && searchData.files.length > 0) {
        return searchData.files[0].id;
      }
    }

    // 2. Folder does not exist, create it inside parentFolderId
    const createRes = await fetch('https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id,name', {
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
 * @param {string} [params.dateString] - Custom date string for subfolder (defaults to today YYYY-MM-DD)
 * @returns {Promise<{ success: boolean, fileId: string, name: string, webViewLink: string, webContentLink: string, parentFolderId?: string, dateFolder?: string }>}
 */
export async function uploadToGoogleDrive({
  name,
  mimeType = 'application/octet-stream',
  data,
  folderType = 'shipments',
  folderId,
  useDateFolder = true,
  dateString
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

    const metadata = {
      name,
      parents: targetFolder ? [targetFolder] : [GOOGLE_DRIVE_CONFIG.sharedDriveId]
    };

    const boundary = '-------mdc_boundary_' + Math.random().toString(36).substring(2);
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelim = `\r\n--${boundary}--`;

    let fileBytes;
    if (typeof data === 'string') {
      fileBytes = new TextEncoder().encode(data);
    } else if (data instanceof ArrayBuffer) {
      fileBytes = new Uint8Array(data);
    } else if (data instanceof Uint8Array) {
      fileBytes = data;
    } else if (typeof Blob !== 'undefined' && data instanceof Blob) {
      const buf = await data.arrayBuffer();
      fileBytes = new Uint8Array(buf);
    } else {
      fileBytes = new TextEncoder().encode(JSON.stringify(data));
    }

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

    const uploadRes = await fetch(
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

    return {
      success: true,
      fileId: result.id,
      name: result.name,
      webViewLink: result.webViewLink,
      webContentLink: result.webContentLink,
      parentFolderId: targetFolder,
      dateFolder: resolvedDateFolderName
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
