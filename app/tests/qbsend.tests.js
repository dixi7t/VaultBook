/* VaultBook — Send to QuickBooks Desktop (1.30) engine tests. Loaded after mis.tests.js; shares OB.tests. */
(function (root) {
  'use strict';
  var OB = root.OB, U = OB.util, T = OB.tests;
  function test(name, fn) { T.push({ name: name, fn: fn }); }
  function eq(a, b, msg) { if (a !== b) throw new Error((msg || 'Expected equal') + ': expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }
  function ok(v, msg) { if (!v) throw new Error(msg || 'Assertion failed'); }
  function acc(b, name) { var a = b.accounts.find(function (x) { return x.name === name; }); if (!a) throw new Error('No account ' + name); return a.id; }

  // ACME: invoice A (item line + plain line), paid by payment P1; invoice B open. BETA: invoice C paid by credit memo + payment.
  function fixture() {
    var b, c, d, item, ids = {};
    return OB.Book.create(new OB.MemoryAdapter(), { name: 'Send Co' }).then(function (x) { b = x; return Promise.all([b.saveContact({ kind: 'customer', name: 'ACME Imaging', address: '1 Main St\nMesa, AZ 85201' }), b.saveContact({ kind: 'customer', name: 'BETA: Clinic' })]); })
      .then(function (cs) { c = cs[0]; d = cs[1]; return b.saveItem({ name: 'Radiology Services', type: 'service', incomeAccountId: acc(b, 'Services'), price: '100' }); })
      .then(function (it) {
        item = it; var svc = acc(b, 'Services');
        return b.saveTransactions([
          { type: 'invoice', date: '2026-08-05', dueDate: '2026-08-20', number: '1243', contactId: c.id, memo: 'July reads', lines: [{ itemId: item.id, accountId: svc, description: 'Radiology Services - For Holiday', qty: '2', rate: '100', amount: '200' }, { accountId: svc, description: 'Courier', amount: '30.27' }] },
          { type: 'invoice', date: '2026-09-04', number: '1261', contactId: c.id, lines: [{ accountId: svc, amount: '500' }] },
          { type: 'invoice', date: '2026-08-10', number: '1250', contactId: d.id, lines: [{ accountId: svc, amount: '400' }] }]);
      })
      .then(function (ts) {
        ts.forEach(function (t) { ids[t.number] = t.id; });
        var ck = acc(b, 'Checking');
        return b.saveTransactions([
          { type: 'payment', date: '2026-08-11', number: 'ACH', contactId: c.id, accountId: ck, amount: '230.27', applications: [{ txnId: ids['1243'], amount: '230.27' }] },
          { type: 'creditMemo', date: '2026-08-12', contactId: d.id, lines: [{ accountId: acc(b, 'Services'), amount: '100' }], applications: [{ txnId: ids['1250'], amount: '100' }] },
          { type: 'payment', date: '2026-08-20', contactId: d.id, accountId: ck, amount: '300', applications: [{ txnId: ids['1250'], amount: '300' }] }]);
      })
      .then(function (ps) { ps.forEach(function (t, i) { ids['p' + i] = t.id; }); return { b: b, c: c, d: d, item: item, ids: ids }; });
  }

  test('QS-01 sendList: invoices and customer payments, filters (type, period, customer, status, amount), not sent by default', function () {
    return fixture().then(function (f) {
      var Q = OB.qbsend, b = f.b;
      var all = Q.sendList(b, {});
      eq(all.filter(function (x) { return x.kind === 'invoice'; }).length, 3); eq(all.filter(function (x) { return x.kind === 'payment'; }).length, 2, 'credit memos are not sent');
      var inv = all.find(function (x) { return x.number === '1243'; });
      eq(inv.customer, 'ACME Imaging'); eq(inv.amount, 23027); eq(inv.date, '2026-08-05'); eq(inv.status, 'Not sent'); eq(inv.sent, false);
      var p = all.find(function (x) { return x.kind === 'payment' && x.amount === 23027; }); eq(p.applied, 'Invoice 1243'); eq(p.customer, 'ACME Imaging');
      eq(Q.sendList(b, { kinds: ['payment'] }).length, 2);
      eq(Q.sendList(b, { from: '2026-09-01', to: '2026-09-30' }).length, 1, 'period');
      eq(Q.sendList(b, { contactId: f.d.id }).length, 2, 'customer');
      eq(Q.sendList(b, { min: 45000 }).map(function (x) { return x.number; }).join(), '1261', 'amount from');
      eq(Q.sendList(b, { max: 30000 }).length, 3, 'amount to');
      ok(all.every(function (x) { return x.id && x.key; }), 'ids and keys');
    });
  });

  test('QS-02 batch v2: invoices with items (line description as typed), addresses, terms; payments naming invoices; invoices first', function () {
    return fixture().then(function (f) {
      var Q = OB.qbsend, b = f.b, list = Q.sendList(b, {});
      var batch = Q.batch(b, list.map(function (x) { return x.key; }), { now: '2026-11-12T20:00:00.000Z' });
      eq(batch.format, 'vaultbook-qb-batch'); eq(batch.version, 2); eq(batch.company, 'Send Co'); eq(batch.createdAt, '2026-11-12T20:00:00.000Z');
      eq(batch.invoices.length, 3); eq(batch.payments.length, 2);
      var i = batch.invoices.find(function (x) { return x.number === '1243'; });
      eq(i.customer, 'ACME Imaging'); eq(i.date, '2026-08-05'); eq(i.dueDate, '2026-08-20'); eq(i.terms, 'Net 15'); eq(i.memo, 'July reads'); eq(i.total, '230.27');
      eq(JSON.stringify(i.billTo), JSON.stringify(['ACME Imaging', '1 Main St', 'Mesa, AZ 85201']));
      eq(i.lines.length, 2);
      eq(i.lines[0].item, 'Radiology Services'); eq(i.lines[0].description, 'Radiology Services - For Holiday'); eq(i.lines[0].qty, '2'); eq(i.lines[0].rate, '100.00'); eq(i.lines[0].amount, '200.00'); eq(i.lines[0].incomeAccount, 'Services');
      eq(i.lines[1].item, '', 'no item: the script matches by description or asks'); eq(i.lines[1].description, 'Courier'); eq(i.lines[1].amount, '30.27'); eq(i.lines[1].qty, ''); eq(i.lines[1].incomeAccount, 'Services');
      eq(batch.invoices.find(function (x) { return x.number === '1250'; }).customer, 'BETA- Clinic', 'QuickBooks name rules: no colon');
      var p = batch.payments.find(function (x) { return x.amount === '230.27'; });
      eq(p.customer, 'ACME Imaging'); eq(p.ref, 'ACH'); eq(p.depositTo, 'Checking'); eq(JSON.stringify(p.apply), JSON.stringify([{ invoice: '1243', invoiceDate: '2026-08-05', amount: '230.27' }]));
      eq(batch.payments.find(function (x) { return x.amount === '300.00'; }).apply[0].amount, '300.00', 'the credit memo part is not a payment');
      eq(Q.batch(b, [list.find(function (x) { return x.kind === 'payment'; }).key]).invoices.length, 0, 'only chosen keys');
    });
  });

  test('QS-03 result file: items marked sent with the QuickBooks id and date, problems kept; sent status in sendList; resend allowed', function () {
    return fixture().then(function (f) {
      var Q = OB.qbsend, b = f.b, list = Q.sendList(b, {}), inv = list.find(function (x) { return x.number === '1243'; }), pay = list.find(function (x) { return x.kind === 'payment' && x.amount === 23027; }), open = list.find(function (x) { return x.number === '1261'; });
      var result = { format: 'vaultbook-qb-result', version: 2, company: 'Send Co', at: '2026-11-12T21:00:00.000Z', items: [
        { key: inv.key, status: 'Recorded', txnId: 'A1-23' }, { key: pay.key, status: 'Already in QuickBooks', txnId: 'B2-99' }, { key: open.key, status: 'Problem', details: 'customer not found' }] };
      return Q.applyResult(b, result).then(function (r) {
        eq(r.sent, 2); eq(r.problems, 1);
        var now = Q.sendList(b, {});
        var i2 = now.find(function (x) { return x.key === inv.key; }); eq(i2.sent, true); eq(i2.status, 'Sent'); eq(i2.qbTxnId, 'A1-23'); eq(i2.sentAt, '2026-11-12T21:00:00.000Z');
        eq(now.find(function (x) { return x.key === pay.key; }).status, 'Sent');
        var o2 = now.find(function (x) { return x.key === open.key; }); eq(o2.status, 'Problem'); eq(o2.problem, 'customer not found'); eq(o2.sent, false);
        eq(Q.sendList(b, { status: 'new' }).length, 3, 'not sent: 2 unsent + the problem one');
        eq(Q.sendList(b, { status: 'sent' }).length, 2);
        eq(Q.sendList(b, { status: 'problem' }).length, 1);
        ok(b.company.qbSent && b.company.qbSent[inv.id], 'kept on the company');
        return Q.applyResult(b, { format: 'vaultbook-qb-result', version: 2, items: [{ key: open.key, status: 'Recorded', txnId: 'C3' }] });
      }).then(function () {
        eq(Q.sendList(b, { status: 'problem' }).length, 0, 'problem cleared after a good run');
        return Q.applyResult(b, { format: 'nope' }).then(function () { throw new Error('should reject'); }, function (e) { ok(/result file/i.test(e.message), e.message); });
      });
    });
  });
  test('QS-04 bank transactions go in the batch by shape: check, deposit, card charge, transfer, journal; accounts and names listed; bills left out', function () {
    var b, ids = {};
    var acc = function (n) { var a = b.accounts.find(function (x) { return x.name === n; }); if (!a) throw new Error('No account ' + n); return a.id; };
    return OB.Book.create(new OB.MemoryAdapter(), { name: 'Bank Co' }).then(function (x) { b = x; return Promise.all([b.saveContact({ kind: 'vendor', name: 'Paper Co' }), b.saveContact({ kind: 'customer', name: 'ACME' })]); })
      .then(function (cs) {
        var ck = acc('Checking'), sv = acc('Savings'), card = acc('Business Credit Card');
        return b.saveTransactions([
          { type: 'check', date: '2026-05-08', number: '501', contactId: cs[0].id, accountId: ck, memo: 'paper', lines: [{ accountId: acc('Office Supplies & Software'), amount: '250' }, { accountId: acc('Meals'), amount: '50' }] },
          { type: 'expense', date: '2026-05-09', contactId: cs[0].id, accountId: card, lines: [{ accountId: acc('Meals'), amount: '40' }] },
          { type: 'deposit', date: '2026-05-10', contactId: cs[1].id, accountId: ck, lines: [{ accountId: acc('Services'), amount: '700' }] },
          { type: 'transfer', date: '2026-05-11', accountId: ck, toAccountId: sv, amount: '1000' },
          { type: 'journal', date: '2026-05-12', number: 'J1', jlines: [{ accountId: acc('Meals'), debit: '30', credit: 0 }, { accountId: acc('Office Supplies & Software'), debit: 0, credit: '30' }] },
          { type: 'bill', date: '2026-05-13', number: 'B9', contactId: cs[0].id, lines: [{ accountId: acc('Meals'), amount: '99' }] }]);
      }).then(function (ts) {
        var list = OB.qbsend.sendList(b, { kinds: ['bank'] });
        eq(list.map(function (r) { return r.label; }).join(), 'Check,Card charge,Deposit,Transfer,Journal entry'); eq(list[0].amount, 30000); eq(list[3].amount, 100000);
        eq(OB.qbsend.sendList(b, { kinds: ['bank'], accountId: acc('Savings') }).length, 1, 'account filter');
        var bt = OB.qbsend.batch(b, ts.map(function (t) { return t.id; }), { now: 'N' }), by = {}; bt.bank.forEach(function (x) { by[x.kind] = x; });
        eq(bt.version, 3); eq(bt.bank.length, 5); eq(bt.skipped.length, 1); eq(bt.skipped[0].type, 'bill'); ok(JSON.stringify(bt).indexOf('skipped') < 0, 'skipped is not written to the file');
        eq(by.check.account, 'Checking'); eq(by.check.payee, 'Paper Co'); eq(by.check.ref, '501'); eq(by.check.amount, '300.00'); eq(by.check.lines.map(function (l) { return l.amount; }).join(), '250.00,50.00');
        eq(by.cardCharge.account, 'Business Credit Card'); eq(by.cardCharge.lines[0].amount, '40.00');
        eq(by.deposit.account, 'Checking'); eq(by.deposit.lines[0].amount, '700.00'); eq(by.deposit.lines[0].name, 'ACME');
        eq(by.transfer.from, 'Checking'); eq(by.transfer.to, 'Savings'); eq(by.transfer.amount, '1000.00');
        eq(by.journal.lines.length, 2); eq(by.journal.lines[0].debit, '30.00'); eq(by.journal.lines[1].credit, '30.00'); eq(by.journal.ref, 'J1');
        eq(bt.accounts['Checking'], 'Bank'); eq(bt.accounts['Business Credit Card'], 'CreditCard'); eq(bt.accounts['Meals'], 'Expense'); eq(bt.names['Paper Co'], 'vendor'); eq(bt.names['ACME'], 'customer');
        eq(OB.qbsend.batch(b, [], {}).version, 2, 'no bank items: the old file version');
      });
  });
})(typeof window !== 'undefined' ? window : globalThis);
