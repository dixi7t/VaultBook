/* VaultBook — paystubs → payroll journal entry (1.33) tests. Synthetic stubs only (made-up names), shaped like the OCR rows the
 * statement engine returns for a scanned "EARNINGS / TAXES / MISCELLANEOUS DEDUCTIONS" stub printed twice per page. Loaded after
 * qbfull.tests.js; shares OB.tests. */
(function (root) {
  'use strict';
  var OB = root.OB, U = OB.util, T = OB.tests;
  function test(name, fn) { T.push({ name: name, fn: fn }); }
  function eq(a, b, msg) { if (a !== b) throw new Error((msg || 'Expected equal') + ': expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }
  function ok(v, msg) { if (!v) throw new Error(msg || 'Assertion failed'); }

  // Column x positions (image pixels at 216 dpi): labels, then CURRENT / YTD per section
  var X = { lab1: 80, cur1: 450, ytd1: 640, lab2: 800, cur2: 1040, ytd2: 1220, lab3: 1380, cur3: 1610, ytd3: 1790, name: 620, num: 1050, date: 1760 };
  function row(page, y, cells) { return { page: page, y: y, items: cells.map(function (c) { return { text: c[1], x: c[0], y: y, width: c[1].length * 18 }; }), text: cells.map(function (c) { return c[1]; }).join(' ') }; }
  // One copy of a stub. v: { name, date, period, earn: [[label, cur, ytd]], tax: [...], ded: [...], tot: [ec, ey, tc, ty, dc, dy], net: [c, y] }
  function copy(page, top, v) {
    var r = [], y = top;
    r.push(row(page, y, [[60, 'CHECK'], [130, 'NO.'], [300, 'SOCIAL'], [430, 'SECURITY NO.'], [620, 'EMPLOYEE'], [760, 'NAME'], [1050, 'NUMBER'], [1380, 'STATUS'], [1500, 'DEPT/CLASS'], [1760, 'DATE']])); y -= 40;
    r.push(row(page, y, [[300, 'ep:'], [X.name, v.name.split(' ')[0]], [X.name + 120, v.name.split(' ')[1]], [1160, 'Salaried'], [1370, '|s'], [X.date, v.date]])); y -= 26;
    r.push(row(page, y, [[330, 'EARNINGS'], [940, 'TAXES'], [1500, 'MISCELLANEOUS'], [1700, 'DEDUCTIONS']])); y -= 36;
    r.push(row(page, y, [[X.lab1, 'TYPE'], [210, '$/hr'], [300, 'hrs'], [X.cur1, 'CURRENT'], [X.ytd1, 'YTD'], [X.lab2, 'TYPE'], [X.cur2, 'CURRENT'], [X.ytd2, 'YTD'], [X.lab3, 'TYPE'], [X.cur3, 'CURRENT'], [X.ytd3, 'YTD']])); y -= 38;
    var n = Math.max(v.earn.length, v.tax.length, v.ded.length);
    for (var i = 0; i < n; i++) {
      var cells = [], e = v.earn[i], t = v.tax[i], d = v.ded[i];
      if (e) { cells.push([X.lab1, e[0]]); if (e[1]) cells.push([X.cur1, e[1]]); if (e[2]) cells.push([X.ytd1, e[2]]); }
      if (t) { cells.push([X.lab2, t[0]]); if (t[1]) cells.push([X.cur2, t[1]]); if (t[2]) cells.push([X.ytd2, t[2]]); }
      if (d) { cells.push([X.lab3, d[0]]); if (d[1]) cells.push([X.cur3, d[1]]); if (d[2]) cells.push([X.ytd3, d[2]]); }
      r.push(row(page, y, cells)); y -= 24;
    }
    y -= 260;
    r.push(row(page, y, [[X.lab1, 'TOTALS'], [X.cur1, v.tot[0]], [X.ytd1, v.tot[1]], [X.cur2, v.tot[2]], [X.ytd2, v.tot[3]], [X.cur3, v.tot[4]], [X.ytd3, v.tot[5]]])); y -= 38;
    r.push(row(page, y, [[X.lab1, 'NETPAY'], [X.cur1, v.net[0]], [X.ytd1, v.net[1]], [X.lab2, 'Period'], [X.lab2 + 130, v.period]]));
    return r;
  }
  // a page like the client's: a clean top copy, the check, and a poorer bottom copy (cells lost, separators misread)
  function page(p, top, bottom, check) {
    return copy(p, 2200, top).concat([row(p, 1336, [[1300, check[0]], [1560, check[1]]]), row(p, 1206, [[200, 'Forty-Four Thousand Dollars & 50 Cents']])]).concat(copy(p, 694, bottom));
  }
  var ALEX_MAY = { name: 'ALEX MORGAN', date: '05/31/2026', period: '05/01/26-05/31/26',
    earn: [['Gross Wages', '75000 !00', '375000:00]'], ['Total Wages', '75000 !00', '375000!00|']],
    tax: [['MCWH', '1762:50', '7012 50'], ['SSWH', '0:00', '1143900'], ['FITW', '2625000', '131250 /00'], ['sITW', '2850 00', '14250 !00']], ded: [],
    tot: ['75000 !00', '375000 !00', '30862! 50', '16395150', '0/00', '0/00'], net: ['44137 50', '211048:50|'] };
  var ALEX_MAY_POOR = { name: 'ALEX MORGAN', date: '05/31/2026', period: '05/01/26-05/31/26',
    earn: [['Gross Wages', '75000 !00', '375000!00|'], ['Total Wages', '75000 :00', '375000:00]']],
    tax: [['MCWH', '', '7012/50'], ['SSWH', '', '11439:00'], ['FITW', '', '131250 /00'], ['SITW', '', '']], ded: [],
    tot: ['75000 00', '375000 !00', '3086250', '163951 /50', '0/00', '0/00'], net: ['44137:50', '211048:50]'] };
  var JORDAN_MAY = { name: 'JORDAN LEE', date: '05/31/2026', period: '05/01/26-05/31/26',
    earn: [['Gross Wages', '75000 :00', '375000:00]'], ['Total Wages', '75000 |00', '375000/00]']],
    tax: [['MCWH', '1762: 50', '7012150'], ['SSWH', '0/00', '1143900'], ['FITW', '26250/00', '131250 /00'], ['SITw', '187500', "9375 '00"]], ded: [],
    tot: ['75000 !00', '375000 00', '29887! 50', "159076 '50", '0/00', '0/00'], net: ['45112 50', '215923:50|'] };
  function mayRows() { return page(1, ALEX_MAY, ALEX_MAY_POOR, ['05/31/2026', '$******44,137.50']).concat(page(2, JORDAN_MAY, JORDAN_MAY, ['05/31/2026', '$******45,112.50'])); }

  test('PS-01 amounts read the way OCR prints them: separators misread, cents run on, a separator read as 1', function () {
    var P = OB.paystub, c = function (s) { return P.amountCandidates(s); };
    eq(c('75000 !00')[0], 7500000); eq(c('375000:00]')[0], 37500000); eq(c('0/00')[0], 0); eq(c('44,137.50')[0], 4413750); eq(c('$******44,137.50')[0], 4413750);
    eq(c('2625000')[0], 2625000, 'cents run on: 26250.00'); eq(c("9375 '00")[0], 937500); eq(c('1762: 50')[0], 176250);
    var k = c('7012150'); eq(k[0], 7012150); ok(k.indexOf(701250) > 0, 'a separator read as "1" is the second reading: 7012.50');
    eq(c('H').length, 0, 'not a number'); eq(c('1,234.56')[0], 123456); eq(c('(12.00)')[0], 1200);
  });

  test('PS-02 parse: one stub per employee and pay date from two copies per page, columns by position, totals and net prove every figure', function () {
    var P = OB.paystub, r = P.parse(mayRows());
    eq(r.stubs.length, 2, 'two employees, each printed twice');
    var a = r.stubs[0]; eq(a.employee, 'Alex Morgan'); eq(a.payDate, '2026-05-31'); eq(a.periodFrom, '2026-05-01'); eq(a.periodTo, '2026-05-31'); eq(a.frequency, 'monthly'); eq(a.copies, 2);
    var by = {}; a.lines.forEach(function (l) { by[l.category] = l; });
    eq(by.wages.current, 7500000); eq(by.wages.ytd, 37500000); eq(by.ee_medicare.current, 176250); eq(by.ee_medicare.ytd, 701250, 'YTD 7012.50 chosen because the column then adds to TOTALS');
    eq(by.ee_ss.current, 0); eq(by.fed.current, 2625000); eq(by.state.current, 285000);
    eq(a.lines.filter(function (l) { return l.subtotal; }).length, 1, 'Total Wages is a subtotal, not wages twice');
    eq(a.totals.gross, 7500000); eq(a.totals.taxes, 3086250); eq(a.totals.deductions, 0); eq(a.totals.net, 4413750); eq(a.checkAmount, 4413750);
    eq(a.issues.length, 0, a.issues.join(' | '));
    var j = r.stubs[1]; eq(j.employee, 'Jordan Lee'); eq(j.lines.find(function (l) { return l.category === 'state'; }).current, 187500); eq(j.totals.net, 4511250); eq(j.issues.length, 0, j.issues.join(' | '));
  });

  test('PS-03 a figure lost in every copy is worked out from the total and flagged; a wrong net is an issue', function () {
    var P = OB.paystub;
    var bad = JSON.parse(JSON.stringify(ALEX_MAY)); bad.tax[2][1] = ''; // FITW current lost
    var r = P.parse(page(1, bad, ALEX_MAY_POOR, ['05/31/2026', '$******44,137.50']));
    var f = r.stubs[0].lines.find(function (l) { return l.category === 'fed'; });
    eq(f.current, 2625000, 'worked out from TOTALS'); ok(f.inferred, 'flagged as worked out'); eq(r.stubs[0].issues.length, 0);
    var s = r.stubs[0]; s.lines.find(function (l) { return l.category === 'state'; }).current = 290000;   // a user edit that no longer ties
    var iss = P.check(s); ok(iss.some(function (x) { return /taxes/i.test(x); }) && iss.some(function (x) { return /net/i.test(x); }), iss.join(' | '));
  });

  test('PS-04 labels: standard codes by section, learned labels win, unknown labels are asked for; frequency from the period', function () {
    var P = OB.paystub;
    eq(P.classify('MCWH', 'tax'), 'ee_medicare'); eq(P.classify('OASDI', 'tax'), 'ee_ss'); eq(P.classify('Fed Income Tax', 'tax'), 'fed'); eq(P.classify('AZ SIT', 'tax'), 'state');
    eq(P.classify('CA SDI', 'tax'), 'otherTax'); eq(P.classify('Medical', 'ded'), 'benefits', 'medical insurance is a deduction, not Medicare'); eq(P.classify('401K', 'ded'), 'retirement');
    eq(P.classify('Overtime', 'earn'), 'wages'); eq(P.classify('XYZ CODE', 'tax'), null, 'unknown'); eq(P.classify('XYZ CODE', 'tax', { 'XYZ CODE': 'local' }), 'local');
    eq(P.frequency('2026-05-01', '2026-05-31'), 'monthly'); eq(P.frequency('2026-05-04', '2026-05-10'), 'weekly'); eq(P.frequency('2026-05-04', '2026-05-17'), 'bi-weekly');
    eq(P.frequency('2026-05-01', '2026-05-15'), 'semi-monthly'); eq(P.frequency('2026-05-16', '2026-05-31'), 'semi-monthly'); eq(P.frequency('2026-04-01', '2026-06-30'), 'quarterly');
  });

  function bookWithAccounts() { return OB.Book.create(new OB.MemoryAdapter(), { name: 'Pay Co' }); }   // default chart: 6650 Payroll Expenses, 2300 Payroll Liabilities
  test('PS-05 settings: accounts guessed from the chart, employer taxes (FICA match, 1.45% Medicare, FUTA/SUTA on wages up to the base)', function () {
    return bookWithAccounts().then(function (b) {
      var P = OB.paystub, st = P.settings(b), acc = function (n) { return b.accounts.find(function (a) { return a.number === n; }).id; };
      eq(st.accounts.wages, acc('6650')); eq(st.accounts.fed, acc('2300')); eq(st.accounts.net, acc('2300')); eq(st.accounts.taxExpense, acc('6650'));
      var stub = P.parse(mayRows()).stubs[0];
      var er = P.employer(stub, st); eq(er.er_ss, 0, 'no employee SS (wage base reached): no match'); eq(er.er_medicare, 108750, '1.45% only (no additional 0.9%)'); eq(er.futa, 0, 'past the $7,000 base'); eq(er.suta, 0);
      var first = JSON.parse(JSON.stringify(stub)); first.lines.forEach(function (l) { if (l.category === 'wages') l.ytd = 300000; if (l.category === 'ee_ss') l.current = 18600; });
      first.totals.gross = 300000; first.totals.grossYtd = 300000;
      first.lines.find(function (l) { return l.category === 'wages' && !l.subtotal; }).current = 300000;
      var st2 = JSON.parse(JSON.stringify(st)); st2.employer.suta = { rate: '2.0', base: '8000' };
      var e2 = P.employer(first, st2); eq(e2.er_ss, 18600); eq(e2.futa, 1800, '0.6% of 3,000'); eq(e2.suta, 6000, '2.0% of 3,000');
    });
  });

  test('PS-06 journal per pay date: wages and employer taxes debited, withholding/Medicare/net credited per employee, balanced; posted once; summary mode', function () {
    var b;
    return bookWithAccounts().then(function (x) {
      b = x; var P = OB.paystub, st = P.settings(b), stubs = P.parse(mayRows()).stubs;
      var j = P.journal(b, stubs, st);
      eq(j.errors.length, 0, j.errors.join(' | ')); eq(j.draft.type, 'journal'); eq(j.draft.date, '2026-05-31'); eq(j.draft.number, 'PR-2026-05-31');
      ok(/monthly/.test(j.draft.memo) && /2 employees/.test(j.draft.memo), j.draft.memo);
      var dr = U.sum(j.draft.jlines, function (l) { return l.debit || 0; }), cr = U.sum(j.draft.jlines, function (l) { return l.credit || 0; });
      eq(dr, cr, 'balanced'); eq(dr, 2 * (7500000 + 108750));
      var line = function (memo) { return j.draft.jlines.find(function (l) { return l.memo === memo; }); };
      eq(line('Alex Morgan - Gross wages').debit, 7500000); eq(line('Alex Morgan - Employer Medicare').debit, 108750);
      eq(line('Alex Morgan - Federal income tax withheld').credit, 2625000); eq(line('Alex Morgan - Medicare withheld').credit, 176250); eq(line('Alex Morgan - Employer Medicare payable').credit, 108750);
      eq(line('Jordan Lee - State income tax withheld').credit, 187500); eq(line('Jordan Lee - Net pay').credit, 4511250);
      ok(!line('Alex Morgan - Social Security withheld'), 'zero lines are left out');
      var sum = P.journal(b, stubs, Object.assign({}, st, { detail: 'summary' }));
      eq(sum.draft.jlines.find(function (l) { return /^Gross wages/.test(l.memo); }).debit, 15000000); ok(sum.draft.jlines.length < j.draft.jlines.length);
      return b.saveTransaction(j.draft).then(function () {
        var again = P.journal(b, stubs, st); ok(again.errors.some(function (e) { return /already/i.test(e); }), 'posted once: ' + again.errors.join(' | '));
        eq(P.posted(b)['2026-05-31'].length, 1);
      });
    });
  });

  test('PS-07 a stub that does not tie blocks its journal; learn accounts from an earlier payroll entry; a YTD gap in the books is reported', function () {
    var b;
    return bookWithAccounts().then(function (x) {
      b = x; var P = OB.paystub;
      return Promise.all([b.saveAccount({ type: 'ocl', name: 'Federal Withholding', parentId: b.accounts.find(function (a) { return a.number === '2300'; }).id }),
        b.saveAccount({ type: 'ocl', name: 'Medicare Payable', parentId: b.accounts.find(function (a) { return a.number === '2300'; }).id })]);
    }).then(function (accs) {
      var P = OB.paystub, fed = accs[0], med = accs[1], wages = b.accounts.find(function (a) { return a.number === '6650'; }), liab = b.accounts.find(function (a) { return a.number === '2300'; }), bank = b.accounts.find(function (a) { return a.type === 'bank'; });
      return b.saveTransaction({ type: 'journal', date: '2026-03-31', number: 'PR-MAR', memo: 'Payroll March', jlines: [
        { accountId: wages.id, debit: '150000', memo: 'Gross wages' }, { accountId: fed.id, credit: '52500', memo: 'Federal withholding' }, { accountId: med.id, credit: '3525', memo: 'Medicare' },
        { accountId: liab.id, credit: '5700', memo: 'State withholding' }, { accountId: bank.id, credit: '88275', memo: 'Net pay' }] }).then(function (je) {
        var L = P.learnFromJournal(b, je);
        eq(L.accounts.wages, wages.id); eq(L.accounts.fed, fed.id); eq(L.accounts.medicare, med.id); eq(L.accounts.state, liab.id); eq(L.accounts.net, bank.id);
        var st = P.settings(b); Object.assign(st.accounts, L.accounts);
        var stubs = P.parse(mayRows()).stubs;
        var gap = P.ytdGap(b, stubs, st);
        eq(gap.priorStub, 60000000, 'paystubs: 2 x 300,000 paid before May'); eq(gap.priorBooks, 15000000, 'books: only March'); ok(gap.missing > 0 && /4 months|months/.test(gap.message), gap.message);
        stubs[0].lines.find(function (l) { return l.category === 'fed'; }).current = 2600000; stubs[0].issues = P.check(stubs[0]);
        var j = P.journal(b, stubs, st); ok(j.errors.some(function (e) { return /Alex Morgan/.test(e); }), j.errors.join(' | '));
        return b.savePayroll(st).then(function () { eq(P.settings(b).accounts.fed, fed.id, 'saved on the company'); });
      });
    });
  });
  test('PS-08 a scrap of letters between the lines and TOTALS is not a line; a short YTD amount stays in its column', function () {
    var P = OB.paystub, rows = mayRows(), k = rows.findIndex(function (r) { return /^TOTALS/.test(r.text); });
    rows.splice(k, 0, row(1, rows[k].y + 23, [[X.lab2 + 10, 'ee']]));
    var a = P.parse(rows).stubs[0]; eq(a.lines.filter(function (l) { return l.label === 'ee'; }).length, 0); eq(a.issues.length, 0, a.issues.join(' | '));
    var j = JSON.parse(JSON.stringify(JORDAN_MAY)); j.ded = [['401K', '0.00', '0.00']]; j.tax[0][2] = '761.25';
    var r = row(2, 2000, [[X.lab1, 'TYPE'], [X.cur1, 'CURRENT'], [X.ytd1, 'YTD'], [X.lab2, 'TYPE'], [X.cur2, 'CURRENT'], [X.ytd2, 'YTD'], [X.lab3, 'TYPE'], [X.cur3, 'CURRENT'], [X.ytd3, 'YTD']]);
    var line = row(2, 1960, [[X.lab2, 'MCWH'], [X.cur2, '36.25'], [X.ytd2 + 60, '761.25'], [X.lab3, '401K'], [X.cur3, '0.00'], [X.ytd3, '0.00']]);
    var got = P.parse([r, line, row(2, 1700, [[X.lab1, 'TOTALS']]), row(2, 1660, [[X.lab1, 'NET PAY']])]);
    var m = got.stubs[0] && got.stubs[0].lines.find(function (l) { return l.category === 'ee_medicare'; });
    ok(m && m.ytd === 76125, 'MCWH YTD 761.25 kept in the TAXES column'); ok(got.stubs[0].lines.some(function (l) { return l.label === '401K'; }), '401K label clean');
  });
  test('PS-09 YTD headings not read: tax labels still found; single-letter scraps (column rules) dropped from labels', function () {
    var P = OB.paystub;
    var h = row(1, 2000, [[X.lab1, 'TPE'], [X.cur1, 'CURRENT'], [X.cur2, 'CURRENT'], [X.cur3, 'CURRENT']]);
    var l1 = row(1, 1960, [[X.lab1, 'Gross'], [X.lab1 + 80, 'Wages'], [X.cur1, '15000.00'], [X.ytd1, '555000.00'], [X.lab2, 'MCWH'], [X.cur2, '352.50'], [X.ytd2, '11242.50']]);
    var l2 = row(1, 1930, [[X.ytd1 + 20, 'i'], [X.lab2, 'FITW'], [X.cur2, '5250.00'], [X.ytd2, '194250.00']]);
    var st = P.parse([h, l1, l2, row(1, 1700, [[X.lab1, 'TOTALS']]), row(1, 1660, [[X.lab1, 'NET PAY'], [X.cur1, '9397.50']])]).stubs[0];
    var by = {}; st.lines.forEach(function (l) { by[l.label] = l; });
    eq(by.MCWH && by.MCWH.category, 'ee_medicare'); eq(by.FITW && by.FITW.category, 'fed', 'label "FITW", not "i FITW"'); eq(by.FITW.current, 525000);
  });
  test('PS-10 QuickBooks .iif from a paystub journal with account names: balanced TRNS/SPL, accounts created parents first', function () {
    var P = OB.paystub, stub = P.parse(mayRows()).stubs[0];
    var names = { wages: 'Payroll Expenses:Wages', taxExpense: 'Payroll Expenses:Taxes', fed: 'Payroll Liabilities:Federal', ss: 'Payroll Liabilities:FICA', medicare: 'Payroll Liabilities:FICA',
      state: 'Payroll Liabilities:State', local: 'Payroll Liabilities', otherTax: 'Payroll Liabilities', retirement: 'Payroll Liabilities', benefits: 'Payroll Liabilities', garnish: 'Payroll Liabilities', otherDed: 'Payroll Liabilities',
      futa: 'Payroll Liabilities:FUTA', suta: 'Payroll Liabilities:SUTA', net: 'Checking' };
    var byId = {}; Object.keys(names).forEach(function (k) { byId[names[k]] = { id: names[k], name: names[k] }; });
    var book = { accounts: [], accById: byId, posted: function () { return []; } };
    var j = P.journal(book, [stub], Object.assign({}, P.DEFAULTS, { accounts: names }));
    eq(j.errors.length, 0, j.errors.join(' | '));
    var types = {}; Object.keys(names).forEach(function (k) { types[names[k]] = k === 'net' ? 'BANK' : /^(wages|taxExpense)$/.test(k) ? 'EXP' : 'OCLIAB'; });
    var iif = P.toIIF([j.draft], { create: true, types: types }), rows = iif.split('\r\n').filter(Boolean).map(function (r) { return r.split('\t'); });
    var acc = rows.filter(function (r) { return r[0] === 'ACCNT'; }).map(function (r) { return r[1] + '/' + r[2]; });
    ok(acc.indexOf('Payroll Liabilities/OCLIAB') >= 0 && acc.indexOf('Payroll Liabilities/OCLIAB') < acc.indexOf('Payroll Liabilities:Federal/OCLIAB'), 'parent before child'); ok(acc.indexOf('Checking/BANK') >= 0, 'net pay to the bank');
    eq(acc.length, new Set(acc).size, 'each account once');
    var tx = rows.filter(function (r) { return r[0] === 'TRNS' || r[0] === 'SPL'; });
    eq(tx[0][0], 'TRNS'); eq(tx[0][2], 'GENERAL JOURNAL'); eq(tx[0][3], j.draft.date.slice(5, 7) + '/' + j.draft.date.slice(8) + '/' + j.draft.date.slice(0, 4)); eq(tx[0][7], 'PR' + j.draft.date.slice(5, 7) + j.draft.date.slice(8) + j.draft.date.slice(2, 4), 'DOCNUM fits QuickBooks 11 characters'); ok(tx.every(function (r) { return r[7].length <= 11; })); ok(!/[^\x20-\x7e]/.test(iif.replace(/[\t\r\n]/g, '')), 'ASCII only (period dash)');
    eq(tx.reduce(function (s, r) { return s + Math.round(parseFloat(r[6]) * 100); }, 0), 0, 'debits = credits');
    eq(tx.length, j.draft.jlines.length); ok(/Payroll \(monthly\)/.test(tx[0][8]) && / - Gross wages$/.test(tx[0][8]), 'entry memo on the first line'); ok(/Net pay$/.test(tx[tx.length - 1][8]));
    eq(rows[rows.length - 1][0], 'ENDTRNS'); ok(!/\r\n/.test(iif.replace(/\r\n/g, '')), 'CRLF only');
    ok(P.toIIF([j.draft]).indexOf('!ACCNT') < 0, 'no account rows unless asked');
  });
  test('PS-11 several pay dates merged into one entry: same account + memo added, balanced, dated the last pay date', function () {
    var P = OB.paystub, d1 = { date: '2026-01-31', number: 'PR-2026-01-31', memo: 'Payroll (monthly) - pay date 01/31/2026, 2 employees (from paystubs)', jlines: [{ accountId: 'Wages', debit: 100000, credit: 0, memo: 'A - Gross wages' }, { accountId: 'Fed', debit: 0, credit: 20000, memo: 'A - Federal income tax withheld' }, { accountId: 'Net', debit: 0, credit: 80000, memo: 'A - Net pay' }] };
    var d2 = JSON.parse(JSON.stringify(d1)); d2.date = '2026-02-28'; d2.number = 'PR-2026-02-28'; d2.jlines[0].debit = 150000; d2.jlines[2].credit = 130000;
    var m = P.mergeDrafts([d2, d1]);
    eq(m.date, '2026-02-28'); eq(m.number, 'PR-2026-02-28'); eq(m.jlines.length, 3); eq(m.jlines[0].debit, 250000); eq(m.jlines[1].credit, 40000); eq(m.jlines[2].credit, 210000);
    ok(/\(monthly\) - 2 pay dates 01\/31\/2026 to 02\/28\/2026, 2 employees/.test(m.memo), m.memo);
    eq(m.jlines.reduce(function (s, l) { return s + l.debit - l.credit; }, 0), 0);
    eq(P.mergeDrafts([d1]), d1, 'one pay date stays as it is');
    d1.importRef = 'Paystub payroll 2026-01-31 · A, B'; d2.importRef = 'Paystub payroll 2026-02-28 · A, B';
    var c = P.mergeDrafts([d1, d2]); eq(c.importRef, 'Paystub payroll 2026-01-31, 2026-02-28 · A, B');
    var posted = P.posted({ posted: function () { return [Object.assign({ type: 'journal', id: 't1' }, c)]; } });
    ok(posted['2026-01-31'] && posted['2026-02-28'], 'a combined entry counts as posted for every pay date in it');
    ok(/PR022826/.test(P.toIIF([m])), 'iif number');
  });
})(typeof window !== 'undefined' ? window : globalThis);
