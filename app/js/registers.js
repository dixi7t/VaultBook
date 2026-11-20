/* VaultBook — Sales, Purchase and Bank registers (TallyPrime style): a month-wise summary of debits, credits and
 * closing balance, and the voucher list behind each month. Read-only: figures come from posted transactions.
 *
 * OB.registers.build(book, opts) → { kind, from, to, opening, closing, debit, credit, months[], vouchers[] }
 *   opts: kind 'sales' | 'purchase' | 'bank'; accountId (bank: required); from, to (YYYY-MM-DD);
 *         filters: types[], contactId, ledgerId (voucher has a line on this account), min, max (cents, on the
 *         voucher amount), number, memo, party (text), status ('open'|'paid'|'overdue' for sales/purchase;
 *         'cleared'|'uncleared'|'reconciled' for bank), classId, dir ('in'|'out').
 *   Amounts are integer cents. Debit/credit follow the register's ledger: sales are credits (credit memos are
 *   debits), purchases are debits (vendor credits are credits), bank money in is a debit. Closing balance is
 *   signed debit-positive; sales show credit balances, as in Tally.
 */
(function (root) {
  'use strict';
  var OB = root.OB, U = OB.util, S = OB.schema;
  var R = OB.registers = {};

  R.TYPES = {
    sales: { dr: ['creditMemo'], cr: ['invoice', 'salesReceipt'], dflt: ['invoice', 'salesReceipt', 'creditMemo'] },
    purchase: { dr: ['bill', 'expense', 'check'], cr: ['vendorCredit', 'ccCredit'], dflt: ['bill', 'expense', 'check', 'vendorCredit', 'ccCredit'] }
  };
  R.TITLES = { sales: 'Sales Register', purchase: 'Purchase Register', bank: 'Bank Book' };

  function headAccount(b, t) {
    var def = S.TXN_TYPES[t.type] || {};
    if (def.head === 'AR') return b.sys('AR').id;
    if (def.head === 'AP') return b.sys('AP').id;
    return t.accountId || '';
  }
  function linesOf(b, t, exceptAccountId) {
    return (t.splits || []).map(function (s, i) { return { s: s, i: i }; }).filter(function (x) { return x.s.accountId !== exceptAccountId; })
      .map(function (x) { return { accountId: x.s.accountId, account: b.accountLabel(x.s.accountId), memo: x.s.memo || '', amount: x.s.amount, classId: x.s.classId || '' }; });
  }
  function textHas(hay, needle) { return !needle || String(hay || '').toLowerCase().indexOf(String(needle).toLowerCase()) >= 0; }

  /** Keep or drop a voucher row by the common filters. v = { t, party, amount (cents, positive), lines } */
  function passes(b, v, o, today) {
    var t = v.t;
    if (o.contactId && (t.contactId || v.contactId || '') !== o.contactId) return false;
    if (o.party && !textHas(v.party, o.party)) return false;
    if (o.number && !textHas(t.number, o.number)) return false;
    if (o.memo && !(textHas(t.memo, o.memo) || v.lines.some(function (l) { return textHas(l.memo, o.memo); }))) return false;
    if (o.min !== undefined && o.min !== null && o.min !== '' && v.amount < +o.min) return false;
    if (o.max !== undefined && o.max !== null && o.max !== '' && v.amount > +o.max) return false;
    if (o.ledgerId && !(t.splits || []).some(function (s) { return s.accountId === o.ledgerId; })) return false;
    if (o.classId && !(t.splits || []).some(function (s) { return (s.classId || '') === (o.classId === '__none' ? '' : o.classId); })) return false;
    if (o.status === 'open' || o.status === 'paid' || o.status === 'overdue') {
      if (['invoice', 'bill', 'creditMemo', 'vendorCredit'].indexOf(t.type) < 0) return false;
      var open = b.openBalance(t);
      if (o.status === 'open' && !(open > 0)) return false;
      if (o.status === 'paid' && open > 0) return false;
      if (o.status === 'overdue' && !(open > 0 && t.dueDate && t.dueDate < today)) return false;
    }
    return true;
  }

  R.build = function (b, opts) {
    var o = Object.assign({}, opts || {}), kind = o.kind || 'sales', today = U.today();
    var from = U.isDate(o.from) ? o.from : '1900-01-01', to = U.isDate(o.to) ? o.to : '2999-12-31';
    var vouchers = [], opening = 0;
    if (kind === 'bank') {
      var a = b.accById[o.accountId]; if (!a) throw new Error('Choose a bank or credit card account.');
      opening = b.rawBalance(a.id, U.addDays(from, -1));
      var reg = b.register(a.id, from, to), seen = {};
      reg.rows.forEach(function (x) {
        if (x.t.status !== 'posted') return;
        var key = x.t.id + ':' + x.i; if (seen[key]) return; seen[key] = 1;
        var lines = linesOf(b, x.t, a.id), amt = x.amount;
        var v = { t: x.t, splitIndex: x.i, date: x.t.date, type: x.t.type, number: x.t.number || '', memo: x.s.memo || x.t.memo || '',
          contactId: x.s.contactId || x.t.contactId || '', party: b.contactLabel(x.s.contactId || x.t.contactId) || b.splitCounterpart(x.t, x.i),
          debit: amt > 0 ? amt : 0, credit: amt < 0 ? -amt : 0, amount: Math.abs(amt), cleared: x.s.cleared || '', lines: lines };
        if (o.types && o.types.length && o.types.indexOf(x.t.type) < 0) return;
        if (o.dir === 'in' && !(amt > 0)) return;
        if (o.dir === 'out' && !(amt < 0)) return;
        if (o.status === 'cleared' && v.cleared !== 'C' && v.cleared !== 'R') return;
        if (o.status === 'uncleared' && (v.cleared === 'C' || v.cleared === 'R')) return;
        if (o.status === 'reconciled' && v.cleared !== 'R') return;
        if (!passes(b, v, Object.assign({}, o, { status: '' }), today)) return;
        vouchers.push(v);
      });
    } else {
      var def = R.TYPES[kind]; if (!def) throw new Error('Unknown register: ' + kind);
      var types = o.types && o.types.length ? o.types : def.dflt;
      b.transactions.forEach(function (t) {
        if (t.status !== 'posted' || t.date < from || t.date > to || types.indexOf(t.type) < 0) return;
        var dr = def.dr.indexOf(t.type) >= 0, cr = def.cr.indexOf(t.type) >= 0; if (!dr && !cr) return;
        var amt = Math.abs(t.total || 0), lines = linesOf(b, t, headAccount(b, t));
        var v = { t: t, date: t.date, type: t.type, number: t.number || '', memo: t.memo || '', contactId: t.contactId || '',
          party: b.contactLabel(t.contactId) || (t.payee || '') || (kind === 'sales' ? 'Cash sale' : b.accountLabel(t.accountId)),
          debit: dr ? amt : 0, credit: cr ? amt : 0, amount: amt, open: ['invoice', 'bill', 'creditMemo', 'vendorCredit'].indexOf(t.type) >= 0 ? b.openBalance(t) : null, lines: lines };
        if (!passes(b, v, o, today)) return;
        vouchers.push(v);
      });
      vouchers.sort(function (x, y) { return x.date < y.date ? -1 : x.date > y.date ? 1 : String(x.number).localeCompare(String(y.number), undefined, { numeric: true }); });
    }
    // month-wise summary across the whole period (months with no vouchers still show, like Tally)
    var months = [], idx = {}, bal = opening;
    var start = from === '1900-01-01' ? (vouchers.length ? vouchers[0].date : today) : from;
    var end = to === '2999-12-31' ? (vouchers.length ? vouchers[vouchers.length - 1].date : today) : to;
    if (end < start) end = start;
    for (var m = U.monthStart(start), n = 0; m <= end && n < 600; m = U.addMonths(m, 1), n++) {
      idx[m.slice(0, 7)] = months.length; months.push({ month: m.slice(0, 7), from: m < start ? start : m, to: U.monthEnd(m) > end ? end : U.monthEnd(m), count: 0, debit: 0, credit: 0, closing: 0 });
    }
    var dTot = 0, cTot = 0;
    vouchers.forEach(function (v) {
      var r = months[idx[v.date.slice(0, 7)]]; if (r) { r.count++; r.debit += v.debit; r.credit += v.credit; }
      dTot += v.debit; cTot += v.credit;
    });
    months.forEach(function (r) { bal += r.debit - r.credit; r.closing = bal; });
    // running balance on each voucher (bank: the account balance; others: cumulative net)
    var run = opening; vouchers.forEach(function (v) { run += v.debit - v.credit; v.balance = run; });
    return { kind: kind, accountId: o.accountId || '', from: from, to: to, opening: opening, debit: dTot, credit: cTot, closing: opening + dTot - cTot, months: months, vouchers: vouchers };
  };

  /** Tally-style balance text: "1,234.00 Dr" / "56.00 Cr". */
  R.drcr = function (cents) { return cents === 0 ? '' : U.fmt(Math.abs(cents)) + (cents > 0 ? ' Dr' : ' Cr'); };

  if (typeof module !== 'undefined' && module.exports) module.exports = R;
})(typeof window !== 'undefined' ? window : globalThis);
