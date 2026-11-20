/* VaultBook — payroll documents: recognise, read and cross-check (1.34).
 *
 * A client hands over whatever payroll paper they have: paystubs, the payroll service's summaries and employee registers,
 * EFTPS federal deposit confirmations, Form 941, state withholding returns and payments, state unemployment returns and
 * wage reports. OB.paydocs.read(rows, fileName) recognises each one (rows as the statement engine returns them, from the
 * PDF text or OCR), says what it is used for (paystubs make the payroll entry; payments are tax paid; returns and
 * summaries only verify) and reads its figures. OB.paydocs.reconcile(docs) puts everything side by side by month and
 * quarter and checks it the way an accountant would: paystubs against the register and the summary, each month's federal
 * liability (income tax + 2 × Social Security + Medicare withheld + employer Medicare) against the EFTPS deposits, the 941
 * lines against the paystubs and deposits, each state's withholding against the employees whose state tax adds up to it,
 * unemployment wages and FUTA. What is missing is listed as missing, not as wrong.
 * Identification numbers (SSN, EIN, bank accounts) are never kept.
 */
(function (root) {
  'use strict';
  var OB = root.OB = root.OB || {};
  var U = OB.util, P = OB.paystub, D = OB.paydocs = {};

  /* ---------------- text helpers ---------------- */
  var AMT = /\(?-?\$?\s?\d[\d,]*\.\d{2}(?!\d)\)?/g;
  var cents = function (s) { var t = String(s).replace(/[$,\s]/g, ''), neg = /^\(.*\)$|^-/.test(t); var n = Math.round(parseFloat(t.replace(/[()\-]/g, '')) * 100); return isFinite(n) ? (neg ? -n : n) : null; };
  var amounts = function (line) { return (String(line).match(AMT) || []).map(cents); };
  var last = function (line) { var a = amounts(line); return a.length ? a[a.length - 1] : null; };
  var MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  var monOf = function (t) { var i = MON.indexOf(String(t).slice(0, 3).toUpperCase()); return i < 0 ? 0 : i + 1; };
  var pad = function (n) { return (n < 10 ? '0' : '') + n; };
  var ym = function (y, m) { return y + '-' + pad(m); };
  var qOf = function (month) { return month.slice(0, 4) + '-Q' + Math.ceil(+month.slice(5, 7) / 3); };
  var monthsOfQ = function (q) { var y = q.slice(0, 4), n = +q.slice(-1); return [1, 2, 3].map(function (i) { return ym(y, (n - 1) * 3 + i); }); };
  var dateOf = function (s) {   // 02/02/2026, 1/29/2026, 16-Apr-2026 → yyyy-mm-dd
    var m = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s); if (m) return m[3] + '-' + pad(+m[1]) + '-' + pad(+m[2]);
    m = /(\d{1,2})-([A-Za-z]{3})-(\d{4})/.exec(s); if (m && monOf(m[2])) return m[3] + '-' + pad(monOf(m[2])) + '-' + pad(+m[1]);
    return null;
  };
  /** Same person whatever the order or punctuation: "KADAKIA, KEVIN" = "Kevin Kadakia". */
  D.personKey = function (name) { return String(name || '').toUpperCase().replace(/[^A-Z ]+/g, ' ').split(/\s+/).filter(function (w) { return w.length > 1; }).sort().join(' '); };
  var STATES = 'AL Alabama|AK Alaska|AZ Arizona|AR Arkansas|CA California|CO Colorado|CT Connecticut|DE Delaware|DC District of Columbia|FL Florida|GA Georgia|HI Hawaii|ID Idaho|IL Illinois|IN Indiana|IA Iowa|KS Kansas|KY Kentucky|LA Louisiana|ME Maine|MD Maryland|MA Massachusetts|MI Michigan|MN Minnesota|MS Mississippi|MO Missouri|MT Montana|NE Nebraska|NV Nevada|NH New Hampshire|NJ New Jersey|NM New Mexico|NY New York|NC North Carolina|ND North Dakota|OH Ohio|OK Oklahoma|OR Oregon|PA Pennsylvania|RI Rhode Island|SC South Carolina|SD South Dakota|TN Tennessee|TX Texas|UT Utah|VT Vermont|VA Virginia|WA Washington|WV West Virginia|WI Wisconsin|WY Wyoming'
    .split('|').map(function (s) { return [s.slice(0, 2), s.slice(3)]; });
  var HINTS = [[/AZTAXES|\bADOR\b|A1-QRT/i, 'AZ'], [/IOWA|\bLOWA\b|MYIOWAUI|DES MOINES/i, 'IA'], [/\bEDD\b|\bDE 9\b/i, 'CA'], [/NJ-927|WR-30/i, 'NJ'], [/NYS-45/i, 'NY']];
  var stateOf = function (text, name) {
    var h = HINTS.find(function (x) { return x[0].test(text) || x[0].test(name || ''); }); if (h) return h[1];
    var s = STATES.find(function (x) { return new RegExp('\\b' + x[1] + '\\b', 'i').test(text); }); if (s) return s[0];
    var f = /(?:^|[_\s-])([A-Z]{2})[_\s-]/.exec(name || ''); return f && STATES.some(function (x) { return x[0] === f[1]; }) ? f[1] : null;
  };
  var yearOf = function (text) { var c = {}; (text.match(/\b20\d\d\b/g) || []).forEach(function (y) { c[y] = (c[y] || 0) + 1; }); return Object.keys(c).sort(function (a, b) { return c[b] - c[a]; })[0] || null; };
  var quarterOf = function (text, name, year) {
    var m = /\b(1st|2nd|3rd|4th|first|second|third|fourth)\s*(?:qtr|quarter)/i.exec(text + ' ' + String(name || '').replace(/_/g, ' ')) || /\bQuarter:?\s*([1-4])\s*\/\s*20\d\d/i.exec(text) || /\bQ([1-4])\b/.exec(text) || /\bQ([1-4])\b/i.exec(String(name || '').replace(/_/g, ' '));
    if (m) { var n = { '1st': 1, first: 1, '2nd': 2, second: 2, '3rd': 3, third: 3, '4th': 4, fourth: 4 }[m[1].toLowerCase()] || +m[1]; return year ? year + '-Q' + n : null; }
    var fp = /Filing Period:?\s*(\d{1,2}-[A-Za-z]{3}-\d{4})/i.exec(text); if (fp) { var d = dateOf(fp[1]); return d ? qOf(d.slice(0, 7)) : null; }
    return null;
  };
  /** Amount on the line holding the label, or on the next line when the form puts it underneath. */
  var after = function (lines, re) { for (var i = 0; i < lines.length; i++) if (re.test(lines[i])) { var a = last(lines[i].replace(re, ' ')); if (a === null && i + 1 < lines.length) a = last(lines[i + 1]); if (a !== null) return a; } return null; };
  var dateAfter = function (lines, re) { for (var i = 0; i < lines.length; i++) if (re.test(lines[i])) { var d = dateOf(lines[i].replace(/^.*?(?=\d)/, '')) || (i + 1 < lines.length ? dateOf(lines[i + 1]) : null); if (d) return d; } return null; };

  var FIELD = { GROSS: 'gross', MCWH: 'mcwh', MC: 'mcwh', MEDICARE: 'mcwh', SSWH: 'sswh', SS: 'sswh', FITW: 'fitw', FWT: 'fitw', FIT: 'fitw', SITW: 'sitw', SWT: 'sitw', SIT: 'sitw', LITW: 'litw', NET: 'net' };
  D.FIELDS = [['gross', 'Gross wages'], ['fitw', 'Federal income tax'], ['sswh', 'Social Security withheld'], ['mcwh', 'Medicare withheld'], ['sitw', 'State income tax'], ['litw', 'Local tax'], ['net', 'Net pay']];

  /* ---------------- what each document is ---------------- */
  D.KINDS = {
    paystubs: ['Paystubs', 'entry', 'Makes the payroll journal entry for each pay date.'],
    register: ['Payroll register (employee detail)', 'verify', 'Checks the paystubs, employee by employee and pay date by pay date.'],
    summary: ['Payroll summary (payroll service)', 'verify', 'Checks monthly and quarterly totals and employer taxes.'],
    fedDeposit: ['Federal tax deposit (EFTPS)', 'payment', 'Federal payroll tax paid: income tax, Social Security and Medicare.'],
    f941: ['Form 941 quarterly federal return', 'verify', 'Checks the quarter: wages, withholding, Social Security, Medicare and deposits.'],
    stateWhReturn: ['State withholding return', 'verify', 'Checks state income tax withheld; shows which employees it covers.'],
    stateWhPayment: ['State withholding payment', 'payment', 'State income tax paid.'],
    stateUi: ['State unemployment (SUTA) return', 'verify', 'Checks unemployment wages and the employer SUTA expense.'],
    stateUiWages: ['State unemployment wage report', 'verify', 'Shows which employees are reported to that state.'],
    unknown: ['Not recognised as a payroll document', 'ignored', 'Not used. If it is payroll, send it so VaultBook can learn it.']
  };
  D.read = function (rows, name, opts) {
    var lines = (rows || []).map(function (r) { return String(r.text || '').replace(/\s+/g, ' ').trim(); }).filter(Boolean), text = lines.join('\n');
    var year = yearOf(String(name || '').replace(/[_.-]/g, ' ')) || yearOf(text);   // the file name's year beats a form revision year ("A1-QRT (2025)")
    var doc = { name: name || '', kind: 'unknown', year: year, state: null, period: null, values: {}, months: {}, employees: {}, payments: [], warnings: [] };
    var stubs = P.parse(rows || [], { labels: (opts && opts.labels) || {} }).stubs.filter(function (s) { return s.lines.length; });
    if (stubs.length) { doc.kind = 'paystubs'; doc.stubs = stubs; }
    else if (/EFTPS|Federal Tax Deposit/i.test(text)) readEftps(doc, lines);
    else if (/Form 941|941 for|QUARTERLY Federal Tax Return/i.test(text) && /\b5e\b|Total deposits/i.test(text)) read941(doc, lines, text);
    else if (/Payer.?s Summary|Payroll Summary by|Summary by Month|Summary by Quarter/i.test(text)) readSummary(doc, lines);
    else if (/EMPLOYEE DETAIL|Payroll Register|Employee Earnings/i.test(text) && /Gross/i.test(text)) readRegister(doc, lines, year);
    else if (/Unemployment|Contribution(?:s)? (?:&|and) Payroll|Wage Detail|Wage Line|Taxable Wage|\bSUTA\b|\bSUI\b|\bUI\b.*\bReport/i.test(text)) readUi(doc, lines, text);
    else if (/Withholding/i.test(text) && /Return|A1-QRT|Liability|Tax Withheld/i.test(text)) readStateWh(doc, lines, text);
    else if (/Payment Confirmation|Payment Amount/i.test(text) && stateOf(text, name)) readStatePayment(doc, lines);
    if (doc.kind !== 'paystubs' && doc.kind !== 'unknown' && doc.kind !== 'summary' && doc.kind !== 'register' && !doc.period) doc.period = quarterOf(text, name, year);
    if (/^state/.test(doc.kind) && !doc.state) doc.state = stateOf(text, name);
    var k = D.KINDS[doc.kind]; doc.label = k[0]; doc.role = k[1]; doc.use = k[2];
    doc.empty = doc.kind !== 'paystubs' && doc.kind !== 'unknown' && !Object.keys(doc.values).length && !Object.keys(doc.months).length && !Object.keys(doc.employees).length && !doc.payments.length;
    return doc;
  };
  /** One file → { doc, how }. PDF text first; OCR for scans, and for a PDF whose text gave no figures. E = window.OBStatement. */
  D.readFile = async function (file, E, opts, say) {
    say = say || function () {};
    var isImg = /\.(png|jpe?g)$/i.test(file.name) || /^image\//.test(file.type || '');
    if (isImg) { say('Reading ' + file.name + ' with OCR…'); return { doc: D.read(await E.ocrImageRows(file, say), file.name, opts), how: 'OCR' }; }
    say('Reading ' + file.name + '…');
    var rows = await E.extractRows(file), digits = rows.reduce(function (n, r) { return n + (r.items || []).filter(function (i) { return /\d/.test(i.text); }).length; }, 0);
    var doc = digits >= 6 ? D.read(rows, file.name, opts) : null;
    if (doc && doc.kind !== 'unknown' && !doc.empty) return { doc: doc, how: 'text' };
    say((digits < 6 ? 'No text in ' : 'Nothing usable in the text of ') + file.name + ': reading it with OCR (offline)…');
    var ocr = D.read(await E.ocrExtractRows(file, say), file.name, opts);
    return ocr.kind !== 'unknown' || !doc ? { doc: ocr, how: 'OCR' } : { doc: doc, how: 'text' };
  };
  /** The paystubs as one document for reconcile (they may have been corrected on screen). */
  D.stubDoc = function (stubs, name) { var k = D.KINDS.paystubs; return { name: name || 'Paystubs', kind: 'paystubs', label: k[0], role: k[1], use: k[2], stubs: stubs, values: {}, months: {}, employees: {}, payments: [], year: null, state: null, period: null }; };
  function readEftps(doc, lines) {
    doc.kind = 'fedDeposit';
    var a = after(lines, /Payment Amount/i), d = dateAfter(lines, /Settlement Date/i);
    if (a !== null) doc.payments.push({ amount: a, date: d, tax: 'federal' });
  }
  function read941(doc, lines, text) {
    doc.kind = 'f941';
    var V = doc.values, at = function (re) { var l = lines.find(function (x) { return re.test(x); }); return l || ''; };
    var one = function (re) { var a = amounts(at(re)); return a.length ? a[a.length - 1] : null; };
    V.wages = one(/^2\s+Wages/i); V.fitw = one(/^3\s+Federal income tax/i);
    var a5 = amounts(at(/^5a\b/i)); V.ssWages = a5[0] === undefined ? null : a5[0]; V.ssTax = a5.length > 1 ? a5[a5.length - 1] : null;
    var c5 = amounts(at(/^5c\b/i)); V.mcWages = c5[0] === undefined ? null : c5[0]; V.mcTax = c5.length > 1 ? c5[c5.length - 1] : null;
    var d5 = amounts(at(/Additional Medicare Tax withholding/i)); V.addlWages = d5[0] === undefined ? null : d5[0]; V.addlTax = d5.length > 1 ? d5[d5.length - 1] : null;
    V.ssMcTotal = one(/^5e\b/i); V.liability = one(/^12\s+Total taxes after/i); V.deposits = one(/^13\s+Total deposits/i);
    if (V.deposits === null) { var i = lines.findIndex(function (x) { return /^13\s+Total deposits/i.test(x); }); if (i >= 0 && lines[i + 1]) V.deposits = last(lines[i + 1]); }
    Object.keys(V).forEach(function (k) { if (V[k] === null) delete V[k]; });
    doc.period = quarterOf(text.replace(/\b[1-4]: (January|April|July|October)[^\n]*/g, ''), doc.name, doc.year);
  }
  /** Tables of LABEL n n n under a header of month names or quarters (payroll-service summary views). */
  function readSummary(doc, lines) {
    doc.kind = 'summary';
    var y = doc.year || '????', cols = null, section = '', q = doc.quarters = {};
    lines.forEach(function (l) {
      var w = l.split(' ');
      var mons = w.filter(function (t) { return monOf(t) && t.length <= 4; });
      if (mons.length >= 3 && mons.length >= w.length - 2) { cols = { months: mons.map(monOf) }; section = ''; return; }
      if (/\bYTD\b/.test(l) && /\b(1st|4th)\b/i.test(l)) { cols = { quarters: true }; section = ''; return; }
      if (/^TAXABLE WAGES/i.test(l)) { section = 'taxable'; return; }
      if (/^EMPLOYER/i.test(l)) { section = 'employer'; return; }
      if (/^EMPLOYEE/i.test(l)) { section = 'employee'; return; }
      if (/^(Qtr|Otr|Mon)\b|View [A-Z]/i.test(l)) { cols = null; return; }
      if (!cols) return;
      var lab = (w[0] || '').toUpperCase().replace(/[^A-Z]/g, ''), a = amounts(l);
      if (!a.length) return;
      if (cols.months) {
        var f = FIELD[lab]; if (!f) return;
        cols.months.forEach(function (m, i) { if (a[i] === undefined) return; var k = ym(y, m); (doc.months[k] = doc.months[k] || {})[f] = a[i]; });
      } else if (section === 'employer' || section === 'taxable') {
        var key = section === 'employer' ? { MC: 'erMc', SS: 'erSs', FUTA: 'futa', SUTA: 'suta' }[lab] : { FUTA: 'futaWages', SUTA: 'sutaWages', SS: 'ssWages', MC: 'mcWages' }[lab];
        if (!key) return;
        a.slice(0, 4).forEach(function (v, i) { var k = y + '-Q' + (i + 1); (q[k] = q[k] || {})[key] = v; });
      }
    });
    Object.keys(doc.months).forEach(function (k) { if (!Object.keys(doc.months[k]).some(function (f) { return doc.months[k][f]; })) delete doc.months[k]; });
    if (!Object.keys(q).length) delete doc.quarters;
  }
  /** Employee detail: a NAME line, then one line per pay date (mm/dd …amounts in the header's column order). */
  function readRegister(doc, lines, year) {
    doc.kind = 'register';
    var order = null, who = null, rd = /Report Date:?\s*\d{1,2}\/\d{1,2}\/(\d{4})/i.exec(lines.join(' ')); if (rd) year = doc.year = rd[1];
    lines.forEach(function (l) {
      if (/\bGross\b/i.test(l) && /\bNet\b/i.test(l) && !amounts(l).length) { order = l.toUpperCase().split(/\s+/).map(function (t) { return FIELD[t.replace(/[^A-Z]/g, '')]; }).filter(Boolean); return; }
      if (/^[A-Z][A-Z'-]+,\s*[A-Z][A-Z' -]+$/.test(l)) { who = l; return; }
      var m = /^(\d{1,2})\/(\d{1,2})\b/.exec(l); if (!m || !who || !order) return;
      var a = amounts(l); if (a.length < order.length) return;
      var rec = {}; order.forEach(function (f, i) { rec[f] = a[i]; });
      var k = ym(year, +m[1]), e = doc.employees[who] = doc.employees[who] || {};
      if (!e[k]) e[k] = {}; Object.keys(rec).forEach(function (f) { e[k][f] = (e[k][f] || 0) + rec[f]; });
    });
  }
  function readStateWh(doc, lines, text) {
    doc.kind = 'stateWhReturn';
    var V = doc.values, b = {};
    lines.forEach(function (l) { var m = /^B([1-4])(?=[\sA-Z])/.exec(l); if (m && last(l) !== null) b[m[1]] = last(l); });
    if (b[1] !== undefined || b[2] !== undefined || b[3] !== undefined) V.monthly = [b[1] || 0, b[2] || 0, b[3] || 0];
    V.withheld = b[4] !== undefined ? b[4] : after(lines, /^1 Liability|Tax Withheld|Total (?:tax )?withheld|^A1\b/i);
    var pay = after(lines, /^Total Arizona payroll|^E Total .*payroll|Total (?:state )?wages/i); if (pay !== null) V.wages = pay;
    var amt = after(lines, /^Amount\b/i), pd = dateAfter(lines, /Payment Date/i);
    if (amt !== null && pd) doc.payments.push({ amount: amt, date: pd, tax: 'state' });
    Object.keys(V).forEach(function (k) { if (V[k] === null) delete V[k]; });
  }
  function readStatePayment(doc, lines) {
    doc.kind = 'stateWhPayment';
    var a = after(lines, /Payment Amount|^Amount\b/i), d = dateAfter(lines, /Settlement Date|Payment Date/i) || dateAfter(lines, /Submitted Date/i);
    if (a !== null) doc.payments.push({ amount: a, date: d, tax: 'state' });
  }
  function readUi(doc, lines, text) {
    doc.kind = /Wage (Line )?Detail/i.test(text) && !/Contribution Tax|Rate:/i.test(text) ? 'stateUiWages' : 'stateUi';
    var V = doc.values;
    V.wages = after(lines, /Total Wages(?: \(All Pages\))?:/i); V.taxable = after(lines, /Taxable Wages(?: \(All Pages\))?:/i);
    var r = /(\d+\.\d+)\s*%/.exec(text); if (r) V.rate = r[1];
    V.owed = after(lines, /Amount Due \(Line|Total Owed|Contribution Owed|Contribution Due/i);
    if (doc.kind === 'stateUiWages' && (V.wages === null || V.taxable === null)) { var i = lines.findIndex(function (l) { return /Total Wages/i.test(l); }); for (var j = i + 1; j < Math.min(lines.length, i + 4); j++) { var a = amounts(lines[j]); if (a.length >= 2) { V.wages = a[0]; V.taxable = a[1]; if (a[2] !== undefined) V.owed = a[2]; break; } } }
    lines.forEach(function (l) {   // employee wage lines: … LAST FIRST [MI] $total $taxable
      var m = /\b([A-Z][A-Z'-]+)\s+([A-Z][A-Z'-]+)(?:\s+[A-Z])?\s+\$?([\d,]+\.\d{2})\s+\$?([\d,]+\.\d{2})/.exec(l);
      if (m && !/TOTAL|WAGES|TAXABLE|PAGES/.test(m[1] + m[2])) doc.employees[m[1] + ', ' + m[2]] = { wages: cents(m[3]), taxable: cents(m[4]) };
    });
    Object.keys(V).forEach(function (k) { if (V[k] === null) delete V[k]; });
  }

  /* ---------------- cross-check ---------------- */
  var ER_MC = 0.0145;
  /** docs: from D.read (paystub docs may carry corrected stubs). → { docs, people, months, quarters, checks, notes } */
  D.reconcile = function (docs) {
    // a document without a year (a payroll-service summary prints only "Jan … Jun") takes the year of the others
    var yc = {}; docs.forEach(function (d) { (d.stubs || []).forEach(function (st) { if (st.payDate) yc[st.payDate.slice(0, 4)] = (yc[st.payDate.slice(0, 4)] || 0) + 1; }); if (d.year && !d.stubs) yc[d.year] = (yc[d.year] || 0) + 1; }); var yr = Object.keys(yc).sort(function (a, b) { return yc[b] - yc[a]; })[0];
    docs.forEach(function (d) { if (d.year || !yr) return; d.year = yr; ['months', 'quarters'].forEach(function (f) { if (!d[f]) return; var o = {}; Object.keys(d[f]).forEach(function (k) { o[k.replace('????', yr)] = d[f][k]; }); d[f] = o; }); });
    var checks = [], notes = [], people = {}, M = {}, src = function (k) { return docs.filter(function (d) { return d.kind === k; }); };
    var add = function (group, label, expected, found, sources, tol, extra) {
      var st = expected === null || expected === undefined || found === null || found === undefined ? 'missing' : Math.abs(expected - found) <= (tol || 0) ? 'ok' : 'diff';
      checks.push(Object.assign({ group: group, label: label, expected: expected, found: found, status: st, sources: sources || [] }, extra || {}));
    };
    var person = function (name) { var k = D.personKey(name); if (!people[k]) people[k] = { key: k, name: name, months: {}, states: {} }; if (/[a-z]/.test(name) && !/[a-z]/.test(people[k].name)) people[k].name = name; return people[k]; };
    // 1. the paystubs, by employee and month (several pay dates in a month add up)
    var stubDocs = src('paystubs');
    stubDocs.forEach(function (d) { d.stubs.forEach(function (s) {
      if (!s.payDate) return;
      var p = person(s.employee), k = s.payDate.slice(0, 7), r = p.months[k] = p.months[k] || { gross: 0, fitw: 0, sswh: 0, mcwh: 0, sitw: 0, litw: 0, net: 0, payDates: [] };
      var cat = function (c) { return U.sum(s.lines.filter(function (l) { return l.category === c && !l.subtotal; }), function (l) { return l.current || 0; }); };
      r.gross += cat('wages'); r.fitw += cat('fed'); r.sswh += cat('ee_ss'); r.mcwh += cat('ee_medicare'); r.sitw += cat('state'); r.litw += cat('local'); r.net += s.totals.net || 0;
      r.payDates.push(s.payDate); r.erMc = Math.round(r.gross * ER_MC);
    }); });
    var stubFiles = stubDocs.map(function (d) { return d.name; });
    // 2. register: employee by employee against the paystubs
    src('register').forEach(function (d) { Object.keys(d.employees).forEach(function (who) {
      var p = person(who);
      Object.keys(d.employees[who]).sort().forEach(function (k) {
        var r = d.employees[who][k], s = p.months[k];
        if (!s) { notes.push({ kind: 'missing', text: p.name + ' ' + k + ': in the register (' + d.name + ') but no paystub was provided.' }); p.regOnly = p.regOnly || {}; p.regOnly[k] = r; return; }
        D.FIELDS.forEach(function (f) { if (r[f[0]] !== undefined) add('Paystubs vs register', p.name + ' ' + k + ' · ' + f[1], r[f[0]], s[f[0]], [d.name].concat(stubFiles)); });
      });
    }); });
    // months, all employees together (paystubs first, else the register)
    Object.keys(people).forEach(function (pk) { var p = people[pk]; var all = Object.assign({}, p.regOnly || {}, p.months);
      Object.keys(all).forEach(function (k) { var r = all[k], m = M[k] = M[k] || { month: k, gross: 0, fitw: 0, sswh: 0, mcwh: 0, sitw: 0, litw: 0, net: 0, erMc: 0, people: 0, fromStubs: 0 };
        D.FIELDS.forEach(function (f) { m[f[0]] += r[f[0]] || 0; }); m.erMc += r.erMc !== undefined ? r.erMc : Math.round((r.gross || 0) * ER_MC); m.people++; if (p.months[k]) m.fromStubs++; }); });
    Object.keys(M).forEach(function (k) { var m = M[k]; m.fed = m.fitw + 2 * m.sswh + m.mcwh + m.erMc; });
    // 3. payroll summary: monthly totals and employer taxes
    src('summary').forEach(function (d) {
      Object.keys(d.months).sort().forEach(function (k) {
        var r = d.months[k], m = M[k];
        if (!m) { if (r.gross) notes.push({ kind: 'missing', text: k + ': the summary shows ' + U.fmt(r.gross, { symbol: true }) + ' of wages but no paystubs or register were provided for that month.' }); return; }
        D.FIELDS.forEach(function (f) { if (r[f[0]] !== undefined && (r[f[0]] || m[f[0]])) add('Paystubs vs payroll summary', k + ' · ' + f[1], r[f[0]], m[f[0]], [d.name]); });
      });
      Object.keys(d.quarters || {}).sort().forEach(function (q) {
        var r = d.quarters[q], ms = monthsOfQ(q).map(function (k) { return M[k]; }).filter(Boolean); if (!ms.length) return;
        if (r.erMc !== undefined) add('Employer taxes', q + ' · Employer Medicare (1.45% of wages)', r.erMc, U.sum(ms, function (m) { return m.erMc; }), [d.name], 100);
        if (r.erSs !== undefined) add('Employer taxes', q + ' · Employer Social Security (= employee)', r.erSs, U.sum(ms, function (m) { return m.sswh; }), [d.name]);
      });
    });
    // 4. federal deposits: each month's liability against the EFTPS deposits
    var deps = [].concat.apply([], src('fedDeposit').map(function (d) { return d.payments.map(function (p) { return Object.assign({ file: d.name }, p); }); })).sort(function (a, b) { return (a.date || '') < (b.date || '') ? -1 : 1; });
    var used = {};
    deps.forEach(function (p) {
      var cands = Object.keys(M).filter(function (k) { return !used[k] && Math.abs(M[k].fed - p.amount) <= 100 && (!p.date || k <= p.date.slice(0, 7)); }).sort().reverse();
      if (cands.length) { used[cands[0]] = p; M[cands[0]].deposit = p; add('Federal deposits (EFTPS)', cands[0] + ' · deposit ' + (p.date ? U.fmtDate(p.date) : '') + ' = income tax + 2 × Social Security + Medicare withheld + employer Medicare', M[cands[0]].fed, p.amount, [p.file].concat(stubFiles), 100); }
      else add('Federal deposits (EFTPS)', 'Deposit ' + U.fmt(p.amount, { symbol: true }) + (p.date ? ' on ' + U.fmtDate(p.date) : '') + ' does not equal any month’s federal liability', null, p.amount, [p.file], 0, { status: 'diff' });
    });
    if (deps.length) Object.keys(M).sort().forEach(function (k) { if (!M[k].deposit && M[k].fed) notes.push({ kind: 'missing', text: k + ': federal liability ' + U.fmt(M[k].fed, { symbol: true }) + ' — no EFTPS deposit provided for it.' }); });
    checks.forEach(function (c) { if (c.status === 'diff' && c.group === 'Federal deposits (EFTPS)' && c.expected === null) c.status = 'diff'; });
    // 5. Form 941 by quarter
    src('f941').forEach(function (d) {
      var V = d.values, q = d.period;
      if (!q && V.wages !== undefined) q = Object.keys(groupQ(M)).find(function (x) { return groupQ(M)[x].gross === V.wages; }) || null;
      if (!q) { notes.push({ kind: 'warn', text: d.name + ': could not tell which quarter this 941 is for.' }); return; }
      d.period = q;
      var G = groupQ(M)[q]; if (!G) { notes.push({ kind: 'missing', text: d.name + ': no paystubs, register or summary months for ' + q + '.' }); return; }
      var s = [d.name];
      add('Form 941 ' + q, 'Line 2 wages = gross wages', G.gross, V.wages, s); add('Form 941 ' + q, 'Line 3 federal income tax = paystubs', G.fitw, V.fitw, s);
      add('Form 941 ' + q, 'Line 5a Social Security tax = 2 × employee Social Security', 2 * G.sswh, V.ssTax, s, 100);
      add('Form 941 ' + q, 'Lines 5c + 5d Medicare tax = Medicare withheld + employer Medicare', G.mcwh + G.erMc, V.mcTax === undefined ? undefined : V.mcTax + (V.addlTax || 0), s, 100);
      add('Form 941 ' + q, 'Line 12 total taxes = the three months’ federal liability', G.fed, V.liability, s, 100);
      var qd = monthsOfQ(q).map(function (k) { return M[k] && M[k].deposit; }).filter(Boolean);
      if (qd.length) add('Form 941 ' + q, 'Line 13 deposits = EFTPS deposits provided (' + qd.length + ')', U.sum(qd, function (p) { return p.amount; }), V.deposits, s);
      if (V.liability !== undefined && V.deposits !== undefined) add('Form 941 ' + q, 'Balance due (line 12 − line 13)', 0, V.liability - V.deposits, s);
    });
    // 6. states: which employees each state's withholding belongs to, then the figures
    var stateDocs = docs.filter(function (d) { return /^state/.test(d.kind); });
    var assign = function (state, months, amount, field) {   // smallest set of employees whose figure for those months adds to the amount
      var list = Object.keys(people).filter(function (k) { return months.some(function (m) { var r = people[k].months[m] || (people[k].regOnly || {})[m]; return r && r[field]; }); });
      if (list.length > 15) return null;
      var val = function (k) { return U.sum(months, function (m) { var r = people[k].months[m] || (people[k].regOnly || {})[m]; return r ? r[field] || 0 : 0; }); };
      for (var n = 1; n <= list.length; n++) { var hit = combos(list, n).find(function (c) { return U.sum(c, val) === amount; }); if (hit) { hit.forEach(function (k) { people[k].states[state] = true; }); return hit; } }
      return null;
    };
    stateDocs.forEach(function (d) {
      if (!d.state) { notes.push({ kind: 'warn', text: d.name + ': could not tell which state this is for.' }); return; }
      if (d.kind === 'stateUiWages' || d.kind === 'stateUi') Object.keys(d.employees).forEach(function (n) { var k = D.personKey(n); if (people[k]) people[k].states[d.state] = true; });
    });
    stateDocs.filter(function (d) { return d.kind === 'stateWhReturn'; }).forEach(function (d) {
      var q = d.period; if (!q || d.values.withheld === undefined) return;
      var who = assign(d.state, monthsOfQ(q), d.values.withheld, 'sitw') || [];
      var label = who.length ? ' (' + who.map(function (k) { return people[k].name; }).join(', ') + ')' : '';
      add(d.state + ' withholding ' + q, 'Return total = state tax withheld on the paystubs' + label, who.length ? U.sum(monthsOfQ(q), function (m) { return U.sum(who, function (k) { var r = people[k].months[m] || (people[k].regOnly || {})[m]; return r ? r.sitw : 0; }); }) : null, d.values.withheld, [d.name]);
      if (d.values.monthly && who.length) monthsOfQ(q).forEach(function (m, i) { add(d.state + ' withholding ' + q, m + ' liability', U.sum(who, function (k) { var r = people[k].months[m] || (people[k].regOnly || {})[m]; return r ? r.sitw : 0; }), d.values.monthly[i], [d.name]); });
      if (d.values.wages !== undefined && who.length) add(d.state + ' withholding ' + q, 'State wages on the return', U.sum(monthsOfQ(q), function (m) { return U.sum(who, function (k) { var r = people[k].months[m] || (people[k].regOnly || {})[m]; return r ? r.gross : 0; }); }), d.values.wages, [d.name]);
      d.payments.forEach(function (p) { add(d.state + ' withholding ' + q, 'Payment ' + (p.date ? U.fmtDate(p.date) : '') + ' = return total', d.values.withheld, p.amount, [d.name]); });
    });
    stateDocs.filter(function (d) { return d.kind === 'stateWhPayment'; }).forEach(function (d) { d.payments.forEach(function (p) {
      var m = p.date ? p.date.slice(0, 7) : null, prev = m ? ym(+m.slice(0, 4) - (m.slice(5) === '01' ? 1 : 0), m.slice(5) === '01' ? 12 : +m.slice(5) - 1) : null;
      var month = [m, prev].find(function (k) { return k && M[k] && assign(d.state, [k], p.amount, 'sitw'); });
      add(d.state + ' withholding payments', 'Payment ' + U.fmt(p.amount, { symbol: true }) + (p.date ? ' on ' + U.fmtDate(p.date) : '') + (month ? ' = ' + month + ' state tax of ' + Object.keys(people).filter(function (k) { return people[k].states[d.state]; }).map(function (k) { return people[k].name; }).join(', ') : ' — matches no month’s state tax'), month ? p.amount : null, p.amount, [d.name], 0, month ? {} : { status: 'diff' });
    }); });
    // state tax nobody's return or payment covers
    Object.keys(people).forEach(function (k) { var p = people[k], sit = U.sum(Object.keys(p.months), function (m) { return p.months[m].sitw; });
      if (sit && !Object.keys(p.states).length && stateDocs.length) notes.push({ kind: 'missing', text: p.name + ': state tax of ' + U.fmt(sit, { symbol: true }) + ' withheld, but no state return or payment provided matches it.' }); });
    // 7. unemployment: wages per state, the return's own arithmetic, the employer SUTA in the summary
    var uiOwed = {};
    stateDocs.filter(function (d) { return d.kind === 'stateUi' || d.kind === 'stateUiWages'; }).forEach(function (d) {
      var q = d.period, V = d.values, s = [d.name]; if (!q) return;
      var who = Object.keys(d.employees).map(D.personKey).filter(function (k) { return people[k]; });
      if (!who.length && V.wages !== undefined) who = assign(d.state, monthsOfQ(q), V.wages, 'gross') || [];
      if (who.length && V.wages !== undefined) add(d.state + ' unemployment ' + q, 'Total wages = gross wages of ' + who.map(function (k) { return people[k].name; }).join(', '), U.sum(monthsOfQ(q), function (m) { return U.sum(who, function (k) { var r = people[k].months[m] || (people[k].regOnly || {})[m]; return r ? r.gross : 0; }); }), V.wages, s);
      if (V.rate && V.taxable !== undefined && V.owed !== undefined) add(d.state + ' unemployment ' + q, 'Contribution = taxable wages × ' + V.rate + '%', Math.round(V.taxable * parseFloat(V.rate) / 100), V.owed, s);
      if (d.kind === 'stateUi' && V.owed !== undefined) uiOwed[q] = (uiOwed[q] || 0) + V.owed;
    });
    src('summary').forEach(function (d) { Object.keys(d.quarters || {}).forEach(function (q) {
      var r = d.quarters[q]; if (!r.suta) return;
      if (uiOwed[q] !== undefined) add('Employer taxes', q + ' · SUTA in the summary = unemployment returns provided', r.suta, uiOwed[q], [d.name]);
      else notes.push({ kind: 'missing', text: q + ': the summary shows SUTA of ' + U.fmt(r.suta, { symbol: true }) + ' but no state unemployment return was provided.' });
      var uiTaxable = U.sum(stateDocs.filter(function (x) { return x.kind === 'stateUi' && x.period === q; }), function (x) { return x.values.taxable || 0; });
      if (r.sutaWages && uiTaxable && r.sutaWages > uiTaxable) notes.push({ kind: 'missing', text: q + ': the summary has ' + U.fmt(r.sutaWages, { symbol: true }) + ' of SUTA wages but the unemployment returns provided cover ' + U.fmt(uiTaxable, { symbol: true }) + '. Another state’s unemployment return is missing (or its rate is 0%).' });
    }); });
    // 8. FUTA: 0.6% of each employee's first $7,000 a year
    src('summary').forEach(function (d) { Object.keys(d.quarters || {}).forEach(function (q) {
      var r = d.quarters[q]; if (r.futa === undefined) return;
      var y = q.slice(0, 4), wages = 0;
      Object.keys(people).forEach(function (k) { var ytd = 0; Object.keys(Object.assign({}, people[k].regOnly || {}, people[k].months)).sort().forEach(function (m) { if (m.slice(0, 4) !== y) return; var g = (people[k].months[m] || people[k].regOnly[m]).gross || 0; var before = ytd; ytd += g; if (qOf(m) === q) wages += Math.max(0, Math.min(700000, ytd) - Math.min(700000, before)); }); });
      if (monthsOfQ(q).some(function (k) { return M[k]; })) add('Employer taxes', q + ' · FUTA 0.6% of the first $7,000 per employee', Math.round(wages * 0.006), r.futa, [d.name]);
    }); });
    var Q = groupQ(M);
    return { docs: docs, people: Object.keys(people).map(function (k) { var p = people[k]; return { name: p.name, states: Object.keys(p.states), months: Object.keys(p.months).sort() }; }),
      months: Object.keys(M).sort().map(function (k) { return M[k]; }), quarters: Object.keys(Q).sort().map(function (k) { return Q[k]; }), checks: checks, notes: notes,
      counts: { ok: checks.filter(function (c) { return c.status === 'ok'; }).length, diff: checks.filter(function (c) { return c.status === 'diff'; }).length, missing: notes.filter(function (n) { return n.kind === 'missing'; }).length } };
  };
  function groupQ(M) { var Q = {}; Object.keys(M).forEach(function (k) { var q = qOf(k), m = M[k], g = Q[q] = Q[q] || { quarter: q, gross: 0, fitw: 0, sswh: 0, mcwh: 0, sitw: 0, litw: 0, net: 0, erMc: 0, fed: 0 }; Object.keys(g).forEach(function (f) { if (f !== 'quarter') g[f] += m[f] || 0; }); }); return Q; }
  function combos(list, n) { if (!n) return [[]]; var out = []; list.forEach(function (x, i) { combos(list.slice(i + 1), n - 1).forEach(function (c) { out.push([x].concat(c)); }); }); return out; }

  /* ---------------- the report (same HTML in VaultBook and the standalone tool) ---------------- */
  D.reportHTML = function (R) {
    var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
    var $$ = function (c) { return c == null ? '' : U.fmt(c, { symbol: true }); };
    var docs = R.docs.map(function (d) {
      var what = d.kind === 'paystubs' ? d.stubs.length + ' stub' + (d.stubs.length === 1 ? '' : 's') : d.payments.length ? d.payments.map(function (p) { return $$(p.amount) + (p.date ? ' on ' + U.fmtDate(p.date) : ''); }).join(', ') : Object.keys(d.months).length ? Object.keys(d.months).length + ' months' : Object.keys(d.employees).length ? Object.keys(d.employees).length + ' employee' + (Object.keys(d.employees).length === 1 ? '' : 's') : '';
      return '<tr><td>' + esc(d.name) + '</td><td>' + esc(d.label) + (d.state ? ' · ' + esc(d.state) : '') + (d.period ? ' · ' + esc(d.period) : '') + '</td><td><span class="pdc-role pdc-' + d.role + '">' + esc({ entry: 'Makes the entry', payment: 'Tax paid', verify: 'Checks only', ignored: 'Not used' }[d.role]) + '</span> <span class="pdc-muted">' + esc(d.use) + '</span></td><td>' + esc(what) + (d.empty ? ' <span class="pdc-bad">no figures read</span>' : '') + '</td></tr>';
    }).join('');
    var people = R.people.map(function (p) { return '<tr><td>' + esc(p.name) + '</td><td>' + (p.states.length ? esc(p.states.join(', ')) : '<span class="pdc-muted">not shown by the documents</span>') + '</td><td>' + esc(p.months.length ? p.months[0] + ' – ' + p.months[p.months.length - 1] + ' (' + p.months.length + ')' : 'register only') + '</td></tr>'; }).join('');
    var months = R.months.map(function (m) { return '<tr><td>' + m.month + '</td><td class="num">' + m.people + (m.fromStubs < m.people ? ' <span class="pdc-muted">(' + (m.people - m.fromStubs) + ' from register)</span>' : '') + '</td><td class="num">' + $$(m.gross) + '</td><td class="num">' + $$(m.fitw) + '</td><td class="num">' + $$(m.sswh) + '</td><td class="num">' + $$(m.mcwh) + '</td><td class="num">' + $$(m.erMc) + '</td><td class="num">' + $$(m.sitw) + '</td><td class="num">' + $$(m.net) + '</td><td class="num">' + $$(m.fed) + '</td><td>' + (m.deposit ? '<span class="pdc-ok">✓</span> ' + $$(m.deposit.amount) + (m.deposit.date ? ' ' + U.fmtDate(m.deposit.date) : '') : '<span class="pdc-muted">—</span>') + '</td></tr>'; }).join('');
    var groups = {}; R.checks.forEach(function (c) { (groups[c.group] = groups[c.group] || []).push(c); });
    var checks = Object.keys(groups).map(function (g) {
      var L = groups[g], bad = L.filter(function (c) { return c.status !== 'ok'; });
      return '<details class="pdc-group"' + (bad.length ? ' open' : '') + '><summary>' + (bad.length ? '<span class="pdc-bad">✗ ' + bad.length + '</span>' : '<span class="pdc-ok">✓</span>') + ' ' + esc(g) + ' <span class="pdc-muted">' + L.length + ' check' + (L.length === 1 ? '' : 's') + '</span></summary><table class="pdc-table"><tbody>' +
        L.map(function (c) { return '<tr class="pdc-' + c.status + '"><td>' + (c.status === 'ok' ? '<span class="pdc-ok">✓</span>' : c.status === 'diff' ? '<span class="pdc-bad">✗</span>' : '–') + '</td><td>' + esc(c.label) + '</td><td class="num">' + $$(c.expected) + '</td><td class="num">' + $$(c.found) + '</td><td class="num">' + (c.status === 'diff' && c.expected != null && c.found != null ? '<span class="pdc-bad">' + $$(c.found - c.expected) + '</span>' : '') + '</td><td class="pdc-muted">' + esc(c.sources.slice(0, 2).join(', ')) + '</td></tr>'; }).join('') + '</tbody></table></details>';
    }).join('');
    var notes = R.notes.map(function (n) { return '<li class="pdc-' + n.kind + '">' + esc(n.text) + '</li>'; }).join('');
    return '<div class="pdc">' +
      '<p class="pdc-sum"><strong>' + R.counts.ok + '</strong> checks agree · <strong class="' + (R.counts.diff ? 'pdc-bad' : '') + '">' + R.counts.diff + '</strong> differ · <strong>' + R.counts.missing + '</strong> things not provided</p>' +
      '<h3>Documents</h3><table class="pdc-table"><thead><tr><th>File</th><th>Recognised as</th><th>Used for</th><th>Read</th></tr></thead><tbody>' + docs + '</tbody></table>' +
      (people ? '<h3>Employees</h3><table class="pdc-table"><thead><tr><th>Employee</th><th>State (from the state documents)</th><th>Paystub months</th></tr></thead><tbody>' + people + '</tbody></table>' : '') +
      (months ? '<h3>By month</h3><div class="pdc-scroll"><table class="pdc-table"><thead><tr><th>Month</th><th class="num">Employees</th><th class="num">Gross</th><th class="num">Fed. income tax</th><th class="num">SS withheld</th><th class="num">Medicare withheld</th><th class="num">Employer Medicare</th><th class="num">State tax</th><th class="num">Net pay</th><th class="num">Federal liability</th><th>EFTPS deposit</th></tr></thead><tbody>' + months + '</tbody></table></div>' : '') +
      (checks ? '<h3>Cross-checks</h3><p class="pdc-muted">Expected (worked out from the paystubs or the other documents) · Found (on the document) · Difference</p>' + checks : '') +
      (notes ? '<h3>Not provided or not matched</h3><ul class="pdc-notes">' + notes + '</ul>' : '') + '</div>';
  };
  D.CSS = '.pdc h3{font-size:14px;margin:16px 0 6px}.pdc-table{border-collapse:collapse;width:100%;font-size:13px}.pdc-table th,.pdc-table td{padding:4px 8px;border-bottom:1px solid var(--line,#d9dee7);text-align:left;vertical-align:top}.pdc-table th{font-size:11.5px;text-transform:uppercase;letter-spacing:.03em;color:var(--muted,#5d6779)}.pdc-table .num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}.pdc-scroll{overflow-x:auto}.pdc-scroll td,.pdc-scroll th{white-space:nowrap}.pdc-muted{color:var(--muted,#5d6779)}.pdc-ok{color:var(--ok,#067647);font-weight:600}.pdc-bad{color:var(--danger,#b42318);font-weight:600}.pdc-group{margin:4px 0;border:1px solid var(--line,#d9dee7);border-radius:8px;padding:6px 10px}.pdc-group summary{cursor:pointer;font-weight:600}.pdc-role{font-size:11.5px;padding:1px 7px;border-radius:99px;background:#eef1f5;white-space:nowrap}.pdc-entry{background:#e7f5ee}.pdc-payment{background:#e8f0fb}.pdc-ignored{background:#fdecea}.pdc-notes li.pdc-missing{color:var(--warn,#a15c07)}.pdc-sum{font-size:14px}';
})(typeof window !== 'undefined' ? window : globalThis);
