/**
 * MDC System 2 - High-Capacity IndexedDB Persistent Storage Engine
 * Provides robust, non-volatile database storage that survives page refreshes and browser restarts.
 */

const DB_NAME = 'MDC_SYSTEM_DB';
const DB_VERSION = 1;
const STORE_APP_STATE = 'app_state';
const STORE_SAVED_RECORDS = 'saved_records';

class DbStorage {
  constructor() {
    this.db = null;
    this.initPromise = null;
  }

  async getDb() {
    if (this.db) return this.db;
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise((resolve) => {
      if (typeof window === 'undefined' || !window.indexedDB) {
        resolve(null);
        return;
      }

      const request = window.indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_APP_STATE)) {
          db.createObjectStore(STORE_APP_STATE, { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains(STORE_SAVED_RECORDS)) {
          db.createObjectStore(STORE_SAVED_RECORDS, { keyPath: 'id' });
        }
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        resolve(this.db);
      };

      request.onerror = (event) => {
        console.warn('[IndexedDB] Failed to open database, falling back to LocalStorage:', event.target.error);
        resolve(null);
      };
    });

    return this.initPromise;
  }

  // --- APP STATE KEY-VALUE OPERATIONS ---

  async getItem(key, fallbackValue = null) {
    try {
      const db = await this.getDb();
      if (db) {
        const tx = db.transaction(STORE_APP_STATE, 'readonly');
        const store = tx.objectStore(STORE_APP_STATE);
        const req = store.get(key);
        const result = await new Promise((resolve) => {
          req.onsuccess = () => resolve(req.result ? req.result.value : null);
          req.onerror = () => resolve(null);
        });
        if (result !== null && result !== undefined) return result;
      }
    } catch (err) {
      console.warn(`[IndexedDB] Read error for ${key}:`, err);
    }

    // Fallback to localStorage
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const raw = window.localStorage.getItem(key);
        if (raw !== null && raw !== undefined) {
          return JSON.parse(raw);
        }
      }
    } catch (err) {
      console.debug('LocalStorage read fallback note:', err);
    }

    return fallbackValue;
  }

  async setItem(key, value) {
    // 1. Always attempt fast sync to localStorage
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(key, JSON.stringify(value));
      }
    } catch (err) {
      console.debug('LocalStorage quota note:', err);
    }

    // 2. Persist to IndexedDB
    try {
      const db = await this.getDb();
      if (db) {
        const tx = db.transaction(STORE_APP_STATE, 'readwrite');
        const store = tx.objectStore(STORE_APP_STATE);
        store.put({ key, value, updated_at: new Date().toISOString() });
        await new Promise((resolve) => {
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => resolve(false);
        });
      }
    } catch (err) {
      console.warn(`[IndexedDB] Write error for ${key}:`, err);
    }
  }

  async removeItem(key) {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem(key);
      }
    } catch (err) {
      console.debug('LocalStorage remove note:', err);
    }

    try {
      const db = await this.getDb();
      if (db) {
        const tx = db.transaction(STORE_APP_STATE, 'readwrite');
        const store = tx.objectStore(STORE_APP_STATE);
        store.delete(key);
      }
    } catch (err) {
      console.warn(`[IndexedDB] Delete error for ${key}:`, err);
    }
  }

  // --- SAVED PERIOD RECORDS (PERMANENT ARCHIVE) ---

  async getAllSavedRecords() {
    try {
      const db = await this.getDb();
      if (db) {
        const tx = db.transaction(STORE_SAVED_RECORDS, 'readonly');
        const store = tx.objectStore(STORE_SAVED_RECORDS);
        const req = store.getAll();
        const records = await new Promise((resolve) => {
          req.onsuccess = () => resolve(req.result || []);
          req.onerror = () => resolve([]);
        });
        if (records && records.length > 0) {
          return records.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        }
      }
    } catch (err) {
      console.warn('[IndexedDB] Failed to get saved records:', err);
    }

    // Fallback to localStorage
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const raw = window.localStorage.getItem('mdc_saved_records');
        if (raw) return JSON.parse(raw);
      }
    } catch (err) {
      console.debug('LocalStorage saved records read note:', err);
    }

    return [];
  }

  async putSavedRecord(record) {
    if (!record || !record.id) return;

    try {
      const db = await this.getDb();
      if (db) {
        const tx = db.transaction(STORE_SAVED_RECORDS, 'readwrite');
        const store = tx.objectStore(STORE_SAVED_RECORDS);
        store.put(record);
      }
    } catch (err) {
      console.warn('[IndexedDB] Failed to save record:', err);
    }

    // Also update localStorage
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const existing = JSON.parse(window.localStorage.getItem('mdc_saved_records') || '[]');
        const updated = [record, ...existing.filter(r => r.id !== record.id)].slice(0, 50);
        window.localStorage.setItem('mdc_saved_records', JSON.stringify(updated));
      }
    } catch (err) {
      console.debug('LocalStorage put saved record note:', err);
    }
  }

  async deleteSavedRecord(recordId) {
    if (!recordId) return;

    try {
      const db = await this.getDb();
      if (db) {
        const tx = db.transaction(STORE_SAVED_RECORDS, 'readwrite');
        const store = tx.objectStore(STORE_SAVED_RECORDS);
        store.delete(recordId);
      }
    } catch (err) {
      console.warn('[IndexedDB] Failed to delete saved record:', err);
    }

    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const existing = JSON.parse(window.localStorage.getItem('mdc_saved_records') || '[]');
        const updated = existing.filter(r => r.id !== recordId);
        window.localStorage.setItem('mdc_saved_records', JSON.stringify(updated));
      }
    } catch (err) {
      console.debug('LocalStorage delete saved record note:', err);
    }
  }
}

export const dbStorage = new DbStorage();
export default dbStorage;
