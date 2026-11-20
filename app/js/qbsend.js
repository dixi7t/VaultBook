/* VaultBook — Send to QuickBooks Desktop (1.30): choose invoices and customer payments, write one batch file for the
 * connector script (tools/VaultBook QuickBooks.cmd), and read its result back so each item shows as sent.
 *
 * OB.qbsend.sendList(book, opts)   → rows { key, id, kind: 'invoice'|'payment', date, number, customer, contactId, amount,
 *                                    applied, sent, sentAt, qbTxnId, problem, status: 'Not sent'|'Sent'|'Problem', t }
 *   opts: kinds ['invoice','payment'], from, to, contactId, status '' | 'new' | 'sent' | 'problem', min, max (cents)
 * OB.qbsend.batch(book, keys, opts) → { format: 'vaultbook-qb-batch', version: 2|3, company, createdAt, invoices: [...], payments: [...],
 *   bank: [check | cardCharge | cardCredit | deposit | transfer | journal], accounts: { name: qbXML type }, names: { name: 'vendor'|'customer' } } (1.38)
 *   The script records invoices first, then payments, so a payment can close an invoice sent in the same run.
 * OB.qbsend.applyResult(book, result) → marks items sent / problem on company.qbSent (through saveCompanySent).
 * Amounts in the batch are strings with two decimals; the script never touches floating point.
 */
(function (root) {
  'use strict';
  var OB = root.OB = root.OB || {};
  var U = OB.util, Q = OB.qbsend = {};
  var clean = function (s) { return String(s === null || s === undefined ? '' : s).replace(/[\t\r\n]+/g, ' ').replace(/"/g, "'").trim(); };
  var qbName = function (s) { return clean(s).replace(/:/g, '-').slice(0, 41); };
  var money = function (c) { return (c / 100).toFixed(2); };
  var termsText = function (t) {
    if (t.terms !== '' && t.terms !== undefined && t.terms !== null && isFinite(+t.terms)) return +t.terms ? 'Net ' + (+t.terms) : 'Due on receipt';
    if (t.dueDate && t.dueDate > t.date) return 'Net ' + U.daysBetween(t.date, t.dueDate);
    return '';
  };
  var appliedText = function (book, t) {
    return (t.applications || []).map(function (a) { var d = book.txById[a.txnId]; return d ? (d.type === 'invoice' ? 'Invoice ' : '') + (d.number || U.fmtDate(d.date)) : ''; }).filter(Boolean).join(', ');
  };

  /* ---- 1.38: bank transactions (checks and expenses, deposits, transfers, card charges and credits, journal entries) ---- */
  Q.BANK_TYPES = { check: 1, expense: 1, deposit: 1, transfer: 1, journal: 1, ccCredit: 1 };
  Q.BANK_LABEL = { check: 'Check', cardCharge: 'Card charge', cardCredit: 'Card credit', deposit: 'Deposit', transfer: 'Transfer', journal: 'Journal entry' };
  var QB_ACC = { bank: 'Bank', ar: 'AccountsReceivable', oca: 'OtherCurrentAsset', fa: 'FixedAsset', oa: 'OtherAsset', ap: 'AccountsPayable', cc: 'CreditCard', ocl: 'OtherCurrentLiability', ltl: 'LongTermLiability',
    equity: 'Equity', income: 'Income', cogs: 'CostOfGoodsSold', expense: 'Expense', oi: 'OtherIncome', oe: 'OtherExpense' };
  /** How a posted transaction goes to QuickBooks, from its splits (debit +, credit −):
   *  money out of one bank account → check; into one → deposit; one card account → card charge / credit; a transfer → transfer;
   *  a journal, or anything touching two bank accounts, → journal entry. → { kind, headId, amount, splits, head } or null. */
  Q.bankShape = function (book, t) {
    if (!Q.BANK_TYPES[t.type]) return null;
    var splits = (t.splits || []).filter(function (x) { return x.amount; }); if (splits.length < 2) return null;
    var isMoney = function (x) { var a = book.accById[x.accountId]; return a && (a.type === 'bank' || a.type === 'cc'); };
    if (t.type === 'transfer' && splits.length === 2) { var f = splits.find(function (x) { return x.amount < 0; }), to = splits.find(function (x) { return x.amount > 0; }); if (f && to) return { kind: 'transfer', head: f, to: to, headId: f.accountId, amount: -f.amount, splits: splits }; }
    var m = splits.filter(isMoney);
    if (t.type !== 'journal' && m.length === 1) {
      var h = m[0], cc = book.accById[h.accountId].type === 'cc';
      return { kind: cc ? (h.amount < 0 ? 'cardCharge' : 'cardCredit') : (h.amount < 0 ? 'check' : 'deposit'), head: h, headId: h.accountId, amount: Math.abs(h.amount), splits: splits };
    }
    return { kind: 'journal', head: m[0] || splits[0], headId: (m[0] || splits[0]).accountId, amount: U.sum(splits, function (x) { return x.amount > 0 ? x.amount : 0; }), splits: splits };
  };

  Q.sendList = function (book, opts) {
    opts = opts || {};
    var kinds = opts.kinds && opts.kinds.length ? opts.kinds : ['invoice', 'payment'], sent = (book.company && book.company.qbSent) || {}, rows = [];
    book.posted().forEach(function (t) {
      var shape = Q.BANK_TYPES[t.type] ? Q.bankShape(book, t) : null;
      var kind = t.type === 'invoice' ? 'invoice' : t.type === 'payment' ? 'payment' : shape ? 'bank' : '';
      if (!kind || kinds.indexOf(kind) < 0 || t.voidedBy) return;
      if (opts.from && t.date < opts.from) return;
      if (opts.to && t.date > opts.to) return;
      if (opts.contactId && t.contactId !== opts.contactId) return;
      if (opts.accountId && !(t.splits || []).some(function (x) { return x.accountId === opts.accountId; }) && t.accountId !== opts.accountId) return;
      var amount = shape ? shape.amount : kind === 'invoice' ? t.total : Math.abs(t.amount || t.total || 0);
      if (opts.min && amount < opts.min) return;
      if (opts.max && amount > opts.max) return;
      var s = sent[t.id] || {}, isSent = !!s.qbTxnId, status = isSent ? 'Sent' : s.problem ? 'Problem' : 'Not sent';
      if (opts.status === 'new' && isSent) return;
      if (opts.status === 'sent' && !isSent) return;
      if (opts.status === 'problem' && status !== 'Problem') return;
      var c = book.contactById[t.contactId] || (shape && book.contactById[shape.head.contactId]);
      rows.push({ key: t.id, id: t.id, kind: kind, t: t, label: shape ? Q.BANK_LABEL[shape.kind] : kind === 'invoice' ? 'Invoice' : 'Payment', account: shape ? book.accountLabel(shape.headId) + (shape.kind === 'transfer' ? ' → ' + book.accountLabel(shape.to.accountId) : '') : '', date: t.date, number: t.number || '', customer: c ? c.name : '', contactId: t.contactId, amount: amount,
        applied: kind === 'payment' ? appliedText(book, t) : '', sent: isSent, sentAt: s.at || '', qbTxnId: s.qbTxnId || '', problem: isSent ? '' : s.problem || '', status: status });
    });
    rows.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : (a.kind === 'invoice' ? -1 : 1) - (b.kind === 'invoice' ? -1 : 1) || String(a.number).localeCompare(String(b.number), undefined, { numeric: true }); });
    return rows;
  };

  Q.batch = function (book, keys, opts) {
    opts = opts || {};
    var want = {}; (keys || []).forEach(function (k) { want[k] = 1; });
    var accName = function (id) { var n = opts.names && opts.names[id]; return n && String(n).trim() ? clean(n) : book.accById[id] ? book.accountFullName(book.accById[id]) : ''; };
    var invoices = [], payments = [], bank = [], accounts = {}, names = {}, skipped = [];
    var acc = function (id) { var n = accName(id), a = book.accById[id]; if (n && a) accounts[n] = QB_ACC[a.type] || 'Expense'; return n; };
    var who = function (cid) { var x = cid && book.contactById[cid]; if (!x) return ''; var n = qbName(x.name); names[n] = x.kind === 'customer' ? 'customer' : 'vendor'; return n; };
    book.posted().forEach(function (t) {
      if (!want[t.id]) return;
      var c = book.contactById[t.contactId] || { name: '' };
      var sh = Q.bankShape(book, t);
      if (sh) {
        var base = { key: t.id, kind: sh.kind, date: t.date, ref: clean(t.number || t.checkNo || '').slice(0, 11), memo: clean(t.memo || sh.head.memo).slice(0, 4000), amount: money(sh.amount) };
        if (sh.kind === 'transfer') { base.from = acc(sh.head.accountId); base.to = acc(sh.to.accountId); }
        else if (sh.kind === 'journal') base.lines = sh.splits.map(function (x) { var l = { account: acc(x.accountId), memo: clean(x.memo).slice(0, 4000), name: who(x.contactId) }; l[x.amount > 0 ? 'debit' : 'credit'] = money(Math.abs(x.amount)); return l; });
        else {
          var sign = sh.kind === 'check' || sh.kind === 'cardCharge' ? 1 : -1;   // the other side of the bank line, as positive amounts
          base.account = acc(sh.headId); base.payee = who(t.contactId || sh.head.contactId);
          base.lines = sh.splits.filter(function (x) { return x !== sh.head; }).map(function (x) { return { account: acc(x.accountId), amount: money(sign * x.amount), memo: clean(x.memo).slice(0, 4000), name: who(x.contactId) || (sh.kind === 'deposit' ? base.payee : '') }; });
        }
        bank.push(base); return;
      }
      if (t.type !== 'invoice' && t.type !== 'payment') { skipped.push({ key: t.id, type: t.type, date: t.date, number: t.number || '' }); return; }
      if (t.type === 'invoice') {
        var addr = [c.name].concat(String(c.address || '').split(/\r?\n/).filter(Boolean)).slice(0, 5).map(clean);
        invoices.push({ key: t.id, customer: qbName(c.name), date: t.date, dueDate: t.dueDate || '', terms: termsText(t), number: clean(t.number).slice(0, 11), memo: clean(t.memo).slice(0, 4000), total: money(t.total), billTo: addr,
          lines: (t.lines || []).filter(function (l) { return l.amount; }).map(function (l) {
            var it = l.itemId && book.itemById ? book.itemById[l.itemId] : null;
            var hasQty = l.qty !== null && l.qty !== undefined && l.qty !== '' && l.rate !== null && l.rate !== undefined && Math.round(+l.qty * l.rate) === l.amount;
            return { item: it ? qbName(it.name) : '', description: clean(l.description).slice(0, 4000), qty: hasQty ? String(+l.qty) : '', rate: hasQty ? money(l.rate) : '', amount: money(l.amount), incomeAccount: accName(l.accountId), taxable: !!l.taxable };
          }) });
        if (t.tax) invoices[invoices.length - 1].tax = money(t.tax);
      } else if (t.type === 'payment') {
        var head = (t.splits || []).find(function (sp) { return sp.amount > 0; }), bl = (book.bankLines || []).find(function (l) { return l.txnId === t.id && l.checkNo; });
        var apply = (t.applications || []).map(function (a) { var d = book.txById[a.txnId]; return d && d.type === 'invoice' ? { invoice: clean(d.number), invoiceDate: d.date, amount: money(a.amount) } : null; }).filter(Boolean);
        payments.push({ key: t.id, customer: qbName(c.name), date: t.date, amount: money(Math.abs(t.amount || t.total || 0)), depositTo: accName(t.accountId || (head && head.accountId)), ref: clean(t.number || t.checkNo || (bl && bl.checkNo) || '').slice(0, 20),
          memo: clean(t.memo || (OB.qbexport && OB.qbexport.appliedText ? OB.qbexport.appliedText(book, t) : '')).slice(0, 4000), apply: apply });
      }
    });
    var out = { format: 'vaultbook-qb-batch', version: bank.length ? 3 : 2, company: clean(book.company && book.company.name), createdAt: opts.now || new Date().toISOString(), invoices: invoices, payments: payments };
    if (bank.length) { out.bank = bank; out.accounts = accounts; out.names = names; }   // version 3 needs the 1.38 connector script
    Object.defineProperty(out, 'skipped', { value: skipped, enumerable: false });      // types the connector cannot record yet (bills, bill payments, sales receipts…): not written to the file
    return out;
  };

  /** Read the script's result file: { format: 'vaultbook-qb-result', items: [{ key, status, txnId, details }] }. */
  Q.applyResult = function (book, result) {
    if (!result || result.format !== 'vaultbook-qb-result' || !Array.isArray(result.items)) return Promise.reject(new Error('This is not a VaultBook QuickBooks result file.'));
    var at = result.at || new Date().toISOString(), sent = 0, problems = 0, changes = {};
    result.items.forEach(function (it) {
      if (!it || !it.key || !book.txById[it.key]) return;
      if (it.txnId && (it.status === 'Recorded' || it.status === 'Already in QuickBooks')) { changes[it.key] = { qbTxnId: String(it.txnId), at: it.status === 'Recorded' ? at : (book.company.qbSent && book.company.qbSent[it.key] && book.company.qbSent[it.key].at) || at }; sent++; }
      else if (it.status === 'Problem') { changes[it.key] = { problem: clean(it.details || 'problem').slice(0, 300), at: at }; problems++; }
    });
    return book.saveCompanySent(changes).then(function () { return { sent: sent, problems: problems }; });
  };

  /** Company-level record of what reached QuickBooks: company.qbSent[txnId] = { qbTxnId, at } or { problem, at }. */
  OB.Book.prototype.saveCompanySent = function (changes) {
    var self = this, c = U.clone(this.company); c.qbSent = Object.assign({}, c.qbSent || {});
    Object.keys(changes).forEach(function (k) { c.qbSent[k] = changes[k]; });
    var n = Object.keys(changes).length, au = this._auditEntry('qbSend', '', 'QuickBooks Desktop result loaded: ' + n + ' item' + (n === 1 ? '' : 's'));
    return this._commit([{ store: 'company', value: c }, { store: 'audit', value: au }], function () { self.company = c; self.audit.push(au); });
  };
})(typeof window !== 'undefined' ? window : globalThis);
