/* VaultBook — Doc Center (1.49.0): one place for every document. Files dropped in wait in an inbox (attachments with no
   owner) until they are attached; VaultBook reads the date, amount and vendor from the file name or the PDF text and
   suggests the transaction. Also: transactions with no document, clean up, and a document package for the CPA.
   Files live inside the company and its backups, so there are no links to break. */
(function (root) {
  'use strict';
  var OB = root.OB, U = OB.util, Book = OB.Book, D = OB.docs = {};
  function LedgerError(msg) { var e = new Error(msg); e.name = 'LedgerError'; return e; }

  /** A short fingerprint of the file content, to find the same file twice. */
  D.hash = function (data) {
    var s = String(data || ''), i = s.indexOf(','), h1 = 0x811c9dc5, h2 = 0;
    for (var k = i + 1; k < s.length; k++) { var c = s.charCodeAt(k); h1 = Math.imul(h1 ^ c, 16777619); h2 = (h2 * 31 + c) | 0; }
    return (h1 >>> 0).toString(16) + '-' + (h2 >>> 0).toString(16) + '-' + (s.length - i - 1);
  };

  // Inbox files: attachments with no owner yet. addAttachment takes { inbox: true } for them (1.49).
  var add0 = Book.prototype.addAttachment;
  Book.prototype.addAttachment = function (input) {
    var self = this;
    if (!input.inbox) return add0.call(this, input).then(function (a) { return self._docStamp(a); });
    var m = String(input.dataUrl || '').match(/^data:([\w.+\/-]+)?(;base64)?,/);
    if (!m) return Promise.reject(LedgerError('That file could not be read.'));
    var body = input.dataUrl.slice(m[0].length), pad = /==$/.test(body) ? 2 : /=$/.test(body) ? 1 : 0;
    var bytes = m[2] ? Math.floor(body.length * 3 / 4) - pad : decodeURIComponent(body).length;
    if (bytes > Book.ATTACH_MAX) return Promise.reject(LedgerError('Files can be up to 4 MB. Scan receipts at a lower resolution or as PDF.'));
    var name = String(input.name || 'file').slice(0, 200);
    var a = { id: U.uid('att'), ownerId: '', name: name, type: m[1] || 'application/octet-stream', size: bytes, data: input.dataUrl, addedAt: new Date().toISOString(), hash: D.hash(input.dataUrl) };
    a.info = D.readName(this, name);
    var audit = this._auditEntry('attach', null, 'Added ' + name + ' to the Doc Center inbox (' + Math.round(bytes / 1024) + ' KB)');
    return this._commit([{ store: 'attachments', value: a }, { store: 'audit', value: audit }], function () { self.attachments.push(a); self.audit.push(audit); }).then(function () { return a; });
  };
  Book.prototype._docStamp = function (a) { // the hash and what the name says, kept on attachments made the old way
    var self = this, i = this.attachments.indexOf(a); if (i < 0 || a.hash) return Promise.resolve(a);
    var x = U.clone(a); x.hash = D.hash(a.data); x.info = D.readName(this, a.name);
    return this._commit([{ store: 'attachments', value: x }], function () { self.attachments[i] = x; }).then(function () { return x; });
  };
  function put(book, id, change, summary, txnId) {
    var prior = book.attachments.find(function (x) { return x.id === id; });
    if (!prior || prior.deleted) return Promise.reject(LedgerError('Document not found.'));
    var a = U.clone(prior); change(a);
    var ops = [{ store: 'attachments', value: a }], audit = summary ? book._auditEntry('attach', txnId || null, summary) : null;
    if (audit) ops.push({ store: 'audit', value: audit });
    return book._commit(ops, function () { book.attachments[book.attachments.indexOf(prior)] = a; if (audit) book.audit.push(audit); }).then(function () { return a; });
  }
  /** Attach a document (from the inbox, or move it) to a transaction. */
  Book.prototype.linkAttachment = function (id, txnId) {
    var t = this.txById[txnId]; if (!t) return Promise.reject(LedgerError('Choose the transaction to attach it to.'));
    var a = this.attachments.find(function (x) { return x.id === id; });
    return put(this, id, function (x) { x.ownerId = txnId; }, 'Attached ' + (a ? a.name : 'document') + ' to ' + OB.schema.TXN_TYPES[t.type].label + (t.number ? ' ' + t.number : '') + ' of ' + U.fmtDate(t.date), txnId);
  };
  /** Back to the inbox. */
  Book.prototype.unlinkAttachment = function (id) {
    var a = this.attachments.find(function (x) { return x.id === id; });
    return put(this, id, function (x) { x.ownerId = ''; }, 'Moved ' + (a ? a.name : 'document') + ' back to the Doc Center inbox', a && a.ownerId);
  };
  /** Correct what VaultBook read: { date, amount (cents), vendorId }. */
  Book.prototype.setAttachmentInfo = function (id, info) {
    return put(this, id, function (x) { x.info = Object.assign({}, x.info || {}, info); }, '');
  };

  /* ---------- reading documents ---------- */
  var MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
  function p2(n) { return (n < 10 ? '0' : '') + n; }
  function mkDate(y, m, d) {
    y = +y; m = +m; d = +d; if (y < 100) y += 2000;
    if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return '';
    var iso = y + '-' + p2(m) + '-' + p2(d); return U.isDate(iso) ? iso : '';
  }
  /** The first date in a text: 2024-03-05, 03/05/2024, 3.5.24, 03-05-24, Mar 5 2024, 5 March 2024. */
  D.dateIn = function (s) {
    s = String(s || ''); var m, re = /(\d{4})[-_.\/](\d{1,2})[-_.\/](\d{1,2})|(\d{1,2})[-_.\/](\d{1,2})[-_.\/](\d{2,4})|([a-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})|(\d{1,2})\s+([a-z]{3,9})\.?,?\s+(\d{4})/gi;
    while ((m = re.exec(s))) {
      var d = m[1] ? mkDate(m[1], m[2], m[3]) : m[4] ? mkDate(m[6], m[4], m[5]) : m[7] ? (MON[m[7].toLowerCase().slice(0, 4)] || MON[m[7].toLowerCase().slice(0, 3)] ? mkDate(m[9], MON[m[7].toLowerCase().slice(0, 4)] || MON[m[7].toLowerCase().slice(0, 3)], m[8]) : '')
        : (MON[m[11].toLowerCase().slice(0, 3)] ? mkDate(m[12], MON[m[11].toLowerCase().slice(0, 3)], m[10]) : '');
      if (d) return d;
    }
    return '';
  };
  function vendorOf(book, text) {
    var w = ' ' + String(text || '').toLowerCase().replace(/[^a-z0-9&]+/g, ' ').trim() + ' ', best = null, bl = 0;
    book.contacts.forEach(function (c) {
      if (c.active === false) return; var k = c.name.toLowerCase().replace(/[^a-z0-9&]+/g, ' ').trim();
      if (k.length >= 3 && w.indexOf(' ' + k + ' ') >= 0 && k.length > bl) { best = c; bl = k.length; }
    });
    return best;
  }
  /** What a file name says: { date, amount (cents, 0 = none), vendor (contact or null) }. */
  D.readName = function (book, name) {
    var base = String(name || '').replace(/\.[a-z0-9]{2,5}$/i, ''), date = D.dateIn(base);
    var rest = base.replace(/(\d{4})[-_.\/](\d{1,2})[-_.\/](\d{1,2})|(\d{1,2})[-_.\/](\d{1,2})[-_.\/](\d{2,4})/g, ' ');
    var am = rest.match(/\$?\s?(\d{1,3}(?:,\d{3})+|\d+)\.(\d{2})(?!\d)/);
    var v = vendorOf(book, base.replace(/[_-]+/g, ' '));
    return { date: date, amount: am ? Math.round(+am[1].replace(/,/g, '') * 100 + +am[2]) : 0, vendorId: v ? v.id : '', vendor: v };
  };
  /** What a document's text says: the total (Total / Amount due / Balance due / Grand total, else the largest amount),
   *  the document date (next to "Date", else the first date) and a vendor named in it. */
  D.readText = function (book, text) {
    var lines = String(text || '').split(/\n/), money = /\$?\s?(\d{1,3}(?:,\d{3})+|\d+)\.(\d{2})(?!\d)/g, amt = 0, big = 0, date = '';
    var val = function (s) { var m, last = 0; money.lastIndex = 0; while ((m = money.exec(s))) last = Math.round(+m[1].replace(/,/g, '') * 100 + +m[2]); return last; };
    lines.forEach(function (l) {
      var v = val(l); if (v > big) big = v;
      if (!amt && /\b(grand total|total due|amount due|balance due|total amount|amount paid|total)\b/i.test(l) && !/sub\s*total/i.test(l) && v) amt = v;
      if (!date && /\b(invoice date|receipt date|statement date|bill date|date)\b/i.test(l) && !/\bdue\b/i.test(l)) date = D.dateIn(l);
    });
    var v = vendorOf(book, text);
    return { date: date || D.dateIn(text), amount: amt || big, vendorId: v ? v.id : '', vendor: v };
  };

  /* ---------- finding the transaction ---------- */
  D.inbox = function (book) { return book.attachments.filter(function (a) { return !a.deleted && !a.ownerId; }); };
  D.all = function (book) { return book.attachments.filter(function (a) { return !a.deleted; }); };
  function days(a, b) { return Math.round((Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10)) - Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10))) / 86400000); }
  /** Up to 5 transactions this document may belong to, best first: [{ t, score, sure, why }]. The amount must match
   *  (or the vendor and a date within 10 days). Sure: the amount and a date within 5 days, and no close second. */
  /** An earlier document with the same content (attached, or earlier in the inbox), or null. */
  D.dupOf = function (book, a) {
    var h = a.hash || D.hash(a.data);
    return book.attachments.find(function (x) { return x !== a && x.id !== a.id && !x.deleted && (x.hash || D.hash(x.data)) === h && (x.ownerId || x.addedAt < a.addedAt || (x.addedAt === a.addedAt && x.id < a.id)); }) || null;
  };
  D.suggest = function (book, a, opts) {
    var info = (a && a.info) || {}, amt = info.amount || 0, date = info.date || '', vid = info.vendorId || '';
    if (!amt && !(vid && date)) return [];
    var has = {}; book.attachments.forEach(function (x) { if (!x.deleted && x.ownerId) has[x.ownerId] = 1; });
    var out = [];
    book.transactions.forEach(function (t) {
      if (t.status !== 'posted' || OB.schema.TXN_TYPES[t.type].nonPosting) return;
      var tot = Math.abs(book.txnTotal(t)), dd = date ? Math.abs(days(t.date, date)) : null, why = [], score = 0;
      var amtOk = amt && tot === amt, venOk = vid && (t.contactId === vid || (t.lines || []).some(function (l) { return l.contactId === vid; }));
      if (!amtOk && !(venOk && dd !== null && dd <= 10)) return;
      if (amtOk) { score += 50; why.push('amount'); }
      if (venOk) { score += 25; why.push('vendor'); }
      if (dd !== null) { if (dd > 45) return; score += Math.max(0, 25 - dd * 2); if (dd <= 5) why.push(dd ? 'date within ' + dd + ' day' + (dd === 1 ? '' : 's') : 'same date'); }
      if (has[t.id]) score -= 15;
      out.push({ t: t, score: score, why: why, dd: dd, amtOk: !!amtOk, has: !!has[t.id] });
    });
    out.sort(function (x, y) { return y.score - x.score || (x.dd === null ? 99 : x.dd) - (y.dd === null ? 99 : y.dd); });
    out = out.slice(0, 5);
    if (out[0]) out[0].sure = !D.dupOf(book, a) && out[0].amtOk && out[0].dd !== null && out[0].dd <= 5 && !out[0].has && (!out[1] || out[0].score - out[1].score >= 15);
    return out;
  };

  /* ---------- reports ---------- */
  D.NEEDS = { check: 1, expense: 1, bill: 1, ccCredit: 1, vendorCredit: 1 };
  /** Spending with no document: checks, expenses, card charges and bills from opts.from to opts.to of at least
   *  opts.min cents (default $75, the IRS receipt line). Largest first. */
  D.missing = function (book, opts) {
    opts = opts || {}; var min = opts.min === undefined ? 7500 : opts.min, has = {};
    book.attachments.forEach(function (x) { if (!x.deleted && x.ownerId) has[x.ownerId] = 1; });
    return book.transactions.filter(function (t) {
      return t.status === 'posted' && D.NEEDS[t.type] && !has[t.id] && (!opts.from || t.date >= opts.from) && (!opts.to || t.date <= opts.to) && Math.abs(book.txnTotal(t)) >= min;
    }).sort(function (x, y) { return Math.abs(book.txnTotal(y)) - Math.abs(book.txnTotal(x)) || (x.date < y.date ? -1 : 1); });
  };
  /** Clean up: { dupes (a later copy of a file already kept on the same transaction or in the inbox), onVoid (files on
   *  void transactions), large (files of at least opts.large bytes, default 1 MB), bytes (all files) }. */
  D.cleanup = function (book, opts) {
    opts = opts || {}; var seen = {}, out = { dupes: [], onVoid: [], large: [], bytes: 0 }, lim = opts.large || 1048576;
    D.all(book).slice().sort(function (x, y) { return x.addedAt < y.addedAt ? -1 : 1; }).forEach(function (a) {
      var h = a.hash || D.hash(a.data), k = (a.ownerId || 'inbox') + '|' + h; out.bytes += a.size || 0;
      if (seen[k]) out.dupes.push(a); else seen[k] = 1;
      var t = a.ownerId && book.txById[a.ownerId]; if (t && t.status === 'void') out.onVoid.push(a);
      if ((a.size || 0) >= lim) out.large.push(a);
    });
    return out;
  };
  /** Remove several documents (each one logged). */
  D.remove = function (book, ids) { return ids.reduce(function (p, id) { return p.then(function () { return book.removeAttachment(id); }); }, Promise.resolve()); };

  /* ---------- the CPA package ---------- */
  function bytesOf(dataUrl) {
    var m = String(dataUrl || '').match(/^data:[^,]*?(;base64)?,/); if (!m) return new Uint8Array(0);
    var body = dataUrl.slice(m[0].length);
    if (!m[1]) return new TextEncoder().encode(decodeURIComponent(body));
    var bin = typeof atob === 'function' ? atob(body) : Buffer.from(body, 'base64').toString('binary'), arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  }
  var clean = function (s) { return String(s || '').replace(/[\\\/:*?"<>|\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60); };
  /** Every document on transactions dated opts.from..opts.to, named "date - vendor - amount - type number.ext", plus
   *  Index.csv (one line per transaction, documents or not). { files [{name, data}], count, missing }. */
  D.packageFiles = function (book, opts) {
    opts = opts || {}; var by = {}, files = [], used = {}, rows = [['Date', 'Type', 'Number', 'Name', 'Amount', 'Documents', 'File names']], missing = 0;
    D.all(book).forEach(function (a) { if (a.ownerId) (by[a.ownerId] = by[a.ownerId] || []).push(a); });
    var txs = book.transactions.filter(function (t) { return t.status === 'posted' && (!opts.from || t.date >= opts.from) && (!opts.to || t.date <= opts.to) && (by[t.id] || D.NEEDS[t.type]); })
      .sort(function (x, y) { return x.date < y.date ? -1 : x.date > y.date ? 1 : (x.number || '').localeCompare(y.number || ''); });
    txs.forEach(function (t) {
      var docs = by[t.id] || [], who = t.contactId && book.contactById[t.contactId] ? book.contactById[t.contactId].name : '', amt = (Math.abs(book.txnTotal(t)) / 100).toFixed(2), names = [];
      var label = OB.schema.TXN_TYPES[t.type].label + (t.number ? ' ' + t.number : '');
      docs.forEach(function (a, k) {
        var ext = (String(a.name).match(/\.[a-z0-9]{2,5}$/i) || [''])[0].toLowerCase();
        var n = clean([t.date, who, amt, label].filter(Boolean).join(' - ')) + (docs.length > 1 ? ' (' + (k + 1) + ')' : '') + ext, j = 2;
        while (used[n]) n = n.replace(/(\.[a-z0-9]+)?$/, ' ' + j++ + '$1');
        used[n] = 1; names.push(n); files.push({ name: n, data: bytesOf(a.data) });
      });
      if (!docs.length) missing++;
      rows.push([t.date, OB.schema.TXN_TYPES[t.type].label, t.number || '', who, amt, String(docs.length), names.join('; ')]);
    });
    var csv = rows.map(function (r) { return r.map(function (c) { c = String(c); return /[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(','); }).join('\r\n');
    files.push({ name: 'Index.csv', data: new TextEncoder().encode(csv) });
    return { files: files, count: files.length - 1, missing: missing };
  };
})(typeof window !== 'undefined' ? window : globalThis);
