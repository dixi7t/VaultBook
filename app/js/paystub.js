/* VaultBook — paystubs → payroll journal entry (1.33).
 *
 * Input: page rows as the statement engine returns them, from a PDF's text layer or from OCR of a scan:
 *   [{ page, y (higher = nearer the top), items: [{ text, x, y, width }] }]
 * OB.paystub.parse(rows) finds every stub table (EARNINGS | TAXES | DEDUCTIONS with CURRENT / YTD columns, as most payroll
 * services print), reads each cell by its column position, merges the copies of the same stub (many services print the stub
 * twice a page), and proves every figure: each column adds to TOTALS, gross − taxes − deductions = net pay = the check amount.
 * A figure lost in every copy is worked out from its total and flagged. Anything that still does not tie is listed in
 * stub.issues and blocks the journal entry until corrected.
 *
 * Categories: wages (earnings), ee_ss, ee_medicare, fed, state, local, otherTax (SDI, SUI…), retirement, benefits, garnish,
 * otherDed. Employer taxes (not on a paystub) are worked out: Social Security match, 1.45% Medicare, FUTA and SUTA on wages
 * up to their bases (from the stub's YTD).
 * OB.paystub.journal(book, stubs, settings) → one journal draft for one pay date (lines per employee or summarised),
 * posted through saveTransaction like any entry. Settings live on the company (company.payroll), so they travel in backups.
 */
(function (root) {
  'use strict';
  var OB = root.OB = root.OB || {};
  var U = OB.util, P = OB.paystub = {};

  /* ---------------- amounts as OCR prints them ---------------- */
  var SEP = /[\s!:\/|'`.,;"]/;
  /** Every reading of a cell, most likely first (cents). "75000 !00", "2625000" (cents run on), "7012150" (separator read as 1). */
  P.amountCandidates = function (s) {
    var t = String(s || '').replace(/[\[\]{}$*]/g, ' ').replace(/[Oo](?=\d)|(?<=\d)[Oo]/g, '0').trim();
    var neg = /^\(.*\)$/.test(t) || /^-/.test(t); t = t.replace(/[()\-]/g, ' ').trim();
    if (!/\d/.test(t) || /[A-Za-z]{2,}/.test(t)) return [];
    var out = [], add = function (c) { if (c !== null && isFinite(c) && out.indexOf(c) < 0) out.push(c); };
    var std = /^(\d{1,3}(?:,\d{3})+|\d+)\.(\d{2})$/.exec(t);                         // 44,137.50
    if (std) { add(+std[1].replace(/,/g, '') * 100 + +std[2]); return out; }
    var m = /^(\d[\d,]*)\s*[\s!:\/|'`.;"]+\s*(\d{2})$/.exec(t);                      // 75000 !00, 1762: 50, 0/00
    if (m) add(+m[1].replace(/,/g, '') * 100 + +m[2]);
    var d = t.replace(/,/g, '');
    if (/^\d+$/.test(d)) {
      if (d.length >= 3) add(+d.slice(0, -2) * 100 + +d.slice(-2));                  // 2625000 → 26250.00
      if (d.length >= 5 && /[17]/.test(d.charAt(d.length - 3))) add(+d.slice(0, -3) * 100 + +d.slice(-2)); // 7012150 → 7012.50
      if (d.length <= 2) add(+d * 100);                                               // "0"
    }
    if (!out.length) { var g = d.match(/\d+/g) || []; if (g.length >= 2 && g[g.length - 1].length === 2) add(+g.slice(0, -1).join('') * 100 + +g[g.length - 1]); }
    return neg ? out.map(function (c) { return -c; }) : out;
  };

  /* ---------------- labels ---------------- */
  var canon = function (s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9()% ]+/g, ' ').replace(/\s+/g, ' ').trim(); };
  P.canon = canon;
  var DICT = {
    earn: [[/^TOTAL\b|^GROSS PAY$|^TOTAL GROSS/, 'subtotal'], [/REIMB/, 'reimb'], [/./, 'wages']],
    tax: [[/^MC|MEDI|MEDCR|\bMED\b|MEDICARE/, 'ee_medicare'], [/^SS|OASDI|SOC|SOCIAL|\bFICA\b/, 'ee_ss'], [/^F[IW]T|^FED|FEDERAL|\bFWT\b/, 'fed'],
      [/SDI|\bSUI|\bFLI\b|PFL|PFML|VPDI|\bTDI\b|\bWC\b|DISAB/, 'otherTax'], [/^L[IW]T|LOCAL|CITY|COUNTY|SCHOOL|\bLST\b|\bEIT\b|\bOCC\b/, 'local'],
      [/^S[IW]T|^STATE|\bS[IW]T\b|\bSWT\b|\b[A-Z]{2} (SIT|SWT|WH|INC)|STATE/, 'state']],
    ded: [[/401|403|457|ROTH|RETIRE|PENSION|SIMPLE/, 'retirement'], [/GARN|CHILD|SUPPORT|LEVY|LIEN/, 'garnish'],
      [/HEALTH|MEDICAL|MED INS|DENTAL|VISION|\bINS\b|INSUR|HSA|FSA|125|CAFE|LIFE|DISAB|BENEF/, 'benefits'], [/./, 'otherDed']]
  };
  P.LABELS = { wages: 'Gross wages', reimb: 'Reimbursement', ee_ss: 'Social Security withheld', ee_medicare: 'Medicare withheld', fed: 'Federal income tax withheld',
    state: 'State income tax withheld', local: 'Local tax withheld', otherTax: 'Other employee tax withheld', retirement: 'Retirement deduction', benefits: 'Benefit deduction',
    garnish: 'Garnishment', otherDed: 'Other deduction' };
  P.SECTION_OF = { wages: 'earn', reimb: 'earn', ee_ss: 'tax', ee_medicare: 'tax', fed: 'tax', state: 'tax', local: 'tax', otherTax: 'tax', retirement: 'ded', benefits: 'ded', garnish: 'ded', otherDed: 'ded' };
  /** Category of a stub label in its section; learned labels (company settings) win; null = unknown (ask). */
  P.classify = function (label, section, learned) {
    var c = canon(label); if (!c) return null;
    if (learned && learned[c]) return learned[c];
    var list = DICT[section] || []; for (var i = 0; i < list.length; i++) if (list[i][0].test(c)) return list[i][1];
    return null;
  };
  P.frequency = function (from, to) {
    if (!from || !to) return '';
    var d = U.daysBetween(from, to) + 1, a = +from.slice(8, 10), z = +to.slice(8, 10), end = +U.monthEnd(to).slice(8, 10);
    if (d <= 8) return 'weekly';
    if (d >= 13 && d <= 16 && ((a === 1 && z === 15) || (a === 16 && z === end))) return 'semi-monthly';
    if (d >= 13 && d <= 15) return 'bi-weekly';
    if (d >= 28 && d <= 31) return 'monthly';
    if (d >= 89 && d <= 92) return 'quarterly';
    return 'other';
  };
  var ymd = function (s) {
    var m = /(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(String(s || '')); if (!m) return '';
    var y = +m[3]; if (y < 100) y += 2000;
    var mo = +m[1], d = +m[2]; if (mo < 1 || mo > 12 || d < 1 || d > 31) return '';
    return y + '-' + (mo < 10 ? '0' : '') + mo + '-' + (d < 10 ? '0' : '') + d;
  };
  var title = function (s) { return String(s || '').toLowerCase().replace(/\b[a-z]/g, function (c) { return c.toUpperCase(); }); };

  /* ---------------- layout ---------------- */
  /** Rows of one page regrouped so words on the same printed line are one row, top to bottom. */
  function pageRows(rows) {
    var byPage = {};
    rows.forEach(function (r) { (byPage[r.page || 1] = byPage[r.page || 1] || []).push(r); });
    var out = [];
    Object.keys(byPage).sort(function (a, b) { return a - b; }).forEach(function (p) {
      var rs = byPage[p].slice().sort(function (a, b) { return b.y - a.y; });
      var gaps = []; for (var i = 1; i < rs.length; i++) gaps.push(rs[i - 1].y - rs[i].y);
      gaps.sort(function (a, b) { return a - b; });
      var tol = Math.max(2, (gaps.length ? gaps[Math.floor(gaps.length / 2)] : 10) * 0.4);
      var cur = null;
      rs.forEach(function (r) {
        if (cur && Math.abs(cur.y - r.y) < tol) { cur.items = cur.items.concat(r.items); return; }
        cur = { page: +p, y: r.y, items: r.items.slice() }; out.push(cur);
      });
    });
    out.forEach(function (r) { r.items.sort(function (a, b) { return a.x - b.x; }); r.text = r.items.map(function (i) { return i.text; }).join(' '); });
    return out;
  }
  var cx = function (it) { return it.x + (it.width || 0) / 2; };
  var isCur = function (t) { return /^cur/i.test(t); }, isYtd = function (t) { return /^y\.?t\.?d\.?$/i.test(t) || /^ytd/i.test(t); };
  function header(r) {
    var cols = r.items.filter(function (i) { return isCur(i.text) || isYtd(i.text); }).map(function (i) { return { kind: isCur(i.text) ? 'cur' : 'ytd', x: cx(i) }; });
    if (cols.filter(function (c) { return c.kind === 'cur'; }).length < 1 || cols.length < 2) return null;
    var secs = []; // [{cur, ytd}] in x order
    cols.forEach(function (c) { var last = secs[secs.length - 1]; if (c.kind === 'cur' || !last || last.ytd !== undefined) secs.push({}); secs[secs.length - 1][c.kind] = c.x; });
    secs = secs.filter(function (s) { return s.cur !== undefined; });
    secs.forEach(function (s, i) { if (s.ytd === undefined) { var w = i + 1 < secs.length ? (secs[i + 1].cur - s.cur) * 0.45 : 180; s.ytd = s.cur + w; } });
    // where each later section's label column starts (its "TYPE" heading), so a short YTD amount is not taken for the next label
    var words = r.items.filter(function (i) { return !isCur(i.text) && !isYtd(i.text) && /[A-Za-z]/.test(i.text); });
    secs.forEach(function (s, i) { if (!i) return; var w = words.filter(function (it) { return it.x > secs[i - 1].ytd && cx(it) < s.cur; }).sort(function (a, b) { return a.x - b.x; })[0]; if (w) s.lab = w.x; });
    return secs;
  }
  /** Assign a row's words to cells: section k label (left of CURRENT_k), cur_k, ytd_k. */
  function cells(r, secs) {
    var out = secs.map(function () { return { label: [], cur: [], ytd: [] }; });
    var bounds = []; // column boundaries between consecutive numeric columns
    secs.forEach(function (s) { bounds.push({ k: 0, x: s.cur }); bounds.push({ k: 1, x: s.ytd }); });
    r.items.forEach(function (it) {
      var x = cx(it), t = String(it.text || '').trim(); if (!t) return;
      var numeric = /\d/.test(t) && !/[A-Za-z]{2,}/.test(t), sepOnly = /^[!:\/|'`.]+\d{0,2}[\]|]*$/.test(t);
      // section: the first whose CURRENT column is right of the word's left edge (labels sit left of their CURRENT)
      // the next section starts where this one's YTD cell ends (its label sits right after that cell)
      var edge = function (k) { return secs[k + 1].lab !== undefined ? secs[k + 1].lab - 25 : secs[k].ytd + Math.max(40, (secs[k].ytd - secs[k].cur) * 0.5); };
      var k = 0; while (k < secs.length - 1 && x > edge(k)) k++;
      var s = secs[k], lbEdge = s.cur - Math.max(60, (s.ytd - s.cur) * 0.75);
      // a word right of this section's CURRENT is the next section's label (its YTD heading may not have been read)
      if (!numeric && !sepOnly) { if (x < s.cur) out[k].label.push(t); else if (k + 1 < secs.length) out[k + 1].label.push(t); return; }
      if (x < lbEdge && !sepOnly) { out[k].label.push(t); return; }
      (Math.abs(x - s.cur) <= Math.abs(x - s.ytd) ? out[k].cur : out[k].ytd).push(t);
    });
    // single characters in a label are column rules read as letters ("i", "|", ":")
    return out.map(function (c) { return { label: c.label.filter(function (w) { return w.length > 1; }).join(' ').replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9)]+$/g, ''), cur: c.cur.join(' '), ytd: c.ytd.join(' ') }; });
  }
  var SECTION_WORDS = [[/EARN/i, 'earn'], [/TAX/i, 'tax'], [/DEDUC|MISC|VOLUNT|OTHER/i, 'ded']];
  function sectionNames(above, secs) {
    var names = secs.map(function (s, i) { return ['earn', 'tax', 'ded'][i] || 'ded'; });
    if (!above) return names;
    var found = [];
    above.items.forEach(function (it) { SECTION_WORDS.forEach(function (w) { if (w[0].test(it.text)) found.push({ x: cx(it), name: w[1] }); }); });
    // each heading names the section nearest it, once; sections left over take the remaining names in the usual order
    // (a heading can be hidden, e.g. "EARNINGS" under a redaction mark)
    var got = secs.map(function () { return null; }), usedN = {};
    found.sort(function (a, b) { return a.x - b.x; }).forEach(function (f) {
      if (usedN[f.name]) return;
      var bi = -1; secs.forEach(function (s, i) { var mid = (s.cur + s.ytd) / 2; if (got[i] === null && (bi < 0 || Math.abs(mid - f.x) < Math.abs((secs[bi].cur + secs[bi].ytd) / 2 - f.x))) bi = i; });
      if (bi >= 0) { got[bi] = f.name; usedN[f.name] = 1; }
    });
    var rest = ['earn', 'tax', 'ded'].filter(function (n) { return !usedN[n]; });
    return got.map(function (g) { return g || rest.shift() || 'ded'; });
  }
  var NAME_JUNK = /^(SALARIED|HOURLY|EXEMPT|NON-?EXEMPT|EMPLOYEE|NAME|NUMBER|STATUS|CHECK|DATE|NO|SSN|SOCIAL|SECURITY)$/i;
  function employeeOf(rows, hi, top) {
    // the row under the "EMPLOYEE NAME" header, words in that column; falls back to two or more capitalised words
    for (var i = hi - 1; i >= Math.max(top, hi - 5); i--) {
      var h = rows[i], e = h.items.find(function (it) { return /^employee$/i.test(it.text); });
      if (!e || i + 1 >= hi + 1) continue;
      var nx = h.items.find(function (it) { return /^(number|status|dept)/i.test(it.text) && it.x > e.x + 20; });
      var r = rows[i + 1], words = r.items.filter(function (it) { return it.x >= e.x - 40 && (!nx || it.x < nx.x + (nx.width || 60)) && /^[A-Z][A-Za-z'.-]+$/.test(it.text) && /^[A-Z'.-]+$/.test(it.text) && !NAME_JUNK.test(it.text); });
      if (words.length) return { name: title(words.map(function (w) { return w.text; }).join(' ')), date: ymd(r.text) };
    }
    for (var j = hi - 1; j >= Math.max(top, hi - 5); j--) {
      var m = /\b([A-Z][A-Z'.-]+(?:\s+[A-Z][A-Z'.-]+){1,3})\b\s*(?:\d{1,6}\s+)?(?:Salaried|Hourly|\d{1,2}\/)/.exec(rows[j].text);
      if (m && !NAME_JUNK.test(m[1].split(' ')[0])) return { name: title(m[1]), date: ymd(rows[j].text) };
    }
    return { name: '', date: '' };
  }

  /* ---------------- parse ---------------- */
  P.parse = function (rowsIn, opts) {
    opts = opts || {};
    var rows = pageRows(rowsIn || []), copies = [], warnings = [];
    for (var i = 0; i < rows.length; i++) {
      var secs = header(rows[i]); if (!secs) continue;
      var names = sectionNames(rows[i - 1] && rows[i - 1].page === rows[i].page ? rows[i - 1] : null, secs);
      var prevTop = copies.length && copies[copies.length - 1].page === rows[i].page ? copies[copies.length - 1].end + 1 : 0;
      while (prevTop < i && rows[prevTop].page !== rows[i].page) prevTop++;
      var emp = employeeOf(rows, i, prevTop);
      var c = { page: rows[i].page, start: i, employee: emp.name, payDate: emp.date, lines: [], totals: null, net: null, period: null, check: null };
      var j = i + 1;
      for (; j < rows.length && rows[j].page === rows[i].page; j++) {
        if (header(rows[j])) { j--; break; }
        var cs = cells(rows[j], secs), first = canon(cs[0].label);
        if (/^TOT/.test(first) && !/WAGE|EARN|GROSS/.test(first)) { c.totals = cs; continue; }
        if (/NET\s*PAY|NETPAY|^NET\b/.test(first)) {
          c.net = cs[0]; var pm = /(\d{1,2}\/\d{1,2}\/\d{2,4})\s*(?:-|–|to|thru)\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i.exec(rows[j].text);
          if (pm) c.period = [ymd(pm[1]), ymd(pm[2])];
          continue;
        }
        if (c.net) {  // after NET PAY: the period, the check amount and date, or the next stub
          var pm2 = !c.period && /(\d{1,2}\/\d{1,2}\/\d{2,4})\s*(?:-|–|to|thru)\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i.exec(rows[j].text); if (pm2) c.period = [ymd(pm2[1]), ymd(pm2[2])];
          var ck = /\$[\s*]*([\d,]+\.\d{2})/.exec(rows[j].text);
          if (ck && !c.check) c.check = { amount: P.amountCandidates(ck[1])[0], date: ymd(rows[j].text) };
          if (/EMPLOYEE|CHECK\s*NO/i.test(rows[j].text)) { j--; break; }   // the next stub's heading: leave it for that stub
          if (j - (c.netRow || j) > 8) break;
          continue;
        }
        if (c.totals) continue;
        secs.forEach(function (s, k) {
          // a stray mark (a column rule read as ":" or "|") is not a line: it needs a label or a readable amount
          // and a scrap of letters with no amount at all ("ee", "I") is not one either unless it is a label VaultBook knows
          var noAmt = !P.amountCandidates(cs[k].cur).length && !P.amountCandidates(cs[k].ytd).length;
          if (noAmt && (!/[A-Za-z]{2}/.test(cs[k].label) || !P.classify(cs[k].label, names[k], opts.labels || {}))) return;
          c.lines.push({ section: names[k], label: cs[k].label, cur: cs[k].cur, ytd: cs[k].ytd });
        });
        if (c.net && !c.netRow) c.netRow = j;
      }
      c.end = Math.min(j, rows.length - 1); c.secNames = names;
      if (c.totals || c.net) copies.push(c);
      i = c.end;
    }
    // the check printed between two copies belongs to both
    copies.forEach(function (c, k) { if (!c.check && copies[k - 1] && copies[k - 1].check && copies[k - 1].employee === c.employee) c.check = copies[k - 1].check; });
    copies.forEach(function (c, k) { if (!c.check && copies[k + 1] && copies[k + 1].check && copies[k + 1].employee === c.employee) c.check = copies[k + 1].check; });
    // merge copies of the same stub (employee + pay date)
    var groups = [], byKey = {};
    copies.forEach(function (c) {
      if (!c.payDate) c.payDate = (c.check && c.check.date) || (c.period && c.period[1]) || '';
      var key = canon(c.employee) + '|' + c.payDate;
      if (!byKey[key]) { byKey[key] = { key: key, copies: [] }; groups.push(byKey[key]); }
      byKey[key].copies.push(c);
    });
    var stubs = groups.map(function (g) { return merge(g, opts.labels || {}); });
    if (!copies.length) warnings.push('No paystub table was found (a table with CURRENT and YTD columns).');
    return { stubs: stubs, warnings: warnings };
  };

  function merge(g, learned) {
    var cs = g.copies, base = cs[0];
    var stub = { key: g.key, employee: base.employee || 'Unknown employee', payDate: base.payDate, periodFrom: '', periodTo: '', frequency: '', copies: cs.length, pages: cs.map(function (c) { return c.page; }), lines: [], issues: [] };
    var per = cs.map(function (c) { return c.period; }).filter(Boolean)[0]; if (per) { stub.periodFrom = per[0]; stub.periodTo = per[1]; stub.frequency = P.frequency(per[0], per[1]); }
    var ck = cs.map(function (c) { return c.check; }).filter(Boolean)[0]; stub.checkAmount = ck ? ck.amount : null;
    // lines by section and order; candidates from every copy, a value seen in more copies first
    var secLines = {};
    cs.forEach(function (c) {
      var idx = {};
      c.lines.forEach(function (l) {
        var n = idx[l.section] = (idx[l.section] || 0); idx[l.section]++;
        var list = secLines[l.section] = secLines[l.section] || [];
        var t = list[n] = list[n] || { section: l.section, labels: [], cur: [], ytd: [] };
        if (l.label) t.labels.push(l.label);
        t.cur.push(P.amountCandidates(l.cur)); t.ytd.push(P.amountCandidates(l.ytd));
      });
    });
    var rank = function (lists) { var score = {}; lists.forEach(function (l) { l.forEach(function (v, i) { score[v] = (score[v] || 0) + (i === 0 ? 10 : 1); }); }); return Object.keys(score).map(Number).sort(function (a, b) { return score[b] - score[a]; }); };
    var totCands = function (k, col) { return rank(cs.map(function (c) { if (!c.totals) return []; var si = c.secNames.indexOf(k); return si < 0 ? [] : P.amountCandidates(c.totals[si][col]); })); };
    var netCands = function (col) { return rank(cs.map(function (c) { return c.net ? P.amountCandidates(c.net[col]) : []; })); };
    var totals = { earn: {}, tax: {}, ded: {} };
    ['earn', 'tax', 'ded'].forEach(function (k) {
      var list = (secLines[k] || []).filter(Boolean);
      list.forEach(function (t) {
        var label = t.labels.map(function (x) { return { x: x, c: P.classify(x, k, learned) }; }).sort(function (a, b) { return (b.c ? 1 : 0) - (a.c ? 1 : 0); })[0];
        t.label = label ? label.x : ''; t.category = label ? label.c : null; t.subtotal = t.category === 'subtotal';
        t.curC = rank(t.cur); t.ytdC = rank(t.ytd);
      });
      ['cur', 'ytd'].forEach(function (col) {
        var lines = list.filter(function (t) { return !t.subtotal && (t.label || t[col + 'C'].length); });
        var tc = totCands(k, col), sub = list.filter(function (t) { return t.subtotal; }).map(function (t) { return t[col + 'C']; })[0] || [];
        var target = tc.length ? tc : sub;
        var pick = solve(lines.map(function (t) { return t[col + 'C']; }), target);
        lines.forEach(function (t, i) { t[col] = pick.values[i]; if (pick.inferred[i]) t[col + 'Inferred'] = true; });
        list.filter(function (t) { return t.subtotal; }).forEach(function (t) { t[col] = pick.total !== null ? pick.total : t[col + 'C'][0]; });
        totals[k][col] = pick.total !== null ? pick.total : (lines.every(function (t) { return t[col] !== null && t[col] !== undefined; }) ? U.sum(lines, function (t) { return t[col]; }) : null);
      });
      list.forEach(function (t) {
        stub.lines.push({ section: k, label: t.label || '(no label)', category: t.subtotal ? 'subtotal' : t.category, subtotal: t.subtotal, current: t.cur === undefined ? null : t.cur, ytd: t.ytd === undefined ? null : t.ytd, inferred: !!t.curInferred });
      });
    });
    var ns = netCands('cur'), ny = netCands('ytd'), g0 = totals.earn.cur || 0, t0 = totals.tax.cur || 0, d0 = totals.ded.cur || 0;
    var calc = g0 - t0 - d0;
    stub.totals = { gross: totals.earn.cur, taxes: totals.tax.cur, deductions: totals.ded.cur || 0, grossYtd: totals.earn.ytd, net: ns.indexOf(calc) >= 0 ? calc : (stub.checkAmount === calc ? calc : (ns[0] !== undefined ? ns[0] : stub.checkAmount)), netYtd: ny[0] !== undefined ? ny[0] : null };
    stub.issues = P.check(stub);
    return stub;
  }
  /** Choose one candidate per line so the column adds to one of the total's candidates; fewest second choices wins.
   *  A line with no reading at all is worked out from the total (when it is the only one). */
  function solve(cands, totals) {
    var n = cands.length, best = null;
    var missing = []; cands.forEach(function (c, i) { if (!c.length) missing.push(i); });
    var choose = function (i, acc, cost, picks) {
      if (best && cost >= best.cost) return;
      if (i === n) {
        var sum = acc, ok = null;
        if (!totals.length) ok = missing.length ? null : sum;
        else if (!missing.length) { if (totals.indexOf(sum) >= 0) ok = sum; }
        else if (missing.length === 1) ok = totals[0];
        if (ok === null && totals.length) return;
        var vals = picks.slice(); if (missing.length === 1 && totals.length) vals[missing[0]] = ok - sum;
        best = { cost: cost, values: vals, total: ok, inferred: missing.length === 1 && totals.length ? (function () { var a = []; a[missing[0]] = true; return a; })() : [] };
        return;
      }
      if (!cands[i].length) { picks[i] = null; choose(i + 1, acc, cost, picks); return; }
      var lim = Math.min(cands[i].length, 3);
      for (var k = 0; k < lim; k++) { picks[i] = cands[i][k]; choose(i + 1, acc + cands[i][k], cost + k, picks); }
    };
    if (n <= 14) choose(0, 0, 0, []);
    if (!best) {   // nothing ties: first readings, flagged by check()
      var vals = cands.map(function (c) { return c.length ? c[0] : null; });
      return { values: vals, total: totals.length ? totals[0] : null, inferred: [] };
    }
    return best;
  }

  /** Every reason a stub cannot be posted as read: columns that do not add up, net pay that is not gross − taxes − deductions,
   *  the check amount, unknown labels and missing figures. */
  P.check = function (s) {
    var out = [], m = function (c) { return U.fmt(c, { symbol: true }); };
    var lines = s.lines.filter(function (l) { return !l.subtotal; });
    lines.forEach(function (l) {
      if (l.current === null || l.current === undefined) out.push('"' + l.label + '": current amount not read; type it in.');
      if (!l.category) out.push('"' + l.label + '": choose what this line is.');
    });
    var sum = function (sec) { return U.sum(lines.filter(function (l) { return l.section === sec; }), function (l) { return l.current || 0; }); };
    var g = sum('earn'), t = sum('tax'), d = sum('ded');
    if (s.totals.gross !== null && s.totals.gross !== undefined && g !== s.totals.gross) out.push('Earnings add to ' + m(g) + ' but the stub total is ' + m(s.totals.gross) + '.');
    if (s.totals.taxes !== null && s.totals.taxes !== undefined && t !== s.totals.taxes) out.push('Taxes add to ' + m(t) + ' but the stub total is ' + m(s.totals.taxes) + '.');
    if (s.totals.deductions && d !== s.totals.deductions) out.push('Deductions add to ' + m(d) + ' but the stub total is ' + m(s.totals.deductions) + '.');
    if (s.totals.net === null || s.totals.net === undefined) out.push('Net pay was not read; type it in.');
    else if (g - t - d !== s.totals.net) out.push('Gross ' + m(g) + ' − taxes ' + m(t) + ' − deductions ' + m(d) + ' = ' + m(g - t - d) + ', but net pay reads ' + m(s.totals.net) + '.');
    if (s.checkAmount !== null && s.checkAmount !== undefined && s.totals.net !== null && s.checkAmount !== s.totals.net) out.push('The check is for ' + m(s.checkAmount) + ' but net pay reads ' + m(s.totals.net) + '.');
    if (!s.payDate) out.push('Pay date not read; type it in.');
    if (!s.employee || s.employee === 'Unknown employee') out.push('Employee name not read; type it in.');
    return out;
  };
  /** Recompute totals after the user edits a line (totals follow the lines; net stays as printed so a wrong figure still shows). */
  P.retotal = function (s) {
    var lines = s.lines.filter(function (l) { return !l.subtotal; }), sum = function (sec) { return U.sum(lines.filter(function (l) { return l.section === sec; }), function (l) { return l.current || 0; }); };
    s.totals.gross = sum('earn'); s.totals.taxes = sum('tax'); s.totals.deductions = sum('ded');
    s.lines.filter(function (l) { return l.subtotal; }).forEach(function (l) { l.current = s.totals.gross; });
    s.issues = P.check(s); return s;
  };

  /* ---------------- settings (company.payroll) ---------------- */
  P.SLOTS = [
    ['wages', 'Gross wages', 'expense'], ['taxExpense', 'Employer payroll taxes', 'expense'],
    ['fed', 'Federal income tax withheld', 'liability'], ['ss', 'Social Security (employee + employer)', 'liability'], ['medicare', 'Medicare (employee + employer)', 'liability'],
    ['state', 'State income tax withheld', 'liability'], ['local', 'Local tax withheld', 'liability'], ['otherTax', 'Other employee taxes (SDI, SUI…)', 'liability'],
    ['retirement', 'Retirement deductions (401k…)', 'liability'], ['benefits', 'Benefit deductions (health…)', 'liability'], ['garnish', 'Garnishments', 'liability'], ['otherDed', 'Other deductions', 'liability'],
    ['futa', 'FUTA payable', 'liability'], ['suta', 'SUTA payable', 'liability'], ['net', 'Net pay (clearing or bank)', 'any']];
  var LIAB = { ocl: 1, ltl: 1, cc: 1 }, EXP = { expense: 1, cogs: 1, oe: 1 };
  var KEY = { wages: /SALAR|WAGE|PAYROLL EXP|OFFICER|COMPENS/, taxExpense: /PAYROLL TAX|EMPLOYER TAX|TAXES.*PAYROLL|FICA EXP/, fed: /FED|FIT\b|FEDERAL/, ss: /SOC|SOCIAL|\bSS\b|OASDI|FICA/, medicare: /MEDICARE|\bMED\b|FICA/,
    state: /STATE|\bSIT\b|\bSWT\b|\b(AZ|CA|IA|NY|NJ|PA|IL|GA|NC|OH|MI|VA|MA|WI|MN|CO|OR|MD|MO|IN|SC|AL|KY|LA|CT|UT|OK|IA|AR|MS|KS|NE|ID|WV|NM|HI|ME|MT|RI|DE|DC|VT)\b/, local: /LOCAL|CITY|COUNTY|SCHOOL/, otherTax: /SDI|\bSUI\b|DISAB|PFL|FLI/,
    retirement: /401|RETIRE|PENSION|403|457/, benefits: /HEALTH|INSUR|BENEFIT|DENTAL|VISION|HSA/, garnish: /GARN|SUPPORT|LEVY/, otherDed: /DEDUCT/, futa: /FUTA|FEDERAL UNEMP/, suta: /SUTA|\bSUI\b|STATE UNEMP|UNEMPLOY/, net: /NET PAY|CLEARING|WAGES PAYABLE|PAYROLL PAYABLE|ACCRUED PAYROLL/ };
  var full = function (book, a) { return canon((a.number ? a.number + ' ' : '') + book.accountFullName(a)); };
  function guess(book) {
    var acts = book.accounts.filter(function (a) { return a.active !== false; });
    var find = function (re, types) { return acts.find(function (a) { return types[a.type] && re.test(full(book, a)); }); };
    var payExp = find(/PAYROLL/, EXP) || find(/SALAR|WAGE/, EXP), payLiab = find(/PAYROLL LIAB|PAYROLL PAY/, LIAB) || find(/PAYROLL/, LIAB);
    var acc = {};
    P.SLOTS.forEach(function (s) {
      var k = s[0], a = null;
      if (s[2] === 'expense') a = find(KEY[k], EXP);
      else { a = acts.find(function (x) { return LIAB[x.type] && KEY[k].test(full(book, x)) && x.parentId && payLiab && x.parentId === payLiab.id; }) || find(KEY[k], LIAB); }
      if (k === 'net' && !a) a = payLiab;
      if (!a) a = s[2] === 'expense' ? payExp : payLiab;
      acc[k] = a ? a.id : '';
    });
    return acc;
  }
  P.DEFAULTS = { employer: { fica: true, futa: { rate: '0.6', base: '7000' }, suta: { rate: '', base: '' } }, detail: 'employee', labels: {} };
  P.settings = function (book) {
    var saved = (book.company && book.company.payroll) || {}, g = guess(book), acc = {};
    P.SLOTS.forEach(function (s) { var id = saved.accounts && saved.accounts[s[0]]; acc[s[0]] = id && book.accById[id] ? id : g[s[0]]; });
    return { accounts: acc, employer: U.clone(saved.employer || P.DEFAULTS.employer), detail: saved.detail || P.DEFAULTS.detail, labels: Object.assign({}, saved.labels || {}), saved: !!saved.accounts };
  };
  OB.Book.prototype.savePayroll = function (st) {
    var self = this, c = U.clone(this.company);
    c.payroll = { accounts: Object.assign({}, st.accounts), employer: U.clone(st.employer), detail: st.detail === 'summary' ? 'summary' : 'employee', labels: Object.assign({}, st.labels || {}) };
    var au = this._auditEntry('payrollSettings', '', 'Payroll settings saved (accounts for paystub journal entries)');
    return this._commit([{ store: 'company', value: c }, { store: 'audit', value: au }], function () { self.company = c; self.audit.push(au); });
  };

  /** Accounts used by an earlier payroll entry, by side, account name and line memo. */
  P.learnFromJournal = function (book, t) {
    var acc = {}, used = [];
    var lines = (t.jlines || []).map(function (l) { var a = book.accById[l.accountId]; return a ? { a: a, debit: l.debit || 0, credit: l.credit || 0, text: full(book, a) + ' ' + canon(l.memo) } : null; }).filter(Boolean);
    var dr = lines.filter(function (l) { return l.debit; }).sort(function (x, y) { return y.debit - x.debit; });
    dr.forEach(function (l, i) { if (KEY.taxExpense.test(l.text) && !acc.taxExpense) acc.taxExpense = l.a.id; else if (!acc.wages && (i === 0 || KEY.wages.test(l.text))) acc.wages = l.a.id; });
    var order = ['futa', 'suta', 'medicare', 'ss', 'fed', 'state', 'local', 'otherTax', 'retirement', 'benefits', 'garnish', 'net'];
    lines.filter(function (l) { return l.credit; }).forEach(function (l) {
      if (l.a.type === 'bank') { if (!acc.net) acc.net = l.a.id; return; }
      var k = order.find(function (s) { return !acc[s] && KEY[s].test(l.text) && !(s === 'medicare' && /SOC|OASDI|\bSS\b/.test(l.text) && !/MEDI/.test(l.text)); });
      if (k) { acc[k] = l.a.id; used.push(k); if (k === 'ss' && /FICA/.test(l.text) && !acc.medicare) acc.medicare = l.a.id; }
    });
    return { accounts: acc, slots: used };
  };

  /* ---------------- employer taxes and the journal ---------------- */
  var pct = function (v) { var n = parseFloat(String(v || '').replace(/[^0-9.]/g, '')); return isFinite(n) ? n : 0; };
  var money = function (v) { return Math.round(pct(v) * 100); };
  P.employer = function (s, st) {
    var cat = function (c) { return U.sum(s.lines.filter(function (l) { return l.category === c; }), function (l) { return l.current || 0; }); };
    var gross = U.sum(s.lines.filter(function (l) { return l.category === 'wages'; }), function (l) { return l.current || 0; });
    var ytd = s.totals.grossYtd !== null && s.totals.grossYtd !== undefined ? s.totals.grossYtd : gross, prior = Math.max(0, ytd - gross);
    var capped = function (base) { var b = money(base); if (!b) return gross; return Math.max(0, Math.min(b, ytd) - Math.min(b, prior)); };
    var e = st.employer || {}, out = { er_ss: 0, er_medicare: 0, futa: 0, suta: 0 };
    if (e.fica) { out.er_ss = cat('ee_ss'); out.er_medicare = cat('ee_medicare') ? Math.round(gross * 0.0145) : 0; }
    if (e.futa && pct(e.futa.rate)) out.futa = Math.round(capped(e.futa.base) * pct(e.futa.rate) / 100);
    if (e.suta && pct(e.suta.rate)) out.suta = Math.round(capped(e.suta.base) * pct(e.suta.rate) / 100);
    if (s.employerOverride) Object.keys(s.employerOverride).forEach(function (k) { if (s.employerOverride[k] !== null && s.employerOverride[k] !== undefined) out[k] = s.employerOverride[k]; });
    return out;
  };
  var CREDIT_SLOT = { ee_ss: 'ss', ee_medicare: 'medicare', fed: 'fed', state: 'state', local: 'local', otherTax: 'otherTax', retirement: 'retirement', benefits: 'benefits', garnish: 'garnish', otherDed: 'otherDed' };
  var ER = [['er_ss', 'Employer Social Security', 'ss'], ['er_medicare', 'Employer Medicare', 'medicare'], ['futa', 'FUTA', 'futa'], ['suta', 'SUTA', 'suta']];
  /** Journal entries already made from paystubs: { payDate: [txn] }. */
  P.posted = function (book) {
    var out = {};
    // "Paystub payroll 2026-05-31 · NAMES", or a combined entry "Paystub payroll 2026-01-31, 2026-02-28, … · NAMES"
    book.posted().forEach(function (t) { var r = t.type === 'journal' && /^Paystub payroll ([^·]*)/.exec(t.importRef || ''); if (r) (r[1].match(/\d{4}-\d{2}-\d{2}/g) || []).forEach(function (d) { (out[d] = out[d] || []).push(t); }); });
    return out;
  };
  /** One journal entry for the stubs of one pay date. → { draft, errors, warnings, employer: {stubKey: {...}} } */
  P.journal = function (book, stubs, st) {
    var errors = [], warnings = [], A = st.accounts || {}, lines = [], date = stubs[0] && stubs[0].payDate;
    if (!date) errors.push('The pay date is missing.');
    stubs.forEach(function (s) { if (s.payDate !== date) errors.push(s.employee + ' has a different pay date.'); });
    stubs.forEach(function (s) { (s.issues && s.issues.length ? s.issues : P.check(s)).forEach(function (x) { errors.push(s.employee + ': ' + x); }); });
    var done = (P.posted(book)[date] || []);
    stubs.forEach(function (s) { if (done.some(function (t) { return (t.importRef || '').toUpperCase().indexOf(canon(s.employee)) >= 0; })) errors.push(s.employee + ': payroll for ' + U.fmtDate(date) + ' is already posted (' + done.map(function (t) { return t.number; }).join(', ') + ').'); });
    var need = {}, ers = {};
    var add = function (slot, side, amount, memo) { if (!amount) return; need[slot] = 1; lines.push({ slot: slot, accountId: A[slot] || '', debit: side === 'D' ? amount : 0, credit: side === 'C' ? amount : 0, memo: memo }); };
    stubs.forEach(function (s) {
      var who = s.employee, e = ers[s.key] = P.employer(s, st);
      var gross = U.sum(s.lines.filter(function (l) { return l.category === 'wages'; }), function (l) { return l.current || 0; });
      add('wages', 'D', gross, who + ' - Gross wages');
      var reimb = U.sum(s.lines.filter(function (l) { return l.category === 'reimb'; }), function (l) { return l.current || 0; }); add('wages', 'D', reimb, who + ' - Reimbursement');
      ER.forEach(function (x) { add('taxExpense', 'D', e[x[0]], who + ' - ' + x[1]); });
      s.lines.filter(function (l) { return CREDIT_SLOT[l.category]; }).forEach(function (l) { add(CREDIT_SLOT[l.category], 'C', l.current || 0, who + ' - ' + (P.LABELS[l.category] || l.label)); });
      ER.forEach(function (x) { add(x[2], 'C', e[x[0]], who + ' - ' + x[1] + ' payable'); });
      add('net', 'C', s.totals.net || 0, who + ' - Net pay');
    });
    if (st.detail === 'summary') {   // one line per account and kind of amount
      var by = {}, out = [];
      lines.forEach(function (l) { var kind = l.memo.replace(/^.* - /, ''), k = l.slot + '|' + (l.debit ? 'D' : 'C') + '|' + kind; if (!by[k]) { by[k] = Object.assign({}, l, { memo: kind, n: 0, debit: 0, credit: 0 }); out.push(by[k]); } by[k].debit += l.debit; by[k].credit += l.credit; by[k].n++; });
      out.forEach(function (l) { if (l.n > 1) l.memo += ' (' + l.n + ' employees)'; delete l.n; });
      lines = out;
    }
    Object.keys(need).forEach(function (slot) { if (!A[slot] || !book.accById[A[slot]]) errors.push('Choose the account for "' + P.SLOTS.find(function (x) { return x[0] === slot; })[1] + '" in Payroll settings.'); });
    var dr = U.sum(lines, function (l) { return l.debit; }), cr = U.sum(lines, function (l) { return l.credit; });
    if (dr !== cr) errors.push('The entry does not balance by ' + U.fmt(dr - cr, { symbol: true }) + ' (a stub figure is wrong).');
    var freq = stubs.map(function (s) { return s.frequency; }).filter(Boolean)[0] || '';
    var per = stubs[0] && stubs[0].periodFrom ? U.fmtDate(stubs[0].periodFrom) + ' – ' + U.fmtDate(stubs[0].periodTo) : '';
    var draft = { type: 'journal', date: date, number: 'PR-' + date, memo: 'Payroll' + (freq ? ' (' + freq + ')' : '') + ' - pay date ' + U.fmtDate(date) + (per ? ', period ' + per : '') + ', ' + stubs.length + ' employee' + (stubs.length === 1 ? '' : 's') + ' (from paystubs)',
      importRef: 'Paystub payroll ' + date + ' · ' + stubs.map(function (s) { return s.employee.toUpperCase(); }).join(', '),
      jlines: lines.map(function (l) { return { accountId: l.accountId, debit: l.debit, credit: l.credit, memo: l.memo }; }) };
    return { draft: draft, errors: errors, warnings: warnings, employer: ers, totalDebit: dr, totalCredit: cr };
  };

  /** Several pay dates' journal drafts as ONE entry, dated the last pay date. Lines with the same account, memo and side are
   *  added together (per employee and item, or per item when the drafts were summarised). */
  P.mergeDrafts = function (drafts) {
    drafts = drafts.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    if (drafts.length < 2) return drafts[0];
    var by = {}, out = [];
    drafts.forEach(function (d) { d.jlines.forEach(function (l) {
      var k = l.accountId + '|' + l.memo + '|' + (l.debit ? 'D' : 'C');
      if (!by[k]) { by[k] = { accountId: l.accountId, memo: l.memo, debit: 0, credit: 0 }; out.push(by[k]); }
      by[k].debit += l.debit || 0; by[k].credit += l.credit || 0;
    }); });
    var first = drafts[0], lastD = drafts[drafts.length - 1];
    var freq = (/\((weekly|bi-weekly|semi-monthly|monthly|quarterly|other)\)/.exec(first.memo) || [])[1];
    var people = (/(\d+) employees?/.exec(lastD.memo) || [])[1];
    return { type: 'journal', date: lastD.date, number: 'PR-' + lastD.date,
      memo: 'Payroll' + (freq ? ' (' + freq + ')' : '') + ' - ' + drafts.length + ' pay dates ' + U.fmtDate(first.date) + ' to ' + U.fmtDate(lastD.date) + (people ? ', ' + people + ' employee' + (people === '1' ? '' : 's') : '') + ' (from paystubs, combined)',
      importRef: 'Paystub payroll ' + drafts.map(function (d) { return d.date; }).join(', ') + ' · ' + drafts.map(function (d) { return (d.importRef || '').split(' · ')[1] || ''; }).join(', ').split(', ').filter(function (n, i, a) { return n && a.indexOf(n) === i; }).join(', '), jlines: out };
  };

  /** QuickBooks Desktop .iif for journal drafts whose accountId is a QuickBooks account NAME ("Payroll Liabilities:FUTA").
   *  opts.create: also write !ACCNT rows (parents first) so QuickBooks creates missing accounts; opts.types: { name: 'EXP'|'OCLIAB'|'BANK'|… }. */
  P.toIIF = function (drafts, opts) {
    opts = opts || {};
    // plain ASCII: QuickBooks reads .iif as ANSI ("–" would arrive garbled)
    var clean = function (t) { return String(t || '').replace(/[\u2013\u2014]/g, '-').replace(/[\u2018\u2019]/g, "'").replace(/[\t\r\n"]+/g, ' ').replace(/[^\x20-\x7e]/g, '').trim(); };
    // QuickBooks DOCNUM holds at most 11 characters: PR-2026-05-31 → PR053126
    var docnum = function (n) { var m = /^PR-(\d{2})(\d{2})-(\d{2})-(\d{2})$/.exec(n || ''); return m ? 'PR' + m[3] + m[4] + m[2] : clean(n).slice(0, 11); };
    var amt = function (c) { return (c < 0 ? '-' : '') + (Math.abs(c) / 100).toFixed(2); };
    var mdy = function (d) { return d.slice(5, 7) + '/' + d.slice(8, 10) + '/' + d.slice(0, 4); };
    var out = [];
    if (opts.create) {
      var seen = {};
      out.push('!ACCNT\tNAME\tACCNTTYPE');
      drafts.forEach(function (d) { d.jlines.forEach(function (l) {
        var parts = clean(l.accountId).split(':'), type = (opts.types || {})[l.accountId] || 'EXP';
        parts.forEach(function (x, i) { var n = parts.slice(0, i + 1).join(':'); if (!seen[n]) { seen[n] = 1; out.push('ACCNT\t' + n + '\t' + type); } });
      }); });
    }
    out.push('!TRNS\tTRNSID\tTRNSTYPE\tDATE\tACCNT\tNAME\tAMOUNT\tDOCNUM\tMEMO', '!SPL\tSPLID\tTRNSTYPE\tDATE\tACCNT\tNAME\tAMOUNT\tDOCNUM\tMEMO', '!ENDTRNS');
    drafts.forEach(function (d) {
      d.jlines.forEach(function (l, i) {
        var memo = i ? l.memo : d.memo + ' - ' + l.memo;   // the entry's memo (frequency, pay date, period) rides on its first line
        out.push([i ? 'SPL' : 'TRNS', '', 'GENERAL JOURNAL', mdy(d.date), clean(l.accountId), '', amt((l.debit || 0) - (l.credit || 0)), docnum(d.number), clean(memo)].join('\t'));
      });
      out.push('ENDTRNS');
    });
    return out.join('\r\n') + '\r\n';
  };

  /** Wages paid this year before the pay date: the stubs' YTD against the wages account in the books (a missing month shows here). */
  P.ytdGap = function (book, stubs, st) {
    var date = stubs[0] && stubs[0].payDate; if (!date) return null;
    var y = date.slice(0, 4) + '-01-01', wid = st.accounts.wages;
    var priorStub = U.sum(stubs, function (s) { var g = U.sum(s.lines.filter(function (l) { return l.category === 'wages'; }), function (l) { return l.current || 0; }); return s.totals.grossYtd !== null && s.totals.grossYtd !== undefined ? s.totals.grossYtd - g : 0; });
    var priorBooks = 0;
    book.posted().forEach(function (t) { if (t.date < y || t.date >= date) return; (t.splits || []).forEach(function (sp) { if (sp.accountId === wid && sp.amount > 0) priorBooks += sp.amount; }); });
    var current = U.sum(stubs, function (s) { return U.sum(s.lines.filter(function (l) { return l.category === 'wages'; }), function (l) { return l.current || 0; }); });
    var missing = priorStub - priorBooks, periods = current ? Math.round(missing / current * 10) / 10 : 0;
    var message = !priorStub ? '' : missing === 0 ? 'Wages before this pay date tie: the books and the paystubs both show ' + U.fmt(priorBooks, { symbol: true }) + ' this year.'
      : missing > 0 ? 'The paystubs say ' + U.fmt(priorStub, { symbol: true }) + ' of wages was paid this year before ' + U.fmtDate(date) + '; the books have ' + U.fmt(priorBooks, { symbol: true }) + ' in that account. ' + U.fmt(missing, { symbol: true }) + ' is missing' + (periods ? ' (about ' + periods + ' pay period' + (periods === 1 ? '' : 's') + ' at this pay, or ' + Math.round(periods) + ' months if monthly)' : '') + '.'
      : 'The books show ' + U.fmt(-missing, { symbol: true }) + ' more wages before ' + U.fmtDate(date) + ' than the paystubs\' YTD (other employees or entries in that account?).';
    return { priorStub: priorStub, priorBooks: priorBooks, missing: missing, message: message };
  };
})(typeof window !== 'undefined' ? window : globalThis);
