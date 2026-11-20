/* VaultBook — sales tax by agency, Pay Sales Tax, and reports added in 1.18:
 * A/R Collections, Missing Checks, Voided/Changed Transactions, Cash Flow Forecast. */
(function (root) {
  'use strict';
  var OB = root.OB, U = OB.util, S = OB.schema, Book = OB.Book, R = OB.reports;
  function LedgerError(msg, field) { var e = new Error(msg); e.name = 'LedgerError'; e.field = field; return e; }

  /* ---------- sales tax by agency ---------- */
  /** Tax of a posted document split by agency (stored taxParts; older documents use their rate's agency). */
  Book.prototype.taxPartsOf = function (t) {
    if (!t.tax) return [];
    if (t.taxParts && t.taxParts.length) return t.taxParts;
    var tx = this.salesTaxById(t.taxId); return [{ agency: tx ? (tx.agency || tx.name) : '(unknown)', name: tx ? tx.name : '', rate: t.taxRate || 0, amount: t.tax }];
  };
  Book.prototype.taxAgencies = function () {
    var seen = {}, out = [];
    (this.company.salesTaxes || []).forEach(function (x) {
      (x.components && x.components.length ? x.components : [{ agency: x.agency || x.name }]).forEach(function (c) { if (!seen[c.agency]) { seen[c.agency] = 1; out.push({ agency: c.agency, accountId: x.accountId }); } });
    });
    return out;
  };
  /** Sales tax return per agency: taxable / exempt sales, tax collected and paid in the period, and what is owed at the end. */
  R.salesTaxByAgency = function (book, opts) {
    var from = opts.from || '0000-01-01', to = opts.to || '9999-12-31', by = {}, exempt = 0, cash = opts.basis === 'cash';
    // CPA-23 cash basis: an A/R document's tax counts as payments and credits are applied to it (like R.entries cash)
    var portions = function (t) {
      if (!cash || S.TXN_TYPES[t.type].head !== 'AR' || !t.total) return [{ date: t.date, f: 1 }];
      var out = [];
      (book.incoming[t.id] || []).forEach(function (x) { var s = book.txById[x.from]; if (s && s.status === 'posted') out.push({ date: book.appliedOn(s, t, x.date), f: x.amount / t.total }); });
      (t.applications || []).forEach(function (a) { var g = book.txById[a.txnId]; if (g && g.status === 'posted') out.push({ date: book.appliedOn(t, g, a.date), f: a.amount / t.total }); });
      return out;
    };
    var row = function (a) { return by[a] = by[a] || { agency: a, taxable: 0, collected: 0, paid: 0, before: 0, paidBefore: 0, due: 0 }; };
    book.taxAgencies().forEach(function (x) { row(x.agency); });
    book.posted().forEach(function (t) {
      var def = S.TXN_TYPES[t.type];
      if (def.taxable) {
        var sign = def.headSide === 'C' ? -1 : 1, c = book.contactById[t.contactId];
        var isEx = t.exempt !== undefined ? t.exempt : !!(c && c.taxExempt); // saved at posting (CPA-23); older documents use the customer
        portions(t).forEach(function (pt) {
          var f = pt.f, part = function (x) { return Math.round(x * f); };
          if (pt.date >= from && pt.date <= to && isEx) exempt += sign * part(book.lineTotal(t.lines));
          var counted = {}; // taxable sales count once per agency per document, even when it has several parts (state + county)
          book.taxPartsOf(t).forEach(function (p) {
            var r = row(p.agency);
            if (pt.date < from) r.before += sign * part(p.amount);
            else if (pt.date <= to) { r.collected += sign * part(p.amount); if (!counted[p.agency]) { counted[p.agency] = 1; r.taxable += sign * part(t.taxableAmount || 0); } }
          });
        });
      }
      (t.lines || []).forEach(function (l) {
        if (!l.taxAgency) return;
        var r = row(l.taxAgency), amt = S.TXN_TYPES[t.type].headSide === 'D' ? -l.amount : l.amount; // checks/expenses debit the liability
        if (t.type === 'journal') return;
        if (t.date < from) r.paidBefore += amt; else if (t.date <= to) r.paid += amt;
      });
      if (t.type === 'journal') (t.jlines || []).forEach(function (l) {
        if (!l.taxAgency) return; var r = row(l.taxAgency), amt = (l.debit || 0) - (l.credit || 0);
        if (t.date < from) r.paidBefore += amt; else if (t.date <= to) r.paid += amt;
      });
    });
    var rows = Object.keys(by).map(function (k) { var r = by[k]; r.opening = r.before - r.paidBefore; r.due = r.opening + r.collected - r.paid; return r; })
      .filter(function (r) { return r.opening || r.collected || r.paid || r.due || book.taxAgencies().some(function (x) { return x.agency === r.agency; }); })
      .sort(function (a, b) { return a.agency.localeCompare(b.agency); });
    return { from: from, to: to, basis: cash ? 'cash' : 'accrual', rows: rows, exemptSales: exempt, totals: { collected: U.sum(rows, function (r) { return r.collected; }), paid: U.sum(rows, function (r) { return r.paid; }), due: U.sum(rows, function (r) { return r.due; }) } };
  };
  /** Pay Sales Tax: one check per agency from a bank account, debiting the sales tax liability, tagged with the agency. */
  Book.prototype.paySalesTax = function (opts) {
    var self = this, items = (opts.items || []).filter(function (x) { return x.amount > 0; });
    if (!items.length) return Promise.reject(LedgerError('Choose the agencies to pay.'));
    var bank = this.accById[opts.accountId]; if (!bank || bank.type !== 'bank') return Promise.reject(LedgerError('Choose the bank account to pay from.', 'accountId'));
    var agencies = this.taxAgencies(), out = [];
    return items.reduce(function (p, it) {
      return p.then(function () {
        var v = self.contacts.find(function (c) { return c.kind === 'vendor' && c.name.toLowerCase() === it.agency.toLowerCase(); });
        return (v ? Promise.resolve(v) : self.saveContact({ kind: 'vendor', name: it.agency })).then(function (vendor) {
          var acc = (agencies.find(function (a) { return a.agency === it.agency; }) || {}).accountId || (self.sys('STAX') || {}).id;
          return self.saveTransaction({ type: 'check', date: opts.date, contactId: vendor.id, accountId: bank.id, toBePrinted: !!opts.toBePrinted, memo: 'Sales tax' + (opts.period ? ' — ' + opts.period : ''),
            lines: [{ accountId: acc, amount: it.amount, description: 'Sales tax payment' + (opts.period ? ' — ' + opts.period : ''), taxAgency: it.agency }] }).then(function (t) { out.push(t); });
        });
      });
    }, Promise.resolve()).then(function () { return out; });
  };

  /* ---------- A/R Collections ---------- */
  R.collections = function (book, opts) {
    var asOf = opts.asOf, by = {};
    book.posted().forEach(function (t) {
      if (t.type !== 'invoice' || !t.dueDate || t.dueDate >= asOf || t.date > asOf) return;
      var open = book.openBalance(t); if (open <= 0) return;
      var c = book.contactById[t.contactId] || {}, g = by[t.contactId] = by[t.contactId] || { contactId: t.contactId, name: book.contactLabel ? book.contactLabel(t.contactId) : c.name, phone: c.phone || '', email: c.email || '', contactName: c.contactName || '', rows: [], total: 0, oldest: 0 };
      var days = U.daysBetween(t.dueDate, asOf);
      g.rows.push({ t: t, open: open, days: days }); g.total += open; g.oldest = Math.max(g.oldest, days);
    });
    var groups = Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return b.oldest - a.oldest || a.name.localeCompare(b.name); });
    groups.forEach(function (g) { g.rows.sort(function (a, b) { return b.days - a.days; }); });
    return { asOf: asOf, groups: groups, total: U.sum(groups, function (g) { return g.total; }) };
  };

  /* ---------- Missing Checks ---------- */
  var CHECKS = { check: 1, billPayment: 1, expense: 1, customerRefund: 1 };
  R.missingChecks = function (book, opts) {
    var acc = opts.accountId, list = book.transactions.filter(function (t) { return CHECKS[t.type] && t.accountId === acc && /^\d+$/.test(String(t.number || '').trim()); })
      .map(function (t) { return { t: t, n: +t.number }; }).sort(function (a, b) { return a.n - b.n || (a.t.date < b.t.date ? -1 : 1); });
    var rows = [], gaps = 0, dups = 0;
    list.forEach(function (x, i) {
      var prev = list[i - 1];
      if (prev && x.n > prev.n + 1) { gaps++; rows.push({ gap: true, from: prev.n + 1, to: x.n - 1 }); }
      var dup = (prev && prev.n === x.n) || (list[i + 1] && list[i + 1].n === x.n);
      if (dup && !(prev && prev.n === x.n)) dups++;
      rows.push({ t: x.t, n: x.n, duplicate: !!dup, void: x.t.status === 'void' });
    });
    return { accountId: acc, rows: rows, gaps: gaps, duplicates: dups, count: list.length };
  };

  /* ---------- Voided / changed transactions (from the audit trail) ---------- */
  R.changedTransactions = function (book, opts) {
    var from = opts.from || '0000-01-01', to = opts.to || '9999-12-31';
    var rows = book.audit.filter(function (a) { var d = String(a.ts).slice(0, 10); return (a.action === 'void' || a.action === 'edit') && d >= from && d <= to; }).map(function (a) {
      var now = book.txById[a.txnId], before = a.before || {};
      return { ts: a.ts, action: a.action === 'void' ? 'Voided' : 'Changed', t: now || null, type: (now || before).type, number: (now || before).number || '', date: (now || before).date || '',
        before: before.total, after: now ? (now.status === 'void' ? 0 : now.total) : null, summary: a.summary, changes: a.action === 'edit' ? diff(before, now) : [] };
    }).sort(function (a, b) { return a.ts < b.ts ? 1 : -1; });
    return { from: from, to: to, rows: rows };
    function diff(b, n) {
      if (!n) return []; var out = [];
      if (b.date !== n.date) out.push('date ' + U.fmtDate(b.date) + ' → ' + U.fmtDate(n.date));
      if (b.total !== n.total) out.push('amount ' + U.fmt(b.total) + ' → ' + U.fmt(n.total));
      if ((b.contactId || '') !== (n.contactId || '')) out.push('name ' + ((book.contactById[b.contactId] || {}).name || '—') + ' → ' + ((book.contactById[n.contactId] || {}).name || '—'));
      if ((b.number || '') !== (n.number || '')) out.push('no. ' + (b.number || '—') + ' → ' + (n.number || '—'));
      if ((b.memo || '') !== (n.memo || '')) out.push('memo');
      if (U.stableStringify((b.splits || []).map(function (s) { return [s.accountId, s.amount]; })) !== U.stableStringify((n.splits || []).map(function (s) { return [s.accountId, s.amount]; }))) out.push('accounts / lines');
      return out;
    }
  };

  /* ---------- Cash Flow Forecast ---------- */
  /** Weekly forecast: bank balance today, plus open invoices, minus open bills, plus/minus recurring entries and payroll.
   *  1.50.2: built from the Calendar's events (OB.cal), so the report and the Calendar's daily balance always agree;
   *  planned pay dates and expected dates set in the Calendar count. Anything overdue falls in the first week. */
  R.cashForecast = function (book, opts) {
    var asOf = opts.asOf || U.today(), weeks = Math.max(1, Math.min(52, +opts.weeks || 12));
    var banks = book.accounts.filter(function (a) { return a.type === 'bank' && a.active !== false; });
    var start = U.sum(banks, function (a) { return book.accountBalance(a.id, asOf); });
    var cols = []; for (var w = 0; w < weeks; w++) cols.push({ from: U.addDays(asOf, w * 7 + 1), to: U.addDays(asOf, w * 7 + 7), receipts: 0, payments: 0, recurring: 0 });
    var put = function (date, key, amt) { var c = date <= asOf ? cols[0] : cols.find(function (x) { return date >= x.from && date <= x.to; }); if (c) c[key] += amt; };
    var overdueIn = 0, overdueOut = 0;
    OB.cal.events(book, { from: U.addDays(asOf, -3660), to: cols[cols.length - 1].to, today: asOf }).forEach(function (e) {
      if (!e.amount || e.done) return;
      if (e.kind === 'invoice') { put(e.date, 'receipts', e.amount); if (e.due <= asOf) overdueIn += e.amount; }
      else if (e.kind === 'bill') { put(e.date, 'payments', -e.amount); if (e.due <= asOf) overdueOut -= e.amount; }
      else if ((e.kind === 'recurring' || e.kind === 'payroll') && e.date > asOf) put(e.date, 'recurring', e.amount);
    });
    var bal = start;
    cols.forEach(function (c) { c.net = c.receipts - c.payments + c.recurring; c.start = bal; bal += c.net; c.end = bal; });
    return { asOf: asOf, start: start, weeks: cols, end: bal, overdueIn: overdueIn, overdueOut: overdueOut };
  };
})(typeof window !== 'undefined' ? window : globalThis);
