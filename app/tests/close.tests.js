/* VaultBook — Close the books (1.46): VaultBook prepares the bank lines like a staff accountant, the CPA reviews,
   asks the client, ties out and signs off. Loaded by tests/run-node.js and tests/tests.html. */
(function (root) {
  'use strict';
  var OB = root.OB, C = OB.close, U = OB.util, T = OB.tests = OB.tests || [];
  function test(name, fn) { T.push({ name: name, fn: fn }); }
  function eq(a, b, msg) { if (a !== b) throw new Error((msg || 'Expected equal') + ': expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }
  function ok(v, msg) { if (!v) throw new Error(msg || 'Assertion failed'); }
  function acc(b, name) { var a = b.accounts.find(function (x) { return x.name === name; }); if (!a) throw new Error('No account ' + name); return a.id; }
  function clean(b) { var i = b.checkIntegrity(); eq(i.issues.length, 0, 'integrity: ' + i.issues.join('; ')); }
  function seq(list, fn) { return list.reduce(function (p, x) { return p.then(function () { return fn(x); }); }, Promise.resolve()); }
  var YEAR = { from: '2025-01-01', to: '2025-12-31' };

  /* Two past years of habits, then 2025 bank lines:
     Costco always Office Supplies (sure) · Home Depot mixed (suggest) · Amazon always Owner's Draw (sure, but an owner account: never auto)
     · a payee seen only in old years then changed (recent habit wins) · a new payee (ask) · a line already in the books (match first). */
  function firm() {
    var b, v = {}, ck;
    return OB.Book.create(new OB.MemoryAdapter(), { name: 'Close Co' }).then(function (x) {
      b = x; ck = acc(b, 'Checking');
      return seq(['Costco', 'Home Depot', 'Amazon', 'Gold Gym', 'Granite Property'], function (n) { return b.saveContact({ kind: 'vendor', name: n }).then(function (c) { v[n] = c.id; }); });
    }).then(function () {
      var past = [];
      for (var m = 1; m <= 12; m++) {
        var mm = (m < 10 ? '0' : '') + m;
        past.push(['2024-' + mm + '-03', 'Costco', 'Office Supplies & Software', 120]);
        past.push(['2023-' + mm + '-03', 'Costco', 'Office Supplies & Software', 110]);
        past.push(['2024-' + mm + '-09', 'Home Depot', m % 2 ? 'Repairs & Maintenance' : 'Office Supplies & Software', 80]);
        past.push(['2024-' + mm + '-15', 'Amazon', "Owner's Draw", 60]);
        past.push(['2024-' + mm + '-20', 'Granite Property', 'Rent & Lease', 2000]);
        past.push(['2022-' + mm + '-20', 'Gold Gym', 'Meals', 50]);                       // old habit…
        if (m >= 6) past.push(['2024-' + mm + '-21', 'Gold Gym', "Owner's Draw", 50]);    // …changed in 2024
      }
      return seq(past, function (p) { return b.saveTransaction({ type: 'expense', date: p[0], accountId: ck, contactId: v[p[1]], memo: p[1].toUpperCase() + ' PURCHASE', lines: [{ accountId: acc(b, p[2]), amount: String(p[3]) }] }); });
    }).then(function () {   // January rent was entered by hand before the statement arrived
      return b.saveTransaction({ type: 'check', number: '501', date: '2025-01-19', accountId: ck, contactId: v['Granite Property'], lines: [{ accountId: acc(b, 'Rent & Lease'), amount: '2000' }] });
    }).then(function () {
      return b.importBankLines(ck, [
        { date: '2025-01-03', description: 'COSTCO WHSE #1097 FRISCO TX', amount: -12345 },
        { date: '2025-01-09', description: 'THE HOME DEPOT #6512', amount: -8800 },
        { date: '2025-01-15', description: 'AMAZON MKTPLACE PMTS', amount: -6000 },
        { date: '2025-01-21', description: 'GOLD GYM 0042', amount: -5000 },
        { date: '2025-01-19', description: 'CHECK 501', amount: -200000, checkNo: '501' },
        { date: '2025-01-25', description: 'ZQX TRADING 7781', amount: -4100 },
        { date: '2025-02-03', description: 'COSTCO WHSE #1097 FRISCO TX', amount: -9900 }], { fileName: 'jan-feb.csv', endingBalance: 100000, endingDate: '2025-02-28' });
    }).then(function () { return { b: b, ck: ck, v: v }; });
  }
  function byDesc(plans, re) { return plans.find(function (p) { return re.test(p.line.description) && (!p.line.date || true); }); }

  test('CL-01 prepare: match first, then sure habits auto-post, mixed habits suggest three, owner accounts never auto, new payees ask', function () {
    return firm().then(function (f) {
      var plans = C.prepare(f.b, { from: YEAR.from, to: YEAR.to, auto: true }), b = f.b;
      eq(plans.length, 6, 'the check entered by hand was matched to the books on import');
      var chk = b.bankLines.find(function (l) { return /CHECK 501/.test(l.description); }); eq(chk.status, 'posted'); eq(chk.auto, 'books');
      var cost = byDesc(plans, /COSTCO/); eq(cost.kind, 'habit'); ok(cost.auto, 'Costco is sure'); eq(cost.categoryId, acc(b, 'Office Supplies & Software'));
      ok(/Costco/.test(cost.reason) && /24 of 24/.test(cost.reason), cost.reason);
      var hd = byDesc(plans, /HOME DEPOT/); eq(hd.kind, 'habit'); ok(!hd.auto, 'Home Depot is mixed'); eq(hd.top.length, 2, 'both accounts offered'); ok(hd.top[0].n === 6 && hd.top[1].n === 6, JSON.stringify(hd.top));
      var am = byDesc(plans, /AMAZON/); ok(!am.auto, 'an owner account is never posted without you'); eq(am.categoryId, acc(b, "Owner's Draw")); ok(/owner|loan|payroll|balance sheet/i.test(am.why), am.why);
      var gg = byDesc(plans, /GOLD GYM/); eq(gg.categoryId, acc(b, "Owner's Draw"), 'the habit of the last two years wins over older years');
      var zq = byDesc(plans, /ZQX/); eq(zq.kind, 'ask'); ok(!zq.auto);
      return b.saveTransaction({ type: 'expense', date: '2025-01-25', accountId: f.ck, memo: 'ZQX boxes', lines: [{ accountId: acc(b, 'Office Supplies & Software'), amount: '41' }] }).then(function () {
        var z2 = byDesc(C.prepare(b, { from: YEAR.from, to: YEAR.to, auto: true }), /ZQX/);
        eq(z2.kind, 'match', 'an entry typed after the import is matched, never added twice'); ok(z2.auto && z2.d.kind === 'match');
      }).then(function () {
      ok(C.prepare(b, { from: YEAR.from, to: YEAR.to, auto: false }).every(function (p) { return !p.auto; }), 'auto-post off: everything waits for you');
      });
    });
  });

  test('CL-02 post the prepared lines: each goes through the bank feed, keeps its reason, and can be undone', function () {
    var f;
    return firm().then(function (x) { f = x; return C.post(f.b, C.prepare(f.b, { from: YEAR.from, to: YEAR.to, auto: true })); }).then(function (r) {
      var b = f.b;
      eq(r.posted, 2, 'the two Costco lines'); eq(r.failed.length, 0);
      var l = b.bankLines.find(function (x) { return /COSTCO/.test(x.description) && x.date === '2025-01-03'; });
      eq(l.status, 'posted'); ok(/Costco/.test(l.prepared), 'reason kept on the line: ' + l.prepared);
      eq(b.txById[l.txnId].contactId, f.v.Costco, 'the payee is filled in'); clean(b);
      eq(b.transactions.filter(function (t) { return t.number === '501'; }).length, 1, 'no second check');
      return b.undoBankLine(l.id).then(function () { eq(b.bankLineById[l.id].status, 'review'); clean(b); });
    });
  });

  test('CL-03 self-test: learn from the years before, predict a year already done, measure', function () {
    return firm().then(function (f) {
      var t = C.selfTest(f.b, { from: '2024-01-01', to: '2024-12-31' });
      ok(t.lines >= 50, 'lines tested: ' + t.lines);
      eq(t.auto.n, 19, 'Costco (12) and Gold Gym (7) looked sure from the years before: ' + JSON.stringify(t));
      eq(t.auto.right, 12, 'Gold Gym changed account in 2024: the test shows it');
      eq(t.ask, 36, 'Home Depot, Amazon and Granite were new in 2024');
      eq(C.autoAllowed(t), false, '63% right: auto-post is not offered for this client');
      eq(C.autoAllowed({ auto: { n: 40, right: 36 } }), false, '90% is not enough');
      eq(C.autoAllowed({ auto: { n: 40, right: 39 } }), true);
    });
  });

  test('CL-04 review by payee: groups sorted by dollars; accept a group with one account; ask the client about a line', function () {
    var f;
    return firm().then(function (x) { f = x; return C.post(f.b, C.prepare(f.b, { from: YEAR.from, to: YEAR.to, auto: true })); }).then(function () {
      var b = f.b, g = C.groups(C.prepare(b, { from: YEAR.from, to: YEAR.to, auto: true }));
      eq(g.length, 4); ok(g[0].total >= g[1].total && g[1].total >= g[2].total, 'largest dollars first');
      var hd = g.find(function (x) { return /Home Depot/.test(x.label); });
      return C.accept(b, hd.plans, acc(b, 'Repairs & Maintenance')).then(function (r) {
        eq(r.posted, 1); eq(b.bankLines.find(function (l) { return /HOME DEPOT/.test(l.description); }).categoryId, acc(b, 'Repairs & Maintenance'));
        var zq = b.bankLines.find(function (l) { return /ZQX/.test(l.description); });
        return b.updateBankLine(zq.id, { ask: 'What was this payment to ZQX Trading for?' }).then(function () {
          var cl = C.checklist(b, YEAR);
          eq(cl.questions.open, 1); eq(cl.questions.list[0].ask, 'What was this payment to ZQX Trading for?');
          return b.updateBankLine(zq.id, { answer: 'Packing boxes' });
        }).then(function () { eq(C.checklist(b, YEAR).questions.open, 0); eq(b.bankLineById[zq.id].answer, 'Packing boxes'); clean(b); });
      });
    });
  });

  test('CL-05 checklist: statements received by month, reconciliations, compare to last year, and sign-off only when everything ties', function () {
    var f;
    return firm().then(function (x) { f = x; return C.post(f.b, C.prepare(f.b, { from: YEAR.from, to: YEAR.to, auto: true })); }).then(function () {
      var b = f.b, cl = C.checklist(b, YEAR, '2025-03-15');
      var st = cl.statements.accounts.find(function (a) { return a.accountId === f.ck; });
      eq(st.missing.join(','), '', 'Jan and Feb received; March has not ended yet');
      eq(C.checklist(b, YEAR, '2025-05-02').statements.accounts.find(function (a) { return a.accountId === f.ck; }).missing.join(','), '2025-03,2025-04', 'months that ended without a statement');
      ok(!cl.reconcile.done && !cl.review.done, 'still open');
      var rec = cl.reconcile.accounts.find(function (a) { return a.accountId === f.ck; }); eq(rec.through, '');
      // compare to last year: rent, owner draw and others vs 2024; a reason clears a flagged line
      var fl = cl.flux; ok(fl.rows.length > 0); var rent = fl.rows.find(function (r) { return r.accountId === acc(b, 'Rent & Lease'); });
      ok(rent && rent.flag, 'rent fell from $24,000 to $2,000: flagged');
      eq(C.canSignOff(cl).ok, false); ok(C.canSignOff(cl).why.length >= 3, C.canSignOff(cl).why.join(' | '));
      return C.saveNote(b, YEAR, rent.accountId, 'Only January posted so far').then(function () {
        var r2 = C.checklist(b, YEAR, '2025-03-15').flux.rows.find(function (r) { return r.accountId === rent.accountId; });
        eq(r2.note, 'Only January posted so far'); ok(r2.explained);
        return C.saveSettings(b, { flux: { amt: 5000000, pct: 50 } });
      }).then(function () {
        ok(!C.checklist(b, YEAR, '2025-03-15').flux.rows.some(function (r) { return r.flag && r.accountId !== rent.accountId; }), 'a higher floor flags less');
        return C.signOff(b, YEAR, '2025-03-15').then(function () { throw new Error('sign-off should be refused'); }, function (e) { ok(/statement|review|reconcil/i.test(e.message), e.message); });
      });
    });
  });

  test('CL-06 sign-off locks the period, records who-when, and the audit trail shows it', function () {
    var b;
    return OB.Book.create(new OB.MemoryAdapter(), { name: 'Tiny Close Co' }).then(function (x) {
      b = x; var p = { from: '2025-01-01', to: '2025-01-31' };
      var cl = C.checklist(b, p, '2025-02-10'); ok(C.canSignOff(cl).ok, 'nothing to do in an empty month: ' + C.canSignOff(cl).why.join(' | '));
      return C.signOff(b, p, '2025-02-10').then(function () {
        eq(b.company.closingDate, '2025-01-31'); ok(b.company.close.periods['2025-01-01_2025-01-31'].signedOff.at);
        ok(b.audit.some(function (a) { return /Signed off 01\/01\/2025/.test(a.summary || a.message || a.text || JSON.stringify(a)); }), 'audit entry');
        return OB.Book.prototype.saveTransaction.call(b, { type: 'expense', date: '2025-01-20', accountId: acc(b, 'Checking'), lines: [{ accountId: acc(b, 'Meals'), amount: '5' }] })
          .then(function () { throw new Error('closed period accepted a posting'); }, function (e) { ok(/closed/i.test(e.message), e.message); });
      });
    });
  });

  test('CL-07 adjusting entries: last year\'s journal entries in the same period are offered to repeat', function () {
    var b;
    return OB.Book.create(new OB.MemoryAdapter(), { name: 'Adj Co' }).then(function (x) {
      b = x;
      return b.saveTransaction({ type: 'journal', date: '2024-12-31', memo: 'Depreciation 2024', jlines: [{ accountId: acc(b, 'Depreciation'), debit: '1200' }, { accountId: acc(b, 'Accumulated Depreciation'), credit: '1200' }] });
    }).then(function () {
      var cl = C.checklist(b, YEAR, '2026-01-10');
      eq(cl.adjust.list.length, 1); eq(cl.adjust.list[0].memo, 'Depreciation 2024'); eq(cl.adjust.list[0].date, '2025-12-31', 'dated one year later');
      eq(cl.adjust.list[0].done, false);
      return b.saveTransaction({ type: 'journal', date: '2025-12-31', memo: 'Depreciation 2025', jlines: [{ accountId: acc(b, 'Depreciation'), debit: '1300' }, { accountId: acc(b, 'Accumulated Depreciation'), credit: '1300' }] });
    }).then(function () { eq(C.checklist(b, YEAR, '2026-01-10').adjust.list[0].done, true, 'an entry to the same accounts this year counts as done'); });
  });
  /* 1.57.0 — the same engine now feeds the Bank feed. Made-up names only. */
  function shop() {
    var b, v = {}, ck;
    var names = ['Circle K', "Bo Marlow's", 'Tallgrass Corporation', 'Lantern Food Yard', 'T- Mobile', 'Pilot', 'ABC Shop', 'Northwind Staffing', 'Costco', 'Granite Property', 'Interest Earned'];
    return OB.Book.create(new OB.MemoryAdapter(), { name: 'Shop Co' }).then(function (x) {
      b = x; ck = acc(b, 'Checking');
      return seq(names, function (n) { return b.saveContact({ kind: 'vendor', name: n }).then(function (c) { v[n] = c.id; }); });
    }).then(function () {
      var past = [];
      for (var m = 1; m <= 6; m++) {
        var d = '2024-0' + m + '-05';
        past.push({ type: 'expense', date: d, accountId: ck, contactId: v['Circle K'], lines: [{ accountId: acc(b, 'Meals'), amount: '20' }] });
        past.push({ type: 'expense', date: d, accountId: ck, contactId: v['Costco'], lines: [{ accountId: acc(b, 'Office Supplies & Software'), amount: '90' }] });
        past.push({ type: 'expense', date: d, accountId: ck, contactId: v['T- Mobile'], lines: [{ accountId: acc(b, 'Utilities'), amount: '70' }] });
        past.push({ type: 'expense', date: d, accountId: ck, contactId: v['Granite Property'], lines: [{ accountId: acc(b, 'Rent & Lease'), amount: '2000' }] });
        // QuickBooks deposits carry the payer on the deposit line, not on the deposit
        past.push({ type: 'deposit', date: d, accountId: ck, memo: 'Deposit', lines: [{ accountId: acc(b, 'Services'), amount: '5000', contactId: v['Northwind Staffing'] }] });
        past.push({ type: 'deposit', date: d, accountId: ck, memo: 'Deposit', lines: [{ accountId: acc(b, 'Uncategorized Income'), amount: '0.01', contactId: v['Interest Earned'] }] });
      }
      return seq(past, function (t) { return b.saveTransaction(t); });
    }).then(function () {
      return b.importBankLines(ck, [
        { date: '2025-01-03', description: 'Checkcard 0105 Circlek — CHECKCARD 0105 CIRCLEK #10001 ANYTOWN TX CKCD 5542 XXXXXXXXXXXX1111 XXXX XXXX XXXX 1111', amount: -2006 },
        { date: '2025-01-04', description: 'Northwind Staffi DES:EDI — NORTHWIND STAFFI DES:EDI PYMTS ID:PAY0001 INDN:SHOP CO CO ID:XXXXX39478 CCD', amount: 500000 },
        { date: '2025-01-05', description: 'Mobile Purchase 0129 — MOBILE PURCHASE 0129 MAVI CAFE SANAYI VE T ISTANBUL', amount: -1018 },
        { date: '2025-01-06', description: 'Zephyr Staffing Inc. DES:Direct — ZEPHYR STAFFING INC. DES:DIRECT PAY ID:X0001 INDN:ABC SHOP WORLDWIDE CO ID:1234', amount: 640000 },
        { date: '2025-01-07', description: 'Costco — PURCHASE REFUND 0224 COSTCO WHSE #1000 ANYTOWN TX', amount: 999 },
        { date: '2025-01-08', description: 'Wire Type:Book IN — WIRE TYPE:BOOK IN DATE:250108 TIME:1602 ET TRN:1 RELATED REF:GRANITE PROPERTY RENT', amount: -200000 },
        { date: '2025-01-09', description: 'Checkcard 0802 TST — CHECKCARD 0802 TST* LANTERN FOOD YARD PILOT POINT TX 24000001 CKCD 5812', amount: -3100 },
        { date: '2025-01-10', description: 'Interest Earned', amount: 1 },
        { date: '2025-01-11', description: 'T-Mobile — T-MOBILE*AUTO PAY 800-555-0100 WA', amount: -7000 }], { fileName: 'jan.qbo' });
    }).then(function () { return { b: b, ck: ck, v: v }; });
  }
  test('CL-08 reading the payee out of bank wording: joined and cut-off names, card and ACH noise, and no false finds', function () {
    return shop().then(function (f) {
      var b = f.b, H = OB.hints, name = function (d) { var m = H.vendorMatch(b, d); return m ? m.contact.name + '/' + m.how : ''; };
      eq(name('CHECKCARD 0105 CIRCLEK #10001 ANYTOWN TX CKCD 5542 XXXXXXXXXXXX1111'), 'Circle K/start', 'two words written as one');
      eq(name('CHECKCARD 1231 BO MARLOWS DISCOUNT MART SPRINGFIELDNJ 2400000001'), "Bo Marlow's/start", 'apostrophe');
      eq(name('TALLGRASS CORPORATI DES:EDI PYMTS ID:77 INDN:SHOP CO'), 'Tallgrass Corporation/start', 'the bank cut the name short');
      eq(name('CHECKCARD 0802 TST* LANTERN FOOD YARD PILOT POINT TX 24000001'), 'Lantern Food Yard/start', 'processor prefix dropped; the town Pilot Point is not the vendor Pilot');
      eq(name('MOBILE PURCHASE 0129 MAVI CAFE SANAYI VE T ISTANBUL'), '', '"Mobile purchase" is not T- Mobile');
      eq(name('T-MOBILE*AUTO PAY 800-555-0100 WA'), 'T- Mobile/start');
      eq(name('ZEPHYR STAFFING INC. DES:DIRECT PAY ID:X0001 INDN:ABC SHOP WORLDWIDE CO ID:1234'), '', 'the company\'s own name after INDN: is not a payee');
      eq(name('WIRE TYPE:BOOK IN DATE:250108 TIME:1602 ET TRN:1 RELATED REF:GRANITE PROPERTY RENT'), 'Granite Property/inside');
      eq(name('Zelle payment to Granite Property Conf# abc123'), 'Granite Property/start', 'Zelle names the payee after "payment to"');
      eq(H.vendorIn(b, 'COSTCO WHSE #1097').name, 'Costco', 'the old call still answers with the contact');
    });
  });
  test('CL-09 deposits learn from the payer on the deposit line; generic names like Interest Earned work; money back uses the same account but waits', function () {
    return shop().then(function (f) {
      var b = f.b, plans = C.prepare(b, { accountId: f.ck, auto: true });
      var dep = byDesc(plans, /NORTHWIND/); eq(dep.kind, 'habit'); eq(dep.categoryId, acc(b, 'Services')); eq(dep.contactId, f.v['Northwind Staffing']); eq(dep.auto, true, dep.why);
      var int = byDesc(plans, /^Interest Earned/); eq(int.kind, 'habit'); eq(int.categoryId, acc(b, 'Uncategorized Income'));
      var back = byDesc(plans, /REFUND 0224 COSTCO/); eq(back.kind, 'habit'); eq(back.categoryId, acc(b, 'Office Supplies & Software')); eq(back.auto, false); ok(/money back/i.test(back.why), back.why);
      var wire = byDesc(plans, /WIRE TYPE/); eq(wire.categoryId, acc(b, 'Rent & Lease')); eq(wire.auto, false, 'a name found in the middle of the text is never sure'); ok(/middle/.test(wire.why), wire.why);
      eq(byDesc(plans, /CIRCLEK/).auto, true); eq(byDesc(plans, /MAVI CAFE/).kind, 'ask'); eq(byDesc(plans, /ZEPHYR/).kind, 'ask');
    });
  });
  test('CL-10 the Bank feed asks the same engine: one answer per line, kept until the books change', function () {
    return shop().then(function (f) {
      var b = f.b, m = C.forFeed(b, f.ck), l = b.bankLinesFor(f.ck, 'review').find(function (x) { return /CIRCLEK/.test(x.description); });
      eq(m[l.id].categoryId, acc(b, 'Meals')); eq(m[l.id].auto, true); ok(C.forFeed(b, f.ck) === m, 'kept between redraws');
      return b.postBankLine(l.id, m[l.id].d).then(function () { var m2 = C.forFeed(b, f.ck); ok(m2 !== m && !m2[l.id], 'rebuilt after a post'); clean(b); });
    });
  });
  test('CL-11 an entry far from the bank date is offered but not chosen (monthly charges of one amount); answers are kept until the books change', function () {
    var b, ck, v;
    return OB.Book.create(new OB.MemoryAdapter(), { name: 'Far Co' }).then(function (x) {
      b = x; ck = acc(b, 'Checking'); return b.saveContact({ kind: 'vendor', name: 'Orchard Apps' });
    }).then(function (c) {
      v = c.id; return b.saveTransaction({ type: 'expense', date: '2024-11-05', accountId: ck, contactId: v, lines: [{ accountId: acc(b, 'Office Supplies & Software'), amount: '0.99' }] });
    }).then(function () {
      return b.importBankLines(ck, [{ date: '2025-01-05', description: 'ORCHARD APPS BILL', amount: -99 }], { fileName: 'jan.csv' });
    }).then(function () {
      var jan = b.bankLines.find(function (l) { return l.date === '2025-01-05'; });
      eq(jan.status, 'review', 'not matched to the November entry by itself');
      var cj = b.bankCandidates(jan.id); eq(cj.length, 1); ok(!cj[0].best, 'two months away: offered only');
      ok(b.bankCandidates(jan.id) === cj, 'kept between redraws');
      return b.importBankLines(ck, [{ date: '2024-11-07', description: 'ORCHARD APPS BILL', amount: -99 }], { fileName: 'nov.csv' }).then(function () {
        var nov = b.bankLines.find(function (l) { return l.date === '2024-11-07'; }), cn = nov.status === 'review' ? b.bankCandidates(nov.id) : [];
        ok(nov.status === 'posted' || cn[0].best, 'two days away: matched');
        return nov.status === 'posted' ? null : b.postBankLine(nov.id, { kind: 'match', txnId: cn[0].txnId, splitIndex: cn[0].splitIndex });
      }).then(function () { eq(b.bankCandidates(jan.id).length, 0, 'rebuilt after the books changed: the entry is taken'); clean(b); });
    });
  });
})(typeof window !== 'undefined' ? window : global);
