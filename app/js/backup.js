/* OfflineBooks US — full company backup (JSON) and validated restore. */
(function (root) {
  'use strict';
  var OB = root.OB = root.OB || {};
  var U = OB.util, S = OB.schema;
  var B = OB.backup = {};

  function checksum(data) {
    var s = U.stableStringify(data);
    var bytes = typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(s) : Buffer.from(s, 'utf8');
    return 'crc32:' + U.crc32(bytes).toString(16).padStart(8, '0') + '-fnv:' + U.fnv(s) + '-len:' + s.length;
  }
  B.checksum = checksum;

  B.create = function (book) {
    var data = book.exportData();
    return {
      format: S.BACKUP_FORMAT,
      appVersion: S.APP_VERSION,
      dataVersion: data.company.dataVersion,
      createdAt: new Date().toISOString(),
      companyName: data.company.name,
      counts: { accounts: data.accounts.length, contacts: data.contacts.length, transactions: data.transactions.length, auditEntries: data.audit.length },
      checksum: checksum(data),
      data: data
    };
  };
  /** Backup of a protected company: the whole backup is encrypted with the company's data key.
   *  The file carries only the password- and recovery-wrapped key, so it opens with either. */
  B.createEncrypted = function (book) {
    if (!book.dek || !book.security) return Promise.reject(new Error('This company is not password protected.'));
    var inner = B.create(book);
    return OB.sec.encryptJson(book.dek, inner, 'backup').then(function (e) {
      return {
        format: S.BACKUP_FORMAT, encrypted: true, appVersion: S.APP_VERSION, createdAt: inner.createdAt, companyName: inner.companyName,
        security: { version: book.security.version, cipher: book.security.cipher, password: book.security.password, recovery: book.security.recovery, hint: book.security.hint, autoLockMinutes: book.security.autoLockMinutes, enabledAt: book.security.enabledAt, changedAt: book.security.changedAt },
        payload: { iv: OB.sec.b64(e.iv), ct: OB.sec.b64(e.ct) }
      };
    });
  };
  /** Decrypt an encrypted backup with the password (or recovery key). Resolves { inner, dek, security }. */
  B.decrypt = function (obj, secret, mode) {
    if (!obj || !obj.encrypted || !obj.security || !obj.payload) return Promise.reject(new Error('This is not an encrypted backup.'));
    return OB.sec.unlock(obj.security, secret, mode).then(function (dek) {
      return OB.sec.decryptJson(dek, { iv: OB.sec.unb64(obj.payload.iv), ct: OB.sec.unb64(obj.payload.ct) }, 'backup').then(function (inner) {
        return { inner: inner, dek: dek, security: Object.assign({ key: 'security' }, obj.security) };
      });
    });
  };
  B.fileName = function (book) {
    var d = new Date();
    var stamp = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0') + '_' + String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0');
    return 'VaultBook_' + U.safeFileName(book.company.name) + '_' + stamp + '.json';
  };

  /**
   * Validate a parsed backup. Returns { ok, errors[], warnings[], data, summary }.
   * Never mutates the input; the returned data is migrated to the current schema.
   */
  B.validate = function (obj) {
    var errors = [], warnings = [];
    if (!obj || typeof obj !== 'object') return { ok: false, errors: ['The file is not a valid JSON backup.'], warnings: [] };
    if (obj.encrypted) return { ok: false, needsPassword: true, errors: ['This backup is password protected. Enter the company password to open it.'], warnings: [] };
    if (obj.format !== S.BACKUP_FORMAT) return { ok: false, errors: ['This file is not a VaultBook (OfflineBooks US) backup (missing format marker).'], warnings: [] };
    if (!obj.data || !obj.data.company) return { ok: false, errors: ['The backup does not contain company data.'], warnings: [] };
    if (obj.checksum && checksum(obj.data) !== obj.checksum) errors.push('Checksum mismatch: the backup file was modified or damaged after it was created.');
    if (!obj.checksum) warnings.push('The backup has no checksum; its integrity cannot be verified.');
    var data = U.clone(obj.data);
    OB.STORES.forEach(function (s) { if (!Array.isArray(data[s])) data[s] = []; });
    try { var applied = S.migrate(data); if (applied.length) warnings.push('Upgraded data format: ' + applied.join(', ') + '.'); }
    catch (e) { errors.push(e.message); return { ok: false, errors: errors, warnings: warnings }; }

    // structural checks
    var ids = {};
    var dupCheck = function (store) { data[store].forEach(function (x) { if (!x || !x.id) errors.push('A record in ' + store + ' has no id.'); else if (ids[x.id]) errors.push('Duplicate id ' + x.id + ' in ' + store + '.'); else ids[x.id] = store; }); };
    OB.STORES.forEach(dupCheck);
    var acc = U.byKey(data.accounts, 'id'), con = U.byKey(data.contacts, 'id'), txs = U.byKey(data.transactions, 'id');
    ['AR', 'AP', 'OBE', 'RE'].forEach(function (code) { if (!data.accounts.some(function (a) { return a.system === code; })) errors.push('Required system account ' + code + ' is missing.'); });
    data.accounts.forEach(function (a) { if (!S.TYPE[a.type]) errors.push('Account "' + a.name + '" has an unknown type ' + a.type + '.'); });
    var unbalanced = 0;
    data.transactions.forEach(function (t) {
      var label = (S.TXN_TYPES[t.type] ? S.TXN_TYPES[t.type].label : t.type) + ' ' + (t.number || t.id);
      if (!S.TXN_TYPES[t.type]) { errors.push('Unknown transaction type in ' + label + '.'); return; }
      if (!U.isDate(t.date)) errors.push(label + ' has an invalid date.');
      if (!Array.isArray(t.splits)) { errors.push(label + ' has no journal lines.'); return; }
      var sum = 0;
      t.splits.forEach(function (s) {
        if (!acc[s.accountId]) errors.push(label + ' references a missing account.');
        if (!Number.isInteger(s.amount)) errors.push(label + ' has a non-integer amount.');
        if (s.contactId && !con[s.contactId]) errors.push(label + ' references a missing customer/vendor.');
        sum += s.amount;
      });
      if (t.status === 'posted' && sum !== 0) unbalanced++;
      (t.applications || []).forEach(function (a) { if (!txs[a.txnId]) errors.push(label + ' is applied to a missing transaction.'); });
    });
    if (unbalanced) errors.push(unbalanced + ' posted transaction(s) do not balance.');
    if (errors.length) return { ok: false, errors: errors, warnings: warnings };

    // full accounting integrity check on an in-memory copy
    var book;
    try { book = new OB.Book(new OB.MemoryAdapter(), U.clone(data)); }
    catch (e) { return { ok: false, errors: ['Could not load the backup: ' + e.message], warnings: warnings }; }
    var integ = book.checkIntegrity();
    integ.issues.forEach(function (i) { errors.push(i); });
    return {
      ok: errors.length === 0, errors: errors, warnings: warnings, data: data, integrity: integ,
      summary: { companyName: data.company.name, createdAt: obj.createdAt, appVersion: obj.appVersion, accounts: data.accounts.length, contacts: data.contacts.length, transactions: data.transactions.length }
    };
  };

  /** Prepare validated data for restore. mode: 'replace' keeps the company id; 'copy' creates a new company. */
  B.prepareRestore = function (data, mode, newName) {
    var d = U.clone(data);
    if (mode === 'copy') {
      d.company.id = U.uid('co');
      d.company.name = newName || (d.company.name + ' (restored)');
      d.company.createdAt = new Date().toISOString();
    }
    OB.Book.chainAudit(d.audit, { id: U.uid('aud'), ts: new Date().toISOString(), action: 'restore', txnId: '', summary: 'Restored from backup (' + (mode === 'copy' ? 'as new company' : 'replacing existing data') + ')', before: null });
    return d;
  };
})(typeof window !== 'undefined' ? window : globalThis);
