/* OfflineBooks US — engine test suite. Runs in Node (tests/run-node.js) and in the browser (tests/tests.html). */
(function (root) {
  'use strict';
  var OB = root.OB, U = OB.util, R = OB.reports;
  var T = OB.tests = [];
  function test(name, fn) { T.push({ name: name, fn: fn }); }
  function eq(a, b, msg) { if (a !== b) throw new Error((msg || 'Expected equal') + ': expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }
  function ok(v, msg) { if (!v) throw new Error(msg || 'Assertion failed'); }
  function rejects(p, re, msg) {
    return p.then(function () { throw new Error((msg || 'Expected rejection') + ' but it succeeded'); }, function (e) {
      if (re && !re.test(e.message)) throw new Error((msg || 'Wrong error') + ': ' + e.message);
    });
  }
  function newBook(opts) { return OB.Book.create(new OB.MemoryAdapter(), Object.assign({ name: 'Test Co' }, opts || {})); }
  function acc(book, name) { var a = book.accounts.find(function (x) { return x.name === name; }); if (!a) throw new Error('No account ' + name); return a.id; }
  function cust(book, name) { return book.saveContact({ kind: 'customer', name: name }); }
  function vend(book, name) { return book.saveContact({ kind: 'vendor', name: name }); }
  function bal(book, name, to) { return book.accountBalance(acc(book, name), to); }
  function totalCash(book) { return U.sum(book.accounts.filter(function (a) { return a.type === 'bank'; }), function (a) { return book.accountBalance(a.id); }); }

  test('Money parsing and formatting uses exact cents', function () {
    eq(U.toCents('1,234.56'), 123456); eq(U.toCents('(1,234.56)'), -123456); eq(U.toCents('$-5'), -500);
    eq(U.toCents('0.1'), 10); eq(U.toCents('1.005'), 101); eq(U.toCents('12-'), -1200); eq(U.toCents(''), 0);
    eq(U.fmt(-123456, { symbol: true }), '-$1,234.56'); eq(U.fmt(5), '0.05');
    var parts = U.allocate(1000, [1, 1, 1]); eq(U.sum(parts), 1000, 'allocation sums exactly');
    var threw = false; try { U.toCents('abc'); } catch (e) { threw = true; } ok(threw, 'invalid amount throws');
  });

  test('Dates: parsing, month math and fiscal year', function () {
    eq(U.parseDate('3/7/2025'), '2025-03-07'); eq(U.parseDate('2025-02-30'), null); eq(U.addMonths('2025-01-31', 1), '2025-02-28');
    eq(U.fiscalYearStart('2025-03-15', 7), '2024-07-01'); eq(U.fiscalYearStart('2025-08-01', 7), '2025-07-01');
    eq(U.daysBetween('2025-01-01', '2025-03-01'), 59);
  });

  test('Example 1 — cash sale: Debit Cash $1,000 / Credit Sales $1,000', function () {
    return newBook().then(function (b) {
      return cust(b, 'Walk-in').then(function (c) {
        return b.saveTransaction({ type: 'salesReceipt', date: '2025-01-10', contactId: c.id, accountId: acc(b, 'Checking'), lines: [{ accountId: acc(b, 'Sales'), amount: '1000.00', description: 'Goods' }] });
      }).then(function (t) {
        var dr = t.splits.find(function (s) { return s.amount > 0; }), cr = t.splits.find(function (s) { return s.amount < 0; });
        eq(dr.accountId, acc(b, 'Checking')); eq(dr.amount, 100000);
        eq(cr.accountId, acc(b, 'Sales')); eq(cr.amount, -100000);
        eq(bal(b, 'Checking'), 100000); eq(bal(b, 'Sales'), 100000);
        var p = R.pnl(b, { from: '2025-01-01', to: '2025-12-31' }); eq(p.netIncome[0], 100000);
      });
    });
  });

  test('Example 2 — invoice $1,000 then $400 payment leaves $600 receivable; revenue counted once', function () {
    var b, c, inv;
    return newBook().then(function (x) { b = x; return cust(b, 'Acme'); }).then(function (x) {
      c = x;
      return b.saveTransaction({ type: 'invoice', date: '2025-02-01', dueDate: '2025-03-03', contactId: c.id, lines: [{ accountId: acc(b, 'Services'), qty: 10, rate: '100' }] });
    }).then(function (x) {
      inv = x; eq(inv.total, 100000, 'qty × rate'); ok(/^INV-/.test(inv.number), 'auto-numbered');
      return b.saveTransaction({ type: 'payment', date: '2025-02-15', contactId: c.id, accountId: acc(b, 'Checking'), amount: '400', applications: [{ txnId: inv.id, amount: '400' }] });
    }).then(function () {
      eq(bal(b, 'Accounts Receivable (A/R)'), 60000, 'A/R');
      eq(b.openBalance(inv.id), 60000, 'invoice open balance');
      eq(b.contactBalance(c.id), 60000, 'customer balance');
      eq(bal(b, 'Services'), 100000, 'income only from the invoice');
      eq(bal(b, 'Checking'), 40000);
      var ag = R.aging(b, { kind: 'customer', asOf: '2025-02-28' });
      eq(ag.total, 60000, 'aging total'); eq(ag.total, ag.accountBalance, 'aging = A/R');
      var ag2 = R.aging(b, { kind: 'customer', asOf: '2025-04-15' });
      eq(ag2.rows[0].buckets[2], 60000, '43 days past due → 31–60 bucket');
      var integ = b.checkIntegrity(); eq(integ.issues.length, 0, integ.issues.join('; '));
    });
  });

  test('Example 3 — bill $300 then $100 payment leaves $200 payable; expense counted once', function () {
    var b, v, bill;
    return newBook().then(function (x) { b = x; return vend(b, 'Office Depot'); }).then(function (x) {
      v = x; return b.saveTransaction({ type: 'bill', date: '2025-03-01', contactId: v.id, lines: [{ accountId: acc(b, 'Office Supplies & Software'), amount: '300' }] });
    }).then(function (x) {
      bill = x;
      return b.saveTransaction({ type: 'billPayment', date: '2025-03-10', contactId: v.id, accountId: acc(b, 'Checking'), amount: '100', applications: [{ txnId: bill.id, amount: '100' }] });
    }).then(function () {
      eq(bal(b, 'Accounts Payable (A/P)'), 20000); eq(b.openBalance(bill.id), 20000); eq(b.contactBalance(v.id), 20000);
      eq(bal(b, 'Office Supplies & Software'), 30000, 'expense only from the bill');
      eq(bal(b, 'Checking'), -10000);
      var ag = R.aging(b, { kind: 'vendor', asOf: '2025-03-31' }); eq(ag.total, 20000); eq(ag.accountBalance, 20000);
    });
  });

  test('Example 4 — transfer $500 between banks leaves total cash unchanged and no income/expense', function () {
    var b;
    return newBook().then(function (x) { b = x; return b.setOpeningBalance(acc(b, 'Checking'), '2025-01-01', 200000); }).then(function () {
      var before = totalCash(b);
      return b.saveTransaction({ type: 'transfer', date: '2025-01-05', accountId: acc(b, 'Checking'), toAccountId: acc(b, 'Savings'), amount: '500' }).then(function () {
        eq(totalCash(b), before, 'total cash unchanged');
        eq(bal(b, 'Checking'), 150000); eq(bal(b, 'Savings'), 50000);
        var p = R.pnl(b, { from: '2025-01-01', to: '2025-12-31' }); eq(p.netIncome[0], 0, 'no P&L effect');
        var cf = R.cashFlow(b, { from: '2025-01-02', to: '2025-12-31' }); eq(cf.netChange, 0); ok(cf.reconciles);
      });
    });
  });

  test('Example 5 (engine) — data reloads identically from storage', function () {
    var b, ad = new OB.MemoryAdapter();
    return OB.Book.create(ad, { name: 'Persist Co' }).then(function (x) { b = x; return cust(b, 'Reload'); }).then(function (c) {
      return b.saveTransaction({ type: 'invoice', date: '2025-01-01', contactId: c.id, lines: [{ accountId: acc(b, 'Sales'), amount: '250.25' }] });
    }).then(function () { return ad.loadAll(); }).then(function (data) {
      var b2 = OB.Book.fromData(ad, data);
      eq(b2.transactions.length, 1); eq(b2.accountBalance(b2.sys('AR').id), 25025); eq(b2.company.name, 'Persist Co');
      eq(b2.contacts.length, 1); eq(b2.accounts.length, b.accounts.length);
    });
  });

  test('Overpayment, double application and duplicate submissions are prevented', function () {
    var b, c, inv;
    return newBook().then(function (x) { b = x; return cust(b, 'Dup'); }).then(function (x) {
      c = x; return b.saveTransaction({ type: 'invoice', date: '2025-01-01', contactId: c.id, lines: [{ accountId: acc(b, 'Sales'), amount: '100' }] });
    }).then(function (x) {
      inv = x;
      return rejects(b.saveTransaction({ type: 'payment', date: '2025-01-02', contactId: c.id, accountId: acc(b, 'Checking'), amount: '150', applications: [{ txnId: inv.id, amount: '150' }] }), /open/);
    }).then(function () {
      var d = { type: 'payment', date: '2025-01-02', contactId: c.id, accountId: acc(b, 'Checking'), amount: '100', applications: [{ txnId: inv.id, amount: '100' }], clientToken: 'form-123' };
      return Promise.all([b.saveTransaction(d), b.saveTransaction(d).catch(function (e) { return e; })]);
    }).then(function (res) {
      var payments = b.transactions.filter(function (t) { return t.type === 'payment'; });
      eq(payments.length, 1, 'only one payment posted');
      return b.saveTransaction({ type: 'payment', date: '2025-01-02', contactId: c.id, accountId: acc(b, 'Checking'), amount: '100', applications: [{ txnId: inv.id, amount: '100' }], clientToken: 'form-123' });
    }).then(function (again) {
      eq(b.transactions.filter(function (t) { return t.type === 'payment'; }).length, 1, 'resubmitting same form token does not post again');
      return rejects(b.saveTransaction({ type: 'payment', date: '2025-01-03', contactId: c.id, accountId: acc(b, 'Checking'), amount: '50', applications: [{ txnId: inv.id, amount: '50' }] }), /open/, 'paying a fully paid invoice');
    }).then(function () {
      eq(b.openBalance(inv.id), 0); eq(b.contactBalance(c.id), 0);
      var dup = b.findDuplicates(b.normalize({ type: 'invoice', date: '2025-01-01', contactId: c.id, lines: [{ accountId: acc(b, 'Sales'), amount: '100' }] }));
      eq(dup.length, 1, 'possible duplicate invoice detected');
    });
  });

  test('Unbalanced or invalid journal entries are rejected', function () {
    var b;
    return newBook().then(function (x) {
      b = x;
      return rejects(b.saveTransaction({ type: 'journal', date: '2025-01-01', jlines: [{ accountId: acc(b, 'Checking'), debit: '100' }, { accountId: acc(b, 'Sales'), credit: '99.99' }] }), /must equal/);
    }).then(function () {
      return rejects(b.saveTransaction({ type: 'journal', date: '2025-01-01', jlines: [{ accountId: acc(b, 'Accounts Receivable (A/R)'), debit: '100' }, { accountId: acc(b, 'Sales'), credit: '100' }] }), /need a customer/);
    }).then(function () {
      return rejects(b.saveTransaction({ type: 'journal', date: '2025-13-01', jlines: [{ accountId: acc(b, 'Checking'), debit: '1' }, { accountId: acc(b, 'Sales'), credit: '1' }] }), /valid date/);
    }).then(function () {
      return rejects(b.saveTransaction({ type: 'expense', date: '2025-01-01', accountId: acc(b, 'Checking'), lines: [{ accountId: acc(b, 'Accounts Payable (A/P)'), amount: '5' }] }), /A\/R and A\/P/);
    }).then(function () { eq(b.transactions.length, 0, 'nothing posted'); });
  });

  test('Voiding keeps the record, removes its effect, and protects applied documents', function () {
    var b, c, inv, pay;
    return newBook().then(function (x) { b = x; return cust(b, 'Void Co'); }).then(function (x) {
      c = x; return b.saveTransaction({ type: 'invoice', date: '2025-01-01', contactId: c.id, lines: [{ accountId: acc(b, 'Sales'), amount: '500' }] });
    }).then(function (x) {
      inv = x; return b.saveTransaction({ type: 'payment', date: '2025-01-05', contactId: c.id, accountId: acc(b, 'Checking'), amount: '500', applications: [{ txnId: inv.id, amount: '500' }] });
    }).then(function (x) {
      pay = x; return rejects(b.voidTransaction(inv.id), /applied/);
    }).then(function () { return b.voidTransaction(pay.id, 'Bounced check'); }).then(function () {
      eq(b.txById[pay.id].status, 'void'); eq(b.transactions.length, 2, 'record kept');
      eq(b.openBalance(inv.id), 50000, 'invoice open again'); eq(bal(b, 'Checking'), 0);
      ok(b.audit.some(function (a) { return a.action === 'void' && a.txnId === pay.id && a.before; }), 'audit history with prior version');
      return rejects(b.saveTransaction(Object.assign({}, b.txById[pay.id], { amount: '1' })), /Voided/);
    }).then(function () { return b.voidTransaction(inv.id); }).then(function () {
      eq(bal(b, 'Sales'), 0); eq(b.checkIntegrity().issues.length, 0);
    });
  });

  test('Journal reversal posts an equal and opposite entry', function () {
    var b, je;
    return newBook().then(function (x) {
      b = x; return b.saveTransaction({ type: 'journal', date: '2025-06-30', memo: 'Accrue rent', jlines: [{ accountId: acc(b, 'Rent & Lease'), debit: '1200' }, { accountId: acc(b, 'Payroll Liabilities'), credit: '1200' }] });
    }).then(function (x) { je = x; return b.reverseJournal(je.id, '2025-07-01'); }).then(function (rev) {
      eq(rev.reversalOf, je.id); eq(b.txById[je.id].reversedBy, rev.id);
      eq(bal(b, 'Rent & Lease'), 0); eq(bal(b, 'Rent & Lease', '2025-06-30'), 120000);
      return rejects(b.reverseJournal(je.id), /already/);
    });
  });

  test('Credit memos, unapplied payments and customer refunds', function () {
    var b, c, inv, cm, pay;
    return newBook().then(function (x) { b = x; return cust(b, 'Credits'); }).then(function (x) {
      c = x; return b.saveTransaction({ type: 'invoice', date: '2025-01-01', contactId: c.id, lines: [{ accountId: acc(b, 'Sales'), amount: '1000' }] });
    }).then(function (x) {
      inv = x; return b.saveTransaction({ type: 'creditMemo', date: '2025-01-02', contactId: c.id, lines: [{ accountId: acc(b, 'Sales'), amount: '200' }], applications: [{ txnId: inv.id, amount: '200' }] });
    }).then(function (x) {
      cm = x; eq(b.openBalance(inv.id), 80000); eq(bal(b, 'Sales'), 80000, 'credit memo reduces income');
      return b.saveTransaction({ type: 'payment', date: '2025-01-03', contactId: c.id, accountId: acc(b, 'Checking'), amount: '900', applications: [{ txnId: inv.id, amount: '800' }] });
    }).then(function (x) {
      pay = x; eq(b.openBalance(pay.id), 10000, '$100 unapplied credit'); eq(b.contactBalance(c.id), -10000, 'customer has a credit');
      return b.saveTransaction({ type: 'customerRefund', date: '2025-01-04', contactId: c.id, accountId: acc(b, 'Checking'), amount: '100', applications: [{ txnId: pay.id, amount: '100' }] });
    }).then(function () {
      eq(b.contactBalance(c.id), 0); eq(bal(b, 'Accounts Receivable (A/R)'), 0); eq(bal(b, 'Checking'), 80000);
      eq(bal(b, 'Sales'), 80000, 'refund of overpayment is not an expense');
      var ag = R.aging(b, { kind: 'customer', asOf: '2025-12-31' }); eq(ag.total, 0);
      eq(b.checkIntegrity().issues.length, 0, b.checkIntegrity().issues.join('; '));
    });
  });

  test('Vendor credits apply to bills; credit card charges and credits', function () {
    var b, v, bill;
    return newBook().then(function (x) { b = x; return vend(b, 'Supplier'); }).then(function (x) {
      v = x; return b.saveTransaction({ type: 'bill', date: '2025-01-01', contactId: v.id, lines: [{ accountId: acc(b, 'Cost of Goods Sold'), amount: '700' }] });
    }).then(function (x) {
      bill = x; return b.saveTransaction({ type: 'vendorCredit', date: '2025-01-05', contactId: v.id, lines: [{ accountId: acc(b, 'Cost of Goods Sold'), amount: '50' }], applications: [{ txnId: bill.id, amount: '50' }] });
    }).then(function () {
      eq(b.openBalance(bill.id), 65000); eq(bal(b, 'Cost of Goods Sold'), 65000);
      return b.saveTransaction({ type: 'billPayment', date: '2025-01-10', contactId: v.id, accountId: acc(b, 'Business Credit Card'), amount: '650', applications: [{ txnId: bill.id, amount: '650' }] });
    }).then(function () {
      eq(bal(b, 'Business Credit Card'), 65000, 'card liability increases'); eq(b.openBalance(bill.id), 0);
      return b.saveTransaction({ type: 'expense', date: '2025-01-11', accountId: acc(b, 'Business Credit Card'), lines: [{ accountId: acc(b, 'Meals'), amount: '42.10' }] });
    }).then(function () {
      return b.saveTransaction({ type: 'ccCredit', date: '2025-01-12', accountId: acc(b, 'Business Credit Card'), lines: [{ accountId: acc(b, 'Meals'), amount: '2.10' }] });
    }).then(function () {
      eq(bal(b, 'Meals'), 4000); eq(bal(b, 'Business Credit Card'), 69000);
      return b.saveTransaction({ type: 'transfer', date: '2025-01-20', accountId: acc(b, 'Checking'), toAccountId: acc(b, 'Business Credit Card'), amount: '690' });
    }).then(function () { eq(bal(b, 'Business Credit Card'), 0, 'card paid off by transfer'); eq(bal(b, 'Checking'), -69000); });
  });

  test('Cash basis recognizes income/expense only when paid, proportionally', function () {
    var b, c, v, inv, bill;
    return newBook({ basis: 'cash' }).then(function (x) { b = x; return cust(b, 'Cash C'); }).then(function (x) {
      c = x; return vend(b, 'Cash V');
    }).then(function (x) {
      v = x; return b.saveTransaction({ type: 'invoice', date: '2025-01-01', contactId: c.id, lines: [{ accountId: acc(b, 'Sales'), amount: '600' }, { accountId: acc(b, 'Services'), amount: '400' }] });
    }).then(function (x) {
      inv = x; return b.saveTransaction({ type: 'payment', date: '2025-02-01', contactId: c.id, accountId: acc(b, 'Checking'), amount: '400', applications: [{ txnId: inv.id, amount: '400' }] });
    }).then(function () {
      return b.saveTransaction({ type: 'bill', date: '2025-01-01', contactId: v.id, lines: [{ accountId: acc(b, 'Rent & Lease'), amount: '300' }] });
    }).then(function (x) {
      bill = x; return b.saveTransaction({ type: 'billPayment', date: '2025-02-10', contactId: v.id, accountId: acc(b, 'Checking'), amount: '100', applications: [{ txnId: bill.id, amount: '100' }] });
    }).then(function () {
      var jan = R.pnl(b, { from: '2025-01-01', to: '2025-01-31', basis: 'cash' }); eq(jan.netIncome[0], 0, 'nothing in January on cash basis');
      var feb = R.pnl(b, { from: '2025-02-01', to: '2025-02-28', basis: 'cash' });
      eq(feb.sections.income.totals[0], 40000, 'income = payment'); eq(feb.sections.expense.totals[0], 10000);
      var sales = feb.sections.income.rows.find(function (r) { return r.accountId === acc(b, 'Sales'); });
      eq(sales.values[0], 24000, '60% of payment to Sales');
      var accr = R.pnl(b, { from: '2025-01-01', to: '2025-12-31', basis: 'accrual' }); eq(accr.netIncome[0], 70000);
      var bsCash = R.balanceSheet(b, { asOf: '2025-12-31', basis: 'cash' }); ok(bsCash.balanced, 'cash-basis balance sheet balances');
      var bsAcc = R.balanceSheet(b, { asOf: '2025-12-31', basis: 'accrual' }); ok(bsAcc.balanced, 'accrual balance sheet balances');
      var tb = R.trialBalance(b, { asOf: '2025-12-31', basis: 'cash' }); ok(tb.balanced);
    });
  });

  test('Balance sheet, trial balance, cash flow and retained earnings across fiscal years', function () {
    var b, c;
    return newBook({ fiscalYearStartMonth: 1 }).then(function (x) { b = x; return b.setOpeningBalance(acc(b, 'Checking'), '2023-12-31', 1000000); }).then(function () {
      return cust(b, 'Multi');
    }).then(function (x) {
      c = x;
      return b.saveTransaction({ type: 'salesReceipt', date: '2024-05-01', contactId: c.id, accountId: acc(b, 'Checking'), lines: [{ accountId: acc(b, 'Sales'), amount: '5000' }] });
    }).then(function () {
      return b.saveTransaction({ type: 'expense', date: '2024-06-01', accountId: acc(b, 'Checking'), lines: [{ accountId: acc(b, 'Utilities'), amount: '1500' }] });
    }).then(function () {
      return b.saveTransaction({ type: 'check', date: '2025-02-01', number: '1001', accountId: acc(b, 'Checking'), lines: [{ accountId: acc(b, 'Furniture and Equipment'), amount: '2000' }] });
    }).then(function () {
      return b.saveTransaction({ type: 'salesReceipt', date: '2025-03-01', contactId: c.id, accountId: acc(b, 'Checking'), lines: [{ accountId: acc(b, 'Sales'), amount: '1000' }] });
    }).then(function () {
      var bs = R.balanceSheet(b, { asOf: '2025-12-31', compare: ['2024-12-31'] });
      ok(bs.balanced, 'balanced in both columns');
      var eqG = bs.groups[2], rows = eqG.subs[0].rows;
      var re = rows.find(function (r) { return r.accountId === acc(b, 'Retained Earnings'); });
      var ni = rows.find(function (r) { return r.netIncome; });
      eq(re.values[0], 350000, '2024 profit rolled into retained earnings'); eq(ni.values[0], 100000, '2025 net income');
      eq(re.values[1], 0, 'no retained earnings at end of 2024'); eq(ni.values[1], 350000);
      eq(bs.totalAssets, 1000000 + 500000 - 150000 - 200000 + 100000 + 200000);
      var tb = R.trialBalance(b, { asOf: '2025-12-31' }); ok(tb.balanced, 'trial balance');
      var reRow = tb.rows.find(function (r) { return r.accountId === acc(b, 'Retained Earnings'); }); eq(reRow.credit, 350000);
      var cf = R.cashFlow(b, { from: '2025-01-01', to: '2025-12-31' });
      ok(cf.reconciles, 'cash flow reconciles'); eq(cf.netInvesting, -200000); eq(cf.netChange, -100000);
      eq(cf.cashEnd, bal(b, 'Checking', '2025-12-31'));
      var cmp = R.pnl(b, { from: '2024-01-01', to: '2025-12-31', columns: 'year' });
      eq(cmp.columns.length, 3); eq(cmp.netIncome[0], 350000); eq(cmp.netIncome[1], 100000); eq(cmp.netIncome[2], 450000);
      var mon = R.pnl(b, { from: '2025-01-01', to: '2025-12-31', columns: 'month' }); eq(mon.columns.length, 13); eq(mon.netIncome[2], 100000);
      var gl = R.generalLedger(b, { from: '2025-01-01', to: '2025-12-31', accountIds: [acc(b, 'Checking')] });
      eq(gl.accounts[0].opening, 1350000); eq(gl.accounts[0].closing, 1250000);
    });
  });

  test('Bank reconciliation: difference must be zero; reconciled lines are locked; undo works', function () {
    var b, t1, t2, chk = null;
    return newBook().then(function (x) {
      b = x; chk = acc(b, 'Checking');
      return b.saveTransaction({ type: 'deposit', date: '2025-01-03', accountId: chk, lines: [{ accountId: acc(b, 'Sales'), amount: '1000' }] });
    }).then(function (x) {
      t1 = x; return b.saveTransaction({ type: 'expense', date: '2025-01-05', accountId: chk, lines: [{ accountId: acc(b, 'Bank Charges & Fees'), amount: '15' }] });
    }).then(function (x) {
      t2 = x;
      var refs = [{ txnId: t1.id, i: t1.splits.findIndex(function (s) { return s.accountId === chk; }) }];
      return rejects(b.finishReconciliation(chk, '2025-01-31', 98500, refs), /difference/i).then(function () {
        refs.push({ txnId: t2.id, i: t2.splits.findIndex(function (s) { return s.accountId === chk; }) });
        return b.finishReconciliation(chk, '2025-01-31', 98500, refs);
      });
    }).then(function (rec) {
      eq(rec.beginningBalance, 0); eq(b.reconciledBalance(chk), 98500);
      return rejects(b.voidTransaction(t1.id), /reconciled/);
    }).then(function () {
      return rejects(b.saveTransaction(Object.assign({}, b.txById[t2.id], { lines: [{ accountId: acc(b, 'Bank Charges & Fees'), amount: '16' }] })), /reconcil/);
    }).then(function () { return b.undoLastReconciliation(chk); }).then(function () {
      eq(b.reconciledBalance(chk), 0); return b.voidTransaction(t2.id);
    });
  });

  test('Recurring transactions post on schedule exactly once', function () {
    var b, r;
    return newBook().then(function (x) {
      b = x;
      return b.saveRecurring({ name: 'Rent', frequency: 'monthly', nextDate: '2025-01-31', template: { type: 'expense', accountId: acc(b, 'Checking'), lines: [{ accountId: acc(b, 'Rent & Lease'), amount: 150000 }] } });
    }).then(function (x) {
      r = x; eq(b.dueRecurring('2025-03-15').length, 1);
      return b.postRecurring(r.id);
    }).then(function (t) {
      eq(t.date, '2025-01-31'); eq(t.total, 150000);
      var rr = b.recurring.find(function (x) { return x.id === r.id; }); eq(rr.nextDate, '2025-02-28');
      return b.postRecurring(r.id);
    }).then(function () {
      eq(bal(b, 'Rent & Lease'), 300000);
      var rr = b.recurring.find(function (x) { return x.id === r.id; }); eq(rr.nextDate, '2025-03-28');
      return rejects(b.saveRecurring({ name: 'bad', frequency: 'monthly', nextDate: '2025-01-01', template: { type: 'payment' } }), /cannot be recurring/);
    });
  });

  test('Bank CSV import: rules categorize, transfers detected, re-import skips duplicates', function () {
    var b, chk;
    var csv = 'Date,Description,Amount\n01/02/2025,STRIPE PAYOUT,1250.00\n01/03/2025,"COMCAST, INC",-89.99\n01/04/2025,TRANSFER TO SAVINGS,-300\n01/05/2025,COFFEE SHOP,-4.50\n01/05/2025,COFFEE SHOP,-4.50\n';
    return newBook().then(function (x) {
      b = x; chk = acc(b, 'Checking');
      return b.saveRule({ contains: 'comcast', direction: 'out', accountId: acc(b, 'Utilities') });
    }).then(function () {
      return b.saveRule({ contains: 'transfer to savings', accountId: acc(b, 'Savings') });
    }).then(function () {
      var table = U.parseCSV(csv);
      var map = OB.importer.detectColumns(table[0]); map.hasHeader = true;
      var parsed = OB.importer.parseBankRows(table, map);
      eq(parsed.rows.length, 5); eq(parsed.rows[1].description, 'COMCAST, INC'); eq(parsed.rows[1].amount, -8999);
      var rows = OB.importer.categorize(b, chk, OB.importer.assignHashes(chk, parsed.rows));
      eq(rows[1].categoryId, acc(b, 'Utilities'), 'rule applied'); eq(rows[0].categoryId, acc(b, 'Uncategorized Income'));
      ok(rows[3].hash !== rows[4].hash, 'identical rows in one file are distinct');
      var drafts = rows.map(function (r) { return OB.importer.rowToDraft(b, chk, r); });
      eq(drafts[2].type, 'transfer');
      return b.postBatch(drafts).then(function (res) {
        eq(res.posted.length, 5); eq(res.errors.length, 0);
        eq(bal(b, 'Checking'), 125000 - 8999 - 30000 - 900); eq(bal(b, 'Savings'), 30000); eq(bal(b, 'Utilities'), 8999);
        var again = OB.importer.categorize(b, chk, OB.importer.assignHashes(chk, OB.importer.parseBankRows(table, map).rows));
        ok(again.every(function (r) { return r.duplicate && !r.include; }), 'all flagged as duplicates');
        return b.postBatch(again.map(function (r) { return OB.importer.rowToDraft(b, chk, r); }));
      }).then(function (res2) { eq(res2.posted.length, 0); eq(res2.skipped.length, 5); eq(b.transactions.length, 5); });
    });
  });

  test('Backup round trip with checksum validation and tamper detection', function () {
    var b;
    return newBook().then(function (x) { b = x; return cust(b, 'Backup C'); }).then(function (c) {
      return b.saveTransaction({ type: 'invoice', date: '2025-01-01', contactId: c.id, lines: [{ accountId: acc(b, 'Sales'), amount: '321.09' }] });
    }).then(function () {
      var bk = OB.backup.create(b);
      var json = JSON.stringify(bk);
      var v = OB.backup.validate(JSON.parse(json));
      ok(v.ok, 'valid: ' + v.errors.join('; ')); eq(v.summary.transactions, 1);
      var tampered = JSON.parse(json); tampered.data.transactions[0].splits[0].amount += 1;
      var v2 = OB.backup.validate(tampered); ok(!v2.ok, 'tampered rejected'); ok(v2.errors.some(function (e) { return /Checksum/.test(e); }));
      var bad = OB.backup.validate({ hello: 1 }); ok(!bad.ok);
      var copy = OB.backup.prepareRestore(v.data, 'copy');
      ok(copy.company.id !== b.company.id, 'copy gets a new company id'); ok(/restored/.test(copy.company.name));
      var restored = OB.Book.fromData(new OB.MemoryAdapter(), copy);
      eq(restored.accountBalance(restored.sys('AR').id), 32109);
      // older data version migrates
      var old = JSON.parse(json); old.data.company.dataVersion = 1; delete old.data.company.counters; delete old.checksum;
      var v3 = OB.backup.validate(old); ok(v3.ok, v3.errors.join(';')); ok(v3.warnings.some(function (w) { return /Upgraded/.test(w); }));
    });
  });

  test('Closing date locks earlier periods', function () {
    var b, t;
    return newBook().then(function (x) {
      b = x; return b.saveTransaction({ type: 'deposit', date: '2024-12-15', accountId: acc(b, 'Checking'), lines: [{ accountId: acc(b, 'Sales'), amount: '10' }] });
    }).then(function (x) { t = x; return b.saveCompany({ closingDate: '2024-12-31' }); }).then(function () {
      return rejects(b.saveTransaction({ type: 'deposit', date: '2024-12-20', accountId: acc(b, 'Checking'), lines: [{ accountId: acc(b, 'Sales'), amount: '10' }] }), /closed/);
    }).then(function () { return rejects(b.voidTransaction(t.id), /closed/); });
  });

  test('Editing: invoice total cannot drop below payments applied; audit keeps prior version', function () {
    var b, c, inv;
    return newBook().then(function (x) { b = x; return cust(b, 'Edit'); }).then(function (x) {
      c = x; return b.saveTransaction({ type: 'invoice', date: '2025-01-01', contactId: c.id, lines: [{ accountId: acc(b, 'Sales'), amount: '100' }] });
    }).then(function (x) {
      inv = x; return b.saveTransaction({ type: 'payment', date: '2025-01-02', contactId: c.id, accountId: acc(b, 'Checking'), amount: '80', applications: [{ txnId: inv.id, amount: '80' }] });
    }).then(function () {
      var d = U.clone(b.txById[inv.id]); d.lines = [{ accountId: acc(b, 'Sales'), amount: 5000 }];
      return rejects(b.saveTransaction(d), /cannot be lower/);
    }).then(function () {
      var d = U.clone(b.txById[inv.id]); d.lines = [{ accountId: acc(b, 'Sales'), amount: 12000 }];
      return b.saveTransaction(d);
    }).then(function (t) {
      eq(t.version, 2); eq(b.openBalance(inv.id), 4000); eq(bal(b, 'Sales'), 12000);
      var a = b.audit.filter(function (x) { return x.txnId === inv.id && x.action === 'edit'; }); eq(a.length, 1); eq(a[0].before.total, 10000);
    });
  });

  test('Failed storage write leaves the books unchanged (atomic posting)', function () {
    var b;
    return newBook().then(function (x) {
      b = x; b.adapter.failNext = true;
      return rejects(b.saveTransaction({ type: 'deposit', date: '2025-01-01', accountId: acc(b, 'Checking'), lines: [{ accountId: acc(b, 'Sales'), amount: '10' }] }), /Simulated/);
    }).then(function () {
      eq(b.transactions.length, 0); eq(bal(b, 'Checking'), 0);
      return b.saveTransaction({ type: 'deposit', date: '2025-01-01', accountId: acc(b, 'Checking'), lines: [{ accountId: acc(b, 'Sales'), amount: '10' }] });
    }).then(function () { eq(b.transactions.length, 1, 'queue recovers after failure'); });
  });

  test('Opening balances post against Opening Balance Equity', function () {
    var b;
    return newBook().then(function (x) { b = x; return b.setOpeningBalance(acc(b, 'Business Credit Card'), '2024-12-31', 50000); }).then(function () {
      eq(bal(b, 'Business Credit Card'), 50000); eq(bal(b, 'Opening Balance Equity'), -50000);
      return rejects(b.setOpeningBalance(b.sys('AR').id, '2024-12-31', 100), /invoices/);
    });
  });

  test('Accounts and contacts: validation, duplicates, system protections', function () {
    var b;
    return newBook().then(function (x) {
      b = x; return rejects(b.saveAccount({ name: 'Checking', type: 'bank' }), /already exists/);
    }).then(function () { return b.saveAccount({ name: 'Marketing:Online', number: '6010', type: 'expense', parentId: acc(b, 'Advertising & Marketing') }); })
      .then(function (a) {
        ok(/Advertising & Marketing:Marketing:Online/.test(b.accountLabel(a.id)));
        return rejects(b.saveAccount({ id: b.sys('AR').id, name: 'A/R', type: 'bank' }), /system/);
      }).then(function () {
        return cust(b, 'Same');
      }).then(function () { return rejects(cust(b, 'same'), /already exists/); })
      .then(function () { return vend(b, 'Same'); }); // same name as a vendor is fine
  });

  test('Performance: 20,000 transactions post and report quickly', function () {
    var b, chk;
    var now = function () { return (typeof performance !== 'undefined' ? performance : Date).now(); };
    return newBook().then(function (x) {
      b = x; chk = acc(b, 'Checking');
      var cats = ['Sales', 'Services', 'Meals', 'Utilities', 'Travel', 'Rent & Lease'].map(function (n) { return acc(b, n); });
      var drafts = [];
      for (var i = 0; i < 20000; i++) {
        var d = U.addDays('2022-01-01', i % 1460), inc = i % 3 === 0;
        drafts.push({ type: inc ? 'deposit' : 'expense', date: d, accountId: chk, memo: 'Txn ' + i, lines: [{ accountId: cats[inc ? i % 2 : 2 + (i % 4)], amount: 1000 + (i % 977) }] });
      }
      var t0 = now();
      return b.postBatch(drafts).then(function (res) {
        var postMs = now() - t0;
        eq(res.posted.length, 20000);
        var t1 = now();
        var p = R.pnl(b, { from: '2022-01-01', to: '2025-12-31', columns: 'month' });
        var bs = R.balanceSheet(b, { asOf: '2025-12-31' });
        var tb = R.trialBalance(b, { asOf: '2025-12-31' });
        var cf = R.cashFlow(b, { from: '2022-01-01', to: '2025-12-31' });
        var reportMs = now() - t1;
        ok(bs.balanced && tb.balanced && cf.reconciles, 'reports consistent at scale');
        eq(p.netIncome[p.netIncome.length - 1], R.netIncome(b, 'accrual', '2022-01-01', '2025-12-31'));
        var t2 = now(); var integ = b.checkIntegrity(); var integMs = now() - t2;
        eq(integ.issues.length, 0);
        ok(reportMs < 8000, 'reports took ' + reportMs + 'ms');
        return { info: 'post ' + Math.round(postMs) + 'ms, 4 reports ' + Math.round(reportMs) + 'ms, integrity ' + Math.round(integMs) + 'ms' };
      });
    });
  });

  test('XLSX export produces a valid ZIP container', function () {
    var bytes = OB.xlsx.build([{ name: 'Report', rows: [[{ v: 'Account', bold: true }, { v: 'Amount', bold: true }], ['Sales', { v: 1234.5, money: true }], ['A & B <x>', -5]] }]);
    eq(bytes[0], 0x50); eq(bytes[1], 0x4b); eq(bytes[2], 3); eq(bytes[3], 4);
    var tail = bytes.length - 22; eq(bytes[tail], 0x50); eq(bytes[tail + 1], 0x4b); eq(bytes[tail + 2], 5); eq(bytes[tail + 3], 6);
  });

  /* ---------- 1.10: shared report model, Excel formulas, PDF ---------- */
  function unzipStored(bytes) { // our writer stores files uncompressed
    var files = {}, i = 0, dec = function (a) { return typeof TextDecoder !== 'undefined' ? new TextDecoder().decode(a) : Buffer.from(a).toString('utf8'); };
    while (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 3 && bytes[i + 3] === 4) {
      var dv = new DataView(bytes.buffer, bytes.byteOffset + i), size = dv.getUint32(18, true), nl = dv.getUint16(26, true);
      var name = dec(bytes.subarray(i + 30, i + 30 + nl)); files[name] = dec(bytes.subarray(i + 30 + nl, i + 30 + nl + size)); i += 30 + nl + size;
    }
    return files;
  }
  function sheetCells(xml) {
    var cells = {}, re = /<c r="([A-Z]+\d+)"[^>]*?(?:\/>|>([\s\S]*?)<\/c>)/g, m;
    while ((m = re.exec(xml))) {
      var inner = m[2] || '', f = /<f>([^<]*)<\/f>/.exec(inner), v = /<v>([^<]*)<\/v>/.exec(inner), t = /<t[^>]*>([^<]*)<\/t>/.exec(inner);
      cells[m[1]] = { f: f ? f[1].replace(/&quot;/g, '"') : null, v: v ? +v[1] : null, t: t ? t[1] : null };
    }
    return cells;
  }
  function evalFormula(f, get) { // + - * / ( ) , cell refs, numbers, ROUND/ABS/MIN/MAX; IFERROR(x,"") → x
    f = f.replace(/^IFERROR\((.*),""\)$/, '$1');
    var toks = f.match(/ROUND\(|ABS\(|MIN\(|MAX\(|[A-Z]+\d+|\d+(?:\.\d+)?|[-+*/(),]/g), p = 0;
    var FN = { 'ROUND(': function (a) { var m = Math.pow(10, a[1]); return (a[0] < 0 ? -1 : 1) * Math.round(Math.abs(a[0]) * m) / m; }, 'ABS(': function (a) { return Math.abs(a[0]); }, 'MIN(': function (a) { return Math.min.apply(null, a); }, 'MAX(': function (a) { return Math.max.apply(null, a); } };
    var expr = function () { var v = term(); while (toks[p] === '+' || toks[p] === '-') { var op = toks[p++], w = term(); v = op === '+' ? v + w : v - w; } return v; };
    var term = function () { var v = fac(); while (toks[p] === '*' || toks[p] === '/') { var op = toks[p++], w = fac(); v = op === '*' ? v * w : v / w; } return v; };
    var fac = function () { var t = toks[p++]; if (FN[t]) { var a = [expr()]; while (toks[p] === ',') { p++; a.push(expr()); } p++; return FN[t](a); } if (t === '(') { var v = expr(); p++; return v; } if (t === '-') return -fac(); if (/^[A-Z]/.test(t)) return get(t); return +t; };
    return expr();
  }

  test('Report model: Excel subtotals are live formulas that equal the engine; PDF shows the same figures as the screen', function () {
    return classBook().then(function (x) {
      var b = x.b, R2 = OB.reports, M = OB.reportModel;
      return b.saveAccount({ name: 'Online Ads', type: 'expense', parentId: acc(b, 'Advertising & Marketing') }).then(function (sub) {
        return b.saveTransaction({ type: 'expense', date: '2025-03-12', accountId: acc(b, 'Checking'), lines: [{ accountId: sub.id, amount: '75.25' }, { accountId: acc(b, 'Meals'), amount: '19.99' }] });
      }).then(function () {
        var st = R2.statement(b, { kind: 'pl', from: '2025-01-01', to: '2025-03-31', columns: 'month', compare: ['inc'] });
        var nf = { neg: 'paren', red: '1' };
        var model = M.fromStatement(st, { company: b.company.name, title: 'Profit and Loss', lines: ['January – March 2025'], footer: ['Accrual basis'], nf: nf });
        var flat = R2.flattenStatement(st);
        eq(model.rows.length, flat.length, 'model rows = screen rows');
        var files = unzipStored(OB.xlsx.build([M.toSheet(model, { name: 'P&L' })]));
        ok(/<pane [^>]*state="frozen"/.test(files['xl/worksheets/sheet1.xml']), 'frozen panes');
        ok(/<mergeCell ref="A1:/.test(files['xl/worksheets/sheet1.xml']), 'merged title');
        ok(/_xlnm.Print_Titles/.test(files['xl/workbook.xml']) && /fitToWidth="1"/.test(files['xl/worksheets/sheet1.xml']), 'print titles and fit to width');
        ok(/fullCalcOnLoad="1"/.test(files['xl/workbook.xml']), 'recalculate on open');
        var cells = sheetCells(files['xl/worksheets/sheet1.xml']);
        var get = function (ref) { var c = cells[ref]; return c && c.v !== null ? c.v : 0; };
        var formulas = Object.keys(cells).filter(function (k) { return cells[k].f; });
        ok(formulas.length >= 10, 'formulas written: ' + formulas.length);
        formulas.forEach(function (k) { var got = evalFormula(cells[k].f, get); ok(Math.abs(got - cells[k].v) < 0.005, k + ' ' + cells[k].f + ' = ' + got + ' but engine says ' + cells[k].v); });
        var netRow = model.rows.findIndex(function (r) { return r.section === 'net'; });
        var bodyStart = Object.keys(cells).filter(function (k) { return /^A\d+$/.test(k) && cells[k].t === 'Net Income'; })[0];
        var tc = st.cols.findIndex(function (c) { return c.group === st.groups.length - 1 && c.variant === 'cur'; }), L = OB.xlsx.colName(tc + 1);
        ok(bodyStart && cells[L + bodyStart.slice(1)].f, 'Net Income total column is a formula');
        eq(get(L + bodyStart.slice(1)), st.sections.net.cells[tc] / 100, 'Net Income cached value equals engine');
        ok(!cells[OB.xlsx.colName(tc + 2) + bodyStart.slice(1)].f, '% columns keep values, not sums');
        ok(netRow >= 0);
        // PDF: every figure the screen shows appears as text, page numbers present
        var pdf = M.toPdf(model, { paper: 'letter' }), str = '';
        for (var i = 0; i < pdf.length; i++) str += String.fromCharCode(pdf[i]);
        ok(/^%PDF-1\.4/.test(str) && /%%EOF\n$/.test(str), 'PDF header and trailer');
        var shown = {}; (str.match(/\((?:[^()\\]|\\.)*\) Tj/g) || []).forEach(function (t) { shown[t.slice(1, -4).replace(/\\([()\\])/g, '$1').replace(/\\(\d{3})/g, function (a, o) { return String.fromCharCode(parseInt(o, 8)); })] = 1; });
        var n = 0;
        model.rows.forEach(function (r) { model.columns.forEach(function (c, ci) { var t = M.cellText(model, r, ci); if (t) { n++; ok(shown[t], 'PDF has "' + t + '" (' + r.label + ')'); } }); });
        ok(n > 20, 'checked ' + n + ' figures');
        ok(shown['Page 1 of 1'], 'page numbers');
        ok(shown['(1,059.99)'] || Object.keys(shown).some(function (k) { return /^\(.*\)$/.test(k); }), 'negative style follows the report setting');
        // xref offsets point at objects
        var xref = +/startxref\n(\d+)/.exec(str)[1]; eq(str.slice(xref, xref + 4), 'xref');
        var offs = str.slice(xref).split('\n').slice(3).filter(function (l) { return / n $/.test(l); }).map(function (l) { return +l.slice(0, 10); });
        offs.forEach(function (o, k) { eq(str.slice(o, o + String(k + 1).length + 6), (k + 1) + ' 0 obj', 'xref ' + (k + 1)); });
      });
    });
  });

  test('PDF: long reports paginate with repeating headings and page numbers; paper sizes and orientation', function () {
    var M = OB.reportModel, P = OB.pdf;
    var mtx = [[{ v: 'Co', bold: true }], [{ v: 'General Ledger', bold: true }], ['All dates'], [], ['Date', 'Memo', 'Debit', 'Credit'].map(function (h) { return { v: h, bold: true }; })];
    for (var i = 0; i < 300; i++) mtx.push(['2025-01-' + (i % 28 + 1), 'Line ' + i + ' – café “quoted”', { v: i + 0.5, money: true }, '']);
    var model = M.fromMatrix(mtx);
    eq(model.lines.join('|'), 'Co|General Ledger|All dates'); eq(model.columns.length, 3); eq(model.columns[0].num, false); eq(model.columns[1].num, true);
    eq(M.cellText(model, model.rows[3], 1), '3.50');
    var count = function (bytes) { var s = ''; for (var k = 0; k < bytes.length; k++) s += String.fromCharCode(bytes[k]); return { s: s, pages: +/\/Count (\d+)/.exec(s)[1], box: /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(s) }; };
    var a = count(M.toPdf(model, { paper: 'letter', orientation: 'portrait' }));
    ok(a.pages >= 5, 'pages ' + a.pages); eq(a.box[1] + 'x' + a.box[2], '612x792');
    eq((a.s.match(/\(Debit\) Tj/g) || []).length, a.pages, 'column heading on every page');
    ok(a.s.indexOf('(Page ' + a.pages + ' of ' + a.pages + ') Tj') > 0, 'last page number');
    ok(a.s.indexOf('\\223quoted\\224') > 0, 'curly quotes encoded as WinAnsi');
    var l = count(M.toPdf(model, { paper: 'legal', orientation: 'landscape' })); eq(l.box[1] + 'x' + l.box[2], '1008x612');
    var c = count(M.toPdf(model, { paper: 'custom', width: 5, height: 7 })); eq(c.box[1] + 'x' + c.box[2], '360x504');
    eq(P.fit('A very long description that will not fit', 8, false, 60).slice(-1), '…');
    ok(P.measure('1,234.56', 10) > 30 && P.measure('Total', 10, true) > P.measure('Total', 10), 'bold letters are wider');
    eq(P.measure('1,234.56', 10, true), P.measure('1,234.56', 10), 'figures keep the same width in bold (tabular)');
    eq(M.excelMoneyFormat({ neg: 'paren', red: '1', d1000: '1' }, true), '"$"#,##0.00,"K";[Red]("$"#,##0.00,"K")');
    eq(M.fmtNumber(-123456789, { neg: 'paren', d1000: '1' }, { symbol: true }), '($1,234.57K)');
  });

  /* ---------- 1.10: statement designer (report templates) ---------- */
  function designerBook() {
    var b;
    return newBook().then(function (x) { b = x; return cust(b, 'C'); })
      .then(function (c) { return b.saveTransaction({ type: 'salesReceipt', date: '2025-02-10', contactId: c.id, accountId: acc(b, 'Checking'), lines: [{ accountId: acc(b, 'Sales'), amount: '1000' }, { accountId: acc(b, 'Services'), amount: '500' }] }); })
      .then(function () { return b.saveTransaction({ type: 'salesReceipt', date: '2024-02-10', contactId: b.contacts[0].id, accountId: acc(b, 'Checking'), lines: [{ accountId: acc(b, 'Sales'), amount: '800' }] }); })
      .then(function () { return b.saveTransaction({ type: 'expense', date: '2025-02-12', accountId: acc(b, 'Checking'), lines: [{ accountId: acc(b, 'Cost of Goods Sold'), amount: '600' }, { accountId: acc(b, 'Rent & Lease'), amount: '400' }, { accountId: acc(b, 'Meals'), amount: '33.33' }] }); })
      .then(function () { return b.saveTransaction({ type: 'deposit', date: '2025-02-20', accountId: acc(b, 'Checking'), lines: [{ accountId: acc(b, 'Interest Earned'), amount: '7.5' }] }); })
      .then(function () { return b.saveTransaction({ type: 'journal', date: '2025-02-28', jlines: [{ accountId: acc(b, 'Vehicles'), debit: '5000' }, { accountId: acc(b, 'Loan Payable'), credit: '5000' }] }); })
      .then(function () { return b; });
  }

  test('Designer: formulas parse safely; validation catches syntax, unknown rows, circles, duplicates and bad selections', function () {
    var D = OB.designer;
    var p = D.parseFormula('(a + b) * 2 - abs(c) / max(d, 1)');
    eq(p.refs.sort().join(','), 'a,b,c,d');
    eq(D.evalFormula(p.ast, function (k) { return { a: 1, b: 2, c: -3, d: 0.5 }[k]; }), 3);
    eq(D.evalFormula(D.parseFormula('a / b').ast, function (k) { return k === 'a' ? 5 : 0; }), null, 'division by zero is empty, not Infinity');
    ['', 'a +', '(a', 'a b', 'foo(a)', 'a $ b', 'abs(a, b)'].forEach(function (f) { var t = false; try { D.parseFormula(f); } catch (e) { t = true; } ok(t, 'rejects ' + JSON.stringify(f)); });
    var t = false; try { D.parseFormula('alert(1)'); } catch (e) { t = /Unknown function/.test(e.message); } ok(t, 'no arbitrary functions');
    var bad = D.normalize({ kind: 'pl', rows: [
      { id: 'a', type: 'formula', formula: 'b + 1' }, { id: 'b', type: 'formula', formula: 'a * 2' }, { id: 'a', type: 'accounts', select: { types: ['income'] } },
      { id: '9x', type: 'text' }, { type: 'formula', formula: 'nothere' }, { type: 'accounts', select: {} }, { type: 'accounts', select: { rest: true } }, { type: 'accounts', select: { rest: true } },
      { type: 'accounts', select: { types: ['bank'] } }, { type: 'accounts', select: { netIncome: true } }, { id: 'h', type: 'header', label: 'H' }, { type: 'formula', formula: 'h + 1' }, { type: 'accounts', select: { numbers: '40x' } }] });
    var v = D.validate(bad), all = v.errors.join(' | ');
    [/in a circle/, /“a” is used twice/, /id “9x”/, /no row has that id/, /choose which accounts/, /Only one row/, /does not belong/, /only for balance sheets/, /header row/, /Account numbers/].forEach(function (re) { ok(re.test(all), re + ' in ' + all); });
    eq(D.validate(D.starter('plmargin')).errors.length, 0); eq(D.validate(D.starter('bsratios')).errors.length, 0);
    var rg = D.parseRanges('4000-4999, 6100, 7000-');
    eq(rg.length, 3); eq(rg[0][0], 4000); eq(rg[0][1], 4999); eq(rg[1][0], 6100); eq(rg[1][1], 6100); eq(rg[2][0], 7000); eq(rg[2][1], Infinity);
  });

  test('Designer: template rows tie to the statement engine; margins, ratios, account mapping audit and number ranges', function () {
    var D = OB.designer, R2 = OB.reports;
    return designerBook().then(function (b) {
      var o = { from: '2025-01-01', to: '2025-12-31' };
      var res = D.run(b, D.starter('plmargin'), o), st = R2.statement(b, { kind: 'pl', from: o.from, to: o.to, compare: ['py', 'chg'] });
      eq(res.errors.length, 0, res.errors.join());
      eq(res.cols.map(function (c) { return c.variant; }).join(','), 'cur,py,chg');
      var S2 = res.sections;
      eq(S2.income.cells[0], 150000); eq(S2.income.cells[1], 80000, 'previous year column'); eq(S2.income.cells[2], 70000, '$ change');
      eq(S2.gp.cells[0], st.sections.gross.cells[0], 'gross profit = statement');
      eq(S2.net.cells[0], st.sections.net.cells[0], 'net income = statement'); eq(S2.net.cells[0], R2.netIncome(b, 'accrual', o.from, o.to), 'net income = ledger');
      eq(Math.round(S2.gpm.cells[0] * 10) / 10, 60, 'gross margin %'); eq(S2.gpm.fmt, 'pct');
      eq(S2.gpm.cells[2], S2.gpm.cells[0] - S2.gpm.cells[1], '% row change in points');
      eq(res.audit.unmapped.length, 0, 'every P&L account with amounts is on the report'); eq(res.audit.duplicates.length, 0);
      ok(res.collapsed[S2.income.key], 'summary rows start collapsed');
      eq(S2.income.children.length, 2, 'expandable to Sales and Services');
      ok(S2.income.children.every(function (k) { return k.accountId; }), 'account lines drill down');
      // audit: drop expenses, count Sales twice
      var t = D.normalize({ kind: 'pl', rows: [{ id: 'inc', type: 'accounts', label: 'Income', select: { types: ['income'] } }, { id: 'sales', type: 'accounts', label: 'Sales again', select: { numbers: '4000-4099' } }] });
      var r2 = D.run(b, t, o);
      eq(r2.sections.sales.cells[0], 100000, 'number range picks 4000 Sales only');
      eq(r2.audit.duplicates.length, 1); eq(r2.audit.unmapped.length, 4, 'COGS, rent, meals, interest');
      ok(/not on this report/.test(r2.warnings.join()) && /more than one row/.test(r2.warnings.join()));
      // balance sheet ratios
      var bs = D.run(b, D.starter('bsratios'), o), bst = R2.statement(b, { kind: 'bs', from: o.from, to: o.to, compare: ['pp', 'chg'] });
      eq(bs.errors.length, 0, bs.errors.join());
      eq(bs.sections.ta.cells[0], bst.sections.assets.cells[0], 'total assets = statement');
      eq(bs.sections.tle.cells[0], bst.sections.le.cells[0], 'liabilities + equity = statement (net income included)');
      eq(bs.audit.unmapped.length, 0);
      eq(bs.sections.cr.cells[0], null, 'no current liabilities: current ratio is empty, not infinite');
      eq(Math.round(bs.sections.de.cells[0] * 1000) / 1000, Math.round(500000 / (bst.sections.equity.cells[0]) * 1000) / 1000, 'debt to equity');
      var blank = D.run(b, D.starter('blankbs'), o);
      eq(blank.sections.check.cells[0], 0, 'blank balance sheet balances');
    });
  });

  test('Designer: Excel copy keeps live formulas equal to the engine; templates export and import as JSON', function () {
    var D = OB.designer, M = OB.reportModel;
    return designerBook().then(function (b) {
      var res = D.run(b, D.starter('plmargin'), { from: '2025-01-01', to: '2025-12-31' });
      res.collapsed = {}; // expand everything
      var model = M.fromStatement(res, { company: 'Test Co', title: 'Margins', nf: {} });
      var gpm = model.rows.find(function (r) { return r.label === 'Gross margin'; });
      ok(gpm.fmt === 'pct' && !gpm.bold && gpm.italic && gpm.cond, 'row format, style and colour rule reach the model');
      eq(M.cellText(model, gpm, 0), '60.0 %');
      eq(M.condClass(gpm, 25, model.columns[0]), 'bad'); eq(M.condClass(gpm, 45, model.columns[0]), '');
      var files = unzipStored(OB.xlsx.build([M.toSheet(model)])), cells = sheetCells(files['xl/worksheets/sheet1.xml']);
      var get = function (ref) { var c = cells[ref]; return c && c.v !== null ? c.v : 0; };
      var fs = Object.keys(cells).filter(function (k) { return cells[k].f; });
      ok(fs.length >= 12, fs.length + ' formulas');
      fs.forEach(function (k) { var got = evalFormula(cells[k].f, get); ok(Math.abs(got - cells[k].v) < 0.005, k + ' ' + cells[k].f + ' = ' + got + ' vs ' + cells[k].v); });
      ok(fs.some(function (k) { return /IFERROR\(/.test(cells[k].f) && /\//.test(cells[k].f); }), 'margin formulas guard division by zero');
      var json = D.toJson(D.starter('bsratios')), back = D.fromJson(json, b);
      eq(back.rows.length, D.starter('bsratios').rows.length); eq(JSON.parse(json).$schema, D.SCHEMA.$id);
      var withIds = D.normalize({ kind: 'pl', rows: [{ id: 'x', type: 'accounts', select: { accounts: [acc(b, 'Sales'), 'acct_gone'] } }] });
      eq(D.fromJson(D.toJson(withIds), b).rows[0].select.accounts.length, 1, 'unknown account ids dropped on import');
      [['{', /not valid JSON/], ['{"a":1}', /not a VaultBook report template/], [JSON.stringify({ format: D.FORMAT, version: 1, kind: 'pl', rows: [{ type: 'formula', formula: 'x +' }] }), /ends too early/]].forEach(function (c) {
        var msg = ''; try { D.fromJson(c[0], b); } catch (e) { msg = e.message; } ok(c[1].test(msg), msg);
      });
      return b.saveReport({ name: 'My margins', report: 'designer', params: { def: D.starter('plmargin') } }).then(function (r) {
        eq(b.reports.find(function (x) { return x.id === r.id; }).params.def.rows.length, D.starter('plmargin').rows.length, 'stored in the existing saved-reports store');
      });
    });
  });

  /* ---------- 1.11: interactive financial workbook ---------- */
  test('Workbook: every exported figure equals the engine, on accrual and cash basis', function () {
    var W = OB.workbook, R2 = OB.reports;
    return designerBook().then(function (b) {
      return b.saveContact({ kind: 'vendor', name: 'Landlord' }).then(function (v) {
        return b.saveTransaction({ type: 'bill', date: '2025-03-01', dueDate: '2025-03-31', contactId: v.id, lines: [{ accountId: acc(b, 'Rent & Lease'), amount: '700' }] });
      }).then(function () { return b.saveTransaction({ type: 'invoice', date: '2025-03-05', dueDate: '2025-04-04', contactId: b.contacts[0].id, lines: [{ accountId: acc(b, 'Services'), amount: '250' }] }); })
      .then(function () {
        ['accrual', 'cash'].forEach(function (basis) {
          var from = '2025-01-01', to = '2025-12-31', p = W.plan(b, { from: from, to: to, basis: basis }), v = p.values;
          var pl = R2.statement(b, { kind: 'pl', from: from, to: to, basis: basis }), bs = R2.statement(b, { kind: 'bs', from: from, to: to, basis: basis });
          eq(v['pl.income'], pl.sections.income.cells[0] / 100, basis + ' income'); eq(v['pl.net'], pl.sections.net.cells[0] / 100, basis + ' net income');
          eq(v['pl.gross'], pl.sections.gross.cells[0] / 100, basis + ' gross profit');
          eq(v['bs.assets'], bs.sections.assets.cells[0] / 100, basis + ' total assets'); eq(v['bs.le'], bs.sections.le.cells[0] / 100, basis + ' L&E');
          var tb = R2.trialBalance(b, { asOf: to, basis: basis }); eq(v['tb.debit'], tb.totalDebit / 100); eq(v['tb.credit'], tb.totalCredit / 100);
          var cf = R2.cashFlow(b, { from: from, to: to, basis: basis }); eq(v['cf.end'], cf.cashEnd / 100); eq(v['cf.begin'], cf.cashBegin / 100); eq(v['cf.net'], cf.netChange / 100);
          eq(v['ar.total'], R2.aging(b, { kind: 'customer', asOf: to }).total / 100); eq(v['ap.total'], 700); eq(v['ar.total'], v['ar.ledger'], 'aging ties');
          var gl = R2.generalLedger(b, { from: from, to: to, basis: basis, plFromFiscalStart: false });
          gl.accounts.forEach(function (a) { eq(p.glEnding[a.accountId], a.closing / 100, basis + ' GL closing ' + a.label); });
          eq(v['inc.total'], v['pl.income'] + v['pl.oi'], 'income details = income + other income');
        });
      });
    });
  });

  test('Workbook: sheets, names, tables, links, chart, protection option, subsets and the row limit', function () {
    var W = OB.workbook;
    return designerBook().then(function (b) {
      var r = W.build(b, { from: '2025-01-01', to: '2025-12-31', protect: true }), files = unzipStored(r.bytes), wbx = files['xl/workbook.xml'];
      eq((wbx.match(/<sheet name=/g) || []).length, 14, '12 reports + My Analysis + source data');
      ['Dashboard', 'Profit &amp; Loss', 'Balance Sheet', 'Cash Flow', 'Trial Balance', 'General Ledger', 'Income Details', 'Expense Details', 'AR Aging', 'AP Aging', 'Journal Entries', 'Account Index', 'My Analysis', 'Data - Ledger Lines'].forEach(function (n) { ok(wbx.indexOf('name="' + n + '"') > 0, n); });
      ['FromDate', 'ToDate', 'FYStart', 'L_Date', 'L_Amt', 'L_Net', 'L_Key'].forEach(function (n) { ok(wbx.indexOf('<definedName name="' + n + '"') > 0, 'name ' + n); });
      ok(Object.keys(files).some(function (k) { return /^xl\/tables\//.test(k) && /name="VB_Lines"/.test(files[k]); }) && Object.keys(files).some(function (k) { return /name="VB_Journal"/.test(files[k]); }), 'source data and journal are Excel tables');
      ok(files['xl/charts/chart1.xml'] && files['xl/drawings/drawing1.xml'], 'dashboard chart');
      var sheetOf = function (n) { var i = (wbx.match(/<sheet name="[^"]*"/g) || []).findIndex(function (x) { return x.indexOf('"' + n + '"') > 0; }); return files['xl/worksheets/sheet' + (i + 1) + '.xml']; };
      ok(/<sheetProtection /.test(sheetOf('Data - Ledger Lines')) && !/<sheetProtection /.test(sheetOf('Profit &amp; Loss')), 'protection only on source data, only when asked');
      ok(!/<sheetProtection /.test(unzipStored(W.build(b, { from: '2025-01-01', to: '2025-12-31' }).bytes)['xl/worksheets/sheet14.xml']), 'not protected by default');
      ok(/<dataValidation type="date"/.test(sheetOf('Dashboard')), 'From/To are date inputs');
      var plainXml = sheetOf('Profit &amp; Loss').replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
      ok(/SUMIFS\(L_Amt,L_Key,\$A\d+,L_Date,">="&FromDate,L_Date,"<="&ToDate\)/.test(plainXml), 'P&L amounts are SUMIFS on the date cells');
      var pl = sheetOf('Profit &amp; Loss');
      ok(/location="'General Ledger'!B\d+"/.test(pl) && /location="'Income Details'!A1"/.test(pl), 'P&L links to ledgers and to Income Details');
      ok(/location="'Journal Entries'!A\d+"/.test(sheetOf('General Ledger')) && /location="'Profit &amp; Loss'!A1"/.test(sheetOf('Income Details')), 'ledger lines link to journal entries; details link back');
      ok(/outlineLevel="1"/.test(sheetOf('General Ledger')) && /<autoFilter ref=/.test(sheetOf('General Ledger')), 'grouped rows and filters in the ledger');
      ok(/<conditionalFormatting/.test(sheetOf('Balance Sheet')) && /<tabColor rgb="FF808080"\/>/.test(sheetOf('Data - Ledger Lines')), 'conditional formats and tab colours');
      // a subset still works and never links to a missing sheet
      var sub = unzipStored(W.build(b, { from: '2025-01-01', to: '2025-12-31', sheets: { pl: true } }).bytes), sw = sub['xl/workbook.xml'];
      eq((sw.match(/<sheet name=/g) || []).length, 3, 'Dashboard, P&L and data');
      Object.keys(sub).filter(function (k) { return /worksheets\/sheet/.test(k); }).forEach(function (k) { (sub[k].match(/location="'([^']+)'/g) || []).forEach(function (m) { var n = m.slice(11, -1); ok(sw.indexOf('name="' + n.replace(/&/g, '&amp;') + '"') > 0 || sw.indexOf('name="' + n + '"') > 0, k + ' links to missing sheet ' + n); }); });
      var keep = W.MAX_ROWS; W.MAX_ROWS = 20;
      try { var msg = ''; try { W.plan(b, { from: '2025-01-01', to: '2025-12-31' }); } catch (e) { msg = e.message; } ok(/more than one Excel sheet can hold/.test(msg), msg); } finally { W.MAX_ROWS = keep; }
      var bad = ''; try { W.plan(b, { from: '2025-12-31', to: '2025-01-01' }); } catch (e) { bad = e.message; } ok(/valid reporting period/.test(bad));
    });
  });

  test('Company name: required and at most 120 characters when edited', function () {
    return newBook().then(function (b) {
      var was = b.company.name;
      return rejects(b.saveCompany({ name: new Array(122).join('X') }), /120 characters/)
        .then(function () { eq(b.company.name, was, 'a rejected name changes nothing'); return rejects(b.saveCompany({ name: '  ' }), /required/); })
        .then(function () { return b.saveCompany({ name: new Array(121).join('Y') }); })
        .then(function () { eq(b.company.name.length, 120); });
    });
  });

  test('Company logo: optional, image data URLs only, size-limited, removable', function () {
    return newBook().then(function (b) {
      ok(!b.company.logo, 'no logo by default');
      var png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
      return b.saveCompany({ logo: png }).then(function () { eq(b.company.logo, png); })
        .then(function () { return rejects(b.saveCompany({ logo: 'data:text/html;base64,PHNjcmlwdD4=' }), /PNG, JPEG/); })
        .then(function () { return rejects(b.saveCompany({ logo: 'javascript:alert(1)' }), /PNG, JPEG/); })
        .then(function () { return rejects(b.saveCompany({ logo: 'data:image/png;base64,' + new Array(1400002).join('A') }), /too large/); })
        .then(function () { eq(b.company.logo, png, 'rejected saves change nothing'); return b.saveCompany({ logo: '' }); })
        .then(function () { eq(b.company.logo, ''); return b.saveCompany({ name: 'Renamed' }); })
        .then(function () { eq(b.company.logo, '', 'other saves leave the logo alone'); });
    });
  });

  test('Invoice layout: reference geometry, wrapping, page overflow; screen and PDF draw the same text', function () {
    var L = OB.invoiceLayout;
    return newBook({ name: 'Layout Co' }).then(function (b) {
      return b.saveCompany({ address: '1 Main St\nPhoenix, AZ 85001', email: 'ar@x.example', phone: '480' }).then(function () { return cust(b, 'Hospital'); }).then(function (c) {
        var lines = []; for (var i = 0; i < 40; i++) lines.push({ accountId: acc(b, 'Services'), description: 'Line ' + i + (i === 0 ? ' ' + new Array(40).join('very long description ') : ''), amount: '10' });
        return Promise.all([b.saveTransaction({ type: 'invoice', date: '2026-10-08', contactId: c.id, lines: [lines[1]] }), b.saveTransaction({ type: 'invoice', date: '2026-10-09', contactId: c.id, lines: lines })]);
      }).then(function (ts) {
        var one = L.pages(b, ts[0]);
        eq(one.length, 1);
        var find = function (ops, s) { return ops.find(function (o) { return o.t === 'text' && o.s === s; }); };
        var inv = find(one[0], 'Invoice'); eq(inv.x, 570.4); eq(inv.y, 45.12); eq(inv.size, 21.12); eq(inv.font, 'arialb'); eq(inv.align, 'right');
        eq(find(one[0], '10/8/2026').y, 88.08, 'date m/d/yyyy in the box'); eq(find(one[0], 'Layout Co').y, 66.72); eq(Math.round(find(one[0], 'Tel # 480').y * 100) / 100, 129.6);
        eq(find(one[0], 'Total').x, 439.44); ok(find(one[0], 'Thank you for your business.'));
        eq(one[0].filter(function (o) { return o.t === 'line'; }).length, 48, 'boxes as on the reference');
        ok(!one[0].some(function (o) { return o.t === 'image'; }), 'no logo by default');
        var many = L.pages(b, ts[1]);
        eq(many.length, 2, 'long invoice continues on a second page');
        ok(find(many[0], 'Continued on the next page.') && !find(many[0], 'Total') && find(many[1], 'Total') && find(many[1], 'Page 2 of 2'), 'total only on the last page');
        var body = many[0].filter(function (o) { return o.t === 'text' && o.x === 39.12 && o.y >= 356; });
        ok(body.every(function (o) { return OB.pdf.measure(o.s, 9.12, 'tnr') <= 427.4 - 39.12 - 4 + 0.01; }), 'wrapped to the description column');
        var pdf = L.pdf(many, {}, 'x'), str = ''; for (var k = 0; k < pdf.length; k++) str += String.fromCharCode(pdf[k]);
        eq(+/\/Count (\d+)/.exec(str)[1], 2); ok(/\/BaseFont \/TimesNewRomanPSMT/.test(str) && /\/BaseFont \/Arial-BoldMT/.test(str), 'reference fonts named in the PDF');
        var svg = L.svg(one[0]); ok(/viewBox="0 0 612 792"/.test(svg) && svg.indexOf('>Thank you for your business.</text>') > 0, 'SVG page');
      });
    });
  });

  test('QuickBooks .iif export: selected invoices round-trip into a new company with the same customers, lines and totals', function () {
    var src, inv = [];
    return newBook({ name: 'Source Co' }).then(function (b) { src = b; return b.saveAccount({ name: 'Consulting', type: 'income', parentId: acc(b, 'Services') }); })
      .then(function (sub) {
        src._sub = sub.id;
        return src.saveItem({ name: 'Radiology read', type: 'service', price: '125', incomeAccountId: sub.id, description: 'Professional interpretation' });
      })
      .then(function (it) {
        src._item = it.id;
        return src.saveContact({ kind: 'customer', name: 'Upland Hills: Health "North"', address: '800 Compassion Way\nDodgeville, WI 53533', email: 'ap@upland.example' });
      })
      .then(function (c) {
        var mk = function (o) { return src.saveTransaction(Object.assign({ type: 'invoice', contactId: c.id }, o)).then(function (t) { inv.push(t); return t; }); };
        return mk({ date: '2026-10-08', number: '1276', terms: 30, memo: 'September 2026', lines: [{ accountId: src._sub, itemId: src._item, description: 'Reads\tfor September', qty: 3, rate: '125' }, { accountId: acc(src, 'Services'), description: 'On-site visit', amount: '22400' }] })
          .then(function () { return mk({ date: '2026-10-21', number: '1288', lines: [{ accountId: acc(src, 'Services'), description: 'License fee', amount: '2499.75' }] }); })
          .then(function () { return mk({ date: '2026-10-22', number: '1290', lines: [{ accountId: acc(src, 'Services'), description: 'Not selected', amount: '10' }] }); })
          .then(function () { return src.saveTransaction({ type: 'salesReceipt', date: '2026-10-22', contactId: c.id, accountId: acc(src, 'Checking'), lines: [{ accountId: acc(src, 'Sales'), amount: '5' }] }); });
      })
      .then(function (sr) {
        var r = OB.qbexport.invoicesIIF(src, [inv[0].id, inv[1].id, sr.id, 'nope']);
        eq(r.count, 2); eq(r.total, inv[0].total + inv[1].total); eq(r.skipped.length, 2, 'sales receipt and unknown id skipped');
        ok(/\r\n/.test(r.text) && r.text.split('\r\n').every(function (l) { return l.indexOf('\n') < 0; }), 'CRLF lines');
        ok(r.text.indexOf('ACCNT\tServices:Consulting\tINC') >= 0 && r.text.indexOf('ACCNT\tServices\tINC') < r.text.indexOf('ACCNT\tServices:Consulting'), 'parent account before sub-account');
        ok(r.text.indexOf('TRNS\t\tINVOICE\t10/8/2026\tAccounts Receivable (A/R)\tUpland Hills- Health \'North\'\t\t22775.00\t1276\tSeptember 2026\tN\tN\tN') >= 0, 'TRNS line: date m/d/yyyy, A/R, name without colon or quotes, total');
        ok(r.text.indexOf('SPL\t\tINVOICE\t10/8/2026\tServices:Consulting\t\t\t-375.00\t1276\tReads for September\tN\t-3\t125.00\tRadiology read\tN') >= 0, 'SPL line with quantity, rate and item');
        ok(r.text.indexOf('1290') < 0, 'unselected invoice not exported');
        ok(/\tNet 30\r\n/.test(r.text), 'terms');
        // parse back with the QuickBooks importer and import into a fresh company
        var model = OB.qbimport.read([{ name: 'invoices.iif', text: r.text }]);
        eq(model.errors.length, 0, model.errors.join(' '));
        eq(model.txns.length, 2);
        ok(model.txns.every(function (t) { return U.sum(t.rows, function (x) { return x.amount; }) === 0; }), 'each exported invoice balances');
        return newBook({ name: 'QuickBooks Co' }).then(function (dst) {
          var plan = OB.qbimport.plan(model, dst);
          if (plan.errors.length) throw new Error(plan.errors.join(' | '));
          return dst.importBundle(plan.bundle).then(function () {
            var got = dst.posted().filter(function (t) { return t.type === 'invoice'; }).sort(OB.Book.cmpTxn);
            eq(got.length, 2, 'two invoices imported');
            eq(got[0].number, '1276'); eq(got[0].total, inv[0].total); eq(got[1].total, inv[1].total);
            eq(dst.contactById[got[0].contactId].name, "Upland Hills- Health 'North'");
            eq(dst.accountBalance(dst.sys('AR').id), inv[0].total + inv[1].total, 'A/R in the new company equals the exported invoices');
            ok(dst.items.some(function (x) { return x.name === 'Radiology read'; }), 'item created');
            ok(dst.accounts.some(function (a) { return a.name === 'Consulting' && dst.accById[a.parentId] && dst.accById[a.parentId].name === 'Services'; }), 'sub-account recreated under its parent');
          });
        });
      });
  });

  test('CSV export neutralizes formula injection and round-trips quotes', function () {
    var csv = U.toCSV([['=SUM(A1)', 'a,b', 'say "hi"', '-12.50']]);
    eq(csv, "'=SUM(A1),\"a,b\",\"say \"\"hi\"\"\",-12.50");
    var back = U.parseCSV('a,"b,c","d ""e"""\r\n1,2,3');
    eq(back[0][1], 'b,c'); eq(back[0][2], 'd "e"'); eq(back.length, 2);
  });

  test('Security: password unlocks, wrong password and wrong recovery key are rejected', function () {
    var C = OB.sec, setup;
    return C.setup('Correct Horse 42!', { hint: 'horse' }).then(function (r) {
      setup = r;
      ok(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){7}$/.test(r.recoveryKey), 'recovery key format');
      ok(JSON.stringify(r.security).indexOf('Correct Horse') < 0, 'password not stored');
      eq(r.security.password.iterations, 600000);
      return C.unlock(r.security, 'Correct Horse 42!');
    }).then(function (k) {
      ok(k, 'unlocked');
      return rejects(C.unlock(setup.security, 'correct horse 42!'), /Incorrect password/);
    }).then(function () {
      return C.unlock(setup.security, setup.recoveryKey.toLowerCase().replace(/-/g, ' '), 'recovery');
    }).then(function (k2) {
      ok(k2, 'recovery key works in any case/spacing');
      return rejects(C.unlock(setup.security, 'AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA', 'recovery'), /recovery key/);
    }).then(function () { eq(C.passwordProblems('short').length > 0, true); eq(C.passwordProblems('Test Co', 'test co').length > 0, true); });
  });

  test('Security: records are bound to their location and tampering is detected', function () {
    var C = OB.sec, dek;
    return C.newDataKey().then(function (k) { dek = k; return C.encryptJson(dek, { name: 'Acme', amount: 100000 }, 'transactions/t1'); }).then(function (e) {
      return C.decryptJson(dek, e, 'transactions/t1').then(function (v) {
        eq(v.amount, 100000);
        return rejects(C.decryptJson(dek, e, 'transactions/t2'), /could not be decrypted/, 'record moved to another id');
      }).then(function () {
        var bad = new Uint8Array(e.ct.slice(0)); bad[3] ^= 1;
        return rejects(C.decryptJson(dek, { iv: e.iv, ct: bad.buffer }, 'transactions/t1'), /could not be decrypted/, 'flipped bit');
      });
    });
  });

  test('Security: encrypted backup has no readable data and restores with password or recovery key', function () {
    var b, r, json;
    return newBook().then(function (x) { b = x; return cust(b, 'Very Secret Customer'); }).then(function (c) {
      return b.saveTransaction({ type: 'invoice', date: '2025-01-01', contactId: c.id, lines: [{ accountId: acc(b, 'Sales'), amount: '4321.98', description: 'Confidential work' }] });
    }).then(function () { return OB.sec.setup('Ledger-Pass-2025'); }).then(function (x) {
      r = x; b.dek = r.dek; b.security = r.security;
      return OB.backup.createEncrypted(b);
    }).then(function (enc) {
      json = JSON.stringify(enc);
      ok(json.indexOf('Very Secret Customer') < 0 && json.indexOf('Confidential') < 0 && json.indexOf('4321') < 0, 'no plaintext in encrypted backup');
      var v = OB.backup.validate(JSON.parse(json)); ok(!v.ok && v.needsPassword, 'validator asks for the password');
      return rejects(OB.backup.decrypt(JSON.parse(json), 'wrong password!'), /Incorrect/);
    }).then(function () { return OB.backup.decrypt(JSON.parse(json), 'Ledger-Pass-2025'); }).then(function (d) {
      var v = OB.backup.validate(d.inner); ok(v.ok, v.errors.join('; ')); eq(v.summary.transactions, 1);
      return OB.backup.decrypt(JSON.parse(json), r.recoveryKey, 'recovery');
    }).then(function (d2) { ok(OB.backup.validate(d2.inner).ok, 'recovery key opens backup'); });
  });

  /* ---------- 1.7: classes, statements, budgets, 1099, builder, saved reports ---------- */
  function classBook() {
    var b, C = {};
    return newBook().then(function (x) { b = x; return b.saveCompany({ useClasses: true }); })
      .then(function () { return b.saveClass({ name: 'Retail' }); }).then(function (c) { C.retail = c; return b.saveClass({ name: 'East', parentId: c.id }); })
      .then(function (c) { C.east = c; return b.saveClass({ name: 'Online' }); }).then(function (c) { C.online = c; return cust(b, 'Shop'); })
      .then(function (c) {
        return b.saveTransaction({ type: 'salesReceipt', date: '2025-02-10', contactId: c.id, accountId: acc(b, 'Checking'), lines: [
          { accountId: acc(b, 'Sales'), amount: '1000', classId: C.east.id }, { accountId: acc(b, 'Sales'), amount: '400', classId: C.online.id }, { accountId: acc(b, 'Services'), amount: '100' }] });
      })
      .then(function () { return b.saveTransaction({ type: 'expense', date: '2025-02-12', accountId: acc(b, 'Checking'), classId: C.online.id, lines: [{ accountId: acc(b, 'Advertising & Marketing'), amount: '250' }] }); })
      .then(function () { return { b: b, C: C }; });
  }

  test('Classes: lines carry classes into splits; header class fills untagged lines', function () {
    return classBook().then(function (x) {
      var b = x.b, sr = b.transactions.find(function (t) { return t.type === 'salesReceipt'; });
      var byCls = {}; sr.splits.forEach(function (s) { if (s.amount < 0) byCls[s.classId || ''] = (byCls[s.classId || ''] || 0) + s.amount; });
      eq(byCls[x.C.east.id], -100000); eq(byCls[x.C.online.id], -40000); eq(byCls[''], -10000);
      var ex = b.transactions.find(function (t) { return t.type === 'expense'; });
      ok(ex.splits.every(function (s) { return s.classId === x.C.online.id; }), 'transaction class applies to every split');
      eq(b.classFullName(x.C.east.id), 'Retail:East');
      eq(b.checkIntegrity().issues.length, 0, 'integrity');
      return rejects(b.saveClass({ name: 'retail' }), /already exists/);
    });
  });

  test('Classes: inactive classes cannot be used on new transactions', function () {
    return classBook().then(function (x) {
      return x.b.saveClass(Object.assign({}, x.C.online, { active: false })).then(function () {
        return rejects(x.b.saveTransaction({ type: 'expense', date: '2025-03-01', accountId: acc(x.b, 'Checking'), lines: [{ accountId: acc(x.b, 'Meals'), amount: '10', classId: x.C.online.id }] }), /inactive/);
      });
    });
  });

  test('Statement: P&L totals match the classic engine; class columns and filters add up', function () {
    return classBook().then(function (x) {
      var b = x.b, R2 = OB.reports;
      var st = R2.statement(b, { kind: 'pl', from: '2025-01-01', to: '2025-12-31', columns: 'total' });
      var old = R2.pnl(b, { from: '2025-01-01', to: '2025-12-31' });
      eq(st.sections.net.cells[0], old.netIncome[0], 'net income');
      eq(st.sections.income.cells[0], 150000);
      var byc = R2.statement(b, { kind: 'pl', from: '2025-01-01', to: '2025-12-31', columns: 'class' });
      var labels = byc.cols.map(function (c) { return c.label; });
      ok(labels.indexOf('Retail:East') >= 0 && labels.indexOf('Online') >= 0 && labels.indexOf('Not specified') >= 0 && labels[labels.length - 1] === 'Total', labels.join(','));
      ok(labels.indexOf('Retail') < 0, 'class with no own activity hidden');
      var inc = byc.sections.income.cells;
      eq(inc.slice(0, -1).reduce(function (a, v) { return a + v; }, 0), inc[inc.length - 1], 'class columns sum to total');
      var retail = R2.statement(b, { kind: 'pl', from: '2025-01-01', to: '2025-12-31', classId: x.C.retail.id });
      eq(retail.sections.income.cells[0], 100000, 'parent class filter includes sub-classes');
      var none = R2.statement(b, { kind: 'pl', from: '2025-01-01', to: '2025-12-31', classId: '__none' });
      eq(none.sections.income.cells[0], 10000, 'unclassified filter');
    });
  });

  test('Statement: comparisons, % of income, sub-account rollups and month columns', function () {
    var b;
    return newBook().then(function (x) { b = x; return b.saveAccount({ name: 'Online Ads', type: 'expense', parentId: acc(b, 'Advertising & Marketing') }); })
      .then(function () { return cust(b, 'C'); })
      .then(function (c) { return b.saveTransaction({ type: 'salesReceipt', date: '2025-03-05', contactId: c.id, accountId: acc(b, 'Checking'), lines: [{ accountId: acc(b, 'Sales'), amount: '2000' }] }); })
      .then(function () { return b.saveTransaction({ type: 'salesReceipt', date: '2024-03-05', contactId: b.contacts[0].id, accountId: acc(b, 'Checking'), lines: [{ accountId: acc(b, 'Sales'), amount: '1000' }] }); })
      .then(function () { return b.saveTransaction({ type: 'expense', date: '2025-03-06', accountId: acc(b, 'Checking'), lines: [{ accountId: acc(b, 'Advertising & Marketing'), amount: '100' }, { accountId: acc(b, 'Online Ads'), amount: '300' }] }); })
      .then(function () {
        var R2 = OB.reports;
        var st = R2.statement(b, { kind: 'pl', from: '2025-01-01', to: '2025-12-31', compare: ['py', 'chg', 'pchg', 'inc'] });
        var lbl = st.cols.map(function (c) { return c.variant; }).join(',');
        eq(lbl, 'cur,py,chg,pchg,inc');
        var sales = st.sections.income.children[0];
        eq(sales.cells[0], 200000); eq(sales.cells[1], 100000); eq(sales.cells[2], 100000); eq(Math.round(sales.cells[3]), 100); eq(Math.round(sales.cells[4]), 100);
        var adv = st.sections.expense.children[0];
        eq(adv.kind, 'group', 'parent with sub-account becomes a group'); eq(adv.cells[0], 40000, 'rollup');
        ok(adv.children[0].ownRow && adv.children[0].cells[0] === 10000, 'parent own amount row');
        eq(Math.round(st.sections.expense.cells[4]), 20, '% of income');
        var mo = R2.statement(b, { kind: 'pl', from: '2025-01-01', to: '2025-06-30', columns: 'month' });
        eq(mo.cols.length, 7, 'six months + total');
        eq(mo.sections.net.cells[2], 160000, 'March net income'); eq(mo.sections.net.cells[6], 160000);
        var flat = R2.flattenStatement(st);
        ok(flat.some(function (r) { return /^Total .*Advertising & Marketing$/.test(r.label); }), 'Total for line');
      });
  });

  test('Statement: Balance Sheet groups, balances and equals the classic balance sheet', function () {
    return classBook().then(function (x) {
      var b = x.b, R2 = OB.reports;
      var st = R2.statement(b, { kind: 'bs', from: '2025-01-01', to: '2025-12-31', compare: ['pp', 'col'] });
      var old = R2.balanceSheet(b, { asOf: '2025-12-31' });
      ok(st.balanced, 'balanced');
      eq(st.sections.assets.cells[0], old.totalAssets);
      eq(st.sections.le.cells[0], old.totalLiabEquity);
      ok(st.sections.bank && st.sections.bank.children.length, 'Bank Accounts group');
      eq(Math.round(st.sections.assets.cells[2]), 100, '% of column for total assets');
    });
  });

  test('Statement: MTD and QTD columns equal a P&L for the month / fiscal quarter to date', function () {
    var b;
    return newBook({ fiscalYearStartMonth: 7 }).then(function (x) { b = x; return cust(b, 'C'); })
      .then(function (c) {
        var sale = function (d, amt) { return b.saveTransaction({ type: 'salesReceipt', date: d, contactId: c.id, accountId: acc(b, 'Checking'), lines: [{ accountId: acc(b, 'Sales'), amount: amt }] }); };
        return sale('2025-07-15', '100').then(function () { return sale('2025-09-02', '200'); }).then(function () { return sale('2025-10-03', '400'); }).then(function () { return sale('2025-11-20', '800'); });
      }).then(function () {
        var R2 = OB.reports;
        eq(R2.fiscalQuarterStart('2025-11-20', 7), '2025-10-01'); eq(R2.fiscalQuarterStart('2025-09-30', 7), '2025-07-01'); eq(R2.fiscalQuarterStart('2026-02-01', 1), '2026-01-01');
        var st = R2.statement(b, { kind: 'pl', from: '2025-11-01', to: '2025-11-30', compare: ['mtd', 'qtd', 'ytd', 'chg'] });
        eq(st.cols.map(function (c) { return c.variant; }).join(','), 'cur,mtd,qtd,ytd,chg');
        var inc = st.sections.income.cells;
        eq(inc[1], 80000, 'MTD'); eq(inc[2], 120000, 'QTD from Oct 1 (fiscal Q2)'); eq(inc[3], 150000, 'YTD from Jul 1');
        eq(inc[3], R2.netIncome(b, 'accrual', '2025-07-01', '2025-11-30'), 'YTD equals the ledger');
        eq(inc[4], 0, '$ change compares with the first time column (MTD)');
        var bs = R2.statement(b, { kind: 'bs', from: '2025-11-01', to: '2025-11-30', compare: ['mtd', 'qtd'] });
        eq(bs.cols.length, 1, 'balance sheet ignores MTD/QTD');
      });
  });

  test('Reconciliation: every main report ties to the ledger, and a broken tie is reported', function () {
    return classBook().then(function (x) {
      var b = x.b, R2 = OB.reports;
      return b.saveContact({ kind: 'vendor', name: 'V' }).then(function (v) {
        return b.saveTransaction({ type: 'bill', date: '2025-03-01', contactId: v.id, lines: [{ accountId: acc(b, 'Rent & Lease'), amount: '700' }] });
      }).then(function () {
        ['accrual', 'cash'].forEach(function (basis) {
          var r = R2.reconcile(b, { from: '2025-01-01', to: '2025-12-31', basis: basis });
          eq(r.checks.length, 8);
          ok(r.ok, basis + ': ' + r.checks.filter(function (c) { return !c.ok; }).map(function (c) { return c.label; }).join('; '));
        });
        var orig = R2.cashFlow;
        R2.cashFlow = function () { var c = orig.apply(this, arguments); c.cashEnd += 1; return c; };
        try { var bad = R2.reconcile(b, { from: '2025-01-01', to: '2025-12-31' }); ok(!bad.ok && !bad.checks.find(function (c) { return c.id === 'cf'; }).ok, 'tampered cash flow is caught'); }
        finally { R2.cashFlow = orig; }
      });
    });
  });

  test('Budgets: save, Budget vs. Actuals and month allocation', function () {
    return classBook().then(function (x) {
      var b = x.b;
      return rejects(b.saveBudget({ name: '', fyStart: '2025-01-01' }), /name/).then(function () {
        var amounts = {}; amounts[acc(b, 'Sales')] = new Array(12).fill('1000'); amounts[acc(b, 'Advertising & Marketing')] = new Array(12).fill('100'); amounts[acc(b, 'Checking')] = new Array(12).fill('5');
        return b.saveBudget({ name: 'Plan', fyStart: '2025-01-15', amounts: amounts });
      }).then(function (bud) {
        eq(bud.fyStart, '2025-01-01'); ok(!bud.amounts[acc(b, 'Checking')], 'balance sheet accounts are ignored');
        var st = OB.reports.statement(b, { kind: 'bva', from: '2025-01-01', to: '2025-03-31', budgetId: bud.id });
        eq(st.cols.map(function (c) { return c.variant; }).join(','), 'cur,bud,var,pbud');
        var sales = st.sections.income.children.find(function (n) { return n.accountId === acc(b, 'Sales'); });
        eq(sales.cells[0], 140000); eq(sales.cells[1], 300000); eq(sales.cells[2], -160000); eq(Math.round(sales.cells[3]), 47);
        return b.deleteBudget(bud.id).then(function () { eq(b.activeBudgets().length, 0); });
      });
    });
  });

  test('1099: bank payments to tracked vendors by box; card payments excluded; threshold', function () {
    var b, v;
    return newBook().then(function (x) { b = x; return b.saveContact({ kind: 'vendor', name: 'Joe Contractor', is1099: true, taxId: '123-45-6789' }); })
      .then(function (c) { v = c; var m = {}; m[acc(b, 'Contractors')] = 'NEC1'; m[acc(b, 'Rent & Lease')] = 'MISC1'; return b.saveCompany({ map1099: m }); })
      .then(function () { return b.saveTransaction({ type: 'bill', date: '2026-02-01', contactId: v.id, lines: [{ accountId: acc(b, 'Contractors'), amount: '1500' }, { accountId: acc(b, 'Rent & Lease'), amount: '500' }] }); })
      .then(function (bill) { return b.saveTransaction({ type: 'billPayment', date: '2026-02-10', contactId: v.id, accountId: acc(b, 'Checking'), amount: '1000', applications: [{ txnId: bill.id, amount: '1000' }] }); })
      .then(function () { return b.saveTransaction({ type: 'check', date: '2026-03-01', contactId: v.id, accountId: acc(b, 'Checking'), lines: [{ accountId: acc(b, 'Contractors'), amount: '1500' }] }); })
      .then(function () { return b.saveTransaction({ type: 'expense', date: '2026-03-02', contactId: v.id, accountId: acc(b, 'Business Credit Card'), lines: [{ accountId: acc(b, 'Contractors'), amount: '700' }] }); })
      .then(function () {
        var r = OB.reports.report1099(b, { year: 2026 });
        eq(r.rows.length, 1);
        eq(r.rows[0].boxes.NEC1, 225000, 'NEC: 750 of the bill payment + 1500 check, card excluded');
        eq(r.rows[0].boxes.MISC1, 25000, 'rent share of the bill payment');
        ok(r.rows[0].meets, 'over the $2,000 threshold'); ok(!r.rows[0].missingTaxId);
        eq(OB.schema.threshold1099('NEC1', 2025), 60000); eq(OB.schema.threshold1099('NEC1', 2026), 200000);
        eq(OB.reports.report1099(b, { year: 2025 }).rows.length, 0, 'other year');
      });
  });

  test('Report builder: filters, grouping, totals and saved reports', function () {
    return classBook().then(function (x) {
      var b = x.b, R2 = OB.reports;
      var r = R2.builder(b, { from: '2025-01-01', to: '2025-12-31', accountTypes: ['income'], groupBy: 'class' });
      eq(r.totals.amount, 150000); eq(r.groups.length, 3);
      eq(r.groups.find(function (g) { return g.label === 'Retail:East'; }).totals.amount, 100000);
      var big = R2.builder(b, { from: '2025-01-01', to: '2025-12-31', minAmount: 50000 });
      ok(big.lines.every(function (l) { return Math.abs(l.debit || l.credit) >= 50000; }), 'min amount');
      var txt = R2.builder(b, { from: '2025-01-01', to: '2025-12-31', text: 'advertising' });
      ok(txt.lines.length >= 1 && txt.lines.every(function (l) { return /advertising/i.test(l.account + l.memo); }), 'text filter');
      var mo = R2.builder(b, { from: '2025-01-01', to: '2025-12-31', groupBy: 'month', summary: true });
      eq(mo.groups.length, 1); eq(mo.groups[0].label, 'Feb 2025');
      return b.saveReport({ name: 'Income by class', report: 'builder', params: { cfg: { groupBy: 'class' } } }).then(function (rp) {
        eq(b.savedReports().length, 1);
        return rejects(b.saveReport({ name: 'income BY class', report: 'pnl' }), /already exists/).then(function () { return b.deleteReport(rp.id); });
      }).then(function () { eq(b.savedReports().length, 0); });
    });
  });

  test('Data v2 → v4 migration and backup round trip keep classes, budgets and saved reports', function () {
    return classBook().then(function (x) {
      var b = x.b;
      var old = { company: { name: 'Old', dataVersion: 2, counters: {} }, accounts: [], contacts: [], transactions: [], rules: [], recurring: [], reconciliations: [], audit: [] };
      OB.schema.migrate(old);
      eq(old.company.dataVersion, OB.schema.DATA_VERSION); ok(Array.isArray(old.classes) && Array.isArray(old.budgets) && Array.isArray(old.reports)); eq(old.company.useClasses, false);
      ok(Array.isArray(old.items) && Array.isArray(old.company.imports), 'v3 -> v4 adds items and import history');
      return b.saveReport({ name: 'Mine', report: 'pnl', params: { by: 'month' } }).then(function () {
        var bk = JSON.parse(JSON.stringify(OB.backup.create(b)));
        var v = OB.backup.validate(bk); ok(v.ok, (v.errors || []).join('; '));
        eq(bk.data.classes.length, 3); eq(bk.data.reports.length, 1);
      });
    });
  });

  /* ---------- QuickBooks migration ---------- */
  var QBFILES = ['Chart_of_Accounts.IIF', 'Customer_List.IIF', 'Vendor_List.IIF', 'Other_Name_List.IIF', 'Payment_terms_list.IIF', 'Item_List.IIF', 'Class_List.IIF', 'General_Ledger.CSV'];
  function qbFiles() {
    if (typeof require === 'function' && typeof window === 'undefined') {
      var fs = require('fs'), path = require('path');
      return Promise.resolve(QBFILES.map(function (n) { return { name: n, text: fs.readFileSync(path.join(__dirname, 'fixtures', 'qb', n), 'latin1') }; }));
    }
    return Promise.all(QBFILES.map(function (n) { return fetch('fixtures/qb/' + n).then(function (r) { return r.text(); }).then(function (t) { return { name: n, text: t }; }); }));
  }
  function qbImported() {
    return Promise.all([newBook(), qbFiles()]).then(function (x) {
      var b = x[0], model = OB.qbimport.read(x[1]), plan = OB.qbimport.plan(model, b);
      if (plan.errors.length) throw new Error(plan.errors.join(' | '));
      return b.importBundle(plan.bundle).then(function () { return { b: b, plan: plan, model: model }; });
    });
  }
  test('QuickBooks import: files are recognised and the ledger is rebuilt into balanced transactions', function () {
    return qbFiles().then(function (files) {
      var kinds = files.map(function (f) { return OB.qbimport.detect(f.name, f.text).kind; });
      eq(kinds.filter(function (k) { return k === 'iif'; }).length, 7); eq(kinds[7], 'ledger-csv');
      var model = OB.qbimport.read(files);
      eq(model.errors.length, 0, model.errors.join(' '));
      ok(model.txns.every(function (t) { return U.sum(t.rows, function (r) { return r.amount; }) === 0; }), 'every rebuilt transaction balances');
      var checks101 = model.txns.filter(function (t) { return t.qbType === 'Check' && t.num === '101'; });
      eq(checks101.length, 2, 'two identical checks are split by their bank lines');
      eq(OB.qbimport.qbDate('1/5/25'), '2025-01-05'); eq(OB.qbimport.cents('"(1,234.50)"'.replace(/"/g, '')), -123450);
    });
  });
  test('QuickBooks import: balances, documents, contacts, items and classes match QuickBooks', function () {
    return qbImported().then(function (x) {
      var b = x.b, plan = x.plan;
      var cmp = OB.qbimport.compareBalances(b, plan.expected);
      ok(cmp.ok, 'every account equals the QuickBooks balance: ' + JSON.stringify(cmp.rows.filter(function (r) { return !r.ok; })));
      var integ = b.checkIntegrity(); eq(integ.issues.length, 0, integ.issues.join('; '));
      var type = function (t) { return b.transactions.filter(function (x) { return x.type === t; }).length; };
      eq(type('invoice'), 3); eq(type('payment'), 2); eq(type('bill'), 1); eq(type('billPayment'), 1); eq(type('transfer'), 1); eq(type('check'), 3); eq(type('journal'), 1); eq(type('deposit'), 2);
      // payment recorded before its invoice (QuickBooks allows it) is applied by the number in its reference
      var inv1001 = b.transactions.find(function (t) { return t.type === 'invoice' && t.number === '1001'; });
      eq(b.openBalance(inv1001), 0, 'Inv 1001 paid by the earlier-dated payment');
      var inv1003 = b.transactions.find(function (t) { return t.type === 'invoice' && t.number === '1003'; });
      eq(b.openBalance(inv1003), 150000, 'Acme 1003 stays open (the Beta payment cannot apply to it)');
      eq(b.accountBalance(b.sys('AR').id), 120000);
      // sub-accounts, numbers, system accounts mapped, unused defaults deactivated, hidden account inactive
      var cons = b.accounts.find(function (a) { return a.name === 'Consulting'; });
      eq(b.accountFullName(cons), 'Income:Consulting'); eq(cons.number, '40100');
      eq(b.sys('AR').name, 'Accounts Receivable'); eq(b.sys('UNDEP').number, '12000');
      ok(b.accounts.find(function (a) { return a.name === 'Checking'; }).active === false, 'unused default account made inactive');
      ok(b.accounts.find(function (a) { return a.name === 'Old Expense'; }).active === false, 'hidden QuickBooks account inactive');
      ok(!b.accounts.some(function (a) { return a.name === 'Estimates'; }), 'non-posting account skipped');
      ok(plan.warnings.some(function (w) { return /Non-posting/.test(w); }) && plan.warnings.some(function (w) { return /discount/i.test(w); }));
      // contacts with terms, addresses, 1099
      var acme = b.contacts.find(function (c) { return c.name === 'Acme Clinic'; });
      eq(acme.terms, 30); eq(acme.email, 'ap@acme.test'); ok(/12 Main St/.test(acme.address) && !/^Acme/.test(acme.address)); eq(acme.contactName, 'Pat Lee');
      eq(b.contacts.find(function (c) { return c.name === 'Beta Health, LLC'; }).terms, 0);
      ok(b.contacts.find(function (c) { return c.name === 'Dr. Smith Consulting'; }).is1099);
      ok(b.contacts.find(function (c) { return c.name === 'Gamma Labs'; }).active === false);
      eq(inv1001.dueDate, '2025-02-15', 'due date from customer terms');
      // items linked to invoice lines by description; classes imported and feature on
      eq(b.items.length, 3); ok(inv1001.lines[0].itemId === b.items.find(function (i) { return i.name === 'CONSULT'; }).id, 'invoice line linked to item');
      eq(b.classes.length, 2); ok(b.company.useClasses);
      eq(b.company.imports.length, 1);
      // backup round trip keeps items and import history
      var bk = JSON.parse(JSON.stringify(OB.backup.create(b))); var v = OB.backup.validate(bk);
      ok(v.ok, (v.errors || []).join('; ')); eq(bk.data.items.length, 3);
    });
  });
  test('QuickBooks import is all-or-nothing and refuses a company that already has transactions', function () {
    return qbImported().then(function (x) {
      var b = x.b, n = b.transactions.length;
      return qbFiles().then(function (files) {
        var plan = OB.qbimport.plan(OB.qbimport.read(files), b);
        return rejects(b.importBundle(plan.bundle), /already has transactions/).then(function () { eq(b.transactions.length, n); });
      });
    }).then(function () {
      return Promise.all([newBook(), qbFiles()]).then(function (y) {
        var b = y[0], plan = OB.qbimport.plan(OB.qbimport.read(y[1]), b);
        var bad = JSON.parse(JSON.stringify(plan.bundle));
        bad.transactions[bad.transactions.length - 1].jlines = [{ accountId: bad.transactions[0].lines ? bad.transactions[0].lines[0].accountId : '', debit: 100, credit: 0 }];
        bad.transactions[bad.transactions.length - 1].type = 'journal';
        var accBefore = b.accounts.length;
        return rejects(b.importBundle(bad), /could not be imported/).then(function () {
          eq(b.transactions.length, 0, 'nothing posted'); eq(b.accounts.length, accBefore, 'accounts restored'); eq(b.contacts.length, 0);
        });
      });
    });
  });
  test('QuickBooks import: a missing chart of accounts is reported instead of guessing', function () {
    return Promise.all([newBook(), qbFiles()]).then(function (y) {
      var files = y[1].filter(function (f) { return f.name !== 'Chart_of_Accounts.IIF'; });
      var plan = OB.qbimport.plan(OB.qbimport.read(files), y[0]);
      ok(plan.errors.some(function (e) { return /not in the chart of accounts/.test(e); }), plan.errors.join(' | '));
    });
  });
  test('QuickBooks import: a ledger section "Leaf - Other" posts to the parent sub-account, and -MULTIPLE- is not a payee', function () {
    var T = '\t', iif = ['!ACCNT' + T + 'NAME' + T + 'ACCNTTYPE', 'ACCNT' + T + 'Town Bank' + T + 'BANK', 'ACCNT' + T + 'Payroll Costs' + T + 'EXP',
      'ACCNT' + T + 'Payroll Costs:Staff Wages' + T + 'EXP', 'ACCNT' + T + 'Payroll Costs:Staff Wages:Night Desk' + T + 'EXP'].join('\r\n');
    var gl = ['"","Type","Date","Num","Adj","Name","Memo","Split","Debit","Credit","Balance"',
      '"Town Bank",,,,,,,,,,""', ',"Check","01/05/2025","11",,"-MULTIPLE-","Wages","-SPLIT-","",300.00,-300.00', '"Total Town Bank",,,,,,,,0.00,300.00,-300.00',
      '"Staff Wages - Other",,,,,,,,,,""', ',"Check","01/05/2025","11",,"-MULTIPLE-","Wages","Town Bank",200.00,"",200.00', '"Total Staff Wages - Other",,,,,,,,200.00,0.00,200.00',
      '"Night Desk",,,,,,,,,,""', ',"Check","01/05/2025","11",,"-MULTIPLE-","Wages","Town Bank",100.00,"",100.00', '"Total Night Desk",,,,,,,,100.00,0.00,100.00'].join('\r\n');
    return newBook().then(function (b) {
      var plan = OB.qbimport.plan(OB.qbimport.read([{ name: 'coa.IIF', text: iif }, { name: 'gl.CSV', text: gl }]), b);
      eq(plan.errors.length, 0, plan.errors.join(' | '));
      return b.importBundle(plan.bundle).then(function () {
        var w = b.accounts.find(function (a) { return a.name === 'Staff Wages'; });
        eq(b.accountBalance(w.id), 20000, 'the "- Other" lines sit on Staff Wages itself');
        ok(!b.contacts.some(function (c) { return /multiple/i.test(c.name); }), 'no -MULTIPLE- contact');
      });
    });
  });
  test('Statement layouts: twelve looks, saved on the company, each makes a PDF; two-sided sides agree', function () {
    var M = OB.reportModel;
    eq(M.LOOKS.length, 12); eq(M.lookOf('nope'), 'classic'); eq(M.MAJOR_LOOKS.join(), 'classic,lines,grid');
    return newBook().then(function (b) { return OB.sample.populate(b, '2026-06-30').then(function () { return b.saveCompany({ statementLook: 'two' }); }).then(function () {
      eq(b.company.statementLook, 'two');
      return b.saveCompany({ statementLook: 'junk' }); }).then(function () {
      eq(b.company.statementLook, 'classic', 'an unknown layout is stored as Classic');
      ['bs', 'pl'].forEach(function (kind) {
        var st = OB.reports.statement(b, { kind: kind, from: '2026-01-01', to: '2026-06-30', basis: 'accrual' });
        var t = M.twoSides(st); eq(t.left.total, t.right.total, kind + ' two-sided totals agree'); ok(t.right.total !== 0);
        M.LOOKS.forEach(function (L) {
          var model = M.fromStatement(st, { company: 'X', title: 'T', lines: ['p'], footer: [], nf: {}, look: L[0] });
          eq(model.look, L[0]);
          var pdf = M.toPdf(model, {}); ok(pdf.length > 800 && String.fromCharCode(pdf[0], pdf[1], pdf[2], pdf[3]) === '%PDF', kind + ' ' + L[0] + ' PDF');
          if (L[0] === 'two') { var r = M.twoSidesRows(model); eq(r.left.total, t.left.total); eq(r.right.total, t.right.total, 'the PDF split matches the screen'); }
        });
      });
    }); });
  });
  test('QuickBooks import: a ledger whose earlier years are closed (income and expense lines missing) is rebuilt from the Split column and completed from an all-dates P&L', function () {
    var T = '\t', iif = ['!HDR' + T + 'PROD' + T + 'VER' + T + 'REL' + T + 'IIFVER' + T + 'DATE', 'HDR' + T + 'QuickBooks' + T + '1' + T + 'R1' + T + '1' + T + '2026-06-30',
      '!ACCNT' + T + 'NAME' + T + 'ACCNTTYPE' + T + 'OBAMOUNT' + T + 'EXTRA', 'ACCNT' + T + 'Town Bank' + T + 'BANK' + T + '900.00' + T, 'ACCNT' + T + 'Retained Earnings' + T + 'EQUITY' + T + '0.00' + T + 'RETEARNINGS',
      'ACCNT' + T + 'Fees Earned' + T + 'INC' + T + '0.00' + T, 'ACCNT' + T + 'Rent Paid' + T + 'EXP' + T + '0.00' + T, 'ACCNT' + T + 'Wages Paid' + T + 'EXP' + T + '0.00' + T, 'ACCNT' + T + 'Sales TAX PAYABLE' + T + 'EXP' + T + '0.00' + T].join('\r\n');
    // 2024 is closed: the bank lines are there, their income and expense side is not; 2025 is complete
    var gl = ['"","Type","Date","Num","Adj","Name","Memo","Split","Debit","Credit","Balance"',
      '"Town Bank",,,,,,,,,,""', ',"Deposit","03/01/2024","",,"Pine Clinic","","Fees Earned",1000.00,"",1000.00', ',"Check","04/01/2024","11",,"Oak Realty","","Rent Paid","",300.00,700.00',
      ',"Check","05/01/2024","12",,"","payroll","-SPLIT-","",250.00,450.00', ',"Deposit","02/01/2025","",,"Pine Clinic","","Fees Earned",400.00,"",850.00', ',"Check","02/02/2025","13",,"Oak Realty","","Rent Paid","",150.00,700.00', '"Total Town Bank",,,,,,,,1400.00,700.00,700.00',
      '"Retained Earnings",,,,,,,,,,""', ',"Closing Entry","12/31/2024","",,"","","","",450.00,-450.00', '"Total Retained Earnings",,,,,,,,0.00,450.00,-450.00',
      '"Fees Earned",,,,,,,,,,""', ',"Deposit","02/01/2025","",,"Pine Clinic","","Town Bank","",400.00,-400.00', '"Total Fees Earned",,,,,,,,0.00,400.00,-400.00',
      '"Rent Paid",,,,,,,,,,""', ',"Check","02/02/2025","13",,"Oak Realty","","Town Bank",150.00,"",150.00', '"Total Rent Paid",,,,,,,,150.00,0.00,150.00'].join('\r\n');
    var files = [{ name: 'coa.IIF', text: iif }, { name: 'gl.CSV', text: gl }], Q = OB.qbimport;
    var pl = 'Profit & Loss\nJanuary 2024 through December 2025\nIncome\nFees Earned  1,400.00\nTotal Income  1,400.00\nExpense\nRent Paid  450.00\nWages Paid  250.00\nTotal Expense  700.00\nNet Income  700.00';
    return newBook().then(function (b) {
      var p = Q.plan(Q.read(files), b, {});
      eq(p.errors.length, 0, p.errors.join(' | '));
      ok(p.warnings.some(function (w) { return /closed in this ledger/.test(w) && /2 income and expense lines were put back/.test(w) && /1 transactions \(\$250\.00\)/.test(w); }), p.warnings.join(' | '));
      ok(p.warnings.some(function (w) { return /Sales TAX PAYABLE \(Expense\)/.test(w); }), 'a name shared with a system account is kept apart');
      eq(p.preview.openingMode, 'skip', 'list balances dated after the last transaction are not posted as opening balances'); ok(p.preview.balancesLater);
      return b.importBundle(p.bundle).then(function () {
        var acc = function (n) { return b.accounts.find(function (a) { return a.name === n; }); };
        eq(b.accountBalance(acc('Town Bank').id), 70000, 'bank equals the ledger'); eq(b.accountBalance(acc('Fees Earned').id), 140000); eq(b.accountBalance(acc('Rent Paid').id), 45000);
        eq(b.accountBalance(acc('Wages Paid').id), 0, 'the -SPLIT- check cannot be assigned without a report'); eq(b.rawBalance(acc('Retained Earnings').id), 25000);
      });
    }).then(function () { return newBook(); }).then(function (b) {
      var p = Q.plan(Q.read(files), b, { reportTexts: [pl] });
      ok(p.warnings.some(function (w) { return /QB-CLOSED/.test(w); }), p.warnings.join(' | '));
      return b.importBundle(p.bundle).then(function () {
        var acc = function (n) { return b.accounts.find(function (a) { return a.name === n; }); };
        eq(b.accountBalance(acc('Wages Paid').id), 25000, 'the P&L total completes the closed year'); eq(b.rawBalance(acc('Retained Earnings').id), 0, 'nothing is left parked in Retained Earnings');
        var v = Q.verifyText(b, pl.replace('Profit & Loss', 'Profit & Loss\nAll Transactions')); eq(v.mismatched.length, 0); ok(v.matched.length >= 3);
        // a report that does not cover all the imported dates is refused, not half-applied
        return newBook().then(function (b2) { var p2 = Q.plan(Q.read(files), b2, { reportTexts: [pl.replace('January 2024', 'January 2025')] }); ok(!p2.warnings.some(function (w) { return /QB-CLOSED/.test(w); })); });
      });
    });
  });
  test('QuickBooks import: a General Ledger printed to PDF is read by column position; account types come from the statement PDFs; opening balances are carried in', function () {
    var Q = OB.qbimport, R = function (p, items) { return { p: p, items: items.map(function (i) { return { x: i[0], w: i[1] || String(i[2]).length * 4.5, s: i[2] }; }) }; };
    var num = function (right, s) { var w = s.length * 4.5; return [right - w, w, s]; };   // amounts are right-aligned: debit ends at 588, credit at 666, balance at 751
    var hdr = function (p) { return [R(p, [[36, 30, '9:00 AM'], [300, 90, 'Maple Dental Inc']]), R(p, [[36, 30, '01/05/26'], [340, 70, 'General Ledger']]), R(p, [[36, 50, 'Accrual Basis'], [338, 80, 'As of December 31,'], [420, 20, '2025']]),
      R(p, [[95, 18, 'Type'], [168, 17, 'Date'], [220, 18, 'Num'], [258, 12, 'Adj'], [315, 22, 'Name'], [394, 23, 'Memo'], [468, 18, 'Split'], [543, 20, 'Debit'], [620, 23, 'Credit'], [698, 31, 'Balance']])]; };
    var line = function (p, type, date, n, name, memo, split, dr, cr, bal) { var it = [[68, 0, type], [152, 40, date]]; if (n) it.push([213, 0, n]); if (name) it.push([285, 0, name]); if (memo) it.push([377, 0, memo]); if (/\.\.\.$/.test(memo || '')) it.push([427, 7, '...']); if (split) it.push([446, 0, split]); if (dr) it.push(num(588, dr)); if (cr) it.push(num(666, cr)); it.push(num(751, bal)); return R(p, it); };
    var head = function (p, x, name, bal) { return R(p, [[x, 0, name], num(751, bal)]); }, total = function (p, x, name, dr, cr, bal) { return R(p, [[x, 0, 'Total ' + name], num(588, dr), num(666, cr), num(751, bal)]); };
    var gl = hdr(1).concat([head(1, 54, 'Town Bank # 0509', '1,000.00'),
      line(1, 'Deposit', '02/03/2025', '', '', '', 'Fees Earned', '500.00', '', '1,500.00'), line(1, 'Deposit', '02/03/2025', '', '', '', 'Fees Earned', '250.00', '', '1,750.00'),
      line(1, 'Check', '02/04/2025', '101', 'Oak Realty Managem', 'RENT FEB', 'Rent Paid', '', '300.00', '1,450.00'), line(1, 'Check', '02/05/2025', '', 'Corner Hardware', 'PAYPAL', 'Office Supplies...', '', '40.00', '1,410.00'),
      total(1, 54, 'Town Bank # 0509', '750.00', '340.00', '1,410.00'), R(1, [[380, 30, 'Page 1']])], hdr(2), [
      head(2, 54, 'Staff Loan', '0.00'), total(2, 54, 'Staff Loan', '0.00', '0.00', '0.00'),
      head(2, 54, 'Equipment', '2,000.00'), R(2, [[54, 0, 'Total Equipment'], num(751, '2,000.00')]),
      head(2, 54, 'Owner Capital', '-3,000.00'), R(2, [[54, 0, 'Total Owner Capital'], num(751, '-3,000.00')]),
      head(2, 54, 'Fees Earned', '0.00'), line(2, 'Deposit', '02/03/2025', '', '', '', 'Town Bank # ...', '', '500.00', '-500.00'), line(2, 'Deposit', '02/03/2025', '', '', '', 'Town Bank # ...', '', '250.00', '-750.00'), total(2, 54, 'Fees Earned', '0.00', '750.00', '-750.00'),
      head(2, 54, 'Occupancy', '0.00'), head(2, 66, 'Rent Paid', '0.00'), line(2, 'Check', '02/04/2025', '101', 'Oak Realty Managem', 'RENT FEB', 'Town Bank # ...', '300.00', '', '300.00'), total(2, 66, 'Rent Paid', '300.00', '0.00', '300.00'), total(2, 54, 'Occupancy', '300.00', '0.00', '300.00'),
      head(2, 54, 'Office Supplies and Postage', '0.00'), line(2, 'Check', '02/05/2025', '', 'Corner Hardware', 'PAYPAL', 'Town Bank # ...', '40.00', '', '40.00'), total(2, 54, 'Office Supplies and Postage', '40.00', '0.00', '40.00'),
      R(2, [[41, 0, 'TOTAL'], num(588, '1,090.00'), num(666, '1,090.00'), num(751, '0.00')])]);
    var bs = [R(1, [[36, 30, '9:00 AM'], [300, 90, 'Maple Dental Inc']]), R(1, [[36, 30, '01/05/26'], [340, 70, 'Balance Sheet']]), R(1, [[60, 0, 'ASSETS']]), R(1, [[70, 0, 'Checking/Savings']]), R(1, [[80, 0, 'Town Bank # 0509'], num(500, '1,410.00')]), R(1, [[70, 0, 'Total Checking/Savings'], num(500, '1,410.00')]),
      R(1, [[70, 0, 'Fixed Assets']]), R(1, [[80, 0, 'Equipment'], num(500, '2,000.00')]), R(1, [[70, 0, 'Total Fixed Assets'], num(500, '2,000.00')]), R(1, [[70, 0, 'Equity']]), R(1, [[80, 0, 'Owner Capital'], num(500, '3,000.00')]), R(1, [[80, 0, 'Net Income'], num(500, '410.00')]), R(1, [[70, 0, 'Total Equity'], num(500, '3,410.00')])];
    var pl = [R(1, [[36, 30, '01/05/26'], [340, 70, 'Profit & Loss']]), R(1, [[70, 0, 'Income']]), R(1, [[80, 0, 'Fees Earned'], num(500, '750.00')]), R(1, [[70, 0, 'Total Income'], num(500, '750.00')]),
      R(1, [[70, 0, 'Expense']]), R(1, [[80, 0, 'Occupancy']]), R(1, [[90, 0, 'Rent Paid'], num(480, '300.00')]), R(1, [[80, 0, 'Total Occupancy'], num(500, '300.00')]), R(1, [[80, 0, 'Office Supplies and Postage'], num(500, '40.00')]), R(1, [[70, 0, 'Total Expense'], num(500, '340.00')])];
    eq(Q.pdfKind(gl), 'gl'); eq(Q.pdfKind(bs), 'bs'); eq(Q.pdfKind(pl), 'pnl');
    var led = Q.pdfLedger(gl); eq(led.lines, 8); eq(led.asOf, '2025-12-31'); eq(led.accounts.length, 8);
    ok(/,Check,02\/04\/2025,101,,Oak Realty Managem,RENT FEB,Rent Paid,,,300\.00,"1,450\.00"/.test(led.csv), 'each text run lands in its column: ' + led.csv.split('\r\n')[4]);
    ok(/Occupancy:Rent Paid,/.test(led.csv), 'a sub-account heading carries its full name');
    var inp = Q.pdfInputs([{ name: 'GL.pdf', rows: gl }, { name: 'BS.pdf', rows: bs }, { name: 'PL.pdf', rows: pl }], false);
    eq(inp.files.length, 2); ok(/8 lines, as of 12\/31\/2025/.test(inp.labels['GL.pdf'])); ok(inp.notes.some(function (n) { return /cuts long text short/.test(n); })); ok(inp.notes.some(function (n) { return /Staff Loan as/.test(n) && /place in the ledger/.test(n); }), inp.notes.join(' | '));
    return newBook().then(function (b) {
      var p = Q.plan(Q.read(inp.files), b, {});
      eq(p.errors.length, 0, p.errors.join(' | ')); eq(p.preview.openingMode, 'post');
      eq(p.preview.kinds.deposit, 2, 'two deposits on one day with no name stay two deposits'); eq(p.preview.kinds.check, 2);
      return b.importBundle(p.bundle).then(function () {
        var acc = function (n) { return b.accounts.find(function (a) { return a.name === n; }); };
        eq(b.accountBalance(acc('Town Bank # 0509').id), 141000); eq(acc('Town Bank # 0509').type, 'bank'); eq(acc('Equipment').type, 'fixed'); eq(acc('Owner Capital').type, 'equity'); eq(acc('Fees Earned').type, 'income');
        eq(acc('Rent Paid').type, 'expense', 'a sub-account takes its type from the statements or its parent'); eq(b.accById[acc('Rent Paid').parentId].name, 'Occupancy');
        eq(b.accountBalance(acc('Rent Paid').id), 30000); eq(b.accountBalance(acc('Equipment').id), 200000, 'opening balance carried in');
        var ob = b.transactions.find(function (t) { return t.type === 'journal' && t.date === '2024-12-31'; }); ok(ob, 'the opening entry is dated the last day of the year before');
        ok(Q.compareBalances(b, p.expected).ok, 'every account equals the ledger');
        ok(!Q.pdfInputs([{ name: 'BS.pdf', rows: bs }], false).files.length, 'statements alone add no ledger');
      });
    });
  });
  test('QuickBooks-style reports: open invoices, unpaid bills, balance detail, sales, banking detail tie to the ledger', function () {
    return qbImported().then(function (x) {
      var b = x.b, R = OB.reports, asOf = '2099-12-31', all = { from: '1900-01-01', to: asOf };
      var oi = R.openDocs(b, { kind: 'customer', asOf: asOf });
      eq(oi.total, 120000, 'open invoices total'); eq(oi.total, oi.accountBalance, 'open invoices tie to A/R');
      ok(oi.groups.some(function (g) { return g.docs.some(function (d) { return d.number === '1003' && d.open === 150000 && d.due; }); }), 'invoice 1003 listed with due date');
      ok(!oi.groups.some(function (g) { return g.docs.some(function (d) { return d.number === '1001'; }); }), 'paid invoice 1001 not listed');
      var ub = R.openDocs(b, { kind: 'vendor', asOf: asOf });
      eq(ub.total, -b.rawBalance(b.sys('AP').id, asOf), 'unpaid bills total'); eq(ub.total, ub.accountBalance, 'unpaid bills tie to A/P');
      var cd = R.contactDetail(b, { kind: 'customer', asOf: asOf }); eq(cd.total, 120000); eq(cd.total, cd.accountBalance);
      cd.groups.forEach(function (g) { eq(g.rows[g.rows.length - 1].balance, g.total, 'running balance ends at total for ' + g.name); });
      var vd = R.contactDetail(b, { kind: 'vendor', asOf: asOf }); eq(vd.total, ub.total); eq(vd.total, vd.accountBalance);
      var income = U.sum(b.accounts.filter(function (a) { return a.type === 'income'; }), function (a) { return -b.rawBalance(a.id, asOf); });
      eq(R.salesByCustomer(b, Object.assign({ basis: 'accrual' }, all)).total, income, 'sales by customer equals total income');
      var si = R.salesByItem(b, all);
      ok(si.rows.filter(function (r) { return r.itemId; }).length >= 1, 'sales grouped by product/service');
      var dep = R.bankDetail(b, Object.assign({ mode: 'deposit' }, all)), chk = R.bankDetail(b, Object.assign({ mode: 'check' }, all));
      ok(dep.rows.length >= 2 && chk.rows.length >= 3, 'deposits ' + dep.rows.length + ', checks ' + chk.rows.length);
      chk.rows.concat(dep.rows).forEach(function (r) { eq(U.sum(r.lines, function (l) { return l.amount; }), r.amount, 'lines add up for ' + r.t.type + ' ' + r.t.number); });
    });
  });
  test('Items: create, unique names, lines keep their item', function () {
    return newBook().then(function (b) {
      return b.saveItem({ name: 'Audit', type: 'service', incomeAccountId: acc(b, 'Services'), price: '250.00', description: 'Annual audit' }).then(function (it) {
        eq(it.price, 25000);
        return rejects(b.saveItem({ name: 'audit', type: 'service' }), /already exists/).then(function () {
          return cust(b, 'Zed').then(function (c) {
            return b.saveTransaction({ type: 'invoice', date: '2025-05-01', contactId: c.id, lines: [{ accountId: it.incomeAccountId, itemId: it.id, description: 'Annual audit', qty: 1, rate: '250.00' }] });
          });
        }).then(function (t) { eq(t.lines[0].itemId, it.id); eq(t.total, 25000); });
      });
    });
  });

  /* ---------- 1.13: sales tax, estimates / purchase orders, audit chain, closing date ---------- */
  test('Sales tax: rate in millionths, tax only on taxable lines, posted to Sales Tax Payable', function () {
    return newBook().then(function (b) {
      eq(OB.Book.parseRate('8.25'), 82500); eq(OB.Book.parseRate('8.6%'), 86000); eq(OB.Book.parseRate('0.0625'), 625); ok(isNaN(OB.Book.parseRate('8.12345')), '5 decimals rejected');
      eq(OB.Book.taxOn(10000, 82500), 825); eq(OB.Book.taxOn(333, 82500), 27, 'rounds half up: 27.4725 -> 27'); eq(OB.Book.taxOn(-1000, 82500), -83);
      ok(b.sys('STAX'), 'new companies mark Sales Tax Payable as the system sales tax account');
      return rejects(b.saveSalesTax({ name: 'Bad', rate: '101' }), /between 0 and 100/).then(function () {
        return rejects(b.saveSalesTax({ name: 'Wrong acct', rate: '5', accountId: acc(b, 'Sales') }), /liability/);
      }).then(function () {
        return b.saveSalesTax({ name: 'AZ + Tucson', agency: 'Arizona DOR', rate: '8.7', makeDefault: true });
      }).then(function (tx) {
        eq(tx.rate, 87000); eq(b.company.defaultSalesTaxId, tx.id); eq(tx.accountId, b.sys('STAX').id);
        return cust(b, 'Retail Buyer').then(function (c) {
          return b.saveTransaction({ type: 'invoice', date: '2026-03-01', contactId: c.id, taxId: tx.id, lines: [
            { accountId: acc(b, 'Sales'), description: 'Goods', amount: '200.00', taxable: true },
            { accountId: acc(b, 'Services'), description: 'Labor', amount: '100.00' }] });
        }).then(function (t) {
          eq(t.taxableAmount, 20000); eq(t.taxRate, 87000); eq(t.tax, 1740); eq(t.total, 31740, 'total = lines + tax');
          eq(b.accountBalance(b.sys('STAX').id), 1740, 'tax is a liability, not income');
          eq(bal(b, 'Sales'), 20000); eq(b.openBalance(t), 31740);
          eq(U.sum(t.splits, function (s) { return s.amount; }), 0, 'balances');
          var r = R.salesTaxLiability(b, { from: '2026-01-01', to: '2026-12-31' });
          eq(r.rows.length, 1); eq(r.rows[0].taxable, 20000); eq(r.rows[0].nontaxable, 10000); eq(r.rows[0].tax, 1740); eq(r.accounts[0].balance, 1740); eq(r.accounts[0].collected, 1740);
          eq(b.checkIntegrity().issues.length, 0, b.checkIntegrity().issues.join('; '));
          // a credit memo reverses tax; editing the rate list later keeps the posted rate on the document
          return b.saveTransaction({ type: 'creditMemo', date: '2026-03-05', contactId: t.contactId, taxId: tx.id, lines: [{ accountId: acc(b, 'Sales'), amount: '50.00', taxable: true }] }).then(function (cm) {
            eq(cm.tax, 435); eq(b.accountBalance(b.sys('STAX').id), 1305);
            var r2 = R.salesTaxLiability(b, { from: '2026-01-01', to: '2026-12-31' });
            eq(r2.rows[0].taxable, 15000); eq(r2.rows[0].tax, 1305);
            return b.saveSalesTax({ id: tx.id, name: tx.name, agency: tx.agency, rate: '9', accountId: tx.accountId });
          }).then(function () {
            eq(b.txById[t.id].taxRate, 87000, 'posted documents keep their rate');
            // .iif export carries the tax line and the tax item; it reads back with the same totals
            var x = OB.qbexport.invoicesIIF(b, [t.id]);
            ok(x.text.indexOf('INVITEM\tAZ + Tucson\tSTAX\tArizona DOR\tSales Tax Payable\t9%') >= 0, 'sales tax item (current rate)');
            ok(x.text.indexOf('SPL\t\tINVOICE\t3/1/2026\tSales Tax Payable\t\t\t-17.40\t') >= 0 && x.text.indexOf('\tAUTOSTAX\r\n') > 0, 'sales tax line');
            ok(x.text.indexOf('-200.00\t' + t.number + '\tGoods\tN\t-1\t200.00\t\tY\t') >= 0, 'taxable line flagged Y');
            var model = OB.qbimport.read([{ name: 'inv.iif', text: x.text }]);
            eq(model.errors.length, 0, model.errors.join(' '));
            return newBook({ name: 'QB' }).then(function (dst) {
              var plan = OB.qbimport.plan(model, dst);
              if (plan.errors.length) throw new Error(plan.errors.join(' | '));
              return dst.importBundle(plan.bundle).then(function () {
                eq(dst.accountBalance(dst.sys('AR').id), 31740); eq(dst.accountBalance(dst.sys('STAX').id), 1740, 'tax lands in Sales Tax Payable');
              });
            });
          });
        });
      });
    });
  });

  test('Sales tax: tax-exempt customer flag, missing rate rejected, pay tax from the liability', function () {
    return newBook().then(function (b) {
      return b.saveSalesTax({ name: 'State', rate: '6' }).then(function (tx) {
        return b.saveContact({ kind: 'customer', name: 'School District', taxExempt: true }).then(function (c) {
          eq(c.taxExempt, true);
          return rejects(b.saveTransaction({ type: 'salesReceipt', date: '2026-02-01', contactId: c.id, accountId: acc(b, 'Checking'), taxId: 'stx_gone', lines: [{ accountId: acc(b, 'Sales'), amount: '10', taxable: true }] }), /no longer exists/).then(function () {
            return b.saveTransaction({ type: 'salesReceipt', date: '2026-02-01', contactId: c.id, accountId: acc(b, 'Checking'), taxId: tx.id, lines: [{ accountId: acc(b, 'Sales'), amount: '100', taxable: true }] });
          });
        }).then(function (sr) {
          eq(sr.tax, 600); eq(bal(b, 'Checking'), 10600);
          return b.saveTransaction({ type: 'check', date: '2026-03-20', accountId: acc(b, 'Checking'), lines: [{ accountId: b.sys('STAX').id, amount: '6.00', description: 'Sales tax return' }] });
        }).then(function () {
          eq(b.accountBalance(b.sys('STAX').id), 0);
          var r = R.salesTaxLiability(b, { from: '2026-01-01', to: '2026-12-31' });
          eq(r.accounts[0].paid, 600); eq(r.accounts[0].balance, 0); eq(r.totals.tax, 600);
        });
      });
    });
  });

  test('Estimates and purchase orders: no ledger effect, convert, close, reopen when the invoice is voided', function () {
    return newBook().then(function (b) {
      var c, est, inv;
      return cust(b, 'Prospect').then(function (x) { c = x;
        return b.saveTransaction({ type: 'estimate', date: '2026-04-01', contactId: c.id, lines: [{ accountId: acc(b, 'Services'), description: 'Design', qty: 10, rate: '120' }], message: 'Valid 30 days' });
      }).then(function (e) {
        est = e; eq(e.status, 'open'); eq(e.total, 120000); eq(e.splits.length, 0); eq(e.number, 'EST-1001');
        eq(R.trialBalance(b, {}).totalDebit, 0, 'estimates do not post'); eq(b.contactBalance(c.id), 0);
        eq(b.posted().length, 0);
        return b.saveTransaction({ type: 'invoice', date: '2026-04-10', contactId: c.id, sourceId: est.id, lines: est.lines });
      }).then(function (i) {
        inv = i; eq(b.txById[est.id].status, 'closed'); eq(b.txById[est.id].linkedTo[0], inv.id); eq(inv.sourceId, est.id);
        return rejects(b.saveTransaction({ type: 'invoice', date: '2026-04-11', contactId: c.id, sourceId: est.id, lines: est.lines }), /already closed/);
      }).then(function () {
        return b.voidTransaction(inv.id, 'wrong');
      }).then(function () {
        eq(b.txById[est.id].status, 'open', 'voiding the invoice reopens the estimate');
        return b.setDocStatus(est.id, 'closed');
      }).then(function () {
        eq(b.txById[est.id].status, 'closed');
        return vend(b, 'Supplier');
      }).then(function (v) {
        return b.saveTransaction({ type: 'purchaseOrder', date: '2026-04-02', contactId: v.id, lines: [{ accountId: acc(b, 'Office Supplies & Software'), amount: '75.00' }] }).then(function (po) {
          eq(po.number, 'PO-1001'); eq(po.status, 'open');
          return rejects(b.saveTransaction({ type: 'invoice', date: '2026-04-03', contactId: c.id, sourceId: po.id, lines: po.lines }), /no longer exists/).then(function () {
            return b.saveTransaction({ type: 'bill', date: '2026-04-05', contactId: v.id, sourceId: po.id, lines: po.lines });
          }).then(function (bill) { eq(b.txById[po.id].status, 'closed'); eq(bill.total, 7500); eq(bal(b, 'Accounts Payable (A/P)'), 7500); });
        });
      }).then(function () { eq(b.checkIntegrity().issues.length, 0, b.checkIntegrity().issues.join('; ')); });
    });
  });

  test('Audit trail is SHA-256 hash-chained: edits and deletions are detected', function () {
    return newBook().then(function (b) {
      return cust(b, 'A').then(function (c) {
        return b.saveTransaction({ type: 'invoice', date: '2026-01-05', contactId: c.id, lines: [{ accountId: acc(b, 'Sales'), amount: '10' }] });
      }).then(function () {
        var v = b.verifyAudit(); eq(v.problems.length, 0); eq(v.chained, b.audit.length);
        b.audit.forEach(function (a) { ok(/^[0-9a-f]{64}$/.test(a.hash), 'hash on every entry'); });
        var keep = b.audit[1].summary;
        b.audit[1].summary = 'Something else';
        ok(b.verifyAudit().problems.some(function (p) { return /changed after it was written/.test(p); }), 'edit detected');
        b.audit[1].summary = keep; eq(b.verifyAudit().problems.length, 0);
        var removed = b.audit.splice(1, 1)[0];
        ok(b.verifyAudit().problems.some(function (p) { return /missing/.test(p); }), 'deletion detected');
        ok(b.checkIntegrity().issues.length > 0, 'integrity check reports it');
        b.audit.splice(1, 0, removed);
        // a legacy (pre-1.13) list with unhashed entries still verifies; new entries start one chain
        var legacy = { audit: [{ id: 'aud_x', ts: '2020-01-01T00:00:00Z', action: 'create', txnId: '', summary: 'old', before: null }] };
        var e = OB.Book.chainAudit(legacy.audit, { id: 'aud_y', ts: '2026-01-01T00:00:00Z', action: 'restore', txnId: '', summary: 'r', before: null });
        eq(e.prev, ''); var vb = OB.Book.prototype.verifyAudit.call(legacy); eq(vb.legacy, 1); eq(vb.problems.length, 0);
      });
    });
  });

  test('Closing date: history of changes and an optional password gate', function () {
    return newBook().then(function (b) {
      return b.saveCompany({ closingDate: '2025-12-31', newClosingPassword: 'close-it' }).then(function (c) {
        ok(c.closingPasswordHash && c.closingPasswordHash.indexOf('close-it') < 0, 'only a salted hash is stored');
        eq(c.closingHistory.length, 1); eq(c.closingHistory[0].to, '2025-12-31');
        return rejects(b.saveCompany({ closingDate: '2026-01-31' }), /password/);
      }).then(function () { return rejects(b.saveCompany({ closingDate: '2026-01-31', closingPassword: 'nope' }), /incorrect/); })
        .then(function () { return b.saveCompany({ name: 'Renamed' }); })
        .then(function () { return b.saveCompany({ closingDate: '2026-01-31', closingPassword: 'close-it' }); })
        .then(function (c) { eq(c.closingDate, '2026-01-31'); eq(c.closingHistory.length, 2); eq(c.closingHistory[1].from, '2025-12-31');
          return b.saveCompany({ closingPassword: 'close-it', newClosingPassword: '' }); })
        .then(function (c) { ok(!c.closingPasswordHash, 'password removed'); return b.saveCompany({ closingDate: '' }); })
        .then(function (c) { eq(c.closingDate, ''); eq(c.closingHistory.length, 3); });
    });
  });

  test('Data v4 → v6 migration: sales tax account, counters, history, inventory account', function () {
    var d = { company: { id: 'c1', name: 'Old', dataVersion: 4, counters: { invoice: 1001 } }, accounts: [{ id: 'a1', number: '2200', name: 'Sales Tax Payable', type: 'ocl', system: '' }, { id: 'a2', number: '1300', name: 'Inventory Asset', type: 'oca', system: '' }], transactions: [], audit: [] };
    OB.schema.migrate(d);
    eq(d.company.dataVersion, OB.schema.DATA_VERSION); eq(d.accounts[0].system, 'STAX'); eq(d.accounts[1].system, 'INV'); eq(d.company.counters.invAdjust, 1); ok(Array.isArray(d.company.fixedAssets)); eq(d.company.counters.estimate, 1001); eq(d.company.counters.purchaseOrder, 1001);
    ok(Array.isArray(d.company.salesTaxes) && Array.isArray(d.company.closingHistory));
  });

  /* ---------- 1.14: deposits, checks, write-off, finance charges, 1099 data ---------- */
  test('Make Deposits: payments in Undeposited Funds become one bank deposit, once, in full', function () {
    return newBook().then(function (b) {
      var c, p1, p2, undep = b.sys('UNDEP').id;
      return cust(b, 'Payer').then(function (x) { c = x;
        return b.saveTransaction({ type: 'invoice', date: '2026-02-01', contactId: c.id, lines: [{ accountId: acc(b, 'Sales'), amount: '500' }] });
      }).then(function (inv) {
        return b.saveTransaction({ type: 'payment', date: '2026-02-05', contactId: c.id, accountId: undep, amount: '300', applications: [{ txnId: inv.id, amount: '300' }] }).then(function (x) { p1 = x;
          return b.saveTransaction({ type: 'salesReceipt', date: '2026-02-06', contactId: c.id, accountId: undep, lines: [{ accountId: acc(b, 'Sales'), amount: '120' }] });
        });
      }).then(function (x) {
        p2 = x;
        eq(b.undepositedItems().length, 2); eq(b.accountBalance(undep), 42000);
        return rejects(b.saveTransaction({ type: 'deposit', date: '2026-02-07', accountId: acc(b, 'Checking'), lines: [{ accountId: undep, fromTxnId: p1.id, amount: '200' }] }), /full/);
      }).then(function () {
        return b.saveTransaction({ type: 'deposit', date: '2026-02-07', accountId: acc(b, 'Checking'), memo: 'Batch', lines: [
          { accountId: undep, fromTxnId: p1.id, amount: '300', description: 'Payment' }, { accountId: undep, fromTxnId: p2.id, amount: '120' }] });
      }).then(function (dep) {
        eq(dep.total, 42000); eq(b.accountBalance(undep), 0); eq(bal(b, 'Checking'), 42000); eq(b.undepositedItems().length, 0);
        eq(b.depositedBy[p1.id], dep.id);
        return rejects(b.saveTransaction({ type: 'deposit', date: '2026-02-08', accountId: acc(b, 'Checking'), lines: [{ accountId: undep, fromTxnId: p1.id, amount: '300' }] }), /another deposit/).then(function () {
          return rejects(b.voidTransaction(p1.id), /part of the deposit/);
        }).then(function () {
          return rejects(b.saveTransaction(Object.assign({}, p2, { lines: [{ accountId: acc(b, 'Sales'), amount: '150' }] })), /Remove it from that deposit/);
        }).then(function () { return b.voidTransaction(dep.id); });
      }).then(function () {
        eq(b.undepositedItems().length, 2, 'voiding the deposit puts the payments back in Undeposited Funds');
        eq(b.checkIntegrity().issues.length, 0, b.checkIntegrity().issues.join('; '));
      });
    });
  });

  test('Checks: amounts in words, print queue, numbering on print', function () {
    eq(U.amountWords(123456), 'One thousand two hundred thirty-four and 56/100'); eq(U.amountWords(7), 'Zero and 07/100'); eq(U.amountWords(2000000), 'Twenty thousand and 00/100');
    return newBook().then(function (b) {
      var ids = [];
      return vend(b, 'Landlord').then(function (v) {
        return b.saveTransaction({ type: 'check', date: '2026-03-01', contactId: v.id, accountId: acc(b, 'Checking'), number: '', toBePrinted: true, lines: [{ accountId: acc(b, 'Rent & Lease'), amount: '1500' }] })
          .then(function (t) { ids.push(t.id); eq(t.toBePrinted, true); eq(t.number, '', 'no number until printed');
            return b.saveTransaction({ type: 'expense', date: '2026-03-02', contactId: v.id, accountId: acc(b, 'Checking'), toBePrinted: 'on', lines: [{ accountId: acc(b, 'Utilities'), amount: '80' }] }); })
          .then(function (t) { ids.push(t.id); return b.saveTransaction({ type: 'check', date: '2026-03-03', contactId: v.id, accountId: acc(b, 'Checking'), number: '2001', lines: [{ accountId: acc(b, 'Utilities'), amount: '5' }] }); });
      }).then(function () {
        eq(b.checksToPrint().length, 2);
        var pages = OB.invoiceLayout.checkPages(b, b.checksToPrint(), {});
        var texts = pages[0].filter(function (o) { return o.t === 'text'; }).map(function (o) { return o.s; });
        ok(texts.some(function (x) { return /^One thousand five hundred and 00\/100 \*+$/.test(x); }), 'amount in words with star fill');
        ok(texts.indexOf('**1,500.00') >= 0 && texts.indexOf('Landlord') >= 0, 'amount and payee');
        var pdf = OB.invoiceLayout.pdf(pages, {}, 'Checks'); ok(pdf.length > 1000, 'PDF builds');
        return rejects(b.setChecksPrinted(ids, '2000'), /2001 is already used/);
      }).then(function () { return b.setChecksPrinted(ids, '2002'); })
        .then(function (u) { eq(u[0].number, '2002'); eq(u[1].number, '2003'); eq(b.checksToPrint().length, 0); ok(b.company.counters.check >= 2004); eq(bal(b, 'Checking'), -158500, 'ledger unchanged by printing'); });
    });
  });

  test('Bad debt write-off: credit memo to Bad Debt applied to the invoice', function () {
    return newBook().then(function (b) {
      var inv;
      return cust(b, 'Gone Away').then(function (c) { return b.saveTransaction({ type: 'invoice', date: '2026-01-10', contactId: c.id, lines: [{ accountId: acc(b, 'Services'), amount: '900' }] }); })
        .then(function (i) { inv = i; return b.saveTransaction({ type: 'payment', date: '2026-01-20', contactId: i.contactId, accountId: acc(b, 'Checking'), amount: '100', applications: [{ txnId: i.id, amount: '100' }] }); })
        .then(function () { return rejects(b.writeOffInvoice(inv.id, { date: '2025-12-31' }), /before the invoice date/); })
        .then(function () { return b.writeOffInvoice(inv.id, { date: '2026-06-30' }); })
        .then(function (cm) {
          eq(cm.type, 'creditMemo'); eq(cm.total, 80000); eq(cm.writeOffOf, inv.id); eq(b.openBalance(inv), 0); eq(b.openBalance(cm), 0);
          eq(bal(b, 'Bad Debt'), 80000, 'Bad Debt expense created and charged'); eq(b.accountBalance(b.sys('AR').id), 0);
          return rejects(b.writeOffInvoice(inv.id), /nothing left/);
        });
    });
  });

  test('Finance charges: APR × days overdue / 365 per invoice, minimum charge, grace period', function () {
    return newBook().then(function (b) {
      var c1, c2;
      return cust(b, 'Late Larry').then(function (c) { c1 = c; return cust(b, 'Barely Late'); }).then(function (c) { c2 = c;
        return b.saveTransaction({ type: 'invoice', date: '2026-01-01', dueDate: '2026-01-31', contactId: c1.id, lines: [{ accountId: acc(b, 'Sales'), amount: '1000' }] });
      }).then(function () { return b.saveTransaction({ type: 'invoice', date: '2026-03-01', dueDate: '2026-03-25', contactId: c2.id, lines: [{ accountId: acc(b, 'Sales'), amount: '100' }] }); })
        .then(function () {
          var rows = b.financeChargePreview({ asOf: '2026-03-31', apr: 18, minCharge: 200, graceDays: 10 });
          eq(rows.length, 1, 'invoice 6 days late is inside the 10-day grace');
          eq(rows[0].contactId, c1.id); eq(rows[0].overdue, 100000); eq(rows[0].charge, Math.round(100000 * 0.18 * 59 / 365), '59 days at 18%');
          var rows2 = b.financeChargePreview({ asOf: '2026-03-31', apr: 18, minCharge: 200, graceDays: 0 });
          eq(rows2.find(function (r) { return r.contactId === c2.id; }).charge, 200, 'minimum charge');
          return b.assessFinanceCharges(rows, { asOf: '2026-03-31' });
        }).then(function (invs) {
          eq(invs.length, 1); ok(invs[0].financeCharge); eq(bal(b, 'Finance Charge Income'), invs[0].total);
          var again = b.financeChargePreview({ asOf: '2026-04-30', apr: 18, graceDays: 0 });
          ok(!again.some(function (r) { return r.invoices.some(function (x) { return x.id === invs[0].id; }); }), 'finance charges are not charged on finance charges by default');
        });
    });
  });

  test('1099 data: recipients over the threshold, address split, TIN type, CSV for the IRS template, 1096 totals', function () {
    eq(U.tinType('12-3456789'), 'EIN'); eq(U.tinType('123-45-6789'), 'SSN'); eq(U.tinType('123456789'), '');
    var a = U.parseUSAddress('77 Oak Ave\nSuite 2\nTucson, AZ 85701'); eq(a.line1, '77 Oak Ave'); eq(a.line2, 'Suite 2'); eq(a.city, 'Tucson'); eq(a.state, 'AZ'); eq(a.zip, '85701');
    return newBook({ ein: '86-1234567', address: '1 Payer Way\nPhoenix, AZ 85001' }).then(function (b) {
      var nec = acc(b, 'Contractors');
      return b.saveCompany({ map1099: (function () { var m = {}; m[nec] = 'NEC1'; m[acc(b, 'Rent & Lease')] = 'MISC1'; return m; })() }).then(function () {
        return b.saveContact({ kind: 'vendor', name: 'Dev Contractor', is1099: true, taxId: '123-45-6789', w9OnFile: true, address: '5 Elm St\nMesa, AZ 85201', email: 'dev@example.com' });
      }).then(function (v) {
        return b.saveTransaction({ type: 'check', date: '2026-05-01', number: '10', contactId: v.id, accountId: acc(b, 'Checking'), lines: [{ accountId: nec, amount: '2500' }] })
          .then(function () { return b.saveContact({ kind: 'vendor', name: 'Small Job', is1099: true, address: 'Nowhere' }); })
          .then(function (v2) { return b.saveTransaction({ type: 'check', date: '2026-05-02', number: '11', contactId: v2.id, accountId: acc(b, 'Checking'), lines: [{ accountId: nec, amount: '2100' }] }); });
      }).then(function () {
        var rows = R.recipients1099(b, '2026');
        eq(rows.length, 2);
        var dev = rows.find(function (r) { return r.name === 'Dev Contractor'; }), sm = rows.find(function (r) { return r.name === 'Small Job'; });
        eq(dev.nec1, 250000); eq(dev.tinType, 'SSN'); eq(dev.problems.length, 0); eq(dev.address.city, 'Mesa');
        ok(sm.problems.indexOf('No tax ID') >= 0 && sm.problems.indexOf('No W-9 on file') >= 0, 'problems listed');
        var t = R.totals1096(rows); eq(t.nec.forms, 2); eq(t.nec.total, 460000); eq(t.misc.forms, 0);
        var csv = R.csv1099(b, '2026');
        ok(csv.indexOf('2026,1099-NEC,Test Co,86-1234567,1 Payer Way,Phoenix,AZ,85001,') === csv.indexOf('\r\n') + 2, 'payer columns');
        ok(csv.indexOf('SSN,123-45-6789,Dev Contractor,5 Elm St,,Mesa,AZ,85201,dev@example.com,2500.00') > 0, 'recipient row');
        ok(/\r\n$/.test(csv));
      });
    });
  });

  /* ---------- 1.15: inventory and fixed assets ---------- */
  test('Inventory: purchases at cost, sales post average-cost COGS, returns, adjustments, valuation ties to the ledger', function () {
    return newBook().then(function (b) {
      var it, v, c, inv = function () { return b.sys('INV').id; };
      return b.saveItem({ name: 'Widget', type: 'inventory', trackQty: true, incomeAccountId: acc(b, 'Sales'), price: '25', reorderPoint: 5 }).then(function (x) {
        it = x; eq(it.assetAccountId, b.sys('INV').id); eq(it.expenseAccountId, acc(b, 'Cost of Goods Sold'));
        return vend(b, 'Maker');
      }).then(function (x) { v = x; return cust(b, 'Shop'); }).then(function (x) { c = x;
        return rejects(b.saveTransaction({ type: 'bill', date: '2026-01-02', contactId: v.id, lines: [{ itemId: it.id, accountId: acc(b, 'Office Supplies & Software'), qty: 10, amount: '100' }] }), /inventory asset account/);
      }).then(function () { return rejects(b.saveTransaction({ type: 'bill', date: '2026-01-02', contactId: v.id, lines: [{ itemId: it.id, accountId: inv(), amount: '100' }] }), /enter the quantity/); })
        .then(function () { return b.saveTransaction({ type: 'bill', date: '2026-01-02', contactId: v.id, lines: [{ itemId: it.id, accountId: inv(), qty: 10, amount: '100' }] }); })
        .then(function () { return b.saveTransaction({ type: 'bill', date: '2026-01-05', contactId: v.id, lines: [{ itemId: it.id, accountId: inv(), qty: 10, amount: '160' }] }); })
        .then(function () {
          var s = b.inventoryState('2026-12-31')[it.id]; eq(s.qty, 20); eq(s.value, 26000); eq(Math.round(s.avg), 1300, 'average cost 13.00');
          return b.saveTransaction({ type: 'invoice', date: '2026-01-10', contactId: c.id, lines: [{ itemId: it.id, accountId: acc(b, 'Sales'), qty: 4, rate: '25' }] });
        }).then(function (t) {
          eq(t.lines[0].cost, 5200, '4 × 13.00'); eq(bal(b, 'Cost of Goods Sold'), 5200); eq(b.accountBalance(inv()), 20800); eq(t.total, 10000, 'customer total unchanged by cost');
          eq(U.sum(t.splits, function (x) { return x.amount; }), 0);
          return b.saveTransaction({ type: 'creditMemo', date: '2026-01-12', contactId: c.id, lines: [{ itemId: it.id, accountId: acc(b, 'Sales'), qty: 1, rate: '25' }] });
        }).then(function (cm) {
          eq(cm.lines[0].cost, 1300); eq(bal(b, 'Cost of Goods Sold'), 3900); eq(b.inventoryState()[it.id].qty, 17);
          return b.saveTransaction({ type: 'invAdjust', date: '2026-01-31', accountId: acc(b, 'Cost of Goods Sold'), memo: 'Count', adjustments: [{ itemId: it.id, qty: -2 }] });
        }).then(function (adj) {
          eq(adj.number, 'ADJ-1'); eq(adj.adjustments[0].value, -2600, 'shrinkage at average cost'); eq(b.inventoryState()[it.id].qty, 15);
          var r = R.inventoryValuation(b, { asOf: '2026-12-31' });
          eq(r.rows[0].qty, 15); eq(r.total, 19500); eq(r.ledger, 19500, 'valuation equals Inventory Asset'); eq(r.rows[0].retail, 37500);
          var ss = R.stockStatus(b, { asOf: '2026-12-31' }); eq(ss.rows[0].order, false);
          eq(b.checkIntegrity().issues.length, 0, b.checkIntegrity().issues.join('; '));
          return b.saveItem(Object.assign({}, it, { assetAccountId: acc(b, 'Prepaid Expenses') }));
        }).then(function () { throw new Error('asset account change should be refused'); }, function (e) { ok(/cannot change/.test(e.message), e.message); });
    });
  });

  test('Fixed assets: straight-line, double-declining and MACRS schedules; depreciation posted and read back', function () {
    var sl = OB.Book.depSchedule({ inService: '2026-01-15', cost: 1200000, salvage: 0, method: 'SL', lifeMonths: 60 });
    eq(sl.length, 60); eq(sl[0].date, '2026-01-31'); eq(sl[0].amount, 20000); eq(U.sum(sl, function (x) { return x.amount; }), 1200000);
    var odd = OB.Book.depSchedule({ inService: '2026-03-01', cost: 100000, salvage: 1000, method: 'SL', lifeMonths: 7 });
    eq(U.sum(odd, function (x) { return x.amount; }), 99000, 'rounding never loses a cent');
    var ddb = OB.Book.depSchedule({ inService: '2026-01-01', cost: 1000000, salvage: 100000, method: 'DDB', lifeMonths: 60 });
    eq(U.sum(ddb, function (x) { return x.amount; }), 900000, 'DDB stops at salvage'); ok(ddb[0].amount > ddb[30].amount, 'declining');
    var mac = OB.Book.depSchedule({ inService: '2026-06-01', cost: 1000000, method: 'MACRS', macrsClass: 5 });
    eq(mac.map(function (x) { return x.amount; }).join(','), '200000,320000,192000,115200,115200,57600'); eq(mac[0].date, '2026-12-31');
    return newBook().then(function (b) {
      return rejects(b.saveFixedAsset({ name: 'Truck', inService: '2026-01-15', cost: '12000', method: 'SL', lifeMonths: 60, accountId: acc(b, 'Vehicles'), accumAccountId: acc(b, 'Vehicles'), expenseAccountId: acc(b, 'Depreciation') }), /separate account/)
        .then(function () { return b.saveFixedAsset({ name: 'Truck', inService: '2026-01-15', cost: '12000', method: 'SL', lifeMonths: 60, accountId: acc(b, 'Vehicles'), accumAccountId: acc(b, 'Accumulated Depreciation'), expenseAccountId: acc(b, 'Depreciation') }); })
        .then(function (a) {
          var due = b.depreciationDue('2026-03-31'); eq(due.length, 1); eq(due[0].due, 60000);
          return b.recordDepreciation('2026-03-31').then(function (je) {
            ok(je.depreciation); eq(je.jlines[0].assetId, a.id); eq(bal(b, 'Depreciation'), 60000); eq(b.depreciationRecorded(a.id), 60000);
            eq(b.depreciationDue('2026-03-31').length, 0, 'nothing due twice');
            return rejects(b.recordDepreciation('2026-03-31'), /No depreciation is due/);
          }).then(function () { return b.recordDepreciation('2026-06-30'); })
            .then(function () {
              var r = R.fixedAssets(b, { asOf: '2026-06-30' }); eq(r.rows[0].recorded, 120000); eq(r.rows[0].bookValue, 1080000); eq(r.rows[0].unrecorded, 0); eq(r.rows[0].thisYear, 120000);
              eq(b.checkIntegrity().issues.length, 0);
            });
        });
    });
  });

  /* ---------- 1.16: attachments, Customer:Job, billable expenses, tax lines ---------- */
  test('Attachments: add to a transaction, size limit, remove keeps a tombstone; included in backups', function () {
    return newBook().then(function (b) {
      var t;
      return cust(b, 'A').then(function (c) { return b.saveTransaction({ type: 'invoice', date: '2026-01-01', contactId: c.id, lines: [{ accountId: acc(b, 'Sales'), amount: '10' }] }); })
        .then(function (x) { t = x; return rejects(b.addAttachment({ ownerId: 'nope', name: 'x', dataUrl: 'data:text/plain;base64,aGk=' }), /Save the transaction/); })
        .then(function () { return rejects(b.addAttachment({ ownerId: t.id, name: 'big.pdf', dataUrl: 'data:application/pdf;base64,' + 'A'.repeat(6 * 1024 * 1024) }), /4 MB/); })
        .then(function () { return b.addAttachment({ ownerId: t.id, name: 'receipt.txt', dataUrl: 'data:text/plain;base64,aGVsbG8=' }); })
        .then(function (a) {
          eq(a.size, 5); eq(b.attachmentsFor(t.id).length, 1);
          var bk = OB.backup.create(b);
          ok(JSON.stringify(bk).indexOf('receipt.txt') > 0, 'backup carries the attachment');
          return b.removeAttachment(a.id);
        }).then(function (a) { ok(a.deleted && a.data === ''); eq(b.attachmentsFor(t.id).length, 0); eq(b.attachments.length, 1, 'tombstone kept'); });
    });
  });

  test('Customer:Job: jobs under customers, labels, no cycles; billable costs re-billed once', function () {
    return newBook().then(function (b) {
      var cu, job, v, bill;
      return cust(b, 'Smith Family').then(function (c) { cu = c; return b.saveContact({ kind: 'customer', name: 'Kitchen remodel', parentId: c.id, jobStatus: 'in progress' }); })
        .then(function (j) { job = j; eq(b.contactLabel(j.id), 'Smith Family:Kitchen remodel'); eq(b.jobsOf(cu.id).length, 1);
          return rejects(b.saveContact(Object.assign({}, cu, { parentId: j.id })), /itself/); })
        .then(function () { return vend(b, 'Lumber Yard'); })
        .then(function (x) { v = x;
          return rejects(b.saveTransaction({ type: 'bill', date: '2026-02-01', contactId: v.id, lines: [{ accountId: acc(b, 'Repairs & Maintenance'), amount: '400', billable: true }] }), /customer \(or job\) to bill/);
        }).then(function () {
          return b.saveTransaction({ type: 'bill', date: '2026-02-01', contactId: v.id, lines: [{ accountId: acc(b, 'Repairs & Maintenance'), amount: '400', billable: true, contactId: job.id, description: 'Cabinets' }, { accountId: acc(b, 'Office Supplies & Software'), amount: '20' }] });
        }).then(function (x) {
          bill = x; var u = b.unbilledCosts(job.id); eq(u.length, 1); eq(u[0].key, bill.id + ':0'); eq(u[0].amount, 40000);
          eq(b.unbilledCosts(cu.id).length, 0, 'costs belong to the job');
          return b.saveTransaction({ type: 'invoice', date: '2026-02-10', contactId: job.id, lines: [{ accountId: acc(b, 'Repairs & Maintenance'), amount: '400', description: 'Cabinets', billOf: bill.id + ':0' }, { accountId: acc(b, 'Services'), amount: '1000', description: 'Labor' }] });
        }).then(function (inv) {
          eq(b.unbilledCosts().length, 0); eq(b.billedBy(bill.id + ':0').id, inv.id);
          eq(bal(b, 'Repairs & Maintenance'), 0, 'the re-billed cost nets out of the expense');
          return rejects(b.saveTransaction({ type: 'invoice', date: '2026-02-11', contactId: job.id, lines: [{ accountId: acc(b, 'Repairs & Maintenance'), amount: '400', billOf: bill.id + ':0' }] }), /already billed/)
            .then(function () { return rejects(b.voidTransaction(bill.id), /billed on invoice/); })
            .then(function () { return rejects(b.saveTransaction(Object.assign({}, bill, { lines: [{ accountId: acc(b, 'Repairs & Maintenance'), amount: '450', billable: true, contactId: job.id }, bill.lines[1]] })), /already billed/); })
            .then(function () { return b.voidTransaction(inv.id); })
            .then(function () { eq(b.unbilledCosts(job.id).length, 1, 'voiding the invoice makes the cost unbilled again'); eq(R.unbilledCosts(b, {}).total, 40000); });
        });
    });
  });

  test('Tax lines: suggestions by name and type, summary by line, unmapped accounts listed, CSV', function () {
    return newBook().then(function (b) {
      var a = function (n) { return b.accounts.find(function (x) { return x.name === n; }); };
      eq(OB.Book.suggestTaxLine('1040C', a('Advertising & Marketing')), 'C8'); eq(OB.Book.suggestTaxLine('1040C', a('Rent & Lease')), 'C20b');
      eq(OB.Book.suggestTaxLine('1120S', a('Sales')), 'S1a'); eq(OB.Book.suggestTaxLine('1120S', a('Depreciation')), 'S14'); eq(OB.Book.suggestTaxLine('1065', a('Cost of Goods Sold')), 'P2');
      eq(OB.Book.suggestTaxLine('1040C', a('Checking')), '', 'balance sheet accounts are not mapped');
      var map = {}; b.accounts.forEach(function (x) { var c = OB.Book.suggestTaxLine('1040C', x); if (c) map[x.id] = c; }); delete map[a('Meals').id];
      return b.saveCompany({ taxForm: '1040C', taxLines: map }).then(function () {
        return cust(b, 'C');
      }).then(function (c) {
        return b.saveTransaction({ type: 'salesReceipt', date: '2026-03-01', contactId: c.id, accountId: acc(b, 'Checking'), lines: [{ accountId: acc(b, 'Sales'), amount: '5000' }] });
      }).then(function () { return b.saveTransaction({ type: 'expense', date: '2026-03-02', accountId: acc(b, 'Checking'), lines: [{ accountId: acc(b, 'Advertising & Marketing'), amount: '300' }, { accountId: acc(b, 'Meals'), amount: '80' }] }); })
        .then(function () {
          var r = R.taxSummary(b, { from: '2026-01-01', to: '2026-12-31', basis: 'accrual' });
          eq(r.form, '1040C'); eq(r.rows.find(function (x) { return x.code === 'C1'; }).amount, 500000); eq(r.rows.find(function (x) { return x.code === 'C8'; }).amount, 30000);
          eq(r.unmapped.length, 1); eq(r.unmapped[0].amount, 8000);
          var csv = R.taxCsv(b, { from: '2026-01-01', to: '2026-12-31' });
          ok(csv.indexOf('1040C,1 Gross receipts or sales,Total,5000.00') > 0 && csv.indexOf('NOT MAPPED') > 0, csv);
        });
    });
  });

  /* ---------- 1.17: sales orders, progress & batch invoicing, deposits, price levels ---------- */
  test('Progress invoicing: estimate billed in parts, stays open until fully invoiced; limits; void reopens', function () {
    return newBook().then(function (b) {
      var c, est, i1;
      return cust(b, 'Owner').then(function (x) { c = x;
        return b.saveTransaction({ type: 'estimate', date: '2026-04-01', contactId: c.id, lines: [{ accountId: acc(b, 'Services'), description: 'Design', amount: '1000' }, { accountId: acc(b, 'Services'), description: 'Build', amount: '3000' }] });
      }).then(function (e) {
        est = e;
        var half = b.progressLines(est.id, 'pct', 50); eq(half.length, 2); eq(half[0].amount, 50000); eq(half[1].amount, 150000); eq(half[1].srcLine, 1);
        return b.saveTransaction({ type: 'invoice', date: '2026-04-10', contactId: c.id, sourceId: est.id, lines: half });
      }).then(function (x) {
        i1 = x; eq(b.txById[est.id].status, 'open', 'half invoiced: estimate still open');
        var pr = b.sourceProgress(est.id); eq(pr.billed, 200000); eq(pr.total, 400000);
        return rejects(b.saveTransaction({ type: 'invoice', date: '2026-04-11', contactId: c.id, sourceId: est.id, lines: [{ accountId: acc(b, 'Services'), amount: '600', srcLine: 0 }] }), /only \$500\.00/);
      }).then(function () { return b.saveTransaction({ type: 'invoice', date: '2026-04-20', contactId: c.id, sourceId: est.id, lines: b.progressLines(est.id, 'rest') }); })
        .then(function (i2) {
          eq(i2.total, 200000); eq(b.txById[est.id].status, 'closed'); eq(b.txById[est.id].linkedTo.length, 2);
          return b.voidTransaction(i1.id);
        }).then(function () { eq(b.txById[est.id].status, 'open', 'voiding a part invoice reopens the estimate'); eq(b.progressLines(est.id, 'rest').length, 2); });
    });
  });

  test('Sales orders and partial PO billing use the same progress rule', function () {
    return newBook().then(function (b) {
      var so, po;
      return cust(b, 'Retail').then(function (c) {
        return b.saveTransaction({ type: 'salesOrder', date: '2026-05-01', contactId: c.id, lines: [{ accountId: acc(b, 'Sales'), qty: 10, rate: '20' }] }).then(function (x) {
          so = x; eq(so.number, 'SO-1001'); eq(so.status, 'open'); eq(so.splits.length, 0);
          return b.saveTransaction({ type: 'invoice', date: '2026-05-03', contactId: c.id, sourceId: so.id, lines: b.progressLines(so.id, 'rest') });
        }).then(function (inv) { eq(inv.total, 20000); eq(inv.lines[0].qty, 10, 'full line keeps qty × rate'); eq(b.txById[so.id].status, 'closed'); });
      }).then(function () { return vend(b, 'Supplier'); }).then(function (v) {
        return b.saveTransaction({ type: 'purchaseOrder', date: '2026-05-01', contactId: v.id, lines: [{ accountId: acc(b, 'Office Supplies & Software'), amount: '500' }] }).then(function (x) {
          po = x; return b.saveTransaction({ type: 'bill', date: '2026-05-05', contactId: v.id, sourceId: po.id, lines: [{ accountId: acc(b, 'Office Supplies & Software'), amount: '200', srcLine: 0 }] });
        }).then(function () { eq(b.txById[po.id].status, 'open', 'partly billed PO stays open'); eq(b.sourceProgress(po.id).billed, 20000); });
      });
    });
  });

  test('Customer deposits: retainer held as a liability, applied on the invoice; fully prepaid invoice is paid', function () {
    return newBook().then(function (b) {
      var c;
      return cust(b, 'Client').then(function (x) { c = x; return b.receiveDeposit({ date: '2026-06-01', contactId: c.id, accountId: acc(b, 'Checking'), amount: '1500' }); })
        .then(function (sr) {
          var dep = b.depositAccount(); ok(dep && dep.type === 'ocl'); eq(b.depositsHeld(c.id), 150000); eq(bal(b, 'Checking'), 150000); eq(b.accountBalance(dep.id), 150000);
          return b.saveTransaction({ type: 'invoice', date: '2026-06-20', contactId: c.id, lines: [{ accountId: acc(b, 'Services'), amount: '1500' }, { accountId: dep.id, amount: '-1500', description: 'Deposit applied' }] });
        }).then(function (inv) {
          eq(inv.total, 0); eq(b.openBalance(inv), 0); eq(b.depositsHeld(c.id), 0); eq(bal(b, 'Services'), 150000, 'income recognised when invoiced');
          return rejects(b.saveTransaction({ type: 'invoice', date: '2026-06-21', contactId: c.id, lines: [{ accountId: acc(b, 'Services'), amount: '0' }] }), /greater than zero/);
        });
    });
  });

  test('Price levels and batch invoicing', function () {
    return newBook().then(function (b) {
      var it, pl, wh, c2;
      return b.saveItem({ name: 'Monthly service', type: 'service', incomeAccountId: acc(b, 'Services'), price: '100' }).then(function (x) { it = x;
        return b.savePriceLevel({ name: 'Wholesale', method: 'pct', pct: -20 }); })
        .then(function (x) { pl = x; return b.saveContact({ kind: 'customer', name: 'Wholesaler', priceLevelId: pl.id, terms: 15 }); })
        .then(function (x) { wh = x; eq(b.priceFor(it.id, wh.id), 8000); return b.savePriceLevel({ name: 'VIP', method: 'item', prices: (function () { var p = {}; p[it.id] = '65'; return p; })() }); })
        .then(function (vip) { return b.saveContact({ kind: 'customer', name: 'VIP Co', priceLevelId: vip.id }); })
        .then(function (x) { c2 = x; eq(b.priceFor(it.id, c2.id), 6500); return cust(b, 'Regular'); })
        .then(function (c3) {
          eq(b.priceFor(it.id, c3.id), 10000);
          return b.batchInvoices([wh.id, c2.id, c3.id], { date: '2026-07-01', lines: [{ itemId: it.id, accountId: acc(b, 'Services'), description: 'July', qty: 1 }] });
        }).then(function (r) {
          eq(r.errors.length, 0); eq(r.posted.length, 3);
          eq(r.posted.map(function (t) { return t.total; }).join(','), '8000,6500,10000');
          eq(r.posted[0].dueDate, '2026-07-16', 'customer terms'); ok(r.posted[0].number !== r.posted[1].number);
        });
    });
  });

  /* ---------- 1.18: sales tax by agency, Pay Sales Tax, reports ---------- */
  test('Combined sales tax: components by agency, split on documents, return per agency, Pay Sales Tax', function () {
    return newBook().then(function (b) {
      var tx, c;
      return rejects(b.saveSalesTax({ name: 'Bad', components: [{ name: 'State', rate: '5' }] }), /agency/).then(function () {
        return b.saveSalesTax({ name: 'Tucson combined', components: [{ name: 'Arizona', agency: 'Arizona DOR', rate: '5.6' }, { name: 'Pima County', agency: 'Arizona DOR', rate: '0.5' }, { name: 'Tucson', agency: 'City of Tucson', rate: '2.6' }] });
      }).then(function (x) {
        tx = x; eq(tx.rate, 87000, '5.6 + 0.5 + 2.6 = 8.7%'); eq(b.taxAgencies().map(function (a) { return a.agency; }).join('|'), 'Arizona DOR|City of Tucson');
        return cust(b, 'Shop');
      }).then(function (x) { c = x;
        return b.saveTransaction({ type: 'invoice', date: '2026-01-15', contactId: c.id, taxId: tx.id, lines: [{ accountId: acc(b, 'Sales'), amount: '1000', taxable: true }] });
      }).then(function (inv) {
        eq(inv.tax, 8700); eq(inv.taxParts.length, 3); eq(U.sum(inv.taxParts, function (p) { return p.amount; }), 8700); eq(inv.taxParts[2].amount, 2600);
        return b.saveContact({ kind: 'customer', name: 'School', taxExempt: true, exemptCert: { number: 'EX-1', state: 'az', reason: 'government', expires: '2027-12-31' } });
      }).then(function (sc) {
        eq(sc.exemptCert.state, 'AZ');
        return b.saveTransaction({ type: 'invoice', date: '2026-01-20', contactId: sc.id, lines: [{ accountId: acc(b, 'Sales'), amount: '300' }] });
      }).then(function () {
        var r = R.salesTaxByAgency(b, { from: '2026-01-01', to: '2026-03-31' });
        var az = r.rows.find(function (x) { return x.agency === 'Arizona DOR'; }), city = r.rows.find(function (x) { return x.agency === 'City of Tucson'; });
        eq(az.collected, 6100); eq(city.collected, 2600); eq(az.taxable, 100000); eq(r.exemptSales, 30000); eq(r.totals.due, 8700);
        return b.paySalesTax({ date: '2026-04-15', accountId: acc(b, 'Checking'), period: 'Q1 2026', items: [{ agency: 'Arizona DOR', amount: az.due }, { agency: 'City of Tucson', amount: city.due }] });
      }).then(function (checks) {
        eq(checks.length, 2); ok(b.contacts.some(function (x) { return x.kind === 'vendor' && x.name === 'City of Tucson'; }), 'agency vendor created');
        eq(b.accountBalance(b.sys('STAX').id), 0, 'liability cleared');
        var r = R.salesTaxByAgency(b, { from: '2026-04-01', to: '2026-06-30' });
        eq(r.rows.find(function (x) { return x.agency === 'Arizona DOR'; }).opening, 6100); eq(r.rows.find(function (x) { return x.agency === 'Arizona DOR'; }).paid, 6100); eq(r.totals.due, 0);
      });
    });
  });

  test('Reports: A/R Collections, Missing Checks, Voided/Changed, Cash Flow Forecast', function () {
    return newBook().then(function (b) {
      var c, inv;
      return b.saveContact({ kind: 'customer', name: 'Late Co', phone: '555-0100' }).then(function (x) { c = x;
        return b.saveTransaction({ type: 'invoice', date: '2026-01-01', dueDate: '2026-01-31', contactId: c.id, lines: [{ accountId: acc(b, 'Sales'), amount: '700' }] });
      }).then(function (x) { inv = x;
        var col = R.collections(b, { asOf: '2026-03-02' }); eq(col.groups.length, 1); eq(col.groups[0].total, 70000); eq(col.groups[0].oldest, 30); eq(col.groups[0].phone, '555-0100');
        return vend(b, 'V');
      }).then(function (v) {
        var mk = function (n, amt) { return b.saveTransaction({ type: 'check', date: '2026-02-0' + (n % 9 + 1), number: String(n), contactId: v.id, accountId: acc(b, 'Checking'), lines: [{ accountId: acc(b, 'Utilities'), amount: amt }] }); };
        return mk(101, '10').then(function () { return mk(102, '11'); }).then(function () { return mk(105, '12'); }).then(function () { return mk(105, '13'); });
      }).then(function () {
        var mc = R.missingChecks(b, { accountId: acc(b, 'Checking') }); eq(mc.gaps, 1); eq(mc.duplicates, 1);
        var gap = mc.rows.find(function (r) { return r.gap; }); eq(gap.from, 103); eq(gap.to, 104);
        return b.saveTransaction(Object.assign({}, inv, { lines: [{ accountId: acc(b, 'Sales'), amount: '750' }] }));
      }).then(function () { return b.saveTransaction({ type: 'expense', date: '2026-02-10', accountId: acc(b, 'Checking'), lines: [{ accountId: acc(b, 'Meals'), amount: '20' }] }); })
        .then(function (e) { return b.voidTransaction(e.id, 'dup'); })
        .then(function () {
          var ch = R.changedTransactions(b, {}); eq(ch.rows.length, 2);
          var ed = ch.rows.find(function (r) { return r.action === 'Changed'; }); ok(ed.changes.some(function (x) { return /amount 700.00 → 750.00/.test(x); }), ed.changes.join(';'));
          ok(ch.rows.some(function (r) { return r.action === 'Voided' && r.before === 2000; }));
          return b.saveTransaction({ type: 'bill', date: '2026-03-01', dueDate: '2026-03-20', contactId: b.contacts.find(function (x) { return x.kind === 'vendor'; }).id, lines: [{ accountId: acc(b, 'Rent & Lease'), amount: '400' }] });
        }).then(function () {
          var f = R.cashForecast(b, { asOf: '2026-03-02', weeks: 4 });
          eq(f.start, b.accountBalance(acc(b, 'Checking'), '2026-03-02')); eq(f.weeks.length, 4);
          eq(f.weeks[0].receipts, 75000, 'overdue invoice expected in the first week'); eq(f.weeks[2].payments, 40000, 'bill due 3/20 in week 3');
          eq(f.end, f.start + 75000 - 40000); eq(f.overdueIn, 75000);
        });
    });
  });

  /* runner */
  OB.runTests = function (onResult) {
    var results = [], i = 0;
    function next() {
      if (i >= T.length) return Promise.resolve(results);
      var t = T[i++], start = Date.now();
      return Promise.resolve().then(t.fn).then(function (ret) {
        var r = { name: t.name, ok: true, ms: Date.now() - start, info: ret && ret.info };
        results.push(r); if (onResult) onResult(r);
      }, function (e) {
        var r = { name: t.name, ok: false, ms: Date.now() - start, error: e && (e.stack || e.message) || String(e) };
        results.push(r); if (onResult) onResult(r);
      }).then(next);
    }
    return next();
  };
})(typeof window !== 'undefined' ? window : globalThis);
