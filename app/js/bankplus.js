/* VaultBook — bank feed, part 2 (1.23):
 *  1. Rules v2: several conditions (description and amount, all/any), bank accounts, direction, split by percent
 *     or amount, class, memo, auto-add, and a preview of the lines a rule catches.
 *  2. One bank line to several book entries: a deposit of payments waiting in Undeposited Funds (a Deposit is
 *     created), or several entries already in the bank account that add up to the bank line ("group" match).
 *  3. Already in the books: on import, lines that are clearly the same as an entry already in the account (same
 *     amount, close date or the same check number) are matched to it instead of waiting to be added again.
 * Amounts are integer cents; bank line amounts are + money in, − money out. Every posting still goes through
 * the ledger's validation; every change is one commit with an audit entry.
 */
(function (root) {
  'use strict';
  var OB = root.OB, U = OB.util, S = OB.schema, I = OB.importer, Book = OB.Book, LedgerError = OB.LedgerError;
  var B = OB.bankplus = {};
  var queued = function (raw) { return function () { var self = this, args = arguments, p = this._queue.then(function () { return raw.apply(self, args); }); this._queue = p.catch(function () {}); return p; }; };

  /* ======================= 1. Rules v2 ======================= */
  var DESC_OPS = { contains: 1, notContains: 1, equals: 1, starts: 1, ends: 1 }, AMT_OPS = { eq: 1, gt: 1, lt: 1, between: 1 };
  /** The conditions of a rule (older rules keep their single "contains"). */
  B.conditions = function (r) {
    if (r.conditions && r.conditions.length) return r.conditions;
    return r.contains ? [{ field: 'desc', op: 'contains', value: r.contains }] : [];
  };
  function test(c, desc, amount) {
    if (c.field === 'amount') {
      var a = Math.abs(amount), v = +c.value || 0, v2 = +c.value2 || 0;
      return c.op === 'eq' ? a === v : c.op === 'gt' ? a > v : c.op === 'lt' ? a < v : c.op === 'between' ? a >= Math.min(v, v2) && a <= Math.max(v, v2) : false;
    }
    var d = String(desc || '').toLowerCase().replace(/\s+/g, ' ').trim(), t = String(c.value || '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (!t) return false;
    return c.op === 'notContains' ? d.indexOf(t) < 0 : c.op === 'equals' ? d === t : c.op === 'starts' ? d.indexOf(t) === 0 : c.op === 'ends' ? d.slice(-t.length) === t : d.indexOf(t) >= 0;
  }
  /** Does rule r catch a bank line? (description, amount ±cents, bank account id) */
  B.ruleMatches = function (r, desc, amount, accountId) {
    if (!r || r.deleted || r.active === false) return false;
    if (r.direction === 'in' && !(amount > 0)) return false;
    if (r.direction === 'out' && !(amount < 0)) return false;
    if (r.accountIds && r.accountIds.length && accountId && r.accountIds.indexOf(accountId) < 0) return false;
    var cs = B.conditions(r); if (!cs.length) return false;
    return r.match === 'any' ? cs.some(function (c) { return test(c, desc, amount); }) : cs.every(function (c) { return test(c, desc, amount); });
  };
  /** Split lines for an amount: fixed amounts first, percentages share the rest (the last percent line takes the
   *  rounding). Returns [{accountId, amount, memo, classId}] or null when the rule cannot split this amount. */
  B.splitFor = function (r, abs) {
    if (!r.splits || r.splits.length < 2) return null;
    var fixed = r.splits.filter(function (x) { return x.kind === 'amount'; }), pct = r.splits.filter(function (x) { return x.kind !== 'amount'; });
    var fixedSum = U.sum(fixed, function (x) { return +x.amount || 0; }), rest = abs - fixedSum;
    if (rest < 0 || (!pct.length && rest !== 0)) return null;
    var pctTotal = U.sum(pct, function (x) { return +x.pct || 0; });
    if (pct.length && Math.abs(pctTotal - 100) > 0.0001) return null;
    var used = 0, lastPct = pct[pct.length - 1];
    var out = r.splits.map(function (x) {
      var amt = x.kind === 'amount' ? +x.amount : (x === lastPct ? rest - used : Math.round(rest * (+x.pct || 0) / 100));
      if (x.kind !== 'amount' && x !== lastPct) used += amt;
      return { accountId: x.accountId, amount: amt, memo: x.memo || '', classId: x.classId || '' };
    }).filter(function (x) { return x.amount !== 0; });
    if (out.some(function (x) { return x.amount < 0; })) return null;
    return out.length >= 2 ? out : null;
  };

  /** First active rule that catches the line, highest priority first (accountId optional for old callers). */
  Book.prototype.matchRule = function (description, amount, accountId) {
    var self = this, list = this.rules.filter(function (r) { return r.active !== false && !r.deleted; }).sort(function (a, b) { return (b.priority || 0) - (a.priority || 0); });
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      if (!B.ruleMatches(r, description, amount, accountId)) continue;
      if (r.splits && r.splits.length >= 2) { if (r.splits.every(function (x) { return self.accById[x.accountId] && self.accById[x.accountId].active !== false; })) return r; continue; }
      if (this.accById[r.accountId] && this.accById[r.accountId].active !== false) return r;
    }
    return null;
  };

  function normRule(book, input, existing) {
    var conds = (input.conditions && input.conditions.length ? input.conditions : (input.contains ? [{ field: 'desc', op: 'contains', value: input.contains }] : []))
      .map(function (c) {
        if (c.field === 'amount') {
          var v = typeof c.value === 'number' ? c.value : U.toCents(String(c.value || '').replace(/[$,\s]/g, '') || '0');
          var v2 = c.op === 'between' ? (typeof c.value2 === 'number' ? c.value2 : U.toCents(String(c.value2 || '').replace(/[$,\s]/g, '') || '0')) : 0;
          return { field: 'amount', op: AMT_OPS[c.op] ? c.op : 'eq', value: Math.abs(v), value2: Math.abs(v2) };
        }
        return { field: 'desc', op: DESC_OPS[c.op] ? c.op : 'contains', value: String(c.value || '').trim() };
      }).filter(function (c) { return c.field === 'amount' ? c.value > 0 || c.op === 'gt' : c.value; });
    if (!conds.length) throw LedgerError('Add at least one condition, such as “description contains COMCAST”.', 'conditions');
    if (!conds.some(function (c) { return c.field === 'desc' && c.op !== 'notContains'; }) && !conds.some(function (c) { return c.field === 'amount' && c.op === 'eq'; }))
      throw LedgerError('Include a description that must appear (or an exact amount), so the rule does not catch every line.', 'conditions');
    var splits = (input.splits || []).map(function (x) {
      var kind = x.kind === 'amount' ? 'amount' : 'pct';
      return { accountId: x.accountId || '', kind: kind, pct: kind === 'pct' ? +String(x.pct || 0).replace('%', '') : 0, amount: kind === 'amount' ? (typeof x.amount === 'number' ? x.amount : U.toCents(String(x.amount || '0').replace(/[$,\s]/g, '') || '0')) : 0, memo: String(x.memo || '').trim(), classId: x.classId || '' };
    }).filter(function (x) { return x.accountId || x.pct || x.amount; });
    var bad = function (id) { var a = book.accById[id]; return !a || a.type === 'ar' || a.type === 'ap'; };
    if (splits.length === 1) throw LedgerError('A split needs at least two lines, or use one category.', 'splits');
    if (splits.length) {
      if (splits.some(function (x) { return bad(x.accountId); })) throw LedgerError('Choose a category for every split line (not A/R or A/P).', 'splits');
      var pct = splits.filter(function (x) { return x.kind === 'pct'; });
      if (pct.length && Math.abs(U.sum(pct, function (x) { return x.pct; }) - 100) > 0.0001) throw LedgerError('The percent lines must add up to 100%.', 'splits');
      if (!pct.length) throw LedgerError('At least one split line must be a percent, so it takes the rest of each amount.', 'splits');
    } else {
      if (!book.accById[input.accountId]) throw LedgerError('Choose a category account.', 'accountId');
      if (bad(input.accountId)) throw LedgerError('Rules cannot categorize to A/R or A/P.', 'accountId');
    }
    var firstDesc = conds.find(function (c) { return c.field === 'desc' && c.op === 'contains'; });
    return { id: existing ? existing.id : U.uid('rule'), name: String(input.name || (firstDesc ? firstDesc.value : 'Rule')).trim(),
      contains: firstDesc ? firstDesc.value : '', conditions: conds, match: input.match === 'any' ? 'any' : 'all',
      direction: ['in', 'out'].indexOf(input.direction) >= 0 ? input.direction : 'any', accountIds: (input.accountIds || []).filter(function (id) { return book.accById[id]; }),
      accountId: splits.length ? splits[0].accountId : input.accountId, splits: splits.length ? splits : undefined, contactId: input.contactId || '', classId: input.classId || '', memo: String(input.memo || '').trim(),
      autoAdd: !!input.autoAdd, priority: +input.priority || 0, active: input.active !== false, createdAt: existing && existing.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
  }
  B.normRule = normRule;
  var saveRule = function (input) {
    var self = this, existing = input.id ? this.rules.find(function (r) { return r.id === input.id; }) : null, r;
    try { r = normRule(this, input, existing); } catch (e) { return Promise.reject(e); }
    if (r.splits === undefined) delete r.splits;
    return this._commit([{ store: 'rules', value: r }], function () { if (existing) self.rules[self.rules.indexOf(existing)] = r; else self.rules.push(r); }).then(function () { return r; });
  };
  Book.prototype._raw_saveRule = saveRule; Book.prototype.saveRule = queued(saveRule);

  /** What a rule (saved or being edited) would catch: { review: [lines in For review], posted: n, other: [rules that come first] }. */
  Book.prototype.rulePreview = function (input) {
    var r, actionError = '';
    try { r = normRule(this, input, null); } catch (e) {
      if (e.field !== 'accountId' && e.field !== 'splits') return { error: e.message, review: [], posted: 0, earlier: 0 };
      actionError = e.message;   // the conditions are fine: still show what they catch
      var any = this.accounts.find(function (a) { return a.type === 'expense' && a.active !== false; });
      try { r = normRule(this, Object.assign({}, input, { splits: [], accountId: any && any.id }), null); } catch (e2) { return { error: e2.message, review: [], posted: 0, earlier: 0 }; }
    }
    var self = this, review = [], posted = 0, earlier = 0;
    (this.bankLines || []).forEach(function (l) {
      if (l.status !== 'review' && l.status !== 'posted') return;
      if (!B.ruleMatches(r, l.description, l.amount, l.accountId)) return;
      if (l.status === 'posted') { posted++; return; }
      var first = self.matchRule(l.description, l.amount, l.accountId);
      if (first && first.id !== input.id && (first.priority || 0) > r.priority) earlier++;
      review.push(l);
    });
    return { review: review, posted: posted, earlier: earlier, actionError: actionError };
  };

  // suggestions now pass the bank account (rules limited to accounts) and carry a rule's split, class and memo
  var suggestion0 = Book.prototype.bankSuggestion;
  Book.prototype.bankSuggestion = function (lineId) {
    var l = this.bankLineById[lineId]; if (!l) return null;
    var r = this.matchRule(l.description, l.amount, l.accountId);
    if (r) {
      var sp = B.splitFor(r, Math.abs(l.amount));
      if (r.splits && !sp) r = null;   // a split this amount cannot carry: fall back to history
      else return { categoryId: r.accountId, contactId: r.contactId || '', classId: r.classId || '', memo: r.memo || '', splits: sp, autoAdd: !!r.autoAdd, source: 'rule', ruleId: r.id, reason: 'Rule: ' + (r.name || r.contains) };
    }
    var old = suggestion0.call(Object.create(this, { matchRule: { value: function () { return null; } } }), lineId);
    return old;
  };

  /* ======================= 2. Several entries for one bank line ======================= */
  /** Subsets of items (same-sign cents) whose amounts add up to target; up to `want` solutions, sizes min..max. */
  B.subsets = function (items, target, opts) {
    opts = opts || {};
    var min = opts.min || 2, max = opts.max || 6, want = opts.want || 2, budget = opts.budget || 60000;
    var list = items.slice().sort(function (a, b) { return Math.abs(b.amount) - Math.abs(a.amount); }), n = list.length, out = [];
    var T = Math.abs(target), abs = list.map(function (x) { return Math.abs(x.amount); }), suffix = new Array(n + 1); suffix[n] = 0;
    for (var i = n - 1; i >= 0; i--) suffix[i] = suffix[i + 1] + abs[i];
    var pick = [];
    (function dfs(start, sum) {
      if (out.length >= want || budget-- <= 0) return;
      if (sum === T && pick.length >= min) { out.push(pick.map(function (k) { return list[k]; })); return; }
      if (pick.length >= max || sum + suffix[start] < T) return;
      for (var k = start; k < n && out.length < want; k++) {
        if (sum + abs[k] > T) continue;
        pick.push(k); dfs(k + 1, sum + abs[k]); pick.pop();
      }
    })(0, 0);
    return out;
  };

  var cands0 = Book.prototype.bankCandidates;
  Book.prototype.bankCandidates = function (lineId) {
    var mm = this._bfMemo || (this._bfMemo = { cands: {}, win: {}, docs: {} });
    return mm.cands[lineId] || (mm.cands[lineId] = allCandidates.call(this, lineId));
  };
  function allCandidates(lineId) {
    var self = this, l = this.bankLineById[lineId];
    var out = cands0.call(this, lineId); if (!l || l.status !== 'review') return out;
    var linked = this._bankLinked(), acc = this.accById[l.accountId];
    // (a) payments and receipts waiting in Undeposited Funds that make up this deposit
    var undep = this.sys('UNDEP');
    if (l.amount > 0 && undep && acc && acc.type === 'bank' && this.undepositedItems) {
      var waiting = this.undepositedItems().filter(function (t) { return t.date <= U.addDays(l.date, 3) && t.date >= U.addDays(l.date, -60); })
        .map(function (t) { return { t: t, amount: self.undepositedAmount(t) }; }).filter(function (x) { return x.amount > 0; });
      var one = waiting.filter(function (x) { return x.amount === l.amount; });
      one.slice(0, 3).forEach(function (x) {
        out.push({ kind: 'deposit', txnIds: [x.t.id], txnId: x.t.id, score: 9 + (self.contactById[x.t.contactId] && nameIn(self.contactById[x.t.contactId].name, l.description) ? 4 : 0),
          reasons: ['waiting in Undeposited Funds for exactly this amount', 'a deposit is recorded for it'] });
      });
      if (waiting.length >= 2 && waiting.length <= 40) {
        var sols = B.subsets(waiting, l.amount, { min: 2, max: 8, want: 2 });
        sols.forEach(function (g, k) {
          out.push({ kind: 'deposit', txnIds: g.map(function (x) { return x.t.id; }), txnId: g[0].t.id, score: sols.length === 1 ? 11 : 7,
            reasons: [g.length + ' payments waiting in Undeposited Funds add up to this deposit', sols.length > 1 ? 'another combination also adds up: check it' : 'only combination that adds up'] });
        });
      }
    }
    // (b) several entries already in this account that add up to the bank line (e.g. two payments, one bank deposit)
    var near = this._bankWindow(l.accountId, U.addDays(l.date, -10), U.addDays(l.date, 3)).filter(function (e) {
      if (e.t.status !== 'posted' || e.s.cleared === 'R' || linked[e.t.id + ':' + e.i] || !e.s.amount || (e.s.amount > 0) !== (l.amount > 0) || Math.abs(e.s.amount) >= Math.abs(l.amount)) return false;
      var dd = U.daysBetween(l.date, e.t.date); return dd >= -10 && dd <= 3;
    }).map(function (e) { return { e: e, amount: e.s.amount }; });
    if (near.length >= 2 && near.length <= 40) {
      var gs = B.subsets(near, l.amount, { min: 2, max: 6, want: 2 });
      gs.forEach(function (g) {
        out.push({ kind: 'group', links: g.map(function (x) { return { txnId: x.e.t.id, splitIndex: x.e.i }; }), txnId: g[0].e.t.id, splitIndex: g[0].e.i, score: gs.length === 1 ? 10 : 6,
          reasons: [g.length + ' entries in ' + acc.name + ' add up to this line', gs.length > 1 ? 'another combination also adds up: check it' : 'only combination that adds up'] });
      });
    }
    // (c) several open invoices (money in) or bills (money out) of one customer or vendor that add up to the line;
    //     only for contacts the bank text points to (name written with or without spaces, or invoice numbers)
    if (acc && acc.type !== 'cc') {
      var T = Math.abs(l.amount), nums = numbersIn(l.description), seen = {};
      out.forEach(function (c) { if (c.kind === 'open') seen[c.txnIds.slice().sort().join()] = 1; });
      var byC = {};
      this.bankOpenDocs(lineId, null, true).docs.forEach(function (t) { (byC[t.contactId] = byC[t.contactId] || []).push(t); });
      Object.keys(byC).forEach(function (cid) {
        var c = self.contactById[cid], list = byC[cid].filter(function (t) { return t.date <= U.addDays(l.date, 5); });
        var named = c && mentioned(c.name, l.description), numbered = list.filter(function (t) { return t.number && nums[String(t.number).replace(/^0+/, '')]; });
        if (!named && !numbered.length || list.length < 2 || list.length > 40) return;
        var items = list.map(function (t) { return { t: t, amount: self.openBalance(t) }; }), sols = [];
        if (numbered.length >= 2 && U.sum(numbered, function (t) { return self.openBalance(t); }) === T) sols.push(numbered.map(function (t) { return { t: t }; }));
        B.subsets(items, T, { min: 2, max: 5, want: 3 }).forEach(function (g) { sols.push(g); });
        var uniq = [];
        sols.forEach(function (g) { var k = g.map(function (x) { return x.t.id; }).sort().join(); if (!seen[k]) { seen[k] = 1; uniq.push(g); } });
        uniq.forEach(function (g) {
          var ts = g.map(function (x) { return x.t; }), allNo = ts.every(function (t) { return t.number && nums[String(t.number).replace(/^0+/, '')]; });
          var label = S.TXN_TYPES[ts[0].type].label.toLowerCase() + 's';
          var reasons = [ts.length + ' open ' + label + ' (' + ts.map(function (t) { return t.number || U.fmtDate(t.date); }).join(', ') + ') add up to exactly this amount'];
          if (named) reasons.push(c.name + ' is in the bank text');
          if (allNo) reasons.push('the bank text lists ' + label + ' ' + ts.map(function (t) { return t.number; }).join(' and '));
          if (uniq.length > 1 && !allNo) reasons.push('another combination also adds up: check it');
          out.push({ kind: 'open', txnIds: ts.map(function (t) { return t.id; }), txnId: ts[0].id, score: 8 + (named ? 5 : 0) + (allNo ? 7 : 0) - (uniq.length > 1 && !allNo ? 3 : 0), reasons: reasons });
        });
      });
    }
    // (d) a customer split one invoice (or a vendor's bill was paid) over several days: other For review lines in this
    //     account whose bank text names the same contact add up, with this line, to one open item. Never by amount
    //     alone: every line must name the contact. Each line then posts a part payment of its own amount.
    if (acc && acc.type !== 'cc') {
      var ab = Math.abs(l.amount), want2 = l.amount > 0 ? 'invoice' : 'bill', splits = [];
      var named = this.bankOpenDocs(lineId, null, true).docs.reduce(function (m, t) {
        var c = self.contactById[t.contactId];
        if (c && self.openBalance(t) > ab && mentioned(c.name, l.description)) (m[c.id] = m[c.id] || []).push(t);
        return m;
      }, {});
      Object.keys(named).forEach(function (cid) {
        var c = self.contactById[cid];
        var peers = self.bankLinesFor(l.accountId, 'review').filter(function (x) {
          return x.id !== l.id && (x.amount > 0) === (l.amount > 0) && Math.abs(U.daysBetween(l.date, x.date)) <= 60 && mentioned(c.name, x.description);
        }).slice(0, 30).map(function (x) { return { x: x, amount: Math.abs(x.amount) }; });
        if (!peers.length) return;
        named[cid].forEach(function (t) {
          B.subsets(peers, self.openBalance(t) - ab, { min: 1, max: 4, want: 2 }).forEach(function (g) {
            var first = g.reduce(function (d, p) { return p.x.date < d ? p.x.date : d; }, l.date);
            if (t.date > U.addDays(first, 5)) return;                              // paid before it was billed: no
            var amts = {}; amts[t.id] = ab;
            var noTxt = t.number && [l].concat(g.map(function (p) { return p.x; })).some(function (y) { return numbersIn(y.description)[String(t.number).replace(/^0+/, '')]; });
            splits.push({ kind: 'open', split: true, txnIds: [t.id], txnId: t.id, amounts: amts, peers: g.map(function (p) { return p.x.id; }),
              score: 9 + (noTxt ? 6 : 0),
              reasons: ['with ' + g.map(function (p) { return 'the ' + U.fmtDate(p.x.date) + ' line (' + U.fmt(Math.abs(p.x.amount), { symbol: true }) + ')'; }).join(' and ') + ' this pays ' + S.TXN_TYPES[t.type].label.toLowerCase() + ' ' + (t.number || U.fmtDate(t.date)) + ' (' + U.fmt(self.openBalance(t), { symbol: true }) + ') in full',
                c.name + ' is in the bank text of each line', 'this line pays ' + U.fmt(ab, { symbol: true }) + ' of it'].concat(noTxt ? ['the bank text lists the ' + want2 + ' number'] : []) });
          });
        });
      });
      if (splits.length > 1) splits.forEach(function (x) { x.score -= 3; x.reasons.push(splits.length - 1 + ' other ' + want2 + (splits.length > 2 ? 's' : '') + ' of the same amount also fit: the oldest is listed first'); });
      splits.forEach(function (x) { out.push(x); });
    }
    // the bank text names the invoice/bill number or the contact: that outweighs amount and date (e.g. "Inv 1229")
    var nums0 = numbersIn(l.description);
    out.forEach(function (c) {
      if (c.kind !== 'open' || c.split || c.txnIds.length > 1) return;
      var t = self.txById[c.txnId], who = t && self.contactById[t.contactId];
      if (t && t.number && nums0[String(t.number).replace(/^0+/, '')]) { c.score += 6; c.reasons.push('the bank text lists ' + S.TXN_TYPES[t.type].label.toLowerCase() + ' ' + t.number); }
      if (who && !c.reasons.some(function (r) { return r.indexOf(' is in the bank text') >= 0; }) && mentioned(who.name, l.description)) { c.score += 3; c.reasons.push(who.name + ' is in the bank text'); }
    });
    // equal evidence: the oldest open item first (the order payments are usually applied)
    var newest = function (c) { return (c.txnIds || [c.txnId]).reduce(function (m, id) { var t = self.txById[id]; return t && t.date > m ? t.date : m; }, ''); };
    out.forEach(function (c) { delete c.best; });
    out.sort(function (a, b) { return b.score - a.score || (newest(a) < newest(b) ? -1 : newest(a) > newest(b) ? 1 : 0); });
    // 1.57: an entry more than 10 days from the bank date is only offered, never chosen by itself, unless the check number
    // agrees: a monthly charge of the same amount was being matched to last month's entry instead of being added
    var top = out[0], far = top && top.kind === 'register' && self.txById[top.txnId] && Math.abs(U.daysBetween(l.date, self.txById[top.txnId].date)) > 10 && !/^check number/.test(top.reasons[0]);
    if (top && !far && (out.length === 1 || top.score - out[1].score >= 3)) top.best = true;
    return out;
  }
  /** Open invoices (money in) or bills (money out) for matching a For review line by hand: {contactId, docs, contacts}.
   *  contactId = the one asked for, else the customer/vendor the bank text names; docs = that contact's open items,
   *  oldest first (all contacts' when all is true). contacts = everyone with open items, for the picker. */
  Book.prototype.bankOpenDocs = function (lineId, contactId, all) {
    var self = this, l = this.bankLineById[lineId]; if (!l) return { contactId: '', docs: [], contacts: [] };
    var want = l.amount > 0 ? 'invoice' : 'bill', open = this.transactions.filter(function (t) { return t.type === want && t.status === 'posted' && self.openBalance(t) > 0; });
    open.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : String(a.number).localeCompare(String(b.number), undefined, { numeric: true }); });
    if (all) return { contactId: '', docs: open, contacts: [] };
    var ids = {}; open.forEach(function (t) { ids[t.contactId] = 1; });
    var contacts = Object.keys(ids).filter(function (id) { return self.contactById[id]; }).sort(function (a, b) { return self.contactById[a].name.localeCompare(self.contactById[b].name); });
    var cid = contactId;
    if (cid === undefined || cid === null) {
      var nums = numbersIn(l.description), byNo = open.find(function (t) { return t.number && nums[String(t.number).replace(/^0+/, '')] && mentioned(self.contactById[t.contactId].name, l.description); });
      cid = byNo ? byNo.contactId : (contacts.find(function (id) { return mentioned(self.contactById[id].name, l.description); }) || '');
    }
    return { contactId: cid, docs: cid ? open.filter(function (t) { return t.contactId === cid; }) : [], contacts: contacts };
  };
  // the bank text names a contact: first two significant words of the name, spaces ignored ("HONOR HEALTH" in "Honorhealth Supp")
  function mentioned(name, desc) {
    var w = words(name).filter(function (x) { return !/^(THE|LLC|INC|CO|LTD|CORP|AND|OF|PLLC|LLP|PC|PA|DBA)$/.test(x); }).slice(0, 2);
    var key = w.join(''), d = String(desc || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    return key.length >= 5 && d.indexOf(key) >= 0;
  }
  function numbersIn(desc) { var o = {}; (String(desc || '').match(/\d+/g) || []).forEach(function (n) { if (n.length >= 3 && n.length <= 8) o[n.replace(/^0+/, '')] = 1; }); return o; }
  function words(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(function (w) { return w.length >= 3; }); }
  function nameIn(name, desc) {
    var w = words(name).filter(function (x) { return !/^(THE|LLC|INC|CO|LTD|CORP|AND)$/.test(x); }), d = ' ' + words(desc).join(' ') + ' ';
    return w.length > 0 && w.every(function (x) { return d.indexOf(' ' + x) >= 0; });
  }

  // a group match claims every entry it links
  Book.prototype._bankLinked = function () {
    var m = {};
    this.bankLines.forEach(function (l) {
      if (l.status !== 'posted') return;
      if (l.links) l.links.forEach(function (x) { m[x.txnId + ':' + x.splitIndex] = l.id; });
      else if (l.txnId) m[l.txnId + ':' + l.splitIndex] = l.id;
    });
    return m;
  };

  var post0 = Book.prototype._raw_postBankLine;
  var postBankLine = function (lineId, d) {
    var self = this, l = this.bankLineById[lineId]; d = d || {};
    if (d.kind !== 'deposit' && d.kind !== 'group') return post0.call(this, lineId, d);
    if (!l) return Promise.reject(LedgerError('Bank line not found.'));
    if (l.status !== 'review') return Promise.reject(LedgerError(l.status === 'posted' ? 'This bank line is already posted.' : 'Only a line in For review can be matched.'));
    var nl = U.clone(l); nl.postedAt = new Date().toISOString(); nl.status = 'posted'; nl.via = d.kind;
    if (d.kind === 'deposit') {
      var undep = this.sys('UNDEP'), items = (d.txnIds || []).map(function (id) { return self.txById[id]; });
      if (!undep || !items.length || items.some(function (t) { return !t || t.status !== 'posted'; })) return Promise.reject(LedgerError('Choose the payments to deposit.'));
      var total = U.sum(items, function (t) { return self.undepositedAmount(t); });
      if (total !== l.amount) return Promise.reject(LedgerError('The payments add up to ' + U.fmt(total, { symbol: true }) + '; the deposit is ' + U.fmt(l.amount, { symbol: true }) + '.'));
      var draft = { type: 'deposit', date: l.date, accountId: l.accountId, memo: l.description, importHash: l.hash,
        lines: items.map(function (t) { return { accountId: undep.id, amount: self.undepositedAmount(t), fromTxnId: t.id, contactId: t.contactId || '', description: S.TXN_TYPES[t.type].label + (t.number ? ' ' + t.number : '') + ' ' + U.fmtDate(t.date) }; }) };
      var p; try { p = this._prepareSave(draft); } catch (e) { return Promise.reject(e); }
      var k = p.t.splits.findIndex(function (x) { return x.accountId === l.accountId && x.amount === l.amount; });
      if (k >= 0) p.t.splits[k].cleared = 'C';
      nl.txnId = p.t.id; nl.splitIndex = k;
      return this._commit(p.ops.concat([{ store: 'bankLines', value: nl }]), function () { p.apply(); self.bankLines[self.bankLines.indexOf(l)] = nl; }).then(function () { self.reindex(); return p.t; });
    }
    // group: link several existing entries
    var links = (d.links || []).map(function (x) { return { txnId: x.txnId, splitIndex: +x.splitIndex }; }), linked = this._bankLinked(), seen = {}, sum = 0, changed = {};
    if (links.length < 2) return Promise.reject(LedgerError('Choose at least two entries, or use Match for one.'));
    for (var i = 0; i < links.length; i++) {
      var x = links[i], t = this.txById[x.txnId], s = t && t.splits[x.splitIndex];
      if (!t || t.status !== 'posted' || !s || s.accountId !== l.accountId) return Promise.reject(LedgerError('Each entry must be in this account.'));
      if (s.cleared === 'R') return Promise.reject(LedgerError('An entry is already reconciled.'));
      var key = x.txnId + ':' + x.splitIndex; if (seen[key] || linked[key]) return Promise.reject(LedgerError('An entry is already matched to a bank line.')); seen[key] = 1;
      if ((s.amount > 0) !== (l.amount > 0)) return Promise.reject(LedgerError('Every entry must be money ' + (l.amount > 0 ? 'in.' : 'out.')));
      sum += s.amount;
      var nt = changed[t.id] || (changed[t.id] = U.clone(t)); x.clearedBefore = s.cleared || ''; nt.splits[x.splitIndex].cleared = 'C';
    }
    if (sum !== l.amount) return Promise.reject(LedgerError('The entries add up to ' + U.fmt(sum, { symbol: true }) + '; the bank line is ' + U.fmt(l.amount, { symbol: true }) + ' (difference ' + U.fmt(l.amount - sum, { symbol: true }) + ').'));
    nl.links = links; nl.txnId = links[0].txnId; nl.splitIndex = links[0].splitIndex;
    var au = this._auditEntry('bankMatch', links[0].txnId, 'Matched bank line ' + U.fmtDate(l.date) + ' ' + U.fmt(l.amount, { symbol: true }) + ' "' + l.description + '" to ' + links.length + ' entries');
    var ops = Object.keys(changed).map(function (id) { return { store: 'transactions', value: changed[id] }; }).concat([{ store: 'bankLines', value: nl }, { store: 'audit', value: au }]);
    return this._commit(ops, function () {
      Object.keys(changed).forEach(function (id) { self.transactions[self.transactions.indexOf(self.txById[id])] = changed[id]; });
      self.bankLines[self.bankLines.indexOf(l)] = nl; self.audit.push(au);
    }).then(function () { self.reindex(); return nl; });
  };
  Book.prototype._raw_postBankLine = postBankLine; Book.prototype.postBankLine = queued(postBankLine);

  var unmatch0 = Book.prototype._raw__bankUnmatch;
  var bankUnmatch = function (lineId) {
    var self = this, l = this.bankLineById[lineId];
    if (!l || !l.links) return unmatch0.call(this, lineId);
    var changed = {}, nl = U.clone(l);
    l.links.forEach(function (x) {
      var t = self.txById[x.txnId]; if (!t || !t.splits[x.splitIndex] || t.splits[x.splitIndex].cleared === 'R') return;
      var nt = changed[t.id] || (changed[t.id] = U.clone(t)); nt.splits[x.splitIndex].cleared = x.clearedBefore || '';
    });
    ['txnId', 'splitIndex', 'via', 'postedAt', 'clearedBefore', 'links', 'auto'].forEach(function (f) { delete nl[f]; }); nl.status = 'review';
    var au = this._auditEntry('bankUnmatch', l.txnId, 'Unmatched bank line ' + U.fmtDate(l.date) + ' ' + U.fmt(l.amount, { symbol: true }) + ' from ' + l.links.length + ' entries — the entries are kept');
    var ops = Object.keys(changed).map(function (id) { return { store: 'transactions', value: changed[id] }; }).concat([{ store: 'bankLines', value: nl }, { store: 'audit', value: au }]);
    return this._commit(ops, function () {
      Object.keys(changed).forEach(function (id) { self.transactions[self.transactions.indexOf(self.txById[id])] = changed[id]; });
      self.bankLines[self.bankLines.indexOf(l)] = nl; self.audit.push(au);
    }).then(function () { self.reindex(); return nl; });
  };
  Book.prototype._raw__bankUnmatch = bankUnmatch; Book.prototype._bankUnmatch = queued(bankUnmatch);

  var undo0 = Book.prototype.undoBankLine;
  Book.prototype.undoBankLine = function (lineId) {
    var self = this, l = this.bankLineById[lineId];
    if (l && l.status === 'posted' && l.links) {
      if (l.links.some(function (x) { var t = self.txById[x.txnId]; return t && t.splits[x.splitIndex] && t.splits[x.splitIndex].cleared === 'R'; }))
        return Promise.reject(LedgerError('An entry of this match is reconciled. Undo the reconciliation first.'));
      return this._bankUnmatch(lineId);
    }
    return undo0.call(this, lineId);
  };

  /* ======================= 3. Already in the books ======================= */
  /** Pair bank lines (or parsed rows) with entries already in the account, one to one, strongest first:
   *  exact amount and either the same check number (book date up to 90 days earlier) or a book date from
   *  7 days before to 3 days after the bank date. Entries already reconciled or matched are left alone.
   *  items: [{ key, date, amount, checkNo, description }] → { key: { txnId, splitIndex, reasons } } */
  Book.prototype.bankBooksPairs = function (accountId, items) {
    var self = this, linked = this._bankLinked(), byAmt = {};
    (this.splitIndex()[accountId] || []).forEach(function (e) {
      if (e.t.status !== 'posted' || e.s.cleared === 'R' || linked[e.t.id + ':' + e.i] || !e.s.amount) return;
      (byAmt[e.s.amount] = byAmt[e.s.amount] || []).push(e);
    });
    var pairs = [];
    items.forEach(function (it) {
      (byAmt[it.amount] || []).forEach(function (e) {
        var dd = U.daysBetween(it.date, e.t.date), chk = it.checkNo && e.t.number && String(e.t.number).replace(/^0+/, '') === String(it.checkNo).replace(/^0+/, '');
        if (chk ? (dd < -90 || dd > 5) : (dd < -7 || dd > 3)) return;
        var c = self.contactById[e.s.contactId || e.t.contactId], named = !!(c && nameIn(c.name, it.description));
        var score = (chk ? 100 : 0) + (named ? 10 : 0) + (8 - Math.min(8, Math.abs(dd)));
        var reasons = ['same amount', chk ? 'check ' + it.checkNo + ' matches' : dd === 0 ? 'same date' : Math.abs(dd) + ' day' + (Math.abs(dd) === 1 ? '' : 's') + (dd < 0 ? ' earlier in the books' : ' later in the books')];
        if (named) reasons.push(c.name + ' is in the bank text');
        pairs.push({ key: it.key, e: e, score: score, reasons: reasons });
      });
    });
    pairs.sort(function (a, b) { return b.score - a.score; });
    var usedK = {}, usedE = {}, out = {};
    pairs.forEach(function (p) {
      var ek = p.e.t.id + ':' + p.e.i; if (usedK[p.key] || usedE[ek]) return;
      usedK[p.key] = usedE[ek] = 1;
      out[p.key] = { txnId: p.e.t.id, splitIndex: p.e.i, reasons: p.reasons, label: S.TXN_TYPES[p.e.t.type].label + (p.e.t.number ? ' ' + p.e.t.number : '') + ' · ' + U.fmtDate(p.e.t.date) };
    });
    return out;
  };

  var preview0 = Book.prototype.bankPreview;
  /** Dry run of an import: new lines, lines imported before, and new lines already entered in the books. */
  Book.prototype.bankPreview = function (accountId, rows) {
    var r = preview0.call(this, accountId, rows), self = this;
    var seen = {};
    this.bankLines.forEach(function (l) { if (l.accountId === accountId && l.status !== 'removed') seen[l.hash] = 1; });
    this.transactions.forEach(function (t) { if (t.importHash && t.status === 'posted') seen[t.importHash] = 1; });
    var items = [];
    I.assignHashes(accountId, rows.map(function (x) { return { date: x.date, description: x.description || '(no description)', amount: x.amount, checkNo: x.checkNo || '' }; }))
      .forEach(function (x, k) { if (!seen[x.hash] && U.isDate(x.date) && x.amount) { seen[x.hash] = 1; items.push({ key: k, date: x.date, amount: x.amount, checkNo: x.checkNo, description: x.description }); } });
    var pairs = this.bankBooksPairs(accountId, items);
    r.inBooks = items.filter(function (it) { return pairs[it.key]; }).map(function (it) { return { date: it.date, description: it.description, amount: it.amount, entry: pairs[it.key].label, reasons: pairs[it.key].reasons }; });
    r.autoAdd = items.filter(function (it) { if (pairs[it.key]) return false; var ru = self.matchRule(it.description, it.amount, accountId); return ru && ru.autoAdd && (!ru.splits || B.splitFor(ru, Math.abs(it.amount))); }).length;
    return r;
  };

  /** Match lines to entries already in the books, in one commit. Returns the number matched. */
  Book.prototype._matchToBooks = function (lineIds) {
    var self = this, lines = lineIds.map(function (id) { return self.bankLineById[id]; }).filter(function (l) { return l && l.status === 'review'; });
    if (!lines.length) return Promise.resolve(0);
    var acc = lines[0].accountId, pairs = this.bankBooksPairs(acc, lines.map(function (l) { return { key: l.id, date: l.date, amount: l.amount, checkNo: l.checkNo, description: l.description }; }));
    var changed = {}, nls = [], now = new Date().toISOString();
    lines.forEach(function (l) {
      var p = pairs[l.id]; if (!p) return;
      var t = changed[p.txnId] || (changed[p.txnId] = U.clone(self.txById[p.txnId])), nl = U.clone(l);
      nl.clearedBefore = t.splits[p.splitIndex].cleared || ''; t.splits[p.splitIndex].cleared = 'C';
      nl.status = 'posted'; nl.via = 'match'; nl.auto = 'books'; nl.postedAt = now; nl.txnId = p.txnId; nl.splitIndex = p.splitIndex; nl.matchReasons = p.reasons;
      nls.push(nl);
    });
    if (!nls.length) return Promise.resolve(0);
    var au = this._auditEntry('bankMatch', '', 'Matched ' + nls.length + ' imported bank line' + (nls.length === 1 ? '' : 's') + ' to entries already in the books (not added again)');
    var ops = Object.keys(changed).map(function (id) { return { store: 'transactions', value: changed[id] }; }).concat(nls.map(function (n) { return { store: 'bankLines', value: n }; }), [{ store: 'audit', value: au }]);
    return this._commit(ops, function () {
      Object.keys(changed).forEach(function (id) { self.transactions[self.transactions.indexOf(self.txById[id])] = changed[id]; });
      nls.forEach(function (n) { self.bankLines[self.bankLines.indexOf(self.bankLineById[n.id])] = n; });
      self.audit.push(au);
    }).then(function () { self.reindex(); return nls.length; });
  };

  var import0 = Book.prototype._raw_importBankLines;
  /** Import as before; then (meta.matchBooks, default on) match lines already in the books, and (meta.autoAdd,
   *  default on) post lines caught by an auto-add rule. Returns { …, matched, autoAdded }. */
  var importBankLines = function (accountId, rows, meta) {
    var self = this; meta = meta || {};
    return import0.call(this, accountId, rows, meta).then(function (res) {
      res.matched = 0; res.autoAdded = 0;
      if (!res.lines || !res.lines.length) return res;
      var ids = res.lines.map(function (l) { return l.id; });
      return Promise.resolve(meta.matchBooks === false ? 0 : self._matchToBooks(ids)).then(function (n) {
        res.matched = n;
        if (meta.autoAdd === false) return res;
        var todo = ids.map(function (id) { return self.bankLineById[id]; }).filter(function (l) { return l && l.status === 'review'; });
        var chain = Promise.resolve();
        todo.forEach(function (l) {
          var r = self.matchRule(l.description, l.amount, l.accountId); if (!r || !r.autoAdd) return;
          var sp = B.splitFor(r, Math.abs(l.amount)); if (r.splits && !sp) return;
          var d = sp ? { kind: 'split', lines: sp, contactId: r.contactId, memo: r.memo || '' } : { kind: 'add', categoryId: r.accountId, contactId: r.contactId, classId: r.classId, memo: r.memo || '' };
          chain = chain.then(function () { return postBankLine.call(self, l.id, d).then(function () { res.autoAdded++; }, function () { /* stays in For review */ }); });
        });
        return chain.then(function () { return res; });
      });
    });
  };
  Book.prototype._raw_importBankLines = importBankLines; Book.prototype.importBankLines = queued(importBankLines);
})(typeof window !== 'undefined' ? window : globalThis);
