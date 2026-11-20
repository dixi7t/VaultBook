/* VaultBook — Update QuickBooks Desktop to match VaultBook (1.47).
 * Compares the transactions VaultBook imported from QuickBooks (importRef "TxnID …") with a full QuickBooks export
 * (connector "Export everything", or the live link) and works out only what differs:
 *   updates — a check, deposit or journal entry whose lines (account, amount, memo, name) or header (date, memo, number,
 *             payee) changed in VaultBook. Every QuickBooks line is listed by its TxnLineID because QuickBooks removes the
 *             lines an edit leaves out; unchanged lines carry the id only. Lines added in VaultBook go as TxnLineID -1.
 *   voids   — a linked transaction voided in VaultBook. VaultBook never deletes, so nothing is deleted in QuickBooks.
 *   accounts — VaultBook accounts QuickBooks does not have yet, by QuickBooks full name (Parent:Child) and type.
 * Each edit carries the export's EditSequence: QuickBooks refuses it when the entry was changed there since the export.
 * QuickBooks entries VaultBook does not have are never touched (counted as qbOnly).
 * OB.qbupdate.plan(book, full) → { updates, voids, accounts, skipped, linked, qbOnly }
 * OB.qbupdate.batch(book, plan, today) → the file the connector applies (format vaultbook-qb-batch, version 3)
 * OB.qbupdate.toText(batch) → JSON in plain ASCII (the Windows PowerShell 5.1 script reads it). */
(function (root) {
  'use strict';
  var OB = root.OB, U = OB.util, QU = OB.qbupdate = {};
  var arr = function (x) { return x === null || x === undefined || x === '' ? [] : Array.isArray(x) ? x : [x]; };
  var txt = function (x) { return x === null || x === undefined ? '' : typeof x === 'object' ? (x['#text'] || '') : String(x); };
  var name = function (r) { return r ? txt(r.FullName || r.Name || '') : ''; };
  var cents = function (v) { var n = parseFloat(txt(v).replace(/[^0-9.\-]/g, '')); return isFinite(n) ? Math.round(n * 100) : 0; };
  var money = function (c) { return (c / 100).toFixed(2); };
  var clean = function (m) { return txt(m).replace(/\s*\[VB:[^\]]*\]/g, '').trim(); };
  var QBTYPE = { bank: 'Bank', cc: 'CreditCard', ar: 'AccountsReceivable', ap: 'AccountsPayable', oca: 'OtherCurrentAsset', fixed: 'FixedAsset', oa: 'OtherAsset',
    ocl: 'OtherCurrentLiability', ltl: 'LongTermLiability', equity: 'Equity', income: 'Income', oi: 'OtherIncome', cogs: 'CostOfGoodsSold', expense: 'Expense', oe: 'OtherExpense' };
  var KIND = { check: 'Check', deposit: 'Deposit', journal: 'JournalEntry' };

  /** VaultBook account → QuickBooks full name; notes the accounts QuickBooks still needs. */
  function accountNamer(book, full, need) {
    var qb = {}, leaf = {};
    arr((full.lists || {}).Account).forEach(function (a) { var n = name(a); if (!n) return; qb[n.toLowerCase()] = n; var l = n.split(':').pop().toLowerCase(); (leaf[l] = leaf[l] || []).push(n); });
    var memo = {};
    function path(a) { var p = [], seen = {}; while (a && !seen[a.id]) { seen[a.id] = 1; p.unshift(a.name); a = a.parentId ? book.accById[a.parentId] : null; } return p.join(':'); }
    return function qbName(id) {
      if (memo[id] !== undefined) return memo[id];
      var a = book.accById[id]; if (!a) return (memo[id] = '');
      var p = path(a), hit = qb[p.toLowerCase()] || ((leaf[a.name.toLowerCase()] || []).length === 1 ? leaf[a.name.toLowerCase()][0] : '');
      if (!hit) { var par = a.parentId ? qbName(a.parentId) : ''; hit = par ? par + ':' + a.name : a.name; need[hit] = QBTYPE[a.type] || 'Expense'; }
      return (memo[id] = hit);
    };
  }

  function qbLines(kind, q) {
    if (kind === 'check') return arr(q.ExpenseLineRet).map(function (l) { return { lineId: txt(l.TxnLineID), account: name(l.AccountRef), amount: cents(l.Amount), memo: clean(l.Memo), name: name(l.CustomerRef) }; });
    if (kind === 'deposit') return arr(q.DepositLineRet).map(function (l) { return { lineId: txt(l.TxnLineID), account: name(l.AccountRef), amount: cents(l.Amount), memo: clean(l.Memo), name: name(l.EntityRef) }; });
    var out = [];
    arr(q.JournalDebitLine).forEach(function (l) { out.push({ lineId: txt(l.TxnLineID), side: 'Debit', account: name(l.AccountRef), amount: cents(l.Amount), memo: clean(l.Memo), name: name(l.EntityRef) }); });
    arr(q.JournalCreditLine).forEach(function (l) { out.push({ lineId: txt(l.TxnLineID), side: 'Credit', account: name(l.AccountRef), amount: cents(l.Amount), memo: clean(l.Memo), name: name(l.EntityRef) }); });
    return out;
  }
  function vbLines(book, t, qbName) {
    var who = function (id) { return id && book.contactById[id] ? book.contactById[id].name : ''; };
    if (t.type === 'journal') return (t.jlines || []).map(function (l) { return { side: l.debit ? 'Debit' : 'Credit', account: qbName(l.accountId), amount: l.debit || l.credit || 0, memo: clean(l.memo), name: who(l.contactId) }; });
    return (t.lines || []).filter(function (l) { return l.amount; }).map(function (l) { return { account: qbName(l.accountId), amount: l.amount, memo: clean(l.description), name: who(l.contactId) }; });
  }

  /** The line edits: [] when nothing changed. Same count: by position, only changed fields. Else: replace all lines. */
  function lineEdits(kind, ql, vl, what) {
    var out = [], changed = false, sideOk = function (q, v) { return kind !== 'journal' || q.side === v.side; };
    if (ql.length === vl.length && ql.every(function (q, i) { return sideOk(q, vl[i]); })) {
      ql.forEach(function (q, i) {
        var v = vl[i], e = { lineId: q.lineId };
        if (kind === 'journal') e.side = q.side;
        if (q.account.toLowerCase() !== v.account.toLowerCase()) { e.account = v.account; what.push(money(v.amount) + ' ' + q.account + ' -> ' + v.account); changed = true; }
        if (q.amount !== v.amount) { e.amount = money(v.amount); what.push('line ' + (i + 1) + ' amount ' + money(q.amount) + ' -> ' + money(v.amount)); changed = true; }
        if (q.memo !== v.memo && v.memo !== '' ) { e.memo = v.memo; what.push('line ' + (i + 1) + ' memo'); changed = true; }
        if (q.name !== v.name && kind !== 'check') { e.name = v.name; what.push('line ' + (i + 1) + ' name ' + (v.name || '(none)')); changed = true; }
        out.push(e);
      });
      return changed ? out : [];
    }
    what.push('lines ' + ql.length + ' -> ' + vl.length);
    return vl.map(function (v, i) {
      var e = { lineId: i < ql.length && sideOk(ql[i], v) ? ql[i].lineId : '-1', account: v.account, amount: money(v.amount) };
      if (kind === 'journal') e.side = v.side; if (v.memo) e.memo = v.memo; if (v.name) e.name = v.name;
      return e;
    });
  }

  QU.plan = function (book, full) {
    if (!full || full.format !== 'vaultbook-qb-full') throw new Error('Choose the full QuickBooks export (connector: Export everything).');
    var need = {}, qbName = accountNamer(book, full, need), X = full.txns || {}, byId = {}, used = {};
    Object.keys(KIND).forEach(function (k) { arr(X[KIND[k]]).forEach(function (q) { byId[txt(q.TxnID)] = { kind: k, q: q }; }); });
    var from = full.from || '', to = full.to || '9999-12-31', out = { updates: [], voids: [], accounts: need, skipped: [], linked: 0, qbOnly: 0, snapshotAt: full.at || '' };
    var who = function (id) { return id && book.contactById[id] ? book.contactById[id].name : ''; };
    book.transactions.forEach(function (t) {
      var m = /TxnID (\S+)/.exec(t.importRef || ''), sent = (book.company.qbSent || {})[t.id], id = m ? m[1] : sent && sent.qbTxnId;
      if (!id) return;
      var label = (OB.schema.TXN_TYPES[t.type] || {}).label + ' ' + U.fmtDate(t.date) + (t.number ? ' #' + t.number : '') + ' ' + money(t.total || 0);
      var hit = byId[id];
      if (!hit) { if (KIND[t.type] && t.date >= from && t.date <= to) out.skipped.push({ key: t.id, label: label, why: 'QuickBooks id ' + id + ' is not in this QuickBooks export' }); return; }
      used[id] = 1; out.linked++;
      var q = hit.q, kind = hit.kind, base = { key: t.id, kind: kind, txnId: id, editSeq: txt(q.EditSequence), label: label };
      if (kind !== t.type) { out.skipped.push(Object.assign(base, { why: 'a ' + t.type + ' in VaultBook but a ' + KIND[kind] + ' in QuickBooks' })); return; }
      if (t.status === 'void') { if (cents(q.Amount || q.DepositTotal) !== 0 || kind === 'journal') out.voids.push(base); return; }
      if (t.status && t.status !== 'posted') return;
      var what = [], header = {}, h = 0;
      var qDate = txt(q.TxnDate), qMemo = clean(q.Memo), qRef = txt(q.RefNumber), qPayee = name(q.PayeeEntityRef);
      if (qDate && qDate !== t.date) { header.date = t.date; what.push('date ' + qDate + ' -> ' + t.date); h++; }
      if (kind !== 'journal' && qMemo !== clean(t.memo)) { header.memo = clean(t.memo); what.push('memo'); h++; }
      var dupNo = qRef && (t.number || '').indexOf(qRef + '-') === 0 && /^-\d+$/.test(t.number.slice(qRef.length));   // the import renames repeated numbers 400 -> 400-2
      if (kind !== 'deposit' && qRef !== (t.number || '') && !dupNo) { header.ref = t.number || ''; what.push('number ' + (qRef || '(none)') + ' -> ' + (t.number || '(none)')); h++; }
      if (kind === 'check' && qPayee.toLowerCase() !== who(t.contactId).toLowerCase()) { header.payee = who(t.contactId); what.push('payee ' + (qPayee || '(none)') + ' -> ' + (header.payee || '(none)')); h++; }
      var lines = lineEdits(kind, qbLines(kind, q), vbLines(book, t, qbName), what);
      if (!h && !lines.length) return;
      if (kind === 'check' && arr(q.ItemLineRet).length) { out.skipped.push(Object.assign(base, { why: 'it has item lines in QuickBooks: change it in QuickBooks (' + what.join('; ') + ')' })); return; }
      out.updates.push(Object.assign(base, { header: h ? header : null, lines: lines, what: what }));
    });
    Object.keys(byId).forEach(function (id) { if (!used[id]) out.qbOnly++; });
    // only the new accounts an update or the plan uses
    var usedAcc = {};
    out.updates.forEach(function (u) { u.lines.forEach(function (l) { if (l.account) usedAcc[l.account] = 1; }); });
    Object.keys(need).forEach(function (k) { var any = Object.keys(usedAcc).some(function (u) { return u === k || u.indexOf(k + ':') === 0; }); if (!any) delete need[k]; });
    return out;
  };

  QU.batch = function (book, plan, today) {
    return { format: 'vaultbook-qb-batch', version: 3, kind: 'update', company: book.company.name, createdAt: new Date().toISOString(), madeOn: today || U.today(),
      snapshotAt: plan.snapshotAt || '', accounts: plan.accounts, updates: plan.updates, voids: plan.voids, invoices: [], payments: [], bank: [] };
  };
  /** JSON with every character outside plain ASCII escaped (\uXXXX). */
  QU.toText = function (batch) { return JSON.stringify(batch, null, 1).replace(/[\u007f-￿]/g, function (c) { return '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4); }); };
})(typeof window !== 'undefined' ? window : global);
