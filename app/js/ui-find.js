/* VaultBook — Find (1.27): one screen with three ways in.
 *   All results — one box that reads plain words and field:value, and lists matching transactions,
 *                 customers and vendors, accounts, products and bank feed lines.
 *   Simple      — type, name, period, number, amount (QuickBooks Desktop Find, Simple tab).
 *   Advanced    — any number of conditions, match all or any, any period including all dates;
 *                 saved searches; export. Every result says where it matched.
 * All searching is done by OB.find (js/find.js). The search lives in the address (#/find?...), so Back works.
 */
(function () {
  'use strict';
  const OB = window.OB, UI = OB.ui, U = OB.util, S = OB.schema, F = OB.find, esc = U.esc;
  const K = UI.keys;
  const LIMIT = 500;

  const enc = (o) => encodeURIComponent(JSON.stringify(o));
  const dec = (s) => { try { return JSON.parse(decodeURIComponent(s)); } catch (e) { return null; } };
  const savedKey = () => 'findSaved:' + UI.book.company.id;
  const period = (p) => {
    const r = UI.ranges(), k = p.range || 'all';
    if (k === 'custom') return { range: k, from: p.from || '', to: p.to || '' };
    if (k === 'all' || !r[k]) return { range: 'all', from: '', to: '' };
    return { range: k, from: r[k][1], to: r[k][2] };
  };
  const periodHtml = (id, p) => `<label class="field"><span>Period</span>${UI.rangeSelect(id, p.range || 'all')}</label>
    <span class="fd-custom" ${p.range === 'custom' ? '' : 'hidden'}><label class="field"><span>From</span><input type="date" data-pf value="${esc(p.from || '')}"></label><label class="field"><span>To</span><input type="date" data-pt value="${esc(p.to || '')}"></label></span>`;
  const readPeriod = (box, id) => { const k = box.querySelector('#' + id).value; return k === 'custom' ? { range: k, from: box.querySelector('[data-pf]').value, to: box.querySelector('[data-pt]').value } : { range: k }; };
  const bindPeriod = (box, id) => box.querySelector('#' + id).addEventListener('change', (e) => { box.querySelector('.fd-custom').hidden = e.target.value !== 'custom'; });

  /* ---------- the results table (shared by all three tabs) ---------- */
  function acctOf(b, t) {
    if (t.accountId && b.accById[t.accountId]) return b.accountLabel(t.accountId);
    const ids = [...new Set((t.splits || []).map((s) => s.accountId))];
    return ids.length > 2 ? '-Split-' : ids.length ? b.accountLabel(ids[0]) : '';
  }
  const SORTS = { date: (r) => r.t.date, type: (r) => UI.typeLabel(r.t.type), num: (r) => r.t.number || '', name: (r) => UI.contactName(r.t.contactId), amount: (r) => Math.abs(r.t.total || 0) };
  function table(b, res, sort, base) {
    if (!res.count) return UI.empty('Nothing matches. Try fewer conditions, a wider period, or All dates.');
    let rows = res.rows;
    if (sort && SORTS[sort.replace(/^-/, '')]) {
      const f = SORTS[sort.replace(/^-/, '')], dir = sort[0] === '-' ? -1 : 1;
      rows = rows.slice().sort((x, y) => { const a = f(x), c = f(y); return (a < c ? -1 : a > c ? 1 : 0) * dir; });
    }
    const th = (k, l, cls) => { const cur = (sort || '-date').replace(/^-/, '') === k, desc = (sort || '-date')[0] === '-';
      return `<th${cls ? ` class="${cls}"` : ''} aria-sort="${cur ? (desc ? 'descending' : 'ascending') : 'none'}"><a href="${esc(base('sort', cur && !desc ? '-' + k : k))}" data-testid="fd-sort-${k}">${esc(l)}${cur ? (desc ? ' ▾' : ' ▴') : ''}</a></th>`; };
    const shown = rows.slice(0, LIMIT);
    return `<p class="fd-count" data-testid="fd-count"><b>${res.count}</b> transaction${res.count === 1 ? '' : 's'} · total ${UI.money(res.total, { symbol: true })}${res.count > LIMIT ? ` · showing the first ${LIMIT}; Export has them all` : ''}</p>
      <div class="fd-scroll"><table class="data fd-results" data-testid="fd-results"><thead><tr>${th('date', 'Date')}${th('type', 'Type')}${th('num', 'No.')}${th('name', 'Name')}<th>Account</th><th>Memo · where it matched</th>${th('amount', 'Amount', 'num')}<th class="num">Open</th></tr></thead>
      <tbody>${shown.map((r) => { const t = r.t;
        return `<tr class="click${t.status === 'void' ? ' inactive' : ''}" data-href="#/txn/${esc(t.id)}"><td>${UI.date(t.date)}</td><td>${esc(UI.typeLabel(t.type))}${t.status === 'void' ? ' <span class="badge">Void</span>' : ''}</td><td>${esc(t.number || '')}</td>
          <td>${esc(UI.contactName(t.contactId))}</td><td class="fd-acct">${esc(acctOf(b, t))}</td><td class="fd-memo"><span class="fd-mt">${esc(t.memo || (t.lines || [])[0] && t.lines[0].description || '')}</span>${r.why.length ? `<span class="fd-why">${r.why.slice(0, 4).map((w) => `<span>${esc(w)}</span>`).join('')}${r.why.length > 4 ? `<span>+${r.why.length - 4}</span>` : ''}</span>` : ''}</td>
          <td class="num">${UI.money(t.total || 0)}</td><td class="num">${r.open === null ? '' : UI.money(r.open)}</td></tr>`; }).join('')}</tbody></table></div>`;
  }
  function exportRes(b, res, title) {
    const m = [['Date', 'Type', 'No.', 'Name', 'Account', 'Memo', 'Amount', 'Open balance', 'Where it matched', 'Status']];
    res.rows.forEach((r) => m.push([r.t.date, UI.typeLabel(r.t.type), r.t.number || '', UI.contactName(r.t.contactId), acctOf(b, r.t), r.t.memo || '', (r.t.total || 0) / 100, r.open === null ? '' : r.open / 100, r.why.join('; '), r.t.status]));
    UI.modal({ title: 'Export search results', html: `<p>${res.count} transactions.</p>`, actions: [{ label: 'Cancel', value: null }, { label: 'CSV', value: 'csv' }, { label: 'Excel', value: 'xlsx', primary: true }] })
      .then((f) => { if (f) UI.exportMatrix(title, m, f); });
  }

  /* ---------- tabs ---------- */
  function tabs(cur, p) {
    const q = p.q ? '&q=' + encodeURIComponent(p.q) : '';
    return `<nav class="ct-tabs fd-tabs" role="tablist" aria-label="Find">${[['all', 'All results'], ['simple', 'Simple'], ['adv', 'Advanced']]
      .map(([k, l]) => `<a role="tab" href="#/find?tab=${k}${k === 'all' ? q : ''}" aria-selected="${cur === k}" data-testid="fd-tab-${k}">${l}</a>`).join('')}</nav>`;
  }

  UI.routes.find = (el, r) => {
    const b = UI.book, p = r.params, tab = ['simple', 'adv'].indexOf(p.tab) >= 0 ? p.tab : 'all';
    const base = (k, v) => '#/find?' + UI.qs(Object.assign({}, p, { [k]: v }));
    let body = '', res = null, cr = null;

    if (tab === 'all') {
      const e = F.everything(b, p.q || '');
      cr = e.criteria; res = cr && (cr.conds.length || cr.from || cr.status !== 'posted') ? { rows: e.transactions, count: e.transactions.length, total: U.sum(e.transactions, (x) => x.t.total || 0) } : null;
      const sec = (id, label, n, html) => n ? `<section class="fd-sec" id="fd-${id}" data-testid="fd-sec-${id}"><h2 class="h3">${label} <span class="bf-count">${n}</span></h2>${html}</section>` : '';
      const jump = [['tx', 'Transactions', res ? res.count : 0], ['ct', 'Customers and vendors', e.contacts.length], ['ac', 'Accounts', e.accounts.length], ['it', 'Products and services', e.items.length], ['bl', 'Bank feed lines', e.bankLines.length]].filter((x) => x[2]);
      body = `<form class="fd-bar" id="fd-allf" role="search"><label class="sr-only" for="fd-q">Search all company data</label>
          <input type="search" id="fd-q" value="${esc(p.q || '')}" placeholder="invoices over 5000 from acme may 2026 · memo:&quot;cash paid&quot; · 1162 · $370,074.75" autocomplete="off" data-testid="fd-q">
          <button class="btn primary" type="submit">Search</button></form>
        <p class="muted small fd-hint">Every date is searched unless you name one (<i>this year</i>, <i>last month</i>, <i>may 2026</i>, <i>in 2025</i>, a date). Words to narrow: a type (<i>invoices</i>, <i>checks</i>), a customer or vendor, <i>over</i>/<i>under</i>/<i>between</i> an amount, <i>open</i>, <i>overdue</i>, <i>void</i>, or <code>memo:</code> <code>no:</code> <code>name:</code> <code>account:</code> <code>amount&gt;</code> <code>date:</code>.</p>
        ${p.q ? `<p class="fd-read" data-testid="fd-read">${cr ? esc(F.describe(b, cr)) : ''}${res ? ` <a class="btn small" href="#/find?tab=adv&c=${enc(Object.assign({}, cr, { range: cr.from ? 'custom' : 'all' }))}" data-testid="fd-to-adv">Change in Advanced</a>` : ''}</p>
          ${jump.length ? `<nav class="fd-jump" aria-label="Jump to">${jump.map(([id, l, n]) => `<a href="#fd-${id}" data-jump="fd-${id}">${l} <span class="bf-count">${n}</span></a>`).join('')}</nav>` : `<p class="muted">Nothing found for “${esc(p.q)}”.</p>`}
          ${res && res.count ? sec('tx', 'Transactions', res.count, table(b, res, p.sort, base)) : ''}
          ${sec('ct', 'Customers and vendors', e.contacts.length, `<ul class="fd-list">${e.contacts.map((c) => `<li><a href="#/contact/${esc(c.id)}">${esc(c.name)}</a> <span class="muted small">${esc(c.kind === 'customer' ? 'Customer' : 'Vendor')}${c.email ? ' · ' + esc(c.email) : ''}${c.phone ? ' · ' + esc(c.phone) : ''}</span> <span class="num">${UI.money(b.contactBalance(c.id), { symbol: true })}</span></li>`).join('')}</ul>`)}
          ${sec('ac', 'Accounts', e.accounts.length, `<ul class="fd-list">${e.accounts.map((a) => `<li><a href="#/register/${esc(a.id)}">${esc(b.accountLabel(a.id))}</a> <span class="muted small">${esc(S.TYPE[a.type] ? S.TYPE[a.type].label : a.type)}</span></li>`).join('')}</ul>`)}
          ${sec('it', 'Products and services', e.items.length, `<ul class="fd-list">${e.items.map((i) => `<li><a href="#/items?q=${encodeURIComponent(i.name)}">${esc(i.name)}</a> <span class="muted small">${esc(i.sku || '')} ${esc(i.description || '')}</span></li>`).join('')}</ul>`)}
          ${sec('bl', 'Bank feed lines', e.bankLines.length, `<table class="data"><thead><tr><th>Date</th><th>Bank account</th><th>Bank text</th><th>Status</th><th class="num">Amount</th></tr></thead><tbody>${e.bankLines.slice(0, 200).map((l) => `<tr class="click" data-href="#/bankfeed?account=${esc(l.accountId)}&tab=${esc(l.status === 'review' ? 'review' : l.status)}"><td>${UI.date(l.date)}</td><td>${esc(b.accountLabel(l.accountId))}</td><td class="fd-memo">${esc(l.description)}</td><td>${esc({ review: 'For review', posted: 'Posted', excluded: 'Excluded' }[l.status] || l.status)}</td><td class="num">${UI.money(l.amount)}</td></tr>`).join('')}</tbody></table>`)}` : ''}`;
    } else if (tab === 'simple') {
      const pd = period(p);
      const conds = [];
      if (p.type) conds.push({ field: 'type', op: 'is', ids: [p.type] });
      if (p.name) conds.push({ field: 'name', op: 'is', ids: [p.name] });
      if (p.num) conds.push({ field: 'number', op: 'contains', value: p.num });
      if (p.amt) conds.push({ field: 'amount', op: 'eq', value: p.amt, target: 'either' });
      cr = { conds, from: pd.from, to: pd.to, status: 'posted' };
      const ran = p.go === '1';
      if (ran) res = F.find(b, cr);
      const contacts = b.contacts.filter((c) => c.active !== false).sort((x, y) => x.name.localeCompare(y.name));
      body = `<form class="fd-simple" id="fd-sf" data-testid="fd-simple">
          <label class="field"><span>Transaction type</span><select name="type"><option value="">Any type</option>${Object.keys(S.TXN_TYPES).map((k) => `<option value="${k}"${p.type === k ? ' selected' : ''}>${esc(S.TXN_TYPES[k].label)}</option>`).join('')}</select></label>
          <label class="field"><span>Customer, vendor or payee</span><select name="name"><option value="">Anyone</option>${contacts.map((c) => `<option value="${esc(c.id)}"${p.name === c.id ? ' selected' : ''}>${esc(c.name)} (${c.kind === 'customer' ? 'customer' : 'vendor'})</option>`).join('')}</select></label>
          ${periodHtml('fd-sp', Object.assign({}, p, { range: pd.range }))}
          <label class="field"><span>Number</span><input name="num" value="${esc(p.num || '')}" placeholder="invoice, check or ref no."></label>
          <label class="field"><span>Amount</span><input name="amt" inputmode="decimal" value="${esc(p.amt || '')}" placeholder="0.00"></label>
          <div class="form-actions"><button class="btn primary" type="submit" data-testid="fd-find">Find</button><a class="btn" href="#/find?tab=simple">Reset</a>${res ? '<button type="button" class="btn" id="fd-export">Export</button>' : ''}</div></form>
        ${res ? `<p class="fd-read">${esc(F.describe(b, cr))}</p>${table(b, res, p.sort, base)}` : ''}`;
    } else {
      const c0 = dec(p.c || '') || { match: 'all', conds: [{ field: 'memo', op: 'contains', value: '' }], range: 'all', status: 'posted' };
      if (c0.range && c0.range !== 'custom') { const pd = period(c0); c0.from = pd.from; c0.to = pd.to; }
      cr = c0;
      const ran = p.go === '1' || (p.c && (c0.conds || []).some((c) => c.value || (c.ids && c.ids.length) || ['empty', 'notempty'].indexOf(c.op) >= 0 || F.field(c.field) && F.field(c.field).kind === 'choice'));
      if (ran) res = F.find(b, Object.assign({}, c0, { conds: (c0.conds || []).filter((c) => !(F.field(c.field) && F.field(c.field).kind === 'text' && !c.value && ['empty', 'notempty'].indexOf(c.op) < 0)) }));
      const saved = OB.prefs.get(savedKey()) || [];
      body = `<form class="fd-adv" id="fd-af" data-testid="fd-adv">
          <div class="fd-top">${periodHtml('fd-ap', { range: c0.range || (c0.from || c0.to ? 'custom' : 'all'), from: c0.from, to: c0.to })}
            <label class="field"><span>Status</span><select id="fd-status"><option value="posted">Posted</option><option value="void"${c0.status === 'void' ? ' selected' : ''}>Voided</option><option value="all"${c0.status === 'all' ? ' selected' : ''}>Posted and voided</option></select></label>
            <fieldset class="fd-match"><legend>Show transactions that match</legend><label class="check"><input type="radio" name="fd-m" value="all"${c0.match !== 'any' ? ' checked' : ''}> all conditions</label><label class="check"><input type="radio" name="fd-m" value="any"${c0.match === 'any' ? ' checked' : ''}> any condition</label></fieldset>
            ${saved.length ? `<label class="field"><span>Saved searches</span><select id="fd-saved" data-testid="fd-saved"><option value="">Choose…</option>${saved.map((s, i) => `<option value="${i}">${esc(s.name)}</option>`).join('')}</select></label>` : ''}</div>
          <ol class="fd-conds" id="fd-conds" data-testid="fd-conds">${(c0.conds || []).map((c, i) => condRow(b, c, i)).join('')}</ol>
          <div class="form-actions"><button type="button" class="btn" id="fd-add" data-testid="fd-add">+ Add condition</button><span class="spacer"></span>
            <a class="btn" href="#/find?tab=adv">Reset</a>${res ? '<button type="button" class="btn" id="fd-save" data-testid="fd-save">Save search</button><button type="button" class="btn" id="fd-export" data-testid="fd-export">Export</button>' : ''}<button class="btn primary" type="submit" data-testid="fd-find">Find</button></div></form>
        ${res ? `<p class="fd-read" data-testid="fd-read">${esc(F.describe(b, cr))}</p>${table(b, res, p.sort, base)}` : ''}`;
    }

    el.innerHTML = UI.page('Find', '', `${tabs(tab, p)}${body}`);
    UI.bindRowLinks(el);
    el.querySelectorAll('[data-jump]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); const t = el.querySelector('#' + a.dataset.jump); if (t) { t.scrollIntoView({ block: 'start' }); t.querySelector('a, tr.click') && t.querySelector('a, tr.click').focus(); } }));
    const ex = el.querySelector('#fd-export'); if (ex && res) ex.addEventListener('click', () => exportRes(b, res, 'Find'));

    if (tab === 'all') {
      const f = el.querySelector('#fd-allf'), q = el.querySelector('#fd-q');
      f.addEventListener('submit', (e) => { e.preventDefault(); UI.go('#/find?' + UI.qs({ q: q.value.trim() })); });
      if (!p.q || !res) setTimeout(() => { q.focus(); q.select(); }, 0);   // after the keyboard layer places focus
    } else if (tab === 'simple') {
      const f = el.querySelector('#fd-sf'); bindPeriod(f, 'fd-sp');
      f.addEventListener('submit', (e) => { e.preventDefault(); const pd = readPeriod(f, 'fd-sp');
        UI.go('#/find?' + UI.qs({ tab: 'simple', go: '1', type: f.elements.type.value, name: f.elements.name.value, num: f.elements.num.value.trim(), amt: f.elements.amt.value.trim(), range: pd.range, from: pd.from || '', to: pd.to || '' })); });
      if (!res) setTimeout(() => f.elements.type.focus(), 0);
    } else {
      const f = el.querySelector('#fd-af'), list = el.querySelector('#fd-conds'); bindPeriod(f, 'fd-ap');
      const read = () => { const pd = readPeriod(f, 'fd-ap');
        return { match: f.querySelector('[name=fd-m]:checked').value, status: f.querySelector('#fd-status').value, range: pd.range, from: pd.from || '', to: pd.to || '', conds: [...list.children].map(readRow) }; };
      const run = () => UI.go('#/find?tab=adv&go=1&c=' + enc(read()));
      f.addEventListener('submit', (e) => { e.preventDefault(); run(); });
      el.querySelector('#fd-add').addEventListener('click', () => {
        const cs = read().conds; if (cs.length >= 12) { UI.toast('Twelve conditions at most.'); return; }
        list.insertAdjacentHTML('beforeend', condRow(b, { field: 'amount', op: 'eq', value: '', target: 'total' }, cs.length));
        list.lastElementChild.querySelector('select').focus();
      });
      list.addEventListener('change', (e) => { // a new field or operator redraws that row only
        const li = e.target.closest('li'); if (!li || !(e.target.matches('[data-cf]') || e.target.matches('[data-co]'))) return;
        const c = readRow(li); if (e.target.matches('[data-cf]')) { c.op = ''; c.value = ''; c.value2 = ''; c.ids = []; }
        li.outerHTML = condRow(b, c, [...list.children].indexOf(li));
        const again = list.children[[...list.children].indexOf(li)] || list.lastElementChild; (again.querySelector(e.target.matches('[data-cf]') ? '[data-co]' : '[data-cv], [data-co]') || again).focus();
      });
      list.addEventListener('click', (e) => { const x = e.target.closest('[data-crm]'); if (x) { const li = x.closest('li'); li.remove(); if (!list.children.length) list.insertAdjacentHTML('beforeend', condRow(b, { field: 'text', op: 'contains', value: '' }, 0)); } });
      const sv = el.querySelector('#fd-save');
      if (sv) sv.addEventListener('click', () => UI.prompt('Save search', 'Name for this search', '').then((n) => saveIt(n)));
      const saveIt = (n) => { n = String(n || '').trim(); if (!n) return; const l = (OB.prefs.get(savedKey()) || []).filter((x) => x.name !== n); l.push({ name: n, c: read() }); OB.prefs.set(savedKey(), l.slice(-30)); UI.toast('Saved. Pick it under Saved searches.'); UI.render(); };
      const ss = el.querySelector('#fd-saved');
      if (ss) ss.addEventListener('change', () => { const s = (OB.prefs.get(savedKey()) || [])[+ss.value]; if (s) UI.go('#/find?tab=adv&go=1&c=' + enc(s.c)); });
      if (!res) { const first = list.querySelector('[data-cv]') || list.querySelector('select'); if (first) setTimeout(() => first.focus(), 0); }
    }
  };

  /* one condition row: field, operator, value(s) */
  function condRow(b, c, i) {
    const f = F.field(c.field) || F.field('text'), ops = F.OPS[f.kind], op = ops.some((o) => o[0] === c.op) ? c.op : ops[0][0];
    const fieldSel = `<select data-cf aria-label="Condition ${i + 1}: field">${F.FIELDS.map((x) => `<option value="${x.k}"${x.k === f.k ? ' selected' : ''}>${esc(x.label)}</option>`).join('')}</select>`;
    const opSel = ops.length > 1 ? `<select data-co aria-label="Condition ${i + 1}: operator">${ops.map(([k, l]) => `<option value="${k}"${k === op ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>` : `<input type="hidden" data-co value="${op}"><span class="fd-op">${esc(ops[0][1])}</span>`;
    let val = '';
    if (f.kind === 'num') val = `<input data-cv inputmode="decimal" value="${esc(c.value || '')}" aria-label="Condition ${i + 1}: amount or number" placeholder="${esc(f.hint)}">`;
    else if (f.kind === 'text') val = op === 'empty' || op === 'notempty' ? '' : `<input data-cv value="${esc(c.value || '')}" aria-label="Condition ${i + 1}: text" placeholder="${esc(f.hint || '')}">`;
    else if (f.kind === 'amount') val = `<input data-cv inputmode="decimal" value="${esc(c.value || '')}" aria-label="Condition ${i + 1}: amount" placeholder="0.00">${op === 'between' ? `<span>and</span><input data-cv2 inputmode="decimal" value="${esc(c.value2 || '')}" aria-label="Condition ${i + 1}: second amount" placeholder="0.00">` : ''}
      <select data-ct aria-label="Condition ${i + 1}: which amount"><option value="total"${c.target !== 'line' && c.target !== 'either' ? ' selected' : ''}>transaction total</option><option value="line"${c.target === 'line' ? ' selected' : ''}>any one line</option><option value="either"${c.target === 'either' ? ' selected' : ''}>total or a line</option></select>`;
    else if (f.kind === 'date') val = op === 'empty' ? '' : `<input type="date" data-cv value="${esc(c.value || '')}" aria-label="Condition ${i + 1}: date">${op === 'between' ? `<span>and</span><input type="date" data-cv2 value="${esc(c.value2 || '')}" aria-label="Condition ${i + 1}: second date">` : ''}`;
    else if (f.kind === 'choice') val = `<select data-cv aria-label="Condition ${i + 1}: value">${f.choices.map(([k, l]) => `<option value="${k}"${c.value === k ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
    else {
      const opts = f.list === 'contact' ? b.contacts.slice().sort((x, y) => x.name.localeCompare(y.name)).map((x) => [x.id, x.name + (x.kind === 'vendor' ? ' (vendor)' : '')])
        : f.list === 'account' ? b.accounts.filter((a) => a.active !== false || (c.ids || []).indexOf(a.id) >= 0).map((a) => [a.id, b.accountLabel(a.id)])
        : f.list === 'type' ? Object.keys(S.TXN_TYPES).map((k) => [k, S.TXN_TYPES[k].label])
        : f.list === 'class' ? (b.classes || []).map((x) => [x.id, x.name]) : (b.items || []).map((x) => [x.id, x.name]);
      val = `<select multiple size="${Math.min(5, Math.max(2, opts.length))}" data-cv aria-label="Condition ${i + 1}: choose one or more (Ctrl+click for more)">${opts.map(([k, l]) => `<option value="${esc(k)}"${(c.ids || []).indexOf(k) >= 0 ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
    }
    return `<li class="fd-cond" data-kind="${f.kind}">${i ? '' : ''}${fieldSel}${opSel}<span class="fd-val">${val}</span><button type="button" class="icon-btn" data-crm aria-label="Remove condition ${i + 1}" title="Remove">✕</button></li>`;
  }
  function readRow(li) {
    const g = (s) => li.querySelector(s), f = g('[data-cf]').value, kind = F.field(f).kind, c = { field: f, op: g('[data-co]') ? g('[data-co]').value : '' };
    const v = g('[data-cv]');
    if (kind === 'ref') c.ids = v ? [...v.selectedOptions].map((o) => o.value) : [];
    else if (v) c.value = v.value.trim();
    if (g('[data-cv2]')) c.value2 = g('[data-cv2]').value.trim();
    if (g('[data-ct]')) c.target = g('[data-ct]').value;
    return c;
  }

  /* Ctrl+F: Find, except on screens where Ctrl+F already filters (reports, registers) */
  K.add({ id: 'find', key: 'Ctrl+F', label: 'Find (search all transactions)', group: 'General', ctx: (c) => c !== 'none' && !(UI.reportCtl && UI.reportCtl.hash === location.hash && UI.reportCtl.filter), panel: false, run: () => UI.go('#/find?tab=' + (location.hash.indexOf('#/find') === 0 ? 'adv' : 'all')) });
})();
