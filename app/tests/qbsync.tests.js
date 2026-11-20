/* VaultBook — QuickBooks snapshot matching (1.31) tests. Loaded after qbsend.tests.js; shares OB.tests. */
(function (root) {
  'use strict';
  var OB = root.OB, U = OB.util, T = OB.tests;
  function test(name, fn) { T.push({ name: name, fn: fn }); }
  function eq(a, b, msg) { if (a !== b) throw new Error((msg || 'Expected equal') + ': expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }
  function ok(v, msg) { if (!v) throw new Error(msg || 'Assertion failed'); }
  function acc(b, name) { var a = b.accounts.find(function (x) { return x.name === name; }); if (!a) throw new Error('No account ' + name); return a.id; }

  // Jan: invoice 1001 + payment (both in QuickBooks). Feb: invoice 1002 (not in QB), check 501 (in QB, hand-typed). Mar: nothing in VaultBook, QB has a deposit.
  function fixture() {
    var b, c, v, ids = {};
    return OB.Book.create(new OB.MemoryAdapter(), { name: 'Sync Co' }).then(function (x) { b = x; return Promise.all([b.saveContact({ kind: 'customer', name: 'ACME' }), b.saveContact({ kind: 'vendor', name: 'Paper Co' })]); })
      .then(function (cs) {
        c = cs[0]; v = cs[1]; var svc = acc(b, 'Services'), ck = acc(b, 'Checking');
        return b.saveTransactions([
          { type: 'invoice', date: '2026-01-10', number: '1001', contactId: c.id, lines: [{ accountId: svc, amount: '1000' }] },
          { type: 'invoice', date: '2026-02-10', number: '1002', contactId: c.id, lines: [{ accountId: svc, amount: '2000' }] },
          { type: 'check', date: '2026-02-15', number: '501', contactId: v.id, accountId: ck, lines: [{ accountId: acc(b, 'Office Supplies & Software'), amount: '250' }] }]);
      })
      .then(function (ts) {
        ts.forEach(function (t) { ids[t.number] = t.id; });
        return b.saveTransaction({ type: 'payment', date: '2026-01-25', number: 'ACH1', contactId: c.id, accountId: acc(b, 'Checking'), amount: '1000', applications: [{ txnId: ids['1001'], amount: '1000' }] });
      })
      .then(function (p) { ids.pay = p.id; return { b: b, c: c, v: v, ids: ids }; });
  }
  function snapshot(f) {
    return { format: 'vaultbook-qb-snapshot', version: 1, company: 'Sync Co', at: '2026-11-12T23:00:00.000Z', from: '2026-01-01', to: '2026-03-31',
      txns: [
        { txnId: 'Q-1', type: 'Invoice', date: '2026-01-10', num: '1001', name: 'ACME', amount: '1000.00', key: '' },
        { txnId: 'Q-2', type: 'ReceivePayment', date: '2026-01-25', num: 'ACH1', name: 'ACME', amount: '1000.00', key: f.ids.pay },
        { txnId: 'Q-3', type: 'Check', date: '2026-02-15', num: '501', name: 'Paper Co', amount: '250.00', key: '' },
        { txnId: 'Q-4', type: 'Deposit', date: '2026-03-03', num: '', name: '', amount: '75.00', key: '' }],
      months: [{ month: '2026-01', count: 2 }, { month: '2026-02', count: 1 }, { month: '2026-03', count: 1 }] };
  }

  test('SY-01 match: by VaultBook key, by type+date+number+amount; unmatched on each side; QuickBooks-only items listed', function () {
    return fixture().then(function (f) {
      var S = OB.qbsync, r = S.compare(f.b, snapshot(f));
      eq(r.matched.length, 3, 'invoice 1001 (fields), payment (key), check 501 (fields)');
      var inv = r.matched.find(function (m) { return m.t.number === '1001'; }); eq(inv.qb.txnId, 'Q-1'); eq(inv.how, 'fields');
      eq(r.matched.find(function (m) { return m.t.id === f.ids.pay; }).how, 'key');
      eq(r.missing.length, 1); eq(r.missing[0].number, '1002', 'invoice 1002 is not in QuickBooks');
      eq(r.qbOnly.length, 1); eq(r.qbOnly[0].txnId, 'Q-4', 'the March deposit exists only in QuickBooks');
    });
  });

  test('SY-02 months: state per month (Done, Not in QuickBooks, Partly, QuickBooks only), counts both sides, period from the snapshot', function () {
    return fixture().then(function (f) {
      var S = OB.qbsync, r = S.compare(f.b, snapshot(f));
      var m = {}; r.months.forEach(function (x) { m[x.month] = x; });
      eq(r.months.map(function (x) { return x.month; }).join(), '2026-01,2026-02,2026-03');
      eq(m['2026-01'].state, 'Done'); eq(m['2026-01'].qb, 2); eq(m['2026-01'].vb, 2); eq(m['2026-01'].missing, 0);
      eq(m['2026-02'].state, 'Partly'); eq(m['2026-02'].qb, 1); eq(m['2026-02'].vb, 2); eq(m['2026-02'].missing, 1);
      eq(m['2026-03'].state, 'QuickBooks only'); eq(m['2026-03'].vb, 0); eq(m['2026-03'].qbOnly, 1);
      var empty = S.compare(f.b, Object.assign(snapshot(f), { txns: [], months: [] }));
      eq(empty.months.find(function (x) { return x.month === '2026-02'; }).state, 'Not in QuickBooks');
    });
  });

  test('SY-03 gap for chosen months: missing items of those months plus invoices from other months that a chosen payment pays; remember matches', function () {
    var f;
    return fixture().then(function (x) {
      f = x; var b = f.b;
      // a March payment paying the February invoice 1002 (which is not in QuickBooks)
      return b.saveTransaction({ type: 'payment', date: '2026-03-20', contactId: f.c.id, accountId: acc(b, 'Checking'), amount: '2000', applications: [{ txnId: f.ids['1002'], amount: '2000' }] });
    }).then(function () {
      var S = OB.qbsync, b = f.b, r = S.compare(b, snapshot(f));
      var g = S.gap(b, r, ['2026-03']);
      eq(g.keys.length, 2, 'the March payment and the February invoice it pays');
      eq(g.extra.length, 1); eq(g.extra[0].number, '1002'); eq(g.extra[0].month, '2026-02');
      eq(S.gap(b, r, ['2026-02']).keys.length, 1, 'February alone: just invoice 1002');
      eq(S.gap(b, r, ['2026-01']).keys.length, 0, 'January is done');
      return S.remember(b, r).then(function (n) {
        eq(n, 3, 'three matched transactions remembered as in QuickBooks');
        eq(b.company.qbSent[f.ids['1001']].qbTxnId, 'Q-1');
        var again = S.compare(b, Object.assign(snapshot(f), { txns: snapshot(f).txns.map(function (t) { return Object.assign({}, t, { key: t.txnId === 'Q-1' ? f.ids['1001'] : t.key }); }) }));
        eq(again.matched.find(function (m) { return m.t.number === '1001'; }).how, 'key');
        eq(OB.qbsend.sendList(b, {}).find(function (x) { return x.number === '1001'; }).status, 'Sent', 'the send list shows it as in QuickBooks');
      });
    });
  });

  test('SY-04 a snapshot of another company or a wrong file is refused; types map both ways', function () {
    return fixture().then(function (f) {
      var S = OB.qbsync;
      var bad = null; try { S.compare(f.b, { format: 'x' }); } catch (e) { bad = e; } ok(bad && /snapshot/i.test(bad.message), 'wrong file');
      eq(S.TYPES.Invoice, 'invoice'); eq(S.TYPES.ReceivePayment, 'payment'); eq(S.TYPES.BillPaymentCheck, 'billPayment'); eq(S.TYPES.JournalEntry, 'journal'); eq(S.TYPES.CreditCardCharge, 'expense');
      var r = S.compare(f.b, Object.assign(snapshot(f), { company: 'Other Co' }));
      ok(r.warning && /Other Co/.test(r.warning), 'company name mismatch is a warning, not a stop');
    });
  });
  test('SY-05 a payment that QuickBooks holds as a Deposit (same date and amount) counts as already there, once', function () {
    return fixture().then(function (f) {
      var snap = snapshot(f);
      snap.txns = snap.txns.filter(function (q) { return q.type !== 'ReceivePayment'; });           // QuickBooks has no Receive Payment for it…
      snap.txns.push({ txnId: 'Q-DEP', type: 'Deposit', date: '2026-01-25', num: '', name: '', amount: '1000.00', key: '' });   // …but a deposit of the same day and amount
      var r = OB.qbsync.compare(f.b, snap), m = r.matched.find(function (x) { return x.t.id === f.ids.pay; });
      ok(m && m.how === 'deposit' && m.qb.txnId === 'Q-DEP', 'payment matched to the deposit');
      ok(!r.missing.some(function (t) { return t.id === f.ids.pay; }), 'not offered for sending');
      return f.b.saveTransaction({ type: 'payment', date: '2026-01-25', number: 'ACH2', contactId: f.c.id, accountId: acc(f.b, 'Checking'), amount: '1000' }).then(function (p2) {
        var r2 = OB.qbsync.compare(f.b, snap);
        eq(r2.matched.filter(function (x) { return x.how === 'deposit'; }).length, 1, 'one deposit covers one payment');
        eq(r2.missing.filter(function (t) { return t.type === 'payment'; }).length, 1, 'the second payment of the same amount is still missing');
      });
    });
  });
  test('SY-06 an expense here that is a Check there (same date and amount, number only on one side) is the same entry', function () {
    return fixture().then(function (f) {
      return f.b.saveTransaction({ type: 'expense', date: '2026-02-20', contactId: f.v.id, accountId: acc(f.b, 'Checking'), lines: [{ accountId: acc(f.b, 'Meals'), amount: '75' }] }).then(function (e) {
        var snap = snapshot(f); snap.txns.push({ txnId: 'Q-CK9', type: 'Check', date: '2026-02-20', num: '777', name: 'Paper Co', amount: '75.00', key: '' });
        var r = OB.qbsync.compare(f.b, snap);
        ok(r.matched.some(function (x) { return x.t.id === e.id && x.qb.txnId === 'Q-CK9'; }), 'matched across types'); ok(!r.missing.some(function (t) { return t.id === e.id; }));
      });
    });
  });
})(typeof window !== 'undefined' ? window : globalThis);
