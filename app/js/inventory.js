/* VaultBook — inventory (perpetual, average cost) and fixed assets with depreciation (1.15).
 *
 * Inventory applies to items of type 'inventory' with trackQty on:
 *   purchases (bill, check, expense)  qty in,  value in  = line amount, line account = the item's asset account
 *   vendor credit, card credit        qty out, value out = line amount
 *   invoice, sales receipt            qty out, value out = qty × average cost on the document date (stored on the line as cost)
 *   credit memo                       qty in,  value in  = qty × average cost (stored as cost)
 *   inventory adjustment              qty ± and value ± (value defaults to qty × average cost)
 * Sales and credit memos post the stored cost between Cost of Goods Sold and the asset account (ledger.js buildSplits),
 * so every document still rebuilds to exactly the same splits. Average cost = asset value ÷ quantity, walked in date order.
 *
 * Fixed assets live on the company record (company.fixedAssets). Depreciation is posted as journal entries whose
 * lines carry assetId; what is recorded is always read back from those entries.
 */
(function (root) {
  'use strict';
  var OB = root.OB, U = OB.util, S = OB.schema, Book = OB.Book, R = OB.reports;
  function LedgerError(msg, field) { var e = new Error(msg); e.name = 'LedgerError'; e.field = field; return e; }

  var SALE = { invoice: -1, salesReceipt: -1, creditMemo: 1 };          // qty direction, valued at average cost
  var BUY = { bill: 1, check: 1, expense: 1, vendorCredit: -1, ccCredit: -1 }; // qty direction, valued at the line amount
  Book.INV_SALE = SALE; Book.INV_BUY = BUY;
  Book.prototype.tracked = function (itemId) { var it = itemId && this.itemById[itemId]; return it && it.type === 'inventory' && it.trackQty ? it : null; };

  /** Quantity and value moves of one posted document for tracked items: [{ itemId, qty, value }]. */
  Book.prototype.inventoryMoves = function (t) {
    var self = this, out = [];
    if (t.type === 'invAdjust') { (t.adjustments || []).forEach(function (a) { if (self.tracked(a.itemId)) out.push({ itemId: a.itemId, qty: a.qty || 0, value: a.value || 0 }); }); return out; }
    var dir = SALE[t.type] || BUY[t.type];
    if (!dir) return out;
    (t.lines || []).forEach(function (l) {
      if (!self.tracked(l.itemId) || l.qty === null || l.qty === undefined) return;
      var value = SALE[t.type] ? (l.cost || 0) : l.amount;
      out.push({ itemId: l.itemId, qty: dir * +l.qty, value: dir * value });
    });
    return out;
  };
  /** On-hand quantity, value and average cost per tracked item as of a date (inclusive). opts.exclude = a txn id to leave out. */
  Book.prototype.inventoryState = function (asOf, opts) {
    var self = this, st = {}, ex = opts && opts.exclude;
    this.items.forEach(function (it) { if (self.tracked(it.id)) st[it.id] = { itemId: it.id, qty: 0, value: 0, avg: 0, lastAvg: 0 }; });
    this.transactions.filter(function (t) { return t.status === 'posted' && t.id !== ex && (!asOf || t.date <= asOf); }).sort(Book.cmpTxn).forEach(function (t) {
      self.inventoryMoves(t).forEach(function (m) {
        var s = st[m.itemId]; if (!s) return;
        s.qty = Math.round((s.qty + m.qty) * 10000) / 10000; s.value += m.value;
        if (s.qty > 0) s.lastAvg = s.value / s.qty;
      });
    });
    Object.keys(st).forEach(function (k) { var s = st[k]; s.avg = s.qty > 0 ? s.value / s.qty : s.lastAvg; });
    return st;
  };

  /** Cost of `qty` units leaving (dir -1) or returning (dir +1) given the state before the document (CPA-03):
   *  units on hand go at the average cost; a shortfall (negative inventory allowed) at the item's standard cost,
   *  else the last average. */
  function lineCost(it, st, qty, dir) {
    var s = st[it.id] || { qty: 0, avg: 0, lastAvg: 0 }, q = Math.abs(+qty || 0), sign = (+qty || 0) < 0 ? -1 : 1;
    var std = it.cost !== null && it.cost !== undefined ? it.cost : s.lastAvg || 0;
    if (dir > 0 || sign < 0) return Math.round(q * (s.qty > 0 ? s.avg : std)) * sign;   // returns: back in at the current average
    var have = Math.max(0, Math.min(q, s.qty || 0));
    return Math.round(have * s.avg + (q - have) * std) * sign;
  }
  function applyMove(st, m) {
    var s = st[m.itemId]; if (!s) return;
    s.qty = Math.round((s.qty + m.qty) * 10000) / 10000; s.value += m.value;
    if (s.qty > 0) { s.lastAvg = s.value / s.qty; s.avg = s.lastAvg; } else s.avg = s.lastAvg;
  }
  /** Put costs on a document's sold / returned lines and default-valued adjustments from a state. Returns true if anything changed. */
  function costDoc(self, t, st, only) {
    var changed = false;
    if (SALE[t.type]) (t.lines || []).forEach(function (l) {
      var it = self.tracked(l.itemId); if (!it) { if (l.cost !== undefined && !only) { delete l.cost; changed = true; } return; }
      if (only && only.indexOf(it.id) < 0) return;
      var c = lineCost(it, st, l.qty, SALE[t.type]);
      if (l.cost !== c) { l.cost = c; changed = true; }
      l.cogsAccountId = it.expenseAccountId || (self.accounts.find(function (a) { return a.type === 'cogs'; }) || {}).id;
      l.assetAccountId = it.assetAccountId || (self.sys('INV') || {}).id;
    });
    if (t.type === 'invAdjust') t.adjustments.forEach(function (a) {
      if (only && only.indexOf(a.itemId) < 0) return;
      if (a.value === null || a.value === undefined || a.auto) {
        var it = self.tracked(a.itemId), s = st[a.itemId] || { avg: 0 };
        var v = it ? (a.qty < 0 ? lineCost(it, st, -a.qty, -1) * -1 : Math.round((a.qty || 0) * s.avg)) : 0;
        if (a.value !== v) { a.value = v; changed = true; }
        a.auto = true;    // valued at average cost, so a recost may revalue it
      }
    });
    return changed;
  }
  /** Called by saveTransaction before validation: put the average cost on sold / returned lines and adjustments. */
  Book.prototype._costInventory = function (t) {
    var self = this, need = (SALE[t.type] && (t.lines || []).some(function (l) { return self.tracked(l.itemId); })) || t.type === 'invAdjust';
    if (!need) return;
    costDoc(this, t, this.inventoryState(t.date, { exclude: t.id }));
  };

  /** Quantity each tracked item would reach at its lowest point from `t` onward, with and without `t` (CPA-03). */
  Book.prototype._lowestOnHand = function (t, prior) {
    var self = this, out = {}, mine = {};
    this.inventoryMoves(t).forEach(function (m) { mine[m.itemId] = (mine[m.itemId] || 0) + m.qty; });
    var theirs = {}; if (prior && prior.status === 'posted') this.inventoryMoves(prior).forEach(function (m) { theirs[m.itemId] = (theirs[m.itemId] || 0) + m.qty; });
    Object.keys(mine).forEach(function (id) {
      if (!(mine[id] < 0) && !(mine[id] < (theirs[id] || 0))) return;
      var docs = self.transactions.filter(function (x) { return x.status === 'posted' && x.id !== t.id; });
      var base = 0, later = [];
      docs.forEach(function (x) { self.inventoryMoves(x).forEach(function (m) { if (m.itemId !== id) return; if (x.date <= t.date) base += m.qty; else later.push({ date: x.date, qty: m.qty }); }); });
      later.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
      var low = function (own) { var q = base + own, min = q; later.forEach(function (m) { q += m.qty; if (q < min) min = q; }); return Math.round(min * 10000) / 10000; };
      var oldDate = prior && prior.status === 'posted' && prior.date !== t.date;
      out[id] = { onHand: Math.round(base * 10000) / 10000, withIt: low(mine[id]), without: oldDate ? -Infinity : low(theirs[id] || 0) };
    });
    return out;
  };

  /** Recalculate the stored cost of sales, returns and average-valued adjustments from `fromDate` (CPA-03).
   *  One atomic write and one audit entry. Documents in a closed period keep their cost; the difference goes into
   *  one value-only inventory adjustment dated the first day after the closing date. Resolves { changed, skipped, correction }. */
  Book.prototype.recostInventory = function (fromDate, itemIds, opts) {
    var self = this, only = itemIds && itemIds.length ? itemIds.slice() : null, closed = this.company.closingDate || '';
    var st = {}; this.items.forEach(function (it) { if (self.tracked(it.id)) st[it.id] = { itemId: it.id, qty: 0, value: 0, avg: 0, lastAvg: 0 }; });
    var now = new Date().toISOString(), changed = [], skipped = [], fix = {};
    this.transactions.filter(function (t) { return t.status === 'posted'; }).sort(Book.cmpTxn).forEach(function (t) {
      var costs = (SALE[t.type] || t.type === 'invAdjust') && t.date >= fromDate;
      if (costs) {
        var c = U.clone(t);
        if (costDoc(self, c, st, only)) {
          if (closed && t.date <= closed) {
            skipped.push(t.id);
            var was = {}; self.inventoryMoves(t).forEach(function (m) { was[m.itemId] = (was[m.itemId] || 0) + m.value; });
            self.inventoryMoves(c).forEach(function (m) { fix[m.itemId] = (fix[m.itemId] || 0) + m.value - (was[m.itemId] || 0); });
          } else {
            c.splits = self.buildSplits(c);
            c.splits.forEach(function (sp) { var m = t.splits.find(function (p) { return p.accountId === sp.accountId && p.amount === sp.amount && p.cleared; }); if (m) sp.cleared = m.cleared; });
            c.total = self.txnTotal(c); c.updatedAt = now; c.version = (t.version || 1) + 1;
            changed.push(c);
          }
          self.inventoryMoves(c).forEach(function (m) { applyMove(st, m); });   // carry the correct value forward
          return;
        }
      }
      self.inventoryMoves(t).forEach(function (m) { applyMove(st, m); });
    });
    var corr = null, fixIds = Object.keys(fix).filter(function (k) { return fix[k]; });
    if (fixIds.length) {
      var cogs = (self.accounts.find(function (a) { return a.type === 'cogs'; }) || {}).id;
      corr = self.normalize({ type: 'invAdjust', date: U.addDays(closed, 1), accountId: (self.itemById[fixIds[0]] || {}).expenseAccountId || cogs,
        memo: 'Inventory recost correction for closed period through ' + U.fmtDate(closed), adjustments: fixIds.map(function (k) { return { itemId: k, qty: 0, value: fix[k], memo: 'Recost' }; }) });
      corr.adjustments.forEach(function (a, i) { a.value = fix[fixIds[i]]; });
      corr.id = U.uid('txn'); corr.status = 'posted'; corr.createdAt = now; corr.updatedAt = now; corr.version = 1;
      corr.splits = self.buildSplits(corr); corr.total = self.txnTotal(corr);
    }
    if (!changed.length && !corr) return Promise.resolve({ changed: [], skipped: skipped, correction: null });
    var audit = this._auditEntry('recost', null, 'Inventory recosted from ' + U.fmtDate(fromDate) + ': ' + changed.length + ' document(s) updated' +
      (skipped.length ? ', ' + skipped.length + ' in the closed period kept (correction ' + U.fmt(U.sum(fixIds, function (k) { return fix[k]; }), { symbol: true }) + ' on ' + U.fmtDate(corr.date) + ')' : ''));
    var ops = changed.map(function (c) { return { store: 'transactions', value: c }; });
    if (corr) ops.push({ store: 'transactions', value: corr });
    ops.push({ store: 'audit', value: audit });
    return this._commit(ops, function () {
      changed.forEach(function (c) { self.transactions[self.transactions.indexOf(self.txById[c.id])] = c; });
      if (corr) self.transactions.push(corr);
      self.audit.push(audit);
    }).then(function () { return { changed: changed, skipped: skipped, correction: corr }; });
  };
  /** Validation rules for tracked items (hooked into Book.validate). */
  Book.prototype._validateInventory = function (t, prior, err) {
    var self = this;
    if (t.type === 'invAdjust') {
      this._checkOnHand(t, prior, err);
      t.adjustments.forEach(function (a, i) {
        var it = self.itemById[a.itemId];
        if (!it || !self.tracked(a.itemId)) err('Line ' + (i + 1) + ': choose an inventory item that tracks quantity on hand.', 'adjustments');
        else if (!self.accById[it.assetAccountId]) err('Item ' + it.name + ' has no inventory asset account.', 'adjustments');
        if (!isFinite(a.qty)) err('Line ' + (i + 1) + ': invalid quantity.', 'adjustments');
      });
      return;
    }
    var buy = BUY[t.type], sale = SALE[t.type];
    this._checkOnHand(t, prior, err);
    if (!buy && !sale) return;
    (t.lines || []).forEach(function (l, i) {
      var it = self.tracked(l.itemId); if (!it) return;
      if (l.qty === null || l.qty === undefined || !(+l.qty > 0)) err('Line ' + (i + 1) + ': enter the quantity of ' + it.name + ' (it tracks quantity on hand).', 'lines.' + i);
      if (buy && l.accountId !== it.assetAccountId) err('Line ' + (i + 1) + ': ' + it.name + ' is bought into ' + self.accountLabel(it.assetAccountId) + ' (its inventory asset account).', 'lines.' + i);
      if (sale && (!self.accById[it.assetAccountId] || !self.accById[it.expenseAccountId])) err('Item ' + it.name + ' needs an inventory asset account and a cost of goods sold account.', 'lines.' + i);
    });
  };

  /** CPA-03: refuse a document that takes an item below zero on hand (from its date on), unless the company allows it. */
  Book.prototype._checkOnHand = function (t, prior, err) {
    if (this.company.allowNegativeInventory) return;
    var self = this, low = this._lowestOnHand(t, prior);
    Object.keys(low).forEach(function (id) {
      var x = low[id], it = self.itemById[id];
      if (x.withIt < 0 && x.withIt < x.without) err('Only ' + Math.max(0, x.onHand) + ' of ' + (it ? it.name : 'this item') + ' on hand on ' + U.fmtDate(t.date) +
        ' — this would take it below zero. Enter the purchase first, or turn on "Allow negative inventory" in Settings.', 'lines');
    });
  };

  /* ---------- reports ---------- */
  /** Inventory Valuation Summary: qty on hand, average cost, asset value, % of value, sales price and retail value. */
  R.inventoryValuation = function (book, opts) {
    var st = book.inventoryState(opts.asOf), rows = book.items.filter(function (it) { return book.tracked(it.id); }).map(function (it) {
      var s = st[it.id]; return { itemId: it.id, name: it.name, sku: it.sku || '', qty: s.qty, avg: Math.round(s.avg), value: s.value, price: it.price, retail: it.price !== null && it.price !== undefined ? Math.round(s.qty * it.price) : null, assetAccountId: it.assetAccountId };
    }).sort(function (a, b) { return a.name.localeCompare(b.name, undefined, { numeric: true }); });
    var total = U.sum(rows, function (r) { return r.value; });
    rows.forEach(function (r) { r.pct = total ? r.value / total : 0; });
    var accIds = {}; rows.forEach(function (r) { if (r.assetAccountId) accIds[r.assetAccountId] = 1; });
    var ledger = U.sum(Object.keys(accIds), function (id) { return book.accountBalance(id, opts.asOf); });
    return { asOf: opts.asOf, rows: rows, total: total, retail: U.sum(rows, function (r) { return r.retail || 0; }), ledger: ledger, accounts: Object.keys(accIds) };
  };
  /** Inventory Stock Status: on hand, on open purchase orders, reorder point, and how many to order. */
  R.stockStatus = function (book, opts) {
    var st = book.inventoryState(opts.asOf), onPO = {};
    book.transactions.forEach(function (t) { if (t.type === 'purchaseOrder' && t.status === 'open') (t.lines || []).forEach(function (l) { if (book.tracked(l.itemId)) onPO[l.itemId] = (onPO[l.itemId] || 0) + (+l.qty || 0); }); });
    var rows = book.items.filter(function (it) { return book.tracked(it.id); }).map(function (it) {
      var q = st[it.id].qty, rp = it.reorderPoint === null || it.reorderPoint === undefined || it.reorderPoint === '' ? null : +it.reorderPoint, po = onPO[it.id] || 0;
      return { itemId: it.id, name: it.name, qty: q, onPO: po, reorderPoint: rp, order: rp !== null && q + po <= rp, negative: q < 0 };
    }).sort(function (a, b) { return a.name.localeCompare(b.name, undefined, { numeric: true }); });
    return { asOf: opts.asOf, rows: rows };
  };

  /* ---------- fixed assets ---------- */
  // IRS Pub. 946 Table A-1: MACRS GDS, 200%/150% declining balance, half-year convention (percent of cost by recovery year)
  Book.MACRS = {
    3: [33.33, 44.45, 14.81, 7.41],
    5: [20.00, 32.00, 19.20, 11.52, 11.52, 5.76],
    7: [14.29, 24.49, 17.49, 12.49, 8.93, 8.92, 8.93, 4.46],
    10: [10.00, 18.00, 14.40, 11.52, 9.22, 7.37, 6.55, 6.55, 6.56, 6.55, 3.28],
    15: [5.00, 9.50, 8.55, 7.70, 6.93, 6.23, 5.90, 5.90, 5.91, 5.90, 5.91, 5.90, 5.91, 5.90, 5.91, 2.95],
    20: [3.750, 7.219, 6.677, 6.177, 5.713, 5.285, 4.888, 4.522, 4.462, 4.461, 4.462, 4.461, 4.462, 4.461, 4.462, 4.461, 4.462, 4.461, 4.462, 4.461, 2.231]
  };
  /* CPA-11: MACRS percentage table built the way Pub. 946 builds it (200% DB, 150% for 15/20-yr, switching to straight line),
     given the first-year fraction: 0.5 = half-year (reproduces Table A-1), 0.875/0.625/0.375/0.125 = mid-quarter Q1–Q4 (Tables A-2–A-5). */
  function macrsTable(cls, f) {
    // percentages to 2 places (3 for 20-yr), each year figured on the rounded remaining basis, like the published tables
    var m = Math.pow(10, cls === 20 ? 3 : 2), rate = (cls >= 15 ? 1.5 : 2) / cls, left = 100 * m, life = cls, out = [], k = 0;
    while (left > 0) {
      var frac = k === 0 ? f : Math.min(1, life), amt;
      if (k > 0 && life <= 1) amt = left;
      else amt = Math.min(left, Math.round(Math.max(left * rate * frac, left * frac / life) + 1e-6));
      out.push(amt / m); left -= amt; life -= frac; k++;
    }
    return out;
  }
  Book.macrsTable = macrsTable;
  Book.MACRS_MQ = {};
  Object.keys(Book.MACRS).forEach(function (c) { Book.MACRS_MQ[c] = [0.875, 0.625, 0.375, 0.125].map(function (f) { return macrsTable(+c, f); }); });
  function monthEnd(y, m) { var d = new Date(Date.UTC(y, m + 1, 0)); return d.toISOString().slice(0, 10); }
  /** Full depreciation schedule: [{ date, amount }] (month ends for SL / DDB; Dec 31 for MACRS). Sums exactly to the depreciable base.
      MACRS uses the asset's convention (HY default, MQ = mid-quarter by in-service quarter); a disposal before the last recovery year
      gets the disposal-year convention (half a year, or the mid-quarter fraction) and nothing after it (CPA-11). */
  Book.depSchedule = function (a) {
    var out = [], y = +a.inService.slice(0, 4), m = +a.inService.slice(5, 7) - 1, cost = a.cost, salvage = a.method === 'MACRS' ? 0 : (a.salvage || 0), base = cost - salvage;
    if (!(base > 0)) return out;
    if (a.method === 'MACRS') {
      var mq = a.convention === 'MQ', tab = mq ? (Book.MACRS_MQ[a.macrsClass] || [])[Math.floor(m / 3)] : Book.MACRS[a.macrsClass]; if (!tab) return out;
      var done = 0, dy = a.disposed ? +a.disposed.slice(0, 4) : 0, dq = a.disposed ? Math.floor((+a.disposed.slice(5, 7) - 1) / 3) : 0;
      for (var j = 0; j < tab.length; j++) {
        var amt = j === tab.length - 1 ? base - done : Math.round(cost * tab[j] / 100);
        if (dy && y + j === dy) {
          if (j === 0) break; // placed in service and disposed in the same year: no depreciation
          if (j < tab.length - 1) amt = Math.round(amt * (mq ? (dq + 0.5) / 4 : 0.5));
          out.push({ date: a.disposed, amount: amt }); break;
        }
        done += amt; out.push({ date: (y + j) + '-12-31', amount: amt });
      }
      return out.filter(function (x) { return x.amount; });
    }
    var n = Math.max(1, Math.round(a.lifeMonths || 0)), book = cost, acc = 0;
    for (var k = 0; k < n; k++) {
      var amt;
      if (a.method === 'DDB') {
        var left = n - k, ddb = book * 2 / n, sl = (book - salvage) / left;
        amt = k === n - 1 ? base - acc : Math.round(Math.max(ddb, sl));
        amt = Math.min(amt, book - salvage - 0);
      } else amt = Math.round((k + 1) * base / n) - Math.round(k * base / n);
      if (amt <= 0 && k < n - 1) amt = 0;
      acc += amt; book -= amt;
      var mm = m + k; out.push({ date: monthEnd(y + Math.floor(mm / 12), mm % 12), amount: amt });
    }
    return out.filter(function (x) { return x.amount; });
  };
  Book.prototype.fixedAssetById = function (id) { return (this.company.fixedAssets || []).find(function (x) { return x.id === id; }) || null; };
  /** Depreciation already posted for an asset (journal lines with its assetId crediting accumulated depreciation). */
  Book.prototype.depreciationRecorded = function (assetId, asOf, withDisposal) {
    var a = this.fixedAssetById(assetId); if (!a) return 0;
    return U.sum(this.posted().filter(function (t) { return t.type === 'journal' && (!asOf || t.date <= asOf) && (withDisposal || !t.disposal); }), function (t) {
      return U.sum((t.jlines || []).filter(function (l) { return l.assetId === assetId && l.accountId === a.accumAccountId; }), function (l) { return (l.credit || 0) - (l.debit || 0); });
    });
  };
  Book.prototype.depreciationDue = function (asOf) {
    var self = this;
    return (this.company.fixedAssets || []).filter(function (a) { return a.active !== false && !self.disposalOf(a); }).map(function (a) {
      var stop = a.disposed && a.disposed < asOf ? a.disposed : asOf;
      var scheduled = U.sum(Book.depSchedule(a).filter(function (x) { return x.date <= stop; }), function (x) { return x.amount; });
      var recorded = self.depreciationRecorded(a.id);
      return { assetId: a.id, name: a.name, scheduled: scheduled, recorded: recorded, due: scheduled - recorded };
    }).filter(function (r) { return r.due !== 0; });
  };
  /** The posted disposal journal entry of an asset, if any (CPA-11). */
  Book.prototype.disposalOf = function (a, asOf) {
    var t = a && a.disposalId ? this.txById[a.disposalId] : null;
    return t && t.status === 'posted' && (!asOf || t.date <= asOf) ? t : null;
  };
  Book.prototype.saveFixedAsset = function (input) {
    var self = this, c = U.clone(this.company), list = c.fixedAssets = c.fixedAssets || [];
    var existing = input.id ? list.find(function (x) { return x.id === input.id; }) : null;
    if (input.id && !existing) return Promise.reject(LedgerError('Fixed asset not found.'));
    var name = String(input.name || '').trim(); if (!name) return Promise.reject(LedgerError('Name the asset.', 'name'));
    if (!U.isDate(input.inService)) return Promise.reject(LedgerError('Enter the date the asset was placed in service.', 'inService'));
    var cost = input.cost === undefined || input.cost === '' ? NaN : (typeof input.cost === 'number' ? input.cost : U.toCents(input.cost));
    if (!(cost > 0)) return Promise.reject(LedgerError('Enter the cost.', 'cost'));
    var salvage = input.salvage === undefined || input.salvage === '' ? 0 : (typeof input.salvage === 'number' ? input.salvage : U.toCents(input.salvage));
    if (salvage < 0 || salvage >= cost) return Promise.reject(LedgerError('Salvage value must be less than the cost.', 'salvage'));
    var method = input.method || 'SL';
    if (['SL', 'DDB', 'MACRS'].indexOf(method) < 0) return Promise.reject(LedgerError('Choose a depreciation method.', 'method'));
    var life = Math.round(+input.lifeMonths || 0), cls = +input.macrsClass || 0;
    if (method !== 'MACRS' && !(life >= 1 && life <= 600)) return Promise.reject(LedgerError('Enter the useful life (1–600 months).', 'lifeMonths'));
    if (method === 'MACRS' && !Book.MACRS[cls]) return Promise.reject(LedgerError('Choose the MACRS recovery period (3, 5, 7, 10, 15 or 20 years).', 'macrsClass'));
    var chk = function (id, types, label) { var a = self.accById[id]; if (!a || types.indexOf(a.type) < 0) throw LedgerError('Choose the ' + label + '.', label); return a.id; };
    var acc;
    try { acc = { accountId: chk(input.accountId, ['fixed', 'oa'], 'asset account'), accumAccountId: chk(input.accumAccountId, ['fixed', 'oa'], 'accumulated depreciation account'), expenseAccountId: chk(input.expenseAccountId, ['expense', 'oe'], 'depreciation expense account') }; }
    catch (e) { return Promise.reject(e); }
    if (acc.accountId === acc.accumAccountId) return Promise.reject(LedgerError('Use a separate account for accumulated depreciation.', 'accumAccountId'));
    if (input.disposed && !U.isDate(input.disposed)) return Promise.reject(LedgerError('Invalid disposal date.', 'disposed'));
    // CPA-11: tax depreciation can differ from the book method that posts (optional; '' = same as book)
    var taxMethod = input.taxMethod || '', taxClass = +input.taxClass || 0, conv = input.convention === 'MQ' ? 'MQ' : '';
    if (taxMethod && taxMethod !== 'MACRS') return Promise.reject(LedgerError('The tax method can only be MACRS.', 'taxMethod'));
    if (taxMethod && !Book.MACRS[taxClass]) return Promise.reject(LedgerError('Choose the MACRS recovery period for tax.', 'taxClass'));
    var a = existing ? U.clone(existing) : { id: U.uid('fa'), active: true, createdAt: new Date().toISOString() };
    Object.assign(a, acc, { name: name, description: String(input.description || ''), inService: input.inService, cost: cost, salvage: method === 'MACRS' ? 0 : salvage, method: method, lifeMonths: method === 'MACRS' ? 0 : life, macrsClass: method === 'MACRS' ? cls : 0, disposed: input.disposed || '' });
    if (taxMethod) { a.taxMethod = taxMethod; a.taxClass = taxClass; } else { delete a.taxMethod; delete a.taxClass; }
    if (conv) a.convention = conv; else delete a.convention;
    if (input.disposalId !== undefined) { if (input.disposalId) a.disposalId = String(input.disposalId); else delete a.disposalId; }
    if (input.active !== undefined) a.active = !!input.active;
    if (existing) list[list.indexOf(existing)] = a; else list.push(a);
    var audit = this._auditEntry(existing ? 'edit-asset' : 'create-asset', null, (existing ? 'Edited' : 'Added') + ' fixed asset ' + a.name + ' ' + U.fmt(a.cost, { symbol: true }), existing ? U.clone(existing) : null);
    return this._commit([{ store: 'company', value: c }, { store: 'audit', value: audit }], function () { self.company = c; self.audit.push(audit); }).then(function () { return a; });
  };
  /** Post one journal entry with the depreciation due through asOf for every asset (debit expense, credit accumulated). */
  Book.prototype.recordDepreciation = function (asOf, ids) {
    var self = this, due = this.depreciationDue(asOf).filter(function (r) { return !ids || ids.indexOf(r.assetId) >= 0; });
    if (!due.length) return Promise.reject(LedgerError('No depreciation is due through ' + U.fmtDate(asOf) + '.'));
    var jl = [];
    due.forEach(function (r) {
      var a = self.fixedAssetById(r.assetId), memo = 'Depreciation — ' + a.name;
      if (r.due > 0) { jl.push({ accountId: a.expenseAccountId, debit: r.due, credit: 0, memo: memo, assetId: a.id }); jl.push({ accountId: a.accumAccountId, debit: 0, credit: r.due, memo: memo, assetId: a.id }); }
      else { jl.push({ accountId: a.accumAccountId, debit: -r.due, credit: 0, memo: memo + ' (correction)', assetId: a.id }); jl.push({ accountId: a.expenseAccountId, debit: 0, credit: -r.due, memo: memo + ' (correction)', assetId: a.id }); }
    });
    return this.saveTransaction({ type: 'journal', date: asOf, memo: 'Depreciation through ' + U.fmtDate(asOf), depreciation: true, jlines: jl });
  };
  /** Dispose of (sell or scrap) a fixed asset (CPA-11): record depreciation through the disposal date, then one journal entry
      that clears its cost and accumulated depreciation, records the proceeds, and books the difference to Gain/Loss on Sale of Assets. */
  Book.prototype.disposeFixedAsset = function (id, opts) {
    var self = this, a = this.fixedAssetById(id); opts = opts || {};
    if (!a) return Promise.reject(LedgerError('Fixed asset not found.'));
    if (this.disposalOf(a)) return Promise.reject(LedgerError(a.name + ' has already been disposed of.'));
    var date = opts.date, proceeds = opts.proceeds === undefined || opts.proceeds === '' ? 0 : (typeof opts.proceeds === 'number' ? opts.proceeds : U.toCents(opts.proceeds));
    if (!U.isDate(date)) return Promise.reject(LedgerError('Enter the disposal date.', 'date'));
    if (date < a.inService) return Promise.reject(LedgerError('The disposal date is before the asset was placed in service.', 'date'));
    if (!(proceeds >= 0)) return Promise.reject(LedgerError('Proceeds cannot be negative.', 'proceeds'));
    var dep = proceeds ? this.accById[opts.depositAccountId] : null;
    if (proceeds && (!dep || !(S.TYPE[dep.type].cash || dep.type === 'oca' || dep === this.sys('UNDEP')))) return Promise.reject(LedgerError('Choose the account the proceeds went to.', 'depositAccountId'));
    if (this.company.closingDate && date <= this.company.closingDate) return Promise.reject(LedgerError('The disposal date is in a closed period.', 'date'));
    var gainAcc;
    return this.ensureAccount('GAINSALE', /gain\/loss on sale/i, 7100, 'Gain/Loss on Sale of Assets', 'oi')
      .then(function (g) { gainAcc = g; return self.saveFixedAsset(Object.assign({}, a, { disposed: date })); })
      .then(function (a2) {
        a = a2;
        return self.depreciationDue(date).some(function (r) { return r.assetId === id; }) ? self.recordDepreciation(date, [id]) : null;
      })
      .then(function () {
        var acc = self.depreciationRecorded(id, date), memo = 'Disposal — ' + a.name, gain = proceeds + acc - a.cost, jl = [];
        if (acc) jl.push({ accountId: a.accumAccountId, debit: acc > 0 ? acc : 0, credit: acc < 0 ? -acc : 0, memo: memo, assetId: id });
        if (proceeds) jl.push({ accountId: dep.id, debit: proceeds, credit: 0, memo: memo });
        jl.push({ accountId: a.accountId, debit: 0, credit: a.cost, memo: memo, assetId: id });
        if (gain) jl.push({ accountId: gainAcc.id, debit: gain < 0 ? -gain : 0, credit: gain > 0 ? gain : 0, memo: memo + (gain > 0 ? ' (gain)' : ' (loss)') });
        return self.saveTransaction({ type: 'journal', date: date, memo: memo, disposal: id, jlines: jl })
          .then(function (t) { return self.saveFixedAsset(Object.assign({}, a, { disposalId: t.id })).then(function () { return { disposal: t, gain: gain }; }); });
      });
  };
  /** Mid-quarter test (Pub. 946): more than 40% of the year's MACRS basis placed in service in the last quarter. */
  R.macrsConventionCheck = function (book, year) {
    var total = 0, q4 = 0;
    (book.company.fixedAssets || []).forEach(function (a) {
      if ((a.taxMethod || a.method) !== 'MACRS' || +a.inService.slice(0, 4) !== +year) return;
      total += a.cost; if (+a.inService.slice(5, 7) >= 10) q4 += a.cost;
    });
    var share = total ? q4 / total : 0;
    return { year: +year, basis: total, q4Basis: q4, q4Share: share, midQuarter: share > 0.4,
      message: share > 0.4 ? Math.round(share * 100) + '% of ' + year + ' MACRS basis was placed in service in the last quarter; the mid-quarter convention applies.' : '' };
  };
  R.fixedAssets = function (book, opts) {
    var asOf = opts.asOf, fyStart = U.fiscalYearStart(asOf, book.company.fiscalYearStartMonth || 1), ys = asOf.slice(0, 4) + '-01-01';
    var rows = (book.company.fixedAssets || []).map(function (a) {
      var sch = Book.depSchedule(a), stop = a.disposed && a.disposed < asOf ? a.disposed : asOf, gone = book.disposalOf(a, asOf);
      var scheduled = U.sum(sch.filter(function (x) { return x.date <= stop; }), function (x) { return x.amount; });
      var thisYear = U.sum(sch.filter(function (x) { return x.date >= fyStart && x.date <= stop; }), function (x) { return x.amount; });
      var taxA = a.taxMethod ? Object.assign({}, a, { method: 'MACRS', macrsClass: a.taxClass, salvage: 0 }) : a.method === 'MACRS' ? a : null;
      var taxThisYear = taxA ? U.sum(Book.depSchedule(taxA).filter(function (x) { return x.date >= ys && x.date <= stop; }), function (x) { return x.amount; }) : null;
      var posted = book.depreciationRecorded(a.id, asOf), recorded = gone ? book.depreciationRecorded(a.id, asOf, true) : posted, cost = gone ? 0 : a.cost;
      return { assetId: a.id, name: a.name, inService: a.inService, method: a.method === 'MACRS' ? 'MACRS ' + a.macrsClass + '-yr' + (a.convention === 'MQ' ? ' MQ' : '') : a.method === 'DDB' ? 'Double-declining ' + Math.round(a.lifeMonths / 12 * 10) / 10 + ' yr' : 'Straight-line ' + Math.round(a.lifeMonths / 12 * 10) / 10 + ' yr',
        taxMethod: a.taxMethod ? 'MACRS ' + a.taxClass + '-yr' : '', taxThisYear: taxThisYear,
        cost: cost, salvage: a.salvage, recorded: recorded, bookValue: cost - recorded, scheduled: scheduled, unrecorded: gone ? 0 : scheduled - posted, thisYear: thisYear, disposed: a.disposed || '', disposalId: gone ? gone.id : '' };
    }).sort(function (x, y) { return x.inService < y.inService ? -1 : 1; });
    // register vs general ledger: the asset and accumulated depreciation accounts the register uses
    var accs = {}, accums = {};
    (book.company.fixedAssets || []).forEach(function (a) { accs[a.accountId] = 1; accums[a.accumAccountId] = 1; });
    var gl = function (ids, sign) { return U.sum(Object.keys(ids), function (id) { return sign * book.rawBalance(id, asOf); }); };
    var reg = U.sum(rows, function (r) { return r.cost; }), regAcc = U.sum(rows, function (r) { return r.recorded; }), led = gl(accs, 1), ledAcc = gl(accums, -1);
    return { asOf: asOf, rows: rows, cost: reg, recorded: regAcc, bookValue: U.sum(rows, function (r) { return r.bookValue; }), unrecorded: U.sum(rows, function (r) { return r.unrecorded; }),
      reconcile: { register: reg, ledger: led, difference: reg - led, accumRegister: regAcc, accumLedger: ledAcc, accumDifference: regAcc - ledAcc } };
  };

  /* CPA-03: saving, editing or voiding a document that moves an item, dated before that item's latest movement,
     recosts the later sales (after the save, in its own atomic write). */
  Book.prototype._recostAfter = function (docs) {
    var self = this, items = {}, from = '';
    docs.forEach(function (t) { if (!t) return; self.inventoryMoves(t).forEach(function (m) { items[m.itemId] = 1; if (!from || t.date < from) from = t.date; }); });
    var ids = Object.keys(items); if (!ids.length) return Promise.resolve(null);
    var later = this.transactions.some(function (x) { return x.status === 'posted' && x.date > from && self.inventoryMoves(x).some(function (m) { return items[m.itemId]; }); });
    return later ? this.recostInventory(from, ids) : Promise.resolve(null);
  };
  ['saveTransaction', 'voidTransaction'].forEach(function (name) {
    var pub = Book.prototype[name];
    Book.prototype[name] = function (a) {
      var self = this, before = name === 'voidTransaction' ? this.txById[a] : a && a.id && this.txById[a.id];
      before = before ? U.clone(before) : null;
      return pub.apply(this, arguments).then(function (t) {
        return self._recostAfter([name === 'voidTransaction' ? null : t, before]).then(function () { return (t && self.txById[t.id]) || t; });
      });
    };
  });

  // CPA-11: voiding a disposal entry puts the asset back in service (disposeFixedAsset itself is not queued: it composes queued calls)
  (function () {
    var pub = Book.prototype.voidTransaction;
    Book.prototype.voidTransaction = function (id) {
      var self = this, t = this.txById[id], aid = t && t.type === 'journal' && t.disposal;
      return pub.apply(this, arguments).then(function (r) {
        var a = aid && self.fixedAssetById(aid);
        return a && a.disposalId === id ? self.saveFixedAsset(Object.assign({}, a, { disposed: '', disposalId: '' })).then(function () { return r; }) : r;
      });
    };
  })();

  ['saveFixedAsset', 'recostInventory'].forEach(function (name) {
    var raw = Book.prototype[name]; Book.prototype['_raw_' + name] = raw;
    Book.prototype[name] = function () { var self = this, args = arguments, p = this._queue.then(function () { return raw.apply(self, args); }); this._queue = p.catch(function () {}); return p; };
  });
})(typeof window !== 'undefined' ? window : globalThis);
