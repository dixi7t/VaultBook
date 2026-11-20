/* VaultBook — statement designer engine (report templates).
 * A template is JSON (format "vaultbook-report-template", version 1; schema in D.SCHEMA) describing rows:
 *   accounts — accounts picked by type, number range, name text, explicit ids, "all remaining" (and Net Income on a balance sheet)
 *   formula  — arithmetic on other rows' ids (+ − × ÷, parentheses, abs/min/max), shown as money, % or ratio
 *   header / text / spacer — layout
 * with per-row style (bold, italic, indent, line above / double line, page break, hide when zero) and a conditional
 * colour rule. Values come from R.statement (same columns, comparisons, basis and filters as the statement screen),
 * so a template never has its own calculation of account balances. The result has the statement tree shape, so the
 * statement table, drill-down, Excel (with live formulas) and PDF adapters render it unchanged.
 * Money values inside formulas are dollars; a % row's formula is a fraction (gp / income → 45.2 %).
 */
(function (root) {
  'use strict';
  var OB = root.OB = root.OB || {};
  var U = OB.util, S = OB.schema, R = OB.reports;
  var D = OB.designer = {};
  D.FORMAT = 'vaultbook-report-template';
  D.VERSION = 1;
  var ROW_TYPES = ['accounts', 'formula', 'header', 'text', 'spacer'];
  var FMTS = ['money', 'pct', 'ratio'];
  var OPS = ['lt', 'le', 'gt', 'ge'];
  var LINES = ['', 'above', 'double'];
  var ID_RE = /^[a-z_][a-z0-9_]{0,31}$/;

  /** JSON Schema (draft 2020-12) of a template file — for other tools; D.validate applies the same rules plus formula checks. */
  D.SCHEMA = {
    $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'urn:vaultbook:report-template:1', title: 'VaultBook report template', type: 'object',
    required: ['format', 'version', 'kind', 'rows'],
    properties: {
      format: { const: D.FORMAT }, version: { const: 1 }, name: { type: 'string', maxLength: 80 }, kind: { enum: ['pl', 'bs'] },
      period: { type: 'object', properties: { range: { type: 'string' }, from: { type: 'string', format: 'date' }, to: { type: 'string', format: 'date' } } },
      basis: { enum: ['', 'cash', 'accrual'] },
      columns: { type: 'object', properties: { by: { enum: ['total', 'day', 'week', 'month', 'quarter', 'year', 'class', 'customer', 'vendor'] }, compare: { type: 'array', items: { enum: Object.keys(R.COMPARE_LABELS || {}) } } } },
      header: { type: 'object', properties: { title: { type: 'string' }, subtitle: { type: 'string' }, showCompany: { type: 'boolean' }, footer: { type: 'string' } } },
      rows: { type: 'array', maxItems: 500, items: { type: 'object', required: ['type'], properties: {
        id: { type: 'string', pattern: ID_RE.source }, type: { enum: ROW_TYPES }, label: { type: 'string', maxLength: 120 }, totalLabel: { type: 'string', maxLength: 120 },
        select: { type: 'object', properties: { types: { type: 'array', items: { type: 'string' } }, numbers: { type: 'string' }, match: { type: 'string' }, accounts: { type: 'array', items: { type: 'string' } }, rest: { type: 'boolean' }, netIncome: { type: 'boolean' } } },
        detail: { enum: ['summary', 'accounts', 'none'] }, sign: { enum: [1, -1] }, formula: { type: 'string', maxLength: 500 }, format: { enum: FMTS },
        style: { type: 'object', properties: { bold: { type: 'boolean' }, italic: { type: 'boolean' }, indent: { type: 'integer', minimum: 0, maximum: 6 }, line: { enum: LINES }, pageBreak: { type: 'boolean' }, hideZero: { type: 'boolean' } } },
        cond: { type: 'object', required: ['op', 'value'], properties: { op: { enum: OPS }, value: { type: 'number' }, style: { enum: ['bad', 'good'] } } }
      } } }
    }
  };

  /* ---------- formulas ---------- */
  var FUNCS = { abs: 1, min: 1, max: 1 };
  function tokenize(src) {
    var out = [], i = 0, s = String(src || '');
    while (i < s.length) {
      var c = s[i];
      if (/\s/.test(c)) { i++; continue; }
      var m = /^(\d+(?:\.\d+)?|\.\d+)/.exec(s.slice(i));
      if (m) { out.push({ t: 'num', v: +m[1] }); i += m[1].length; continue; }
      m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(s.slice(i));
      if (m) { out.push({ t: 'id', v: m[0].toLowerCase() }); i += m[0].length; continue; }
      if ('+-*/(),'.indexOf(c) >= 0) { out.push({ t: c }); i++; continue; }
      if (c === '×') { out.push({ t: '*' }); i++; continue; }
      if (c === '÷') { out.push({ t: '/' }); i++; continue; }
      if (c === '−') { out.push({ t: '-' }); i++; continue; }
      throw new Error('Unexpected “' + c + '” in formula');
    }
    return out;
  }
  /** Parse a formula into a tree. Throws a plain-English error. Returns { ast, refs: [row ids] }. */
  D.parseFormula = function (src) {
    var toks = tokenize(src), p = 0, refs = {};
    if (!toks.length) throw new Error('The formula is empty');
    var peek = function () { return toks[p] || { t: 'end' }; };
    var take = function (t) { var x = peek(); if (x.t !== t) throw new Error(t === ')' ? 'A “)” is missing' : 'Expected “' + t + '”'); p++; return x; };
    function expr() { var n = term(); while (peek().t === '+' || peek().t === '-') { var op = toks[p++].t; n = { op: op, a: n, b: term() }; } return n; }
    function term() { var n = unary(); while (peek().t === '*' || peek().t === '/') { var op = toks[p++].t; n = { op: op, a: n, b: unary() }; } return n; }
    function unary() { if (peek().t === '-') { p++; return { op: 'neg', a: unary() }; } if (peek().t === '+') { p++; return unary(); } return primary(); }
    function primary() {
      var x = peek();
      if (x.t === 'num') { p++; return { num: x.v }; }
      if (x.t === 'id') {
        p++;
        if (peek().t === '(') {
          if (!FUNCS[x.v]) throw new Error('Unknown function “' + x.v + '” (use abs, min or max)');
          p++; var args = [expr()];
          while (peek().t === ',') { p++; args.push(expr()); }
          take(')');
          if (x.v === 'abs' && args.length !== 1) throw new Error('abs() takes one value');
          return { fn: x.v, args: args };
        }
        refs[x.v] = 1; return { ref: x.v };
      }
      if (x.t === '(') { p++; var n = expr(); take(')'); return n; }
      throw new Error(x.t === 'end' ? 'The formula ends too early' : 'Unexpected “' + x.t + '” in formula');
    }
    var ast = expr();
    if (p < toks.length) throw new Error('Unexpected “' + (toks[p].v || toks[p].t) + '” in formula');
    return { ast: ast, refs: Object.keys(refs) };
  };
  /** Evaluate a parsed formula; get(id) returns a number or null. Division by zero and missing values give null. */
  D.evalFormula = function (ast, get) {
    var ev = function (n) {
      if (n.num !== undefined) return n.num;
      if (n.ref) { var v = get(n.ref); return v === null || v === undefined || !isFinite(v) ? null : v; }
      if (n.fn) {
        var args = n.args.map(ev);
        if (args.some(function (a) { return a === null; })) return null;
        return n.fn === 'abs' ? Math.abs(args[0]) : Math[n.fn].apply(null, args);
      }
      var a = ev(n.a);
      if (n.op === 'neg') return a === null ? null : -a;
      var b = ev(n.b);
      if (a === null || b === null) return null;
      if (n.op === '+') return a + b;
      if (n.op === '-') return a - b;
      if (n.op === '*') return a * b;
      return b === 0 ? null : a / b;
    };
    return ev(ast);
  };
  /** Excel formula tokens (strings and { key: node key }) for a parsed formula. */
  function excelTokens(ast, keyOf) {
    var out = [];
    var w = function (n, parentPrec) {
      if (n.num !== undefined) { out.push(String(n.num)); return; }
      if (n.ref) { out.push({ key: keyOf(n.ref) }); return; }
      if (n.fn) { out.push(n.fn.toUpperCase() + '('); n.args.forEach(function (a, i) { if (i) out.push(','); w(a, 0); }); out.push(')'); return; }
      if (n.op === 'neg') { out.push('-('); w(n.a, 0); out.push(')'); return; }
      var prec = n.op === '+' || n.op === '-' ? 1 : 2;
      if (prec < parentPrec) out.push('(');
      w(n.a, prec); out.push(n.op); w(n.b, prec + (n.op === '-' || n.op === '/' ? 1 : 0));
      if (prec < parentPrec) out.push(')');
    };
    w(ast, 0);
    return out;
  }

  /* ---------- account selection ---------- */
  function scopeTypes(kind) { return S.ACCOUNT_TYPES.filter(function (t) { return kind === 'bs' ? S.isBS(t.id) : S.isPL(t.id); }).map(function (t) { return t.id; }); }
  /** "4000-4999, 6100, 7000-" → [[lo, hi]] on numeric account numbers. */
  function parseRanges(txt) {
    var out = [];
    String(txt || '').split(/[,;]/).map(function (x) { return x.trim(); }).filter(Boolean).forEach(function (part) {
      var m = /^(\d+)?\s*(?:-|–|to)\s*(\d+)?$/.exec(part);
      if (m && (m[1] || m[2])) out.push([m[1] ? +m[1] : -Infinity, m[2] ? +m[2] : Infinity]);
      else if (/^\d+$/.test(part)) out.push([+part, +part]);
      else throw new Error('Account numbers “' + part + '”: use 4000-4999 or 6100');
    });
    return out;
  }
  D.parseRanges = parseRanges;
  /** Accounts a row selects (explicit part only; "rest" is resolved by D.run). */
  D.selectAccounts = function (book, sel, kind) {
    sel = sel || {};
    var scope = scopeTypes(kind), types = sel.types && sel.types.length ? sel.types : null;
    var ranges = sel.numbers ? parseRanges(sel.numbers) : null;
    var text = String(sel.match || '').trim().toLowerCase();
    var ids = sel.accounts && sel.accounts.length ? sel.accounts : null;
    if (!types && !ranges && !text && !ids) return [];
    return book.sortedAccounts(function (a) {
      if (scope.indexOf(a.type) < 0) return false;
      if (ids && ids.indexOf(a.id) >= 0) return true;
      if (!types && !ranges && !text) return false;
      if (types && types.indexOf(a.type) < 0) return false;
      if (ranges) { var n = parseFloat(a.number); if (!isFinite(n) || !ranges.some(function (r) { return n >= r[0] && n <= r[1]; })) return false; }
      if (text && book.accountFullName(a).toLowerCase().indexOf(text) < 0) return false;
      return true;
    }).map(function (a) { return a.id; });
  };

  /* ---------- validation ---------- */
  D.normalize = function (def) {
    var d = U.clone(def || {});
    d.format = D.FORMAT; d.version = D.VERSION;
    d.kind = d.kind === 'bs' ? 'bs' : 'pl';
    d.name = String(d.name || '').trim();
    d.period = d.period || { range: 'fyToDate' };
    d.basis = d.basis === 'cash' || d.basis === 'accrual' ? d.basis : '';
    d.columns = d.columns || {}; d.columns.by = d.columns.by || 'total'; d.columns.compare = (d.columns.compare || []).filter(function (x) { return R.COMPARE_LABELS[x]; });
    d.header = d.header || {};
    d.rows = (d.rows || []).map(function (r) {
      var x = { type: ROW_TYPES.indexOf(r.type) >= 0 ? r.type : 'text' };
      ['id', 'label', 'totalLabel', 'formula', 'format', 'detail'].forEach(function (k) { if (r[k] !== undefined && r[k] !== '') x[k] = String(r[k]); });
      if (x.id) x.id = x.id.toLowerCase();
      if (r.sign === -1 || r.sign === '-1') x.sign = -1;
      if (r.select) x.select = U.clone(r.select);
      if (r.style) x.style = U.clone(r.style);
      if (r.cond && r.cond.op && r.cond.value !== '' && r.cond.value !== undefined && r.cond.value !== null) x.cond = { op: r.cond.op, value: +r.cond.value, style: r.cond.style === 'good' ? 'good' : 'bad' };
      return x;
    });
    return d;
  };
  /** { errors: [msg], warnings: [msg] } — errors stop the report; warnings are shown with it. */
  D.validate = function (def, book) {
    var errors = [], warnings = [];
    if (!def || typeof def !== 'object') return { errors: ['This is not a report template.'], warnings: [] };
    if (def.format !== D.FORMAT) errors.push('Not a VaultBook report template (format must be “' + D.FORMAT + '”).');
    if (def.version !== D.VERSION) errors.push('Template version ' + def.version + ' is not supported (expected ' + D.VERSION + ').');
    if (def.kind !== 'pl' && def.kind !== 'bs') errors.push('Kind must be “pl” (profit and loss) or “bs” (balance sheet).');
    if (!Array.isArray(def.rows)) { errors.push('The template has no rows.'); return { errors: errors, warnings: warnings }; }
    if (def.rows.length > 500) errors.push('A template can have at most 500 rows.');
    var ids = {}, parsed = {}, kindOf = {};
    def.rows.forEach(function (r, i) {
      var where = 'Row ' + (i + 1) + (r.label ? ' “' + r.label + '”' : '');
      if (ROW_TYPES.indexOf(r.type) < 0) errors.push(where + ': unknown row type “' + r.type + '”.');
      if (r.id !== undefined) {
        if (!ID_RE.test(r.id)) errors.push(where + ': id “' + r.id + '” must start with a letter and use only a–z, 0–9 and _.');
        else if (ids[r.id]) errors.push(where + ': id “' + r.id + '” is used twice.');
        else if (FUNCS[r.id]) errors.push(where + ': id “' + r.id + '” is a function name.');
        else { ids[r.id] = i + 1; kindOf[r.id] = r.type; }
      }
      if (r.format && FMTS.indexOf(r.format) < 0) errors.push(where + ': format must be money, pct or ratio.');
      if (r.cond && (OPS.indexOf(r.cond.op) < 0 || !isFinite(r.cond.value))) errors.push(where + ': the colour rule needs a comparison and a number.');
      if (r.style && r.style.line && LINES.indexOf(r.style.line) < 0) errors.push(where + ': line must be above or double.');
      if (r.type === 'formula') {
        if (!r.formula) errors.push(where + ': enter a formula, for example “income - expenses”.');
        else { try { parsed[r.id || '#' + i] = D.parseFormula(r.formula); parsed[r.id || '#' + i].row = i; } catch (e) { errors.push(where + ': ' + e.message + '.'); } }
      }
      if (r.type === 'accounts') {
        var s = r.select || {};
        if (s.numbers) { try { parseRanges(s.numbers); } catch (e) { errors.push(where + ': ' + e.message + '.'); } }
        if (!(s.types && s.types.length) && !s.numbers && !String(s.match || '').trim() && !(s.accounts && s.accounts.length) && !s.rest && !s.netIncome) errors.push(where + ': choose which accounts the row adds up.');
        if (s.netIncome && def.kind !== 'bs') errors.push(where + ': Net Income as an account line is only for balance sheets.');
        if (book && s.accounts) s.accounts.forEach(function (id) { if (!book.accById[id]) warnings.push(where + ': an account picked for this row no longer exists.'); });
        if (s.types) { var sc = scopeTypes(def.kind); s.types.forEach(function (t) { if (sc.indexOf(t) < 0) errors.push(where + ': account type “' + t + '” does not belong on this kind of report.'); }); }
      }
    });
    var rests = def.rows.filter(function (r) { return r.type === 'accounts' && r.select && r.select.rest; }).length;
    if (rests > 1) errors.push('Only one row can collect “all remaining accounts”.');
    // references and cycles
    Object.keys(parsed).forEach(function (k) {
      parsed[k].refs.forEach(function (ref) {
        if (!ids[ref]) errors.push('Row ' + (parsed[k].row + 1) + ': the formula uses “' + ref + '”, but no row has that id.');
        else if (kindOf[ref] !== 'accounts' && kindOf[ref] !== 'formula') errors.push('Row ' + (parsed[k].row + 1) + ': “' + ref + '” is a ' + kindOf[ref] + ' row and has no amount.');
      });
    });
    var state = {};
    var visit = function (id, path) {
      if (state[id] === 2 || !parsed[id]) return;
      if (state[id] === 1) { errors.push('Formulas refer to each other in a circle: ' + path.concat(id).join(' → ') + '.'); return; }
      state[id] = 1; parsed[id].refs.forEach(function (r) { visit(r, path.concat(id)); }); state[id] = 2;
    };
    Object.keys(parsed).forEach(function (k) { if (k[0] !== '#') visit(k, []); });
    errors = errors.filter(function (e, i) { return errors.indexOf(e) === i; });
    return { errors: errors, warnings: warnings };
  };

  /* ---------- run ---------- */
  /**
   * Evaluate a template for a period. o: { from, to, basis (overrides template), classId }
   * Returns a statement-shaped result: { kind, cols, groups, multiHeader, tree, collapsed, audit, warnings, errors }.
   */
  D.run = function (book, def, o) {
    o = o || {};
    def = D.normalize(def);
    var v = D.validate(def, book);
    var base = R.statement(book, { kind: def.kind, from: o.from, to: o.to, basis: o.basis || def.basis || undefined, columns: def.columns.by, compare: def.columns.compare, classId: o.classId || '', rows: 'all', cols: o.cols || 'active' });
    var res = { kind: def.kind, template: true, basis: base.basis, from: o.from, to: o.to, cols: base.cols, groups: base.groups, multiHeader: base.multiHeader, tree: [], sections: {}, collapsed: {}, budget: null,
      errors: v.errors, warnings: v.warnings.slice(), audit: { unmapped: [], duplicates: [] } };
    if (v.errors.length) return res;
    var vcs = base.valueCols, zero = function () { return vcs.map(function () { return 0; }); };
    var accVals = function (id) { return vcs.map(function (c) { return c.map.values[id] || 0; }); };
    var used = {}, rowAccounts = [];
    def.rows.forEach(function (r, i) {
      if (r.type !== 'accounts') return;
      var ids = D.selectAccounts(book, r.select, def.kind);
      ids.forEach(function (id) { (used[id] = used[id] || []).push(i); });
      rowAccounts[i] = ids;
    });
    var scope = scopeTypes(def.kind);
    var hasValue = function (id) { return vcs.some(function (c) { return c.map.values[id] || c.map.active[id]; }); };
    var restIdx = def.rows.findIndex(function (r) { return r.type === 'accounts' && r.select && r.select.rest; });
    var rest = book.sortedAccounts(function (a) { return scope.indexOf(a.type) >= 0 && !used[a.id]; }).map(function (a) { return a.id; });
    if (restIdx >= 0) { rowAccounts[restIdx] = rowAccounts[restIdx].concat(rest); rest.forEach(function (id) { used[id] = [restIdx]; }); }
    else res.audit.unmapped = rest.filter(hasValue);
    res.audit.duplicates = Object.keys(used).filter(function (id) { return used[id].length > 1 && hasValue(id); });
    var niUsed = def.rows.some(function (r) { return r.type === 'accounts' && r.select && (r.select.netIncome || (r.select.rest && def.kind === 'bs')); });
    if (def.kind === 'bs' && !niUsed && vcs.some(function (c) { return c.map.values.__NI; })) res.audit.unmapped.push('__NI');
    if (res.audit.unmapped.length) res.warnings.push(res.audit.unmapped.length + ' account' + (res.audit.unmapped.length > 1 ? 's have' : ' has') + ' amounts but ' + (res.audit.unmapped.length > 1 ? 'are' : 'is') + ' not on this report: ' + res.audit.unmapped.map(function (id) { return id === '__NI' ? 'Net Income' : book.accountLabel(id); }).join(', ') + '.');
    if (res.audit.duplicates.length) res.warnings.push(res.audit.duplicates.length + ' account' + (res.audit.duplicates.length > 1 ? 's are' : ' is') + ' counted on more than one row: ' + res.audit.duplicates.map(function (id) { return book.accountLabel(id); }).join(', ') + '.');

    // values of every accounts / formula row on the raw value columns
    var raw = {}, fmtOf = {}, parsed = {};
    def.rows.forEach(function (r, i) {
      var key = r.id || '#' + i;
      fmtOf[key] = r.type === 'formula' ? (r.format || 'money') : 'money';
      if (r.type === 'accounts') {
        var t = zero(), sg = r.sign === -1 ? -1 : 1;
        rowAccounts[i].forEach(function (id) { accVals(id).forEach(function (x, k) { t[k] += sg * x; }); });
        if (r.select && (r.select.netIncome || (r.select.rest && def.kind === 'bs'))) vcs.forEach(function (c, k) { t[k] += sg * (c.map.values.__NI || 0); });
        raw[key] = t;
      }
      if (r.type === 'formula') parsed[key] = D.parseFormula(r.formula);
    });
    var fval = function (key) {
      if (raw[key]) return raw[key];
      var p = parsed[key];
      raw[key] = vcs.map(function (c, k) {
        var x = D.evalFormula(p.ast, function (ref) { var vals = fval(ref), y = vals[k]; return y === null ? null : fmtOf[ref] === 'pct' ? y / 100 : fmtOf[ref] === 'ratio' ? y : y / 100; });
        if (x === null) return null;
        // money: round half away from zero, like Excel's ROUND, so the spreadsheet shows the same cents
        return fmtOf[key] === 'pct' ? x * 100 : fmtOf[key] === 'ratio' ? x : (x < 0 ? -1 : 1) * Math.round(Math.abs(x) * 100);
      });
      return raw[key];
    };
    Object.keys(parsed).forEach(fval);

    var nodeKey = function (r, i) { return 'd:' + (r.id || i); };
    var cellsOf = function (vals, fmt) {
      var c = base.cellsFor(vals.map(function (x) { return x === null ? NaN : x; })).map(function (x) { return typeof x === 'number' && isNaN(x) ? null : x; });
      if (fmt === 'pct' || fmt === 'ratio') c = c.map(function (x, k) { return res.cols[k].pct ? null : x; });
      return c;
    };
    def.rows.forEach(function (r, i) {
      var st = r.style || {}, depth = Math.max(0, Math.min(6, +st.indent || 0)), key = nodeKey(r, i);
      var style = { bold: !!st.bold, italic: !!st.italic, line: st.line || '', pageBreak: !!st.pageBreak };
      var n;
      if (r.type === 'spacer') n = { key: key, kind: 'spacer', label: '', depth: depth, children: [], style: style };
      else if (r.type === 'header') n = { key: key, kind: 'text', label: r.label || '', depth: depth, children: [], style: Object.assign({}, style, { bold: true }) };
      else if (r.type === 'text') n = { key: key, kind: 'text', label: r.label || '', depth: depth, children: [], style: style };
      else if (r.type === 'formula') {
        var fv = raw[r.id || '#' + i];
        n = { key: key, kind: 'net', label: r.label || r.formula, depth: depth, children: [], style: style, fmt: r.format && r.format !== 'money' ? r.format : '', cond: r.cond, vals: fv, cells: cellsOf(fv, r.format),
          expr: excelTokens(parsed[r.id || '#' + i].ast, function (ref) { var j = def.rows.findIndex(function (x) { return x.id === ref; }); return nodeKey(def.rows[j], j); }) };
        if (!st.bold && !st.line) n.style.plain = true;
      } else {
        var vals = raw[r.id || '#' + i];
        var kids = rowAccounts[i].filter(function (id) { return accVals(id).some(Boolean) || (st.hideZero ? false : hasValue(id)); }).map(function (id) {
          var a = book.accById[id], sg = r.sign === -1 ? -1 : 1, av = accVals(id).map(function (x) { return sg * x; });
          return { key: key + ':' + id, kind: 'account', label: book.accountLabel(id), accountId: id, inactive: !a.active, depth: depth + 1, children: [], vals: av, cells: cellsOf(av) };
        });
        if (r.select && (r.select.netIncome || (r.select.rest && def.kind === 'bs')) && vcs.some(function (c) { return c.map.values.__NI; })) {
          var ni = vcs.map(function (c) { return (r.sign === -1 ? -1 : 1) * (c.map.values.__NI || 0); });
          kids.push({ key: key + ':ni', kind: 'account', label: 'Net Income', netIncome: true, depth: depth + 1, children: [], vals: ni, cells: cellsOf(ni) });
        }
        var label = r.label || 'Accounts';
        if (r.detail === 'none' || !kids.length) n = { key: key, kind: 'account', label: label, depth: depth, children: [], style: style, cond: r.cond, vals: vals, cells: cellsOf(vals), accountId: kids.length === 1 ? kids[0].accountId : undefined };
        else {
          n = { key: key, kind: 'group', label: label, totalLabel: r.totalLabel || 'Total ' + label, depth: depth, children: kids, style: style, cond: r.cond, vals: vals, cells: cellsOf(vals) };
          if (r.detail !== 'accounts') res.collapsed[key] = true;
        }
      }
      if (st.hideZero && n.vals && !n.vals.some(function (x) { return x; })) return;
      if (r.id) res.sections[r.id] = n;
      res.tree.push(n);
    });
    return res;
  };

  /* ---------- files ---------- */
  D.toJson = function (def) { var d = D.normalize(def); return JSON.stringify(Object.assign({ $schema: D.SCHEMA.$id }, d), null, 2); };
  /** Read a template file's text; throws with the validation errors. */
  D.fromJson = function (text, book) {
    var d;
    try { d = JSON.parse(text); } catch (e) { throw new Error('The file is not valid JSON.'); }
    if (!d || d.format !== D.FORMAT) throw new Error('This file is not a VaultBook report template.');
    delete d.$schema;
    var n = D.normalize(d), v = D.validate(n, book);
    if (v.errors.length) throw new Error(v.errors.slice(0, 5).join(' '));
    // ids of specific accounts only mean something in the company that exported them
    n.rows.forEach(function (r) { if (r.select && r.select.accounts) r.select.accounts = r.select.accounts.filter(function (id) { return book && book.accById[id]; }); });
    return n;
  };

  /* ---------- starter templates ---------- */
  D.TEMPLATES = {
    plmargin: { name: 'Condensed P&L with margins', kind: 'pl', columns: { by: 'total', compare: ['py', 'chg'] }, rows: [
      { id: 'income', type: 'accounts', label: 'Revenue', select: { types: ['income'] }, style: { bold: true } },
      { id: 'cogs', type: 'accounts', label: 'Cost of goods sold', select: { types: ['cogs'] } },
      { id: 'gp', type: 'formula', label: 'Gross profit', formula: 'income - cogs', style: { bold: true, line: 'above' } },
      { id: 'gpm', type: 'formula', label: 'Gross margin', formula: 'gp / income', format: 'pct', style: { italic: true, indent: 1 }, cond: { op: 'lt', value: 30, style: 'bad' } },
      { type: 'spacer' },
      { id: 'opex', type: 'accounts', label: 'Operating expenses', select: { types: ['expense'] } },
      { id: 'op', type: 'formula', label: 'Operating income', formula: 'gp - opex', style: { bold: true, line: 'above' }, cond: { op: 'lt', value: 0, style: 'bad' } },
      { id: 'opm', type: 'formula', label: 'Operating margin', formula: 'op / income', format: 'pct', style: { italic: true, indent: 1 } },
      { type: 'spacer' },
      { id: 'oi', type: 'accounts', label: 'Other income', select: { types: ['oi'] }, style: { hideZero: true } },
      { id: 'oe', type: 'accounts', label: 'Other expenses', select: { types: ['oe'] }, style: { hideZero: true } },
      { id: 'other', type: 'formula', label: 'Net other income', formula: 'oi - oe', style: { hideZero: true } },
      { id: 'net', type: 'formula', label: 'Net income', formula: 'op + other', style: { bold: true, line: 'double' }, cond: { op: 'lt', value: 0, style: 'bad' } },
      { id: 'npm', type: 'formula', label: 'Net margin', formula: 'net / income', format: 'pct', style: { italic: true, indent: 1 } }] },
    bsratios: { name: 'Balance Sheet with key ratios', kind: 'bs', columns: { by: 'total', compare: ['pp', 'chg'] }, rows: [
      { type: 'header', label: 'Assets' },
      { id: 'ca', type: 'accounts', label: 'Current assets', select: { types: ['bank', 'ar', 'oca'] }, style: { indent: 1 } },
      { id: 'lta', type: 'accounts', label: 'Fixed and other assets', select: { types: ['fixed', 'oa'] }, style: { indent: 1 } },
      { id: 'ta', type: 'formula', label: 'Total assets', formula: 'ca + lta', style: { bold: true, line: 'double' } },
      { type: 'spacer' },
      { type: 'header', label: 'Liabilities and equity' },
      { id: 'cl', type: 'accounts', label: 'Current liabilities', select: { types: ['ap', 'cc', 'ocl'] }, style: { indent: 1 } },
      { id: 'ltl', type: 'accounts', label: 'Long-term liabilities', select: { types: ['ltl'] }, style: { indent: 1 } },
      { id: 'eq', type: 'accounts', label: 'Equity (including net income)', select: { types: ['equity'], netIncome: true }, style: { indent: 1 } },
      { id: 'tle', type: 'formula', label: 'Total liabilities and equity', formula: 'cl + ltl + eq', style: { bold: true, line: 'double' } },
      { type: 'spacer' },
      { type: 'header', label: 'Key ratios' },
      { id: 'wc', type: 'formula', label: 'Working capital', formula: 'ca - cl', style: { indent: 1 }, cond: { op: 'lt', value: 0, style: 'bad' } },
      { id: 'cr', type: 'formula', label: 'Current ratio', formula: 'ca / cl', format: 'ratio', style: { indent: 1 }, cond: { op: 'lt', value: 1, style: 'bad' } },
      { id: 'de', type: 'formula', label: 'Debt to equity', formula: '(cl + ltl) / eq', format: 'ratio', style: { indent: 1 }, cond: { op: 'gt', value: 2, style: 'bad' } }] },
    blankpl: { name: 'Blank profit and loss', kind: 'pl', rows: [
      { id: 'income', type: 'accounts', label: 'Income', select: { types: ['income', 'oi'] }, detail: 'accounts' },
      { id: 'costs', type: 'accounts', label: 'Costs', select: { rest: true }, detail: 'accounts' },
      { id: 'net', type: 'formula', label: 'Net income', formula: 'income - costs', style: { bold: true, line: 'double' } }] },
    blankbs: { name: 'Blank balance sheet', kind: 'bs', rows: [
      { id: 'assets', type: 'accounts', label: 'Assets', select: { types: ['bank', 'ar', 'oca', 'fixed', 'oa'] }, detail: 'accounts' },
      { id: 'le', type: 'accounts', label: 'Liabilities and equity', select: { rest: true }, detail: 'accounts' },
      { id: 'check', type: 'formula', label: 'Difference (should be zero)', formula: 'abs(assets - le)', style: { italic: true }, cond: { op: 'gt', value: 0, style: 'bad' } }] }
  };
  D.starter = function (key) { var t = D.TEMPLATES[key]; return t ? D.normalize(Object.assign({ format: D.FORMAT, version: D.VERSION }, U.clone(t))) : null; };
})(typeof window !== 'undefined' ? window : globalThis);
