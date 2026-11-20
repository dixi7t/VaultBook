/* VaultBook — sales workflows (1.17): price levels, customer deposits / retainers, batch invoicing and
 * progress invoicing drafts. Postings go through Book.saveTransaction. */
(function (root) {
  'use strict';
  var OB = root.OB, U = OB.util, S = OB.schema, Book = OB.Book, R = OB.reports;
  function LedgerError(msg, field) { var e = new Error(msg); e.name = 'LedgerError'; e.field = field; return e; }

  /* ---------- price levels ---------- */
  /** Price levels: method 'pct' raises or lowers every item's price by pct %; method 'item' sets a price per item. */
  Book.prototype.savePriceLevel = function (input) {
    var self = this, c = U.clone(this.company), list = c.priceLevels = c.priceLevels || [];
    var existing = input.id ? list.find(function (x) { return x.id === input.id; }) : null;
    if (input.id && !existing) return Promise.reject(LedgerError('Price level not found.'));
    var name = String(input.name || '').trim(); if (!name) return Promise.reject(LedgerError('Name the price level.', 'name'));
    if (list.some(function (x) { return x.id !== input.id && x.name.toLowerCase() === name.toLowerCase(); })) return Promise.reject(LedgerError('A price level named "' + name + '" already exists.', 'name'));
    var method = input.method === 'item' ? 'item' : 'pct', pct = +input.pct || 0;
    if (method === 'pct' && !(pct > -100 && pct <= 1000)) return Promise.reject(LedgerError('Enter a percentage above −100.', 'pct'));
    var prices = {};
    if (method === 'item') Object.keys(input.prices || {}).forEach(function (k) {
      var v = input.prices[k]; if (v === '' || v === null || v === undefined || !self.itemById[k]) return;
      prices[k] = typeof v === 'number' ? v : U.toCents(v);
    });
    var p = existing ? U.clone(existing) : { id: U.uid('pl'), active: true };
    Object.assign(p, { name: name, method: method, pct: method === 'pct' ? pct : 0, prices: prices });
    if (input.active !== undefined) p.active = !!input.active;
    if (existing) list[list.indexOf(existing)] = p; else list.push(p);
    var audit = this._auditEntry(existing ? 'edit-pricelevel' : 'create-pricelevel', null, (existing ? 'Edited' : 'Created') + ' price level ' + p.name);
    return this._commit([{ store: 'company', value: c }, { store: 'audit', value: audit }], function () { self.company = c; self.audit.push(audit); }).then(function () { return p; });
  };
  Book.prototype.priceLevelById = function (id) { return (this.company.priceLevels || []).find(function (x) { return x.id === id; }) || null; };
  /** Sales price of an item for a customer (their price level, else the item price). Jobs use the parent's level. */
  Book.prototype.priceFor = function (itemId, contactId) {
    var it = this.itemById[itemId]; if (!it) return null;
    var c = this.contactById[contactId], g = 0;
    while (c && !c.priceLevelId && c.parentId && g++ < 20) c = this.contactById[c.parentId];
    var pl = c && c.priceLevelId ? this.priceLevelById(c.priceLevelId) : null;
    if (!pl || pl.active === false) return it.price;
    if (pl.method === 'item') return pl.prices[itemId] !== undefined ? pl.prices[itemId] : it.price;
    return it.price === null || it.price === undefined ? null : Math.round(it.price * (100 + pl.pct) / 100);
  };

  /* ---------- customer deposits / retainers ---------- */
  Book.prototype.depositAccount = function () { return this.sys('CUSTDEP') || this.accounts.find(function (a) { return a.type === 'ocl' && /customer deposit|retainer/i.test(a.name); }) || null; };
  /** Deposits held for a customer (and its jobs when withJobs): credit balance of Customer Deposits for that name. */
  Book.prototype.depositsHeld = function (contactId, withJobs, asOf, excludeId) {
    var acc = this.depositAccount(); if (!acc) return 0;
    var self = this, ids = {}; ids[contactId] = 1;
    if (withJobs) this.contacts.forEach(function (c) { if (c.parentId === contactId) ids[c.id] = 1; });
    return -U.sum((this.splitIndex()[acc.id] || []).filter(function (e) { return ids[e.s.contactId || e.t.contactId] && (!asOf || e.t.date <= asOf) && e.t.id !== excludeId; }), function (e) { return e.s.amount; });
  };
  /** CPA-12: a document may not use more of a customer's deposits than are held for it (and its jobs) on its date. */
  Book.prototype._validateDeposits = function (t, err) {
    var acc = this.depositAccount(); if (!acc || ['invoice', 'check', 'expense'].indexOf(t.type) < 0) return;
    var self = this, used = {};
    this.buildSplitsSafe(t).forEach(function (s) { if (s.accountId === acc.id && s.amount > 0) { var k = s.contactId || t.contactId || ''; used[k] = (used[k] || 0) + s.amount; } });
    Object.keys(used).forEach(function (cid) {
      var c = self.contactById[cid];
      if (!c || c.kind !== 'customer') { err('Lines that use ' + acc.name + ' need the customer the deposit belongs to.', 'lines'); return; }
      var top = c.parentId && self.contactById[c.parentId] ? c.parentId : cid, held = self.depositsHeld(top, true, t.date, t.id);
      if (used[cid] > held) err('Only ' + U.fmt(Math.max(0, held), { symbol: true }) + ' of deposits is held for ' + c.name + ' on ' + U.fmtDate(t.date) + '; this uses ' + U.fmt(used[cid], { symbol: true }) + '.', 'lines');
    });
  };
  /** Refund a customer's deposit: a check from a bank account debiting Customer Deposits (capped like any use). */
  Book.prototype.refundDeposit = function (input) {
    var acc = this.depositAccount(); if (!acc) return Promise.reject(LedgerError('There are no customer deposits to refund.'));
    return this.saveTransaction({ type: 'check', date: input.date, contactId: input.contactId, accountId: input.accountId, number: input.number || '', memo: input.memo || 'Deposit refund',
      lines: [{ accountId: acc.id, description: input.description || 'Refund of deposit / retainer', amount: input.amount, contactId: input.contactId }] });
  };
  /** Receive a deposit or retainer: a sales receipt whose line goes to the Customer Deposits liability. */
  Book.prototype.receiveDeposit = function (input) {
    var self = this;
    return this.ensureAccount('CUSTDEP', /customer deposit|retainer/i, 2150, 'Customer Deposits', 'ocl').then(function (acc) {
      return self.saveTransaction({ type: 'salesReceipt', date: input.date, contactId: input.contactId, accountId: input.accountId, number: input.number || '', memo: input.memo || 'Deposit / retainer',
        message: '', lines: [{ accountId: acc.id, description: input.description || 'Deposit / retainer received', amount: input.amount, contactId: input.contactId }] });
    });
  };

  /* ---------- batch invoicing ---------- */
  /** One invoice per customer with the same lines. Each customer's terms, sales tax and price level apply. */
  Book.prototype.batchInvoices = function (customerIds, tpl) {
    var self = this, out = [], errors = [];
    if (!customerIds || !customerIds.length) return Promise.reject(LedgerError('Choose the customers to invoice.'));
    if (!tpl.lines || !tpl.lines.length) return Promise.reject(LedgerError('Add at least one line.'));
    return customerIds.reduce(function (p, cid) {
      return p.then(function () {
        var c = self.contactById[cid]; if (!c) return;
        var terms = c.terms === undefined || c.terms === '' ? self.company.defaultTerms : c.terms;
        var lines = tpl.lines.map(function (l) {
          var rate = l.itemId ? self.priceFor(l.itemId, cid) : null;
          var ln = Object.assign({}, l);
          if (l.itemId && (l.rate === '' || l.rate === undefined || l.rate === null) && rate !== null) { ln.rate = rate; ln.amount = ''; }
          return ln;
        });
        var taxId = tpl.taxId === 'customer' ? (c.taxExempt ? '' : (c.salesTaxId || self.company.defaultSalesTaxId || '')) : (tpl.taxId || '');
        return self.saveTransaction({ type: 'invoice', date: tpl.date, contactId: cid, terms: terms, dueDate: U.addDays(tpl.date, +terms || 0), memo: tpl.memo || '', message: tpl.message, taxId: taxId, lines: lines, classId: tpl.classId || '' })
          .then(function (t) { out.push(t); }, function (e) { errors.push({ contactId: cid, name: c.name, message: e.message }); });
      });
    }, Promise.resolve()).then(function () { return { posted: out, errors: errors }; });
  };

  /* ---------- progress invoicing ---------- */
  /** Draft lines to invoice from an estimate / sales order (or bill from a PO): mode 'rest' (all that is left) or
   *  'pct' (pct % of each line's original amount, never more than what is left). */
  Book.prototype.progressLines = function (srcId, mode, pct) {
    var src = this.txById[srcId]; if (!src) return [];
    var pr = this.sourceProgress(srcId);
    return (src.lines || []).map(function (l, i) {
      var left = l.amount - pr.done[i], amt = mode === 'pct' ? Math.min(left, Math.round(l.amount * (+pct || 0) / 100)) : left;
      if (l.amount > 0 && amt <= 0) return null;
      var ln = { accountId: l.accountId, itemId: l.itemId || '', description: l.description || '', amount: amt, srcLine: i, taxable: !!l.taxable, classId: l.classId || '' };
      if (l.qty !== null && l.qty !== undefined && l.rate !== null && l.rate !== undefined && amt === l.amount) { ln.qty = l.qty; ln.rate = l.rate; }
      else if (mode === 'pct' && l.qty !== null && l.qty !== undefined) ln.description = (l.description || '') + ' (' + (+pct) + '%)';
      return ln;
    }).filter(Boolean);
  };

  ['savePriceLevel'].forEach(function (name) {
    var raw = Book.prototype[name]; Book.prototype['_raw_' + name] = raw;
    Book.prototype[name] = function () { var self = this, args = arguments, p = this._queue.then(function () { return raw.apply(self, args); }); this._queue = p.catch(function () {}); return p; };
  });
})(typeof window !== 'undefined' ? window : globalThis);
