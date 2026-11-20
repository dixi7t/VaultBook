/* VaultBook — bank and card files of every common layout (1.47.1): Debit/Credit type columns, title rows above the
   header, Excel workbooks with summary sheets. Money in is positive. Loaded by tests/run-node.js and tests/tests.html. */
(function (root) {
  'use strict';
  var OB = root.OB, I = OB.importer, T = OB.tests = OB.tests || [];
  function test(name, fn) { T.push({ name: name, fn: fn }); }
  function eq(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((msg || 'Expected equal') + ': expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }
  var WANT = [10000, -4510, 250050, -99];
  function amounts(table) {
    var t = table.slice(I.findHeader(table)), m = I.detectColumns(t[0], t.slice(1)); m.hasHeader = true;
    return I.parseBankRows(t, m).rows.map(function (r) { return r.amount; });
  }

  test('XS-01 unsigned amount with a Dr/Cr column', function () {
    eq(amounts([['Date', 'Particulars', 'Amount', 'Dr/Cr'], ['03/02/2026', 'ACME', '100.00', 'CR'], ['03/05/2026', 'STAPLES', '45.10', 'DR'], ['03/13/2026', 'WIRE IN', '2,500.50', 'Cr'], ['03/17/2026', 'FEE', '0.99', 'Dr']]), WANT);
  });
  test('XS-02 unsigned amount with a Transaction Type column in words', function () {
    eq(amounts([['Date', 'Description', 'Transaction Type', 'Amount'], ['03/02/2026', 'ACME', 'Deposit', '100'], ['03/05/2026', 'STAPLES', 'Withdrawal', '45.10'], ['03/13/2026', 'WIRE IN', 'Credit', '2500.50'], ['03/17/2026', 'FEE', 'Debit', '0.99']]), WANT);
  });
  test('XS-03 a signed amount wins over the type column (refunds on a debit card keep their sign)', function () {
    eq(amounts([['Details', 'Posting Date', 'Description', 'Amount', 'Type'], ['CREDIT', '03/02/2026', 'ACME', '100', 'ACH_CREDIT'], ['DEBIT', '03/05/2026', 'STAPLES', '-45.10', 'DEBIT_CARD'], ['CREDIT', '03/13/2026', 'REFUND', '2500.50', 'DEBIT_CARD'], ['DEBIT', '03/17/2026', 'FEE', '-0.99', 'FEE_TRANSACTION']]), WANT);
  });
  test('XS-04 title rows above the header are skipped', function () {
    var t = [['First Community Bank'], ['Account 1234567'], [], ['Posting Date', 'Description', 'Amount', 'Balance'], ['2026-03-02', 'ACME', 100, ''], ['2026-03-05', 'STAPLES', -45.1, ''], ['2026-03-13', 'WIRE', 2500.5, ''], ['2026-03-17', 'FEE', -0.99, '']];
    eq(I.findHeader(t), 3); eq(amounts(t), WANT);
  });
  test('XS-05 separate money out / money in columns, with or without minus signs', function () {
    eq(amounts([['Date', 'Description', 'Withdrawals', 'Deposits'], ['03/02/2026', 'ACME', '', '100'], ['03/05/2026', 'STAPLES', '-45.10', ''], ['03/13/2026', 'WIRE', '', '2500.50'], ['03/17/2026', 'FEE', '0.99', '']]), WANT);
  });
  test('XS-06 the workbook sheet with the most transactions is chosen; summary sheets are skipped', function () {
    var tx = [['Date', 'Description', 'Type', 'Amount']].concat([['03/02/2026', 'ACME', 'Credit', 100], ['03/05/2026', 'STAPLES', 'Debit', -45.1], ['03/13/2026', 'WIRE', 'Credit', 2500.5], ['03/17/2026', 'FEE', 'Debit', -0.99]]);
    var sheets = [{ name: 'Reconciliation Summary', rows: [['Source File', 'Beginning Balance', 'Ending Balance', 'Stated Total Credits'], ['a.pdf', 1, 2, 3]] },
      { name: 'Statement 1', rows: tx.slice(0, 3) }, { name: 'All Transactions', rows: tx }, { name: 'By Vendor', rows: [['Vendor', 'Count', 'Total'], ['ACME', 1, 100]] }];
    var list = I.pickSheets(sheets);
    eq(list.map(function (s) { return s.name; }), ['All Transactions', 'Statement 1']);
    eq(amounts(list[0].table), WANT);
  });
  test('XS-07 a file with no transaction table picks nothing', function () {
    eq(I.pickSheets([{ name: 'Notes', rows: [['Hello'], ['World']] }]), []);
    eq(I.findHeader([['a', 'b'], ['1', '2']]), 0);
  });
})(typeof window !== 'undefined' ? window : global);
