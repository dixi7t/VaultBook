/* VaultBook — Close the books (1.46). VaultBook works like the staff accountant who prepares the books; the CPA
 * reviews, asks the client, ties out and signs off. Nothing here posts by itself: C.post and C.accept go through
 * Book.postBankLine (saveTransaction), and C.signOff through saveCompany (closing date).
 *  prepare: for each bank line in For review — 1 an entry already in the books (match, never a second entry),
 *           2 the company's own bank rule, 3 the payee's habit (last two years first), 4 a common merchant, else ask.
 *           Only a sure habit, a rule or a match is marked auto; never an owner, loan, payroll, tax or balance sheet account.
 *  selfTest: learn from the years before a finished year, predict that year, count how often it was right.
 *  checklist: statements received, prepared, review, client questions, reconciliations, compare to last year,
 *             adjusting entries, sign-off. Sign-off is refused until the first six tie. */
(function (root) {
  'use strict';
  var OB = root.OB, U = OB.util, S = OB.schema, I = OB.importer, H = OB.hints, R = OB.reports, LedgerError = OB.LedgerError;
  var C = OB.close = {};
  var FEED = { bank: 1, cc: 1, oca: 1 };
  var RISKY = /payroll|wage|salar|loan|shareholder|stockholder|owner|draw|distribution|dividend|officer|1099|tax|suspense|uncategor|ask my accountant/i;   // taxes change account year to year: always reviewed

  /** Why an account must wait for a person ('' when it may be posted automatically). */
  C.risky = function (book, id) {
    var a = book.accById[id];
    if (!a || a.active === false) return 'an inactive account';
    if (!S.isPL(a.type)) return 'a balance sheet account';
    if (RISKY.test(a.name)) return 'an owner, loan, payroll or tax account';
    return '';
  };
  C.key = function (p) { return p.from + '_' + p.to; };
  C.settings = function (book) { return (book.company && book.company.close) || {}; };
  function nextYear(d, n) { return String(+d.slice(0, 4) + n) + d.slice(4); }
  function keyOf(w) { return w.slice(0, 4).join(' '); }
  function wordsKey(s) { var k = keyOf(H.words(s)); return H.notPayee(k) ? '' : k; }
  // a past entry is filed under its payee's name and under its bank wording, so a bank line finds it either way
  function txnKeys(book, t) {
    var c = t.contactId && book.contactById[t.contactId], a = c ? wordsKey(c.name) : '', b = wordsKey(I.ruleTextFor(t.memo));
    return [a, b].filter(function (k, i, l) { return k && l.indexOf(k) === i; });
  }
  function lineKey(book, desc, hab, dir) {
    var c = H.vendorIn(book, desc), a = c ? wordsKey(c.name) : '', b = wordsKey(I.ruleTextFor(desc));
    var k = [a, b].find(function (x) { return x && hab && hab[x + dir]; }) || a || b;
    return { key: k, contact: c };
  }
  function cashSplit(book) { return function (s) { var a = book.accById[s.accountId]; return a && (a.type === 'bank' || a.type === 'cc'); }; }
  function money(c) { return U.fmt(Math.abs(c), { symbol: true }); }

  /** Past uses per payee and direction: { 'COSTCO|out': [{date, acct, contactId}] }. One bank/card line and one other line only. */
  C.habits = function (book, opts) {
    opts = opts || {}; var m = {}, isCash = cashSplit(book);
    book.transactions.forEach(function (t) {
      if ((t.status && t.status !== 'posted') || (opts.before && t.date >= opts.before) || /^QB-/.test(t.number || '')) return;
      var ps = book.buildSplitsSafe(t), c = ps.filter(isCash); if (c.length !== 1 || ps.length !== 2) return;
      var o = ps[0] === c[0] ? ps[1] : ps[0], a = book.accById[o.accountId];
      if (!a || a.system === 'RE' || FEED[a.type]) return;
      var dir = c[0].amount > 0 ? '|in' : '|out', u = { date: t.date, acct: a.id, contactId: t.contactId || '' };
      txnKeys(book, t).forEach(function (k) { (m[k + dir] = m[k + dir] || []).push(u); });
    });
    return m;
  };

  /** What the habit says on a date: the last two calendar years count first (habits change), older years otherwise. */
  function decide(book, uses, asOf, label) {
    var since = String(+asOf.slice(0, 4) - 2) + '-01-01', all = {}, rec = {}, nAll = 0, nRec = 0;
    uses.forEach(function (u) { all[u.acct] = (all[u.acct] || 0) + 1; nAll++; if (u.date >= since && u.date < asOf) { rec[u.acct] = (rec[u.acct] || 0) + 1; nRec++; } });
    var recent = nRec >= 3, src = recent ? rec : all, n = recent ? nRec : nAll;
    var ids = Object.keys(src).sort(function (a, b) { return src[b] - src[a] || (all[b] || 0) - (all[a] || 0); });
    var best = ids[0], last = uses.filter(function (u) { return u.date < asOf || !recent; }).sort(function (x, y) { return x.date < y.date ? 1 : -1; }).slice(0, 3);
    var sure = n >= (recent ? 3 : 5) && src[best] / n >= 0.98 && last.length >= 3 && last.every(function (u) { return u.acct === best; });
    var top = ids.concat(Object.keys(all)).filter(function (x, i, a) { return a.indexOf(x) === i && book.accById[x]; }).slice(0, 3)
      .map(function (id) { return { accountId: id, n: src[id] || 0 }; });
    var lastUse = last[0], who = (uses.filter(function (u) { return u.acct === best && u.contactId; }).pop() || {}).contactId || '';
    return { best: best, sure: sure, top: top, contactId: who,
      reason: label + ': ' + (book.accById[best] ? book.accById[best].name : '') + ' ' + src[best] + ' of ' + n + ' times' + (recent ? ' since ' + since.slice(0, 4) : '') + (lastUse ? ', last on ' + U.fmtDate(lastUse.date) : '') };
  }

  function planFor(book, l, hab, opts) {
    var lk = lineKey(book, l.description, hab, l.amount > 0 ? '|in' : '|out'), p = { line: l, kind: 'ask', auto: false, categoryId: '', contactId: lk.contact ? lk.contact.id : '', top: [], reason: '', why: '', d: null,
      key: lk.key || l.description, label: lk.contact ? lk.contact.name : lk.key || l.description };
    var best = book.bankCandidates(l.id).find(function (c) { return c.best; });
    if (best) {
      p.kind = 'match'; p.cand = best; p.reason = 'Already in the books: ' + (best.reasons || []).join(', ');
      if (best.kind === 'register' && !best.split && best.txnId && best.splitIndex !== undefined) { p.d = { kind: 'match', txnId: best.txnId, splitIndex: best.splitIndex }; p.auto = true; }
      else p.why = 'Check this match in the bank feed';
      return p;
    }
    var sug = book.bankSuggestion(l.id);
    if (sug && sug.source === 'rule') {
      p.kind = 'rule'; p.categoryId = sug.categoryId; p.contactId = sug.contactId || p.contactId; p.reason = sug.reason; p.top = [{ accountId: sug.categoryId, n: 0 }];
      if (!sug.splits && book.accById[sug.categoryId]) { p.d = { kind: 'add', categoryId: sug.categoryId, contactId: p.contactId, classId: sug.classId || undefined }; p.auto = true; }
      else p.why = 'A split rule: post it in the bank feed';
      return p;
    }
    var uses = lk.key && hab[lk.key + (l.amount > 0 ? '|in' : '|out')];
    if (uses && uses.length) {
      var dz = decide(book, uses, l.date, p.label);
      p.kind = 'habit'; p.categoryId = dz.best; p.top = dz.top; p.reason = dz.reason; p.contactId = p.contactId || dz.contactId;
      p.d = { kind: 'add', categoryId: dz.best, contactId: p.contactId };
      var why = C.risky(book, dz.best);
      p.auto = dz.sure && !why;
      p.why = why ? 'Goes to ' + why + ': you decide' : dz.sure ? '' : dz.top.length > 1 ? 'Used more than one account' : 'Not used often enough yet';
      return p;
    }
    var h = H && H.fromCommon(book, l);
    if (h) { p.kind = 'common'; p.categoryId = h.categoryId; p.top = [{ accountId: h.categoryId, n: 0 }]; p.reason = h.reason; p.d = { kind: 'add', categoryId: h.categoryId, contactId: p.contactId }; p.why = 'New payee'; return p; }
    p.why = 'New payee, no history';
    return p;
  }

  /** Plans for the bank lines in For review, oldest first. opts: {from, to, accountId, auto} — auto false marks nothing auto. */
  C.prepare = function (book, opts) {
    opts = opts || {}; var hab = C.habits(book);
    return book.bankLines.filter(function (l) { return l.status === 'review' && (!opts.accountId || l.accountId === opts.accountId) && (!opts.from || l.date >= opts.from) && (!opts.to || l.date <= opts.to); })
      .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; })
      .map(function (l) { var p = planFor(book, l, hab, opts); if (!opts.auto) p.auto = false; return p; });
  };

  function postEach(book, list, mk) {
    var res = { posted: 0, failed: [] };
    return list.reduce(function (pr, p) {
      return pr.then(function () {
        var l = book.bankLineById[p.line.id]; if (!l || l.status !== 'review') return;
        var d = mk(p); if (!d) return;
        return book.postBankLine(l.id, d).then(function () { res.posted++; }, function (e) { res.failed.push({ line: l, error: e.message }); });
      });
    }, Promise.resolve()).then(function () { return res; });
  }
  /** Post the plans marked auto; each keeps its reason on the bank line (Posted tab, undo as usual). */
  C.post = function (book, plans) {
    return postEach(book, (plans || []).filter(function (p) { return p.auto && p.d; }), function (p) { return Object.assign({}, p.d, { prepared: p.reason }); });
  };
  /** Post a reviewed group with the account the reviewer chose. */
  C.accept = function (book, plans, categoryId, contactId) {
    if (!book.accById[categoryId]) return Promise.reject(LedgerError('Choose an account.'));
    return postEach(book, plans || [], function (p) { return { kind: 'add', categoryId: categoryId, contactId: contactId !== undefined ? contactId : p.contactId }; });
  };
  /** Lines to review grouped by payee, largest dollars first: [{key, label, plans, total, top}]. */
  C.groups = function (plans) {
    var g = {};
    (plans || []).forEach(function (p) {
      var k = p.key + (p.line.amount > 0 ? '|in' : '|out');
      var x = g[k] = g[k] || { key: k, label: p.label, plans: [], total: 0, top: p.top, kind: p.kind, why: p.why, reason: p.reason };
      x.plans.push(p); x.total += Math.abs(p.line.amount);
    });
    return Object.keys(g).map(function (k) { return g[k]; }).sort(function (a, b) { return b.total - a.total; });
  };

  /** Measure on a finished period: learn from everything before it, predict each bank/card line in it. */
  C.selfTest = function (book, p, debug) {
    var hab = C.habits(book, { before: p.from }), isCash = cashSplit(book);
    var r = { from: p.from, to: p.to, lines: 0, auto: { n: 0, right: 0 }, suggest: { n: 0, right: 0, top3: 0 }, ask: 0 };
    if (debug) r.wrong = [];
    book.transactions.forEach(function (t) {
      if ((t.status && t.status !== 'posted') || t.date < p.from || t.date > p.to || /^QB-/.test(t.number || '')) return;
      var ps = book.buildSplitsSafe(t), c = ps.filter(isCash); if (c.length !== 1 || ps.length !== 2) return;
      var o = ps[0] === c[0] ? ps[1] : ps[0], a = book.accById[o.accountId]; if (!a || a.system === 'RE' || FEED[a.type]) return;
      r.lines++;
      var cn = t.contactId && book.contactById[t.contactId] ? book.contactById[t.contactId].name : '';
      var dir = c[0].amount > 0 ? '|in' : '|out', lk = lineKey(book, t.memo || cn, hab, dir), uses = lk.key && hab[lk.key + dir];
      if (!uses) { r.ask++; return; }
      var dz = decide(book, uses, t.date, lk.key), sure = dz.sure && !C.risky(book, dz.best), b = sure ? r.auto : r.suggest;
      b.n++; if (dz.best === a.id) b.right++; else if (sure && r.wrong) r.wrong.push([lk.key, book.accById[dz.best].name, a.name, dz.reason]);
      if (!sure && dz.top.some(function (x) { return x.accountId === a.id; })) r.suggest.top3++;
    });
    return r;
  };
  /** Auto-posting is offered only on a clear measured result: at least 20 sure lines, 95% right. */
  C.autoAllowed = function (t) { return !!(t && t.auto && t.auto.n >= 20 && t.auto.right / t.auto.n >= 0.95); };

  /* ---------------- the checklist ---------------- */
  function months(from, to) { var out = [], m = from.slice(0, 7); while (m <= to.slice(0, 7)) { out.push(m); var y = +m.slice(0, 4), n = +m.slice(5, 7) + 1; if (n > 12) { y++; n = 1; } m = y + '-' + (n < 10 ? '0' : '') + n; } return out; }
  function monthEnd(m) { var y = +m.slice(0, 4), n = +m.slice(5, 7); return m + '-' + String(new Date(Date.UTC(y, n, 0)).getUTCDate()).padStart(2, '0'); }
  function inScope(book, p) { // statement accounts: a bank or card account with imported lines, or with postings in the period
    var ix = book.splitIndex();
    return book.accounts.filter(function (a) {
      if (a.active === false || !FEED[a.type]) return false;
      if (book.bankLines.some(function (l) { return l.accountId === a.id && l.status !== 'removed'; })) return true;
      return a.type !== 'oca' && (ix[a.id] || []).some(function (e) { return e.t.status === 'posted' && e.t.date >= p.from && e.t.date <= p.to; });
    });
  }

  C.flux = function (book, p, set, notes) {
    var prior = { from: nextYear(p.from, -1), to: nextYear(p.to, -1) };
    var cur = R.pnl(book, { from: p.from, to: p.to }), old = R.pnl(book, prior), map = {};
    [[cur, 'cur'], [old, 'prior']].forEach(function (x) {
      x[0].sectionOrder.forEach(function (k) { x[0].sections[k].rows.forEach(function (r) {
        var m = map[r.accountId] = map[r.accountId] || { accountId: r.accountId, label: r.label, cur: 0, prior: 0 };
        m[x[1]] = r.values[r.values.length - 1];
      }); });
    });
    var income = 0; old.sections.income.rows.forEach(function (r) { income += r.values[r.values.length - 1]; });
    set = set || {};
    var amt = set.amt > 0 ? set.amt : Math.max(50000, Math.round(Math.abs(income) / 100)), pct = set.pct > 0 ? set.pct : 10;
    var rows = Object.keys(map).map(function (k) {
      var r = map[k], diff = r.cur - r.prior;
      r.diff = diff; r.pct = r.prior ? Math.round(diff / Math.abs(r.prior) * 1000) / 10 : null;
      r.flag = Math.abs(diff) >= amt && (r.prior === 0 || Math.abs(diff) / Math.abs(r.prior) * 100 >= pct);
      r.note = (notes || {})[k] || ''; r.explained = !r.flag || !!r.note;
      return r;
    }).sort(function (a, b) { return Math.abs(b.diff) - Math.abs(a.diff); });
    return { prior: prior, amt: amt, pct: pct, rows: rows, flagged: rows.filter(function (r) { return r.flag; }).length, done: rows.every(function (r) { return r.explained; }) };
  };

  /** Last year's journal entries in the same period, dated a year later; done when this period has one to the same accounts. */
  C.adjusting = function (book, p) {
    var from = nextYear(p.from, -1), to = nextYear(p.to, -1), sig = function (t) { return book.buildSplitsSafe(t).map(function (s) { return s.accountId; }).filter(function (x, i, a) { return a.indexOf(x) === i; }).sort().join(','); };
    var now = {};
    book.transactions.forEach(function (t) { if (t.type === 'journal' && t.status === 'posted' && t.date >= p.from && t.date <= p.to) now[sig(t)] = 1; });
    var list = book.transactions.filter(function (t) { return t.type === 'journal' && t.status === 'posted' && t.date >= from && t.date <= to && !/^QB-/.test(t.number || ''); })
      .sort(function (a, b) { return a.date < b.date ? -1 : 1; })
      .map(function (t) {
        var ps = book.buildSplitsSafe(t);
        return { txnId: t.id, date: nextYear(t.date, 1), memo: t.memo || '', number: t.number || '', amount: U.sum(ps.filter(function (s) { return s.amount > 0; }), function (s) { return s.amount; }),
          accounts: ps.map(function (s) { return book.accountLabel(s.accountId); }).filter(function (x, i, a) { return a.indexOf(x) === i; }), done: !!now[sig(t)] };
      });
    return { list: list, open: list.filter(function (x) { return !x.done; }).length };
  };

  C.checklist = function (book, p, today) {
    today = today || U.today();
    var st = C.settings(book), per = (st.periods || {})[C.key(p)] || {};
    var lastDone = months(p.from, p.to).filter(function (m) { return monthEnd(m) < today; });   // statements exist only for months that have ended
    var due = lastDone.length ? monthEnd(lastDone[lastDone.length - 1]) : '';
    var accs = inScope(book, p);
    var statements = { accounts: accs.map(function (a) {
      var imps = book.bankImports.filter(function (x) { return x.accountId === a.id && !x.undone; });
      var lines = book.bankLines.filter(function (l) { return l.accountId === a.id && l.status !== 'removed'; });
      var got = function (m) { var s = m + '-01', e = monthEnd(m);
        return imps.some(function (x) { var to = x.endingDate && x.endingDate > x.dateTo ? x.endingDate : x.dateTo; return x.dateFrom <= e && to >= s; }) || lines.some(function (l) { return l.date >= s && l.date <= e; }); };
      return { accountId: a.id, name: book.accountLabel(a.id), months: lastDone.map(function (m) { return { m: m, ok: got(m) }; }), missing: lastDone.filter(function (m) { return !got(m); }) };
    }) };
    statements.done = statements.accounts.every(function (a) { return !a.missing.length; });
    var inP = function (l) { return l.date >= p.from && l.date <= p.to && l.status !== 'removed' && FEED[(book.accById[l.accountId] || {}).type]; };
    var plines = book.bankLines.filter(inP), waiting = plines.filter(function (l) { return l.status === 'review'; });
    var prepared = { byVaultBook: plines.filter(function (l) { return l.status === 'posted' && l.prepared; }).length, byYou: plines.filter(function (l) { return l.status === 'posted' && !l.prepared; }).length,
      waiting: waiting.length, ranAt: per.preparedAt || '' };
    prepared.done = !waiting.length || !!per.preparedAt;
    var asked = plines.filter(function (l) { return l.ask; });
    var questions = { list: asked, open: asked.filter(function (l) { return !l.answer && l.status === 'review'; }).length };
    questions.done = !questions.open;
    var reconcile = { accounts: accs.map(function (a) {
      var r = book.reconciliations.filter(function (x) { return x.accountId === a.id && !x.undone; }).sort(function (x, y) { return x.statementDate < y.statementDate ? 1 : -1; })[0];
      var through = r ? r.statementDate : '';
      return { accountId: a.id, name: book.accountLabel(a.id), through: through, ok: !due || through >= due };
    }) };
    reconcile.done = reconcile.accounts.every(function (a) { return a.ok; });
    var flux = C.flux(book, p, st.flux, per.notes);
    return { period: p, key: C.key(p), due: due, statements: statements, prepared: prepared, review: { waiting: waiting.length, done: !waiting.length },
      questions: questions, reconcile: reconcile, flux: flux, adjust: C.adjusting(book, p), signedOff: per.signedOff || null };
  };

  /** What still stands in the way of signing off: { ok, why[] }. Adjusting entries are the reviewer's call, not a gate. */
  C.canSignOff = function (cl) {
    var why = [];
    cl.statements.accounts.forEach(function (a) { if (a.missing.length) why.push(a.name + ': statement missing for ' + a.missing.join(', ')); });
    if (cl.review.waiting) why.push(cl.review.waiting + ' bank line' + (cl.review.waiting === 1 ? '' : 's') + ' still to review');
    if (cl.questions.open) why.push(cl.questions.open + ' client question' + (cl.questions.open === 1 ? '' : 's') + ' not answered');
    cl.reconcile.accounts.forEach(function (a) { if (!a.ok) why.push(a.name + ': not reconciled through ' + U.fmtDate(cl.due)); });
    if (!cl.flux.done) why.push((cl.flux.rows.filter(function (r) { return !r.explained; }).length) + ' change' + (cl.flux.rows.filter(function (r) { return !r.explained; }).length === 1 ? '' : 's') + ' from last year without a reason');
    return { ok: !why.length, why: why };
  };

  function saveClose(book, fn) { var c = U.clone(C.settings(book)); fn(c); return book.saveCompany({ close: c }); }
  /** Change settings: { auto, flux: {amt (cents), pct}, test }. */
  C.saveSettings = function (book, ch) { return saveClose(book, function (c) { Object.keys(ch || {}).forEach(function (k) { c[k] = ch[k]; }); }); };
  function period(c, p) { c.periods = c.periods || {}; return (c.periods[C.key(p)] = c.periods[C.key(p)] || {}); }
  C.saveNote = function (book, p, accountId, text) { return saveClose(book, function (c) { var x = period(c, p); x.notes = x.notes || {}; text = String(text || '').trim().slice(0, 500); if (text) x.notes[accountId] = text; else delete x.notes[accountId]; }); };
  C.markPrepared = function (book, p, res) { return saveClose(book, function (c) { var x = period(c, p); x.preparedAt = new Date().toISOString(); x.preparedPosted = res ? res.posted : 0; }); };

  /** Sign off: refused until the checklist ties; then the period is locked (closing date) and the sign-off recorded. */
  C.signOff = function (book, p, today, closingPassword) {
    var cl = C.checklist(book, p, today), can = C.canSignOff(cl);
    if (!can.ok) return Promise.reject(LedgerError('Not ready to sign off: ' + can.why.join('; ') + '.'));
    var c = U.clone(C.settings(book)), x = period(c, p), cd = book.company.closingDate || '';
    x.signedOff = { at: new Date().toISOString(), closingDate: p.to };
    var input = { close: c }; if (p.to > cd) { input.closingDate = p.to; input.closingPassword = closingPassword; }
    return book.saveCompany(input).then(function () {
      var a = book._auditEntry('closeSignOff', '', 'Signed off ' + U.fmtDate(p.from) + ' to ' + U.fmtDate(p.to) + '; books closed through ' + U.fmtDate(p.to > cd ? p.to : cd));
      return book._commit([{ store: 'audit', value: a }], function () { book.audit.push(a); });
    });
  };
})(typeof window !== 'undefined' ? window : global);
