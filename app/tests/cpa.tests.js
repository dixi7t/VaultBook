/* VaultBook — CPA audit regression tests (CPA-01 … CPA-25). Each test reproduces the audit numbers.
   Loaded after engine.tests.js by tests/run-node.js and tests/tests.html; shares OB.tests and OB.runTests. */
(function (root) {
  'use strict';
  var OB = root.OB, U = OB.util, R = OB.reports;
  var T = OB.tests;
  function test(name, fn) { T.push({ name: name, fn: fn }); }
  function eq(a, b, msg) { if (a !== b) throw new Error((msg || 'Expected equal') + ': expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }
  function ok(v, msg) { if (!v) throw new Error(msg || 'Assertion failed'); }
  function near(a, b, tol, msg) { if (Math.abs(a - b) > tol) throw new Error((msg || 'Expected near') + ': expected ' + b + ' ± ' + tol + ', got ' + a); }
  function rejects(p, re, msg) {
    return p.then(function () { throw new Error((msg || 'Expected rejection') + ' but it succeeded'); }, function (e) {
      if (re && !re.test(e.message)) throw new Error((msg || 'Wrong error') + ': ' + e.message);
    });
  }
  function newBook(opts) { return OB.Book.create(new OB.MemoryAdapter(), Object.assign({ name: 'CPA Co' }, opts || {})); }
  function acc(book, name) { var a = book.accounts.find(function (x) { return x.name === name; }); if (!a) throw new Error('No account ' + name); return a.id; }
  function cust(book, name) { return book.saveContact({ kind: 'customer', name: name }); }
  function vend(book, name) { return book.saveContact({ kind: 'vendor', name: name }); }
  function bal(book, name, to) { return book.accountBalance(acc(book, name), to); }
  function clean(b) { var i = b.checkIntegrity(); eq(i.issues.length, 0, 'integrity: ' + i.issues.join('; ')); }
  // edit a posted document: start from the stored copy, like the form does (no tax fields in the draft)
  function draftOf(t, change) {
    var d = JSON.parse(JSON.stringify(t));
    delete d.splits; delete d.tax; delete d.taxRate; delete d.taxParts; delete d.taxableAmount; delete d.total;
    return Object.assign(d, change || {});
  }

  /* ---------- CPA-02: editing a posted document keeps its tax rate ---------- */
  test('CPA-02 editing a posted invoice keeps the tax rate it was posted at', function () {
    var b, c, tx, inv;
    return newBook().then(function (x) { b = x; return b.saveSalesTax({ name: 'NJ', agency: 'NJ Division of Taxation', rate: '6.625' }); })
      .then(function (x) { tx = x; return cust(b, 'Acme'); })
      .then(function (x) {
        c = x;
        return b.saveTransaction({ type: 'invoice', date: '2026-03-01', contactId: c.id, taxId: tx.id, lines: [{ accountId: acc(b, 'Sales'), amount: '1000', taxable: true }] });
      })
      .then(function (x) {
        inv = x; eq(inv.tax, 6625, 'tax at 6.625%');
        return b.saveSalesTax({ id: tx.id, name: tx.name, agency: tx.agency, rate: '7', accountId: tx.accountId });
      })
      .then(function () { return b.saveTransaction(draftOf(b.txById[inv.id], { memo: 'memo only' })); })
      .then(function (x) {
        eq(x.tax, 6625, 'memo-only edit keeps $66.25'); eq(x.total, 106625, 'total stays $1,066.25'); eq(x.taxRate, 66250, 'stored rate kept');
        var d = draftOf(x); d.lines[0].amount = '2000';
        return b.saveTransaction(d);
      })
      .then(function (x) {
        eq(x.tax, 13250, 'changed line re-taxed at the posted 6.625%');
        return b.saveTransaction(draftOf(x, { updateTaxRate: true }));
      })
      .then(function (x) {
        eq(x.tax, 14000, 'explicit update uses today\'s 7%'); eq(x.taxRate, 70000);
        return b.saveTransaction({ type: 'creditMemo', date: '2026-03-20', contactId: c.id, taxId: tx.id, fromInvoiceId: inv.id, lines: [{ accountId: acc(b, 'Sales'), amount: '100', taxable: true }] });
      })
      .then(function (cm) {
        eq(cm.taxRate, 70000, 'credit memo from the (now 7%) invoice uses the invoice rate');
        return b.saveSalesTax({ id: tx.id, name: tx.name, agency: tx.agency, rate: '8', accountId: tx.accountId });
      })
      .then(function () {
        return b.saveTransaction({ type: 'creditMemo', date: '2026-03-21', contactId: c.id, taxId: tx.id, lines: [{ accountId: acc(b, 'Sales'), amount: '10', taxable: true }], applications: [{ txnId: inv.id, amount: '1' }] });
      })
      .then(function (cm2) {
        eq(cm2.taxRate, 70000, 'credit memo applied to the invoice defaults to its rate, not today\'s 8%');
        clean(b);
      });
  });

  /* ---------- CPA-01: finance charges never re-charge days already charged ---------- */
  test('CPA-01 finance charges count only days not yet charged; void frees them; open balance as of the date', function () {
    var b, c, inv, fc1, o = { apr: 18, graceDays: 0 };
    var charge = function (asOf) { var r = b.financeChargePreview(Object.assign({ asOf: asOf }, o)); return r.length ? r[0].charge : 0; };
    return newBook().then(function (x) { b = x; return cust(b, 'Late Payer'); })
      .then(function (x) { c = x; return b.saveTransaction({ type: 'invoice', date: '2026-01-01', dueDate: '2026-01-31', contactId: c.id, lines: [{ accountId: acc(b, 'Services'), amount: '10000' }] }); })
      .then(function (x) {
        inv = x;
        eq(charge('2026-03-02'), 14795, '30 days on $10,000 at 18% = $147.95');
        return b.assessFinanceCharges(b.financeChargePreview(Object.assign({ asOf: '2026-03-02' }, o)), { asOf: '2026-03-02' });
      })
      .then(function (out) {
        fc1 = out[0];
        ok(fc1.financeChargeOf && fc1.financeChargeOf[0].txnId === inv.id && fc1.financeChargeOf[0].to === '2026-03-02', 'assessment records what it charged and through when');
        eq(charge('2026-03-02'), 0, 'running again the same day charges nothing');
        eq(charge('2026-04-01'), 14795, 'next month charges only the new 30 days');
        return b.voidTransaction(fc1.id);
      })
      .then(function () {
        eq(charge('2026-04-01'), 29589, 'after voiding the first charge, all 60 days are chargeable again');
        // a payment dated after asOf does not reduce the balance charged as of asOf
        return b.saveTransaction({ type: 'payment', date: '2026-04-15', contactId: c.id, accountId: acc(b, 'Checking'), amount: '10000', applications: [{ txnId: inv.id, amount: '10000' }] });
      })
      .then(function () {
        eq(charge('2026-04-01'), 29589, 'open balance is taken as of the assessment date');
        eq(charge('2026-05-01'), 0, 'paid in full before 5/1 → nothing to charge');
        clean(b);
      });
  });

  /* ---------- CPA-03: no overselling at $0; backdated entries recost later sales ---------- */
  function invSetup(opts) {
    var k = { };
    return newBook(opts).then(function (b) { k.b = b; return b.saveItem({ name: 'Widget', type: 'inventory', trackQty: true, incomeAccountId: acc(b, 'Sales'), price: '50', cost: '20' }); })
      .then(function (it) { k.it = it; return vend(k.b, 'Maker'); })
      .then(function (v) { k.v = v; return cust(k.b, 'Shop'); })
      .then(function (c) { k.c = c; k.inv = k.b.sys('INV').id; return k; });
  }
  function buy(k, date, qty, amt) { return k.b.saveTransaction({ type: 'bill', date: date, contactId: k.v.id, lines: [{ itemId: k.it.id, accountId: k.inv, qty: qty, amount: amt }] }); }
  function sell(k, date, qty) { return k.b.saveTransaction({ type: 'invoice', date: date, contactId: k.c.id, lines: [{ itemId: k.it.id, accountId: acc(k.b, 'Sales'), qty: qty, rate: '50' }] }); }
  test('CPA-03a selling more than is on hand is refused by default; allowed with the setting at standard cost', function () {
    var k;
    return invSetup().then(function (x) { k = x; return rejects(sell(k, '2026-03-10', 10), /on hand/i, 'oversell blocked'); })
      .then(function () { return k.b.saveCompany({ allowNegativeInventory: true }); })
      .then(function () { return sell(k, '2026-03-10', 10); })
      .then(function (t) {
        eq(t.lines[0].cost, 20000, 'shortfall costed at the item\'s standard cost ($20)');
        return buy(k, '2026-03-12', 10, '200');
      })
      .then(function () {
        var s = k.b.inventoryState()[k.it.id]; eq(s.qty, 0); eq(s.value, 0, 'no phantom $200 left in inventory');
        eq(k.b.accountBalance(k.inv), 0, 'Inventory Asset $0'); clean(k.b);
      });
  });
  test('CPA-03b a backdated purchase recosts the later sale (avg $20, COGS $200, inventory $200)', function () {
    var k, sale;
    return invSetup().then(function (x) { k = x; return buy(k, '2026-03-01', 10, '100'); })
      .then(function () { return sell(k, '2026-03-10', 10); })
      .then(function (t) { sale = t; eq(t.lines[0].cost, 10000); return buy(k, '2026-03-05', 10, '300'); })
      .then(function () {
        eq(k.b.txById[sale.id].lines[0].cost, 20000, 'sale recosted at the new average $20');
        eq(bal(k.b, 'Cost of Goods Sold'), 20000, 'COGS $200');
        var s = k.b.inventoryState()[k.it.id]; eq(s.qty, 10); eq(s.value, 20000); eq(Math.round(s.avg), 2000);
        var v = R.inventoryValuation(k.b, { asOf: '2026-12-31' }); eq(v.total, v.ledger, 'valuation = GL inventory asset');
        ok(k.b.audit.some(function (a) { return /Inventory recosted from/.test(a.summary); }), 'one audit entry for the recost');
        clean(k.b);
        return k.b.voidTransaction(k.b.transactions.find(function (t) { return t.type === 'bill' && t.date === '2026-03-05'; }).id);
      })
      .then(function () {
        eq(k.b.txById[sale.id].lines[0].cost, 10000, 'voiding the backdated purchase recosts the sale back to $100');
        eq(bal(k.b, 'Cost of Goods Sold'), 10000); clean(k.b);
      });
  });
  test('CPA-03c recosting never changes a closed period; one correcting adjustment in the first open period', function () {
    var k, sale;
    return invSetup().then(function (x) { k = x; return buy(k, '2026-03-01', 10, '100'); })
      .then(function () { return sell(k, '2026-03-10', 5); })
      .then(function (t) {
        // data saved by an older version: a backdated purchase that never recosted the sale
        sale = t; var real = k.b.recostInventory; k.b.recostInventory = function () { return Promise.resolve({ changed: [], skipped: [] }); };
        return buy(k, '2026-03-05', 10, '300').then(function () { k.b.recostInventory = real; });
      })
      .then(function () { eq(k.b.txById[sale.id].lines[0].cost, 5000, 'stale cost (old data)'); return k.b.saveCompany({ closingDate: '2026-03-31' }); })
      .then(function () { return k.b.recostInventory('2026-03-01', [k.it.id]); })
      .then(function (r) {
        eq(k.b.txById[sale.id].lines[0].cost, 5000, 'closed-period sale untouched');
        ok(r.skipped.indexOf(sale.id) >= 0, 'skipped document reported');
        var adj = k.b.transactions.find(function (t) { return t.type === 'invAdjust' && t.status === 'posted'; });
        ok(adj && adj.date === '2026-04-01', 'correction dated in the first open period');
        eq(adj.adjustments[0].value, -5000, 'correction = what the sale should have cost more ($100 − $50)');
        eq(bal(k.b, 'Cost of Goods Sold'), 10000, 'COGS now right in total');
        var v = R.inventoryValuation(k.b, { asOf: '2026-12-31' }); eq(v.total, v.ledger, 'valuation still = GL');
        clean(k.b);
      });
  });

  /* ---------- CPA-05: apply a credit without editing the (reconciled) payment ---------- */
  test('CPA-05 an unapplied amount on a reconciled payment can be applied to a new invoice', function () {
    var b, c, chk, a1, pay, a2;
    return newBook().then(function (x) { b = x; chk = acc(b, 'Checking'); return cust(b, 'Over Payer'); })
      .then(function (x) { c = x; return b.saveTransaction({ type: 'invoice', date: '2026-01-05', contactId: c.id, lines: [{ accountId: acc(b, 'Services'), amount: '100' }] }); })
      .then(function (x) { a1 = x; return b.saveTransaction({ type: 'payment', date: '2026-01-20', contactId: c.id, accountId: chk, amount: '150', applications: [{ txnId: a1.id, amount: '100' }] }); })
      .then(function (x) {
        pay = x; eq(b.openBalance(pay), 5000, '$50 unapplied');
        return b.finishReconciliation(chk, '2026-01-31', 15000, [{ txnId: pay.id, i: pay.splits.findIndex(function (s) { return s.accountId === chk; }) }]);
      })
      .then(function () { return b.saveCompany({ closingDate: '2026-01-31' }); })
      .then(function () { return b.saveTransaction({ type: 'invoice', date: '2026-02-10', contactId: c.id, lines: [{ accountId: acc(b, 'Services'), amount: '50' }] }); })
      .then(function (x) {
        a2 = x;
        return rejects(b.applyCredit(pay.id, a2.id, 5000, '2026-01-15'), /closed period/i, 'application date in a closed period refused');
      })
      .then(function () { return rejects(b.applyCredit(pay.id, a2.id, 6000, '2026-02-10'), /only \$50\.00/i, 'cannot apply more than is unapplied'); })
      .then(function () { return b.applyCredit(pay.id, a2.id, 5000, '2026-02-10'); })
      .then(function () {
        var p = b.txById[pay.id];
        eq(b.openBalance(a2.id), 0, 'new invoice paid'); eq(b.openBalance(p), 0, 'payment fully applied');
        ok(p.splits.some(function (s) { return s.cleared === 'R'; }), 'reconciliation untouched');
        eq(p.applications[1].date, '2026-02-10', 'application date stored');
        eq(b.openBalanceAsOf(a2.id, '2026-02-09'), 0, 'invoice not open before it existed'); eq(b.openBalanceAsOf(pay.id, '2026-02-09'), 5000, 'credit still unapplied before the application date');
        ok(b.audit.some(function (x) { return x.action === 'apply'; }), 'audit entry');
        clean(b);
      });
  });

  /* ---------- CPA-08 / CPA-24: aging ties to the GL on every date ---------- */
  function monthEnds(year) { var out = []; for (var m = 1; m <= 12; m++) out.push(U.monthEnd(year + '-' + (m < 10 ? '0' : '') + m + '-01')); return out; }
  function tieOut(b, kind, dates) {
    dates.forEach(function (d) { var ag = R.aging(b, { kind: kind, asOf: d }); eq(ag.total, ag.accountBalance, kind + ' aging = GL on ' + d); });
  }
  test('CPA-08 a payment applied to a later invoice stays an unapplied credit until the invoice exists', function () {
    var b, c, pay, inv;
    return newBook().then(function (x) { b = x; return cust(b, 'Early Bird'); })
      .then(function (x) { c = x; return b.saveTransaction({ type: 'payment', date: '2026-01-15', contactId: c.id, accountId: acc(b, 'Checking'), amount: '200' }); })
      .then(function (x) { pay = x; return b.saveTransaction({ type: 'invoice', date: '2026-05-01', contactId: c.id, lines: [{ accountId: acc(b, 'Services'), amount: '200' }] }); })
      .then(function (x) { inv = x; var d = JSON.parse(JSON.stringify(b.txById[pay.id])); delete d.splits; d.applications = [{ txnId: inv.id, amount: '200' }]; return b.saveTransaction(d); })
      .then(function () {
        var ag = R.aging(b, { kind: 'customer', asOf: '2026-02-28' });
        eq(ag.accountBalance, -20000, 'GL A/R at 2/28 is a $200 credit'); eq(ag.total, -20000, 'aging shows the unapplied credit');
        // and a payment dated before the invoice it pays, applied when entered
        return b.saveTransaction({ type: 'invoice', date: '2026-07-01', contactId: c.id, lines: [{ accountId: acc(b, 'Services'), amount: '300' }] });
      })
      .then(function (x) { return b.saveTransaction({ type: 'payment', date: '2026-06-20', contactId: c.id, accountId: acc(b, 'Checking'), amount: '300', applications: [{ txnId: x.id, amount: '300' }] }); })
      .then(function () { tieOut(b, 'customer', monthEnds(2026)); clean(b); });
  });
  test('CPA-08 sweep: mixed A/R and A/P activity — aging equals the GL at 12 month-ends', function () {
    var b, c, v, i1, i2, bl;
    return newBook().then(function (x) { b = x; return cust(b, 'Mixed'); })
      .then(function (x) { c = x; return vend(b, 'Supplier'); })
      .then(function (x) { v = x; return b.saveTransaction({ type: 'invoice', date: '2026-01-10', dueDate: '2026-02-09', contactId: c.id, lines: [{ accountId: acc(b, 'Services'), amount: '1000' }] }); })
      .then(function (x) { i1 = x; return b.saveTransaction({ type: 'invoice', date: '2026-03-05', dueDate: '2026-04-04', contactId: c.id, lines: [{ accountId: acc(b, 'Services'), amount: '500' }] }); })
      .then(function (x) { i2 = x; return b.saveTransaction({ type: 'payment', date: '2026-02-20', contactId: c.id, accountId: acc(b, 'Checking'), amount: '1200', applications: [{ txnId: i1.id, amount: '1000' }] }); })
      .then(function (p) { return b.applyCredit(p.id, i2.id, 20000, '2026-04-15'); })
      .then(function () { return b.saveTransaction({ type: 'creditMemo', date: '2026-05-02', contactId: c.id, lines: [{ accountId: acc(b, 'Services'), amount: '50' }] }); })
      .then(function () { return b.saveTransaction({ type: 'journal', date: '2026-06-30', jlines: [{ accountId: acc(b, 'Accounts Receivable (A/R)'), debit: '75', contactId: c.id }, { accountId: acc(b, 'Services'), credit: '75' }] }); })
      .then(function () { return b.saveTransaction({ type: 'bill', date: '2026-01-20', dueDate: '2026-02-19', contactId: v.id, lines: [{ accountId: acc(b, 'Office Supplies & Software'), amount: '400' }] }); })
      .then(function (x) { bl = x; return b.saveTransaction({ type: 'billPayment', date: '2026-03-01', contactId: v.id, accountId: acc(b, 'Checking'), amount: '500', applications: [{ txnId: bl.id, amount: '400' }] }); })
      .then(function () { return b.saveTransaction({ type: 'bill', date: '2026-08-01', contactId: v.id, lines: [{ accountId: acc(b, 'Office Supplies & Software'), amount: '100' }] }); })
      .then(function (x) { var bp = b.transactions.find(function (t) { return t.type === 'billPayment'; }); return b.applyCredit(bp.id, x.id, 10000, '2026-08-05'); })
      .then(function () {
        tieOut(b, 'customer', monthEnds(2026)); tieOut(b, 'vendor', monthEnds(2026));
        var je = R.aging(b, { kind: 'customer', asOf: '2026-09-30' }).rows[0].docs.find(function (d) { return d.other; });
        ok(je, 'the journal entry to A/R is listed');
        eq(je.daysPastDue, 92, 'CPA-24: journal entry aged by its own date'); ok(je.bucket === 4, 'CPA-24: 92 days → 91 and over');
        clean(b);
      });
  });

  /* ---------- CPA-04: vendor refund ---------- */
  test('CPA-04 a vendor refund closes the vendor credit; it can no longer reduce a bill; aging = GL; cash basis', function () {
    var b, v, bill, vc, ref;
    return newBook().then(function (x) { b = x; return vend(b, 'Refunder'); })
      .then(function (x) { v = x; return b.saveTransaction({ type: 'bill', date: '2026-02-01', contactId: v.id, lines: [{ accountId: acc(b, 'Office Supplies & Software'), amount: '500' }] }); })
      .then(function (x) { bill = x; return b.saveTransaction({ type: 'billPayment', date: '2026-02-10', contactId: v.id, accountId: acc(b, 'Checking'), amount: '500', applications: [{ txnId: bill.id, amount: '500' }] }); })
      .then(function () { return b.saveTransaction({ type: 'vendorCredit', date: '2026-02-15', contactId: v.id, lines: [{ accountId: acc(b, 'Office Supplies & Software'), amount: '200' }] }); })
      .then(function (x) { vc = x; return rejects(b.saveTransaction({ type: 'vendorRefund', date: '2026-02-20', contactId: v.id, accountId: acc(b, 'Checking'), amount: '250', applications: [{ txnId: vc.id, amount: '250' }] }), /only \$200\.00 open/); })
      .then(function () { return b.saveTransaction({ type: 'vendorRefund', date: '2026-02-20', contactId: v.id, accountId: acc(b, 'Checking'), amount: '200', applications: [{ txnId: vc.id, amount: '200' }] }); })
      .then(function (x) {
        ref = x;
        eq(b.openBalance(vc.id), 0, 'vendor credit fully used'); eq(b.contactBalance(v.id), 0, 'vendor balance $0');
        eq(bal(b, 'Checking'), -30000, 'bank: −$500 paid + $200 refunded');
        var dr = ref.splits.find(function (s) { return s.amount > 0; }); eq(dr.accountId, acc(b, 'Checking'), 'Dr bank'); eq(ref.splits.find(function (s) { return s.amount < 0; }).accountId, b.sys('AP').id, 'Cr A/P');
        return b.saveTransaction({ type: 'bill', date: '2026-03-01', contactId: v.id, lines: [{ accountId: acc(b, 'Office Supplies & Software'), amount: '300' }] });
      })
      .then(function (x) {
        eq(b.openDocs('billPayment', v.id).map(function (t) { return t.id; }).join(), x.id, 'only the new bill is open');
        return rejects(b.applyCredit(vc.id, x.id, 100, '2026-03-02'), /only \$0\.00 unapplied/, 'used credit cannot pay the new bill');
      })
      .then(function () {
        var ag = R.aging(b, { kind: 'vendor', asOf: '2026-03-31' }); eq(ag.total, ag.accountBalance, 'A/P aging = GL'); eq(ag.total, 30000);
        var cashFeb = R.pnl(b, { from: '2026-02-20', to: '2026-02-20', basis: 'cash' });
        var accrFeb = R.pnl(b, { from: '2026-02-01', to: '2026-02-28' });
        eq(cashFeb.netIncome[0], 20000, 'cash basis: the refund reduces the expense by $200 on its date');
        eq(accrFeb.netIncome[0], -30000, 'accrual: $500 bill − $200 credit');
        clean(b);
      });
  });

  /* ---------- CPA-06: available credits ---------- */
  test('CPA-06 Receive Payment: a $100 credit memo plus a $200 payment closes a $300 invoice', function () {
    var b, c, inv, cm;
    return newBook().then(function (x) { b = x; return cust(b, 'Credit Holder'); })
      .then(function (x) { c = x; return b.saveTransaction({ type: 'creditMemo', date: '2026-04-01', contactId: c.id, lines: [{ accountId: acc(b, 'Services'), amount: '100' }] }); })
      .then(function (x) { cm = x; return b.saveTransaction({ type: 'invoice', date: '2026-04-05', contactId: c.id, lines: [{ accountId: acc(b, 'Services'), amount: '300' }] }); })
      .then(function (x) {
        inv = x;
        var cr = b.availableCredits(c.id); eq(cr.length, 1); eq(cr[0].t.id, cm.id); eq(cr[0].open, 10000);
        eq(b.availableCredits(c.id, 'vendor').length, 0, 'customer credits only for a customer');
        return b.saveTransaction({ type: 'payment', date: '2026-04-20', contactId: c.id, accountId: acc(b, 'Checking'), amount: '200', applications: [{ txnId: inv.id, amount: '200' }] });
      })
      .then(function () { return b.applyCredit(cm.id, inv.id, 10000, '2026-04-20'); })
      .then(function () {
        eq(b.openBalance(inv.id), 0, 'invoice closed'); eq(b.openBalance(cm.id), 0, 'credit memo used');
        eq(b.availableCredits(c.id).length, 0, 'no credits left'); clean(b);
      });
  });

  /* ---------- CPA-09: bad-debt write-off reverses the sales tax ---------- */
  test('CPA-09 writing off $1,000 + $66.25 tax: Bad Debt $1,000, Sales Tax Payable $0, agency −$66.25', function () {
    var b, c, tx, inv, stp;
    return newBook().then(function (x) { b = x; return b.saveSalesTax({ name: 'NJ', agency: 'NJ Division of Taxation', rate: '6.625' }); })
      .then(function (x) { tx = x; stp = tx.accountId; return cust(b, 'Gone'); })
      .then(function (x) { c = x; return b.saveTransaction({ type: 'invoice', date: '2026-01-10', contactId: c.id, taxId: tx.id, lines: [{ accountId: acc(b, 'Sales'), amount: '1000', taxable: true }] }); })
      .then(function (x) { inv = x; return b.writeOffInvoice(inv.id, { date: '2026-06-30' }); })
      .then(function (cm) {
        eq(b.openBalance(inv.id), 0, 'invoice closed'); eq(cm.tax, 6625, 'tax part reversed');
        eq(bal(b, 'Bad Debt'), 100000, 'Bad Debt $1,000.00'); eq(b.accountBalance(stp), 0, 'Sales Tax Payable $0.00');
        var r = R.salesTaxByAgency(b, { from: '2026-06-01', to: '2026-06-30' }).rows[0]; eq(r.collected, -6625, 'agency return shows −$66.25 in June');
        clean(b);
        // a partly paid, partly taxable invoice; and the reverseTax: false option
        return b.saveTransaction({ type: 'invoice', date: '2026-02-01', contactId: c.id, taxId: tx.id, lines: [{ accountId: acc(b, 'Sales'), amount: '600', taxable: true }, { accountId: acc(b, 'Services'), amount: '400' }] });
      })
      .then(function (x) { inv = x; return b.saveTransaction({ type: 'payment', date: '2026-03-01', contactId: c.id, accountId: acc(b, 'Checking'), amount: '500', applications: [{ txnId: inv.id, amount: '500' }] }); })
      .then(function () { return b.writeOffInvoice(inv.id, { date: '2026-06-30' }); })
      .then(function (cm) {
        eq(b.openBalance(inv.id), 0, 'remaining balance written off exactly'); eq(cm.total, 53975, 'credit = open $539.75');
        near(cm.tax, Math.round(3975 * 53975 / 103975), 1, 'tax part pro rata to what is open');
        clean(b);
        return b.saveTransaction({ type: 'invoice', date: '2026-02-02', contactId: c.id, taxId: tx.id, lines: [{ accountId: acc(b, 'Sales'), amount: '100', taxable: true }] });
      })
      .then(function (x) { return b.writeOffInvoice(x.id, { date: '2026-06-30', reverseTax: false }); })
      .then(function (cm) { eq(cm.tax || 0, 0, 'reverseTax:false keeps the old behaviour'); eq(cm.total, 10663); clean(b); });
  });

  /* ---------- CPA-12: customer deposits cannot be over-applied ---------- */
  test('CPA-12 applying $900 against a $300 deposit is refused; $100 accepted; refunding the other $200 leaves $0', function () {
    var b, c, dep;
    return newBook().then(function (x) { b = x; return cust(b, 'Retainer Client'); })
      .then(function (x) { c = x; return b.receiveDeposit({ date: '2026-02-01', contactId: c.id, accountId: acc(b, 'Checking'), amount: '300' }); })
      .then(function () {
        dep = b.depositAccount().id; eq(b.depositsHeld(c.id, true), 30000);
        var inv = function (amt) { return { type: 'invoice', date: '2026-02-10', contactId: c.id, lines: [{ accountId: acc(b, 'Services'), amount: '1000' }, { accountId: dep, amount: '-' + amt, description: 'Deposit applied', contactId: c.id }] }; };
        return rejects(b.saveTransaction(inv('900')), /only \$300\.00 of deposits/i).then(function () { return b.saveTransaction(inv('100')); });
      })
      .then(function () {
        eq(b.depositsHeld(c.id, true), 20000, '$200 still held');
        return rejects(b.refundDeposit({ contactId: c.id, date: '2026-02-15', accountId: acc(b, 'Checking'), amount: '250' }), /only \$200\.00 of deposits/i);
      })
      .then(function () { return b.refundDeposit({ contactId: c.id, date: '2026-02-15', accountId: acc(b, 'Checking'), amount: '200' }); })
      .then(function (t) {
        eq(b.depositsHeld(c.id, true), 0, 'nothing left held'); eq(b.accountBalance(dep), 0, 'Customer Deposits $0');
        ok(t.type === 'check' && t.splits.some(function (s) { return s.accountId === dep && s.amount === 20000; }), 'refund check debits Customer Deposits');
        clean(b);
      });
  });

  /* ---------- CPA-07: cash basis recognises invoices paid from a deposit ---------- */
  function cashBal(b, accId, asOf) { return R.rawSum(R.entries(b, 'cash')[accId], '', asOf); }
  test('CPA-07 cash basis: a $500 invoice fully covered by a $500 deposit is $500 income; deposits $0; BS balances', function () {
    var b, c, dep;
    return newBook().then(function (x) { b = x; return cust(b, 'Prepaid'); })
      .then(function (x) { c = x; return b.receiveDeposit({ date: '2026-02-01', contactId: c.id, accountId: acc(b, 'Checking'), amount: '500' }); })
      .then(function () { dep = b.depositAccount().id; return b.saveTransaction({ type: 'invoice', date: '2026-03-01', contactId: c.id, lines: [{ accountId: acc(b, 'Services'), amount: '500' }, { accountId: dep, amount: '-500', description: 'Deposit applied', contactId: c.id }] }); })
      .then(function (inv) {
        eq(inv.total, 0, 'invoice fully covered');
        eq(R.pnl(b, { from: '2026-03-01', to: '2026-03-31' }).netIncome[0], 50000, 'accrual income $500');
        eq(R.pnl(b, { from: '2026-03-01', to: '2026-03-31', basis: 'cash' }).netIncome[0], 50000, 'cash income $500 in the invoice month');
        eq(R.pnl(b, { from: '2026-02-01', to: '2026-02-28', basis: 'cash' }).netIncome[0], 0, 'not income when the deposit arrived');
        eq(cashBal(b, dep, '2026-03-31'), 0, 'cash-basis Customer Deposits $0');
        ok(R.balanceSheet(b, { asOf: '2026-03-31', basis: 'cash' }).balanced, 'cash balance sheet balances');
        ok(R.balanceSheet(b, { asOf: '2026-03-31' }).balanced, 'accrual balance sheet balances');
        // partly covered: $100 deposit on a $1,000 invoice, $900 paid later — no double count
        return b.receiveDeposit({ date: '2026-04-01', contactId: c.id, accountId: acc(b, 'Checking'), amount: '100' });
      })
      .then(function () { return b.saveTransaction({ type: 'invoice', date: '2026-04-10', contactId: c.id, lines: [{ accountId: acc(b, 'Services'), amount: '1000' }, { accountId: dep, amount: '-100', contactId: c.id }] }); })
      .then(function (inv) { return b.saveTransaction({ type: 'payment', date: '2026-05-05', contactId: c.id, accountId: acc(b, 'Checking'), amount: '900', applications: [{ txnId: inv.id, amount: '900' }] }); })
      .then(function () {
        eq(R.pnl(b, { from: '2026-04-01', to: '2026-04-30', basis: 'cash' }).netIncome[0], 10000, 'April: the $100 covered by the deposit');
        eq(R.pnl(b, { from: '2026-05-01', to: '2026-05-31', basis: 'cash' }).netIncome[0], 90000, 'May: the $900 paid');
        eq(cashBal(b, dep, '2026-12-31'), 0, 'deposits relieved once'); ok(R.balanceSheet(b, { asOf: '2026-12-31', basis: 'cash' }).balanced);
        clean(b);
      });
  });

  /* ---------- CPA-10: Statement of Cash Flows classification ---------- */
  test('CPA-10 cash flows: depreciation is an operating add-back; Undeposited Funds is cash; per-account override', function () {
    var b, c, loc;
    return newBook().then(function (x) { b = x; return b.saveTransaction({ type: 'journal', date: '2026-03-31', jlines: [{ accountId: acc(b, 'Depreciation'), debit: '2400' }, { accountId: acc(b, 'Accumulated Depreciation'), credit: '2400' }] }); })
      .then(function () {
        var cf = R.cashFlow(b, { from: '2026-01-01', to: '2026-12-31' });
        eq(cf.netOperating, 0, 'operating $0 (net loss + depreciation add-back)'); eq(cf.netInvesting, 0, 'investing $0');
        ok(cf.operating.some(function (r) { return /Depreciation and amortization/.test(r.label) && r.amount === 240000; }), 'add-back line'); ok(cf.reconciles);
        return cust(b, 'Walk-in');
      })
      .then(function (x) { c = x; return b.saveTransaction({ type: 'salesReceipt', date: '2026-04-02', contactId: c.id, accountId: b.sys('UNDEP').id, lines: [{ accountId: acc(b, 'Sales'), amount: '1000' }] }); })
      .then(function () {
        var cf = R.cashFlow(b, { from: '2026-04-01', to: '2026-04-30' });
        eq(cf.cashEnd, 100000, 'cash in Undeposited Funds counts as cash'); eq(cf.netOperating, 100000); ok(cf.reconciles);
        return b.saveAccount({ name: 'Line of Credit', type: 'ocl', cashFlow: 'financing' });
      })
      .then(function (x) { loc = x; return b.saveTransaction({ type: 'deposit', date: '2026-05-03', accountId: acc(b, 'Checking'), lines: [{ accountId: loc.id, amount: '5000' }] }); })
      .then(function () {
        var cf = R.cashFlow(b, { from: '2026-05-01', to: '2026-05-31' });
        eq(cf.netFinancing, 500000, 'line of credit draw is financing'); eq(cf.netOperating, 0); ok(cf.reconciles);
        return newBook();
      })
      .then(function (s) { return OB.sample.populate(s, '2026-06-30').then(function () { var cf = R.cashFlow(s, { from: '2026-01-01', to: '2026-06-30' }); ok(cf.reconciles, 'sample company reconciles'); }); });
  });

  /* ---------- CPA-11: fixed asset disposal and MACRS conventions ---------- */
  function asset(b, extra) {
    return b.saveFixedAsset(Object.assign({ name: 'Truck', inService: '2026-03-15', cost: '5000', method: 'MACRS', macrsClass: 5,
      accountId: acc(b, 'Vehicles'), accumAccountId: acc(b, 'Accumulated Depreciation'), expenseAccountId: acc(b, 'Depreciation') }, extra || {}));
  }
  test('CPA-11 MACRS half-year: disposal year gets half the table amount (5-yr $5,000, 3/2026 → 6/30/2028 = $3,080)', function () {
    var b, a;
    return newBook().then(function (x) { b = x; return asset(b); })
      .then(function (x) {
        a = x;
        var sch = OB.Book.depSchedule(Object.assign({}, a, { disposed: '2028-06-30' }));
        eq(U.sum(sch, function (r) { return r.amount; }), 308000, '$1,000 + $1,600 + $480');
        eq(sch[sch.length - 1].date, '2028-06-30');
      });
  });
  test('CPA-11 disposal: depreciation to date, then cost and accumulated depreciation cleared, gain booked, BS balances', function () {
    var b, a, r;
    return newBook().then(function (x) { b = x; return b.saveTransaction({ type: 'deposit', date: '2026-01-02', accountId: acc(b, 'Checking'), lines: [{ accountId: acc(b, 'Owner\'s Investment'), amount: '6000' }] }); })
      .then(function () { return b.saveTransaction({ type: 'check', date: '2026-03-15', accountId: acc(b, 'Checking'), number: '101', lines: [{ accountId: acc(b, 'Vehicles'), amount: '5000' }] }); })
      .then(function () { return asset(b); })
      .then(function (x) { a = x; return b.recordDepreciation('2027-12-31'); })
      .then(function () {
        eq(b.depreciationRecorded(a.id), 260000, '2026–2027 recorded');
        return b.disposeFixedAsset(a.id, { date: '2028-06-30', proceeds: '2500', depositAccountId: acc(b, 'Checking') });
      })
      .then(function (res) {
        r = R.fixedAssets(b, { asOf: '2028-12-31' }).rows.find(function (x) { return x.assetId === a.id; });
        eq(r.cost, 0, 'asset cost cleared'); eq(r.recorded, 0, 'accumulated depreciation cleared'); eq(r.bookValue, 0);
        eq(b.accountBalance(acc(b, 'Vehicles'), '2028-12-31'), 0, 'GL Vehicles $0'); eq(b.accountBalance(acc(b, 'Accumulated Depreciation'), '2028-12-31'), 0, 'GL accumulated $0');
        // book value at disposal 5,000 − 3,080 = 1,920; proceeds 2,500 → gain 580
        eq(res.gain, 58000, 'gain $580'); eq(b.accountBalance(b.accounts.find(function (x) { return /gain\/loss on sale/i.test(x.name); }).id, '2028-12-31'), 58000);
        eq(b.depreciationDue('2029-12-31').filter(function (d) { return d.assetId === a.id; }).length, 0, 'nothing due after disposal');
        ok(R.balanceSheet(b, { asOf: '2028-12-31' }).balanced, 'balance sheet balances');
        var cf = R.cashFlow(b, { from: '2028-01-01', to: '2028-12-31' });
        eq(cf.netInvesting, 250000, 'proceeds are investing'); eq(cf.netOperating, 0, 'gain removed from operating; depreciation added back'); ok(cf.reconciles);
        clean(b);
        return b.voidTransaction(res.disposal.id);
      })
      .then(function () {
        r = R.fixedAssets(b, { asOf: '2028-12-31' }).rows.find(function (x) { return x.assetId === a.id; });
        eq(r.cost, 500000, 'voiding the disposal restores the asset'); clean(b);
      });
  });
  test('CPA-11 mid-quarter convention, separate book/tax methods, register = GL reconciliation', function () {
    var b;
    Object.keys(OB.Book.MACRS).forEach(function (k) { eq(JSON.stringify(OB.Book.macrsTable(+k, 0.5)), JSON.stringify(OB.Book.MACRS[k]), k + '-yr generator reproduces Pub. 946 Table A-1'); });
    Object.keys(OB.Book.MACRS_MQ).forEach(function (k) { OB.Book.MACRS_MQ[k].forEach(function (row, q) { near(row.reduce(function (s, x) { return s + x; }, 0), 100, 0.02, k + '-yr Q' + (q + 1) + ' table sums to 100%'); }); });
    return newBook().then(function (x) { b = x; return asset(b, { name: 'Computer', inService: '2026-11-10', cost: '3000', macrsClass: 5 }); })
      .then(function () { return asset(b, { name: 'Desk', inService: '2026-02-01', cost: '1000', macrsClass: 7 }); })
      .then(function () {
        var w = R.macrsConventionCheck(b, 2026);
        ok(w.midQuarter, '75% of 2026 MACRS basis placed in service in Q4 → mid-quarter applies'); near(w.q4Share, 0.75, 0.001);
        var pc = OB.Book.depSchedule(Object.assign({}, b.company.fixedAssets[0], { convention: 'MQ' }));
        eq(pc[0].amount, 15000, '5-yr mid-quarter Q4 year 1 = 5%');
        return b.saveFixedAsset(Object.assign({}, b.company.fixedAssets[1], { method: 'SL', lifeMonths: 84, taxMethod: 'MACRS', taxClass: 7 }));
      })
      .then(function (a) {
        eq(a.method, 'SL', 'book method posts'); eq(a.taxMethod, 'MACRS'); eq(a.taxClass, 7);
        var r = R.fixedAssets(b, { asOf: '2026-12-31' });
        var row = r.rows.find(function (x) { return x.assetId === a.id; }); eq(row.taxThisYear, 14290, 'tax depreciation 14.29% shown separately');
        ok(r.reconcile && r.reconcile.register === 400000 && r.reconcile.ledger === 0 && r.reconcile.difference === 400000, 'register vs GL difference reported (assets not bought through the GL here)');
      });
  });

  /* ---------- CPA-14: reversing entries keep class and asset; default date = day after the period end ---------- */
  test('CPA-14 reverseJournal copies class (header and line) and assetId, defaults to the first day of the next period', function () {
    var b, cls, cls2, je;
    return newBook().then(function (x) { b = x; return b.saveClass({ name: 'East' }); })
      .then(function (c) { cls = c; return b.saveClass({ name: 'West' }); })
      .then(function (c) { cls2 = c; return b.saveTransaction({ type: 'journal', date: '2026-03-17', classId: cls.id, memo: 'Accrual', jlines: [
        { accountId: acc(b, 'Depreciation'), debit: '100', classId: cls2.id, assetId: 'fa_x' }, { accountId: acc(b, 'Accumulated Depreciation'), credit: '100', assetId: 'fa_x' }] }); })
      .then(function (t) { je = t; return b.reverseJournal(t.id); })
      .then(function (rev) {
        eq(rev.date, '2026-04-01', 'day after the March period end');
        eq(rev.classId, cls.id, 'header class kept');
        eq(rev.jlines[0].classId, cls2.id, 'line class kept'); eq(rev.jlines[0].assetId, 'fa_x', 'asset kept'); eq(rev.jlines[1].assetId, 'fa_x');
        eq(rev.jlines[0].credit, 10000); eq(rev.jlines[0].debit, 0);
        var byCls = {}; b.posted().forEach(function (t) { (t.splits || []).forEach(function (s) { byCls[s.classId || ''] = (byCls[s.classId || ''] || 0) + s.amount; }); });
        eq(byCls[cls2.id], 0, 'class P&L nets to zero after reversal'); eq(byCls[cls.id], 0);
        clean(b);
      });
  });

  /* ---------- CPA-13: early-payment discounts; bounced payments ---------- */
  test('CPA-13 2% 10 Net 30: discount taken through a credit memo to Sales Discounts in the same write as the payment', function () {
    var b, c, inv;
    return newBook().then(function (x) { b = x; return b.saveContact({ kind: 'customer', name: 'Acme', terms: 30, discountPct: 2, discountDays: 10 }); })
      .then(function (x) { c = x; eq(c.discountPct, 2); eq(c.discountDays, 10);
        return b.saveTransaction({ type: 'invoice', date: '2026-05-01', contactId: c.id, terms: 30, discountPct: c.discountPct, discountDays: c.discountDays, lines: [{ accountId: acc(b, 'Services'), amount: '1000' }] }); })
      .then(function (t) {
        inv = t; eq(inv.discountPct, 2); eq(inv.discountDays, 10);
        eq(b.discountAvailable(inv.id, '2026-05-11').amount, 2000, '$20 through May 11'); eq(b.discountAvailable(inv.id, '2026-05-11').lastDay, '2026-05-11');
        eq(b.discountAvailable(inv.id, '2026-05-12').amount, 0, 'expired after the discount days');
        var writes = 0, put = b.adapter.putMany; b.adapter.putMany = function (ops) { if (ops.some(function (o) { return o.store === 'transactions'; })) writes++; return put.apply(this, arguments); };
        return b.receiveWithDiscount({ type: 'payment', date: '2026-05-10', contactId: c.id, accountId: acc(b, 'Checking'), amount: '980', applications: [{ txnId: inv.id, amount: '980' }] }, [{ txnId: inv.id }])
          .then(function (r) { b.adapter.putMany = put; eq(writes, 1, 'payment and discount credit in one transaction write (the discount account is set up first)'); return r; });
      })
      .then(function (r) {
        eq(r.credits.length, 1); eq(r.credits[0].type, 'creditMemo'); eq(r.credits[0].total, 2000); eq(r.credits[0].discountOf, inv.id);
        eq(b.openBalance(b.txById[inv.id]), 0, 'invoice paid in full'); eq(bal(b, 'Sales Discounts', '2026-05-31'), -2000, 'sales discounts (contra income) $20');
        eq(bal(b, 'Checking', '2026-05-31'), 98000); eq(b.contactBalance(c.id), 0);
        clean(b);
        return b.receiveWithDiscount({ type: 'payment', date: '2026-05-20', contactId: c.id, accountId: acc(b, 'Checking'), amount: '1' }, [{ txnId: inv.id, amount: '5' }]).then(function () { throw new Error('should reject'); }, function (e) { ok(/no early-payment discount|open/i.test(e.message), e.message); });
      })
      .then(function () { eq(b.transactions.filter(function (t) { return t.status === 'posted'; }).length, 3, 'a rejected batch writes nothing'); clean(b); });
  });
  test('CPA-13 vendor terms discount: vendor credit to Purchase Discounts with the bill payment', function () {
    var b, v, bill;
    return newBook().then(function (x) { b = x; return b.saveContact({ kind: 'vendor', name: 'Supply Co', terms: 30, discountPct: 1.5, discountDays: 15 }); })
      .then(function (x) { v = x; return b.saveTransaction({ type: 'bill', date: '2026-06-01', contactId: v.id, terms: 30, discountPct: 1.5, discountDays: 15, lines: [{ accountId: acc(b, 'Office Supplies & Software'), amount: '400' }] }); })
      .then(function (t) { bill = t; return b.receiveWithDiscount({ type: 'billPayment', date: '2026-06-10', contactId: v.id, accountId: acc(b, 'Checking'), amount: '394', applications: [{ txnId: bill.id, amount: '394' }] }, [{ txnId: bill.id }]); })
      .then(function (r) {
        eq(r.credits[0].type, 'vendorCredit'); eq(r.credits[0].total, 600);
        eq(b.openBalance(b.txById[bill.id]), 0); eq(b.contactBalance(v.id), 0); eq(bal(b, 'Purchase Discounts', '2026-06-30'), -600, 'purchase discounts reduce cost');
        clean(b);
      });
  });
  test('CPA-13 bounced payment: original untouched, A/R re-opened by a new entry, bank and customer fees', function () {
    var b, c, inv, pay;
    return newBook().then(function (x) { b = x; return cust(b, 'Beta'); })
      .then(function (x) { c = x; return b.saveTransaction({ type: 'invoice', date: '2026-07-01', contactId: c.id, lines: [{ accountId: acc(b, 'Services'), amount: '500' }] }); })
      .then(function (t) { inv = t; return b.saveTransaction({ type: 'payment', date: '2026-07-05', contactId: c.id, accountId: b.sys('UNDEP').id, amount: '500', applications: [{ txnId: inv.id, amount: '500' }] }); })
      .then(function (p) { pay = p; return b.saveTransaction({ type: 'deposit', date: '2026-07-06', accountId: acc(b, 'Checking'), lines: [{ fromTxnId: pay.id, accountId: b.sys('UNDEP').id, amount: '500', contactId: c.id }] }); })
      .then(function () {
        var before = JSON.stringify(b.txById[pay.id]);
        return b.recordBouncedPayment(pay.id, { date: '2026-07-12', bankFee: '15', customerFee: '25' }).then(function (r) { eq(JSON.stringify(b.txById[pay.id]), before, 'original payment untouched'); return r; });
      })
      .then(function (r) {
        eq(r.charge.bounceOf, pay.id); eq(r.charge.total, 52500, 'customer owes the $500 again plus a $25 fee');
        eq(bal(b, 'Checking', '2026-07-31'), -1500, 'bank: +500 −500 −15');
        eq(b.contactBalance(c.id), 52500, 'A/R re-opened');
        eq(bal(b, 'Bank Charges & Fees', '2026-07-31'), 1500);
        var ag = R.aging(b, { kind: 'customer', asOf: '2026-07-31' }); eq(ag.rows[0].total, 52500);
        ok(R.balanceSheet(b, { asOf: '2026-07-31' }).balanced, 'BS balances (accrual)'); ok(R.balanceSheet(b, { asOf: '2026-07-31', basis: 'cash' }).balanced, 'BS balances (cash)');
        clean(b);
        return b.recordBouncedPayment(pay.id, { date: '2026-07-13' }).then(function () { throw new Error('should reject'); }, function (e) { ok(/already/i.test(e.message), e.message); });
      });
  });

  test('CPA-13 saveTransactions: a failed write leaves memory exactly as before', function () {
    var b, c, n, aud;
    return newBook().then(function (x) { b = x; return cust(b, 'Gamma'); })
      .then(function (x) {
        c = x; n = b.transactions.length; aud = b.audit.length;
        var put = b.adapter.putMany; b.adapter.putMany = function () { return Promise.reject(new Error('disk full')); };
        return b.saveTransactions([{ type: 'invoice', date: '2026-08-01', contactId: c.id, lines: [{ accountId: acc(b, 'Services'), amount: '10' }] },
          function (done) { return { type: 'payment', date: '2026-08-02', contactId: c.id, accountId: acc(b, 'Checking'), amount: '10', applications: [{ txnId: done[0].id, amount: '10' }] }; }])
          .then(function () { throw new Error('should fail'); }, function (e) { b.adapter.putMany = put; eq(e.message, 'disk full'); });
      })
      .then(function () { eq(b.transactions.length, n); eq(b.audit.length, aud); eq(b.contactBalance(c.id), 0); clean(b); });
  });

  /* ---------- Phase 4: warnings (CPA-15–18, CPA-08) and controls (CPA-19–23, 25) ---------- */
  function codes(ws) { return ws.map(function (w) { return w.code; }).sort().join(','); }
  test('CPA-15/16/17/18/08 warnings(): duplicate bill no., duplicate check no., wrong account types, inactive names, payment before document', function () {
    var b, v, c, it, bill, chk, inv;
    return newBook().then(function (x) { b = x; return vend(b, 'Paper Co'); })
      .then(function (x) { v = x; return cust(b, 'Delta'); })
      .then(function (x) { c = x; return b.saveItem({ name: 'Old service', type: 'service', incomeAccountId: acc(b, 'Services'), price: '10' }); })
      .then(function (x) { it = x; return b.saveTransaction({ type: 'bill', date: '2026-02-01', contactId: v.id, number: 'A-100', lines: [{ accountId: acc(b, 'Office Supplies & Software'), amount: '50' }] }); })
      .then(function (x) { bill = x; return b.saveTransaction({ type: 'check', date: '2026-02-02', accountId: acc(b, 'Checking'), number: '1001', contactId: v.id, lines: [{ accountId: acc(b, 'Rent & Lease'), amount: '100' }] }); })
      .then(function (x) { chk = x; return b.saveTransaction({ type: 'invoice', date: '2026-03-01', contactId: c.id, lines: [{ itemId: it.id, accountId: acc(b, 'Services'), amount: '10' }] }); })
      .then(function (x) {
        inv = x;
        var w = b.warnings(b.normalize({ type: 'bill', date: '2026-02-05', contactId: v.id, number: ' a-100 ', lines: [{ accountId: acc(b, 'Office Supplies & Software'), amount: '50' }] }));
        eq(codes(w), 'CPA-15', 'same vendor + bill number'); ok(/A-100/.test(w[0].message));
        eq(codes(b.warnings(b.normalize({ type: 'bill', date: '2026-02-05', contactId: v.id, number: 'A-100', lines: [{ accountId: acc(b, 'Office Supplies & Software'), amount: '50' }] }), bill)), '', 'editing the bill itself is fine');
        eq(codes(b.warnings(b.normalize({ type: 'expense', date: '2026-02-06', accountId: acc(b, 'Checking'), number: '1001', lines: [{ accountId: acc(b, 'Meals'), amount: '5' }] }))), 'CPA-16', 'same bank + check number');
        eq(codes(b.warnings(b.normalize({ type: 'check', date: '2026-02-06', accountId: acc(b, 'Savings'), number: '1001', lines: [{ accountId: acc(b, 'Meals'), amount: '5' }] }))), '', 'another bank account may reuse the number');
        eq(codes(b.warnings(b.normalize({ type: 'invoice', date: '2026-02-06', contactId: c.id, lines: [{ accountId: acc(b, 'Checking'), amount: '5' }] }))), 'CPA-17', 'invoice line to a bank account');
        eq(codes(b.warnings(b.normalize({ type: 'check', date: '2026-02-06', accountId: acc(b, 'Checking'), number: '1002', lines: [{ accountId: acc(b, 'Services'), amount: '5' }] }))), 'CPA-17', 'check line to an income account');
        return b.saveContact({ id: c.id, kind: 'customer', name: 'Delta', active: false });
      })
      .then(function () { return b.saveItem(Object.assign({}, it, { active: false })); })
      .then(function () {
        var w = b.warnings(b.normalize({ type: 'invoice', date: '2026-04-01', contactId: c.id, lines: [{ itemId: it.id, accountId: acc(b, 'Services'), amount: '10' }] }));
        eq(codes(w), 'CPA-18,CPA-18', 'inactive customer and item');
        eq(codes(b.warnings(b.normalize(Object.assign({}, draftOf(inv), { memo: 'edit' })), inv)), '', 'editing an existing document for them is allowed');
        return b.saveContact({ id: c.id, kind: 'customer', name: 'Delta', active: true });
      })
      .then(function () {
        var w = b.warnings(b.normalize({ type: 'payment', date: '2026-02-20', contactId: c.id, accountId: acc(b, 'Checking'), amount: '10', applications: [{ txnId: inv.id, amount: '10' }] }));
        eq(codes(w), 'CPA-08', 'payment dated before the invoice it pays');
        // imports never see warnings: a duplicate bill number still posts through postBatch / saveTransaction
        return b.saveTransaction({ type: 'bill', date: '2026-02-05', contactId: v.id, number: 'A-100', lines: [{ accountId: acc(b, 'Office Supplies & Software'), amount: '50' }] });
      })
      .then(function (t) { ok(t.id, 'warnings do not block saving'); clean(b); });
  });
  test('CPA-25 expense / check lines to Undeposited Funds are blocked', function () {
    var b;
    return newBook().then(function (x) { b = x;
      return rejects(b.saveTransaction({ type: 'expense', date: '2026-02-06', accountId: acc(b, 'Checking'), lines: [{ accountId: b.sys('UNDEP').id, amount: '5' }] }), /Undeposited Funds/); })
      .then(function () { return rejects(b.saveTransaction({ type: 'check', date: '2026-02-06', accountId: acc(b, 'Checking'), number: '7', lines: [{ accountId: b.sys('UNDEP').id, amount: '5' }] }), /Undeposited Funds/); });
  });
  test('CPA-19/20 reconciliation controls: undo in a closed period needs the password; statement date must follow the last one', function () {
    var b, chk, dep;
    return newBook().then(function (x) { b = x; return b.saveTransaction({ type: 'deposit', date: '2026-01-05', accountId: acc(b, 'Checking'), lines: [{ accountId: acc(b, 'Owner\'s Investment'), amount: '100' }] }); })
      .then(function (t) { dep = t; return b.finishReconciliation(acc(b, 'Checking'), '2026-01-31', 10000, [{ txnId: t.id, i: t.splits.findIndex(function (s) { return s.accountId === acc(b, 'Checking'); }) }]); })
      .then(function () { return rejects(b.finishReconciliation(acc(b, 'Checking'), '2026-01-31', 10000, []), /after .*last reconciliation|Jan 31, 2026|01\/31\/2026/i); })
      .then(function () { return rejects(b.finishReconciliation(acc(b, 'Checking'), '2026-01-15', 10000, []), /after/i); })
      .then(function () { return b.saveCompany({ closingDate: '2026-01-31', newClosingPassword: 'pw12' }); })
      .then(function () { return rejects(b.undoLastReconciliation(acc(b, 'Checking')), /closing date password/i); })
      .then(function () { return rejects(b.undoLastReconciliation(acc(b, 'Checking'), 'wrong'), /incorrect/i); })
      .then(function () { return b.undoLastReconciliation(acc(b, 'Checking'), 'pw12'); })
      .then(function (rec) { ok(rec.undone); return b.finishReconciliation(acc(b, 'Checking'), '2026-01-31', 10000, [{ txnId: dep.id, i: dep.splits.findIndex(function (s) { return s.accountId === acc(b, 'Checking'); }) }]); })
      .then(function (rec) { ok(rec.id, 'after an undo the same statement date can be reconciled again'); clean(b); });
  });
  test('CPA-21 void as of a date: the closed period stays as reported, a reversing entry lands in the open period', function () {
    var b, c, inv;
    return newBook().then(function (x) { b = x; return cust(b, 'Echo'); })
      .then(function (x) { c = x; return b.saveTransaction({ type: 'invoice', date: '2026-01-10', contactId: c.id, lines: [{ accountId: acc(b, 'Services'), amount: '300' }] }); })
      .then(function (t) { inv = t; return b.saveCompany({ closingDate: '2026-01-31' }); })
      .then(function () { return rejects(b.voidTransaction(inv.id, 'wrong customer'), /closed period/); })
      .then(function () { return rejects(b.voidTransaction(inv.id, 'x', { asOf: '2026-01-20' }), /open period|after/i); })
      .then(function () { return b.voidTransaction(inv.id, 'wrong customer', { asOf: '2026-02-03' }); })
      .then(function (je) {
        eq(je.type, 'journal'); eq(je.date, '2026-02-03'); eq(je.voidOf, inv.id);
        var o = b.txById[inv.id]; eq(o.status, 'posted', 'original stays posted in the closed period'); eq(o.voidedBy, je.id);
        eq(bal(b, 'Services', '2026-01-31'), 30000, 'January as reported'); eq(b.accountBalance(acc(b, 'Services'), '2026-02-28', '2026-02-01'), -30000, 'reversed in February'); ok(R.balanceSheet(b, { asOf: '2026-02-28', basis: 'cash' }).balanced, 'cash basis balances'); eq(R.netIncome(b, 'cash', '2026-01-01', '2026-02-28'), 0, 'cash basis: never earned, never reversed');
        eq(b.contactBalance(c.id), 0); eq(b.openBalance(o), 0, 'nothing left to collect');
        eq(R.aging(b, { kind: 'customer', asOf: '2026-01-31' }).rows[0].total, 30000, 'aging as of January unchanged');
        eq(R.aging(b, { kind: 'customer', asOf: '2026-02-28' }).rows.length, 0, 'aging after the void: nothing open');
        clean(b);
        return rejects(b.voidTransaction(inv.id, 'again', { asOf: '2026-02-04' }), /already/i);
      });
  });
  test('CPA-22 a discount line on a new document follows the taxability of the lines above it ($100 − $20 at 10% → $8.00)', function () {
    var b, tx, c, disc;
    return newBook().then(function (x) { b = x; return b.saveSalesTax({ name: 'Ten', agency: 'State', rate: '10' }); })
      .then(function (x) { tx = x; return cust(b, 'Foxtrot'); })
      .then(function (x) { c = x; return b.saveItem({ name: 'Promo', type: 'discount', incomeAccountId: acc(b, 'Sales') }); })
      .then(function (x) { disc = x; return b.saveTransaction({ type: 'invoice', date: '2026-03-01', contactId: c.id, taxId: tx.id, lines: [{ accountId: acc(b, 'Sales'), amount: '100', taxable: true }, { itemId: disc.id, accountId: acc(b, 'Sales'), amount: '-20' }] }); })
      .then(function (t) {
        eq(t.tax, 800, 'tax on the discounted amount'); eq(t.lines[1].taxable, true);
        return b.saveTransaction(Object.assign(draftOf(t), { id: t.id, lines: [{ accountId: acc(b, 'Sales'), amount: '100', taxable: true }, { itemId: disc.id, accountId: acc(b, 'Sales'), amount: '-20', taxable: false }] }));
      })
      .then(function (t) { eq(t.tax, 1000, 'an explicit choice is kept'); clean(b); });
  });
  test('CPA-23 sales tax by agency: exempt status saved at posting; cash basis recognises tax as payments are applied', function () {
    var b, tx, c, ex, inv;
    return newBook().then(function (x) { b = x; return b.saveSalesTax({ name: 'Ten', agency: 'State', rate: '10' }); })
      .then(function (x) { tx = x; return cust(b, 'Golf'); })
      .then(function (x) { c = x; return b.saveContact({ kind: 'customer', name: 'Church', taxExempt: true }); })
      .then(function (x) { ex = x; return b.saveTransaction({ type: 'invoice', date: '2026-03-01', contactId: ex.id, lines: [{ accountId: acc(b, 'Sales'), amount: '200' }] }); })
      .then(function (t) { eq(t.exempt, true, 'exempt flag saved on the document'); return b.saveContact({ id: ex.id, kind: 'customer', name: 'Church', taxExempt: false }); })
      .then(function () {
        eq(R.salesTaxByAgency(b, { from: '2026-03-01', to: '2026-03-31' }).exemptSales, 20000, 'still exempt after the customer flag changes');
        return b.saveTransaction({ type: 'invoice', date: '2026-03-05', contactId: c.id, taxId: tx.id, lines: [{ accountId: acc(b, 'Sales'), amount: '100', taxable: true }] });
      })
      .then(function (t) { inv = t; eq(t.exempt, false, 'taxable customer when posted'); return b.saveTransaction({ type: 'payment', date: '2026-04-10', contactId: c.id, accountId: acc(b, 'Checking'), amount: '55', applications: [{ txnId: t.id, amount: '55' }] }); })
      .then(function () {
        var mar = R.salesTaxByAgency(b, { from: '2026-03-01', to: '2026-03-31', basis: 'cash' }).rows.find(function (r) { return r.agency === 'State'; });
        var apr = R.salesTaxByAgency(b, { from: '2026-04-01', to: '2026-04-30', basis: 'cash' }).rows.find(function (r) { return r.agency === 'State'; });
        eq(mar.collected, 0, 'nothing collected in March on cash basis'); eq(apr.collected, 500, 'half the tax when half is paid'); eq(apr.taxable, 5000);
        eq(R.salesTaxByAgency(b, { from: '2026-03-01', to: '2026-03-31' }).rows.find(function (r) { return r.agency === 'State'; }).collected, 1000, 'accrual unchanged');
        clean(b);
      });
  });

  /* ---------- Definition of done: sample company, and backup/restore of every new type and field ---------- */
  test('CPA done: sample company — integrity clean, balance sheet balances on both bases, aging = GL at 12 month-ends', function () {
    return newBook().then(function (s) {
      return OB.sample.populate(s, '2026-12-31').then(function () {
        clean(s);
        monthEnds(2026).forEach(function (d) {
          ok(R.balanceSheet(s, { asOf: d }).balanced, 'accrual BS balances ' + d); ok(R.balanceSheet(s, { asOf: d, basis: 'cash' }).balanced, 'cash BS balances ' + d);
        });
        tieOut(s, 'customer', monthEnds(2026)); tieOut(s, 'vendor', monthEnds(2026));
      });
    });
  });
  function everything() {
    var b, c, v, inv, cm, pay, bill, vc;
    return newBook().then(function (x) { b = x; return b.saveCompany({ allowNegativeInventory: true }); })
      .then(function () { return b.saveContact({ kind: 'customer', name: 'All Types Co', terms: 30, discountPct: 2, discountDays: 10, taxExempt: true }); })
      .then(function (x) { c = x; return b.saveContact({ kind: 'vendor', name: 'All Types Vendor', terms: 30, discountPct: 1, discountDays: 10 }); })
      .then(function (x) { v = x; var a = b.accById[acc(b, 'Loan Payable')]; return b.saveAccount(Object.assign({}, a, { cashFlow: 'financing' })); })
      .then(function () { return b.saveTransaction({ type: 'deposit', date: '2026-01-02', accountId: acc(b, 'Checking'), lines: [{ accountId: acc(b, 'Owner\'s Investment'), amount: '20000' }] }); })
      .then(function () { return b.saveTransaction({ type: 'invoice', date: '2026-02-01', contactId: c.id, terms: 30, discountPct: 2, discountDays: 10, lines: [{ accountId: acc(b, 'Services'), amount: '1000' }] }); })
      .then(function (t) { inv = t; return b.receiveWithDiscount({ type: 'payment', date: '2026-02-05', contactId: c.id, accountId: acc(b, 'Checking'), amount: '980', applications: [{ txnId: inv.id, amount: '980' }] }, [{ txnId: inv.id }]); })
      .then(function (r) { pay = r.payment; return b.saveTransaction({ type: 'creditMemo', date: '2026-02-10', contactId: c.id, lines: [{ accountId: acc(b, 'Services'), amount: '50' }] }); })
      .then(function (t) { cm = t; return b.saveTransaction({ type: 'invoice', date: '2026-02-12', contactId: c.id, lines: [{ accountId: acc(b, 'Services'), amount: '300' }] }); })
      .then(function (t) { return b.applyCredit(cm.id, t.id, 5000, '2026-02-15'); })
      .then(function () { return b.recordBouncedPayment(pay.id, { date: '2026-02-20', bankFee: '10', customerFee: '20' }); })
      .then(function () { return b.saveTransaction({ type: 'bill', date: '2026-03-01', contactId: v.id, number: 'B-1', lines: [{ accountId: acc(b, 'Rent & Lease'), amount: '400' }] }); })
      .then(function (t) { bill = t; return b.saveTransaction({ type: 'vendorCredit', date: '2026-03-02', contactId: v.id, lines: [{ accountId: acc(b, 'Rent & Lease'), amount: '60' }] }); })
      .then(function (t) { vc = t; return b.saveTransaction({ type: 'vendorRefund', date: '2026-03-03', contactId: v.id, accountId: acc(b, 'Checking'), amount: '60', applications: [{ txnId: vc.id, amount: '60' }] }); })
      .then(function () { return b.saveFixedAsset({ name: 'Van', inService: '2026-01-15', cost: '5000', method: 'SL', lifeMonths: 60, taxMethod: 'MACRS', taxClass: 5, accountId: acc(b, 'Vehicles'), accumAccountId: acc(b, 'Accumulated Depreciation'), expenseAccountId: acc(b, 'Depreciation') }); })
      .then(function (a) { return b.recordDepreciation('2026-05-31').then(function () { return b.disposeFixedAsset(a.id, { date: '2026-06-30', proceeds: '4000', depositAccountId: acc(b, 'Checking') }); }); })
      .then(function () { return b.saveTransaction({ type: 'journal', date: '2026-07-31', memo: 'Accrual', jlines: [{ accountId: acc(b, 'Utilities'), debit: '30' }, { accountId: acc(b, 'Loan Payable'), credit: '30' }] }); })
      .then(function (j) { return b.reverseJournal(j.id); })
      .then(function () { return b.saveTransaction({ type: 'invoice', date: '2026-08-05', contactId: c.id, lines: [{ accountId: acc(b, 'Services'), amount: '75' }] }); })
      .then(function (t) { return b.saveCompany({ closingDate: '2026-08-31' }).then(function () { return b.voidTransaction(t.id, 'duplicate', { asOf: '2026-09-02' }); }); })
      .then(function () { return b; });
  }
  test('CPA done: backup → restore round trip keeps every new type and field (plain and encrypted)', function () {
    var b, json, r;
    var pick = function (bk) { return JSON.stringify({ t: bk.transactions.map(function (t) { return [t.type, t.status, t.date, t.total, t.discountOf, t.bounceOf, t.voidOf, t.voidedBy, t.disposal, t.exempt, t.discountPct, (t.applications || []).map(function (a) { return a.date || ''; })]; }),
      fa: bk.company.fixedAssets, neg: bk.company.allowNegativeInventory, cf: bk.accounts.filter(function (a) { return a.cashFlow; }).map(function (a) { return a.cashFlow; }), disc: bk.contacts.map(function (x) { return [x.discountPct, x.discountDays]; }) }); };
    return everything().then(function (x) {
      b = x; clean(b);
      ['vendorRefund', 'creditMemo', 'vendorCredit', 'journal'].forEach(function (ty) { ok(b.transactions.some(function (t) { return t.type === ty; }), ty + ' present'); });
      ok(b.transactions.some(function (t) { return t.voidedBy; }) && b.transactions.some(function (t) { return t.disposal; }) && b.transactions.some(function (t) { return t.bounceOf; }) && b.transactions.some(function (t) { return t.discountOf; }), 'new links present');
      ok(R.balanceSheet(b, { asOf: '2026-12-31' }).balanced && R.balanceSheet(b, { asOf: '2026-12-31', basis: 'cash' }).balanced, 'BS balances on both bases');
      var v = OB.backup.validate(JSON.parse(JSON.stringify(OB.backup.create(b)))); ok(v.ok, v.errors.join('; '));
      var restored = OB.Book.fromData(new OB.MemoryAdapter(), OB.backup.prepareRestore(v.data, 'copy'));
      eq(pick(restored), pick(b), 'every new field survives a plain backup'); clean(restored);
      eq(restored.accountBalance(restored.sys('AR').id), b.accountBalance(b.sys('AR').id));
      return OB.sec.setup('Round-Trip-Pass-1');
    }).then(function (x) { r = x; b.dek = r.dek; b.security = r.security; return OB.backup.createEncrypted(b); })
      .then(function (enc) { json = JSON.stringify(enc); ok(json.indexOf('All Types Co') < 0, 'encrypted backup has no plaintext'); return OB.backup.decrypt(JSON.parse(json), 'Round-Trip-Pass-1'); })
      .then(function (d) {
        var v = OB.backup.validate(d.inner); ok(v.ok, v.errors.join('; '));
        var restored = OB.Book.fromData(new OB.MemoryAdapter(), OB.backup.prepareRestore(v.data, 'copy'));
        eq(pick(restored), pick(b), 'every new field survives an encrypted backup'); clean(restored);
      });
  });

})(typeof window !== 'undefined' ? window : globalThis);
