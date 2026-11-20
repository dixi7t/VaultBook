/* OfflineBooks US — double-entry accounting engine.
 * Storage-agnostic: persists through an adapter with putMany(ops) -> Promise (atomic).
 * All money is integer cents. A split amount > 0 is a debit, < 0 is a credit.
 */
(function (root) {
  'use strict';
  var OB = root.OB = root.OB || {};
  var U = OB.util, S = OB.schema;

  function LedgerError(msg, field) { var e = new Error(msg); e.name = 'LedgerError'; e.field = field; return e; }
  OB.LedgerError = LedgerError;

  var STORES = ['accounts', 'contacts', 'transactions', 'rules', 'recurring', 'reconciliations', 'audit', 'classes', 'budgets', 'reports', 'items', 'attachments', 'bankLines', 'bankImports'];
  OB.STORES = STORES;

  function Book(adapter, data) {
    this.adapter = adapter;
    this.company = data.company;
    this.accounts = data.accounts || [];
    this.contacts = data.contacts || [];
    this.transactions = data.transactions || [];
    this.rules = data.rules || [];
    this.recurring = data.recurring || [];
    this.reconciliations = data.reconciliations || [];
    this.audit = data.audit || [];
    this.classes = data.classes || [];
    this.budgets = data.budgets || [];
    this.reports = data.reports || [];
    this.items = data.items || [];
    this.attachments = data.attachments || [];
    this.bankLines = data.bankLines || [];      // 1.20 bank feed (js/bankfeed.js)
    this.bankImports = data.bankImports || [];
    this._queue = Promise.resolve();
    this.reindex();
  }
  OB.Book = Book;
  Book.BILLABLE = { bill: 1, check: 1, expense: 1 }; // purchase lines that can be re-billed to a customer (1.16)

  /* ---------------- construction / persistence ---------------- */
  Book.create = function (adapter, opts) {
    var company = S.newCompany(opts || {});
    var data = { company: company, accounts: S.defaultAccounts(), contacts: [], transactions: [], rules: [], recurring: [], reconciliations: [], audit: [], classes: [], budgets: [], reports: [], items: [], attachments: [], bankLines: [], bankImports: [] };
    var book = new Book(adapter, data);
    var ops = [{ store: 'company', value: company }];
    data.accounts.forEach(function (a) { ops.push({ store: 'accounts', value: a }); });
    var a0 = book._auditEntry('create-company', null, 'Company created: ' + company.name);
    ops.push({ store: 'audit', value: a0 });
    return adapter.putMany(ops).then(function () { book.audit.push(a0); return book; });
  };
  Book.fromData = function (adapter, data) {
    S.migrate(data);
    return new Book(adapter, data);
  };
  Book.prototype.exportData = function () {
    var self = this, d = { company: U.clone(this.company) };
    STORES.forEach(function (s) { d[s] = U.clone(self[s]); });
    return d;
  };
  /** Serialize writes so multi-step operations never interleave. */
  Book.prototype._commit = function (ops, apply) {
    var self = this;
    return this.adapter.putMany(ops).then(function () { apply(); self.reindex(); }, function (e) {
      // nothing was written: the audit chain tip goes back to before this write's first entry
      var first = ops.find(function (o) { return o.store === 'audit' && o.value && o.value.hash; });
      if (first) self._auditTip = first.value.prev;
      throw e;
    });
  };
  /* Audit entries are hash-chained (1.13): hash = SHA-256(prev + entry without hash). Changing or deleting an
   * entry breaks the chain, which checkIntegrity() reports. Entries written before 1.13 carry no hash. */
  Book.auditHash = function (a) {
    return U.sha256((a.prev || '') + '|' + U.stableStringify({ id: a.id, ts: a.ts, action: a.action, txnId: a.txnId, summary: a.summary, before: a.before }));
  };
  Book.prototype.auditHead = function () {
    if (this._auditTip !== undefined) return this._auditTip;
    var linked = {}, head = '';
    this.audit.forEach(function (a) { if (a.prev) linked[a.prev] = 1; });
    // the tip is the chained entry nobody points to (newest by time if the chain is broken)
    this.audit.filter(function (a) { return a.hash && !linked[a.hash]; }).sort(function (x, y) { return x.ts < y.ts ? -1 : x.ts > y.ts ? 1 : 0; }).forEach(function (a) { head = a.hash; });
    return (this._auditTip = head);
  };
  /** Chain an audit entry built outside a Book (e.g. a restore record) onto a plain audit list. */
  Book.chainAudit = function (list, entry) {
    var b = { audit: list }; entry.prev = Book.prototype.auditHead.call(b); entry.hash = Book.auditHash(entry); list.push(entry); return entry;
  };
  Book.prototype._auditEntry = function (action, txnId, summary, before) {
    var a = { id: U.uid('aud'), ts: new Date().toISOString(), action: action, txnId: txnId || '', summary: summary || '', before: before || null, prev: this.auditHead() };
    a.hash = Book.auditHash(a);
    this._auditTip = a.hash; // several entries in one write chain to each other
    return a;
  };
  /** Verify the audit chain. Returns { chained, legacy, problems[] }. */
  Book.prototype.verifyAudit = function () {
    var byHash = {}, problems = [], chained = 0, legacy = 0, genesis = 0, used = {};
    this.audit.forEach(function (a) { if (a.hash) byHash[a.hash] = a; });
    this.audit.forEach(function (a) {
      if (!a.hash) { legacy++; return; }
      chained++;
      if (Book.auditHash(a) !== a.hash) problems.push('Audit entry of ' + U.fmtDate(String(a.ts).slice(0, 10)) + ' (“' + String(a.summary).slice(0, 60) + '”) was changed after it was written.');
      if (!a.prev) genesis++;
      else if (!byHash[a.prev]) problems.push('An audit entry before ' + U.fmtDate(String(a.ts).slice(0, 10)) + ' is missing (the history was deleted or edited).');
      else if (used[a.prev]) problems.push('The audit history forks at ' + U.fmtDate(String(a.ts).slice(0, 10)) + '.');
      used[a.prev || '(start)'] = 1;
    });
    if (genesis > 1) problems.push('The audit history has ' + genesis + ' starting points instead of one (entries were removed).');
    return { chained: chained, legacy: legacy, problems: problems };
  };

  /* ---------------- indexes ---------------- */
  Book.prototype.reindex = function () {
    var self = this;
    this.accById = U.byKey(this.accounts, 'id');
    this.contactById = U.byKey(this.contacts, 'id');
    this.classById = U.byKey(this.classes || [], 'id');
    this.itemById = U.byKey(this.items || [], 'id');
    this.txById = {};
    this.tokenIndex = {};
    this.accBySystem = {};
    this.accounts.forEach(function (a) { if (a.system) self.accBySystem[a.system] = a; });
    this.incoming = {}; // targetId -> [{from, amount}]
    this.depositedBy = {}; // payment/receipt id -> the deposit that moved it out of Undeposited Funds (1.14)
    this.transactions.forEach(function (t) {
      self.txById[t.id] = t;
      if (t.status === 'posted' && t.type === 'deposit') (t.lines || []).forEach(function (l) { if (l.fromTxnId) self.depositedBy[l.fromTxnId] = t.id; });
      if (t.clientToken) self.tokenIndex[t.clientToken] = t.id;
      if (t.status === 'posted' && t.applications) {
        t.applications.forEach(function (ap) {
          (self.incoming[ap.txnId] = self.incoming[ap.txnId] || []).push({ from: t.id, amount: ap.amount, date: ap.date || '' });
        });
      }
    });
    this._splitIndex = null; // lazy
  };
  /** accountId -> [{t, s, i}] sorted by date then creation, posted only */
  Book.prototype.splitIndex = function () {
    if (this._splitIndex) return this._splitIndex;
    var idx = {};
    var txs = this.transactions.filter(function (t) { return t.status === 'posted'; });
    txs.sort(cmpTxn);
    txs.forEach(function (t) {
      t.splits.forEach(function (s, i) { (idx[s.accountId] = idx[s.accountId] || []).push({ t: t, s: s, i: i }); });
    });
    this._splitIndex = idx;
    return idx;
  };
  function cmpTxn(a, b) {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return (a.createdAt || '') < (b.createdAt || '') ? -1 : (a.createdAt || '') > (b.createdAt || '') ? 1 : 0;
  }
  Book.cmpTxn = cmpTxn;
  Book.prototype.posted = function () { return this.transactions.filter(function (t) { return t.status === 'posted'; }); };

  /* ---------------- accounts ---------------- */
  Book.prototype.sys = function (code) { return this.accBySystem[code]; };
  Book.prototype.saveAccount = function (input) {
    var self = this;
    var existing = input.id ? this.accById[input.id] : null;
    var name = String(input.name || '').trim();
    if (!name) return Promise.reject(LedgerError('Account name is required.', 'name'));
    if (!S.TYPE[input.type]) return Promise.reject(LedgerError('Choose an account type.', 'type'));
    var dupe = this.accounts.find(function (a) { return a.id !== input.id && a.name.toLowerCase() === name.toLowerCase(); });
    if (dupe) return Promise.reject(LedgerError('An account named "' + name + '" already exists.', 'name'));
    if (input.number) {
      var dn = this.accounts.find(function (a) { return a.id !== input.id && a.number && a.number === String(input.number).trim(); });
      if (dn) return Promise.reject(LedgerError('Account number ' + input.number + ' is already used by ' + dn.name + '.', 'number'));
    }
    if (existing) {
      if (existing.system && existing.type !== input.type) return Promise.reject(LedgerError('The type of a system account cannot be changed.', 'type'));
      var used = (this.splitIndex()[existing.id] || []).length > 0;
      if (used && S.isBS(existing.type) !== S.isBS(input.type)) return Promise.reject(LedgerError('This account has transactions; it cannot move between balance sheet and income statement types.', 'type'));
      if (input.active === false && existing.system) return Promise.reject(LedgerError('System accounts cannot be made inactive.'));
      if (input.active === false && this.accountBalance(existing.id) !== 0) return Promise.reject(LedgerError('Only accounts with a zero balance can be made inactive.'));
    }
    if (input.parentId) {
      var parent = this.accById[input.parentId];
      if (!parent || parent.id === input.id) return Promise.reject(LedgerError('Invalid parent account.'));
      if (parent.type !== input.type) return Promise.reject(LedgerError('A sub-account must have the same type as its parent.'));
    }
    var acc = existing ? U.clone(existing) : { id: U.uid('acct'), system: '', active: true };
    acc.name = name; acc.number = String(input.number || '').trim(); acc.type = input.type;
    acc.description = input.description || ''; acc.parentId = input.parentId || '';
    // CPA-10: where the account's changes go on the Statement of Cash Flows ('' = by account type)
    if (input.cashFlow !== undefined) { if (['operating', 'investing', 'financing', ''].indexOf(input.cashFlow || '') < 0) return Promise.reject(LedgerError('Cash flow section must be operating, investing or financing.', 'cashFlow')); if (input.cashFlow) acc.cashFlow = input.cashFlow; else delete acc.cashFlow; }
    if (input.active !== undefined) acc.active = !!input.active;
    var audit = this._auditEntry(existing ? 'edit-account' : 'create-account', null, (existing ? 'Edited' : 'Created') + ' account ' + acc.name, existing ? U.clone(existing) : null);
    return this._commit([{ store: 'accounts', value: acc }, { store: 'audit', value: audit }], function () {
      if (existing) self.accounts[self.accounts.indexOf(existing)] = acc; else self.accounts.push(acc);
      self.audit.push(audit);
    }).then(function () { return acc; });
  };
  Book.prototype.accountLabel = function (id) {
    var a = this.accById[id]; if (!a) return '(missing account)';
    return (a.number ? a.number + ' ' : '') + this.accountFullName(a);
  };
  Book.prototype.accountFullName = function (a) {
    var names = [a.name], p = a.parentId ? this.accById[a.parentId] : null, guard = 0;
    while (p && guard++ < 10) { names.unshift(p.name); p = p.parentId ? this.accById[p.parentId] : null; }
    return names.join(':');
  };
  Book.prototype.sortedAccounts = function (filter) {
    var self = this;
    var order = S.ACCOUNT_TYPES.map(function (t) { return t.id; });
    return this.accounts.filter(filter || function () { return true; }).sort(function (a, b) {
      var d = order.indexOf(a.type) - order.indexOf(b.type);
      if (d) return d;
      var ka = (a.number || '') + self.accountFullName(a), kb = (b.number || '') + self.accountFullName(b);
      return ka.localeCompare(kb);
    });
  };

  /* ---------------- contacts ---------------- */
  Book.prototype.saveContact = function (input) {
    var self = this;
    var existing = input.id ? this.contactById[input.id] : null;
    var name = String(input.name || '').trim();
    if (!name) return Promise.reject(LedgerError('Name is required.', 'name'));
    if (input.kind !== 'customer' && input.kind !== 'vendor') return Promise.reject(LedgerError('Contact kind must be customer or vendor.'));
    var dupe = this.contacts.find(function (c) { return c.id !== input.id && c.kind === input.kind && c.name.toLowerCase() === name.toLowerCase(); });
    if (dupe) return Promise.reject(LedgerError('A ' + input.kind + ' named "' + name + '" already exists.', 'name'));
    if (existing && existing.kind !== input.kind) return Promise.reject(LedgerError('A contact cannot change between customer and vendor.'));
    var c = existing ? U.clone(existing) : { id: U.uid(input.kind === 'customer' ? 'cus' : 'ven'), kind: input.kind, active: true, createdAt: new Date().toISOString() };
    ['company', 'email', 'phone', 'address', 'notes', 'taxId'].forEach(function (k) { c[k] = input[k] || ''; });
    // extended contact details (1.9): kept when the editor does not send them
    S.CONTACT_EXTRA.forEach(function (k) { if (input[k] !== undefined) c[k] = String(input[k] || ''); else if (c[k] === undefined) c[k] = ''; });
    c.name = name; c.terms = input.terms === undefined || input.terms === '' ? (existing ? existing.terms : self.company.defaultTerms) : +input.terms;
    c.is1099 = !!input.is1099;
    // CPA-13: early-payment discount terms (percent, days); kept when the editor does not send them
    if (input.discountPct !== undefined) {
      var dp = +input.discountPct || 0, dd = Math.round(+input.discountDays || 0);
      if (dp < 0 || dp >= 100) return Promise.reject(LedgerError('The discount must be between 0 and 100%.', 'discountPct'));
      if (dp) { c.discountPct = Math.round(dp * 100) / 100; c.discountDays = Math.max(0, dd); } else { delete c.discountPct; delete c.discountDays; }
    }
    // Customer:Job (1.16): a job is a customer with a parent customer
    if (input.parentId !== undefined) {
      var pid = input.parentId || '';
      if (pid) {
        var par = this.contactById[pid];
        if (!par || par.kind !== 'customer' || input.kind !== 'customer') return Promise.reject(LedgerError('A job belongs to a customer.', 'parentId'));
        for (var up = par, g = 0; up && g < 20; up = this.contactById[up.parentId], g++) if (up.id === c.id) return Promise.reject(LedgerError('A customer cannot be a job of itself or of its own jobs.', 'parentId'));
      }
      c.parentId = pid;
    }
    if (input.exemptCert !== undefined) { var ec = input.exemptCert || {}; c.exemptCert = { number: String(ec.number || '').trim(), state: String(ec.state || '').trim().toUpperCase().slice(0, 2), reason: ['', 'resale', 'nonprofit', 'government', 'other'].indexOf(ec.reason) >= 0 ? ec.reason : 'other', expires: U.isDate(ec.expires) ? ec.expires : '' }; }
    if (input.priceLevelId !== undefined) { if (input.priceLevelId && !(this.company.priceLevels || []).some(function (x) { return x.id === input.priceLevelId; })) return Promise.reject(LedgerError('The price level no longer exists.', 'priceLevelId')); c.priceLevelId = input.priceLevelId || ''; }
    if (input.jobStatus !== undefined) c.jobStatus = ['', 'pending', 'awarded', 'in progress', 'closed', 'not awarded'].indexOf(input.jobStatus) >= 0 ? input.jobStatus : '';
    ['jobStart', 'jobEnd', 'jobType'].forEach(function (k) { if (input[k] !== undefined) c[k] = String(input[k] || ''); });
    if (input.w9OnFile !== undefined) c.w9OnFile = !!input.w9OnFile && input.w9OnFile !== 'false'; // W-9 received (1.14)
    // sales tax (1.13): customers can be tax-exempt or carry their own default rate
    if (input.taxExempt !== undefined) c.taxExempt = !!input.taxExempt && input.taxExempt !== 'false';
    if (input.salesTaxId !== undefined) {
      if (input.salesTaxId && !this.salesTaxById(input.salesTaxId)) return Promise.reject(LedgerError('The selected sales tax rate no longer exists.', 'salesTaxId'));
      c.salesTaxId = input.salesTaxId || '';
    }
    if (input.active !== undefined) c.active = !!input.active;
    var audit = this._auditEntry(existing ? 'edit-contact' : 'create-contact', null, (existing ? 'Edited ' : 'Created ') + c.kind + ' ' + c.name, existing ? U.clone(existing) : null);
    return this._commit([{ store: 'contacts', value: c }, { store: 'audit', value: audit }], function () {
      if (existing) self.contacts[self.contacts.indexOf(existing)] = c; else self.contacts.push(c);
      self.audit.push(audit);
    }).then(function () { return c; });
  };

  /* ---------------- products & services (items) ---------------- */
  Book.prototype.saveItem = function (input) {
    var self = this;
    var existing = input.id ? this.itemById[input.id] : null;
    var name = String(input.name || '').trim();
    if (!name) return Promise.reject(LedgerError('Item name is required.', 'name'));
    var type = input.type || 'service';
    if (!S.ITEM_TYPES.some(function (t) { return t.id === type; })) return Promise.reject(LedgerError('Choose an item type.', 'type'));
    var dupe = this.items.find(function (x) { return x.id !== input.id && x.name.toLowerCase() === name.toLowerCase(); });
    if (dupe) return Promise.reject(LedgerError('An item named "' + name + '" already exists.', 'name'));
    var badAcc = ['incomeAccountId', 'expenseAccountId', 'assetAccountId'].find(function (k) { return input[k] && !self.accById[input[k]]; });
    if (badAcc) return Promise.reject(LedgerError('The account chosen for this item no longer exists.', badAcc));
    var it = existing ? U.clone(existing) : { id: U.uid('item'), active: true, createdAt: new Date().toISOString() };
    it.name = name; it.type = type; it.sku = String(input.sku || '').trim();
    it.description = String(input.description || ''); it.purchaseDescription = String(input.purchaseDescription || '');
    it.incomeAccountId = input.incomeAccountId || ''; it.expenseAccountId = input.expenseAccountId || ''; it.assetAccountId = input.assetAccountId || '';
    it.price = input.price === '' || input.price === undefined || input.price === null ? null : toC(input.price);
    it.cost = input.cost === '' || input.cost === undefined || input.cost === null ? null : toC(input.cost);
    it.taxable = !!input.taxable;
    // inventory (1.15): quantity on hand at average cost; needs an asset account and a cost of goods sold account
    if (input.trackQty !== undefined) it.trackQty = type === 'inventory' && !!input.trackQty && input.trackQty !== 'false';
    if (type !== 'inventory') it.trackQty = false;
    if (input.reorderPoint !== undefined) it.reorderPoint = input.reorderPoint === '' || input.reorderPoint === null ? null : +input.reorderPoint;
    if (it.trackQty) {
      if (!it.assetAccountId && this.sys('INV')) it.assetAccountId = this.sys('INV').id;
      if (!it.expenseAccountId) { var cg = this.accounts.find(function (a) { return a.type === 'cogs' && a.active; }); if (cg) it.expenseAccountId = cg.id; }
      var aa = this.accById[it.assetAccountId], ca = this.accById[it.expenseAccountId];
      if (!aa || ['oca', 'oa'].indexOf(aa.type) < 0) return Promise.reject(LedgerError('An item that tracks quantity needs an inventory asset account (Other Current Asset).', 'assetAccountId'));
      if (!ca || ['cogs', 'expense'].indexOf(ca.type) < 0) return Promise.reject(LedgerError('An item that tracks quantity needs a cost of goods sold account.', 'expenseAccountId'));
      if (existing && existing.trackQty && existing.assetAccountId !== it.assetAccountId && this.transactions.some(function (t) { return t.status === 'posted' && self.inventoryMoves && self.inventoryMoves(t).some(function (m) { return m.itemId === it.id; }); }))
        return Promise.reject(LedgerError('This item already has inventory history; its asset account cannot change.', 'assetAccountId'));
    }
    if (input.active !== undefined) it.active = !!input.active;
    var audit = this._auditEntry(existing ? 'edit-item' : 'create-item', null, (existing ? 'Edited' : 'Created') + ' item ' + it.name, existing ? U.clone(existing) : null);
    return this._commit([{ store: 'items', value: it }, { store: 'audit', value: audit }], function () {
      if (existing) self.items[self.items.indexOf(existing)] = it; else self.items.push(it);
      self.audit.push(audit);
    }).then(function () { return it; });
  };

  /* ---------------- migration import (all-or-nothing) ---------------- */
  /**
   * Import a prepared bundle from another accounting program in ONE atomic write.
   * bundle = { accounts: [full account records, new or replacing by id], contacts: [...], items: [...],
   *            transactions: [drafts, in posting order], company: {patch}, record: {import history entry} }
   * Every transaction goes through normalize() + validate() + buildSplits() exactly like manual entry.
   * Payments may apply to invoices earlier in the same bundle. On any error nothing is written and the
   * in-memory books are restored. Resolves { posted, accounts, contacts, items }.
   */
  Book.prototype.importBundle = function (bundle, opts) {
    var self = this; opts = opts || {};
    if (!opts.allowExisting && this.transactions.some(function (t) { return t.status === 'posted'; }))
      return Promise.reject(LedgerError('This company already has transactions. Import into a new, empty company so nothing is posted twice.'));
    var snap = { accounts: this.accounts.slice(), contacts: this.contacts.slice(), items: this.items.slice(), classes: this.classes.slice(), transactions: this.transactions.slice(), audit: this.audit.slice(), company: U.clone(this.company) };
    var restore = function () {
      ['accounts', 'contacts', 'items', 'classes', 'transactions', 'audit'].forEach(function (k) { self[k] = snap[k]; });
      self.company = snap.company; self._splitIndex = null; self.reindex();
    };
    var ops = [], posted = [], errors = [];
    var put = function (store, list, rec) {
      var i = list.findIndex(function (x) { return x.id === rec.id; });
      if (i >= 0) list[i] = rec; else list.push(rec);
      ops.push({ store: store, value: rec });
    };
    try {
      (bundle.accounts || []).forEach(function (a) { put('accounts', self.accounts, a); });
      (bundle.contacts || []).forEach(function (c) { put('contacts', self.contacts, c); });
      (bundle.items || []).forEach(function (x) { put('items', self.items, x); });
      (bundle.classes || []).forEach(function (x) { put('classes', self.classes, x); });
      this.reindex();
      // structural checks the editors normally enforce
      var names = {}, nums = {}, cnames = {};
      this.accounts.forEach(function (a) {
        var k = a.name.toLowerCase(), pk = (a.parentId || '') + '|' + k;
        if (names[pk]) errors.push({ message: 'Two accounts are named "' + a.name + '".' }); names[pk] = 1;
        if (a.number) { if (nums[a.number]) errors.push({ message: 'Account number ' + a.number + ' is used twice.' }); nums[a.number] = 1; }
        if (!S.TYPE[a.type]) errors.push({ message: 'Account "' + a.name + '" has an unknown type.' });
        if (a.parentId) { var p = self.accById[a.parentId]; if (!p || p.type !== a.type) errors.push({ message: 'Sub-account "' + a.name + '" must have a parent of the same type.' }); }
      });
      this.contacts.forEach(function (c) { var k = c.kind + '|' + c.name.toLowerCase(); if (cnames[k]) errors.push({ message: 'Two ' + c.kind + 's are named "' + c.name + '".' }); cnames[k] = 1; });
      if (errors.length) throw LedgerError(errors[0].message);
      var base = Date.now();
      (bundle.transactions || []).forEach(function (d, i) {
        var t;
        try { t = self.normalize(d); } catch (e) { errors.push({ index: i, ref: d.importRef, message: e.message }); return; }
        var errs = self.validate(t, null);
        if (errs.length) { errors.push({ index: i, ref: d.importRef, message: errs.map(function (e) { return e.message; }).join(' ') }); return; }
        t.id = d.id || U.uid('txn'); t.splits = self.buildSplits(t); t.total = self.txnTotal(t); t.status = 'posted';
        var ts = new Date(base + i).toISOString(); t.createdAt = ts; t.updatedAt = ts; t.version = 1;
        self.transactions.push(t); self.txById[t.id] = t;
        (t.applications || []).forEach(function (ap) { (self.incoming[ap.txnId] = self.incoming[ap.txnId] || []).push({ from: t.id, amount: ap.amount, date: ap.date || '' }); });
        self._splitIndex = null;
        ops.push({ store: 'transactions', value: t }); posted.push(t);
      });
      if (errors.length) { var le = LedgerError(errors.length + ' transaction' + (errors.length === 1 ? '' : 's') + ' could not be imported. Nothing was changed.'); le.errors = errors; throw le; }
      var company = U.clone(this.company);
      Object.assign(company, bundle.company || {});
      company.imports = (company.imports || []).concat(bundle.record ? [bundle.record] : []);
      this.company = company; ops.push({ store: 'company', value: company });
      var audit = this._auditEntry('import', null, (bundle.record && bundle.record.summary) || ('Imported ' + posted.length + ' transactions'));
      this.audit.push(audit); ops.push({ store: 'audit', value: audit });
    } catch (e) { restore(); return Promise.reject(e); }
    return this.adapter.putMany(ops).then(function () {
      self._splitIndex = null; self.reindex();
      return { posted: posted, accounts: (bundle.accounts || []).length, contacts: (bundle.contacts || []).length, items: (bundle.items || []).length, classes: (bundle.classes || []).length };
    }, function (e) { restore(); throw e; });
  };

  /* ---------------- company settings ---------------- */
  /* Closing date password: a gate on moving the closing date, like QuickBooks (not encryption).
   * Stored as an iterated, salted SHA-256; the password itself is never stored. */
  Book.closingHash = function (salt, pw) { var h = salt + '|' + pw; for (var i = 0; i < 5000; i++) h = U.sha256(h); return h; };
  Book.checkClosingPassword = function (company, pw) { return !!(pw && company.closingPasswordHash && Book.closingHash(company.closingPasswordSalt, String(pw)) === company.closingPasswordHash); };
  Book.prototype.saveCompany = function (input) {
    var self = this;
    var c = U.clone(this.company);
    ['name', 'legalName', 'ein', 'address', 'email', 'phone'].forEach(function (k) { if (input[k] !== undefined) c[k] = String(input[k]); });
    if (!String(c.name).trim()) return Promise.reject(LedgerError('Company name is required.', 'name'));
    if (input.name !== undefined && String(c.name).length > 120) return Promise.reject(LedgerError('Keep the company name to 120 characters or fewer.', 'name'));
    if (input.basis) c.basis = input.basis === 'cash' ? 'cash' : 'accrual';
    if (input.fiscalYearStartMonth) {
      var m = +input.fiscalYearStartMonth; if (m < 1 || m > 12) return Promise.reject(LedgerError('Invalid fiscal year start month.'));
      c.fiscalYearStartMonth = m;
    }
    // closing date (1.13): optional password; every change is kept in closingHistory
    var closingChange = input.closingDate !== undefined && (input.closingDate || '') !== (c.closingDate || '');
    if ((closingChange || input.newClosingPassword !== undefined) && c.closingPasswordHash && !Book.checkClosingPassword(c, input.closingPassword))
      return Promise.reject(LedgerError(input.closingPassword ? 'The closing date password is incorrect.' : 'Enter the closing date password to change the closing date.', 'closingPassword'));
    if (input.closingDate !== undefined) {
      if (input.closingDate && !U.isDate(input.closingDate)) return Promise.reject(LedgerError('Invalid closing date.'));
      if (closingChange) { c.closingHistory = (c.closingHistory || []).concat([{ at: new Date().toISOString(), from: c.closingDate || '', to: input.closingDate || '' }]).slice(-200); }
      c.closingDate = input.closingDate || '';
    }
    if (input.newClosingPassword !== undefined) {
      var np = String(input.newClosingPassword || '');
      if (np && np.length < 4) return Promise.reject(LedgerError('Use at least 4 characters for the closing date password.', 'newClosingPassword'));
      if (np) { c.closingPasswordSalt = U.uid('salt'); c.closingPasswordHash = Book.closingHash(c.closingPasswordSalt, np); }
      else { delete c.closingPasswordSalt; delete c.closingPasswordHash; }
    }
    if (input.defaultTerms !== undefined) c.defaultTerms = Math.max(0, +input.defaultTerms || 0);
    if (input.close !== undefined) { var cj = JSON.stringify(input.close || {}); if (cj.length > 200000) return Promise.reject(LedgerError('Close notes are too long.')); c.close = JSON.parse(cj); }   // Close the books settings and sign-offs (1.46)
    if (input.calendar !== undefined) { var kj = JSON.stringify(input.calendar || {}); if (kj.length > 200000) return Promise.reject(LedgerError('Too many calendar notes.')); c.calendar = JSON.parse(kj); }   // calendar to-dos, filed marks, pay dates (1.50)
    if (input.statementLook !== undefined) c.statementLook = OB.reportModel ? OB.reportModel.lookOf(input.statementLook) : String(input.statementLook);
    if (input.lastBackupAt !== undefined) c.lastBackupAt = input.lastBackupAt;
    if (input.customerMessages !== undefined) c.customerMessages = (input.customerMessages || []).map(function (m) { return String(m).trim().slice(0, 200); }).filter(function (m, i, a) { return m && a.indexOf(m) === i; }).slice(0, 50);
    if (input.logo !== undefined) {
      // optional invoice logo: an image data URL (PNG, JPEG, GIF, WebP), at most ~1 MB; '' removes it
      var lg = String(input.logo || '');
      if (lg && !/^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+\/=]+$/.test(lg)) return Promise.reject(LedgerError('The logo must be a PNG, JPEG, GIF or WebP image.', 'logo'));
      if (lg.length > 1400000) return Promise.reject(LedgerError('The logo file is too large (use an image under 1 MB).', 'logo'));
      c.logo = lg;
    }
    // income tax return and account -> tax line mapping (1.16)
    if (input.taxForm !== undefined) c.taxForm = ['', '1040C', '1120S', '1065', '1120'].indexOf(input.taxForm) >= 0 ? input.taxForm : '';
    if (input.taxLines !== undefined) { var tl = {}; Object.keys(input.taxLines || {}).forEach(function (k) { if (input.taxLines[k] && self.accById[k]) tl[k] = String(input.taxLines[k]); }); c.taxLines = tl; }
    // check printing alignment and finance-charge defaults (1.14)
    if (input.checkAlign !== undefined) c.checkAlign = { dx: Math.max(-72, Math.min(72, +(input.checkAlign || {}).dx || 0)), dy: Math.max(-72, Math.min(72, +(input.checkAlign || {}).dy || 0)) };
    if (input.checkCompanyBlock !== undefined) c.checkCompanyBlock = !!input.checkCompanyBlock;
    if (input.allowNegativeInventory !== undefined) c.allowNegativeInventory = !!input.allowNegativeInventory;   // CPA-03
    if (input.financeCharge !== undefined) {
      var fc = input.financeCharge || {};
      if (!(+fc.apr >= 0 && +fc.apr <= 100)) return Promise.reject(LedgerError('Enter an annual rate between 0 and 100%.', 'apr'));
      c.financeCharge = { apr: +fc.apr, minCharge: Math.max(0, Math.round(+fc.minCharge || 0)), graceDays: Math.max(0, Math.min(365, Math.round(+fc.graceDays || 0))), onFinanceCharges: !!fc.onFinanceCharges };
    }
    var flag = function (v) { return v === true || v === 'on' || v === '1'; };
    if (input.useClasses !== undefined) c.useClasses = flag(input.useClasses);
    if (input.useBudgets !== undefined) c.useBudgets = flag(input.useBudgets);
    if (input.use1099 !== undefined) c.use1099 = flag(input.use1099);
    if (input.map1099 !== undefined) {
      var mp = {};
      Object.keys(input.map1099 || {}).forEach(function (k) {
        var box = input.map1099[k];
        if (box && self.accById[k] && S.BOXES_1099.some(function (b) { return b.id === box; })) mp[k] = box;
      });
      c.map1099 = mp;
    }
    var ops = [{ store: 'company', value: c }];
    var audit = null;
    if (input.lastBackupAt === undefined || Object.keys(input).length > 1) {
      audit = this._auditEntry('edit-company', null, 'Company settings updated', U.clone(this.company));
      ops.push({ store: 'audit', value: audit });
    }
    return this._commit(ops, function () { self.company = c; if (audit) self.audit.push(audit); }).then(function () { return c; });
  };

  /* ---------------- transaction building ---------------- */
  Book.prototype.lineTotal = function (lines) { return U.sum(lines || [], function (l) { return l.amount || 0; }); };

  /* ---------------- sales tax (1.13) ----------------
   * A rate is stored in millionths (8.25 % = 82500) so tax = round(taxable cents × rate / 1,000,000) stays integer. */
  /* ---------------- progress invoicing (1.17) ---------------- */
  /** How much of each line of an estimate / sales order / PO is already invoiced or billed by posted documents.
   *  exclude = a document id to leave out; extra = an unsaved version of a document to count. Documents converted
   *  before 1.17 (no srcLine on any line) count as the whole source. */
  Book.prototype.sourceProgress = function (srcId, exclude, extra) {
    var src = this.txById[srcId], n = src && src.lines ? src.lines.length : 0, done = [], i;
    for (i = 0; i < n; i++) done.push(0);
    var docs = this.transactions.filter(function (t) { return t.sourceId === srcId && t.status === 'posted' && t.id !== exclude && (!extra || t.id !== extra.id); });
    if (extra) docs.push(extra);
    var whole = false;
    docs.forEach(function (t) {
      var any = (t.lines || []).some(function (l) { return l.srcLine !== undefined; });
      if (!any) { whole = true; return; }
      (t.lines || []).forEach(function (l) { if (l.srcLine !== undefined && l.srcLine < n) done[l.srcLine] += l.amount; });
    });
    if (whole) for (i = 0; i < n; i++) done[i] = Math.max(done[i], src.lines[i].amount);
    var full = n > 0 && src.lines.every(function (l, k) { return l.amount <= 0 || done[k] >= l.amount; });
    var total = src ? U.sum(src.lines, function (l) { return l.amount; }) : 0, billed = U.sum(done, function (x) { return x; });
    return { done: done, full: full, total: total, billed: Math.min(billed, total), docs: docs.filter(function (t) { return t !== extra; }) };
  };

  /* ---------------- Undeposited Funds (1.14) ---------------- */
  /** What a posted transaction put into Undeposited Funds (its debit to that account). */
  Book.prototype.undepositedAmount = function (t) {
    var u = this.sys('UNDEP'); if (!u || !t || !t.splits) return 0;
    return U.sum(t.splits.filter(function (s) { return s.accountId === u.id && s.amount > 0; }), function (s) { return s.amount; });
  };
  /** Payments and receipts waiting in Undeposited Funds (not yet in a deposit), oldest first. ignoreDeposit = the deposit being edited. */
  Book.prototype.undepositedItems = function (ignoreDeposit) {
    var self = this;
    return this.transactions.filter(function (t) {
      if (t.status !== 'posted' || t.type === 'deposit' || t.type === 'journal' || t.type === 'transfer') return false;
      var by = self.depositedBy[t.id];
      return (!by || by === ignoreDeposit) && self.undepositedAmount(t) > 0;
    }).sort(cmpTxn);
  };
  Book.prototype.salesTaxById = function (id) { return (this.company.salesTaxes || []).find(function (x) { return x.id === id; }) || null; };
  Book.parseRate = function (v) {
    var m = String(v === undefined || v === null ? '' : v).trim().replace(/%$/, '').trim().match(/^(\d{1,3})(?:\.(\d{0,4}))?$/);
    if (!m) return NaN;
    return +m[1] * 10000 + +((m[2] || '') + '0000').slice(0, 4);
  };
  Book.fmtRate = function (ppm) { var s = (ppm / 10000).toFixed(4).replace(/0+$/, '').replace(/\.$/, ''); return s + '%'; };
  Book.taxOn = function (taxableCents, ppm) { var v = taxableCents * ppm / 1000000; return v < 0 ? -Math.round(-v) : Math.round(v); };
  Book.prototype.saveSalesTax = function (input) {
    var self = this, c = U.clone(this.company), list = c.salesTaxes = c.salesTaxes || [];
    var existing = input.id ? list.find(function (x) { return x.id === input.id; }) : null;
    if (input.id && !existing) return Promise.reject(LedgerError('Sales tax rate not found.'));
    var name = String(input.name || '').trim();
    if (!name) return Promise.reject(LedgerError('Name the tax rate (for example "Arizona state + Tucson").', 'name'));
    if (list.some(function (x) { return x.id !== input.id && x.name.toLowerCase() === name.toLowerCase(); })) return Promise.reject(LedgerError('A sales tax rate named "' + name + '" already exists.', 'name'));
    // combined rate (1.18): components (state / county / city …), each with its agency; the rate is their sum
    var comps = (input.components || []).map(function (x) { return { name: String(x.name || '').trim(), agency: String(x.agency || '').trim(), rate: Book.parseRate(x.rate) }; }).filter(function (x) { return x.name || x.agency || x.rate; });
    if (comps.some(function (x) { return !(x.rate >= 0) || !x.agency; })) return Promise.reject(LedgerError('Each part of a combined rate needs an agency and a rate (e.g. 5.6).', 'components'));
    var rate = comps.length ? comps.reduce(function (s2, x) { return s2 + x.rate; }, 0) : Book.parseRate(input.rate);
    if (!(rate >= 0) || rate > 1000000) return Promise.reject(LedgerError('Enter the rate as a percent between 0 and 100 (up to 4 decimals), e.g. 8.25.', 'rate'));
    var acc = this.accById[input.accountId || (this.sys('STAX') || {}).id];
    if (!acc) return Promise.reject(LedgerError('Choose the liability account the tax is owed in (usually Sales Tax Payable).', 'accountId'));
    if (acc.type !== 'ocl' && acc.type !== 'ltl') return Promise.reject(LedgerError('Sales tax must go to a liability account (Other Current Liability).', 'accountId'));
    var t = existing ? U.clone(existing) : { id: U.uid('stx'), active: true, createdAt: new Date().toISOString() };
    t.name = name; t.agency = comps.length ? '' : String(input.agency || '').trim(); t.rate = rate; t.accountId = acc.id;
    if (comps.length) t.components = comps; else delete t.components;
    if (input.active !== undefined) t.active = !!input.active;
    if (existing) list[list.indexOf(existing)] = t; else list.push(t);
    if (input.makeDefault) c.defaultSalesTaxId = t.id;
    else if (c.defaultSalesTaxId === t.id && t.active === false) c.defaultSalesTaxId = '';
    var audit = this._auditEntry(existing ? 'edit-salestax' : 'create-salestax', null, (existing ? 'Edited' : 'Created') + ' sales tax ' + t.name + ' ' + Book.fmtRate(t.rate), existing ? U.clone(existing) : null);
    return this._commit([{ store: 'company', value: c }, { store: 'audit', value: audit }], function () { self.company = c; self.audit.push(audit); }).then(function () { return t; });
  };

  Book.prototype.buildSplits = function (t) {
    var def = S.TXN_TYPES[t.type];
    var splits = [];
    var tcls = t.classId || '';
    var push = function (accountId, amount, contactId, memo, classId) {
      if (amount === 0) return;
      var sp = { accountId: accountId, amount: amount, contactId: contactId || '', memo: memo || '', cleared: '' };
      var c = classId === undefined ? tcls : classId;
      if (c) sp.classId = c;
      splits.push(sp);
    };
    if (!def.special) {
      if (def.nonPosting) return splits; // estimates and purchase orders never touch the ledger
      var headId = def.head === 'AR' ? this.sys('AR').id : def.head === 'AP' ? this.sys('AP').id : t.accountId;
      var total = this.lineTotal(t.lines) + (t.tax || 0);
      var sign = def.headSide === 'D' ? 1 : -1;
      push(headId, sign * total, t.contactId, t.memo);
      t.lines.forEach(function (l) { push(l.accountId, -sign * l.amount, l.contactId || t.contactId, l.description, l.classId || tcls); });
      if (t.tax) { var tx = this.salesTaxById(t.taxId); push(tx ? tx.accountId : '', -sign * t.tax, '', 'Sales tax' + (tx ? ': ' + tx.name : ''), ''); }
      // inventory sold (or returned): cost moves between the asset and cost of goods sold (1.15)
      t.lines.forEach(function (l) { if (l.cost) { push(l.cogsAccountId, sign * l.cost, '', 'Cost: ' + (l.description || ''), l.classId || tcls); push(l.assetAccountId, -sign * l.cost, '', 'Cost: ' + (l.description || ''), l.classId || tcls); } });
      return splits;
    }
    switch (t.type) {
      case 'payment':
        push(t.accountId, t.amount, t.contactId, t.memo); push(this.sys('AR').id, -t.amount, t.contactId, t.memo); break;
      case 'customerRefund':
        push(this.sys('AR').id, t.amount, t.contactId, t.memo); push(t.accountId, -t.amount, t.contactId, t.memo); break;
      case 'billPayment':
        push(this.sys('AP').id, t.amount, t.contactId, t.memo); push(t.accountId, -t.amount, t.contactId, t.memo); break;
      case 'vendorRefund':   // CPA-04: Dr bank (or Undeposited Funds) / Cr A/P
        push(t.accountId, t.amount, t.contactId, t.memo); push(this.sys('AP').id, -t.amount, t.contactId, t.memo); break;
      case 'transfer':
        push(t.toAccountId, t.amount, '', t.memo); push(t.accountId, -t.amount, '', t.memo); break;
      case 'journal':
        (t.jlines || []).forEach(function (l) { push(l.accountId, (l.debit || 0) - (l.credit || 0), l.contactId, l.memo, l.classId || tcls); });
        break;
      case 'invAdjust': {
        var self2 = this;
        (t.adjustments || []).forEach(function (a) { var it = self2.itemById[a.itemId]; if (!it || !a.value) return; push(it.assetAccountId, a.value, '', 'Adjust ' + it.name + (a.memo ? ' — ' + a.memo : '')); push(t.accountId, -a.value, '', 'Adjust ' + it.name + (a.memo ? ' — ' + a.memo : '')); });
        break;
      }
    }
    return splits;
  };

  Book.prototype.txnTotal = function (t) {
    var def = S.TXN_TYPES[t.type];
    if (!def) return 0;
    if (!def.special) return this.lineTotal(t.lines) + (t.tax || 0);
    if (t.type === 'journal') return U.sum(t.splits || [], function (s) { return s.amount > 0 ? s.amount : 0; });
    if (t.type === 'invAdjust') return U.sum(t.adjustments || [], function (a) { return Math.abs(a.value || 0); });
    return t.amount || 0;
  };

  /** Sum of posted applications pointing AT txn (optionally ignoring one source txn). */
  Book.prototype.incomingApplied = function (txnId, ignoreFrom) {
    return U.sum((this.incoming[txnId] || []).filter(function (x) { return x.from !== ignoreFrom; }), function (x) { return x.amount; });
  };
  /** Open balance: invoices/bills -> amount due; payments/credits -> unapplied credit. */
  Book.prototype.openBalance = function (t, ignoreFrom) {
    if (typeof t === 'string') t = this.txById[t];
    if (!t || t.status !== 'posted') return 0;
    if (this.voidedAsOf(t)) return 0; // CPA-21: voided by a reversing entry in a later period
    var out = U.sum(t.applications || [], function (a) { return a.amount; });
    return this.txnTotal(t) - this.incomingApplied(t.id, ignoreFrom) - out;
  };
  /** The posted reversing entry that voided t "as of" a later date (CPA-21), if it is dated on/before asOf (any date when omitted). */
  Book.prototype.voidedAsOf = function (t, asOf) {
    var je = t && t.voidedBy ? this.txById[t.voidedBy] : null;
    return je && je.status === 'posted' && (!asOf || je.date <= asOf) ? je : null;
  };
  /** When an application counts (CPA-08): never before the credit exists, the document exists, or the day it was applied. */
  Book.prototype.appliedOn = function (src, target, appDate) {
    var d = src ? src.date : ''; if (target && target.date > d) d = target.date; if (appDate && appDate > d) d = appDate; return d;
  };
  /** Open balance as of a date: only applications that count by `asOf` reduce it (CPA-01 / CPA-08). */
  Book.prototype.openBalanceAsOf = function (t, asOf) {
    if (typeof t === 'string') t = this.txById[t];
    if (!t || t.status !== 'posted' || t.date > asOf || this.voidedAsOf(t, asOf)) return 0;
    var self = this;
    var inc = U.sum((this.incoming[t.id] || []).filter(function (x) { var src = self.txById[x.from]; return src && src.status === 'posted' && self.appliedOn(src, t, x.date) <= asOf; }), function (x) { return x.amount; });
    var out = U.sum((t.applications || []).filter(function (a) { return self.appliedOn(t, self.txById[a.txnId], a.date) <= asOf; }), function (a) { return a.amount; });
    return this.txnTotal(t) - inc - out;
  };
  /** Open documents for a contact that a txn of `type` can be applied to. */
  Book.prototype.openDocs = function (type, contactId, ignoreFrom) {
    var def = S.TXN_TYPES[type], self = this;
    if (!def || !def.applies) return [];
    return this.transactions.filter(function (t) {
      return t.status === 'posted' && t.contactId === contactId && def.applies.indexOf(t.type) >= 0 && t.id !== ignoreFrom &&
        self.openBalance(t, ignoreFrom) + self.ownAppTo(ignoreFrom, t.id) > 0;
    }).sort(cmpTxn);
  };
  Book.prototype.ownAppTo = function (fromId, targetId) {
    var f = fromId ? this.txById[fromId] : null;
    if (!f || f.status !== 'posted' || !f.applications) return 0;
    return U.sum(f.applications.filter(function (a) { return a.txnId === targetId; }), function (a) { return a.amount; });
  };

  /** Normalize a draft into a clean transaction document (does not mutate input). */
  Book.prototype.normalize = function (d) {
    var t = {
      id: d.id || '', type: d.type, date: d.date, number: String(d.number || '').trim(), contactId: d.contactId || '',
      memo: String(d.memo || '').trim(), accountId: d.accountId || '', clientToken: d.clientToken || ''
    };
    if (d.classId) t.classId = d.classId;
    var def = S.TXN_TYPES[d.type];
    if (!def) throw LedgerError('Unknown transaction type: ' + d.type);
    if (!def.special) {
      // CPA-22: on a new document, a discount line (discount item or negative amount) with no taxable choice follows
      // the taxability of the line above it, so tax is figured on the amount after the discount
      var newDoc = !d.id, lastTax = false, items0 = this.itemById || {};
      t.lines = (d.lines || []).map(function (l) {
        var qty = l.qty === undefined || l.qty === '' ? null : +l.qty;
        var rate = l.rate === undefined || l.rate === '' || l.rate === null ? null : toC(l.rate);
        var hasAmt = l.amount !== undefined && l.amount !== '' && l.amount !== null;
        var amount = hasAmt ? toC(l.amount) : 0;
        if (!hasAmt && qty !== null && rate !== null) amount = Math.round(qty * rate);
        var line = { accountId: l.accountId || '', description: String(l.description || ''), qty: qty, rate: rate, amount: amount, contactId: l.contactId || '' };
        if (l.itemId) line.itemId = String(l.itemId);
        if (l.classId) line.classId = l.classId;
        if (d.type === 'deposit' && l.fromTxnId) line.fromTxnId = String(l.fromTxnId);
        if (l.taxAgency) line.taxAgency = String(l.taxAgency); // sales tax payment / adjustment for an agency (1.18)
        if ((l.billable === true || l.billable === 'on' || l.billable === 1 || l.billable === '1') && Book.BILLABLE[d.type]) line.billable = true; // re-bill to the line's customer (1.16)
        if (l.billOf && d.type === 'invoice') line.billOf = String(l.billOf); // 'txnId:lineIndex' of the billable cost this line bills
        if (l.cost !== undefined && l.cost !== null && l.cogsAccountId) { line.cost = toC(l.cost); line.cogsAccountId = l.cogsAccountId; line.assetAccountId = l.assetAccountId; } // inventory cost (1.15)
        var isDisc = (line.itemId && items0[line.itemId] && items0[line.itemId].type === 'discount') || amount < 0;
        if (def.taxable && (l.taxable === true || l.taxable === 'on' || l.taxable === '1' || l.taxable === 1)) line.taxable = true;
        else if (def.taxable && newDoc && isDisc && lastTax && (l.taxable === undefined || l.taxable === null || l.taxable === '')) line.taxable = true;
        if (!isDisc) lastTax = !!line.taxable;
        return line;
      }).filter(function (l) { return l.accountId || l.amount; });
      // CPA-23: whether the customer was tax-exempt when the document was posted (kept on later edits)
      if (def.taxable && t.contactId) {
        var pr0 = d.id ? this.txById[d.id] : null, cc0 = this.contactById[t.contactId];
        t.exempt = pr0 && pr0.contactId === t.contactId && pr0.exempt !== undefined ? pr0.exempt : !!(cc0 && cc0.taxExempt);
      }
      if (def.taxable && d.taxId) {
        t.taxId = String(d.taxId);
        var stx = this.salesTaxById(t.taxId);
        // CPA-02: a posted document keeps the rate it was posted at. Today's rate applies to new documents, a changed
        // tax code, or an explicit "update to current rate". A credit memo made from an invoice starts at the invoice's rate.
        var prior = d.id ? this.txById[d.id] : null;
        if (!prior && d.type === 'creditMemo') {
          var self0 = this, src = d.fromInvoiceId ? [d.fromInvoiceId] : (d.applications || []).map(function (a) { return a.txnId; });
          prior = src.map(function (id) { return self0.txById[id]; }).find(function (x) { return x && x.taxId === t.taxId && x.taxRate !== undefined; }) || null;
        }
        var keep = !!(stx && prior && prior.taxId === t.taxId && prior.taxRate !== undefined && !d.updateTaxRate);
        var rate = keep ? prior.taxRate : stx ? stx.rate : 0;
        t.taxableAmount = this.lineTotal(t.lines.filter(function (l) { return l.taxable; }));
        t.taxRate = rate;        // the rate used, kept with the document (like a TAX_LINE)
        t.tax = stx ? Book.taxOn(t.taxableAmount, rate) : 0;
        // the split of the tax by agency, kept with the document (1.18)
        if (stx && t.tax) {
          var parts = keep && prior.taxParts && prior.taxParts.length ? prior.taxParts
            : stx.components && stx.components.length ? stx.components : [{ name: stx.name, agency: stx.agency || stx.name, rate: rate }];
          var amts = U.allocate(t.tax, parts.map(function (x) { return x.rate; }));
          t.taxParts = parts.map(function (x, k) { return { agency: x.agency, name: x.name, rate: x.rate, amount: amts[k] }; });
        }
      }
      if (d.sourceId) {
        t.sourceId = String(d.sourceId);
        // progress invoicing (1.17): each line remembers the source line it bills
        var kept = (d.lines || []).filter(function (l) { return l.accountId || (l.amount !== '' && l.amount !== undefined && l.amount !== null && toC(l.amount)); });
        t.lines.forEach(function (ln, i) { var sl = kept[i] && kept[i].srcLine; if (sl !== undefined && sl !== '' && sl !== null && isFinite(+sl)) ln.srcLine = +sl; });
      }
      if (d.financeCharge && d.type === 'invoice') {
        t.financeCharge = true;
        // CPA-01: which invoices this assessment charged, and through which date
        if (Array.isArray(d.financeChargeOf)) t.financeChargeOf = d.financeChargeOf.filter(function (x) { return x && x.txnId && U.isDate(x.to); })
          .map(function (x) { return { txnId: String(x.txnId), from: U.isDate(x.from) ? x.from : '', to: x.to, open: Math.round(+x.open || 0), charge: Math.round(+x.charge || 0) }; });
      }
      if (d.writeOffOf && d.type === 'creditMemo') t.writeOffOf = String(d.writeOffOf);
      // CPA-13: early-payment discount terms (e.g. 2% 10 Net 30), the discount credit, and a bounced-payment charge
      if ((d.type === 'invoice' || d.type === 'bill') && +d.discountPct > 0) { t.discountPct = Math.round(+d.discountPct * 100) / 100; t.discountDays = Math.max(0, Math.round(+d.discountDays || 0)); }
      if (d.discountOf && (d.type === 'creditMemo' || d.type === 'vendorCredit')) t.discountOf = String(d.discountOf);
      if (d.bounceOf && d.type === 'invoice') t.bounceOf = String(d.bounceOf);
      if (def.head === 'AR' || def.head === 'AP') { t.dueDate = d.dueDate || ''; t.terms = d.terms === undefined ? '' : d.terms; }
    } else if (d.type === 'journal') {
      t.jlines = (d.jlines || []).map(function (l) {
        var jl = { accountId: l.accountId || '', debit: toC(l.debit), credit: toC(l.credit), memo: String(l.memo || ''), contactId: l.contactId || '' };
        if (l.classId) jl.classId = l.classId;
        return jl;
      }).filter(function (l) { return l.accountId || l.debit || l.credit; });
      if (d.reversalOf) t.reversalOf = d.reversalOf;
      if (d.depreciation) t.depreciation = true;
      if (d.disposal) t.disposal = String(d.disposal); // CPA-11: fixed asset disposal entry (asset id)
      if (d.voidOf) t.voidOf = String(d.voidOf);       // CPA-21: reversing entry that voids another transaction as of its date
      t.jlines.forEach(function (jl, i) { var src = (d.jlines || []).filter(function (l) { return l.accountId || l.debit || l.credit; })[i]; if (src && src.assetId) jl.assetId = String(src.assetId); });
    } else if (d.type === 'invAdjust') {
      t.adjustments = (d.adjustments || []).map(function (a) {
        var q = a.qty === '' || a.qty === undefined || a.qty === null ? 0 : +a.qty;
        var adj = { itemId: String(a.itemId || ''), qty: q, value: a.value === '' || a.value === undefined || a.value === null ? null : toC(a.value), memo: String(a.memo || '') };
        if (a.auto && adj.value !== null) adj.auto = true;   // valued at average cost (CPA-03): a recost may revalue it
        return adj;
      }).filter(function (a) { return a.itemId && (a.qty || a.value); });
    } else {
      t.amount = toC(d.amount);
      if (d.type === 'transfer') t.toAccountId = d.toAccountId || '';
    }
    if (def.applies) {
      t.applications = (d.applications || []).map(function (a) { var x = { txnId: a.txnId, amount: toC(a.amount) }; if (U.isDate(a.date)) x.date = a.date; return x; })   // date: when it was applied (CPA-05)
        .filter(function (a) { return a.amount !== 0; });
    }
    if (d.message !== undefined && d.message !== null && (d.type === 'invoice' || d.type === 'salesReceipt' || d.type === 'creditMemo' || d.type === 'estimate')) t.message = String(d.message).trim().slice(0, 200); // customer message printed on the document
    var flag = function (v) { return v === true || v === 'on' || v === '1' || v === 1 || v === 'true'; };
    if ((d.type === 'check' || d.type === 'billPayment' || d.type === 'expense') && flag(d.toBePrinted)) t.toBePrinted = true; // print later (Print checks)
    if (d.importHash) t.importHash = d.importHash;
    if (d.importRef) t.importRef = String(d.importRef);
    if (d.recurringId) t.recurringId = d.recurringId;
    return t;
  };
  function toC(v) { return typeof v === 'number' && Number.isInteger(v) ? v : U.toCents(v); }
  /* Amounts arriving from the UI are strings ("12.50"); from code they may be integer cents.
     Convention: numeric integer values passed to normalize() are cents. */

  /** Validate a normalized transaction. Returns list of error messages (empty = valid). */
  Book.prototype.validate = function (t, prior) {
    var errs = [], self = this, def = S.TXN_TYPES[t.type];
    var err = function (m, f) { errs.push({ message: m, field: f || '' }); };
    if (!U.isDate(t.date)) err('Enter a valid date.', 'date');
    var lock = def.nonPosting ? '' : this.company.closingDate; // non-posting documents don't affect closed books
    if (lock && U.isDate(t.date) && t.date <= lock) err('The books are closed through ' + U.fmtDate(lock) + '. Change the closing date in Settings to post on this date.', 'date');
    if (prior && lock && prior.date <= lock) err('This transaction is in a closed period (on or before ' + U.fmtDate(lock) + ') and cannot be changed.');
    var contact = t.contactId ? this.contactById[t.contactId] : null;
    if (t.contactId && !contact) err('Selected contact no longer exists.', 'contactId');
    var priorClasses = {};
    if (prior) [prior.classId].concat((prior.lines || prior.jlines || []).map(function (l) { return l.classId; })).forEach(function (c) { if (c) priorClasses[c] = 1; });
    var checkClass = function (id, field) {
      if (!id) return;
      var c = self.classById[id];
      if (!c) err('The selected class no longer exists.', field);
      else if (c.active === false && !priorClasses[id]) err('Class "' + c.name + '" is inactive.', field);
    };
    checkClass(t.classId, 'classId');
    (t.lines || []).forEach(function (l, i) { checkClass(l.classId, 'lines.' + i); });
    (t.jlines || []).forEach(function (l, i) { checkClass(l.classId, 'jlines.' + i); });
    if (def.contact === 'customer' || def.contact === 'vendor') {
      if (!contact) err('Choose a ' + def.contact + '.', 'contactId');
      else if (contact.kind !== def.contact) err('A ' + def.label.toLowerCase() + ' must use a ' + def.contact + '.', 'contactId');
    }
    var arId = this.sys('AR').id, apId = this.sys('AP').id;
    var checkAcc = function (id, field, allowedTypes, allowArAp) {
      var a = self.accById[id];
      if (!a) { err('Choose an account.', field); return null; }
      if (!a.active) err('Account "' + a.name + '" is inactive.', field);
      if (allowedTypes && allowedTypes.indexOf(a.type) < 0) err('"' + a.name + '" cannot be used here (needs ' + allowedTypes.map(function (x) { return S.TYPE[x].label; }).join(' or ') + ').', field);
      if (!allowArAp && (a.id === arId || a.id === apId || a.type === 'ar' || a.type === 'ap')) err('Use invoices, bills and payments for A/R and A/P — not "' + a.name + '" on this line.', field);
      return a;
    };
    if (!def.special) {
      if (def.head === 'account') checkAcc(t.accountId, 'accountId', S.HEAD_ACCOUNT_TYPES[t.type]);
      if (!t.lines.length) err('Add at least one line.', 'lines');
      t.lines.forEach(function (l, i) {
        checkAcc(l.accountId, 'lines.' + i);
        if (l.accountId && l.accountId === t.accountId) err('Line ' + (i + 1) + ' uses the same account as the payment account.', 'lines.' + i);
        if (l.qty !== null && !isFinite(l.qty)) err('Line ' + (i + 1) + ': invalid quantity.', 'lines.' + i);
      });
      var cdep = this.depositAccount ? this.depositAccount() : this.sys('CUSTDEP'), usesDeposit = t.type === 'invoice' && cdep && t.lines.some(function (l) { return l.accountId === cdep.id && l.amount < 0; });
      var docTotal = this.lineTotal(t.lines) + (t.tax || 0);
      if (docTotal < 0 || (docTotal === 0 && !usesDeposit)) err('The total must be greater than zero.', 'lines');
      if (t.taxId) {
        var stx = this.salesTaxById(t.taxId);
        if (!stx) err('The selected sales tax rate no longer exists.', 'taxId');
        else {
          if (stx.active === false && !(prior && prior.taxId === t.taxId)) err('Sales tax rate "' + stx.name + '" is inactive.', 'taxId');
          if (!def.nonPosting && t.tax && !this.accById[stx.accountId]) err('The liability account for sales tax "' + stx.name + '" no longer exists.', 'taxId');
        }
      }
      if (t.sourceId) {
        var src = this.txById[t.sourceId], sdef = src && S.TXN_TYPES[src.type];
        if (!src || !sdef || sdef.convertsTo !== t.type) err('The estimate or purchase order this came from no longer exists.');
        else {
          if (src.status === 'void') err(sdef.label + ' ' + (src.number || '') + ' is void.');
          else if (src.status === 'closed' && !(prior && prior.sourceId === t.sourceId)) err(sdef.label + ' ' + (src.number || '') + ' is already closed.');
          if (src.contactId !== t.contactId) err('The ' + def.contact + ' must match ' + sdef.label.toLowerCase() + ' ' + (src.number || '') + '.', 'contactId');
          var pr = this.sourceProgress(src.id, t.id || '__new__');
          t.lines.forEach(function (l, i) {
            if (l.srcLine === undefined) return;
            var sl = src.lines[l.srcLine];
            if (!sl) { err('Line ' + (i + 1) + ' refers to a line that is not on ' + sdef.label.toLowerCase() + ' ' + (src.number || '') + '.', 'lines.' + i); return; }
            var left = sl.amount - pr.done[l.srcLine];
            if (sl.amount > 0 && l.amount > left) err('Line ' + (i + 1) + ': only ' + U.fmt(left, { symbol: true }) + ' of “' + (sl.description || 'this line') + '” is left to ' + (t.type === 'bill' ? 'bill' : 'invoice') + '.', 'lines.' + i);
          });
        }
      }
      if (t.dueDate && !U.isDate(t.dueDate)) err('Enter a valid due date.', 'dueDate');
      if (t.dueDate && U.isDate(t.date) && t.dueDate < t.date) err('The due date cannot be before the transaction date.', 'dueDate');
    } else if (t.type === 'invAdjust') {
      checkAcc(t.accountId, 'accountId');
      if (!t.adjustments.length) err('Add at least one item to adjust.', 'adjustments');
    } else if (t.type === 'journal') {
      if (t.jlines.length < 2) err('A journal entry needs at least two lines.', 'jlines');
      var dr = 0, cr = 0;
      t.jlines.forEach(function (l, i) {
        var a = checkAcc(l.accountId, 'jlines.' + i, null, true);
        if (l.debit < 0 || l.credit < 0) err('Line ' + (i + 1) + ': amounts cannot be negative.', 'jlines.' + i);
        if (l.debit && l.credit) err('Line ' + (i + 1) + ': enter a debit or a credit, not both.', 'jlines.' + i);
        if (!l.debit && !l.credit) err('Line ' + (i + 1) + ': enter an amount.', 'jlines.' + i);
        if (a && (a.type === 'ar' || a.type === 'ap')) {
          var c = self.contactById[l.contactId];
          if (!c) err('Line ' + (i + 1) + ': lines that use ' + a.name + ' need a ' + (a.type === 'ar' ? 'customer' : 'vendor') + '.', 'jlines.' + i);
          else if (c.kind !== (a.type === 'ar' ? 'customer' : 'vendor')) err('Line ' + (i + 1) + ': ' + a.name + ' requires a ' + (a.type === 'ar' ? 'customer' : 'vendor') + '.', 'jlines.' + i);
        }
        dr += l.debit; cr += l.credit;
      });
      if (dr !== cr) err('Debits (' + U.fmt(dr) + ') must equal credits (' + U.fmt(cr) + '). Difference: ' + U.fmt(dr - cr) + '.', 'jlines');
      if (dr === 0) err('The journal entry total cannot be zero.', 'jlines');
    } else {
      checkAcc(t.accountId, 'accountId', S.HEAD_ACCOUNT_TYPES[t.type]);
      if (!(t.amount > 0)) err('The amount must be greater than zero.', 'amount');
      if (t.type === 'transfer') {
        checkAcc(t.toAccountId, 'toAccountId', S.HEAD_ACCOUNT_TYPES.transfer);
        if (t.toAccountId && t.toAccountId === t.accountId) err('Transfer from and to accounts must be different.', 'toAccountId');
      }
    }
    if (this._validateInventory) this._validateInventory(t, prior, err);
    if (this._validateDeposits && !def.nonPosting) this._validateDeposits(t, err);   // CPA-12
    // CPA-25: Undeposited Funds only receives customer receipts; money spent comes out of a bank or card account
    var uf = this.sys('UNDEP');
    if (uf && (t.type === 'expense' || t.type === 'check' || t.type === 'ccCredit') && (t.lines || []).some(function (l) { return l.accountId === uf.id; }))
      err('Undeposited Funds holds customer payments waiting to be deposited. Choose another account for this line (use a deposit or transfer to move money out of it).', 'lines');
    if (this._validateBillable) this._validateBillable(t, prior, err);
    /* deposits of Undeposited Funds (1.14): each linked line moves one payment / receipt, in full, once */
    if (t.type === 'deposit') {
      var undep = this.sys('UNDEP'), seenDep = {};
      (t.lines || []).forEach(function (l, i) {
        if (!l.fromTxnId) return;
        var src = self.txById[l.fromTxnId];
        if (!src || src.status !== 'posted') { err('Line ' + (i + 1) + ': the payment being deposited no longer exists or was voided.', 'lines.' + i); return; }
        if (seenDep[l.fromTxnId]) err('Line ' + (i + 1) + ': the same payment is deposited twice.', 'lines.' + i); seenDep[l.fromTxnId] = 1;
        var by = self.depositedBy[l.fromTxnId];
        if (by && by !== t.id) err('Line ' + (i + 1) + ': ' + S.TXN_TYPES[src.type].label + ' ' + (src.number || U.fmtDate(src.date)) + ' is already in another deposit.', 'lines.' + i);
        if (!undep || l.accountId !== undep.id) err('Line ' + (i + 1) + ': a deposited payment must come from Undeposited Funds.', 'lines.' + i);
        if (l.amount !== self.undepositedAmount(src)) err('Line ' + (i + 1) + ': deposit the full ' + U.fmt(self.undepositedAmount(src), { symbol: true }) + ' of this payment.', 'lines.' + i);
      });
    }
    if (prior && this.depositedBy[prior.id] && this.txById[this.depositedBy[prior.id]]) {
      var dep = this.txById[this.depositedBy[prior.id]];
      if (this.undepositedAmount(Object.assign({}, t, { splits: this.buildSplitsSafe(t) })) !== this.undepositedAmount(prior))
        err('This payment is part of the deposit of ' + U.fmtDate(dep.date) + ' (' + U.fmt(dep.total, { symbol: true }) + '). Remove it from that deposit before changing its amount or account.');
    }
    /* applications */
    if (def.applies) {
      var seen = {}, applied = 0;
      t.applications.forEach(function (a) {
        var target = self.txById[a.txnId];
        var key = a.txnId + '|' + (a.date || '');   // the same document may be applied again on a later date (CPA-05)
        if (seen[key]) err('The same document is applied twice.'); seen[key] = 1;
        if (!target || target.status !== 'posted') { err('An applied document no longer exists or was voided.'); return; }
        if (def.applies.indexOf(target.type) < 0) err('A ' + def.label.toLowerCase() + ' cannot be applied to a ' + S.TXN_TYPES[target.type].label.toLowerCase() + '.');
        if (target.contactId !== t.contactId) err('Applied documents must belong to the same ' + def.contact + '.');
        if (a.amount < 0) err('Applied amounts cannot be negative.');
        var open = self.openBalance(target, t.id || '__new__');
        if (a.amount > open) err((S.TXN_TYPES[target.type].label) + ' ' + (target.number || '') + ' has only ' + U.fmt(open, { symbol: true }) + ' open; you applied ' + U.fmt(a.amount, { symbol: true }) + '.', 'applications');
        applied += a.amount;
      });
      var own = this.txnTotal(Object.assign({}, t, { splits: this.buildSplitsSafe(t) }));
      if (applied > own) err('Applied amounts (' + U.fmt(applied, { symbol: true }) + ') exceed the ' + def.label.toLowerCase() + ' total (' + U.fmt(own, { symbol: true }) + ').', 'applications');
      if (t.id) {
        var incomingTo = this.incomingApplied(t.id);
        if (applied + incomingTo > own) err('Other transactions already use ' + U.fmt(incomingTo, { symbol: true }) + ' of this credit; the total is too small.', 'amount');
      }
    }
    /* edits of documents that others are applied to */
    if (prior) {
      var incoming = this.incoming[prior.id] || [];
      if (incoming.length) {
        var tot = this.txnTotal(Object.assign({}, t, { splits: this.buildSplitsSafe(t) }));
        var inc = this.incomingApplied(prior.id);
        var out = U.sum(t.applications || [], function (a) { return a.amount; });
        if (tot < inc + out) err('Payments or credits of ' + U.fmt(inc, { symbol: true }) + ' are applied to this transaction; its total cannot be lower than that.', 'lines');
        if (t.contactId !== prior.contactId) err('Payments or credits are applied to this transaction, so its customer/vendor cannot change.', 'contactId');
      }
      if (prior.type !== t.type) err('The transaction type cannot be changed.');
      if (prior.status === 'void') err('Voided transactions cannot be edited.');
      if ((prior.splits || []).some(function (s) { return s.cleared === 'R'; })) err('This transaction includes reconciled lines. Undo the reconciliation before editing it.');
    }
    if (t.number && (t.type === 'invoice' || t.type === 'creditMemo' || t.type === 'salesReceipt' || t.type === 'estimate' || t.type === 'purchaseOrder')) {
      var dupNo = this.transactions.find(function (x) { return x.type === t.type && x.number === t.number && x.id !== t.id && x.status !== 'void'; });
      if (dupNo) err(def.label + ' number ' + t.number + ' is already used.', 'number');
    }
    if (!errs.length && !def.nonPosting) {
      var splits = this.buildSplits(t);
      var bal = U.sum(splits, function (s) { return s.amount; });
      if (bal !== 0) err('Internal error: transaction does not balance (' + U.fmt(bal) + ').');
      if (splits.length < 2 && t.type !== 'invAdjust') err('The transaction has no amounts to post.');
    }
    return errs;
  };
  Book.prototype.buildSplitsSafe = function (t) { try { return this.buildSplits(t); } catch (e) { return []; } };

  /** Possible duplicates: same type, date, total and contact (or import hash). */
  Book.prototype.findDuplicates = function (t) {
    var self = this;
    var total = this.txnTotal(Object.assign({}, t, { splits: this.buildSplitsSafe(t) }));
    return this.transactions.filter(function (x) {
      if (x.id === t.id || x.status !== 'posted') return false;
      if (t.importHash && x.importHash === t.importHash) return true;
      return x.type === t.type && x.date === t.date && (x.contactId || '') === (t.contactId || '') &&
        (x.accountId || '') === (t.accountId || '') && self.txnTotal(x) === total;
    });
  };

  Book.prototype.nextNumber = function (type) {
    var def = S.TXN_TYPES[type];
    var n = this.company.counters[type];
    if (n === undefined) return '';
    var self = this, num;
    do { num = (def.prefix || '') + n; n++; } while (this.transactions.some(function (x) { return x.type === type && x.number === num; }));
    return num;
  };

  /**
   * Validate and post (create or update) a transaction atomically.
   * Returns the saved transaction. Throws LedgerError with .errors on validation failure.
   */
  /** Warnings for a normalized transaction (CPA-15–18, CPA-08): worth a second look but not wrong, so forms ask
   *  "Save anyway?". saveTransaction / imports never call this. Returns [{ code, message, field }]. */
  Book.prototype.warnings = function (t, prior) {
    var self = this, out = [], selfId = prior ? prior.id : t.id, def = S.TXN_TYPES[t.type] || {};
    var w = function (code, message, field) { out.push({ code: code, message: message, field: field || '' }); };
    var others = function (fn) { return self.transactions.filter(function (x) { return x.status !== 'void' && x.id !== selfId && fn(x); }); };
    var num = String(t.number || '').trim().toLowerCase();
    if (t.type === 'bill' && num && t.contactId) {
      var dupB = others(function (x) { return x.type === 'bill' && x.contactId === t.contactId && String(x.number || '').trim().toLowerCase() === num; });
      if (dupB.length) w('CPA-15', (this.contactById[t.contactId] || {}).name + ' already has bill number ' + dupB[0].number + ' (' + U.fmtDate(dupB[0].date) + ', ' + U.fmt(dupB[0].total, { symbol: true }) + '). Is this the same bill?', 'number');
    }
    var CHK = { check: 1, billPayment: 1, expense: 1 };
    if (CHK[t.type] && num && t.accountId) {
      var dupC = others(function (x) { return CHK[x.type] && x.status === 'posted' && x.accountId === t.accountId && String(x.number || '').trim().toLowerCase() === num; });
      if (dupC.length) w('CPA-16', 'Check number ' + dupC[0].number + ' was already used from ' + (this.accById[t.accountId] || {}).name + ' (' + U.fmtDate(dupC[0].date) + ', ' + U.fmt(dupC[0].total, { symbol: true }) + ').', 'number');
    }
    var SALES = { invoice: 1, salesReceipt: 1, creditMemo: 1 }, BUYS = { bill: 1, check: 1, expense: 1 };
    (t.lines || []).forEach(function (l, i) {
      var a = self.accById[l.accountId]; if (!a) return;
      if (SALES[t.type] && !t.bounceOf && (a.type === 'bank' || a.type === 'cc' || a.type === 'fixed')) w('CPA-17', 'Line ' + (i + 1) + ' posts a sale to ' + a.name + ' (' + S.TYPE[a.type].label + '). Sales lines normally go to an income account.', 'lines.' + i);
      if (BUYS[t.type] && (a.type === 'income' || a.type === 'oi')) w('CPA-17', 'Line ' + (i + 1) + ' posts a purchase to ' + a.name + ' (an income account). Purchases normally go to an expense, cost or asset account.', 'lines.' + i);
    });
    var c = this.contactById[t.contactId];
    if (c && c.active === false && (!prior || prior.contactId !== t.contactId)) w('CPA-18', c.name + ' is inactive.', 'contactId');
    var had = {}; ((prior && prior.lines) || []).forEach(function (l) { if (l.itemId) had[l.itemId] = 1; });
    var seen = {};
    (t.lines || []).forEach(function (l) { var it = l.itemId && self.itemById[l.itemId]; if (it && it.active === false && !had[it.id] && !seen[it.id]) { seen[it.id] = 1; w('CPA-18', 'The item ' + it.name + ' is inactive.', 'lines'); } });
    (t.applications || []).forEach(function (ap) {
      var g = self.txById[ap.txnId];
      if (g && g.date > t.date) w('CPA-08', 'This ' + (def.label || '').toLowerCase() + ' is dated ' + U.fmtDate(t.date) + ', before ' + S.TXN_TYPES[g.type].label + ' ' + (g.number || '') + ' (' + U.fmtDate(g.date) + ') that it is applied to. It will count from ' + U.fmtDate(g.date) + '.', 'date');
    });
    return out;
  };
  /** Normalize, validate and build one transaction; returns the write ops and the in-memory apply step (throws on error). */
  Book.prototype._prepareSave = function (draft) {
    var self = this, t = this.normalize(draft), prior = null;
    // idempotency: the same form submission never posts twice
    if (!t.id && t.clientToken && this.tokenIndex[t.clientToken]) return { dup: this.txById[this.tokenIndex[t.clientToken]] };
    if (t.id) {
      prior = this.txById[t.id];
      if (!prior) throw LedgerError('Transaction not found.');
    }
    if (this._costInventory) this._costInventory(t); // average cost of items sold / adjusted, as of the document date (1.15)
    var errs = this.validate(t, prior);
    if (errs.length) {
      var e = LedgerError(errs.map(function (x) { return x.message; }).join('\n'));
      e.errors = errs; throw e;
    }
    var now = new Date().toISOString();
    var company = this.company, companyChanged = false;
    if (!t.number && company.counters[t.type] !== undefined && t.type !== 'check') {
      t.number = this.nextNumber(t.type);
    }
    var numMatch = t.number && t.number.match(/(\d+)$/);
    if (numMatch && company.counters[t.type] !== undefined && +numMatch[1] >= company.counters[t.type]) {
      company = U.clone(company); company.counters[t.type] = +numMatch[1] + 1; companyChanged = true;
    }
    t.splits = this.buildSplits(t);
    // keep cleared (C) marks for unchanged account/amount pairs on edit
    if (prior) {
      t.splits.forEach(function (s) {
        var m = prior.splits.find(function (p) { return p.accountId === s.accountId && p.amount === s.amount && p.cleared === 'C'; });
        if (m) s.cleared = 'C';
      });
    }
    t.total = this.txnTotal(t);
    var def0 = S.TXN_TYPES[t.type];
    t.status = def0.nonPosting ? (prior ? prior.status : 'open') : 'posted';
    if (prior && prior.linkedTo) t.linkedTo = prior.linkedTo;
    t.createdAt = prior ? prior.createdAt : now;
    t.updatedAt = now;
    t.version = prior ? (prior.version || 1) + 1 : 1;
    if (prior && prior.reversedBy) t.reversedBy = prior.reversedBy;
    if (!t.id) t.id = U.uid('txn');
    var def = S.TXN_TYPES[t.type];
    var audit = this._auditEntry(prior ? 'edit' : 'create', t.id,
      (prior ? 'Edited ' : 'Posted ') + def.label + (t.number ? ' ' + t.number : '') + ' ' + U.fmt(t.total, { symbol: true }), prior ? U.clone(prior) : null);
    var ops = [{ store: 'transactions', value: t }, { store: 'audit', value: audit }];
    if (companyChanged) ops.push({ store: 'company', value: company });
    // converting an estimate / purchase order closes it and links both documents (DOC_LINK)
    // progress invoicing (1.17): the source stays open until every line is fully invoiced / billed
    var src = t.sourceId ? this.txById[t.sourceId] : null, srcNew = null, srcAudit = null;
    if (src) {
      var full = this.sourceProgress(src.id, t.id, t).full;
      var isNew = !prior || prior.sourceId !== t.sourceId, linked = (src.linkedTo || []).indexOf(t.id) >= 0 ? src.linkedTo : (src.linkedTo || []).concat([t.id]);
      var st = full ? 'closed' : (isNew ? 'open' : src.status);
      if (isNew || st !== src.status) {
        srcNew = U.clone(src); srcNew.status = st; srcNew.updatedAt = now; srcNew.linkedTo = linked;
        if (isNew) srcAudit = this._auditEntry('convert', src.id, S.TXN_TYPES[src.type].label + (src.number ? ' ' + src.number : '') + ' → ' + def.label + (t.number ? ' ' + t.number : '') + (full ? '' : ' (part)'), U.clone(src));
        ops.push({ store: 'transactions', value: srcNew }); if (srcAudit) ops.push({ store: 'audit', value: srcAudit });
      }
    }
    return { t: t, ops: ops, apply: function () {
      if (prior) self.transactions[self.transactions.indexOf(prior)] = t; else self.transactions.push(t);
      self.audit.push(audit);
      if (srcNew) { self.transactions[self.transactions.indexOf(self.txById[src.id])] = srcNew; if (srcAudit) self.audit.push(srcAudit); }
      if (companyChanged) self.company = company;
    } };
  };
  Book.prototype.saveTransaction = function (draft) {
    var p;
    try { p = this._prepareSave(draft); } catch (e) { return Promise.reject(e); }
    if (p.dup) return Promise.resolve(p.dup);
    return this._commit(p.ops, p.apply).then(function () { return p.t; });
  };
  /** Save several transactions in ONE atomic write (CPA-13): each is validated against the ones before it; if any
   *  fails, or the write fails, nothing is kept. A draft may be a function of the transactions prepared so far. */
  Book.prototype.saveTransactions = function (drafts) {
    var self = this, keep = { tx: this.transactions.slice(), audit: this.audit.length, company: this.company, tip: this._auditTip }, done = [], ops = [];
    var undo = function () { self.transactions = keep.tx; self.audit.length = keep.audit; self.company = keep.company; self._auditTip = keep.tip; self.reindex(); };
    try {
      drafts.forEach(function (d) {
        var p = self._prepareSave(typeof d === 'function' ? d(done.slice()) : d);
        if (p.dup) throw LedgerError('This form was already saved.');
        p.apply(); self.reindex(); done.push(p.t); ops = ops.concat(p.ops);
      });
    } catch (e) { undo(); return Promise.reject(e); }
    return this.adapter.putMany(ops).then(function () { self.reindex(); return done; }, function (e) { undo(); throw e; });
  };

  /** Apply an unapplied payment / credit to an open document without editing the payment (CPA-05).
   *  Only `applications` change — amount, account, date, contact and splits stay the same, so a reconciled
   *  or closed-period payment can still be used. The application date must be in an open period. */
  Book.APPLY_CREDIT = { payment: 1, billPayment: 1, creditMemo: 1, vendorCredit: 1 };
  /** Unapplied credits a contact can use (CPA-06): credit memos and unapplied payments for a customer,
   *  vendor credits and unapplied bill payments for a vendor. [{ t, open }] oldest first. */
  Book.prototype.availableCredits = function (contactId, kind) {
    var self = this, c = this.contactById[contactId], k = kind || (c && c.kind) || 'customer';
    var types = k === 'vendor' ? { vendorCredit: 1, billPayment: 1 } : { creditMemo: 1, payment: 1 };
    return this.transactions.filter(function (t) { return t.status === 'posted' && t.contactId === contactId && types[t.type]; })
      .map(function (t) { return { t: t, open: self.openBalance(t) }; }).filter(function (x) { return x.open > 0; })
      .sort(function (a, b) { return cmpTxn(a.t, b.t); });
  };
  Book.prototype.applyCredit = function (sourceId, targetId, amount, date) {
    var self = this, src = this.txById[sourceId], tgt = this.txById[targetId], def = src && S.TXN_TYPES[src.type];
    var amt = typeof amount === 'number' ? Math.round(amount) : toC(amount);
    date = date || U.today();
    if (!src || src.status !== 'posted' || !Book.APPLY_CREDIT[src.type]) return Promise.reject(LedgerError('Choose a posted payment or credit to apply.'));
    if (!tgt || tgt.status !== 'posted' || def.applies.indexOf(tgt.type) < 0) return Promise.reject(LedgerError('A ' + def.label.toLowerCase() + ' cannot be applied to that document.'));
    if (tgt.contactId !== src.contactId) return Promise.reject(LedgerError('The credit and the document must belong to the same ' + def.contact + '.'));
    if (!U.isDate(date)) return Promise.reject(LedgerError('Enter a valid date.', 'date'));
    if (this.company.closingDate && date <= this.company.closingDate) return Promise.reject(LedgerError('The application date is in a closed period (on or before ' + U.fmtDate(this.company.closingDate) + ').', 'date'));
    if (!(amt > 0)) return Promise.reject(LedgerError('Enter an amount to apply.', 'amount'));
    var avail = this.openBalance(src), open = this.openBalance(tgt);
    if (amt > avail) return Promise.reject(LedgerError('This ' + def.label.toLowerCase() + ' has only ' + U.fmt(avail, { symbol: true }) + ' unapplied.', 'amount'));
    if (amt > open) return Promise.reject(LedgerError(S.TXN_TYPES[tgt.type].label + ' ' + (tgt.number || '') + ' has only ' + U.fmt(open, { symbol: true }) + ' open.', 'amount'));
    var c = U.clone(src), now = new Date().toISOString();
    c.applications = (c.applications || []).concat([{ txnId: tgt.id, amount: amt, date: date }]);
    c.updatedAt = now; c.version = (src.version || 1) + 1;
    var audit = this._auditEntry('apply', src.id, 'Applied ' + U.fmt(amt, { symbol: true }) + ' of ' + def.label + (src.number ? ' ' + src.number : '') + ' to ' +
      S.TXN_TYPES[tgt.type].label + (tgt.number ? ' ' + tgt.number : '') + ' on ' + U.fmtDate(date), U.clone(src));
    return this._commit([{ store: 'transactions', value: c }, { store: 'audit', value: audit }], function () {
      self.transactions[self.transactions.indexOf(src)] = c; self.audit.push(audit);
    }).then(function () { return c; });
  };

  /** Void: keeps the record (status 'void'), removes its effect from all reports. */
  Book.prototype.voidTransaction = function (id, reason, opts) {
    var self = this, prior = this.txById[id];
    if (!prior) return Promise.reject(LedgerError('Transaction not found.'));
    if (prior.status === 'void') return Promise.reject(LedgerError('This transaction is already void.'));
    if (this.voidedAsOf(prior)) return Promise.reject(LedgerError('This transaction was already voided as of ' + U.fmtDate(this.voidedAsOf(prior).date) + '.'));
    var pdef = S.TXN_TYPES[prior.type];
    if (opts && opts.asOf) return this._voidAsOf(prior, reason, opts.asOf);
    if (!pdef.nonPosting && this.company.closingDate && prior.date <= this.company.closingDate) return Promise.reject(LedgerError('This transaction is in a closed period and cannot be voided.'));
    var inc = this.incoming[id] || [];
    if (inc.length) {
      var labels = inc.map(function (x) { var s = self.txById[x.from]; return S.TXN_TYPES[s.type].label + ' ' + (s.number || U.fmtDate(s.date)); });
      return Promise.reject(LedgerError('Other transactions are applied to this one (' + labels.join(', ') + '). Void or edit those first.'));
    }
    if (prior.splits.some(function (s) { return s.cleared === 'R'; })) return Promise.reject(LedgerError('This transaction has been reconciled. Undo the reconciliation before voiding it.'));
    var depBy = this.depositedBy[id] && this.txById[this.depositedBy[id]];
    if (depBy) return Promise.reject(LedgerError('This payment is part of the deposit of ' + U.fmtDate(depBy.date) + ' (' + U.fmt(depBy.total, { symbol: true }) + '). Remove it from that deposit (or void the deposit) first.'));
    var t = U.clone(prior);
    t.status = 'void'; t.voidedAt = new Date().toISOString(); t.voidReason = reason || ''; t.updatedAt = t.voidedAt; t.version = (t.version || 1) + 1;
    var audit = this._auditEntry('void', id, 'Voided ' + S.TXN_TYPES[t.type].label + (t.number ? ' ' + t.number : '') + ' ' + U.fmt(t.total, { symbol: true }) + (reason ? ' — ' + reason : ''), U.clone(prior));
    var ops = [{ store: 'transactions', value: t }, { store: 'audit', value: audit }];
    // voiding the invoice/bill made from an estimate/PO reopens it when nothing else was made from it
    var src = prior.sourceId && this.txById[prior.sourceId], srcNew = null;
    if (src && src.status !== 'void') {
      srcNew = U.clone(src); srcNew.linkedTo = (src.linkedTo || []).filter(function (x) { return x !== id; });
      srcNew.status = this.sourceProgress(src.id, id).full ? 'closed' : 'open';
      srcNew.updatedAt = t.updatedAt; ops.push({ store: 'transactions', value: srcNew });
    }
    return this._commit(ops, function () {
      self.transactions[self.transactions.indexOf(prior)] = t; self.audit.push(audit);
      if (srcNew) self.transactions[self.transactions.indexOf(self.txById[src.id])] = srcNew;
    }).then(function () { return t; });
  };

  /** Close or reopen an estimate / purchase order by hand (no ledger effect). */
  Book.prototype.setDocStatus = function (id, status) {
    var self = this, prior = this.txById[id];
    if (!prior || !S.TXN_TYPES[prior.type].nonPosting) return Promise.reject(LedgerError('Only estimates and purchase orders can be closed or reopened.'));
    if (prior.status === 'void') return Promise.reject(LedgerError('This document is void.'));
    if (status !== 'open' && status !== 'closed') return Promise.reject(LedgerError('Unknown status.'));
    if (prior.status === status) return Promise.resolve(prior);
    var t = U.clone(prior); t.status = status; t.updatedAt = new Date().toISOString(); t.version = (t.version || 1) + 1;
    var audit = this._auditEntry(status === 'closed' ? 'close' : 'reopen', id, (status === 'closed' ? 'Closed ' : 'Reopened ') + S.TXN_TYPES[t.type].label + (t.number ? ' ' + t.number : ''), U.clone(prior));
    return this._commit([{ store: 'transactions', value: t }, { store: 'audit', value: audit }], function () {
      self.transactions[self.transactions.indexOf(prior)] = t; self.audit.push(audit);
    }).then(function () { return t; });
  };

  /** CPA-21: void "as of" a later date. The original stays posted in its (reported or closed) period; a journal entry
   *  dated asOf, in an open period, reverses every split, and the original is marked voided by it. One atomic write. */
  Book.prototype._voidAsOf = function (prior, reason, asOf) {
    var self = this, def = S.TXN_TYPES[prior.type], id = prior.id, cd = this.company.closingDate;
    if (def.nonPosting || prior.type === 'journal' && prior.voidOf) return Promise.reject(LedgerError('This transaction cannot be voided as of another date.'));
    if (!U.isDate(asOf) || asOf < prior.date || (cd && asOf <= cd)) return Promise.reject(LedgerError('Choose a void date on or after the transaction' + (cd ? ' and after the closing date (' + U.fmtDate(cd) + '), in an open period.' : '.'), 'asOf'));
    if ((this.incoming[id] || []).length) return Promise.reject(LedgerError('Other transactions are applied to this one. Void or edit those first.'));
    if ((prior.applications || []).length) return Promise.reject(LedgerError('This ' + def.label.toLowerCase() + ' is applied to other documents, so it cannot be voided as of another date.' + (prior.type === 'payment' ? ' For a returned payment, use Record bounced payment.' : '')));
    if (this.depositedBy[id] && this.txById[this.depositedBy[id]]) return Promise.reject(LedgerError('This payment is part of a deposit. Remove it from that deposit (or void the deposit) first.'));
    if (this.inventoryMoves && this.inventoryMoves(prior).length) return Promise.reject(LedgerError('A document that moves inventory cannot be voided as of another date. Void it in its own period, or post an inventory adjustment.'));
    var label = def.label + (prior.number ? ' ' + prior.number : '');
    var p;
    try {
      p = this._prepareSave({ type: 'journal', date: asOf, voidOf: id, memo: 'Void of ' + label + ' (' + U.fmtDate(prior.date) + ')' + (reason ? ' — ' + reason : ''),
        jlines: prior.splits.filter(function (sp) { return sp.amount; }).map(function (sp) { var l = { accountId: sp.accountId, debit: sp.amount < 0 ? -sp.amount : 0, credit: sp.amount > 0 ? sp.amount : 0, memo: sp.memo || '', contactId: sp.contactId || '' }; if (sp.classId) l.classId = sp.classId; return l; }) });
    } catch (e) { return Promise.reject(e); }
    var o = U.clone(prior); o.voidedBy = p.t.id; o.voidReason = reason || ''; o.updatedAt = new Date().toISOString();
    var audit = this._auditEntry('void', id, 'Voided ' + label + ' as of ' + U.fmtDate(asOf) + ' by a reversing entry' + (reason ? ' — ' + reason : ''), U.clone(prior));
    return this._commit(p.ops.concat([{ store: 'transactions', value: o }, { store: 'audit', value: audit }]), function () {
      p.apply(); self.transactions[self.transactions.indexOf(self.txById[id])] = o; self.audit.push(audit);
    }).then(function () { return p.t; });
  };
  /** Reverse a journal entry: posts an equal and opposite entry and links both. */
  Book.prototype.reverseJournal = function (id, date) {
    var self = this, orig = this.txById[id];
    if (!orig || orig.type !== 'journal') return Promise.reject(LedgerError('Only journal entries can be reversed. Void other transaction types instead.'));
    if (orig.status !== 'posted') return Promise.reject(LedgerError('Only posted entries can be reversed.'));
    if (orig.reversedBy && this.txById[orig.reversedBy] && this.txById[orig.reversedBy].status === 'posted') return Promise.reject(LedgerError('This entry has already been reversed.'));
    // CPA-14: keep the class (header and lines) and fixed asset links; default to the day after the original's month end
    var draft = {
      type: 'journal', date: date || U.addDays(U.monthEnd(orig.date), 1), memo: 'Reversal of JE ' + (orig.number || '') + (orig.memo ? ': ' + orig.memo : ''), reversalOf: orig.id,
      jlines: orig.jlines.map(function (l) { var r = { accountId: l.accountId, debit: l.credit, credit: l.debit, memo: l.memo, contactId: l.contactId }; if (l.classId) r.classId = l.classId; if (l.assetId) r.assetId = l.assetId; return r; })
    };
    if (orig.classId) draft.classId = orig.classId;
    return this._raw_saveTransaction(draft).then(function (rev) {
      var o = U.clone(self.txById[id]); o.reversedBy = rev.id; o.updatedAt = new Date().toISOString();
      return self._commit([{ store: 'transactions', value: o }], function () {
        var cur = self.txById[id]; self.transactions[self.transactions.indexOf(cur)] = o;
      }).then(function () { return rev; });
    });
  };

  /* ---------------- balances ---------------- */
  Book.prototype.normalSign = function (accountOrType) {
    var type = typeof accountOrType === 'string' ? accountOrType : accountOrType.type;
    return S.TYPE[type].normal === 'D' ? 1 : -1;
  };
  /** Raw (debit-positive) balance of an account for from..to inclusive (either optional). */
  Book.prototype.rawBalance = function (accountId, to, from) {
    var list = this.splitIndex()[accountId] || [], t = 0;
    for (var i = 0; i < list.length; i++) {
      var d = list[i].t.date;
      if (to && d > to) break;
      if (from && d < from) continue;
      t += list[i].s.amount;
    }
    return t;
  };
  /** Balance in the account's natural sign (assets positive, liabilities positive, income positive...). */
  Book.prototype.accountBalance = function (accountId, to, from) {
    var a = this.accById[accountId]; if (!a) return 0;
    return this.normalSign(a) * this.rawBalance(accountId, to, from);
  };
  /** Customer/vendor balance from the A/R or A/P subledger. */
  Book.prototype.contactBalance = function (contactId, to) {
    var c = this.contactById[contactId]; if (!c) return 0;
    var acc = c.kind === 'customer' ? this.sys('AR') : this.sys('AP');
    var list = this.splitIndex()[acc.id] || [], t = 0;
    for (var i = 0; i < list.length; i++) {
      if (to && list[i].t.date > to) break;
      if (list[i].s.contactId === contactId) t += list[i].s.amount;
    }
    return c.kind === 'customer' ? t : -t;
  };
  /** Register rows with running balance (natural sign). */
  Book.prototype.register = function (accountId, from, to) {
    var a = this.accById[accountId], sign = this.normalSign(a);
    var list = this.splitIndex()[accountId] || [], bal = 0, rows = [];
    for (var i = 0; i < list.length; i++) {
      var e = list[i], d = e.t.date;
      if (to && d > to) break;
      bal += sign * e.s.amount;
      if (from && d < from) continue;
      rows.push({ t: e.t, s: e.s, i: e.i, amount: e.s.amount, balance: bal });
    }
    return { rows: rows, openingBalance: from ? this.accountBalance(accountId, U.addDays(from, -1)) : 0 };
  };
  /** Name of the "other side" for a split row in a register. */
  Book.prototype.splitCounterpart = function (t, idx) {
    var self = this;
    var others = t.splits.filter(function (s, i) { return i !== idx; });
    var ids = []; others.forEach(function (s) { if (ids.indexOf(s.accountId) < 0) ids.push(s.accountId); });
    if (ids.length === 1) return this.accountLabel(ids[0]);
    return '-Split- (' + ids.length + ' accounts)';
  };

  /* ---------------- reconciliation ---------------- */
  Book.prototype.reconciledBalance = function (accountId) {
    var a = this.accById[accountId], sign = this.normalSign(a);
    return sign * U.sum((this.splitIndex()[accountId] || []).filter(function (e) { return e.s.cleared === 'R'; }), function (e) { return e.s.amount; });
  };
  Book.prototype.setCleared = function (txnId, splitIndex, flag) {
    var self = this, prior = this.txById[txnId];
    if (!prior || prior.status !== 'posted') return Promise.reject(LedgerError('Transaction not found.'));
    if (prior.splits[splitIndex].cleared === 'R') return Promise.reject(LedgerError('Reconciled lines cannot be changed here.'));
    var t = U.clone(prior); t.splits[splitIndex].cleared = flag ? 'C' : '';
    return this._commit([{ store: 'transactions', value: t }], function () { self.transactions[self.transactions.indexOf(prior)] = t; });
  };
  /**
   * Finish a reconciliation. refs: [{txnId, i}] of the splits the user ticked.
   * Validates that beginning + cleared activity equals the statement ending balance.
   */
  Book.RECON_DIFF_NAME = 'Reconciliation Discrepancies';
  /** opts.adjust (1.23): finish with a difference by posting an adjusting journal entry to the
   *  "Reconciliation Discrepancies" expense account (created when missing), dated on the statement date. */
  Book.prototype.finishReconciliation = function (accountId, statementDate, endingBalance, refs, opts) {
    var self = this, a = this.accById[accountId]; opts = opts || {};
    if (!a || ['bank', 'cc', 'oca', 'ocl', 'ltl'].indexOf(a.type) < 0) return Promise.reject(LedgerError('Choose a bank, credit card or other balance sheet account.'));
    if (!U.isDate(statementDate)) return Promise.reject(LedgerError('Enter the statement ending date.'));
    // CPA-20: statements are reconciled in order
    var lastRec = this.reconciliations.filter(function (r) { return r.accountId === accountId && !r.undone; }).sort(function (x, y) { return x.statementDate < y.statementDate ? 1 : -1; })[0];
    if (lastRec && statementDate <= lastRec.statementDate) return Promise.reject(LedgerError('The statement date must be after the last reconciliation of ' + a.name + ' (' + U.fmtDate(lastRec.statementDate) + ').'));
    var sign = this.normalSign(a), begin = this.reconciledBalance(accountId), cleared = 0;
    var byTxn = {};
    for (var k = 0; k < refs.length; k++) {
      var r = refs[k], t = this.txById[r.txnId];
      if (!t || t.status !== 'posted' || !t.splits[r.i] || t.splits[r.i].accountId !== accountId) return Promise.reject(LedgerError('A selected line is no longer valid. Reload the reconciliation.'));
      if (t.splits[r.i].cleared === 'R') return Promise.reject(LedgerError('A selected line is already reconciled.'));
      if (t.date > statementDate) return Promise.reject(LedgerError('A selected transaction is dated after the statement date.'));
      cleared += sign * t.splits[r.i].amount;
      (byTxn[r.txnId] = byTxn[r.txnId] || []).push(r.i);
    }
    var diff = endingBalance - (begin + cleared);
    if (diff !== 0 && !opts.adjust) return Promise.reject(LedgerError('The difference must be $0.00 to finish. Current difference: ' + U.fmt(diff, { symbol: true }) + '.'));
    var adj = null, ops = [], updated = [];
    var ensureDiffAccount = function () {
      var x = self.accounts.find(function (y) { return y.name === Book.RECON_DIFF_NAME && y.type === 'expense'; });
      if (x) return Promise.resolve(x);
      return self._raw_saveAccount({ name: Book.RECON_DIFF_NAME, type: 'expense', description: 'Differences accepted when finishing a reconciliation' });
    };
    var start = diff !== 0 ? ensureDiffAccount().then(function (dacc) {
      if (dacc.active === false) throw LedgerError('Make the ' + Book.RECON_DIFF_NAME + ' account active first.');
      var raw = sign * diff;   // change in the account's own debit(+)/credit(−) terms
      var p = self._prepareSave({ type: 'journal', date: statementDate, memo: 'Reconciliation adjustment for ' + a.name + ' statement ' + U.fmtDate(statementDate),
        jlines: [{ accountId: accountId, debit: raw > 0 ? raw : 0, credit: raw < 0 ? -raw : 0, memo: 'Reconciliation adjustment' }, { accountId: dacc.id, debit: raw < 0 ? -raw : 0, credit: raw > 0 ? raw : 0, memo: 'Reconciliation adjustment' }] });
      var k = p.t.splits.findIndex(function (x) { return x.accountId === accountId; });
      p.t.splits[k].cleared = 'R';
      adj = { p: p, i: k };
    }) : Promise.resolve();
    return start.then(function () {
    var refList = refs.map(function (r) { return { txnId: r.txnId, i: r.i }; });
    if (adj) { refList.push({ txnId: adj.p.t.id, i: adj.i }); cleared += diff; }
    var report = self._reconSnapshot(accountId, statementDate, refList, adj ? adj.p.t : null);
    var rec = { id: U.uid('rec'), accountId: accountId, statementDate: statementDate, beginningBalance: begin, endingBalance: endingBalance, clearedTotal: cleared, refs: refList, completedAt: new Date().toISOString(), undone: false, report: report };
    if (adj) { rec.adjustment = { txnId: adj.p.t.id, amount: diff }; ops = ops.concat(adj.p.ops); }
    Object.keys(byTxn).forEach(function (id) {
      var t = U.clone(self.txById[id]);
      byTxn[id].forEach(function (i) { t.splits[i].cleared = 'R'; });
      ops.push({ store: 'transactions', value: t }); updated.push(t);
    });
    var audit = self._auditEntry('reconcile', null, 'Reconciled ' + a.name + ' through ' + U.fmtDate(statementDate) + ', ending balance ' + U.fmt(endingBalance, { symbol: true }) + (adj ? ' with an adjustment of ' + U.fmt(diff, { symbol: true }) : ''));
    ops.push({ store: 'reconciliations', value: rec }, { store: 'audit', value: audit });
    return self._commit(ops, function () {
      if (adj) adj.p.apply();
      updated.forEach(function (t) { self.transactions[self.transactions.indexOf(self.txById[t.id])] = t; });
      self.reconciliations.push(rec); self.audit.push(audit);
    }).then(function () { self.reindex(); return rec; });
    });
  };
  /** A frozen record of a reconciliation (1.23): every cleared line and every line still outstanding on the
   *  statement date, as they were when it was finished, so the report reprints the same later. */
  Book.prototype._reconSnapshot = function (accountId, statementDate, refs, extraTxn) {
    var self = this, a = this.accById[accountId], sign = this.normalSign(a), want = {};
    refs.forEach(function (r) { want[r.txnId + ':' + r.i] = 1; });
    var row = function (t, i) { var s = t.splits[i]; return { txnId: t.id, i: i, date: t.date, type: t.type, number: t.number || '', name: (self.contactLabel ? self.contactLabel(s.contactId || t.contactId) : '') || '', memo: s.memo || t.memo || '', amount: sign * s.amount }; };
    var cleared = [], outstanding = [];
    (this.splitIndex()[accountId] || []).forEach(function (e) {
      if (e.t.status !== 'posted' || e.t.date > statementDate) return;
      if (want[e.t.id + ':' + e.i]) cleared.push(row(e.t, e.i));
      else if (e.s.cleared !== 'R') outstanding.push(row(e.t, e.i));
    });
    if (extraTxn) extraTxn.splits.forEach(function (s, i) { if (s.accountId === accountId) cleared.push(row(extraTxn, i)); });
    var register = this.accountBalance(accountId, statementDate) + (extraTxn ? U.sum(extraTxn.splits.filter(function (s) { return s.accountId === accountId; }), function (s) { return sign * s.amount; }) : 0);
    return { cleared: cleared, outstanding: outstanding, registerBalance: register, madeAt: new Date().toISOString() };
  };
  /** The report of a reconciliation: the frozen record, or (for reconciliations finished before 1.23) one rebuilt
   *  from today's data, marked rebuilt. */
  Book.prototype.reconReport = function (recId) {
    var rec = this.reconciliations.find(function (r) { return r.id === recId; }); if (!rec) return null;
    var rep = rec.report;
    if (!rep) {
      var self = this, sign = this.normalSign(this.accById[rec.accountId]), want = {};
      rec.refs.forEach(function (r) { want[r.txnId + ':' + r.i] = 1; });
      var cleared = rec.refs.map(function (r) { var t = self.txById[r.txnId], s = t && t.splits[r.i]; return s ? { txnId: t.id, i: r.i, date: t.date, type: t.type, number: t.number || '', name: (self.contactLabel ? self.contactLabel(s.contactId || t.contactId) : ''), memo: s.memo || t.memo || '', amount: sign * s.amount } : null; }).filter(Boolean);
      rep = { cleared: cleared, outstanding: null, registerBalance: null, rebuilt: true };
    }
    var ins = U.sum(rep.cleared.filter(function (x) { return x.amount > 0; }), function (x) { return x.amount; }), outs = U.sum(rep.cleared.filter(function (x) { return x.amount < 0; }), function (x) { return x.amount; });
    return Object.assign({ rec: rec, account: this.accById[rec.accountId], clearedIn: ins, clearedOut: outs,
      outstandingIn: rep.outstanding ? U.sum(rep.outstanding.filter(function (x) { return x.amount > 0; }), function (x) { return x.amount; }) : null,
      outstandingOut: rep.outstanding ? U.sum(rep.outstanding.filter(function (x) { return x.amount < 0; }), function (x) { return x.amount; }) : null }, rep);
  };
  Book.prototype.undoLastReconciliation = function (accountId, closingPassword) {
    var self = this;
    var recs = this.reconciliations.filter(function (r) { return r.accountId === accountId && !r.undone; })
      .sort(function (a, b) { return a.completedAt < b.completedAt ? 1 : -1; });
    if (!recs.length) return Promise.reject(LedgerError('There is no reconciliation to undo for this account.'));
    // CPA-19: a reconciliation in a closed period is part of the closed books
    var cd = this.company.closingDate;
    if (cd && recs[0].statementDate <= cd && this.company.closingPasswordHash && !Book.checkClosingPassword(this.company, closingPassword))
      return Promise.reject(LedgerError(closingPassword ? 'The closing date password is incorrect.' : 'This reconciliation is in a closed period (on or before ' + U.fmtDate(cd) + '). Enter the closing date password to undo it.', 'closingPassword'));
    var rec = U.clone(recs[0]); rec.undone = true; rec.undoneAt = new Date().toISOString();
    var ops = [{ store: 'reconciliations', value: rec }], updated = [];
    var byTxn = {};
    rec.refs.forEach(function (r) { (byTxn[r.txnId] = byTxn[r.txnId] || []).push(r.i); });
    Object.keys(byTxn).forEach(function (id) {
      if (!self.txById[id]) return;
      var t = U.clone(self.txById[id]);
      byTxn[id].forEach(function (i) { if (t.splits[i] && t.splits[i].cleared === 'R') t.splits[i].cleared = 'C'; });
      ops.push({ store: 'transactions', value: t }); updated.push(t);
    });
    var audit = this._auditEntry('unreconcile', null, 'Undid reconciliation of ' + this.accById[accountId].name + ' through ' + U.fmtDate(rec.statementDate));
    ops.push({ store: 'audit', value: audit });
    return this._commit(ops, function () {
      updated.forEach(function (t) { self.transactions[self.transactions.indexOf(self.txById[t.id])] = t; });
      self.reconciliations[self.reconciliations.indexOf(recs[0])] = rec; self.audit.push(audit);
    }).then(function () {
      var at = rec.adjustment && self.txById[rec.adjustment.txnId];   // 1.23: the adjustment goes with the reconciliation
      if (!at || at.status !== 'posted') return rec;
      return self._raw_voidTransaction(at.id, 'Reconciliation undone').then(function () { return rec; }, function () { return rec; });
    });
  };

  /* ---------------- opening balances ---------------- */
  Book.prototype.setOpeningBalance = function (accountId, date, amountCents) {
    var a = this.accById[accountId];
    if (!a || !S.isBS(a.type)) return Promise.reject(LedgerError('Opening balances apply to balance sheet accounts.'));
    if (a.type === 'ar' || a.type === 'ap') return Promise.reject(LedgerError('Enter opening A/R and A/P as invoices and bills so customer and vendor balances stay correct.'));
    if (!amountCents) return Promise.reject(LedgerError('Enter a non-zero opening balance.'));
    var obe = this.sys('OBE').id;
    if (accountId === obe) return Promise.reject(LedgerError('Choose an account other than Opening Balance Equity.'));
    var raw = this.normalSign(a) * amountCents; // debit-positive amount for the account
    var jl = [
      { accountId: accountId, debit: raw > 0 ? raw : 0, credit: raw < 0 ? -raw : 0, memo: 'Opening balance' },
      { accountId: obe, debit: raw < 0 ? -raw : 0, credit: raw > 0 ? raw : 0, memo: 'Opening balance' }
    ];
    return this.saveTransaction({ type: 'journal', date: date, memo: 'Opening balance — ' + a.name, jlines: jl });
  };

  /* ---------------- classes ---------------- */
  Book.prototype.saveClass = function (input) {
    var self = this;
    var existing = input.id ? this.classById[input.id] : null;
    var name = String(input.name || '').trim();
    if (!name) return Promise.reject(LedgerError('Class name is required.', 'name'));
    var dupe = this.classes.find(function (c) { return c.id !== input.id && c.name.toLowerCase() === name.toLowerCase() && (c.parentId || '') === (input.parentId || ''); });
    if (dupe) return Promise.reject(LedgerError('A class named "' + name + '" already exists.', 'name'));
    if (input.parentId) {
      var p = this.classById[input.parentId], guard = 0;
      if (!p) return Promise.reject(LedgerError('Invalid parent class.'));
      while (p && guard++ < 20) { if (p.id === input.id) return Promise.reject(LedgerError('A class cannot be inside itself.')); p = p.parentId ? this.classById[p.parentId] : null; }
    }
    var c = existing ? U.clone(existing) : { id: U.uid('cls'), active: true, createdAt: new Date().toISOString() };
    c.name = name; c.parentId = input.parentId || ''; c.description = String(input.description || '');
    if (input.active !== undefined) c.active = !!input.active;
    var audit = this._auditEntry(existing ? 'edit-class' : 'create-class', null, (existing ? 'Edited' : 'Created') + ' class ' + c.name, existing ? U.clone(existing) : null);
    return this._commit([{ store: 'classes', value: c }, { store: 'audit', value: audit }], function () {
      if (existing) self.classes[self.classes.indexOf(existing)] = c; else self.classes.push(c);
      self.audit.push(audit);
    }).then(function () { return c; });
  };
  /** Company features switched in Settings > Features: 'classes' | 'budgets' | '1099'. */
  Book.prototype.feature = function (name) {
    var c = this.company;
    if (name === 'classes') return !!c.useClasses;
    if (name === 'budgets') return c.useBudgets !== false;
    if (name === '1099') return c.use1099 !== false;
    return true;
  };
  Book.prototype.classFullName = function (id) {
    var c = this.classById[id]; if (!c) return '';
    var names = [c.name], p = c.parentId ? this.classById[c.parentId] : null, guard = 0;
    while (p && guard++ < 10) { names.unshift(p.name); p = p.parentId ? this.classById[p.parentId] : null; }
    return names.join(':');
  };
  Book.prototype.sortedClasses = function (filter) {
    var self = this;
    return this.classes.filter(filter || function () { return true; }).sort(function (a, b) { return self.classFullName(a.id).localeCompare(self.classFullName(b.id)); });
  };

  /* ---------------- budgets ----------------
   * { id, name, fyStart: 'YYYY-MM-01', classId, amounts: { accountId: [12 x cents, natural sign] } } */
  Book.prototype.saveBudget = function (input) {
    var self = this;
    var existing = input.id ? this.budgets.find(function (x) { return x.id === input.id; }) : null;
    var name = String(input.name || '').trim();
    if (!name) return Promise.reject(LedgerError('Budget name is required.', 'name'));
    if (!U.isDate(input.fyStart)) return Promise.reject(LedgerError('Choose the budget year.', 'fyStart'));
    if (input.classId && !this.classById[input.classId]) return Promise.reject(LedgerError('The selected class no longer exists.', 'classId'));
    var dupe = this.budgets.find(function (x) { return !x.deleted && x.id !== input.id && x.name.toLowerCase() === name.toLowerCase(); });
    if (dupe) return Promise.reject(LedgerError('A budget named "' + name + '" already exists.', 'name'));
    var amounts = {};
    Object.keys(input.amounts || {}).forEach(function (accId) {
      var a = self.accById[accId];
      if (!a || !S.isPL(a.type)) return;
      var row = (input.amounts[accId] || []).slice(0, 12).map(function (v) { return typeof v === 'number' && Number.isInteger(v) ? v : U.toCents(v || 0); });
      while (row.length < 12) row.push(0);
      if (row.some(function (v) { return v !== 0; })) amounts[accId] = row;
    });
    var bud = existing ? U.clone(existing) : { id: U.uid('bud'), createdAt: new Date().toISOString() };
    bud.name = name; bud.fyStart = U.monthStart(input.fyStart); bud.classId = input.classId || ''; bud.amounts = amounts; bud.updatedAt = new Date().toISOString();
    var audit = this._auditEntry(existing ? 'edit-budget' : 'create-budget', null, (existing ? 'Edited' : 'Created') + ' budget ' + bud.name);
    return this._commit([{ store: 'budgets', value: bud }, { store: 'audit', value: audit }], function () {
      if (existing) self.budgets[self.budgets.indexOf(existing)] = bud; else self.budgets.push(bud);
      self.audit.push(audit);
    }).then(function () { return bud; });
  };
  Book.prototype.deleteBudget = function (id) {
    var self = this, existing = this.budgets.find(function (x) { return x.id === id; });
    if (!existing) return Promise.resolve();
    var bud = U.clone(existing); bud.deleted = true;
    var audit = this._auditEntry('delete-budget', null, 'Deleted budget ' + bud.name);
    return this._commit([{ store: 'budgets', value: bud }, { store: 'audit', value: audit }], function () { self.budgets[self.budgets.indexOf(existing)] = bud; self.audit.push(audit); });
  };
  Book.prototype.activeBudgets = function () { return this.budgets.filter(function (x) { return !x.deleted; }).sort(function (a, b) { return a.fyStart < b.fyStart ? 1 : a.fyStart > b.fyStart ? -1 : a.name.localeCompare(b.name); }); };

  /* ---------------- saved (memorized) reports ----------------
   * { id, name, report: 'pnl' | 'bs' | 'builder' | ..., params: {...}, group } */
  Book.prototype.saveReport = function (input) {
    var self = this;
    var existing = input.id ? this.reports.find(function (x) { return x.id === input.id; }) : null;
    var name = String(input.name || '').trim();
    if (!name) return Promise.reject(LedgerError('Give the report a name.', 'name'));
    if (!input.report) return Promise.reject(LedgerError('Invalid report.'));
    var dupe = this.reports.find(function (x) { return !x.deleted && x.id !== input.id && x.name.toLowerCase() === name.toLowerCase(); });
    if (dupe) return Promise.reject(LedgerError('A saved report named "' + name + '" already exists.', 'name'));
    var r = existing ? U.clone(existing) : { id: U.uid('rpt'), createdAt: new Date().toISOString() };
    r.name = name; r.report = String(input.report); r.params = U.clone(input.params || {}); r.group = String(input.group || ''); r.updatedAt = new Date().toISOString();
    return this._commit([{ store: 'reports', value: r }], function () {
      if (existing) self.reports[self.reports.indexOf(existing)] = r; else self.reports.push(r);
    }).then(function () { return r; });
  };
  Book.prototype.deleteReport = function (id) {
    var self = this, existing = this.reports.find(function (x) { return x.id === id; });
    if (!existing) return Promise.resolve();
    var r = U.clone(existing); r.deleted = true;
    return this._commit([{ store: 'reports', value: r }], function () { self.reports[self.reports.indexOf(existing)] = r; });
  };
  Book.prototype.savedReports = function () { return this.reports.filter(function (x) { return !x.deleted; }).sort(function (a, b) { return a.name.localeCompare(b.name); }); };

  /* ---------------- rules & recurring ---------------- */
  Book.prototype.saveRule = function (input) {
    var self = this;
    if (!String(input.contains || '').trim()) return Promise.reject(LedgerError('Enter the text the bank description must contain.', 'contains'));
    if (!this.accById[input.accountId]) return Promise.reject(LedgerError('Choose a category account.', 'accountId'));
    var a = this.accById[input.accountId];
    if (a.type === 'ar' || a.type === 'ap') return Promise.reject(LedgerError('Rules cannot categorize to A/R or A/P.'));
    var existing = input.id ? this.rules.find(function (r) { return r.id === input.id; }) : null;
    var r = { id: existing ? existing.id : U.uid('rule'), name: String(input.name || input.contains).trim(), contains: String(input.contains).trim(),
      direction: ['in', 'out'].indexOf(input.direction) >= 0 ? input.direction : 'any', accountId: input.accountId, contactId: input.contactId || '',
      priority: +input.priority || 0, active: input.active !== false };
    return this._commit([{ store: 'rules', value: r }], function () {
      if (existing) self.rules[self.rules.indexOf(existing)] = r; else self.rules.push(r);
    }).then(function () { return r; });
  };
  Book.prototype.deleteRule = function (id) {
    var self = this;
    var existing = this.rules.find(function (r) { return r.id === id; });
    if (!existing) return Promise.resolve();
    var r = U.clone(existing); r.active = false; r.deleted = true;
    return this._commit([{ store: 'rules', value: r }], function () { self.rules[self.rules.indexOf(existing)] = r; });
  };
  /** First matching active rule for a bank line (amount: + money in, − money out). */
  Book.prototype.matchRule = function (description, amount) {
    var d = String(description || '').toLowerCase();
    var list = this.rules.filter(function (r) { return r.active && !r.deleted; }).sort(function (a, b) { return b.priority - a.priority; });
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      if (r.direction === 'in' && amount < 0) continue;
      if (r.direction === 'out' && amount > 0) continue;
      if (d.indexOf(r.contains.toLowerCase()) >= 0 && this.accById[r.accountId] && this.accById[r.accountId].active) return r;
    }
    return null;
  };

  Book.prototype.saveRecurring = function (input) {
    var self = this;
    var src = input.template;
    if (!src || !S.TXN_TYPES[src.type]) return Promise.reject(LedgerError('Invalid template.'));
    if (S.TXN_TYPES[src.type].applies && src.type !== 'invoice') return Promise.reject(LedgerError('Payments and credits cannot be recurring; use invoices, bills, expenses, checks, deposits, transfers or journal entries.'));
    if (['weekly', 'monthly', 'quarterly', 'yearly'].indexOf(input.frequency) < 0) return Promise.reject(LedgerError('Choose a frequency.'));
    if (!U.isDate(input.nextDate)) return Promise.reject(LedgerError('Enter the next date.', 'nextDate'));
    if (input.endDate && !U.isDate(input.endDate)) return Promise.reject(LedgerError('Invalid end date.', 'endDate'));
    // validate template is postable
    var test = U.clone(src); delete test.id; test.date = input.nextDate; test.number = '';
    try { var n = this.normalize(test); var errs = this.validate(n, null).filter(function (e) { return e.field !== 'date'; }); if (errs.length) return Promise.reject(LedgerError(errs.map(function (e) { return e.message; }).join('\n'))); }
    catch (e) { return Promise.reject(e); }
    var existing = input.id ? this.recurring.find(function (r) { return r.id === input.id; }) : null;
    var tpl = U.clone(src); delete tpl.id; delete tpl.splits; delete tpl.status; delete tpl.number; delete tpl.clientToken; delete tpl.createdAt; delete tpl.updatedAt; delete tpl.version; delete tpl.applications; delete tpl.importHash;
    var r = { id: existing ? existing.id : U.uid('rcr'), name: String(input.name || S.TXN_TYPES[src.type].label).trim(), template: tpl, frequency: input.frequency,
      nextDate: input.nextDate, endDate: input.endDate || '', active: input.active !== false, lastPosted: existing ? existing.lastPosted : '' };
    return this._commit([{ store: 'recurring', value: r }], function () {
      if (existing) self.recurring[self.recurring.indexOf(existing)] = r; else self.recurring.push(r);
    }).then(function () { return r; });
  };
  Book.prototype.dueRecurring = function (asOf) {
    asOf = asOf || U.today();
    return this.recurring.filter(function (r) { return r.active && !r.deleted && r.nextDate <= asOf && (!r.endDate || r.nextDate <= r.endDate); });
  };
  Book.prototype.advanceDate = function (date, freq) {
    if (freq === 'weekly') return U.addDays(date, 7);
    if (freq === 'monthly') return U.addMonths(date, 1);
    if (freq === 'quarterly') return U.addMonths(date, 3);
    return U.addMonths(date, 12);
  };
  /** Post one occurrence of a recurring template and advance its schedule. Idempotent per date. */
  Book.prototype.postRecurring = function (id) {
    var self = this, r = this.recurring.find(function (x) { return x.id === id; });
    if (!r) return Promise.reject(LedgerError('Recurring template not found.'));
    var draft = U.clone(r.template);
    draft.date = r.nextDate; draft.recurringId = r.id; draft.clientToken = 'rcr:' + r.id + ':' + r.nextDate;
    if (draft.dueDate && r.template.date) draft.dueDate = U.addDays(r.nextDate, Math.max(0, U.daysBetween(r.template.date, r.template.dueDate)));
    else if (draft.dueDate) draft.dueDate = r.nextDate;
    delete draft.number;
    return this._raw_saveTransaction(draft).then(function (t) {
      var nr = U.clone(r); nr.lastPosted = r.nextDate; nr.nextDate = self.advanceDate(r.nextDate, r.frequency);
      if (nr.endDate && nr.nextDate > nr.endDate) nr.active = false;
      return self._commit([{ store: 'recurring', value: nr }], function () { self.recurring[self.recurring.indexOf(r)] = nr; }).then(function () { return t; });
    });
  };
  Book.prototype.deleteRecurring = function (id) {
    var self = this, r = this.recurring.find(function (x) { return x.id === id; });
    if (!r) return Promise.resolve();
    var nr = U.clone(r); nr.active = false; nr.deleted = true;
    return this._commit([{ store: 'recurring', value: nr }], function () { self.recurring[self.recurring.indexOf(r)] = nr; });
  };

  /** Bulk-post many drafts (CSV import) in one atomic write. Returns {posted, skipped, errors}. */
  Book.prototype.postBatch = function (drafts) {
    var self = this, posted = [], errors = [], skipped = [];
    var tempTxns = [];
    var hashes = {};
    this.transactions.forEach(function (t) { if (t.importHash && t.status === 'posted') hashes[t.importHash] = true; });
    var now = new Date().toISOString();
    drafts.forEach(function (d, i) {
      try {
        var t = self.normalize(d);
        if (t.importHash && hashes[t.importHash]) { skipped.push({ index: i, reason: 'Already imported' }); return; }
        var errs = self.validate(t, null);
        if (errs.length) { errors.push({ index: i, message: errs.map(function (e) { return e.message; }).join(' ') }); return; }
        t.id = U.uid('txn'); t.splits = self.buildSplits(t); t.total = self.txnTotal(t); t.status = 'posted';
        t.createdAt = now; t.updatedAt = now; t.version = 1;
        if (t.importHash) hashes[t.importHash] = true;
        tempTxns.push(t);
      } catch (e) { errors.push({ index: i, message: e.message }); }
    });
    if (!tempTxns.length) return Promise.resolve({ posted: [], skipped: skipped, errors: errors });
    var audit = this._auditEntry('import', null, 'Imported ' + tempTxns.length + ' bank transactions');
    var ops = tempTxns.map(function (t) { return { store: 'transactions', value: t }; });
    ops.push({ store: 'audit', value: audit });
    return this._commit(ops, function () {
      tempTxns.forEach(function (t) { self.transactions.push(t); }); self.audit.push(audit);
    }).then(function () { return { posted: tempTxns, skipped: skipped, errors: errors }; });
  };

  /* ---------------- integrity ---------------- */
  Book.prototype.checkIntegrity = function () {
    var self = this, issues = [], ok = [];
    var ids = {};
    var totalRaw = 0;
    this.transactions.forEach(function (t) {
      if (ids[t.id]) issues.push('Duplicate transaction id ' + t.id); ids[t.id] = 1;
      if (t.status !== 'posted') return;
      var s = U.sum(t.splits, function (x) { return x.amount; });
      if (s !== 0) issues.push(S.TXN_TYPES[t.type].label + ' ' + (t.number || t.id) + ' on ' + t.date + ' is out of balance by ' + U.fmt(s));
      t.splits.forEach(function (x) {
        if (!self.accById[x.accountId]) issues.push('Transaction ' + (t.number || t.id) + ' references a missing account.');
        if (!Number.isInteger(x.amount)) issues.push('Transaction ' + (t.number || t.id) + ' has a non-integer amount.');
      });
      var rebuilt = self.buildSplitsSafe(t);
      if (rebuilt.length && U.stableStringify(rebuilt.map(stripCleared)) !== U.stableStringify(t.splits.map(stripCleared))) issues.push('Transaction ' + (t.number || t.id) + ' splits do not match its source lines.');
      totalRaw += s;
    });
    if (!issues.length) ok.push('Every posted transaction balances (debits = credits).');
    var tb = OB.reports ? OB.reports.trialBalance(this, {}) : null;
    if (tb) { if (tb.totalDebit !== tb.totalCredit) issues.push('Trial balance is out by ' + U.fmt(tb.totalDebit - tb.totalCredit)); else ok.push('Trial balance debits equal credits (' + U.fmt(tb.totalDebit, { symbol: true }) + ').'); }
    ['AR', 'AP'].forEach(function (code) {
      var acc = self.sys(code), kind = code === 'AR' ? 'customer' : 'vendor';
      var accBal = self.accountBalance(acc.id);
      var sub = U.sum(self.contacts.filter(function (c) { return c.kind === kind; }), function (c) { return self.contactBalance(c.id); });
      var orphan = (self.splitIndex()[acc.id] || []).filter(function (e) { return !self.contactById[e.s.contactId]; });
      if (orphan.length) issues.push(acc.name + ' has ' + orphan.length + ' lines without a valid ' + kind + '.');
      if (accBal !== sub) issues.push(acc.name + ' (' + U.fmt(accBal) + ') does not equal the total of ' + kind + ' balances (' + U.fmt(sub) + ').');
      else ok.push(acc.name + ' equals the sum of ' + kind + ' balances (' + U.fmt(accBal, { symbol: true }) + ').');
      // open documents must reconcile to subledger
      var docTypes = code === 'AR' ? { invoice: 1, creditMemo: -1, payment: -1, customerRefund: 1 } : { bill: 1, vendorCredit: -1, billPayment: -1, vendorRefund: 1 };
      var openSum = 0;
      self.transactions.forEach(function (t) { if (t.status === 'posted' && docTypes[t.type]) openSum += docTypes[t.type] * self.openBalance(t); });
      var otherAR = U.sum((self.splitIndex()[acc.id] || []).filter(function (e) { return docTypes[e.t.type] === undefined && !(e.t.voidOf && docTypes[(self.txById[e.t.voidOf] || {}).type]); }), function (e) { return (code === 'AR' ? 1 : -1) * e.s.amount; });
      if (openSum + otherAR !== accBal) issues.push(acc.name + ': open documents (' + U.fmt(openSum + otherAR) + ') do not reconcile to the account balance (' + U.fmt(accBal) + ').');
      else ok.push(acc.name + ' open documents reconcile to the account balance.');
    });
    this.transactions.forEach(function (t) {
      if (t.status !== 'posted') return;
      if (S.TXN_TYPES[t.type].applies || t.type === 'invoice' || t.type === 'bill') {
        var ob = self.openBalance(t);
        if (ob < 0) issues.push(S.TXN_TYPES[t.type].label + ' ' + (t.number || t.id) + ' is over-applied by ' + U.fmt(-ob));
      }
    });
    var bs = OB.reports ? OB.reports.balanceSheet(this, { asOf: '9999-12-31' }) : null;
    if (bs) { if (bs.totalAssets !== bs.totalLiabEquity) issues.push('Balance sheet does not balance: assets ' + U.fmt(bs.totalAssets) + ' vs liabilities + equity ' + U.fmt(bs.totalLiabEquity)); else ok.push('Balance sheet balances: assets = liabilities + equity (' + U.fmt(bs.totalAssets, { symbol: true }) + ').'); }
    var va = this.verifyAudit();
    va.problems.forEach(function (p) { issues.push(p); });
    if (!va.problems.length && va.chained) ok.push('Audit trail intact: ' + va.chained + ' entries verified by their SHA-256 chain' + (va.legacy ? ' (' + va.legacy + ' older entries from before 1.13 are not chained)' : '') + '.');
    return { ok: ok, issues: issues, checkedAt: new Date().toISOString(), transactions: this.transactions.length };
  };
  function stripCleared(s) { return { accountId: s.accountId, amount: s.amount, contactId: s.contactId, memo: s.memo, classId: s.classId || '' }; }

  /* ---------------- serialization ----------------
   * Every mutating operation runs validate→persist→apply as one unit in a queue,
   * so double clicks or concurrent calls can never both pass validation. */
  ['saveTransaction', 'saveTransactions', 'voidTransaction', 'reverseJournal', 'postRecurring', 'postBatch', 'finishReconciliation', 'undoLastReconciliation',
    'setCleared', 'saveAccount', 'saveContact', 'saveCompany', 'saveRule', 'deleteRule', 'saveRecurring', 'deleteRecurring',
    'saveClass', 'saveBudget', 'deleteBudget', 'saveReport', 'deleteReport', 'saveSalesTax', 'setDocStatus', 'applyCredit'].forEach(function (name) {
    var raw = Book.prototype[name];
    Book.prototype['_raw_' + name] = raw;
    Book.prototype[name] = function () {
      var self = this, args = arguments;
      var p = this._queue.then(function () { return raw.apply(self, args); });
      this._queue = p.catch(function () {});
      return p;
    };
  });

  /* ---------------- memory adapter (tests) ---------------- */
  OB.MemoryAdapter = function () { this.data = { company: null }; this.writes = 0; this.failNext = false; };
  OB.MemoryAdapter.prototype.putMany = function (ops) {
    var self = this;
    if (this.failNext) { this.failNext = false; return Promise.reject(new Error('Simulated storage failure')); }
    ops.forEach(function (o) {
      if (o.store === 'company') self.data.company = U.clone(o.value);
      else { var m = self.data[o.store] = self.data[o.store] || {}; m[o.value.id] = U.clone(o.value); }
    });
    this.writes++;
    return Promise.resolve();
  };
  OB.MemoryAdapter.prototype.loadAll = function () {
    var self = this, d = { company: U.clone(this.data.company) };
    STORES.forEach(function (s) { d[s] = Object.keys(self.data[s] || {}).map(function (k) { return U.clone(self.data[s][k]); }); });
    return Promise.resolve(d);
  };
})(typeof window !== 'undefined' ? window : globalThis);
