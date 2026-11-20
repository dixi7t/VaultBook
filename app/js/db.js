/* OfflineBooks US — IndexedDB storage.
 * Registry database "OfflineBooksUS" lists companies; each company lives in its own
 * database "OfflineBooksUS_<companyId>" so companies are fully independent.
 */
(function (root) {
  'use strict';
  var OB = root.OB = root.OB || {};
  var DB = OB.db = {};
  var REGISTRY = 'OfflineBooksUS';
  var REGISTRY_VERSION = 1;
  var COMPANY_DB_VERSION = 6;

  /* IndexedDB structural upgrades, keyed by the version they upgrade TO. */
  var COMPANY_UPGRADES = {
    1: function (db) {
      db.createObjectStore('company', { keyPath: 'id' });
      db.createObjectStore('accounts', { keyPath: 'id' });
      db.createObjectStore('contacts', { keyPath: 'id' });
      var tx = db.createObjectStore('transactions', { keyPath: 'id' });
      tx.createIndex('date', 'date');
      tx.createIndex('type', 'type');
      db.createObjectStore('rules', { keyPath: 'id' });
      db.createObjectStore('recurring', { keyPath: 'id' });
      db.createObjectStore('reconciliations', { keyPath: 'id' });
      db.createObjectStore('audit', { keyPath: 'id' });
    },
    // v2 (app 1.3): unencrypted 'meta' store for the password-protection record (wrapped keys only)
    2: function (db) { db.createObjectStore('meta', { keyPath: 'key' }); },
    // v3 (app 1.7): classes, budgets and saved (memorized) reports
    3: function (db) { ['classes', 'budgets', 'reports'].forEach(function (s) { if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' }); }); },
    // v4 (app 1.9): products & services (items)
    4: function (db) { if (!db.objectStoreNames.contains('items')) db.createObjectStore('items', { keyPath: 'id' }); },
    // v5 (app 1.16): file attachments (receipts, bills) as data URLs
    5: function (db) { if (!db.objectStoreNames.contains('attachments')) db.createObjectStore('attachments', { keyPath: 'id' }); },
    // v6 (app 1.20): bank feed lines and import history
    6: function (db) { ['bankLines', 'bankImports'].forEach(function (s) { if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' }); }); }
  };

  function req2p(r) { return new Promise(function (res, rej) { r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); }; }); }

  DB.available = function () {
    try { return !!root.indexedDB; } catch (e) { return false; }
  };

  function open(name, version, upgrades) {
    return new Promise(function (resolve, reject) {
      var r;
      try { r = root.indexedDB.open(name, version); } catch (e) { reject(e); return; }
      r.onupgradeneeded = function (ev) {
        var db = r.result;
        for (var v = ev.oldVersion + 1; v <= version; v++) if (upgrades[v]) upgrades[v](db, r.transaction);
      };
      r.onsuccess = function () {
        var db = r.result;
        db.onversionchange = function () { db.close(); if (root.OB.ui && OB.ui.onVersionChange) OB.ui.onVersionChange(); };
        resolve(db);
      };
      r.onerror = function () { reject(r.error || new Error('Could not open database ' + name)); };
      r.onblocked = function () { reject(new Error('The database is open in another tab with an older version. Close other VaultBook tabs and reload.')); };
    });
  }

  var registryDb = null;
  DB.registry = function () {
    if (registryDb) return Promise.resolve(registryDb);
    return open(REGISTRY, REGISTRY_VERSION, {
      1: function (db) { db.createObjectStore('companies', { keyPath: 'id' }); db.createObjectStore('settings', { keyPath: 'key' }); }
    }).then(function (db) { registryDb = db; return db; });
  };
  DB.listCompanies = function () {
    return DB.registry().then(function (db) { return req2p(db.transaction('companies').objectStore('companies').getAll()); })
      .then(function (list) { return list.filter(function (c) { return !c.deleted; }).sort(function (a, b) { return (b.lastOpened || '').localeCompare(a.lastOpened || ''); }); });
  };
  DB.registerCompany = function (entry) {
    return DB.registry().then(function (db) {
      var tx = db.transaction('companies', 'readwrite'); tx.objectStore('companies').put(entry);
      return new Promise(function (res, rej) { tx.oncomplete = res; tx.onerror = function () { rej(tx.error); }; });
    });
  };
  DB.getSetting = function (key) {
    return DB.registry().then(function (db) { return req2p(db.transaction('settings').objectStore('settings').get(key)); }).then(function (r) { return r ? r.value : undefined; });
  };
  DB.setSetting = function (key, value) {
    return DB.registry().then(function (db) {
      var tx = db.transaction('settings', 'readwrite'); tx.objectStore('settings').put({ key: key, value: value });
      return new Promise(function (res, rej) { tx.oncomplete = res; tx.onerror = function () { rej(tx.error); }; });
    });
  };
  DB.dbName = function (companyId) { return 'OfflineBooksUS_' + companyId; };

  /** Adapter used by OB.Book: one atomic IndexedDB transaction per putMany. */
  function CompanyAdapter(db, companyId) { this.db = db; this.companyId = companyId; }
  /* When this.key (the company data key) is set, every record except 'meta' is stored
     AES-GCM encrypted as { id, enc }. Encryption happens before the IndexedDB transaction
     opens, because IndexedDB transactions auto-commit across awaits. */
  CompanyAdapter.prototype.putMany = function (ops) {
    var self = this, key = this.key;
    var prep = !key ? Promise.resolve(ops) : Promise.all(ops.map(function (o) {
      if (o.del !== undefined || o.store === 'meta') return o;
      return OB.sec.encryptJson(key, o.value, o.store + '/' + o.value.id).then(function (e) { return { store: o.store, value: { id: o.value.id, enc: e } }; });
    }));
    return prep.then(function (ready) {
      return new Promise(function (resolve, reject) {
        var stores = [];
        ready.forEach(function (o) { if (stores.indexOf(o.store) < 0) stores.push(o.store); });
        var tx;
        try { tx = self.db.transaction(stores, 'readwrite'); } catch (e) { reject(e); return; }
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error || new Error('Write failed')); };
        tx.onabort = function () { reject(tx.error || new Error('Write aborted (storage may be full).')); };
        try { ready.forEach(function (o) { if (o.del !== undefined) tx.objectStore(o.store).delete(o.del); else tx.objectStore(o.store).put(o.value); }); }
        catch (e) { try { tx.abort(); } catch (x) { /* ignore */ } reject(e); }
      });
    });
  };
  CompanyAdapter.prototype.getSecurity = function () {
    var db = this.db;
    if (!db.objectStoreNames.contains('meta')) return Promise.resolve(null);
    return req2p(db.transaction('meta').objectStore('meta').get('security')).then(function (r) { return r || null; });
  };
  CompanyAdapter.prototype.loadAll = function () {
    var db = this.db, key = this.key;
    var stores = ['company'].concat(OB.STORES);
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(stores, 'readonly'), out = {};
      stores.forEach(function (s) { tx.objectStore(s).getAll().onsuccess = function (e) { out[s] = e.target.result; }; });
      tx.oncomplete = function () { resolve(out); };
      tx.onerror = function () { reject(tx.error); };
    }).then(function (raw) {
      var jobs = [];
      stores.forEach(function (s) {
        raw[s].forEach(function (r, i) {
          if (!r || !r.enc) return;
          if (!key) { var e = new Error('This company is password protected.'); e.code = 'LOCKED'; throw e; }
          jobs.push(OB.sec.decryptJson(key, r.enc, s + '/' + r.id).then(function (v) { raw[s][i] = v; }));
        });
      });
      return Promise.all(jobs).then(function () { raw.company = raw.company && raw.company[0]; return raw; });
    });
  };
  CompanyAdapter.prototype.close = function () { try { this.db.close(); } catch (e) { /* ignore */ } };
  OB.CompanyAdapter = CompanyAdapter;

  DB.openCompanyAdapter = function (companyId, key) {
    return open(DB.dbName(companyId), COMPANY_DB_VERSION, COMPANY_UPGRADES).then(function (db) { var a = new CompanyAdapter(db, companyId); a.key = key || null; return a; });
  };
  /** Read the (unencrypted) protection record without unlocking. null = not protected. */
  DB.getSecurity = function (companyId) {
    return DB.openCompanyAdapter(companyId).then(function (a) { return a.getSecurity().then(function (s) { a.close(); return s; }); });
  };

  /** Create a brand-new company database. */
  DB.createCompany = function (opts) {
    var tmpId = null;
    return Promise.resolve().then(function () {
      var company = OB.schema.newCompany(opts);
      tmpId = company.id;
      return DB.openCompanyAdapter(company.id).then(function (adapter) {
        var data = { company: company, accounts: OB.schema.defaultAccounts(), contacts: [], transactions: [], rules: [], recurring: [], reconciliations: [], audit: [], classes: [], budgets: [], reports: [], items: [], attachments: [], bankLines: [], bankImports: [] };
        var book = new OB.Book(adapter, data);
        var ops = [{ store: 'company', value: company }];
        data.accounts.forEach(function (a) { ops.push({ store: 'accounts', value: a }); });
        var a0 = book._auditEntry('create-company', null, 'Company created: ' + company.name); book.audit.push(a0);
        ops.push({ store: 'audit', value: a0 });
        return adapter.putMany(ops).then(function () {
          return DB.registerCompany({ id: company.id, name: company.name, createdAt: company.createdAt, lastOpened: new Date().toISOString() });
        }).then(function () { return book; });
      });
    });
  };

  /** Load a company fully into memory (fast reports for 20k+ transactions). */
  DB.loadCompany = function (companyId, key) {
    return DB.openCompanyAdapter(companyId, key).then(function (adapter) {
      return Promise.all([adapter.loadAll(), adapter.getSecurity()]).then(function (res) {
        var data = res[0], security = res[1];
        if (security && !key) { adapter.close(); var le = new Error('This company is password protected.'); le.code = 'LOCKED'; throw le; }
        if (!data.company) throw new Error('Company data is missing or damaged. Restore it from a backup.');
        var before = data.company.dataVersion;
        var applied = OB.schema.migrate(data);
        var book = new OB.Book(adapter, data);
        var p = Promise.resolve();
        if (applied.length) {
          // persist migrated records in one atomic write
          var ops = [{ store: 'company', value: data.company }];
          OB.STORES.forEach(function (s) { (data[s] || []).forEach(function (v) { ops.push({ store: s, value: v }); }); });
          p = adapter.putMany(ops);
        }
        return p.then(function () {
          return DB.registerCompany({ id: data.company.id, name: data.company.name, createdAt: data.company.createdAt, lastOpened: new Date().toISOString(), protected: !!security });
        }).then(function () { book.migratedFrom = applied.length ? before : null; book.security = security; book.dek = key || null; return book; });
      });
    });
  };

  /** Write a full dataset into a fresh company database (used by restore). */
  DB.writeCompanyData = function (data, prot) {
    return new Promise(function (resolve, reject) {
      var r = root.indexedDB.deleteDatabase(DB.dbName(data.company.id));
      r.onsuccess = r.onerror = function () { resolve(); };
      r.onblocked = function () { reject(new Error('Close other tabs using this company, then try again.')); };
    }).then(function () { return DB.openCompanyAdapter(data.company.id, prot ? prot.dek : null); }).then(function (adapter) {
      var ops = [{ store: 'company', value: data.company }];
      if (prot) ops.push({ store: 'meta', value: prot.security });
      OB.STORES.forEach(function (s) { (data[s] || []).forEach(function (v) { ops.push({ store: s, value: v }); }); });
      return adapter.putMany(ops).then(function () {
        adapter.close();
        return DB.registerCompany({ id: data.company.id, name: data.company.name, createdAt: data.company.createdAt, lastOpened: new Date().toISOString(), protected: !!prot });
      });
    });
  };

  /* ---------------- password protection ---------------- */
  // Run inside the book's write queue so nothing else is writing while keys change.
  function exclusive(book, fn) { var p = book._queue.then(fn); book._queue = p.catch(function () {}); return p; }
  function allOps(book) {
    var ops = [{ store: 'company', value: book.company }];
    OB.STORES.forEach(function (s) { book[s].forEach(function (v) { ops.push({ store: s, value: v }); }); });
    return ops;
  }
  function audit(book, action, summary) { var a = book._auditEntry(action, null, summary); return a; }
  function reg(book, prot) { return DB.registerCompany({ id: book.company.id, name: book.company.name, createdAt: book.company.createdAt, lastOpened: new Date().toISOString(), protected: prot }); }

  /** Turn protection on: encrypts every record in ONE atomic write. Resolves to the recovery key. */
  DB.protect = function (book, password, opts) {
    if (book.security) return Promise.reject(new Error('This company is already password protected.'));
    var probs = OB.sec.passwordProblems(password, book.company.name);
    if (probs.length) return Promise.reject(new Error(probs.join(' ')));
    return exclusive(book, function () {
      return OB.sec.setup(password, opts).then(function (r) {
        var a = audit(book, 'security', 'Password protection turned on (company data encrypted)');
        book.audit.push(a);
        var ops = allOps(book); ops.push({ store: 'meta', value: r.security });
        book.adapter.key = r.dek;
        return book.adapter.putMany(ops).then(function () {
          book.dek = r.dek; book.security = r.security; return reg(book, true);
        }, function (e) { book.adapter.key = null; book.audit.pop(); throw e; }).then(function () { return r.recoveryKey; });
      });
    });
  };
  /** Turn protection off: verifies the password, then rewrites everything unencrypted (atomic). */
  DB.unprotect = function (book, password) {
    if (!book.security) return Promise.reject(new Error('This company is not password protected.'));
    return exclusive(book, function () {
      return OB.sec.unlock(book.security, password).then(function () {
        var a = audit(book, 'security', 'Password protection turned off (company data decrypted)');
        book.audit.push(a);
        var ops = allOps(book); ops.push({ store: 'meta', del: 'security' });
        var oldKey = book.adapter.key; book.adapter.key = null;
        return book.adapter.putMany(ops).then(function () { book.dek = null; book.security = null; return reg(book, false); },
          function (e) { book.adapter.key = oldKey; book.audit.pop(); throw e; });
      });
    });
  };
  function saveSecurity(book, sec, summary) {
    var a = audit(book, 'security', summary);
    return book.adapter.putMany([{ store: 'meta', value: sec }, { store: 'audit', value: a }]).then(function () { book.security = sec; book.audit.push(a); });
  }
  /** Change password (current password required). Only the data key's wrapper changes. */
  DB.changePassword = function (book, current, next) {
    var probs = OB.sec.passwordProblems(next, book.company.name);
    if (probs.length) return Promise.reject(new Error(probs.join(' ')));
    return exclusive(book, function () {
      return OB.sec.unlock(book.security, current).then(function () { return OB.sec.wrap(book.dek, next); }).then(function (w) {
        var sec = Object.assign({}, book.security, { password: w, changedAt: new Date().toISOString() });
        return saveSecurity(book, sec, 'Company password changed');
      });
    });
  };
  /** After unlocking with the recovery key: set a new password AND issue a new recovery key. */
  DB.resetAfterRecovery = function (book, next, hint) {
    var probs = OB.sec.passwordProblems(next, book.company.name);
    if (probs.length) return Promise.reject(new Error(probs.join(' ')));
    var rk = OB.sec.newRecoveryKey();
    return exclusive(book, function () {
      return Promise.all([OB.sec.wrap(book.dek, next), OB.sec.wrap(book.dek, OB.sec.normalizeRecoveryKey(rk), OB.sec.RECOVERY_ITERATIONS)]).then(function (w) {
        var sec = Object.assign({}, book.security, { password: w[0], recovery: w[1], hint: hint === undefined ? book.security.hint : hint, changedAt: new Date().toISOString() });
        return saveSecurity(book, sec, 'Password reset using the recovery key; new recovery key issued');
      }).then(function () { return rk; });
    });
  };
  /** New recovery key (password required). The old recovery key stops working. */
  DB.newRecoveryKey = function (book, password) {
    var rk = OB.sec.newRecoveryKey();
    return exclusive(book, function () {
      return OB.sec.unlock(book.security, password).then(function () { return OB.sec.wrap(book.dek, OB.sec.normalizeRecoveryKey(rk), OB.sec.RECOVERY_ITERATIONS); }).then(function (w) {
        return saveSecurity(book, Object.assign({}, book.security, { recovery: w }), 'New recovery key issued (previous one revoked)');
      }).then(function () { return rk; });
    });
  };
  DB.setSecurityOptions = function (book, opts) {
    return exclusive(book, function () {
      var sec = Object.assign({}, book.security);
      if (opts.hint !== undefined) sec.hint = String(opts.hint).slice(0, 100);
      if (opts.autoLockMinutes !== undefined) sec.autoLockMinutes = Math.max(0, +opts.autoLockMinutes || 0);
      return saveSecurity(book, sec, 'Security options updated');
    });
  };

  DB.deleteCompany = function (companyId) {
    return DB.registry().then(function (db) {
      var tx = db.transaction('companies', 'readwrite'); tx.objectStore('companies').delete(companyId);
      return new Promise(function (res) { tx.oncomplete = res; });
    }).then(function () {
      return new Promise(function (resolve) { var r = root.indexedDB.deleteDatabase(DB.dbName(companyId)); r.onsuccess = r.onerror = r.onblocked = function () { resolve(); }; });
    });
  };

  DB.storageInfo = function () {
    var nav = root.navigator;
    var info = { persisted: null, usage: null, quota: null };
    if (!nav || !nav.storage) return Promise.resolve(info);
    var p1 = nav.storage.persisted ? nav.storage.persisted().then(function (v) { info.persisted = v; }).catch(function () {}) : Promise.resolve();
    var p2 = nav.storage.estimate ? nav.storage.estimate().then(function (e) { info.usage = e.usage; info.quota = e.quota; }).catch(function () {}) : Promise.resolve();
    return Promise.all([p1, p2]).then(function () { return info; });
  };
  DB.requestPersistence = function () {
    var nav = root.navigator;
    if (!nav || !nav.storage || !nav.storage.persist) return Promise.resolve(false);
    return nav.storage.persist().catch(function () { return false; });
  };
})(typeof window !== 'undefined' ? window : globalThis);
