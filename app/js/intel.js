/* VaultBook Intelligence (1.42): answers questions about the books in plain words, offline.
 *   I.extract(text)                  words -> slots (what, which ones, how to show it). No book needed; an on-device
 *                                    language model may supply the same slots instead (see ui-intel.js).
 *   I.resolve(book, slots, ctx, today) slots -> intent: names become records, period words become dates.
 *   I.run(book, intent, today)       intent -> answer. Every figure comes from OB.reports or the ledger; nothing is estimated.
 *   I.ask(book, text, ctx, today)    the three together.
 * Read-only: nothing here posts or changes a record. Money in integer cents. */
(function (root) {
  'use strict';
  var OB = root.OB = root.OB || {}, U = OB.util, I = OB.intel = {};
  var MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  var money = function (c) { return U.fmt(c, { symbol: true }); };
  var plural = function (n, w, ws) { return n + ' ' + (n === 1 ? w : (ws || w + 's')); };
  var norm = function (s) { return String(s || '').toLowerCase().replace(/[^a-z0-9$%./ ]+/g, ' ').replace(/\s+/g, ' ').trim(); };
  var nameKey = function (s) { return norm(s).replace(/[./]/g, ' ').replace(/\b(inc|llc|l l c|pc|p c|ltd|co|corp|corporation|company|the|and)\b/g, ' ').replace(/\s+/g, ' ').trim(); };

  /* ---------- 1. words -> slots ---------- */
  var SUBJECTS = [
    ['bankfeed', /\bbank ?feeds?\b|\bto review\b|\bfor review\b|\buncategori[sz]ed\b/],
    ['invoices', /\binvoices?\b|\breceivables?\b|\ba\/r\b|\bowes? us\b|\bowed to us\b|\bowing us\b/],
    ['bills', /\bbills?\b|\bpayables?\b|\ba\/p\b|\bwe owe\b|\bdo we owe\b|\bunpaid bills?\b/],
    ['customers', /\bcustomers?\b|\bclients?\b/],
    ['vendors', /\bvendors?\b|\bsuppliers?\b|\bpayees?\b|\bcontractors?\b/],
    ['accounts', /\baccounts?\b(?! receivable| payable)|\bchart of accounts\b/],
    ['profit', /\bprofit\b|\bnet income\b|\bearnings\b|\bbottom line\b|\bloss\b|\bmargin\b/],
    ['expenses', /\bexpenses?\b|\bspend(ing)?\b|\bspent\b|\bcosts?\b/],
    ['income', /\bincome\b|\brevenue\b|\bsales\b|\bturnover\b|\bearned\b/],
    ['cash', /\bcash\b|\bbank balances?\b|\bmoney in (the )?bank\b|\bin the bank\b/]
  ];
  /** Words -> slots. Pure text work: the same slots can come from a language model. */
  I.extract = function (text) {
    var q = norm(text), s = { text: String(text || '').trim(), subject: '', shape: '', name: '' }, m;
    // "check 1042", "invoice INV-7", "bill #88": a document number is a search, whatever else the words look like
    if (/\b(check|cheque|invoice|bill|journal|deposit|payment|receipt)s?\s*(no|number|num|#)?\s*[a-z]{0,4}[- ]?\d+\b/.test(q) && !/\bdays?\b|\btop\b|\blast\b/.test(q) || /^\$? ?[\d,]+(\.\d\d)?$/.test(q)) { s.subject = 'find'; s.shape = 'list'; s.name = ''; s.period = null; s.findDoc = true; return s; }
    SUBJECTS.some(function (x) { if (x[1].test(q)) { s.subject = x[0]; return true; } return false; });
    if (/\bhow many\b|\bnumber of\b|\bcount\b/.test(q)) s.shape = 'count';
    else if (/\bwhy\b|\bwhat changed\b|\bexplain\b|\breason\b/.test(q)) s.shape = 'why';
    else if (/\b(each|every|per|by) month\b|\bmonthly\b|\bmonth by month\b|\bmonth wise\b|\btrend\b/.test(q)) s.shape = 'bymonth';
    else if (/\btop\b|\bbiggest\b|\blargest\b|\bhighest\b|\bmost\b/.test(q)) s.shape = 'top';
    else if (/\bhow much\b|\btotal\b|\bsum\b/.test(q)) s.shape = 'total';
    else if (/\bshow\b|\blist\b|\bwhich\b|\bwho\b|\bgive me\b|\bwhat are\b/.test(q)) s.shape = 'list';
    if (/\bpercent(age)?s?\b|%|\bshare\b/.test(q)) s.percent = true;
    if ((m = /\btop (\d{1,2})\b/.exec(q))) s.top = +m[1];
    if (/\bopen\b|\bunpaid\b|\boutstanding\b|\bowes?\b|\bowed\b|\bowing\b|\bdue\b/.test(q)) s.open = true;
    if (/\boverdue\b|\blate\b|\bpast due\b/.test(q)) { s.open = true; s.overdue = true; }
    if ((m = /\b(?:more than|over|older than|above|beyond|past|greater than|>)\s*(\d{1,4})\s*\+?\s*days?\b/.exec(q)) || (m = /\b(\d{1,4})\s*\+?\s*days?\b/.exec(q))) { s.minDays = +m[1]; s.open = true; }
    if (/\b(since|from) (the )?invoice date\b|\bby invoice date\b|\bold\b(?!er)/.test(q)) s.ageBy = 'date';
    if ((m = /\b(?:more than|over|above|greater than|>)\s*\$\s*([\d,]+(?:\.\d\d)?)/.exec(q))) s.minAmount = Math.round(+m[1].replace(/,/g, '') * 100);
    if (/\b(vs|versus|compared?( with| to)?|against)\b|\blast year\b.*\bthis year\b|\bthan last\b/.test(q)) s.compare = true;
    if (/\b(no|without|missing) (an? )?e ?mail\b/.test(q)) s.noEmail = true;
    if (/\b1099\b/.test(q)) s.is1099 = true;
    if (/\binactive\b/.test(q)) s.inactive = true;
    s.period = I.periodWords(q);
    if ((s.compare || s.shape === 'why') && s.period && s.period.key === 'lastYear') s.period = null;   // "against last year": last year is what we compare with, not the period asked for
    // what is left may be a name: drop the words already understood
    s.name = q.replace(/\b(how many|how much|number of|what is|what are|what s|whats|who is|who are|tell me|give me|show me|show|list|please|about|the|of|for|from|to|in|on|at|is|are|was|were|do|does|did|we|us|our|me|my|i|a|an|and|or|there|their|has|have|had|with|by|each|every|per|than|more|over|older|days?|open|unpaid|outstanding|overdue|late|past|due|total|count|balance|record|details?|info|all|any|this|last|current|previous|year|month|quarter|ytd|today|so far|percent(age)?s?|share|top|biggest|largest|highest|most|why|explain|compared?|vs|versus|against|been|which|that|it|them|they|pay|paid|owe|owes|owed|owing|transactions?|statement)\b/g, ' ')
      .replace(new RegExp('\\b(' + SUBJECTS.map(function (x) { return x[1].source; }).join('|') + ')', 'g'), ' ')
      .replace(new RegExp('\\b(' + MONTHS.join('|') + '|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\\b', 'g'), ' ').replace(/\b(19|20)\d\d\b|\b\d+\b|[$%]/g, ' ').replace(/\s+/g, ' ').trim();
    return s;
  };
  /** Period words -> { key, n, month, year } (dates are worked out in resolve, where "today" and the fiscal year are known). */
  I.periodWords = function (q) {
    var m;
    if (/\ball (time|dates)\b|\bever\b|\bsince (the )?(start|beginning)\b/.test(q)) return { key: 'all' };
    if ((m = /\blast (\d{1,3}) days\b/.exec(q))) return { key: 'days', n: +m[1] };
    if (/\bthis month\b|\bmonth to date\b|\bmtd\b/.test(q)) return { key: 'thisMonth' };
    if (/\blast month\b|\bprevious month\b/.test(q)) return { key: 'lastMonth' };
    if (/\bthis quarter\b|\bqtd\b/.test(q)) return { key: 'thisQuarter' };
    if (/\blast quarter\b|\bprevious quarter\b/.test(q)) return { key: 'lastQuarter' };
    if (/\blast year\b|\bprevious year\b|\bprior year\b/.test(q) && !/\bthis year\b/.test(q)) return { key: 'lastYear' };
    if (/\bthis year\b|\bytd\b|\byear to date\b|\bso far\b/.test(q)) return { key: 'thisYear' };
    var mi = -1; MONTHS.forEach(function (mn, i) { if (new RegExp('\\b(' + mn + '|' + mn.slice(0, 3) + (mn === 'september' ? '|sept' : '') + ')\\b').test(q) && !(mn === 'may' && /\bmay (i|we|be)\b/.test(q))) mi = i; });
    var y = /\b((?:19|20)\d\d)\b/.exec(q);
    if (mi >= 0) return { key: 'month', month: mi + 1, year: y ? +y[1] : 0 };
    if (y) return { key: 'year', year: +y[1] };
    return null;
  };

  /* ---------- 2. slots -> intent ---------- */
  var lev1 = function (a, b) {   // true when a and b differ by at most one edit (typing slip)
    if (a === b) return true; if (Math.abs(a.length - b.length) > 1) return false;
    var i = 0, j = 0, d = 0;
    while (i < a.length && j < b.length) { if (a[i] === b[j]) { i++; j++; continue; } if (++d > 1) return false; if (a.length > b.length) i++; else if (a.length < b.length) j++; else { i++; j++; } }
    return d + (a.length - i) + (b.length - j) <= 1;
  };
  /** Best record for some words: every word of the question's name part must be in the record's name (one typing slip allowed in longer words). */
  I.findName = function (list, words, key) {
    var ws = nameKey(words).split(' ').filter(function (w) { return w.length > 1; }); if (!ws.length) return null;
    var best = null, bestScore = 0;
    list.forEach(function (x) {
      var ns = nameKey(key(x)).split(' ').filter(Boolean); if (!ns.length) return;
      var hit = ws.filter(function (w) { return ns.some(function (n) { return n === w || (w.length >= 3 && n.indexOf(w) === 0) || (w.length >= 5 && lev1(n, w)); }); }).length;
      if (!hit || hit < ws.length) return;
      var score = hit / ns.length + (x.active === false ? -0.01 : 0);
      if (score > bestScore) { bestScore = score; best = x; }
    });
    return best;
  };
  I.period = function (book, w, today, dflt) {
    var fm = book.company.fiscalYearStartMonth || 1, fy = U.fiscalYearStart(today, fm), k = (w && w.key) || dflt || 'thisYear';
    var q0 = function (d) { var s = d.slice(0, 8) + '01', mo = +s.slice(5, 7), back = ((mo - fm) % 3 + 3) % 3; return U.addMonths(s, -back); };
    if (k === 'all') return { from: '1900-01-01', to: today, label: 'all dates' };
    if (k === 'days') return { from: U.addDays(today, -w.n + 1), to: today, label: 'last ' + w.n + ' days' };
    if (k === 'thisMonth') return { from: U.monthStart(today), to: today, label: 'this month' };
    if (k === 'lastMonth') { var lm = U.addMonths(U.monthStart(today), -1); return { from: lm, to: U.monthEnd(lm), label: U.monthLabel(lm) }; }
    if (k === 'thisQuarter') return { from: q0(today), to: today, label: 'this quarter' };
    if (k === 'lastQuarter') { var lq = U.addMonths(q0(today), -3); return { from: lq, to: U.addDays(q0(today), -1), label: 'last quarter' }; }
    if (k === 'lastYear') { var ly = U.addMonths(fy, -12); return { from: ly, to: U.addDays(fy, -1), label: 'last year' }; }
    if (k === 'month') { var yr = w.year || (w.month > +today.slice(5, 7) ? +today.slice(0, 4) - 1 : +today.slice(0, 4)), ms = U.ymd(yr, w.month, 1), me = U.monthEnd(ms); return { from: ms, to: me > today ? today : me, label: U.monthLabel(ms) }; }
    if (k === 'year') { var ys = U.ymd(w.year, fm, 1), ye = U.addDays(U.addMonths(ys, 12), -1); return { from: ys, to: ye > today ? today : ye, label: String(w.year) }; }
    return { from: fy, to: today, label: 'this year to date' };
  };
  /** Slots -> intent. ctx = { contactId, accountId, last } carries the subject of the conversation. */
  I.resolve = function (book, s, ctx, today) {
    ctx = ctx || {}; today = today || U.today();
    var it = { subject: s.subject, shape: s.shape, open: !!s.open, overdue: !!s.overdue, minDays: s.minDays || 0, ageBy: s.ageBy || 'due', minAmount: s.minAmount || 0, top: s.top || 0,
      percent: !!s.percent, compare: !!s.compare, noEmail: !!s.noEmail, is1099: !!s.is1099, inactive: !!s.inactive, text: s.text, periodGiven: !!s.period };
    var c = s.name ? I.findName(book.contacts, s.name, function (x) { return x.name; }) : null;
    var a = !c && s.name ? I.findName(book.accounts, s.name, function (x) { return x.name; }) : null;
    if (c) it.contactId = c.id; else if (a) it.accountId = a.id;
    // a follow-up ("open invoices", "and last year?", "by month") keeps the record or the question it follows
    var bare = !s.name || (!c && !a);
    if (bare && !it.subject && ctx.last && (s.period || s.shape || s.compare || s.percent)) { var L = ctx.last; it.subject = L.subject; it.contactId = L.contactId; it.accountId = L.accountId; if (!it.shape) it.shape = L.shape; if (!s.period) s.period = L.periodWords; it.open = it.open || L.open; it.followed = true; }
    if (!it.contactId && !it.accountId && !s.name && ctx.contactId && /^(invoices|bills)$/.test(it.subject) && !/\b(all|every|total)\b/.test(norm(s.text))) it.contactId = ctx.contactId;
    if (!it.subject) it.subject = it.contactId ? 'contact' : it.accountId ? 'account' : s.name ? 'find' : 'help';
    if (it.subject === 'customers' && it.contactId && !it.shape) it.subject = 'contact';
    if (it.subject === 'vendors' && it.contactId && !it.shape) it.subject = 'contact';
    it.periodWords = s.period || null;
    it.period = I.period(book, s.period, today, /^(invoices|bills|customers|vendors|accounts|cash|bankfeed)$/.test(it.subject) ? 'all' : 'thisYear');
    it.unknownName = s.name && !c && !a ? s.name : '';
    if (s.findDoc) { it.subject = 'find'; it.contactId = it.accountId = ''; }
    return it;
  };

  /* ---------- 3. intent -> answer ---------- */
  var R = function () { return OB.reports; };
  var link = function (v, href) { return { v: v, href: href }; };
  var txnHref = function (t) { return '#/txn/' + t.id; };
  var plHref = function (p, basis, extra) { return '#/report/pnl?range=custom&from=' + p.from + '&to=' + p.to + '&basis=' + basis + (extra || ''); };
  var share = function (v, tot) { return tot ? (Math.round(v / tot * 1000) / 10).toFixed(1) + '%' : ''; };
  function openDocs(book, it, kind, today) {
    var ag = R().aging(book, { kind: kind, asOf: today }), type = kind === 'customer' ? 'invoice' : 'bill', out = [];
    ag.rows.forEach(function (r) {
      if (it.contactId && r.contactId !== it.contactId) return;
      r.docs.forEach(function (d) {
        if (d.t.type !== type || d.open <= 0) return;
        var days = it.ageBy === 'date' ? U.daysBetween(d.t.date, today) : (d.daysPastDue || 0);
        if (it.minDays && days <= it.minDays) return;
        if (it.overdue && !it.minDays && (d.daysPastDue || 0) <= 0) return;
        if (it.minAmount && d.open <= it.minAmount) return;
        out.push({ t: d.t, open: d.open, due: d.due, days: days, name: r.name, contactId: r.contactId });
      });
    });
    return out.sort(function (x, y) { return y.days - x.days || y.open - x.open; });
  }
  function docsAnswer(book, it, today) {
    var cust = it.subject === 'invoices', kind = cust ? 'customer' : 'vendor', noun = cust ? 'invoice' : 'bill', docs = openDocs(book, it, kind, today), total = U.sum(docs, function (d) { return d.open; });
    var who = it.contactId ? book.contactById[it.contactId].name : '';
    var cond = (it.minDays ? ', more than ' + it.minDays + ' days ' + (it.ageBy === 'date' ? 'since the ' + noun + ' date' : 'past due') : it.overdue ? ', past due' : '') + (it.minAmount ? ', over ' + money(it.minAmount) : '');
    var und = 'Open ' + noun + 's' + (who ? ' for ' + who : '') + cond + ', as of ' + U.fmtDate(today);
    var ans = { understood: und, source: { label: cust ? 'Open Invoices' : 'Unpaid Bills', href: cust ? '#/report/openinv' : '#/report/unpaidbills' }, ctx: { contactId: it.contactId || '' }, actions: [] };
    if (!docs.length) { ans.text = 'There are no open ' + noun + 's' + (who ? ' for ' + who : '') + cond.replace(/^,/, '') + '.'; return ans; }
    ans.text = (docs.length === 1 ? '1 open ' + noun : docs.length + ' open ' + noun + 's') + (who ? ' for ' + who : '') + (cond ? cond.replace(/^, /, ' ') : '') + ', ' + money(total) + ' in total.';
    var byWho = /\bwho\b|\bwhich (customers?|clients?|vendors?)\b/.test(norm(it.text)) && !it.contactId;
    if (byWho) {
      var by = {}, order = []; docs.forEach(function (d) { if (!by[d.contactId]) { by[d.contactId] = { name: d.name, id: d.contactId, n: 0, open: 0, days: 0 }; order.push(by[d.contactId]); } var g = by[d.contactId]; g.n++; g.open += d.open; g.days = Math.max(g.days, d.days); });
      order.sort(function (x, y) { return y.open - x.open; });
      ans.text = plural(order.length, cust ? 'customer' : 'vendor') + ' with ' + ans.text.charAt(0).toLowerCase() + ans.text.slice(1);
      ans.table = { head: [cust ? 'Customer' : 'Vendor', noun.charAt(0).toUpperCase() + noun.slice(1) + 's', 'Oldest (days)', 'Open'], rows: order.slice(0, 12).map(function (g) { return [{ v: g.name, ask: g.name }, g.n, g.days > 0 ? g.days : '', money(g.open)]; }) };
      if (order.length > 12) ans.more = (order.length - 12) + ' more in the report.';
    } else if (it.shape !== 'count' || docs.length <= 12) {
      ans.table = { head: [noun.charAt(0).toUpperCase() + noun.slice(1), who ? 'Date' : (cust ? 'Customer' : 'Vendor'), 'Due', it.ageBy === 'date' ? 'Days old' : 'Days late', 'Open'],
        rows: docs.slice(0, 12).map(function (d) { return [link(d.t.number || U.fmtDate(d.t.date), txnHref(d.t)), who ? U.fmtDate(d.t.date) : { v: d.name, ask: d.name }, d.due ? U.fmtDate(d.due) : '', d.days > 0 ? d.days : '', money(d.open)]; }) };
      if (docs.length > 12) ans.more = (docs.length - 12) + ' more in the report.';
    }
    ans.actions.push({ label: cust ? 'Open A/R aging' : 'Open A/P aging', href: cust ? '#/report/araging' : '#/report/apaging' });
    if (it.minDays && it.ageBy !== 'date') ans.actions.push({ label: 'Count from the ' + noun + ' date instead', ask: it.text + ' since invoice date' });
    return ans;
  }
  function contactsAnswer(book, it) {
    var kind = it.subject === 'customers' ? 'customer' : 'vendor', all = book.contacts.filter(function (c) { return c.kind === kind; });
    var list = all, cond = '';
    if (it.noEmail) { list = list.filter(function (c) { return !c.email; }); cond = ' with no email'; }
    if (it.is1099) { list = list.filter(function (c) { return c.is1099; }); cond += ' marked 1099'; }
    if (it.inactive) { list = list.filter(function (c) { return c.active === false; }); cond += ' that are inactive'; }
    if (it.open) { var ag = R().aging(book, { kind: kind, asOf: U.today() }), has = {}; ag.rows.forEach(function (r) { if (r.total > 0) has[r.contactId] = r.total; }); list = list.filter(function (c) { return has[c.id]; }); cond += ' with an open balance'; }
    var act = list.filter(function (c) { return c.active !== false; }).length;
    var ans = { understood: (kind === 'customer' ? 'Customers' : 'Vendors') + cond, source: { label: kind === 'customer' ? 'Customer list' : 'Vendor list', href: kind === 'customer' ? '#/customers' : '#/vendors' }, actions: [], ctx: {} };
    ans.text = plural(list.length, kind) + cond + (cond && !it.inactive ? '' : it.inactive ? '' : ': ' + act + ' active, ' + (list.length - act) + ' inactive') + '.';
    if ((cond || it.shape === 'list') && list.length) { ans.table = { head: ['Name', 'Email', 'Phone'], rows: list.slice(0, 12).map(function (c) { return [{ v: c.name, ask: c.name }, c.email || '', c.phone || '']; }) }; if (list.length > 12) ans.more = (list.length - 12) + ' more in the list.'; }
    return ans;
  }
  function contactAnswer(book, it, today) {
    var c = book.contactById[it.contactId], cust = c.kind === 'customer', kind = cust ? 'customer' : 'vendor', p = it.period;
    var docs = openDocs(book, { contactId: c.id, ageBy: 'due' }, kind, today), open = U.sum(docs, function (d) { return d.open; }), late = docs.filter(function (d) { return d.days > 0; }), over90 = U.sum(docs.filter(function (d) { return d.days > 90; }), function (d) { return d.open; });
    var mine = book.transactions.filter(function (t) { return t.contactId === c.id && t.status === 'posted'; });
    var inP = function (t) { return t.date >= p.from && t.date <= p.to; }, tot = function (types) { return U.sum(mine.filter(function (t) { return types.indexOf(t.type) >= 0 && inP(t); }), function (t) { return t.total || 0; }); };
    var payTypes = cust ? ['payment'] : ['billPayment', 'check', 'expense'], lastPay = mine.filter(function (t) { return payTypes.indexOf(t.type) >= 0; }).sort(function (x, y) { return x.date < y.date ? 1 : -1; })[0];
    var rows = [['Type', (cust ? 'Customer' : 'Vendor') + (c.active === false ? ' (inactive)' : '')], ['Terms', c.terms !== undefined && c.terms !== '' ? 'Net ' + c.terms : 'not set'],
      [cust ? 'Open invoices' : 'Unpaid bills', docs.length ? docs.length + ' · ' + money(open) : 'none'],
      [cust ? 'Last payment received' : 'Last payment made', lastPay ? link(money(lastPay.total || 0) + ' on ' + U.fmtDate(lastPay.date), txnHref(lastPay)) : 'none'],
      [(cust ? 'Sales, ' : 'Bills and expenses, ') + p.label, money(cust ? tot(['invoice', 'salesReceipt']) - tot(['creditMemo']) : tot(['bill', 'check', 'expense']) - tot(['vendorCredit']))]];
    rows.push([cust ? 'Received, ' + p.label : 'Paid, ' + p.label, money(cust ? tot(['payment', 'salesReceipt']) : tot(['billPayment', 'check', 'expense']))]);
    if (!cust) rows.push(['1099', c.is1099 ? 'Yes' : 'No']);
    rows.push(['Email / phone', [c.email, c.phone].filter(Boolean).join(' · ') || 'none on file']);
    var ans = { understood: (cust ? 'Customer' : 'Vendor') + ' record: ' + c.name, table: { head: null, rows: rows }, source: { label: (cust ? 'Customer' : 'Vendor') + ' record and ' + (cust ? 'A/R' : 'A/P') + ' aging as of ' + U.fmtDate(today), href: '#/contact/' + c.id }, ctx: { contactId: c.id } };
    ans.text = c.name + ' is ' + (c.active === false ? 'an inactive ' : 'an active ') + kind + '. ' + (docs.length ? 'Open balance ' + money(open) + (over90 ? ', of which ' + money(over90) + ' is over 90 days past due' : late.length ? ', ' + plural(late.length, noun(cust)) + ' past due' : '') + '.' : 'Nothing is open.');
    if (it.shape === 'total' || /\b(pay|paid|sales?|sold|billed|received|spent|spend)\b/.test(norm(it.text))) {
      var paidQ = /\b(pay|paid|received|spent|spend)\b/.test(norm(it.text)), amt = cust ? (paidQ ? tot(['payment', 'salesReceipt']) : tot(['invoice', 'salesReceipt']) - tot(['creditMemo'])) : (paidQ ? tot(['billPayment', 'check', 'expense']) : tot(['bill', 'check', 'expense']) - tot(['vendorCredit']));
      ans.text = (cust ? (paidQ ? 'Received from ' : 'Sales to ') : (paidQ ? 'Paid to ' : 'Bills and expenses from ')) + c.name + ' for ' + p.label + ': ' + money(amt) + '.';
      ans.understood = (cust ? (paidQ ? 'Payments received from ' : 'Sales to ') : (paidQ ? 'Payments to ' : 'Bills and expenses from ')) + c.name + ', ' + U.fmtDate(p.from) + ' to ' + U.fmtDate(p.to);
    }
    ans.actions = [{ label: cust ? 'Open invoices' : 'Unpaid bills', ask: (cust ? 'open invoices for ' : 'unpaid bills for ') + c.name }, { label: 'Open the record', href: '#/contact/' + c.id }];
    return ans;
  }
  function noun(cust) { return cust ? 'invoice' : 'bill'; }
  function accountAnswer(book, it, today) {
    var a = book.accById[it.accountId], T = OB.schema.TYPE[a.type], pl = /^(income|cogs|expense|oi|oe)$/.test(a.type), p = it.period;
    var bal = pl ? book.accountBalance(a.id, p.to, p.from) : book.accountBalance(a.id, today), rows = [['Type', T ? T.label : a.type], [pl ? 'Total, ' + p.label : 'Balance as of ' + U.fmtDate(today), money(bal)]];
    var recs = (book.reconciliations || []).filter(function (r) { return r.accountId === a.id; }).sort(function (x, y) { return (x.statementDate || x.date || '') < (y.statementDate || y.date || '') ? 1 : -1; });
    if (/^(bank|cc)$/.test(a.type)) { rows.push(['Last reconciled', recs[0] ? U.fmtDate(recs[0].statementDate || recs[0].date) : 'never']); if (book.bankLinesFor) rows.push(['Bank feed lines to review', book.bankLinesFor(a.id, 'review').length]); }
    var href = '#/report/gl?account=' + a.id + '&range=custom&from=' + (pl ? p.from : '1900-01-01') + '&to=' + (pl ? p.to : today);
    return { understood: 'Account: ' + a.name, text: a.name + (pl ? ' totals ' + money(bal) + ' for ' + p.label + '.' : ' has a balance of ' + money(bal) + ' as of ' + U.fmtDate(today) + '.'), table: { head: null, rows: rows }, source: { label: 'Account ledger', href: href }, ctx: { accountId: a.id }, actions: [{ label: 'Open the ledger', href: href }] };
  }
  function accountsAnswer(book, it) {
    var list = book.accounts.filter(function (a) { return it.inactive ? a.active === false : true; }), act = list.filter(function (a) { return a.active !== false; }).length, by = {};
    list.forEach(function (a) { var l = OB.schema.TYPE[a.type] ? OB.schema.TYPE[a.type].label : a.type; by[l] = (by[l] || 0) + 1; });
    return { understood: 'Chart of accounts', text: plural(list.length, 'account') + (it.inactive ? ' are inactive.' : ': ' + act + ' active, ' + (list.length - act) + ' inactive.'), table: { head: ['Type', 'Accounts'], rows: Object.keys(by).map(function (k) { return [k, by[k]]; }) }, source: { label: 'Chart of accounts', href: '#/accounts' }, ctx: {}, actions: [] };
  }
  function cashAnswer(book, today) {
    var list = book.accounts.filter(function (a) { return a.type === 'bank' && a.active !== false; }).map(function (a) { return { a: a, bal: book.accountBalance(a.id, today) }; }).filter(function (x) { return x.bal; }), tot = U.sum(list, function (x) { return x.bal; });
    return { understood: 'Bank balances as of ' + U.fmtDate(today), text: money(tot) + ' across ' + plural(list.length, 'bank account') + '.', table: { head: ['Account', 'Balance'], rows: list.map(function (x) { return [{ v: x.a.name, ask: 'balance of ' + x.a.name }, money(x.bal)]; }) }, source: { label: 'Balance Sheet', href: '#/report/bs' }, ctx: {}, actions: [{ label: 'Open the Balance Sheet', href: '#/report/bs' }] };
  }
  function feedAnswer(book) {
    var by = {}; (book.bankLines || []).forEach(function (l) { if (l.status === 'review') by[l.accountId] = (by[l.accountId] || 0) + 1; });
    var ids = Object.keys(by), n = U.sum(ids, function (k) { return by[k]; });
    return { understood: 'Bank feed lines waiting for review', text: n ? plural(n, 'bank feed line') + ' waiting for review in ' + plural(ids.length, 'account') + '.' : 'No bank feed lines are waiting for review.', table: n ? { head: ['Account', 'To review'], rows: ids.map(function (k) { return [link(book.accById[k] ? book.accById[k].name : k, '#/bankfeed?account=' + k), by[k]]; }) } : null, source: { label: 'Bank feed', href: '#/bankfeed' }, ctx: {}, actions: [] };
  }
  var PL_KEYS = { income: ['income', 'oi'], expenses: ['cogs', 'expense', 'oe'] };
  function plStatement(book, p, columns) { return R().statement(book, { kind: 'pl', from: p.from, to: p.to, basis: book.company.basis === 'cash' ? 'cash' : 'accrual', columns: columns || 'total' }); }
  function plValue(st, subject, i) {
    var sec = function (k) { return st.sections[k] && st.sections[k].cells ? st.sections[k].cells[i] || 0 : 0; };
    if (subject === 'profit') { var n = st.tree.filter(function (x) { return x.kind === 'net' && x.section === 'net'; })[0]; return n ? n.cells[i] || 0 : 0; }
    return U.sum(PL_KEYS[subject], sec);
  }
  function plAccounts(st, subject) {   // leaf accounts of the sections behind a subject, with their first-column value
    var out = [], walk = function (n) { if (n.kind === 'group' && !n.accountId) { n.children.forEach(walk); return; } if (n.children && n.children.length) n.children.forEach(walk); if (n.accountId && n.cells && n.cells[0]) out.push({ id: n.accountId, label: n.label, v: n.ownCells ? n.ownCells[0] : n.cells[0] }); };
    PL_KEYS[subject].forEach(function (k) { if (st.sections[k]) st.sections[k].children.forEach(walk); });
    return out;
  }
  function prevPeriod(p, it) { var yr = { from: U.addMonths(p.from, -12), to: U.addMonths(p.to, -12) }; yr.label = 'the same period a year earlier'; return yr; }
  function plAnswer(book, it, today) {
    var p = it.period, basis = book.company.basis === 'cash' ? 'cash' : 'accrual', subj = it.subject, word = subj === 'profit' ? 'Net income' : subj === 'income' ? 'Income' : 'Expenses';
    var per = U.fmtDate(p.from) + ' to ' + U.fmtDate(p.to), ans = { source: { label: 'Profit and Loss, ' + basis + ' basis', href: plHref(p, basis) }, ctx: {}, actions: [{ label: 'Open Profit and Loss', href: plHref(p, basis) }] };
    if (it.shape === 'bymonth' || (it.percent && it.shape !== 'top' && subj !== 'profit' && !it.compare && it.shape !== 'why' && !it.top)) {
      if (p.from === '1900-01-01') p = it.period = I.period(book, null, today, 'thisYear');
      var st = plStatement(book, p, 'month'), n = st.cols.length - 1, tot = plValue(st, subj, n), inc = subj === 'profit' ? plValue(st, 'income', n) : 0;
      ans.understood = word + ' by month, ' + U.fmtDate(p.from) + ' to ' + U.fmtDate(p.to) + (subj === 'profit' ? ', with margin (net income as a percentage of income)' : ', with each month\'s share of the total');
      ans.table = { head: ['Month', word, subj === 'profit' ? 'Margin' : 'Share'], rows: st.cols.slice(0, n).map(function (c, i) { var v = plValue(st, subj, i); return [link(c.label, plHref({ from: c.from, to: c.to }, basis)), money(v), subj === 'profit' ? share(v, plValue(st, 'income', i)) : share(v, tot)]; }).concat([['Total', money(tot), subj === 'profit' ? share(tot, inc) : tot ? '100.0%' : '']]), total: true };
      var best = st.cols.slice(0, n).map(function (c, i) { return { l: c.label, v: plValue(st, subj, i) }; }).sort(function (x, y) { return y.v - x.v; })[0];
      ans.text = word + (subj === 'expenses' ? ' total ' : ' totals ') + money(tot) + ' over ' + plural(n, 'month') + (best && n > 1 ? '. The highest month is ' + best.l + ' at ' + money(best.v) + (subj !== 'profit' ? ' (' + share(best.v, tot) + ')' : '') : '') + '.';
      ans.source.href = plHref(p, basis, '&by=month'); ans.actions = [{ label: 'Open Profit and Loss by month', href: ans.source.href }];
      return ans;
    }
    var cur = plStatement(book, p), v = plValue(cur, subj, 0);
    if (it.shape === 'top' || it.top) {
      var s2 = subj === 'profit' ? 'expenses' : subj, list = plAccounts(cur, s2).sort(function (x, y) { return y.v - x.v; }), k = it.top || 5, tt = plValue(cur, s2, 0);
      ans.understood = 'Largest ' + (s2 === 'income' ? 'income' : 'expense') + ' accounts, ' + per;
      ans.table = { head: ['Account', 'Amount', 'Share'], rows: list.slice(0, k).map(function (x) { return [{ v: x.label, ask: x.label }, money(x.v), share(x.v, tt)]; }) };
      ans.text = 'Total ' + s2 + ' ' + money(tt) + '. The top ' + Math.min(k, list.length) + ' make up ' + share(U.sum(list.slice(0, k), function (x) { return x.v; }), tt) + '.';
      return ans;
    }
    if (it.compare || it.shape === 'why') {
      var pp = prevPeriod(p, it), old = plStatement(book, pp), ov = plValue(old, subj, 0), d = v - ov;
      ans.understood = word + ', ' + per + ', compared with ' + U.fmtDate(pp.from) + ' to ' + U.fmtDate(pp.to);
      var movers = function (s2) { var m = {}, add = function (list, sign) { list.forEach(function (x) { m[x.id] = m[x.id] || { label: x.label, d: 0 }; m[x.id].d += sign * x.v; }); }; add(plAccounts(cur, s2), 1); add(plAccounts(old, s2), -1); return Object.keys(m).map(function (id) { return m[id]; }).filter(function (x) { return x.d; }).sort(function (x, y) { return Math.abs(y.d) - Math.abs(x.d); }); };
      var dir = function (x) { return (x >= 0 ? 'up ' : 'down ') + money(Math.abs(x)); }, pc = ov ? ' (' + (Math.round(d / Math.abs(ov) * 1000) / 10).toFixed(1) + '%)' : '';
      ans.text = word + ' is ' + money(v) + ', ' + dir(d) + pc + ' from ' + money(ov) + '.';
      var rows = [], sign = function (x) { return (x > 0 ? '+' : '') + U.fmt(x, {}); };
      if (subj === 'profit') { var di = plValue(cur, 'income', 0) - plValue(old, 'income', 0), de = plValue(cur, 'expenses', 0) - plValue(old, 'expenses', 0); ans.text += ' Income is ' + dir(di) + ' and expenses are ' + dir(de) + '.'; rows.push(['Income', sign(di)]); movers('income').slice(0, 3).forEach(function (x) { rows.push(['   ' + x.label, sign(x.d)]); }); rows.push(['Expenses', sign(de)]); movers('expenses').slice(0, 4).forEach(function (x) { rows.push(['   ' + x.label, sign(x.d)]); }); }
      else movers(subj).slice(0, 6).forEach(function (x) { rows.push([x.label, sign(x.d)]); });
      if (rows.length) { ans.table = { head: ['Largest changes', 'Change'], rows: rows }; }
      ans.actions = [{ label: 'Open the comparison', href: plHref(p, basis, '&cmp=py') }];
      return ans;
    }
    ans.understood = word + ', ' + per;
    ans.text = word + ' for ' + p.label + ' is ' + money(v) + '.' + (subj === 'profit' ? ' Income ' + money(plValue(cur, 'income', 0)) + ', expenses ' + money(plValue(cur, 'expenses', 0)) + ', margin ' + (share(v, plValue(cur, 'income', 0)) || 'n/a') + '.' : '');
    ans.actions.unshift({ label: 'By month', ask: (subj === 'profit' ? 'profit' : subj) + ' by month' }, { label: 'Compare with last year', ask: (subj === 'profit' ? 'profit' : subj) + ' compared with last year' });
    return ans;
  }
  function findAnswer(book, it, today) {
    var F = OB.find, res = F ? F.everything(book, it.text, today) : { transactions: [], contacts: [], accounts: [] }, tx = res.transactions || [];
    var ans = { understood: 'Search for "' + it.text + '"', source: { label: 'Find', href: '#/find?q=' + encodeURIComponent(it.text) }, ctx: {}, actions: [{ label: 'Open in Find', href: '#/find?q=' + encodeURIComponent(it.text) }] };
    if (!tx.length) return null;
    ans.text = plural(tx.length, 'transaction') + ' found.';
    ans.table = { head: ['Date', 'Type', 'Name', 'Amount'], rows: tx.slice(0, 10).map(function (r) { var t = r.t || r; return [link(U.fmtDate(t.date), txnHref(t)), (OB.schema.TXN_TYPES[t.type] || {}).label || t.type, t.contactId && book.contactById[t.contactId] ? book.contactById[t.contactId].name : '', money(t.total || 0)]; }) };
    if (tx.length > 10) ans.more = (tx.length - 10) + ' more in Find.';
    return ans;
  }
  I.HELP = ['Northside Office Supply', 'How many open invoices are there?', 'Invoices open more than 90 days', 'Income by month with percentage', 'Top 5 expenses this year', 'Why is profit different from last year?', 'How many vendors have no email?', 'Bank balances'];
  function helpAnswer(book, it) {
    return { understood: '', notUnderstood: true, text: it && it.unknownName ? 'I could not find "' + it.unknownName + '" in your customers, vendors, accounts or transactions.' : 'I answer from your books. Type a customer, vendor or account name, or ask about:',
      table: { head: null, rows: [['Money owed', 'open invoices, unpaid bills, who is late, more than 90 days'], ['Counts', 'how many customers, vendors, accounts, invoices'], ['Totals', 'income, expenses, profit for a period, by month, with percentages'], ['Changes', 'compare with last year, why profit changed, top expenses'], ['Bank', 'bank balances, a bank account, bank feed to review'], ['Find', 'a check number, an amount, a memo']] }, ctx: {}, actions: [] };
  }
  /** intent -> answer { understood, text, table, more, source, actions, ctx }. */
  I.run = function (book, it, today) {
    today = today || U.today();
    var a;
    if (it.subject === 'invoices' || it.subject === 'bills') a = docsAnswer(book, it, today);
    else if (it.subject === 'customers' || it.subject === 'vendors') a = contactsAnswer(book, it);
    else if (it.subject === 'contact') a = contactAnswer(book, it, today);
    else if (it.subject === 'account') a = accountAnswer(book, it, today);
    else if (it.subject === 'accounts') a = it.accountId ? accountAnswer(book, it, today) : accountsAnswer(book, it);
    else if (it.subject === 'cash') a = it.accountId ? accountAnswer(book, it, today) : cashAnswer(book, today);
    else if (it.subject === 'bankfeed') a = feedAnswer(book);
    else if (/^(income|expenses|profit)$/.test(it.subject)) {
      if (it.contactId) a = contactAnswer(book, it, today);
      else if (it.accountId && it.shape !== 'bymonth') a = accountAnswer(book, it, today);
      else a = plAnswer(book, it, today);
    }
    else if (it.subject === 'find') a = findAnswer(book, it, today) || helpAnswer(book, { unknownName: it.unknownName || it.text });
    else a = helpAnswer(book, it);
    a.intent = it;
    return a;
  };
  I.ask = function (book, text, ctx, today) { return I.run(book, I.resolve(book, I.extract(text), ctx, today), today); };

  /* ---------- contract for a language model: it may fill these slots when the words above are not understood ---------- */
  I.SLOT_SCHEMA = { type: 'object', additionalProperties: false, required: ['subject', 'shape'], properties: {
    subject: { type: 'string', enum: ['invoices', 'bills', 'customers', 'vendors', 'accounts', 'income', 'expenses', 'profit', 'cash', 'bankfeed', 'name', 'unknown'] },
    shape: { type: 'string', enum: ['count', 'total', 'list', 'bymonth', 'top', 'why', 'record'] },
    name: { type: 'string' }, open: { type: 'boolean' }, overdue: { type: 'boolean' }, minDays: { type: 'integer' }, percent: { type: 'boolean' }, compare: { type: 'boolean' }, top: { type: 'integer' },
    period: { type: 'string', enum: ['thisYear', 'lastYear', 'thisMonth', 'lastMonth', 'thisQuarter', 'lastQuarter', 'all', 'none'] } } };
  I.SLOT_PROMPT = 'You turn a bookkeeping question into search slots for an accounting program. Never answer the question and never give numbers. ' +
    'subject: what is asked about (income = revenue or sales; expenses = costs or spending; profit = net income; cash = bank balances; name = a specific customer, vendor or account, put it in "name"; unknown if none fits). ' +
    'shape: count (how many), total (how much), list (show them), bymonth (per month or trend), top (largest), why (explain a change), record (details of one name). ' +
    'open = unpaid or outstanding. overdue = late. minDays = "more than N days". percent = asks for a percentage or share. compare = against an earlier period. period = the time span, or none.';
  /** Slots from a model's JSON -> the same slots extract() gives. Anything outside the schema is dropped. */
  I.fromModel = function (json, text) {
    var j = typeof json === 'string' ? JSON.parse(json) : json, P = I.SLOT_SCHEMA.properties, s = { text: String(text || '').trim(), subject: '', shape: '', name: '' };
    if (!j || P.subject.enum.indexOf(j.subject) < 0 || j.subject === 'unknown') return null;
    s.subject = j.subject === 'name' ? '' : j.subject; s.shape = P.shape.enum.indexOf(j.shape) >= 0 && j.shape !== 'record' ? j.shape : '';
    s.name = typeof j.name === 'string' ? norm(j.name).slice(0, 80) : '';
    s.open = j.open === true || j.overdue === true; s.overdue = j.overdue === true; s.percent = j.percent === true; s.compare = j.compare === true;
    if (j.minDays > 0 && j.minDays < 10000) { s.minDays = Math.round(j.minDays); s.open = true; }
    if (j.top > 0 && j.top <= 50) s.top = Math.round(j.top);
    s.period = P.period.enum.indexOf(j.period) >= 0 && j.period !== 'none' ? { key: j.period } : I.periodWords(norm(text));
    return s;
  };
})(typeof window !== 'undefined' ? window : globalThis);
