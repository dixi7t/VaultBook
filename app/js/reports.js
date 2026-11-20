/* OfflineBooks US — report engine. Every figure is computed from posted journal splits. */
(function (root) {
  'use strict';
  var OB = root.OB = root.OB || {};
  var U = OB.util, S = OB.schema;
  var R = OB.reports = {};

  /* ---------- entries by basis ----------
   * Returns accountId -> [{t, accountId, amount, contactId, memo, i}] sorted by date.
   * Accrual: the posted splits. Cash: A/R & A/P documents are recognized only when paid,
   * by allocating each payment application across the paid document's lines.
   */
  R.entries = function (book, basis) {
    var idx = book.splitIndex();
    if (basis !== 'cash') return idx;
    if (book._cashCache && book._cashCache.src === idx) return book._cashCache.out;
    var out = {}, arId = book.sys('AR').id, apId = book.sys('AP').id;
    var add = function (t, accountId, amount, contactId, memo, i, classId) {
      if (!amount) return;
      var sp = { accountId: accountId, amount: amount, contactId: contactId || '', memo: memo || '' };
      if (classId) sp.classId = classId;
      (out[accountId] = out[accountId] || []).push({ t: t, s: sp, i: i });
    };
    var docTypes = { invoice: 1, bill: 1, creditMemo: 1, vendorCredit: 1 };
    var cdep = book.depositAccount ? book.depositAccount() : null, cdepId = cdep ? cdep.id : '';
    // CPA-07: the part of an invoice paid from a customer deposit was received in cash already (when the deposit came in).
    // It is recognised on the invoice date — the deposit is relieved and the invoice's other lines are recognised pro rata —
    // and payments then allocate only over those other lines, so nothing counts twice.
    var depOf = function (t) { return t.type === 'invoice' && cdepId ? U.sum(t.splits.filter(function (x) { return x.accountId === cdepId && x.amount > 0; }), function (x) { return x.amount; }) : 0; };
    var docLines = function (t) { var dep = depOf(t); return t.splits.filter(function (x) { return x.accountId !== arId && x.accountId !== apId && !(dep && x.accountId === cdepId && x.amount > 0); }); };
    var txs = book.posted().sort(OB.Book.cmpTxn);
    // t = the entry being added (dated), d = the document whose cash-basis treatment applies, g = +1 / −1
    // CPA-21: a reversing entry that voids a document "as of" a later date undoes exactly what that document contributed
    var post = function (t, d, g) {
      if (docTypes[d.type]) {
        var dep = depOf(d); if (!dep) return;
        d.splits.forEach(function (x, i) { if (x.accountId === cdepId && x.amount > 0) add(t, x.accountId, g * x.amount, x.contactId, x.memo, i, x.classId); });
        var ls = docLines(d), parts = U.allocate(dep, ls.map(function (x) { return Math.abs(x.amount) * (x.amount < 0 ? 1 : -1); }));
        ls.forEach(function (x, k) { add(t, x.accountId, -g * parts[k], x.contactId, x.memo || 'Paid from deposit', d.splits.indexOf(x), x.classId); });
        return;
      }
      var isAppType = d.type === 'payment' || d.type === 'billPayment' || d.type === 'customerRefund' || d.type === 'vendorRefund';
      d.splits.forEach(function (s, i) {
        if (isAppType && (s.accountId === arId || s.accountId === apId)) {
          var sign = s.amount > 0 ? 1 : -1, remaining = Math.abs(s.amount);
          (d.applications || []).forEach(function (ap) {
            var target = book.txById[ap.txnId];
            if (!target || target.status !== 'posted' || !docTypes[target.type]) return; // e.g. refund of unapplied payment stays on A/R
            var lineSplits = docLines(target);
            var weights = lineSplits.map(function (x) { return Math.abs(x.amount) * (x.amount * sign > 0 ? 1 : -1); });
            var parts = U.allocate(ap.amount, weights);
            lineSplits.forEach(function (x, k) { add(t, x.accountId, g * sign * parts[k], s.contactId, x.memo || ('Payment for ' + (target.number || '')), i, x.classId); });
            remaining -= ap.amount;
          });
          if (remaining) add(t, s.accountId, g * sign * remaining, s.contactId, s.memo, i, s.classId);
        } else add(t, s.accountId, g * s.amount, s.contactId, s.memo, i, s.classId);
      });
    };
    txs.forEach(function (t) {
      var orig = t.type === 'journal' && t.voidOf ? book.txById[t.voidOf] : null;
      if (orig) post(t, orig, -1); else post(t, t, 1);
    });
    book._cashCache = { src: idx, out: out };
    return out;
  };
  R.basis = function (book, opts) { return (opts && opts.basis) || book.company.basis || 'accrual'; };

  /** Raw (debit-positive) sum for an account within [from, to]. */
  function rawSum(list, from, to) {
    var t = 0;
    if (!list) return 0;
    for (var i = 0; i < list.length; i++) {
      var d = list[i].t.date;
      if (to && d > to) break;
      if (from && d < from) continue;
      t += list[i].s.amount;
    }
    return t;
  }
  R.rawSum = rawSum;

  /* ---------- period columns ---------- */
  R.periods = function (from, to, mode) {
    if (!mode || mode === 'total') return [{ label: 'Total', from: from, to: to }];
    var cols = [], start = from;
    var guard = 0;
    while (start <= to && guard++ < 400) {
      var end;
      if (mode === 'month') end = U.monthEnd(start);
      else if (mode === 'quarter') end = U.addDays(U.addMonths(U.monthStart(start), 3), -1);
      else end = U.addDays(U.addMonths(U.monthStart(start), 12), -1);
      if (end > to) end = to;
      var label = mode === 'month' ? U.monthLabel(start) : mode === 'quarter' ? U.monthLabel(start) + ' – ' + U.monthLabel(end) : (start.slice(0, 4) === end.slice(0, 4) && start.slice(5) === '01-01' && end.slice(5) === '12-31' ? start.slice(0, 4) : U.fmtDate(start) + ' – ' + U.fmtDate(end));
      cols.push({ label: label, from: start, to: end });
      start = U.addDays(end, 1);
    }
    if (cols.length > 1) cols.push({ label: 'Total', from: from, to: to, total: true });
    return cols;
  };

  /* ---------- Profit & Loss ---------- */
  var PL_SECTIONS = [
    { key: 'income', title: 'Income', types: ['income'] },
    { key: 'cogs', title: 'Cost of Goods Sold', types: ['cogs'] },
    { key: 'expense', title: 'Expenses', types: ['expense'] },
    { key: 'oi', title: 'Other Income', types: ['oi'] },
    { key: 'oe', title: 'Other Expenses', types: ['oe'] }
  ];
  R.pnl = function (book, opts) {
    var basis = R.basis(book, opts), ent = R.entries(book, basis);
    var cols = R.periods(opts.from, opts.to, opts.columns);
    var sections = {};
    PL_SECTIONS.forEach(function (sec) {
      var rows = [];
      book.sortedAccounts(function (a) { return sec.types.indexOf(a.type) >= 0; }).forEach(function (a) {
        var sign = book.normalSign(a);
        var vals = cols.map(function (c) { return sign * rawSum(ent[a.id], c.from, c.to); });
        if (vals.some(function (v) { return v !== 0; })) rows.push({ accountId: a.id, label: book.accountLabel(a.id), depth: depth(book, a), values: vals });
      });
      var totals = cols.map(function (c, k) { return U.sum(rows, function (r) { return r.values[k]; }); });
      sections[sec.key] = { title: sec.title, rows: rows, totals: totals };
    });
    var m = function (f) { return cols.map(function (c, k) { return f(k); }); };
    var gross = m(function (k) { return sections.income.totals[k] - sections.cogs.totals[k]; });
    var netOp = m(function (k) { return gross[k] - sections.expense.totals[k]; });
    var netOther = m(function (k) { return sections.oi.totals[k] - sections.oe.totals[k]; });
    var net = m(function (k) { return netOp[k] + netOther[k]; });
    return { title: 'Profit and Loss', basis: basis, from: opts.from, to: opts.to, columns: cols, sections: sections, sectionOrder: PL_SECTIONS.map(function (s) { return s.key; }), grossProfit: gross, netOperatingIncome: netOp, netOtherIncome: netOther, netIncome: net };
  };
  function depth(book, a) { var d = 0, p = a.parentId ? book.accById[a.parentId] : null; while (p && d < 10) { d++; p = p.parentId ? book.accById[p.parentId] : null; } return d; }

  /** Net income (raw P&L) over a range for a basis — natural sign (profit positive). */
  R.netIncome = function (book, basis, from, to) {
    var ent = R.entries(book, basis), t = 0;
    book.accounts.forEach(function (a) { if (S.isPL(a.type)) t += rawSum(ent[a.id], from, to); });
    return -t;
  };

  /* ---------- Balance Sheet ---------- */
  R.balanceSheet = function (book, opts) {
    var basis = R.basis(book, opts), ent = R.entries(book, basis);
    var dates = [opts.asOf].concat(opts.compare || []);
    var fyMonth = book.company.fiscalYearStartMonth || 1;
    var groups = [
      { key: 'assets', title: 'Assets', subs: [['Current Assets', ['bank', 'ar', 'oca']], ['Fixed Assets', ['fixed']], ['Other Assets', ['oa']]] },
      { key: 'liabilities', title: 'Liabilities', subs: [['Current Liabilities', ['ap', 'cc', 'ocl']], ['Long-Term Liabilities', ['ltl']]] },
      { key: 'equity', title: 'Equity', subs: [['Equity', ['equity']]] }
    ];
    var out = { title: 'Balance Sheet', basis: basis, asOf: opts.asOf, columns: dates.map(function (d) { return { label: 'As of ' + U.fmtDate(d), asOf: d }; }), groups: [] };
    var reAcc = book.sys('RE');
    groups.forEach(function (g) {
      var G = { key: g.key, title: g.title, subs: [], totals: dates.map(function () { return 0; }) };
      g.subs.forEach(function (sub) {
        var rows = [];
        book.sortedAccounts(function (a) { return sub[1].indexOf(a.type) >= 0; }).forEach(function (a) {
          var sign = g.key === 'assets' ? 1 : -1;
          var vals = dates.map(function (d) {
            var v = sign * rawSum(ent[a.id], null, d);
            if (reAcc && a.id === reAcc.id) {
              var fys = U.fiscalYearStart(d, fyMonth);
              v += R.netIncome(book, basis, null, U.addDays(fys, -1)); // prior years' profit
            }
            return v;
          });
          if (vals.some(function (v) { return v !== 0; }) || (reAcc && a.id === reAcc.id)) rows.push({ accountId: a.id, label: book.accountLabel(a.id), depth: depth(book, a), values: vals });
        });
        if (g.key === 'equity') {
          rows.push({ accountId: '', label: 'Net Income', netIncome: true, values: dates.map(function (d) { return R.netIncome(book, basis, U.fiscalYearStart(d, fyMonth), d); }) });
        }
        var totals = dates.map(function (d, k) { return U.sum(rows, function (r) { return r.values[k]; }); });
        if (rows.length) G.subs.push({ title: sub[0], rows: rows, totals: totals });
        totals.forEach(function (v, k) { G.totals[k] += v; });
      });
      out.groups.push(G);
    });
    out.totalAssetsByCol = out.groups[0].totals;
    out.totalLiabEquityByCol = dates.map(function (d, k) { return out.groups[1].totals[k] + out.groups[2].totals[k]; });
    out.totalAssets = out.totalAssetsByCol[0];
    out.totalLiabEquity = out.totalLiabEquityByCol[0];
    out.balanced = out.totalAssetsByCol.every(function (v, k) { return v === out.totalLiabEquityByCol[k]; });
    return out;
  };

  /* ---------- Trial Balance ---------- */
  R.trialBalance = function (book, opts) {
    var basis = R.basis(book, opts), ent = R.entries(book, basis);
    var asOf = opts.asOf || '9999-12-31';
    var fys = U.fiscalYearStart(asOf === '9999-12-31' ? U.today() : asOf, book.company.fiscalYearStartMonth);
    if (asOf === '9999-12-31') fys = '0000-01-01'; // all-time: no closing
    var rows = [], reAcc = book.sys('RE');
    book.sortedAccounts().forEach(function (a) {
      var raw;
      if (S.isPL(a.type)) raw = rawSum(ent[a.id], fys, asOf);
      else raw = rawSum(ent[a.id], null, asOf);
      if (reAcc && a.id === reAcc.id && fys !== '0000-01-01') raw += -R.netIncome(book, basis, null, U.addDays(fys, -1));
      if (raw !== 0) rows.push({ accountId: a.id, label: book.accountLabel(a.id), type: a.type, debit: raw > 0 ? raw : 0, credit: raw < 0 ? -raw : 0 });
    });
    var td = U.sum(rows, function (r) { return r.debit; }), tc = U.sum(rows, function (r) { return r.credit; });
    return { title: 'Trial Balance', basis: basis, asOf: opts.asOf, rows: rows, totalDebit: td, totalCredit: tc, balanced: td === tc };
  };

  /* ---------- General Ledger / Transaction detail ---------- */
  R.generalLedger = function (book, opts) {
    var basis = R.basis(book, opts), ent = R.entries(book, basis);
    var from = opts.from, to = opts.to;
    var filter = opts.accountIds && opts.accountIds.length ? opts.accountIds : null;
    var typeFilter = opts.accountTypes || null;
    var clsF = opts.classId && R.classFilter ? R.classFilter(book, opts.classId) : null;
    var accounts = [];
    book.sortedAccounts(function (a) { return (!filter || filter.indexOf(a.id) >= 0) && (!typeFilter || typeFilter.indexOf(a.type) >= 0); }).forEach(function (a) {
      var list = ent[a.id] || [];
      var sign = book.normalSign(a);
      var plStart = S.isPL(a.type) && opts.plFromFiscalStart ? U.fiscalYearStart(from, book.company.fiscalYearStartMonth) : null;
      var opening = from ? sign * rawSum(list, plStart, U.addDays(from, -1)) : 0;
      if (S.isPL(a.type) && !opts.plFromFiscalStart) opening = 0;
      var bal = opening, rows = [];
      for (var i = 0; i < list.length; i++) {
        var e = list[i], d = e.t.date;
        if (to && d > to) break;
        if (from && d < from) continue;
        if (opts.contactId !== undefined && opts.contactId !== null && (opts.contactId === '' ? (e.s.contactId || '') !== '' : e.s.contactId !== opts.contactId)) continue;
        if (clsF && (clsF === '__none' ? e.s.classId : !clsF[e.s.classId || ''])) continue;
        bal += sign * e.s.amount;
        rows.push({ t: e.t, i: e.i, date: d, type: S.TXN_TYPES[e.t.type].label, number: e.t.number, name: e.s.contactId && book.contactById[e.s.contactId] ? book.contactById[e.s.contactId].name : '', memo: e.s.memo || e.t.memo, split: book.splitCounterpart(e.t, e.i), debit: e.s.amount > 0 ? e.s.amount : 0, credit: e.s.amount < 0 ? -e.s.amount : 0, balance: bal });
      }
      if (rows.length || opening) accounts.push({ accountId: a.id, label: book.accountLabel(a.id), opening: opening, rows: rows, closing: bal, totalDebit: U.sum(rows, function (r) { return r.debit; }), totalCredit: U.sum(rows, function (r) { return r.credit; }) });
    });
    return { title: opts.title || 'General Ledger', basis: basis, from: from, to: to, accounts: accounts };
  };

  /* ---------- Cash Flow (indirect method) ---------- */
  R.cashFlow = function (book, opts) {
    var basis = R.basis(book, opts), ent = R.entries(book, basis);
    var from = opts.from, to = opts.to, before = U.addDays(from, -1);
    var ni = R.netIncome(book, basis, from, to);
    var sections = { operating: [], investing: [], financing: [] };
    var cashBegin = 0, cashEnd = 0, undep = book.sys('UNDEP'), dep = 0, accum = {};
    // CPA-10: accumulated depreciation / amortization accounts are a non-cash operating add-back
    (book.company.fixedAssets || []).forEach(function (fa) { if (fa.accumAccountId) accum[fa.accumAccountId] = 1; });
    book.accounts.forEach(function (a) { if (/accumulated\s+(depreciation|amortization)/i.test(a.name)) accum[a.id] = 1; });
    // CPA-11: a fixed asset disposal is one investing inflow (the proceeds); its gain or loss is taken out of operating
    var skip = {}, proceeds = 0, gain = 0;
    book.posted().forEach(function (t) {
      if (t.type !== 'journal' || !t.disposal || t.date < from || t.date > to) return;
      (t.jlines || []).forEach(function (l) {
        var a = book.accById[l.accountId]; if (!a) return;
        var raw = (l.debit || 0) - (l.credit || 0);
        if (!S.isBS(a.type)) { gain -= raw; return; }
        if (S.TYPE[a.type].cash || (undep && a.id === undep.id)) { proceeds += raw; return; }
        skip[a.id] = (skip[a.id] || 0) + raw;
      });
    });
    book.sortedAccounts().forEach(function (a) {
      if (!S.isBS(a.type)) return;
      var list = ent[a.id];
      // cash: bank accounts, plus Undeposited Funds (receipts waiting to be deposited are cash on hand)
      if (S.TYPE[a.type].cash || (undep && a.id === undep.id)) { cashBegin += rawSum(list, null, before); cashEnd += rawSum(list, null, to); return; }
      var change = rawSum(list, from, to) - (skip[a.id] || 0);
      if (!change) return;
      var effect = -change; // debit increase in a non-cash account uses cash
      if (accum[a.id] && !a.cashFlow) { dep += effect; return; }
      var sec = a.cashFlow || (['ar', 'oca', 'ap', 'cc', 'ocl'].indexOf(a.type) >= 0 ? 'operating' : (a.type === 'fixed' || a.type === 'oa') ? 'investing' : 'financing');
      sections[sec].push({ accountId: a.id, label: book.accountLabel(a.id), amount: effect });
    });
    if (dep) sections.operating.unshift({ accountId: '', label: 'Depreciation and amortization', amount: dep, depreciation: true });
    if (gain) sections.operating.push({ accountId: '', label: (gain > 0 ? 'Gain' : 'Loss') + ' on sale of fixed assets', amount: -gain, disposal: true });
    if (proceeds) sections.investing.push({ accountId: '', label: 'Proceeds from sale of fixed assets', amount: proceeds, disposal: true });
    var tot = function (arr) { return U.sum(arr, function (r) { return r.amount; }); };
    var op = ni + tot(sections.operating), inv = tot(sections.investing), fin = tot(sections.financing);
    return { title: 'Statement of Cash Flows', basis: basis, from: from, to: to, netIncome: ni, operating: sections.operating, investing: sections.investing, financing: sections.financing,
      netOperating: op, netInvesting: inv, netFinancing: fin, netChange: op + inv + fin, cashBegin: cashBegin, cashEnd: cashEnd, reconciles: cashBegin + op + inv + fin === cashEnd };
  };

  /* ---------- A/R and A/P aging ---------- */
  R.aging = function (book, opts) {
    var kind = opts.kind === 'vendor' ? 'vendor' : 'customer';
    var asOf = opts.asOf || U.today();
    var docSign = kind === 'customer' ? { invoice: 1, creditMemo: -1, payment: -1, customerRefund: 1 } : { bill: 1, vendorCredit: -1, billPayment: -1, vendorRefund: 1 };
    var acc = kind === 'customer' ? book.sys('AR') : book.sys('AP');
    var buckets = ['Current', '1 – 30', '31 – 60', '61 – 90', '91 and over'];
    // applications that count by asOf: not before the credit, the document, or the day it was applied (CPA-08)
    var appliedTo = {}, appliedFrom = {};
    book.posted().forEach(function (t) {
      if (t.date > asOf || !t.applications) return;
      t.applications.forEach(function (a) {
        var tgt = book.txById[a.txnId]; if (!tgt || tgt.status !== 'posted' || book.appliedOn(t, tgt, a.date) > asOf) return;
        appliedTo[a.txnId] = (appliedTo[a.txnId] || 0) + a.amount; appliedFrom[t.id] = (appliedFrom[t.id] || 0) + a.amount;
      });
    });
    var byContact = {};
    var ensure = function (cid) {
      if (!byContact[cid]) byContact[cid] = { contactId: cid, name: book.contactById[cid] ? book.contactById[cid].name : '(unknown)', buckets: [0, 0, 0, 0, 0], total: 0, docs: [] };
      return byContact[cid];
    };
    book.posted().forEach(function (t) {
      if (t.date > asOf) return;
      if (docSign[t.type] !== undefined) {
        if (book.voidedAsOf(t, asOf)) return; // CPA-21: voided by a reversing entry on/before asOf
        var open = t.total - (appliedTo[t.id] || 0) - (appliedFrom[t.id] || 0);
        if (!open) return;
        var sign = docSign[t.type];
        var amt = sign * open;
        var due = t.dueDate || t.date;
        var days = U.daysBetween(due, asOf);
        var b = sign < 0 || days <= 0 ? 0 : days <= 30 ? 1 : days <= 60 ? 2 : days <= 90 ? 3 : 4;
        var row = ensure(t.contactId);
        row.buckets[b] += amt; row.total += amt;
        row.docs.push({ t: t, open: amt, due: due, daysPastDue: Math.max(0, days), bucket: b });
      }
    });
    // other A/R or A/P activity (journal entries etc.): a charge ages from its own date, a credit is current (CPA-24)
    (book.splitIndex()[acc.id] || []).forEach(function (e) {
      if (e.t.date > asOf || docSign[e.t.type] !== undefined || e.t.voidOf) return;
      var amt = kind === 'customer' ? e.s.amount : -e.s.amount;
      var days = U.daysBetween(e.t.date, asOf), bk = amt < 0 || days <= 0 ? 0 : days <= 30 ? 1 : days <= 60 ? 2 : days <= 90 ? 3 : 4;
      var row = ensure(e.s.contactId);
      row.buckets[bk] += amt; row.total += amt;
      row.docs.push({ t: e.t, open: amt, due: e.t.date, daysPastDue: Math.max(0, days), bucket: bk, other: true });
    });
    var rows = Object.keys(byContact).map(function (k) { return byContact[k]; }).filter(function (r) { return r.total !== 0 || r.docs.some(function (d) { return d.open; }); })
      .sort(function (a, b) { return a.name.localeCompare(b.name); });
    var totals = buckets.map(function (b, k) { return U.sum(rows, function (r) { return r.buckets[k]; }); });
    return { title: kind === 'customer' ? 'A/R Aging Summary' : 'A/P Aging Summary', kind: kind, asOf: asOf, bucketLabels: buckets, rows: rows, totals: totals, total: U.sum(totals), accountBalance: book.accountBalance(acc.id, asOf) };
  };

  /* ---------- Expense detail ---------- */
  R.expenseDetail = function (book, opts) {
    var r = R.generalLedger(book, { from: opts.from, to: opts.to, basis: opts.basis, accountTypes: ['cogs', 'expense', 'oe'], contactId: opts.contactId, title: 'Expense Detail' });
    r.total = U.sum(r.accounts, function (a) { return a.closing; });
    return r;
  };
  /** Expenses by vendor/payee summary. */
  R.expenseByVendor = function (book, opts) {
    var basis = R.basis(book, opts), ent = R.entries(book, basis), m = {};
    book.accounts.forEach(function (a) {
      if (['cogs', 'expense', 'oe'].indexOf(a.type) < 0) return;
      (ent[a.id] || []).forEach(function (e) {
        if (e.t.date < opts.from || e.t.date > opts.to) return;
        var k = e.s.contactId || e.t.contactId || '';
        m[k] = (m[k] || 0) + e.s.amount;
      });
    });
    var rows = Object.keys(m).map(function (k) { return { contactId: k, name: k && book.contactById[k] ? book.contactById[k].name : '(no payee)', amount: m[k] }; }).filter(function (r) { return r.amount; }).sort(function (a, b) { return b.amount - a.amount; });
    return { title: 'Expenses by Vendor Summary', basis: basis, from: opts.from, to: opts.to, rows: rows, total: U.sum(rows, function (r) { return r.amount; }) };
  };

  /* ---------- Transaction list ---------- */
  R.transactionList = function (book, opts) {
    opts = opts || {};
    var q = (opts.search || '').toLowerCase();
    var list = book.transactions.filter(function (t) {
      if (opts.status !== 'all' && opts.status !== 'void' && t.status !== 'posted') return false;
      if (opts.status === 'void' && t.status !== 'void') return false;
      if (opts.from && t.date < opts.from) return false;
      if (opts.to && t.date > opts.to) return false;
      if (opts.type && t.type !== opts.type) return false;
      if (opts.types && opts.types.indexOf(t.type) < 0) return false;
      if (opts.contactId && t.contactId !== opts.contactId) return false;
      if (opts.accountId && !t.splits.some(function (s) { return s.accountId === opts.accountId; })) return false;
      if (q) {
        var c = t.contactId && book.contactById[t.contactId] ? book.contactById[t.contactId].name : '';
        var hay = (t.number + ' ' + t.memo + ' ' + c + ' ' + S.TXN_TYPES[t.type].label + ' ' + U.fmtPlain(t.total) + ' ' + (t.lines || []).map(function (l) { return l.description; }).join(' ')).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
    list.sort(function (a, b) { return -OB.Book.cmpTxn(a, b); });
    return list;
  };

  /* ---------- Open documents (Open Invoices / Unpaid Bills) ---------- */
  /** Every open A/R (customer) or A/P (vendor) item on a date, grouped by contact — the QuickBooks Open Invoices / Unpaid Bills Detail report. */
  R.openDocs = function (book, opts) {
    var ag = R.aging(book, { kind: opts.kind, asOf: opts.asOf });
    var groups = ag.rows.map(function (r) {
      var docs = r.docs.slice().sort(function (x, y) { return x.t.date < y.t.date ? -1 : x.t.date > y.t.date ? 1 : 0; })
        .map(function (d) { return { t: d.t, date: d.t.date, number: d.t.number || '', type: d.t.type, terms: d.t.terms, due: d.other ? '' : d.due, aging: d.other || d.open < 0 ? 0 : d.daysPastDue, open: d.open, other: !!d.other }; });
      return { contactId: r.contactId, name: r.name, docs: docs, total: r.total };
    }).filter(function (g) { return g.docs.length; });
    return { kind: ag.kind, asOf: ag.asOf, groups: groups, total: ag.total, accountBalance: ag.accountBalance };
  };

  /* ---------- Customer / vendor balance detail ---------- */
  /** Every posting to A/R (or A/P) per contact up to a date, with a running balance. */
  R.contactDetail = function (book, opts) {
    var kind = opts.kind === 'vendor' ? 'vendor' : 'customer';
    var acc = kind === 'customer' ? book.sys('AR') : book.sys('AP');
    var sign = kind === 'customer' ? 1 : -1, by = {};
    (book.splitIndex()[acc.id] || []).slice().sort(function (a, b) { return OB.Book.cmpTxn(a.t, b.t); }).forEach(function (e) {
      if (e.t.date > opts.asOf) return;
      var cid = e.s.contactId || e.t.contactId || '';
      var g = by[cid] = by[cid] || { contactId: cid, name: cid && book.contactById[cid] ? book.contactById[cid].name : '(no name)', rows: [], total: 0 };
      g.total += sign * e.s.amount;
      g.rows.push({ t: e.t, amount: sign * e.s.amount, balance: g.total, memo: e.s.memo || e.t.memo || '' });
    });
    var groups = Object.keys(by).map(function (k) { return by[k]; }).filter(function (g) { return opts.all || g.total; }).sort(function (a, b) { return a.name.localeCompare(b.name); });
    return { kind: kind, asOf: opts.asOf, groups: groups, total: U.sum(groups, function (g) { return g.total; }), accountBalance: sign * book.rawBalance(acc.id, opts.asOf) };
  };

  /* ---------- Sales ---------- */
  var SALES_SIGN = { invoice: 1, salesReceipt: 1, creditMemo: -1 };
  /** Income-account postings in a period grouped by customer (accrual: invoices, sales receipts, credit memos, deposits and journals to income). */
  R.salesByCustomer = function (book, opts) {
    var basis = R.basis(book, opts), ent = R.entries(book, basis), m = {};
    book.accounts.forEach(function (a) {
      if (a.type !== 'income') return;
      (ent[a.id] || []).forEach(function (e) {
        if (e.t.date < opts.from || e.t.date > opts.to) return;
        var k = e.s.contactId || e.t.contactId || '';
        m[k] = (m[k] || 0) - e.s.amount;
      });
    });
    var rows = Object.keys(m).map(function (k) { return { contactId: k, name: k && book.contactById[k] ? book.contactById[k].name : '(no customer)', amount: m[k] }; }).filter(function (r) { return r.amount; }).sort(function (a, b) { return a.name.localeCompare(b.name); });
    return { basis: basis, rows: rows, total: U.sum(rows, function (r) { return r.amount; }) };
  };
  /** Sales document lines in a period grouped by product/service (quantity, amount, average price). */
  R.salesByItem = function (book, opts) {
    var m = {};
    book.posted().forEach(function (t) {
      var sg = SALES_SIGN[t.type];
      if (!sg || t.date < opts.from || t.date > opts.to) return;
      (t.lines || []).forEach(function (l) {
        var k = l.itemId && book.itemById && book.itemById[l.itemId] ? l.itemId : '';
        var r = m[k] = m[k] || { itemId: k, name: k ? book.itemById[k].name : '(no product/service)', qty: 0, amount: 0 };
        r.qty += sg * (l.qty === null || l.qty === undefined ? 0 : l.qty);
        r.amount += sg * (l.amount || 0);
      });
    });
    var rows = Object.keys(m).map(function (k) { return m[k]; }).filter(function (r) { return r.amount || r.qty; }).sort(function (a, b) { return a.name.localeCompare(b.name); });
    rows.forEach(function (r) { r.avg = r.qty ? Math.round(r.amount / r.qty) : null; });
    return { rows: rows, total: U.sum(rows, function (r) { return r.amount; }) };
  };

  /* ---------- Banking detail ---------- */
  /** Money in (Deposit Detail) or money out by check (Check Detail): each transaction with its other-side lines. */
  R.bankDetail = function (book, opts) {
    var types = opts.mode === 'check' ? { check: 1, billPayment: 1, expense: 1 } : { deposit: 1, payment: 1, salesReceipt: 1 };
    var bankIds = {};
    book.accounts.forEach(function (a) { if (a.type === 'bank' || (opts.mode !== 'check' && a.system === 'UNDEP')) bankIds[a.id] = 1; });
    var list = book.posted().filter(function (t) {
      if (!types[t.type] || t.date < opts.from || t.date > opts.to) return false;
      if (opts.mode === 'check' && t.type === 'expense' && !t.number) return false;
      return t.splits.some(function (s) { return bankIds[s.accountId] && (opts.mode === 'check' ? s.amount < 0 : s.amount > 0); });
    }).sort(OB.Book.cmpTxn);
    var out = list.map(function (t) {
      var head = t.splits.filter(function (s) { return bankIds[s.accountId] && (opts.mode === 'check' ? s.amount < 0 : s.amount > 0); });
      var amount = U.sum(head, function (s) { return Math.abs(s.amount); });
      var lines = t.splits.filter(function (s) { return head.indexOf(s) < 0; }).map(function (s) { return { accountId: s.accountId, contactId: s.contactId, memo: s.memo, amount: opts.mode === 'check' ? s.amount : -s.amount }; });
      return { t: t, accountId: head[0].accountId, amount: amount, lines: lines };
    });
    return { rows: out, total: U.sum(out, function (r) { return r.amount; }) };
  };

  /* ---------- Dashboard ---------- */
  /** Sales Tax Liability (accrual, by document date): per rate the taxable and non-taxable sales and the tax
   *  charged (credit memos subtract); per liability account the opening balance, tax collected, payments and
   *  adjustments, and the balance owed at the end of the period. */
  R.salesTaxLiability = function (book, opts) {
    var from = opts.from || '0000-01-01', to = opts.to || '9999-12-31', byRate = {}, order = [], none = null;
    book.posted().forEach(function (t) {
      var def = S.TXN_TYPES[t.type];
      if (!def.taxable || t.date < from || t.date > to) return;
      var sign = def.headSide === 'C' ? -1 : 1, lines = book.lineTotal(t.lines), taxable = t.taxId ? (t.taxableAmount || 0) : 0;
      var key = t.taxId || '', row = byRate[key];
      if (!row) {
        var tx = t.taxId ? book.salesTaxById(t.taxId) : null;
        row = byRate[key] = { taxId: key, name: tx ? tx.name : t.taxId ? '(deleted rate)' : 'No sales tax charged', agency: tx ? tx.agency || '' : '', rate: tx ? tx.rate : 0, accountId: tx ? tx.accountId : '', taxable: 0, nontaxable: 0, tax: 0, count: 0 };
        if (key) order.push(row); else none = row;
      }
      row.taxable += sign * taxable; row.nontaxable += sign * (lines - taxable); row.tax += sign * (t.tax || 0); row.count++;
    });
    var rows = order.sort(function (a, b) { return a.name.localeCompare(b.name); });
    if (none) rows.push(none);
    var accIds = {};
    (book.company.salesTaxes || []).forEach(function (x) { if (book.accById[x.accountId]) accIds[x.accountId] = 1; });
    rows.forEach(function (r) { if (r.accountId && book.accById[r.accountId]) accIds[r.accountId] = 1; });
    var accounts = Object.keys(accIds).map(function (id) {
      var collected = 0, paid = 0, other = 0, opening = -book.rawBalance(id, U.addDays(from, -1));
      (book.splitIndex()[id] || []).forEach(function (e) {
        if (e.t.date < from || e.t.date > to) return;
        var credit = -e.s.amount; // liability grows with credits
        if (S.TXN_TYPES[e.t.type].taxable && e.t.tax) collected += credit;
        else if (credit < 0) paid += -credit; else other += credit;
      });
      return { accountId: id, label: book.accountLabel(id), opening: opening, collected: collected, paid: paid, adjustments: other, balance: opening + collected - paid + other };
    }).sort(function (a, b) { return a.label.localeCompare(b.label); });
    return { from: from, to: to, rows: rows, accounts: accounts,
      totals: { taxable: U.sum(rows, function (r) { return r.taxable; }), nontaxable: U.sum(rows, function (r) { return r.nontaxable; }), tax: U.sum(rows, function (r) { return r.tax; }), balance: U.sum(accounts, function (a) { return a.balance; }) } };
  };

  R.dashboard = function (book, asOf) {
    asOf = asOf || U.today();
    var basis = book.company.basis;
    var fys = U.fiscalYearStart(asOf, book.company.fiscalYearStartMonth);
    var banks = book.sortedAccounts(function (a) { return (a.type === 'bank' || a.type === 'cc') && a.active; }).map(function (a) {
      return { account: a, balance: book.accountBalance(a.id), reconciled: book.reconciledBalance(a.id) };
    });
    var months = [];
    var start = U.monthStart(U.addMonths(asOf, -11));
    for (var k = 0; k < 12; k++) {
      var f = U.addMonths(start, k), t = U.monthEnd(f);
      var p = R.pnl(book, { from: f, to: t, basis: basis });
      months.push({ label: U.monthLabel(f).slice(0, 3), from: f, to: t, income: p.sections.income.totals[0] + p.sections.oi.totals[0], expense: p.sections.cogs.totals[0] + p.sections.expense.totals[0] + p.sections.oe.totals[0] });
    }
    var ytd = R.pnl(book, { from: fys, to: asOf, basis: basis });
    var overdueInv = book.posted().filter(function (t) { return t.type === 'invoice' && t.dueDate && t.dueDate < asOf && book.openBalance(t) > 0; });
    var overdueBills = book.posted().filter(function (t) { return t.type === 'bill' && t.dueDate && t.dueDate < asOf && book.openBalance(t) > 0; });
    return {
      banks: banks, months: months, fyStart: fys,
      ytdIncome: ytd.sections.income.totals[0] + ytd.sections.oi.totals[0],
      ytdExpense: ytd.sections.cogs.totals[0] + ytd.sections.expense.totals[0] + ytd.sections.oe.totals[0],
      ytdNet: ytd.netIncome[0],
      ar: book.accountBalance(book.sys('AR').id), ap: book.accountBalance(book.sys('AP').id),
      overdueInvoices: overdueInv, overdueInvoiceTotal: U.sum(overdueInv, function (t) { return book.openBalance(t); }),
      overdueBills: overdueBills, overdueBillTotal: U.sum(overdueBills, function (t) { return book.openBalance(t); })
    };
  };
  /**
   * The Business overview widgets (1.25): the last `days` days (default 30) ending asOf.
   * pnl { income, expense, net, prevNet, change (fraction vs the days before, 2 dp; null when there is none) },
   * expenses { total, rows: top 3 by amount then Other }, invoices { overdue, notDue: {count,total}, paid30, undeposited },
   * bills { open, dueSoon (due within 7 days, overdue included) }, banks [{ account, balance, bank, review }], toReview.
   * Amounts are integer cents.
   */
  R.home = function (book, asOf, opts) {
    asOf = asOf || U.today();
    var days = (opts && opts.days) || 30, basis = book.company.basis;
    // opts.from/to: the profit figures follow a chosen period (the dashboard uses the app's period); compared with as many days before it
    var to = opts && opts.to && opts.to < asOf ? opts.to : asOf;
    var from = opts && opts.from ? opts.from : U.addDays(asOf, -(days - 1));
    if (opts && opts.from) days = U.daysBetween(from, to) + 1;
    var pFrom = U.addDays(from, -days), pTo = U.addDays(from, -1), from30 = U.addDays(asOf, -29);
    var sum = function (p, keys) { return U.sum(keys, function (k) { return p.sections[k].totals[0]; }); };
    var cur = R.pnl(book, { from: from, to: to, basis: basis }), prev = R.pnl(book, { from: pFrom, to: pTo, basis: basis });
    var income = sum(cur, ['income', 'oi']), expense = sum(cur, ['cogs', 'expense', 'oe']), prevNet = prev.netIncome[0];
    var rows = [];
    ['cogs', 'expense', 'oe'].forEach(function (k) { cur.sections[k].rows.forEach(function (r) { if (r.values[0] > 0) rows.push({ accountId: r.accountId, label: book.accById[r.accountId].name, amount: r.values[0] }); }); });
    rows.sort(function (a, b) { return b.amount - a.amount || (a.label < b.label ? -1 : 1); });
    var top = rows.slice(0, 3), rest = U.sum(rows.slice(3), function (r) { return r.amount; });
    if (rest > 0) top.push({ accountId: '', label: 'Other', amount: rest });
    var posted = book.posted(), tally = function (list) { return { count: list.length, total: U.sum(list, function (t) { return book.openBalance(t); }) }; };
    var openInv = posted.filter(function (t) { return t.type === 'invoice' && book.openBalance(t) > 0; });
    var openBills = posted.filter(function (t) { return t.type === 'bill' && book.openBalance(t) > 0; });
    var soon = U.addDays(asOf, 7), undep = book.sys('UNDEP');
    var banks = book.sortedAccounts(function (a) { return (a.type === 'bank' || a.type === 'cc') && a.active; }).map(function (a) {
      return { account: a, balance: book.accountBalance(a.id), bank: book.bankBalance ? book.bankBalance(a.id) : null, review: book.bankLinesFor ? book.bankLinesFor(a.id, 'review').length : 0 };
    });
    return {
      from: from, to: to, days: days,
      pnl: { income: income, expense: expense, net: cur.netIncome[0], prevNet: prevNet, change: prevNet ? Math.round((cur.netIncome[0] - prevNet) / Math.abs(prevNet) * 100) / 100 : null },
      expenses: { total: expense, rows: top },
      invoices: {
        overdue: tally(openInv.filter(function (t) { return t.dueDate && t.dueDate < asOf; })),
        notDue: tally(openInv.filter(function (t) { return !(t.dueDate && t.dueDate < asOf); })),
        paid30: U.sum(posted.filter(function (t) { return t.type === 'payment' && t.date >= from30 && t.date <= asOf; }), function (t) { return t.total; }),
        undeposited: undep ? book.accountBalance(undep.id) : 0
      },
      bills: { open: tally(openBills), dueSoon: tally(openBills.filter(function (t) { return !t.dueDate || t.dueDate <= soon; })) },
      banks: banks, toReview: U.sum(banks, function (x) { return x.review; })
    };
  };
})(typeof window !== 'undefined' ? window : globalThis);
