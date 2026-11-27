/* VaultBook — export invoices to QuickBooks Desktop (.iif).
 * Row layout follows the tested Invoice PDF Extractor tool (!TRNS / !SPL / !ENDTRNS, tab-separated, CRLF):
 *   TRNS  INVOICE  date  A/R account  customer  class  +total  invoice no.  memo  N  TOPRINT  N  bill-to address 1–5  due date  terms
 *   SPL   INVOICE  date  income account  class  −amount  invoice no.  description  N  −qty  rate  item  N
 * Optionally preceded by the lists QuickBooks needs to accept the file: accounts (!ACCNT), customers (!CUST), items (!INVITEM).
 * The text is checked by parsing it back with OB.qbimport, so the file round-trips into VaultBook too.
 */
(function (root) {
  'use strict';
  var OB = root.OB = root.OB || {};
  var X = OB.qbexport = {};

  // VaultBook → QuickBooks account and item types (inverse of the importer's tables)
  var ACC = { bank: 'BANK', ar: 'AR', oca: 'OCASSET', fixed: 'FIXASSET', oa: 'OASSET', ap: 'AP', cc: 'CCARD', ocl: 'OCLIAB', ltl: 'LTLIAB', equity: 'EQUITY', income: 'INC', cogs: 'COGS', expense: 'EXP', oi: 'EXINC', oe: 'EXEXP' };
  var ITEM = { service: 'SERV', noninventory: 'PART', inventory: 'INVENTORY', othercharge: 'OTHC', discount: 'DISC', payment: 'PMT', subtotal: 'SUBT', group: 'GRP', salestax: 'STAX', fixedasset: 'OTHC' };
  X.ACC = ACC; X.ITEM = ITEM;

  var clean = function (s) { return OB.util.qbText(s).replace(/[\t\r\n]+/g, ' ').replace(/"/g, "'").replace(/ {2,}/g, ' ').trim(); };   // 1.62: same plain text as the connector
  var qbName = function (s) { return clean(s).replace(/:/g, '-').slice(0, 41); }; // QuickBooks name rules: no ':' in a name, 41 characters
  var money = function (c) { return (c / 100).toFixed(2); };
  var qbDate = function (d) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || ''); return m ? (+m[2]) + '/' + (+m[3]) + '/' + m[1] : ''; };
  X.qbDate = qbDate;
  /** QuickBooks Desktop reads .iif as Windows-1252 (ANSI): bytes for the text, "?" for characters it cannot hold. */
  X.toAnsi = function (text) {
    var CP = (OB.pdf && OB.pdf.CP) || {}, out = new Uint8Array(text.length), n = 0;
    for (var i = 0; i < text.length; i++) {
      var c = text.charCodeAt(i);
      if (c >= 0xD800 && c <= 0xDBFF) { out[n++] = 63; i++; continue; }
      out[n++] = c < 128 || (c >= 160 && c < 256) ? c : CP[c] || (c === 0x2212 ? 45 : 63);
    }
    return out.subarray(0, n);
  };
  var row = function (a) { return a.join('\t'); };

  /**
   * book: OB.Book; ids: transaction ids (non-invoices and void invoices are skipped);
   * opts: { lists: true (accounts, customers, items), toPrint: false }
   * Returns { text, count, total (cents), skipped: [{ id, reason }], names: {customers, accounts, items} }.
   */
  X.invoicesIIF = function (book, ids, opts) {
    opts = opts || {};
    var lists = opts.lists !== false;
    var skipped = [], invs = [];
    (ids || []).forEach(function (id) {
      var t = book.txById[id];
      if (!t) return skipped.push({ id: id, reason: 'not found' });
      if (t.type !== 'invoice') return skipped.push({ id: id, reason: 'not an invoice' });
      if (t.status !== 'posted') return skipped.push({ id: id, reason: 'void' });
      invs.push(t);
    });
    invs.sort(OB.Book.cmpTxn);
    var arAcc = book.sys('AR');
    var accName = function (id) { var a = book.accById[id]; return a ? clean(book.accountFullName(a)) : ''; };
    var custName = {}, usedAcc = {}, usedItem = {}, usedCust = {}; var usedTax = {};
    invs.forEach(function (t) {
      var c = book.contactById[t.contactId];
      if (c) { usedCust[c.id] = c; custName[c.id] = qbName(c.name); }
      var ar = (t.splits.find(function (s) { return s.amount > 0 && book.accById[s.accountId] && book.accById[s.accountId].type === 'ar'; }) || {}).accountId || arAcc.id;
      usedAcc[ar] = 1;
      (t.lines || []).forEach(function (l) { usedAcc[l.accountId] = 1; if (l.itemId && book.itemById && book.itemById[l.itemId]) usedItem[l.itemId] = book.itemById[l.itemId]; });
      var tx = t.tax && book.salesTaxById(t.taxId);
      if (tx) { usedTax[tx.id] = tx; usedAcc[tx.accountId] = 1; }
    });
    var out = [];
    if (lists) {
      // parent accounts first, so QuickBooks can create sub-accounts ("Parent:Child")
      var withParents = {};
      Object.keys(usedAcc).forEach(function (id) { var a = book.accById[id], g = 0; while (a && g++ < 10) { withParents[a.id] = a; a = a.parentId ? book.accById[a.parentId] : null; } });
      var accs = Object.keys(withParents).map(function (k) { return withParents[k]; }).sort(function (x, y) { return book.accountFullName(x).split(':').length - book.accountFullName(y).split(':').length || book.accountFullName(x).localeCompare(book.accountFullName(y)); });
      out.push(row(['!ACCNT', 'NAME', 'ACCNTTYPE', 'DESC', 'ACCNUM']));
      accs.forEach(function (a) { out.push(row(['ACCNT', clean(book.accountFullName(a)), ACC[a.type] || 'OCASSET', clean(a.description), clean(a.number)])); });
      var custs = Object.keys(usedCust).map(function (k) { return usedCust[k]; }).sort(function (x, y) { return x.name.localeCompare(y.name); });
      if (custs.length) {
        out.push(row(['!CUST', 'NAME', 'BADDR1', 'BADDR2', 'BADDR3', 'BADDR4', 'BADDR5', 'EMAIL', 'PHONE1', 'CONT1']));
        custs.forEach(function (c) {
          var addr = [c.name].concat(String(c.address || '').split(/\r?\n/).filter(Boolean)).slice(0, 5).map(clean);
          while (addr.length < 5) addr.push('');
          out.push(row(['CUST', custName[c.id]].concat(addr, [clean(c.email), clean(c.phone), clean(c.contactName)])));
        });
      }
      var items = Object.keys(usedItem).map(function (k) { return usedItem[k]; }).sort(function (x, y) { return x.name.localeCompare(y.name); });
      if (items.length) {
        out.push(row(['!INVITEM', 'NAME', 'INVITEMTYPE', 'DESC', 'ACCNT', 'PRICE', 'TAXABLE']));
        items.forEach(function (it) { out.push(row(['INVITEM', qbName(it.name), ITEM[it.type] || 'OTHC', clean(it.description).slice(0, 4000), accName(it.incomeAccountId), it.price === null || it.price === undefined ? '0' : money(it.price), it.taxable ? 'Y' : 'N'])); });
      }
      // sales tax rates become QuickBooks sales tax items (STAX); PRICE is the rate in percent
      var taxes = Object.keys(usedTax).map(function (k) { return usedTax[k]; }).sort(function (x, y) { return x.name.localeCompare(y.name); });
      if (taxes.length) {
        out.push(row(['!INVITEM', 'NAME', 'INVITEMTYPE', 'DESC', 'ACCNT', 'PRICE', 'TAXABLE']));
        taxes.forEach(function (x) { out.push(row(['INVITEM', qbName(x.name), 'STAX', clean(x.agency || x.name), accName(x.accountId), rateText(x.rate), 'N'])); });
      }
    }
    out.push(row(['!TRNS', 'TRNSID', 'TRNSTYPE', 'DATE', 'ACCNT', 'NAME', 'CLASS', 'AMOUNT', 'DOCNUM', 'MEMO', 'CLEAR', 'TOPRINT', 'NAMEISTAXABLE', 'ADDR1', 'ADDR2', 'ADDR3', 'ADDR4', 'ADDR5', 'DUEDATE', 'TERMS']));
    out.push(row(['!SPL', 'SPLID', 'TRNSTYPE', 'DATE', 'ACCNT', 'NAME', 'CLASS', 'AMOUNT', 'DOCNUM', 'MEMO', 'CLEAR', 'QNTY', 'PRICE', 'INVITEM', 'TAXABLE', 'EXTRA']));
    out.push('!ENDTRNS');
    var total = 0;
    var clsName = function (id) { return id && book.classFullName ? clean(book.classFullName(id)) : ''; };
    invs.forEach(function (t) {
      var c = book.contactById[t.contactId] || { name: '' };
      var ar = (t.splits.find(function (s) { return s.amount > 0 && book.accById[s.accountId] && book.accById[s.accountId].type === 'ar'; }) || {}).accountId || arAcc.id;
      var addr = [c.name].concat(String(c.address || '').split(/\r?\n/).filter(Boolean)).slice(0, 5).map(clean);
      while (addr.length < 5) addr.push('');
      var date = qbDate(t.date);
      var terms = t.terms !== '' && t.terms !== undefined && t.terms !== null ? (+t.terms ? 'Net ' + (+t.terms) : 'Due on receipt') : '';
      out.push(row(['TRNS', '', 'INVOICE', date, accName(ar), custName[c.id] || qbName(c.name), clsName(t.classId), money(t.total), clean(t.number), clean(t.memo), 'N', opts.toPrint ? 'Y' : 'N', 'N'].concat(addr, [t.dueDate ? qbDate(t.dueDate) : '', terms])));
      (t.lines || []).forEach(function (l) {
        var it = l.itemId && book.itemById ? book.itemById[l.itemId] : null;
        var hasQty = l.qty !== null && l.qty !== undefined && l.qty !== '' && l.rate !== null && l.rate !== undefined && Math.round(+l.qty * l.rate) === l.amount;
        out.push(row(['SPL', '', 'INVOICE', date, accName(l.accountId), '', clsName(l.classId || t.classId), money(-l.amount), clean(t.number), clean(l.description).slice(0, 4000), 'N',
          hasQty ? String(-(+l.qty)) : '-1', hasQty ? money(l.rate) : money(l.amount), it ? qbName(it.name) : '', l.taxable ? 'Y' : 'N', '']));
      });
      if (t.tax) {
        var tx = book.salesTaxById(t.taxId), taxAcc = tx ? tx.accountId : (book.sys('STAX') || {}).id;
        out.push(row(['SPL', '', 'INVOICE', date, accName(taxAcc), '', '', money(-t.tax), clean(t.number), clean(tx ? tx.name : 'Sales tax'), 'N', '', rateText(t.taxRate || 0), tx ? qbName(tx.name) : '', 'N', 'AUTOSTAX']));
      }
      out.push('ENDTRNS');
      total += t.total;
    });
    return { text: out.join('\r\n') + '\r\n', count: invs.length, total: total, skipped: skipped };
    function rateText(ppm) { return OB.Book.fmtRate(ppm); }
  };

  /* ---------- 1.20: bank feed transactions → QuickBooks ---------- */
  /**
   * Pick the bank lines to send: opts { accountIds, from, to, includeReview (false), onlyNew (true), payments 'skip'|'payment'|'deposit' }.
   * 'payment' (1.27.3): customer payments as IIF PAYMENT and bill payments as BILLPMT. 'deposit' is kept for old callers only:
   * QuickBooks turns a deposit to A/R into an unapplied credit and the invoices stay open.
   * Only posted lines go: each brings the transaction it created or matched (a transfer seen from both accounts is sent once).
   * Lines still in For review and excluded lines are never sent.
   */
  function pick(book, opts) {
    var U = OB.util;
    var from = opts.from || '0000-01-01', to = opts.to || '9999-12-31', onlyNew = opts.onlyNew !== false, want = {};
    (opts.accountIds || []).forEach(function (id) { want[id] = 1; });
    var items = [], byTxn = {}, skipped = [], byAccount = {};
    (opts.accountIds || []).forEach(function (id) { byAccount[id] = { in: 0, out: 0, count: 0 }; });
    var skip = function (l, why) { skipped.push({ lineId: l.id, accountId: l.accountId, date: l.date, description: l.description, amount: l.amount, reason: why }); };
    book.bankLines.filter(function (l) { return want[l.accountId] && l.date >= from && l.date <= to && (l.status === 'posted' || l.status === 'review'); })
      .sort(function (x, y) { return x.date < y.date ? -1 : x.date > y.date ? 1 : (x.seq || 0) - (y.seq || 0); })
      .forEach(function (l) {
        if (onlyNew && l.exportId) return skip(l, 'already exported ' + (l.exportedAt ? 'on ' + U.fmtDate(l.exportedAt.slice(0, 10)) : 'before'));
        if (onlyNew && OB.qbsend && (l.links ? l.links.map(function (x) { return x.txnId; }) : [l.txnId]).some(function (id) { return book.txById[id] && OB.qbsend.inQB(book, book.txById[id]); }))
          return skip(l, 'already in QuickBooks');   // 1.62: recorded by the connector, or imported from QuickBooks
        if (l.status === 'review') return skip(l, 'not posted yet (post it in the Bank feed first)'); // only what is in the books goes to QuickBooks
        var ids = l.links ? l.links.map(function (x) { return x.txnId; }) : [l.txnId];   // a group match (1.23) links several entries
        var txs = ids.map(function (id) { return book.txById[id]; });
        if (txs.some(function (t) { return !t || t.status !== 'posted'; })) return skip(l, 'its transaction was voided');
        var pay = txs.find(function (t) { return t.type === 'payment' || t.type === 'billPayment'; });
        if (pay && opts.payments !== 'deposit' && opts.payments !== 'payment') return skip(l, (pay.type === 'payment' ? 'customer payment of an invoice: record it in QuickBooks with Receive Payments' : 'bill payment: record it in QuickBooks with Pay Bills') + ', or choose to send payments to A/R and A/P');
        txs.forEach(function (t, n) {
          if (byTxn[t.id]) { if (!n) byTxn[t.id].lineIds.push(l.id); }
          else { var it = { txn: t, bankAccountId: l.accountId, lineIds: n ? [] : [l.id] }; byTxn[t.id] = it; items.push(it); }
        });
        var b = byAccount[l.accountId]; b.count++; if (l.amount > 0) b.in += l.amount; else b.out -= l.amount;
      });
    return { items: items, skipped: skipped, byAccount: byAccount, lineIds: [].concat.apply([], items.map(function (x) { return x.lineIds; })) };
  }
  X.pickBankLines = pick;

  /** QuickBooks Desktop .iif for the chosen bank lines: CHECK / DEPOSIT / TRANSFER / CREDIT CARD / CCARD REFUND
   *  (GENERAL JOURNAL for anything else), built from each transaction's splits (debit +, credit −).
   *  opts also: names { accountId: 'name in QuickBooks' }, cleared (true), lists (true).
   *  Returns { text, txnCount, lineIds, skipped, byAccount }. */
  X.bankIIF = function (book, opts) {
    opts = opts || {};
    var p = opts.picked || pick(book, opts), names = opts.names || {}, cleared = opts.cleared !== false;
    var accName = function (id) { var a = book.accById[id]; return names[id] && String(names[id]).trim() ? clean(names[id]) : a ? clean(book.accountFullName(a)) : ''; };
    var clsName = function (id) { return id && book.classFullName ? clean(book.classFullName(id)) : ''; };
    var usedAcc = {}, usedName = {}, body = [];
    var nameOf = function (cid) { var c = cid && book.contactById[cid]; if (!c) return ''; usedName[c.id] = c; return qbName(c.name); };
    p.items.forEach(function (it) {
      var t = it.txn, splits = t.splits.filter(function (s) { return s.amount; });
      var head = t.type === 'transfer' ? splits.find(function (s) { return s.amount < 0; }) : splits.find(function (s) { return s.accountId === it.bankAccountId; });
      if (!head) head = splits[0];
      var acc = book.accById[head.accountId] || {}, type;
      var asPay = opts.payments === 'payment' && (t.type === 'payment' || t.type === 'billPayment') && (acc.type === 'bank' || acc.type === 'oca' || acc.type === 'cc');
      if (asPay) type = t.type === 'payment' ? 'PAYMENT' : 'BILLPMT';
      else if (t.type === 'transfer') type = 'TRANSFER';
      else if (t.type === 'journal') type = 'GENERAL JOURNAL';
      else if (acc.type === 'cc') type = head.amount < 0 ? 'CREDIT CARD' : 'CCARD REFUND';
      else if (acc.type === 'bank' || acc.type === 'oca') type = head.amount < 0 ? 'CHECK' : 'DEPOSIT';
      else type = 'GENERAL JOURNAL';
      var d = qbDate(t.date), who = nameOf(t.contactId || head.contactId), num = clean(t.number);
      var clr = function (s) { return cleared && (s.cleared === 'C' || s.cleared === 'R') ? 'Y' : 'N'; };
      usedAcc[head.accountId] = 1;
      var memo = clean(t.memo || head.memo);
      if (opts.mark) memo = (memo.slice(0, 4000) + ' [VB:' + t.id + ']').trim();   // 1.63: the same mark the tool writes, so it can find (and remove) these later
      if (asPay) { var pays = X.appliedText(book, t); memo = clean((memo && memo.indexOf(pays) < 0 ? memo + ' · ' : '') + pays).slice(0, 4000); if (!num) { var bl = book.bankLineById[it.lineIds[0]]; num = clean(t.checkNo || (bl && bl.checkNo) || ''); } }
      body.push(row(['TRNS', '', type, d, accName(head.accountId), who, clsName(head.classId || t.classId), money(head.amount), num, memo, clr(head)]));
      splits.forEach(function (s) {
        if (s === head) return; usedAcc[s.accountId] = 1;
        body.push(row(['SPL', '', type, d, accName(s.accountId), nameOf(s.contactId) || who, clsName(s.classId || t.classId), money(s.amount), num, clean(s.memo).slice(0, 4000), t.type === 'transfer' ? clr(s) : 'N']));
      });
      body.push('ENDTRNS');
    });
    var out = [];
    if (opts.lists !== false && p.items.length) {
      var withParents = {};
      Object.keys(usedAcc).forEach(function (id) { var a = book.accById[id], g = 0; if (names[id] && String(names[id]).trim()) { withParents[id] = a; return; } while (a && g++ < 10) { withParents[a.id] = a; a = a.parentId ? book.accById[a.parentId] : null; } });
      var accs = Object.keys(withParents).map(function (k) { return withParents[k]; }).filter(Boolean)
        .sort(function (x, y) { return accName(x.id).split(':').length - accName(y.id).split(':').length || accName(x.id).localeCompare(accName(y.id)); });
      out.push(row(['!ACCNT', 'NAME', 'ACCNTTYPE', 'DESC', 'ACCNUM']));
      accs.forEach(function (a) { out.push(row(['ACCNT', accName(a.id), ACC[a.type] || 'OCASSET', clean(a.description), names[a.id] ? '' : clean(a.number)])); });
      var groups = { vendor: [], customer: [], other: [] };
      Object.keys(usedName).forEach(function (k) { var c = usedName[k]; (groups[c.kind] || groups.other).push(c); });
      [['vendor', '!VEND', 'VEND'], ['customer', '!CUST', 'CUST'], ['other', '!OTHERNAME', 'OTHERNAME']].forEach(function (g) {
        var list = groups[g[0]].sort(function (x, y) { return x.name.localeCompare(y.name); }); if (!list.length) return;
        out.push(row([g[1], 'NAME'])); list.forEach(function (c) { out.push(row([g[2], qbName(c.name)])); });
      });
    }
    out.push(row(['!TRNS', 'TRNSID', 'TRNSTYPE', 'DATE', 'ACCNT', 'NAME', 'CLASS', 'AMOUNT', 'DOCNUM', 'MEMO', 'CLEAR']));
    out.push(row(['!SPL', 'SPLID', 'TRNSTYPE', 'DATE', 'ACCNT', 'NAME', 'CLASS', 'AMOUNT', 'DOCNUM', 'MEMO', 'CLEAR']));
    out.push('!ENDTRNS');
    return { text: out.concat(body).join('\r\n') + '\r\n', txnCount: p.items.length, lineIds: p.lineIds, skipped: p.skipped, byAccount: p.byAccount, format: 'iif' };
  };

  /** 1.62: an .iif of chosen bank transactions (by id, as Send to QuickBooks > By date lists them), oldest first. */
  X.txnsIIF = function (book, ids, opts) {
    var items = [], skipped = [];
    ids.map(function (id) { return book.txById[id]; }).filter(Boolean).sort(function (x, y) { return x.date < y.date ? -1 : x.date > y.date ? 1 : 0; }).forEach(function (t) {
      var sh = t.status === 'posted' && OB.qbsend.bankShape(book, t);
      if (sh) items.push({ txn: t, bankAccountId: sh.headId, lineIds: [] }); else skipped.push({ txnId: t.id, date: t.date, reason: 'not a bank transaction' });
    });
    return X.bankIIF(book, Object.assign({ mark: true }, opts, { picked: { items: items, skipped: skipped, byAccount: {}, lineIds: [] } }));
  };

  /**
   * 1.64: one .iif for any picked transactions (a report's tick boxes): invoices through invoicesIIF, bank transactions
   * through txnsIIF. Left out: what QuickBooks already has (Q.inQB) and types an .iif from VaultBook cannot carry yet.
   * → { text, count, keys (in the file), inQB (ids), cannot: { typeLabel: n } }
   */
  X.anyIIF = function (book, ids, opts) {
    opts = opts || {};
    var Q = OB.qbsend, inv = [], bank = [], inQB = [], cannot = {}, seen = {};
    (ids || []).forEach(function (id) {
      var t = book.txById[id]; if (!t || seen[id]) return; seen[id] = 1;
      if (t.status !== 'posted' && !(t.type === 'invoice' && t.status === 'closed')) { cannot.Void = (cannot.Void || 0) + 1; return; }
      if (Q.inQB(book, t)) { inQB.push(id); return; }
      if (t.type === 'invoice') inv.push(id);
      else if (Q.bankShape(book, t)) bank.push(id);
      else { var k = (OB.schema.TXN_TYPES[t.type] || {}).label || t.type; cannot[k] = (cannot[k] || 0) + 1; }
    });
    var parts = [], count = 0;
    if (inv.length) { var a = X.invoicesIIF(book, inv, opts); parts.push(a.text); count += a.count; }
    if (bank.length) { var c = X.txnsIIF(book, bank, opts); parts.push(c.text); count += c.txnCount; }
    return { text: parts.join(''), count: count, keys: inv.concat(bank), inQB: inQB, cannot: cannot };
  };

  /** "Pays invoice 1162 $340,074.75; invoice 1170 $30,000.00" — what a payment was applied to in VaultBook. */
  X.appliedText = function (book, t) {
    var apps = (t.applications || []).map(function (a) { var d = book.txById[a.txnId]; return d ? { d: d, amount: a.amount } : null; }).filter(Boolean);
    if (!apps.length) return '';
    var noun = function (d) { return d.type === 'bill' ? 'bill' : d.type === 'creditMemo' ? 'credit memo' : d.type === 'vendorCredit' ? 'vendor credit' : 'invoice'; };
    return 'Pays ' + apps.map(function (x) { return noun(x.d) + ' ' + (x.d.number || OB.util.fmtDate(x.d.date)) + ' ' + OB.util.fmt(x.amount, { symbol: true }); }).join('; ');
  };

  /** Every invoice and bill the exported bank payments pay, one row each, plus a CSV of it: the checklist for
   *  applying the payments in QuickBooks Desktop (an .iif cannot link a payment to an invoice), and a file that
   *  Transaction Pro or SaasAnt can import as Receive Payments / Pay Bills with the invoice link.
   *  Same choice of lines as the export (opts.onlyNew false lists lines exported before too). */
  X.paymentList = function (book, opts) {
    var U = OB.util, p = pick(book, Object.assign({}, opts, { payments: 'payment' })), rows = [];
    var accName = function (id) { var n = opts.names && opts.names[id]; return n && String(n).trim() ? clean(n) : book.accById[id] ? book.accountFullName(book.accById[id]) : ''; };
    p.items.forEach(function (it) {
      var t = it.txn; if (t.type !== 'payment' && t.type !== 'billPayment') return;
      (t.applications || []).forEach(function (a) {
        var d = book.txById[a.txnId]; if (!d) return;
        var bl = book.bankLineById[it.lineIds[0]];
        rows.push({ date: t.date, kind: t.type === 'payment' ? 'Customer payment' : 'Bill payment', name: (book.contactById[t.contactId] || {}).name || '', ref: t.number || t.checkNo || (bl && bl.checkNo) || '',
          amount: Math.abs(t.amount || t.total || 0), bank: accName(it.bankAccountId), doc: d.number || '', docDate: d.date, applied: a.amount, txnId: t.id, docId: d.id });
      });
    });
    var q = function (v) { v = String(v === null || v === undefined ? '' : v); return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var mdy = function (d) { return d ? d.slice(5, 7) + '/' + d.slice(8, 10) + '/' + d.slice(0, 4) : ''; };
    var csv = 'Date,Type,Customer or vendor,Payment no.,Payment amount,Bank account,Apply to,Invoice or bill date,Amount to apply\r\n'
      + rows.map(function (r) { return [mdy(r.date), r.kind, r.name, r.ref, money(r.amount), r.bank, r.doc, mdy(r.docDate), money(r.applied)].map(q).join(','); }).join('\r\n') + (rows.length ? '\r\n' : '');
    return { rows: rows, csv: csv, payments: U.sum(p.items.filter(function (it) { return it.txn.type === 'payment' || it.txn.type === 'billPayment'; }), function () { return 1; }) };
  };

  /** The batch file for the QuickBooks Desktop connector (tools/VaultBook-QB.ps1, Send mode; v1 payments-only batch): one entry per customer
   *  payment, with the bank account, and every invoice it pays by number and amount. The script looks each invoice up
   *  in QuickBooks and records the payment against it (qbXML ReceivePaymentAdd / AppliedToTxnAdd), which an .iif cannot.
   *  Amounts are strings with two decimals so nothing passes through floating point. Same choice of lines as paymentList.
   *  Bill payments are counted, not sent yet. */
  X.connectorBatch = function (book, opts) {
    var pl = X.paymentList(book, opts), by = {}, list = [], bills = {};
    pl.rows.forEach(function (r) {
      if (r.kind !== 'Customer payment') { bills[r.txnId] = 1; return; }
      var p = by[r.txnId];
      if (!p) {
        var t = book.txById[r.txnId];
        p = by[r.txnId] = { key: r.txnId, customer: qbName(r.name), date: r.date, amount: money(r.amount), depositTo: clean(r.bank), ref: clean(r.ref).slice(0, 20), memo: clean(X.appliedText(book, t)).slice(0, 4000), apply: [] };
        list.push(p);
      }
      p.apply.push({ invoice: clean(r.doc), invoiceDate: r.docDate, amount: money(r.applied) });
    });
    return { format: 'vaultbook-qb-batch', version: 1, company: clean(book.company && book.company.name), createdAt: opts.now || new Date().toISOString(), payments: list, billPayments: Object.keys(bills).length };
  };

  /** QuickBooks Online bank upload (3 columns: Date, Description, Amount) for ONE account: the bank lines as the bank
   *  sent them, posted lines only (QuickBooks Online then categorizes them in its own bank feed). Payments included. */
  X.bankCSV = function (book, opts) {
    var p = pick(book, Object.assign({}, opts, { payments: 'deposit' })), q = function (s) { s = String(s || ''); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    var lines = [].concat.apply([], p.items.map(function (it) { return it.lineIds.map(function (id) { return book.bankLineById[id]; }); }))
      .filter(function (l) { return l && (opts.accountIds || []).indexOf(l.accountId) >= 0; })
      .sort(function (x, y) { return x.date < y.date ? -1 : x.date > y.date ? 1 : (x.seq || 0) - (y.seq || 0); });
    var mdy = function (d) { return d.slice(5, 7) + '/' + d.slice(8, 10) + '/' + d.slice(0, 4); };
    var text = 'Date,Description,Amount\r\n' + lines.map(function (l) { return [mdy(l.date), q(l.description), money(l.amount)].join(','); }).join('\r\n') + (lines.length ? '\r\n' : '');
    return { text: text, txnCount: lines.length, lineIds: lines.map(function (l) { return l.id; }), skipped: p.skipped, byAccount: p.byAccount, format: 'csv' };
  };
})(typeof window !== 'undefined' ? window : globalThis);
