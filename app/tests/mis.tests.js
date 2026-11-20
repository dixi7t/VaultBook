/* VaultBook — Invoice Payment Days (MIS) report tests (1.29). Loaded after find.tests.js; shares OB.tests. */
(function (root) {
  'use strict';
  var OB = root.OB, T = OB.tests;
  function test(name, fn) { T.push({ name: name, fn: fn }); }
  function eq(a, b, msg) { if (a !== b) throw new Error((msg || 'Expected equal') + ': expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }
  function ok(v, msg) { if (!v) throw new Error(msg || 'Assertion failed'); }
  function acc(b, name) { var a = b.accounts.find(function (x) { return x.name === name; }); if (!a) throw new Error('No account ' + name); return a.id; }

  // Customer ACME: A paid on time in one payment, B paid in two (late), C open. Customer BETA: D paid by payment + credit memo.
  function fixture() {
    var b, c, d, ids = {};
    return OB.Book.create(new OB.MemoryAdapter(), { name: 'MIS Co' }).then(function (x) { b = x; return Promise.all([b.saveContact({ kind: 'customer', name: 'ACME' }), b.saveContact({ kind: 'customer', name: 'BETA' })]); })
      .then(function (cs) {
        c = cs[0]; d = cs[1]; var svc = acc(b, 'Services');
        return b.saveTransactions([
          { type: 'invoice', date: '2026-01-10', dueDate: '2026-01-25', number: 'A', contactId: c.id, lines: [{ accountId: svc, amount: '1000' }] },
          { type: 'invoice', date: '2026-01-10', dueDate: '2026-02-09', number: 'B', contactId: c.id, lines: [{ accountId: svc, amount: '2000' }] },
          { type: 'invoice', date: '2026-02-01', dueDate: '2026-03-03', number: 'C', contactId: c.id, lines: [{ accountId: svc, amount: '800' }] },
          { type: 'invoice', date: '2026-02-10', dueDate: '2026-03-12', number: 'D', contactId: d.id, lines: [{ accountId: svc, amount: '500' }] }]);
      })
      .then(function (ts) {
        ts.forEach(function (t) { ids[t.number] = t.id; });
        var ck = acc(b, 'Checking');
        return b.saveTransactions([
          { type: 'payment', date: '2026-01-25', number: '501', contactId: c.id, accountId: ck, amount: '1000', applications: [{ txnId: ids.A, amount: '1000' }] },
          { type: 'payment', date: '2026-02-01', contactId: c.id, accountId: ck, amount: '500', applications: [{ txnId: ids.B, amount: '500' }] },
          { type: 'payment', date: '2026-03-11', contactId: c.id, accountId: ck, amount: '1500', applications: [{ txnId: ids.B, amount: '1500' }] },
          { type: 'creditMemo', date: '2026-02-20', contactId: d.id, lines: [{ accountId: acc(b, 'Services'), amount: '100' }], applications: [{ txnId: ids.D, amount: '100' }] },
          { type: 'payment', date: '2026-03-02', contactId: d.id, accountId: ck, amount: '400', applications: [{ txnId: ids.D, amount: '400' }] }]);
      })
      .then(function () { return { b: b, c: c, d: d, ids: ids }; });
  }

  test('MIS-01 invoice view: payment dates, days to pay, days late, status and open balance per invoice', function () {
    return fixture().then(function (f) {
      var r = OB.payDays.report(f.b, { from: '2026-01-01', to: '2026-03-31', asOf: '2026-03-31' });
      var by = {}; r.invoices.forEach(function (x) { by[x.number] = x; });
      eq(r.invoices.length, 4);
      var A = by.A; eq(A.status, 'Paid'); eq(A.paidDate, '2026-01-25'); eq(A.daysToPay, 15); eq(A.daysLate, 0); eq(A.onTime, true); eq(A.received, 100000); eq(A.payCount, 1); eq(A.apps[0].number, '501'); ok(/#501 \$1,000\.00/.test(A.payments), A.payments);
      var B = by.B; eq(B.status, 'Paid'); eq(B.firstPayDate, '2026-02-01'); eq(B.daysToFirst, 22); eq(B.paidDate, '2026-03-11'); eq(B.daysToPay, 60); eq(B.daysLate, 30); eq(B.onTime, false); eq(B.payCount, 2);
      eq(B.weightedDays, 50.5, 'amount-weighted: (500×22 + 1500×60) / 2000');
      var C = by.C; eq(C.status, 'Open'); eq(C.open, 80000); eq(C.daysOpen, 58); eq(C.daysPastDue, 28); eq(C.daysToPay, null);
      var D = by.D; eq(D.status, 'Paid'); eq(D.received, 40000); eq(D.credits, 10000); eq(D.paidDate, '2026-03-02'); eq(D.daysToPay, 20);
    });
  });

  test('MIS-02 summary by customer: averages, weighted average, on-time %, open count and oldest open; totals', function () {
    return fixture().then(function (f) {
      var r = OB.payDays.report(f.b, { from: '2026-01-01', to: '2026-03-31', asOf: '2026-03-31' });
      var acme = r.customers.find(function (x) { return x.name === 'ACME'; });
      eq(acme.invoices, 3); eq(acme.invoiced, 380000); eq(acme.received, 300000); eq(acme.open, 80000);
      eq(acme.paidCount, 2); eq(acme.avgDays, 37.5); eq(acme.weightedDays, 38.7, '(1000×15 + 500×22 + 1500×60) / 3000');
      eq(acme.avgLate, 15); eq(acme.onTimePct, 50); eq(acme.fastest, 15); eq(acme.slowest, 60); eq(acme.openCount, 1); eq(acme.oldestOpen, 58);
      eq(r.total.invoices, 4); eq(r.total.invoiced, 430000); eq(r.total.paidCount, 3); eq(r.total.avgDays, 31.7, '(15 + 60 + 20) / 3');
      eq(r.total.onTimePct, 66.7);
    });
  });

  test('MIS-03 payment-line view, filters (customer, status, payments received in period) and payments after the status date', function () {
    return fixture().then(function (f) {
      var P = OB.payDays;
      var lines = P.report(f.b, { from: '2026-01-01', to: '2026-03-31', asOf: '2026-03-31' }).lines;
      eq(lines.length, 5, 'one row per payment or credit applied');
      var l = lines.find(function (x) { return x.invoice === 'B' && x.date === '2026-03-11'; }); eq(l.days, 60); eq(l.daysLate, 30); eq(l.amount, 150000); eq(l.kind, 'Payment'); eq(l.depositTo, 'Checking');
      eq(lines.find(function (x) { return x.invoice === 'D' && x.kind === 'Credit memo'; }).amount, 10000);
      eq(P.report(f.b, { from: '2026-01-01', to: '2026-03-31', asOf: '2026-03-31', contactId: f.d.id }).invoices.length, 1, 'customer filter');
      eq(P.report(f.b, { from: '2026-01-01', to: '2026-03-31', asOf: '2026-03-31', status: 'open' }).invoices.map(function (x) { return x.number; }).join(), 'C');
      eq(P.report(f.b, { from: '2026-01-01', to: '2026-03-31', asOf: '2026-03-31', status: 'paid' }).invoices.length, 3);
      var mar = P.report(f.b, { from: '2026-03-01', to: '2026-03-31', asOf: '2026-03-31', by: 'payment' });
      eq(mar.invoices.map(function (x) { return x.number; }).sort().join(), 'B,D', 'paid in March');
      eq(mar.lines.map(function (x) { return x.invoice + x.date; }).sort().join(), 'B2026-03-11,D2026-03-02', 'only March receipts');
      var feb = P.report(f.b, { from: '2026-01-01', to: '2026-03-31', asOf: '2026-02-28' });
      var B = feb.invoices.find(function (x) { return x.number === 'B'; });
      eq(B.status, 'Partly paid'); eq(B.open, 150000); eq(B.paidDate, ''); eq(B.daysOpen, 49);
    });
  });

  test('MIS-04 fields: every view has a field list with defaults; the matrix follows the chosen fields and order', function () {
    return fixture().then(function (f) {
      var P = OB.payDays;
      ['invoice', 'summary', 'payment'].forEach(function (v) { ok(P.FIELDS[v].length >= 8, v); ok(P.DEFAULTS[v].every(function (k) { return P.FIELDS[v].some(function (x) { return x.key === k; }); }), v + ' defaults are fields'); });
      var r = P.report(f.b, { from: '2026-01-01', to: '2026-03-31', asOf: '2026-03-31' });
      var m = P.matrix(r, 'invoice', ['number', 'customer', 'daysToPay']);
      eq(m[0].join('|'), 'Invoice no.|Customer|Days to pay');
      var row = m.find(function (x) { return x[0] === 'B'; }); eq(row[2], 60);
      var s = P.matrix(r, 'summary', ['customer', 'avgDays']); eq(s[s.length - 1][0], 'Total'); eq(s[s.length - 1][1], 31.7);
    });
  });

  test('MIS-05 drill-down: one level, customer → its invoices, each invoice row carrying its payment details; totals', function () {
    return fixture().then(function (f) {
      var P = OB.payDays, r = P.report(f.b, { from: '2026-01-01', to: '2026-03-31', asOf: '2026-03-31' }), rows = P.drill(r);
      eq(rows.filter(function (x) { return x.level === 0; }).map(function (x) { return x.label; }).join(), 'ACME,BETA');
      ok(rows.every(function (x) { return x.level <= 1; }), 'no payment level');
      eq(rows.length, 6, '2 customers + 4 invoices');
      var acme = rows[0]; eq(acme.days, 37.5); eq(acme.amount, 380000); eq(acme.onTime, 50); eq(acme.invoices, 3);
      var b = rows.find(function (x) { return x.label === 'Invoice B'; }); eq(b.level, 1); eq(b.path, acme.path + '/' + b.id);
      eq(b.days, 60); eq(b.late, 30); eq(b.status, 'Paid'); eq(b.date, '2026-01-10'); eq(b.firstPayDate, '2026-02-01'); eq(b.lastPayDate, '2026-03-11'); eq(b.paidDate, '2026-03-11'); eq(b.payCount, 2); eq(b.received, 200000); eq(b.depositTo, 'Checking');
      ok(/02\/01\/2026 \$500\.00; 03\/11\/2026 \$1,500\.00/.test(b.payments), b.payments);
      eq(rows.find(function (x) { return x.label === 'Invoice A'; }).payNos, '501');
      var m = P.matrix(r, 'drill', ['date', 'amount', 'days']);
      eq(m[0].join('|'), 'Customer / invoice|Invoice date|Invoice amount|Days to pay');
      var mb = m.find(function (x) { return x[0] && x[0].v === 'Invoice B'; }); eq(mb[0].depth, 1); eq(mb[3], 60);
      eq(m[m.length - 1][0], 'Total'); eq(m[m.length - 1][3], 31.7);
    });
  });

  test('MIS-06 Excel: a drill-down matrix exports as grouped rows (outline levels, summary row above)', function () {
    return fixture().then(function (f) {
      var P = OB.payDays, M = OB.reportModel, r = P.report(f.b, { from: '2026-01-01', to: '2026-03-31', asOf: '2026-03-31' });
      var model = M.fromMatrix([['MIS Co'], ['Invoice Payment Days'], []].concat(P.matrix(r, 'drill')));
      ok(model.outline, 'model knows it has levels'); eq(model.rows[1].depth, 1);
      var sh = M.toSheet(model, {}); ok(sh.summaryAbove, 'summary above');
      var lv = Object.keys(sh.rowMeta).map(function (k) { return sh.rowMeta[k].level; });
      ok(lv.length === 4 && lv.every(function (x) { return x === 1; }), 'invoices grouped under their customer: ' + lv.join());
      var xml = OB.xlsx.build([sh]); ok(xml && xml.length > 100, 'xlsx built');
    });
  });

  test('MIS-07 income accounts used on each invoice: list, count, and one field per account summed by customer and in total', function () {
    var f, inc2;
    return fixture().then(function (x) {
      f = x; var b = f.b;
      inc2 = b.accounts.find(function (a) { return (a.type === 'income' || a.type === 'oi') && a.name !== 'Services'; });
      return b.saveTransaction({ type: 'invoice', date: '2026-03-01', number: 'E', contactId: f.d.id, lines: [{ accountId: acc(b, 'Services'), amount: '300' }, { accountId: inc2.id, amount: '200' }, { accountId: acc(b, 'Services'), amount: '50' }] });
    }).then(function () {
      var P = OB.payDays, b = f.b, r = P.report(b, { from: '2026-01-01', to: '2026-03-31', asOf: '2026-03-31' });
      var svc = acc(b, 'Services'), E = r.invoices.find(function (x) { return x.number === 'E'; });
      eq(E.incomeCount, 2, 'two income accounts'); eq(E['inc:' + svc], 35000); eq(E['inc:' + inc2.id], 20000);
      ok(E.incomeText.indexOf(b.accountLabel(svc) + ' $350.00') >= 0 && E.incomeText.indexOf(b.accountLabel(inc2.id) + ' $200.00') >= 0, E.incomeText);
      var inf = P.incomeFields(r); eq(inf.length, 2); ok(inf.some(function (x) { return x.key === 'inc:' + inc2.id && x.label === b.accountLabel(inc2.id) && x.type === 'money'; }));
      ok(P.allFields('invoice', r).some(function (x) { return x.key === 'incomeText'; }), 'list field');
      var beta = r.customers.find(function (x) { return x.name === 'BETA'; }); eq(beta['inc:' + svc], 85000, 'D 500 + E 350'); eq(beta['inc:' + inc2.id], 20000);
      eq(r.total['inc:' + svc], 465000);
      var m = P.matrix(r, 'drill', ['amount', 'inc:' + svc, 'inc:' + inc2.id], r);
      eq(m[0][2], b.accountLabel(svc)); var last = m[m.length - 1]; eq(last[3].v, 200);
      var me = m.find(function (x) { return x[0] && x[0].v === 'Invoice E'; }); eq(me[2].v, 350); eq(me[3].v, 200);
      eq(P.matrix(r, 'summary', ['customer', 'inc:' + inc2.id]).slice(-1)[0][1].v, 200, 'summary total');
    });
  });
})(typeof window !== 'undefined' ? window : globalThis);
