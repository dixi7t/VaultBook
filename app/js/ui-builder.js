/* OfflineBooks US — custom report builder.
 * Build a report from posted transaction lines: pick columns (and their order), filters, grouping with
 * subtotals or a summary, sorting and a title; the preview updates as you change options.
 * Saved builder reports live in the company's "reports" store next to saved standard reports.
 */
(function () {
  'use strict';
  const U = OB.util, S = OB.schema, R = OB.reports, UI = OB.ui, esc = U.esc;
  const MAX_LINES = 3000;
  const DEFAULT = { title: 'Custom report', range: 'fyToDate', basis: '', columns: ['date', 'type', 'number', 'name', 'account', 'memo', 'amount'], groupBy: '', summary: false, sortBy: 'date', sortDir: 'asc',
    accountTypes: [], accountId: '', classId: '', contactId: '', txnTypes: [], text: '', minAmount: '', maxAmount: '', cleared: '' };
  const MONEY_COLS = { debit: 1, credit: 1, amount: 1, balance: 1 };
  const PRESETS = [
    ['Expenses by vendor (detail)', { title: 'Expenses by vendor', accountTypes: ['expense', 'cogs', 'oe'], groupBy: 'name', columns: ['date', 'type', 'number', 'account', 'memo', 'amount'] }],
    ['Income by customer (summary)', { title: 'Income by customer', accountTypes: ['income', 'oi'], groupBy: 'name', summary: true }],
    ['Spending by class', { title: 'Spending by class', accountTypes: ['expense', 'cogs', 'oe'], groupBy: 'class', columns: ['date', 'name', 'account', 'memo', 'amount'] }],
    ['Monthly activity by account type', { title: 'Monthly activity', groupBy: 'month', summary: true }],
    ['Uncleared bank transactions', { title: 'Uncleared bank transactions', accountTypes: ['bank'], cleared: 'U', columns: ['date', 'type', 'number', 'name', 'memo', 'debit', 'credit'] }],
    ['Large transactions (over $1,000)', { title: 'Large transactions', minAmount: '1000', columns: ['date', 'type', 'number', 'name', 'account', 'amount'], sortBy: 'amount', sortDir: 'desc' }]
  ];

  UI.routes.builder = (el, r) => {
    const b = UI.book;
    const saved = r.id ? b.reports.find((x) => x.id === r.id && !x.deleted && x.report === 'builder') : null;
    if (r.id && !saved) { el.innerHTML = UI.page('Report not found', '', UI.empty('This saved report no longer exists.', '<a class="btn" href="#/reports">Reports</a>')); return; }
    const cfg = Object.assign({}, U.clone(DEFAULT), saved ? U.clone(saved.params.cfg || {}) : {});
    if (!cfg.basis) cfg.basis = b.company.basis;
    const colLabel = {}; R.BUILDER_COLUMNS.forEach(([k, l]) => { colLabel[k] = l; });
    const typeChecks = S.ACCOUNT_TYPES.map((t) => `<label class="check"><input type="checkbox" name="atype" value="${t.id}" ${cfg.accountTypes.indexOf(t.id) >= 0 ? 'checked' : ''}> ${esc(t.label)}</label>`).join('');
    const txnChecks = Object.keys(S.TXN_TYPES).map((k) => `<label class="check"><input type="checkbox" name="ttype" value="${k}" ${cfg.txnTypes.indexOf(k) >= 0 ? 'checked' : ''}> ${esc(S.TXN_TYPES[k].label)}</label>`).join('');
    el.innerHTML = `<div class="page fill rb-page">
      <div class="page-head"><div><a href="#/reports" class="back">Reports</a><h1>${esc(saved ? saved.name : 'Custom report builder')}</h1><p class="sub">${saved ? 'Saved custom report' : 'Choose columns, filters and grouping — the preview updates as you go.'}</p></div>
        <div class="actions">${saved ? '' : `<div class="menu-wrap"><button type="button" class="btn" id="rb-presets" aria-haspopup="menu" aria-expanded="false">Start from… ▾</button><div class="menu" role="menu" hidden>${PRESETS.map(([l], i) => `<button type="button" role="menuitem" data-preset="${i}">${esc(l)}</button>`).join('')}</div></div>`}
          <button type="button" class="btn" data-x="csv">CSV</button><button type="button" class="btn" data-x="xlsx" data-key="e">Excel</button><button type="button" class="btn" data-x="pdf">PDF</button><button type="button" class="btn" id="rb-print" data-key="p">Print</button>
          ${saved ? '<button type="button" class="btn" id="rb-saveas">Save as new…</button>' : ''}<button type="button" class="btn primary" id="rb-save" data-key="s">${saved ? 'Save' : 'Save report…'}</button></div></div>
      <div class="rb-layout">
        <form class="rb-side card no-print" id="rb-form" autocomplete="off">
          <label class="field"><span>Report title</span><input name="title" value="${esc(cfg.title)}" maxlength="80"></label>
          <details open><summary>Period and basis</summary>
            <label class="field"><span>Report period</span>${UI.rangeSelect('rb-range', cfg.range)}</label>
            <div class="form-grid"><label class="field"><span>From</span><input type="date" name="from" value="${esc(cfg.from || '')}"></label><label class="field"><span>To</span><input type="date" name="to" value="${esc(cfg.to || '')}"></label></div>
            <label class="field"><span>Accounting method</span><select name="basis"><option value="accrual">Accrual</option><option value="cash"${cfg.basis === 'cash' ? ' selected' : ''}>Cash</option></select></label></details>
          <details open><summary>Columns</summary>
            <ul class="rb-cols" id="rb-cols">${orderCols(cfg.columns).map((k) => `<li data-col="${k}"><label class="check"><input type="checkbox" name="col" value="${k}" ${cfg.columns.indexOf(k) >= 0 ? 'checked' : ''}> ${esc(colLabel[k])}</label>
              <span class="rb-move"><button type="button" class="btn ghost small icon" data-mv="-1" aria-label="Move ${esc(colLabel[k])} up">↑</button><button type="button" class="btn ghost small icon" data-mv="1" aria-label="Move ${esc(colLabel[k])} down">↓</button></span></li>`).join('')}</ul></details>
          <details open><summary>Group and sort</summary>
            <label class="field"><span>Group by</span><select name="groupBy">${R.BUILDER_GROUPS.map(([k, l]) => `<option value="${k}"${cfg.groupBy === k ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
            <label class="check"><input type="checkbox" name="summary" ${cfg.summary ? 'checked' : ''}> Summary only (one line per group)</label>
            <div class="form-grid"><label class="field"><span>Sort by</span><select name="sortBy">${[['date', 'Date'], ['number', 'No.'], ['name', 'Name'], ['account', 'Account'], ['amount', 'Amount'], ['type', 'Type'], ['class', 'Class']].map(([k, l]) => `<option value="${k}"${cfg.sortBy === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
              <label class="field"><span>Order</span><select name="sortDir"><option value="asc">Ascending</option><option value="desc"${cfg.sortDir === 'desc' ? ' selected' : ''}>Descending</option></select></label></div></details>
          <details${hasFilters(cfg) ? ' open' : ''}><summary>Filters</summary>
            <label class="field"><span>Account</span>${UI.comboHtml('account', 'any', cfg.accountId, 'name="accountId"', { placeholder: 'All accounts', label: 'Account' })}</label>
            <fieldset class="cz-types"><legend>Account types <span class="muted small">(none ticked = all)</span></legend>${typeChecks}</fieldset>
            ${b.classes.length ? `<label class="field"><span>Class</span><select name="classId"><option value="">All classes</option><option value="__none"${cfg.classId === '__none' ? ' selected' : ''}>Not specified</option>${UI.classOptions(cfg.classId, { blank: false })}</select></label>` : ''}
            <label class="field"><span>Customer or vendor</span>${UI.comboHtml('contact', 'any', cfg.contactId, 'name="contactId"', { placeholder: 'Anyone', label: 'Customer or vendor' })}</label>
            <fieldset class="cz-types"><legend>Transaction types <span class="muted small">(none ticked = all)</span></legend>${txnChecks}</fieldset>
            <label class="field"><span>Text contains</span><input name="text" value="${esc(cfg.text)}" placeholder="memo, name, number, amount…"></label>
            <div class="form-grid"><label class="field"><span>Amount at least</span><input name="minAmount" inputmode="decimal" value="${esc(cfg.minAmount)}" placeholder="0.00"></label><label class="field"><span>Amount at most</span><input name="maxAmount" inputmode="decimal" value="${esc(cfg.maxAmount)}" placeholder="no limit"></label></div>
            <label class="field"><span>Cleared status</span><select name="cleared">${[['', 'Any'], ['U', 'Uncleared'], ['C', 'Cleared'], ['R', 'Reconciled']].map(([k, l]) => `<option value="${k}"${cfg.cleared === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
            <button type="button" class="btn ghost small" id="rb-clear">Clear filters</button></details>
        </form>
        <article class="report rb-out scroll-area" id="rb-out" tabindex="0" aria-live="polite"></article>
      </div></div>`;

    const form = el.querySelector('#rb-form'), out = el.querySelector('#rb-out');
    const rangeSel = el.querySelector('#rb-range');
    const read = () => {
      const fd = (n) => { const x = form.querySelector(`[name="${n}"]`); return x ? x.value : ''; };
      const c = {
        title: fd('title').trim() || 'Custom report', range: rangeSel.value, from: fd('from'), to: fd('to'), basis: fd('basis'),
        columns: [...form.querySelectorAll('#rb-cols li')].map((li) => li.querySelector('input')).filter((x) => x.checked).map((x) => x.value),
        groupBy: fd('groupBy'), summary: form.querySelector('[name="summary"]').checked, sortBy: fd('sortBy'), sortDir: fd('sortDir'),
        accountTypes: [...form.querySelectorAll('[name="atype"]:checked')].map((x) => x.value), accountId: fd('accountId'), classId: fd('classId'), contactId: fd('contactId'),
        txnTypes: [...form.querySelectorAll('[name="ttype"]:checked')].map((x) => x.value), text: fd('text'), minAmount: fd('minAmount'), maxAmount: fd('maxAmount'), cleared: fd('cleared')
      };
      if (c.range !== 'custom') { const rr = UI.ranges()[c.range]; c.from = rr[1]; c.to = rr[2]; }
      return c;
    };
    const syncRange = () => { if (rangeSel.value !== 'custom') { const rr = UI.ranges()[rangeSel.value]; form.querySelector('[name=from]').value = rr[1]; form.querySelector('[name=to]').value = rr[2]; } };
    syncRange();
    let last = null;
    const run = () => {
      const c = read();
      let res;
      try {
        const money = (v) => { try { return v ? Math.abs(U.toCents(v)) : 0; } catch (e) { return 0; } };
        res = R.builder(b, { from: c.from, to: c.to, basis: c.basis, accountTypes: c.accountTypes, accountIds: c.accountId ? [c.accountId] : null, classId: c.classId, contactId: c.contactId,
          txnTypes: c.txnTypes, text: c.text, minAmount: money(c.minAmount), maxAmount: money(c.maxAmount), cleared: c.cleared, columns: c.columns, groupBy: c.groupBy, summary: c.summary, sortBy: c.sortBy, sortDir: c.sortDir });
      } catch (e) { out.innerHTML = `<div class="banner danger">${esc(e.message)}</div>`; return; }
      last = { c, res };
      out.innerHTML = renderResult(b, c, res, colLabel);
    };
    let tmr = null;
    const soon = () => { clearTimeout(tmr); tmr = setTimeout(run, 120); };
    form.addEventListener('input', soon);
    form.addEventListener('change', (e) => { if (e.target === rangeSel) syncRange(); if (e.target.name === 'from' || e.target.name === 'to') rangeSel.value = 'custom'; soon(); });
    form.addEventListener('submit', (e) => e.preventDefault());
    form.addEventListener('click', (e) => {
      const mv = e.target.closest('[data-mv]');
      if (!mv) return;
      const li = mv.closest('li'), d = +mv.dataset.mv;
      if (d < 0 && li.previousElementSibling) li.parentNode.insertBefore(li, li.previousElementSibling);
      if (d > 0 && li.nextElementSibling) li.parentNode.insertBefore(li.nextElementSibling, li);
      mv.focus(); soon(); tracker.refresh();
    });
    el.querySelector('#rb-clear').addEventListener('click', () => {
      form.querySelectorAll('[name="atype"],[name="ttype"]').forEach((x) => { x.checked = false; });
      ['text', 'minAmount', 'maxAmount'].forEach((n) => { form.querySelector(`[name="${n}"]`).value = ''; });
      form.querySelector('[name="cleared"]').value = '';
      const cs = form.querySelector('[name="classId"]'); if (cs) cs.value = '';
      form.querySelectorAll('.combo').forEach((cb) => { const h = cb.querySelector('input[type=hidden]'), t = cb.querySelector('input:not([type=hidden])'); if (h) h.value = ''; if (t) t.value = ''; });
      run(); tracker.refresh();
    });
    const pb = el.querySelector('#rb-presets');
    if (pb) {
      pb.addEventListener('click', (e) => { e.stopPropagation(); const m = pb.nextElementSibling; m.hidden = !m.hidden; pb.setAttribute('aria-expanded', String(!m.hidden)); });
      pb.nextElementSibling.addEventListener('click', (e) => {
        const x = e.target.closest('[data-preset]'); if (!x) return;
        const pre = Object.assign({}, U.clone(DEFAULT), PRESETS[+x.dataset.preset][1], { basis: read().basis, range: rangeSel.value });
        UI._builderPreset = pre; UI.dirty = false; UI.render();
      });
      document.addEventListener('click', () => { if (pb.isConnected) pb.nextElementSibling.hidden = true; }, { once: true });
    }
    if (UI._builderPreset && !saved) {
      const pre = UI._builderPreset; UI._builderPreset = null;
      form.querySelector('[name=title]').value = pre.title;
      form.querySelector('[name=groupBy]').value = pre.groupBy; form.querySelector('[name=summary]').checked = !!pre.summary;
      form.querySelector('[name=sortBy]').value = pre.sortBy; form.querySelector('[name=sortDir]').value = pre.sortDir;
      form.querySelectorAll('[name="atype"]').forEach((x) => { x.checked = pre.accountTypes.indexOf(x.value) >= 0; });
      form.querySelector('[name=minAmount]').value = pre.minAmount || ''; form.querySelector('[name=cleared]').value = pre.cleared || '';
      const ul = form.querySelector('#rb-cols');
      orderCols(pre.columns).forEach((k) => { const li = ul.querySelector(`[data-col="${k}"]`); ul.appendChild(li); li.querySelector('input').checked = pre.columns.indexOf(k) >= 0; });
      if (pre.accountTypes.length || pre.minAmount || pre.cleared) form.querySelectorAll('details').forEach((d) => { if (d.querySelector('[name=atype]')) d.open = true; });
    }
    run();

    const doSave = (asNew) => {
      const c = read();
      const params = { cfg: Object.assign({}, c, c.range !== 'custom' ? { from: '', to: '' } : {}) };
      if (saved && !asNew) return b.saveReport(Object.assign({}, saved, { params, name: saved.name })).then(() => true);
      return UI.prompt(asNew ? 'Save as new report' : 'Save report', 'Report name', c.title, { ok: 'Save' }).then((name) => {
        if (!name) return false;
        return b.saveReport({ name, report: 'builder', params }).then((x) => { UI.dirty = false; UI.toast('Saved “' + x.name + '” to My reports.'); UI.go('#/builder/' + x.id); return 'nav'; });
      });
    };
    const saveBtn = el.querySelector('#rb-save');
    const submit = () => UI.runSave(saveBtn, () => doSave(false).then((ok) => { if (ok === true) return true; UI.setStatus(UI.dirty ? 'dirty' : 'idle'); return false; }), 'Report saved').then((ok) => { if (ok) tracker.reset(); return ok; });
    const tracker = UI.trackForm(form, { snapshot: () => JSON.stringify(read()), save: submit });
    saveBtn.addEventListener('click', submit);
    const sa = el.querySelector('#rb-saveas'); if (sa) sa.addEventListener('click', () => doSave(true).catch(UI.error));
    el.querySelector('#rb-print').addEventListener('click', () => window.print());
    el.querySelectorAll('[data-x]').forEach((x) => x.addEventListener('click', () => { if (last) UI.exportMatrix(last.c.title.replace(/[^A-Za-z0-9]+/g, '_'), matrix(b, last.c, last.res, colLabel), x.dataset.x, { report: true }); }));
  };

  const hasFilters = (c) => c.accountTypes.length || c.accountId || c.classId || c.contactId || c.txnTypes.length || c.text || c.minAmount || c.maxAmount || c.cleared;
  const orderCols = (chosen) => chosen.concat(R.BUILDER_COLUMNS.map((x) => x[0]).filter((k) => chosen.indexOf(k) < 0));
  const cellText = (l, k) => k === 'date' ? U.fmtDate(l.date) : MONEY_COLS[k] ? l[k] : (l[k] || '');

  function renderResult(b, c, res, colLabel) {
    const cols = c.columns.length ? c.columns : ['date', 'amount'];
    const period = c.range === 'all' ? 'All dates' : U.fmtDate(c.from) + ' – ' + U.fmtDate(c.to);
    let shown = 0;
    const head = `<tr>${cols.map((k) => `<th class="${MONEY_COLS[k] ? 'num' : ''}">${esc(colLabel[k])}</th>`).join('')}</tr>`;
    const line = (l) => `<tr>${cols.map((k) => {
      if (MONEY_COLS[k]) return `<td class="num">${l[k] || k === 'amount' || k === 'balance' ? UI.money(l[k]) : ''}</td>`;
      if (k === 'type') return `<td>${UI.txnLink(l.t, l.type)}</td>`;
      if (k === 'date') return `<td>${UI.date(l.date)}</td>`;
      if (k === 'memo' || k === 'split') return `<td class="memo">${esc(l[k])}</td>`;
      return `<td>${esc(l[k] || '')}</td>`;
    }).join('')}</tr>`;
    const totCells = (t) => cols.map((k, i) => i === 0 ? null : MONEY_COLS[k] && k !== 'balance' ? `<td class="num">${UI.money(t[k])}</td>` : '<td></td>');
    let body = '';
    if (c.summary && c.groupBy) {
      const sc = [['group', R.BUILDER_GROUPS.find((x) => x[0] === c.groupBy)[1]], ['count', 'Lines'], ['debit', 'Debit'], ['credit', 'Credit'], ['amount', 'Amount']];
      body = `<table class="statement sb-table rb-table"><thead><tr>${sc.map(([k, l], i) => `<th class="${i ? 'num' : ''}">${esc(l)}</th>`).join('')}</tr></thead><tbody>
        ${res.groups.map((g) => `<tr class="r-acc"><td class="lbl">${esc(g.label)}</td><td class="num">${g.totals.count}</td><td class="num">${UI.money(g.totals.debit)}</td><td class="num">${UI.money(g.totals.credit)}</td><td class="num">${UI.money(g.totals.amount)}</td></tr>`).join('')}
        <tr class="r-net r-grand"><td class="lbl">Total</td><td class="num">${res.totals.count}</td><td class="num">${UI.money(res.totals.debit, { symbol: true })}</td><td class="num">${UI.money(res.totals.credit, { symbol: true })}</td><td class="num">${UI.money(res.totals.amount, { symbol: true })}</td></tr></tbody></table>`;
    } else {
      res.groups.forEach((g) => {
        if (c.groupBy) body += `<tr class="r-hdr"><td colspan="${cols.length}" class="lbl">${esc(g.label)} <span class="muted small">(${g.totals.count})</span></td></tr>`;
        g.lines.forEach((l) => { if (shown < MAX_LINES) body += line(l); shown++; });
        if (c.groupBy) body += `<tr class="r-tot"><td class="lbl">Total for ${esc(g.label)}</td>${totCells(g.totals).filter((x) => x !== null).join('')}</tr>`;
      });
      body = `<table class="statement sb-table rb-table"><thead>${head}</thead><tbody>${body}
        <tr class="r-net r-grand"><td class="lbl">Total (${res.totals.count.toLocaleString()} lines)</td>${totCells(res.totals).filter((x) => x !== null).join('')}</tr></tbody></table>`;
    }
    const note = shown > MAX_LINES ? `<div class="banner info">Showing the first ${MAX_LINES.toLocaleString()} of ${shown.toLocaleString()} lines. Exports include every line; narrow the filters to see more here.</div>` : '';
    const amtNote = c.columns.indexOf('amount') >= 0 ? '<p class="muted small">Amount is in each account’s normal direction: income, expenses, assets and liabilities increase as positive numbers.</p>' : '';
    return `<header><h2>${esc(b.company.name)}</h2><h1>${esc(c.title)}</h1><p>${esc(period)} · ${c.basis === 'cash' ? 'Cash' : 'Accrual'} basis</p></header>${note}
      ${res.lines.length ? body : UI.empty('No transaction lines match these options.')}${amtNote}`;
  }
  function matrix(b, c, res, colLabel) {
    const cols = c.columns.length ? c.columns : ['date', 'amount'];
    const rows = [[{ v: b.company.name, bold: true }], [{ v: c.title, bold: true }], [(c.range === 'all' ? 'All dates' : U.fmtDate(c.from) + ' – ' + U.fmtDate(c.to)) + ' · ' + c.basis + ' basis'], []];
    if (c.summary && c.groupBy) {
      rows.push(['Group', 'Lines', 'Debit', 'Credit', 'Amount'].map((h) => ({ v: h, bold: true })));
      res.groups.forEach((g) => rows.push([g.label, g.totals.count, UI.m(g.totals.debit), UI.m(g.totals.credit), UI.m(g.totals.amount)]));
      rows.push([{ v: 'Total', bold: true }, res.totals.count, UI.m(res.totals.debit, true), UI.m(res.totals.credit, true), UI.m(res.totals.amount, true)]);
      return rows;
    }
    rows.push(cols.map((k) => ({ v: colLabel[k], bold: true })));
    const tot = (t, label) => [{ v: label, bold: true }].concat(cols.slice(1).map((k) => MONEY_COLS[k] && k !== 'balance' ? UI.m(t[k], true) : ''));
    res.groups.forEach((g) => {
      if (c.groupBy) rows.push([{ v: g.label, bold: true }]);
      g.lines.forEach((l) => rows.push(cols.map((k) => MONEY_COLS[k] ? UI.m(l[k]) : cellText(l, k))));
      if (c.groupBy) rows.push(tot(g.totals, 'Total for ' + g.label));
    });
    rows.push(tot(res.totals, 'Total'));
    return rows;
  }
})();
