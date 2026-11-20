/* OfflineBooks US — financial statement builder (Profit and Loss, Balance Sheet, Budget vs. Actuals).
 * Produces a column model (display columns × comparisons × calculations) and a row tree
 * (sections → account-type groups → parent accounts → sub-accounts) that the screen,
 * the exports and the tests all share. Every amount is integer cents in the row's natural sign
 * (income, expenses, assets, liabilities and equity all positive when normal).
 */
(function (root) {
  'use strict';
  var OB = root.OB = root.OB || {};
  var U = OB.util, S = OB.schema, R = OB.reports;

  /* ---------- filters ---------- */
  /** Set of class ids for a filter value: '' = all, '__none' = unclassified, id = that class and its sub-classes. */
  R.classFilter = function (book, id) {
    if (!id) return null;
    if (id === '__none') return '__none';
    var set = {}; set[id] = 1;
    var grew = true, guard = 0;
    while (grew && guard++ < 20) {
      grew = false;
      (book.classes || []).forEach(function (c) { if (c.parentId && set[c.parentId] && !set[c.id]) { set[c.id] = 1; grew = true; } });
    }
    return set;
  };
  function passes(e, f) {
    if (!f) return true;
    if (f.cls) {
      var c = e.s.classId || '';
      if (f.cls === '__none' ? c : !f.cls[c]) return false;
    }
    if (f.clsExact !== undefined && (e.s.classId || '') !== f.clsExact) return false;
    if (f.contactId !== undefined && (e.s.contactId || e.t.contactId || '') !== f.contactId) return false;
    if (f.accountIds && !f.accountIds[e.s.accountId]) return false;
    return true;
  }

  /** P&L amounts per account for a range: { values: {accountId: natural cents}, active: {accountId: true} }. */
  R.plMap = function (book, basis, from, to, f) {
    var ent = R.entries(book, basis), values = {}, active = {};
    book.accounts.forEach(function (a) {
      if (!S.isPL(a.type)) return;
      var list = ent[a.id]; if (!list) return;
      var t = 0, act = false;
      for (var i = 0; i < list.length; i++) {
        var d = list[i].t.date;
        if (to && d > to) break;
        if (from && d < from) continue;
        if (!passes(list[i], f)) continue;
        t += list[i].s.amount; act = true;
      }
      if (t) values[a.id] = book.normalSign(a) * t;
      if (act) active[a.id] = true;
    });
    return { values: values, active: active };
  };

  /** Balance sheet balances per account as of a date (Retained Earnings includes prior years' profit; NI = this fiscal year). */
  R.bsMap = function (book, basis, asOf) {
    var ent = R.entries(book, basis), values = {}, active = {};
    var fys = U.fiscalYearStart(asOf, book.company.fiscalYearStartMonth || 1);
    var reAcc = book.sys('RE');
    book.accounts.forEach(function (a) {
      if (!S.isBS(a.type)) return;
      var list = ent[a.id];
      var v = (S.TYPE[a.type].cls === 'asset' ? 1 : -1) * R.rawSum(list, null, asOf);
      if (reAcc && a.id === reAcc.id) v += R.netIncome(book, basis, null, U.addDays(fys, -1));
      if (v) values[a.id] = v;
      if (list && list.length && list[0].t.date <= asOf) active[a.id] = true;
    });
    values.__NI = R.netIncome(book, basis, fys, asOf);
    return { values: values, active: active, fyStart: fys };
  };

  /** Budget amounts per account for the months that start inside [from, to]. */
  R.budgetMap = function (book, budget, from, to) {
    var values = {};
    if (!budget) return { values: values, active: {} };
    var start = budget.fyStart;
    Object.keys(budget.amounts || {}).forEach(function (accId) {
      var row = budget.amounts[accId], t = 0;
      for (var k = 0; k < 12; k++) {
        var ms = U.addMonths(start, k);
        if (ms >= U.monthStart(from) && ms <= to) t += row[k] || 0;
      }
      if (t) values[accId] = t;
    });
    return { values: values, active: {} };
  };

  /* ---------- columns ---------- */
  var PERIOD_MODES = { total: 1, day: 1, week: 1, month: 1, quarter: 1, year: 1 };
  R.periodsEx = function (from, to, mode) {
    if (mode === 'day' || mode === 'week') {
      var cols = [], start = from, guard = 0;
      while (start <= to && guard++ < 400) {
        var end = mode === 'day' ? start : U.addDays(start, 6 - ((new Date(start + 'T00:00:00Z').getUTCDay() + 7) % 7)); // weeks end on Saturday
        if (end > to) end = to;
        cols.push({ label: mode === 'day' ? U.fmtDate(start) : U.fmtDate(start) + ' – ' + U.fmtDate(end), from: start, to: end });
        start = U.addDays(end, 1);
      }
      if (cols.length > 1) cols.push({ label: 'Total', from: from, to: to, total: true });
      return cols;
    }
    return R.periods(from, to, mode);
  };
  function shiftYear(d, n) { return U.addMonths(d, 12 * n); }
  function prevPeriod(from, to) {
    // same length immediately before; whole months stay whole months
    if (from.slice(8) === '01' && to === U.monthEnd(to)) {
      var months = (+to.slice(0, 4) - +from.slice(0, 4)) * 12 + (+to.slice(5, 7) - +from.slice(5, 7)) + 1;
      var pf = U.addMonths(from, -months);
      return { from: pf, to: U.addDays(from, -1) };
    }
    var len = U.daysBetween(from, to);
    return { from: U.addDays(from, -len - 1), to: U.addDays(from, -1) };
  }
  /** Short label for a date range: "Mar 2025", "Jan – Mar 2025", "2025", else "01/05/2025 – 02/10/2025". */
  R.rangeLabel = function (from, to) {
    var wholeMonths = from.slice(8) === '01' && to === U.monthEnd(to);
    if (wholeMonths) {
      if (from.slice(0, 7) === to.slice(0, 7)) return U.monthLabel(from);
      if (from.slice(5) === '01-01' && to.slice(5) === '12-31' && from.slice(0, 4) === to.slice(0, 4)) return from.slice(0, 4);
      var a = U.monthLabel(from), z = U.monthLabel(to);
      return from.slice(0, 4) === to.slice(0, 4) ? a.replace(/ \d{4}$/, '') + ' – ' + z : a + ' – ' + z;
    }
    if (from.slice(8) === '01' && from.slice(0, 7) === to.slice(0, 7)) return U.monthLabel(from).replace(/ (\d{4})$/, ' 1–' + +to.slice(8) + ', $1');
    return U.fmtDate(from) + ' – ' + U.fmtDate(to);
  };
  var VARIANT_ORDER = ['cur', 'bud', 'var', 'pbud', 'py', 'pp', 'mtd', 'qtd', 'ytd', 'pyytd', 'chg', 'pchg', 'row', 'col', 'inc', 'exp'];
  R.COMPARE_LABELS = { py: 'Previous year (PY)', pp: 'Previous period (PP)', mtd: 'Month-to-date (MTD)', qtd: 'Quarter-to-date (QTD)', ytd: 'Year-to-date (YTD)', pyytd: 'Previous year-to-date (PY YTD)', chg: '$ Change', pchg: '% Change', row: '% of Row', col: '% of Column', inc: '% of Income', exp: '% of Expense' };

  var TIME_VARIANT = { py: 1, pp: 1, mtd: 1, qtd: 1, ytd: 1, pyytd: 1 };
  /** First day of the fiscal quarter that contains date d. */
  R.fiscalQuarterStart = function (d, fyMonth) {
    var fys = U.fiscalYearStart(d, fyMonth || 1);
    var months = (+d.slice(0, 4) - +fys.slice(0, 4)) * 12 + (+d.slice(5, 7) - +fys.slice(5, 7));
    return U.addMonths(fys, Math.floor(months / 3) * 3);
  };
  /** Base (display) columns. Each: { label, from, to, f: filter, total } */
  function baseColumns(book, o, kind) {
    var by = o.columns || 'total';
    if (PERIOD_MODES[by]) return R.periodsEx(o.from, o.to, by).map(function (c) { return { label: c.label, from: c.from, to: c.to, total: !!c.total || by === 'total' }; });
    if (kind === 'bs') return [{ label: 'Total', from: o.from, to: o.to, total: true }];
    var cols = [];
    if (by === 'class') {
      book.sortedClasses().forEach(function (c) { cols.push({ label: book.classFullName(c.id), from: o.from, to: o.to, f: { clsExact: c.id }, probe: true }); });
      cols.push({ label: 'Not specified', from: o.from, to: o.to, f: { clsExact: '' }, probe: true });
    } else if (by === 'customer' || by === 'vendor') {
      var lab = function (c) { return book.contactLabel ? book.contactLabel(c.id) : c.name; }; // Customer:Job (1.16)
      book.contacts.filter(function (c) { return c.kind === by; }).sort(function (a, b) { return lab(a).localeCompare(lab(b)); })
        .forEach(function (c) { cols.push({ label: lab(c), from: o.from, to: o.to, f: { contactId: c.id }, probe: true }); });
      cols.push({ label: 'Not specified', from: o.from, to: o.to, f: { contactId: '' }, probe: true });
    }
    cols.push({ label: 'Total', from: o.from, to: o.to, total: true });
    return cols;
  }
  function mergeFilter(a, b) { var o = {}; [a, b].forEach(function (x) { if (x) Object.keys(x).forEach(function (k) { o[k] = x[k]; }); }); return Object.keys(o).length ? o : null; }

  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function qbDate(d) { return MON[+d.slice(5, 7) - 1] + ' ' + (+d.slice(8, 10)) + ', ' + d.slice(2, 4); }
  function qbRange(f, t) {
    if (!U.isDate(f) || !U.isDate(t) || f < '1901' || t > '2998') return 'Total';
    var whole = f.slice(8) === '01' && U.monthEnd(t) === t, yy = function (d) { return d.slice(2, 4); };
    if (whole) return f.slice(0, 7) === t.slice(0, 7) ? MON[+f.slice(5, 7) - 1] + ' ' + yy(t)
      : MON[+f.slice(5, 7) - 1] + (yy(f) !== yy(t) ? ' ' + yy(f) : '') + ' - ' + MON[+t.slice(5, 7) - 1] + ' ' + yy(t);
    return (yy(f) === yy(t) ? MON[+f.slice(5, 7) - 1] + ' ' + (+f.slice(8, 10)) : qbDate(f)) + ' - ' + qbDate(t);
  }
  /** QuickBooks Desktop wording: "Total Income"; an upper-case section totals as "TOTAL ASSETS". */
  function totalOf(label) { return /[a-z]/.test(label) ? 'Total ' + label : 'TOTAL ' + label; }
  /* ---------- row skeletons ---------- */
  var PL_LAYOUT = [
    { key: 'income', title: 'Income', types: ['income'], always: true },
    { key: 'cogs', title: 'Cost of Goods Sold', types: ['cogs'] },
    { key: 'gross', title: 'Gross Profit', net: function (v) { return v.income - v.cogs; } },
    { key: 'expense', title: 'Expense', types: ['expense'], always: true },
    { key: 'netop', title: 'Net Ordinary Income', net: function (v) { return v.gross - v.expense; } },
    { key: 'oi', title: 'Other Income', types: ['oi'] },
    { key: 'oe', title: 'Other Expense', types: ['oe'] },
    { key: 'netother', title: 'Net Other Income', net: function (v) { return v.oi - v.oe; }, needs: ['oi', 'oe'] },
    { key: 'net', title: 'Net Income', net: function (v) { return v.netop + v.netother; }, grand: true }
  ];
  var BS_LAYOUT = [
    { key: 'assets', title: 'ASSETS', children: [
      { key: 'ca', title: 'Current Assets', children: [
        { key: 'bank', title: 'Checking/Savings', types: ['bank'] },
        { key: 'ar', title: 'Accounts Receivable', types: ['ar'] },
        { key: 'oca', title: 'Other Current Assets', types: ['oca'] }] },
      { key: 'fa', title: 'Fixed Assets', types: ['fixed'] },
      { key: 'oa', title: 'Other Assets', types: ['oa'] }] },
    { key: 'le', title: 'LIABILITIES & EQUITY', children: [
      { key: 'liab', title: 'Liabilities', children: [
        { key: 'cl', title: 'Current Liabilities', children: [
          { key: 'ap', title: 'Accounts Payable', types: ['ap'] },
          { key: 'cc', title: 'Credit Cards', types: ['cc'] },
          { key: 'ocl', title: 'Other Current Liabilities', types: ['ocl'] }] },
        { key: 'ltl', title: 'Long-Term Liabilities', types: ['ltl'] }] },
      { key: 'equity', title: 'Equity', types: ['equity'], netIncome: true }] }
  ];
  /** Chart series for a statement: per period (the Total column only when it is the only one) — P&L income
   *  (incl. other income) vs expenses (COGS, expense, other expense) with net income; balance sheet assets,
   *  liabilities and equity. Integer cents, read straight from the statement cells. */
  R.statementChart = function (st) {
    var gs = st.groups.length > 1 ? st.groups.filter(function (g) { return !g.total; }) : st.groups;
    var pick = function (g) { for (var i = g.start; i < g.start + g.span; i++) if (st.cols[i] && st.cols[i].variant === 'cur') return i; return -1; };
    var cell = function (k, i) { var s = st.sections[k]; return s && s.cells ? (s.cells[i] || 0) : 0; };
    var bs = st.kind === 'bs', max = 0;
    var points = gs.map(function (g) {
      var i = pick(g); if (i < 0) return null;
      var v = bs ? { assets: cell('assets', i), liab: cell('liab', i), equity: cell('equity', i) }
        : { inc: cell('income', i) + cell('oi', i), exp: cell('cogs', i) + cell('expense', i) + cell('oe', i) };
      Object.keys(v).forEach(function (k) { max = Math.max(max, Math.abs(v[k])); });
      return { label: g.label, values: v, net: bs ? v.assets - v.liab : cell('net', i) };
    }).filter(Boolean);
    return { series: bs ? [['assets', 'Assets'], ['liab', 'Liabilities'], ['equity', 'Equity']] : [['inc', 'Income'], ['exp', 'Expenses']], points: points, max: max };
  };

  R.PL_SECTION_TITLES = PL_LAYOUT.map(function (x) { return [x.key, x.title]; });

  /** Build account nodes (with parent/sub-account rollups) for a list of account types. */
  function accountNodes(book, types, depth) {
    var accs = book.sortedAccounts(function (a) { return types.indexOf(a.type) >= 0; });
    var byParent = {};
    accs.forEach(function (a) { var p = a.parentId && book.accById[a.parentId] && types.indexOf(book.accById[a.parentId].type) >= 0 ? a.parentId : ''; (byParent[p] = byParent[p] || []).push(a); });
    var make = function (a, d) {
      var kids = (byParent[a.id] || []).map(function (c) { return make(c, d + 1); });
      return { key: 'a:' + a.id, kind: 'account', label: book.accountLabel(a.id).replace(book.accountFullName(a), a.name), accountId: a.id, inactive: !a.active, depth: d, children: kids };
    };
    return (byParent[''] || []).map(function (a) { return make(a, depth); });
  }

  /**
   * Build a statement.
   *  o.kind: 'pl' | 'bs' | 'bva'
   *  o.from, o.to, o.basis, o.columns ('total'|'day'|'week'|'month'|'quarter'|'year'|'class'|'customer'|'vendor')
   *  o.compare: ['py','pp','ytd','pyytd','chg','pchg','row','col','inc','exp']
   *  o.classId (filter), o.contactId (filter), o.accountTypes (filter), o.budgetId (bva)
   *  o.rows: 'active' | 'all' | 'nonzero', o.cols: 'active' | 'all' | 'nonzero', o.titles: {sectionKey: title}
   */
  R.statement = function (book, o) {
    o = o || {};
    var kind = o.kind === 'bs' ? 'bs' : o.kind === 'bva' ? 'bva' : 'pl';
    var basis = R.basis(book, o);
    var cmp = (o.compare || []).filter(function (x) { return R.COMPARE_LABELS[x]; });
    if (kind === 'bs') cmp = cmp.filter(function (x) { return ['mtd', 'qtd', 'ytd', 'pyytd', 'inc', 'exp'].indexOf(x) < 0; });
    if (kind === 'bva') cmp = cmp.filter(function (x) { return ['row', 'col', 'inc', 'exp'].indexOf(x) >= 0; });
    var budget = kind === 'bva' ? (book.budgets || []).find(function (b) { return b.id === o.budgetId && !b.deleted; }) || book.activeBudgets()[0] : null;
    var gf = mergeFilter(o.classId ? { cls: R.classFilter(book, o.classId) } : null, o.contactId !== undefined && o.contactId !== '' ? { contactId: o.contactId } : null);
    if (o.accountTypes && o.accountTypes.length) {
      var ids = {}; book.accounts.forEach(function (a) { if (o.accountTypes.indexOf(a.type) >= 0) ids[a.id] = 1; });
      gf = mergeFilter(gf, { accountIds: ids });
    }
    var fyMonth = book.company.fiscalYearStartMonth || 1;
    var bases = baseColumns(book, o, kind);

    /* value sources: one map per (base, variant) */
    var cache = {};
    var mapFor = function (spec) {
      var k = JSON.stringify(spec);
      if (cache[k]) return cache[k];
      var m;
      if (spec.bud) m = R.budgetMap(book, budget, spec.from, spec.to);
      else if (kind === 'bs') m = R.bsMap(book, basis, spec.to);
      else m = R.plMap(book, basis, spec.from, spec.to, spec.f);
      return (cache[k] = m);
    };
    var cols = [], groups = [];
    bases.forEach(function (bc, gi) {
      var f = mergeFilter(gf, bc.f);
      var variants = kind === 'bva' ? ['cur', 'bud', 'var', 'pbud'] : ['cur'];
      cmp.forEach(function (x) { if (variants.indexOf(x) < 0) variants.push(x); });
      variants.sort(function (a, b) { return VARIANT_ORDER.indexOf(a) - VARIANT_ORDER.indexOf(b); });
      var firstCmp = variants.filter(function (v) { return TIME_VARIANT[v]; })[0];
      if (!firstCmp) variants = variants.filter(function (v) { return v !== 'chg' && v !== 'pchg'; });
      if (bases.length === 1) variants = variants.filter(function (v) { return v !== 'row'; });
      var start = cols.length;
      variants.forEach(function (v) {
        var c = { id: gi + ':' + v, group: gi, variant: v, pct: ['pchg', 'row', 'col', 'inc', 'exp', 'pbud'].indexOf(v) >= 0, from: bc.from, to: bc.to, f: f, base: bc };
        if (v === 'cur') c.label = variants.length > 1 ? (kind === 'bva' ? 'Actual' : 'Current') : bc.label;
        else if (v === 'bud') { c.label = 'Budget'; c.bud = true; }
        else if (v === 'var') c.label = kind === 'bva' ? 'Over budget' : '';
        else if (v === 'pbud') c.label = '% of Budget';
        else if (v === 'py') { c.from = shiftYear(bc.from, -1); c.to = shiftYear(bc.to, -1); c.label = (kind === 'bs' ? 'As of ' + U.fmtDate(c.to) : R.rangeLabel(c.from, c.to)) + ' (PY)'; }
        else if (v === 'pp') { var pp = prevPeriod(bc.from, bc.to); c.from = pp.from; c.to = pp.to; c.label = (kind === 'bs' ? 'As of ' + U.fmtDate(c.to) : R.rangeLabel(c.from, c.to)) + ' (PP)'; }
        else if (v === 'mtd') { c.from = U.monthStart(bc.to); c.label = 'MTD'; }
        else if (v === 'qtd') { c.from = R.fiscalQuarterStart(bc.to, fyMonth); c.label = 'QTD'; }
        else if (v === 'ytd') { c.from = U.fiscalYearStart(bc.to, fyMonth); c.label = 'YTD'; }
        else if (v === 'pyytd') { c.to = shiftYear(bc.to, -1); c.from = U.fiscalYearStart(c.to, fyMonth); c.label = 'PY YTD'; }
        else c.label = R.COMPARE_LABELS[v];
        if (v === 'chg' || v === 'pchg') c.ref = firstCmp;
        c.value = v === 'cur' || v === 'bud' || !!TIME_VARIANT[v];
        if (c.value) c.map = mapFor({ from: c.from, to: c.to, f: c.f || null, bud: !!c.bud });
        cols.push(c);
      });
      groups.push({ label: kind === 'bs' && bc.total && bases.length === 1 ? 'As of ' + U.fmtDate(bc.to) : (kind === 'bs' && !bc.total ? 'As of ' + U.fmtDate(bc.to) : bc.label), start: start, span: cols.length - start, base: bc, total: !!bc.total });
    });
    if (kind === 'bs') groups.forEach(function (g) { var c = cols[g.start]; if (g.span === 1) c.label = g.label; });
    // one total column: QuickBooks Desktop heading — "Nov 5, 26" (balance sheet) or "Jan - Dec 26" / "Jan 1 - Nov 5, 26"
    if (bases.length === 1 && bases[0].total && cols.length === 1) cols[0].label = kind === 'bs' ? qbDate(bases[0].to) : qbRange(bases[0].from, bases[0].to);

    /* rows */
    var titles = o.titles || {};
    var valueCols = cols.filter(function (c) { return c.value; });
    var rowsMode = o.rows || 'active';
    var accVals = function (accId) { return valueCols.map(function (c) { return c.map.values[accId] || 0; }); };
    var isActive = function (accId) { return valueCols.some(function (c) { return c.map.active[accId] || c.map.values[accId]; }); };
    var zero = function () { return valueCols.map(function () { return 0; }); };
    var add = function (a, b) { return a.map(function (x, i) { return x + b[i]; }); };
    function finishAccount(n) {
      n.children = n.children.map(finishAccount).filter(Boolean);
      n.own = accVals(n.accountId);
      var keep = rowsMode === 'all' ? !n.inactive || n.own.some(Boolean) : rowsMode === 'nonzero' ? n.own.some(Boolean) : isActive(n.accountId);
      if (!n.children.length) { if (!keep) return null; n.vals = n.own; return n; }
      // parent with sub-accounts: header, its own amount as a row, children, "Total"
      n.kind = 'group'; n.accGroup = true;
      var tot = n.own.slice();
      n.children.forEach(function (c) { tot = add(tot, c.vals); });
      if (keep || n.own.some(Boolean)) n.children.unshift({ key: n.key + ':own', kind: 'account', label: n.label, accountId: n.accountId, depth: n.depth + 1, children: [], vals: n.own, ownRow: true });
      n.vals = tot; n.totalLabel = totalOf(n.label);
      return n;
    }
    function deepen(n, d) { n.depth = d; (n.children || []).forEach(function (c) { deepen(c, d + 1); }); }
    var sections = {}, tree = [];
    if (kind === 'bs') {
      var buildBS = function (def, depth) {
        var n = { key: 's:' + def.key, kind: 'group', section: def.key, label: titles[def.key] || def.title, depth: depth, children: [] };
        if (def.children) n.children = def.children.map(function (c) { return buildBS(c, depth + 1); }).filter(Boolean);
        else n.children = accountNodes(book, def.types, depth + 1).map(finishAccount).filter(Boolean);
        if (def.netIncome) n.children.push({ key: 'ni', kind: 'account', label: 'Net Income', netIncome: true, depth: depth + 1, children: [], vals: valueCols.map(function (c) { return c.map.values.__NI || 0; }) });
        n.vals = n.children.reduce(function (t, c) { return add(t, c.vals); }, zero());
        n.totalLabel = totalOf(n.label);
        sections[def.key] = n;
        if (!n.children.length && rowsMode !== 'all' && depth > 0) return null;
        return n;
      };
      BS_LAYOUT.forEach(function (def) { tree.push(buildBS(def, 0)); });
    } else {
      var v = {};
      PL_LAYOUT.forEach(function (def) {
        if (def.types) {
          var n = { key: 's:' + def.key, kind: 'group', section: def.key, label: titles[def.key] || def.title, depth: 0, children: accountNodes(book, def.types, 1).map(finishAccount).filter(Boolean) };
          n.vals = n.children.reduce(function (t, c) { return add(t, c.vals); }, zero());
          n.totalLabel = totalOf(n.label);
          sections[def.key] = n;
          v[def.key] = n.vals;
          if (n.children.length || def.always || rowsMode === 'all') tree.push(n);
        } else {
          var vals = valueCols.map(function (c, i) { var x = {}; Object.keys(v).forEach(function (k) { x[k] = v[k][i]; }); return def.net(x); });
          v[def.key] = vals;
          var show = !def.needs || def.needs.some(function (k) { return sections[k] && sections[k].children.length; }) || rowsMode === 'all';
          if (def.key === 'gross' && !(sections.cogs && sections.cogs.children.length) && rowsMode !== 'all') show = true; // QuickBooks always shows Gross Profit
          var nn = { key: 'n:' + def.key, kind: 'net', section: def.key, label: titles[def.key] || def.title, depth: 0, children: [], vals: vals, grand: !!def.grand };
          sections[def.key] = nn;
          if (show) tree.push(nn);
        }
      });
    }

    /* expand value arrays to every column, then derived columns */
    var colIndexOfValue = {}; var vi = 0;
    cols.forEach(function (c, i) { if (c.value) colIndexOfValue[i] = vi++; });
    var denom = function (sectionKey, ci) { var s = sections[sectionKey]; return s ? s.vals[colIndexOfValue[ci]] : 0; };
    var groupCol = function (g, variant) { for (var i = groups[g].start; i < groups[g].start + groups[g].span; i++) if (cols[i].variant === variant) return i; return -1; };
    var totalGroup = groups.length - 1;
    function expand(vals) {
      var out = cols.map(function (c, i) { return c.value ? vals[colIndexOfValue[i]] : null; });
      cols.forEach(function (c, i) {
        if (c.value) return;
        var cur = out[groupCol(c.group, 'cur')], ref, d;
        if (c.variant === 'var') out[i] = cur - out[groupCol(c.group, 'bud')];
        else if (c.variant === 'pbud') { d = out[groupCol(c.group, 'bud')]; out[i] = d ? cur / d * 100 : null; }
        else if (c.variant === 'chg') { ref = out[groupCol(c.group, c.ref)]; out[i] = cur - ref; }
        else if (c.variant === 'pchg') { ref = out[groupCol(c.group, c.ref)]; out[i] = ref ? (cur - ref) / Math.abs(ref) * 100 : null; }
        else if (c.variant === 'row') { d = out[groupCol(totalGroup, 'cur')]; out[i] = d ? cur / d * 100 : null; }
        else if (c.variant === 'col') { var ci = groupCol(c.group, 'cur'); d = kind === 'bs' ? denom('assets', ci) : (denom('income', ci) || denom('net', ci)); out[i] = d ? cur / d * 100 : null; }
        else if (c.variant === 'inc') { d = denom('income', groupCol(c.group, 'cur')); out[i] = d ? cur / d * 100 : null; }
        else if (c.variant === 'exp') { d = denom('expense', groupCol(c.group, 'cur')); out[i] = d ? cur / d * 100 : null; }
      });
      return out;
    }
    function walk(n) { n.cells = expand(n.vals); (n.children || []).forEach(walk); }
    tree.forEach(walk);
    tree.forEach(function (n) { deepen(n, 0); });

    /* hide display columns with no amounts (class/customer/vendor columns default to active only) */
    var colsMode = o.cols || 'active';
    var hideGroup = {}, keepCol = null;
    groups.forEach(function (g, gi) {
      if (g.total) return;
      if (colsMode === 'all' || (!g.base.probe && colsMode === 'active')) return;
      var any = false;
      var scan = function (n) { if (n.kind === 'account' && n.cells[g.start]) any = true; (n.children || []).forEach(scan); };
      tree.forEach(scan);
      if (!any) hideGroup[gi] = true;
    });
    if (Object.keys(hideGroup).length) {
      var keep = keepCol = cols.map(function (c) { return !hideGroup[c.group]; });
      var strip = function (n) { n.cells = n.cells.filter(function (x, i) { return keep[i]; }); (n.children || []).forEach(strip); };
      tree.forEach(strip);
      var newCols = [], newGroups = [];
      groups.forEach(function (g, gi) { if (hideGroup[gi]) return; var st = newCols.length; for (var i = g.start; i < g.start + g.span; i++) newCols.push(cols[i]); newGroups.push(Object.assign({}, g, { start: st })); });
      cols = newCols; groups = newGroups;
    }

    var out = { kind: kind, basis: basis, from: o.from, to: o.to, cols: cols, groups: groups, tree: tree, sections: sections, budget: budget || null,
      multiHeader: cols.length > groups.length,
      // for report templates: raw value columns (each with .map) and the same column expansion the tree used
      valueCols: valueCols, cellsFor: function (vals) { var c = expand(vals); return keepCol ? c.filter(function (x, i) { return keepCol[i]; }) : c; } };
    if (kind === 'bs') {
      out.balanced = cols.every(function (c, i) { return !c.value || sections.assets.cells[i] === sections.le.cells[i]; });
    }
    return out;
  };

  /** Flatten a statement into rows for export / tests: [{label, depth, cells, kind}] with "Total" lines. */
  R.flattenStatement = function (st, collapsed) {
    var rows = [];
    collapsed = collapsed || {};
    var visit = function (n) {
      if (n.kind === 'group') {
        if (collapsed[n.key]) { rows.push({ key: n.key, label: n.label, depth: n.depth, cells: n.cells, kind: 'collapsed', node: n }); return; }
        rows.push({ key: n.key, label: n.label, depth: n.depth, cells: null, kind: 'header', node: n });
        n.children.forEach(visit);
        rows.push({ key: n.key + ':total', label: n.totalLabel, depth: n.depth, cells: n.cells, kind: 'total', node: n });
      } else rows.push({ key: n.key, label: n.label, depth: n.depth, cells: n.cells, kind: n.kind, node: n });
    };
    st.tree.forEach(visit);
    return rows;
  };

  /* ---------- reconciliation ---------- */
  /**
   * Proves that the main reports tie to the posted ledger for one period: trial balance, balance sheet,
   * statement P&L vs the classic engine, cash flow, A/R and A/P aging vs their control accounts.
   * Returns { ok, checks: [{ id, label, expected, actual, ok }] } (amounts in cents).
   */
  R.reconcile = function (book, o) {
    o = o || {};
    var basis = R.basis(book, o), from = o.from, to = o.to;
    var checks = [];
    var add = function (id, label, expected, actual) { checks.push({ id: id, label: label, expected: expected, actual: actual, ok: expected === actual }); };
    var tb = R.trialBalance(book, { asOf: to, basis: basis });
    add('tb', 'Trial balance: debits equal credits', tb.totalDebit, tb.totalCredit);
    var raw = 0; book.accounts.forEach(function (a) { raw += R.rawSum(R.entries(book, basis)[a.id], null, to); });
    add('ledger', 'Ledger: all postings to ' + U.fmtDate(to) + ' net to zero', 0, raw);
    var bs = R.statement(book, { kind: 'bs', from: from, to: to, basis: basis, rows: 'all' });
    add('bs', 'Balance sheet: assets equal liabilities and equity', bs.sections.assets.cells[0], bs.sections.le.cells[0]);
    var classicBs = R.balanceSheet(book, { asOf: to, basis: basis });
    add('bs-classic', 'Balance sheet: total assets equal the account balances', classicBs.totalAssets, bs.sections.assets.cells[0]);
    var pl = R.statement(book, { kind: 'pl', from: from, to: to, basis: basis, rows: 'all' });
    add('pl', 'Profit and loss: net income equals the ledger', R.netIncome(book, basis, from, to), pl.sections.net.cells[0]);
    var cf = R.cashFlow(book, { from: from, to: to, basis: basis });
    add('cf', 'Cash flow: beginning cash + net change = ending cash', cf.cashEnd, cf.cashBegin + cf.netChange);
    var ar = R.aging(book, { kind: 'customer', asOf: to }), ap = R.aging(book, { kind: 'vendor', asOf: to });
    add('ar', 'A/R aging total equals Accounts Receivable', ar.accountBalance, ar.total);
    add('ap', 'A/P aging total equals Accounts Payable', ap.accountBalance, ap.total);
    return { basis: basis, from: from, to: to, checks: checks, ok: checks.every(function (c) { return c.ok; }) };
  };

  /* ---------- 1099 ---------- */
  /**
   * Payments to 1099 vendors in a calendar year, by box. Counts money paid from bank accounts
   * (checks, expenses, bill payments — allocated to the bill's expense lines) to accounts mapped
   * in company.map1099. Card payments are excluded (the card company reports those on 1099-K).
   */
  R.report1099 = function (book, o) {
    o = o || {};
    var year = String(o.year || U.today().slice(0, 4));
    var from = year + '-01-01', to = year + '-12-31';
    var map = book.company.map1099 || {};
    var ent = R.entries(book, 'cash');
    var byVendor = {};
    var included = o.includeAll ? null : {};
    book.contacts.forEach(function (c) { if (c.kind === 'vendor' && (o.includeAll || c.is1099)) { if (included) included[c.id] = 1; } });
    var detail = [];
    Object.keys(map).forEach(function (accId) {
      var box = map[accId];
      (ent[accId] || []).forEach(function (e) {
        var d = e.t.date;
        if (d < from || d > to) return;
        var vid = e.s.contactId || e.t.contactId;
        var v = vid && book.contactById[vid];
        if (!v || v.kind !== 'vendor') return;
        if (included && !included[vid]) return;
        if (e.t.type === 'journal' || e.t.type === 'transfer') return;
        var head = book.accById[e.t.accountId];
        if (!head || head.type !== 'bank') return; // card payments and non-cash entries are not reportable here
        var row = byVendor[vid] = byVendor[vid] || { contactId: vid, name: v.name, taxId: v.taxId || '', address: v.address || '', is1099: !!v.is1099, boxes: {}, total: 0 };
        row.boxes[box] = (row.boxes[box] || 0) + e.s.amount;
        row.total += e.s.amount;
        detail.push({ t: e.t, contactId: vid, accountId: accId, box: box, amount: e.s.amount, memo: e.s.memo || e.t.memo || '' });
      });
    });
    var boxes = S.BOXES_1099.filter(function (b) { return Object.keys(byVendor).some(function (k) { return byVendor[k].boxes[b.id]; }); });
    var rows = Object.keys(byVendor).map(function (k) { return byVendor[k]; }).sort(function (a, b) { return a.name.localeCompare(b.name); });
    rows.forEach(function (r) {
      r.meets = S.BOXES_1099.some(function (b) { return (r.boxes[b.id] || 0) >= S.threshold1099(b.id, year); });
      r.missingTaxId = !String(r.taxId).trim();
    });
    if (o.threshold === 'meets') rows = rows.filter(function (r) { return r.meets; });
    var totals = {}; boxes.forEach(function (b) { totals[b.id] = U.sum(rows, function (r) { return r.boxes[b.id] || 0; }); });
    var unmapped = book.accounts.filter(function (a) { return ['expense', 'cogs', 'oe'].indexOf(a.type) >= 0 && !map[a.id]; });
    var vendors1099 = book.contacts.filter(function (c) { return c.kind === 'vendor' && c.is1099; });
    detail.sort(function (a, b) { return a.t.date < b.t.date ? -1 : a.t.date > b.t.date ? 1 : 0; });
    return { title: '1099 Contractor Summary', year: year, boxes: boxes, rows: rows, totals: totals, total: U.sum(rows, function (r) { return r.total; }), detail: detail,
      mappedCount: Object.keys(map).length, unmappedExpenseAccounts: unmapped.length, vendors1099: vendors1099.length,
      missingTaxId: vendors1099.filter(function (c) { return !String(c.taxId || '').trim(); }) };
  };

  /* ---------- custom report builder ---------- */
  R.BUILDER_COLUMNS = [
    ['date', 'Date'], ['type', 'Transaction type'], ['number', 'No.'], ['name', 'Name'], ['account', 'Account'], ['accountType', 'Account type'],
    ['class', 'Class'], ['memo', 'Memo / description'], ['split', 'Split'], ['debit', 'Debit'], ['credit', 'Credit'], ['amount', 'Amount'], ['balance', 'Running balance'], ['cleared', 'Cleared']
  ];
  R.BUILDER_GROUPS = [['', 'None'], ['account', 'Account'], ['accountType', 'Account type'], ['class', 'Class'], ['name', 'Customer / vendor'], ['type', 'Transaction type'], ['month', 'Month'], ['quarter', 'Quarter'], ['year', 'Year']];
  /**
   * Line-level report over posted splits.
   *  cfg: { from, to, basis, accountTypes[], accountIds[], classId, contactId, txnTypes[], text, minAmount, maxAmount (cents, absolute),
   *         cleared: ''|'C'|'R'|'U', columns[], groupBy, summary (bool), sortBy, sortDir }
   */
  R.builder = function (book, cfg) {
    cfg = cfg || {};
    var basis = R.basis(book, cfg), ent = R.entries(book, basis);
    var clsF = R.classFilter(book, cfg.classId);
    var accTypes = cfg.accountTypes && cfg.accountTypes.length ? cfg.accountTypes : null;
    var accIds = cfg.accountIds && cfg.accountIds.length ? cfg.accountIds : null;
    var types = cfg.txnTypes && cfg.txnTypes.length ? cfg.txnTypes : null;
    var q = String(cfg.text || '').toLowerCase().trim();
    var lines = [];
    book.sortedAccounts().forEach(function (a) {
      if (accTypes && accTypes.indexOf(a.type) < 0) return;
      if (accIds && accIds.indexOf(a.id) < 0) return;
      var sign = book.normalSign(a), bal = 0;
      (ent[a.id] || []).forEach(function (e) {
        var d = e.t.date;
        if (cfg.to && d > cfg.to) return;
        bal += sign * e.s.amount;
        if (cfg.from && d < cfg.from) return;
        if (types && types.indexOf(e.t.type) < 0) return;
        if (clsF && !passes(e, { cls: clsF })) return;
        var cid = e.s.contactId || e.t.contactId || '';
        if (cfg.contactId && cid !== cfg.contactId) return;
        var abs = Math.abs(e.s.amount);
        if (cfg.minAmount && abs < cfg.minAmount) return;
        if (cfg.maxAmount && abs > cfg.maxAmount) return;
        var orig = e.t.splits && e.t.splits[e.i];
        var cl = orig && orig.accountId === a.id ? orig.cleared || '' : '';
        if (cfg.cleared === 'U' ? cl : cfg.cleared && cl !== cfg.cleared) return;
        var name = cid && book.contactById[cid] ? book.contactById[cid].name : '';
        var memo = e.s.memo || e.t.memo || '';
        var line = { t: e.t, i: e.i, date: d, type: S.TXN_TYPES[e.t.type].label, txnType: e.t.type, number: e.t.number || '', contactId: cid, name: name,
          accountId: a.id, account: book.accountLabel(a.id), accountType: S.TYPE[a.type].label, classId: e.s.classId || '', class: e.s.classId ? book.classFullName(e.s.classId) : '',
          memo: memo, split: book.splitCounterpart(e.t, e.i), debit: e.s.amount > 0 ? e.s.amount : 0, credit: e.s.amount < 0 ? -e.s.amount : 0, amount: sign * e.s.amount, balance: bal,
          cleared: cl === 'R' ? 'Reconciled' : cl === 'C' ? 'Cleared' : '' };
        if (q && (line.number + ' ' + name + ' ' + memo + ' ' + line.account + ' ' + line.type + ' ' + line.class + ' ' + U.fmtPlain(abs)).toLowerCase().indexOf(q) < 0) return;
        lines.push(line);
      });
    });
    var dir = cfg.sortDir === 'desc' ? -1 : 1, sb = cfg.sortBy || 'date';
    var keyOf = function (l) { return sb === 'amount' || sb === 'debit' || sb === 'credit' ? l[sb] : String(l[sb] || '').toLowerCase(); };
    lines.sort(function (a, b) { var x = keyOf(a), y = keyOf(b); if (x < y) return -dir; if (x > y) return dir; return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    var gk = cfg.groupBy || '';
    var groupKey = function (l) {
      if (gk === 'month') return l.date.slice(0, 7);
      if (gk === 'quarter') return l.date.slice(0, 4) + '-Q' + (Math.floor((+l.date.slice(5, 7) - 1) / 3) + 1);
      if (gk === 'year') return l.date.slice(0, 4);
      if (gk === 'account') return l.account;
      return l[gk] || '';
    };
    var groupLabel = function (k, l) {
      if (gk === 'month') return U.monthLabel(k + '-01');
      if (gk === 'quarter') return k.replace('-', ' ');
      return k || (gk === 'class' ? 'Not specified' : gk === 'name' ? '(no name)' : '—');
    };
    var groups = [];
    if (gk) {
      var idx = {};
      lines.forEach(function (l) { var k = groupKey(l); if (!idx[k]) { idx[k] = { key: k, label: groupLabel(k, l), lines: [] }; groups.push(idx[k]); } idx[k].lines.push(l); });
      if (gk === 'month' || gk === 'quarter' || gk === 'year') groups.sort(function (a, b) { return a.key < b.key ? -1 : 1; });
      else if (gk !== 'account') groups.sort(function (a, b) { return a.label.localeCompare(b.label); });
    } else groups.push({ key: '', label: '', lines: lines });
    var tot = function (ls) { return { debit: U.sum(ls, function (l) { return l.debit; }), credit: U.sum(ls, function (l) { return l.credit; }), amount: U.sum(ls, function (l) { return l.amount; }), count: ls.length }; };
    groups.forEach(function (g) { g.totals = tot(g.lines); });
    return { basis: basis, lines: lines, groups: groups, totals: tot(lines), columns: (cfg.columns && cfg.columns.length ? cfg.columns : ['date', 'type', 'number', 'name', 'account', 'memo', 'amount']) };
  };
})(typeof window !== 'undefined' ? window : globalThis);
