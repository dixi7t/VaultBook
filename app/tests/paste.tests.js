/* VaultBook — paste entries from Excel into a ledger (1.48.0). Synthetic names only. Loaded by tests/run-node.js and tests/tests.html. */
(function (root) {
  'use strict';
  var OB = root.OB, P = OB.paste, T = OB.tests = OB.tests || [];
  function test(name, fn) { T.push({ name: name, fn: fn }); }
  function eq(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((msg || 'Expected equal') + ': expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }
  function ok(v, msg) { if (!v) throw new Error(msg || 'Expected true'); }
  function withBook(fn) { return function () { return OB.Book.create(new OB.MemoryAdapter(), { name: 'Paste Co' }).then(fn); }; }
  function acc(b, name) { return b.accounts.find(function (a) { return a.name === name; }); }
  // the user's layout: a QuickBooks report copied from Excel (tabs), with a heading row and total rows
  var QB = '\tType\tDate\tNum\tAdj\tName\tMemo\tClr\tSplit\tDebit\tCredit\tBalance\n' +
    'Rent Expense\t\t\t\t\t\t\t\t\t\t\n' +
    '\tCheck\t1/29/2024\t\t\tPine Street LLC\tMonthly rent "Unit 4"\t\tFirst Test Bank 7038\t1,500.00\t\t1,500.00\n' +
    'Total Rent Expense\t\t\t\t\t\t\t\t1500\t0\t1500\n' +
    'TOTAL\t\t\t\t\t\t\t\t1500\t0\t1500\n';

  test('PE-01 a pasted QuickBooks report keeps entries and drops headings, totals and balance', function () {
    var rows = P.fromText(QB);
    eq(rows.length, 1);
    eq([rows[0].type, rows[0].date, rows[0].name, rows[0].memo, rows[0].split, rows[0].debit, rows[0].credit], ['Check', '2024-01-29', 'Pine Street LLC', 'Monthly rent "Unit 4"', 'First Test Bank 7038', '1500.00', '']);
  });
  test('PE-02 headerless rows paste in grid order; quoted cells with tabs and new lines survive', function () {
    var rows = P.fromText('Deposit\t02/03/2024\t55\t\tAcme Co\t"two\nlines"\tC\tSales\t\t250\n');
    eq([rows[0].type, rows[0].num, rows[0].memo, rows[0].clr, rows[0].split, rows[0].credit], ['Deposit', '55', 'two\nlines', 'C', 'Sales', '250.00']);
  });
  test('PE-03 repeat monthly moves dates and keeps month ends', function () {
    var r = P.repeat([{ date: '2024-01-29', memo: 'Rent' }, { date: '2024-01-31', memo: 'Fee' }], 2);
    eq(r.map(function (x) { return x.date; }), ['2024-02-29', '2024-02-29', '2024-03-29', '2024-03-31']);
    eq(r[0].memo, 'Rent');
  });
  test('PE-04 plan: missing account with a type guess, new names, Check from the expense ledger', withBook(function (b) {
    var rent = acc(b, 'Rent or Lease') || acc(b, 'Rent Expense') || b.accounts.find(function (a) { return a.type === 'expense'; });
    var p = P.plan(b, rent.id, P.fromText(QB));
    eq(p.missing.map(function (m) { return [m.name, m.type]; }), [['First Test Bank 7038', 'bank']]);
    eq(p.newNames.map(function (n) { return [n.name, n.kind]; }), [['Pine Street LLC', 'vendor']]);
    eq(p.entries.length, 1); eq(p.entries[0].kind, 'check'); eq(p.errors, []);
  }));
  test('PE-05 post: creates the account and vendor, posts a check, marks it cleared, flags a repeat as duplicate', withBook(function (b) {
    var rent = b.accounts.find(function (a) { return a.type === 'expense'; }), rows = P.fromText(QB.replace('\t\tFirst Test Bank', '\tC\tFirst Test Bank'));
    return P.post(b, rent.id, rows, {}).then(function (res) {
      eq(res.saved.length, 1); var t = res.saved[0], bank = acc(b, 'First Test Bank 7038');
      ok(bank && bank.type === 'bank', 'bank account created');
      eq(t.type, 'check'); eq(t.accountId, bank.id); eq(t.date, '2024-01-29');
      eq(b.contactById[t.contactId].name, 'Pine Street LLC');
      eq(b.accountBalance(rent.id), 150000);
      eq(b.txById[t.id].splits.find(function (s) { return s.accountId === bank.id; }).cleared, 'C');
      var again = P.plan(b, rent.id, rows);
      eq(again.missing, []); eq(again.entries[0].duplicate, true);
    });
  }));
  test('PE-06 rows with the same date and number post as one split entry; a journal row needs no type', withBook(function (b) {
    var chk = acc(b, 'Checking'), exp = b.accounts.filter(function (a) { return a.type === 'expense'; });
    var rows = [
      { type: 'Check', date: '2024-03-01', num: '101', name: 'Office Mart', memo: 'paper', split: exp[0].name, debit: '', credit: '40' },
      { type: 'Check', date: '2024-03-01', num: '101', name: 'Office Mart', memo: 'toner', split: exp[1].name, debit: '', credit: '60' },
      { type: '', date: '2024-03-02', num: '', name: '', memo: 'reclass', split: exp[0].name, debit: '5', credit: '' }];
    var p = P.plan(b, chk.id, rows);
    eq(p.entries.map(function (e) { return [e.kind, e.rows]; }), [['check', [0, 1]], ['journal', [2]]]);
    return P.post(b, chk.id, rows, {}).then(function (res) {
      eq(res.saved.length, 2); eq(res.saved[0].lines.length, 2); eq(b.txnTotal(res.saved[0]), 10000);
      eq(b.accountBalance(chk.id), -10000 + 500);
    });
  }));
  test('PE-07 a missing account can point to an existing one; bad rows are listed and nothing posts', withBook(function (b) {
    var chk = acc(b, 'Checking'), exp = b.accounts.find(function (a) { return a.type === 'expense'; });
    var rows = [{ type: 'Check', date: '2024-04-01', name: '', memo: 'x', split: 'Old Expense Name', debit: '', credit: '12' }];
    var p = P.plan(b, chk.id, rows);
    eq(p.missing.length, 1);
    var bad = rows.concat([{ date: '', split: exp.name, debit: '1' }, { date: '2024-04-02', split: exp.name, debit: '1', credit: '1' }, { date: '2024-04-03', split: '-SPLIT-', debit: '9' }]);
    var pb = P.plan(b, chk.id, bad, { map: { 'old expense name': exp.id } });
    eq(pb.errors.map(function (e) { return e.row; }), [1, 2, 3]);
    return P.post(b, chk.id, bad, { map: { 'old expense name': exp.id } }).then(function () { throw new Error('should not post'); }, function (e) {
      ok(/row/i.test(e.message)); eq(b.transactions.length, 0);
      return P.post(b, chk.id, rows, { map: { 'old expense name': exp.id } });
    }).then(function (res) { eq(res.saved[0].lines[0].accountId, exp.id); ok(!acc(b, 'Old Expense Name')); });
  }));
  test('PE-08 Excel rows with a blank date under an entry are its split lines; Total rows still drop', function () {
    var rows = P.fromText('Type\tDate\tNum\tName\tMemo\tSplit\tDebit\tCredit\nCheck\t03/01/2024\t\tPine Street LLC\tMarch rent\tRent A\t\t2000\n\t\t\t\tStore B\tRent B\t\t2,000\n\t\t\t\t\tRent C\t\t6000\nTotal\t\t\t\t\t\t\t10000\n');
    eq(rows.length, 3);
    eq(rows.map(function (r) { return [r.date, r.type, r.name, r.memo, r.split, r.credit]; }), [['2024-03-01', 'Check', 'Pine Street LLC', 'March rent', 'Rent A', '2000.00'], ['2024-03-01', 'Check', 'Pine Street LLC', 'Store B', 'Rent B', '2000.00'], ['2024-03-01', 'Check', 'Pine Street LLC', 'March rent', 'Rent C', '6000.00']]);
    ok(rows[0].entry && rows[0].entry === rows[1].entry && rows[1].entry === rows[2].entry, 'one entry');
  });
  function three(b) { return Promise.all(['Rent A', 'Rent B', 'Rent C'].map(function (n) { return b.saveAccount({ name: n, type: 'expense' }); })); }
  test('PE-09 an Entry # column groups rows; repeated copies stay separate entries', withBook(function (b) {
    var chk = acc(b, 'Checking');
    return three(b).then(function () {
      var rows = P.fromText('Entry #\tType\tDate\tSplit\tCredit\n7\tCheck\t03/01/2024\tRent A\t2000\n7\tCheck\t03/01/2024\tRent B\t2000\n7\tCheck\t03/01/2024\tRent C\t6000\n');
      eq(rows[0].entry, '7');
      var p = P.plan(b, chk.id, rows.concat(P.repeat(rows, 1)));
      eq(p.entries.map(function (e) { return [e.kind, e.rows.length]; }), [['check', 3], ['check', 3]]);
      return P.post(b, chk.id, rows, {});
    }).then(function (res) { eq(res.saved.length, 1); eq(res.saved[0].lines.map(function (l) { return l.amount; }), [200000, 200000, 600000]); eq(b.accountBalance(chk.id), -1000000); });
  }));
  test('PE-10 one Split cell can list several accounts by amount, by percent, or with one taking the rest', withBook(function (b) {
    var chk = acc(b, 'Checking');
    return three(b).then(function () {
      var row = function (split, amt) { return { type: 'Check', date: '2024-03-01', split: split, credit: amt }; };
      var lines = function (split, amt) { var p = P.plan(b, chk.id, [row(split, amt)]); return p.errors.length ? p.errors[0].message : p.entries[0].draft.lines.map(function (l) { return l.amount; }); };
      eq(lines('Rent A 2000; Rent B 2,000; Rent C 6000', '10000'), [200000, 200000, 600000]);
      eq(lines('Rent A 20%; Rent B 20%; Rent C 60%', '10000.01'), [200000, 200000, 600001]);
      eq(lines('Rent A 2000; Rent B 2000; Rent C', '10000'), [200000, 200000, 600000]);
      ok(/add up to 9,000.00/.test(lines('Rent A 2000; Rent B 2000; Rent C 5000', '10000')), 'mismatch reported');
      var p = P.plan(b, chk.id, [row('Rent A 50%; New Place 50%', '100')]);
      eq(p.missing.map(function (m) { return m.name; }), ['New Place']);
      return P.post(b, chk.id, [row('Rent A 2000; Rent B 2000; Rent C 6000', '10000')], {});
    }).then(function (res) { eq(res.saved.length, 1); eq(res.saved[0].lines.length, 3); eq(b.txnTotal(res.saved[0]), 1000000); });
  }));
})(typeof window !== 'undefined' ? window : global);
