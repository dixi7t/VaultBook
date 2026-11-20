/* VaultBook — payroll documents: recognise, read, cross-check (1.34) tests. Synthetic documents only (made-up company and people),
 * written as the text lines OCR or a PDF text layer gives. Loaded after paystub.tests.js; shares OB.tests. */
(function (root) {
  'use strict';
  var OB = root.OB, T = OB.tests, D = OB.paydocs;
  function test(name, fn) { T.push({ name: name, fn: fn }); }
  function eq(a, b, msg) { if (a !== b) throw new Error((msg || 'Expected equal') + ': expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }
  function ok(v, msg) { if (!v) throw new Error(msg || 'Assertion failed'); }
  var rows = function (text) { return text.trim().split('\n').map(function (l, i) { var t = l.trim(), x = 40; return { page: 1, y: 700 - i * 14, text: t, items: t.split(' ').map(function (w) { var it = { text: w, x: x, y: 700 - i * 14, width: w.length * 6 }; x += w.length * 6 + 6; return it; }) }; }); };

  // Two made-up employees, Jan–Mar 2026: Alex Morgan (Iowa), Jordan Lee (Arizona)
  var PEOPLE = { 'Alex Morgan': { gross: 1000000, fitw: 150000, sswh: 62000, mcwh: 14500, sitw: 40000 }, 'Jordan Lee': { gross: 800000, fitw: 100000, sswh: 49600, mcwh: 11600, sitw: 20000 } };
  var stub = function (who, date) { var p = PEOPLE[who]; return { key: who + date, employee: who, payDate: date, lines: [{ category: 'wages', current: p.gross }, { category: 'fed', current: p.fitw }, { category: 'ee_ss', current: p.sswh }, { category: 'ee_medicare', current: p.mcwh }, { category: 'state', current: p.sitw }], totals: { net: p.gross - p.fitw - p.sswh - p.mcwh - p.sitw }, issues: [] }; };
  var stubs = function () { var out = []; ['2026-01-31', '2026-02-28', '2026-03-31'].forEach(function (d) { out.push(stub('Alex Morgan', d), stub('Jordan Lee', d)); }); return out; };
  // month: gross 18,000; FIT 2,500; SS 1,116; MC 261; employer MC 261 → federal liability 5,254.00; quarter 15,762.00
  var DOCS = {
    eftpsJan: ['EFTPS Payments\nDeposit Confirmation\nTax Type Federal Tax Deposit\nPayment Amount $5,254.00\nSettlement Date 02/13/2026', 'Jan deposit.pdf'],
    eftpsFeb: ['Welcome To EFTPS - Payments\nPayment Amount $5,254.00\nSettlement Date 03/13/2026', 'Feb deposit.pdf'],
    eftpsMar: ['Welcome To EFTPS - Payments\nPayment Amount $5,254.00\nSettlement Date 04/14/2026', 'Mar deposit.pdf'],
    f941: ['Form 941 for 2026: Employer’s QUARTERLY Federal Tax Return\n2 Wages, tips, and other compensation ........ 2 54000.00\n3 Federal income tax withheld from wages ...... 3 7500.00\n5a Taxable social security wages ..... 54000.00 | x0.124 = 6696.00\n5c Taxable Medicare wages & tips ..... 54000.00 | x0.029 = 1566.00\n5e Total social security and Medicare taxes ..... 5e 8262.00\n12 Total taxes after adjustments and nonrefundable credits ..... 12 15762.00\n13 Total deposits for this quarter, including overpayment ..... 13 15762.00', '941 1ST QTR 2026.pdf'],
    summary: ["Payer's Summary by Month (Jan-Jun) View A\nPayer: SAMPLE CLINIC LLC State: ALL\nJan Feb Mar Apr May Jun\nGross 18000.00 18000.00 18000.00 0.00 0.00 0.00\nMCWH 261.00 261.00 261.00 0.00 0.00 0.00\nSSWH 1116.00 1116.00 1116.00 0.00 0.00 0.00\nFITW 2500.00 2500.00 2500.00 0.00 0.00 0.00\nSITW 600.00 600.00 600.00 0.00 0.00 0.00\nNet 13523.00 13523.00 13523.00 0.00 0.00 0.00\nPayroll Summary by Quarter View D\n1st 2nd 3rd 4th YTD\nEMPLOYER S EXPENSES\nMC 0.0145 783.00 0.00 0.00 0.00 783.00\nSS 0.0620 3348.00 0.00 0.00 0.00 3348.00\nFUTA 84.00 0.00 0.00 0.00 84.00\nSUTA 180.00 0.00 0.00 0.00 180.00", 'summary.pdf'],
    register: ['SAMPLE CLINIC EMPLOYEE DETAIL\nReport Date: 01/01/2026 Thru: 03/31/2026\nDate Sta Gross MCWH SSWH FITW SITW Net\nMORGAN, ALEX\n01/31 IA 10000.00 145.00 620.00 1500.00 400.00 7335.00\n02/28 IA 10000.00 145.00 620.00 1500.00 400.00 7335.00\n03/31 IA 10000.00 145.00 620.00 1500.00 400.00 7335.00\nLEE, JORDAN\n01/31 AZ 8000.00 116.00 496.00 1000.00 200.00 6188.00\n02/28 AZ 8000.00 116.00 496.00 1000.00 200.00 6188.00\n03/31 AZ 8000.00 116.00 496.00 1000.00 200.00 6188.00', 'register.pdf'],
    azReturn: ['Arizona Quarterly Withholding Tax Return A1-QRT\nE Total Arizona payroll for this quarter ......... $ 24000.00\nB1Month 1 Liability ........ B1 $200.00\nB2Month 2 Liability ........ B2 $200.00\nB3Month 3 Liability ........ B3 $200.00\nB4Total. Enter this amount on Part 3, line 1 ...... B4 $600.00', 'AZ WH RETURN 1ST QTR 2026.pdf'],
    azPay: ['Payment Confirmation\nSAMPLE CLINIC LLC\nhttps://www.aztaxes.gov/Home/PaymentConfirmation\nPayment Amount\n$200.00\nSettlement Date\n01/30/2026', 'AZ payment jan 2026.pdf'],
    iaWh: ['Name: SAMPLE CLINIC LLC\nFiling Period: 31-Mar-2026\nWithholding Tax Return Summary\nFinal Balances Tax Withheld $1,200.00\nAmount $1,200.00\nPayment Date 20-Apr-2026\nThis is a summary only and will not be accepted as a return by the Iowa Department of Revenue.', 'IA WH Q1 2026.pdf'],
    iaUi: ["Employer's Contribution & Payroll Report\nUnemployment Insurance Tax Bureau\nDes Moines IA 50319\n1st Quarter 2026\n1. Total Wages (All Pages): $30,000.00\nContribution Tax 1.000 %\n2. Taxable Wages (All Pages): $18,000.00\n12. Amount Due (Line 9 + 10 -11): $180.00\n1 XXX-XX-0000 MORGAN ALEX $30,000.00 $18,000.00", 'IA UI Q1 2026.pdf'],
    letter: ['Dear customer, thank you for your order of 3 widgets on 01/02/2026.', 'letter.pdf']
  };
  var read = function (k) { return D.read(rows(DOCS[k][0]), DOCS[k][1]); };
  var all = function (skip) { return [D.stubDoc(stubs(), 'stubs.pdf')].concat(Object.keys(DOCS).filter(function (k) { return k !== 'letter' && (skip || []).indexOf(k) < 0; }).map(read)); };

  test('PD-01 each document is recognised, given its use, and read (no identification numbers kept)', function () {
    var k = function (key) { return read(key); };
    eq(k('eftpsJan').kind, 'fedDeposit'); eq(k('eftpsJan').role, 'payment'); eq(k('eftpsJan').payments[0].amount, 525400); eq(k('eftpsJan').payments[0].date, '2026-02-13');
    var f = k('f941'); eq(f.kind, 'f941'); eq(f.role, 'verify'); eq(f.period, '2026-Q1'); eq(f.values.wages, 5400000); eq(f.values.ssTax, 669600); eq(f.values.liability, 1576200); eq(f.values.deposits, 1576200);
    var s = k('summary'); eq(s.kind, 'summary'); eq(s.months['????-01'].gross, 1800000); eq(s.quarters['????-Q1'].erMc, 78300); eq(s.quarters['????-Q1'].suta, 18000);
    var r = k('register'); eq(r.kind, 'register'); eq(r.employees['LEE, JORDAN']['2026-02'].sitw, 20000);
    var az = k('azReturn'); eq(az.kind, 'stateWhReturn'); eq(az.state, 'AZ'); eq(az.period, '2026-Q1'); eq(az.values.withheld, 60000); eq(az.values.monthly.join(), '20000,20000,20000'); eq(az.values.wages, 2400000);
    var p = k('azPay'); eq(p.kind, 'stateWhPayment'); eq(p.state, 'AZ'); eq(p.payments[0].amount, 20000); eq(p.payments[0].date, '2026-01-30');
    var ia = k('iaWh'); eq(ia.kind, 'stateWhReturn'); eq(ia.state, 'IA'); eq(ia.period, '2026-Q1'); eq(ia.values.withheld, 120000); eq(ia.payments[0].date, '2026-04-20');
    var ui = k('iaUi'); eq(ui.kind, 'stateUi'); eq(ui.state, 'IA'); eq(ui.values.taxable, 1800000); eq(ui.values.rate, '1.000'); eq(ui.values.owed, 18000); eq(Object.keys(ui.employees).join(), 'MORGAN, ALEX');
    ok(JSON.stringify(ui).indexOf('XXX-XX') < 0, 'no SSN kept');
    var l = k('letter'); eq(l.kind, 'unknown'); eq(l.role, 'ignored');
  });

  test('PD-02 everything provided agrees: paystubs, register, summary, EFTPS, 941, state withholding, unemployment, FUTA', function () {
    var R = D.reconcile(all());
    var bad = R.checks.filter(function (c) { return c.status !== 'ok'; });
    eq(bad.length, 0, bad.map(function (c) { return c.group + ': ' + c.label + ' ' + c.expected + '/' + c.found; }).join(' | '));
    ok(R.checks.length > 60, 'many checks: ' + R.checks.length);
    var g = function (name) { return R.checks.filter(function (c) { return c.group.indexOf(name) === 0; }).length; };
    ok(g('Paystubs vs register') && g('Paystubs vs payroll summary') && g('Federal deposits') === 3 && g('Form 941 2026-Q1') >= 6 && g('AZ withholding 2026-Q1') && g('IA withholding 2026-Q1') && g('IA unemployment') && g('Employer taxes') >= 4, 'every area checked');
    var st = {}; R.people.forEach(function (p) { st[p.name] = p.states.join(); }); eq(st['Alex Morgan'], 'IA', 'state worked out from the documents'); eq(st['Jordan Lee'], 'AZ');
    eq(R.months[0].fed, 525400); ok(R.months.every(function (m) { return m.deposit; }), 'each month matched to its deposit');
    eq(R.notes.filter(function (n) { return n.kind === 'missing'; }).length, 0, R.notes.map(function (n) { return n.text; }).join(' | '));
    var html = D.reportHTML(R); ok(/checks agree/.test(html) && /Federal deposit/.test(html) && /Not used|Makes the entry/.test(html));
  });

  test('PD-03 a wrong figure shows as a difference; a document not provided shows as missing, not wrong', function () {
    var docs = all(['eftpsMar']);
    docs.find(function (d) { return d.kind === 'register'; }).employees['MORGAN, ALEX']['2026-02'].fitw = 160000;
    docs.find(function (d) { return d.kind === 'f941'; }).values.fitw = 750100;
    docs.find(function (d) { return d.name === 'Feb deposit.pdf'; }).payments[0].amount = 515400;
    var R = D.reconcile(docs), diff = R.checks.filter(function (c) { return c.status === 'diff'; }).map(function (c) { return c.label; }).join(' | ');
    ok(/2026-02 · Federal income tax/.test(diff), 'register difference: ' + diff); ok(/Line 3/.test(diff), '941 line 3'); ok(/does not equal any month/.test(diff), 'odd deposit');
    ok(R.notes.some(function (n) { return n.kind === 'missing' && /2026-03: federal liability/.test(n.text); }), 'March deposit not provided');
    var noUi = D.reconcile(all(['iaUi']));
    ok(noUi.notes.some(function (n) { return /SUTA of \$180\.00 but no state unemployment return/.test(n.text); }), 'missing SUTA return noted');
  });

  test('PD-04 people match in any order; the summary takes the year of the other documents; the file name year beats a form revision', function () {
    eq(D.personKey('MORGAN, ALEX'), D.personKey('Alex Morgan'));
    var R = D.reconcile([D.stubDoc(stubs()), read('summary')]); ok(R.checks.some(function (c) { return /^2026-01 · Gross/.test(c.label) && c.status === 'ok'; }), 'summary months as 2026');
    eq(D.read(rows('Arizona Quarterly Withholding Tax Return A1-QRT (2025)\nB4Total ..... B4 $600.00'), 'AZ_WH_1ST_QTR_2026.pdf').period, '2026-Q1');
  });
})(typeof window !== 'undefined' ? window : globalThis);
