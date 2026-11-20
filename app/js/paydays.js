/* VaultBook — Invoice Payment Days (MIS): when each invoice was raised, when it was paid, how many days it took.
 * OB.payDays.report(book, opts) → { invoices, lines, customers, total, asOf }
 *   opts: from, to (period), by: 'invoice' (invoices dated in the period, default) | 'payment' (invoices paid in full in
 *   the period; payment lines received in the period), asOf (payments counted up to this date, default today),
 *   contactId, status: '' | 'paid' | 'part' | 'open' | 'unpaid' (part or open).
 * Days: days to pay = invoice date → date paid in full; days late = paid-in-full date − due date (0 when on time);
 * weighted days = payments' days weighted by amount. Credits applied settle an invoice but are not payments.
 * OB.payDays.FIELDS / DEFAULTS list the columns of each view ('invoice', 'summary', 'payment'); matrix() builds the
 * rows for CSV, Excel and PDF from the chosen fields.
 */
(function (root) {
  'use strict';
  var OB = root.OB = root.OB || {};
  var U = OB.util, P = OB.payDays = {};
  var r1 = function (x) { return Math.round(x * 10) / 10; };
  var avg = function (xs) { xs = xs.filter(function (x) { return x !== null && x !== undefined; }); return xs.length ? r1(xs.reduce(function (s, x) { return s + x; }, 0) / xs.length) : null; };
  var KIND = { payment: 'Payment', creditMemo: 'Credit memo', journal: 'Journal entry' };

  P.report = function (book, opts) {
    opts = opts || {};
    var asOf = opts.asOf || U.today(), from = opts.from || '0000-01-01', to = opts.to || '9999-12-31', byPay = opts.by === 'payment';
    var name = function (cid) { var c = book.contactById[cid]; return c ? c.name : '(no customer)'; };
    var accName = function (id) { var a = book.accById[id]; return a ? book.accountFullName(a) : ''; };
    var all = [], usedInc = {};
    book.posted().forEach(function (t) {
      if (t.type !== 'invoice' || t.date > asOf || !t.total || book.voidedAsOf(t, asOf)) return;
      if (opts.contactId && t.contactId !== opts.contactId) return;
      var due = t.dueDate || t.date, open = book.openBalanceAsOf(t, asOf);
      var apps = (book.incoming[t.id] || []).map(function (x) {
        var s = book.txById[x.from]; if (!s || s.status !== 'posted') return null;
        var d = book.appliedOn(s, t, x.date); if (d > asOf) return null;
        var head = (s.splits || []).find(function (sp) { return sp.amount > 0; });
        return { src: s, date: d, amount: x.amount, payment: s.type === 'payment', kind: KIND[s.type] || s.type, number: s.number || s.checkNo || '', depositTo: s.type === 'payment' ? accName(s.accountId || (head && head.accountId)) : '', memo: s.memo || '' };
      }).filter(Boolean).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
      var settled = t.total - open, paidDate = '';
      if (!open) { var cum = 0; apps.forEach(function (a) { cum += a.amount; if (!paidDate && cum >= t.total) paidDate = a.date; }); if (!paidDate) paidDate = apps.length ? apps[apps.length - 1].date : t.date; }
      var pays = apps.filter(function (a) { return a.payment; }), received = U.sum(pays, function (a) { return a.amount; });
      // income accounts on the invoice (income and other income), net of discounts on the same account
      var inc = {}; (t.splits || []).forEach(function (sp) { var a = book.accById[sp.accountId]; if (a && (a.type === 'income' || a.type === 'oi')) inc[a.id] = (inc[a.id] || 0) - sp.amount; });
      var incIds = Object.keys(inc).filter(function (k) { return inc[k]; }).sort(function (a, b) { return book.accountLabel(a).localeCompare(book.accountLabel(b)); });
      var wsum = U.sum(pays, function (a) { return a.amount * U.daysBetween(t.date, a.date); });
      all.push({
        t: t, id: t.id, contactId: t.contactId, customer: name(t.contactId), number: t.number || '', date: t.date, dueDate: due, terms: t.terms || '', memo: t.memo || '',
        amount: t.total, received: received, credits: settled - received, open: open,
        status: !open ? 'Paid' : settled > 0 ? 'Partly paid' : 'Open',
        payCount: pays.length, firstPayDate: apps.length ? apps[0].date : '', paidDate: paidDate,
        daysToFirst: apps.length ? U.daysBetween(t.date, apps[0].date) : null,
        daysToPay: paidDate ? U.daysBetween(t.date, paidDate) : null,
        daysLate: paidDate ? Math.max(0, U.daysBetween(due, paidDate)) : null,
        onTime: paidDate ? paidDate <= due : null,
        weightedDays: received ? r1(wsum / received) : null, _w: wsum,
        daysOpen: open ? U.daysBetween(t.date, asOf) : null, daysPastDue: open ? Math.max(0, U.daysBetween(due, asOf)) : null,
        payments: apps.map(function (a) { return U.fmtDate(a.date) + (a.number ? ' #' + a.number : '') + ' ' + U.fmt(a.amount, { symbol: true }) + (a.payment ? '' : ' (' + a.kind.toLowerCase() + ')'); }).join('; '),
        apps: apps,
        incomeIds: incIds, incomeCount: incIds.length,
        incomeText: incIds.map(function (k) { return book.accountLabel(k) + ' ' + U.fmt(inc[k], { symbol: true }); }).join('; ')
      });
      var row = all[all.length - 1]; incIds.forEach(function (k) { row['inc:' + k] = inc[k]; usedInc[k] = book.accountLabel(k); });
    });
    var st = opts.status || '';
    var keep = function (x) { return !st || (st === 'paid' ? x.status === 'Paid' : st === 'part' ? x.status === 'Partly paid' : st === 'open' ? x.status === 'Open' : st === 'unpaid' ? x.status !== 'Paid' : true); };
    var invoices = all.filter(function (x) { return keep(x) && (byPay ? x.paidDate && x.paidDate >= from && x.paidDate <= to : x.date >= from && x.date <= to); });
    var cmp = function (a, b) { return a.customer.localeCompare(b.customer) || (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) || String(a.number).localeCompare(String(b.number), undefined, { numeric: true }); };
    invoices.sort(cmp);
    var lines = [];
    (byPay ? all.filter(keep).sort(cmp) : invoices).forEach(function (x) {
      x.apps.forEach(function (a) {
        if (byPay && (a.date < from || a.date > to)) return;
        lines.push({ id: a.src.id, t: a.src, contactId: x.contactId, customer: x.customer, invoice: x.number, invoiceId: x.id, invoiceDate: x.date, dueDate: x.dueDate, invoiceAmount: x.amount,
          date: a.date, number: a.number, kind: a.kind, depositTo: a.depositTo, amount: a.amount, days: U.daysBetween(x.date, a.date), daysLate: U.daysBetween(x.dueDate, a.date), memo: a.memo });
      });
    });
    var incKeys = Object.keys(usedInc).map(function (k) { return 'inc:' + k; });
    var sum = function (list, label, cid) {
      var paid = list.filter(function (x) { return x.paidDate; }), opn = list.filter(function (x) { return x.open; }), rec = U.sum(list, function (x) { return x.received; });
      var days = paid.map(function (x) { return x.daysToPay; });
      return { contactId: cid, customer: label, name: label, invoices: list.length, invoiced: U.sum(list, function (x) { return x.amount; }), received: rec, credits: U.sum(list, function (x) { return x.credits; }), open: U.sum(list, function (x) { return x.open; }),
        paidCount: paid.length, avgDays: avg(days), weightedDays: rec ? r1(U.sum(list, function (x) { return x._w; }) / rec) : null, avgLate: avg(paid.map(function (x) { return x.daysLate; })),
        onTimePct: paid.length ? r1(100 * paid.filter(function (x) { return x.onTime; }).length / paid.length) : null,
        fastest: days.length ? Math.min.apply(null, days) : null, slowest: days.length ? Math.max.apply(null, days) : null,
        avgFirst: avg(list.map(function (x) { return x.daysToFirst; })), openCount: opn.length, oldestOpen: opn.length ? Math.max.apply(null, opn.map(function (x) { return x.daysOpen; })) : null };
    };
    var sumInc = function (o, list) { incKeys.forEach(function (k) { var v = U.sum(list, function (x) { return x[k] || 0; }); if (v) o[k] = v; }); return o; };
    var by = {}; invoices.forEach(function (x) { (by[x.contactId] = by[x.contactId] || []).push(x); });
    var customers = Object.keys(by).map(function (k) { return sumInc(sum(by[k], by[k][0].customer, k), by[k]); }).sort(function (a, b) { return a.name.localeCompare(b.name); });
    var incomeAccounts = Object.keys(usedInc).filter(function (k) { return invoices.some(function (x) { return x['inc:' + k]; }); })
      .map(function (k) { return { id: k, label: usedInc[k] }; }).sort(function (a, b) { return a.label.localeCompare(b.label); });
    return { asOf: asOf, from: opts.from, to: opts.to, by: byPay ? 'payment' : 'invoice', invoices: invoices, lines: lines, customers: customers, total: sumInc(sum(invoices, 'Total', ''), invoices), incomeAccounts: incomeAccounts };
  };

  /** Drill-down: each customer (totals and averages) with its invoices underneath, one level only. Each invoice row
   *  carries its payment details (dates, numbers, amounts, bank) so nothing needs opening. */
  P.drill = function (r) {
    var rows = [], byC = {};
    r.invoices.forEach(function (x) { (byC[x.contactId] = byC[x.contactId] || []).push(x); });
    var incOf = function (row, src) { (r.incomeAccounts || []).forEach(function (a) { if (src['inc:' + a.id]) row['inc:' + a.id] = src['inc:' + a.id]; }); return row; };
    var cv = function (c) { return { invoices: c.invoices, amount: c.invoiced, received: c.received, credits: c.credits, open: c.open, days: c.avgDays, firstDays: c.avgFirst, weighted: c.weightedDays, late: c.avgLate, onTime: c.onTimePct, openCount: c.openCount, daysOpen: c.oldestOpen }; };
    r.customers.forEach(function (c) {
      var cp = 'c:' + (c.contactId || '-');
      rows.push(incOf(Object.assign({ level: 0, kind: 'customer', path: cp, id: c.contactId, contactId: c.contactId, label: c.name }, cv(c)), c));
      (byC[c.contactId] || []).forEach(function (x) {
        var ip = cp + '/' + x.id;
        rows.push({ level: 1, kind: 'invoice', path: ip, id: x.id, t: x.t, label: 'Invoice ' + (x.number || U.fmtDate(x.date)), date: x.date, dueDate: x.dueDate, terms: x.terms, amount: x.amount, received: x.received, credits: x.credits, open: x.open,
          paidDate: x.paidDate, days: x.daysToPay, firstDays: x.daysToFirst, weighted: x.weightedDays, late: x.daysLate, status: x.status, daysOpen: x.daysOpen, memo: x.memo,
          payCount: x.payCount, firstPayDate: x.firstPayDate, lastPayDate: x.apps.length ? x.apps[x.apps.length - 1].date : '', payments: x.payments,
          payNos: x.apps.map(function (a) { return a.number; }).filter(Boolean).join(', '),
          depositTo: x.apps.map(function (a) { return a.depositTo; }).filter(function (v, i, arr) { return v && arr.indexOf(v) === i; }).join(', '),
          incomeCount: x.incomeCount, incomeText: x.incomeText });
        incOf(rows[rows.length - 1], x);
      });
    });
    return rows;
  };

  var F = function (key, label, type) { return { key: key, label: label, type: type || 'text' }; };
  P.FIELDS = {
    invoice: [F('customer', 'Customer'), F('number', 'Invoice no.'), F('date', 'Invoice date', 'date'), F('dueDate', 'Due date', 'date'), F('terms', 'Terms'),
      F('amount', 'Invoice amount', 'money'), F('received', 'Received', 'money'), F('credits', 'Credits applied', 'money'), F('open', 'Open balance', 'money'), F('status', 'Status'),
      F('payCount', 'No. of payments', 'num'), F('firstPayDate', 'First payment', 'date'), F('paidDate', 'Paid in full on', 'date'), F('daysToFirst', 'Days to first payment', 'num'),
      F('daysToPay', 'Days to pay', 'num'), F('weightedDays', 'Weighted days', 'num'), F('daysLate', 'Days late', 'num'), F('daysOpen', 'Days open', 'num'), F('daysPastDue', 'Days past due', 'num'),
      F('payments', 'Payments received'), F('memo', 'Memo')],
    summary: [F('customer', 'Customer'), F('invoices', 'Invoices', 'num'), F('invoiced', 'Invoiced', 'money'), F('received', 'Received', 'money'), F('credits', 'Credits applied', 'money'), F('open', 'Open balance', 'money'),
      F('paidCount', 'Paid invoices', 'num'), F('avgDays', 'Avg days to pay', 'num'), F('weightedDays', 'Weighted avg days', 'num'), F('avgFirst', 'Avg days to first payment', 'num'), F('avgLate', 'Avg days late', 'num'),
      F('onTimePct', 'Paid on time %', 'num'), F('fastest', 'Fastest (days)', 'num'), F('slowest', 'Slowest (days)', 'num'), F('openCount', 'Open invoices', 'num'), F('oldestOpen', 'Oldest open (days)', 'num')],
    drill: [F('invoices', 'Invoices', 'num'), F('date', 'Invoice date', 'date'), F('dueDate', 'Due date', 'date'), F('terms', 'Terms'), F('amount', 'Invoice amount', 'money'),
      F('firstPayDate', 'First payment', 'date'), F('lastPayDate', 'Last payment', 'date'), F('paidDate', 'Paid in full on', 'date'), F('payCount', 'No. of payments', 'num'), F('payNos', 'Payment no.'),
      F('received', 'Received', 'money'), F('credits', 'Credits applied', 'money'), F('open', 'Open balance', 'money'),
      F('days', 'Days to pay', 'num'), F('firstDays', 'Days to first payment', 'num'), F('weighted', 'Weighted days', 'num'), F('late', 'Days late', 'num'), F('status', 'Status'),
      F('onTime', 'Paid on time %', 'num'), F('openCount', 'Open invoices', 'num'), F('daysOpen', 'Days open (oldest)', 'num'), F('depositTo', 'Deposited to'),
      F('payments', 'Payments received (date, no., amount)'), F('memo', 'Memo')],
    payment: [F('customer', 'Customer'), F('invoice', 'Invoice no.'), F('invoiceDate', 'Invoice date', 'date'), F('dueDate', 'Due date', 'date'), F('invoiceAmount', 'Invoice amount', 'money'),
      F('date', 'Payment date', 'date'), F('number', 'Payment no.'), F('kind', 'Type'), F('depositTo', 'Deposited to'), F('amount', 'Amount applied', 'money'),
      F('days', 'Days after invoice', 'num'), F('daysLate', 'Days after due date', 'num'), F('memo', 'Memo')]
  };
  // income-account fields (1.29.2): the list and count, plus one money field per income account found in the report
  var INC_LIST = [F('incomeText', 'Income accounts'), F('incomeCount', 'No. of income accounts', 'num')];
  P.incomeFields = function (r) { return ((r && r.incomeAccounts) || []).map(function (a) { return F('inc:' + a.id, a.label, 'money'); }); };
  /** Every field a view offers for this report: the fixed ones, then the income-account fields (not in By payment). */
  P.allFields = function (view, r) {
    var base = P.FIELDS[view] || P.FIELDS.invoice;
    return view === 'payment' ? base : base.concat(view === 'summary' ? [] : INC_LIST, P.incomeFields(r));
  };
  P.DEFAULTS = {
    drill: ['invoices', 'date', 'dueDate', 'amount', 'paidDate', 'payNos', 'received', 'open', 'days', 'late', 'status', 'onTime', 'payments'],
    invoice: ['customer', 'number', 'date', 'dueDate', 'amount', 'received', 'paidDate', 'daysToPay', 'daysLate', 'status', 'open'],
    summary: ['customer', 'invoices', 'invoiced', 'received', 'open', 'avgDays', 'weightedDays', 'avgLate', 'onTimePct', 'openCount', 'oldestOpen'],
    payment: ['customer', 'invoice', 'invoiceDate', 'dueDate', 'date', 'number', 'amount', 'days', 'daysLate', 'depositTo']
  };
  /** The chosen fields of a view, in the order chosen; unknown keys dropped, empty → defaults. */
  P.fields = function (view, keys, r) {
    var list = P.allFields(view, r), get = function (ks) { return ks.map(function (k) { return list.find(function (f) { return f.key === k; }); }).filter(Boolean); };
    var out = keys && keys.length ? get(keys) : [];
    return out.length ? out : get(P.DEFAULTS[view] || P.DEFAULTS.invoice);
  };
  P.items = function (r, view) { return view === 'drill' ? P.drill(r) : view === 'summary' ? r.customers : view === 'payment' ? r.lines : r.invoices; };
  P.DRILL_HEAD = 'Customer / invoice';
  /** Total row of a list for the chosen fields: money summed, days averaged (summary: the report's total). */
  var incOfTotal = function (r, o) { (r.incomeAccounts || []).forEach(function (a) { if (r.total['inc:' + a.id]) o['inc:' + a.id] = r.total['inc:' + a.id]; }); return o; };
  P.totals = function (r, view) {
    if (view === 'summary') return r.total;
    if (view === 'drill') { var c = r.total; return incOfTotal(r, { invoices: c.invoices, amount: c.invoiced, received: c.received, credits: c.credits, open: c.open, days: c.avgDays, firstDays: c.avgFirst, weighted: c.weightedDays, late: c.avgLate, onTime: c.onTimePct, openCount: c.openCount, daysOpen: c.oldestOpen }); }
    var list = P.items(r, view), t = {};
    P.allFields(view, r).forEach(function (f) {
      if (f.type === 'money' && f.key !== 'invoiceAmount') t[f.key] = U.sum(list, function (x) { return x[f.key] || 0; });
      else if (f.type === 'num' && /^days|weighted/.test(f.key)) t[f.key] = avg(list.map(function (x) { return x[f.key]; }));
    });
    return t;
  };
  P.value = function (f, x) {
    var v = x[f.key];
    if (v === null || v === undefined || v === '') return '';
    if (f.type === 'money') return { v: v / 100, money: true };
    if (f.type === 'date') return U.fmtDate(v);
    return v;
  };
  /** Rows for CSV / Excel / PDF: header, one row per item, then a Total row (flag mtx.hasTotal).
   *  Drill-down: the first column is the tree label, a cell { v, depth } (0 customer, 1 invoice) that the
   *  report model turns into grouped rows in Excel and indents in PDF. */
  P.matrix = function (r, view, keys) {
    var fs = P.fields(view, keys, r), list = P.items(r, view), tot = P.totals(r, view);
    if (view === 'drill') {
      var dm = [[P.DRILL_HEAD].concat(fs.map(function (f) { return f.label; }))];
      list.forEach(function (x) { dm.push([{ v: x.label, depth: x.level, bold: x.level === 0 }].concat(fs.map(function (f) { return P.value(f, x); }))); });
      dm.push(['Total'].concat(fs.map(function (f) { return P.value(f, tot); }))); dm.hasTotal = true;
      return dm;
    }
    var mtx = [fs.map(function (f) { return f.label; })];
    list.forEach(function (x) { mtx.push(fs.map(function (f) { return P.value(f, x); })); });
    var tr = fs.map(function (f, i) { return i === 0 ? 'Total' : f.key === 'customer' ? '' : P.value(f, tot); });
    mtx.push(tr); mtx.hasTotal = true;
    return mtx;
  };
})(typeof window !== 'undefined' ? window : globalThis);
