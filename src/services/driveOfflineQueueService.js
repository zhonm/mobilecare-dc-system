/**
 * Offline Google Drive Upload Queue Service (Feature D)
 * 
 * Provides resilient IndexedDB offline queuing for Google Drive uploads
 * (Signed Packing Lists, backups, and offloaded snapshots) when provincial branches
 * or DC operators experience intermittent internet connectivity.
 * 
 * Automatically captures uploads when offline and drains the queue immediately
 * when connectivity restores.
 */

import { uploadToGoogleDrive } from './googleDriveService.js';

const DB_NAME = 'mdc_drive_offline_db';
const DB_VERSION = 1;
const STORE_NAME = 'offline_drive_queue';

let memoryQueueFallback = [];

/**
 * Opens or initializes the IndexedDB database
 */
function openOfflineQueueDb() {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }

    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('status', 'status', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      console.warn('[OfflineQueue] IndexedDB open error, falling back to memory queue:', req.error);
      resolve(null);
    };
  });
}

/**
 * Converts File or Blob to ArrayBuffer for reliable IndexedDB storage
 */
async function blobToArrayBuffer(fileOrBlob) {
  if (!fileOrBlob) return null;
  if (fileOrBlob instanceof ArrayBuffer) return fileOrBlob;
  if (fileOrBlob instanceof Uint8Array) return fileOrBlob.buffer;
  if (typeof Blob !== 'undefined' && fileOrBlob instanceof Blob) {
    return await fileOrBlob.arrayBuffer();
  }
  return fileOrBlob;
}

/**
 * Enqueues a pending upload into offline storage
 */
export async function enqueueOfflineDriveUpload({
  type = 'PMG_SIGNED_PL',
  shipmentId,
  siteFolder = 'BRANCH',
  fileName,
  mimeType = 'application/pdf',
  fileData,
  payload = {}
}) {
  const id = `drive-offline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const bufferData = await blobToArrayBuffer(fileData);

  const queueItem = {
    id,
    type,
    shipmentId,
    siteFolder,
    fileName: fileName || `Document_${Date.now()}`,
    mimeType,
    fileData: bufferData,
    payload,
    createdAt: new Date().toISOString(),
    retryCount: 0,
    status: 'pending'
  };

  try {
    const db = await openOfflineQueueDb();
    if (db) {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.put(queueItem);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } else {
      memoryQueueFallback.push(queueItem);
    }

    console.info(`[OfflineQueue] Stored pending upload "${queueItem.fileName}" (${queueItem.id})`);
    return { success: true, queueId: id, isQueuedOffline: true };
  } catch (err) {
    console.error('[OfflineQueue] Failed to enqueue item:', err);
    memoryQueueFallback.push(queueItem);
    return { success: true, queueId: id, isQueuedOffline: true, fallback: true };
  }
}

/**
 * Retrieves all pending offline items
 */
export async function getPendingOfflineUploads() {
  try {
    const db = await openOfflineQueueDb();
    if (db) {
      return await new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.getAll();
        req.onsuccess = () => {
          const items = (req.result || []).filter((item) => item.status !== 'completed');
          resolve(items);
        };
        req.onerror = () => resolve([...memoryQueueFallback]);
      });
    }
  } catch (_) {}

  return [...memoryQueueFallback];
}

/**
 * Removes an item from the offline queue upon successful sync
 */
export async function removeOfflineDriveUpload(id) {
  memoryQueueFallback = memoryQueueFallback.filter((i) => i.id !== id);
  try {
    const db = await openOfflineQueueDb();
    if (db) {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    }
  } catch (err) {
    console.warn('[OfflineQueue] Failed to remove synced item:', err);
  }
}

/**
 * Processes and drains the offline upload queue when online
 * 
 * @param {Object} options
 * @param {Function} [options.onItemSynced] - Callback called when an item is successfully uploaded: (item, result)
 * @param {Function} [options.onProgress] - Callback for overall queue progress: ({ current, total, item })
 * @returns {Promise<{ processed: number, successCount: number, errorCount: number }>}
 */
export async function processOfflineDriveQueue({ onItemSynced, onProgress } = {}) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { processed: 0, successCount: 0, errorCount: 0, isOffline: true };
  }

  const items = await getPendingOfflineUploads();
  if (!items || items.length === 0) {
    return { processed: 0, successCount: 0, errorCount: 0 };
  }

  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (onProgress) {
      onProgress({ current: i + 1, total: items.length, item });
    }

    try {
      let uploadResult = null;

      if (item.type === 'PMG_SIGNED_PL') {
        const { uploadPmgSignedPackingListToDrive } = await import('./driveAutoSyncService.js');
        uploadResult = await uploadPmgSignedPackingListToDrive({
          file: item.fileData,
          shipment: item.payload?.shipment || { id: item.shipmentId },
          site: item.payload?.site || item.siteFolder
        });
      } else {
        uploadResult = await uploadToGoogleDrive({
          name: item.fileName,
          mimeType: item.mimeType,
          data: item.fileData,
          folderType: item.payload?.folderType || 'shipments'
        });
      }

      if (uploadResult?.success) {
        successCount++;
        await removeOfflineDriveUpload(item.id);
        if (onItemSynced) {
          try {
            await onItemSynced(item, uploadResult);
          } catch (syncCallbackErr) {
            console.warn('[OfflineQueue] onItemSynced callback error:', syncCallbackErr);
          }
        }
      } else {
        errorCount++;
        item.retryCount = (item.retryCount || 0) + 1;
      }
    } catch (itemErr) {
      errorCount++;
      console.error(`[OfflineQueue] Error uploading queued item ${item.id}:`, itemErr);
    }
  }

  return {
    processed: items.length,
    successCount,
    errorCount
  };
}

let syncListenerAttached = false;

/**
 * Initializes automatic background online sync listener
 */
export function initOfflineDriveSyncListener(onItemSynced) {
  if (typeof window === 'undefined' || syncListenerAttached) return () => {};

  syncListenerAttached = true;

  const handleOnline = () => {
    console.info('[OfflineQueue] Network connection restored. Draining offline Google Drive queue...');
    processOfflineDriveQueue({ onItemSynced });
  };

  window.addEventListener('online', handleOnline);

  // Periodic polling every 45s if online
  const intervalId = setInterval(() => {
    if (typeof navigator === 'undefined' || navigator.onLine) {
      processOfflineDriveQueue({ onItemSynced });
    }
  }, 45000);

  return () => {
    window.removeEventListener('online', handleOnline);
    clearInterval(intervalId);
    syncListenerAttached = false;
  };
}
