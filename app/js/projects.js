/* VaultBook — attachments, Customer:Job, billable expenses and income-tax line mapping (1.16). */
(function (root) {
  'use strict';
  var OB = root.OB, U = OB.util, S = OB.schema, Book = OB.Book, R = OB.reports;
  function LedgerError(msg, field) { var e = new Error(msg); e.name = 'LedgerError'; e.field = field; return e; }

  /* ---------- attachments ---------- */
  Book.ATTACH_MAX = 4 * 1024 * 1024; // bytes per file (kept in the company's books and backups)
  /** Attach a file (data URL) to a transaction, contact or fixed asset. */
  Book.prototype.addAttachment = function (input) {
    var self = this, owner = input.ownerId && (this.txById[input.ownerId] || this.contactById[input.ownerId] || this.fixedAssetById(input.ownerId));
    if (!owner) return Promise.reject(LedgerError('Save the transaction before attaching files.'));
    var m = String(input.dataUrl || '').match(/^data:([\w.+\/-]+)?(;base64)?,/);
    if (!m) return Promise.reject(LedgerError('That file could not be read.'));
    var body = input.dataUrl.slice(m[0].length), pad = /==$/.test(body) ? 2 : /=$/.test(body) ? 1 : 0;
    var bytes = m[2] ? Math.floor(body.length * 3 / 4) - pad : decodeURIComponent(body).length;
    if (bytes > Book.ATTACH_MAX) return Promise.reject(LedgerError('Files can be up to 4 MB. Scan receipts at a lower resolution or as PDF.'));
    var name = String(input.name || 'file').slice(0, 200);
    var a = { id: U.uid('att'), ownerId: input.ownerId, name: name, type: m[1] || 'application/octet-stream', size: bytes, data: input.dataUrl, addedAt: new Date().toISOString() };
    var audit = this._auditEntry('attach', this.txById[input.ownerId] ? input.ownerId : null, 'Attached ' + name + ' (' + Math.round(bytes / 1024) + ' KB)');
    return this._commit([{ store: 'attachments', value: a }, { store: 'audit', value: audit }], function () { self.attachments.push(a); self.audit.push(audit); }).then(function () { return a; });
  };
  /** Remove an attachment: the file content is erased; a tombstone and the audit entry stay. */
  Book.prototype.removeAttachment = function (id) {
    var self = this, prior = this.attachments.find(function (x) { return x.id === id; });
    if (!prior || prior.deleted) return Promise.reject(LedgerError('Attachment not found.'));
    var a = U.clone(prior); a.deleted = new Date().toISOString(); a.data = '';
    var audit = this._auditEntry('detach', this.txById[a.ownerId] ? a.ownerId : null, 'Removed attachment ' + a.name);
    return this._commit([{ store: 'attachments', value: a }, { store: 'audit', value: audit }], function () { self.attachments[self.attachments.indexOf(prior)] = a; self.audit.push(audit); }).then(function () { return a; });
  };
  Book.prototype.attachmentsFor = function (ownerId) { return this.attachments.filter(function (a) { return a.ownerId === ownerId && !a.deleted; }); };

  /* ---------- Customer:Job ---------- */
  /** "Customer:Job:Sub-job" for jobs, the plain name otherwise. */
  Book.prototype.contactLabel = function (id) {
    var c = this.contactById[id], parts = [], g = 0;
    while (c && g++ < 20) { parts.unshift(c.name); c = c.parentId ? this.contactById[c.parentId] : null; }
    return parts.join(':');
  };
  Book.prototype.jobsOf = function (customerId) { return this.contacts.filter(function (c) { return c.parentId === customerId; }); };

  /* ---------- billable expenses ---------- */
  /** Billable purchase lines not yet billed on a posted invoice: [{ key, t, index, line, customerId, amount }]. */
  Book.prototype.unbilledCosts = function (customerId, ignoreInvoice) {
    var self = this, billed = {};
    this.transactions.forEach(function (t) { if (t.type === 'invoice' && t.status === 'posted' && t.id !== ignoreInvoice) (t.lines || []).forEach(function (l) { if (l.billOf) billed[l.billOf] = t.id; }); });
    var out = [];
    this.transactions.filter(function (t) { return t.status === 'posted' && Book.BILLABLE[t.type]; }).sort(Book.cmpTxn).forEach(function (t) {
      (t.lines || []).forEach(function (l, i) {
        if (!l.billable || !l.contactId) return;
        if (customerId && l.contactId !== customerId) return;
        var key = t.id + ':' + i; if (billed[key]) return;
        out.push({ key: key, t: t, index: i, line: l, customerId: l.contactId, amount: l.amount });
      });
    });
    return out;
  };
  Book.prototype.billedBy = function (key) {
    var hit = this.transactions.find(function (t) { return t.type === 'invoice' && t.status === 'posted' && (t.lines || []).some(function (l) { return l.billOf === key; }); });
    return hit || null;
  };
  Book.prototype._validateBillable = function (t, prior, err) {
    var self = this;
    if (Book.BILLABLE[t.type]) (t.lines || []).forEach(function (l, i) {
      if (!l.billable) return;
      var c = self.contactById[l.contactId];
      if (!c || c.kind !== 'customer') err('Line ' + (i + 1) + ': choose the customer (or job) to bill this cost to.', 'lines.' + i);
      if (prior && prior.lines && prior.lines[i] && prior.lines[i].billable) {
        var by = self.billedBy(prior.id + ':' + i);
        if (by && (l.amount !== prior.lines[i].amount || l.contactId !== prior.lines[i].contactId)) err('Line ' + (i + 1) + ' is already billed on invoice ' + (by.number || '') + '; its amount and customer cannot change.', 'lines.' + i);
      }
    });
    if (prior && Book.BILLABLE[prior.type]) (prior.lines || []).forEach(function (pl, i) {
      if (!pl.billable) return;
      var by = self.billedBy(prior.id + ':' + i), now = (t.lines || [])[i];
      if (by && (!now || !now.billable)) err('Line ' + (i + 1) + ' is billed on invoice ' + (by.number || '') + '. Remove it from that invoice first.', 'lines.' + i);
    });
    if (t.type !== 'invoice') return;
    var seen = {};
    (t.lines || []).forEach(function (l, i) {
      if (!l.billOf) return;
      var p = l.billOf.split(':'), src = self.txById[p[0]], sl = src && src.lines && src.lines[+p[1]];
      if (!src || src.status !== 'posted' || !sl || !sl.billable) { err('Line ' + (i + 1) + ': the billable cost no longer exists.', 'lines.' + i); return; }
      if (seen[l.billOf]) err('Line ' + (i + 1) + ': the same cost is billed twice.', 'lines.' + i); seen[l.billOf] = 1;
      var by = self.billedBy(l.billOf);
      if (by && by.id !== t.id) err('Line ' + (i + 1) + ': this cost is already billed on invoice ' + (by.number || '') + '.', 'lines.' + i);
      var cust = self.contactById[sl.contactId];
      if (sl.contactId !== t.contactId && !(cust && cust.parentId === t.contactId)) err('Line ' + (i + 1) + ': this cost belongs to ' + self.contactLabel(sl.contactId) + '.', 'lines.' + i);
    });
  };
  /** Void guard: a billable cost that was billed cannot be voided while the invoice stands. */
  var pubVoid = Book.prototype.voidTransaction;
  Book.prototype.voidTransaction = function (id, reason) {
    var self = this, t = this.txById[id];
    if (t && Book.BILLABLE[t.type]) {
      var hit = (t.lines || []).map(function (l, i) { return l.billable ? self.billedBy(id + ':' + i) : null; }).filter(Boolean)[0];
      if (hit) return Promise.reject(LedgerError('A cost on this transaction is billed on invoice ' + (hit.number || '') + '. Void or edit that invoice first.'));
    }
    return pubVoid.apply(this, arguments);
  };
  /** Unbilled Costs by Job report. */
  R.unbilledCosts = function (book, opts) {
    var rows = book.unbilledCosts().filter(function (x) { return !opts.asOf || x.t.date <= opts.asOf; });
    var by = {};
    rows.forEach(function (x) { (by[x.customerId] = by[x.customerId] || { customerId: x.customerId, name: book.contactLabel(x.customerId), rows: [], total: 0 }); by[x.customerId].rows.push(x); by[x.customerId].total += x.amount; });
    var groups = Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return a.name.localeCompare(b.name); });
    return { groups: groups, total: U.sum(groups, function (g) { return g.total; }) };
  };

  /* ---------- income tax lines ---------- */
  // Line numbers follow the 2025 forms; check them against the year's form before filing.
  Book.TAX_FORMS = {
    '1040C': { label: 'Schedule C (Form 1040) — sole proprietor / single-member LLC', lines: [
      ['C1', '1 Gross receipts or sales'], ['C2', '2 Returns and allowances'], ['C4', '4 Cost of goods sold'], ['C6', '6 Other income'],
      ['C8', '8 Advertising'], ['C9', '9 Car and truck expenses'], ['C10', '10 Commissions and fees'], ['C11', '11 Contract labor'], ['C12', '12 Depletion'], ['C13', '13 Depreciation and section 179'],
      ['C14', '14 Employee benefit programs'], ['C15', '15 Insurance (other than health)'], ['C16a', '16a Interest — mortgage'], ['C16b', '16b Interest — other'], ['C17', '17 Legal and professional services'],
      ['C18', '18 Office expense'], ['C19', '19 Pension and profit-sharing plans'], ['C20a', '20a Rent — vehicles, machinery, equipment'], ['C20b', '20b Rent — other business property'], ['C21', '21 Repairs and maintenance'],
      ['C22', '22 Supplies'], ['C23', '23 Taxes and licenses'], ['C24a', '24a Travel'], ['C24b', '24b Deductible meals'], ['C25', '25 Utilities'], ['C26', '26 Wages'], ['C27a', '27a Other expenses (Part V)'], ['NDED', 'Not deductible']] },
    '1120S': { label: 'Form 1120-S — S corporation', lines: [
      ['S1a', '1a Gross receipts or sales'], ['S1b', '1b Returns and allowances'], ['S2', '2 Cost of goods sold'], ['S5', '5 Other income'], ['S7', '7 Compensation of officers'], ['S8', '8 Salaries and wages'],
      ['S9', '9 Repairs and maintenance'], ['S10', '10 Bad debts'], ['S11', '11 Rents'], ['S12', '12 Taxes and licenses'], ['S13', '13 Interest'], ['S14', '14 Depreciation'], ['S15', '15 Depletion'], ['S16', '16 Advertising'],
      ['S17', '17 Pension, profit-sharing, etc.'], ['S18', '18 Employee benefit programs'], ['S20', 'Other deductions (attach statement)'], ['NDED', 'Not deductible (M-1)']] },
    '1065': { label: 'Form 1065 — partnership / multi-member LLC', lines: [
      ['P1a', '1a Gross receipts or sales'], ['P1b', '1b Returns and allowances'], ['P2', '2 Cost of goods sold'], ['P7', '7 Other income'], ['P9', '9 Salaries and wages'], ['P10', '10 Guaranteed payments to partners'],
      ['P11', '11 Repairs and maintenance'], ['P12', '12 Bad debts'], ['P13', '13 Rent'], ['P14', '14 Taxes and licenses'], ['P15', '15 Interest'], ['P16', '16 Depreciation'], ['P17', '17 Depletion'],
      ['P18', '18 Retirement plans, etc.'], ['P19', '19 Employee benefit programs'], ['P21', 'Other deductions (attach statement)'], ['NDED', 'Not deductible (M-1)']] },
    '1120': { label: 'Form 1120 — C corporation', lines: [
      ['K1a', '1a Gross receipts or sales'], ['K1b', '1b Returns and allowances'], ['K2', '2 Cost of goods sold'], ['K5', '5 Interest income'], ['K10', '10 Other income'], ['K12', '12 Compensation of officers'], ['K13', '13 Salaries and wages'],
      ['K14', '14 Repairs and maintenance'], ['K15', '15 Bad debts'], ['K16', '16 Rents'], ['K17', '17 Taxes and licenses'], ['K18', '18 Interest'], ['K19', '19 Charitable contributions'], ['K20', '20 Depreciation'],
      ['K22', '22 Advertising'], ['K23', '23 Pension, profit-sharing, etc.'], ['K24', '24 Employee benefit programs'], ['K26', 'Other deductions (attach statement)'], ['NDED', 'Not deductible (M-1)']] }
  };
  /** Suggest a tax line for an account from its type and name. */
  Book.suggestTaxLine = function (form, a) {
    var n = a.name.toLowerCase(), F = { '1040C': 'C', '1120S': 'S', '1065': 'P', '1120': 'K' }[form];
    if (!F) return '';
    var pick = function (map) { return map[form] || ''; };
    if (a.type === 'income') return /return|refund|allowance/.test(n) ? pick({ '1040C': 'C2', '1120S': 'S1b', '1065': 'P1b', '1120': 'K1b' }) : pick({ '1040C': 'C1', '1120S': 'S1a', '1065': 'P1a', '1120': 'K1a' });
    if (a.type === 'oi') return /interest/.test(n) && form === '1120' ? 'K5' : pick({ '1040C': 'C6', '1120S': 'S5', '1065': 'P7', '1120': 'K10' });
    if (a.type === 'cogs') return pick({ '1040C': 'C4', '1120S': 'S2', '1065': 'P2', '1120': 'K2' });
    if (a.type !== 'expense' && a.type !== 'oe') return '';
    var rules = [
      [/advertis|marketing/, { '1040C': 'C8', '1120S': 'S16', '1065': 'P21', '1120': 'K22' }], [/car|truck|vehicle|auto|mileage|fuel/, { '1040C': 'C9', '1120S': 'S20', '1065': 'P21', '1120': 'K26' }],
      [/commission/, { '1040C': 'C10', '1120S': 'S20', '1065': 'P21', '1120': 'K26' }], [/contract/, { '1040C': 'C11', '1120S': 'S20', '1065': 'P21', '1120': 'K26' }],
      [/depreciat/, { '1040C': 'C13', '1120S': 'S14', '1065': 'P16', '1120': 'K20' }], [/insur/, { '1040C': 'C15', '1120S': 'S20', '1065': 'P21', '1120': 'K26' }],
      [/mortgage/, { '1040C': 'C16a', '1120S': 'S13', '1065': 'P15', '1120': 'K18' }], [/interest/, { '1040C': 'C16b', '1120S': 'S13', '1065': 'P15', '1120': 'K18' }],
      [/legal|professional|accounting|bookkeep/, { '1040C': 'C17', '1120S': 'S20', '1065': 'P21', '1120': 'K26' }], [/office|software|postage/, { '1040C': 'C18', '1120S': 'S20', '1065': 'P21', '1120': 'K26' }],
      [/pension|401|retire/, { '1040C': 'C19', '1120S': 'S17', '1065': 'P18', '1120': 'K23' }], [/rent|lease/, { '1040C': 'C20b', '1120S': 'S11', '1065': 'P13', '1120': 'K16' }],
      [/repair|maint/, { '1040C': 'C21', '1120S': 'S9', '1065': 'P11', '1120': 'K14' }], [/suppl/, { '1040C': 'C22', '1120S': 'S20', '1065': 'P21', '1120': 'K26' }],
      [/tax|licen/, { '1040C': 'C23', '1120S': 'S12', '1065': 'P14', '1120': 'K17' }], [/travel/, { '1040C': 'C24a', '1120S': 'S20', '1065': 'P21', '1120': 'K26' }],
      [/meal/, { '1040C': 'C24b', '1120S': 'S20', '1065': 'P21', '1120': 'K26' }], [/utilit|phone|internet/, { '1040C': 'C25', '1120S': 'S20', '1065': 'P21', '1120': 'K26' }],
      [/officer/, { '1040C': 'C26', '1120S': 'S7', '1065': 'P9', '1120': 'K12' }], [/wage|salar|payroll/, { '1040C': 'C26', '1120S': 'S8', '1065': 'P9', '1120': 'K13' }],
      [/guaranteed/, { '1040C': 'C27a', '1120S': 'S20', '1065': 'P10', '1120': 'K26' }], [/bad debt/, { '1040C': 'C27a', '1120S': 'S10', '1065': 'P12', '1120': 'K15' }],
      [/benefit|health/, { '1040C': 'C14', '1120S': 'S18', '1065': 'P19', '1120': 'K24' }], [/charit|donat/, { '1040C': 'NDED', '1120S': 'NDED', '1065': 'NDED', '1120': 'K19' }],
      [/penalt|fine|political/, { '1040C': 'NDED', '1120S': 'NDED', '1065': 'NDED', '1120': 'NDED' }], [/uncategor/, { '1040C': '', '1120S': '', '1065': '', '1120': '' }]];
    for (var i = 0; i < rules.length; i++) if (rules[i][0].test(n)) return rules[i][1][form];
    return pick({ '1040C': 'C27a', '1120S': 'S20', '1065': 'P21', '1120': 'K26' });
  };
  /** Income Tax Summary: P&L account activity in a period by tax line (sign: income positive, expenses positive). */
  R.taxSummary = function (book, opts) {
    var form = book.company.taxForm, def = Book.TAX_FORMS[form], map = book.company.taxLines || {}, basis = R.basis(book, opts);
    if (!def) return { form: '', rows: [], unmapped: [] };
    var pnl = R.pnl(book, { from: opts.from, to: opts.to, basis: basis }), byLine = {}, unmapped = [];
    var acctAmount = {};
    Object.keys(pnl.sections || {}).forEach(function (k) { (pnl.sections[k].rows || []).forEach(function (r) { if (r.accountId) acctAmount[r.accountId] = (acctAmount[r.accountId] || 0) + (r.values ? r.values[0] : 0); }); });
    Object.keys(acctAmount).forEach(function (id) {
      var amt = acctAmount[id]; if (!amt) return;
      var code = map[id], a = book.accById[id];
      if (!code) { unmapped.push({ accountId: id, label: book.accountLabel(id), amount: amt }); return; }
      var row = byLine[code] = byLine[code] || { code: code, label: (def.lines.find(function (x) { return x[0] === code; }) || [code, code])[1], amount: 0, accounts: [] };
      row.amount += amt; row.accounts.push({ accountId: id, label: book.accountLabel(id), amount: amt });
    });
    var order = def.lines.map(function (x) { return x[0]; });
    var rows = Object.keys(byLine).map(function (k) { return byLine[k]; }).sort(function (a, b) { return order.indexOf(a.code) - order.indexOf(b.code); });
    return { form: form, formLabel: def.label, basis: basis, from: opts.from, to: opts.to, rows: rows, unmapped: unmapped };
  };
  R.taxCsv = function (book, opts) {
    var r = R.taxSummary(book, opts), q = function (v) { v = String(v); return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var out = [['Form', 'Tax line', 'Account', 'Amount'].join(',')];
    r.rows.forEach(function (row) { row.accounts.forEach(function (a) { out.push([r.form, row.label, a.label, (a.amount / 100).toFixed(2)].map(q).join(',')); }); out.push([r.form, row.label, 'Total', (row.amount / 100).toFixed(2)].map(q).join(',')); });
    r.unmapped.forEach(function (a) { out.push([r.form, 'NOT MAPPED', a.label, (a.amount / 100).toFixed(2)].map(q).join(',')); });
    return out.join('\r\n') + '\r\n';
  };

  ['addAttachment', 'removeAttachment'].forEach(function (name) {
    var raw = Book.prototype[name]; Book.prototype['_raw_' + name] = raw;
    Book.prototype[name] = function () { var self = this, args = arguments, p = this._queue.then(function () { return raw.apply(self, args); }); this._queue = p.catch(function () {}); return p; };
  });
})(typeof window !== 'undefined' ? window : globalThis);
