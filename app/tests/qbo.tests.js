/* VaultBook — QuickBooks Online report import (1.24): Journal, General Ledger, Trial Balance, Balance Sheet,
   Profit and Loss and the contact lists, as QuickBooks Online exports them to Excel or CSV.
   Synthetic data only. Loaded after bankplus.tests.js by tests/run-node.js and tests/tests.html; shares OB.tests. */
(function (root) {
  'use strict';
  var OB = root.OB, U = OB.util, Q = OB.qbimport;
  var T = OB.tests;
  function test(name, fn) { T.push({ name: name, fn: fn }); }
  function eq(a, b, msg) { if (a !== b) throw new Error((msg || 'Expected equal') + ': expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }
  function ok(c, msg) { if (!c) throw new Error(msg || 'Expected true'); }

  var CO = 'Maple Dental, P.C.', FOOT = 'Monday, Nov 09, 2026 10:31:47 AM GMT-8 - Accrual Basis';
  function top(title, period) { return [[CO], [title], [period || 'All Dates'], []]; }
  // [date, type, num, name, [[memo, account, debit, credit], ...], totalsRow?]
  var TX = [
    ['01/02/2025', 'Deposit', '', '', [['Deposit', 'Checking', 1000, ''], ['Deposit', 'Sales', '', 1000]], true],
    ['01/03/2025', 'Expense', '', 'Staples', [['STAPLES 0010', 'Checking', '', 50], ['STAPLES 0010', 'Office Supplies & Software', 50, '']], false],
    ['01/05/2025', 'Check', 101, 'Oak Realty', [['January rent', 'Checking', '', 800], ['January rent', 'Rent & Lease', 800, '']], true],
    ['01/31/2025', 'Journal Entry', 'JE-1', '', [['Depreciation', 'Depreciation Expense', 100, ''], ['Depreciation', 'z-Accumulated Depreciation', '', 100]], true],
    ['02/01/2025', 'Expense', '', '', [['PARKING AUTH', 'Checking', '', 30], ['PARKING AUTH', 'Auto Expense:Parking & Tolls', 30, '']], false],
    ['02/02/2025', 'Journal Entry', 'JE-2', '', [['Chair bought on loan', 'Dental Equipment', 5000, ''], ['Chair bought on loan', 'Bank Loan', '', 5000]], true],
    ['02/03/2025', 'Transfer', '', '', [['To savings', 'Checking', '', 200], ['To savings', 'Savings (9576)', 200, '']], true],
    ['02/05/2025', 'Check', 101, 'Oak Realty', [['February rent', 'Checking', '', 800], ['February rent', 'Rent & Lease', 800, '']], true],
    ['02/06/2025', 'Expense', '', 'Staples', [['Paper and a refund', 'Checking', '', 40], ['Paper', 'Office Supplies & Software', 45.5, ''], ['Refund', 'Auto Expense', '', 5.5]], true]
  ];
  function journal(txs) {
    var rows = top('Journal').concat([['', 'Date', 'Transaction Type', 'Num', 'Name', 'Memo/Description', 'Account', 'Debit', 'Credit']]), td = 0;
    (txs || TX).forEach(function (t) {
      var d = 0;
      t[4].forEach(function (l, i) { rows.push(['', i ? '' : t[0], i ? '' : t[1], i ? '' : t[2], i ? '' : t[3], l[0], l[1], l[2], l[3]]); d += +l[2] || 0; });
      if (t[5]) { rows.push(['', '', '', '', '', '', '', d, d]); rows.push([]); }
      td += d;
    });
    return rows.concat([['TOTAL', '', '', '', '', '', '', td, td], [], [FOOT]]);
  }
  // General Ledger: one section per account, sub-accounts indented under their parent
  function ledger() {
    var by = {}, order = [];
    TX.forEach(function (t) { t[4].forEach(function (l) { if (!by[l[1]]) { by[l[1]] = []; order.push(l[1]); } by[l[1]].push(['', t[0], t[1], t[2], t[3], l[0], l[1], l[2], l[3], '']); }); });
    var rows = top('General Ledger').concat([['', 'Date', 'Transaction Type', 'Num', 'Name', 'Memo/Description', 'Account', 'Debit', 'Credit', 'Balance']]);
    order.filter(function (a) { return a.indexOf(':') < 0; }).forEach(function (a) {
      rows.push([a]); by[a].forEach(function (r) { rows.push(r); });
      var kids = order.filter(function (k) { return k.indexOf(a + ':') === 0; });
      if (kids.length) rows.push(['   Total for ' + a, '', '', '', '', '', '', 1, 1]);     // the parent's own subtotal, as QuickBooks Online prints it
      kids.forEach(function (k) { rows.push(['   ' + k.split(':')[1]]); by[k].forEach(function (r) { rows.push(r); }); rows.push(['   Total for ' + k.split(':')[1], '', '', '', '', '', '', 1, '   ']); });
      rows.push([kids.length ? 'Total for ' + a + ' with sub-accounts' : 'Total for ' + a, '', '', '', '', '', '', 1, 1]);
    });
    return rows.concat([[], [FOOT]]);
  }
  function balanceSheet(period) {
    return top('Balance Sheet', period).concat([['', 'Total'], ['ASSETS'], ['   Current Assets'], ['      Bank Accounts'], ['         Checking', '-920.00'], ['         Savings (9576)', 200], ['      Total Bank Accounts', -720],
      ['   Total Current Assets', -720], ['   Fixed Assets'], ['      Dental Equipment', 5000], ['      z-Accumulated Depreciation', -100], ['   Total Fixed Assets', 4900], ['TOTAL ASSETS', 4180],
      ['LIABILITIES AND EQUITY'], ['   Liabilities'], ['      Long-Term Liabilities'], ['         Bank Loan', 5000], ['      Total Long-Term Liabilities', 5000], ['   Total Liabilities', 5000],
      ['   Equity'], ['      Opening Balance Equity', 0], ['      Retained Earnings', 0], ['      Net Income', -820], ['   Total Equity', -820], ['TOTAL LIABILITIES AND EQUITY', 4180], [], [FOOT]]);
  }
  function pnl(period) {
    return top('Profit and Loss', period).concat([['', 'Total'], ['Income'], ['   Sales', 1000], ['Total Income', 1000], ['Gross Profit', 1000], ['Expenses'], ['   Auto Expense', -5.5], ['      Parking & Tolls', 30], ['   Total Auto Expense', 24.5],
      ['   Office Supplies & Software', 95.5], ['   Rent & Lease', 1600], ['Total Expenses', 1720], ['Net Operating Income', -720], ['Other Expenses'], ['   Depreciation Expense', 100], ['Total Other Expenses', 100], ['Net Other Income', -100], ['Net Income', -820], [], [FOOT]]);
  }
  function trial(period) {
    return top('Trial Balance', period).concat([['', 'Debit', 'Credit'], ['Checking', '', 920], ['Savings (9576)', 200, ''], ['Dental Equipment', 5000, ''], ['z-Accumulated Depreciation', '', 100], ['Bank Loan', '', 5000], ['Opening Balance Equity', '', 0], ['Retained Earnings', '', 0],
      ['Sales', '', 1000], ['Auto Expense', '', 5.5], ['Auto Expense:Parking & Tolls', 30, ''], ['Office Supplies & Software', 95.5, ''], ['Rent & Lease', 1600, ''], ['Depreciation Expense', 100, ''], ['TOTAL', 7025.5, 7025.5], [], [FOOT]]);
  }
  function vendors() { return top('Vendor Contact List', '').concat([['', 'Vendor', 'Phone Numbers', 'Email', 'Full Name', 'Address', 'Account #'], ['', 'Staples', 'Phone: (610) 555-0100', 'orders@staples.example', 'Pat Lee', '1 Main St\nAllentown PA 18101', 'A-77'], ['', 'Oak Realty', '', '', '', '', ''], [], [FOOT]]); }
  function customers() { return top('Customer Contact List', '').concat([['', 'Customer', 'Phone Numbers', 'Email', 'Full Name', 'Billing Address', 'Shipping Address'], [], ['This report contains no data'], [], [FOOT]]); }
  function employees() { return top('Employee Contact List', '').concat([['', 'Employee', 'Phone Numbers', 'Email', 'Address'], ['', 'Dr. Ana Ruiz', '', '', ''], [], [FOOT]]); }
  function fileSet(skip) {
    var all = { 'Journal.xlsx': journal(), 'General_ledger.xlsx': ledger(), 'Balance_sheet.xlsx': balanceSheet(), 'Profit_and_loss.xlsx': pnl(), 'Trial_balance.xlsx': trial(), 'Vendors.xlsx': vendors(), 'Customers.xlsx': customers(), 'Employees.xlsx': employees() };
    return Object.keys(all).filter(function (n) { return (skip || []).indexOf(n) < 0; }).map(function (n) { return { name: n, rows: all[n] }; });
  }
  function newBook() { return OB.Book.create(new OB.MemoryAdapter(), { name: 'Import target' }); }
  function imported(files) {
    return newBook().then(function (b) {
      var model = Q.read(files), plan = Q.plan(model, b);
      if (plan.errors.length) throw new Error(plan.errors.join(' | '));
      return b.importBundle(plan.bundle).then(function () { return { b: b, plan: plan, model: model }; });
    });
  }
  function acct(b, name) { var a = b.accounts.find(function (x) { return x.name === name; }); if (!a) throw new Error('No account ' + name); return a; }
  function count(b, type) { return b.transactions.filter(function (t) { return t.type === type && t.status === 'posted'; }).length; }

  test('QO-01 QuickBooks Online reports are recognised by their title, in Excel rows or CSV text', function () {
    var kinds = {}; fileSet().forEach(function (f) { var d = Q.detect(f.name, '', false, f.rows); eq(d.kind, 'qbo', f.name); kinds[f.name] = d; });
    eq(kinds['Journal.xlsx'].report, 'journal'); eq(kinds['General_ledger.xlsx'].report, 'gl'); eq(kinds['Trial_balance.xlsx'].report, 'tb'); eq(kinds['Balance_sheet.xlsx'].report, 'bs');
    eq(kinds['Profit_and_loss.xlsx'].report, 'pnl'); eq(kinds['Vendors.xlsx'].report, 'vendors'); eq(kinds['Customers.xlsx'].report, 'customers'); eq(kinds['Employees.xlsx'].report, 'employees');
    eq(kinds['Journal.xlsx'].company, CO); eq(kinds['Trial_balance.xlsx'].period, 'All Dates');
    ok(/empty/i.test(kinds['Customers.xlsx'].label), kinds['Customers.xlsx'].label); ok(/2\b/.test(kinds['Vendors.xlsx'].label), kinds['Vendors.xlsx'].label);
    // the same Journal saved as CSV
    var csv = journal().map(function (r) { return r.map(function (c) { return /[",\n]/.test(String(c)) ? '"' + String(c).replace(/"/g, '""') + '"' : c; }).join(','); }).join('\r\n');
    var d = Q.detect('Journal.csv', csv); eq(d.kind, 'qbo'); eq(d.report, 'journal');
    eq(Q.detect('notes.xlsx', '', false, [['Hello'], ['World', 1]]).kind, 'unknown');
    var m = Q.read(fileSet()); eq(m.company.name, CO); eq(m.company.basis, 'accrual'); eq(m.qbo, true);
  });

  test('QO-00 a worksheet becomes rows: constant formulas are read as their number, dates as dates, gaps as blanks', function () {
    var ssf = { is_date: function (z) { return /[ymd]/i.test(z); }, format: function (f, v) { return v === 45000 ? '2023-03-15' : String(v); } };
    var ws = { '!ref': 'A1:C4', A1: { t: 's', v: 'Trial Balance' }, A3: { t: 's', v: '   Checking' }, B3: { t: 'n', v: 0, f: '39750.34', z: '#,##0.00' }, C3: { t: 'n', v: 0, f: '-10.00' },
      B4: { t: 'n', v: 0, f: '(B3)+(C3)' }, A4: { t: 'n', v: 45000, z: 'm/d/yyyy' }, C4: { t: 'n', v: 12.5 }, AA2: { t: 's', v: 'far' }, C1: { t: 'e', v: 7 } };
    var rows = Q.sheetRows(ws, ssf);
    eq(rows.length, 4); eq(rows[0][0], 'Trial Balance'); eq(rows[0].length, 1, 'error cells are blank'); eq(rows[2][0], '   Checking', 'indentation kept'); eq(rows[2][1], 39750.34); eq(rows[2][2], -10);
    eq(rows[3][1], 0, 'a real formula keeps its stored value'); eq(rows[3][0], '2023-03-15'); eq(rows[3][2], 12.5); eq(rows[1][26], 'far'); eq(rows[1][0], '');
    eq(Q.sheetRows({ A1: { t: 'n', v: 0, f: '=5.25' } })[0][0], 5.25);
  });

  test('QO-02 the Journal gives exact transactions; account types and sub-accounts come from the Balance Sheet and Profit and Loss', function () {
    var m = Q.read(fileSet());
    eq(m.errors.length, 0, m.errors.join(' ')); eq(m.txns.length, 9);
    ok(m.txns.every(function (t) { return U.sum(t.rows, function (r) { return r.amount; }) === 0; }), 'every transaction balances');
    eq(m.txns[2].num, '101', 'a number Excel stored as 101.0 reads as 101'); eq(m.txns[2].name, 'Oak Realty'); eq(m.txns[2].date, '2025-01-05'); eq(m.txns[8].rows.length, 3);
    eq(m.txns[3].qbType, 'General Journal'); eq(m.txns[1].memo, 'STAPLES 0010');
    var by = {}; m.accounts.forEach(function (a) { by[a.NAME] = a; });
    eq(by.Checking.ACCNTTYPE, 'BANK'); eq(by['Savings (9576)'].ACCNTTYPE, 'BANK'); eq(by['Dental Equipment'].ACCNTTYPE, 'FIXASSET'); eq(by['z-Accumulated Depreciation'].ACCNTTYPE, 'FIXASSET');
    eq(by['Bank Loan'].ACCNTTYPE, 'LTLIAB'); eq(by['Retained Earnings'].EXTRA, 'RETEARNINGS'); eq(by['Opening Balance Equity'].EXTRA, 'OPENBAL');
    eq(by.Sales.ACCNTTYPE, 'INC'); eq(by['Auto Expense:Parking & Tolls'].ACCNTTYPE, 'EXP'); eq(by['Depreciation Expense'].ACCNTTYPE, 'EXEXP');
    ok(!by['Net Income'] && !by['Gross Profit'] && !by['Total Income'] && !by['Current Assets'], 'totals and headings are not accounts');
    eq(by.Checking.QBOBAL, -92000, 'Trial Balance: debit minus credit'); eq(by['Bank Loan'].QBOBAL, -500000); eq(by['Auto Expense'].QBOBAL, -550);
    ok(/not needed/i.test(m.files.find(function (f) { return f.name === 'General_ledger.xlsx'; }).label), 'the ledger is not needed beside a Journal');
  });

  test('QO-03 a whole QuickBooks Online company imports and every balance equals the Trial Balance', function () {
    return imported(fileSet()).then(function (x) {
      var b = x.b, cmp = Q.compareBalances(b, x.plan.expected);
      ok(cmp.ok, 'balances: ' + JSON.stringify(cmp.rows.filter(function (r) { return !r.ok; }))); eq(cmp.rows.length, 13);
      eq(b.checkIntegrity().issues.length, 0); eq(x.plan.preview.openingDiffs.length, 0, 'nothing left for an opening entry');
      eq(count(b, 'deposit'), 1); eq(count(b, 'expense'), 3); eq(count(b, 'check'), 2); eq(count(b, 'journal'), 2); eq(count(b, 'transfer'), 1);
      eq(b.rawBalance(acct(b, 'Checking').id), -92000); eq(b.rawBalance(acct(b, 'Parking & Tolls').id), 3000);
      eq(acct(b, 'Parking & Tolls').parentId, acct(b, 'Auto Expense').id); eq(acct(b, 'Bank Loan').type, 'ltl'); eq(acct(b, 'z-Accumulated Depreciation').type, 'fixed');
      var st = b.contacts.find(function (c) { return c.name === 'Staples'; }); eq(st.kind, 'vendor'); eq(st.email, 'orders@staples.example'); eq(st.phone, '(610) 555-0100'); eq(st.contactName, 'Pat Lee'); ok(/Allentown/.test(st.address));
      var emp = b.contacts.find(function (c) { return c.name === 'Dr. Ana Ruiz'; }); ok(emp && /employee/i.test(emp.notes), 'the employee is kept as a payee with a note');
      var checks = b.transactions.filter(function (t) { return t.type === 'check'; }).map(function (t) { return t.number; }).sort(); eq(checks.join(','), '101,101-2', 'a repeated check number is kept unique');
      eq(b.transactions.find(function (t) { return t.type === 'check'; }).contactId, b.contacts.find(function (c) { return c.name === 'Oak Realty'; }).id);
      ok(/QuickBooks Online/.test(b.company.imports[0].from), b.company.imports[0].from);
      ok(x.plan.warnings.some(function (w) { return /101/.test(w); }));
    });
  });

  test('QO-04 with no Journal the General Ledger is rebuilt into balanced transactions (sub-accounts found by their headings)', function () {
    var m = Q.read(fileSet(['Journal.xlsx']));
    eq(m.errors.length, 0, m.errors.join(' '));
    ok(m.txns.length >= 8 && m.txns.every(function (t) { return U.sum(t.rows, function (r) { return r.amount; }) === 0; }), 'balanced: ' + m.txns.length);
    ok(m.warnings.some(function (w) { return /Journal/.test(w); }), 'says the Journal would be exact');
    // without the Account column the section headings give the account, sub-accounts by their parent heading
    var noCol = fileSet(['Journal.xlsx']).map(function (f) { return f.name === 'General_ledger.xlsx' ? { name: f.name, rows: f.rows.map(function (r, i) { var c = r.slice(); if (c.length > 6) c[6] = i === 4 ? 'Split' : '-Split-'; return c; }) } : f; });
    return imported(fileSet(['Journal.xlsx'])).then(function (x) {
      ok(Q.compareBalances(x.b, x.plan.expected).ok, 'ledger import equals the Trial Balance');
      return imported(noCol);
    }).then(function (x) { ok(Q.compareBalances(x.b, x.plan.expected).ok, 'headings alone give the right accounts'); eq(x.b.rawBalance(acct(x.b, 'Parking & Tolls').id), 3000); });
  });

  test('QO-07 an account with a zero balance is on neither statement, yet its Journal lines still import', function () {
    // an invoice and its payment: Accounts Receivable ends at zero, so the Balance Sheet does not list it
    var extra = TX.concat([['03/01/2025', 'Invoice', '9', 'Pine Clinic', [['Cleaning', 'Accounts Receivable (A/R)', 300, ''], ['Cleaning', 'Sales', '', 300]], true],
      ['03/09/2025', 'Payment', '', 'Pine Clinic', [['', 'Checking', 300, ''], ['', 'Accounts Receivable (A/R)', '', 300]], true]]);
    var files = fileSet().filter(function (f) { return !/Journal|Trial|General/.test(f.name); }).concat([{ name: 'Journal.xlsx', rows: journal(extra) }]);
    return newBook().then(function (b) {
      var p = Q.plan(Q.read(files), b);
      eq(p.errors.length, 0, p.errors.join(' | '));
      ok(p.warnings.some(function (w) { return /zero balance/.test(w) && /Accounts Receivable/.test(w); }), 'the guess is reported');
      return b.importBundle(p.bundle).then(function () { eq(count(b, 'invoice'), 1); eq(count(b, 'payment'), 1); eq(b.accountBalance(b.sys('AR').id), 0); });
    });
  });
  test('QO-08 the General Ledger order places a zero-balance account between its neighbours, so nothing is guessed from the name alone', function () {
    // "Deposits Held" nets to zero; in the General Ledger it sits between two expense accounts, so it is an expense, not an asset
    var extra = TX.concat([['03/02/2025', 'Journal Entry', 'JE-9', '', [['x', 'Deposits Held', 70, ''], ['x', 'Checking', '', 70]], true], ['03/03/2025', 'Journal Entry', 'JE-10', '', [['x', 'Checking', 70, ''], ['x', 'Deposits Held', '', 70]], true]]);
    var gl = top('General Ledger').concat([['', 'Date', 'Transaction Type', 'Num', 'Name', 'Memo/Description', 'Account', 'Debit', 'Credit', 'Balance'],
      ['Checking'], ['Total for Checking'], ['Sales'], ['Total for Sales'], ['Office Supplies & Software'], ['Total for Office Supplies & Software'], ['Deposits Held'], ['Total for Deposits Held'], ['Rent & Lease'], ['Total for Rent & Lease'], [], [FOOT]]);
    var files = fileSet().filter(function (f) { return !/Journal|Trial|General/.test(f.name); }).concat([{ name: 'Journal.xlsx', rows: journal(extra) }, { name: 'General_ledger.xlsx', rows: gl }]);
    return newBook().then(function (b) {
      var p = Q.plan(Q.read(files), b);
      eq(p.errors.length, 0, p.errors.join(' | '));
      ok(p.warnings.some(function (w) { return /Deposits Held as Expense/.test(w) && /place in the General Ledger/.test(w); }), p.warnings.join(' | '));
      return b.importBundle(p.bundle).then(function () { eq(acct(b, 'Deposits Held').type, 'expense'); });
    });
  });

  test('QO-05 missing or partial reports are explained, never guessed', function () {
    return newBook().then(function (b) {
      var p = Q.plan(Q.read(fileSet(['Balance_sheet.xlsx', 'Profit_and_loss.xlsx', 'Trial_balance.xlsx', 'General_ledger.xlsx'])), b);
      ok(p.errors.length && /Balance Sheet/.test(p.errors.join(' ')) && /Profit and Loss/.test(p.errors.join(' ')), 'asks for the two reports: ' + p.errors[0]);
      // only the Balance Sheet: the income and expense accounts are still unknown
      var p2 = Q.plan(Q.read(fileSet(['Profit_and_loss.xlsx', 'Trial_balance.xlsx', 'General_ledger.xlsx'])), b);
      ok(p2.errors.some(function (e) { return /Sales/.test(e) && /Profit and Loss/.test(e); }), p2.errors.join(' | '));
      // an unbalanced Journal transaction is an error with its line
      var bad = TX.slice(0, 2).concat([['01/09/2025', 'Expense', '', '', [['x', 'Checking', '', 10], ['x', 'Rent & Lease', 9, '']], false]]);
      var m3 = Q.read([{ name: 'Journal.xlsx', rows: journal(bad) }]); ok(m3.errors.some(function (e) { return /does not balance/.test(e) && /01\/09\/2025|2025-01-09/.test(e); }), m3.errors.join(' | '));
      // a Profit and Loss for one year is not an all-time total: income and expense balances are then not checked
      var files = fileSet(['Trial_balance.xlsx', 'General_ledger.xlsx']).map(function (f) { return f.name === 'Profit_and_loss.xlsx' ? { name: f.name, rows: pnl('January - December 2025') } : f; });
      var m4 = Q.read(files), sales = m4.accounts.find(function (a) { return a.NAME === 'Sales'; }), chk = m4.accounts.find(function (a) { return a.NAME === 'Checking'; });
      eq(sales.QBOBAL, undefined); eq(chk.QBOBAL, -92000, 'Balance Sheet figures still check the balance-sheet accounts'); eq(m4.accounts.find(function (a) { return a.NAME === 'Bank Loan'; }).QBOBAL, -500000);
      // a ledger with one Amount column cannot be read safely
      var amt = ledger().map(function (r, i) { return i === 4 ? ['', 'Date', 'Transaction Type', 'Num', 'Name', 'Memo/Description', 'Split', 'Amount', 'Balance'] : r; });
      var m5 = Q.read([{ name: 'GL.xlsx', rows: amt }, { name: 'bs.xlsx', rows: balanceSheet() }, { name: 'pl.xlsx', rows: pnl() }]); ok(m5.errors.some(function (e) { return /Debit and Credit/.test(e); }), m5.errors.join(' | '));
    });
  });

  test('QO-06 an Account List gives the types on its own; day-first dates are read when the file shows them', function () {
    var list = top('Account List', '').concat([['', 'Full name', 'Type', 'Detail type', 'Description', 'Balance'], ['', 'Checking', 'Bank', 'Checking', '', '-920.00'], ['', 'Savings (9576)', 'Bank', 'Savings', '', 200], ['', 'Dental Equipment', 'Fixed Assets', 'Machinery & Equipment', 'Chairs', 5000],
      ['', 'z-Accumulated Depreciation', 'Fixed Assets', 'Accumulated Depreciation', '', -100], ['', 'Bank Loan', 'Long Term Liabilities', 'Notes Payable', '', 5000], ['', 'Sales', 'Income', 'Service/Fee Income', '', ''], ['', 'Auto Expense', 'Expenses', 'Auto', '', ''], ['', 'Auto Expense:Parking & Tolls', 'Expenses', 'Auto', '', ''],
      ['', 'Office Supplies & Software', 'Expenses', 'Office', '', ''], ['', 'Rent & Lease', 'Expenses', 'Rent', '', ''], ['', 'Depreciation Expense', 'Other Expense', 'Depreciation', '', ''], [], [FOOT]]);
    eq(Q.detect('Accounts.xlsx', '', false, list).report, 'accounts');
    return imported([{ name: 'Journal.xlsx', rows: journal() }, { name: 'Accounts.xlsx', rows: list }, { name: 'tb.xlsx', rows: trial() }]).then(function (x) {
      ok(Q.compareBalances(x.b, x.plan.expected).ok); eq(acct(x.b, 'Depreciation Expense').type, 'oe'); eq(acct(x.b, 'Dental Equipment').description, 'Chairs');
      var dm = [['31/01/2025', 'Deposit', '', '', [['d', 'Checking', 10, ''], ['d', 'Sales', '', 10]], true], ['01/02/2025', 'Deposit', '', '', [['d', 'Checking', 5, ''], ['d', 'Sales', '', 5]], true]];
      var m = Q.read([{ name: 'Journal.xlsx', rows: journal(dm) }]); eq(m.txns[0].date, '2025-01-31'); eq(m.txns[1].date, '2025-02-01', 'the whole file is day-first');
      eq(Q.read([{ name: 'Journal.xlsx', rows: journal() }]).txns[6].date, '2025-02-03', 'month-first stays month-first');
    });
  });
})(typeof window !== 'undefined' ? window : globalThis);
