/* VaultBook — connection secrets (1.58.0): where keys for outside services (for example a SimpleFIN Access URL) are kept.
 *
 * - Separate from the books: a database of its own ("VaultBookSecrets"), never part of a company, so a secret is never
 *   in a backup, an export, a QuickBooks file or anything else VaultBook writes out.
 * - Encrypted at rest with AES-GCM under a device key the browser generates as NON-EXTRACTABLE: code can ask the
 *   browser to decrypt with it, but can never read the key itself, so the stored bytes are useless off this device.
 * - Listing returns names and dates only. Each record belongs to one company and can be removed (revoked) at any time.
 * - Limits, stated plainly: a script that runs inside VaultBook could still ask for a secret while the page is open.
 *   That is why the page's security policy forbids inline and injected scripts (see index.src.html).
 * Classic script; works in browsers and in Node (tests swap in an in-memory store with OB.secrets._useStore).
 */
(function (root) {
  'use strict';
  var OB = root.OB = root.OB || {};
  var subtle = root.crypto && root.crypto.subtle;
  var DB = 'VaultBookSecrets', KEY_ID = 'device-key';

  /* ---------- storage: IndexedDB in the browser, a Map in tests ---------- */
  function idbStore() {
    var dbp = null;
    function db() {
      if (!dbp) dbp = new Promise(function (res, rej) {
        var r = root.indexedDB.open(DB, 1);
        r.onupgradeneeded = function () { var d = r.result; d.createObjectStore('keys'); d.createObjectStore('secrets', { keyPath: 'id' }); };
        r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); };
      });
      return dbp;
    }
    function tx(store, mode, fn) {
      return db().then(function (d) { return new Promise(function (res, rej) {
        var t = d.transaction(store, mode), s = t.objectStore(store), out = fn(s);
        t.oncomplete = function () { res(out && 'result' in out ? out.result : undefined); }; t.onerror = function () { rej(t.error); }; t.onabort = function () { rej(t.error); };
      }); });
    }
    return {
      getKey: function () { return tx('keys', 'readonly', function (s) { return s.get(KEY_ID); }); },
      putKey: function (k) { return tx('keys', 'readwrite', function (s) { return s.put(k, KEY_ID); }); },
      get: function (id) { return tx('secrets', 'readonly', function (s) { return s.get(id); }); },
      put: function (rec) { return tx('secrets', 'readwrite', function (s) { return s.put(rec); }); },
      del: function (id) { return tx('secrets', 'readwrite', function (s) { return s.delete(id); }); },
      all: function () { return tx('secrets', 'readonly', function (s) { return s.getAll(); }); }
    };
  }
  function memoryStore() {
    var keys = new Map(), recs = new Map();
    return {
      getKey: function () { return Promise.resolve(keys.get(KEY_ID)); },
      putKey: function (k) { keys.set(KEY_ID, k); return Promise.resolve(); },
      get: function (id) { return Promise.resolve(recs.get(id)); },
      put: function (rec) { recs.set(rec.id, rec); return Promise.resolve(); },
      del: function (id) { recs.delete(id); return Promise.resolve(); },
      all: function () { return Promise.resolve(Array.from(recs.values())); },
      _raw: recs
    };
  }
  var store = null;
  function st() { if (!store) store = root.indexedDB ? idbStore() : memoryStore(); return store; }

  /* ---------- the device key ---------- */
  var keyP = null;
  function deviceKey() {
    if (!keyP) keyP = st().getKey().then(function (k) {
      if (k) return k;
      return subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])   // false = not extractable
        .then(function (nk) { return st().putKey(nk).then(function () { return nk; }); });
    });
    return keyP;
  }
  var enc = function (s) { return new TextEncoder().encode(s); };
  var dec = function (b) { return new TextDecoder().decode(b); };
  function aad(rec) { return enc('vaultbook-secret|' + rec.id + '|' + rec.companyId + '|' + rec.kind); }   // binds the bytes to this record

  function clean(rec) { return { id: rec.id, companyId: rec.companyId, kind: rec.kind, label: rec.label, createdAt: rec.createdAt, lastUsedAt: rec.lastUsedAt || '' }; }

  var S = OB.secrets = {
    /** True when this browser can keep secrets (WebCrypto plus IndexedDB, or the test store). */
    available: function () { return !!subtle && (!!root.indexedDB || !!store); },
    /** Save (or replace) a secret. info: { companyId, kind, label }. Resolves with the record, without the value. */
    put: function (id, value, info) {
      info = info || {};
      if (!id || typeof value !== 'string' || !value) return Promise.reject(new Error('A secret needs an id and a value.'));
      var rec = { id: String(id), companyId: String(info.companyId || ''), kind: String(info.kind || 'other'), label: String(info.label || id), createdAt: new Date().toISOString() };
      var iv = root.crypto.getRandomValues(new Uint8Array(12));
      return deviceKey().then(function (k) { return subtle.encrypt({ name: 'AES-GCM', iv: iv, additionalData: aad(rec) }, k, enc(value)); })
        .then(function (ct) { rec.iv = Array.from(iv); rec.data = new Uint8Array(ct); return st().put(rec); })
        .then(function () { return clean(rec); });
    },
    /** The decrypted value, or null when there is no such secret. */
    get: function (id) {
      return st().get(String(id)).then(function (rec) {
        if (!rec) return null;
        return deviceKey().then(function (k) { return subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(rec.iv), additionalData: aad(rec) }, k, rec.data); })
          .then(function (pt) { rec.lastUsedAt = new Date().toISOString(); return st().put(rec).then(function () { return dec(pt); }); });
      });
    },
    /** Names and dates of the stored secrets (never the values), optionally for one company, newest first. */
    list: function (companyId) {
      return st().all().then(function (all) {
        return (all || []).filter(function (r) { return companyId === undefined || r.companyId === companyId; }).map(clean)
          .sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; });
      });
    },
    /** Remove one secret (revoke it on this device). */
    remove: function (id) { return st().del(String(id)); },
    /** Remove every secret of a company (used when a company is deleted). */
    removeCompany: function (companyId) {
      return S.list(companyId).then(function (list) { return Promise.all(list.map(function (r) { return st().del(r.id); })); });
    },
    _useStore: function (s) { store = s || memoryStore(); keyP = null; return store; },
    _memoryStore: memoryStore
  };
})(typeof window !== 'undefined' ? window : globalThis);
