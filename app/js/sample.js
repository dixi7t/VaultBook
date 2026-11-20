/* OfflineBooks US — optional sample data. Everything is posted through the normal engine and validation. */
(function (root) {
  'use strict';
  var OB = root.OB = root.OB || {};
  var U = OB.util;
  OB.sample = {
    populate: function (book, today) {
      today = today || U.today();
      var acc = function (n) { return book.accounts.find(function (a) { return a.name === n; }).id; };
      var start = U.monthStart(U.addMonths(today, -5));
      var d = function (monthOffset, day) { var s = U.addMonths(start, monthOffset); var x = U.ymd(+s.slice(0, 4), +s.slice(5, 7), day); return x > today ? today : x; };
      var C = {}, V = {};
      var seq = Promise.resolve();
      var step = function (fn) { seq = seq.then(fn); };
      [['Harbor Dental Group', 30, 'office@harbordental.example'], ['Maple Street Bakery', 15, 'orders@maplebakery.example'], ['Pinecrest HOA', 30, 'board@pinecresthoa.example']].forEach(function (c) {
        step(function () { return book.saveContact({ kind: 'customer', name: c[0], terms: c[1], email: c[2] }).then(function (x) { C[c[0]] = x.id; }); });
      });
      [['Northside Office Supply', 30], ['City Power & Light', 15], ['Granite Property Mgmt', 0], ['Ace Subcontracting', 30]].forEach(function (v) {
        step(function () { return book.saveContact({ kind: 'vendor', name: v[0], terms: v[1] }).then(function (x) { V[v[0]] = x.id; }); });
      });
      step(function () { return book.setOpeningBalance(acc('Checking'), U.addDays(start, -1), 1250000); });
      step(function () { return book.setOpeningBalance(acc('Savings'), U.addDays(start, -1), 2000000); });
      step(function () { return book.setOpeningBalance(acc('Furniture and Equipment'), U.addDays(start, -1), 860000); });
      step(function () { return book.saveRule({ contains: 'POWER', direction: 'out', accountId: acc('Utilities') }); });
      step(function () { return book.saveRule({ contains: 'COFFEE', direction: 'out', accountId: acc('Meals') }); });
      for (var m = 0; m < 6; m++) (function (m) {
        var invId, billId;
        step(function () {
          return book.saveTransaction({ type: 'invoice', date: d(m, 3), dueDate: U.addDays(d(m, 3), 30), terms: 30, contactId: C['Harbor Dental Group'], memo: 'Monthly IT support',
            lines: [{ accountId: acc('Services'), description: 'Managed IT support', qty: 1, rate: '2400' }, { accountId: acc('Services'), description: 'On-site hours', qty: 6 + m, rate: '95' }] }).then(function (t) { invId = t.id; });
        });
        if (m < 5) step(function () { var t = book.txById[invId]; return book.saveTransaction({ type: 'payment', date: d(m, 25), contactId: t.contactId, accountId: acc('Checking'), amount: t.total, applications: [{ txnId: invId, amount: t.total }] }); });
        step(function () { return book.saveTransaction({ type: 'salesReceipt', date: d(m, 12), contactId: C['Maple Street Bakery'], accountId: acc('Checking'), lines: [{ accountId: acc('Sales'), description: 'POS terminal + setup', qty: 1, rate: String(450 + m * 25) }] }); });
        step(function () { return book.saveTransaction({ type: 'bill', date: d(m, 1), dueDate: d(m, 1), terms: 0, contactId: V['Granite Property Mgmt'], lines: [{ accountId: acc('Rent & Lease'), amount: '1800', description: 'Office rent' }] }).then(function (t) { billId = t.id; }); });
        step(function () { return book.saveTransaction({ type: 'billPayment', date: d(m, 2), contactId: V['Granite Property Mgmt'], accountId: acc('Checking'), amount: '1800', applications: [{ txnId: billId, amount: '1800' }] }); });
        step(function () { return book.saveTransaction({ type: 'expense', date: d(m, 18), contactId: V['City Power & Light'], accountId: acc('Checking'), lines: [{ accountId: acc('Utilities'), amount: (212 + m * 7.35).toFixed(2) }] }); });
        step(function () { return book.saveTransaction({ type: 'expense', date: d(m, 9), contactId: V['Northside Office Supply'], accountId: acc('Business Credit Card'), lines: [{ accountId: acc('Office Supplies & Software'), amount: (86.4 + m * 11).toFixed(2) }, { accountId: acc('Meals'), amount: '38.20', description: 'Client lunch' }] }); });
        step(function () { return book.saveTransaction({ type: 'transfer', date: d(m, 20), accountId: acc('Checking'), toAccountId: acc('Business Credit Card'), amount: (124.6 + m * 11).toFixed(2) }); });
      })(m);
      var pinecrest;
      step(function () { return book.saveTransaction({ type: 'invoice', date: d(3, 15), dueDate: d(4, 15), terms: 30, contactId: C['Pinecrest HOA'], lines: [{ accountId: acc('Services'), description: 'Gate access system install', qty: 1, rate: '5200' }] }).then(function (t) { pinecrest = t; }); });
      step(function () { return book.saveTransaction({ type: 'payment', date: d(4, 10), contactId: C['Pinecrest HOA'], accountId: acc('Checking'), amount: '2000', memo: 'Partial payment', applications: [{ txnId: pinecrest.id, amount: '2000' }] }); });
      step(function () { return book.saveTransaction({ type: 'bill', date: d(5, 2), dueDate: U.addDays(d(5, 2), 30), terms: 30, contactId: V['Ace Subcontracting'], lines: [{ accountId: acc('Contractors'), amount: '1350', description: 'Cabling subcontract' }] }); });
      step(function () { return book.saveTransaction({ type: 'journal', date: d(5, 1), memo: 'Monthly depreciation', jlines: [{ accountId: acc('Depreciation'), debit: '143.33' }, { accountId: acc('Accumulated Depreciation'), credit: '143.33' }] }); });
      step(function () {
        var exp = book.transactions.find(function (t) { return t.type === 'expense' && t.contactId === V['City Power & Light']; });
        return book.saveRecurring({ name: 'City Power & Light — electricity', frequency: 'monthly', nextDate: U.addMonths(U.monthStart(today), 1).slice(0, 8) + '18', template: exp });
      });
      return seq;
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
