/* VaultBook — Studio home widgets and New menu (1.25). Synthetic data only.
   Loaded after qbo.tests.js by tests/run-node.js and tests/tests.html; shares OB.tests. */
(function (root) {
  'use strict';
  var OB = root.OB, R = OB.reports;
  var T = OB.tests;
  function test(name, fn) { T.push({ name: name, fn: fn }); }
  function eq(a, b, msg) { if (a !== b) throw new Error((msg || 'Expected equal') + ': expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }
  function acc(b, name) { var a = b.accounts.find(function (x) { return x.name === name; }); if (!a) throw new Error('No account ' + name); return a.id; }

  function book() {
    var b, c, v;
    return OB.Book.create(new OB.MemoryAdapter(), { name: 'Home Co' }).then(function (bk) { b = bk; return Promise.all([b.saveContact({ kind: 'customer', name: 'Acme' }), b.saveContact({ kind: 'vendor', name: 'Paper Co' })]); }).then(function (cs) {
      c = cs[0].id; v = cs[1].id;
      var A = function (n) { return acc(b, n); };
      return b.saveTransactions([
        { type: 'deposit', date: '2026-09-01', accountId: A('Checking'), lines: [{ accountId: A('Opening Balance Equity'), amount: '9000' }] },
        // the 30 days before (Sep 12 – Oct 11): income 400, expense 100
        { type: 'salesReceipt', date: '2026-10-01', contactId: c, accountId: A('Checking'), lines: [{ accountId: A('Services'), amount: '400' }] },
        { type: 'expense', date: '2026-10-02', accountId: A('Checking'), contactId: v, lines: [{ accountId: A('Office Supplies & Software'), amount: '100' }] },
        // last 30 days (Oct 12 – Nov 10)
        { type: 'invoice', date: '2026-10-15', dueDate: '2026-10-30', contactId: c, number: '1', lines: [{ accountId: A('Services'), amount: '1000' }] },
        { type: 'invoice', date: '2026-11-01', dueDate: '2026-12-01', contactId: c, number: '2', lines: [{ accountId: A('Services'), amount: '600' }] },
        { type: 'expense', date: '2026-11-02', accountId: A('Checking'), lines: [{ accountId: A('Rent & Lease'), amount: '300' }] },
        { type: 'expense', date: '2026-11-03', accountId: A('Checking'), lines: [{ accountId: A('Office Supplies & Software'), amount: '50' }, { accountId: A('Utilities'), amount: '20' }] },
        { type: 'expense', date: '2026-11-04', accountId: A('Checking'), lines: [{ accountId: A('Insurance'), amount: '10' }, { accountId: A('Meals'), amount: '5' }] },
        { type: 'bill', date: '2026-11-05', dueDate: '2026-11-14', contactId: v, number: 'B1', lines: [{ accountId: A('Office Supplies & Software'), amount: '80' }] },
        { type: 'bill', date: '2026-11-05', dueDate: '2026-12-30', contactId: v, number: 'B2', lines: [{ accountId: A('Office Supplies & Software'), amount: '70' }] }
      ]).then(function (saved) {
        var inv1 = saved[3];
        return b.saveTransaction({ type: 'payment', date: '2026-11-06', contactId: c, accountId: b.sys('UNDEP').id, amount: '250', applications: [{ txnId: inv1.id, amount: '250' }] });
      }).then(function () { return { b: b, A: A }; });
    });
  }

  test('ST-01 home widgets: last-30-day profit and change, top expenses with the rest as Other', function () {
    return book().then(function (x) {
      var h = R.home(x.b, '2026-11-10');
      eq(h.from, '2026-10-12'); eq(h.to, '2026-11-10');
      eq(h.pnl.income, 160000); eq(h.pnl.expense, 53500, 'bills count on accrual basis'); eq(h.pnl.net, 106500);
      eq(h.pnl.prevNet, 30000); eq(h.pnl.change, 2.55, 'net up 255%');
      eq(h.expenses.total, 53500);
      eq(h.expenses.rows.map(function (r) { return r.label + ':' + r.amount; }).join('|'), 'Rent & Lease:30000|Office Supplies & Software:20000|Utilities:2000|Other:1500', 'three largest, then Other');
      eq(h.expenses.rows[3].accountId, '', 'Other has no account');
    });
  });

  test('ST-02 home widgets: invoices overdue / not due, paid and not deposited, bills due within 7 days, banks', function () {
    return book().then(function (x) {
      var h = R.home(x.b, '2026-11-10');
      eq(h.invoices.overdue.count, 1); eq(h.invoices.overdue.total, 75000, 'invoice 1 less the 250 paid');
      eq(h.invoices.notDue.count, 1); eq(h.invoices.notDue.total, 60000);
      eq(h.invoices.paid30, 25000);
      eq(h.invoices.undeposited, 25000);
      eq(h.bills.dueSoon.count, 1, 'B1 due Nov 14 is within 7 days; B2 is not'); eq(h.bills.dueSoon.total, 8000);
      eq(h.bills.open.count, 2); eq(h.bills.open.total, 15000);
      var chk = h.banks.find(function (y) { return y.account.name === 'Checking'; });
      eq(chk.balance, x.b.accountBalance(x.A('Checking'))); eq(chk.review, 0); eq(chk.bank, null, 'no bank file imported yet');
      eq(h.toReview, 0);
      eq(R.home(x.b, '2026-11-10', { days: 7 }).from, '2026-11-04', 'window length can change');
      var y = R.home(x.b, '2026-11-10', { from: '2026-01-01', to: '2026-12-31' });
      eq(y.from, '2026-01-01', 'a chosen period'); eq(y.to, '2026-11-10', 'never past today'); eq(y.days, 314, 'compared with as many days before');
      eq(y.pnl.net, R.pnl(x.b, { from: '2026-01-01', to: '2026-11-10', basis: x.b.company.basis }).netIncome[0], 'agrees with the P&L for the same dates');
    });
  });
  test('ST-03 report chart: income and expenses per period from the statement, total column left out; balance sheet as assets / liabilities / equity', function () {
    return book().then(function (x) {
      var st = R.statement(x.b, { kind: 'pl', from: '2026-10-01', to: '2026-11-30', basis: 'accrual', columns: 'month' });
      var ch = R.statementChart(st);
      eq(ch.series.map(function (s) { return s[0]; }).join(), 'inc,exp');
      eq(ch.points.length, 2, 'two months, no Total');
      eq(ch.points[0].values.inc, 140000); eq(ch.points[0].values.exp, 10000); eq(ch.points[0].net, 130000);
      eq(ch.points[1].values.inc, 60000); eq(ch.points[1].values.exp, 53500); eq(ch.max, 140000);
      var one = R.statementChart(R.statement(x.b, { kind: 'pl', from: '2026-10-01', to: '2026-11-30', basis: 'accrual', columns: 'total' }));
      eq(one.points.length, 1); eq(one.points[0].net, 136500);
      var bs = R.statementChart(R.statement(x.b, { kind: 'bs', from: '2026-01-01', to: '2026-11-30', basis: 'accrual', columns: 'total' }));
      eq(bs.series.length, 3); eq(bs.points[0].values.assets, bs.points[0].values.liab + bs.points[0].values.equity, 'assets = liabilities + equity');
    });
  });
})(typeof window !== 'undefined' ? window : globalThis);
