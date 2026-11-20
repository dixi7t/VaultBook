/* VaultBook — interactive financial workbook (one .xlsx per company).
 * Source of truth: R.entries (the engine's posted lines for the chosen basis) written once to "Data - Ledger Lines".
 * Every report sheet is SUMIFS / COUNTIFS formulas over that sheet, driven by the FromDate / ToDate cells on the
 * Dashboard, so changing the dates re-runs every report inside Excel. Each formula and its cached value are generated
 * from the same criteria list (F.sumifs), so the file opens with VaultBook's figures and recalculates to the same ones.
 * Drill-down uses native internal hyperlinks: statement → details → account ledger → journal entry, with links back.
 * The file is a snapshot: nothing in Excel writes back to VaultBook.
 */
(function (root) {
  'use strict';
  var OB = root.OB = root.OB || {};
  var U = OB.util, S = OB.schema, R = OB.reports;
  var W = OB.workbook = {};
  W.MAX_ROWS = 1048576; // Excel's row limit per sheet

  W.SHEETS = [
    ['dash', 'Dashboard'], ['pl', 'Profit & Loss'], ['bs', 'Balance Sheet'], ['cf', 'Cash Flow'], ['tb', 'Trial Balance'], ['gl', 'General Ledger'],
    ['inc', 'Income Details'], ['exp', 'Expense Details'], ['ar', 'AR Aging'], ['ap', 'AP Aging'], ['je', 'Journal Entries'], ['idx', 'Account Index'],
    ['my', 'My Analysis'], ['data', 'Data - Ledger Lines']
  ];
  W.REQUIRED = { dash: 1, data: 1 };
  var NAME = {}; W.SHEETS.forEach(function (s) { NAME[s[0]] = s[1]; });
  var q = function (k) { return "'" + NAME[k].replace(/'/g, "''") + "'"; };

  /* ---------- styles ---------- */
  var MONEY = '#,##0.00;-#,##0.00;"–"', DATE = 'mm/dd/yyyy', PCT = '0.0%';
  var TAB = { dash: '1F3864', pl: '2E75B6', bs: '2E75B6', cf: '2E75B6', tb: '2E75B6', gl: '2F8F83', inc: '2F8F83', exp: '2F8F83', ar: '2F8F83', ap: '2F8F83', je: '2F8F83', idx: '2F8F83', my: '70AD47', data: '808080' };
  var st = {
    title: { bold: true, size: 15 }, sub: { bold: true, size: 12 }, note: { italic: true, color: '595959' },
    head: { bold: true, fill: 'head', border: 'bottom' }, sec: { bold: true, fill: 'F2F2F2' },
    money: { fmt: MONEY }, total: { fmt: MONEY, bold: true, border: 'top' }, grand: { fmt: MONEY, bold: true, border: 'double' },
    date: { fmt: DATE }, input: { fmt: DATE, bold: true, fill: 'FFF2CC', border: 'bottom' }, pct: { fmt: PCT }
  };
  var cell = function (v, s, extra) { return Object.assign({ v: v }, s || {}, extra || {}); };

  /* ---------- criteria → formula text and cached value from one definition ---------- */
  // cond value: { name: 'FromDate', val } | { ref: '$A12', val } | { text: 'P&L' } | { num: 5 } (numeric literal)
  function crit(op, x) {
    var p = op === '=' ? '' : op;
    if (x.text !== undefined) return '"' + p + String(x.text).replace(/"/g, '""') + '"';
    var r = x.name || x.ref;
    return p ? '"' + p + '"&' + r : r;
  }
  function test(v, op, w) { return op === '=' ? v === w : op === '>=' ? v >= w : op === '<=' ? v <= w : op === '<' ? v < w : op === '>' ? v > w : v !== w; }
  function makeF(lines) {
    var F = {};
    /** SUMIFS(L_<col>, L_<field>, crit, …) with its value over the exported lines. */
    F.sumifs = function (col, conds, sign) {
      var f = 'SUMIFS(L_' + col + conds.map(function (c) { return ',L_' + c[0] + ',' + crit(c[1], c[2]); }).join('') + ')';
      var v = 0;
      for (var i = 0; i < lines.length; i++) {
        var l = lines[i], ok = true;
        for (var k = 0; k < conds.length && ok; k++) { var c = conds[k], w = c[2].text !== undefined ? c[2].text : c[2].val; ok = test(l[c[0]], c[1], w); }
        if (ok) v += l[col];
      }
      v = Math.round(v * 100) / 100;
      return sign === -1 ? { f: '-' + f, v: v === 0 ? 0 : -v } : { f: f, v: v };
    };
    F.countifs = function (conds) {
      var f = 'COUNTIFS(' + conds.map(function (c) { return 'L_' + c[0] + ',' + crit(c[1], c[2]); }).join(',') + ')';
      var v = lines.filter(function (l) { return conds.every(function (c) { return test(l[c[0]], c[1], c[2].text !== undefined ? c[2].text : c[2].val); }); }).length;
      return { f: f, v: v };
    };
    return F;
  }
  var add = function (a, b, op) { return { f: a.f + (op || '+') + (/^-/.test(b.f) ? '(' + b.f + ')' : b.f), v: Math.round(((a.v || 0) + (op === '-' ? -1 : 1) * (b.v || 0)) * 100) / 100 }; };
  var sumRefs = function (col, rowsIdx, vals) { return { f: rowsIdx.length ? 'SUM(' + rowsIdx.map(function (r) { return col + (r + 1); }).join(',') + ')' : '0', v: Math.round(vals.reduce(function (s, x) { return s + (x || 0); }, 0) * 100) / 100 }; };

  /* ---------- build ---------- */
  /**
   * o: { from, to (YYYY-MM-DD), basis, sheets: { key: true } (optional subset), protect: bool, includeAllAccounts: bool, now: Date }
   * Returns { sheets, names, props, stats }; W.build(book, o) returns the .xlsx bytes.
   */
  W.plan = function (book, o) {
    o = o || {};
    var X = OB.xlsx, basis = R.basis(book, o), from = o.from, to = o.to;
    if (!U.isDate(from) || !U.isDate(to) || from > to) throw new Error('Choose a valid reporting period.');
    var want = function (k) { return W.REQUIRED[k] || !o.sheets || o.sheets[k]; };
    var fyMonth = book.company.fiscalYearStartMonth || 1, serial = X.serial, now = o.now || new Date();
    var fromS = serial(from), toS = serial(to), fys = U.fiscalYearStart(to, fyMonth), fysS = serial(fys);
    var pyTo = U.addMonths(to, -12), pyFrom = U.addMonths(from, -12), pyFys = U.fiscalYearStart(pyTo, fyMonth);
    var ent = R.entries(book, basis);
    var reAcc = book.sys('RE'), arAcc = book.sys('AR'), apAcc = book.sys('AP');
    var accs = book.sortedAccounts();

    /* account keys: stable text ids used by every SUMIFS (kept in hidden column A of each report) */
    var KEY = {}, byKey = {};
    accs.forEach(function (a, i) { KEY[a.id] = 'K' + ('000' + (i + 1)).slice(-4); byKey[KEY[a.id]] = a; });
    var group = function (a) { var t = S.TYPE[a.type]; return t.pl ? (a.type === 'income' ? 'Income' : a.type === 'oi' ? 'Other Income' : a.type === 'cogs' ? 'Cost of Goods Sold' : a.type === 'expense' ? 'Expense' : 'Other Expense') : (t.cls === 'asset' ? 'Asset' : t.cls === 'liability' ? 'Liability' : 'Equity'); };
    var side = function (a) { return a.type === 'income' || a.type === 'oi' ? 'Income' : S.isPL(a.type) ? 'Expense' : ''; };

    /* journal references: one per posted transaction, in date order */
    var posted = book.posted().slice().sort(OB.Book.cmpTxn), JE = {};
    posted.forEach(function (t, i) { JE[t.id] = 'JE-' + ('00000' + (i + 1)).slice(-6); });
    var contactName = function (id) { return id && book.contactById[id] ? book.contactById[id].name : ''; };

    /* ---- source lines (all dates up to ToDate, so balances and any earlier period work) ---- */
    var lines = [];
    accs.forEach(function (a) {
      (ent[a.id] || []).forEach(function (e) {
        if (e.t.date > to) return;
        var amt = e.s.amount, sg = book.normalSign(a);
        lines.push({ t: e.t, i: e.i, acc: a, Date: serial(e.t.date), date: e.t.date, JE: JE[e.t.id] || '', Key: KEY[a.id], Stmt: S.isPL(a.type) ? 'P&L' : 'BS', Group: group(a), Side: side(a),
          Cash: S.TYPE[a.type].cash ? 'Yes' : 'No', Name: contactName(e.s.contactId || e.t.contactId) || '(no name)', Type: S.TXN_TYPES[e.t.type].label,
          Debit: amt > 0 ? amt / 100 : 0, Credit: amt < 0 ? -amt / 100 : 0, Net: amt / 100, Amt: sg * amt / 100, memo: e.s.memo || e.t.memo || '', cls: e.s.classId ? book.classFullName(e.s.classId) : '' });
      });
    });
    lines.sort(function (x, y) { return x.date < y.date ? -1 : x.date > y.date ? 1 : x.JE < y.JE ? -1 : x.JE > y.JE ? 1 : x.i - y.i; });
    if (lines.length + 10 > W.MAX_ROWS) throw new Error('This company has ' + lines.length.toLocaleString() + ' ledger lines up to ' + U.fmtDate(to) + ', more than one Excel sheet can hold (' + W.MAX_ROWS.toLocaleString() + ' rows). Export an earlier "To" date, or use CSV.');
    var F = makeF(lines);
    var hasData = {}; lines.forEach(function (l) { hasData[l.acc.id] = 1; });
    var listAccs = function (filter) { return accs.filter(function (a) { return filter(a) && (o.includeAllAccounts || hasData[a.id]); }); };
    // Retained Earnings always appears: it carries earlier years' profit even with no postings of its own
    var withRE = function (list, yes) { if (yes && reAcc && list.indexOf(reAcc) < 0) { list = list.concat([reAcc]).sort(function (x, y) { return accs.indexOf(x) - accs.indexOf(y); }); } return list; };
    var FROM = { name: 'FromDate', val: fromS }, TO = { name: 'ToDate', val: toS }, FYS = { name: 'FYStart', val: fysS };
    var inPer = [['Date', '>=', FROM], ['Date', '<=', TO]];
    var keyC = function (r, a) { return ['Key', '=', { ref: '$A' + (r + 1), val: KEY[a.id] }]; };

    var sheets = {}, anchors = { gl: {}, je: {} };
    var mk = function (k) { return (sheets[k] = { key: k, name: NAME[k], rows: [], rowMeta: {}, tabColor: TAB[k], merges: [], cond: [], validations: [], gridlines: k === 'data' || k === 'je' || k === 'gl' }); };
    var glLink = function (a) { return want('gl') && anchors.gl[a.id] !== undefined ? q('gl') + '!B' + (anchors.gl[a.id] + 1) : want('idx') ? q('idx') + '!A1' : null; };
    var withLink = function (c, loc) { if (loc) c.link = loc; return c; };
    var header = function (sh, title, extra) {
      sh.rows.push([null, cell(book.company.name, st.title)]);
      sh.rows.push([null, cell(title, st.sub)]);
      sh.rows.push([null, cell(extra || '', st.note)]);
      var nav = [null, withLink(cell('← Dashboard'), q('dash') + '!A1')];
      sh.rows.push(nav);
      return nav;
    };
    var periodText = function () { return { f: '"For "&TEXT(FromDate,"mmmm d, yyyy")&" – "&TEXT(ToDate,"mmmm d, yyyy")&" · ' + (basis === 'cash' ? 'Cash' : 'Accrual') + ' basis"', v: 'For ' + longDate(from) + ' – ' + longDate(to) + ' · ' + (basis === 'cash' ? 'Cash' : 'Accrual') + ' basis' }; };
    var asOfText = function () { return { f: '"As of "&TEXT(ToDate,"mmmm d, yyyy")&" · ' + (basis === 'cash' ? 'Cash' : 'Accrual') + ' basis"', v: 'As of ' + longDate(to) + ' · ' + (basis === 'cash' ? 'Cash' : 'Accrual') + ' basis' }; };
    var fv = function (x, style, extra) { return Object.assign({ f: x.f, v: x.v }, style || {}, extra || {}); };

    /* ===== Data sheet (original accounting data) ===== */
    var D = mk('data');
    D.rows.push([cell('ORIGINAL VAULTBOOK DATA — every posted ledger line (' + (basis === 'cash' ? 'cash' : 'accrual') + ' basis) through ' + U.fmtDate(to) + '. Every report in this workbook reads this sheet.', { bold: true, color: 'FFFFFF', fill: '595959' })]);
    D.rows.push([cell('Exported ' + now.toLocaleString('en-US') + ' from VaultBook. Do not edit these rows — put your own work on new sheets or columns to the right. Changes here never reach VaultBook.', st.note)]);
    D.rows.push([]);
    var DCOLS = ['Line', 'Date', 'JE Ref', 'Type', 'No.', 'Account Key', 'Account No.', 'Account', 'Account Type', 'Group', 'Statement', 'Side', 'Cash', 'Name', 'Memo', 'Class', 'Debit', 'Credit', 'Net', 'Amount', 'VaultBook ID'];
    var DFIELD = { Date: 'B', JE: 'C', Type: 'D', Key: 'F', Group: 'J', Stmt: 'K', Side: 'L', Cash: 'M', Name: 'N', Debit: 'Q', Credit: 'R', Net: 'S', Amt: 'T' };
    D.rows.push(DCOLS.map(function (h) { return cell(h, st.head); }));
    var d0 = D.rows.length;
    lines.forEach(function (l, i) {
      l.row = D.rows.length;
      D.rows.push([cell('L' + ('00000' + (i + 1)).slice(-6)), cell(l.Date, st.date), l.JE, l.Type, l.t.number || '', l.Key, l.acc.number || '', book.accountFullName(l.acc), S.TYPE[l.acc.type].label, l.Group, l.Stmt, l.Side, l.Cash, l.Name, l.memo, l.cls,
        cell(l.Debit, st.money), cell(l.Credit, st.money), cell(l.Net, st.money), cell(l.Amt, st.money), l.t.id]);
    });
    if (!lines.length) D.rows.push([]);
    var dLast = Math.max(d0, D.rows.length - 1);
    D.tables = [{ name: 'VB_Lines', ref: 'A' + d0 + ':' + X.colName(DCOLS.length - 1) + (dLast + 1), columns: DCOLS, style: 'TableStyleLight1' }];
    D.cols = [8, 11, 11, 16, 9, 9, 10, 34, 20, 16, 9, 9, 6, 24, 30, 14, 12, 12, 12, 12, 22].map(function (w) { return { width: w }; });
    D.freeze = { row: d0, col: 0 };
    D.page = { orientation: 'landscape', titles: [d0, d0] };
    if (o.protect) D.protect = true;
    var names = Object.keys(DFIELD).map(function (k) { return { name: 'L_' + k, ref: q('data') + '!$' + DFIELD[k] + '$' + (d0 + 1) + ':$' + DFIELD[k] + '$' + (dLast + 1) }; });

    /* ===== Journal Entries (every posted transaction in the export period, all its lines) ===== */
    var J = mk('je');
    if (want('je')) {
      header(J, 'Journal Entries', 'Every transaction from ' + U.fmtDate(from) + ' to ' + U.fmtDate(to) + ' with all its debit and credit lines (as posted). Use the filter buttons to search by account, name or type.');
      J.rows[3].push(null, withLink(cell('← General Ledger'), want('gl') ? q('gl') + '!A1' : null));
      var jTot = J.rows.length;
      J.rows.push([]);
      J.rows.push([]);
      var JCOLS = ['JE Ref', 'Date', 'Type', 'No.', 'Name', 'Account', 'Debit', 'Credit', 'Line memo', 'Memo', 'VaultBook ID'];
      var jh = J.rows.length;
      J.rows.push(JCOLS.map(function (h) { return cell(h, st.head); }));
      var jd = 0, jc = 0, jRows = [];
      posted.forEach(function (t) {
        if (t.date < from || t.date > to) return;
        anchors.je[t.id] = J.rows.length;
        t.splits.forEach(function (s, k) {
          var a = book.accById[s.accountId];
          jRows.push({ row: J.rows.length, accountId: s.accountId });
          J.rows.push([cell(JE[t.id], k ? {} : { bold: true }), cell(serial(t.date), st.date), S.TXN_TYPES[t.type].label, t.number || '', contactName(s.contactId || t.contactId), a ? book.accountLabel(a.id) : '(missing account)',
            cell(s.amount > 0 ? s.amount / 100 : 0, st.money), cell(s.amount < 0 ? -s.amount / 100 : 0, st.money), s.memo || '', k ? '' : t.memo || '', t.id]);
          if (s.amount > 0) jd += s.amount; else jc -= s.amount;
        });
      });
      if (J.rows.length === jh + 1) J.rows.push([]);
      var jl = J.rows.length;
      J.rows[jTot] = [null, cell('Shown lines: debits', { bold: true }), fv({ f: 'SUBTOTAL(109,G' + (jh + 2) + ':G' + jl + ')', v: jd / 100 }, st.total), cell('credits', { bold: true }), fv({ f: 'SUBTOTAL(109,H' + (jh + 2) + ':H' + jl + ')', v: jc / 100 }, st.total),
        fv({ f: 'IF(ROUND(C' + (jTot + 1) + '-E' + (jTot + 1) + ',2)=0,"✓ Debits equal credits","✗ Debits and credits differ")', v: jd === jc ? '✓ Debits equal credits' : '✗ Debits and credits differ' }, { bold: true })];
      J.tables = [{ name: 'VB_Journal', ref: 'A' + (jh + 1) + ':K' + jl, columns: JCOLS, style: 'TableStyleLight9' }];
      J.cols = [11, 11, 16, 9, 24, 34, 13, 13, 26, 26, 22].map(function (w) { return { width: w }; });
      J.freeze = { row: jh + 1, col: 1 };
      J.page = { fitWidth: true, orientation: 'landscape', titles: [jh + 1, jh + 1], footer: '&L' + book.company.name.replace(/&/g, '&&') + ' — Journal Entries&RPage &P of &N' };
      if (o.protect) J.protect = true;
      J._jRows = jRows;
    }

    /* ===== General Ledger (per account: opening, lines, running balance, closing) ===== */
    var G = mk('gl');
    if (want('gl')) {
      header(G, 'General Ledger', 'Lines from ' + U.fmtDate(from) + ' to ' + U.fmtDate(to) + '. Opening and closing balances, totals and running balances follow the Dashboard dates; lines outside them show “No” in the last column (filter it).');
      G.rows.push([]);
      var gh = G.rows.length;
      G.rows.push(['Key', 'Date', 'JE Ref', 'Type', 'No.', 'Name', 'Memo', 'Debit', 'Credit', 'Balance', 'In period'].map(function (h, i) { return cell(h, i ? st.head : {}); }));
      var glEnding = {};
      accs.forEach(function (a) {
        var ls = lines.filter(function (l) { return l.acc.id === a.id && l.date >= from && l.date <= to; });
        var pl = S.isPL(a.type), sg = book.normalSign(a);
        var hasBefore = !pl && lines.some(function (l) { return l.acc.id === a.id && l.date < from; });
        if (!ls.length && !hasBefore && !o.includeAllAccounts) return;
        var hr = G.rows.length; anchors.gl[a.id] = hr;
        var back = pl ? (a.type === 'income' || a.type === 'oi' ? 'inc' : 'exp') : 'bs';
        G.rows.push([KEY[a.id], cell(book.accountLabel(a.id), st.sec), cell('', st.sec), cell('', st.sec), cell('', st.sec), cell('', st.sec), withLink(cell('← ' + NAME[want(back) ? back : 'idx'], st.sec), want(back) ? q(back) + '!A1' : (want('idx') ? q('idx') + '!A1' : null)), cell('', st.sec), cell('', st.sec), cell(S.TYPE[a.type].label, Object.assign({ italic: true }, st.sec)), cell('Section', st.sec)]);
        var op = pl ? { f: '0', v: 0 } : F.sumifs('Net', [keyC(G.rows.length, a), ['Date', '<', FROM]], sg);
        var orow = G.rows.length;
        G.rows.push([KEY[a.id], null, null, null, null, null, cell(pl ? 'Beginning balance (income and expense accounts start at zero)' : 'Beginning balance', { italic: true }), null, null, fv(op, st.total), cell('Section')]);
        G.rowMeta[orow] = { level: 1 };
        var bal = op.v, prev = orow;
        ls.forEach(function (l) {
          var r = G.rows.length, inR = l.date >= from && l.date <= to;
          bal = Math.round((bal + (inR ? sg * l.Net : 0)) * 100) / 100;
          G.rows.push([KEY[a.id], cell(l.Date, st.date), withLink(cell(l.JE), anchors.je[l.t.id] !== undefined ? q('je') + '!A' + (anchors.je[l.t.id] + 1) : null), l.Type, l.t.number || '', l.Name === '(no name)' ? '' : l.Name, l.memo,
            cell(l.Debit, st.money), cell(l.Credit, st.money), fv({ f: 'J' + (prev + 1) + '+IF(K' + (r + 1) + '="Yes",' + (sg < 0 ? '-' : '') + '(H' + (r + 1) + '-I' + (r + 1) + '),0)', v: bal }, st.money),
            fv({ f: 'IF(AND(B' + (r + 1) + '>=FromDate,B' + (r + 1) + '<=ToDate),"Yes","No")', v: inR ? 'Yes' : 'No' })]);
          G.rowMeta[r] = { level: 1 };
          prev = r;
        });
        var tr = G.rows.length;
        var dr = F.sumifs('Debit', [keyC(tr, a)].concat(inPer)), cr = F.sumifs('Credit', [keyC(tr, a)].concat(inPer));
        var end = { f: 'J' + (orow + 1) + (sg < 0 ? '-(' : '+(') + 'H' + (tr + 1) + '-I' + (tr + 1) + ')', v: Math.round((op.v + sg * (dr.v - cr.v)) * 100) / 100 };
        G.rows.push([KEY[a.id], null, null, null, null, null, cell('Total ' + book.accountLabel(a.id), { bold: true }), fv(dr, st.total), fv(cr, st.total), fv(end, st.grand), cell('Section')]);
        glEnding[a.id] = end.v;
        G.rows.push([]);
      });
      var gl = G.rows.length;
      G.autoFilter = 'B' + (gh + 1) + ':K' + gl;
      G.cols = [{ width: 8, hidden: true }, { width: 11 }, { width: 11 }, { width: 15 }, { width: 8 }, { width: 22 }, { width: 40 }, { width: 13 }, { width: 13 }, { width: 14 }, { width: 9 }];
      G.freeze = { row: gh + 1, col: 2 };
      G.page = { fitWidth: true, orientation: 'landscape', titles: [gh + 1, gh + 1], footer: '&L' + book.company.name.replace(/&/g, '&&') + ' — General Ledger&RPage &P of &N' };
      G.cond.push({ ref: 'B' + (gh + 2) + ':K' + gl, formula: '$K' + (gh + 2) + '="No"', style: { color: 'A6A6A6' } });
      G._ending = glEnding;
    }
    // journal account cells now link to the account ledgers
    if (want('je')) J._jRows.forEach(function (x) { var loc = glLink(book.accById[x.accountId] || {}); var c = J.rows[x.row][5]; if (loc) J.rows[x.row][5] = withLink(cell(c), loc); });

    var out = { values: {} }; // key figures (cached values) for tests and the dashboard

    /* ===== Profit & Loss ===== */
    var P = mk('pl');
    var plRows = {};
    if (want('pl')) {
      header(P, 'Profit and Loss');
      P.rows[2][1] = fv(periodText(), st.note);
      P.rows.push([]);
      var ph = P.rows.length;
      P.rows.push([cell('Key'), cell('Account', st.head), cell('Amount', st.head), cell('% of Income', st.head), cell('Prior year', st.head), cell('$ Change', st.head)]);
      var PYF = { name: 'EDATE(FromDate,-12)', val: serial(pyFrom) }, PYT = { name: 'EDATE(ToDate,-12)', val: serial(pyTo) };
      var incomeRow = null, secTotals = {};
      var section = function (key, title, types, detailSheet) {
        var hr = P.rows.length;
        P.rows.push([null, withLink(cell(title, st.sec), detailSheet && want(detailSheet) ? q(detailSheet) + '!A1' : null), cell('', st.sec), cell('', st.sec), cell('', st.sec), cell('', st.sec)]);
        var rs = [], vals = [], pv = [];
        listAccs(function (a) { return types.indexOf(a.type) >= 0; }).forEach(function (a) {
          var r = P.rows.length, x = F.sumifs('Amt', [keyC(r, a)].concat(inPer)), y = F.sumifs('Amt', [keyC(r, a), ['Date', '>=', PYF], ['Date', '<=', PYT]]);
          P.rows.push([KEY[a.id], withLink(cell(book.accountLabel(a.id), { indent: 1 }), glLink(a)), fv(x, st.money), null, fv(y, st.money), fv({ f: 'C' + (r + 1) + '-E' + (r + 1), v: Math.round((x.v - y.v) * 100) / 100 }, st.money)]);
          P.rowMeta[r] = { level: 1 }; rs.push(r); vals.push(x.v); pv.push(y.v);
        });
        var tr = P.rows.length, t = sumRefs('C', rs, vals), tp = sumRefs('E', rs, pv);
        P.rows.push([null, cell('Total ' + title, { bold: true }), fv(t, st.total), null, fv(tp, st.total), fv({ f: 'C' + (tr + 1) + '-E' + (tr + 1), v: Math.round((t.v - tp.v) * 100) / 100 }, st.total)]);
        secTotals[key] = { row: tr, v: t.v, pv: tp.v, rows: rs };
        if (key === 'income') incomeRow = tr;
        plRows[key] = tr;
        return tr;
      };
      var net = function (key, title, terms, grand) {
        var r = P.rows.length;
        var f = terms.map(function (x, i) { return (x[1] < 0 ? '-' : i ? '+' : '') + 'C' + (secTotals[x[0]].row + 1); }).join('');
        var fp = f.replace(/C(\d+)/g, 'E$1');
        var v = Math.round(terms.reduce(function (s, x) { return s + x[1] * secTotals[x[0]].v; }, 0) * 100) / 100, pv2 = Math.round(terms.reduce(function (s, x) { return s + x[1] * secTotals[x[0]].pv; }, 0) * 100) / 100;
        P.rows.push([null, cell(title, { bold: true }), fv({ f: f, v: v }, grand ? st.grand : st.total), null, fv({ f: fp, v: pv2 }, grand ? st.grand : st.total), fv({ f: 'C' + (r + 1) + '-E' + (r + 1), v: Math.round((v - pv2) * 100) / 100 }, grand ? st.grand : st.total)]);
        secTotals[key] = { row: r, v: v, pv: pv2 };
        plRows[key] = r;
      };
      section('income', 'Income', ['income'], 'inc');
      section('cogs', 'Cost of Goods Sold', ['cogs'], 'exp');
      net('gross', 'Gross Profit', [['income', 1], ['cogs', -1]]);
      section('expense', 'Expenses', ['expense'], 'exp');
      net('netop', 'Net Operating Income', [['gross', 1], ['expense', -1]]);
      section('oi', 'Other Income', ['oi'], 'inc');
      section('oe', 'Other Expenses', ['oe'], 'exp');
      net('netother', 'Net Other Income', [['oi', 1], ['oe', -1]]);
      net('net', 'Net Income', [['netop', 1], ['netother', 1]], true);
      // % of income on every amount row
      for (var pr = ph + 1; pr < P.rows.length; pr++) {
        var c2 = P.rows[pr][2];
        if (c2 && c2.f) P.rows[pr][3] = fv({ f: 'IFERROR(C' + (pr + 1) + '/C$' + (incomeRow + 1) + ',"")', v: secTotals.income.v ? Math.round(c2.v / secTotals.income.v * 10000) / 10000 : '' }, st.pct);
      }
      P.cols = [{ width: 8, hidden: true }, { width: 44 }, { width: 15 }, { width: 11 }, { width: 15 }, { width: 14 }];
      P.freeze = { row: ph + 1, col: 2 };
      P.page = { fitWidth: true, titles: [ph + 1, ph + 1], footer: '&L' + book.company.name.replace(/&/g, '&&') + '&RPage &P of &N' };
      P.cond.push({ ref: 'C' + (ph + 2) + ':F' + P.rows.length, formula: 'AND(ISNUMBER(C' + (ph + 2) + '),C' + (ph + 2) + '<0)', style: { color: 'C00000' } });
      Object.keys(secTotals).forEach(function (k) { out.values['pl.' + k] = secTotals[k].v; });
    }

    /* ===== Balance Sheet ===== */
    var B = mk('bs');
    if (want('bs')) {
      header(B, 'Balance Sheet');
      B.rows[2][1] = fv(asOfText(), st.note);
      B.rows.push([]);
      var bh = B.rows.length;
      B.rows.push([cell('Key'), cell('Account', st.head), cell('Balance', st.head), cell('Prior year', st.head), cell('$ Change', st.head)]);
      var PYTD = { name: 'EDATE(ToDate,-12)', val: serial(pyTo) }, PYFYS = { name: 'PYFYStart', val: serial(pyFys) };
      var bt = {};
      var bal = function (a, r, asOf, fyStart) {
        var sg = S.TYPE[a.type].cls === 'asset' ? 1 : -1;
        var x = F.sumifs('Net', [keyC(r, a), ['Date', '<=', asOf]], sg);
        if (reAcc && a.id === reAcc.id) x = add(x, F.sumifs('Net', [['Stmt', '=', { text: 'P&L' }], ['Date', '<', fyStart]], -1));
        return x;
      };
      var bsec = function (key, title, types) {
        B.rows.push([null, cell(title, st.sec), cell('', st.sec), cell('', st.sec), cell('', st.sec)]);
        var rs = [], v = [], pv = [];
        withRE(listAccs(function (a) { return types.indexOf(a.type) >= 0; }), key === 'equity').forEach(function (a) {
          var r = B.rows.length, x = bal(a, r, TO, FYS), y = bal(a, r, PYTD, PYFYS);
          B.rows.push([KEY[a.id], withLink(cell(book.accountLabel(a.id), { indent: 1 }), glLink(a)), fv(x, st.money), fv(y, st.money), fv({ f: 'C' + (r + 1) + '-D' + (r + 1), v: Math.round((x.v - y.v) * 100) / 100 }, st.money)]);
          B.rowMeta[r] = { level: 1 }; rs.push(r); v.push(x.v); pv.push(y.v);
        });
        if (key === 'equity') {
          var r = B.rows.length, x = F.sumifs('Net', [['Stmt', '=', { text: 'P&L' }], ['Date', '>=', FYS], ['Date', '<=', TO]], -1), y = F.sumifs('Net', [['Stmt', '=', { text: 'P&L' }], ['Date', '>=', PYFYS], ['Date', '<=', PYTD]], -1);
          B.rows.push([null, withLink(cell('Net Income (fiscal year to date)', { indent: 1 }), want('pl') ? q('pl') + '!A1' : null), fv(x, st.money), fv(y, st.money), fv({ f: 'C' + (r + 1) + '-D' + (r + 1), v: Math.round((x.v - y.v) * 100) / 100 }, st.money)]);
          B.rowMeta[r] = { level: 1 }; rs.push(r); v.push(x.v); pv.push(y.v);
          out.values['bs.ni'] = x.v;
        }
        var tr = B.rows.length, t = sumRefs('C', rs, v), tp = sumRefs('D', rs, pv);
        B.rows.push([null, cell('Total ' + title, { bold: true }), fv(t, st.total), fv(tp, st.total), fv({ f: 'C' + (tr + 1) + '-D' + (tr + 1), v: Math.round((t.v - tp.v) * 100) / 100 }, st.total)]);
        bt[key] = { row: tr, v: t.v, pv: tp.v };
      };
      var grand = function (key, title, parts) {
        var r = B.rows.length, f = parts.map(function (k) { return 'C' + (bt[k].row + 1); }).join('+'), v = Math.round(parts.reduce(function (s, k) { return s + bt[k].v; }, 0) * 100) / 100, pv = Math.round(parts.reduce(function (s, k) { return s + bt[k].pv; }, 0) * 100) / 100;
        B.rows.push([null, cell(title, { bold: true }), fv({ f: f, v: v }, st.grand), fv({ f: f.replace(/C(\d+)/g, 'D$1'), v: pv }, st.grand), fv({ f: 'C' + (r + 1) + '-D' + (r + 1), v: Math.round((v - pv) * 100) / 100 }, st.grand)]);
        bt[key] = { row: r, v: v, pv: pv };
        B.rows.push([]);
      };
      bsec('ca', 'Current Assets', ['bank', 'ar', 'oca']); bsec('fa', 'Fixed Assets', ['fixed']); bsec('oa', 'Other Assets', ['oa']);
      grand('assets', 'Total Assets', ['ca', 'fa', 'oa']);
      bsec('cl', 'Current Liabilities', ['ap', 'cc', 'ocl']); bsec('ltl', 'Long-Term Liabilities', ['ltl']);
      grand('liab', 'Total Liabilities', ['cl', 'ltl']);
      bsec('equity', 'Equity', ['equity']);
      grand('le', 'Total Liabilities and Equity', ['liab', 'equity']);
      var chk = B.rows.length;
      B.rows.push([null, cell('Check: assets − liabilities and equity (should be 0.00)', st.note), fv({ f: 'ROUND(C' + (bt.assets.row + 1) + '-C' + (bt.le.row + 1) + ',2)', v: Math.round((bt.assets.v - bt.le.v) * 100) / 100 }, st.money), fv({ f: 'ROUND(D' + (bt.assets.row + 1) + '-D' + (bt.le.row + 1) + ',2)', v: Math.round((bt.assets.pv - bt.le.pv) * 100) / 100 }, st.money)]);
      B.cond.push({ ref: 'C' + (chk + 1) + ':D' + (chk + 1), formula: 'C' + (chk + 1) + '<>0', style: { color: 'C00000', bold: true, fill: 'FDE9E7' } });
      B.cols = [{ width: 8, hidden: true }, { width: 44 }, { width: 15 }, { width: 15 }, { width: 14 }];
      B.freeze = { row: bh + 1, col: 2 };
      B.page = { fitWidth: true, titles: [bh + 1, bh + 1], footer: '&L' + book.company.name.replace(/&/g, '&&') + '&RPage &P of &N' };
      out.values['bs.assets'] = bt.assets.v; out.values['bs.le'] = bt.le.v; out.values['bs.liab'] = bt.liab.v; out.values['bs.equity'] = bt.equity.v;
      B._rows = bt; B._check = chk;
    }

    /* ===== Cash Flow (indirect) ===== */
    var C = mk('cf');
    if (want('cf')) {
      header(C, 'Statement of Cash Flows');
      C.rows[2][1] = fv(periodText(), st.note);
      C.rows.push([]);
      var ch = C.rows.length;
      C.rows.push([cell('Key'), cell('', st.head), cell('Amount', st.head)]);
      var cfRow = function (label, x, style, lvl, lnk) { var r = C.rows.length; C.rows.push([null, withLink(cell(label, lvl ? { indent: 1 } : { bold: style !== st.money }), lnk || null), fv(x, style)]); if (lvl) C.rowMeta[r] = { level: 1 }; return r; };
      var ni = F.sumifs('Net', [['Stmt', '=', { text: 'P&L' }]].concat(inPer), -1);
      C.rows.push([null, cell('Operating activities', st.sec), cell('', st.sec)]);
      var niRow = cfRow('Net Income', ni, st.money, 1, want('pl') ? q('pl') + '!A1' : null);
      var cfs = { operating: [niRow], investing: [], financing: [] }, cfv = { operating: [ni.v], investing: [], financing: [] };
      var cfSec = function (sec, types) {
        listAccs(function (a) { return types.indexOf(a.type) >= 0 && !S.TYPE[a.type].cash; }).forEach(function (a) {
          var r = C.rows.length, x = F.sumifs('Net', [keyC(r, a)].concat(inPer), -1);
          C.rows.push([KEY[a.id], withLink(cell(book.accountLabel(a.id), { indent: 1 }), glLink(a)), fv(x, st.money)]);
          C.rowMeta[r] = { level: 1 }; cfs[sec].push(r); cfv[sec].push(x.v);
        });
      };
      var cfTot = {};
      var cfClose = function (sec, title) { var r = C.rows.length, t = sumRefs('C', cfs[sec], cfv[sec]); C.rows.push([null, cell(title, { bold: true }), fv(t, st.total)]); cfTot[sec] = { row: r, v: t.v }; };
      cfSec('operating', ['ar', 'oca', 'ap', 'cc', 'ocl']); cfClose('operating', 'Net cash from operating activities');
      C.rows.push([null, cell('Investing activities', st.sec), cell('', st.sec)]);
      cfSec('investing', ['fixed', 'oa']); cfClose('investing', 'Net cash from investing activities');
      C.rows.push([null, cell('Financing activities', st.sec), cell('', st.sec)]);
      cfSec('financing', ['ltl', 'equity']); cfClose('financing', 'Net cash from financing activities');
      var nc = { f: 'C' + (cfTot.operating.row + 1) + '+C' + (cfTot.investing.row + 1) + '+C' + (cfTot.financing.row + 1), v: Math.round((cfTot.operating.v + cfTot.investing.v + cfTot.financing.v) * 100) / 100 };
      var ncr = cfRow('Net change in cash', nc, st.total);
      var cb = F.sumifs('Net', [['Cash', '=', { text: 'Yes' }], ['Date', '<', FROM]]), ce = F.sumifs('Net', [['Cash', '=', { text: 'Yes' }], ['Date', '<=', TO]]);
      var cbr = cfRow('Cash at beginning of period', cb, st.money), cer = cfRow('Cash at end of period', ce, st.grand);
      var cchk = C.rows.length;
      C.rows.push([null, cell('Check: beginning + net change − end (should be 0.00)', st.note), fv({ f: 'ROUND(C' + (cbr + 1) + '+C' + (ncr + 1) + '-C' + (cer + 1) + ',2)', v: Math.round((cb.v + nc.v - ce.v) * 100) / 100 }, st.money)]);
      C.cond.push({ ref: 'C' + (cchk + 1), formula: 'C' + (cchk + 1) + '<>0', style: { color: 'C00000', bold: true, fill: 'FDE9E7' } });
      C.cols = [{ width: 8, hidden: true }, { width: 50 }, { width: 16 }];
      C.freeze = { row: ch + 1, col: 2 };
      C.page = { fitWidth: true, titles: [ch + 1, ch + 1] };
      out.values['cf.net'] = nc.v; out.values['cf.begin'] = cb.v; out.values['cf.end'] = ce.v; out.values['cf.operating'] = cfTot.operating.v;
      C._check = cchk; C._end = cer;
    }

    /* ===== Trial Balance ===== */
    var T = mk('tb');
    if (want('tb')) {
      header(T, 'Trial Balance');
      T.rows[2][1] = fv(asOfText(), st.note);
      T.rows[2].push(null, cell('Income and expense accounts: fiscal year to date; earlier years are in Retained Earnings.', st.note));
      T.rows.push([]);
      var th = T.rows.length;
      T.rows.push([cell('Key'), cell('Account', st.head), cell('Debit', st.head), cell('Credit', st.head), cell('Net (debit − credit)', st.head)]);
      var trs = [], tdv = 0, tcv = 0;
      withRE(listAccs(function () { return true; }), true).forEach(function (a) {
        var r = T.rows.length, x;
        if (S.isPL(a.type)) x = F.sumifs('Net', [keyC(r, a), ['Date', '>=', FYS], ['Date', '<=', TO]]);
        else x = F.sumifs('Net', [keyC(r, a), ['Date', '<=', TO]]);
        if (reAcc && a.id === reAcc.id) x = add(x, F.sumifs('Net', [['Stmt', '=', { text: 'P&L' }], ['Date', '<', FYS]]));
        var E = 'E' + (r + 1);
        T.rows.push([KEY[a.id], withLink(cell(book.accountLabel(a.id)), glLink(a)), fv({ f: 'MAX(' + E + ',0)', v: Math.max(x.v, 0) }, st.money), fv({ f: 'MAX(-' + E + ',0)', v: Math.max(-x.v, 0) }, st.money), fv(x, Object.assign({}, st.money, { italic: true, color: '7F7F7F' }))]);
        trs.push(r); tdv += Math.max(x.v, 0); tcv += Math.max(-x.v, 0);
      });
      var ttr = T.rows.length, td = sumRefs('C', trs, trs.map(function (r) { return T.rows[r][2].v; })), tc = sumRefs('D', trs, trs.map(function (r) { return T.rows[r][3].v; }));
      T.rows.push([null, cell('Total', { bold: true }), fv(td, st.grand), fv(tc, st.grand)]);
      T.rows.push([null, cell('Check: debits − credits (should be 0.00)', st.note), fv({ f: 'ROUND(C' + (ttr + 1) + '-D' + (ttr + 1) + ',2)', v: Math.round((td.v - tc.v) * 100) / 100 }, st.money)]);
      T.cond.push({ ref: 'C' + (ttr + 2), formula: 'C' + (ttr + 2) + '<>0', style: { color: 'C00000', bold: true, fill: 'FDE9E7' } });
      T.cols = [{ width: 8, hidden: true }, { width: 44 }, { width: 15 }, { width: 15 }, { width: 16 }];
      T.freeze = { row: th + 1, col: 2 };
      T.page = { fitWidth: true, titles: [th + 1, th + 1] };
      out.values['tb.debit'] = td.v; out.values['tb.credit'] = tc.v;
      T._total = ttr;
    }

    /* ===== Income / Expense Details ===== */
    var details = function (k, sideName, title, types) {
      var Dt = mk(k);
      if (!want(k)) return;
      var nav = header(Dt, title);
      Dt.rows[2][1] = fv(periodText(), st.note);
      nav.push(null, withLink(cell('← Profit & Loss'), want('pl') ? q('pl') + '!A1' : null));
      Dt.rows.push([]);
      Dt.rows.push([null, cell('By account', st.sub)]);
      var h1 = Dt.rows.length;
      Dt.rows.push([cell('Key'), cell('Account', st.head), cell('Lines', st.head), cell('Debits', st.head), cell('Credits', st.head), cell('Amount', st.head), cell('% of total', st.head)]);
      var rs = [], vs = [];
      listAccs(function (a) { return types.indexOf(a.type) >= 0; }).forEach(function (a) {
        var r = Dt.rows.length, kc = keyC(r, a);
        var n = F.countifs([kc].concat(inPer)), dr = F.sumifs('Debit', [kc].concat(inPer)), cr = F.sumifs('Credit', [kc].concat(inPer)), am = F.sumifs('Amt', [kc].concat(inPer));
        Dt.rows.push([KEY[a.id], withLink(cell(book.accountLabel(a.id)), glLink(a)), fv(n), fv(dr, st.money), fv(cr, st.money), fv(am, st.money), null]);
        rs.push(r); vs.push(am.v);
      });
      var tr = Dt.rows.length, tot = sumRefs('F', rs, vs);
      Dt.rows.push([null, cell('Total', { bold: true }), fv(sumRefs('C', rs, rs.map(function (r) { return Dt.rows[r][2].v; }))), fv(sumRefs('D', rs, rs.map(function (r) { return Dt.rows[r][3].v; })), st.total), fv(sumRefs('E', rs, rs.map(function (r) { return Dt.rows[r][4].v; })), st.total), fv(tot, st.total)]);
      rs.forEach(function (r) { Dt.rows[r][6] = fv({ f: 'IFERROR(F' + (r + 1) + '/F$' + (tr + 1) + ',"")', v: tot.v ? Math.round(Dt.rows[r][5].v / tot.v * 10000) / 10000 : '' }, st.pct); });
      Dt.rows.push([]);
      Dt.rows.push([null, cell('By ' + (sideName === 'Income' ? 'customer' : 'vendor / payee'), st.sub)]);
      Dt.rows.push([null, cell('Name', st.head), cell('Lines', st.head), null, null, cell('Amount', st.head), cell('% of total', st.head)]);
      var namesSeen = {}; lines.forEach(function (l) { if (l.Side === sideName) namesSeen[l.Name] = 1; });
      var nrs = [], nvs = [];
      Object.keys(namesSeen).sort(function (x, y) { return x.localeCompare(y); }).forEach(function (nm) {
        var r = Dt.rows.length, nc = ['Name', '=', { ref: '$B' + (r + 1), val: nm }], sc = ['Side', '=', { text: sideName }];
        var n = F.countifs([sc, nc].concat(inPer)), am = F.sumifs('Amt', [sc, nc].concat(inPer));
        Dt.rows.push([null, nm, fv(n), null, null, fv(am, st.money), null]);
        nrs.push(r); nvs.push(am.v);
      });
      var ntr = Dt.rows.length, nt = sumRefs('F', nrs, nvs);
      Dt.rows.push([null, cell('Total', { bold: true }), null, null, null, fv(nt, st.total)]);
      nrs.forEach(function (r) { Dt.rows[r][6] = fv({ f: 'IFERROR(F' + (r + 1) + '/F$' + (ntr + 1) + ',"")', v: nt.v ? Math.round(Dt.rows[r][5].v / nt.v * 10000) / 10000 : '' }, st.pct); });
      Dt.cols = [{ width: 8, hidden: true }, { width: 42 }, { width: 8 }, { width: 14 }, { width: 14 }, { width: 15 }, { width: 11 }];
      Dt.freeze = { row: h1 + 1, col: 2 };
      Dt.page = { fitWidth: true };
      out.values[k + '.total'] = tot.v; out.values[k + '.byName'] = nt.v;
    };
    details('inc', 'Income', 'Income Details', ['income', 'oi']);
    details('exp', 'Expense', 'Expense Details', ['cogs', 'expense', 'oe']);

    /* ===== AR / AP Aging (open documents as of the export date; days past due follow the aging date cell) ===== */
    var aging = function (k, kind) {
      var A = mk(k);
      if (!want(k)) return;
      var od = R.openDocs(book, { kind: kind, asOf: to });
      var acc = kind === 'customer' ? arAcc : apAcc, sg = kind === 'customer' ? 1 : -1;
      header(A, kind === 'customer' ? 'A/R Aging (Accounts Receivable)' : 'A/P Aging (Accounts Payable)', 'Open balances as of ' + U.fmtDate(to) + ' (the export snapshot). Change the aging date to re-bucket by days past due.');
      A.rows.push([]);
      var dRow = A.rows.length;
      A.rows.push([null, cell('Aging date', { bold: true }), cell(toS, st.input), cell('← type a date', st.note)]);
      A.validations.push({ ref: 'C' + (dRow + 1), title: 'Aging date', prompt: 'Days past due are counted to this date.' });
      var AD = '$C$' + (dRow + 1);
      A.rows.push([]);
      var B5 = ['Current', '1 – 30', '31 – 60', '61 – 90', '91 and over'];
      A.rows.push([null, cell('Summary by ' + kind, st.sub)]);
      A.rows.push([null, cell(kind === 'customer' ? 'Customer' : 'Vendor', st.head)].concat(B5.map(function (b) { return cell(b, st.head); }), [cell('Total', st.head)]));
      var sumStart = A.rows.length, people = od.groups.map(function (g) { return g.name; });
      people.forEach(function () { A.rows.push([]); });
      var sTot = A.rows.length; A.rows.push([]);
      A.rows.push([]);
      A.rows.push([null, cell('Open documents', st.sub)]);
      var dh = A.rows.length;
      A.rows.push([null, cell(kind === 'customer' ? 'Customer' : 'Vendor', st.head), cell('Date', st.head), cell('Type', st.head), cell('No.', st.head), cell('JE Ref', st.head), cell('Due date', st.head), cell('Open balance', st.head), cell('Days past due', st.head)].concat(B5.map(function (b) { return cell(b, st.head); })));
      var docRows = [], bucketV = [0, 0, 0, 0, 0];
      od.groups.forEach(function (g) {
        g.docs.forEach(function (d) {
          var r = A.rows.length, R1 = r + 1, open = d.open / 100;
          var days = d.due ? Math.max(0, U.daysBetween(d.due, to)) : 0;
          var b = d.other || open < 0 || !d.due || U.daysBetween(d.due, to) <= 0 ? 0 : days <= 30 ? 1 : days <= 60 ? 2 : days <= 90 ? 3 : 4;
          var row = [null, g.name, cell(serial(d.date), st.date), S.TXN_TYPES[d.type].label, d.number, withLink(cell(JE[d.t.id] || ''), anchors.je[d.t.id] !== undefined ? q('je') + '!A' + (anchors.je[d.t.id] + 1) : null), d.due ? cell(serial(d.due), st.date) : '', cell(open, st.money),
            fv({ f: 'IF(G' + R1 + '="",0,MAX(0,' + AD + '-G' + R1 + '))', v: days })];
          // buckets: blank due date (journal items), credits and not-yet-due items are current
          var cur = 'OR(G' + R1 + '="",H' + R1 + '<0,' + AD + '-G' + R1 + '<=0)', I1 = 'I' + R1;
          var test = ['', I1 + '<=30', 'AND(' + I1 + '>30,' + I1 + '<=60)', 'AND(' + I1 + '>60,' + I1 + '<=90)', I1 + '>90'];
          for (var k2 = 0; k2 < 5; k2++) {
            row.push(fv({ f: k2 ? 'IF(AND(NOT(' + cur + '),' + test[k2] + '),H' + R1 + ',0)' : 'IF(' + cur + ',H' + R1 + ',0)', v: b === k2 ? open : 0 }, st.money));
            if (b === k2) bucketV[k2] = Math.round((bucketV[k2] + open) * 100) / 100;
          }
          A.rows.push(row); docRows.push(r);
        });
      });
      var dl = A.rows.length;
      A.rows.push([null, cell('Total', { bold: true }), null, null, null, null, null, fv(sumRefs('H', docRows, docRows.map(function (r) { return A.rows[r][7].v; })), st.total), null]
        .concat(B5.map(function (b, i) { return fv(sumRefs(X.colName(9 + i), docRows, docRows.map(function (r) { return A.rows[r][9 + i].v; })), st.total); })));
      // aging is always open documents (accrual); on a cash-basis file the control account is not in the ledger data, so the check uses VaultBook's accrual balance
      var ledgerBal = basis === 'cash' ? { f: null, v: sg * book.rawBalance(acc.id, to) / 100 } : F.sumifs('Net', [['Key', '=', { text: KEY[acc.id] }], ['Date', '<=', { name: 'DataThrough', val: toS }]], sg);
      A._check = A.rows.length;
      A.rows.push([null, cell('Check: ' + book.accountLabel(acc.id) + (basis === 'cash' ? ' balance (accrual, from VaultBook) on ' : ' balance in the ledger data on ') + U.fmtDate(to), st.note), null, null, null, null, null, ledgerBal.f ? fv(ledgerBal, st.money) : cell(ledgerBal.v, st.money), fv({ f: 'IF(ROUND(H' + (dl + 1) + '-H' + (dl + 2) + ',2)=0,"✓ Ties","✗ Does not tie")', v: Math.round((od.total / 100 - ledgerBal.v) * 100) === 0 ? '✓ Ties' : '✗ Does not tie' }, { bold: true })]);
      // summary rows by person, from the document rows (SUMIFS on this sheet)
      var rng = function (col) { return '$' + col + '$' + (dh + 2) + ':$' + col + '$' + (dl === dh + 1 ? dh + 2 : dl); };
      people.forEach(function (nm, i) {
        var r = sumStart + i, row = [null, nm], tot = 0;
        B5.forEach(function (b, k2) {
          var col = X.colName(9 + k2), v = Math.round(docRows.reduce(function (s, dr) { return s + (A.rows[dr][1] === nm ? A.rows[dr][9 + k2].v : 0); }, 0) * 100) / 100;
          row.push(fv({ f: 'SUMIFS(' + rng(col) + ',' + rng('B') + ',$B' + (r + 1) + ')', v: v }, st.money)); tot += v;
        });
        row.push(fv({ f: 'SUM(C' + (r + 1) + ':G' + (r + 1) + ')', v: Math.round(tot * 100) / 100 }, st.total));
        A.rows[r] = row;
      });
      var srs = people.map(function (p, i) { return sumStart + i; });
      A.rows[sTot] = [null, cell('Total', { bold: true })].concat(['C', 'D', 'E', 'F', 'G', 'H'].map(function (col, i) { return fv(sumRefs(col, srs, srs.map(function (r) { return A.rows[r][2 + i].v; })), st.grand); }));
      A.cols = [{ width: 4, hidden: true }, { width: 30 }, { width: 13 }, { width: 14 }, { width: 13 }, { width: 13 }, { width: 13 }, { width: 14 }, { width: 12 }, { width: 13 }, { width: 13 }, { width: 13 }, { width: 13 }, { width: 13 }];
      A.autoFilter = 'B' + (dh + 1) + ':N' + Math.max(dh + 2, dl);
      A.freeze = { row: 0, col: 2 };
      A.page = { fitWidth: true, orientation: 'landscape' };
      out.values[k + '.total'] = od.total / 100; out.values[k + '.ledger'] = ledgerBal.v; out.values[k + '.buckets'] = bucketV;
    };
    aging('ar', 'customer');
    aging('ap', 'vendor');

    /* ===== Account Index ===== */
    var I = mk('idx');
    if (want('idx')) {
      header(I, 'Account Index');
      I.rows[2][1] = fv(periodText(), st.note);
      I.rows.push([]);
      var ih = I.rows.length;
      I.rows.push([cell('Key'), cell('No.', st.head), cell('Account', st.head), cell('Type', st.head), cell('Statement', st.head), cell('Normal', st.head), cell('Opening', st.head), cell('Debits', st.head), cell('Credits', st.head), cell('Closing', st.head), cell('Active', st.head)]);
      accs.forEach(function (a) {
        var r = I.rows.length, pl = S.isPL(a.type), sg = book.normalSign(a), kc = keyC(r, a);
        var op = pl ? { f: '0', v: 0 } : F.sumifs('Net', [kc, ['Date', '<', FROM]], sg);
        var dr = F.sumifs('Debit', [kc].concat(inPer)), cr = F.sumifs('Credit', [kc].concat(inPer));
        I.rows.push([KEY[a.id], a.number || '', withLink(cell(book.accountFullName(a)), glLink(a)), S.TYPE[a.type].label, pl ? 'P&L' : 'BS', S.TYPE[a.type].normal === 'D' ? 'Debit' : 'Credit', fv(op, st.money), fv(dr, st.money), fv(cr, st.money),
          fv({ f: 'G' + (r + 1) + (sg < 0 ? '-(' : '+(') + 'H' + (r + 1) + '-I' + (r + 1) + ')', v: Math.round((op.v + sg * (dr.v - cr.v)) * 100) / 100 }, st.total), a.active ? 'Yes' : 'No']);
      });
      I.autoFilter = 'B' + (ih + 1) + ':K' + I.rows.length;
      I.cols = [{ width: 8, hidden: true }, { width: 9 }, { width: 40 }, { width: 22 }, { width: 10 }, { width: 8 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 7 }];
      I.freeze = { row: ih + 1, col: 3 };
      I.page = { fitWidth: true, orientation: 'landscape', titles: [ih + 1, ih + 1] };
    }

    /* ===== My Analysis (the user's sheet) ===== */
    var Y = mk('my');
    if (want('my')) {
      Y.rows.push([cell('My analysis', st.title)]);
      Y.rows.push([cell('This sheet is yours: add formulas, ratios, charts or PivotTables here or on new sheets. VaultBook never fills it in, and nothing here goes back to VaultBook.', st.note)]);
      Y.rows.push([]);
      Y.rows.push([cell('Examples (edit or delete)', st.sub)]);
      var ex = [];
      if (want('pl')) {
        ex.push(['Gross margin', 'IFERROR(' + q('pl') + '!C' + (plRows.gross + 1) + '/' + q('pl') + '!C' + (plRows.income + 1) + ',"")', st.pct, out.values['pl.income'] ? out.values['pl.gross'] / out.values['pl.income'] : '']);
        ex.push(['Net margin', 'IFERROR(' + q('pl') + '!C' + (plRows.net + 1) + '/' + q('pl') + '!C' + (plRows.income + 1) + ',"")', st.pct, out.values['pl.income'] ? out.values['pl.net'] / out.values['pl.income'] : '']);
      }
      if (want('bs')) {
        var bt2 = B._rows;
        ex.push(['Current ratio (current assets ÷ current liabilities)', 'IFERROR(' + q('bs') + '!C' + (bt2.ca.row + 1) + '/' + q('bs') + '!C' + (bt2.cl.row + 1) + ',"")', { fmt: '0.00' }, bt2.cl.v ? bt2.ca.v / bt2.cl.v : '']);
        ex.push(['Debt to equity', 'IFERROR(' + q('bs') + '!C' + (bt2.liab.row + 1) + '/' + q('bs') + '!C' + (bt2.equity.row + 1) + ',"")', { fmt: '0.00' }, bt2.equity.v ? bt2.liab.v / bt2.equity.v : '']);
      }
      ex.forEach(function (e) { Y.rows.push([e[0], fv({ f: e[1], v: typeof e[3] === 'number' ? Math.round(e[3] * 10000) / 10000 : '' }, e[2])]); });
      Y.cols = [{ width: 52 }, { width: 14 }, { width: 14 }, { width: 14 }];
    }

    /* ===== Dashboard ===== */
    var Hd = mk('dash');
    var fyEnd = U.addDays(U.addMonths(fys, 12), -1);
    var lastDate = lines.length ? lines[lines.length - 1].date : '';
    Hd.rows.push([cell(book.company.name, { bold: true, size: 18 })]);
    Hd.rows.push([cell('Financial reporting workbook', st.sub)]);
    Hd.rows.push([]);
    var info = [['Fiscal year', 'FY ' + U.fmtDate(fys) + ' – ' + U.fmtDate(fyEnd)], ['Reporting basis', basis === 'cash' ? 'Cash' : 'Accrual'], ['Exported', now.toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' }) + ' from VaultBook ' + (S.APP_VERSION || '')],
      ['Data through', U.fmtDate(to) + (lastDate ? ' (last transaction ' + U.fmtDate(lastDate) + ')' : '')], ['Ledger lines', lines.length.toLocaleString() + ' in “' + NAME.data + '”']];
    info.forEach(function (x) { Hd.rows.push([cell(x[0], { bold: true }), x[1]]); });
    Hd.rows.push([]);
    Hd.rows.push([cell('Report period', st.sub), null, cell('Change these two dates to re-run every report.', st.note)]);
    var fromRow = Hd.rows.length;
    Hd.rows.push([cell('From date', { bold: true }), cell(fromS, st.input), cell('', st.note)]);
    Hd.rows.push([cell('To date', { bold: true }), cell(toS, st.input), cell('', st.note)]);
    Hd.validations.push({ ref: 'B' + (fromRow + 1) + ':B' + (fromRow + 2), title: 'Report period', prompt: 'Type a date. Every report sheet recalculates.' });
    Hd.rows[fromRow][2] = fv({ f: 'IF(FromDate>ToDate,"⚠ From is after To",IF(FromDate<ExportFrom,"General Ledger and Journal lines start "&TEXT(ExportFrom,"mm/dd/yyyy")&"; totals still include earlier data",""))', v: '' }, { color: 'C00000' });
    Hd.rows[fromRow + 1][2] = fv({ f: 'IF(ToDate>DataThrough,"⚠ This file has no data after "&TEXT(DataThrough,"mm/dd/yyyy"),"")', v: '' }, { color: 'C00000' });
    Hd.rows.push([]);
    var kp = Hd.rows.length;
    Hd.rows.push([cell('Key figures', st.sub)]);
    var kpis = [];
    if (want('pl')) kpis.push(['Income', 'pl', plRows.income, 'C', out.values['pl.income']], ['Gross profit', 'pl', plRows.gross, 'C', out.values['pl.gross']], ['Net income', 'pl', plRows.net, 'C', out.values['pl.net']]);
    if (want('bs')) kpis.push(['Total assets', 'bs', B._rows.assets.row, 'C', out.values['bs.assets']], ['Total liabilities', 'bs', B._rows.liab.row, 'C', out.values['bs.liab']], ['Total equity', 'bs', B._rows.equity.row, 'C', out.values['bs.equity']]);
    if (want('cf')) kpis.push(['Cash at end of period', 'cf', C._end, 'C', out.values['cf.end']]);
    kpis.forEach(function (x) { Hd.rows.push([withLink(cell(x[0]), q(x[1]) + '!B' + (x[2] + 1)), fv({ f: q(x[1]) + '!' + x[3] + (x[2] + 1), v: x[4] }, st.money)]); });
    Hd.rows.push([]);
    Hd.rows.push([cell('Checks', st.sub), null, cell('Recalculate with the dates above; every check should read OK.', st.note)]);
    var chks = [];
    var okF = function (f, ok) { return { f: 'IF(' + f + ',"OK","CHECK")', v: ok ? 'OK' : 'CHECK' }; };
    var totNet = Math.round(lines.reduce(function (s, l) { return s + l.Net; }, 0) * 100) / 100;
    chks.push(['Ledger data: all lines net to zero', okF('ROUND(SUM(L_Net),2)=0', totNet === 0)]);
    if (want('tb')) chks.push(['Trial balance: debits equal credits', okF('ROUND(' + q('tb') + '!C' + (T._total + 2) + ',2)=0', out.values['tb.debit'] === out.values['tb.credit'])]);
    if (want('bs')) chks.push(['Balance sheet: assets equal liabilities and equity', okF('ROUND(' + q('bs') + '!C' + (B._check + 1) + ',2)=0', out.values['bs.assets'] === out.values['bs.le'])]);
    if (want('cf')) chks.push(['Cash flow: beginning + change = ending cash', okF('ROUND(' + q('cf') + '!C' + (C._check + 1) + ',2)=0', Math.round((out.values['cf.begin'] + out.values['cf.net'] - out.values['cf.end']) * 100) === 0)]);
    ['ar', 'ap'].forEach(function (k) {
      if (!want(k)) return;
      var r = sheets[k]._check; // row with the ledger balance, one below the document totals
      chks.push([k === 'ar' ? 'A/R aging ties to Accounts Receivable' : 'A/P aging ties to Accounts Payable', okF('ROUND(' + q(k) + '!H' + r + '-' + q(k) + '!H' + (r + 1) + ',2)=0', Math.round((out.values[k + '.total'] - out.values[k + '.ledger']) * 100) === 0)]);
    });
    var ckStart = Hd.rows.length;
    chks.forEach(function (x) { Hd.rows.push([x[0], fv(x[1], { bold: true })]); });
    Hd.cond.push({ ref: 'B' + (ckStart + 1) + ':B' + Hd.rows.length, formula: 'B' + (ckStart + 1) + '="OK"', style: { color: '1E7B34' } });
    Hd.cond.push({ ref: 'B' + (ckStart + 1) + ':B' + Hd.rows.length, formula: 'B' + (ckStart + 1) + '="CHECK"', style: { color: 'C00000', fill: 'FDE9E7' } });
    Hd.rows.push([]);
    Hd.rows.push([cell('Sheets', st.sub), null, cell('Click a name to open it. Every report links back here.', st.note)]);
    var DESC = { pl: 'Income, expenses and net income for the period, with prior year', bs: 'Assets, liabilities and equity on the To date, with prior year', cf: 'Where cash came from and went (indirect method)', tb: 'Debit and credit balance of every account',
      gl: 'Each account: opening balance, lines, running balance, closing', inc: 'Income by account and by customer', exp: 'Expenses by account and by vendor', ar: 'Open customer balances by days past due', ap: 'Open bills by days past due',
      je: 'Every transaction with all its debit and credit lines', idx: 'Every account: opening, debits, credits, closing', my: 'Your own sheet for analysis', data: 'Original VaultBook ledger lines (source for every report)' };
    W.SHEETS.forEach(function (s) { if (s[0] !== 'dash' && want(s[0])) Hd.rows.push([withLink(cell(s[1]), q(s[0]) + '!A1'), DESC[s[0]]]); });
    Hd.rows.push([]);
    Hd.rows.push([cell('About this file', st.sub)]);
    ['This workbook is a snapshot of the books. Editing it never changes VaultBook; enter new transactions in VaultBook and export again.',
      'Grey tab “' + NAME.data + '” is the original accounting data. Blue and teal tabs are reports built from it with formulas. The green tab and any sheet you add are yours.',
      'Every report sheet has filters or grouped rows (use the + / − buttons at the left) and prints one page wide. No macros, add-ins or internet are needed.'].forEach(function (t) { Hd.rows.push([cell(t, { wrap: false })]); });
    // monthly chart data: 12 fiscal months ending at the To date's fiscal year
    Hd.rows.push([]);
    var mh = Hd.rows.length;
    Hd.rows.push([cell('Month', st.head), cell('Income', st.head), cell('Expenses', st.head)]);
    for (var mi = 0; mi < 12; mi++) {
      var ms = U.addMonths(fys, mi), me = U.addMonths(fys, mi + 1);
      var M1 = { name: 'EDATE(FYStart,' + mi + ')', val: serial(ms) }, M2 = { name: 'EDATE(FYStart,' + (mi + 1) + ')', val: serial(me) };
      var inc = F.sumifs('Amt', [['Side', '=', { text: 'Income' }], ['Date', '>=', M1], ['Date', '<', M2]]), exp = F.sumifs('Amt', [['Side', '=', { text: 'Expense' }], ['Date', '>=', M1], ['Date', '<', M2]]);
      Hd.rows.push([fv({ f: 'TEXT(EDATE(FYStart,' + mi + '),"mmm yyyy")', v: monthText(ms) }), fv(inc, st.money), fv(exp, st.money)]);
    }
    Hd.charts = [{ title: 'Income and expenses by month (fiscal year of the To date)', cats: q('dash') + '!$A$' + (mh + 2) + ':$A$' + (mh + 13), series: [{ name: q('dash') + '!$B$' + (mh + 1), vals: q('dash') + '!$B$' + (mh + 2) + ':$B$' + (mh + 13) }, { name: q('dash') + '!$C$' + (mh + 1), vals: q('dash') + '!$C$' + (mh + 2) + ':$C$' + (mh + 13), color: 'C55A11' }], from: [4, 2], to: [12, 22] }];
    Hd.cols = [{ width: 44 }, { width: 22 }, { width: 46 }];
    Hd.gridlines = false;
    Hd.page = { fitWidth: true, orientation: 'landscape' };

    names.push({ name: 'FromDate', ref: q('dash') + '!$B$' + (fromRow + 1), comment: 'Report period start (Dashboard)' }, { name: 'ToDate', ref: q('dash') + '!$B$' + (fromRow + 2), comment: 'Report period end (Dashboard)' },
      { name: 'FYMonth', ref: String(fyMonth) }, { name: 'FYStart', ref: 'DATE(YEAR(ToDate)-IF(MONTH(ToDate)<FYMonth,1,0),FYMonth,1)' },
      { name: 'PYFYStart', ref: 'DATE(YEAR(EDATE(ToDate,-12))-IF(MONTH(EDATE(ToDate,-12))<FYMonth,1,0),FYMonth,1)' },
      { name: 'ExportFrom', ref: String(fromS) }, { name: 'DataThrough', ref: String(toS) });
    out.glEnding = G._ending || {};
    var order = W.SHEETS.map(function (s) { return s[0]; }).filter(want);
    var list = order.map(function (k) { var s = sheets[k]; delete s._jRows; delete s._ending; delete s._rows; delete s._check; delete s._end; delete s._total; return s; });
    return { sheets: list, names: names, props: { title: book.company.name + ' — financial workbook', subject: 'FY ' + U.fmtDate(fys) + ' – ' + U.fmtDate(fyEnd) + ', ' + basis + ' basis', creator: 'VaultBook', description: 'Exported ' + now.toISOString() + '; data through ' + to },
      stats: { lines: lines.length, glRows: want('gl') ? G.rows.length : 0, journalRows: want('je') ? J.rows.length : 0 }, values: out.values, glEnding: out.glEnding, keys: KEY, basis: basis, from: from, to: to };
  };
  W.build = function (book, o) { var p = W.plan(book, o); return { bytes: OB.xlsx.build(p.sheets, { names: p.names, props: p.props, active: 0 }), plan: p }; };
  /** Compressed workbook for download (what the app uses). */
  W.buildAsync = function (book, o) { var p = W.plan(book, o); return OB.xlsx.buildAsync(p.sheets, { names: p.names, props: p.props, active: 0 }).then(function (bytes) { return { bytes: bytes, plan: p }; }); };

  function longDate(d) { return ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][+d.slice(5, 7) - 1] + ' ' + (+d.slice(8, 10)) + ', ' + d.slice(0, 4); }
  function monthText(d) { return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+d.slice(5, 7) - 1] + ' ' + d.slice(0, 4); }
})(typeof window !== 'undefined' ? window : globalThis);
