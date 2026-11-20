/* VaultBook — QuickBooks Desktop snapshot matching (1.31).
 * The connector's "Read QuickBooks" writes a snapshot: { format: 'vaultbook-qb-snapshot', version: 1, company, at, from, to,
 *   txns: [{ txnId, type (qbXML name), date, num, name, amount ("0.00"), key (VaultBook id if the connector wrote it) }],
 *   months: [{ month: 'YYYY-MM', count }] }
 * OB.qbsync.compare(book, snap) → { matched: [{ t, qb, how: 'key'|'txnid'|'fields'|'deposit' }], missing: [VaultBook txns not in QuickBooks],
 *   qbOnly: [snapshot txns with no VaultBook match], months: [{ month, qb, vb, matched, missing, qbOnly, state }], warning }
 * OB.qbsync.gap(book, cmp, months) → { keys, items, extra } — what to send for the chosen months, plus invoices from other
 *   months that a chosen payment pays (QuickBooks cannot apply a payment to an invoice it does not have).
 * OB.qbsync.remember(book, cmp) → stores each match on company.qbSent so later compares match by key and the send list shows Sent.
 */
(function (root) {
  'use strict';
  var OB = root.OB = root.OB || {};
  var U = OB.util, S = OB.qbsync = {};
  // qbXML transaction names → VaultBook types (both directions used by the connector and the matcher)
  S.TYPES = { Invoice: 'invoice', SalesReceipt: 'salesReceipt', ReceivePayment: 'payment', CreditMemo: 'creditMemo', ARRefundCreditCard: 'customerRefund',
    Bill: 'bill', BillPaymentCheck: 'billPayment', BillPaymentCreditCard: 'billPayment', VendorCredit: 'vendorCredit', Check: 'check', CreditCardCharge: 'expense', CreditCardCredit: 'ccCredit',
    Deposit: 'deposit', Transfer: 'transfer', JournalEntry: 'journal', InventoryAdjustment: 'invAdjust' };
  var cents = function (v) { var n = parseFloat(String(v === null || v === undefined ? '' : v).replace(/[^0-9.\-]/g, '')); return isFinite(n) ? Math.round(n * 100) : 0; };
  var norm = function (s) { return String(s || '').trim().toLowerCase().replace(/^0+(?=\d)/, ''); };
  var amountOf = function (t) { return Math.abs(t.type === 'payment' || t.type === 'billPayment' || t.type === 'transfer' ? (t.amount || t.total || 0) : (t.total || t.amount || 0)); };
  var monthOf = function (d) { return String(d || '').slice(0, 7); };

  var FAMILY = { check: 'out', expense: 'out', deposit: 'in', transfer: 'move', journal: 'journal', ccCredit: 'cardin' };
  S.compare = function (book, snap) {
    if (!snap || snap.format !== 'vaultbook-qb-snapshot' || !Array.isArray(snap.txns)) throw new Error('This is not a VaultBook QuickBooks snapshot file.');
    var sent = (book.company && book.company.qbSent) || {}, byId = {}, byKey = {}, byFields = {}, byDeposit = {}, byFamily = {};
    snap.txns.forEach(function (q) {
      byId[q.txnId] = q;
      if (q.key) byKey[q.key] = q;
      var vt = S.TYPES[q.type] || String(q.type || '').toLowerCase(), fk = vt + '|' + String(q.date || '').slice(0, 10) + '|' + norm(q.num) + '|' + cents(q.amount);
      (byFields[fk] = byFields[fk] || []).push(q);
      if (FAMILY[vt]) { var mk = FAMILY[vt] + '|' + String(q.date || '').slice(0, 10) + '|' + cents(q.amount); (byFamily[mk] = byFamily[mk] || []).push(q); }
      if (vt === 'deposit') { var dk = String(q.date || '').slice(0, 10) + '|' + cents(q.amount); (byDeposit[dk] = byDeposit[dk] || []).push(q); }
    });
    var VB = {}; Object.keys(S.TYPES).forEach(function (k) { VB[S.TYPES[k]] = 1; });
    var used = {}, matched = [], missing = [];
    var from = snap.from || '0000-01-01', to = snap.to || '9999-12-31';
    book.posted().forEach(function (t) {
      if (!VB[t.type] || t.voidedBy) return;
      if (t.date < from || t.date > to) return;
      var imp = /TxnID (\S+)/.exec(t.importRef || ''), how = 'key';
      var q = byKey[t.id] || (sent[t.id] && sent[t.id].qbTxnId ? byId[sent[t.id].qbTxnId] : null);
      if (!q && imp && byId[imp[1]]) { q = byId[imp[1]]; how = 'txnid'; }   // imported from QuickBooks with its id
      if (!q) {
        var fk = t.type + '|' + t.date + '|' + norm(t.number || t.checkNo) + '|' + amountOf(t), c = (byFields[fk] || []).filter(function (x) { return !used[x.txnId]; });
        if (!c.length && t.type === 'payment') { fk = t.type + '|' + t.date + '||' + amountOf(t); c = (byFields[fk] || []).filter(function (x) { return !used[x.txnId]; }); }
        if (c.length) { q = c[0]; how = 'fields'; }
        // QuickBooks may hold a customer payment as a bank Deposit posted to Accounts Receivable (not applied to an invoice):
        // same date and amount means the money is already there, so it is not sent again
        // money out of a bank or card may be a Check in one program and an expense / card charge in the other; a number typed
        // only on one side must not hide it either: same date and amount of the same kind is the same entry (never sent twice)
        if (!q && FAMILY[t.type]) { c = (byFamily[FAMILY[t.type] + '|' + t.date + '|' + amountOf(t)] || []).filter(function (x) { return !used[x.txnId]; }); if (c.length) { q = c[0]; how = 'fields'; } }
        if (!q && t.type === 'payment') { c = (byDeposit[t.date + '|' + amountOf(t)] || []).filter(function (x) { return !used[x.txnId]; }); if (c.length) { q = c[0]; how = 'deposit'; } }
      }
      if (q && !used[q.txnId]) { used[q.txnId] = 1; matched.push({ t: t, qb: q, how: how }); }
      else missing.push(t);
    });
    var qbOnly = snap.txns.filter(function (q) { return !used[q.txnId]; });
    var months = {}, m = function (k) { return months[k] = months[k] || { month: k, qb: 0, vb: 0, matched: 0, missing: 0, qbOnly: 0 }; };
    (snap.months || []).forEach(function (x) { m(x.month).qb = x.count || 0; });
    snap.txns.forEach(function (q) { var r = m(monthOf(q.date)); if (!(snap.months || []).length) r.qb++; });
    matched.forEach(function (x) { var r = m(monthOf(x.t.date)); r.vb++; r.matched++; });
    missing.forEach(function (t) { var r = m(monthOf(t.date)); r.vb++; r.missing++; });
    qbOnly.forEach(function (q) { m(monthOf(q.date)).qbOnly++; });
    var start = (from.slice(0, 7) < '0001' ? null : from.slice(0, 7)), end = to.slice(0, 7) > '9000' ? null : to.slice(0, 7);
    if (start && end) { for (var d = start; d <= end; d = U.addMonths(d + '-01', 1).slice(0, 7)) m(d); }
    var list = Object.keys(months).sort().map(function (k) {
      var r = months[k];
      r.state = !r.vb && !r.qb && !r.qbOnly ? 'Empty' : !r.vb ? 'QuickBooks only' : !r.missing && !r.qbOnly ? 'Done' : !r.matched && !r.qbOnly ? 'Not in QuickBooks' : 'Partly';
      r.label = new Date(k + '-15T00:00:00').toLocaleString('en-US', { month: 'short', year: 'numeric' });
      return r;
    });
    var warning = snap.company && book.company && snap.company !== book.company.name ? 'This snapshot is from "' + snap.company + '", not "' + book.company.name + '".' : '';
    return { snapshot: snap, matched: matched, missing: missing, qbOnly: qbOnly, months: list, warning: warning };
  };

  S.gap = function (book, cmp, monthKeys) {
    var want = {}; (monthKeys || []).forEach(function (k) { want[k] = 1; });
    var inQb = {}; cmp.matched.forEach(function (x) { inQb[x.t.id] = 1; });
    var items = cmp.missing.filter(function (t) { return want[monthOf(t.date)]; }), keys = {}, extra = [];
    items.forEach(function (t) { keys[t.id] = 1; });
    items.forEach(function (t) {
      if (t.type !== 'payment' && t.type !== 'billPayment') return;
      (t.applications || []).forEach(function (a) {
        var d = book.txById[a.txnId];
        if (!d || inQb[d.id] || keys[d.id] || (d.type !== 'invoice' && d.type !== 'bill')) return;
        keys[d.id] = 1; extra.push({ t: d, number: d.number || '', month: monthOf(d.date), id: d.id });
      });
    });
    return { keys: Object.keys(keys), items: items, extra: extra };
  };

  S.remember = function (book, cmp) {
    var changes = {}, n = 0, sent = (book.company && book.company.qbSent) || {};
    cmp.matched.forEach(function (x) { if (!sent[x.t.id] || sent[x.t.id].qbTxnId !== x.qb.txnId) { changes[x.t.id] = { qbTxnId: String(x.qb.txnId), at: cmp.snapshot.at || new Date().toISOString() }; n++; } });
    if (!n) return Promise.resolve(0);
    return book.saveCompanySent(changes).then(function () { return n; });
  };
})(typeof window !== 'undefined' ? window : globalThis);
