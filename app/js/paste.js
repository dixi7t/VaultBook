/* VaultBook — Paste entries (1.48.0): rows copied from Excel (a QuickBooks report, or any sheet with Date, Split and
   Debit / Credit) become transactions in one ledger. The other side of each row is its Split account. Rows with the same
   date and number are one split entry. The Type column picks the kind (Check, Deposit, Bill, Journal…) the same way as the
   QuickBooks import (OB.qbimport.toDraft). Missing accounts and names are created; everything posts in one atomic write. */
(function (root) {
  'use strict';
  var OB = root.OB, U = OB.util, S = OB.schema, P = OB.paste = {};
  P.COLS = ['type', 'date', 'num', 'adj', 'name', 'memo', 'clr', 'split', 'debit', 'credit', 'entry'];
  P.LABELS = { type: 'Type', date: 'Date', num: 'Num', adj: 'Adj', name: 'Name', memo: 'Memo', clr: 'Clr', split: 'Split (other account)', debit: 'Debit', credit: 'Credit', entry: 'Entry #' };
  P.TYPES = ['Check', 'Deposit', 'Expense', 'Credit Card Charge', 'Credit Card Credit', 'Bill', 'Bill Credit', 'Bill Pmt -Check', 'Invoice', 'Credit Memo', 'Payment', 'Sales Receipt', 'Transfer', 'General Journal'];
  var HEAD = { type: /^(type|transaction type|txn type)$/, date: /^(date|txn date|transaction date|posting date)$/, num: /^(num|no\.?|number|ref|ref no\.?|ref #|check no\.?|doc num|check #)$/,
    adj: /^adj/, name: /^(name|payee|vendor|customer|payee \/ name|name \/ payee|payee\/name)$/, memo: /^(memo|description|memo\/description|memo \/ description|details)$/,
    clr: /^(clr|cleared|✓|c)$/, split: /^(split|account|other account|account \(other side\)|split account|category)$/, debit: /^debit/, credit: /^credit/, amount: /^amount$/,
    entry: /^(entry|entry ?#|entry no\.?|trans ?#|trans no\.?|transaction ?#|txn ?#|je ?#|group|split ?#|split group)$/ };

  /** Tab-separated text as Excel puts it on the clipboard: quoted cells may hold tabs, quotes ("") and new lines. */
  P.parseTSV = function (text) {
    var rows = [], row = [], cell = '', q = false, s = String(text || '').replace(/\r\n?/g, '\n');
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      if (q) { if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
      else if (ch === '"' && cell === '') q = true;
      else if (ch === '\t') { row.push(cell); cell = ''; }
      else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows;
  };
  function isoDate(v) {
    var s = String(v || '').trim(); if (!s) return '';
    if (/^\d{4}-\d\d-\d\d$/.test(s)) return s;
    return OB.importer.parseDateAs(s, 'MDY') || '';
  }
  P.isoDate = isoDate;
  P.money = function (v) { return money(v); };
  function money(v) { // a clean "1500.00" for the grid, '' for blank or zero, the text as typed when it is not a number
    var s = String(v == null ? '' : v).trim(); if (!s) return '';
    try { var c = OB.importer.amountOf(s); return c ? (c / 100).toFixed(2) : ''; } catch (e) { return s; }
  }
  function cents(v) { var s = String(v == null ? '' : v).trim(); if (!s) return 0; try { return OB.importer.amountOf(s); } catch (e) { return NaN; } }

  /** Grid rows from pasted text. A header row (Type, Date, Num, Name, Memo, Split, Debit, Credit…) is found anywhere
   *  in the first rows and decides the columns; without one, cells fill the grid columns in order. Rows with no date
   *  are headings and totals and are dropped; Balance is ignored. */
  /** { at, map } of the header row in the first 15 rows, or null. */
  P.headerOf = function (table) {
    for (var i = 0; i < Math.min(15, table.length); i++) {
      var m = {}, hits = 0;
      (table[i] || []).forEach(function (c, k) { var h = String(c || '').trim().toLowerCase(); Object.keys(HEAD).some(function (f) { if (m[f] === undefined && HEAD[f].test(h)) { m[f] = k; hits++; return true; } return false; }); });
      if (m.date !== undefined && hits >= 3) return { at: i, map: m };
    }
    return null;
  };
  P.fromTable = function (table, startCol) {
    var h = P.headerOf(table), map = h && h.map, at = h ? h.at : -1;
    if (!map) { map = {}; P.COLS.forEach(function (f, k) { if (k >= (startCol || 0)) map[f] = k - (startCol || 0); }); }
    var out = [], auto = 0, head = null;
    table.slice(at + 1).forEach(function (r) {
      var get = function (f) { return map[f] === undefined ? '' : String(r[map[f]] == null ? '' : r[map[f]]).trim(); };
      var row = {}; P.COLS.forEach(function (f) { row[f] = get(f); });
      if (map.amount !== undefined && !row.debit && !row.credit) { var a = cents(get('amount')); if (a > 0) row.debit = get('amount'); else if (a < 0) row.credit = String(get('amount')).replace('-', ''); }
      row.date = isoDate(row.date); row.debit = money(row.debit); row.credit = money(row.credit);
      var first = (r || []).map(function (c) { return String(c == null ? '' : c).trim(); }).filter(Boolean)[0] || '';
      if (!row.date && head && row.split && (row.debit || row.credit) && !/^total\b/i.test(first)) {
        // a line under an entry with the date left blank (as in Excel, or a QuickBooks Journal report): part of that entry
        var prev = head;
        if (!prev.entry) { while (out.some(function (x) { return x.entry === 'A' + (auto + 1); })) auto++; prev.entry = 'A' + (++auto); }
        ['date', 'type', 'num', 'name', 'memo', 'entry'].forEach(function (f) { if (!row[f] || f === 'date' || f === 'entry') row[f] = prev[f]; });
      }
      else if (row.date) head = row;
      if (row.date) out.push(row);
    });
    return out;
  };
  P.fromText = function (text, startCol) { return P.fromTable(P.parseTSV(text), startCol); };

  /** Copies of rows, each a month later, `months` times. A date on a month's last day stays on the last day. */
  P.repeat = function (rows, months) {
    var out = [];
    for (var k = 1; k <= months; k++) rows.forEach(function (r) {
      var d = r.date, y = +d.slice(0, 4), m = +d.slice(5, 7), day = +d.slice(8, 10), last = new Date(Date.UTC(y, m, 0)).getUTCDate();
      var nm = m - 1 + k, ny = y + Math.floor(nm / 12); nm = nm % 12 + 1;
      var nlast = new Date(Date.UTC(ny, nm, 0)).getUTCDate(), nd = day === last ? nlast : Math.min(day, nlast);
      out.push(Object.assign({}, r, { date: ny + '-' + (nm < 10 ? '0' : '') + nm + '-' + (nd < 10 ? '0' : '') + nd }));
    });
    return out;
  };

  function accIndex(b) {
    var ix = {};
    b.accounts.forEach(function (a) {
      var full = b.accountFullName(a);
      [a.name, full, a.name.replace(/\s*\((a\/r|a\/p)\)\s*$/i, ''), a.number && a.number + ' ' + a.name, a.number && a.number + ' · ' + a.name, a.number && a.number + ' ' + full, a.number && a.number + ' · ' + full, a.number]
        .forEach(function (k) { if (k && !ix[k.toLowerCase()]) ix[k.toLowerCase()] = a; });
    });
    return ix;
  }
  /** A type for an account VaultBook does not have, from its name, then from the row. */
  P.guessType = function (name, qbType, ledger, ledgerAmount) {
    var n = String(name || '').toLowerCase(), q = String(qbType || '').toLowerCase();
    if (/accounts? payable|\ba\/p\b/.test(n)) return 'ap';
    if (/accounts? receivable|\ba\/r\b/.test(n)) return 'ar';
    if (/credit card|\bvisa\b|mastercard|\bamex\b|american express|discover card/.test(n)) return 'cc';
    if (/loan|mortgage|note payable|notes payable/.test(n)) return 'ltl';
    if (/payable|accrued|payroll liab|withholding/.test(n)) return 'ocl';
    if (/checking|savings|\bbank\b|money market|petty cash|#\s*\d{3,}|wells fargo|chase|bank of america|capital one|\bpnc\b|td bank|citibank/.test(n)) return 'bank';
    if (/equity|capital|draw|distribution|retained earnings|opening balance/.test(n)) return 'equity';
    if (/cost of goods|\bcogs\b|purchases|materials/.test(n)) return 'cogs';
    if (/expense|fees? paid|rent|utilit|insurance|supplies|repair|travel|meals|wages|salar/.test(n)) return 'expense';
    if (/income|sales|revenue|fees earned|interest earned/.test(n)) return 'income';
    if (/depreciation|equipment|furniture|vehicle|building|computer|improvement/.test(n)) return 'fixed';
    var cash = ledger.type === 'bank' || ledger.type === 'cc';
    if (!cash && /credit card/.test(q)) return 'cc';
    if (!cash && /check|deposit|transfer|bill pmt|payment|sales receipt/.test(q)) return 'bank';
    if (cash) return ledgerAmount > 0 ? 'income' : 'expense';
    return 'expense';
  };
  /** The Split cell: one account, or several separated by ";" — "Rent A 2000; Rent B 20%; Rent C" (one without an
   *  amount takes the rest). Returns [{name, amount}] with the row's sign; reports a split that does not add up. */
  function splitCell(cell, amount, ix, bad) {
    var parts = String(cell).split(/\s*[;\n]\s*/).map(function (x) { return x.trim(); }).filter(Boolean);
    if (parts.length < 2) return [{ name: String(cell).trim(), amount: amount }];
    var total = Math.abs(amount), sign = amount < 0 ? -1 : 1, rest = [], out = [], pct = false;
    parts.forEach(function (x) {
      var m = !ix[x.toLowerCase()] && x.match(/^(.*?[^\s:=])\s*[:=]?\s*\$?\(?(\d[\d,]*(?:\.\d+)?)\)?\s*(%?)$/);
      if (!m) { rest.push(out.length); out.push({ name: x, amount: null }); return; }
      var v = +m[2].replace(/,/g, '');
      if (m[3]) pct = true;
      out.push({ name: m[1].trim(), amount: m[3] ? Math.round(total * v / 100) : Math.round(v * 100), pct: !!m[3] });
    });
    if (rest.length > 1) { bad('Only one account in the Split cell can be without an amount (it takes the rest).'); return []; }
    var sum = out.reduce(function (s, x) { return s + (x.amount || 0); }, 0);
    if (rest.length) { if (sum >= total) { bad('The split amounts already add up to ' + U.fmt(sum) + ', leaving nothing for ' + out[rest[0]].name + '.'); return []; } out[rest[0]].amount = total - sum; }
    else if (sum !== total && pct && Math.abs(total - sum) <= out.length) { var lp = out.filter(function (x) { return x.pct; }).pop(); lp.amount += total - sum; }
    else if (sum !== total) { bad('The split amounts add up to ' + U.fmt(sum) + ', not ' + U.fmt(total) + '.'); return []; }
    return out.map(function (x) { return { name: x.name, amount: sign * x.amount }; });
  }
  var CUSTOMER_TYPES = /deposit|invoice|payment|sales receipt|credit memo|statement charge/;

  /** What the rows would post: { entries [{rows, kind, draft, duplicate, clear}], missing [{key, name, type, parentId, rows}],
   *  newNames [{name, kind}], errors [{row, message}] }. opts.map {lowercase name: account id} points a missing account
   *  at an existing one; opts.types {lowercase name: type} overrides the guessed type. Drafts use 'new:' ids for
   *  accounts and names still to be created. */
  P.plan = function (b, ledgerId, rows, opts) {
    opts = opts || {};
    var ledger = b.accById[ledgerId], ix = accIndex(b), map = opts.map || {}, types = opts.types || {};
    var res = { entries: [], missing: [], newNames: [], errors: [] }, missing = {}, names = {}, groups = [], byKey = {};
    var vend = {}, cust = {}; b.contacts.forEach(function (c) { (c.kind === 'vendor' ? vend : cust)[c.name.toLowerCase()] = c; });
    var bad = function (i, m) { res.errors.push({ row: i, message: m }); };
    rows.forEach(function (r, i) {
      if (!P.COLS.some(function (f) { return String(r[f] || '').trim(); })) return; // an empty grid row
      var dr = cents(r.debit), cr = cents(r.credit), split = String(r.split || '').trim(), low = split.toLowerCase(), errs = res.errors.length;
      if (!U.isDate(r.date)) bad(i, 'Enter a date.');
      if (isNaN(dr) || isNaN(cr)) bad(i, 'Debit and Credit must be amounts.');
      else if (dr && cr) bad(i, 'Enter a Debit or a Credit, not both.');
      else if (!dr && !cr) bad(i, 'Enter a Debit or a Credit.');
      if (!split) bad(i, 'Enter the Split account (the other side of the entry).');
      else if (/^-?split-?$/i.test(split)) bad(i, 'This row is a split. Paste the split\'s own lines, one row per account.');
      if (res.errors.length > errs) return;
      var subs = splitCell(split, dr - cr, ix, function (m) { bad(i, m); });
      var lines = [];
      subs.forEach(function (sb) {
        var name = sb.name, low = name.toLowerCase(), amount = sb.amount, acc = ix[low] || (map[low] && b.accById[map[low]]);
        if (acc && acc.id === ledgerId) { bad(i, 'The Split account is this ledger itself.'); return; }
        if (!acc) {
          var m = missing[low];
          if (!m) {
            var cut = name.lastIndexOf(':'), parent = cut > 0 ? ix[name.slice(0, cut).toLowerCase()] : null;
            m = missing[low] = { key: low, name: parent ? name.slice(cut + 1).trim() : name, full: name, parentId: parent ? parent.id : '', rows: [],
              type: types[low] || (parent ? parent.type : P.guessType(name, r.type, ledger, amount)) };
            res.missing.push(m);
          }
          if (m.rows.indexOf(i) < 0) m.rows.push(i); acc = { id: 'new:' + low, type: m.type };
        }
        lines.push({ r: r, acc: acc, amount: amount });
      });
      if (res.errors.length > errs) return;
      // one entry: the same Entry # on the same date, else the same date, Num and Type, else the row alone
      var ent = String(r.entry || '').trim(), num = String(r.num || '').trim();
      var key = ent ? 'e|' + ent + '|' + r.date : num ? r.date + '|' + num + '|' + String(r.type || '').toLowerCase() : 'row' + i, g = byKey[key];
      if (!g) { g = byKey[key] = { rows: [], lines: [], first: r }; groups.push(g); }
      g.rows.push(i); g.lines = g.lines.concat(lines);
    });
    groups.forEach(function (g) {
      var r0 = g.first, qbType = String(r0.type || '').trim() || 'General Journal', custy = CUSTOMER_TYPES.test(qbType.toLowerCase());
      var contactFor = function (name, kind) {
        var n = String(name || '').trim(), low = n.toLowerCase(); if (!n) return null;
        var k = kind === 'any' ? (vend[low] ? 'vendor' : cust[low] ? 'customer' : custy ? 'customer' : 'vendor') : kind;
        var have = (k === 'vendor' ? vend : cust)[low]; if (have) return have;
        var id = 'new:' + k + ':' + low; if (!names[id]) { names[id] = 1; res.newNames.push({ id: id, name: n, kind: k }); }
        return { id: id };
      };
      var posts = [], merged = {};
      g.lines.forEach(function (x) {
        posts.push({ acc: { id: ledgerId, type: ledger.type }, amount: x.amount, memo: x.r.memo || '', name: x.r.name || '' });
        var cashy = x.acc.type === 'bank' || x.acc.type === 'cc', m = cashy && merged[x.acc.id];
        if (m) m.amount -= x.amount;
        else { m = { acc: x.acc, amount: -x.amount, memo: x.r.memo || '', name: x.r.name || '' }; posts.push(m); if (cashy) merged[x.acc.id] = m; }
      });
      var cashLedger = ledger.type === 'bank' || ledger.type === 'cc';
      if (cashLedger && posts.filter(function (p) { return p.acc.id === ledgerId; }).length > 1) { // one bank line for a split entry in a bank ledger
        var tot = posts.filter(function (p) { return p.acc.id === ledgerId; }).reduce(function (s, p) { return s + p.amount; }, 0);
        posts = [{ acc: { id: ledgerId, type: ledger.type }, amount: tot, memo: '', name: r0.name || '' }].concat(posts.filter(function (p) { return p.acc.id !== ledgerId; }));
      }
      var t = { qbType: qbType, date: r0.date, num: String(r0.num || '').trim(), name: String(r0.name || '').trim(), memo: g.rows.length === 1 ? String(r0.memo || '').trim() : '',
        adj: g.lines.some(function (x) { return String(x.r.adj || '').trim(); }) };
      var d = OB.qbimport.toDraft(t, posts, contactFor, function () { return ''; }, {}, {}, function () { return null; }, {});
      if (!d) return;
      delete d._posts; delete d._payNum;
      if (t.adj && d.type !== 'journal') d.memo = [d.memo, '(adjusting entry)'].filter(Boolean).join(' ');
      var ledgerTotal = posts.filter(function (p) { return p.acc.id === ledgerId; }).reduce(function (s, p) { return s + p.amount; }, 0);
      var others = posts.filter(function (p) { return p.acc.id !== ledgerId; }).map(function (p) { return p.acc.id; });
      var dup = (b.splitIndex()[ledgerId] || []).some(function (e) {
        if (e.t.date !== t.date) return false;
        var onLedger = e.t.splits.filter(function (s) { return s.accountId === ledgerId; }).reduce(function (s, x) { return s + x.amount; }, 0);
        return onLedger === ledgerTotal && e.t.splits.some(function (s) { return others.indexOf(s.accountId) >= 0; });
      });
      res.entries.push({ rows: g.rows, kind: d.type, draft: d, duplicate: dup, clear: g.lines.some(function (x) { return String(x.r.clr || '').trim(); }) });
    });
    return res;
  };

  function swapIds(d, ids) {
    var walk = function (o) { Object.keys(o).forEach(function (k) { var v = o[k]; if (typeof v === 'string' && ids[v]) o[k] = ids[v]; else if (v && typeof v === 'object') walk(v); }); };
    walk(d); return d;
  }
  /** Create the missing accounts and names, then post every entry in one atomic write and mark the cleared ones.
   *  Rejects without posting when a row has an error or an entry would not save. Resolves { saved, accounts, contacts }. */
  P.post = function (b, ledgerId, rows, opts) {
    opts = opts || {};
    var p = P.plan(b, ledgerId, rows, opts);
    var fail = function (list) { return Promise.reject(new Error(list.slice(0, 8).map(function (e) { return 'Row ' + (e.row + 1) + ': ' + e.message; }).join('\n') + (list.length > 8 ? '\n…and ' + (list.length - 8) + ' more' : ''))); };
    if (p.errors.length) return fail(p.errors);
    if (!p.entries.length) return Promise.reject(new Error('There are no entries to post.'));
    var ids = {}, made = { accounts: [], contacts: [] }, chain = Promise.resolve();
    p.missing.forEach(function (m) {
      chain = chain.then(function () { return b.saveAccount({ name: m.name, type: m.type, parentId: m.parentId }); }).then(function (a) { ids['new:' + m.key] = a.id; made.accounts.push(a); });
    });
    p.newNames.forEach(function (n) {
      chain = chain.then(function () { return b.saveContact({ name: n.name, kind: n.kind }); }).then(function (c) { ids[n.id] = c.id; made.contacts.push(c); });
    });
    return chain.then(function () {
      var drafts = p.entries.map(function (e) { return swapIds(e.draft, ids); }), bad = [];
      drafts.forEach(function (d, k) {
        var errs; try { errs = b.validate(b.normalize(d), null); } catch (e) { errs = [{ message: e.message }]; }
        if (errs.length) bad.push({ row: p.entries[k].rows[0], message: errs.map(function (x) { return x.message; }).join(' ') });
      });
      if (bad.length) return fail(bad);
      return b.saveTransactions(drafts).then(function (saved) {
        var marks = Promise.resolve();
        saved.forEach(function (t, k) {
          if (!p.entries[k].clear) return;
          b.txById[t.id].splits.forEach(function (s, i) {
            var a = b.accById[s.accountId]; if (a && (a.type === 'bank' || a.type === 'cc')) marks = marks.then(function () { return b.setCleared(t.id, i, true); });
          });
        });
        return marks.then(function () { return { saved: saved.map(function (t) { return b.txById[t.id]; }), accounts: made.accounts, contacts: made.contacts }; });
      });
    });
  };
})(typeof window !== 'undefined' ? window : globalThis);
