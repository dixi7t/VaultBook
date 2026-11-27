/* VaultBook — bank feed tests (1.20): import parsing defects BF-01…08 and the bank feed inbox BF-10….
   Loaded after cpa.tests.js by tests/run-node.js and tests/tests.html; shares OB.tests. */
(function (root) {
  'use strict';
  var OB = root.OB, U = OB.util, I = OB.importer;
  var T = OB.tests;
  function test(name, fn) { T.push({ name: name, fn: fn }); }
  function eq(a, b, msg) { if (a !== b) throw new Error((msg || 'Expected equal') + ': expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }
  function ok(v, msg) { if (!v) throw new Error(msg || 'Assertion failed'); }
  function rejects(p, re, msg) {
    return p.then(function () { throw new Error((msg || 'Expected rejection') + ' but it succeeded'); }, function (e) {
      if (re && !re.test(e.message)) throw new Error((msg || 'Wrong error') + ': ' + e.message);
    });
  }
  function newBook() { return OB.Book.create(new OB.MemoryAdapter(), { name: 'Feed Co' }); }
  function acc(b, name) { var a = b.accounts.find(function (x) { return x.name === name; }); if (!a) throw new Error('No account ' + name); return a.id; }
  function clean(b) { var i = b.checkIntegrity(); eq(i.issues.length, 0, 'integrity: ' + i.issues.join('; ')); }
  var CHASE = 'Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #\n' +
    'DEBIT,11/02/2026,"SQ *BLUE BOTTLE COFFEE 4432 NEW YORK NY",-14.75,DEBIT_CARD,10234.10,\n' +
    'DEBIT,11/02/2026,"COMCAST CABLE COMM 800-COMCAST PA",-189.99,ACH_DEBIT,10248.85,\n' +
    'CREDIT,11/01/2026,"REMOTE ONLINE DEPOSIT #         1",2450.00,CHECK_DEPOSIT,10438.84,\n' +
    'DEBIT,10/31/2026,"CHECK 1042",-850.00,CHECK_PAID,7988.84,1042\n' +
    'DEBIT,10/30/2026,"ONLINE TRANSFER TO SAV ...4411",-500.00,ACCT_XFER,8838.84,\n';
  function parse(csv, extra) {
    var t = U.parseCSV(csv), m = I.detectColumns(t[0], t.slice(1));
    m.hasHeader = true; Object.assign(m, extra || {});
    return I.parseBankRows(t, m, {});
  }

  /* ---------- Phase 1: parsing defects ---------- */
  test('BF-01 Chase CSV: Description column wins over Details (DEBIT/CREDIT); balance and check columns found', function () {
    var t = U.parseCSV(CHASE), m = I.detectColumns(t[0], t.slice(1));
    eq(m.description, 2, 'Description'); eq(m.date, 1); eq(m.amount, 3); eq(m.balance, 5, 'Balance'); eq(m.check, 6, 'Check or Slip #');
    var r = I.parseBankRows(t, Object.assign(m, { hasHeader: true }), {});
    eq(r.rows[0].description, 'SQ *BLUE BOTTLE COFFEE 4432 NEW YORK NY'); eq(r.rows[0].balance, 1023410); eq(r.rows[3].checkNo, '1042');
    ['Date,Memo,Amount', 'Trans Date,Payee,Debit,Credit', 'Date,Transaction Details,Narrative,Amount'].forEach(function (h) {
      var mm = I.detectColumns(h.split(','), []); ok(mm.description >= 0, h);
    });
    eq(I.detectColumns(['Date', 'Transaction Details', 'Narrative', 'Amount'], [['1/1/2026', 'POS', 'STARBUCKS 123', '-4']]).description, 2, 'narrative text beats a code-like column');
  });
  test('BF-02 a rule suggested from a bank line uses the merchant text, never a bare DEBIT/CREDIT word', function () {
    eq(I.ruleTextFor('SQ *BLUE BOTTLE COFFEE 4432 NEW YORK NY'), 'BLUE BOTTLE COFFEE');
    eq(I.ruleTextFor('COMCAST CABLE COMM 800-COMCAST PA'), 'COMCAST CABLE COMM');
    eq(I.ruleTextFor('DEBIT'), '', 'no rule text from a type word');
    eq(I.ruleTextFor('GUSTO DES:NET 102826 ID:7H2K INDN:ACME LLC CO ID:9111111 CCD'), 'GUSTO');
  });
  test('BF-04 date formats: detected from the file, ambiguous files flagged, DD/MM honoured', function () {
    eq(I.detectDateFormat(['13/11/2026', '05/11/2026']).format, 'DMY');
    eq(I.detectDateFormat(['11/13/2026', '11/05/2026']).format, 'MDY');
    var amb = I.detectDateFormat(['03/11/2026', '05/11/2026']); eq(amb.format, 'MDY'); ok(amb.ambiguous, 'ambiguous flagged');
    eq(I.detectDateFormat(['2026-11-03']).format, 'YMD');
    eq(I.parseDateAs('03/11/2026', 'DMY'), '2026-11-03'); eq(I.parseDateAs('03/11/2026', 'MDY'), '2026-03-11');
    eq(I.parseDateAs('3 Nov 2026', 'DMY'), '2026-11-03'); eq(I.parseDateAs('Nov 3, 2026', 'MDY'), '2026-11-03'); eq(I.parseDateAs('03-NOV-26', 'DMY'), '2026-11-03');
    var r = parse('Date,Narration,Withdrawal,Deposit\n03/11/2026,Office rent,1500.00,\n05/11/2026,Client payment,,900.00\n', { dateFormat: 'DMY' });
    eq(r.rows[0].date, '2026-11-03'); eq(r.rows[0].amount, -150000); eq(r.rows[1].amount, 90000);
    eq(parse('Date,Description,Amount\n11/02/2026,X,12.50 CR\n11/02/2026,Y,7.25 DR\n').rows.map(function (x) { return x.amount; }).join(','), '1250,-725', 'CR/DR suffixes');
  });
  test('BF-07 a file that is not a bank export is refused with a plain reason', function () {
    var t = U.parseCSV('not,a,bank\nfile,with,junk\n'), m = I.detectColumns(t[0], t.slice(1)); m.hasHeader = true;
    var chk = I.checkFile(t, m);
    ok(!chk.ok, 'refused'); ok(/date/i.test(chk.message) && /amount/i.test(chk.message), chk.message);
    var t2 = U.parseCSV(CHASE), m2 = I.detectColumns(t2[0], t2.slice(1)); m2.hasHeader = true; ok(I.checkFile(t2, m2).ok);
    eq(I.checkFile(U.parseCSV(''), m2).ok, false, 'empty file');
  });
  test('BF-08 the Balance column proves the file is complete and gives the ending balance (newest-first files too)', function () {
    var r = parse(CHASE), c = I.checkBalances(r.rows);
    ok(c.hasBalance, 'has balance'); eq(c.endingBalance, 1023410); eq(c.endingDate, '2026-11-02');
    // the sample balances are consistent except the check line (7988.84 → 8838.84 is −850.00 ✓), deposit +2450 from 7988.84 → 10438.84 ✓
    eq(c.mismatches.length, 0, 'consistent: ' + JSON.stringify(c.mismatches));
    var bad = parse(CHASE.replace('10248.85', '10148.85')), cb = I.checkBalances(bad.rows);
    ok(cb.mismatches.length > 0, 'a gap in the running balance is reported');
    ok(!I.checkBalances(parse('Date,Description,Amount\n1/1/2026,X,5\n').rows).hasBalance);
  });

  /* ---------- Phase 2: bank feed inbox ---------- */
  function rowsOf(b, accName, list) { return list.map(function (x) { return { date: x[0], description: x[1], amount: x[2], checkNo: x[3] || '' }; }); }
  test('BF-10 import puts lines in For review (nothing posts); re-import and overlapping files add only new lines; undo import', function () {
    var b, ck, imp1;
    return newBook().then(function (x) {
      b = x; ck = acc(b, 'Checking');
      return b.importBankLines(ck, rowsOf(b, 'Checking', [['2026-11-01', 'COMCAST', -18999], ['2026-11-02', 'COFFEE', -1475], ['2026-11-02', 'COFFEE', -1475]]), { fileName: 'a.csv', endingBalance: 50000, endingDate: '2026-11-02' });
    }).then(function (r) {
      imp1 = r.import; eq(r.added, 3, 'two identical same-day coffees are both kept'); eq(r.duplicates, 0);
      eq(b.bankLinesFor(ck, 'review').length, 3); eq(b.transactions.length, 0, 'nothing posted');
      eq(b.bankImports.length, 1); eq(imp1.endingBalance, 50000);
      return b.importBankLines(ck, rowsOf(b, 'Checking', [['2026-11-02', 'COFFEE', -1475], ['2026-11-02', 'COFFEE', -1475], ['2026-11-03', 'RENT', -150000]]), { fileName: 'b.csv' });
    }).then(function (r) {
      eq(r.added, 1, 'only the new line'); eq(r.duplicates, 2);
      eq(b.bankLinesFor(ck, 'review').length, 4);
      return b.undoBankImport(r.import.id);
    }).then(function () {
      eq(b.bankLinesFor(ck, 'review').length, 3, 'undo removes that file\'s lines'); ok(b.bankImports.find(function (x) { return x.id !== imp1.id; }).undone);
      return b.importBankLines(ck, rowsOf(b, 'Checking', [['2026-11-03', 'RENT', -150000]]), { fileName: 'b.csv' });
    }).then(function (r) { eq(r.added, 1, 'after an undo the same lines can be imported again'); });
  });
  test('BF-11 Add / Transfer / Split post exactly one transaction per line, cleared, linked; Undo voids it and returns the line', function () {
    var b, ck, sv, lines;
    return newBook().then(function (x) {
      b = x; ck = acc(b, 'Checking'); sv = acc(b, 'Savings');
      return b.importBankLines(ck, rowsOf(b, 'Checking', [['2026-11-01', 'COMCAST CABLE', -18999], ['2026-11-02', 'TRANSFER TO SAV', -50000], ['2026-11-03', 'COSTCO', -30000, '']]), { fileName: 'a.csv' });
    }).then(function () {
      var all = b.bankLinesFor(ck, 'review'), by = function (d) { return all.find(function (x) { return x.description.indexOf(d) === 0; }); };
      lines = [by('COMCAST'), by('TRANSFER'), by('COSTCO')];
      return b.postBankLine(lines[0].id, { kind: 'add', categoryId: acc(b, 'Utilities'), memo: 'Internet' });
    }).then(function (t) {
      eq(t.type, 'expense'); eq(t.total, 18999); eq(t.importHash, lines[0].hash);
      var ln = b.bankLineById[lines[0].id]; eq(ln.status, 'posted'); eq(ln.txnId, t.id); eq(t.splits[ln.splitIndex].cleared, 'C', 'bank side cleared');
      return b.postBankLine(lines[1].id, { kind: 'transfer', accountId: sv });
    }).then(function (t) {
      eq(t.type, 'transfer'); eq(b.accountBalance(sv), 50000);
      return rejects(b.postBankLine(lines[2].id, { kind: 'split', lines: [{ accountId: acc(b, 'Office Supplies & Software'), amount: 20000 }, { accountId: acc(b, 'Meals'), amount: 5000 }] }), /add up|difference/i);
    }).then(function () {
      return b.postBankLine(lines[2].id, { kind: 'split', lines: [{ accountId: acc(b, 'Office Supplies & Software'), amount: 20000 }, { accountId: acc(b, 'Meals'), amount: 10000 }] });
    }).then(function (t) {
      eq(t.lines.length, 2); eq(t.total, 30000);
      return rejects(b.postBankLine(lines[2].id, { kind: 'add', categoryId: acc(b, 'Meals') }), /already/i);
    }).then(function () { return b.undoBankLine(lines[0].id); })
      .then(function () {
        var ln = b.bankLineById[lines[0].id]; eq(ln.status, 'review'); ok(!ln.txnId);
        eq(b.txById[b.transactions.find(function (t) { return t.importHash === lines[0].hash; }).id].status, 'void', 'created expense voided');
        eq(b.accountBalance(acc(b, 'Utilities')), 0);
        clean(b);
      });
  });
  test('BF-03 transfer pairing: the savings side of an imported transfer is offered as a match, never counted twice', function () {
    var b, ck, sv, svLine;
    return newBook().then(function (x) {
      b = x; ck = acc(b, 'Checking'); sv = acc(b, 'Savings');
      return b.importBankLines(ck, rowsOf(b, 'Checking', [['2026-10-30', 'ONLINE TRANSFER TO SAV', -50000]]), { fileName: 'chk.csv' });
    }).then(function () { return b.postBankLine(b.bankLinesFor(ck, 'review')[0].id, { kind: 'transfer', accountId: sv }); })
      .then(function () { return b.importBankLines(sv, rowsOf(b, 'Savings', [['2026-10-30', 'ONLINE TRANSFER FROM CHK', 50000]]), { fileName: 'sav.csv', matchBooks: false }); })   // 1.23 would match it on import
      .then(function () {
        svLine = b.bankLinesFor(sv, 'review')[0];
        var c = b.bankCandidates(svLine.id);
        eq(c.length, 1, 'one candidate'); eq(c[0].kind, 'register'); eq(b.txById[c[0].txnId].type, 'transfer'); ok(c[0].best, 'flagged best (only one, same date)');
        return b.postBankLine(svLine.id, { kind: 'match', txnId: c[0].txnId, splitIndex: c[0].splitIndex });
      }).then(function () {
        eq(b.accountBalance(sv), 50000, 'savings still $500'); eq(b.transactions.filter(function (t) { return t.status === 'posted'; }).length, 1);
        eq(b.bankCandidates(svLine.id).length, 0, 'a matched entry is not offered again');
        clean(b);
      });
  });
  test('BF-05 every candidate is listed and ranked; one book entry cannot be claimed by two bank lines', function () {
    var b, ck, l1, l2, t1, t2;
    return newBook().then(function (x) {
      b = x; ck = acc(b, 'Checking');
      return b.saveTransaction({ type: 'check', date: '2026-10-28', accountId: ck, number: '1042', lines: [{ accountId: acc(b, 'Rent & Lease'), amount: '850' }] });
    }).then(function (t) { t1 = t; return b.saveTransaction({ type: 'expense', date: '2026-10-31', accountId: ck, lines: [{ accountId: acc(b, 'Repairs & Maintenance'), amount: '850' }] }); })
      .then(function (t) { t2 = t; return b.importBankLines(ck, rowsOf(b, 'Checking', [['2026-11-01', 'CHECK 1042', -85000, '1042'], ['2026-11-01', 'POS PURCHASE', -85000]]), { fileName: 'a.csv', matchBooks: false }); })
      .then(function () {
        var ls = b.bankLinesFor(ck, 'review'); l1 = ls.find(function (x) { return x.checkNo === '1042'; }); l2 = ls.find(function (x) { return !x.checkNo; });
        var c = b.bankCandidates(l1.id);
        eq(c.length, 2, 'both entries offered'); eq(c[0].txnId, t1.id, 'check number ranks the check first'); ok(/check/i.test(c[0].reasons.join(' ')), c[0].reasons.join('; '));
        eq(b.bankCandidates(l2.id)[0].txnId, t2.id, 'closer date first');
        return b.postBankLine(l1.id, { kind: 'match', txnId: t1.id, splitIndex: c[0].splitIndex });
      })
      .then(function () {
        eq(b.bankCandidates(l2.id).length, 1, 'the matched check is gone from the other line');
        var si = b.txById[t1.id].splits.findIndex(function (s) { return s.accountId === ck; });
        return rejects(b.postBankLine(l2.id, { kind: 'match', txnId: t1.id, splitIndex: si }), /already matched/i);
      })
      .then(function () { return b.undoBankLine(l1.id); })
      .then(function () {
        eq(b.txById[t1.id].status, 'posted', 'undoing a match keeps the entry'); eq(b.txById[t1.id].splits.find(function (s) { return s.accountId === ck; }).cleared || '', '', 'and un-clears it');
        clean(b);
      });
  });
  test('BF-12 match a deposit to an open invoice (and a payment out to an open bill): one payment, applied, cleared', function () {
    var b, ck, c, v, inv, bill;
    return newBook().then(function (x) { b = x; ck = acc(b, 'Checking'); return b.saveContact({ kind: 'customer', name: 'Harbor Dental' }); })
      .then(function (x) { c = x; return b.saveContact({ kind: 'vendor', name: 'Granite Property' }); })
      .then(function (x) { v = x; return b.saveTransaction({ type: 'invoice', date: '2026-10-01', contactId: c.id, lines: [{ accountId: acc(b, 'Services'), amount: '2450' }] }); })
      .then(function (t) { inv = t; return b.saveTransaction({ type: 'bill', date: '2026-10-05', contactId: v.id, lines: [{ accountId: acc(b, 'Rent & Lease'), amount: '1800' }] }); })
      .then(function (t) { bill = t; return b.importBankLines(ck, rowsOf(b, 'Checking', [['2026-11-01', 'REMOTE ONLINE DEPOSIT HARBOR DENTAL', 245000], ['2026-11-02', 'GRANITE PROPERTY MGMT', -180000]]), { fileName: 'a.csv' }); })
      .then(function () {
        var ls = b.bankLinesFor(ck, 'review'), dep = ls.find(function (x) { return x.amount > 0; }), out = ls.find(function (x) { return x.amount < 0; });
        var c1 = b.bankCandidates(dep.id); eq(c1[0].kind, 'open'); eq(c1[0].txnId, inv.id); ok(/Harbor Dental/.test(c1[0].reasons.join(' ')), 'name found in the bank text');
        eq(b.bankCandidates(out.id)[0].txnId, bill.id);
        return b.postBankLine(dep.id, { kind: 'open', txnIds: [inv.id] }).then(function (p) {
          eq(p.type, 'payment'); eq(p.accountId, ck); eq(b.openBalance(b.txById[inv.id]), 0, 'invoice paid');
          return b.postBankLine(out.id, { kind: 'open', txnIds: [bill.id] });
        });
      })
      .then(function (p) { eq(p.type, 'billPayment'); eq(b.openBalance(b.txById[bill.id]), 0); eq(b.accountBalance(ck), 65000); clean(b); });
  });
  test('BF-13 exclude keeps the reason and can be restored; excluded lines never post; batch exclude', function () {
    var b, ck, ls;
    return newBook().then(function (x) { b = x; ck = acc(b, 'Checking'); return b.importBankLines(ck, rowsOf(b, 'Checking', [['2026-11-01', 'A', -100], ['2026-11-01', 'B', -200], ['2026-11-01', 'C', -300]]), { fileName: 'a.csv' }); })
      .then(function () { ls = b.bankLinesFor(ck, 'review'); return b.excludeBankLines([ls[0].id, ls[1].id], 'Duplicate of card feed'); })
      .then(function () {
        eq(b.bankLinesFor(ck, 'excluded').length, 2); eq(b.bankLineById[ls[0].id].excludeReason, 'Duplicate of card feed');
        return rejects(b.postBankLine(ls[0].id, { kind: 'add', categoryId: acc(b, 'Meals') }), /excluded/i);
      })
      .then(function () { return b.restoreBankLines([ls[0].id]); })
      .then(function () { eq(b.bankLinesFor(ck, 'review').length, 2); eq(b.bankLineById[ls[0].id].excludeReason || '', ''); });
  });
  test('BF-14 undo import refuses while lines from it are posted; mapping profile is saved per account', function () {
    var b, ck, r;
    return newBook().then(function (x) { b = x; ck = acc(b, 'Checking'); return b.importBankLines(ck, rowsOf(b, 'Checking', [['2026-11-01', 'A', -100]]), { fileName: 'a.csv' }); })
      .then(function (x) { r = x; return b.postBankLine(b.bankLinesFor(ck, 'review')[0].id, { kind: 'add', categoryId: acc(b, 'Meals') }); })
      .then(function () { return rejects(b.undoBankImport(r.import.id), /posted/i); })
      .then(function () { return b.saveBankProfile(ck, { header: 'Details|Posting Date|Description', mapping: { date: 1, description: 2, amount: 3 }, dateFormat: 'MDY' }); })
      .then(function () { eq(b.bankProfile(ck, 'Details|Posting Date|Description').mapping.description, 2); eq(b.bankProfile(ck, 'Other|Header'), null); });
  });
  test('BF-15 legacy imports (1.19 and earlier, no bank lines) still count as already imported', function () {
    var b, ck;
    return newBook().then(function (x) {
      b = x; ck = acc(b, 'Checking');
      var rows = I.assignHashes(ck, [{ date: '2026-11-01', description: 'OLD', amount: -100 }]);
      return b.saveTransaction({ type: 'expense', date: '2026-11-01', accountId: ck, importHash: rows[0].hash, lines: [{ accountId: acc(b, 'Meals'), amount: '1' }] });
    }).then(function () { return b.importBankLines(ck, [{ date: '2026-11-01', description: 'OLD', amount: -100 }], { fileName: 'old.csv' }); })
      .then(function (r) { eq(r.added, 0); eq(r.duplicates, 1); });
  });
  test('BF-16 backup → restore keeps bank lines, imports and profiles', function () {
    var b, ck;
    return newBook().then(function (x) { b = x; ck = acc(b, 'Checking'); return b.importBankLines(ck, [{ date: '2026-11-01', description: 'A', amount: -100 }], { fileName: 'a.csv', endingBalance: 1 }); })
      .then(function () { return b.saveBankProfile(ck, { header: 'h', mapping: { date: 0 }, dateFormat: 'DMY' }); })
      .then(function () {
        var v = OB.backup.validate(JSON.parse(JSON.stringify(OB.backup.create(b)))); ok(v.ok, v.errors.join('; '));
        var r = OB.Book.fromData(new OB.MemoryAdapter(), OB.backup.prepareRestore(v.data, 'copy'));
        eq(r.bankLines.length, 1); eq(r.bankImports.length, 1); eq(r.bankProfile(r.accounts.find(function (a) { return a.name === 'Checking'; }).id, 'h').dateFormat, 'DMY');
      });
  });
  test('BF-17 suggestions: a rule first, else the category used before for the same merchant; conflicting history = no guess', function () {
    var b, ck;
    return newBook().then(function (x) { b = x; ck = acc(b, 'Checking'); return b.importBankLines(ck, rowsOf(b, 'Checking', [['2026-10-01', 'SQ *BLUE BOTTLE COFFEE 4432 NY', -500], ['2026-10-08', 'SQ *BLUE BOTTLE COFFEE 9921 NY', -650], ['2026-10-09', 'ACME SUPPLY 1', -100], ['2026-10-10', 'ACME SUPPLY 2', -100], ['2026-10-11', 'ACME SUPPLY 3', -100]]), { fileName: 'a.csv' }); })
      .then(function () {
        var ls = b.bankLinesFor(ck, 'review'), coffee = ls.filter(function (x) { return /BLUE/.test(x.description); }), acme = ls.filter(function (x) { return /ACME/.test(x.description); });
        eq(b.bankSuggestion(coffee[0].id), null, 'nothing learned yet');
        eq(b.bankPreview(ck, [{ date: '2026-10-01', description: 'SQ *BLUE BOTTLE COFFEE 4432 NY', amount: -500 }, { date: '2026-10-20', description: 'NEW', amount: -1 }]).fresh, 1, 'preview counts new lines');
        return b.postBankLine(coffee[1].id, { kind: 'add', categoryId: acc(b, 'Meals') })
          .then(function () { var sg = b.bankSuggestion(coffee[0].id); eq(sg.categoryId, acc(b, 'Meals')); eq(sg.source, 'history'); ok(/1 of 1/.test(sg.reason), sg.reason); })
          .then(function () { return b.postBankLine(acme[0].id, { kind: 'add', categoryId: acc(b, 'Meals') }); })
          .then(function () { return b.postBankLine(acme[1].id, { kind: 'add', categoryId: acc(b, 'Office Supplies & Software') }); })
          .then(function () { eq(b.bankSuggestion(acme[2].id), null, 'tied history abstains'); return b.saveRule({ contains: 'acme', accountId: acc(b, 'Repairs & Maintenance'), direction: 'out' }); })
          .then(function () { var sg = b.bankSuggestion(acme[2].id); eq(sg.source, 'rule'); eq(sg.categoryId, acc(b, 'Repairs & Maintenance')); });
      });
  });
  /* ---------- BF-20: export bank feed transactions to QuickBooks ---------- */
  function feedBook() {
    var b, ck, sv, cc, v;
    return newBook().then(function (x) {
      b = x; ck = acc(b, 'Checking'); sv = acc(b, 'Savings'); cc = b.accounts.find(function (a) { return a.type === 'cc'; }).id;
      return b.saveContact({ kind: 'vendor', name: 'Comcast: Cable' });
    }).then(function (x) {
      v = x;
      return b.importBankLines(ck, [{ date: '2026-01-05', description: 'COMCAST', amount: -18999 }, { date: '2026-01-06', description: 'DEPOSIT', amount: 245000 },
        { date: '2026-01-07', description: 'TRANSFER TO SAV', amount: -50000 }, { date: '2026-02-03', description: 'COSTCO', amount: -30000, checkNo: '1043' }, { date: '2026-02-10', description: 'UNKNOWN', amount: -999 }], { fileName: 'jan-feb.csv' });
    }).then(function () { return b.importBankLines(sv, [{ date: '2026-01-07', description: 'TRANSFER FROM CHK', amount: 50000 }], { fileName: 'sav.csv' }); })
      .then(function () { return b.importBankLines(cc, [{ date: '2026-01-09', description: 'AMAZON', amount: -6318 }, { date: '2026-01-20', description: 'REFUND', amount: 1000 }], { fileName: 'card.csv' }); })
      .then(function () {
        var L = function (a, d) { return b.bankLinesFor(a, 'review').find(function (l) { return l.description === d; }).id; };
        return b.postBankLine(L(ck, 'COMCAST'), { kind: 'add', categoryId: acc(b, 'Utilities'), contactId: v.id, memo: 'Internet' })
          .then(function () { return b.postBankLine(L(ck, 'DEPOSIT'), { kind: 'split', lines: [{ accountId: acc(b, 'Services'), amount: 200000 }, { accountId: acc(b, 'Sales'), amount: 45000 }] }); })
          .then(function () { return b.postBankLine(L(ck, 'TRANSFER TO SAV'), { kind: 'transfer', accountId: sv }); })
          .then(function () { var l = b.bankLinesFor(sv, 'review')[0], c = b.bankCandidates(l.id)[0]; return b.postBankLine(l.id, { kind: 'match', txnId: c.txnId, splitIndex: c.splitIndex }); })
          .then(function () { return b.postBankLine(L(ck, 'COSTCO'), { kind: 'add', categoryId: acc(b, 'Office Supplies & Software') }); })
          .then(function () { return b.postBankLine(L(cc, 'AMAZON'), { kind: 'add', categoryId: acc(b, 'Office Supplies & Software') }); })
          .then(function () { return b.postBankLine(L(cc, 'REFUND'), { kind: 'add', categoryId: acc(b, 'Office Supplies & Software') }); })
          .then(function () { return { b: b, ck: ck, sv: sv, cc: cc }; });
      });
  }
  test('BF-20 bank feed → QuickBooks Desktop .iif: right types and signs, transfer once, lists, period and account choice', function () {
    var f;
    return feedBook().then(function (x) {
      f = x; var b = f.b, X = OB.qbexport;
      var r = X.bankIIF(b, { accountIds: [f.ck, f.sv, f.cc], from: '2026-01-01', to: '2026-01-31' });
      eq(r.txnCount, 5, 'Jan: expense, split deposit, transfer (once for both accounts), card charge, card refund');
      ok(/\r\n/.test(r.text) && r.text.indexOf('!TRNS\tTRNSID\tTRNSTYPE\tDATE\tACCNT\tNAME\tCLASS\tAMOUNT\tDOCNUM\tMEMO\tCLEAR') >= 0, 'IIF header');
      ok(r.text.indexOf('TRNS\t\tCHECK\t1/5/2026\tChecking\tComcast- Cable\t\t-189.99\t\tInternet\tY') >= 0, 'payment out = CHECK, bank credited, name without colon, cleared');
      ok(r.text.indexOf('SPL\t\tCHECK\t1/5/2026\tUtilities\tComcast- Cable\t\t189.99\t') >= 0, 'expense line debited');
      ok(r.text.indexOf('TRNS\t\tDEPOSIT\t1/6/2026\tChecking\t\t\t2450.00') >= 0 && r.text.indexOf('SPL\t\tDEPOSIT\t1/6/2026\tServices\t\t\t-2000.00') >= 0 && r.text.indexOf('SPL\t\tDEPOSIT\t1/6/2026\tSales\t\t\t-450.00') >= 0, 'split deposit keeps both lines');
      eq(r.text.split('\tTRANSFER\t').length - 1, 2, 'the transfer is written once (TRNS + SPL)');
      ok(r.text.indexOf('TRNS\t\tCREDIT CARD\t1/9/2026') >= 0 && r.text.indexOf('TRNS\t\tCCARD REFUND\t1/20/2026') >= 0, 'card charge and refund types');
      ok(r.text.indexOf('ACCNT\tChecking\tBANK') >= 0 && r.text.indexOf('ACCNT\tUtilities\tEXP') >= 0 && r.text.indexOf('VEND\tComcast- Cable') >= 0, 'account and vendor lists');
      ok(r.text.indexOf('COSTCO') < 0 && r.text.indexOf('2/3/2026') < 0, 'February not in a January export');
      var only = X.bankIIF(b, { accountIds: [f.cc], from: '2026-01-01', to: '2026-12-31' });
      eq(only.txnCount, 2, 'one account only'); ok(only.text.indexOf('Checking') < 0 || only.text.indexOf('ACCNT\tChecking') < 0, 'other bank not listed');
      var named = X.bankIIF(b, { accountIds: [f.ck], from: '2026-01-01', to: '2026-01-31', qbNames: {} , names: (function () { var o = {}; o[f.ck] = 'Chase Checking 4411'; return o; })() });
      ok(named.text.indexOf('TRNS\t\tCHECK\t1/5/2026\tChase Checking 4411\t') >= 0 && named.text.indexOf('ACCNT\tChase Checking 4411\tBANK') >= 0, 'bank account renamed to the QuickBooks name');
      eq(r.byAccount[f.ck].out, 68999, 'checking money out in January'); eq(r.byAccount[f.ck].in, 245000);
      // round trip: QuickBooks importer reads it back and balances match
      var model = OB.qbimport.read([{ name: 'bank.iif', text: r.text }]);
      eq(model.errors.length, 0, model.errors.join(' '));
      ok(model.txns.every(function (t) { return U.sum(t.rows, function (x) { return x.amount; }) === 0; }), 'every exported transaction balances');
      return newBook().then(function (dst) {
        var plan = OB.qbimport.plan(model, dst); if (plan.errors.length) throw new Error(plan.errors.join(' | '));
        return dst.importBundle(plan.bundle).then(function () {
          var bal = function (bk, n) { return bk.accountBalance(bk.accounts.find(function (a) { return a.name === n; }).id, '2026-01-31'); };
          ['Checking', 'Savings', 'Utilities', 'Services', 'Sales'].forEach(function (n) { eq(bal(dst, n), bal(b, n), n + ' balance after import'); });
        });
      });
    });
  });
  test('BF-21 only posted lines go (For review never); invoice payments skipped or sent to A/R; exported lines tracked so nothing goes twice', function () {
    var f, b, rec;
    return feedBook().then(function (x) {
      f = x; b = f.b; var X = OB.qbexport;
      var r = X.bankIIF(b, { accountIds: [f.ck], from: '2026-02-01', to: '2026-02-28' });
      eq(r.txnCount, 1, 'only the posted line'); eq(r.skipped.length, 1); ok(/not posted/i.test(r.skipped[0].reason), r.skipped[0].reason);
      eq(X.bankIIF(b, { accountIds: [f.ck], from: '2026-02-01', to: '2026-02-28', includeReview: true }).txnCount, 1, 'there is no way to send an unposted line');
      ok(r.text.indexOf('UNKNOWN') < 0, 'the unposted line is not in the file');
      return b.postBankLine(b.bankLinesFor(f.ck, 'review')[0].id, { kind: 'add', categoryId: acc(b, 'Meals') }).then(function () {
        var r2 = X.bankIIF(b, { accountIds: [f.ck], from: '2026-02-01', to: '2026-02-28' }); eq(r2.txnCount, 2, 'once posted it goes');
        return b.recordBankExport(r2, { fileName: 'feb.iif', format: 'iif' });
      });
    }).then(function (e) {
      rec = e; eq(e.count, 2);
      var again = OB.qbexport.bankIIF(b, { accountIds: [f.ck], from: '2026-02-01', to: '2026-02-28' });
      eq(again.txnCount, 0, 'already exported lines are left out'); eq(again.skipped.filter(function (s) { return /already exported/i.test(s.reason); }).length, 2);
      eq(OB.qbexport.bankIIF(b, { accountIds: [f.ck], from: '2026-02-01', to: '2026-02-28', onlyNew: false }).txnCount, 2, 'unless asked to include them');
      return b.undoBankExport(rec.id);
    }).then(function () {
      eq(OB.qbexport.bankIIF(b, { accountIds: [f.ck], from: '2026-02-01', to: '2026-02-28' }).txnCount, 2, 'after undo they export again');
      return b.saveContact({ kind: 'customer', name: 'Harbor Dental' });
    }).then(function (c) { return b.saveTransaction({ type: 'invoice', date: '2026-03-01', contactId: c.id, lines: [{ accountId: acc(b, 'Services'), amount: '500' }] }); })
      .then(function (inv) { return b.importBankLines(f.ck, [{ date: '2026-03-05', description: 'HARBOR DENTAL', amount: 50000 }], { fileName: 'mar.csv' }).then(function () { return b.postBankLine(b.bankLinesFor(f.ck, 'review').find(function (l) { return l.date === '2026-03-05'; }).id, { kind: 'open', txnIds: [inv.id] }); }); })
      .then(function () {
        var X = OB.qbexport, skip = X.bankIIF(b, { accountIds: [f.ck], from: '2026-03-01', to: '2026-03-31' });
        eq(skip.txnCount, 0); ok(/Receive Payments/i.test(skip.skipped[0].reason), skip.skipped[0].reason);
        var dep = X.bankIIF(b, { accountIds: [f.ck], from: '2026-03-01', to: '2026-03-31', payments: 'deposit' });
        ok(dep.text.indexOf('TRNS\t\tDEPOSIT\t3/5/2026\tChecking\tHarbor Dental\t\t500.00') >= 0 && dep.text.indexOf('SPL\t\tDEPOSIT\t3/5/2026\tAccounts Receivable (A/R)\tHarbor Dental\t\t-500.00') >= 0, 'as a deposit to A/R with the customer');
        var csv = X.bankCSV(b, { accountIds: [f.ck], from: '2026-01-01', to: '2026-03-31', onlyNew: false });
        ok(csv.text.indexOf('Date,Description,Amount\r\n') === 0 && csv.text.indexOf('01/05/2026,COMCAST,-189.99') > 0 && csv.text.indexOf('03/05/2026,HARBOR DENTAL,500.00') > 0, 'QuickBooks Online 3-column CSV');
      });
  });
  test('BF-22 a waiting bank line takes a note and a corrected date; the post uses the new date; posted lines refuse', function () {
    var b, ck, id;
    return newBook().then(function (x) { b = x; ck = acc(b, 'Checking'); return b.importBankLines(ck, rowsOf(b, 'Checking', [['2026-11-03', 'COFFEE', -1475]]), { fileName: 'a.csv' }); })
      .then(function () { id = b.bankLinesFor(ck, 'review')[0].id; return b.updateBankLine(id, { note: '  Client meeting  ', date: '2026-11-01' }); })
      .then(function (l) {
        eq(l.note, 'Client meeting'); eq(l.date, '2026-11-01'); eq(l.bankDate, '2026-11-03', 'bank date kept');
        return rejects(b.updateBankLine(id, { date: '2026-13-40' }), /date/i);
      })
      .then(function () { return b.updateBankLine(id, { date: '2026-11-03' }); })
      .then(function (l) { eq(l.date, '2026-11-03'); ok(!l.bankDate, 'back to the bank date drops the copy'); return b.updateBankLine(id, { date: '2026-11-02' }); })
      .then(function () { return b.postBankLine(id, { kind: 'add', categoryId: acc(b, 'Meals') }); })
      .then(function (t) {
        eq(t.date, '2026-11-02'); eq(b.bankLineById[id].note, 'Client meeting');
        return rejects(b.updateBankLine(id, { note: 'x' }), /For review/i);
      })
      .then(function () { clean(b); });
  });
  test('BF-23 one deposit paying several open invoices: suggested from the customer name (written together in the bank text) and the invoice numbers; manual pick with a part payment', function () {
    var b, ck, c, other, inv = {};
    var mk = function (no, date, amt, cid) { return b.saveTransaction({ type: 'invoice', date: date, number: no, contactId: cid || c.id, lines: [{ accountId: acc(b, 'Services'), amount: amt }] }).then(function (t) { inv[no] = t; }); };
    return newBook().then(function (x) { b = x; ck = acc(b, 'Checking'); return b.saveContact({ kind: 'customer', name: 'MESA HEALTH' }); })
      .then(function (x) { c = x; return b.saveContact({ kind: 'customer', name: 'Cedar Clinic' }); })
      .then(function (x) { other = x; return mk('2130', '2026-01-19', '50000'); })
      .then(function () { return mk('2162', '2026-04-07', '340074.75'); })
      .then(function () { return mk('2170', '2026-04-07', '30000'); })
      .then(function () { return mk('2180', '2026-05-01', '27200'); })
      .then(function () { return mk('2185', '2026-06-07', '370074.75'); })          // after the bank date: not offered
      .then(function () { return mk('3001', '2026-04-01', '40074.75', other.id); })
      .then(function () { return mk('3002', '2026-04-01', '330000', other.id); })    // adds up too, but nothing ties it to this line
      .then(function () { return b.importBankLines(ck, rowsOf(b, 'Checking', [['2026-05-04', 'Orig CO Name:Mesahealth Supp Orig ID:1230610111 Desc Date:260504 Ind Name:Acme Imaging 2170*2162\\ Trn: 1243331876Tc', 37007475], ['2026-05-05', 'DEPOSIT', 1000000]]), { fileName: 'may.csv' }); })
      .then(function () {
        var ls = b.bankLinesFor(ck, 'review'), dep = ls.find(function (x) { return x.amount === 37007475; }), small = ls.find(function (x) { return x.amount === 1000000; });
        var cs = b.bankCandidates(dep.id), top = cs[0];
        eq(top.kind, 'open'); ok(top.best, 'clear best match');
        eq(top.txnIds.slice().sort().join(), [inv['2162'].id, inv['2170'].id].sort().join(), 'invoices 2162 and 2170');
        ok(/MESA HEALTH/.test(top.reasons.join(' ')) && /2162/.test(top.reasons.join(' ')), 'reasons name the customer and the numbers: ' + top.reasons.join(' | '));
        ok(!cs.some(function (x) { return x.txnIds && x.txnIds.indexOf(inv['3001'].id) >= 0; }), 'another customer is not offered');
        ok(!cs.some(function (x) { return x.txnIds && x.txnIds.indexOf(inv['2185'].id) >= 0; }), 'a later invoice is not offered');
        eq(b.bankOpenDocs(dep.id).contactId, c.id, 'the manual list starts on the customer named in the bank text');
        eq(b.bankOpenDocs(dep.id).docs.map(function (t) { return t.number; }).join(), '2130,2162,2170,2180,2185');
        eq(b.bankOpenDocs(dep.id, other.id).docs.length, 2);
        return rejects(b.postBankLine(small.id, { kind: 'open', txnIds: [inv['2130'].id], amounts: {} }), /add up to \$50,000\.00/)
          .then(function () { return rejects(b.postBankLine(small.id, { kind: 'open', txnIds: [inv['2130'].id], amounts: (function (o) { o[inv['2130'].id] = 6000000; return o; })({}) }), /more than/i); })
          .then(function () { var a = {}; a[inv['2130'].id] = 1000000; return b.postBankLine(small.id, { kind: 'open', txnIds: [inv['2130'].id], amounts: a }); })
          .then(function (p) { eq(p.type, 'payment'); eq(b.openBalance(b.txById[inv['2130'].id]), 4000000, 'part payment leaves $40,000 open'); return b.postBankLine(dep.id, { kind: 'open', txnIds: top.txnIds }); })
          .then(function (p) { eq(p.amount, 37007475); eq(b.openBalance(b.txById[inv['2162'].id]), 0); eq(b.openBalance(b.txById[inv['2170'].id]), 0); clean(b); });
      });
  });
  test('BF-24 a customer splits one invoice over several days: lines from the same customer that add up to an open invoice are offered as part payments; amount alone is not enough', function () {
    var b, ck, c, inv, other;
    return newBook().then(function (x) { b = x; ck = acc(b, 'Checking'); return b.saveContact({ kind: 'customer', name: 'Sunrise Health' }); })
      .then(function (x) { c = x; return b.saveContact({ kind: 'customer', name: 'Pine Labs' }); })
      .then(function (x) { other = x; return b.saveTransaction({ type: 'invoice', date: '2026-09-01', number: '4410', contactId: c.id, lines: [{ accountId: acc(b, 'Services'), amount: '15000' }] }); })
      .then(function (t) { inv = t; return b.saveTransaction({ type: 'invoice', date: '2026-09-01', number: '5001', contactId: other.id, lines: [{ accountId: acc(b, 'Services'), amount: '12500' }] }); })
      .then(function () {
        return b.importBankLines(ck, rowsOf(b, 'Checking', [
          ['2026-09-22', 'Orig CO Name:Sunrise Health Orig ID:39 CO Entry Descr:Ap Payment Trn: 2650583688Tc', 975000],
          ['2026-09-23', 'Orig CO Name:Sunrise Health Orig ID:39 CO Entry Descr:Ap Payment Trn: 2662491239Tc', 525000],
          ['2026-09-24', 'REMOTE ONLINE DEPOSIT', 275000],                       // 9,750 + 2,750 = 12,500, but nothing ties it to Pine Labs
          ['2026-09-25', 'Orig CO Name:Sunrise Health Trn: 1', 100000]]), { fileName: 'sep.csv' });
      })
      .then(function () {
        var ls = b.bankLinesFor(ck, 'review'), by = function (a) { return ls.find(function (x) { return x.amount === a; }); };
        var a = by(975000), c2 = by(525000), dep = by(275000);
        var ca = b.bankCandidates(a.id).filter(function (x) { return x.split; });
        eq(ca.length, 1, 'one split suggestion for the first line');
        eq(ca[0].txnIds.join(), inv.id); eq(ca[0].amounts[inv.id], 975000, 'pays its own amount'); eq(ca[0].peers.join(), c2.id, 'with the 09/23 line');
        ok(/Sunrise Health/.test(ca[0].reasons.join(' ')) && /09\/23\/2026/.test(ca[0].reasons.join(' ')), ca[0].reasons.join(' | '));
        ok(!b.bankCandidates(dep.id).some(function (x) { return x.split; }), 'an unnamed line is not joined by amount alone');
        ok(b.bankCandidates(c2.id).some(function (x) { return x.split && x.peers[0] === a.id; }), 'the other line sees the same split');
        return b.postBankLine(a.id, { kind: 'open', txnIds: ca[0].txnIds, amounts: ca[0].amounts }).then(function () { return c2; });
      })
      .then(function (c2) {
        eq(b.openBalance(b.txById[inv.id]), 525000, 'part paid, $5,250 left');
        var best = b.bankCandidates(c2.id).find(function (x) { return x.best; });
        ok(best && best.kind === 'open' && best.txnIds[0] === inv.id, 'the second line now matches what is left of the invoice');
        return b.postBankLine(c2.id, { kind: 'open', txnIds: best.txnIds, amounts: best.amounts });
      })
      .then(function () { eq(b.openBalance(b.txById[inv.id]), 0, 'invoice paid in two deposits'); clean(b); });
  });
  test('BF-25 same-amount invoices: the number in the bank text decides; with no number the oldest is listed first and nothing is matched automatically', function () {
    var b, ck, c, ids = {};
    var mk = function (no, date) { return b.saveTransaction({ type: 'invoice', date: date, number: no, contactId: c.id, lines: [{ accountId: acc(b, 'Services'), amount: '72000' }] }).then(function (t) { ids[no] = t.id; }); };
    return newBook().then(function (x) { b = x; ck = acc(b, 'Checking'); return b.saveContact({ kind: 'customer', name: 'Lakeshore Imaging' }); })
      .then(function (x) { c = x; return mk('1216', '2026-07-01'); }).then(function () { return mk('1201', '2026-06-01'); }).then(function () { return mk('1229', '2026-08-01'); })
      .then(function () { return b.importBankLines(ck, rowsOf(b, 'Checking', [['2026-09-09', 'Orig CO Name:Lakeshore Imaging Receivable Inv 1229 Trn: 2526634999Tc', 7200000], ['2026-09-10', 'Orig CO Name:Lakeshore Imaging Receivable', 7200000]]), { fileName: 'x.csv' }); })
      .then(function () {
        var ls = b.bankLinesFor(ck, 'review'), withNo = ls.find(function (l) { return /1229/.test(l.description); }), noNo = ls.find(function (l) { return !/1229/.test(l.description); });
        var a = b.bankCandidates(withNo.id);
        ok(a[0].best && a[0].txnId === ids['1229'], 'Inv 1229 in the bank text picks invoice 1229');
        ok(a[0].reasons.join(' ').indexOf('lists invoice 1229') >= 0);
        var n = b.bankCandidates(noNo.id);
        ok(!n.some(function (x) { return x.best; }), 'three equal invoices, no number: nothing automatic');
        eq(n[0].txnId, ids['1201'], 'oldest open invoice first');
        clean(b);
      });
  });
  test('BF-26 payments go to QuickBooks as Payment / Bill Payment transactions naming the invoices, with a list of what to apply (never as deposits to A/R)', function () {
    var b, ck, c, v, i1, i2, bill, X = OB.qbexport;
    return newBook().then(function (x) { b = x; ck = acc(b, 'Checking'); return Promise.all([b.saveContact({ kind: 'customer', name: 'HONOR HEALTH' }), b.saveContact({ kind: 'vendor', name: 'Paper: Co' })]); })
      .then(function (cs) {
        c = cs[0]; v = cs[1];
        return b.saveTransactions([
          { type: 'invoice', date: '2026-04-07', number: '1162', contactId: c.id, lines: [{ accountId: acc(b, 'Services'), amount: '340074.75' }] },
          { type: 'invoice', date: '2026-04-07', number: '1170', contactId: c.id, lines: [{ accountId: acc(b, 'Services'), amount: '30000' }] },
          { type: 'bill', date: '2026-05-01', number: 'B-77', contactId: v.id, lines: [{ accountId: acc(b, 'Office Supplies & Software'), amount: '250' }] }]);
      })
      .then(function (ts) {
        i1 = ts[0]; i2 = ts[1]; bill = ts[2];
        return b.importBankLines(ck, [{ date: '2026-05-04', description: 'Orig CO Name:Honorhealth Supp 1170*1162', amount: 37007475 }, { date: '2026-05-09', description: 'PAPER CO', amount: -25000, checkNo: '5011' }], { fileName: 'may.csv' });
      })
      .then(function () {
        var ls = b.bankLinesFor(ck, 'review'), dep = ls.find(function (l) { return l.amount > 0; }), out = ls.find(function (l) { return l.amount < 0; });
        var best = b.bankCandidates(dep.id).find(function (x) { return x.best; });
        return b.postBankLine(dep.id, { kind: 'open', txnIds: best.txnIds }).then(function () { return b.postBankLine(out.id, { kind: 'open', txnIds: [bill.id] }); });
      })
      .then(function () {
        var r = X.bankIIF(b, { accountIds: [ck], from: '2026-05-01', to: '2026-05-31', payments: 'payment' });
        eq(r.txnCount, 2, 'both payments are sent');
        ok(r.text.indexOf('\tDEPOSIT\t') < 0, 'no deposit to A/R');
        ok(r.text.indexOf('TRNS\t\tPAYMENT\t5/4/2026\tChecking\tHONOR HEALTH\t\t370074.75\t') >= 0, 'customer payment into the bank: ' + r.text.split('\r\n').filter(function (x) { return /PAYMENT/.test(x); }).join(' || '));
        ok(r.text.indexOf('SPL\t\tPAYMENT\t5/4/2026\tAccounts Receivable (A/R)\tHONOR HEALTH\t\t-370074.75') >= 0, 'A/R credited with the customer');
        ok(/Pays invoice 1162 \$340,074\.75; invoice 1170 \$30,000\.00/.test(r.text), 'memo names the invoices and amounts');
        ok(r.text.indexOf('TRNS\t\tBILLPMT\t5/9/2026\tChecking\tPaper- Co\t\t-250.00\t5011\t') >= 0, 'bill payment from the bank, check number');
        ok(r.text.indexOf('SPL\t\tBILLPMT\t5/9/2026\tAccounts Payable (A/P)\tPaper- Co\t\t250.00') >= 0, 'A/P debited with the vendor');
        ok(/Pays bill B-77 \$250\.00/.test(r.text));
        var model = OB.qbimport.read([{ name: 'may.iif', text: r.text }]);
        eq(model.errors.length, 0, model.errors.join(' '));
        ok(model.txns.every(function (t) { return U.sum(t.rows, function (x) { return x.amount; }) === 0; }), 'balanced');
        var list = X.paymentList(b, { accountIds: [ck], from: '2026-05-01', to: '2026-05-31' });
        eq(list.rows.length, 3, 'one row per invoice or bill paid');
        eq(list.rows[0].doc, '1162'); eq(list.rows[0].applied, 34007475); eq(list.rows[1].doc, '1170'); eq(list.rows[2].kind, 'Bill payment');
        ok(list.csv.indexOf('Date,Type,Customer or vendor,Payment no.,Payment amount,Bank account,Apply to,Invoice or bill date,Amount to apply\r\n') === 0, list.csv.slice(0, 120));
        ok(list.csv.indexOf('05/04/2026,Customer payment,HONOR HEALTH,,370074.75,Checking,1162,04/07/2026,340074.75') > 0, 'csv row');
        var skip = X.bankIIF(b, { accountIds: [ck], from: '2026-05-01', to: '2026-05-31' });
        eq(skip.txnCount, 0, 'left out unless asked'); eq(X.paymentList(b, { accountIds: [ck], from: '2026-05-01', to: '2026-05-31' }).rows.length, 3, 'the list is there either way');
        // BF-27 the QuickBooks connector batch: one entry per customer payment, naming each invoice and the amount to apply
        var batch = X.connectorBatch(b, { accountIds: [ck], from: '2026-05-01', to: '2026-05-31', onlyNew: false, now: '2026-11-12T00:00:00.000Z' });
        eq(batch.format, 'vaultbook-qb-batch'); eq(batch.version, 1); eq(batch.createdAt, '2026-11-12T00:00:00.000Z');
        eq(batch.payments.length, 1, 'customer payments only'); eq(batch.billPayments, 1, 'bill payments counted, not sent yet');
        var p = batch.payments[0];
        eq(p.customer, 'HONOR HEALTH'); eq(p.date, '2026-05-04'); eq(p.amount, '370074.75'); eq(p.depositTo, 'Checking'); eq(p.ref, '');
        eq(JSON.stringify(p.apply), JSON.stringify([{ invoice: '1162', invoiceDate: '2026-04-07', amount: '340074.75' }, { invoice: '1170', invoiceDate: '2026-04-07', amount: '30000.00' }]));
        ok(/^Pays invoice 1162 \$340,074\.75; invoice 1170 \$30,000\.00/.test(p.memo), p.memo);
        eq(X.connectorBatch(b, { accountIds: [ck], from: '2026-06-01', to: '2026-06-30', onlyNew: false }).payments.length, 0, 'period respected');
      });
  });
})(typeof window !== 'undefined' ? window : globalThis);
