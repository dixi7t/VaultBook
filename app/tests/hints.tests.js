/* VaultBook — extra help for bank lines with no suggestion (1.45): what the firm's other clients used, or a built-in
   list of common merchants. Suggestions only; nothing posts by itself. Loaded by tests/run-node.js and tests/tests.html. */
(function (root) {
  'use strict';
  var OB = root.OB, H = OB.hints, T = OB.tests = OB.tests || [];
  function test(name, fn) { T.push({ name: name, fn: fn }); }
  function eq(a, b, msg) { if (a !== b) throw new Error((msg || 'Expected equal') + ': expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }
  function ok(v, msg) { if (!v) throw new Error(msg || 'Assertion failed'); }
  function newBook(name) { return OB.Book.create(new OB.MemoryAdapter(), { name: name }); }
  function acc(b, name) { var a = b.accounts.find(function (x) { return x.name === name; }); if (!a) throw new Error('No account ' + name); return a.id; }
  function spend(b, vendor, cat, memo, n) { // n checking expenses to one category, with or without a payee
    var ck = acc(b, 'Checking'), had = vendor && b.contacts.find(function (c) { return c.name === vendor; });
    var p = had ? Promise.resolve(had) : vendor ? b.saveContact({ kind: 'vendor', name: vendor }) : Promise.resolve(null);
    return p.then(function (c) {
      var chain = Promise.resolve();
      for (var i = 0; i < n; i++) (function (i) { chain = chain.then(function () { return b.saveTransaction({ type: 'expense', date: '2025-0' + (i + 1) + '-10', accountId: ck, contactId: c ? c.id : '', memo: memo || '', lines: [{ accountId: acc(b, cat), amount: '25' }] }); }); })(i);
      return chain;
    });
  }
  function line(desc, amount) { return { id: 'x', description: desc, amount: amount === undefined ? -4210 : amount }; }

  test('HT-01 other clients: a payee another client always puts in one account suggests the same-named account here', function () {
    var a, b;
    return newBook('Client A').then(function (x) { a = x; return spend(a, 'Costco', 'Office Supplies & Software', '', 3); })
      .then(function () { return spend(a, '', 'Utilities', 'COMCAST CABLE COMM 800-COMCAST PA', 2); })
      .then(function () { return newBook('Client B'); }).then(function (x) {
        b = x; var firm = [H.learn(a)];
        ok(firm[0].pairs.length >= 2, 'learned the payee and the bank wording');
        var s = H.fromClients(b, line('CHECKCARD 0112 COSTCO WHSE #1097 FRISCO TX'), firm);
        ok(s, 'Costco found'); eq(s.categoryId, acc(b, 'Office Supplies & Software')); eq(s.source, 'clients');
        ok(/1 other client/.test(s.reason) && /3 of 3/.test(s.reason), s.reason);
        eq(H.fromClients(b, line('COMCAST CABLE COMM 800-COMCAST PA'), firm).categoryId, acc(b, 'Utilities'), 'bank wording learned too');
        eq(H.fromClients(b, line('COSTCO REFUND', 4210), firm), null, 'money in does not use money-out habits');
        eq(H.fromClients(b, line('UNKNOWN SHOP 12'), firm), null);
      });
  });

  test('HT-02 other clients: mixed habits or no similar account here give no suggestion', function () {
    var a;
    return newBook('Client A').then(function (x) { a = x; return spend(a, 'Home Depot', 'Repairs & Maintenance', '', 2); })
      .then(function () { return spend(a, 'Home Depot', 'Office Supplies & Software', '', 2); })
      .then(function () { return a.saveAccount({ name: 'Uniforms', type: 'expense' }); })
      .then(function () { return spend(a, 'Cintas', 'Uniforms', '', 3); })
      .then(function () { return newBook('Client B'); }).then(function (b) {
        var firm = [H.learn(a)];
        eq(H.fromClients(b, line('THE HOME DEPOT #6512'), firm), null, 'two accounts used equally: no guess');
        eq(H.fromClients(b, line('CINTAS CORP 44'), firm), null, 'no Uniforms-like account in this client');
        var learned = JSON.stringify(firm[0]);
        ok(!/2500|2025-0/.test(learned), 'only merchant words and account names are kept, no amounts or dates');
      });
  });

  test('HT-03 common merchants: well-known US merchants map to this client\'s matching account', function () {
    return newBook('Client C').then(function (b) {
      var s = H.fromCommon(b, line('SHELL OIL 57444219 DALLAS TX'));
      ok(s, 'Shell found'); eq(s.categoryId, acc(b, 'Car & Truck')); eq(s.source, 'common'); ok(/Fuel/.test(s.reason), s.reason);
      eq(H.fromCommon(b, line('COMCAST CABLE COMM')).categoryId, acc(b, 'Utilities'));
      eq(H.fromCommon(b, line('UBER *TRIP HELP.UBER.COM')).categoryId, acc(b, 'Travel'));
      eq(H.fromCommon(b, line('GODADDY.COM 480-5058855')).categoryId, acc(b, 'Office Supplies & Software'));
      eq(H.fromCommon(b, line('STARBUCKS STORE 1234')).categoryId, acc(b, 'Meals'));
      eq(H.fromCommon(b, line('MAPLE STREET HARDWARE')), null, 'unknown merchant');
      eq(H.fromCommon(b, line('PAYCHEX INC DES:FLEXPERKS')), null, 'payroll services are never guessed');
      eq(H.fromCommon(b, line('ATT*BILL PAYMENT 09/13')).categoryId, acc(b, 'Utilities'), 'a phone carrier falls back to Utilities when there is no phone account');
      eq(H.fromCommon(b, line('SHELL OIL', 5000)), null, 'spending merchants are not suggested for money in');
    });
  });

  test('HT-05 the full merchant list loads; office supplies win over medical supplies', function () {
    var n = 0; Object.keys(OB.merchants).forEach(function (k) { n += OB.merchants[k].split('|').length; });
    ok(n > 1400, 'merchant names: ' + n);
    return newBook('Client E').then(function (b) { return b.saveAccount({ name: 'Medical Supplies', type: 'expense' }).then(function () {
      eq(H.fromCommon(b, line('STAPLES 00123')).categoryId, acc(b, 'Office Supplies & Software'));
      eq(H.fromCommon(b, line('TURKEY HILL #0456 LANCASTER PA')).categoryId, acc(b, 'Car & Truck'), 'a newly added merchant');
    }); });
  });

  function off(b, names) { // make default accounts inactive, so only the client's own names are left
    return names.reduce(function (p, n) { return p.then(function () { var a = b.accounts.find(function (x) { return x.name === n; }); return b.saveAccount(Object.assign({}, a, { active: false })); }); }, Promise.resolve());
  }
  function adds(b, list) { // [name, type, parent name]
    return list.reduce(function (p, x) { return p.then(function () { return b.saveAccount({ name: x[0], type: x[1], parentId: x[2] ? acc(b, x[2]) : '' }); }); }, Promise.resolve());
  }

  test('HT-06 a QuickBooks-style chart: its own account names, sub-accounts, inactive accounts, a credit card', function () {
    var b;
    return newBook('QB Style Co').then(function (x) { b = x; return off(b, ['Car & Truck', 'Meals', 'Utilities', 'Office Supplies & Software', 'Travel', 'Insurance', 'Bank Charges & Fees']); })
      .then(function () { return adds(b, [['Automobile Expense', 'expense'], ['Fuel', 'expense', 'Automobile Expense'], ['Meals and Entertainment', 'expense'], ['Utilities Exp', 'expense'],
        ['Electric', 'expense', 'Utilities Exp'], ['Telephone Expense', 'expense'], ['Office Expenses', 'expense'], ['Travel Expense', 'expense'], ['Old Supplies', 'expense'], ['Amex', 'cc']]); })
      .then(function () { return b.saveAccount(Object.assign({}, b.accounts.find(function (a) { return a.name === 'Old Supplies'; }), { active: false })); })
      .then(function () {
        var c = function (d) { var s = H.fromCommon(b, line(d)); return s ? b.accById[s.categoryId].name : null; };
        eq(c('SHELL OIL 574442'), 'Fuel', 'the fuel sub-account, not its parent');
        eq(c('DUKE ENERGY PROGRESS'), 'Electric', 'the electric sub-account under utilities');
        eq(c('STARBUCKS 123'), 'Meals and Entertainment'); eq(c('VERIZON WIRELESS'), 'Telephone Expense'); eq(c('STAPLES 9'), 'Office Expenses');
        eq(c('DELTA AIR 0062'), 'Travel Expense'); ok(c('GEICO AUTO') === null, 'no insurance account is active: no guess');
        ok(b.accounts.find(function (a) { return a.name === 'Old Supplies'; }).active === false, 'inactive accounts are never suggested');
        // a card charge is money out like a bank payment; learning works from card lines too
        return b.saveTransaction({ type: 'expense', date: '2025-03-01', accountId: acc(b, 'Amex'), memo: 'BLUE BOTTLE COFFEE 44', lines: [{ accountId: acc(b, 'Meals and Entertainment'), amount: '9' }] })
          .then(function () { return b.saveTransaction({ type: 'expense', date: '2025-03-02', accountId: acc(b, 'Amex'), memo: 'BLUE BOTTLE COFFEE 45', lines: [{ accountId: acc(b, 'Meals and Entertainment'), amount: '7' }] }); });
      }).then(function () {
        var l = H.learn(b), p = l.pairs.find(function (x) { return x[0] === 'BLUE BOTTLE COFFEE'; });
        ok(p && p[1] === 'out' && p[2][0][2] === 2, 'card charges are learned as money out: ' + JSON.stringify(p));
        return newBook('Default Co').then(function (d) { eq(H.fromClients(d, line('BLUE BOTTLE COFFEE 9'), [l]).categoryId, acc(d, 'Meals'), 'Meals and Entertainment there is Meals here'); });
      });
  });

  test('HT-07 an old company: data saved by an early version is upgraded in memory and learned from', function () {
    return newBook('Old Co').then(function (b) { return spend(b, 'Costco', 'Office Supplies & Software', '', 2).then(function () {
      var old = JSON.parse(JSON.stringify({ company: b.company, accounts: b.accounts, contacts: b.contacts, transactions: b.transactions, rules: [], recurring: [], reconciliations: [], audit: [] }));
      old.company.dataVersion = 2;
      OB.schema.migrate(old);
      var again = new OB.Book(new OB.MemoryAdapter(), old), l = H.learn(again);
      ok(l.pairs.some(function (x) { return x[0] === 'COSTCO'; }), 'learned from the upgraded data');
    }); });
  });

  test('HT-08 the sample company and odd lines never throw', function () {
    return newBook('Sample Co').then(function (b) { return OB.sample.populate(b, '2026-11-16').then(function () {
      var l = H.learn(b); ok(l.pairs.length > 0, 'the sample company teaches something');
      ['', '   ', '#####', '0000 1111', 'ÄÖÜ CAFÉ', 'a'.repeat(500), 'CHECK 1042', 'DEPOSIT'].forEach(function (d) {
        H.fromCommon(b, line(d)); H.fromCommon(b, line(d, 100)); H.fromClients(b, line(d), [l]); H.fromClients(b, line(d, 100), [l, { name: '', pairs: [] }]);
      });
      eq(H.fromClients(b, line('STARBUCKS'), []), null); eq(H.fromClients(b, line('STARBUCKS'), null), null);
    }); });
  });

  test('HT-09 a large firm stays fast: 40 clients x 1,500 habits, 500 bank lines', function () {
    return newBook('Big Firm Co').then(function (b) {
      var firm = [];
      for (var c = 0; c < 40; c++) { var pairs = []; for (var i = 0; i < 1500; i++) pairs.push(['VENDOR' + c + 'X' + i, 'out', [['meals', 'expense', 3]]]); pairs.push(['ZZTOP DINER', 'out', [['meals', 'expense', 3]]]); firm.push({ name: 'C' + c, pairs: pairs }); }
      var t0 = Date.now(), hit = 0;
      for (var n = 0; n < 500; n++) if (H.fromClients(b, line(n % 5 ? 'RANDOM SHOP ' + n : 'ZZTOP DINER 22'), firm)) hit++;
      var ms = Date.now() - t0;
      eq(hit, 100); ok(ms < 1500, '500 lines took ' + ms + 'ms');
      ok(/40 other clients/.test(H.fromClients(b, line('ZZTOP DINER'), firm).reason));
    });
  });

  test('HT-10 where this company already posts wins: a used parent keeps its postings, the most-used of similar accounts is chosen', function () {
    var b;
    return newBook('Habits Co').then(function (x) { b = x; return adds(b, [['Sewer Bill', 'expense', 'Utilities'], ['Meals & Entertainment', 'expense']]); })
      .then(function () { return spend(b, '', 'Utilities', 'CITY WATER 1', 1); })
      .then(function () { return spend(b, '', 'Meals & Entertainment', 'LUNCH 1', 3); })
      .then(function () {
        eq(H.fromCommon(b, line('PECO ENERGY PAYMENT')).categoryId, acc(b, 'Utilities'), 'Utilities is used directly, so not its only sub-account');
        eq(H.fromCommon(b, line('STARBUCKS 77')).categoryId, acc(b, 'Meals & Entertainment'), 'the meals account this company uses');
        eq(H.fromCommon(b, line('INTUIT *PAYROLL')), null, 'Intuit alone can be software, payroll or card fees');
        ok(H.fromCommon(b, line('INTUIT *QBOOKS ONLINE')), 'QuickBooks itself is still known');
      });
  });

  test('HT-11 bank words are never learned as payees', function () {
    return newBook('Words Co').then(function (b) { return spend(b, '', 'Meals', 'CHK 1001', 3).then(function () { return spend(b, '', 'Meals', 'ONLINE BANKING TRANSFER CONF 5', 3); })
      .then(function () { return spend(b, '', 'Meals', 'ZELLE TO JOHN', 3); }).then(function () {
        var keys = H.learn(b).pairs.map(function (p) { return p[0]; });
        ok(!keys.some(function (k) { return /^(CHK|BANKING|ZELLE)/.test(k); }), 'learned: ' + keys.join(', '));
      }); });
  });

  test('HT-04 coverage counts lines that had no suggestion and were identified', function () {
    return newBook('Client D').then(function (b) {
      var lines = [line('SHELL OIL 1'), line('COMCAST'), line('MAPLE STREET HARDWARE'), line('STARBUCKS 9')];
      var c = H.coverage(b, lines, function (l) { return H.fromCommon(b, l); });
      eq(c.of, 4); eq(c.found, 3);
    });
  });
})(typeof window !== 'undefined' ? window : global);
