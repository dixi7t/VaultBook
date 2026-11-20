/* VaultBook — TallyPrime-style keyboard work (1.22): typed date shorthand, Sales/Purchase/Bank registers.
   Loaded after bankfeed.tests.js by tests/run-node.js and tests/tests.html; shares OB.tests. */
(function (root) {
  'use strict';
  var OB = root.OB, U = OB.util;
  var T = OB.tests;
  function test(name, fn) { T.push({ name: name, fn: fn }); }
  function eq(a, b, msg) { if (a !== b) throw new Error((msg || 'Expected equal') + ': expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }
  function rejects(p, re, msg) {
    return p.then(function () { throw new Error((msg || 'Expected rejection') + ' but it succeeded'); }, function (e) {
      if (re && !re.test(e.message)) throw new Error((msg || 'Wrong error') + ': ' + e.message);
    });
  }
  function acc(b, name) { var a = b.accounts.find(function (x) { return x.name === name; }); if (!a) throw new Error('No account ' + name); return a.id; }

  test('TP-01 typed date shorthand: month names, digits, separators, day only, today', function () {
    var ref = '2026-11-06', D = function (s) { return U.smartDate(s, ref); };
    [['june20', '2026-06-20'], ['June 20', '2026-06-20'], ['20june', '2026-06-20'], ['20 Jun', '2026-06-20'], ['jun 20 2025', '2025-06-20'],
      ['Jun 20, 25', '2025-06-20'], ['sept 5', '2026-09-05'], ['Sep5', '2026-09-05'], ['0620', '2026-06-20'], ['620', '2026-06-20'],
      ['06-20', '2026-06-20'], ['6.20', '2026-06-20'], ['6/20', '2026-06-20'], ['06/20/26', '2026-06-20'], ['6-20-2025', '2025-06-20'],
      ['062026', '2026-06-20'], ['06202025', '2025-06-20'], ['2026-06-20', '2026-06-20'], ['20250620', '2025-06-20'], ['5', '2026-11-05'],
      ['t', ref], ['today', ref], ['+3', '2026-11-09'], ['-6', '2026-10-31'], ['1231', '2026-12-31']].forEach(function (c) { eq(D(c[0]), c[1], c[0]); });
    ['', 'junk', '1340', '2/30', 'juné', '13/1', 'jux 5', '123456789'].forEach(function (s) { eq(D(s), null, s); });
  });

  function book() {
    var b, ids = {};
    return OB.Book.create(new OB.MemoryAdapter(), { name: 'Reg Co' }).then(function (bk) { b = bk; return Promise.all([b.saveContact({ kind: 'customer', name: 'Acme' }), b.saveContact({ kind: 'vendor', name: 'Paper Co' })]); }).then(function (c) {
      ids.c = c[0].id; ids.v = c[1].id;
      var A = function (n) { return acc(b, n); };
      return b.saveTransactions([
        { type: 'invoice', date: '2026-01-10', contactId: ids.c, number: '1001', lines: [{ accountId: A('Services'), amount: '1000' }] },
        { type: 'invoice', date: '2026-02-03', contactId: ids.c, number: '1002', memo: 'Retainer', lines: [{ accountId: A('Services'), amount: '500' }] },
        { type: 'creditMemo', date: '2026-02-20', contactId: ids.c, number: 'CM-1', lines: [{ accountId: A('Services'), amount: '100' }] },
        { type: 'salesReceipt', date: '2026-03-01', contactId: ids.c, accountId: A('Checking'), number: 'SR-1', lines: [{ accountId: A('Services'), amount: '250' }] },
        { type: 'bill', date: '2026-01-15', contactId: ids.v, number: 'B-7', lines: [{ accountId: A('Office Supplies & Software'), amount: '80' }] },
        { type: 'expense', date: '2026-02-11', accountId: A('Checking'), contactId: ids.v, lines: [{ accountId: A('Office Supplies & Software'), amount: '40' }] },
        { type: 'deposit', date: '2026-01-02', accountId: A('Checking'), lines: [{ accountId: A('Opening Balance Equity'), amount: '5000' }] }
      ]).then(function () { return { b: b, ids: ids, A: A }; });
    });
  }

  test('TP-02 Sales register: month-wise debit/credit/closing and the vouchers behind them', function () {
    return book().then(function (x) {
      var r = OB.registers.build(x.b, { kind: 'sales', from: '2026-01-01', to: '2026-03-31' });
      eq(r.months.length, 3); eq(r.vouchers.length, 4);
      eq(r.months[0].credit, 100000); eq(r.months[1].credit, 50000); eq(r.months[1].debit, 10000, 'credit memo is a debit');
      eq(r.months[2].credit, 25000); eq(r.closing, -(100000 + 50000 - 10000 + 25000), 'closing is a credit balance');
      eq(r.months[2].closing, r.closing);
      eq(OB.registers.drcr(r.closing), '1,650.00 Cr');
      eq(OB.registers.build(x.b, { kind: 'sales', memo: 'retain' }).vouchers.length, 1, 'narration filter');
      eq(OB.registers.build(x.b, { kind: 'sales', min: 30000 }).vouchers.length, 2, 'amount from');
      eq(OB.registers.build(x.b, { kind: 'sales', types: ['creditMemo'] }).vouchers.length, 1, 'voucher type');
      eq(OB.registers.build(x.b, { kind: 'sales', status: 'open' }).vouchers.map(function (v) { return v.number; }).join(), '1001,1002,CM-1', 'open (unpaid) only');
      eq(OB.registers.build(x.b, { kind: 'sales', number: '100' }).vouchers.length, 2, 'voucher number');
      eq(r.vouchers[0].lines[0].account.indexOf('Services') >= 0, true, 'detailed lines name the income account');
    });
  });

  test('TP-03 Purchase register and Bank book: debits, credits, opening and running balance', function () {
    return book().then(function (x) {
      var p = OB.registers.build(x.b, { kind: 'purchase', from: '2026-01-01', to: '2026-12-31' });
      eq(p.debit, 12000); eq(p.vouchers.length, 2); eq(p.months.length, 12);
      eq(OB.registers.build(x.b, { kind: 'purchase', contactId: x.ids.v, types: ['bill'] }).vouchers.length, 1);
      var bk = OB.registers.build(x.b, { kind: 'bank', accountId: x.A('Checking'), from: '2026-02-01', to: '2026-03-31' });
      eq(bk.opening, 500000, 'opening balance from January deposit');
      eq(bk.vouchers.length, 2); eq(bk.credit, 4000); eq(bk.debit, 25000); eq(bk.closing, 500000 - 4000 + 25000);
      eq(bk.vouchers[1].balance, bk.closing);
      eq(OB.registers.build(x.b, { kind: 'bank', accountId: x.A('Checking'), dir: 'out' }).vouchers.length, 1, 'money out only');
    });
  });

  /* ---------- Reclassify transactions (accountant tool) ---------- */
  function rbook() {
    var b;
    return OB.Book.create(new OB.MemoryAdapter(), { name: 'Reclass Co' }).then(function (bk) { b = bk; return Promise.all([b.saveContact({ kind: 'vendor', name: 'Crown of India' }), b.saveContact({ kind: 'customer', name: 'Acme' }), b.saveClass({ name: 'North' }), b.saveClass({ name: 'South' })]); })
      .then(function (r) {
        var A = function (n) { return acc(b, n); }, v = r[0].id, c = r[1].id;
        return Promise.resolve().then(function () { return b.saveTransactions([
          { type: 'check', date: '2026-03-03', accountId: A('Checking'), contactId: v, number: '1707', lines: [{ accountId: A('Meals'), amount: '1385' }] },
          { type: 'check', date: '2026-03-04', accountId: A('Checking'), contactId: v, number: '1711', lines: [{ accountId: A('Meals'), amount: '100' }, { accountId: A('Rent & Lease'), amount: '25' }] },
          { type: 'bill', date: '2026-03-05', contactId: v, number: 'B1', lines: [{ accountId: A('Meals'), amount: '60' }] },
          { type: 'journal', date: '2026-03-06', jlines: [{ accountId: A('Meals'), debit: '10' }, { accountId: A('Checking'), credit: '10' }] },
          { type: 'invoice', date: '2026-03-07', contactId: c, lines: [{ accountId: A('Services'), amount: '500' }] }
        ]); }).then(function (tx) { return { b: b, A: A, tx: tx, v: v, north: r[2].id, south: r[3].id }; });
      });
  }
  test('TP-04 Reclassify: lines on an account, moved to another account in one atomic change, and undone', function () {
    return rbook().then(function (x) {
      var b = x.b, A = x.A;
      var rows = b.reclassRows({ accountId: A('Meals'), from: '2026-03-01', to: '2026-03-31' });
      eq(rows.length, 4, 'two checks, a bill line and a journal line');
      var bal0 = b.accountBalance(A('Meals')), rent0 = b.accountBalance(A('Rent & Lease'));
      var keys = rows.filter(function (r) { return r.type !== 'journal'; }).map(function (r) { return r.key; });
      var pv = b.reclassPreview(keys, { accountId: A('Rent & Lease') });
      eq(pv.txns, 3); eq(pv.moves.length, 1); eq(pv.moves[0].amount, 138500 + 10000 + 6000);
      return b.reclassify(keys, { accountId: A('Rent & Lease') }, 'Rent was coded to meals').then(function (res) {
        eq(res.lines, 3); eq(res.txns, 3);
        eq(b.accountBalance(A('Meals')), bal0 - 154500); eq(b.accountBalance(A('Rent & Lease')), rent0 + 154500);
        var t2 = b.txById[x.tx[1].id]; eq(t2.lines[1].accountId, A('Rent & Lease')); eq(t2.number, '1711', 'number kept'); eq(t2.contactId, x.v, 'payee kept');
        eq(b.txById[x.tx[2].id].contactId, x.v, 'bill still owed to the vendor'); eq(b.openBalance(b.txById[x.tx[2].id]), 6000);
        eq(b.checkIntegrity().issues.length, 0, 'integrity');
        eq(b.reclassBatches()[0].note, 'Rent was coded to meals');
        return b.undoReclass(res.batchId);
      }).then(function () {
        eq(b.accountBalance(A('Meals')), bal0, 'undo restores'); eq(b.accountBalance(A('Rent & Lease')), rent0);
        return rejects(b.undoReclass(b.reclassBatches()[0].id), /already undone/);
      });
    });
  });
  test('TP-05 Reclassify: bank account of checks, classes, and the lines that must not move', function () {
    return rbook().then(function (x) {
      var b = x.b, A = x.A;
      var heads = b.reclassRows({ accountId: A('Checking'), show: 'head' });
      eq(heads.length, 2, 'checks written from the account (journal line is not a header)');
      return b.reclassify(heads.map(function (r) { return r.key; }), { accountId: A('Savings') }).then(function () {
        eq(b.txById[x.tx[0].id].accountId, A('Savings'), 'check now from Savings');
        eq(b.accountBalance(A('Savings')), -(138500 + 12500));
        var ar = b.reclassRows({ accountId: b.sys('AR').id });
        eq(ar.length, 1); eq(ar[0].canAccount, false, 'A/R lines cannot be moved');
        return rejects(b.reclassify([ar[0].key], { accountId: A('Services') }), /cannot be changed|follow their customer/);
      }).then(function () {
        var inv = b.reclassRows({ accountId: A('Services') });
        return rejects(b.reclassify([inv[0].key], { accountId: b.sys('AP').id }), /Receivable or Payable/);
      }).then(function () {
        var tr = b.reclassRows({ accountId: A('Savings'), show: 'head' });
        return rejects(b.reclassify([tr[0].key], { accountId: A('Meals') }), /must come from/, 'a check must come from a bank');
      }).then(function () {
        var meals = b.reclassRows({ accountId: A('Meals') }).map(function (r) { return r.key; });
        return b.reclassify(meals, { classId: x.north });
      }).then(function (res) {
        eq(res.lines, 4);
        b.reclassRows({ accountId: A('Meals') }).forEach(function (r) { eq(r.classId, x.north, 'class on ' + r.type); });
        var t2 = b.txById[x.tx[1].id]; eq(t2.splits.find(function (s) { return s.accountId === A('Rent & Lease'); }).classId, undefined, 'other lines keep their class');
        // header class: the check's bank line; lines without their own class keep the old default
        var head = b.reclassRows({ accountId: A('Savings'), show: 'head' }).find(function (r) { return r.number === '1711'; });
        return b.reclassify([head.key], { classId: x.south }).then(function () {
          var t = b.txById[x.tx[1].id];
          eq(t.classId, x.south); eq(t.lines[0].classId, x.north, 'line keeps its own class'); eq(t.lines[1].classId, undefined, 'unclassed line stays unclassed');
          eq(b.checkIntegrity().issues.length, 0);
        });
      }).then(function () {
        return b.saveCompany({ closingDate: '2026-03-31' }).then(function () {
          var r = b.reclassRows({ accountId: A('Meals') });
          eq(r.every(function (y) { return !y.canAccount && /closed period/.test(y.why); }), true, 'closed period blocks');
          return rejects(b.reclassify([r[0].key], { accountId: A('Rent & Lease') }), /closed period/);
        });
      });
    });
  });
})(typeof window !== 'undefined' ? window : globalThis);
