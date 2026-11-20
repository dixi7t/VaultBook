/* VaultBook — reconciliation report (1.27.2), laid out like QuickBooks' Reconciliation Detail and Summary.
 * Builds an OB.reportModel model from a finished reconciliation, so the screen, PDF and Excel show the same thing.
 *   OB.reconReport.model(book, recId, { view: 'detail'|'summary', printedAt })
 * Detail columns: Type | Date | Num | Name | Memo | Clr | Amount | Balance. Amounts are signed in the account's own
 * terms (deposits +, checks −; on a credit card, charges +, payments −). Inside each section the Balance column
 * runs from zero, as in QuickBooks; Cleared Balance and Register Balance add the beginning balance.
 * Uses the frozen record kept when the reconciliation was finished (book.reconReport). Integer cents.
 */
(function (root) {
  'use strict';
  var OB = root.OB, U = OB.util, S = OB.schema;
  var RR = OB.reconReport = {};

  function typeLabel(k) { return S.TXN_TYPES[k] ? S.TXN_TYPES[k].label : k; }
  function byDate(a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : String(a.number).localeCompare(String(b.number), undefined, { numeric: true }); }
  function stamp(iso) {
    var d = iso ? new Date(iso) : new Date();
    if (isNaN(d)) return '';
    var h = d.getHours(), m = ('0' + d.getMinutes()).slice(-2);
    return U.fmtDate(U.ymd(d.getFullYear(), d.getMonth() + 1, d.getDate())) + ' ' + ((h % 12) || 12) + ':' + m + ' ' + (h < 12 ? 'AM' : 'PM');
  }

  /** The two groups of a section, in QuickBooks order and words. */
  RR.groups = function (account) {
    return account && account.type === 'cc'
      ? [{ sign: 1, title: 'Charges and Cash Advances' }, { sign: -1, title: 'Payments and Credits' }]
      : [{ sign: -1, title: 'Checks and Payments' }, { sign: 1, title: 'Deposits and Credits' }];
  };

  RR.model = function (book, recId, opts) {
    opts = opts || {};
    var rep = book.reconReport(recId); if (!rep) return null;
    var rec = rep.rec, a = rep.account, view = opts.view === 'summary' ? 'summary' : 'detail';
    var groups = RR.groups(a), begin = rec.beginningBalance;
    var split = function (list) { return groups.map(function (g) { return { g: g, items: (list || []).filter(function (x) { return g.sign > 0 ? x.amount > 0 : x.amount < 0; }).sort(byDate) }; }); };
    var cleared = split(rep.cleared), open = rep.outstanding ? split(rep.outstanding) : null;
    var sum = function (l) { return U.sum(l, function (x) { return x.amount; }); };
    var clearedTotal = U.sum(cleared, function (s) { return sum(s.items); });
    var openTotal = open ? U.sum(open, function (s) { return sum(s.items); }) : 0;
    var count = function (n) { return n + (n === 1 ? ' item' : ' items'); };
    var dateTxt = U.fmtDate(rec.statementDate);
    var lines = [book.company.name, view === 'summary' ? 'Reconciliation Summary' : 'Reconciliation Detail', a.name + ', Period Ending ' + dateTxt,
      'Reconciled on ' + stamp(rec.completedAt) + (rec.undone ? ' · UNDONE ' + stamp(rec.undoneAt) : '') + (rep.rebuilt ? ' · rebuilt from today\'s books' : '')];
    var footer = ['Printed ' + stamp(opts.printedAt) + ' · VaultBook'];
    if (rep.rebuilt) footer.push('Finished before VaultBook kept a frozen copy: cleared items are rebuilt from the books and uncleared items are not shown.');
    if (rec.adjustment) footer.push('Includes a reconciliation adjustment of ' + U.fmt(rec.adjustment.amount, { symbol: true }) + ' to ' + OB.Book.RECON_DIFF_NAME + '.');
    var rows = [], spacer = function () { rows.push({ label: '', kind: 'spacer' }); };

    if (view === 'summary') {
      var C = function (label, v, o) { o = o || {}; rows.push({ label: label, depth: o.depth || 0, kind: o.kind || 'account', bold: !!o.bold, line: o.line || null, cells: [v === undefined ? null : v] }); };
      C('Beginning Balance', begin, { bold: true });
      C('Cleared Transactions', undefined, { depth: 1, kind: 'header', bold: true });
      cleared.forEach(function (s) { C(s.g.title + ' - ' + count(s.items.length), sum(s.items), { depth: 2 }); });
      C('Total Cleared Transactions', clearedTotal, { depth: 1, kind: 'total', line: 'single' });
      spacer(); C('Cleared Balance', begin + clearedTotal, { kind: 'total', line: 'single', bold: true });
      if (open) {
        spacer(); C('Uncleared Transactions', undefined, { depth: 1, kind: 'header', bold: true });
        open.forEach(function (s) { C(s.g.title + ' - ' + count(s.items.length), sum(s.items), { depth: 2 }); });
        C('Total Uncleared Transactions', openTotal, { depth: 1, kind: 'total', line: 'single' });
        spacer(); C('Register Balance as of ' + dateTxt, begin + clearedTotal + openTotal, { kind: 'total', line: 'single', bold: true });
      }
      spacer(); C('Ending Balance', begin + clearedTotal + openTotal, { kind: 'total', line: 'double', bold: true });
      spacer(); C('Statement Ending Balance', rec.endingBalance);
      C('Difference', begin + clearedTotal - rec.endingBalance);
      return { kind: 'table', portrait: true, lines: lines, labelHead: '', head: [[dateTxt]], columns: [{ label: dateTxt, num: true }], rows: rows, footer: footer, nf: { neg: 'minus' } };
    }

    // detail
    var R = function (label, cells, o) { o = o || {}; rows.push({ label: label, depth: o.depth || 0, kind: o.kind || 'account', bold: !!o.bold, line: o.line || null, cells: cells, txnId: o.txnId }); };
    var blank = function (amount, balance) { return [null, null, null, null, null, amount === undefined ? null : amount, balance === undefined ? null : balance]; };
    var section = function (title, parts, clr) {
      R(title, null, { depth: 1, kind: 'header', bold: true });
      parts.forEach(function (s) {
        if (!s.items.length) return;
        R(s.g.title + ' - ' + count(s.items.length), null, { depth: 2, kind: 'header', bold: true });
        var run = 0;
        s.items.forEach(function (x) { run += x.amount; R(typeLabel(x.type), [U.fmtDate(x.date), x.number || '', x.name || '', x.memo || '', clr, x.amount, run], { txnId: x.txnId }); });
        R('Total ' + s.g.title, blank(sum(s.items), sum(s.items)), { depth: 2, kind: 'total', line: 'single' });
        spacer();
      });
    };
    R('Beginning Balance', blank(undefined, begin), { bold: true });
    section('Cleared Transactions', cleared, 'X');
    R('Total Cleared Transactions', blank(clearedTotal, clearedTotal), { depth: 1, kind: 'total', line: 'single' });
    spacer(); R('Cleared Balance', blank(clearedTotal, begin + clearedTotal), { kind: 'total', line: 'single', bold: true });
    if (open) {
      spacer(); section('Uncleared Transactions', open, '');
      if (!open.some(function (s) { return s.items.length; })) R('None', null, { depth: 2 });
      R('Total Uncleared Transactions', blank(openTotal, openTotal), { depth: 1, kind: 'total', line: 'single' });
      spacer(); R('Register Balance as of ' + dateTxt, blank(clearedTotal + openTotal, begin + clearedTotal + openTotal), { kind: 'total', line: 'single', bold: true });
    }
    spacer(); R('Ending Balance', blank(clearedTotal + openTotal, begin + clearedTotal + openTotal), { kind: 'total', line: 'double', bold: true });
    spacer(); spacer();
    R('Statement ending balance ' + U.fmt(rec.endingBalance, { symbol: true }) + ' · difference ' + U.fmt(begin + clearedTotal - rec.endingBalance, { symbol: true }), null, { kind: 'note' });
    spacer();
    R('Prepared by: ______________________   Date: __________      Reviewed by: ______________________   Date: __________', null, { kind: 'note' });
    return {
      kind: 'table', portrait: true, lines: lines, labelHead: 'Type', head: [['Date', 'Num', 'Name', 'Memo', 'Clr', 'Amount', 'Balance']],
      columns: [{ label: 'Date', num: false }, { label: 'Num', num: false }, { label: 'Name', num: false }, { label: 'Memo', num: false }, { label: 'Clr', num: false }, { label: 'Amount', num: true }, { label: 'Balance', num: true }],
      rows: rows, footer: footer, nf: { neg: 'minus' }, overflowLabels: true
    };
  };

  /** Rows as plain text for CSV: [label, cells...]. */
  RR.matrix = function (model) {
    var M = OB.reportModel, out = model.lines.filter(Boolean).map(function (l) { return [l]; });
    out.push([]); out.push([model.labelHead || ''].concat(model.columns.map(function (c) { return c.label; })));
    model.rows.forEach(function (r) {
      if (r.kind === 'spacer') return;
      out.push([(r.depth ? new Array(r.depth * 2 + 1).join(' ') : '') + r.label].concat(r.cells ? model.columns.map(function (c, i) { var v = r.cells[i]; return typeof v === 'number' ? (v / 100).toFixed(2) : M.cellText(model, r, i); }) : []));
    });
    return out;
  };
})(typeof window !== 'undefined' ? window : globalThis);
