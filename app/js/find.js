/* VaultBook — Find engine (1.27): advanced transaction search and search across all company data.
 * Pure functions over a Book; no DOM. Money in integer cents.
 *   F.find(book, criteria)        → { rows: [{ t, why: [text], open }], count, total }
 *   F.parse(book, text, today)    → criteria read from plain words ("invoices over 1000 from acme may 2026")
 *                                   and field:value words (memo:"cash paid" amount>25000, as in TallyPrime)
 *   F.describe(book, criteria)    → the criteria in plain English
 *   F.everything(book, text, today) → { transactions, contacts, accounts, items, bankLines }
 * criteria = { match: 'all'|'any', conds: [cond], from, to, status: 'posted'|'void'|'all', today }
 * cond = { field, op, value, value2, ids, target } — fields and operators in F.FIELDS / F.OPS.
 * No date limit: without from/to every date is searched.
 */
(function (root) {
  'use strict';
  var OB = root.OB, U = OB.util, S = OB.schema;
  var F = OB.find = {};

  F.FIELDS = [
    { k: 'text', label: 'Any text', kind: 'text', hint: 'number, memo, names, line descriptions, accounts' },
    { k: 'memo', label: 'Memo or description', kind: 'text', hint: 'the memo and every line description and line memo' },
    { k: 'number', label: 'Number (No., check, ref)', kind: 'text' },
    { k: 'name', label: 'Customer, vendor or payee', kind: 'ref', list: 'contact' },
    { k: 'nametext', label: 'Name contains', kind: 'text' },
    { k: 'num', label: 'Amount or number', kind: 'num', hint: 'e.g. 1162 or 30,000.00' },
    { k: 'account', label: 'Account', kind: 'ref', list: 'account' },
    { k: 'type', label: 'Transaction type', kind: 'ref', list: 'type' },
    { k: 'amount', label: 'Amount', kind: 'amount' },
    { k: 'date', label: 'Date', kind: 'date' },
    { k: 'due', label: 'Due date', kind: 'date' },
    { k: 'class', label: 'Class', kind: 'ref', list: 'class' },
    { k: 'item', label: 'Product or service', kind: 'ref', list: 'item' },
    { k: 'balance', label: 'Paid status', kind: 'choice', choices: [['open', 'Open (not fully paid)'], ['overdue', 'Overdue'], ['paid', 'Paid in full']] },
    { k: 'cleared', label: 'Cleared in the bank', kind: 'choice', choices: [['uncleared', 'Not cleared'], ['cleared', 'Cleared'], ['reconciled', 'Reconciled']] },
    { k: 'source', label: 'Entered how', kind: 'choice', choices: [['manual', 'Typed in VaultBook'], ['imported', 'Imported']] },
    { k: 'entered', label: 'Entered on', kind: 'date' },
    { k: 'modified', label: 'Last changed on', kind: 'date' }
  ];
  F.OPS = {
    text: [['contains', 'contains'], ['notcontains', 'does not contain'], ['is', 'is exactly'], ['startswith', 'starts with'], ['empty', 'is empty'], ['notempty', 'is not empty']],
    ref: [['is', 'is any of'], ['isnot', 'is none of']],
    amount: [['eq', '='], ['ne', '≠'], ['gt', '>'], ['gte', '≥'], ['lt', '<'], ['lte', '≤'], ['between', 'between']],
    date: [['on', 'on'], ['before', 'before'], ['after', 'after'], ['between', 'between'], ['empty', 'is empty']],
    choice: [['is', 'is']],
    num: [['is', 'is']]
  };
  F.field = function (k) { return F.FIELDS.find(function (f) { return f.k === k; }); };
  var OPEN_TYPES = ['invoice', 'bill', 'creditMemo', 'vendorCredit'];

  function cents(v) { if (typeof v === 'number') return Math.round(v); return Math.abs(U.toCents(String(v || '0').replace(/[$,\s]/g, ''))); }
  function low(s) { return String(s == null ? '' : s).toLowerCase(); }
  function compact(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
  function money(c) { return U.fmt(c, { symbol: true }); }
  function cname(book, id) { var c = id && book.contactById[id]; return c ? c.name : ''; }
  function aname(book, id) { var a = id && book.accById[id]; return a ? (a.number ? a.number + ' ' : '') + a.name : ''; }
  function typeLabel(k) { return S.TXN_TYPES[k] ? S.TXN_TYPES[k].label : k; }
  function lines(t) { return t.lines || t.jlines || []; }
  function contactsOf(t) { var o = {}; if (t.contactId) o[t.contactId] = 1; lines(t).forEach(function (l) { if (l.contactId) o[l.contactId] = 1; }); (t.splits || []).forEach(function (s) { if (s.contactId) o[s.contactId] = 1; }); return Object.keys(o); }

  /* text pieces of a transaction, labelled so a match can say where it was found */
  function pieces(book, t, which) {
    var p = [];
    if (which === 'number') { p.push(['No.', t.number || '']); if (t.checkNo) p.push(['Check no.', t.checkNo]); return p; }
    if (which === 'nametext') { contactsOf(t).forEach(function (id) { p.push(['Name', cname(book, id)]); }); return p; }
    if (which === 'text') { p.push(['Type', typeLabel(t.type)]); p.push(['No.', t.number || '']); contactsOf(t).forEach(function (id) { p.push(['Name', cname(book, id)]); }); }
    p.push(['Memo', t.memo || '']);
    lines(t).forEach(function (l, i) { if (l.description) p.push(['Line ' + (i + 1), l.description]); if (l.memo) p.push(['Line ' + (i + 1) + ' memo', l.memo]); });
    (t.splits || []).forEach(function (s) { if (s.memo && s.memo !== t.memo && !p.some(function (x) { return x[1] === s.memo; })) p.push(['Line memo', s.memo]); });
    if (which === 'text') {
      var seen = {}; (t.splits || []).forEach(function (s) { if (!seen[s.accountId]) { seen[s.accountId] = 1; p.push(['Account', aname(book, s.accountId)]); } });
      p.push(['Amount', U.fmtPlain(t.total || 0)]);
    }
    return p.filter(function (x) { return x[1] !== ''; });
  }
  function short(s) { s = String(s); return s.length > 60 ? s.slice(0, 57) + '…' : s; }

  function testText(book, t, c) {
    var v = low(c.value).trim(), ps = pieces(book, t, c.field);
    if (c.field === 'memo' && (c.op === 'empty' || c.op === 'notempty')) { var e = !String(t.memo || '').trim(); return { ok: c.op === 'empty' ? e : !e, why: [] }; }
    if (c.op === 'empty') return { ok: !ps.length, why: [] };
    if (c.op === 'notempty') return { ok: ps.length > 0, why: [] };
    if (!v) return { ok: true, why: [] };
    var hit = ps.filter(function (x) { var h = low(x[1]); return c.op === 'is' ? h === v : c.op === 'startswith' ? h.indexOf(v) === 0 : h.indexOf(v) >= 0 || (c.field === 'text' || c.field === 'nametext') && v.length >= 4 && compact(h).indexOf(compact(v)) >= 0 && compact(v).length >= 4; });
    if (c.op === 'notcontains') return { ok: !hit.length, why: [] };
    return { ok: hit.length > 0, why: hit.map(function (x) { return x[0] + ': ' + short(x[1]); }) };
  }

  function testRef(book, t, c) {
    var ids = c.ids || [], have = [];
    if (c.field === 'name') have = contactsOf(t);
    else if (c.field === 'account') have = (t.splits || []).map(function (s) { return s.accountId; });
    else if (c.field === 'type') have = [t.type];
    else if (c.field === 'class') { have = [t.classId].concat(lines(t).map(function (l) { return l.classId; }), (t.splits || []).map(function (s) { return s.classId; })).filter(Boolean); }
    else if (c.field === 'item') have = lines(t).map(function (l) { return l.itemId; }).filter(Boolean);
    var hit = ids.filter(function (id) { return have.indexOf(id) >= 0; });
    if (c.op === 'isnot') return { ok: !hit.length, why: [] };
    if (!ids.length || c.field === 'type') return { ok: !ids.length || hit.length > 0, why: [] };
    var lab = { name: 'Name', account: 'Account', type: 'Type', class: 'Class', item: 'Item' }[c.field];
    return { ok: hit.length > 0, why: hit.map(function (id) {
      return lab + ': ' + (c.field === 'name' ? cname(book, id) : c.field === 'account' ? aname(book, id) : c.field === 'type' ? typeLabel(id)
        : c.field === 'class' ? ((book.classes || []).find(function (x) { return x.id === id; }) || {}).name : ((book.items || []).find(function (x) { return x.id === id; }) || {}).name);
    }) };
  }

  function cmp(op, a, v1, v2) {
    switch (op) { case 'eq': case 'on': return a === v1; case 'ne': return a !== v1; case 'gt': case 'after': return a > v1; case 'gte': return a >= v1;
      case 'lt': case 'before': return a < v1; case 'lte': return a <= v1; case 'between': return a >= v1 && a <= v2; }
    return false;
  }
  function testAmount(book, t, c) {
    var v1 = cents(c.value), v2 = c.value2 === undefined || c.value2 === '' ? v1 : cents(c.value2), tg = c.target || 'total', why = [];
    if (c.op === 'between' && v2 < v1) { var x = v1; v1 = v2; v2 = x; }
    if (tg !== 'line' && cmp(c.op, Math.abs(t.total || 0), v1, v2)) why.push('Amount: ' + money(Math.abs(t.total || 0)));
    if (tg !== 'total') {
      var ls = lines(t).length ? lines(t).map(function (l, i) { return [i + 1, Math.abs(l.amount || 0)]; }) : (t.splits || []).map(function (s, i) { return [i + 1, Math.abs(s.amount || 0)]; });
      ls.forEach(function (l) { if (l[1] && cmp(c.op, l[1], v1, v2) && !(tg === 'either' && l[1] === Math.abs(t.total || 0))) why.push('Line ' + l[0] + ' amount: ' + money(l[1])); });
    }
    if (c.op === 'ne') return { ok: tg === 'line' ? why.length > 0 : Math.abs(t.total || 0) !== v1, why: [] };
    return { ok: why.length > 0, why: why };
  }
  function testDate(book, t, c) {
    var d = c.field === 'date' ? t.date : c.field === 'due' ? t.dueDate : c.field === 'entered' ? String(t.createdAt || '').slice(0, 10) : String(t.updatedAt || t.createdAt || '').slice(0, 10);
    if (c.op === 'empty') return { ok: !d, why: [] };
    if (!d) return { ok: false, why: [] };
    var v1 = c.value || '', v2 = c.value2 || v1;
    if (c.op === 'between' && v2 < v1) { var x = v1; v1 = v2; v2 = x; }
    var ok = cmp(c.op, d, v1, v2);
    return { ok: ok, why: ok && c.field !== 'date' ? [F.field(c.field).label + ': ' + U.fmtDate(d)] : [] };
  }
  function testChoice(book, t, c, today) {
    if (c.field === 'balance') {
      if (OPEN_TYPES.indexOf(t.type) < 0 || t.status !== 'posted') return { ok: false, why: [] };
      var ob = book.openBalance(t);
      if (c.value === 'paid') return { ok: ob === 0, why: ['Paid in full'] };
      if (c.value === 'overdue') { var od = ob > 0 && t.dueDate && t.dueDate < today; return { ok: !!od, why: od ? ['Overdue since ' + U.fmtDate(t.dueDate) + ', ' + money(ob) + ' open'] : [] }; }
      return { ok: ob > 0, why: ob > 0 ? [money(ob) + ' open'] : [] };
    }
    if (c.field === 'cleared') {
      var want = { uncleared: '', cleared: 'C', reconciled: 'R' }[c.value];
      var bank = (t.splits || []).filter(function (s) { var a = book.accById[s.accountId]; return a && (a.type === 'bank' || a.type === 'cc'); });
      var hit = bank.filter(function (s) { return (s.cleared || '') === want; });
      return { ok: hit.length > 0, why: hit.map(function (s) { return aname(book, s.accountId) + ': ' + ({ '': 'not cleared', C: 'cleared', R: 'reconciled' })[want]; }) };
    }
    if (c.field === 'source') { var imp = !!t.importRef; return { ok: c.value === 'imported' ? imp : !imp, why: imp && c.value === 'imported' ? ['Imported'] : [] }; }
    if (c.field === 'status') return { ok: t.status === c.value, why: [] };
    return { ok: true, why: [] };
  }
  // a bare number typed in the search box: the amount (whole or any line) or the transaction number
  function testNum(book, t, c) {
    var why = [];
    if (t.number && String(t.number).replace(/^0+/, '') === String(c.value).replace(/[$,]/g, '').replace(/^0+/, '')) why.push('No.: ' + t.number);
    var cc = c.cents !== undefined ? c.cents : isAmt(String(c.value || '').trim()) ? cents(c.value) : 0;
    if (cc) why = why.concat(testAmount(book, t, { op: 'eq', value: cc, target: 'either' }).why);
    return { ok: why.length > 0, why: why };
  }

  function test(book, t, c, today) {
    var f = c.field === 'status' ? { kind: 'choice' } : F.field(c.field);
    if (f && f.kind === 'num' && !String(c.value || '').trim()) return { ok: true, why: [] };
    if (!f) return { ok: true, why: [] };
    switch (f.kind) {
      case 'text': return testText(book, t, c);
      case 'ref': return testRef(book, t, c);
      case 'amount': return testAmount(book, t, c);
      case 'date': return testDate(book, t, c);
      case 'choice': return testChoice(book, t, c, today);
      case 'num': return testNum(book, t, c);
    }
    return { ok: true, why: [] };
  }

  F.find = function (book, cr) {
    cr = cr || {};
    var conds = (cr.conds || []).filter(Boolean), any = cr.match === 'any', today = cr.today || U.today(), status = cr.status || 'posted';
    var rows = [];
    book.transactions.forEach(function (t) {
      if (status !== 'all' && t.status !== status) return;
      if (cr.from && t.date < cr.from) return;
      if (cr.to && t.date > cr.to) return;
      var why = [], okAll = true, okAny = !conds.length;
      conds.forEach(function (c) { var r = test(book, t, c, today); if (r.ok) { okAny = true; why = why.concat(r.why); } else okAll = false; });
      if (any ? okAny : okAll) {
        var uniq = []; why.forEach(function (w) { if (w && uniq.indexOf(w) < 0) uniq.push(w); });
        rows.push({ t: t, why: uniq, open: OPEN_TYPES.indexOf(t.type) >= 0 && t.status === 'posted' ? book.openBalance(t) : null });
      }
    });
    rows.sort(function (a, b) { return -OB.Book.cmpTxn(a.t, b.t); });
    return { rows: rows, count: rows.length, total: U.sum(rows, function (r) { return r.t.total || 0; }) };
  };

  /* ---------------- reading the search box ---------------- */
  var MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  var STOP = { from: 1, for: 1, to: 1, by: 1, of: 1, the: 1, and: 1, with: 1, all: 1, show: 1, me: 1, find: 1, any: 1, a: 1, an: 1, on: 1, at: 1, dated: 1 };
  function typeAliases() {
    var out = [];
    Object.keys(S.TXN_TYPES).forEach(function (k) {
      var l = low(typeLabel(k)); out.push([l, k]); out.push([l + 's', k]); out.push([low(k), k]);
    });
    [['je', 'journal'], ['jv', 'journal'], ['journals', 'journal'], ['journal entries', 'journal'], ['cheque', 'check'], ['cheques', 'check'], ['quote', 'estimate'], ['quotes', 'estimate'],
      ['po', 'purchaseOrder'], ['pos', 'purchaseOrder'], ['receipts', 'salesReceipt'], ['sales receipt', 'salesReceipt'], ['bill payment', 'billPayment'], ['bill payments', 'billPayment'],
      ['customer payment', 'payment'], ['customer payments', 'payment'], ['credit memo', 'creditMemo'], ['credit memos', 'creditMemo']].forEach(function (x) { if (S.TXN_TYPES[x[1]]) out.push(x); });
    out.sort(function (a, b) { return b[0].split(' ').length - a[0].split(' ').length || b[0].length - a[0].length; });
    return out;
  }
  function readDate(s, today) {
    var m;
    if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s))) return U.ymd(+m[1], +m[2], +m[3]);
    if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(s))) { var y = +m[3]; if (y < 100) y += 2000; if (+m[1] >= 1 && +m[1] <= 12 && +m[2] >= 1 && +m[2] <= 31) return U.ymd(y, +m[1], +m[2]); }
    return '';
  }
  var AMT = /^\$?(\d{1,3}(,\d{3})+|\d+)(\.\d{1,2})?$|^\$?\.\d{1,2}$/;
  function isAmt(s) { return AMT.test(s); }

  F.parse = function (book, text, today) {
    today = today || U.today();
    var cr = { match: 'all', conds: [], status: 'posted', from: '', to: '' }, types = [];
    var s = ' ' + String(text || '').replace(/[“”]/g, '"') + ' ';
    var phrases = [];
    // field:value (TallyPrime style), value may be quoted; also amount>1000, date>=2026-01-01
    s = s.replace(/\b(type|name|customer|vendor|payee|party|memo|desc|description|narration|note|no|num|number|ref|check|account|acct|ledger|class|item|product|amount|amt|date|due|status|is)\s*(:|>=|<=|>|<|=)\s*("([^"]*)"|'([^']*)'|[^\s]+)/gi, function (all, f, op, v, q1, q2) {
      f = low(f); v = q1 !== undefined ? q1 : q2 !== undefined ? q2 : v;
      var ops = { '>': 'gt', '>=': 'gte', '<': 'lt', '<=': 'lte', '=': 'eq', ':': 'eq' };
      if (f === 'amount' || f === 'amt') {
        var mm = /^(.+)\.\.(.+)$/.exec(v);
        if (mm) cr.conds.push({ field: 'amount', op: 'between', value: mm[1], value2: mm[2], target: 'either' });
        else if (isAmt(v)) cr.conds.push({ field: 'amount', op: ops[op], value: v, target: 'either' });
      } else if (f === 'date' || f === 'due') {
        var d = readDate(v, today), dop = { gt: 'after', gte: 'after', lt: 'before', lte: 'before', eq: 'on' }[ops[op]];
        if (d) { if (op === '>=') d = U.addDays(d, -1); if (op === '<=') d = U.addDays(d, 1); cr.conds.push({ field: f, op: dop, value: d }); }
      } else if (f === 'type') { var ta = typeAliases().find(function (x) { return x[0] === low(v); }); if (ta) types.push(ta[1]); }
      else if (f === 'status') { if (/^void/i.test(v)) cr.status = 'void'; else if (/^all/i.test(v)) cr.status = 'all'; }
      else if (f === 'is') { if (/^(open|unpaid)$/i.test(v)) cr.conds.push({ field: 'balance', op: 'is', value: 'open' }); else if (/^overdue$/i.test(v)) cr.conds.push({ field: 'balance', op: 'is', value: 'overdue' }); else if (/^paid$/i.test(v)) cr.conds.push({ field: 'balance', op: 'is', value: 'paid' }); }
      else {
        var fld = { name: 'nametext', customer: 'nametext', vendor: 'nametext', payee: 'nametext', party: 'nametext', memo: 'memo', desc: 'memo', description: 'memo', narration: 'memo', note: 'memo',
          no: 'number', num: 'number', number: 'number', ref: 'number', check: 'number', account: 'accounttext', acct: 'accounttext', ledger: 'accounttext', class: 'classtext', item: 'itemtext', product: 'itemtext' }[f];
        if (fld === 'accounttext' || fld === 'classtext' || fld === 'itemtext') {
          var lv = low(v), list = fld === 'accounttext' ? book.accounts : fld === 'classtext' ? (book.classes || []) : (book.items || []);
          var ids = list.filter(function (a) { return low(a.name).indexOf(lv) >= 0 || a.number && String(a.number) === v; }).map(function (a) { return a.id; });
          cr.conds.push({ field: fld === 'accounttext' ? 'account' : fld === 'classtext' ? 'class' : 'item', op: 'is', ids: ids.length ? ids : ['(none)'], label: v });
        } else if (fld) cr.conds.push({ field: fld, op: fld === 'number' && op === '=' ? 'is' : 'contains', value: v });
      }
      return ' ';
    });
    s = s.replace(/"([^"]+)"/g, function (a, p) { phrases.push(p); return ' '; });
    s = s.replace(/([<>]=?)\s+/g, '$1');
    s = low(s);
    // amount words
    s = s.replace(/\bbetween\s+(\$?[\d,.]+)\s+and\s+(\$?[\d,.]+)/g, function (a, x, y) { cr.conds.push({ field: 'amount', op: 'between', value: x, value2: y, target: 'either' }); return ' '; });
    s = s.replace(/\b(over|above|more than|greater than|at least|under|below|less than|at most)\s+(\$?[\d,]+(\.\d{1,2})?)/g, function (a, w, v) {
      var op = /over|above|more|greater/.test(w) ? 'gt' : w === 'at least' ? 'gte' : w === 'at most' ? 'lte' : 'lt';
      cr.conds.push({ field: 'amount', op: op, value: v, target: 'either' }); return ' ';
    });
    s = s.replace(/(^|\s)(>=|<=|>|<)(\$?[\d,]+(\.\d{1,2})?)(?=\s)/g, function (a, sp, o, v) { cr.conds.push({ field: 'amount', op: { '>': 'gt', '>=': 'gte', '<': 'lt', '<=': 'lte' }[o], value: v, target: 'either' }); return ' '; });
    // periods
    var y0 = +today.slice(0, 4), setP = function (f, t) { cr.from = f; cr.to = t; return ' '; };
    s = s.replace(/\b(this|last) (month|quarter|year)\b|\bytd\b|\byear to date\b|\btoday\b|\byesterday\b/g, function (w) {
      var ms = U.monthStart(today), qs = U.ymd(y0, Math.floor((+today.slice(5, 7) - 1) / 3) * 3 + 1, 1);
      if (w === 'this month') return setP(ms, U.monthEnd(today));
      if (w === 'last month') { var lm = U.addMonths(ms, -1); return setP(lm, U.monthEnd(lm)); }
      if (w === 'this quarter') return setP(qs, U.addDays(U.addMonths(qs, 3), -1));
      if (w === 'last quarter') { var lq = U.addMonths(qs, -3); return setP(lq, U.addDays(qs, -1)); }
      if (w === 'this year') return setP(U.ymd(y0, 1, 1), U.ymd(y0, 12, 31));
      if (w === 'last year') return setP(U.ymd(y0 - 1, 1, 1), U.ymd(y0 - 1, 12, 31));
      if (w === 'today') return setP(today, today);
      if (w === 'yesterday') { var yd = U.addDays(today, -1); return setP(yd, yd); }
      return setP(U.ymd(y0, 1, 1), today);
    });
    s = s.replace(new RegExp('\\b(' + MONTHS.join('|') + '|' + MONTHS.map(function (m) { return m.slice(0, 3); }).join('|') + ')\\.?\\s+(\\d{4})\\b', 'g'), function (a, m, y) {
      var i = MONTHS.findIndex(function (x) { return x.indexOf(m) === 0; }), st = U.ymd(+y, i + 1, 1); return setP(st, U.monthEnd(st));
    });
    s = s.replace(/\bin\s+((19|20)\d{2})\b/g, function (a, y) { return setP(U.ymd(+y, 1, 1), U.ymd(+y, 12, 31)); });
    // status / paid words
    s = s.replace(/\b(voided|void)\b/g, function () { cr.status = 'void'; return ' '; });
    s = s.replace(/\b(unpaid|open|overdue)\b/g, function (w) { cr.conds.push({ field: 'balance', op: 'is', value: w === 'overdue' ? 'overdue' : 'open' }); return ' '; });
    // transaction types, longest first
    typeAliases().forEach(function (x) {
      s = s.replace(new RegExp('(^|\\s)' + x[0].replace(/ /g, '\\s+') + '(?=\\s|$)', 'g'), function (a, sp) { if (types.indexOf(x[1]) < 0) types.push(x[1]); return sp + ' '; });
    });
    if (types.length) cr.conds.push({ field: 'type', op: 'is', ids: types });
    // names: the longest run of words that is a customer/vendor name (spaces ignored), or its first two words
    var words = s.split(/\s+/).filter(Boolean), keys = {};
    (book.contacts || []).forEach(function (c) {
      var full = compact(c.name), w2 = c.name.toUpperCase().split(/[^A-Z0-9]+/).filter(function (w) { return w && !/^(THE|LLC|INC|CO|LTD|CORP|AND|OF|PLLC|LLP|PC|PA|DBA)$/.test(w); });
      [full, w2.slice(0, 2).join('')].forEach(function (k) { if (k.length >= 4) (keys[k] = keys[k] || []).indexOf(c.id) < 0 && keys[k].push(c.id); });
    });
    var names = [], label = [];
    for (var n = Math.min(6, words.length); n >= 1; n--) {
      for (var i = 0; i + n <= words.length; i++) {
        var seg = words.slice(i, i + n);
        if (seg.some(function (w) { return !w; })) continue;
        var k = compact(seg.join(''));
        if (keys[k] && !(n === 1 && STOP[seg[0]])) { keys[k].forEach(function (id) { if (names.indexOf(id) < 0) names.push(id); }); label.push(seg.join(' ')); for (var j = i; j < i + n; j++) words[j] = ''; }
      }
    }
    if (names.length) cr.conds.push({ field: 'name', op: 'is', ids: names });
    // what is left: dates, numbers, words
    words.filter(Boolean).forEach(function (w) {
      var d = readDate(w, today);
      if (d) { cr.conds.push({ field: 'date', op: 'on', value: d }); return; }
      if (isAmt(w)) { var c0 = cents(w); cr.conds.push({ field: 'num', op: 'is', value: w, cents: c0 > 0 ? c0 : 0 }); return; }
      if (STOP[w] || w.length < 2) return;
      cr.conds.push({ field: 'text', op: 'contains', value: w });
    });
    phrases.forEach(function (p) { cr.conds.push({ field: 'text', op: 'contains', value: p }); });
    return cr;
  };

  F.describe = function (book, cr) {
    var opl = function (kind, op) { var o = (F.OPS[kind] || []).find(function (x) { return x[0] === op; }); return o ? o[1] : op; };
    var parts = (cr.conds || []).map(function (c) {
      var f = F.field(c.field); if (!f) return '';
      if (f.kind === 'ref') {
        var names = c.label || (c.ids || []).map(function (id) { return c.field === 'name' ? cname(book, id) : c.field === 'account' ? aname(book, id) : c.field === 'type' ? typeLabel(id) : id; }).join(', ');
        return f.label.toLowerCase() + ' ' + opl('ref', c.op) + ' ' + names;
      }
      if (f.kind === 'amount') return (c.target === 'line' ? 'a line amount ' : 'amount ') + opl('amount', c.op) + ' ' + money(cents(c.value)) + (c.op === 'between' ? ' and ' + money(cents(c.value2)) : '');
      if (f.kind === 'date') return f.label.toLowerCase() + ' ' + opl('date', c.op) + (c.op === 'empty' ? '' : ' ' + U.fmtDate(c.value) + (c.op === 'between' ? ' and ' + U.fmtDate(c.value2) : ''));
      if (f.kind === 'num') return 'amount or number is ' + c.value;
      if (f.kind === 'choice') return f.label.toLowerCase() + ': ' + ((f.choices.find(function (x) { return x[0] === c.value; }) || [0, c.value])[1]).toLowerCase();
      return f.label.toLowerCase() + ' ' + opl('text', c.op) + (c.op === 'empty' || c.op === 'notempty' ? '' : ' "' + c.value + '"');
    }).filter(Boolean);
    var when = cr.from || cr.to ? (cr.from && cr.to ? U.fmtDate(cr.from) + ' – ' + U.fmtDate(cr.to) : cr.from ? 'from ' + U.fmtDate(cr.from) : 'up to ' + U.fmtDate(cr.to)) : 'all dates';
    var st = cr.status === 'void' ? 'voided ' : cr.status === 'all' ? 'posted and voided ' : '';
    return (st ? st.charAt(0).toUpperCase() + st.slice(1) : '') + (st ? 'transactions' : 'Transactions') + (parts.length ? ' where ' + parts.join(cr.match === 'any' ? ' or ' : ' and ') : '') + ', ' + when;
  };

  /* ---------------- search everything ---------------- */
  F.everything = function (book, text, today) {
    var q = String(text || '').trim(), out = { transactions: [], contacts: [], accounts: [], items: [], bankLines: [], criteria: null };
    if (!q) return out;
    var cr = F.parse(book, q, today); out.criteria = cr;
    out.transactions = cr.conds.length || cr.from || cr.status !== 'posted' ? F.find(book, cr).rows : [];
    // lists use what the search box read: names it recognised, plus the leftover words
    var ws = cr.conds.filter(function (c) { return c.field === 'text'; }).map(function (c) { return low(c.value); });
    var numc = cr.conds.find(function (c) { return c.field === 'num'; }), num = numc ? numc.cents : 0;
    var nameIds = [].concat.apply([], cr.conds.filter(function (c) { return c.field === 'name'; }).map(function (c) { return c.ids; }));
    var accIds = [].concat.apply([], cr.conds.filter(function (c) { return c.field === 'account'; }).map(function (c) { return c.ids; }));
    var hit = function (parts) { var h = low(parts.join(' ')), hc = compact(parts.join(' ')); return ws.length > 0 && ws.every(function (w) { return h.indexOf(w) >= 0 || w.length >= 4 && hc.indexOf(compact(w)) >= 0; }); };
    out.contacts = (book.contacts || []).filter(function (c) { return nameIds.indexOf(c.id) >= 0 || hit([c.name, c.company, c.email, c.phone, c.address, c.notes, c.kind]); });
    out.accounts = (book.accounts || []).filter(function (a) { return accIds.indexOf(a.id) >= 0 || hit([a.name, a.number, a.description, S.TYPE && S.TYPE[a.type] ? S.TYPE[a.type].label : a.type]); });
    out.items = (book.items || []).filter(function (i) { return hit([i.name, i.sku, i.description, i.purchaseDescription]); });
    var nameKeys = nameIds.map(function (id) { return compact(book.contactById[id].name.split(/\s+/).slice(0, 2).join('')); });
    out.bankLines = (book.bankLines || []).filter(function (l) {
      if (l.status === 'removed') return false;
      if (num && Math.abs(l.amount) !== num) return false;
      if (nameKeys.length && !nameKeys.some(function (k) { return compact(l.description).indexOf(k) >= 0; })) return false;
      if (ws.length && !hit([l.description, l.checkNo, l.note])) return false;
      return !!(num || nameKeys.length || ws.length);
    });
    return out;
  };
})(typeof window !== 'undefined' ? window : globalThis);
