/* VaultBook — bank feed (1.20): imported bank lines wait in For review until each is added, matched,
 * transferred, split or excluded. Every posting goes through saveTransaction (normalize → validate → buildSplits);
 * a line and the transaction it creates or matches are written in one commit, with an audit entry.
 * Line amounts: positive = money into the account (deposit, card payment), negative = money out. Cents. */
(function (root) {
  'use strict';
  var OB = root.OB, U = OB.util, S = OB.schema, I = OB.importer, Book = OB.Book, LedgerError = OB.LedgerError;
  var FEED_TYPES = { bank: 1, cc: 1, oca: 1 };

  // index lines by id on every reindex
  var reindex0 = Book.prototype.reindex;
  Book.prototype.reindex = function () {
    reindex0.apply(this, arguments);
    var self = this; this.bankLines = this.bankLines || []; this.bankImports = this.bankImports || [];
    this.bankLineById = {}; this.bankLines.forEach(function (l) { self.bankLineById[l.id] = l; });
  };

  /** Lines of an account by status ('review' | 'posted' | 'excluded'), newest first. */
  Book.prototype.bankLinesFor = function (accountId, status) {
    return this.bankLines.filter(function (l) { return l.accountId === accountId && (!status ? l.status !== 'removed' : l.status === status); })
      .sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : (a.seq || 0) - (b.seq || 0); });
  };
  Book.prototype.bankImportsFor = function (accountId) {
    return this.bankImports.filter(function (x) { return x.accountId === accountId; }).sort(function (a, b) { return a.importedAt < b.importedAt ? 1 : -1; });
  };
  /** Latest bank balance known from an import (file ending balance), or null. */
  Book.prototype.bankBalance = function (accountId) {
    var x = this.bankImportsFor(accountId).find(function (i) { return !i.undone && i.endingBalance !== null && i.endingBalance !== undefined; });
    return x ? { amount: x.endingBalance, date: x.endingDate || '' } : null;
  };

  /** Add parsed rows to an account's For review list; rows already imported (by fingerprint) are skipped. */
  Book.prototype.importBankLines = function (accountId, rows, meta) {
    var self = this, a = this.accById[accountId]; meta = meta || {};
    if (!a || !FEED_TYPES[a.type]) return Promise.reject(LedgerError('Choose a bank, credit card or other current asset account.'));
    if (!rows || !rows.length) return Promise.reject(LedgerError('The file has no transactions.'));
    var seen = {};
    this.bankLines.forEach(function (l) { if (l.accountId === accountId && l.status !== 'removed') seen[l.hash] = 1; });
    this.transactions.forEach(function (t) { if (t.importHash && t.status === 'posted') seen[t.importHash] = 1; });
    var hashed = I.assignHashes(accountId, rows.map(function (r) { return { date: r.date, description: r.description || '(no description)', amount: r.amount, checkNo: r.checkNo || '', balance: r.balance === undefined ? null : r.balance }; }));
    var now = new Date().toISOString(), impId = U.uid('bimp'), fresh = [], dup = 0;
    hashed.forEach(function (r, k) {
      if (!U.isDate(r.date) || !r.amount) return;
      if (seen[r.hash]) { dup++; return; }
      seen[r.hash] = 1;
      fresh.push({ id: U.uid('bl'), accountId: accountId, importId: impId, seq: k, date: r.date, description: r.description, amount: r.amount, checkNo: r.checkNo, balance: r.balance, hash: r.hash, status: 'review', createdAt: now });
    });
    if (!fresh.length) return Promise.resolve({ import: null, added: 0, duplicates: dup, lines: [] });
    var dates = fresh.map(function (l) { return l.date; }).sort();
    var imp = { id: impId, accountId: accountId, fileName: String(meta.fileName || 'Bank file'), source: meta.source || 'csv', importedAt: now, added: fresh.length, duplicates: dup,
      dateFrom: dates[0], dateTo: dates[dates.length - 1], endingBalance: typeof meta.endingBalance === 'number' ? meta.endingBalance : null, endingDate: meta.endingDate || '' };
    var audit = this._auditEntry('bankImport', '', 'Imported ' + fresh.length + ' bank line' + (fresh.length === 1 ? '' : 's') + ' into ' + a.name + ' from ' + imp.fileName + (dup ? ' (' + dup + ' already imported)' : ''));
    var ops = fresh.map(function (l) { return { store: 'bankLines', value: l }; }).concat([{ store: 'bankImports', value: imp }, { store: 'audit', value: audit }]);
    return this._commit(ops, function () { Array.prototype.push.apply(self.bankLines, fresh); self.bankImports.push(imp); self.audit.push(audit); })
      .then(function () { self.reindex(); return { import: imp, added: fresh.length, duplicates: dup, lines: fresh }; });
  };

  /** Dry run of an import: how many lines are new and how many were imported before. */
  Book.prototype.bankPreview = function (accountId, rows) {
    var seen = {}, fresh = 0, dup = 0;
    this.bankLines.forEach(function (l) { if (l.accountId === accountId && l.status !== 'removed') seen[l.hash] = 1; });
    this.transactions.forEach(function (t) { if (t.importHash && t.status === 'posted') seen[t.importHash] = 1; });
    I.assignHashes(accountId, rows.map(function (r) { return { date: r.date, description: r.description || '(no description)', amount: r.amount }; }))
      .forEach(function (r) { if (seen[r.hash]) dup++; else { seen[r.hash] = 1; fresh++; } });
    return { fresh: fresh, duplicates: dup };
  };
  /** Category suggestion for a For review line: a bank rule first, then what was used last time for the same
   *  merchant text on this account ("history"). { categoryId, contactId, source: 'rule'|'history', reason, ruleId } or null. */
  Book.prototype.bankSuggestion = function (lineId) {
    var l = this.bankLineById[lineId]; if (!l) return null;
    var r = this.matchRule(l.description, l.amount);
    if (r) return { categoryId: r.accountId, contactId: r.contactId || '', source: 'rule', ruleId: r.id, reason: 'Rule: ' + (r.name || r.contains) };
    var key = I.ruleTextFor(l.description); if (!key) return null;
    var count = {}, last = {}, n = 0, self = this;
    this.bankLines.forEach(function (x) {
      if (x.status !== 'posted' || x.accountId !== l.accountId || !x.categoryId || (x.amount > 0) !== (l.amount > 0) || I.ruleTextFor(x.description) !== key) return;
      if (!self.accById[x.categoryId] || self.accById[x.categoryId].active === false) return;
      n++; count[x.categoryId] = (count[x.categoryId] || 0) + 1; if (!last[x.categoryId] || x.postedAt > last[x.categoryId].postedAt) last[x.categoryId] = x;
    });
    var ids = Object.keys(count).sort(function (a, b) { return count[b] - count[a]; });
    if (!ids.length || (ids.length > 1 && count[ids[0]] === count[ids[1]])) return null; // conflicting history: no guess
    return { categoryId: ids[0], contactId: last[ids[0]].contactId || '', source: 'history', reason: 'Used ' + count[ids[0]] + ' of ' + n + ' time' + (n === 1 ? '' : 's') + ' for ' + key };
  };

  /** Book entries already claimed by a posted bank line: "txnId:splitIndex" → line id. */
  Book.prototype._bankLinked = function () {
    var m = {}; this.bankLines.forEach(function (l) { if (l.status === 'posted' && l.txnId) m[l.txnId + ':' + l.splitIndex] = l.id; }); return m;
  };
  function words(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(function (w) { return w.length >= 3; }); }
  function nameIn(name, desc) { // every significant word of the contact's name appears in the bank text
    var w = words(name).filter(function (x) { return !/^(THE|LLC|INC|CO|LTD|CORP|AND)$/.test(x); }), d = ' ' + words(desc).join(' ') + ' ';
    return w.length > 0 && w.every(function (x) { return d.indexOf(' ' + x + ' ') >= 0 || d.indexOf(' ' + x) >= 0; });
  }

  /**
   * Candidates for a For review line, best first: { kind: 'register'|'open', txnId|txnIds, splitIndex, score, reasons[], best }.
   * register = an entry already in this account (same amount, 90 days before to 20 days after, not reconciled, not
   * matched to another line) — this is also how the other side of a transfer is found; open = an open invoice
   * (money in) or bill (money out) for exactly this amount.
   */
  Book.prototype.bankCandidates = function (lineId) {
    var self = this, l = this.bankLineById[lineId]; if (!l || l.status !== 'review') return [];
    var linked = this._bankLinked(), out = [];
    (this.splitIndex()[l.accountId] || []).forEach(function (e) {
      if (e.t.status !== 'posted' || e.s.amount !== l.amount || e.s.cleared === 'R' || linked[e.t.id + ':' + e.i]) return;
      var dd = U.daysBetween(l.date, e.t.date); // book date − bank date
      if (dd < -90 || dd > 20) return;
      var score = 10 + Math.max(0, 6 - Math.abs(dd)), reasons = ['same amount', dd === 0 ? 'same date' : Math.abs(dd) + ' day' + (Math.abs(dd) === 1 ? '' : 's') + (dd < 0 ? ' before' : ' after') + ' the bank date'];
      if (l.checkNo && e.t.number && String(e.t.number).replace(/^0+/, '') === String(l.checkNo).replace(/^0+/, '')) { score += 8; reasons.unshift('check number ' + l.checkNo + ' matches'); }
      var c = self.contactById[e.s.contactId || e.t.contactId];
      if (c && nameIn(c.name, l.description)) { score += 4; reasons.push(c.name + ' is in the bank text'); }
      if (e.t.type === 'transfer') reasons.push('transfer between your accounts');
      out.push({ kind: 'register', txnId: e.t.id, splitIndex: e.i, score: score, reasons: reasons });
    });
    var acc = this.accById[l.accountId], wantType = l.amount > 0 ? 'invoice' : 'bill';
    if (acc && acc.type !== 'cc') this.transactions.forEach(function (t) {
      if (t.type !== wantType || t.status !== 'posted' || self.openBalance(t) !== Math.abs(l.amount) || t.date > U.addDays(l.date, 5)) return;
      var c = self.contactById[t.contactId], score = 8, reasons = ['open ' + S.TXN_TYPES[t.type].label.toLowerCase() + (t.number ? ' ' + t.number : '') + ' for exactly this amount'];
      if (c && nameIn(c.name, l.description)) { score += 6; reasons.push(c.name + ' is in the bank text'); }
      out.push({ kind: 'open', txnIds: [t.id], txnId: t.id, score: score, reasons: reasons });
    });
    out.sort(function (a, b) { return b.score - a.score; });
    if (out.length && (out.length === 1 || out[0].score - out[1].score >= 3)) out[0].best = true;
    return out;
  };

  function draftFor(book, l, d) {
    var acc = book.accById[l.accountId], abs = Math.abs(l.amount), isCard = acc.type === 'cc';
    var base = { date: l.date, memo: d.memo !== undefined && d.memo !== '' ? String(d.memo) : l.description, importHash: l.hash };
    if (d.kind === 'add') {
      var cat = book.accById[d.categoryId];
      if (!cat) throw LedgerError('Choose a category.', 'categoryId');
      if (cat.id === l.accountId) throw LedgerError('Choose an account other than ' + acc.name + '.', 'categoryId');
      if (cat.type === 'bank' || cat.type === 'cc') return draftFor(book, l, { kind: 'transfer', accountId: cat.id, memo: d.memo });
      var line = [{ accountId: cat.id, amount: abs, description: d.memo || l.description }];
      if (d.classId) line[0].classId = d.classId;
      base.contactId = d.contactId || '';
      if (l.amount > 0) return Object.assign(base, { type: isCard ? 'ccCredit' : 'deposit', accountId: l.accountId, lines: line });
      return Object.assign(base, { type: l.checkNo && !isCard ? 'check' : 'expense', number: l.checkNo || '', accountId: l.accountId, lines: line });
    }
    if (d.kind === 'transfer') {
      var other = book.accById[d.accountId];
      if (!other || !FEED_TYPES[other.type] && other.type !== 'ocl' && other.type !== 'ltl') throw LedgerError('Choose the other account of the transfer.', 'accountId');
      if (other.id === l.accountId) throw LedgerError('A transfer needs two different accounts.', 'accountId');
      return Object.assign(base, { type: 'transfer', amount: abs, accountId: l.amount > 0 ? other.id : l.accountId, toAccountId: l.amount > 0 ? l.accountId : other.id });
    }
    if (d.kind === 'split') {
      var ls = (d.lines || []).filter(function (x) { return x.accountId && x.amount; });
      if (ls.length < 2) throw LedgerError('A split needs at least two lines.');
      var sum = U.sum(ls, function (x) { return typeof x.amount === 'number' ? x.amount : U.toCents(x.amount); });
      if (sum !== abs) throw LedgerError('The split lines add up to ' + U.fmt(sum, { symbol: true }) + '; the bank line is ' + U.fmt(abs, { symbol: true }) + ' (difference ' + U.fmt(abs - sum, { symbol: true }) + ').', 'lines');
      base.contactId = d.contactId || '';
      var lines = ls.map(function (x) { var o = { accountId: x.accountId, amount: typeof x.amount === 'number' ? x.amount : U.toCents(x.amount), description: x.memo || l.description }; if (x.classId) o.classId = x.classId; return o; });
      if (l.amount > 0) return Object.assign(base, { type: isCard ? 'ccCredit' : 'deposit', accountId: l.accountId, lines: lines });
      return Object.assign(base, { type: l.checkNo && !isCard ? 'check' : 'expense', number: l.checkNo || '', accountId: l.accountId, lines: lines });
    }
    if (d.kind === 'open') {
      var docs = (d.txnIds || []).map(function (id) { return book.txById[id]; });
      var want = l.amount > 0 ? 'invoice' : 'bill';
      if (!docs.length || docs.some(function (t) { return !t || t.type !== want || t.status !== 'posted'; })) throw LedgerError('Choose open ' + (want === 'invoice' ? 'invoices' : 'bills') + ' for this ' + (l.amount > 0 ? 'deposit.' : 'payment.'));
      var cid = docs[0].contactId;
      if (docs.some(function (t) { return t.contactId !== cid; })) throw LedgerError('Match one ' + (want === 'invoice' ? 'customer' : 'vendor') + ' at a time.');
      // d.amounts {txnId: cents} pays part of an item; an item left out of it is paid in full
      var amts = d.amounts || {}, apps = docs.map(function (t) {
        var open = book.openBalance(t), a = amts[t.id] === undefined || amts[t.id] === '' ? open : (typeof amts[t.id] === 'number' ? amts[t.id] : U.toCents(amts[t.id]));
        var name = S.TXN_TYPES[t.type].label + (t.number ? ' ' + t.number : '');
        if (!(a > 0)) throw LedgerError('Enter an amount for ' + name + ', or untick it.');
        if (a > open) throw LedgerError(name + ' has ' + U.fmt(open, { symbol: true }) + ' open; ' + U.fmt(a, { symbol: true }) + ' is more than that.');
        return { txnId: t.id, amount: a };
      });
      var total = U.sum(apps, function (x) { return x.amount; });
      if (total !== abs) throw LedgerError('The chosen items add up to ' + U.fmt(total, { symbol: true }) + '; the bank line is ' + U.fmt(abs, { symbol: true }) + ' (difference ' + U.fmt(abs - total, { symbol: true }) + ').');
      return Object.assign(base, { type: want === 'invoice' ? 'payment' : 'billPayment', contactId: cid, accountId: l.accountId, amount: abs, applications: apps });
    }
    throw LedgerError('Unknown bank line action.');
  }

  /** Post one For review line. d.kind: add {categoryId, contactId?, memo?, classId?} · transfer {accountId} ·
   *  split {lines:[{accountId, amount(cents), memo?}], contactId?} · open {txnIds, amounts?} · match {txnId, splitIndex}. */
  Book.prototype.postBankLine = function (lineId, d) {
    var self = this, l = this.bankLineById[lineId]; d = d || {};
    if (!l) return Promise.reject(LedgerError('Bank line not found.'));
    if (l.status === 'posted') return Promise.reject(LedgerError('This bank line is already posted.'));
    if (l.status === 'excluded') return Promise.reject(LedgerError('This bank line is excluded. Restore it first.'));
    if (l.status !== 'review') return Promise.reject(LedgerError('This bank line was removed.'));
    var nl = U.clone(l); nl.postedAt = new Date().toISOString(); nl.status = 'posted'; nl.via = d.kind;
    if (d.prepared) nl.prepared = String(d.prepared).slice(0, 300);   // posted by Close the books, with its reason (1.46)
    if (d.kind === 'match') {
      var t = this.txById[d.txnId], i = +d.splitIndex, s = t && t.splits[i];
      if (!t || t.status !== 'posted' || !s || s.accountId !== l.accountId) return Promise.reject(LedgerError('Choose an entry in this account to match.'));
      if (s.amount !== l.amount) return Promise.reject(LedgerError('The entry is ' + U.fmt(Math.abs(s.amount), { symbol: true }) + '; the bank line is ' + U.fmt(Math.abs(l.amount), { symbol: true }) + '.'));
      if (s.cleared === 'R') return Promise.reject(LedgerError('That entry is already reconciled.'));
      if (this._bankLinked()[t.id + ':' + i]) return Promise.reject(LedgerError('That entry is already matched to another bank line.'));
      var nt = U.clone(t); nl.clearedBefore = s.cleared || ''; nt.splits[i].cleared = 'C';
      nl.txnId = t.id; nl.splitIndex = i;
      var au = this._auditEntry('bankMatch', t.id, 'Matched bank line ' + U.fmtDate(l.date) + ' ' + U.fmt(l.amount, { symbol: true }) + ' "' + l.description + '" to ' + S.TXN_TYPES[t.type].label + (t.number ? ' ' + t.number : ''));
      return this._commit([{ store: 'transactions', value: nt }, { store: 'bankLines', value: nl }, { store: 'audit', value: au }], function () {
        self.transactions[self.transactions.indexOf(t)] = nt; self.bankLines[self.bankLines.indexOf(l)] = nl; self.audit.push(au);
      }).then(function () { self.reindex(); return nt; });
    }
    var p;
    try { p = this._prepareSave(draftFor(this, l, d)); } catch (e) { return Promise.reject(e); }
    if (p.dup) return Promise.reject(LedgerError('This bank line was already posted.'));
    var k = p.t.splits.findIndex(function (x) { return x.accountId === l.accountId && x.amount === l.amount; });
    if (k < 0) k = p.t.splits.findIndex(function (x) { return x.accountId === l.accountId; });
    if (k >= 0) p.t.splits[k].cleared = 'C';
    nl.txnId = p.t.id; nl.splitIndex = k;
    if (d.kind === 'add') { nl.categoryId = d.categoryId; nl.contactId = d.contactId || ''; }
    return this._commit(p.ops.concat([{ store: 'bankLines', value: nl }]), function () { p.apply(); self.bankLines[self.bankLines.indexOf(l)] = nl; })
      .then(function () { self.reindex(); return p.t; });
  };

  Book.prototype._setBankLines = function (lines, summary) {
    var self = this, au = summary ? this._auditEntry('bankLine', '', summary) : null;
    var ops = lines.map(function (x) { return { store: 'bankLines', value: x }; }); if (au) ops.push({ store: 'audit', value: au });
    return this._commit(ops, function () {
      lines.forEach(function (x) { var o = self.bankLineById[x.id], k = self.bankLines.indexOf(o); if (k >= 0) self.bankLines[k] = x; else self.bankLines.push(x); });
      if (au) self.audit.push(au);
    }).then(function () { self.reindex(); return lines; });
  };
  Book.prototype._bankUnmatch = function (lineId) {
    var self = this, l = this.bankLineById[lineId], t = this.txById[l.txnId], nl = U.clone(l), ops = [], nt = null;
    if (t && t.splits[l.splitIndex] && t.splits[l.splitIndex].cleared !== 'R') { nt = U.clone(t); nt.splits[l.splitIndex].cleared = l.clearedBefore || ''; ops.push({ store: 'transactions', value: nt }); }
    ['txnId', 'splitIndex', 'via', 'postedAt', 'clearedBefore'].forEach(function (f) { delete nl[f]; }); nl.status = 'review';
    var au = this._auditEntry('bankUnmatch', l.txnId, 'Unmatched bank line ' + U.fmtDate(l.date) + ' ' + U.fmt(l.amount, { symbol: true }) + ' — the entry is kept');
    ops.push({ store: 'bankLines', value: nl }, { store: 'audit', value: au });
    return this._commit(ops, function () { if (nt) self.transactions[self.transactions.indexOf(t)] = nt; self.bankLines[self.bankLines.indexOf(l)] = nl; self.audit.push(au); })
      .then(function () { self.reindex(); return nl; });
  };

  /** Undo a posted line: a match is unlinked (the entry stays); a transaction the bank feed created is voided.
   *  Either way the line goes back to For review. Not queued itself: it composes queued calls. */
  Book.prototype.undoBankLine = function (lineId) {
    var self = this, l = this.bankLineById[lineId];
    if (!l || l.status !== 'posted') return Promise.reject(LedgerError('Only a posted bank line can be undone.'));
    var t = this.txById[l.txnId];
    if (t && t.splits[l.splitIndex] && t.splits[l.splitIndex].cleared === 'R') return Promise.reject(LedgerError('This line is reconciled. Undo the reconciliation first.'));
    if (l.via === 'match' || !t) return this._bankUnmatch(lineId);
    var back = function () {
      var cur = self.bankLineById[lineId], nl = U.clone(cur);
      ['txnId', 'splitIndex', 'via', 'postedAt', 'clearedBefore'].forEach(function (f) { delete nl[f]; }); nl.status = 'review';
      return self._setBankLines([nl]);
    };
    if (t.status === 'void') return back();
    return this.voidTransaction(t.id, 'Bank feed: undo').then(back);
  };

  /** Note or corrected date on a line still in For review (the bank's own date is kept as bankDate). */
  Book.prototype.updateBankLine = function (id, ch) {
    var l = this.bankLineById[id]; ch = ch || {};
    if (!l || l.status !== 'review') return Promise.reject(LedgerError('Only lines in For review can be changed.'));
    var n = U.clone(l), what = [];
    if (ch.note !== undefined) { n.note = String(ch.note || '').trim().slice(0, 500); if (!n.note) delete n.note; what.push('note'); }
    // a question for the client and the client's answer (1.46)
    ['ask', 'answer'].forEach(function (k) { if (ch[k] !== undefined) { n[k] = String(ch[k] || '').trim().slice(0, 500); if (!n[k]) delete n[k]; what.push(k === 'ask' ? 'question for the client' : 'client answer'); } });
    if (ch.date !== undefined && ch.date !== l.date) {
      if (!U.isDate(ch.date)) return Promise.reject(LedgerError('Enter a real date (YYYY-MM-DD).'));
      var orig = l.bankDate || l.date; n.date = ch.date;
      if (ch.date === orig) delete n.bankDate; else n.bankDate = orig;
      what.push('date ' + U.fmtDate(ch.date));
    }
    if (!what.length) return Promise.resolve(l);
    return this._raw__setBankLines([n], 'Bank line "' + l.description + '": changed ' + what.join(', ')).then(function () { return n; });
  };

  Book.prototype.excludeBankLines = function (ids, reason) {
    var self = this, list = ids.map(function (id) { return self.bankLineById[id]; });
    if (list.some(function (l) { return !l || l.status !== 'review'; })) return Promise.reject(LedgerError('Only lines in For review can be excluded.'));
    var now = new Date().toISOString();
    return this._raw__setBankLines(list.map(function (l) { var n = U.clone(l); n.status = 'excluded'; n.excludeReason = String(reason || '').trim(); n.excludedAt = now; return n; }),
      'Excluded ' + list.length + ' bank line' + (list.length === 1 ? '' : 's') + (reason ? ' — ' + reason : ''));
  };
  Book.prototype.restoreBankLines = function (ids) {
    var self = this, list = ids.map(function (id) { return self.bankLineById[id]; });
    if (list.some(function (l) { return !l || l.status !== 'excluded'; })) return Promise.reject(LedgerError('Only excluded lines can be restored.'));
    return this._raw__setBankLines(list.map(function (l) { var n = U.clone(l); n.status = 'review'; delete n.excludeReason; delete n.excludedAt; return n; }),
      'Restored ' + list.length + ' excluded bank line' + (list.length === 1 ? '' : 's'));
  };

  /** Remove a whole imported file's lines (Zoho's "Undo Last Import"). Refused while any of its lines is posted. */
  Book.prototype.undoBankImport = function (importId) {
    var self = this, imp = this.bankImports.find(function (x) { return x.id === importId; });
    if (!imp || imp.undone) return Promise.reject(LedgerError('That import was not found or is already undone.'));
    var lines = this.bankLines.filter(function (l) { return l.importId === importId && l.status !== 'removed'; });
    var posted = lines.filter(function (l) { return l.status === 'posted'; }).length;
    if (posted) return Promise.reject(LedgerError(posted + ' line' + (posted === 1 ? ' from this file is' : 's from this file are') + ' posted. Undo ' + (posted === 1 ? 'it' : 'them') + ' on the Posted tab first, then undo the import.'));
    var ni = U.clone(imp); ni.undone = true; ni.undoneAt = new Date().toISOString();
    var nls = lines.map(function (l) { var n = U.clone(l); n.status = 'removed'; return n; });
    var au = this._auditEntry('bankImportUndo', '', 'Undid import of ' + imp.fileName + ' (' + nls.length + ' line' + (nls.length === 1 ? '' : 's') + ' removed)');
    var ops = nls.map(function (n) { return { store: 'bankLines', value: n }; }).concat([{ store: 'bankImports', value: ni }, { store: 'audit', value: au }]);
    return this._commit(ops, function () {
      nls.forEach(function (n) { self.bankLines[self.bankLines.indexOf(self.bankLineById[n.id])] = n; });
      self.bankImports[self.bankImports.indexOf(imp)] = ni; self.audit.push(au);
    }).then(function () { self.reindex(); return ni; });
  };

  /** Column mapping remembered per account and file layout (header row), so the next import skips mapping. */
  Book.prototype.bankProfile = function (accountId, header) {
    var list = ((this.company.bankProfiles || {})[accountId]) || [];
    return list.find(function (p) { return p.header === header; }) || null;
  };
  Book.prototype.saveBankProfile = function (accountId, p) {
    var self = this, c = U.clone(this.company); c.bankProfiles = c.bankProfiles || {};
    var list = (c.bankProfiles[accountId] || []).filter(function (x) { return x.header !== p.header; });
    list.unshift({ header: String(p.header || ''), mapping: p.mapping || {}, dateFormat: p.dateFormat || 'MDY', invert: !!p.invert, savedAt: new Date().toISOString() });
    c.bankProfiles[accountId] = list.slice(0, 5);
    return this._commit([{ store: 'company', value: c }], function () { self.company = c; });
  };

  /** Remember which lines went to QuickBooks (so the next export leaves them out); one record per file. */
  Book.prototype.recordBankExport = function (r, meta) {
    var self = this; meta = meta || {};
    var ids = (r && r.lineIds) || [], now = new Date().toISOString(), id = U.uid('bexp');
    if (!ids.length) return Promise.reject(LedgerError('Nothing was exported.'));
    var rec = { id: id, at: now, fileName: String(meta.fileName || ''), format: meta.format || r.format || 'iif', accountIds: meta.accountIds || [], from: meta.from || '', to: meta.to || '', count: ids.length };
    var c = U.clone(this.company); c.bankExports = (c.bankExports || []).concat([rec]);
    if (meta.names) { c.qbNames = Object.assign({}, c.qbNames || {}); Object.keys(meta.names).forEach(function (k) { if (String(meta.names[k] || '').trim()) c.qbNames[k] = String(meta.names[k]).trim(); else delete c.qbNames[k]; }); }
    var nls = ids.map(function (lid) { var n = U.clone(self.bankLineById[lid]); n.exportId = id; n.exportedAt = now; return n; });
    var au = this._auditEntry('bankExport', '', 'Exported ' + ids.length + ' bank line' + (ids.length === 1 ? '' : 's') + ' to QuickBooks (' + rec.format.toUpperCase() + (rec.fileName ? ', ' + rec.fileName : '') + ')');
    var ops = nls.map(function (n) { return { store: 'bankLines', value: n }; }).concat([{ store: 'company', value: c }, { store: 'audit', value: au }]);
    return this._commit(ops, function () { nls.forEach(function (n) { self.bankLines[self.bankLines.indexOf(self.bankLineById[n.id])] = n; }); self.company = c; self.audit.push(au); })
      .then(function () { self.reindex(); return rec; });
  };
  /** Mark an export's lines as not exported again (e.g. the QuickBooks import was cancelled). */
  Book.prototype.undoBankExport = function (exportId) {
    var self = this, list = this.company.bankExports || [], rec = list.find(function (x) { return x.id === exportId; });
    if (!rec || rec.undone) return Promise.reject(LedgerError('That export was not found or is already undone.'));
    var c = U.clone(this.company); c.bankExports = c.bankExports.map(function (x) { return x.id === exportId ? Object.assign({}, x, { undone: true, undoneAt: new Date().toISOString() }) : x; });
    var nls = this.bankLines.filter(function (l) { return l.exportId === exportId; }).map(function (l) { var n = U.clone(l); delete n.exportId; delete n.exportedAt; return n; });
    var au = this._auditEntry('bankExportUndo', '', 'Marked ' + nls.length + ' bank line' + (nls.length === 1 ? '' : 's') + ' as not exported (' + (rec.fileName || rec.format) + ')');
    var ops = nls.map(function (n) { return { store: 'bankLines', value: n }; }).concat([{ store: 'company', value: c }, { store: 'audit', value: au }]);
    return this._commit(ops, function () { nls.forEach(function (n) { self.bankLines[self.bankLines.indexOf(self.bankLineById[n.id])] = n; }); self.company = c; self.audit.push(au); })
      .then(function () { self.reindex(); return rec; });
  };

  ['importBankLines', 'postBankLine', '_setBankLines', '_bankUnmatch', 'excludeBankLines', 'restoreBankLines', 'updateBankLine', 'undoBankImport', 'saveBankProfile', 'recordBankExport', 'undoBankExport'].forEach(function (name) {
    var raw = Book.prototype[name]; Book.prototype['_raw_' + name] = raw;
    Book.prototype[name] = function () { var self = this, args = arguments, p = this._queue.then(function () { return raw.apply(self, args); }); this._queue = p.catch(function () {}); return p; };
  });
})(typeof window !== 'undefined' ? window : globalThis);
