/* VaultBook — Close the books page (1.46): the close checklist a CPA already uses. VaultBook prepares (like the staff
 * accountant), the CPA reviews, asks the client, ties out and signs off. All accounting is in js/close.js. */
(function () {
  'use strict';
  const U = OB.util, UI = OB.ui, C = OB.close, esc = U.esc;
  const STEPS = [['statements', 'Statements received'], ['prepare', 'Prepared by VaultBook'], ['review', 'Review'], ['questions', 'Client questions'],
    ['reconcile', 'Bank reconciliations'], ['flux', 'Compare to last year'], ['adjust', 'Adjusting entries'], ['signoff', 'Sign off']];
  let cs = null;   // page state while the app is open
  const fresh = (b) => ({ companyId: b.company.id, year: '', month: '', step: 'statements', open: '', test: null, pick: {} });

  function fyStart(b) { return +(b.company.fiscalYearStartMonth || 1); }
  function periodOf(b, yr, wholeYear) {   // the fiscal year that starts in cs.year (or yr), or one of its months
    const m0 = fyStart(b), y = +(yr || cs.year), p2 = (n) => String(n).padStart(2, '0');
    const from = y + '-' + p2(m0) + '-01', endY = m0 === 1 ? y : y + 1, endM = m0 === 1 ? 12 : m0 - 1;
    const last = (yy, mm) => yy + '-' + p2(mm) + '-' + p2(new Date(Date.UTC(yy, mm, 0)).getUTCDate());
    if (!cs.month || wholeYear) return { from, to: last(endY, endM) };
    const mm = +cs.month, yy = mm >= m0 ? y : y + 1;
    return { from: yy + '-' + p2(mm) + '-01', to: last(yy, mm) };
  }
  function years(b) {
    const ds = b.transactions.map((t) => t.date).concat(b.bankLines.map((l) => l.date)).filter(Boolean).sort();
    const now = +U.today().slice(0, 4), first = ds.length ? Math.min(+ds[0].slice(0, 4), now) : now, out = [];
    for (let y = now; y >= first; y--) out.push(y);
    return out;
  }
  const status = (ok, n, word) => ok ? '<span class="badge ok">Done</span>' : `<span class="badge warn">${n ? n + ' ' : ''}${word || 'Open'}</span>`;

  UI.routes.close = (el, r) => {
    const b = UI.book;
    if (!cs || cs.companyId !== b.company.id) cs = fresh(b);
    if (!cs.year) { const today = U.today(), y = +today.slice(0, 4); cs.year = String(+today.slice(5, 7) <= 3 ? y - 1 : y); }
    if (r.params.step && STEPS.some((s) => s[0] === r.params.step)) cs.step = r.params.step;
    const p = periodOf(b), cl = C.checklist(b, p), can = C.canSignOff(cl);
    const plans = C.prepare(b, { from: p.from, to: p.to, auto: false });
    const st = {
      statements: [cl.statements.done, U.sum(cl.statements.accounts, (a) => a.missing.length), 'to import'],
      prepare: [cl.prepared.done, cl.prepared.waiting, 'waiting'],
      review: [cl.review.done, cl.review.waiting, 'to review'],
      questions: [cl.questions.done, cl.questions.open, 'open'],
      reconcile: [cl.reconcile.done, cl.reconcile.accounts.filter((a) => !a.ok).length, 'open'],
      flux: [cl.flux.done, cl.flux.rows.filter((x) => !x.explained).length, 'to explain'],
      adjust: [!cl.adjust.open, cl.adjust.open, 'to consider'],
      signoff: [!!cl.signedOff, 0, cl.signedOff ? '' : 'Not signed']
    };
    const mName = (m) => new Date(Date.UTC(2000, m - 1, 1)).toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
    const m0 = fyStart(b), monthsOpt = Array.from({ length: 12 }, (_, i) => ((m0 - 1 + i) % 12) + 1);
    el.innerHTML = UI.page('Close the books', `<label class="field inline"><span>Year</span><select id="cl-year" data-testid="cl-year">${years(b).map((y) => `<option value="${y}"${String(y) === cs.year ? ' selected' : ''}>${m0 === 1 ? y : 'FY ' + y + '–' + String(y + 1).slice(2)}</option>`).join('')}</select></label>
        <label class="field inline"><span>Period</span><select id="cl-month" data-testid="cl-month"><option value="">Whole year</option>${monthsOpt.map((m) => `<option value="${m}"${String(m) === cs.month ? ' selected' : ''}>${mName(m)}</option>`).join('')}</select></label>`,
      `<p class="muted small cl-period">${esc(U.fmtDate(p.from))} to ${esc(U.fmtDate(p.to))}${cl.signedOff ? ` · <strong>Signed off ${esc(U.fmtDate(cl.signedOff.at.slice(0, 10)))}</strong>` : ''}</p>
      <div class="cl-wrap">
        <ol class="cl-steps" role="tablist" aria-label="Close checklist">${STEPS.map(([k, t], i) => `<li><button role="tab" aria-selected="${cs.step === k}" data-step="${k}" data-testid="cl-step-${k}">
          <span class="cl-n">${i + 1}</span><span class="cl-t">${t}</span>${status(st[k][0], st[k][1], st[k][2])}</button></li>`).join('')}</ol>
        <section class="card cl-pane" data-testid="cl-pane">${pane(b, p, cl, can, plans)}</section>
      </div>`,
      'VaultBook prepares the books from the bank and card statements; you review, ask the client, tie out and sign off.');
    bind(el, b, p, cl, plans);
  };

  function pane(b, p, cl, can, plans) {
    switch (cs.step) {
      case 'statements': return `<h2>Statements received</h2>
        ${cl.statements.accounts.length ? `<div class="scroll-x"><table class="data cl-grid"><thead><tr><th>Account</th>${(cl.statements.accounts[0].months).map((m) => `<th class="num">${esc(m.m.slice(5))}/${esc(m.m.slice(2, 4))}</th>`).join('')}<th></th></tr></thead>
          <tbody>${cl.statements.accounts.map((a) => `<tr><td>${esc(a.name)}</td>${a.months.map((m) => `<td class="num">${m.ok ? '<span class="cl-ok" aria-label="Received">✓</span>' : '<span class="cl-miss">Missing</span>'}</td>`).join('')}
            <td>${a.missing.length ? `<a class="btn small" href="#/bankfeed?account=${esc(a.accountId)}&import=1">Import statement</a>` : ''}</td></tr>`).join('')}</tbody></table></div>
          ${cl.statements.accounts[0].months.length ? '' : '<p class="muted">No month of this period has ended yet.</p>'}`
          : '<p class="muted">No bank or card account has statements or activity in this period.</p>'}
        <p class="muted small">A month counts as received when a bank or card file covering it was imported. Months that have not ended are not asked for.</p>`;
      case 'prepare': {
        const t = cs.test, set = C.settings(b), auto = !!set.auto, allowed = C.autoAllowed(t || set.test), pc = (a, c) => c ? (100 * a / c).toFixed(1) + '%' : '–';
        const tt = t || set.test;
        return `<h2>Prepared by VaultBook</h2>
          <p>VaultBook works through the bank lines in this order: an entry already in the books is matched (never entered twice), then your bank rules,
          then each payee's habit from the last two years. Only sure habits are posted; owner, loan, payroll, tax and balance sheet accounts always wait for you.</p>
          <div class="cl-stats"><div><b data-testid="cl-byvb">${cl.prepared.byVaultBook}</b><span>posted by VaultBook</span></div><div><b>${cl.prepared.byYou}</b><span>posted by you</span></div><div><b>${cl.prepared.waiting}</b><span>waiting</span></div></div>
          <h3>Self-test</h3>
          ${tt ? `<p data-testid="cl-test">Learning from the years before ${esc(tt.from.slice(0, 4))} and predicting ${esc(tt.from.slice(0, 4))}: of ${tt.lines} bank and card lines, VaultBook would have posted
            <strong>${tt.auto.n}</strong> (${pc(tt.auto.n, tt.lines)}), right <strong>${pc(tt.auto.right, tt.auto.n)}</strong>; suggested ${tt.suggest.n}, the right account among the top three ${pc(tt.suggest.top3, tt.suggest.n)}; ${tt.ask} were new payees.</p>
            <p class="${allowed ? '' : 'warn-text'}">${allowed ? 'Measured result is clear (at least 20 lines and 95% right): auto-posting can be used for this client.' : 'Below the bar of 20 sure lines and 95% right: VaultBook will suggest instead of posting, unless you turn it on yourself.'}</p>
            ${tt.wrong && tt.wrong.length ? `<details><summary>Where it was wrong (${tt.wrong.length})</summary><ul class="small">${tt.wrong.slice(0, 12).map((w) => `<li>${esc(w[0])}: would post to ${esc(w[1])}, booked to ${esc(w[2])}</li>`).join('')}</ul></details>` : ''}`
            : '<p class="muted">Run the self-test on the last finished year before letting VaultBook post anything.</p>'}
          <div class="form-actions"><button class="btn" id="cl-test" data-testid="cl-run-test">Run self-test on ${+cs.year - 1}</button></div>
          <label class="check"><input type="checkbox" id="cl-auto" data-testid="cl-auto" ${auto ? 'checked' : ''} ${allowed || auto ? '' : 'data-warn="1"'}> Let VaultBook post the sure lines for this client</label>
          <div class="form-actions"><button class="btn primary" id="cl-prep" data-testid="cl-prepare" ${cl.prepared.waiting ? '' : 'disabled'}>Prepare ${cl.prepared.waiting} waiting line${cl.prepared.waiting === 1 ? '' : 's'}</button>
            <a class="btn ghost" href="#/bankfeed?tab=posted">Posted lines (undo here)</a></div>`;
      }
      case 'review': {
        const g = C.groups(plans);
        if (!g.length) return `<h2>Review</h2>${UI.empty('Nothing waiting. Every bank line in this period is posted or excluded.')}`;
        return `<h2>Review by payee</h2>
          <div class="scroll-x"><table class="data cl-groups" data-testid="cl-groups"><thead><tr><th>Payee</th><th class="num">Lines</th><th class="num">Amount</th><th>Account</th><th>Why</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>
          ${g.map((x, i) => {
            const pick = cs.pick[x.key] !== undefined ? cs.pick[x.key] : (x.top[0] || {}).accountId || '';
            const ans = x.plans.map((q) => q.line.answer).filter(Boolean)[0];
            return `<tr class="cl-g" data-g="${i}"><td><button class="link-btn" data-open="${esc(x.key)}" aria-expanded="${cs.open === x.key}">${esc(x.label)}</button>${ans ? `<span class="cl-ans" title="Client's answer">Client: ${esc(ans)}</span>` : ''}</td>
              <td class="num">${x.plans.length}</td><td class="num">${UI.money(x.total)}</td>
              <td class="cl-acc">${x.top.length > 1 ? `<span class="cl-top">${x.top.map((t) => `<button class="chip" data-top="${esc(t.accountId)}" aria-pressed="${t.accountId === pick}">${esc(b.accountLabel(t.accountId))}${t.n ? ' · ' + t.n : ''}</button>`).join('')}</span>` : ''}
                ${UI.comboHtml('account', 'line', pick, `data-gacc="${i}"`, { label: 'Account for ' + x.label, placeholder: 'Choose account…' })}</td>
              <td class="small muted">${esc(x.why || '')}${x.reason ? `<br>${esc(x.reason)}` : ''}</td>
              <td class="nowrap"><button class="btn small primary" data-accept="${i}" data-testid="cl-accept">Accept</button> <button class="btn small" data-ask="${i}">Ask client</button></td></tr>
              ${cs.open === x.key ? `<tr class="cl-lines"><td colspan="6"><table class="data compact"><tbody>${x.plans.map((q) => `<tr><td class="nowrap">${UI.date(q.line.date)}</td><td>${esc(q.line.description)}</td><td class="num">${UI.money(Math.abs(q.line.amount))}</td><td class="small muted">${esc(q.line.ask ? 'Asked: ' + q.line.ask : '')}</td></tr>`).join('')}</tbody></table></td></tr>` : ''}`;
          }).join('')}</tbody></table></div>`;
      }
      case 'questions': {
        const list = cl.questions.list;
        const nodoc = OB.docs ? OB.docs.missing(b, { from: p.from, to: p.to }) : [];
        return `<h2>Client questions</h2>
          ${nodoc.length ? `<p class="banner warn" data-testid="cl-nodoc">${nodoc.length} expense${nodoc.length === 1 ? '' : 's'} of $75 or more ${nodoc.length === 1 ? 'has' : 'have'} no receipt or bill (${UI.money(U.sum(nodoc, (t) => Math.abs(b.txnTotal(t))), { symbol: true })}). <a href="#/docs?tab=missing&from=${p.from}&to=${p.to}">Ask the client for them in the Doc Center</a>.</p>` : ''}
          ${list.length ? `<div class="form-actions"><button class="btn small" id="cl-qcopy">Copy questions</button><button class="btn small" id="cl-qcsv">Download questions (CSV)</button></div>
          <table class="data" data-testid="cl-questions"><thead><tr><th>Date</th><th>Bank line</th><th class="num">Amount</th><th>Question</th><th>Client's answer</th></tr></thead><tbody>
          ${list.map((l) => `<tr data-line="${esc(l.id)}"><td class="nowrap">${UI.date(l.date)}</td><td>${esc(l.description)}</td><td class="num">${UI.money(Math.abs(l.amount))}</td>
            <td>${l.status === 'review' ? `<input data-q="ask" value="${esc(l.ask)}" aria-label="Question">` : esc(l.ask)}</td>
            <td>${l.status === 'review' ? `<input data-q="answer" value="${esc(l.answer || '')}" placeholder="Answer…" aria-label="Client's answer" data-testid="cl-answer">` : esc(l.answer || '') + ' <span class="badge ok">Posted</span>'}</td></tr>`).join('')}</tbody></table>`
          : UI.empty('No questions. In Review, use Ask client on a payee you need the client to explain.')}`;
      }
      case 'reconcile': return `<h2>Bank reconciliations</h2>${cl.reconcile.accounts.length ? `<table class="data"><thead><tr><th>Account</th><th>Reconciled through</th><th></th></tr></thead><tbody>
        ${cl.reconcile.accounts.map((a) => `<tr><td>${esc(a.name)}</td><td>${a.through ? UI.date(a.through) : '<span class="muted">Never</span>'} ${a.ok ? '<span class="badge ok">Done</span>' : ''}</td>
          <td>${a.ok ? '' : `<a class="btn small" href="#/reconcile?${UI.qs({ account: a.accountId, date: cl.due })}">Reconcile to ${esc(U.fmtDate(cl.due))}</a>`}</td></tr>`).join('')}</tbody></table>`
        : '<p class="muted">No statement accounts in this period.</p>'}
        <p class="muted small">Each account needs a reconciliation through the last month of the period that has ended${cl.due ? ' (' + esc(U.fmtDate(cl.due)) + ')' : ''}.</p>`;
      case 'flux': {
        const f = cl.flux;
        return `<h2>Compare to last year</h2>
          <div class="form-grid cols3"><label class="field"><span>Flag a change of at least ($)</span><input class="money" id="cl-famt" inputmode="decimal" value="${esc(U.fmtPlain(f.amt))}" data-testid="cl-famt"></label>
          <label class="field"><span>and at least (%)</span><input id="cl-fpct" inputmode="decimal" value="${esc(String(f.pct))}"></label></div>
          <p class="muted small">${esc(U.fmtDate(p.from))}–${esc(U.fmtDate(p.to))} against ${esc(U.fmtDate(f.prior.from))}–${esc(U.fmtDate(f.prior.to))}. A flagged line needs a reason before sign-off. The floor is set per client.</p>
          ${f.rows.length ? `<div class="scroll-x"><table class="data" data-testid="cl-flux"><thead><tr><th>Account</th><th class="num">This period</th><th class="num">Last year</th><th class="num">Change</th><th class="num">%</th><th>Reason</th></tr></thead><tbody>
          ${f.rows.map((x) => `<tr class="${x.flag ? 'cl-flag' : ''}"><td><a href="#/report/gl?${UI.qs({ account: x.accountId, range: 'custom', from: p.from, to: p.to })}">${esc(x.label)}</a></td><td class="num">${UI.money(x.cur)}</td><td class="num">${UI.money(x.prior)}</td>
            <td class="num">${UI.money(x.diff)}</td><td class="num">${x.pct === null ? '–' : esc(x.pct.toFixed(1))}</td>
            <td>${x.flag ? `<input data-note="${esc(x.accountId)}" value="${esc(x.note)}" placeholder="Reason for the change…" aria-label="Reason for ${esc(x.label)}">` : `<span class="muted small">${esc(x.note)}</span>`}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No income or expenses in either period.</p>'}`;
      }
      case 'adjust': return `<h2>Adjusting entries</h2><p class="muted small">Last year's journal entries in the same period, dated a year later.</p>
        ${cl.adjust.list.length ? `<table class="data" data-testid="cl-adjust"><thead><tr><th>Date</th><th>Entry</th><th>Accounts</th><th class="num">Last year</th><th></th></tr></thead><tbody>
        ${cl.adjust.list.map((x) => `<tr><td class="nowrap">${UI.date(x.date)}</td><td>${esc(x.memo || x.number || 'Journal entry')}</td><td class="small">${esc(x.accounts.join(', '))}</td><td class="num">${UI.money(x.amount)}</td>
          <td>${x.done ? '<span class="badge ok">Done</span>' : `<a class="btn small" href="#/txn/new?type=journal&copy=${esc(x.txnId)}">Copy</a>`}</td></tr>`).join('')}</tbody></table>`
        : '<p class="muted">Last year had no journal entries in this period.</p>'}`;
      case 'signoff': return `<h2>Sign off</h2>
        ${cl.signedOff ? `<p data-testid="cl-signed">Signed off ${esc(new Date(cl.signedOff.at).toLocaleString())}. Books closed through ${esc(U.fmtDate(cl.signedOff.closingDate))}.</p>`
          : can.ok ? `<p>Everything ties. Signing off locks the books through <strong>${esc(U.fmtDate(p.to))}</strong> (closing date) and records it in the audit trail.</p>
            ${b.company.closingPasswordHash ? '<label class="field"><span>Closing date password</span><input type="password" id="cl-pw" autocomplete="current-password"></label>' : ''}
            <div class="form-actions"><button class="btn primary" id="cl-sign" data-testid="cl-sign">Sign off and lock</button></div>`
          : `<p>Not ready yet:</p><ul data-testid="cl-blockers">${can.why.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>`}`;
    }
    return '';
  }

  function bind(el, b, p, cl, plans) {
    const $ = (s) => el.querySelector(s), on = (s, ev, fn) => { const x = $(s); if (x) x.addEventListener(ev, fn); };
    const re = () => UI.render();
    el.querySelectorAll('[data-step]').forEach((x) => x.addEventListener('click', () => { cs.step = x.dataset.step; re(); }));
    on('#cl-year', 'change', (e) => { cs.year = e.target.value; re(); });
    on('#cl-month', 'change', (e) => { cs.month = e.target.value; re(); });
    on('#cl-test', 'click', (e) => UI.busy(e.target, () => {
      const t = C.selfTest(b, periodOf(b, +cs.year - 1, true), true);   // the whole year before
      cs.test = t; const keep = Object.assign({}, t); delete keep.wrong;
      return C.saveSettings(b, { test: keep }).then(re);
    }));
    on('#cl-auto', 'change', (e) => {
      const want = e.target.checked;
      const go = want && e.target.dataset.warn ? UI.confirm('Post without a clear self-test?', '<p>The self-test for this client is below 20 sure lines or 95% right. VaultBook will post only sure lines to income and expense accounts, each with its reason, and every one can be undone in the bank feed. You remain responsible for the review.</p>', { ok: 'Turn on' }) : Promise.resolve(true);
      go.then((yes) => { if (!yes) { e.target.checked = false; return; } return C.saveSettings(b, { auto: want }).then(re); });
    });
    on('#cl-prep', 'click', (e) => UI.busy(e.target, () => {
      const list = C.prepare(b, { from: p.from, to: p.to, auto: !!C.settings(b).auto });
      return C.post(b, list).then((r) => C.markPrepared(b, p, r).then(() => {
        const left = list.length - r.posted;
        UI.toast(`VaultBook posted ${r.posted} line${r.posted === 1 ? '' : 's'}; ${left} wait for your review.` + (r.failed.length ? ` ${r.failed.length} could not be posted: ${r.failed[0].error}` : ''), r.failed.length ? 'warn' : undefined);
        cs.step = left ? 'review' : 'prepare'; re();
      }));
    }));
    // review
    const groups = cs.step === 'review' ? C.groups(plans) : [];
    el.querySelectorAll('[data-open]').forEach((x) => x.addEventListener('click', () => { cs.open = cs.open === x.dataset.open ? '' : x.dataset.open; re(); }));
    el.querySelectorAll('[data-top]').forEach((x) => x.addEventListener('click', () => { const g = groups[+x.closest('[data-g]').dataset.g]; cs.pick[g.key] = x.dataset.top; re(); }));
    el.querySelectorAll('[data-accept]').forEach((x) => x.addEventListener('click', () => {
      const i = +x.dataset.accept, g = groups[i], h = el.querySelector(`[data-gacc="${i}"]`), acc = (h && h.value) || '';
      if (!acc) { UI.toast('Choose an account for ' + g.label + ' first.', 'warn'); return; }
      UI.busy(x, () => C.accept(b, g.plans, acc).then((r) => { UI.toast(`Posted ${r.posted} line${r.posted === 1 ? '' : 's'} for ${g.label}.` + (r.failed.length ? ' ' + r.failed[0].error : ''), r.failed.length ? 'warn' : undefined); delete cs.pick[g.key]; re(); }));
    }));
    el.querySelectorAll('[data-ask]').forEach((x) => x.addEventListener('click', () => {
      const g = groups[+x.dataset.ask], q = `What were the payments to ${g.label} for (${g.plans.length} line${g.plans.length === 1 ? '' : 's'}, ${U.fmt(g.total, { symbol: true })})?`;
      UI.busy(x, () => g.plans.reduce((pr, pl) => pr.then(() => pl.line.ask ? null : b.updateBankLine(pl.line.id, { ask: q })), Promise.resolve()).then(() => { UI.toast('Question added to Client questions.'); re(); }));
    }));
    // questions
    el.querySelectorAll('[data-q]').forEach((x) => x.addEventListener('change', () => {
      const id = x.closest('[data-line]').dataset.line, ch = {}; ch[x.dataset.q] = x.value;
      b.updateBankLine(id, ch).then(re, (e) => UI.toast(e.message, 'error'));
    }));
    const qtext = () => cl.questions.list.filter((l) => !l.answer).map((l) => `${U.fmtDate(l.date)}  ${U.fmt(Math.abs(l.amount), { symbol: true })}  ${l.description}\n  ${l.ask}`).join('\n\n');
    on('#cl-qcopy', 'click', () => { const t = qtext(); (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => UI.toast('Questions copied.'), () => UI.toast('Could not copy; use Download.', 'warn')); });
    on('#cl-qcsv', 'click', () => {
      const rows = [['Date', 'Bank line', 'Amount', 'Question', 'Answer']].concat(cl.questions.list.map((l) => [l.date, l.description, U.fmtPlain(Math.abs(l.amount)), l.ask, l.answer || '']));
      U.download((b.company.name + ' questions ' + p.from + ' to ' + p.to + '.csv').replace(/[\\/:*?"<>|]/g, ' '), U.toCSV(rows), 'text/csv');
    });
    // flux
    const fl = () => { let amt; try { amt = U.toCents($('#cl-famt').value || 0); } catch (e) { UI.toast('Enter an amount.', 'warn'); return; }
      const pct = +($('#cl-fpct').value || 0); C.saveSettings(b, { flux: { amt: amt, pct: pct } }).then(re); };
    on('#cl-famt', 'change', fl); on('#cl-fpct', 'change', fl);
    el.querySelectorAll('[data-note]').forEach((x) => x.addEventListener('change', () => C.saveNote(b, p, x.dataset.note, x.value).then(re)));
    on('#cl-sign', 'click', (e) => UI.busy(e.target, () => C.signOff(b, p, undefined, ($('#cl-pw') || {}).value).then(() => { UI.toast('Signed off. Books closed through ' + U.fmtDate(p.to) + '.'); re(); }, (er) => UI.toast(er.message, 'error'))));
  }
})();
