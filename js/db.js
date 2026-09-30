/* ==========================================================================
   IndexedDB Storage Engine
   Supports session persistence with graceful LocalStorage fallback
   ========================================================================== */

import { APP_CONFIG } from './config.js';

export class LinedNotesDB {
  constructor() {
    this.dbName = APP_CONFIG.storageDbName;
    this.storeName = APP_CONFIG.storageStoreName;
    this.version = APP_CONFIG.storageDbVersion;
    this.db = null;
    this.initPromise = this.init();
  }

  async init() {
    if (!window.indexedDB) {
      return null;
    }
    return new Promise((resolve) => {
      try {
        const req = indexedDB.open(this.dbName, this.version);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains(this.storeName)) {
            db.createObjectStore(this.storeName, { keyPath: 'key' });
          }
        };
        req.onsuccess = (e) => {
          this.db = e.target.result;
          resolve(this.db);
        };
        req.onerror = () => resolve(null);
      } catch (err) {
        resolve(null);
      }
    });
  }

  async get(key) {
    await this.initPromise;
    if (!this.db) {
      const val = localStorage.getItem(key);
      return val ? JSON.parse(val) : null;
    }
    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction(this.storeName, 'readonly');
        const store = tx.objectStore(this.storeName);
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result ? req.result.data : null);
        req.onerror = () => {
          const val = localStorage.getItem(key);
          resolve(val ? JSON.parse(val) : null);
        };
      } catch (err) {
        const val = localStorage.getItem(key);
        resolve(val ? JSON.parse(val) : null);
      }
    });
  }

  async set(key, data) {
    await this.initPromise;
    if (!this.db) {
      try { localStorage.setItem(key, JSON.stringify(data)); } catch (err) { }
      return;
    }
    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction(this.storeName, 'readwrite');
        const store = tx.objectStore(this.storeName);
        store.put({ key, data, updatedAt: new Date().toISOString() });
        tx.oncomplete = () => resolve();
        tx.onerror = () => {
          try { localStorage.setItem(key, JSON.stringify(data)); } catch (err) { }
          resolve();
        };
      } catch (err) {
        try { localStorage.setItem(key, JSON.stringify(data)); } catch (e) { }
        resolve();
      }
    });
  }

  async delete(key) {
    await this.initPromise;
    try { localStorage.removeItem(key); } catch (err) { }
    if (!this.db) return;
    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction(this.storeName, 'readwrite');
        const store = tx.objectStore(this.storeName);
        store.delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch (err) {
        resolve();
      }
    });
  }

  async getAllSessions() {
    await this.initPromise;
    const sessions = [];
    if (!this.db) {
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith('ln_session_')) {
            const val = localStorage.getItem(k);
            if (val) {
              const parsed = JSON.parse(val);
              sessions.push({
                key: k,
                data: parsed,
                updatedAt: parsed.updatedAt || new Date().toISOString()
              });
            }
          }
        }
      } catch (e) { }
      return sessions;
    }

    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction(this.storeName, 'readonly');
        const store = tx.objectStore(this.storeName);
        const req = store.getAll();
        req.onsuccess = () => {
          const records = (req.result || []).filter(r => r.key && r.key.startsWith('ln_session_'));
          resolve(records);
        };
        req.onerror = () => resolve([]);
      } catch (err) {
        resolve([]);
      }
    });
  }
}
