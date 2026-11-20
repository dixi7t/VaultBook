/* OfflineBooks US — banking: import, rules, reconciliation, recurring. */
(function () {
  'use strict';
  const U = OB.util, S = OB.schema, UI = OB.ui, I = OB.importer, esc = U.esc;
  const routes = UI.routes;
  const bankFilter = (a) => a.type === 'bank' || a.type === 'cc';

  /* Bank import lives in ui-bankfeed.js (1.20): #/import opens the Bank feed import. */

  /* =============== Rules (v2, 1.23) =============== */
  const DESC_OPS = [['contains', 'contains'], ['notContains', 'does not contain'], ['starts', 'starts with'], ['ends', 'ends with'], ['equals', 'is exactly']];
  const AMT_OPS = [['eq', 'is exactly'], ['lt', 'is less than'], ['gt', 'is more than'], ['between', 'is between']];
  const money = (c) => c ? U.fmtPlain(c) : '';
  UI.ruleSummary = (b, r) => {
    const cs = OB.bankplus.conditions(r).map((c) => c.field === 'amount' ? 'amount ' + (AMT_OPS.find((x) => x[0] === c.op) || AMT_OPS[0])[1] + ' ' + U.fmt(c.value, { symbol: true }) + (c.op === 'between' ? ' and ' + U.fmt(c.value2, { symbol: true }) : '') : 'description ' + (DESC_OPS.find((x) => x[0] === c.op) || DESC_OPS[0])[1] + ' “' + c.value + '”');
    return cs.join(r.match === 'any' ? ' or ' : ' and ');
  };
  UI.editRule = (r) => {
    const b = UI.book; r = r || {};
    const banks = b.sortedAccounts(bankFilter).filter((a) => a.active !== false);
    const st = {
      conds: (OB.bankplus.conditions(r).length ? OB.bankplus.conditions(r) : [{ field: 'desc', op: 'contains', value: r.contains || '' }]).map((c) => Object.assign({}, c, c.field === 'amount' ? { value: money(c.value), value2: money(c.value2) } : {})),
      mode: r.splits && r.splits.length ? 'split' : 'one',
      splits: r.splits && r.splits.length ? r.splits.map((x) => ({ accountId: x.accountId, kind: x.kind, val: x.kind === 'amount' ? money(x.amount) : String(x.pct), memo: x.memo || '' })) : [{ accountId: r.accountId || '', kind: 'pct', val: '50', memo: '' }, { accountId: '', kind: 'pct', val: '50', memo: '' }]
    };
    const condRow = (c, i) => `<div class="ru-cond" data-ci="${i}">
      <select data-c="field" aria-label="Field"><option value="desc">Description</option><option value="amount"${c.field === 'amount' ? ' selected' : ''}>Amount</option></select>
      <select data-c="op" aria-label="Condition">${(c.field === 'amount' ? AMT_OPS : DESC_OPS).map(([k, l]) => `<option value="${k}"${c.op === k ? ' selected' : ''}>${l}</option>`).join('')}</select>
      <input data-c="value" value="${esc(c.value || '')}" aria-label="Value" ${c.field === 'amount' ? 'inputmode="decimal" placeholder="0.00"' : 'placeholder="text in the bank description"'}>
      ${c.field === 'amount' && c.op === 'between' ? `<span class="muted">and</span><input data-c="value2" value="${esc(c.value2 || '')}" inputmode="decimal" placeholder="0.00" aria-label="Second amount">` : ''}
      ${st.conds.length > 1 ? `<button type="button" class="btn icon ghost" data-rm-cond="${i}" aria-label="Remove condition">×</button>` : ''}</div>`;
    const splitRow = (x, i) => `<tr data-si="${i}"><td>${UI.comboHtml('account', 'line', x.accountId, 'data-s="accountId"', { label: 'Split category' })}</td>
      <td><select data-s="kind" aria-label="Percent or amount"><option value="pct">%</option><option value="amount"${x.kind === 'amount' ? ' selected' : ''}>$</option></select></td>
      <td><input class="money" data-s="val" value="${esc(x.val)}" inputmode="decimal" aria-label="Share"></td><td><input data-s="memo" value="${esc(x.memo)}" placeholder="memo" aria-label="Split memo"></td>
      <td>${st.splits.length > 2 ? `<button type="button" class="btn icon ghost" data-rm-split="${i}" aria-label="Remove line">×</button>` : ''}</td></tr>`;
    const draw = (m) => {
      m.querySelector('#ru-conds').innerHTML = st.conds.map(condRow).join('');
      m.querySelector('#ru-one').hidden = st.mode !== 'one';
      m.querySelector('#ru-split').hidden = st.mode !== 'split';
      m.querySelector('#ru-split tbody').innerHTML = st.splits.map(splitRow).join('');
    };
    const read = (m) => {
      m.querySelectorAll('.ru-cond').forEach((row) => { const c = st.conds[+row.dataset.ci]; row.querySelectorAll('[data-c]').forEach((x) => { c[x.dataset.c] = x.value; }); });
      m.querySelectorAll('#ru-split tbody tr').forEach((row) => { const x = st.splits[+row.dataset.si]; row.querySelectorAll('[data-s]').forEach((y) => { x[y.dataset.s] = y.value; }); });
    };
    const input = (m) => {
      read(m);
      const amt = (v) => { const t = String(v || '').replace(/[$,\s]/g, ''); return t && isFinite(+t) ? U.toCents(t) : 0; };
      return { id: r.id, name: m.querySelector('#ru-name').value, match: m.querySelector('#ru-match').value, direction: m.querySelector('#ru-dir').value,
        accountIds: [...m.querySelectorAll('[name=ru-bank]:checked')].map((x) => x.value),
        conditions: st.conds.map((c) => c.field === 'amount' ? { field: 'amount', op: c.op, value: amt(c.value), value2: amt(c.value2) } : { field: 'desc', op: c.op, value: c.value }),
        accountId: st.mode === 'one' ? m.querySelector('#ru-acc').value : '',
        splits: st.mode === 'split' ? st.splits.map((x) => ({ accountId: x.accountId, kind: x.kind, pct: x.kind === 'pct' ? x.val : 0, amount: x.kind === 'amount' ? amt(x.val) : 0, memo: x.memo })) : [],
        contactId: m.querySelector('#ru-con').value, classId: m.querySelector('#ru-cls') ? m.querySelector('#ru-cls').value : '', memo: m.querySelector('#ru-memo').value,
        autoAdd: m.querySelector('#ru-auto').checked, priority: m.querySelector('#ru-pri').value };
    };
    const preview = (m) => {
      const pv = b.rulePreview(input(m)), out = m.querySelector('#ru-preview');
      if (st.mode === 'split') { const pct = st.splits.filter((x) => x.kind === 'pct').reduce((a, x) => a + (+x.val || 0), 0); m.querySelector('#ru-pct').textContent = 'Percent lines: ' + (Math.round(pct * 100) / 100) + '% of what is left after the $ lines' + (Math.abs(pct - 100) > 0.0001 ? ' — must be 100%' : ''); m.querySelector('#ru-pct').classList.toggle('warn-text', Math.abs(pct - 100) > 0.0001); }
      if (pv.error) { out.innerHTML = `<span class="muted">${esc(pv.error)}</span>`; return; }
      out.innerHTML = `<strong>${pv.review.length}</strong> line${pv.review.length === 1 ? '' : 's'} waiting in the Bank feed match${pv.review.length === 1 ? 'es' : ''} this rule${pv.posted ? ` · ${pv.posted} already posted would have matched` : ''}${pv.earlier ? ` · ${pv.earlier} go to a higher-priority rule first` : ''}.` +
        (pv.actionError ? ` <span class="warn-text">${esc(pv.actionError)}</span>` : '') + (pv.review.length ? `<ul class="ru-sample">${pv.review.slice(0, 5).map((l) => `<li><span>${UI.date(l.date)}</span><span>${esc(l.description)}</span><span class="num">${UI.money(l.amount)}</span></li>`).join('')}${pv.review.length > 5 ? `<li class="muted">and ${pv.review.length - 5} more</li>` : ''}</ul>` : '');
    };
    return UI.modal({
      title: r.id ? 'Edit bank rule' : 'New bank rule', wide: true, cls: 'ru-modal',
      html: `<div class="ru-grid">
        <label class="field ru-name"><span>Rule name</span><input id="ru-name" value="${esc(r.name || '')}" placeholder="e.g. Amazon under $100"></label>
        <label class="field"><span>Money</span><select id="ru-dir"><option value="any">In or out</option><option value="out"${r.direction === 'out' ? ' selected' : ''}>Money out</option><option value="in"${r.direction === 'in' ? ' selected' : ''}>Money in</option></select></label>
        <fieldset class="ru-accts"><legend>Bank and card accounts</legend>${banks.map((a) => `<label class="check"><input type="checkbox" name="ru-bank" value="${esc(a.id)}"${(r.accountIds || []).indexOf(a.id) >= 0 ? ' checked' : ''}> ${esc(a.name)}</label>`).join('')}<span class="muted small">None ticked = every account</span></fieldset>
        <section class="ru-sec"><div class="ru-h">When <select id="ru-match" aria-label="All or any"><option value="all">all</option><option value="any"${r.match === 'any' ? ' selected' : ''}>any</option></select> of these are true</div>
          <div id="ru-conds"></div><button type="button" class="btn ghost small" id="ru-addc">+ Add condition</button></section>
        <section class="ru-sec"><div class="ru-h">Then</div>
          <div class="segmented" role="group" aria-label="Category or split"><button type="button" data-mode="one" aria-pressed="${st.mode === 'one'}">One category</button><button type="button" data-mode="split" aria-pressed="${st.mode === 'split'}">Split</button></div>
          <div id="ru-one"><label class="field"><span>Category</span>${UI.comboHtml('account', 'line', r.accountId, 'id="ru-acc"', { label: 'Category' })}</label></div>
          <div id="ru-split" hidden><table class="ru-splits"><thead><tr><th>Category</th><th></th><th class="num">Share</th><th>Memo</th><th></th></tr></thead><tbody></tbody></table>
            <div class="row gap"><button type="button" class="btn ghost small" id="ru-adds">+ Add line</button><span class="small" id="ru-pct"></span></div>
            <p class="muted small">$ lines are taken first; % lines share the rest, and the last % line takes any rounding cent.</p></div>
          <div class="form-grid cols3">
            <label class="field"><span>Payee (optional)</span>${UI.comboHtml('contact', 'any', r.contactId, 'id="ru-con"', { placeholder: '—', label: 'Payee' })}</label>
            ${b.classes && b.classes.length ? `<label class="field"><span>Class (optional)</span><select id="ru-cls"><option value="">—</option>${b.sortedClasses().map((c) => `<option value="${esc(c.id)}"${r.classId === c.id ? ' selected' : ''}>${esc(b.classFullName(c.id))}</option>`).join('')}</select></label>` : ''}
            <label class="field"><span>Memo (optional)</span><input id="ru-memo" value="${esc(r.memo || '')}" placeholder="bank text"></label></div>
          <div class="row gap ru-opts"><label class="check"><input type="checkbox" id="ru-auto"${r.autoAdd ? ' checked' : ''}> Auto-add: post matching lines on import without review</label>
            <label class="field ru-pri"><span>Priority</span><input id="ru-pri" type="number" value="${esc(r.priority || 0)}" title="Higher runs first"></label></div></section>
        <section class="ru-sec ru-pv" aria-live="polite"><div class="ru-h">Preview</div><div id="ru-preview" data-testid="ru-preview"></div></section>
      </div>`,
      onMount: (m) => {
        draw(m); let tm;
        const later = () => { clearTimeout(tm); tm = setTimeout(() => preview(m), 150); };
        m.addEventListener('input', later); m.addEventListener('change', (e) => {
          if (e.target.dataset.c === 'field' || e.target.dataset.c === 'op' || e.target.dataset.s === 'kind') { read(m); const ci = e.target.closest('.ru-cond'); if (ci && e.target.dataset.c === 'field') { const c = st.conds[+ci.dataset.ci]; c.op = c.field === 'amount' ? 'eq' : 'contains'; c.value = ''; } draw(m); }
          later();
        });
        m.addEventListener('click', (e) => {
          const t = e.target.closest('button'); if (!t) return;
          if (t.id === 'ru-addc') { read(m); st.conds.push({ field: 'desc', op: 'contains', value: '' }); draw(m); m.querySelector('.ru-cond:last-child input').focus(); }
          else if (t.dataset.rmCond !== undefined) { read(m); st.conds.splice(+t.dataset.rmCond, 1); draw(m); later(); }
          else if (t.id === 'ru-adds') { read(m); st.splits.push({ accountId: '', kind: 'pct', val: '', memo: '' }); draw(m); }
          else if (t.dataset.rmSplit !== undefined) { read(m); st.splits.splice(+t.dataset.rmSplit, 1); draw(m); later(); }
          else if (t.dataset.mode) { read(m); st.mode = t.dataset.mode; m.querySelectorAll('[data-mode]').forEach((x) => x.setAttribute('aria-pressed', String(x === t))); draw(m); later(); }
        });
        preview(m);
        if (!r.id && r.sample) setTimeout(() => { const v = m.querySelector('.ru-cond input'); if (v) { v.focus(); v.select(); } });
      },
      actions: [{ label: 'Cancel', value: null }, { label: 'Save rule', primary: true, collect: (m) => input(m) }]
    }).then((v) => v ? b.saveRule(v).then((x) => { UI.toast('Rule saved.'); return x; }) : null).catch((e) => { UI.error(e); return null; });
  };
  routes.rules = (el) => {
    const b = UI.book;
    const list = b.rules.filter((r) => !r.deleted).sort((x, y) => (y.priority || 0) - (x.priority || 0));
    const waiting = b.bankLines ? b.bankLines.filter((l) => l.status === 'review') : [];
    const caught = (r) => waiting.filter((l) => OB.bankplus.ruleMatches(r, l.description, l.amount, l.accountId)).length;
    el.innerHTML = UI.page('Bank rules', '<button class="btn primary" id="ru-new" data-key="n">+ New rule</button>', list.length ? `
      <table class="data ru-list"><thead><tr><th>Rule</th><th>When</th><th>Then</th><th>Accounts</th><th class="num">Waiting</th><th class="num">Priority</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>
      ${list.map((r) => `<tr class="${r.active === false ? 'inactive' : ''}"><td><strong>${esc(r.name || r.contains)}</strong>${r.autoAdd ? ' <span class="badge ok" title="Posts on import without review">Auto-add</span>' : ''}</td>
        <td class="wrap">${esc((r.direction === 'in' ? 'Money in · ' : r.direction === 'out' ? 'Money out · ' : '') + UI.ruleSummary(b, r))}</td>
        <td class="wrap">${r.splits && r.splits.length ? 'Split: ' + r.splits.map((x) => esc(b.accountLabel(x.accountId)) + ' ' + (x.kind === 'amount' ? U.fmt(x.amount, { symbol: true }) : x.pct + '%')).join(' + ') : esc(b.accountLabel(r.accountId))}${r.contactId ? ' · ' + esc(UI.contactName(r.contactId)) : ''}</td>
        <td class="wrap">${r.accountIds && r.accountIds.length ? r.accountIds.map((id) => esc((b.accById[id] || {}).name || '')).join(', ') : '<span class="muted">All</span>'}</td>
        <td class="num">${caught(r) || ''}</td><td class="num">${r.priority || 0}</td>
        <td class="actions-cell"><button class="btn ghost small" data-edit="${esc(r.id)}">Edit</button><button class="btn ghost small" data-del="${esc(r.id)}">Delete</button></td></tr>`).join('')}</tbody></table>`
      : UI.empty('Rules categorize bank lines for you: for example, a description containing “COMCAST” goes to Utilities, Amazon under $100 to Office Supplies, rent split between two accounts.', '<button class="btn primary" id="ru-new2">Create your first rule</button>'),
    'Rules suggest the category in the Bank feed; auto-add rules post on import. Lines already in your books are matched first and never added twice by a rule.');
    const nb = () => UI.editRule(null).then((x) => { if (x) UI.render(); });
    el.querySelector('#ru-new').addEventListener('click', nb);
    if (el.querySelector('#ru-new2')) el.querySelector('#ru-new2').addEventListener('click', nb);
    el.querySelectorAll('[data-edit]').forEach((x) => x.addEventListener('click', () => UI.editRule(b.rules.find((r) => r.id === x.dataset.edit)).then((y) => { if (y) UI.render(); })));
    el.querySelectorAll('[data-del]').forEach((x) => x.addEventListener('click', () => UI.confirm('Delete rule', '<p>Delete this rule? Transactions already posted are not changed.</p>', { danger: true, ok: 'Delete rule' }).then((ok) => ok && b.deleteRule(x.dataset.del).then(() => UI.render()))));
  };

  /* =============== Reconciliation =============== */
  routes.reconcile = (el, r) => {
    const b = UI.book, p = r.params;
    const accId = p.account || '';
    const a = b.accById[accId];
    if (!a || !p.date || p.ending === undefined || p.ending === '') {
      const hist = b.reconciliations.filter((x) => !accId || x.accountId === accId).sort((x, y) => x.completedAt < y.completedAt ? 1 : -1);
      const last = a ? hist.find((x) => !x.undone && x.accountId === a.id) : null;
      el.innerHTML = UI.page('Reconcile', '', `
        <section class="card narrow">
          <p>Match your books to a bank or credit card statement. Tick each transaction that appears on the statement until the difference is $0.00.</p>
          <label class="field"><span>Account</span><select id="rc-acc">${UI.accountOptions(accId, (x) => ['bank', 'cc', 'oca', 'ocl', 'ltl'].indexOf(x.type) >= 0)}</select></label>
          ${a ? `<p class="muted">Beginning balance (last reconciled): <strong>${U.fmt(b.reconciledBalance(a.id), { symbol: true })}</strong>${last ? ' as of ' + U.fmtDate(last.statementDate) : ''}</p>` : ''}
          <div class="form-grid"><label class="field"><span>Statement ending date</span><input type="date" id="rc-date" value="${esc(p.date || U.monthEnd(U.addMonths(U.today(), -1)))}"></label>
          <label class="field"><span>Statement ending balance</span><input id="rc-end" inputmode="decimal" value="${esc(p.ending || '')}" placeholder="0.00"></label></div>
          <div class="form-actions"><button class="btn primary" id="rc-start">Start reconciling</button></div>
        </section>
        ${hist.length ? `<section class="card"><h2>History</h2><table class="data compact"><thead><tr><th>Account</th><th>Statement date</th><th class="num">Beginning</th><th class="num">Ending</th><th>Completed</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>
          ${hist.map((x, i) => `<tr class="${x.undone ? 'inactive' : ''}"><td>${esc(b.accountLabel(x.accountId))}</td><td>${UI.date(x.statementDate)}</td><td class="num">${UI.money(x.beginningBalance)}</td><td class="num">${UI.money(x.endingBalance)}</td><td>${esc(new Date(x.completedAt).toLocaleDateString())}${x.undone ? ' <span class="badge void">Undone</span>' : ''}</td>
            <td class="actions-cell"><a class="btn ghost small" href="#/recreport/${esc(x.id)}" data-testid="rc-report-link">Report</a>${x.adjustment ? ' <span class="badge warn" title="Finished with an adjustment">Adj. ' + esc(U.fmt(x.adjustment.amount, { symbol: true })) + '</span>' : ''}${!x.undone && hist.findIndex((y) => !y.undone && y.accountId === x.accountId) === i ? `<button class="btn ghost small" data-undo="${esc(x.accountId)}">Undo last</button>` : ''}</td></tr>`).join('')}</tbody></table></section>` : ''}`);
      el.querySelector('#rc-acc').addEventListener('change', (e) => UI.go('#/reconcile?' + UI.qs({ account: e.target.value })));
      el.querySelector('#rc-start').addEventListener('click', () => {
        const acc = el.querySelector('#rc-acc').value, date = el.querySelector('#rc-date').value, end = el.querySelector('#rc-end').value;
        if (!acc || !U.isDate(date) || end === '') return UI.toast('Choose the account and enter the statement date and ending balance.', 'error');
        try { U.toCents(end); } catch (e) { return UI.toast(e.message, 'error'); }
        UI.go('#/reconcile?' + UI.qs({ account: acc, date, ending: end }));
      });
      el.querySelectorAll('[data-undo]').forEach((x) => x.addEventListener('click', () => UI.confirm('Undo reconciliation', '<p>The transactions from the most recent reconciliation of this account go back to “cleared” so they can be changed. The record stays in history as undone.</p>', { ok: 'Undo reconciliation' })
        .then((ok) => ok && b.undoLastReconciliation(x.dataset.undo).catch((e) => {
          // CPA-19: a reconciliation in the closed period needs the closing date password
          if (e.field !== 'closingPassword') throw e;
          return UI.prompt('Closing date password', e.message, '', { type: 'password', ok: 'Undo reconciliation' }).then((pw) => pw === null ? null : b.undoLastReconciliation(x.dataset.undo, pw));
        }).then((r) => { if (r) { UI.toast('Reconciliation undone.'); UI.render(); } })).catch(UI.error)));
      return;
    }
    const sign = b.normalSign(a);
    const ending = U.toCents(p.ending), stDate = p.date;
    const begin = b.reconciledBalance(a.id);
    const entries = (b.splitIndex()[a.id] || []).filter((e) => e.s.cleared !== 'R' && e.t.date <= stDate);
    const ticked = new Set(entries.filter((e) => e.s.cleared === 'C').map((e) => e.t.id + ':' + e.i));
    const incLabel = a.type === 'cc' ? ['Charges', 'Payments'] : ['Deposits', 'Payments'];
    el.innerHTML = UI.page('Reconcile ' + a.name, `<a class="btn ghost" href="#/reconcile?account=${esc(a.id)}">Change statement</a>`, `
      <div class="recon-summary" id="rc-sum"></div>
      <div class="toolbar recon-find"><input type="search" id="rc-q" placeholder="Find by amount, check no., payee or memo" aria-label="Find a transaction" data-testid="rc-search">
        <label class="check"><input type="checkbox" id="rc-unt"> Only not ticked</label><span class="muted small" id="rc-found"></span></div>
      <div class="recon-cols">
        ${['in', 'out'].map((dir) => {
          const list = entries.filter((e) => (sign * e.s.amount > 0) === (dir === 'in'));
          return `<section class="card"><div class="card-head"><h2>${dir === 'in' ? incLabel[0] : incLabel[1]}</h2><button class="btn ghost small" data-all="${dir}">Tick all</button></div>
          ${list.length ? `<table class="data compact"><thead><tr><th><span class="sr-only">Cleared</span></th><th>Date</th><th>Ref</th><th>Payee / memo</th><th class="num">Amount</th></tr></thead><tbody>
          ${list.map((e) => `<tr data-find="${esc([e.t.number, UI.contactName(e.s.contactId || e.t.contactId), e.s.memo, e.t.memo, UI.typeLabel(e.t.type), U.fmtPlain(Math.abs(e.s.amount)), U.fmt(Math.abs(e.s.amount)), U.fmtDate(e.t.date)].join(' ').toLowerCase())}"><td><input type="checkbox" data-k="${esc(e.t.id + ':' + e.i)}" data-dir="${dir}" ${ticked.has(e.t.id + ':' + e.i) ? 'checked' : ''} aria-label="Cleared"></td><td>${UI.date(e.t.date)}</td><td>${esc(e.t.number)}</td>
            <td class="memo"><a href="#/txn/${esc(e.t.id)}">${esc(UI.contactName(e.s.contactId || e.t.contactId) || e.s.memo || e.t.memo || UI.typeLabel(e.t.type))}</a></td><td class="num">${UI.money(Math.abs(e.s.amount))}</td></tr>`).join('')}
          </tbody></table>` : '<p class="muted">None.</p>'}</section>`;
        }).join('')}
      </div>`);
    const amtOf = new Map(entries.map((e) => [e.t.id + ':' + e.i, sign * e.s.amount]));
    function summary() {
      let ins = 0, outs = 0;
      ticked.forEach((k) => { const v = amtOf.get(k) || 0; if (v > 0) ins += v; else outs += v; });
      const cleared = begin + ins + outs, diff = ending - cleared;
      el.querySelector('#rc-sum').innerHTML = `
        <div><span>Statement ending balance</span><b>${UI.money(ending, { symbol: true })}</b></div>
        <div><span>Beginning balance</span><b>${UI.money(begin)}</b></div>
        <div><span>${incLabel[0]} cleared</span><b>${UI.money(ins)}</b></div>
        <div><span>${incLabel[1]} cleared</span><b>${UI.money(-outs)}</b></div>
        <div><span>Cleared balance</span><b>${UI.money(cleared)}</b></div>
        <div class="${diff === 0 ? 'balanced' : 'unbalanced'}"><span>Difference</span><b>${UI.money(diff, { symbol: true })}</b></div>
        <button class="btn primary" id="rc-finish" ${diff === 0 ? '' : 'disabled'}>Finish now</button>
        ${diff !== 0 ? `<button class="btn" id="rc-adjust" data-testid="rc-adjust" title="Post the difference to ${esc(OB.Book.RECON_DIFF_NAME)} and finish">Finish with adjustment…</button>` : ''}`;
      const adjB = el.querySelector('#rc-adjust');
      if (adjB) adjB.addEventListener('click', () => UI.confirm('Finish with an adjustment',
        `<p>The difference of <strong>${UI.money(diff, { symbol: true })}</strong> is posted as a journal entry on ${esc(U.fmtDate(stDate))} between ${esc(a.name)} and <strong>${esc(OB.Book.RECON_DIFF_NAME)}</strong> (an expense account, created if you don't have one), and the reconciliation is finished.</p>
         <p class="muted">Use this only when you can't find the difference. If you find it later, undo the reconciliation: the adjustment is voided with it.</p>`, { ok: 'Post adjustment and finish' })
        .then((ok) => ok && UI.busy(adjB, () => {
          const refs = [...ticked].map((k) => { const [txnId, i] = k.split(':'); return { txnId, i: +i }; });
          return b.finishReconciliation(a.id, stDate, ending, refs, { adjust: true }).then((rec) => { UI.toast('Reconciliation complete with an adjustment of ' + U.fmt(diff, { symbol: true }) + '.'); UI.go('#/recreport/' + rec.id); });
        })).catch(UI.error));
      el.querySelector('#rc-finish').addEventListener('click', (e) => UI.busy(e.target, () => {
        const refs = [...ticked].map((k) => { const [txnId, i] = k.split(':'); return { txnId, i: +i }; });
        return b.finishReconciliation(a.id, stDate, ending, refs).then((rec) => { UI.toast('Reconciliation complete.'); UI.go('#/recreport/' + rec.id); });
      }).catch(UI.error));
    }
    summary();
    el.querySelectorAll('[data-k]').forEach((cb) => cb.addEventListener('change', () => {
      const k = cb.dataset.k, [txnId, i] = k.split(':');
      if (cb.checked) ticked.add(k); else ticked.delete(k);
      summary();
      b.setCleared(txnId, +i, cb.checked).catch(UI.error); // persists the tick so you can resume later
    }));
    el.querySelectorAll('[data-all]').forEach((btn) => btn.addEventListener('click', () => {
      el.querySelectorAll(`[data-dir="${btn.dataset.all}"]`).forEach((cb) => { if (!cb.checked && !cb.closest('tr').hidden) { cb.checked = true; cb.dispatchEvent(new Event('change')); } });
    }));
    // find: by amount (1234.5, 1,234.50, $12), check number, payee or memo; Enter ticks a single hit
    const q = el.querySelector('#rc-q'), unt = el.querySelector('#rc-unt');
    const find = () => {
      const t = q.value.trim().toLowerCase().replace(/^\$/, ''), rows = [...el.querySelectorAll('tr[data-find]')];
      let n = 0;
      rows.forEach((tr) => { const cb = tr.querySelector('[data-k]'), hit = (!t || tr.dataset.find.indexOf(t) >= 0) && (!unt.checked || !cb.checked); tr.hidden = !hit; if (hit) n++; });
      el.querySelector('#rc-found').textContent = t || unt.checked ? n + ' of ' + rows.length + ' shown' : '';
      el.querySelectorAll('[data-all]').forEach((btn) => { btn.textContent = t || unt.checked ? 'Tick shown' : 'Tick all'; });
      return rows.filter((tr) => !tr.hidden);
    };
    q.addEventListener('input', find); unt.addEventListener('change', find);
    q.addEventListener('keydown', (e) => { if (e.key !== 'Enter') return; e.preventDefault(); const hits = find(); if (hits.length === 1) { const cb = hits[0].querySelector('[data-k]'); cb.checked = !cb.checked; cb.dispatchEvent(new Event('change')); q.select(); } });
  };

  /* =============== Reconciliation report (1.23): frozen at finish, reprintable =============== */
  routes.recreport = (el, r) => {
    const b = UI.book, rep = b.reconReport(r.id), RR = OB.reconReport, M = OB.reportModel;
    if (!rep) { el.innerHTML = UI.page('Reconciliation report', '', UI.empty('This reconciliation was not found.', '<a class="btn" href="#/reconcile">Reconcile</a>')); return; }
    const rec = rep.rec, a = rep.account, view = r.params.view === 'summary' ? 'summary' : 'detail';
    const model = RR.model(b, r.id, { view });
    const adj = rec.adjustment, groups = RR.groups(a);
    const cnt = (list, g) => (list || []).filter((x) => g.sign > 0 ? x.amount > 0 : x.amount < 0).length;
    const clearedTotal = rep.clearedIn + rep.clearedOut, diff = rec.beginningBalance + clearedTotal - rec.endingBalance;
    // screen-only strip: the numbers an accountant checks first
    const glance = `<dl class="rr-glance no-print" data-testid="rr-summary">
        <div><dt>Beginning balance</dt><dd>${UI.money(rec.beginningBalance)}</dd></div>
        <div><dt>Cleared (${rep.cleared.length})</dt><dd>${UI.money(clearedTotal)}</dd><span class="muted small">${groups.map((g) => esc(g.title.toLowerCase()) + ' ' + cnt(rep.cleared, g)).join(' · ')}</span></div>
        <div><dt>Statement ending balance</dt><dd>${UI.money(rec.endingBalance)}</dd><span class="${diff ? 'warn-text' : 'ok-text'} small">${diff ? 'Difference ' + U.fmt(diff, { symbol: true }) : 'Difference 0.00 ✓'}</span></div>
        ${rep.outstanding ? `<div><dt>Uncleared (${rep.outstanding.length})</dt><dd>${UI.money(rep.outstandingIn + rep.outstandingOut)}</dd></div>
        <div><dt>Register balance as of ${esc(U.fmtDate(rec.statementDate))}</dt><dd>${UI.money(rep.registerBalance)}</dd><span class="${rec.endingBalance + rep.outstandingIn + rep.outstandingOut === rep.registerBalance ? 'ok-text' : 'warn-text'} small">${rec.endingBalance + rep.outstandingIn + rep.outstandingOut === rep.registerBalance ? 'Statement + uncleared = register ✓' : 'Statement + uncleared ≠ register'}</span></div>` : ''}
        ${adj ? `<div><dt>Reconciliation adjustment</dt><dd>${UI.money(adj.amount)}</dd><span class="muted small">${esc(OB.Book.RECON_DIFF_NAME)}</span></div>` : ''}
      </dl>`;
    // the report itself, drawn from the same model the PDF and Excel use
    const cellTxt = (row, i) => M.cellText(model, row, i);
    const body = model.rows.map((row) => {
      if (row.kind === 'spacer') return '<tr class="rr-sp" aria-hidden="true"><td colspan="' + (model.columns.length + 1) + '"></td></tr>';
      if (row.kind === 'note') return `<tr class="rr-note"><td colspan="${model.columns.length + 1}">${esc(row.label)}</td></tr>`;
      const cells = row.cells || model.columns.map(() => null);
      let lead = 0; if (model.overflowLabels || model.columns.length === 1) while (lead < cells.length && !model.columns[lead].num && !cellTxt(row, lead)) lead++;
      if (!row.cells) lead = model.columns.length;
      const cls = [row.bold ? 'b' : '', row.kind === 'header' ? 'h' : '', row.kind === 'total' ? 't' : '', row.txnId ? 'click' : ''].filter(Boolean).join(' ');
      const tds = model.columns.slice(lead).map((c, k) => { const i = k + lead, v = cells[i], line = typeof v === 'number' && row.line ? (row.line === 'double' ? ' l2' : ' l1') : '';
        return `<td class="${c.num ? 'num' : ''}${i === 4 && !c.num ? ' clr' : ''}${line}${typeof v === 'number' && v < 0 ? ' neg' : ''}">${esc(cellTxt(row, i))}</td>`; }).join('');
      return `<tr class="${cls}"${row.txnId ? ` data-href="#/txn/${esc(row.txnId)}"` : ''}><td class="rr-lbl" style="padding-left:${0.6 + (row.depth || 0) * 1.1}rem"${lead ? ` colspan="${lead + 1}"` : ''}>${esc(row.label)}</td>${tds}</tr>`;
    }).join('');
    el.innerHTML = `<div class="page report-page"><div class="page-head no-print"><div><a href="#/reconcile?account=${esc(a.id)}" class="back">Reconcile</a><h1>Reconciliation report</h1></div>
      <div class="actions"><nav class="seg" aria-label="Report view"><a href="#/recreport/${esc(rec.id)}" aria-current="${view === 'detail' ? 'page' : 'false'}" data-testid="rr-view-detail">Detail</a><a href="#/recreport/${esc(rec.id)}?view=summary" aria-current="${view === 'summary' ? 'page' : 'false'}" data-testid="rr-view-summary">Summary</a></nav>
        <button class="btn" data-x="csv">CSV</button><button class="btn" data-x="xlsx">Excel</button><button class="btn" data-print data-key="p">Print</button><button class="btn primary" data-x="pdf" data-testid="rr-pdf">Download PDF</button></div></div>
      ${glance}
      <article class="report rr-report rr-${view}" aria-label="${esc(model.lines[1])}" data-testid="rr-report">
        <header class="rr-head"><div class="rr-meta">${esc(model.lines[3] || '')}</div><h2>${esc(model.lines[0])}</h2><h1>${esc(model.lines[1])}</h1><p>${esc(model.lines[2])}</p></header>
        <table class="rr-table" data-testid="rr-table"><thead><tr><th class="rr-lbl">${esc(model.labelHead || '')}</th>${model.columns.map((c, i) => `<th class="${c.num ? 'num' : ''}${i === 4 && !c.num ? ' clr' : ''}">${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>
        <footer class="rr-foot">${model.footer.map((f) => `<p>${esc(f)}</p>`).join('')}</footer>
      </article></div>`;
    UI.bindRowLinks(el);
    el.querySelector('[data-print]').addEventListener('click', () => window.print());
    const fname = 'Reconciliation_' + (view === 'summary' ? 'Summary_' : 'Detail_') + a.name + '_' + rec.statementDate;
    el.querySelectorAll('[data-x]').forEach((x) => x.addEventListener('click', () => {
      if (x.dataset.x === 'csv') return UI.exportMatrix(fname, RR.matrix(model), 'csv');
      UI.exportMatrix(fname, null, x.dataset.x, { model });
    }));
  };

  /* =============== Recurring =============== */
  routes.recurring = (el) => {
    const b = UI.book;
    const list = b.recurring.filter((r) => !r.deleted).sort((x, y) => x.nextDate < y.nextDate ? -1 : 1);
    const due = b.dueRecurring();
    el.innerHTML = UI.page('Recurring transactions', due.length ? `<button class="btn primary" id="rr-all">Post all ${due.length} due</button>` : '', list.length ? `
      <table class="data"><thead><tr><th>Name</th><th>Type</th><th>Frequency</th><th>Next date</th><th>End</th><th class="num">Amount</th><th>Last posted</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>
      ${list.map((r) => {
        const isDue = due.indexOf(r) >= 0;
        const amt = r.template.lines ? U.sum(r.template.lines, (l) => l.amount || 0) : r.template.amount || U.sum(r.template.jlines || [], (l) => l.debit || 0);
        return `<tr class="${r.active ? '' : 'inactive'}"><td>${esc(r.name)}</td><td>${esc(UI.typeLabel(r.template.type))}</td><td>${esc(r.frequency)}</td><td>${UI.date(r.nextDate)} ${isDue ? '<span class="badge warn">Due</span>' : ''}</td><td>${UI.date(r.endDate)}</td><td class="num">${UI.money(amt)}</td><td>${UI.date(r.lastPosted)}</td>
          <td class="actions-cell">${isDue ? `<button class="btn small" data-post="${esc(r.id)}">Post ${U.fmtDate(r.nextDate)}</button>` : ''}${isDue ? `<button class="btn ghost small" data-skip="${esc(r.id)}">Skip</button>` : ''}<button class="btn ghost small" data-edit="${esc(r.id)}">Edit</button><button class="btn ghost small" data-del="${esc(r.id)}">Delete</button></td></tr>`;
      }).join('')}</tbody></table>` : UI.empty('No recurring schedules. Open any saved bill, expense, check, invoice, deposit, transfer or journal entry and choose “Make recurring”.'),
    'Due transactions are never posted silently: you confirm each one here or from the dashboard.');
    const post = (id) => b.postRecurring(id).then((t) => { UI.toast(UI.typeLabel(t.type) + ' posted for ' + U.fmtDate(t.date) + '.'); });
    el.querySelectorAll('[data-post]').forEach((x) => x.addEventListener('click', () => UI.busy(x, () => post(x.dataset.post).then(() => UI.render())).catch(UI.error)));
    if (el.querySelector('#rr-all')) el.querySelector('#rr-all').addEventListener('click', (e) => UI.busy(e.target, () => {
      // post every due occurrence, oldest first, repeating while still due
      const loop = (n) => { const d = b.dueRecurring(); if (!d.length || n > 500) return Promise.resolve(n); return post(d[0].id).then(() => loop(n + 1)); };
      return loop(0).then((n) => { UI.toast(n + ' recurring transactions posted.'); UI.render(); });
    }).catch(UI.error));
    el.querySelectorAll('[data-skip]').forEach((x) => x.addEventListener('click', () => {
      const r = b.recurring.find((y) => y.id === x.dataset.skip);
      b.saveRecurring(Object.assign({}, r, { nextDate: b.advanceDate(r.nextDate, r.frequency) })).then(() => UI.render()).catch(UI.error);
    }));
    el.querySelectorAll('[data-del]').forEach((x) => x.addEventListener('click', () => UI.confirm('Delete schedule', '<p>Stop this recurring schedule? Transactions already posted are kept.</p>', { danger: true, ok: 'Delete schedule' }).then((ok) => ok && b.deleteRecurring(x.dataset.del).then(() => UI.render()))));
    el.querySelectorAll('[data-edit]').forEach((x) => x.addEventListener('click', () => {
      const r = b.recurring.find((y) => y.id === x.dataset.edit);
      UI.modal({
        title: 'Edit schedule',
        html: `<div class="form-grid"><label class="field span2"><span>Name</span><input id="r-name" value="${esc(r.name)}"></label>
          <label class="field"><span>Frequency</span><select id="r-freq">${['weekly', 'monthly', 'quarterly', 'yearly'].map((f) => `<option${f === r.frequency ? ' selected' : ''}>${f}</option>`).join('')}</select></label>
          <label class="field"><span>Next date</span><input type="date" id="r-next" value="${esc(r.nextDate)}"></label>
          <label class="field"><span>End date</span><input type="date" id="r-end" value="${esc(r.endDate)}"></label>
          <label class="check"><input type="checkbox" id="r-act" ${r.active ? 'checked' : ''}> Active</label></div>
          <p class="muted">To change amounts or accounts, open a transaction posted from this schedule, edit it, and make a new schedule from it.</p>`,
        actions: [{ label: 'Cancel', value: null }, { label: 'Save schedule', primary: true, collect: (m) => ({ name: m.querySelector('#r-name').value, frequency: m.querySelector('#r-freq').value, nextDate: m.querySelector('#r-next').value, endDate: m.querySelector('#r-end').value, active: m.querySelector('#r-act').checked }) }]
      }).then((v) => v && b.saveRecurring(Object.assign({}, r, v)).then(() => { UI.toast('Schedule saved.'); UI.render(); })).catch(UI.error);
    }));
  };
})();
