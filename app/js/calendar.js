/* VaultBook — money and deadline calendar (1.50.0). One list of dated events from the books: bills to pay, invoices
   expected in, recurring entries, payroll pay dates, Close the books, client questions, tax and filing deadlines and the
   user's to-dos; a day-by-day bank balance forecast; and an .ics export. Settings, to-dos, "filed" marks and planned pay
   dates live on company.calendar, so they travel in backups. Deadlines follow the federal rule: a due date on a weekend
   or a legal holiday in the District of Columbia moves to the next business day. */
(function (root) {
  'use strict';
  var OB = root.OB, U = OB.util, S = OB.schema, K = OB.cal = {};
  var p2 = function (n) { return (n < 10 ? '0' : '') + n; }, ymd = function (y, m, d) { return y + '-' + p2(m) + '-' + p2(d); };
  var dow = function (d) { return new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10))).getUTCDay(); };
  var lastDay = function (y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
  function nth(y, m, wd, n) { // n-th weekday wd (0 = Sunday) of month m; n = -1 for the last
    if (n < 0) { var d = lastDay(y, m); while (dow(ymd(y, m, d)) !== wd) d--; return ymd(y, m, d); }
    var x = 1; while (dow(ymd(y, m, x)) !== wd) x++; return ymd(y, m, x + 7 * (n - 1));
  }
  function observed(d) { var w = dow(d); return w === 6 ? U.addDays(d, -1) : w === 0 ? U.addDays(d, 1) : d; }
  var hol = {};
  /** Federal legal holidays (and DC Emancipation Day) of a year, as observed: { 'YYYY-MM-DD': name }. */
  K.holidays = function (y) {
    if (hol[y]) return hol[y];
    var h = {};
    [[observed(ymd(y, 1, 1)), "New Year's Day"], [nth(y, 1, 1, 3), 'Martin Luther King Jr. Day'], [nth(y, 2, 1, 3), "Washington's Birthday"],
      [observed(ymd(y, 4, 16)), 'DC Emancipation Day'], [nth(y, 5, 1, -1), 'Memorial Day'], [observed(ymd(y, 6, 19)), 'Juneteenth'],
      [observed(ymd(y, 7, 4)), 'Independence Day'], [nth(y, 9, 1, 1), 'Labor Day'], [nth(y, 10, 1, 2), 'Columbus Day'], [observed(ymd(y, 11, 11)), 'Veterans Day'],
      [nth(y, 11, 4, 4), 'Thanksgiving Day'], [observed(ymd(y, 12, 25)), 'Christmas Day']].forEach(function (x) { h[x[0]] = x[1]; });
    var ny = observed(ymd(y + 1, 1, 1)); if (ny.slice(0, 4) === String(y)) h[ny] = "New Year's Day";   // Jan 1 on a Saturday is observed Dec 31
    return (hol[y] = h);
  };
  K.isHoliday = function (d) { return K.holidays(+d.slice(0, 4))[d] || ''; };
  /** The date itself, or the next day that is not a weekend or holiday. */
  K.businessDay = function (d) { var g = 0; while ((dow(d) === 0 || dow(d) === 6 || K.isHoliday(d)) && g++ < 10) d = U.addDays(d, 1); return d; };

  K.settings = function (book) { return Object.assign({ todos: [], done: {}, payOn: {}, expectOn: {}, salesTax: {}, low: 0, payroll: null }, book.company.calendar || {}); };
  function save(book, change) { var c = U.clone(K.settings(book)); change(c); return book.saveCompany({ calendar: c }); }
  /** Tick (or untick) an event: a deadline filed, a to-do done for that date. */
  K.markDone = function (book, key, on) { return save(book, function (c) { if (on) c.done[key] = U.today(); else delete c.done[key]; }); };
  /** When you plan to pay a bill ('' = on its due date). The due date does not change. */
  K.setPayDate = function (book, billId, date) { return save(book, function (c) { if (date) c.payOn[billId] = date; else delete c.payOn[billId]; }); };
  K.saveSettings = function (book, input) { return save(book, function (c) { ['salesTax', 'low', 'payroll', 'remind'].forEach(function (k) { if (input[k] !== undefined) c[k] = input[k]; }); }); };
  var hhmm = function (v) { var m = /^(\d{1,2}):(\d{2})$/.exec(String(v || '').trim()); return m && +m[1] < 24 && +m[2] < 60 ? p2(+m[1]) + ':' + m[2] : ''; };
  K.REMIND = [0, 5, 10, 15, 30, 60, 120, 1440, 2880, 10080];
  /** A to-do: { id?, date, time ('HH:MM' or '' for all day), dur (minutes), title, note, repeat: '' | daily | weekly |
   *  monthly | quarterly | yearly, until, remind (minutes before; null = none) }. Keeps moved / skipped occurrences. */
  K.saveTodo = function (book, input) {
    var title = String(input.title || '').trim().slice(0, 200);
    if (!title) return Promise.reject(new Error('Enter what to do.'));
    if (!U.isDate(input.date)) return Promise.reject(new Error('Enter the date.'));
    var old = input.id ? K.settings(book).todos.find(function (x) { return x.id === input.id; }) : null;
    var t = { id: input.id || U.uid('todo'), date: input.date, time: hhmm(input.time), dur: Math.max(15, Math.min(1440, Math.round(+input.dur || 60))), title: title, note: String(input.note || '').slice(0, 1000),
      repeat: ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'].indexOf(input.repeat) >= 0 ? input.repeat : '', until: U.isDate(input.until) ? input.until : '',
      remind: input.remind === null || input.remind === undefined || input.remind === '' ? null : Math.max(0, Math.round(+input.remind) || 0), moved: old && old.date === input.date && old.repeat === input.repeat ? old.moved || {} : {}, skip: old && old.date === input.date && old.repeat === input.repeat ? old.skip || [] : [] };
    return save(book, function (c) { var i = c.todos.findIndex(function (x) { return x.id === t.id; }); if (i >= 0) c.todos[i] = t; else c.todos.push(t); }).then(function () { return t; });
  };
  K.deleteTodo = function (book, id) { return save(book, function (c) { c.todos = c.todos.filter(function (x) { return x.id !== id; }); Object.keys(c.done).forEach(function (k) { if (k.indexOf('todo|' + id + '|') === 0) delete c.done[k]; }); }); };

  var step = function (d, f, start) { return f === 'daily' ? U.addDays(d, 1) : f === 'weekly' ? U.addDays(d, 7) : f === 'monthly' ? monthOn(start, d, 1) : f === 'quarterly' ? monthOn(start, d, 3) : monthOn(start, d, 12); };
  function monthOn(start, d, n) { // the next month's date, keeping the start's day (or the month's last day)
    var y = +d.slice(0, 4), m = +d.slice(5, 7) + n; y += Math.floor((m - 1) / 12); m = (m - 1) % 12 + 1;
    var sd = +start.slice(8, 10), endStart = sd === lastDay(+start.slice(0, 4), +start.slice(5, 7));
    return ymd(y, m, endStart ? lastDay(y, m) : Math.min(sd, lastDay(y, m)));
  }

  /* ---------- tax and filing deadlines ---------- */
  function payrollDates(book) {
    var out = [];
    book.posted().forEach(function (t) { var r = t.type === 'journal' && /^Paystub payroll (\d{4}-\d\d-\d\d)/.exec(t.importRef || ''); if (r) out.push({ date: r[1], t: t }); });
    return out.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  }
  function hasPayroll(book, opts, today) {
    var s = K.settings(book); if (opts.payroll !== undefined) return !!opts.payroll; if (s.payroll !== null) return !!s.payroll;
    var since = U.addDays(today, -400); return payrollDates(book).some(function (x) { return x.date >= since; });
  }
  function taxEvents(book, from, to, today, opts) {
    var c = book.company, form = c.taxForm || '', m0 = +(c.fiscalYearStartMonth || 1), out = [], s = K.settings(book);
    var y0 = +from.slice(0, 4) - 1, y1 = +to.slice(0, 4);
    var add = function (code, date, title, note, href) { var d = K.businessDay(date); if (d >= from && d <= to) out.push({ key: 'tax|' + code, kind: 'tax', date: d, base: date, title: title, note: note || '', href: href || '' }); };
    var mo = function (y, m) { y += Math.floor((m - 1) / 12); m = (m - 1) % 12 + 1; return [y, m]; };
    var on = function (ym, day) { return ymd(ym[0], ym[1], Math.min(day, lastDay(ym[0], ym[1]))); };
    var pr = hasPayroll(book, opts, today), v1099 = book.contacts.some(function (x) { return x.is1099 && x.active !== false; });
    for (var y = y0; y <= y1; y++) {
      var endYM = m0 === 1 ? [y, 12] : [y + 1, m0 - 1], tag = m0 === 1 ? String(y) : y + '/' + String(y + 1).slice(2), after = function (n) { return mo(endYM[0], endYM[1] + n); };
      if (form === '1120S' || form === '1065') {
        var f = form === '1120S' ? 'Form 1120-S' : 'Form 1065';
        add(form + '|' + tag, on(after(3), 15), f + ' return for ' + tag, 'File the return and give each owner a Schedule K-1, or file Form 7004 for 6 more months.');
        add(form + 'x|' + tag, on(after(9), 15), f + ' return for ' + tag + ' if extended', 'Due date with the Form 7004 extension.');
      }
      if (form === '1120') {
        add('1120|' + tag, on(after(4), 15), 'Form 1120 return for ' + tag, 'File the return and pay the tax, or file Form 7004 for 6 more months.');
        add('1120x|' + tag, on(after(10), 15), 'Form 1120 return for ' + tag + ' if extended', 'Due date with the Form 7004 extension.');
        [4, 6, 9, 12].forEach(function (m, q) { add('1120es|' + tag + '|' + (q + 1), on(mo(y, m0 - 1 + m), 15), 'Corporate estimated tax, payment ' + (q + 1) + ' for ' + tag, 'Deposit through EFTPS.'); });
      }
      if (form === '1040C') {
        add('1040|' + y, ymd(y + 1, 4, 15), 'Form 1040 with Schedule C for ' + y, 'File the return and pay the tax, or file Form 4868 for 6 more months.');
        [[y, 4], [y, 6], [y, 9], [y + 1, 1]].forEach(function (ym, q) { add('1040es|' + y + '|' + (q + 1), ymd(ym[0], ym[1], 15), 'Form 1040-ES estimated tax, payment ' + (q + 1) + ' for ' + y, ''); });
      }
      if (pr) {
        [[y, 4, 30], [y, 7, 31], [y, 10, 31], [y + 1, 1, 31]].forEach(function (x, q) { add('941|' + y + '|' + (q + 1), ymd(x[0], x[1], x[2]), 'Form 941 for Q' + (q + 1) + ' ' + y, 'Quarterly payroll tax return.', '#/payroll'); });
        add('940|' + y, ymd(y + 1, 1, 31), 'Form 940 for ' + y, 'Annual federal unemployment (FUTA) return.', '#/payroll');
        add('w2|' + y, ymd(y + 1, 1, 31), 'W-2 and W-3 for ' + y, 'Give employees their W-2 and file with the SSA.', '#/payroll');
      }
      if (v1099) add('1099|' + y, ymd(y + 1, 1, 31), 'Form 1099-NEC for ' + y, 'Give each 1099 vendor a copy and file with the IRS.', '#/1099');
    }
    // sales tax: one per agency; how often and on which day is set per agency (states differ)
    var agencies = {}; (c.salesTaxes || []).forEach(function (t) { if (t.active !== false) { var a = t.agency || t.name; if (a) agencies[a] = 1; } });
    Object.keys(agencies).forEach(function (a) {
      var st = s.salesTax[a] || {}, fq = st.freq || 'quarterly', day = Math.max(1, Math.min(31, +st.day || 20)), n = fq === 'monthly' ? 1 : fq === 'yearly' ? 12 : 3;
      for (var y = y0; y <= y1; y++) for (var m = 1; m <= 12; m += n) {
        var endM = mo(y, m + n - 1), dueM = mo(endM[0], endM[1] + 1), label = n === 1 ? ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1] + ' ' + y : n === 3 ? 'Q' + ((m + 2) / 3) + ' ' + y : String(y);
        add('stax|' + a + '|' + y + '|' + m, on(dueM, day), 'Sales tax return to ' + a + ' for ' + label, st.freq ? '' : 'Set how often you file and the due day in Calendar settings; states differ.', '#/paysalestax');
      }
    });
    return out;
  }

  /** Every event from opts.from to opts.to: [{ key, kind, date, title, amount (cents, + money in / − out, 0 = none),
   *  note, href, due (on or before today), done, ... }] sorted by date. kinds: bill invoice recurring payroll close
   *  question tax todo. Overdue bills and invoices show on their own date and are counted on today in the forecast. */
  K.events = function (book, opts) {
    opts = opts || {}; var from = opts.from, to = opts.to, today = opts.today || U.today(), s = K.settings(book), out = [];
    var inR = function (d) { return d >= from && d <= to; };
    book.posted().forEach(function (t) {
      if (t.type !== 'bill' && t.type !== 'invoice') return;
      var open = book.openBalance(t); if (open <= 0) return;
      var due = t.dueDate || t.date, d = t.type === 'bill' ? s.payOn[t.id] || due : s.expectOn[t.id] || due, who = t.contactId ? (book.contactById[t.contactId] || {}).name || '' : '';
      if (!inR(d)) return;
      out.push(t.type === 'bill'
        ? { key: 'bill|' + t.id, kind: 'bill', date: d, due: due, title: 'Pay ' + (who || 'bill') + (t.number ? ' #' + t.number : ''), amount: -open, txnId: t.id, contactId: t.contactId, href: '#/txn/' + t.id, overdue: due < today, planned: d !== due }
        : { key: 'inv|' + t.id, kind: 'invoice', date: d, due: due, title: (who || 'Customer') + ' pays invoice ' + (t.number || ''), amount: open, txnId: t.id, contactId: t.contactId, href: '#/txn/' + t.id, overdue: due < today, planned: d !== due });
    });
    (book.recurring || []).forEach(function (r) {
      if (r.deleted || r.active === false || !r.nextDate || !r.template) return;
      var t = r.template, amt = t.lines ? U.sum(t.lines, function (l) { return Math.round(typeof l.amount === 'number' ? l.amount : U.toCents(l.amount || 0)); }) : U.toCents(t.amount || 0);
      var bank = t.accountId && book.accById[t.accountId], sign = t.type === 'deposit' || t.type === 'salesReceipt' ? 1 : t.type === 'expense' || t.type === 'check' || t.type === 'bill' ? -1 : 0;
      if (bank && bank.type === 'cc' && sign < 0) sign = 0;   // a card charge is not money out of the bank yet
      var d = r.nextDate, g = 0;
      while (d <= to && g++ < 400) {
        if (r.endDate && d > r.endDate) break;
        if (d >= from) out.push({ key: 'rec|' + r.id + '|' + d, kind: 'recurring', date: d, title: r.name || S.TXN_TYPES[t.type].label, amount: t.type === 'bill' ? 0 : sign * amt, recurringId: r.id, due: d <= today, next: d === r.nextDate, movable: d === r.nextDate, href: '#/recurring' });
        d = book.advanceDate(d, r.frequency || 'monthly');
      }
    });
    // payroll: the next pay dates from the gap between the last ones (weekly, every 2 weeks, twice a month, monthly)
    var pd = payrollDates(book);
    if (pd.length >= 2) {
      var last = pd[pd.length - 1], gaps = []; for (var i = Math.max(1, pd.length - 6); i < pd.length; i++) gaps.push(daysBetween(pd[i - 1].date, pd[i].date));
      gaps.sort(function (a, b) { return a - b; }); var gap = gaps[Math.floor(gaps.length / 2)];
      var cash = 0; (last.t.jlines || []).forEach(function (l) { var a = book.accById[l.accountId]; if (a && a.type === 'bank') cash += (l.debit || 0) - (l.credit || 0); });
      var biweekly = gaps.every(function (g) { return g === 14; });
      var next = gap <= 8 ? function (d) { return U.addDays(d, 7); } : biweekly ? function (d) { return U.addDays(d, 14); }
        : gap <= 18 ? function (d) { var y = +d.slice(0, 4), m = +d.slice(5, 7), day = +d.slice(8, 10); return day < 15 ? ymd(y, m, 15) : day < lastDay(y, m) ? ymd(y, m, lastDay(y, m)) : (m === 12 ? ymd(y + 1, 1, 15) : ymd(y, m + 1, 15)); }   // twice a month: the 15th and the last day
        : function (d) { return monthOn(last.date, d, 1); };
      var d2 = next(last.date), g2 = 0;
      while (d2 <= to && g2++ < 200) { if (d2 > today && d2 >= from) out.push({ key: 'pay|' + d2, kind: 'payroll', date: d2, title: 'Payroll', amount: cash, note: 'From the last pay dates; the amount is the last payroll\'s bank total.', href: '#/payroll' }); d2 = next(d2); }
    }
    // Close the books: each month with activity, on the 10th of the next month, until it is signed off
    var closed = book.company.closingDate || '', months = {};
    book.posted().forEach(function (t) { months[t.date.slice(0, 7)] = 1; }); (book.bankLines || []).forEach(function (l) { if (l.date) months[l.date.slice(0, 7)] = 1; });
    Object.keys(months).forEach(function (m) {
      var y = +m.slice(0, 4), mm = +m.slice(5, 7), end = ymd(y, mm, lastDay(y, mm)), d = mm === 12 ? ymd(y + 1, 1, 10) : ymd(y, mm + 1, 10);
      if (inR(d)) out.push({ key: 'close|' + m, kind: 'close', date: d, title: 'Close the books for ' + ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][mm - 1] + ' ' + y, done: closed >= end, href: '#/close', fixed: true });
    });
    var qs = (book.bankLines || []).filter(function (l) { return l.ask && !l.answer && l.status !== 'excluded'; });
    if (qs.length && inR(today)) out.push({ key: 'questions|' + today, kind: 'question', date: today, title: qs.length + ' client question' + (qs.length === 1 ? '' : 's') + ' waiting', href: '#/close?step=questions', fixed: true });
    out = out.concat(taxEvents(book, from, to, today, opts));
    s.todos.forEach(function (td) {
      var d = td.date, g = 0, moved = td.moved || {}, skip = td.skip || [];
      var put = function (occ) {
        if (skip.indexOf(occ) >= 0) return; var m = moved[occ] || {}, date = m.date || occ;
        if (date < from || date > to) return;
        out.push({ key: 'todo|' + td.id + '|' + occ, kind: 'todo', date: date, occ: occ, time: m.time !== undefined ? m.time : td.time || '', dur: m.dur || td.dur || 60, title: td.title, note: td.note, todoId: td.id, repeat: td.repeat, remind: td.remind === undefined ? null : td.remind, movable: true });
      };
      while (g++ < 1200) { if (td.until && d > td.until) break; if (d > to && !Object.keys(moved).some(function (o) { return o >= d; })) break; if (d > U.addMonths(to, 13)) break; put(d); if (!td.repeat) break; d = step(d, td.repeat, td.date); }
    });
    out.forEach(function (e) { if (e.kind === 'bill' || e.kind === 'invoice') e.movable = true; if (!e.fixed && s.done[e.key]) e.done = s.done[e.key]; if (e.amount === undefined) e.amount = 0; if (e.due === undefined) e.due = e.date <= today; });   // bills and invoices: due is their due date
    var ORDER = { tax: 0, bill: 1, payroll: 2, invoice: 3, recurring: 4, close: 5, question: 6, todo: 7 };
    return out.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : ORDER[a.kind] - ORDER[b.kind] || (a.title < b.title ? -1 : 1); });
  };
  function daysBetween(a, b) { return Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / 86400000); }

  /** Move events: [{ key, date, time?, dur? }]. To-dos move (one occurrence of a repeating one), a bill gets a planned
   *  pay date, an invoice an expected date, the next recurring entry a new next date. Deadlines and the books' own dates
   *  do not move. Resolves an undo token for K.undo. */
  K.move = function (book, moves, events) {
    var prev = U.clone(K.settings(book)), recs = [], bad = [];
    var evs = events || [], find = function (k) { return evs.find(function (e) { return e.key === k; }); };
    var c = U.clone(prev);
    moves.forEach(function (mv) {
      var p = mv.key.split('|'), e = find(mv.key);
      if (p[0] === 'todo') {
        var td = c.todos.find(function (x) { return x.id === p[1]; }); if (!td) return;
        var occ = p.slice(2).join('|'), keep = {}; ['time', 'dur'].forEach(function (k) { if (mv[k] !== undefined) keep[k] = k === 'time' ? hhmm(mv[k]) : Math.max(15, Math.round(mv[k])); });
        if (!td.repeat) { td.date = mv.date || td.date; Object.assign(td, keep); if (td.moved) td.moved = {}; c.done = renameKey(c.done, mv.key, 'todo|' + td.id + '|' + td.date); }
        else { td.moved = td.moved || {}; td.moved[occ] = Object.assign({}, td.moved[occ] || {}, { date: mv.date || (td.moved[occ] || {}).date || occ }, keep); }
      } else if (p[0] === 'bill') { if (mv.date) c.payOn[p[1]] = mv.date; }
      else if (p[0] === 'inv') { if (mv.date) c.expectOn[p[1]] = mv.date; }
      else if (p[0] === 'rec') { var r = book.recurring.find(function (x) { return x.id === p[1]; }); if (r && p[2] === r.nextDate && mv.date) recs.push({ r: r, date: mv.date }); else bad.push(e ? e.title : mv.key); }
      else bad.push(e ? e.title : mv.key);
    });
    var chain = book.saveCompany({ calendar: c });
    recs.forEach(function (x) { chain = chain.then(function () { return book.saveRecurring(Object.assign({}, x.r, { nextDate: x.date })); }); });
    return chain.then(function () { return { calendar: prev, recurring: recs.map(function (x) { return { id: x.r.id, nextDate: x.r.nextDate }; }), skipped: bad }; });
  };
  function renameKey(o, from, to) { if (o[from] && from !== to) { o[to] = o[from]; delete o[from]; } return o; }
  /** Put the calendar back as it was before a K.move, K.removeMany or K.markMany. */
  K.undo = function (book, tok) {
    var chain = book.saveCompany({ calendar: tok.calendar });
    (tok.recurring || []).forEach(function (x) { chain = chain.then(function () { var r = book.recurring.find(function (y) { return y.id === x.id; }); return r ? book.saveRecurring(Object.assign({}, r, { nextDate: x.nextDate })) : null; }); });
    return chain;
  };
  /** Tick or untick many events at once. */
  K.markMany = function (book, keys, on) { var prev = U.clone(K.settings(book)); return save(book, function (c) { keys.forEach(function (k) { if (on) c.done[k] = U.today(); else delete c.done[k]; }); }).then(function () { return { calendar: prev }; }); };
  /** Delete to-dos: one occurrence of a repeating to-do (all: false) or the whole to-do. Other kinds are left alone. */
  K.removeMany = function (book, keys, all) {
    var prev = U.clone(K.settings(book));
    return save(book, function (c) {
      keys.forEach(function (k) {
        var p = k.split('|'); if (p[0] !== 'todo') return; var occ = p.slice(2).join('|'), td = c.todos.find(function (x) { return x.id === p[1]; }); if (!td) return;
        if (all || !td.repeat) { c.todos = c.todos.filter(function (x) { return x.id !== td.id; }); Object.keys(c.done).forEach(function (d) { if (d.indexOf('todo|' + td.id + '|') === 0) delete c.done[d]; }); }
        else { td.skip = (td.skip || []).concat([occ]); delete c.done[k]; }
      });
    }).then(function () { return { calendar: prev }; });
  };
  /** To-do reminders due now: events whose time minus their reminder is between `since` and `now` (Date objects). */
  K.dueReminders = function (events, since, now) {
    return events.filter(function (e) {
      if (e.kind !== 'todo' || e.remind === null || e.remind === undefined || e.done) return false;
      var hm = (e.time || '09:00').split(':'), at = new Date(+e.date.slice(0, 4), +e.date.slice(5, 7) - 1, +e.date.slice(8, 10), +hm[0], +hm[1]).getTime() - e.remind * 60000;
      return at > since.getTime() && at <= now.getTime();
    });
  };

  /** Day-by-day bank balance from today to opts.to: today's balance of the bank accounts plus each event's money in or
   *  out (anything overdue counted today). { start, days { date: { balance, in, out, low } }, lowDays [dates], low }. */
  K.forecast = function (book, events, opts) {
    opts = opts || {}; var today = opts.today || U.today(), to = opts.to, low = opts.low !== undefined ? opts.low : K.settings(book).low || 0;
    var banks = book.accounts.filter(function (a) { return a.type === 'bank' && a.active !== false; }), start = U.sum(banks, function (a) { return book.accountBalance(a.id, today); });
    var by = {}; events.forEach(function (e) { if (!e.amount || e.done) return; if (e.kind === 'recurring' && e.date < today) return; var d = e.date < today ? today : e.date; (by[d] = by[d] || []).push(e.amount); });
    var days = {}, lowDays = [], bal = start;
    for (var d = today, g = 0; d <= to && g < 800; d = U.addDays(d, 1), g++) {
      var inn = 0, outt = 0; (by[d] || []).forEach(function (a) { if (a > 0) inn += a; else outt -= a; });
      bal += inn - outt; days[d] = { balance: bal, in: inn, out: outt, low: bal < low };
      if (bal < low) lowDays.push(d);
    }
    return { start: start, days: days, lowDays: lowDays, low: low };
  };

  /** An .ics calendar (all-day events) for Outlook, Google Calendar or Apple Calendar. */
  K.ics = function (book, events) {
    var esc = function (s) { return String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n'); };
    var fold = function (l) { var out = ''; while (l.length > 74) { out += l.slice(0, 74) + '\r\n '; l = l.slice(74); } return out + l; };
    var stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, ''), co = book.company.name || 'VaultBook';
    var lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//VaultBook//Calendar//EN', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:' + esc(co)];
    events.forEach(function (e) {
      var d = e.date.replace(/-/g, ''), nx = U.addDays(e.date, 1).replace(/-/g, '');
      var desc = [e.amount ? (e.amount > 0 ? 'In ' : 'Out ') + U.fmt(Math.abs(e.amount), { symbol: true }) : '', e.note || '', e.done ? 'Done' : ''].filter(Boolean).join(' · ');
      lines.push('BEGIN:VEVENT', 'UID:' + esc(e.key.replace(/[^A-Za-z0-9|.-]/g, '')) + '@vaultbook.local', 'DTSTAMP:' + stamp, 'DTSTART;VALUE=DATE:' + d, 'DTEND;VALUE=DATE:' + nx,
        'SUMMARY:' + esc(co + ': ' + e.title).slice(0, 300), desc ? 'DESCRIPTION:' + esc(desc) : null, 'TRANSP:TRANSPARENT', 'END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    return lines.filter(function (l) { return l !== null; }).map(fold).join('\r\n') + '\r\n';
  };
})(typeof window !== 'undefined' ? window : globalThis);
