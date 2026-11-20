/* VaultBook — shared report model and export adapters.
 * Ledger → R.entries → R.statement / designer (calculation) → model (this file) → screen text, Excel, PDF.
 * A model is plain data: { lines: [company, title, subtitle…], head: [groupRow?, labelRow], columns: [{ label, pct, num }],
 *   rows: [{ label, depth, kind, cells, bold, line, fmt, xf, cond, pageBreak }], footer: [text…], nf }
 * Cells: null | string | number (cents, or percent units when the column/row is a percentage, or a ratio)
 *        | { v: number, f: 'num' } for plain quantities. Number text comes from M.fmtNumber, the same function the screen uses.
 */
(function (root) {
  'use strict';
  var OB = root.OB = root.OB || {};
  var M = OB.reportModel = {};

  /* ---------- number text (screen, PDF) and Excel number formats ---------- */
  /** nf: { neg: 'minus'|'paren'|'trail', dec: '2'|'0', d1000: '1', nosym: '1', empty: 'dash'|'blank' }.
   *  o: { pct, ratio, empty (true = a zero shows as empty), symbol, pctSpace } */
  M.fmtNumber = function (v, nf, o) {
    nf = nf || {}; o = o || {};
    if (v === null || v === undefined || v === '') return '';
    if (o.pct) return isFinite(v) ? (Math.round(v * 10) / 10).toFixed(1) + (o.pctSpace === false ? '%' : ' %') : '';
    if (o.ratio) return isFinite(v) ? (Math.round(v * 100) / 100).toFixed(2) : '';
    if (v === 0 && o.empty) return nf.empty === 'dash' ? '–' : '';
    var c = Math.round(v);
    if (nf.d1000 === '1') c = Math.round(c / 1000);
    var neg = c < 0, a = Math.abs(c), s;
    var group = function (n) { return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','); };
    if (nf.dec === '0') s = group(Math.round(a / 100));
    else s = group(Math.floor(a / 100)) + '.' + String(a % 100).padStart(2, '0');
    if (nf.d1000 === '1') s += 'K';
    if (o.symbol && nf.nosym !== '1') s = '$' + s;
    if (neg) s = nf.neg === 'paren' ? '(' + s + ')' : nf.neg === 'trail' ? s + '-' : '-' + s;
    return s;
  };
  /** The Excel number format that displays a dollar value exactly like M.fmtNumber shows its cents. */
  M.excelMoneyFormat = function (nf, symbol, zeroEmpty) {
    nf = nf || {};
    var pos = (symbol && nf.nosym !== '1' ? '"$"' : '') + (nf.dec === '0' ? '#,##0' : '#,##0.00') + (nf.d1000 === '1' ? ',"K"' : '');
    var neg = nf.neg === 'paren' ? '(' + pos + ')' : nf.neg === 'trail' ? pos + '-' : '-' + pos;
    return pos + ';' + (nf.red === '1' ? '[Red]' : '') + neg + (zeroEmpty ? (nf.empty === 'dash' ? ';"–"' : ';""') : '');
  };

  /* ---------- builders ---------- */
  var NET_TERMS = { gross: [['income', 1], ['cogs', -1]], netop: [['gross', 1], ['expense', -1]], netother: [['oi', 1], ['oe', -1]], net: [['netop', 1], ['netother', 1]] };
  function plus(terms) { var t = []; terms.forEach(function (x, i) { if (i || x[1] < 0) t.push(x[1] < 0 ? '-' : '+'); t.push({ r: x[0] }); }); return t; }

  /**
   * Model from a statement (R.statement or a designer result — same tree shape).
   *  meta: { company, title, lines: [subtitle…], footer: [..], nf, collapsed: {nodeKey: true} }
   * Subtotal rows carry xf (formula tokens: strings and { r: rowIndex }) so the Excel copy keeps live SUMs.
   */
  /** Statement layouts (company setting "statementLook"; the report offers the first MAJOR ones as quick buttons). Order = the numbers shown to the user. */
  M.LOOKS = [['classic', 'Classic'], ['lines', 'Clean lines'], ['grid', 'Full grid'], ['two', 'Two-sided'], ['banded', 'Banded'], ['formal', 'Formal print'],
    ['boxed', 'Boxed sections'], ['pad', 'Ledger paper'], ['bars', 'Header bars'], ['step', 'Stepped columns'], ['dense', 'Dense'], ['big', 'Big totals']];
  M.MAJOR_LOOKS = ['classic', 'lines', 'grid'];
  M.lookOf = function (k) { return M.LOOKS.some(function (x) { return x[0] === k; }) ? k : 'classic'; };
  /** Two-sided (T-format) split of top-level statement sections: assets and income on the right, the rest on the left. */
  M.RIGHT_SIDE = { assets: 1, income: 1, oi: 1 };
  /** Tree split for the screen: { left, right } each { title, nodes, extra, total, totalLabel }. Single amount column only. */
  M.twoSides = function (st) {
    var v0 = function (n) { return (n && n.cells && n.cells[0]) || 0; };
    if (st.kind === 'bs') {
      var side = function (n) { return { title: n.label, nodes: n.children, total: v0(n), totalLabel: n.totalLabel }; };
      var A = st.tree.filter(function (n) { return n.section === 'assets'; })[0], L = st.tree.filter(function (n) { return n.kind === 'group' && n.section !== 'assets'; })[0];
      return { left: side(L), right: side(A) };
    }
    var groups = st.tree.filter(function (n) { return n.kind === 'group'; });
    var R = groups.filter(function (n) { return M.RIGHT_SIDE[n.section]; }), Lf = groups.filter(function (n) { return !M.RIGHT_SIDE[n.section]; });
    var net = v0(st.tree.filter(function (n) { return n.kind === 'net' && n.section === 'net'; })[0]);
    var sum = function (list) { return list.reduce(function (t, n) { return t + v0(n); }, 0); };
    var left = { title: 'Expenses', nodes: Lf, total: sum(Lf), totalLabel: 'Total' }, right = { title: 'Income', nodes: R, total: sum(R), totalLabel: 'Total' };
    if (net >= 0) { left.extra = { label: 'Net Income', value: net }; left.total += net; } else { right.extra = { label: 'Net Loss', value: -net }; right.total -= net; }
    return { left: left, right: right };
  };
  /** The same split over export rows (for the PDF): each side { title, rows, extra, total, totalLabel }. */
  M.twoSidesRows = function (model) {
    var bs = model.kind === 'bs', out = { left: { title: bs ? '' : 'Expenses', rows: [], total: 0, totalLabel: 'Total' }, right: { title: bs ? '' : 'Income', rows: [], total: 0, totalLabel: 'Total' } }, cur = null, net = 0;
    var v0 = function (r) { return (r.cells && typeof r.cells[0] === 'number' && r.cells[0]) || 0; };
    model.rows.forEach(function (r) {
      var k = String(r.key || '');
      if (r.depth === 0 && k.indexOf('s:') === 0) {
        var sec = k.split(':')[1], sd = out[M.RIGHT_SIDE[sec] ? 'right' : 'left'];
        if (r.kind === 'header') { cur = sd; if (bs) sd.title = r.label; else sd.rows.push(r); return; }
        if (bs) { sd.total = v0(r); sd.totalLabel = r.label; if (r.kind === 'collapsed') sd.title = r.label; } else { sd.rows.push(r); sd.total += v0(r); }
        cur = null; return;
      }
      if (r.kind === 'net') { if (k === 'n:net') net = v0(r); return; }
      if (cur && r.kind !== 'spacer') cur.rows.push(r);
    });
    if (!bs) { if (net >= 0) { out.left.extra = { label: 'Net Income', value: net }; out.left.total += net; } else { out.right.extra = { label: 'Net Loss', value: -net }; out.right.total -= net; } }
    return out;
  };
  M.fromStatement = function (st, meta) {
    meta = meta || {};
    var collapsed = meta.collapsed || {}, rows = [], byKey = {};
    var columns = st.cols.map(function (c) { return { label: c.label, pct: !!c.pct, num: true, value: !!c.value }; });
    var push = function (r) { rows.push(r); return rows.length - 1; };
    var style = function (n, r) {
      var s = n.style || {};
      if (s.plain) { r.bold = false; r.line = ''; }
      if (s.bold) r.bold = true;
      if (s.line) r.line = s.line;
      if (s.pageBreak) r.pageBreak = true;
      if (s.italic) r.italic = true;
      if (n.cond) r.cond = n.cond;
      if (n.fmt) r.fmt = n.fmt;
      return r;
    };
    var visit = function (n) {
      var idx;
      if (n.kind === 'group') {
        if (collapsed[n.key]) idx = push(style(n, { key: n.key, label: n.label, depth: n.depth, kind: 'collapsed', cells: n.cells, bold: true, emptyZero: true }));
        else {
          push(style(n, { key: n.key + ':h', label: n.label, depth: n.depth, kind: 'header', cells: null, bold: true }));
          var kids = n.children.map(visit).filter(function (i) { return i !== null; });
          idx = push(style(n, { key: n.key + ':total', label: n.totalLabel, depth: n.depth, kind: 'total', cells: n.cells, bold: true, emptyZero: true, line: n.depth === 0 && st.kind === 'bs' ? 'double' : 'above',
            xf: kids.length ? plus(kids.map(function (k) { return [k, 1]; })) : null }));
        }
      } else if (n.kind === 'net') {
        idx = push(style(n, { key: n.key, label: n.label, depth: n.depth, kind: 'net', cells: n.cells, bold: true, emptyZero: true, line: n.grand ? 'double' : 'above', section: n.section, terms: n.terms, expr: n.expr }));
      } else if (n.kind === 'text' || n.kind === 'spacer') {
        push(style(n, { key: n.key, label: n.label || '', depth: n.depth || 0, kind: n.kind, cells: null }));
        return null;
      } else {
        idx = push(style(n, { key: n.key, label: n.label, depth: n.depth, kind: 'account', cells: n.cells, emptyZero: true }));
      }
      if (n.section) byKey[n.section] = idx;
      byKey[n.key] = idx;
      return idx;
    };
    st.tree.forEach(visit);
    // net rows: Gross Profit = Income − COGS …, or a designer formula (expr tokens referring to node keys)
    rows.forEach(function (r) {
      if (r.kind !== 'net') return;
      if (r.expr) {
        var ok = r.expr.every(function (t) { return typeof t === 'string' || byKey[t.key] !== undefined; });
        r.xf = ok ? r.expr.map(function (t) { return typeof t === 'string' ? t : { r: byKey[t.key] }; }) : null;
        r.xfValueOnly = true; // a template formula (e.g. a margin) is not valid on $ / % change columns
      } else {
        var terms = (r.terms || NET_TERMS[r.section] || []).filter(function (t) { return byKey[t[0]] !== undefined; }).map(function (t) { return [byKey[t[0]], t[1]]; });
        r.xf = terms.length ? plus(terms) : null;
      }
      delete r.expr; delete r.terms;
    });
    var head = [];
    if (st.multiHeader) head.push(st.groups.map(function (g) { return { label: g.label, span: g.span }; }));
    head.push(columns.map(function (c) { return c.label; }));
    return { kind: st.kind, lines: [meta.company || '', meta.title || ''].concat(meta.lines || []), head: head, columns: columns, rows: rows, footer: meta.footer || [], nf: meta.nf || {}, labelHead: meta.labelHead || '', look: M.lookOf(meta.look) };
  };

  /**
   * Model from an export matrix (every other report): rows before the first blank row are the title lines,
   * the next row is the column header, the rest is the body. Money cells {v: dollars, money} become cents.
   */
  M.fromMatrix = function (matrix) {
    var text = function (c) { return c && typeof c === 'object' ? c.v : c; };
    var i = 0, lines = [];
    while (i < matrix.length && matrix[i].length && i < 6) { lines.push(String(text(matrix[i][0]) === undefined ? '' : text(matrix[i][0]))); i++; }
    while (i < matrix.length && !matrix[i].length) i++;
    var headRow = matrix[i] || [];
    var width = matrix.reduce(function (w, r) { return Math.max(w, r.length); }, 0);
    var columns = [];
    for (var c = 1; c < width; c++) columns.push({ label: String(text(headRow[c]) || '') });
    var numCol = {};
    var rows = matrix.slice(i + 1).map(function (r) {
      var first = r[0];
      var cells = [];
      for (var k = 1; k < width; k++) {
        var x = r[k];
        if (x && typeof x === 'object' && x.money) { cells.push(Math.round(x.v * 100)); numCol[k - 1] = 1; }
        else if (typeof x === 'number') { cells.push({ v: x, f: 'num' }); numCol[k - 1] = 1; }
        else if (x === undefined || x === null || x === '') cells.push(null);
        else cells.push(String(text(x)));
      }
      var bold = !!(first && typeof first === 'object' && first.bold) || r.some(function (x) { return x && typeof x === 'object' && x.bold && x.money; });
      return { label: String(text(first) === undefined || text(first) === null ? '' : text(first)), depth: (first && typeof first === 'object' && first.depth) || 0, kind: bold && !(first && typeof first === 'object' && first.depth !== undefined) ? 'total' : 'account', cells: cells, bold: bold };
    });
    var outline = rows.some(function (r) { return r.depth > 0; });   // a drill-down: rows group under the row above them
    columns.forEach(function (col, k) { col.num = !!numCol[k]; });
    return { kind: 'table', lines: lines, head: [columns.map(function (x) { return x.label; })], columns: columns, rows: rows, footer: [], nf: {}, labelHead: String(text(headRow[0]) || ''), outline: outline };
  };

  /** Text of one cell exactly as the screen shows it. */
  M.cellText = function (model, row, i) {
    var v = row.cells ? row.cells[i] : null, col = model.columns[i] || {};
    if (v === null || v === undefined) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'object') return v.f === 'num' ? String(v.v) : String(v.v);
    var pct = col.pct || row.fmt === 'pct', ratio = row.fmt === 'ratio';
    return M.fmtNumber(v, model.nf, { pct: pct, ratio: ratio && !col.pct, empty: row.emptyZero && v === 0, symbol: !pct && !ratio && row.kind !== 'account' && model.kind !== 'table' });
  };
  /** Conditional style for a cell: 'bad' | 'good' | ''. cond: { op: 'lt'|'gt'|'le'|'ge', value (dollars, % or ratio), style } */
  M.condClass = function (row, v, col) {
    if (!row.cond || typeof v !== 'number' || (col && col.pct && row.fmt !== 'pct')) return '';
    var x = row.fmt === 'pct' || row.fmt === 'ratio' ? v : v / 100, t = +row.cond.value;
    var hit = row.cond.op === 'lt' ? x < t : row.cond.op === 'le' ? x <= t : row.cond.op === 'ge' ? x >= t : x > t;
    return hit ? (row.cond.style === 'good' ? 'good' : 'bad') : '';
  };

  /* ---------- Excel ---------- */
  /** Sheet spec for OB.xlsx.build: styles, merged title rows, frozen header, print titles, fit to width, live formulas. */
  M.toSheet = function (model, opts) {
    opts = opts || {};
    var X = OB.xlsx, nf = model.nf || {};
    var ncol = model.columns.length + 1, out = [], merges = [];
    var titleRow = function (text, st) { out.push([Object.assign({ v: text }, st)]); if (ncol > 1) merges.push(X.ref(out.length - 1, 0) + ':' + X.ref(out.length - 1, ncol - 1)); };
    model.lines.forEach(function (t, i) { if (t) titleRow(t, i === 0 ? { bold: true, size: 14, align: 'center' } : i === 1 ? { bold: true, size: 12, align: 'center' } : { align: 'center' }); });
    out.push([]);
    var headStart = out.length;
    model.head.forEach(function (hr, hi) {
      var last = hi === model.head.length - 1, row = [{ v: last ? model.labelHead : '', bold: true, fill: 'head', border: 'bottom' }];
      if (!last) { var c = 1; hr.forEach(function (g) { row[c] = { v: g.label, bold: true, fill: 'head', align: 'center' }; for (var k = 1; k < g.span; k++) row[c + k] = { v: '', fill: 'head' }; if (g.span > 1) merges.push(X.ref(out.length, c) + ':' + X.ref(out.length, c + g.span - 1)); c += g.span; }); }
      else hr.forEach(function (l, k) { row[k + 1] = { v: l, bold: true, fill: 'head', border: 'bottom', align: model.columns[k].num === false ? 'left' : 'right', wrap: true }; });
      out.push(row);
    });
    var bodyStart = out.length;
    var rowNo = function (idx) { return bodyStart + idx; };
    model.rows.forEach(function (r) {
      var row = [{ v: r.label, bold: !!r.bold, italic: !!r.italic, indent: Math.min(15, r.depth || 0) }];
      if (r.cells) model.columns.forEach(function (col, i) {
        var v = r.cells[i], cell;
        var border = r.line === 'double' ? 'double' : r.line === 'above' ? 'top' : '';
        if (typeof v === 'string') cell = { v: v, bold: !!r.bold };
        else if (v && typeof v === 'object') cell = { v: v.v, bold: !!r.bold, fmt: '#,##0.##' };
        else if (v === null || v === undefined) cell = border ? { v: '', border: border } : null;
        else if (col.pct || r.fmt === 'pct') cell = { v: isFinite(v) ? v / 100 : '', fmt: '0.0%', bold: !!r.bold, border: border };
        else if (r.fmt === 'ratio') cell = { v: isFinite(v) ? v : '', fmt: '0.00', bold: !!r.bold, border: border };
        else if (v === 0 && r.emptyZero && !r.xf) cell = border ? { v: '', border: border } : null;
        else cell = { v: v / 100, fmt: M.excelMoneyFormat(nf, r.kind !== 'account' && model.kind !== 'table', r.emptyZero), bold: !!r.bold, border: border };
        if (cell && r.xf && !col.pct && (!r.xfValueOnly || col.value) && opts.formulas !== false && typeof v === 'number') {
          var letter = X.colName(i + 1), f = r.xf.map(function (t) { return typeof t === 'string' ? t : letter + (rowNo(t.r) + 1); }).join('');
          if (/^\+/.test(f)) f = f.slice(1);
          // designer % formulas already give a fraction (gp / income), which is what a 0.0% cell holds
          if (!r.fmt && /[*\/]/.test(f)) f = 'ROUND(' + f + ',2)';
          if (f.indexOf('/') >= 0) f = 'IFERROR(' + f + ',"")';
          cell.f = f;
          if (cell.v === '') cell.v = undefined;
        }
        row[i + 1] = cell;
      });
      out.push(row);
    });
    if (model.footer.length) { out.push([]); model.footer.forEach(function (t) { titleRow(t, { italic: true, align: 'center' }); }); }
    var labelW = Math.min(60, Math.max(28, model.rows.reduce(function (w, r) { return Math.max(w, String(r.label).length + (r.depth || 0) * 2); }, 0) + 2));
    var widths = [labelW].concat(model.columns.map(function (c, i) {
      var w = String(c.label).length;
      model.rows.forEach(function (r) { var v = r.cells && r.cells[i]; w = Math.max(w, typeof v === 'string' ? Math.min(40, v.length) : 13); });
      return Math.min(42, Math.max(12, w + 2));
    }));
    var setup = opts.page || {}, rowMeta;
    if (model.outline) { rowMeta = {}; model.rows.forEach(function (r, i) { if (r.depth) rowMeta[bodyStart + i] = { level: Math.min(7, r.depth) }; }); }   // Excel row groups (+/− and 1 2 3)
    return { name: opts.name || model.lines[1] || 'Report', rows: out, widths: widths, merges: merges, freeze: { row: bodyStart, col: 1 }, gridlines: model.kind === 'table', rowMeta: rowMeta, summaryAbove: !!model.outline,
      page: { orientation: setup.orientation && setup.orientation !== 'auto' ? setup.orientation : (ncol > 7 ? 'landscape' : 'portrait'), paper: setup.paper || 'letter', fitWidth: true,
        titles: [headStart + 1, bodyStart], footer: '&L' + (model.lines[0] || '').replace(/&/g, '&&') + '&RPage &P of &N' } };
  };

  /* ---------- PDF ---------- */
  /**
   * Paginated PDF: report heading and column headings repeat on every page, "Page X of Y" in the footer,
   * section headings are kept with the next line, designer rows can force a page break.
   *  setup: { paper: 'letter'|'legal'|'a4'|'tabloid'|'a3'|'custom', width, height (inches, custom), orientation: 'auto'|'portrait'|'landscape', fontSize: 'auto'|7..11 }
   */
  /** Two-sided (T-format) PDF: left and right halves in one box, totals level at the foot. */
  function twoSidedPdf(model, setup) {
    var P = OB.pdf, size = setup.paper === 'custom' ? [Math.max(3, +setup.width || 8.5) * 72, Math.max(3, +setup.height || 11) * 72] : (P.PAPER[setup.paper] || P.PAPER.letter).slice();
    if ((setup.orientation !== 'portrait') !== size[0] > size[1]) size = [size[1], size[0]];   // landscape unless portrait is asked for
    var Wd = size[0], Ht = size[1], mg = 36, usable = Wd - 2 * mg, half = usable / 2, fs = +setup.fontSize || 8.5, lh = fs * 1.6;
    var sides = M.twoSidesRows(model), L = sides.left, R = sides.right;
    var prep = function (sd) { var d0 = sd.rows.reduce(function (m, r) { return Math.min(m, r.depth || 0); }, 9); sd.list = sd.rows.map(function (r) { return { label: r.label, depth: (r.depth || 0) - (d0 === 9 ? 0 : d0), bold: !!r.bold, text: M.cellText(model, r, 0), line: r.line && r.cells && typeof r.cells[0] === 'number' && !!M.cellText(model, r, 0) }; });
      if (sd.extra) sd.list.push({ label: sd.extra.label, depth: 0, bold: true, text: M.fmtNumber(sd.extra.value, model.nf, {}) }); };
    prep(L); prep(R);
    var headH = (fs + 5) * 1.3 + (fs + 3) * 1.3 + Math.max(0, model.lines.length - 2) * (fs + 1) * 1.35 + 10, footH = 26 + model.footer.length * (fs * 1.3);
    var top = mg + headH, per = Math.max(4, Math.floor((Ht - mg - footH - top - lh * 3.2) / lh)), n = Math.max(1, Math.ceil(Math.max(L.list.length, R.list.length) / per));
    var doc = P.create({ width: Wd, height: Ht });
    for (var pi = 0; pi < n; pi++) {
      doc.addPage();
      var yy = mg;
      model.lines.forEach(function (t, i) { if (!t) return; var z = i === 0 ? fs + 5 : i === 1 ? fs + 3 : fs + 1; doc.text(Wd / 2, yy, t, { size: z, bold: i < 2, align: 'center', maxWidth: usable }); yy += z * (i < 2 ? 1.3 : 1.35); });
      var last = pi === n - 1, rowsHere = Math.max(Math.min(per, L.list.length - pi * per), Math.min(per, R.list.length - pi * per), 1);
      var bottom = top + lh * 1.3 + rowsHere * lh + 4 + (last ? lh * 1.5 : 0);
      doc.rect(mg, top, usable, lh * 1.3, { fill: 'F2F5F4' });
      [[L, mg], [R, mg + half]].forEach(function (q) {
        var sd = q[0], x = q[1], y = top + (lh * 1.3 - fs) / 2;
        doc.text(x + 6, y, sd.title + (pi ? ' (continued)' : ''), { size: fs, bold: true, maxWidth: half - 12 });
        y = top + lh * 1.3 + 4 + (lh - fs) / 2;
        sd.list.slice(pi * per, (pi + 1) * per).forEach(function (r) {
          var ind = r.depth * fs * 1.1, w = r.text ? doc.text(x + half - 6, y, r.text, { size: fs, bold: r.bold, align: 'right' }) : 0;
          doc.text(x + 6 + ind, y, r.label, { size: fs, bold: r.bold, maxWidth: half - 18 - ind - w });
          if (r.line) doc.line(x + half - 6 - Math.max(w, 40), y - 1.5, x + half - 6, y - 1.5, { width: 0.5 });
          y += lh;
        });
        if (last) {
          var ty = bottom - lh * 1.5, by = ty + (lh * 1.5 - fs) / 2;
          doc.line(x, ty, x + half, ty, { width: 0.8 });
          doc.text(x + 6, by, sd.totalLabel, { size: fs, bold: true });
          var tw = doc.text(x + half - 6, by, M.fmtNumber(sd.total, model.nf, { symbol: true }), { size: fs, bold: true, align: 'right' });
          doc.line(x + half - 6 - tw, by + fs + 1.5, x + half - 6, by + fs + 1.5, { width: 0.5 }); doc.line(x + half - 6 - tw, by + fs + 3, x + half - 6, by + fs + 3, { width: 0.5 });
        }
      });
      [[mg, top, mg + usable, top], [mg, bottom, mg + usable, bottom], [mg, top, mg, bottom], [mg + usable, top, mg + usable, bottom], [mg + half, top, mg + half, bottom], [mg, top + lh * 1.3, mg + usable, top + lh * 1.3]].forEach(function (q) { doc.line(q[0], q[1], q[2], q[3], { width: 0.7, color: '5E6E6A' }); });
      var fy = Ht - mg - footH + 10;
      doc.line(mg, fy, Wd - mg, fy, { width: 0.4, color: '999999' });
      model.footer.forEach(function (t, i) { doc.text(mg, fy + 5 + i * fs * 1.3, t, { size: fs - 0.5, maxWidth: usable - 80 }); });
      doc.text(Wd - mg, fy + 5, 'Page ' + (pi + 1) + ' of ' + n, { size: fs - 0.5, align: 'right' });
    }
    return doc.output({ title: model.lines[1] || 'Report' });
  }
  M.toPdf = function (model, setup) {
    setup = setup || {};
    var P = OB.pdf;
    var size = setup.paper === 'custom' ? [Math.max(3, +setup.width || 8.5) * 72, Math.max(3, +setup.height || 11) * 72] : (P.PAPER[setup.paper] || P.PAPER.letter).slice();
    var ncol = model.columns.length;
    // layout (statements only): two-sided and stepped need a single amount column, otherwise they print as Classic
    var look = model.kind === 'table' ? 'classic' : M.lookOf(model.look);
    if ((look === 'two' || look === 'step') && ncol !== 1) look = 'classic';
    if (look === 'two') return twoSidedPdf(model, setup);
    var F = look === 'formal' ? 'tnr' : null, ms = function (t, z, bold) { return P.measure(t, z, F || bold); };
    var LH = { lines: 1.9, grid: 1.8, pad: 1.8, bars: 1.8, boxed: 1.75, dense: 1.3, big: 1.65, banded: 1.7 }[look] || 1.55;
    var landscape = setup.orientation === 'landscape' || (setup.orientation !== 'portrait' && !model.portrait && ncol > (model.kind === 'table' ? 5 : 6));
    if (landscape !== size[0] > size[1]) size = [size[1], size[0]];
    var Wd = size[0], Ht = size[1], mg = 36, usable = Wd - 2 * mg;
    var texts = model.rows.map(function (r) { return model.columns.map(function (c, i) { return M.cellText(model, r, i); }); });
    var lastHead = model.head[model.head.length - 1];
    var natural = function (fs) {
      // overflowLabels: a heading or total runs on across the empty cells to its right (QuickBooks style), so only rows with text next to the label set its width
      var sized = model.overflowLabels ? model.rows.filter(function (r) { return r.cells && r.cells[0] !== null && r.cells[0] !== undefined && r.cells[0] !== ''; }) : model.rows;
      var w = [sized.reduce(function (m, r) { return Math.max(m, ms(r.label, fs, r.bold) + (r.depth || 0) * fs * 1.1); }, ms(model.labelHead, fs, true)) + 8];
      model.columns.forEach(function (c, i) {
        var m = Math.min(ms(lastHead[i], fs, true), fs * 9);
        texts.forEach(function (t, k) { m = Math.max(m, ms(t[i], fs, model.rows[k].bold)); });
        w.push(Math.min(m, fs * 26) + 10);
      });
      return w;
    };
    var fs = +setup.fontSize || 0, widths;
    if (fs) widths = natural(fs);
    else { fs = look === 'dense' ? 7.5 : ncol > 8 ? 7 : 8.5; widths = natural(fs); while (fs > 6 && widths.reduce(function (a, b) { return a + b; }, 0) > usable) { fs -= 0.5; widths = natural(fs); } }
    var total = widths.reduce(function (a, b) { return a + b; }, 0);
    if (total < usable) widths[0] += usable - total;
    else {
      // still too wide at the smallest size: shrink the label and text columns (they get "…"), keep figures whole
      var fixed = 0, flex = 0;
      widths.forEach(function (w, i) { if (i && model.columns[i - 1].num) fixed += w; else flex += w; });
      var k = Math.max(0.2, (usable - fixed) / flex);
      widths = widths.map(function (w, i) { return i && model.columns[i - 1].num ? w : w * k; });
    }
    // statements: give spare width to the figures rather than an over-wide label column
    if (model.kind !== 'table' && ncol && widths[0] > usable * 0.55) { var extra = widths[0] - usable * 0.55; widths[0] -= extra; for (var q = 1; q < widths.length; q++) widths[q] += extra / ncol; }
    // stepped: three positions inside the one amount column (accounts, sub-totals, section totals)
    var sw = 0;
    if (look === 'step') { sw = widths[1]; var grow = Math.min(sw * 2, Math.max(0, widths[0] - usable * 0.3)); sw = Math.min(sw, (widths[1] + grow) / 3); widths[1] += grow; widths[0] -= grow; }
    var stepOff = function (r) { return !sw ? 0 : r.kind === 'account' ? 2 * sw : (r.kind === 'total' || r.kind === 'collapsed') && r.depth > 0 ? sw : 0; };
    var xs = [mg]; widths.forEach(function (w, i) { xs.push(xs[i] + w); });
    var lh = fs * LH, numAlign = function (i) { return model.columns[i].num === false ? 'left' : 'right'; };
    var headH = (fs + 5) * 1.3 + (fs + 3) * 1.3 + Math.max(0, model.lines.length - 2) * (fs + 1) * 1.35 + 8 + model.head.length * lh * (model.head.length > 1 ? 1 : 1.2) + 4;
    var footH = 26 + model.footer.length * (fs * 1.3);
    var bodyTop = mg + headH, bodyBottom = Ht - mg - footH;
    var top0 = function (r) { return r.depth === 0 && (r.kind === 'header' || r.kind === 'collapsed' || r.kind === 'total' || r.kind === 'net'); };
    var boxEnd = function (r) { return r.depth === 0 && (r.kind === 'total' || r.kind === 'collapsed' || r.kind === 'net'); };
    var rowFs = function (r) { return look === 'big' && top0(r) ? fs + 3 : look === 'big' && r.kind === 'account' ? fs - 0.5 : fs; };
    var rowH = function (r) { return r.kind === 'spacer' ? lh * 0.6 : (look === 'big' && top0(r) ? lh * 1.3 : lh) + (look === 'boxed' && boxEnd(r) ? lh * 0.45 : 0); };
    // paginate
    var pages = [[]], y = bodyTop;
    model.rows.forEach(function (r, i) {
      var need = rowH(r);
      var keepNext = r.kind === 'header' ? lh : 0;
      if (pages[pages.length - 1].length && (r.pageBreak || y + need + keepNext > bodyBottom)) { pages.push([]); y = bodyTop; }
      pages[pages.length - 1].push(i); y += need;
    });
    var doc = P.create({ width: Wd, height: Ht });
    var tx = function (x, y0, t, o) { if (F) o.font = F; return doc.text(x, y0, t, o); };
    var GREY = 'F2F5F4', RULE = 'C9D2CE', DARK = '1B2826';
    var red = model.nf && model.nf.red === '1';
    pages.forEach(function (list, pi) {
      doc.addPage();
      var yy = mg, center = Wd / 2;
      model.lines.forEach(function (t, i) {
        if (!t) return;
        var s = i === 0 ? fs + 5 : i === 1 ? fs + 3 : fs + 1;
        tx(center, yy, t, { size: s, bold: i < 2, align: 'center', maxWidth: usable });
        yy += s * (i < 2 ? 1.3 : 1.35);
      });
      yy += 8;
      model.head.forEach(function (hr, hi) {
        var last = hi === model.head.length - 1;
        if (!last) { var c = 1; hr.forEach(function (g) { var x1 = xs[c], x2 = xs[c + g.span]; if (g.label) tx((x1 + x2) / 2, yy, g.label, { size: fs, bold: true, align: 'center', maxWidth: x2 - x1 - 4 }); c += g.span; }); }
        else {
          if (model.labelHead) tx(xs[0] + 2, yy, model.labelHead, { size: fs, bold: true, maxWidth: widths[0] - 4 });
          hr.forEach(function (l, i) { var al = numAlign(i); tx(al === 'right' ? xs[i + 2] - 3 : xs[i + 1] + 3, yy, l, { size: fs, bold: true, align: al, maxWidth: widths[i + 1] - 6 }); });
        }
        yy += lh * (last ? 1.2 : 1);
      });
      doc.line(mg, yy - 3, Wd - mg, yy - 3, { width: 0.8 });
      yy += 1 + (lh - fs * 1.55) / 2;
      var bodyY = yy - (lh - fs) / 2, band = 0, boxTop = null, x0 = mg, x9 = Wd - mg, lastB = bodyY;
      var closeBox = function (yb) { if (boxTop === null) return; [[x0, boxTop, x9, boxTop], [x0, yb, x9, yb], [x0, boxTop, x0, yb], [x9, boxTop, x9, yb]].forEach(function (q) { doc.line(q[0], q[1], q[2], q[3], { width: 0.6, color: '8A9A95' }); }); boxTop = null; };
      list.forEach(function (ri) {
        var r = model.rows[ri];
        if (r.kind === 'spacer') { yy += lh * 0.6; lastB = yy - (lh - fs) / 2; return; }
        var z = rowFs(r), h = rowH(r) - (look === 'boxed' && boxEnd(r) ? lh * 0.45 : 0), rt = yy - (lh - fs) / 2, rb = rt + h, ink = null;
        if (h > lh) yy += (h - lh) / 2;
        var acct = r.kind === 'account', hdr = r.kind === 'header', d0h = hdr && r.depth === 0;
        // shading first, then rules, then text
        if (look === 'banded') { if (d0h) doc.rect(x0, rt, x9 - x0, h, { fill: 'E3F1EB' }); else if (acct && band++ % 2) doc.rect(x0, rt, x9 - x0, h, { fill: GREY }); }
        if (look === 'bars') { if (d0h || (r.kind === 'collapsed' && r.depth === 0)) { doc.rect(x0, rt, x9 - x0, h, { fill: DARK }); ink = 'FFFFFF'; } else if (!acct) doc.rect(x0, rt, x9 - x0, h, { fill: GREY }); }
        if ((look === 'grid' && hdr) || (look === 'boxed' && d0h)) doc.rect(x0, rt, x9 - x0, h, { fill: GREY });
        if (look === 'boxed' && boxTop === null && r.depth === 0) boxTop = rt;
        if (look === 'grid' || look === 'pad' || look === 'dense' || ((look === 'lines' || look === 'bars') && (acct || r.kind === 'collapsed'))) doc.line(x0, rb, x9, rb, { width: look === 'dense' ? 0.3 : 0.4, color: RULE });
        if ((look === 'lines' || look === 'big') && d0h) doc.line(x0, rb, x9, rb, { width: 0.7, color: look === 'big' ? '1B2826' : '5E6E6A' });
        if (look === 'big' && acct) ink = '555E5B';
        var indent = (r.depth || 0) * fs * 1.1 + (r.kind === 'total' && model.kind !== 'table' ? fs * 1.1 : 0);
        var label = r.kind === 'header' && pi && ri === list[0] ? r.label + ' (continued)' : r.label;
        var room = widths[0];
        if (model.overflowLabels) { var j = 0; while (j < model.columns.length && !(texts[ri][j])) { room += widths[j + 1]; j++; } }
        var lw = tx(xs[0] + 2 + indent, yy, label, { size: z, bold: !!r.bold, color: ink, maxWidth: room - 4 - indent });
        if (r.cells) model.columns.forEach(function (col, i) {
          var t = texts[ri][i];
          var v = r.cells[i], cls = M.condClass(r, v, col);
          var color = cls === 'bad' || (red && typeof v === 'number' && v < 0 && !col.pct) ? 'B3261E' : cls === 'good' ? '1E7B34' : null;
          var al = numAlign(i), x1 = xs[i + 1], x2 = xs[i + 2] - stepOff(r);
          if (sw) x1 = x2 - sw;
          var tw = t ? tx(al === 'right' ? x2 - 3 : x1 + 3, yy, t, { size: z, bold: !!r.bold, align: al, color: color || ink, maxWidth: x2 - x1 - 6 }) : 0;
          // formal: dotted leader from the account name to its first amount
          if (look === 'formal' && acct && i === 0 && t) { var da = xs[0] + 2 + indent + lw + 5, db = x2 - 3 - tw - 5, dn = Math.floor((db - da) / (fs * 0.5)); if (dn > 2) tx(db, yy, new Array(dn + 1).join('. ').trim(), { size: fs, align: 'right', color: '8A9A95' }); }
          if (r.line && typeof v === 'number' && t) {
            doc.line(x1 + 6, yy - 1.5, x2 - 2, yy - 1.5, { width: 0.5 });
            if (r.line === 'double') { doc.line(x1 + 6, yy + z + 2, x2 - 2, yy + z + 2, { width: 0.5 }); doc.line(x1 + 6, yy + z + 3.5, x2 - 2, yy + z + 3.5, { width: 0.5 }); }
          }
        });
        yy = rt + (lh - fs) / 2 + rowH(r); lastB = rb;
        if (look === 'boxed' && boxEnd(r)) closeBox(rb);
      });
      closeBox(lastB);
      // vertical rules: every column for the full grid, the amount columns for ledger paper
      if (look === 'grid' || look === 'pad') { for (var c = look === 'grid' ? 0 : 1; c < xs.length - (look === 'grid' ? 0 : 1); c++) doc.line(xs[c], bodyY - (look === 'grid' ? lh * 1.2 : 0), xs[c], lastB, { width: look === 'pad' ? 0.6 : 0.4, color: look === 'pad' ? '5E6E6A' : RULE }); }
      var fy = Ht - mg - footH + 10;
      doc.line(mg, fy, Wd - mg, fy, { width: 0.4, color: '999999' });
      model.footer.forEach(function (t, i) { tx(mg, fy + 5 + i * fs * 1.3, t, { size: fs - 0.5, maxWidth: usable - 80 }); });
      tx(Wd - mg, fy + 5, 'Page ' + (pi + 1) + ' of ' + pages.length, { size: fs - 0.5, align: 'right' });
    });
    return doc.output({ title: model.lines[1] || 'Report' });
  };
})(typeof window !== 'undefined' ? window : globalThis);
