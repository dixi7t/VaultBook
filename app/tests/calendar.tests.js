/* VaultBook — money and deadline calendar (1.50.0). Synthetic names only. Loaded by tests/run-node.js and tests/tests.html. */
(function (root) {
  'use strict';
  var OB = root.OB, K = OB.cal, T = OB.tests = OB.tests || [];
  function test(name, fn) { T.push({ name: name, fn: fn }); }
  function eq(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((msg || 'Expected equal') + ': expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }
  function ok(v, msg) { if (!v) throw new Error(msg || 'Expected true'); }
  function withBook(fn) { return function () { return OB.Book.create(new OB.MemoryAdapter(), { name: 'Cal Co' }).then(fn); }; }
  var pick = function (evs, kind) { return evs.filter(function (e) { return e.kind === kind; }); };

  test('CA-01 due dates move past weekends and federal holidays', function () {
    eq(K.businessDay('2026-01-31'), '2026-02-02');   // Saturday
    eq(K.businessDay('2026-10-31'), '2026-11-02');
    eq(K.businessDay('2026-03-15'), '2026-03-16');   // Sunday
    eq(K.businessDay('2027-04-15'), '2027-04-15');
    eq(K.businessDay('2028-04-16'), '2028-04-18');   // Sunday, then DC Emancipation Day observed Monday
    eq(K.businessDay('2026-07-03'), '2026-07-06');   // July 4 on Saturday is observed Friday the 3rd
  });
  test('CA-02 tax deadlines follow the company: S corporation with payroll and 1099 vendors', withBook(function (b) {
    return b.saveCompany({ taxForm: '1120S' }).then(function () { return b.saveContact({ name: 'Ace Contracting', kind: 'vendor', is1099: true }); }).then(function () {
      var ev = pick(K.events(b, { from: '2026-01-01', to: '2026-12-31', today: '2026-01-01', payroll: true }), 'tax');
      var at = function (re) { return ev.filter(function (e) { return re.test(e.title); }).map(function (e) { return e.date; }); };
      eq(at(/1120-S/), ['2026-03-16', '2026-09-15']);
      eq(at(/^Form 941/), ['2026-02-02', '2026-04-30', '2026-07-31', '2026-11-02']);
      eq(at(/1099-NEC/), ['2026-02-02']);
      eq(at(/1040-ES/), []);
    });
  }));
  test('CA-03 sole proprietor estimates and a sales tax agency filing quarterly on the 20th', withBook(function (b) {
    return b.saveSalesTax({ name: 'NJ Sales Tax', agency: 'NJ Division of Taxation', rate: '6.625' }).then(function () { return b.saveCompany({ taxForm: '1040C', calendar: { salesTax: { 'NJ Division of Taxation': { freq: 'quarterly', day: 20 } } } }); }).then(function () {
      var ev = pick(K.events(b, { from: '2026-01-01', to: '2026-12-31', today: '2026-01-01' }), 'tax');
      eq(ev.filter(function (e) { return /1040-ES/.test(e.title); }).map(function (e) { return e.date; }), ['2026-01-15', '2026-04-15', '2026-06-15', '2026-09-15']);
      eq(ev.filter(function (e) { return /NJ Division/.test(e.title); }).map(function (e) { return e.date; }), ['2026-01-20', '2026-04-20', '2026-07-20', '2026-10-20']);
    });
  }));
  test('CA-04 bills and invoices by due date; a planned pay date moves the bill; marks and cash', withBook(function (b) {
    var exp = b.accounts.find(function (a) { return a.type === 'expense'; }), inc = b.accounts.find(function (a) { return a.type === 'income'; }), bill, cu, ve;
    return Promise.all([b.saveContact({ name: 'Pine Street LLC', kind: 'vendor' }), b.saveContact({ name: 'Acme Co', kind: 'customer' })]).then(function (cs) {
      ve = cs[0]; cu = cs[1];
      return b.saveTransaction({ type: 'bill', date: '2026-03-01', dueDate: '2026-03-15', contactId: ve.id, lines: [{ accountId: exp.id, amount: '1500' }] });
    }).then(function (t) { bill = t; return b.saveTransaction({ type: 'deposit', date: '2026-02-01', accountId: b.accounts.find(function (a) { return a.name === 'Checking'; }).id, lines: [{ accountId: inc.id, amount: '1000' }] }); })
    .then(function () { return b.saveTransaction({ type: 'invoice', date: '2026-03-02', dueDate: '2026-03-20', contactId: cu.id, lines: [{ accountId: inc.id, amount: '900' }] }); }).then(function () {
      var ev = K.events(b, { from: '2026-03-01', to: '2026-03-31', today: '2026-03-01' });
      eq(pick(ev, 'bill').map(function (e) { return [e.date, e.amount, e.title]; }), [['2026-03-15', -150000, 'Pay Pine Street LLC']]);
      eq(pick(ev, 'invoice').map(function (e) { return [e.date, e.amount]; }), [['2026-03-20', 90000]]);
      return K.setPayDate(b, bill.id, '2026-03-25');
    }).then(function () {
      var ev = K.events(b, { from: '2026-03-01', to: '2026-03-31', today: '2026-03-01' }), e = pick(ev, 'bill')[0];
      eq([e.date, e.due], ['2026-03-25', '2026-03-15']);
      var f = K.forecast(b, ev, { today: '2026-03-01', to: '2026-03-31', low: 50000 });
      eq([f.days['2026-03-19'].balance, f.days['2026-03-20'].balance, f.days['2026-03-25'].balance], [100000, 190000, 40000]);
      eq(f.lowDays[0], '2026-03-25');
      var tx = pick(K.events(b, { from: '2026-01-01', to: '2026-12-31', today: '2026-01-01' }), 'tax')[0];
      return tx ? K.markDone(b, tx.key, true) : null;
    });
  }));
  test('CA-05 recurring entries and payroll pay dates are projected', withBook(function (b) {
    var chk = b.accounts.find(function (a) { return a.name === 'Checking'; }), exp = b.accounts.find(function (a) { return a.type === 'expense'; });
    var tpl = { type: 'check', accountId: chk.id, contactId: '', lines: [{ accountId: exp.id, amount: '200' }] };
    var pr = function (d) { return b.saveTransaction({ type: 'journal', date: d, number: 'PR-' + d, memo: 'Payroll', importRef: 'Paystub payroll ' + d + ' · TEST', jlines: [{ accountId: exp.id, debit: '1000' }, { accountId: chk.id, credit: '1000' }] }); };
    return b.saveRecurring({ name: 'Internet', template: tpl, frequency: 'monthly', nextDate: '2026-03-05' })
      .then(function () { return pr('2026-02-06'); }).then(function () { return pr('2026-02-20'); }).then(function () { return pr('2026-03-06'); })
      .then(function () {
        var ev = K.events(b, { from: '2026-03-01', to: '2026-04-30', today: '2026-03-07' });
        eq(pick(ev, 'recurring').map(function (e) { return [e.date, e.amount, e.due]; }), [['2026-03-05', -20000, true], ['2026-04-05', -20000, false]]);
        eq(pick(ev, 'payroll').map(function (e) { return [e.date, e.amount]; }), [['2026-03-20', -100000], ['2026-04-03', -100000], ['2026-04-17', -100000]]);
      });
  }));
  test('CA-06 to-dos repeat, can be ticked per date, and export to .ics', withBook(function (b) {
    return K.saveTodo(b, { date: '2026-03-31', title: 'Call client about receipts', repeat: 'monthly' }).then(function (td) {
      var ev = pick(K.events(b, { from: '2026-03-01', to: '2026-06-30', today: '2026-03-01' }), 'todo');
      eq(ev.map(function (e) { return e.date; }), ['2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30']);
      return K.markDone(b, ev[1].key, true).then(function () {
        var ev2 = pick(K.events(b, { from: '2026-03-01', to: '2026-06-30', today: '2026-03-01' }), 'todo');
        eq(ev2.map(function (e) { return !!e.done; }), [false, true, false, false]);
        var ics = K.ics(b, ev2);
        ok(/^BEGIN:VCALENDAR\r\n/.test(ics) && /END:VCALENDAR\r\n$/.test(ics)); eq((ics.match(/BEGIN:VEVENT/g) || []).length, 4);
        ok(/DTSTART;VALUE=DATE:20260430/.test(ics) && /SUMMARY:Cal Co: Call client about receipts/.test(ics));
        return K.deleteTodo(b, td.id);
      }).then(function () { eq(pick(K.events(b, { from: '2026-03-01', to: '2026-06-30', today: '2026-03-01' }), 'todo').length, 0); });
    });
  }));
  test('CA-07 moving many items at once: to-dos, one repeat, a bill, an invoice, the next recurring entry; deadlines stay; undo', withBook(function (b) {
    var exp = b.accounts.find(function (a) { return a.type === 'expense'; }), inc = b.accounts.find(function (a) { return a.type === 'income'; }), chk = b.accounts.find(function (a) { return a.name === 'Checking'; }), r = {};
    var rng = { from: '2026-03-01', to: '2026-04-30', today: '2026-03-01' };
    return Promise.all([b.saveContact({ name: 'Pine Street LLC', kind: 'vendor' }), b.saveContact({ name: 'Acme Co', kind: 'customer' }), b.saveCompany({ taxForm: '1120S' })]).then(function (cs) {
      return Promise.all([b.saveTransaction({ type: 'bill', date: '2026-03-01', dueDate: '2026-03-10', contactId: cs[0].id, lines: [{ accountId: exp.id, amount: '100' }] }),
        b.saveTransaction({ type: 'invoice', date: '2026-03-01', dueDate: '2026-03-12', contactId: cs[1].id, lines: [{ accountId: inc.id, amount: '50' }] }),
        b.saveRecurring({ name: 'Rent', template: { type: 'check', accountId: chk.id, lines: [{ accountId: exp.id, amount: '10' }] }, frequency: 'monthly', nextDate: '2026-03-05' })]);
    }).then(function () { return K.saveTodo(b, { date: '2026-03-03', title: 'Call bank', time: '9:30', dur: 30, remind: 10 }); })
      .then(function (t) { r.one = t; return K.saveTodo(b, { date: '2026-03-02', title: 'Weekly review', repeat: 'weekly' }); })
      .then(function (t) {
        r.wk = t; var ev = K.events(b, rng), key = function (re) { return ev.find(function (e) { return re.test(e.key) || re.test(e.title); }).key; };
        eq(ev.find(function (e) { return e.title === 'Call bank'; }).time, '09:30');
        r.moves = [{ key: key(/Call bank/), date: '2026-03-04', time: '14:00', dur: 90 }, { key: 'todo|' + t.id + '|2026-03-09', date: '2026-03-11' }, { key: key(/^bill\|/), date: '2026-03-20' },
          { key: key(/^inv\|/), date: '2026-03-25' }, { key: key(/^rec\|.*2026-03-05$/), date: '2026-03-06' }, { key: key(/1120-S/), date: '2026-03-30' }];
        return K.move(b, r.moves, ev);
      }).then(function (tok) {
        r.tok = tok; eq(tok.skipped.length, 1, 'the deadline stays');
        var ev = K.events(b, rng), f = function (re) { return ev.filter(function (e) { return re.test(e.title); }).map(function (e) { return [e.date, e.time || '', e.dur]; }); };
        eq(f(/Call bank/), [['2026-03-04', '14:00', 90]]);
        eq(f(/Weekly review/).map(function (x) { return x[0]; }).slice(0, 4), ['2026-03-02', '2026-03-11', '2026-03-16', '2026-03-23']);
        eq(f(/^Pay /)[0][0], '2026-03-20'); eq(f(/pays invoice/)[0][0], '2026-03-25');
        eq(b.recurring[0].nextDate, '2026-03-06'); eq(f(/^Rent$/).map(function (x) { return x[0]; }), ['2026-03-06', '2026-04-06']);
        eq(f(/1120-S/)[0][0], '2026-03-16');
        return K.undo(b, tok);
      }).then(function () {
        var ev = K.events(b, rng);
        eq(ev.find(function (e) { return e.title === 'Call bank'; }).date, '2026-03-03'); eq(b.recurring[0].nextDate, '2026-03-05');
        eq(ev.filter(function (e) { return /Weekly/.test(e.title); })[1].date, '2026-03-09'); eq(ev.find(function (e) { return /^Pay /.test(e.title); }).date, '2026-03-10');
      });
  }));
  test('CA-08 delete one repeat or the whole to-do, tick many, and to-do reminders come due', withBook(function (b) {
    var rng = { from: '2026-03-01', to: '2026-03-31', today: '2026-03-01' };
    return K.saveTodo(b, { date: '2026-03-02', title: 'Standup', time: '10:00', repeat: 'daily', remind: 15 }).then(function (t) {
      var ev = K.events(b, rng).filter(function (e) { return e.kind === 'todo'; }); eq(ev.length, 30);
      var due = K.dueReminders(ev, new Date(2026, 2, 2, 9, 40), new Date(2026, 2, 2, 9, 46)); eq(due.map(function (e) { return e.date; }), ['2026-03-02']);
      eq(K.dueReminders(ev, new Date(2026, 2, 2, 9, 46), new Date(2026, 2, 2, 9, 50)).length, 0);
      return K.removeMany(b, [ev[1].key], false).then(function () { return K.markMany(b, [ev[2].key, ev[3].key], true); }).then(function () {
        var e2 = K.events(b, rng).filter(function (e) { return e.kind === 'todo'; });
        eq(e2.length, 29); eq(e2[0].date, '2026-03-02'); eq(e2[1].date, '2026-03-04'); ok(e2[1].done && e2[2].done && !e2[3].done);
        return K.removeMany(b, [e2[0].key], true);
      }).then(function () { eq(K.events(b, rng).filter(function (e) { return e.kind === 'todo'; }).length, 0); });
    });
  }));
  test('CA-09 the Cash Flow Forecast report and the Calendar balance agree', withBook(function (b) {
    var exp = b.accounts.find(function (a) { return a.type === 'expense'; }), inc = b.accounts.find(function (a) { return a.type === 'income'; }), chk = b.accounts.find(function (a) { return a.name === 'Checking'; });
    return Promise.all([b.saveContact({ name: 'Pine Street LLC', kind: 'vendor' }), b.saveContact({ name: 'Acme Co', kind: 'customer' })]).then(function (cs) {
      return Promise.all([b.saveTransaction({ type: 'deposit', date: '2026-02-01', accountId: chk.id, lines: [{ accountId: inc.id, amount: '5000' }] }),
        b.saveTransaction({ type: 'bill', date: '2026-02-20', dueDate: '2026-02-25', contactId: cs[0].id, lines: [{ accountId: exp.id, amount: '700' }] }),
        b.saveTransaction({ type: 'invoice', date: '2026-03-01', dueDate: '2026-03-18', contactId: cs[1].id, lines: [{ accountId: inc.id, amount: '900' }] }),
        b.saveRecurring({ name: 'Rent', template: { type: 'check', accountId: chk.id, lines: [{ accountId: exp.id, amount: '1200' }] }, frequency: 'monthly', nextDate: '2026-03-10' })]);
    }).then(function () {
      var R = OB.reports, f = R.cashForecast(b, { asOf: '2026-03-02', weeks: 6 }), last = f.weeks[5].to;
      var cal = K.forecast(b, K.events(b, { from: '2016-01-01', to: last, today: '2026-03-02' }), { today: '2026-03-02', to: last });
      eq(f.end, cal.days[last].balance); eq(f.end, 500000 - 70000 + 90000 - 120000 - 120000);
    });
  }));
})(typeof window !== 'undefined' ? window : global);
