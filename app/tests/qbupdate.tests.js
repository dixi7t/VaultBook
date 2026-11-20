/* VaultBook — Update QuickBooks to match VaultBook (1.47): edits and voids worked out from a full QuickBooks export.
   Loaded by tests/run-node.js and tests/tests.html. */
(function (root) {
  'use strict';
  var OB = root.OB, QU = OB.qbupdate, T = OB.tests = OB.tests || [];
  function test(name, fn) { T.push({ name: name, fn: fn }); }
  function eq(a, b, msg) { if (a !== b) throw new Error((msg || 'Expected equal') + ': expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }
  function ok(v, msg) { if (!v) throw new Error(msg || 'Assertion failed'); }
  var R = function (n) { return { FullName: n }; };
  function full() {
    return { format: 'vaultbook-qb-full', version: 1, at: '2026-11-18T21:57:52.000Z', from: '', to: '2026-11-18', company: { CompanyName: 'Corner Candy LLC' },
      lists: {
        Account: [
          { FullName: 'Main Bank', Name: 'Main Bank', AccountType: 'Bank', Balance: '0' },
          { FullName: 'Opening Balance Equity', Name: 'Opening Balance Equity', AccountType: 'Equity', SpecialAccountType: 'OpeningBalanceEquity' },
          { FullName: 'Owners Draw', Name: 'Owners Draw', AccountType: 'Equity' },
          { FullName: 'Sales', Name: 'Sales', AccountType: 'Income' },
          { FullName: 'Purchase', Name: 'Purchase', AccountType: 'CostOfGoodsSold' },
          { FullName: 'Ask My Accountant', Name: 'Ask My Accountant', AccountType: 'OtherExpense' },
          { FullName: 'Utilities', Name: 'Utilities', AccountType: 'Expense' },
          { FullName: 'Utilities:Electric', Name: 'Electric', AccountType: 'Expense' }],
        Vendor: [{ Name: 'Lodi Wholesale' }, { Name: 'PSEG' }], Customer: [], Employee: [], OtherName: [], Item: [], Class: [], StandardTerms: []
      },
      txns: {
        Check: [
          { TxnID: 'C-1', EditSequence: '111', TxnDate: '2025-03-04', RefNumber: '339', AccountRef: R('Main Bank'), PayeeEntityRef: R('Lodi Wholesale'), Amount: '500.00', Memo: 'Check 339',
            ExpenseLineRet: { TxnLineID: 'C-1-L1', AccountRef: R('Ask My Accountant'), Amount: '500.00' } },
          { TxnID: 'C-2', EditSequence: '222', TxnDate: '2025-03-05', AccountRef: R('Main Bank'), PayeeEntityRef: R('PSEG'), Amount: '120.00', Memo: 'PSEG bill',
            ExpenseLineRet: [{ TxnLineID: 'C-2-L1', AccountRef: R('Utilities:Electric'), Amount: '100.00' }, { TxnLineID: 'C-2-L2', AccountRef: R('Ask My Accountant'), Amount: '20.00', Memo: 'late fee' }] },
          { TxnID: 'C-3', EditSequence: '333', TxnDate: '2025-03-06', AccountRef: R('Main Bank'), Amount: '40.00', Memo: 'ATM',
            ExpenseLineRet: { TxnLineID: 'C-3-L1', AccountRef: R('Purchase'), Amount: '40.00' } },
          { TxnID: 'C-4', EditSequence: '444', TxnDate: '2025-03-07', AccountRef: R('Main Bank'), Amount: '15.00', Memo: 'Same as before',
            ExpenseLineRet: { TxnLineID: 'C-4-L1', AccountRef: R('Utilities'), Amount: '15.00' } }],
        Deposit: [{ TxnID: 'D-1', EditSequence: '555', TxnDate: '2025-03-10', DepositToAccountRef: R('Main Bank'), DepositTotal: '900.00', Memo: 'Mobile deposit',
          DepositLineRet: { TxnLineID: 'D-1-L1', AccountRef: R('Sales'), Amount: '900.00', Memo: 'Mobile deposit' } }],
        JournalEntry: [{ TxnID: 'J-1', EditSequence: '666', TxnDate: '2025-01-01', RefNumber: '1',
          JournalDebitLine: { TxnLineID: 'J-1-D', AccountRef: R('Main Bank'), Amount: '1000.00' }, JournalCreditLine: { TxnLineID: 'J-1-C', AccountRef: R('Opening Balance Equity'), Amount: '1000.00' } }]
      } };
  }
  function imported() {
    var b, f = full();
    return OB.Book.create(new OB.MemoryAdapter(), { name: 'Corner Candy LLC' }).then(function (x) {
      b = x; var p = OB.qbimport.plan(OB.qbimport.read([{ name: 'f.json', text: JSON.stringify(f) }]), b, {});
      if (p.errors.length) throw new Error(p.errors.join(' | '));
      return b.importBundle(p.bundle);
    }).then(function () { return { b: b, f: f }; });
  }
  function byQb(b, id) { return b.transactions.find(function (t) { return (t.importRef || '').indexOf('TxnID ' + id) >= 0; }); }
  function acc(b, name) { return b.accounts.find(function (a) { return a.name === name; }).id; }

  test('QU-01 a fresh import has nothing to update', function () {
    return imported().then(function (x) {
      var p = QU.plan(x.b, x.f);
      eq(p.updates.length, 0, JSON.stringify(p.updates)); eq(p.voids.length, 0); eq(p.linked, 6, 'every transaction is linked to its QuickBooks id');
    });
  });

  test('QU-02 a reclass becomes a line edit: every line is sent (QuickBooks removes lines left out), only the changed one with an account', function () {
    var x;
    return imported().then(function (v) { x = v; var b = x.b, t = byQb(b, 'C-2'), rows = b.reclassRows({}).filter(function (r) { return r.txnId === t.id && r.ref.part === 'line' && r.ref.i === 1; });
      return b.reclassify([rows[0].key], { accountId: acc(b, 'Utilities') }, 'fix');
    }).then(function () {
      var p = QU.plan(x.b, x.f); eq(p.updates.length, 1); var u = p.updates[0];
      eq(u.kind, 'check'); eq(u.txnId, 'C-2'); eq(u.editSeq, '222');
      eq(u.lines.length, 2); eq(u.lines[0].lineId, 'C-2-L1'); ok(!u.lines[0].account, 'unchanged line keeps its account');
      eq(u.lines[1].lineId, 'C-2-L2'); eq(u.lines[1].account, 'Utilities'); ok(/Ask My Accountant -> Utilities/.test(u.what.join(' ')), u.what.join(' '));
      ok(!u.header, 'nothing in the header changed');
    });
  });

  test('QU-03 sub-accounts keep their QuickBooks full name; a new VaultBook account is created first', function () {
    var x;
    return imported().then(function (v) { x = v; return x.b.saveAccount({ name: 'Sales Returns', type: 'income', parentId: acc(x.b, 'Sales') }); })
      .then(function () { var b = x.b, t = byQb(b, 'C-1'), r = b.reclassRows({}).find(function (r) { return r.txnId === t.id && r.ref.part === 'line'; });
        return b.reclassify([r.key], { accountId: acc(b, 'Sales Returns') }, 'returned check'); })
      .then(function () { var b = x.b, t = byQb(b, 'C-3'), r = b.reclassRows({}).find(function (r) { return r.txnId === t.id && r.ref.part === 'line'; });
        return b.reclassify([r.key], { accountId: acc(b, 'Electric') }, 'power'); })
      .then(function () {
        var p = QU.plan(x.b, x.f);
        eq(p.accounts['Sales:Sales Returns'], 'Income', 'new account with its QuickBooks parent path and type');
        eq(p.updates.find(function (u) { return u.txnId === 'C-1'; }).lines[0].account, 'Sales:Sales Returns');
        eq(p.updates.find(function (u) { return u.txnId === 'C-3'; }).lines[0].account, 'Utilities:Electric', 'existing sub-account by its full name');
      });
  });

  test('QU-04 deposits, date, memo, payee and number changes; a void becomes a QuickBooks void', function () {
    var x;
    return imported().then(function (v) { x = v; var b = x.b, t = byQb(b, 'D-1'), r = b.reclassRows({}).find(function (r) { return r.txnId === t.id && r.ref.part === 'line'; });
      return b.reclassify([r.key], { accountId: acc(b, 'Owners Draw') }, 'owner money'); })
      .then(function () { var b = x.b, t = byQb(b, 'C-1'), e = OB.util.clone(t); e.date = '2025-03-03'; e.memo = 'Check 339 inventory'; e.number = '340'; e.contactId = b.contacts.find(function (c) { return c.name === 'PSEG'; }).id; return b.saveTransaction(e); })
      .then(function () { return x.b.voidTransaction(byQb(x.b, 'C-3').id, 'duplicate'); })
      .then(function () {
        var p = QU.plan(x.b, x.f);
        var d = p.updates.find(function (u) { return u.txnId === 'D-1'; }); eq(d.kind, 'deposit'); eq(d.lines[0].account, 'Owners Draw'); eq(d.lines[0].lineId, 'D-1-L1');
        var c = p.updates.find(function (u) { return u.txnId === 'C-1'; }); ok(c.header, 'header changes');
        eq(c.header.date, '2025-03-03'); eq(c.header.memo, 'Check 339 inventory'); eq(c.header.ref, '340'); eq(c.header.payee, 'PSEG');
        eq(p.voids.length, 1); eq(p.voids[0].txnId, 'C-3'); eq(p.voids[0].kind, 'check'); eq(p.voids[0].editSeq, '333');
        ok(!p.updates.some(function (u) { return u.txnId === 'C-3'; }), 'a voided entry is voided, not edited');
        var bt = QU.batch(x.b, p, '2026-11-18');
        eq(bt.format, 'vaultbook-qb-batch'); eq(bt.version, 3); eq(bt.updates.length, 2); eq(bt.voids.length, 1); eq(bt.snapshotAt, '2026-11-18T21:57:52.000Z');
        ok(!QU.toText(bt).match(/[^\x00-\x7e]/), 'plain ASCII for the Windows script');
      });
  });

  test('QU-05 amounts and lines added or removed: lines are replaced; QuickBooks entries VaultBook does not have are never touched', function () {
    var x;
    return imported().then(function (v) { x = v; var b = x.b, t = byQb(b, 'C-2'), e = OB.util.clone(t);
      e.lines = [{ accountId: acc(b, 'Electric'), amount: '90' }, { accountId: acc(b, 'Ask My Accountant'), amount: '20', description: 'late fee' }, { accountId: acc(b, 'Utilities'), amount: '10' }];
      return b.saveTransaction(e); })
      .then(function () {
        var f = x.f; f.txns.Check.push({ TxnID: 'C-9', EditSequence: '999', TxnDate: '2025-04-01', AccountRef: R('Main Bank'), Amount: '5.00', ExpenseLineRet: { TxnLineID: 'C-9-L1', AccountRef: R('Utilities'), Amount: '5.00' } });
        var p = QU.plan(x.b, f), u = p.updates[0];
        eq(p.updates.length, 1); eq(u.lines.length, 3); eq(u.lines[0].lineId, 'C-2-L1'); eq(u.lines[0].amount, '90.00'); eq(u.lines[2].lineId, '-1', 'a new line'); eq(u.lines[2].account, 'Utilities');
        eq(p.voids.length, 0, 'C-9 is in QuickBooks only: left alone'); eq(p.qbOnly, 1);
      });
  });

  test('QU-06 a transaction the export does not have, an item line or an unknown kind is listed, not guessed', function () {
    var x;
    return imported().then(function (v) { x = v; var f = x.f; f.txns.Check[3].ItemLineRet = { TxnLineID: 'I1', ItemRef: R('Gum'), Amount: '1.00' };
      f.txns.Check = f.txns.Check.filter(function (c) { return c.TxnID !== 'C-1'; });
      var b = x.b, t = byQb(b, 'C-4'), r = b.reclassRows({}).find(function (r) { return r.txnId === t.id && r.ref.part === 'line'; });
      return b.reclassify([r.key], { accountId: acc(b, 'Purchase') }, 'x').then(function () { return f; }); })
      .then(function (f) {
        var p = QU.plan(x.b, f);
        ok(p.skipped.some(function (s) { return /C-1/.test(s.label + s.why) && /not in this QuickBooks export/.test(s.why); }), JSON.stringify(p.skipped));
        ok(p.skipped.some(function (s) { return /item lines/.test(s.why); }), 'item lines are changed in QuickBooks itself');
        ok(!p.updates.some(function (u) { return u.txnId === 'C-4'; }));
      });
  });
})(typeof window !== 'undefined' ? window : global);
