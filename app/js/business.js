/* VaultBook — business workflows built on the ledger (1.14): print-check numbering, bad-debt write-off,
 * finance charges, 1099 recipient data. Every posting goes through Book.saveTransaction (normalize → validate →
 * balanced splits), so these add no new accounting rules of their own. */
(function (root) {
  'use strict';
  var OB = root.OB, U = OB.util, S = OB.schema, Book = OB.Book, R = OB.reports;
  function LedgerError(msg, field) { var e = new Error(msg); e.name = 'LedgerError'; e.field = field; return e; }

  /* ---------- amounts in words (checks) ---------- */
  var ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  var TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  function words999(n) {
    var out = [];
    if (n >= 100) { out.push(ONES[Math.floor(n / 100)] + ' hundred'); n %= 100; }
    if (n >= 20) { out.push(TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : '')); } else if (n) out.push(ONES[n]);
    return out.join(' ');
  }
  /** 123456 cents -> "One thousand two hundred thirty-four and 56/100" */
  U.amountWords = function (cents) {
    cents = Math.abs(Math.round(cents)); var d = Math.floor(cents / 100), c = cents % 100, parts = [];
    [[1e12, 'trillion'], [1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand'], [1, '']].forEach(function (u) {
      var q = Math.floor(d / u[0]); if (q) { parts.push(words999(q) + (u[1] ? ' ' + u[1] : '')); d -= q * u[0]; }
    });
    var w = parts.length ? parts.join(' ') : 'zero';
    return w.charAt(0).toUpperCase() + w.slice(1) + ' and ' + (c < 10 ? '0' : '') + c + '/100';
  };

  /** Find an account by system code or name pattern, or create it (one atomic save). */
  Book.prototype.ensureAccount = function (code, re, number, name, type) {
    var a = this.accounts.find(function (x) { return x.system === code; }) || this.accounts.find(function (x) { return x.type === type && re.test(x.name); });
    if (a) return Promise.resolve(a);
    var self = this, num = number;
    while (this.accounts.some(function (x) { return x.number === String(num); })) num++;
    return this.saveAccount({ number: String(num), name: name, type: type }).then(function (acc) { return self.accById[acc.id] || acc; });
  };

  /* ---------- checks to print ---------- */
  Book.PRINTABLE_CHECK = { check: 1, billPayment: 1, expense: 1 };
  Book.prototype.checksToPrint = function () {
    var self = this;
    return this.transactions.filter(function (t) {
      var a = self.accById[t.accountId];
      return t.status === 'posted' && t.toBePrinted && Book.PRINTABLE_CHECK[t.type] && a && a.type === 'bank';
    }).sort(Book.cmpTxn);
  };
  /** Give printed checks their numbers (first, first+1, …) and clear "to be printed". Ledger amounts do not change. */
  Book.prototype.setChecksPrinted = function (ids, first) {
    var self = this, n = parseInt(first, 10);
    if (!(n > 0)) return Promise.reject(LedgerError('Enter the number of the first check.', 'first'));
    if (!ids || !ids.length) return Promise.reject(LedgerError('Choose the checks to print.'));
    var now = new Date().toISOString(), ops = [], updated = [], used = {};
    for (var i = 0; i < ids.length; i++) {
      var t = this.txById[ids[i]], acc = t && this.accById[t.accountId];
      if (!t || t.status !== 'posted' || !Book.PRINTABLE_CHECK[t.type] || !acc || acc.type !== 'bank') return Promise.reject(LedgerError('Only posted checks, bill payments and expenses from a bank account can be printed.'));
      if (this.company.closingDate && t.date <= this.company.closingDate) return Promise.reject(LedgerError('A check dated in a closed period cannot be renumbered.'));
      var num = String(n + i);
      var clash = this.transactions.find(function (x) { return x.id !== t.id && x.status === 'posted' && x.accountId === t.accountId && x.number === num && Book.PRINTABLE_CHECK[x.type] && ids.indexOf(x.id) < 0; });
      if (clash) return Promise.reject(LedgerError('Check number ' + num + ' is already used on ' + U.fmtDate(clash.date) + '. Start from another number.', 'first'));
      if (used[num]) return Promise.reject(LedgerError('Duplicate check number.')); used[num] = 1;
      var c = U.clone(t); c.number = num; delete c.toBePrinted; c.printedAt = now; c.updatedAt = now; c.version = (c.version || 1) + 1;
      ops.push({ store: 'transactions', value: c }); updated.push(c);
    }
    var co = U.clone(this.company); co.counters.check = Math.max(co.counters.check || 0, n + ids.length);
    var audit = this._auditEntry('print-checks', null, 'Printed ' + ids.length + ' check(s), numbers ' + n + '–' + (n + ids.length - 1));
    ops.push({ store: 'company', value: co }, { store: 'audit', value: audit });
    return this._commit(ops, function () {
      updated.forEach(function (c) { self.transactions[self.transactions.indexOf(self.txById[c.id])] = c; });
      self.company = co; self.audit.push(audit);
    }).then(function () { return updated; });
  };

  /* ---------- bad debt write-off ---------- */
  /** Write off what is still open on an invoice: a credit memo to Bad Debt expense, applied to the invoice. */
  Book.prototype.writeOffInvoice = function (invoiceId, opts) {
    opts = opts || {};
    var self = this, inv = this.txById[invoiceId];
    if (!inv || inv.type !== 'invoice' || inv.status !== 'posted') return Promise.reject(LedgerError('Choose a posted invoice to write off.'));
    var open = this.openBalance(inv);
    if (!(open > 0)) return Promise.reject(LedgerError('This invoice has nothing left to write off.'));
    var date = opts.date || U.today();
    if (date < inv.date) return Promise.reject(LedgerError('The write-off date cannot be before the invoice date.', 'date'));
    var pick = opts.accountId && this.accById[opts.accountId] ? Promise.resolve(this.accById[opts.accountId]) : this.ensureAccount('BADDEBT', /bad\s*debt/i, 6070, 'Bad Debt', 'expense');
    return pick.then(function (acc) {
      var label = 'Bad debt — invoice ' + (inv.number || U.fmtDate(inv.date)), lines = [{ accountId: acc.id, description: label, amount: open }], tax = {};
      // CPA-09: the tax part of what is open reverses the sales tax liability (at the invoice's rate) instead of
      // being expensed. reverseTax: false keeps the whole balance in Bad Debt (states that don't allow the deduction).
      if (opts.reverseTax !== false && inv.tax && inv.taxId && self.salesTaxById(inv.taxId)) {
        var T = Math.round((inv.taxableAmount || 0) * open / inv.total), t0 = OB.Book.taxOn(T, inv.taxRate), N = open - T - t0;
        lines = [{ accountId: acc.id, description: label + ' (taxable part)', amount: T, taxable: true }];
        if (N) lines.push({ accountId: acc.id, description: label, amount: N });
        tax = { taxId: inv.taxId, fromInvoiceId: inv.id };
      }
      return self.saveTransaction(Object.assign({ type: 'creditMemo', date: date, contactId: inv.contactId, writeOffOf: inv.id, memo: opts.memo || ('Bad debt write-off of invoice ' + (inv.number || '')),
        lines: lines, applications: [{ txnId: inv.id, amount: open }], message: '' }, tax));
    });
  };

  /* ---------- finance charges ---------- */
  /** opts: { asOf, apr (percent), minCharge (cents), graceDays, onFinanceCharges }. Charge = open balance × APR × days overdue / 365, per invoice. */
  Book.prototype.financeChargePreview = function (opts) {
    var self = this, asOf = opts.asOf || U.today(), apr = +opts.apr || 0, min = opts.minCharge || 0, grace = Math.max(0, +opts.graceDays || 0), by = {};
    var charged = this.financeChargedThrough();
    this.posted().forEach(function (t) {
      if (t.type !== 'invoice' || !t.dueDate || (t.financeCharge && !opts.onFinanceCharges) || t.date > asOf) return;
      if (U.daysBetween(t.dueDate, asOf) <= grace) return;
      // CPA-01: count only days after the last assessment that charged this invoice (voided assessments don't count)
      var from = charged[t.id] && charged[t.id] > t.dueDate ? charged[t.id] : t.dueDate, days = U.daysBetween(from, asOf);
      if (days <= 0) return;
      var open = self.openBalanceAsOf(t, asOf); if (open <= 0) return;
      var row = by[t.contactId] = by[t.contactId] || { contactId: t.contactId, name: (self.contactById[t.contactId] || {}).name || '', overdue: 0, raw: 0, invoices: [] };
      var ch = open * (apr / 100) * days / 365;
      row.overdue += open; row.raw += ch; row.invoices.push({ id: t.id, number: t.number, dueDate: t.dueDate, from: from, days: days, open: open, charge: Math.round(ch) });
    });
    return Object.keys(by).map(function (k) { var r = by[k]; r.charge = Math.max(Math.round(r.raw), r.raw > 0 ? min : 0); delete r.raw; return r; })
      .filter(function (r) { return r.charge > 0; }).sort(function (a, b) { return a.name.localeCompare(b.name); });
  };
  /** invoice id → last date it was charged through, from posted (not voided) finance-charge invoices (CPA-01). */
  Book.prototype.financeChargedThrough = function () {
    var out = {};
    this.posted().forEach(function (t) { (t.financeCharge && t.financeChargeOf || []).forEach(function (x) { if (!out[x.txnId] || x.to > out[x.txnId]) out[x.txnId] = x.to; }); });
    return out;
  };
  /** Post one finance-charge invoice per chosen customer. Resolves the invoices. */
  Book.prototype.assessFinanceCharges = function (rows, opts) {
    var self = this, asOf = opts.asOf || U.today();
    if (!rows || !rows.length) return Promise.reject(LedgerError('Choose the customers to charge.'));
    var pick = opts.accountId && this.accById[opts.accountId] ? Promise.resolve(this.accById[opts.accountId]) : this.ensureAccount('FINCHG', /finance\s*charge/i, 7100, 'Finance Charge Income', 'oi');
    return pick.then(function (acc) {
      var out = [];
      return rows.reduce(function (p, r) {
        return p.then(function () {
          return self.saveTransaction({ type: 'invoice', date: asOf, dueDate: asOf, terms: 0, contactId: r.contactId, financeCharge: true, memo: 'Finance charge',
            financeChargeOf: (r.invoices || []).map(function (x) { return { txnId: x.id, from: x.from || x.dueDate, to: asOf, open: x.open, charge: x.charge }; }),
            message: '', lines: [{ accountId: acc.id, description: 'Finance charge on overdue balance of ' + U.fmt(r.overdue, { symbol: true }) + ' as of ' + U.fmtDate(asOf), amount: r.charge }] }).then(function (t) { out.push(t); });
        });
      }, Promise.resolve()).then(function () { return out; });
    });
  };

  /* ---------- 1099 recipients (1.14) ---------- */
  /** Split a free-text US address ("1 Main St\nSuite 4\nTucson, AZ 85701") into lines, city, state and ZIP. */
  U.parseUSAddress = function (text) {
    var lines = String(text || '').split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean), out = { line1: '', line2: '', city: '', state: '', zip: '' };
    if (!lines.length) return out;
    var m = lines[lines.length - 1].match(/^(.*?)[,\s]+([A-Za-z]{2})\.?\s+(\d{5}(?:-\d{4})?)$/);
    if (m) { out.city = m[1].replace(/,$/, '').trim(); out.state = m[2].toUpperCase(); out.zip = m[3]; lines = lines.slice(0, -1); }
    out.line1 = lines[0] || ''; out.line2 = lines.slice(1).join(', ');
    return out;
  };
  /** TIN type from its shape: 12-3456789 is an EIN, 123-45-6789 an SSN; plain 9 digits stays unknown. */
  U.tinType = function (tin) { var s = String(tin || '').trim(); return /^\d{2}-\d{7}$/.test(s) ? 'EIN' : /^\d{3}-\d{2}-\d{4}$/.test(s) ? 'SSN' : ''; };
  /** One row per vendor over the filing threshold, with what each box of 1099-NEC / 1099-MISC needs. */
  R.recipients1099 = function (book, year) {
    var rep = R.report1099(book, { year: year, threshold: 'meets' }), co = book.company;
    return rep.rows.map(function (r) {
      var c = book.contactById[r.contactId] || {}, a = U.parseUSAddress(c.address);
      var box = function (id) { return (r.boxes[id] || 0) >= S.threshold1099(id, year) ? r.boxes[id] : 0; };
      var problems = [];
      if (!String(c.taxId || '').trim()) problems.push('No tax ID');
      if (!c.w9OnFile) problems.push('No W-9 on file');
      if (!a.line1 || !a.city || !a.state || !a.zip) problems.push('Address needs street, city, state and ZIP');
      return { contactId: r.contactId, name: c.company || c.name || r.name, tin: c.taxId || '', tinType: U.tinType(c.taxId), address: a, email: c.email || '',
        nec1: box('NEC1'), misc1: box('MISC1'), misc2: box('MISC2'), misc3: box('MISC3'), misc6: box('MISC6'), misc10: box('MISC10'), w9: !!c.w9OnFile, problems: problems };
    }).filter(function (x) { return x.nec1 || x.misc1 || x.misc2 || x.misc3 || x.misc6 || x.misc10; });
  };
  /** 1096-style totals: number of forms and total reported, per form. */
  R.totals1096 = function (rows) {
    var nec = rows.filter(function (r) { return r.nec1; }), misc = rows.filter(function (r) { return r.misc1 || r.misc2 || r.misc3 || r.misc6 || r.misc10; });
    return { nec: { forms: nec.length, total: U.sum(nec, function (r) { return r.nec1; }) },
      misc: { forms: misc.length, total: U.sum(misc, function (r) { return r.misc1 + r.misc2 + r.misc3 + r.misc6 + r.misc10; }) } };
  };
  /** CSV of 1099 data with plain column names, to copy into the IRS IRIS template (the IRS only accepts its own template file). */
  R.csv1099 = function (book, year) {
    var co = book.company, ca = U.parseUSAddress(co.address), rows = R.recipients1099(book, year);
    var q = function (v) { v = String(v === undefined || v === null ? '' : v); return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var money = function (c) { return c ? (c / 100).toFixed(2) : ''; };
    var head = ['Tax year', 'Form', 'Payer name', 'Payer EIN', 'Payer address', 'Payer city', 'Payer state', 'Payer ZIP', 'Payer phone',
      'Recipient TIN type', 'Recipient TIN', 'Recipient name', 'Recipient address line 1', 'Recipient address line 2', 'Recipient city', 'Recipient state', 'Recipient ZIP', 'Recipient email',
      'NEC box 1 Nonemployee compensation', 'MISC box 1 Rents', 'MISC box 2 Royalties', 'MISC box 3 Other income', 'MISC box 6 Medical and health care payments', 'MISC box 10 Gross proceeds paid to an attorney', 'Notes'];
    var out = [head.map(q).join(',')];
    rows.forEach(function (r) {
      var forms = []; if (r.nec1) forms.push('1099-NEC'); if (r.misc1 || r.misc2 || r.misc3 || r.misc6 || r.misc10) forms.push('1099-MISC');
      forms.forEach(function (f) {
        var nec = f === '1099-NEC';
        out.push([year, f, co.legalName || co.name, co.ein, [ca.line1, ca.line2].filter(Boolean).join(', '), ca.city, ca.state, ca.zip, co.phone,
          r.tinType, r.tin, r.name, r.address.line1, r.address.line2, r.address.city, r.address.state, r.address.zip, r.email,
          nec ? money(r.nec1) : '', nec ? '' : money(r.misc1), nec ? '' : money(r.misc2), nec ? '' : money(r.misc3), nec ? '' : money(r.misc6), nec ? '' : money(r.misc10), r.problems.join('; ')].map(q).join(','));
      });
    });
    return out.join('\r\n') + '\r\n';
  };

  // serialize the new writes through the book's queue (see ledger.js)
  /* ---------- CPA-13: early-payment discounts ---------- */
  /** The early-payment discount still available on an invoice or bill if paid on payDate: { amount, lastDay } (amount 0 when none). */
  Book.prototype.discountAvailable = function (docId, payDate) {
    var t = this.txById[docId];
    if (!t || t.status !== 'posted' || !(t.discountPct > 0)) return { amount: 0, lastDay: '' };
    var last = U.addDays(t.date, t.discountDays || 0), open = this.openBalance(t);
    return { amount: payDate && payDate <= last ? Math.min(open, Math.round(t.total * t.discountPct / 100)) : 0, lastDay: last, pct: t.discountPct };
  };
  /** Post a payment (or bill payment) together with the discount credits it takes, in one atomic write.
   *  discounts: [{ txnId, amount? }] — amount defaults to the discount available on the payment date. */
  Book.prototype.receiveWithDiscount = function (payDraft, discounts) {
    var self = this, cust = payDraft.type === 'payment', disc;
    if (!cust && payDraft.type !== 'billPayment') return Promise.reject(LedgerError('Discounts are taken on a customer payment or a bill payment.'));
    return (cust ? this.ensureAccount('SALESDISC', /sales discount/i, 4950, 'Sales Discounts', 'income') : this.ensureAccount('PURCHDISC', /purchase discount/i, 5950, 'Purchase Discounts', 'cogs'))
      .then(function (a) {
        disc = a;
        var credits = (discounts || []).map(function (x) {
          var t = self.txById[x.txnId], avail = self.discountAvailable(x.txnId, payDraft.date);
          if (!t || t.contactId !== payDraft.contactId) throw LedgerError('The discounted document is not for this ' + (cust ? 'customer.' : 'vendor.'));
          if (!avail.amount) throw LedgerError(S.TXN_TYPES[t.type].label + ' ' + (t.number || '') + ' has no early-payment discount on ' + U.fmtDate(payDraft.date) + (avail.lastDay ? ' (it ended ' + U.fmtDate(avail.lastDay) + ')' : '') + ', or nothing is open.');
          var amt = x.amount === undefined || x.amount === '' ? avail.amount : (typeof x.amount === 'number' ? x.amount : U.toCents(x.amount));
          if (!(amt > 0) || amt > self.openBalance(t)) throw LedgerError('The discount on ' + S.TXN_TYPES[t.type].label + ' ' + (t.number || '') + ' must be more than $0 and no more than its open balance.');
          return { type: cust ? 'creditMemo' : 'vendorCredit', date: payDraft.date, contactId: payDraft.contactId, discountOf: t.id, memo: 'Early-payment discount ' + t.discountPct + '% — ' + S.TXN_TYPES[t.type].label + ' ' + (t.number || ''),
            lines: [{ accountId: disc.id, amount: amt, description: 'Early-payment discount', taxable: false }], applications: [{ txnId: t.id, amount: amt }] };
        });
        return self.saveTransactions(credits.concat([payDraft]));
      })
      .then(function (done) { return { payment: done[done.length - 1], credits: done.slice(0, -1) }; });
  };

  /* ---------- CPA-13: bounced (returned) customer payment ---------- */
  /** The original payment stays as it is. One atomic write posts a charge to the customer (an invoice that credits the bank
   *  the payment landed in, plus an optional returned-check fee) and, when the bank charged a fee, an expense for it. */
  Book.prototype.recordBouncedPayment = function (paymentId, opts) {
    var self = this, p = this.txById[paymentId]; opts = opts || {};
    if (!p || p.type !== 'payment' || p.status !== 'posted') return Promise.reject(LedgerError('Choose a posted customer payment.'));
    if (this.transactions.some(function (t) { return t.status === 'posted' && t.bounceOf === paymentId; })) return Promise.reject(LedgerError('This payment is already recorded as bounced.'));
    if (!U.isDate(opts.date) || opts.date < p.date) return Promise.reject(LedgerError('Enter the date the bank returned the payment (not before the payment).', 'date'));
    var cents = function (v) { return v === undefined || v === '' || v === null ? 0 : typeof v === 'number' ? v : U.toCents(v); };
    var bankFee = cents(opts.bankFee), custFee = cents(opts.customerFee);
    if (bankFee < 0 || custFee < 0) return Promise.reject(LedgerError('Fees cannot be negative.'));
    // the bank account the money actually went to: the deposit's bank if it went through Undeposited Funds
    var dep = this.depositedBy[p.id] ? this.txById[this.depositedBy[p.id]] : null, bank = dep && dep.status === 'posted' ? dep.accountId : p.accountId;
    var feeInc, feeExp, label = 'Returned payment' + (p.number ? ' ' + p.number : '') + (p.reference ? ' (' + p.reference + ')' : '');
    return (custFee ? this.ensureAccount('RETCHK', /returned check/i, 7200, 'Returned Check Charges', 'oi') : Promise.resolve(null))
      .then(function (a) { feeInc = opts.feeIncomeAccountId ? self.accById[opts.feeIncomeAccountId] : a; return bankFee && !opts.bankFeeAccountId ? self.ensureAccount('BANKFEE', /bank.*(charge|fee)/i, 6050, 'Bank Charges & Fees', 'expense') : null; })
      .then(function (a) {
        feeExp = opts.bankFeeAccountId ? self.accById[opts.bankFeeAccountId] : a;
        var lines = [{ accountId: bank, amount: p.amount, description: label, taxable: false }];
        if (custFee) lines.push({ accountId: feeInc.id, amount: custFee, description: 'Returned check fee', taxable: false });
        var drafts = [{ type: 'invoice', date: opts.date, dueDate: opts.date, terms: 0, contactId: p.contactId, bounceOf: p.id, memo: label, lines: lines }];
        if (bankFee) drafts.push({ type: 'expense', date: opts.date, accountId: bank, memo: 'Bank fee — ' + label, lines: [{ accountId: feeExp.id, amount: bankFee, description: 'Returned item fee' }] });
        return self.saveTransactions(drafts);
      })
      .then(function (done) { return { charge: done[0], bankFee: done[1] || null }; });
  };

  ['setChecksPrinted'].forEach(function (name) { // (ensureAccount is not queued: it calls the queued saveAccount)
    var raw = Book.prototype[name];
    Book.prototype['_raw_' + name] = raw;
    Book.prototype[name] = function () { var self = this, args = arguments, p = this._queue.then(function () { return raw.apply(self, args); }); this._queue = p.catch(function () {}); return p; };
  });
})(typeof window !== 'undefined' ? window : globalThis);
