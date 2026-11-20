/* VaultBook — Reclassify transactions (accountant tool, like QuickBooks Accountant's Client Data Review).
 * Move posted transaction lines from one account to another and/or change their class, one by one or all at once.
 * Every change goes through saveTransactions (one atomic write, every rule re-checked) and is recorded as a batch
 * that can be undone while the transactions are unchanged since.
 *
 * Book.prototype.reclassRows(o) → rows of the lines on an account (or on every account when o.accountId is '')
 *   o: accountId, from, to, contactId, show ('all' | 'nonitem' | 'item' | 'head'), types[], memo, min, max (cents, on |amount|)
 *   row: { key, txnId, ref: { part: 'head'|'to'|'line'|'jline', i }, date, type, number, name, memo, accountId,
 *          classId, amount (signed, as posted to the account), item (true = the account comes from a product),
 *          canAccount, canClass, why (reason a part can't change) }
 * Book.prototype.reclassPreview(keys, change) → { moves: [{ from, to, amount }], classes, txns, blocked: [{ key, why }] }
 *   change: { accountId?, classId? ('' = no class, undefined = keep) }
 * Book.prototype.reclassify(keys, change, note) → Promise<{ batchId, txns, lines }>
 * Book.prototype.reclassBatches() / undoReclass(batchId)
 */
(function (root) {
  'use strict';
  var OB = root.OB, U = OB.util, S = OB.schema, Book = OB.Book;
  function err(m) { var e = new Error(m); e.name = 'LedgerError'; return e; }

  /** The parts of a document that carry an account, with the amount each posts (debit +). */
  function parts(b, t) {
    var def = S.TXN_TYPES[t.type], out = [], tcls = t.classId || '';
    if (!def || def.nonPosting || t.status !== 'posted') return out;
    var ar = b.sys('AR').id, ap = b.sys('AP').id;
    if (!def.special) {
      var sign = def.headSide === 'D' ? 1 : -1, total = b.lineTotal(t.lines) + (t.tax || 0);
      var headId = def.head === 'AR' ? ar : def.head === 'AP' ? ap : t.accountId;
      out.push({ part: 'head', i: 0, accountId: headId, classId: tcls, amount: sign * total, memo: t.memo, sys: def.head === 'AR' || def.head === 'AP' });
      (t.lines || []).forEach(function (l, i) {
        if (!l.amount) return;
        out.push({ part: 'line', i: i, accountId: l.accountId, classId: l.classId || tcls, amount: -sign * l.amount, memo: l.description, item: !!l.itemId, cost: !!l.cost, deposited: !!l.fromTxnId });
      });
      return out;
    }
    switch (t.type) {
      case 'payment': case 'vendorRefund': out.push({ part: 'head', i: 0, accountId: t.accountId, classId: tcls, amount: t.amount, memo: t.memo }); break;
      case 'customerRefund': case 'billPayment': out.push({ part: 'head', i: 0, accountId: t.accountId, classId: tcls, amount: -t.amount, memo: t.memo }); break;
      case 'transfer':
        out.push({ part: 'head', i: 0, accountId: t.accountId, classId: tcls, amount: -t.amount, memo: t.memo });
        out.push({ part: 'to', i: 0, accountId: t.toAccountId, classId: tcls, amount: t.amount, memo: t.memo }); break;
      case 'journal':
        (t.jlines || []).forEach(function (l, i) { var a = (l.debit || 0) - (l.credit || 0); if (a) out.push({ part: 'jline', i: i, accountId: l.accountId, classId: l.classId || tcls, amount: a, memo: l.memo, sys: l.accountId === ar || l.accountId === ap }); });
        break;
    }
    return out;
  }
  Book.prototype.reclassParts = function (t) { return parts(this, t); };

  /** Which posted split a part produced (same account and amount, in order) — used for bank-feed links. */
  function splitIndexes(t, list) {
    var used = {};
    return list.map(function (p) {
      for (var i = 0; i < (t.splits || []).length; i++) { var s = t.splits[i]; if (!used[i] && s.accountId === p.accountId && s.amount === p.amount) { used[i] = 1; return i; } }
      return -1;
    });
  }

  function whyNot(b, t, p, si, linked) {
    var cd = b.company.closingDate;
    if (cd && t.date <= cd) return { all: 'In a closed period (on or before ' + U.fmtDate(cd) + ').' };
    if ((t.splits || []).some(function (s) { return s.cleared === 'R'; })) return { all: 'Reconciled. Undo the reconciliation first.' };
    if (t.type === 'invAdjust') return { all: 'Inventory adjustments are changed on the adjustment itself.' };
    var acc = '';
    if (p.sys) acc = 'Accounts Receivable and Payable lines follow their customer or vendor; change the invoice or bill instead.';
    else if (p.item) acc = 'The account comes from the product or service. Change the item, or change only the class.';
    else if (p.cost) acc = 'Inventory cost line. Change only the class.';
    else if (p.deposited) acc = 'A payment taken out of Undeposited Funds by this deposit.';
    else if (p.part === 'head' && b.depositedBy && b.depositedBy[t.id] && b.sys('UNDEP') && p.accountId === b.sys('UNDEP').id) acc = 'Already in a deposit. Remove it from the deposit first.';
    else if (si >= 0 && linked[t.id + ':' + si]) acc = 'Matched to a bank feed line. Undo the match in the Bank feed first.';
    var cls = p.part === 'to' ? 'A transfer has one class; change it on the "from" side.' : '';
    return { acc: acc, cls: cls };
  }

  Book.prototype.reclassRows = function (o) {
    var b = this; o = o || {};
    var from = U.isDate(o.from) ? o.from : '', to = U.isDate(o.to) ? o.to : '';
    var linked = b._bankLinked ? b._bankLinked() : {}, rows = [];
    b.transactions.forEach(function (t) {
      if (t.status !== 'posted' || (from && t.date < from) || (to && t.date > to)) return;
      if (o.types && o.types.length && o.types.indexOf(t.type) < 0) return;
      if (o.contactId && t.contactId !== o.contactId) return;
      var list = parts(b, t); if (!list.length) return;
      var idx = splitIndexes(t, list);
      list.forEach(function (p, n) {
        if (o.accountId && p.accountId !== o.accountId) return;
        if (o.show === 'nonitem' && (p.item || p.part === 'head' || p.part === 'to')) return;
        if (o.show === 'item' && !p.item) return;
        if (o.show === 'head' && p.part !== 'head' && p.part !== 'to') return;
        var amt = Math.abs(p.amount);
        if (o.min !== undefined && o.min !== '' && o.min !== null && amt < +o.min) return;
        if (o.max !== undefined && o.max !== '' && o.max !== null && amt > +o.max) return;
        var name = b.contactLabel ? b.contactLabel(t.contactId) : '';
        if (o.memo) { var q = String(o.memo).toLowerCase(); if ((String(p.memo || '') + ' ' + (t.memo || '') + ' ' + name + ' ' + (t.number || '')).toLowerCase().indexOf(q) < 0) return; }
        var w = whyNot(b, t, p, idx[n], linked);
        rows.push({ key: t.id + '|' + p.part + '|' + p.i, txnId: t.id, ref: { part: p.part, i: p.i }, date: t.date, type: t.type, number: t.number || '', name: name,
          memo: p.memo || t.memo || '', accountId: p.accountId, classId: p.classId || '', amount: p.amount, item: !!p.item,
          canAccount: !w.all && !w.acc, canClass: !w.all && !w.cls, why: w.all || w.acc || w.cls || '' });
      });
    });
    rows.sort(function (x, y) { return x.date < y.date ? -1 : x.date > y.date ? 1 : String(x.number).localeCompare(String(y.number), undefined, { numeric: true }); });
    return rows;
  };

  /** Activity per account for the accounts pane: { accountId: { count, net } } over the period. */
  Book.prototype.reclassActivity = function (from, to) {
    var b = this, out = {};
    b.transactions.forEach(function (t) {
      if (t.status !== 'posted' || (from && t.date < from) || (to && t.date > to)) return;
      parts(b, t).forEach(function (p) { var x = out[p.accountId] = out[p.accountId] || { count: 0, net: 0 }; x.count++; x.net += p.amount; });
    });
    return out;
  };

  function headTypesOk(b, t, part, accId) {
    var a = b.accById[accId]; if (!a) return 'Choose an account that exists.';
    if (a.active === false) return a.name + ' is inactive.';
    if (a.system === 'AR' || a.system === 'AP' || a.id === b.sys('AR').id || a.id === b.sys('AP').id) return 'Lines can’t be moved into Accounts Receivable or Payable; use an invoice, bill or journal entry with a name.';
    if ((part === 'head' || part === 'to') && S.HEAD_ACCOUNT_TYPES[t.type]) {
      var ok = S.HEAD_ACCOUNT_TYPES[t.type]; if (ok.indexOf(a.type) < 0) return 'A ' + S.TXN_TYPES[t.type].label.toLowerCase() + ' must come from a ' + ok.map(function (x) { return S.TYPE[x] ? S.TYPE[x].label.toLowerCase() : x; }).join(' or ') + ' account.';
    }
    return '';
  }

  /** Plan a reclassification. Returns { drafts, moves, classes, txns, lines, blocked }. */
  function plan(b, keys, change) {
    var want = {}, blocked = [], byTxn = {};
    (keys || []).forEach(function (k) { want[k] = 1; var id = k.split('|')[0]; (byTxn[id] = byTxn[id] || []).push(k); });
    var acc = change.accountId || '', cls = change.classId;
    if (!acc && cls === undefined) throw err('Choose a new account, a new class, or both.');
    if (cls && !(b.classById ? b.classById[cls] : (b.classes || []).some(function (c) { return c.id === cls; }))) throw err('Choose a class that exists.');
    var linked = b._bankLinked ? b._bankLinked() : {}, drafts = [], moves = {}, classes = 0, lines = 0;
    Object.keys(byTxn).forEach(function (id) {
      var t = b.txById[id]; if (!t || t.status !== 'posted') { byTxn[id].forEach(function (k) { blocked.push({ key: k, why: 'No longer posted.' }); }); return; }
      var list = parts(b, t), idx = splitIndexes(t, list), d = U.clone(t), touched = false, tcls = t.classId || '';
      var headCls = false;
      list.forEach(function (p, n) {
        var k = t.id + '|' + p.part + '|' + p.i; if (!want[k]) return;
        var w = whyNot(b, t, p, idx[n], linked), did = false;
        if (w.all) { blocked.push({ key: k, why: w.all }); return; }
        if (acc && acc !== p.accountId) {
          if (w.acc) { blocked.push({ key: k, why: w.acc }); }
          else {
            var bad = headTypesOk(b, t, p.part, acc);
            if (bad) blocked.push({ key: k, why: bad });
            else {
              if (p.part === 'head') d.accountId = acc; else if (p.part === 'to') d.toAccountId = acc;
              else if (p.part === 'line') d.lines[p.i].accountId = acc; else d.jlines[p.i].accountId = acc;
              var mk = p.accountId + '>' + acc; moves[mk] = (moves[mk] || 0) + p.amount; did = true;
            }
          }
        }
        if (cls !== undefined && (cls || '') !== (p.classId || '') && !w.cls && !cls && tcls && p.part !== 'head') { blocked.push({ key: k, why: 'The whole transaction has a class; clear it on the header line instead.' }); }
        else if (cls !== undefined && (cls || '') !== (p.classId || '') && !w.cls) {
          if (p.part === 'head') headCls = true;
          else { var L = p.part === 'line' ? d.lines[p.i] : d.jlines[p.i]; if (cls) L.classId = cls; else delete L.classId; }
          classes++; did = true;
        }
        if (did) { touched = true; lines++; }
      });
      if (headCls) {   // the header class is also the default for lines without their own: pin those first
        (d.lines || []).forEach(function (l) { if (!l.classId && tcls) l.classId = tcls; });
        (d.jlines || []).forEach(function (l) { if (!l.classId && tcls) l.classId = tcls; });
        if (cls) d.classId = cls; else delete d.classId;
      }
      if (touched) { delete d.splits; delete d.total; delete d.status; drafts.push(d); }
    });
    var mv = Object.keys(moves).map(function (k) { var p = k.split('>'); return { from: p[0], to: p[1], amount: moves[k] }; });
    return { drafts: drafts, moves: mv, classes: classes, txns: drafts.length, lines: lines, blocked: blocked };
  }
  Book.prototype.reclassPreview = function (keys, change) {
    var p = plan(this, keys, change || {}); delete p.drafts; return p;
  };

  Book.prototype.reclassify = function (keys, change, note) {
    var self = this, p;
    try { p = plan(this, keys, change || {}); } catch (e) { return Promise.reject(e); }
    if (!p.drafts.length) return Promise.reject(err(p.blocked.length ? 'None of the selected lines can be changed: ' + p.blocked[0].why : 'Nothing to change: the selected lines already use that account and class.'));
    var before = p.drafts.map(function (d) { return U.clone(self.txById[d.id]); });
    var batchId = U.uid('rcl');
    return this._raw_saveTransactions(p.drafts).then(function (saved) {
      var c = U.clone(self.company), list = c.reclassBatches = (c.reclassBatches || []).slice(-49);
      var rec = { id: batchId, at: new Date().toISOString(), note: String(note || ''), accountId: (change || {}).accountId || '', classId: (change || {}).classId,
        txns: saved.map(function (t, i) { return { id: t.id, version: t.version, before: before[i] }; }), lines: p.lines, moves: p.moves };
      list.push(rec);
      var audit = self._auditEntry('reclassify', null, 'Reclassified ' + p.lines + ' line' + (p.lines === 1 ? '' : 's') + ' in ' + saved.length + ' transaction' + (saved.length === 1 ? '' : 's') +
        (rec.accountId ? ' to ' + self.accountLabel(rec.accountId) : '') + (rec.classId !== undefined ? ' · class ' + (rec.classId ? (self.classFullName ? self.classFullName(rec.classId) : rec.classId) : 'none') : '') + (rec.note ? ' — ' + rec.note : ''), null);
      return self._commit([{ store: 'company', value: c }, { store: 'audit', value: audit }], function () { self.company = c; self.audit.push(audit); })
        .then(function () { return { batchId: batchId, txns: saved.length, lines: p.lines, blocked: p.blocked, moves: p.moves }; });
    });
  };
  Book.prototype.reclassBatches = function () { return (this.company.reclassBatches || []).slice().reverse(); };

  /** Put every transaction of a batch back as it was, if none was changed since. */
  Book.prototype.undoReclass = function (batchId) {
    var self = this, rec = (this.company.reclassBatches || []).find(function (x) { return x.id === batchId; });
    if (!rec) return Promise.reject(err('That reclassification is not in the history.'));
    if (rec.undone) return Promise.reject(err('That reclassification was already undone.'));
    var changed = rec.txns.filter(function (x) { var t = self.txById[x.id]; return !t || t.version !== x.version; });
    if (changed.length) return Promise.reject(err(changed.length + ' of the transactions changed after the reclassification, so it can’t be undone automatically.'));
    var drafts = rec.txns.map(function (x) { var d = U.clone(x.before); d.version = self.txById[x.id].version; delete d.splits; delete d.total; delete d.status; return d; });
    return this._raw_saveTransactions(drafts).then(function () {
      var c = U.clone(self.company); c.reclassBatches = c.reclassBatches.map(function (x) { return x.id === batchId ? Object.assign({}, x, { undone: new Date().toISOString() }) : x; });
      var audit = self._auditEntry('reclassify-undo', null, 'Undid a reclassification of ' + rec.lines + ' line' + (rec.lines === 1 ? '' : 's'), null);
      return self._commit([{ store: 'company', value: c }, { store: 'audit', value: audit }], function () { self.company = c; self.audit.push(audit); });
    });
  };

  // serialize with every other write (same queue as the ledger's own methods)
  ['reclassify', 'undoReclass'].forEach(function (name) {
    var raw = Book.prototype[name]; Book.prototype['_raw_' + name] = raw;
    Book.prototype[name] = function () { var self = this, args = arguments, p = this._queue.then(function () { return raw.apply(self, args); }); this._queue = p.catch(function () {}); return p; };
  });
})(typeof window !== 'undefined' ? window : globalThis);
