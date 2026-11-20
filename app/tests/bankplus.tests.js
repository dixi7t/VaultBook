/* VaultBook — bank feed part 2 and reconciliation (1.23): rules v2 (BP-01…03), one bank line to several entries
   (BP-04, 05), already in the books on import (BP-06, 07), reconciliation adjustment and report (BP-08, 09).
   Loaded after tally.tests.js by tests/run-node.js and tests/tests.html; shares OB.tests. */
(function (root) {
  'use strict';
  var OB = root.OB, U = OB.util;
  var T = OB.tests;
  function test(name, fn) { T.push({ name: name, fn: fn }); }
  function eq(a, b, msg) { if (a !== b) throw new Error((msg || 'Expected equal') + ': expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }
  function ok(v, msg) { if (!v) throw new Error(msg || 'Assertion failed'); }
  function rejects(p, re, msg) { return p.then(function () { throw new Error((msg || 'Expected rejection') + ' but it succeeded'); }, function (e) { if (re && !re.test(e.message)) throw new Error((msg || 'Wrong error') + ': ' + e.message); }); }
  function newBook() { return OB.Book.create(new OB.MemoryAdapter(), { name: 'Plus Co' }); }
  function acc(b, name) { var a = b.accounts.find(function (x) { return x.name === name; }); if (!a) throw new Error('No account ' + name); return a.id; }
  function clean(b) { var i = b.checkIntegrity(); eq(i.issues.length, 0, 'integrity: ' + i.issues.join('; ')); }
  function rows(list) { return list.map(function (x) { return { date: x[0], description: x[1], amount: x[2], checkNo: x[3] || '' }; }); }
  function review(b, ck) { return b.bankLinesFor(ck, 'review'); }

  test('BP-01 rules v2: all/any conditions, amount ranges, accounts, direction; old one-text rules still work', function () {
    var b, ck, sv;
    return newBook().then(function (x) {
      b = x; ck = acc(b, 'Checking'); sv = acc(b, 'Savings');
      return b.saveRule({ name: 'Small Amazon', conditions: [{ field: 'desc', op: 'contains', value: 'amazon' }, { field: 'amount', op: 'lt', value: '100' }], direction: 'out', accountId: acc(b, 'Office Supplies & Software'), priority: 5 });
    }).then(function () { return b.saveRule({ name: 'Big Amazon', conditions: [{ field: 'desc', op: 'contains', value: 'AMAZON' }, { field: 'amount', op: 'between', value: '100', value2: '5000' }], accountId: acc(b, 'Repairs & Maintenance'), accountIds: [ck] }); })
      .then(function () { return b.saveRule({ contains: 'COMCAST', accountId: acc(b, 'Utilities') }); })   // a 1.20-style rule
      .then(function () { return b.saveRule({ name: 'Fees', match: 'any', conditions: [{ field: 'desc', op: 'starts', value: 'service fee' }, { field: 'desc', op: 'equals', value: 'monthly maintenance' }], accountId: acc(b, 'Bank Charges & Fees') }); })
      .then(function () {
        eq(b.matchRule('AMAZON MKTPLACE', -4599, ck).name, 'Small Amazon');
        eq(b.matchRule('AMAZON MKTPLACE', -45999, ck).name, 'Big Amazon');
        eq(b.matchRule('AMAZON MKTPLACE', -45999, sv), null, 'Big Amazon is for Checking only');
        eq(b.matchRule('AMAZON REFUND', 4599, ck), null, 'money in is not "out"');
        eq(b.matchRule('Comcast cable', -1999).contains, 'COMCAST');
        eq(b.matchRule('SERVICE FEE OCT', -1500, ck).name, 'Fees'); eq(b.matchRule('Monthly  Maintenance', -1500, ck).name, 'Fees');
        eq(b.matchRule('THE MONTHLY MAINTENANCE FEE', -1500, ck), null, '"equals" is the whole text');
        return rejects(b.saveRule({ conditions: [{ field: 'amount', op: 'gt', value: '10' }], accountId: acc(b, 'Meals') }), /description/);
      }).then(function () { return rejects(b.saveRule({ conditions: [{ field: 'desc', op: 'contains', value: 'x' }], accountId: b.sys('AR').id }), /A\/R or A\/P/); });
  });

  test('BP-02 rules v2: split by percent and amount (rounding on the last percent line), class, memo; preview', function () {
    var b, ck;
    return newBook().then(function (x) {
      b = x; ck = acc(b, 'Checking');
      return b.saveRule({ name: 'Rent and power', conditions: [{ field: 'desc', op: 'contains', value: 'LANDLORD' }], splits: [{ accountId: acc(b, 'Utilities'), kind: 'amount', amount: '150' }, { accountId: acc(b, 'Rent & Lease'), kind: 'pct', pct: '66.67' }, { accountId: acc(b, 'Repairs & Maintenance'), kind: 'pct', pct: '33.33' }], memo: 'Monthly rent' });
    }).then(function (r) {
      var sp = OB.bankplus.splitFor(r, 100000);
      eq(sp.map(function (x) { return x.amount; }).join(), '15000,56670,28330', 'fixed first, then percents of the rest');
      eq(OB.bankplus.splitFor(r, 10000), null, 'a $100 line cannot carry the $150 fixed line');
      return b.importBankLines(ck, rows([['2026-11-01', 'ACH LANDLORD LLC', -100000], ['2026-11-02', 'LANDLORD DEPOSIT REFUND', 50000]]), { fileName: 'r.csv' });
    }).then(function () {
      var pv = b.rulePreview({ conditions: [{ field: 'desc', op: 'contains', value: 'landlord' }], direction: 'out', accountId: acc(b, 'Rent & Lease') });
      eq(pv.review.length, 1, 'preview counts only lines the draft rule catches');
      var l = review(b, ck).find(function (x) { return x.amount === -100000; }), sug = b.bankSuggestion(l.id);
      eq(sug.source, 'rule'); eq(sug.splits.length, 3); eq(sug.memo, 'Monthly rent');
      return b.postBankLine(l.id, { kind: 'split', lines: sug.splits, memo: sug.memo });
    }).then(function (t) {
      eq(t.lines.length, 3); eq(b.accountBalance(acc(b, 'Rent & Lease')), 56670); clean(b);
    });
  });

  test('BP-03 auto-add rules post on import; lines already in the books are matched first, never added twice', function () {
    var b, ck;
    return newBook().then(function (x) {
      b = x; ck = acc(b, 'Checking');
      return b.saveRule({ conditions: [{ field: 'desc', op: 'contains', value: 'SERVICE FEE' }], accountId: acc(b, 'Bank Charges & Fees'), autoAdd: true });
    }).then(function () { return b.saveTransaction({ type: 'expense', date: '2026-10-31', accountId: ck, lines: [{ accountId: acc(b, 'Bank Charges & Fees'), amount: '12' }] }); })
      .then(function () { return b.importBankLines(ck, rows([['2026-10-31', 'SERVICE FEE', -1200], ['2026-11-30', 'SERVICE FEE', -1200], ['2026-11-30', 'COFFEE', -450]]), { fileName: 'f.csv' }); })
      .then(function (r) {
        eq(r.matched, 1, 'October fee was already entered: matched'); eq(r.autoAdded, 1, 'November fee added by the rule');
        eq(review(b, ck).length, 1, 'only the coffee waits');
        eq(b.accountBalance(acc(b, 'Bank Charges & Fees')), 2400, 'two fees, not three'); clean(b);
      });
  });

  test('BP-04 one deposit = several payments waiting in Undeposited Funds: a Deposit is recorded; undo puts them back', function () {
    var b, ck, cu, line;
    return newBook().then(function (x) {
      b = x; ck = acc(b, 'Checking');
      return b.saveContact({ kind: 'customer', name: 'Acme' });
    }).then(function (c) {
      cu = c.id;
      var inv = function (amt) { return { type: 'invoice', date: '2026-10-20', contactId: cu, lines: [{ accountId: acc(b, 'Services'), amount: amt }] }; };
      return b.saveTransactions([inv('500'), inv('1200'), inv('300'), inv('999')]);
    }).then(function (invs) {
      var pay = function (t, amt) { return { type: 'payment', date: '2026-10-25', contactId: cu, accountId: b.sys('UNDEP').id, amount: amt, applications: [{ txnId: t.id, amount: amt }] }; };
      return b.saveTransactions([pay(invs[0], '500'), pay(invs[1], '1200'), pay(invs[2], '300'), pay(invs[3], '999')]);
    }).then(function () { return b.importBankLines(ck, rows([['2026-10-27', 'DEPOSIT', 200000]]), { fileName: 'd.csv' }); })
      .then(function () {
        line = review(b, ck)[0];
        var c = b.bankCandidates(line.id), dep = c.find(function (x) { return x.kind === 'deposit'; });
        ok(dep && dep.txnIds.length === 3, 'three payments add up to $2,000: ' + JSON.stringify(c.map(function (x) { return x.kind; })));
        ok(dep.best, 'the only combination is the best match');
        return b.postBankLine(line.id, { kind: 'deposit', txnIds: dep.txnIds });
      }).then(function (t) {
        eq(t.type, 'deposit'); eq(b.accountBalance(ck), 200000); eq(b.undepositedItems().length, 1, 'the $999 payment still waits');
        clean(b);
        return b.undoBankLine(line.id);
      }).then(function () { eq(b.undepositedItems().length, 4, 'undo voids the deposit'); eq(b.accountBalance(ck), 0); clean(b); });
  });

  test('BP-05 one bank line = several entries already in the account (group match); undo; export sends each entry', function () {
    var b, ck, line, t1, t2;
    return newBook().then(function (x) {
      b = x; ck = acc(b, 'Checking');
      return b.saveTransactions([
        { type: 'deposit', date: '2026-11-03', accountId: ck, lines: [{ accountId: acc(b, 'Services'), amount: '700' }] },
        { type: 'deposit', date: '2026-11-04', accountId: ck, lines: [{ accountId: acc(b, 'Services'), amount: '300' }] },
        { type: 'deposit', date: '2026-11-04', accountId: ck, lines: [{ accountId: acc(b, 'Services'), amount: '450' }] }]);
    }).then(function (ts) { t1 = ts[0]; t2 = ts[1]; return b.importBankLines(ck, rows([['2026-11-05', 'MOBILE DEPOSIT', 100000]]), { fileName: 'g.csv' }); })
      .then(function () {
        line = review(b, ck)[0];
        var g = b.bankCandidates(line.id).find(function (x) { return x.kind === 'group'; });
        ok(g && g.links.length === 2, 'the $700 and $300 entries add up');
        return b.postBankLine(line.id, { kind: 'group', links: g.links });
      }).then(function () {
        var l = b.bankLineById[line.id]; eq(l.status, 'posted'); eq(l.links.length, 2);
        eq(b.txById[t1.id].splits.find(function (s) { return s.accountId === ck; }).cleared, 'C');
        var x = OB.qbexport.bankIIF(b, { accountIds: [ck] }); eq(x.txnCount, 2, 'both entries go to QuickBooks');
        eq(b.accountBalance(ck), 145000, 'nothing new was posted');
        return b.undoBankLine(line.id);
      }).then(function () {
        eq(b.bankLineById[line.id].status, 'review'); eq(b.txById[t2.id].splits.find(function (s) { return s.accountId === ck; }).cleared, '', 'ticks removed'); clean(b);
        return rejects(b.postBankLine(line.id, { kind: 'group', links: [{ txnId: t1.id, splitIndex: 0 }, { txnId: t1.id, splitIndex: 0 }] }), /already matched|add up/);
      });
  });

  test('BP-06 already in the books: preview counts them; import matches them one to one, check numbers first', function () {
    var b, ck, c1, c2;
    return newBook().then(function (x) {
      b = x; ck = acc(b, 'Checking');
      return b.saveTransactions([
        { type: 'check', date: '2026-09-28', accountId: ck, number: '1042', lines: [{ accountId: acc(b, 'Rent & Lease'), amount: '850' }] },
        { type: 'check', date: '2026-10-29', accountId: ck, number: '1043', lines: [{ accountId: acc(b, 'Rent & Lease'), amount: '850' }] },
        { type: 'expense', date: '2026-10-30', accountId: ck, lines: [{ accountId: acc(b, 'Meals'), amount: '45.10' }] },
        { type: 'expense', date: '2026-08-01', accountId: ck, lines: [{ accountId: acc(b, 'Meals'), amount: '19.99' }] }]);
    }).then(function (ts) {
      c1 = ts[0]; c2 = ts[1];
      var file = rows([['2026-11-01', 'CHECK 1042', -85000, '1042'], ['2026-11-01', 'CHECK 1043', -85000, '1043'], ['2026-10-31', 'CAFE', -4510], ['2026-10-31', 'CAFE', -1999], ['2026-11-01', 'NEW THING', -2500]]);
      var pv = b.bankPreview(ck, file);
      eq(pv.fresh, 5); eq(pv.inBooks.length, 3, 'two checks by number and the $45.10 by date; the August $19.99 is too far away');
      return b.importBankLines(ck, file, { fileName: 'k.csv' });
    }).then(function (r) {
      eq(r.matched, 3);
      var posted = b.bankLinesFor(ck, 'posted');
      eq(posted.find(function (l) { return l.checkNo === '1042'; }).txnId, c1.id, 'check 1042 to check 1042 (a month earlier)');
      eq(posted.find(function (l) { return l.checkNo === '1043'; }).txnId, c2.id);
      ok(posted.every(function (l) { return l.auto === 'books' && l.via === 'match'; }));
      eq(review(b, ck).length, 2); eq(b.transactions.filter(function (t) { return t.status === 'posted'; }).length, 4, 'nothing added');
      return b.undoBankLine(posted[0].id);
    }).then(function () { eq(review(b, ck).length, 3, 'an automatic match can be undone'); clean(b); });
  });

  test('BP-07 matchBooks off leaves every line for review; reconciled entries are never matched', function () {
    var b, ck, t;
    return newBook().then(function (x) {
      b = x; ck = acc(b, 'Checking');
      return b.saveTransaction({ type: 'expense', date: '2026-10-30', accountId: ck, lines: [{ accountId: acc(b, 'Meals'), amount: '10' }] });
    }).then(function (x) { t = x; return b.finishReconciliation(ck, '2026-10-31', -1000, [{ txnId: t.id, i: t.splits.findIndex(function (s) { return s.accountId === ck; }) }]); })
      .then(function () { return b.importBankLines(ck, rows([['2026-10-30', 'CAFE', -1000]]), { fileName: 'a.csv' }); })
      .then(function (r) { eq(r.matched, 0, 'reconciled entry is left alone'); return b.importBankLines(ck, rows([['2026-11-02', 'X', -500]]), { fileName: 'b.csv', matchBooks: false }); })
      .then(function (r) { eq(r.matched, 0); eq(review(b, ck).length, 2); });
  });

  test('BP-08 reconcile with a difference: adjustment entry to Reconciliation Discrepancies; undo voids it', function () {
    var b, ck, t, rec;
    return newBook().then(function (x) {
      b = x; ck = acc(b, 'Checking');
      return b.saveTransaction({ type: 'deposit', date: '2026-10-05', accountId: ck, lines: [{ accountId: acc(b, 'Services'), amount: '1000' }] });
    }).then(function (x) {
      t = x; var refs = [{ txnId: t.id, i: t.splits.findIndex(function (s) { return s.accountId === ck; }) }];
      return rejects(b.finishReconciliation(ck, '2026-10-31', 99683, refs), /must be \$0\.00/).then(function () { return b.finishReconciliation(ck, '2026-10-31', 99683, refs, { adjust: true }); });
    }).then(function (r) {
      rec = r;
      eq(r.adjustment.amount, -317); var adj = b.txById[r.adjustment.txnId];
      eq(adj.type, 'journal'); eq(b.accountBalance(ck), 99683, 'books now agree with the bank');
      eq(b.accountBalance(acc(b, 'Reconciliation Discrepancies')), 317, 'difference expensed');
      eq(b.reconciledBalance(ck), 99683);
      var rep = b.reconReport(r.id); eq(rep.cleared.length, 2); eq(rep.outstanding.length, 0); ok(!rep.rebuilt);
      clean(b);
      return b.undoLastReconciliation(ck);
    }).then(function () {
      eq(b.txById[rec.adjustment.txnId].status, 'void'); eq(b.accountBalance(ck), 100000); eq(b.reconciledBalance(ck), 0); clean(b);
    });
  });

  test('BP-09 reconciliation report is frozen: outstanding items and register balance as they were', function () {
    var b, ck, a1, a2, rec;
    return newBook().then(function (x) {
      b = x; ck = acc(b, 'Checking');
      return b.saveTransactions([
        { type: 'deposit', date: '2026-10-05', accountId: ck, lines: [{ accountId: acc(b, 'Services'), amount: '1000' }] },
        { type: 'check', date: '2026-10-20', accountId: ck, number: '7', lines: [{ accountId: acc(b, 'Meals'), amount: '40' }] }]);
    }).then(function (ts) {
      a1 = ts[0]; a2 = ts[1];
      return b.finishReconciliation(ck, '2026-10-31', 100000, [{ txnId: a1.id, i: a1.splits.findIndex(function (s) { return s.accountId === ck; }) }]);
    }).then(function (r) {
      rec = r; var rep = b.reconReport(r.id);
      eq(rep.clearedIn, 100000); eq(rep.outstanding.length, 1); eq(rep.outstandingOut, -4000); eq(rep.registerBalance, 96000);
      eq(rep.registerBalance, rec.endingBalance + rep.outstandingIn + rep.outstandingOut, 'register = statement + outstanding');
      return b.saveTransaction({ type: 'deposit', date: '2026-10-25', accountId: ck, lines: [{ accountId: acc(b, 'Services'), amount: '5' }] });
    }).then(function () { eq(b.reconReport(rec.id).outstanding.length, 1, 'a back-dated entry does not change the printed report'); });
  });
  test('BP-20 reconciliation report model (QuickBooks Reconciliation Detail and Summary layout): sections, item counts, running balances, cleared and register balance, PDF text', function () {
    var b, ck, d1, d2, c1, c2, rec, RM = OB.reconReport;
    return newBook().then(function (x) {
      b = x; ck = acc(b, 'Checking');
      return b.saveTransactions([
        { type: 'deposit', date: '2026-09-30', accountId: ck, memo: 'Opening', lines: [{ accountId: acc(b, 'Services'), amount: '11143' }] }]);
    }).then(function (ts) {
      return b.finishReconciliation(ck, '2026-09-30', 1114300, [{ txnId: ts[0].id, i: ts[0].splits.findIndex(function (s) { return s.accountId === ck; }) }]);
    }).then(function () {
      return b.saveTransactions([
        { type: 'deposit', date: '2026-10-31', accountId: ck, lines: [{ accountId: acc(b, 'Services'), amount: '151' }] },
        { type: 'deposit', date: '2026-10-05', accountId: ck, lines: [{ accountId: acc(b, 'Services'), amount: '1879' }] },
        { type: 'check', date: '2026-10-01', accountId: ck, number: '101', memo: 'Monthly Fee', lines: [{ accountId: acc(b, 'Meals'), amount: '29.95' }] },
        { type: 'check', date: '2026-10-12', accountId: ck, number: '102', lines: [{ accountId: acc(b, 'Meals'), amount: '52.24' }] },
        { type: 'check', date: '2026-10-20', accountId: ck, number: '103', lines: [{ accountId: acc(b, 'Meals'), amount: '100' }] },   // stays uncleared
        { type: 'deposit', date: '2026-11-03', accountId: ck, lines: [{ accountId: acc(b, 'Services'), amount: '7' }] }]);              // after the statement
    }).then(function (ts) {
      d1 = ts[0]; d2 = ts[1]; c1 = ts[2]; c2 = ts[3];
      var ref = function (t) { return { txnId: t.id, i: t.splits.findIndex(function (s) { return s.accountId === ck; }) }; };
      return b.finishReconciliation(ck, '2026-10-31', 1114300 + 15100 + 187900 - 2995 - 5224, [d1, d2, c1, c2].map(ref));
    }).then(function (r) {
      rec = r;
      var m = RM.model(b, r.id, { view: 'detail', printedAt: '2026-11-12T12:00:00' });
      eq(m.lines[1], 'Reconciliation Detail'); eq(m.lines[2], 'Checking, Period Ending 10/31/2026');
      eq(m.columns.map(function (c) { return c.label; }).join('|'), 'Date|Num|Name|Memo|Clr|Amount|Balance'); eq(m.labelHead, 'Type');
      var row = function (label) { var x = m.rows.find(function (y) { return y.label === label; }); if (!x) throw new Error('No row ' + label + ' in ' + m.rows.map(function (y) { return y.label; }).join(' / ')); return x; };
      var bal = function (label) { return row(label).cells[6]; }, amt = function (label) { return row(label).cells[5]; };
      eq(bal('Beginning Balance'), 1114300);
      ok(row('Checks and Payments - 2 items'), 'cleared checks heading with count');
      var checks = m.rows.filter(function (y) { return y.label === 'Check' && y.cells[4] === 'X'; });
      eq(checks.map(function (y) { return y.cells[0] + ' ' + y.cells[1] + ' ' + y.cells[5] + ' ' + y.cells[6]; }).join(' / '), '10/01/2026 101 -2995 -2995 / 10/12/2026 102 -5224 -8219', 'date order, running balance per section');
      eq(checks[0].cells[3], 'Monthly Fee');
      eq(amt('Total Checks and Payments'), -8219);
      var deps = m.rows.filter(function (y) { return y.label === 'Deposit' && y.cells[4] === 'X'; });
      eq(deps.map(function (y) { return y.cells[6]; }).join(), '187900,203000', 'deposits run from zero again, oldest first');
      eq(amt('Total Deposits and Credits'), 203000);
      eq(amt('Total Cleared Transactions'), 194781); eq(bal('Cleared Balance'), 1114300 + 194781);
      eq(amt('Total Uncleared Transactions'), -10000);
      eq(bal('Register Balance as of 10/31/2026'), 1114300 + 194781 - 10000);
      eq(bal('Ending Balance'), 1114300 + 194781 - 10000); eq(row('Ending Balance').line, 'double');
      ok(!m.rows.some(function (y) { return y.cells && y.cells[0] === '11/03/2026'; }), 'a later deposit is not on this statement');
      ok(m.rows.some(function (y) { return /Prepared by/.test(y.label); }), 'sign-off lines');
      var s = RM.model(b, r.id, { view: 'summary', printedAt: '2026-11-12T12:00:00' });
      eq(s.lines[1], 'Reconciliation Summary'); eq(s.columns.length, 1);
      var sr = function (label) { return s.rows.find(function (y) { return y.label === label; }).cells[0]; };
      eq(sr('Checks and Payments - 2 items'), -8219); eq(sr('Deposits and Credits - 2 items'), 203000); eq(sr('Cleared Balance'), 1309081); eq(sr('Register Balance as of 10/31/2026'), 1299081);
      eq(sr('Statement Ending Balance'), rec.endingBalance); eq(sr('Difference'), 0);
      if (OB.pdf && OB.reportModel.toPdf) {
        var pdf = OB.reportModel.toPdf(m, { orientation: 'portrait' }), txt = ''; var by = new Uint8Array(pdf.buffer || pdf); for (var q = 0; q < by.length; q++) txt += String.fromCharCode(by[q]);
        ok(/Reconciliation Detail/.test(txt) && /2,030\.00/.test(txt) && /13,090\.81/.test(txt), 'figures are real text in the PDF');
      }
    });
  });
})(typeof window !== 'undefined' ? window : globalThis);
