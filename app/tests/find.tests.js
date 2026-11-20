/* VaultBook — Find and universal search (1.27). Synthetic data only.
   Loaded after studio.tests.js by tests/run-node.js and tests/tests.html; shares OB.tests. */
(function (root) {
  'use strict';
  var OB = root.OB, F = OB.find;
  var T = OB.tests;
  function test(name, fn) { T.push({ name: name, fn: fn }); }
  function eq(a, b, msg) { if (a !== b) throw new Error((msg || 'Expected equal') + ': expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }
  function ok(c, msg) { if (!c) throw new Error(msg || 'Expected true'); }
  function acc(b, name) { var a = b.accounts.find(function (x) { return x.name === name; }); if (!a) throw new Error('No account ' + name); return a.id; }
  var nums = function (rows) { return rows.map(function (r) { return r.t.number; }).sort().join(); };

  function book() {
    var b, c, d, v;
    return OB.Book.create(new OB.MemoryAdapter(), { name: 'Find Co' })
      .then(function (bk) { b = bk; return Promise.all([b.saveContact({ kind: 'customer', name: 'Sunrise Health', email: 'ap@sunrise.example', notes: 'Pays by ACH' }), b.saveContact({ kind: 'customer', name: 'Pine Labs' }), b.saveContact({ kind: 'vendor', name: 'Paper Co' })]); })
      .then(function (cs) {
        c = cs[0].id; d = cs[1].id; v = cs[2].id;
        var A = function (n) { return acc(b, n); };
        return b.saveTransactions([
          { type: 'invoice', date: '2025-03-10', dueDate: '2025-04-09', contactId: c, number: '1001', memo: 'Old reading fees', lines: [{ accountId: A('Services'), amount: '5000', description: 'March reads' }] },
          { type: 'invoice', date: '2026-05-04', dueDate: '2026-06-03', contactId: c, number: '1162', lines: [{ accountId: A('Services'), amount: '340074.75', description: 'MRI reads' }, { accountId: A('Services'), amount: '125', description: 'Courier' }] },
          { type: 'invoice', date: '2026-05-20', dueDate: '2026-06-19', contactId: d, number: '1170', memo: 'cash paid at desk', lines: [{ accountId: A('Services'), amount: '30000' }] },
          { type: 'check', date: '2026-06-02', number: '5005', accountId: A('Checking'), contactId: v, memo: 'Toner', lines: [{ accountId: A('Office Supplies & Software'), amount: '250', description: 'Printer toner' }] },
          { type: 'expense', date: '2026-06-03', accountId: A('Checking'), contactId: v, lines: [{ accountId: A('Office Supplies & Software'), amount: '30000' }] }
        ]);
      }).then(function (saved) {
        return b.saveTransaction({ type: 'payment', date: '2026-06-10', contactId: d, accountId: b.sys('UNDEP').id, amount: '30000', applications: [{ txnId: saved[2].id, amount: '30000' }] })
          .then(function () { return { b: b, c: c, d: d, v: v, A: function (n) { return acc(b, n); } }; });
      });
  }

  test('FD-01 advanced find: all conditions, any condition, every date (no two-year limit), and where each match was found', function () {
    return book().then(function (x) {
      var b = x.b;
      var r = F.find(b, { conds: [{ field: 'type', op: 'is', ids: ['invoice'] }, { field: 'amount', op: 'gte', value: '30000', target: 'total' }] });
      eq(nums(r.rows), '1162,1170', 'invoices of $30,000 or more, all dates');
      r = F.find(b, { from: '2025-01-01', to: '2025-12-31', conds: [{ field: 'type', op: 'is', ids: ['invoice'] }] });
      eq(nums(r.rows), '1001', 'a 2025 invoice is still found');
      r = F.find(b, { match: 'any', conds: [{ field: 'memo', op: 'contains', value: 'toner' }, { field: 'number', op: 'is', value: '1170' }] });
      eq(nums(r.rows), '1170,5005', 'match any');
      var toner = r.rows.find(function (y) { return y.t.number === '5005'; });
      ok(toner.why.some(function (w) { return /Memo/.test(w) && /Toner/.test(w); }) && toner.why.some(function (w) { return /Printer toner/.test(w); }), 'shows where it matched: ' + toner.why.join(' | '));
      r = F.find(b, { conds: [{ field: 'memo', op: 'contains', value: 'courier' }] });
      eq(nums(r.rows), '1162', 'line descriptions are searched too');
      eq(r.total, 34019975, 'total of the found transactions');
      r = F.find(b, { conds: [{ field: 'amount', op: 'eq', value: '125', target: 'line' }] });
      eq(nums(r.rows), '1162', 'amount of any one line');
      r = F.find(b, { conds: [{ field: 'amount', op: 'between', value: '200', value2: '300', target: 'total' }] });
      eq(nums(r.rows), '5005', 'between');
    });
  });

  test('FD-02 names, accounts, open or paid, entered dates, not-contains and empty', function () {
    return book().then(function (x) {
      var b = x.b, r;
      r = F.find(b, { conds: [{ field: 'name', op: 'is', ids: [x.c] }] });
      eq(nums(r.rows), '1001,1162');
      r = F.find(b, { conds: [{ field: 'name', op: 'isnot', ids: [x.c] }, { field: 'type', op: 'is', ids: ['invoice'] }] });
      eq(nums(r.rows), '1170');
      r = F.find(b, { conds: [{ field: 'account', op: 'is', ids: [x.A('Office Supplies & Software')] }] });
      eq(r.rows.length, 2, 'check and expense use the account');
      r = F.find(b, { conds: [{ field: 'balance', op: 'is', value: 'open' }] });
      eq(nums(r.rows), '1001,1162', 'open invoices');
      r = F.find(b, { conds: [{ field: 'balance', op: 'is', value: 'paid' }] });
      eq(nums(r.rows), '1170');
      r = F.find(b, { conds: [{ field: 'balance', op: 'is', value: 'overdue' }], today: '2026-11-12' });
      eq(nums(r.rows), '1001,1162');
      r = F.find(b, { conds: [{ field: 'memo', op: 'empty' }, { field: 'type', op: 'is', ids: ['invoice'] }] });
      eq(nums(r.rows), '1162', 'empty means no memo on the transaction itself');
      r = F.find(b, { conds: [{ field: 'text', op: 'notcontains', value: 'sunrise' }, { field: 'type', op: 'is', ids: ['invoice'] }] });
      eq(nums(r.rows), '1170');
      var today = new Date().toISOString().slice(0, 10);
      r = F.find(b, { conds: [{ field: 'entered', op: 'between', value: today, value2: today }] });
      eq(r.rows.length, 6, 'all entered today');
    });
  });

  test('FD-03 the search box reads plain words: type, amount, name, period and field:value', function () {
    return book().then(function (x) {
      var b = x.b, q = function (s) { return F.find(b, F.parse(b, s, '2026-11-12')); };
      eq(nums(q('invoices over 1000 from sunrise health').rows), '1001,1162');
      eq(nums(q('invoice > 1000 sunrisehealth this year').rows), '1162', 'name written together, this year');
      eq(nums(q('invoices may 2026').rows), '1162,1170');
      eq(nums(q('memo:"cash paid"').rows), '1170');
      eq(nums(q('narration:toner amount<300').rows), '5005', 'Tally words work too');
      eq(q('30000').rows.length, 3, 'a bare number: the invoice, its payment and the expense of that amount');
      eq(nums(q('$340,074.75').rows), '1162');
      eq(nums(q('1162').rows), '1162', 'a bare number also finds the invoice number');
      eq(nums(q('mri').rows), '1162');
      eq(nums(q('between 200 and 300').rows), '5005');
      eq(nums(q('2025-03-10').rows), '1001', 'a date');
      eq(nums(q('3/10/2025').rows), '1001', 'a US date');
      eq(nums(q('checks paper co').rows), '5005');
      eq(nums(q('void').rows), '', 'void: none voided');
      var p = F.parse(b, 'invoices over 1000 from sunrise health last month', '2026-11-12');
      eq(p.from, '2026-10-01'); eq(p.to, '2026-10-31');
      ok(F.describe(b, p).indexOf('Sunrise Health') >= 0, 'plain-English summary: ' + F.describe(b, p));
    });
  });

  test('FD-04 search everything: transactions, customers and vendors (email, notes), accounts, products and bank lines', function () {
    return book().then(function (x) {
      var b = x.b;
      return b.saveItem({ name: 'MRI read', type: 'service', incomeAccountId: x.A('Services'), price: '125', description: 'Per study' })
        .then(function () { return b.importBankLines(x.A('Checking'), [{ date: '2026-06-11', description: 'ORIG CO NAME:SUNRISE HEALTH ACH', amount: 3000000 }], { fileName: 'b.csv' }); })
        .then(function () {
          var e = F.everything(b, 'sunrise', '2026-11-12');
          eq(e.contacts.length, 1); eq(e.transactions.length, 2); eq(e.bankLines.length, 1);
          eq(F.everything(b, 'ach', '2026-11-12').contacts.length, 1, 'contact notes');
          eq(F.everything(b, 'mri', '2026-11-12').items.length, 1);
          ok(F.everything(b, 'checking', '2026-11-12').accounts.length >= 1);
          eq(F.everything(b, '30000', '2026-11-12').bankLines.length, 1, 'bank line amount');
          eq(F.everything(b, '', '2026-11-12').transactions.length, 0, 'empty search finds nothing');
        });
    });
  });
})(typeof window !== 'undefined' ? window : globalThis);
