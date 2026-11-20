/* VaultBook Intelligence: questions in plain words -> exact answers from the books (node + browser). */
(function (root) {
  'use strict';
  var OB = root.OB, I = OB.intel, U = OB.util, T = OB.tests = OB.tests || [];
  function test(name, fn) { T.push({ name: name, fn: fn }); }
  function eq(a, b, msg) { if (a !== b) throw new Error((msg || 'Expected equal') + ': expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }
  function ok(c, msg) { if (!c) throw new Error(msg || 'Expected true'); }
  var DAY = '2026-11-16';
  function book() { return OB.Book.create(new OB.MemoryAdapter(), { name: 'Intel Co' }).then(function (b) { return OB.sample.populate(b, DAY).then(function () { return b; }); }); }
  var cell = function (c) { return c && typeof c === 'object' ? c.v : c; };

  test('VI-01 words become slots: what, which ones, how to show it', function () {
    var s = I.extract('How many invoices are open which have been open for more than 90 days?');
    eq(s.subject, 'invoices'); eq(s.shape, 'count'); eq(s.minDays, 90); ok(s.open); eq(s.name, '');
    s = I.extract('give me percentage of income for each month'); eq(s.subject, 'income'); eq(s.shape, 'bymonth'); ok(s.percent);
    s = I.extract('how many vendors are there?'); eq(s.subject, 'vendors'); eq(s.shape, 'count');
    s = I.extract('top 5 expenses last year'); eq(s.subject, 'expenses'); eq(s.top, 5); eq(s.period.key, 'lastYear');
    s = I.extract('why is profit down compared with last year'); eq(s.subject, 'profit'); eq(s.shape, 'why');
    eq(I.extract('sales in March 2026').period.month, 3); eq(I.extract('expenses last 30 days').period.n, 30);
    eq(I.extract('Harbor Dental Group').name, 'harbor dental group');
  });

  test('VI-02 counts and open documents equal the aging report; the 90-day filter counts from the due date unless told otherwise', function () {
    return book().then(function (b) {
      var ag = OB.reports.aging(b, { kind: 'customer', asOf: DAY }), docs = [];
      ag.rows.forEach(function (r) { r.docs.forEach(function (d) { if (d.t.type === 'invoice' && d.open > 0) docs.push(d); }); });
      var a = I.ask(b, 'how many open invoices are there?', {}, DAY);
      ok(a.text.indexOf(docs.length + ' open invoice') === 0, a.text); ok(a.text.indexOf(U.fmt(U.sum(docs, function (d) { return d.open; }), { symbol: true })) > 0, 'total equals the report: ' + a.text);
      var late = docs.filter(function (d) { return d.daysPastDue > 30; });
      var a2 = I.ask(b, 'how many invoices are open more than 30 days', {}, DAY);
      ok(/past due/.test(a2.understood) && (late.length ? a2.text.indexOf(String(late.length)) === 0 : /no open invoices/.test(a2.text)), a2.text + ' | ' + a2.understood);
      var a3 = I.ask(b, 'invoices open more than 30 days since invoice date', {}, DAY); ok(/since the invoice date/.test(a3.understood), a3.understood);
      var cu = b.contacts.filter(function (c) { return c.kind === 'customer'; }), ve = b.contacts.filter(function (c) { return c.kind === 'vendor'; });
      ok(I.ask(b, 'how many customers are there', {}, DAY).text.indexOf(cu.length + ' customer') === 0); ok(I.ask(b, 'How many vendors are there ?', {}, DAY).text.indexOf(ve.length + ' vendor') === 0);
      var ne = I.ask(b, 'how many vendors have no email', {}, DAY); ok(ne.text.indexOf(ve.filter(function (c) { return !c.email; }).length + ' vendor') === 0, ne.text);
    });
  });

  test('VI-03 income by month with each month\'s share ties to the Profit and Loss; top expenses and the comparison are exact', function () {
    return book().then(function (b) {
      var a = I.ask(b, 'give me percentage of income for each month', {}, DAY), st = OB.reports.statement(b, { kind: 'pl', from: '2026-01-01', to: DAY, basis: 'accrual', columns: 'month' });
      var n = st.cols.length - 1, tot = st.sections.income.cells[n] + (st.sections.oi && st.sections.oi.cells ? st.sections.oi.cells[n] : 0);
      eq(a.table.rows.length, n + 1); eq(a.table.rows[n][1], U.fmt(tot, { symbol: true }), 'total row equals the report'); eq(a.table.rows[n][2], '100.0%');
      var sum = 0; a.table.rows.slice(0, n).forEach(function (r) { sum += parseFloat(r[2]) || 0; }); ok(Math.abs(sum - 100) < 0.6, 'shares add to 100: ' + sum);
      ok(/share of the total/.test(a.understood));
      var t = I.ask(b, 'top 3 expenses this year', {}, DAY); eq(t.table.rows.length, 3); ok(parseFloat(String(t.table.rows[0][1]).replace(/[$,]/g, '')) >= parseFloat(String(t.table.rows[1][1]).replace(/[$,]/g, '')), 'sorted high to low');
      var w = I.ask(b, 'why is profit different from last year?', {}, DAY), cur = OB.reports.statement(b, { kind: 'pl', from: '2026-01-01', to: DAY, basis: 'accrual' });
      var net = cur.tree.filter(function (x) { return x.kind === 'net' && x.section === 'net'; })[0].cells[0];
      ok(w.text.indexOf('Net income is ' + U.fmt(net, { symbol: true })) === 0, w.text); ok(/Income is (up|down)/.test(w.text) && /expenses are (up|down)/.test(w.text));
      var p = I.ask(b, 'profit this year', {}, DAY); ok(p.text.indexOf(U.fmt(net, { symbol: true })) > 0 && /margin/.test(p.text), p.text);
    });
  });

  test('VI-04 a name (even with a typing slip) opens its record; follow-ups keep the subject; unknown questions say so', function () {
    return book().then(function (b) {
      var c = b.contacts.find(function (x) { return x.name === 'Harbor Dental Group'; });
      var a = I.ask(b, 'Harbor Dental', {}, DAY); eq(a.intent.contactId, c.id); eq(a.ctx.contactId, c.id); ok(/Harbor Dental Group is an active customer/.test(a.text), a.text);
      eq(I.ask(b, 'harbor dentel group', {}, DAY).intent.contactId, c.id, 'one typing slip is forgiven');
      var f = I.ask(b, 'open invoices', a.ctx, DAY); eq(f.intent.contactId, c.id, 'the follow-up is about the same customer'); ok(/for Harbor Dental Group/.test(f.understood));
      var all = I.ask(b, 'all open invoices', a.ctx, DAY); ok(!all.intent.contactId, '"all" drops the customer');
      var e1 = I.ask(b, 'expenses this year', {}, DAY), e2 = I.ask(b, 'and last year?', { last: e1.intent }, DAY); eq(e2.intent.subject, 'expenses'); ok(/last year/.test(e2.text), e2.text);
      var bank = b.accounts.find(function (x) { return x.name === 'Checking'; }), ba = I.ask(b, 'balance of checking', {}, DAY); eq(ba.intent.accountId, bank.id); ok(ba.text.indexOf(U.fmt(b.accountBalance(bank.id, DAY), { symbol: true })) > 0, ba.text);
      var x = I.ask(b, 'zzqq wobble', {}, DAY); ok(x.notUnderstood && /could not find/.test(x.text), 'never invents an answer');
      ok(I.ask(b, '', {}, DAY).notUnderstood);
    });
  });

  test('VI-05 a language model may only fill the slots: its output is checked against the schema and never supplies figures', function () {
    return book().then(function (b) {
      var s = I.fromModel('{"subject":"expenses","shape":"top","top":3,"period":"thisYear","name":"","answer":"$1"}', 'what are we burning the most money on?');
      eq(s.subject, 'expenses'); eq(s.top, 3); ok(!('answer' in s), 'extra fields are dropped');
      var a = I.run(b, I.resolve(b, s, {}, DAY), DAY), direct = I.ask(b, 'top 3 expenses this year', {}, DAY);
      eq(JSON.stringify(a.table.rows.map(function (r) { return r.map(cell); })), JSON.stringify(direct.table.rows.map(function (r) { return r.map(cell); })), 'same figures as the built-in reading');
      eq(I.fromModel('{"subject":"weather","shape":"total"}', 'x'), null); eq(I.fromModel('{"subject":"unknown","shape":"total"}', 'x'), null);
      eq(I.fromModel({ subject: 'invoices', shape: 'count', minDays: 90 }, 'x').minDays, 90);
    });
  });
})(typeof window !== 'undefined' ? window : globalThis);
