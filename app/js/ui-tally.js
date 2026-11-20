/* VaultBook — TallyPrime-style keyboard work (1.22).
 *  - Current date (F2) and current period (Alt+F2), typed in shorthand: june20, 0620, 6/20, 6.20, 06-20, 20.
 *  - Report button panel: F2 Period, Alt+N Auto Column, Alt+C New Column, Ctrl+B Basis of Values,
 *    Alt+F5 Detailed, F12 Configure — on every report that offers the option (pages publish UI.reportCtl).
 *  - Sales Register, Purchase Register and Bank Book (#/vreg/sales|purchase|bank): month-wise summary,
 *    Enter on a month for its vouchers, filters on the side.
 *  - Company list: arrow keys, Enter, type-ahead, Alt+C create, Alt+R restore, Alt+Q create from QuickBooks files, Delete.
 * Nothing here posts or changes transactions.
 */
(function () {
  'use strict';
  const UI = OB.ui, U = OB.util, S = OB.schema, esc = U.esc, K = UI.keys, RG = OB.registers;
  const routes = UI.routes;

  /* ---------- current date and current period ---------- */
  const work = {};   // company id -> working date (this session only, like a fresh TallyPrime start)
  const coId = () => UI.book && UI.book.company.id;
  UI.workDate = () => (UI.book && work[coId()]) || U.today();
  UI.setWorkDate = (d) => { if (!UI.book) return; if (!d || d === U.today()) delete work[coId()]; else work[coId()] = d; };
  UI.period = () => { const p = UI.book && OB.prefs.get('period:' + coId()); return p && U.isDate(p.from) && U.isDate(p.to) && p.from <= p.to ? p : null; };
  UI.setPeriod = (p) => { if (UI.book) OB.prefs.set('period:' + coId(), p && p.from ? { from: p.from, to: p.to } : null); };
  UI.fiscalPeriod = () => { const b = UI.book, fys = U.fiscalYearStart(UI.workDate(), b.company.fiscalYearStartMonth || 1); return { from: fys, to: U.addDays(U.addMonths(fys, 12), -1) }; };
  UI.currentPeriod = () => UI.period() || UI.fiscalPeriod();
  /** Default date range for reports: the period set with Alt+F2, otherwise fiscal year to date. */
  UI.defaultRange = (fallback) => UI.period() ? 'period' : (fallback || 'fyToDate');
  const ranges0 = UI.ranges;
  UI.ranges = () => { const r = ranges0(), p = UI.period(); return p ? Object.assign({ period: ['Current period (Alt+F2)', p.from, p.to] }, r) : r; };

  const longDate = (d) => new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  UI.longDate = longDate;
  const HINT = 'Type it any way: <kbd>june20</kbd> <kbd>0620</kbd> <kbd>6/20</kbd> <kbd>6.20</kbd> <kbd>06-20</kbd> <kbd>6/20/25</kbd>, just the day (<kbd>20</kbd>), <kbd>t</kbd> for today or <kbd>+7</kbd>. A missing year is the current one.';
  /** Live "reads as" line under a typed-date field; returns a reader. */
  UI.bindSmartDate = (input, out, ref) => {
    const read = () => {
      const v = input.value.trim(), d = v ? U.smartDate(v, typeof ref === 'function' ? ref() : (ref || UI.workDate())) : null;
      if (out) { out.textContent = !v ? '' : d ? '→ ' + longDate(d) : 'Not a date yet'; out.classList.toggle('bad', !!v && !d); }
      return d;
    };
    input.addEventListener('input', read);
    input.addEventListener('blur', () => { const d = read(); if (d) input.value = U.fmtDate(d); });
    read();
    return read;
  };
  const field = (id, label, value) => `<label class="field sd-field"><span>${label}</span><input id="${id}" class="smart-date" value="${esc(value ? U.fmtDate(value) : '')}" autocomplete="off" spellcheck="false" aria-describedby="${id}-out"><small id="${id}-out" class="sd-out" aria-live="polite"></small></label>`;

  /** Ask for one date. Resolves 'YYYY-MM-DD' or null. */
  UI.askDate = (o) => UI.modal({
    title: o.title || 'Change date', cls: 'sd-modal',
    html: field('sd-a', o.label || 'Date', o.value) + `<p class="muted small">${HINT}</p>`,
    onMount: (m, close) => {
      const inp = m.querySelector('#sd-a'), read = UI.bindSmartDate(inp, m.querySelector('#sd-a-out'), o.ref);
      setTimeout(() => { inp.focus(); inp.select(); });
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); const d = read(); if (d) close(d); else UI.toast('That is not a date. Try june20, 0620 or 6/20.', 'error'); } });
    },
    actions: [{ label: 'Cancel', value: null }, { label: 'Accept', primary: true, collect: (m) => { const d = U.smartDate(m.querySelector('#sd-a').value, o.ref || UI.workDate()); if (!d) { UI.toast('That is not a date.', 'error'); return false; } return d; } }]
  });
  /** Ask for a From/To period. Resolves { from, to } or null. A "To" typed without a year lands on or after "From". */
  const readTo = (txt, from) => {
    const d = U.smartDate(txt, from || UI.workDate()); if (!d || !from || d >= from) return d;
    const next = U.smartDate(txt, U.addMonths(from, 12)); return next && next >= from && !/\d{4}|\d+[\/\-.]\d+[\/\-.]\d+/.test(txt) ? next : d;
  };
  UI.askPeriod = (o) => UI.modal({
    title: o.title || 'Change period', cls: 'sd-modal',
    html: `<div class="form-grid">${field('sd-f', 'From', o.from)}${field('sd-t', 'To', o.to)}</div>
      ${o.reset ? `<p><button type="button" class="btn ghost small" id="sd-reset">${esc(o.reset)}</button></p>` : ''}<p class="muted small">${HINT}</p>`,
    onMount: (m, close) => {
      const f = m.querySelector('#sd-f'), t = m.querySelector('#sd-t');
      const rf = UI.bindSmartDate(f, m.querySelector('#sd-f-out'));
      const tout = m.querySelector('#sd-t-out');
      const rt = () => { const v = t.value.trim(), d = v ? readTo(v, rf()) : null; tout.textContent = !v ? '' : d ? '→ ' + longDate(d) : 'Not a date yet'; tout.classList.toggle('bad', !!v && !d); return d; };
      t.addEventListener('input', rt); t.addEventListener('blur', () => { const d = rt(); if (d) t.value = U.fmtDate(d); }); f.addEventListener('input', rt); rt();
      const done = () => { const a = rf(), b = rt(); if (!a || !b) return UI.toast('Enter both dates.', 'error'); if (a > b) return UI.toast('"To" is before "From".', 'error'); close({ from: a, to: b }); };
      setTimeout(() => { f.focus(); f.select(); });
      f.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); t.focus(); t.select(); } });
      t.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); done(); } });
      const rs = m.querySelector('#sd-reset'); if (rs) rs.addEventListener('click', () => close({ reset: true }));
      m._done = done;
    },
    actions: [{ label: 'Cancel', value: null }, { label: 'Accept', primary: true, collect: (m) => { m._done(); return false; } }]
  });

  UI.changeWorkDate = () => UI.askDate({ title: 'Change current date (F2)', label: 'Current date', value: UI.workDate(), ref: U.today() }).then((d) => {
    if (!d) return; UI.setWorkDate(d);
    UI.toast('Current date is ' + U.fmtDate(d) + (d === U.today() ? ' (today).' : '. New entries are dated on it until you change it or reopen the company.'));
    UI.render();
  });
  UI.changePeriod = () => {
    const cur = UI.currentPeriod();
    return UI.askPeriod({ title: 'Change current period (Alt+F2)', from: cur.from, to: cur.to, reset: UI.period() ? 'Back to the fiscal year' : '' }).then((p) => {
      if (!p) return;
      if (p.reset) { UI.setPeriod(null); UI.toast('Current period is the fiscal year again.'); }
      else { UI.setPeriod(p); UI.toast('Current period ' + U.fmtDate(p.from) + ' to ' + U.fmtDate(p.to) + '. Reports open on it.'); }
      UI.render();
    });
  };

  /* ---------- a keyboard list for choosing options (Alt+N, Alt+C, Ctrl+B, F4 …) ---------- */
  UI.choose = (o) => UI.modal({
    title: o.title, cls: 'chooser',
    html: `<div class="ch-list" role="group" aria-label="${esc(o.title)}">${o.options.map((x, i) => `${x.group && (i === 0 || o.options[i - 1].group !== x.group) ? `<div class="ch-group">${esc(x.group)}</div>` : ''}<label class="ch-opt"><input type="${o.multi ? 'checkbox' : 'radio'}" name="ch" value="${esc(x.value)}"${x.on ? ' checked' : ''}><span>${esc(x.label)}</span>${x.hint ? `<small class="muted">${esc(x.hint)}</small>` : ''}</label>`).join('')}</div>
      <p class="muted small">${o.multi ? '<kbd>↑</kbd><kbd>↓</kbd> move · <kbd>Space</kbd> tick · <kbd>Enter</kbd> accept' : '<kbd>↑</kbd><kbd>↓</kbd> move · <kbd>Enter</kbd> choose · or type the first letter'}${o.note ? ' · ' + esc(o.note) : ''}</p>`,
    onMount: (m, close) => {
      const ins = [...m.querySelectorAll('input[name=ch]')];
      const val = () => o.multi ? ins.filter((x) => x.checked).map((x) => x.value) : (ins.find((x) => x === document.activeElement) || ins.find((x) => x.checked) || {}).value;
      setTimeout(() => { (ins.find((x) => x.checked) || ins[0]).focus(); });
      m.addEventListener('keydown', (e) => {
        const i = ins.indexOf(document.activeElement); if (i < 0) return;
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const n = ins[(i + (e.key === 'ArrowDown' ? 1 : ins.length - 1)) % ins.length]; n.focus(); if (!o.multi) n.checked = true; }
        else if (e.key === 'Enter') { e.preventDefault(); close(val()); }
        else if (e.key.length === 1 && /\S/.test(e.key) && !e.ctrlKey && !e.altKey && !e.metaKey && e.key !== ' ') {
          const k = e.key.toLowerCase(), j = ins.findIndex((x, n) => n > i && x.nextElementSibling.textContent.trim().toLowerCase().startsWith(k));
          const hit = j >= 0 ? j : ins.findIndex((x) => x.nextElementSibling.textContent.trim().toLowerCase().startsWith(k));
          if (hit >= 0) { e.preventDefault(); ins[hit].focus(); if (!o.multi) ins[hit].checked = true; }
        }
      });
      m._val = val;
    },
    actions: [{ label: 'Cancel', value: null }, { label: 'Accept', primary: true, collect: (m) => m._val() }]
  });

  /* ---------- report button panel ---------- */
  /** Report pages set UI.reportCtl = { hash, period, auto, newcol, basis, detail, configure, vtype, filter, account }. */
  const ctl = () => UI.reportCtl && UI.reportCtl.hash === location.hash ? UI.reportCtl : null;
  const has = (k) => (c) => c !== 'entry' && c !== 'none' && !!(ctl() && ctl()[k]);
  const runPeriod = () => {
    const c = ctl().period;
    if (c.asOf !== undefined) return UI.askDate({ title: 'Report date (F2)', label: 'As of', value: c.asOf }).then((d) => d && c.apply(d));
    return UI.askPeriod({ title: 'Report period (F2)', from: c.from, to: c.to }).then((p) => p && !p.reset && c.apply(p.from, p.to));
  };
  const choice = (key, title, multi) => () => {
    const c = ctl()[key];
    return UI.choose({ title, multi, note: c.note, options: c.options.map((x) => ({ value: x[0], label: x[1], on: multi ? (c.value || []).indexOf(x[0]) >= 0 : c.value === x[0], hint: x[2], group: x[3] })) })
      .then((v) => { if (v === null || v === undefined) return; c.apply(v); });
  };
  // replace the old F2 entries: Date in a voucher, Period on a report, otherwise the current date
  K.list = K.list.filter((d) => d.id !== 'period');
  const dateDef = K.list.find((d) => d.id === 'date');
  K.add({ id: 'rperiod', key: 'F2', label: (c) => ctl() && ctl().period && ctl().period.asOf !== undefined ? 'Date' : 'Period', group: 'Screen', ctx: has('period'), run: runPeriod });
  K.add({ id: 'workdate', key: 'F2', label: 'Date', group: 'Screen', ctx: (c) => c !== 'none' && c !== 'entry' && !(ctl() && ctl().period), run: () => UI.changeWorkDate() });
  K.add({ id: 'rperiod2', key: 'Alt+F2', label: 'Period', group: 'Screen', ctx: has('period'), panel: false, run: runPeriod });
  K.add({ id: 'coperiod', key: 'Alt+F2', label: 'Period', group: 'Screen', ctx: (c) => c !== 'none' && c !== 'entry' && !(ctl() && ctl().period), run: () => UI.changePeriod() });
  if (dateDef) { K.list.splice(K.list.indexOf(dateDef), 1); K.list.push(dateDef); }
  K.add({ id: 'vtype', key: 'F4', label: (c) => (ctl() && ctl().vtype && ctl().vtype.label) || 'Voucher type', group: 'Screen', ctx: has('vtype'), run: choice('vtype', 'Voucher types', true) });
  K.add({ id: 'acct', key: 'F4', label: 'Change account', group: 'Screen', ctx: has('account'), run: () => choice('account', ctl().account.title || 'Account', false)() });
  K.add({ id: 'auto', key: 'Alt+N', label: 'Auto column', group: 'Screen', ctx: has('auto'), run: choice('auto', 'Auto column — show columns by', false) });
  K.add({ id: 'newcol', key: 'Alt+C', label: 'New column', group: 'Screen', ctx: has('newcol'), run: () => { const c = ctl().newcol; return (c.multi === false ? choice('newcol', 'New column — compare with', false) : choice('newcol', 'New column — compare with', true))(); } });
  K.add({ id: 'basis', key: 'Ctrl+B', label: 'Basis of values', group: 'Screen', ctx: has('basis'), run: choice('basis', 'Basis of values', false) });
  K.add({ id: 'rdetail', key: 'Alt+F5', label: (c) => ctl() && ctl().detail && ctl().detail.on ? 'Condensed' : 'Detailed', group: 'Screen', ctx: has('detail'), run: () => ctl().detail.apply() });
  K.add({ id: 'rfilter', key: 'Ctrl+F', label: 'Filter', group: 'Screen', ctx: has('filter'), run: () => ctl().filter() });
  K.add({ id: 'rconfig', key: 'F12', label: 'Configure', group: 'Screen', ctx: has('configure'), run: () => ctl().configure() });
  // a report's own key (F2, F4, Alt+F5, F12 …) wins over the generic shortcut on the same key
  const MINE = new Set(['rperiod', 'workdate', 'rperiod2', 'coperiod', 'vtype', 'acct', 'auto', 'newcol', 'basis', 'rdetail', 'rfilter', 'rconfig']);
  const applies = (d, c) => typeof d.ctx === 'function' ? !!d.ctx(c) : (!d.ctx || d.ctx.indexOf(c) >= 0);
  K.list.filter((d) => !MINE.has(d.id) && K.list.some((n) => MINE.has(n.id) && n.key === d.key)).forEach((d) => {
    const c0 = d.ctx;
    d.ctx = (c) => !K.list.some((n) => MINE.has(n.id) && n.key === d.key && applies(n, c)) && (typeof c0 === 'function' ? !!c0(c) : (!c0 || c0.indexOf(c) >= 0));
  });

  /* ---------- Sales Register, Purchase Register, Bank Book ---------- */
  const TYPE_SETS = {
    sales: ['invoice', 'salesReceipt', 'creditMemo'],
    purchase: ['bill', 'expense', 'check', 'vendorCredit', 'ccCredit'],
    bank: ['deposit', 'payment', 'salesReceipt', 'expense', 'check', 'billPayment', 'transfer', 'journal', 'customerRefund', 'vendorRefund', 'ccCredit']
  };
  const MONTH = (ym) => new Date(ym + '-01T00:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const centsOf = (s) => { const v = String(s || '').replace(/[$,\s]/g, ''); return v && isFinite(+v) ? U.toCents(v) : ''; };

  routes.vreg = (el, r) => {
    const b = UI.book, kind = TYPE_SETS[r.id] ? r.id : 'sales', p = Object.assign({}, r.params);
    const banks = b.sortedAccounts((a) => (a.type === 'bank' || a.type === 'cc') && a.active !== false);
    const cur = UI.currentPeriod(), rg = UI.ranges();
    if (p.range && p.range !== 'custom' && rg[p.range]) { p.from = rg[p.range][1]; p.to = rg[p.range][2]; }
    const from = U.isDate(p.from) ? p.from : cur.from, to = U.isDate(p.to) ? p.to : cur.to;
    const go = (ch) => { const np = Object.assign({}, r.params, ch); Object.keys(np).forEach((k) => { if (np[k] === '' || np[k] === undefined || np[k] === null) delete np[k]; }); delete np.page; UI.go('#/vreg/' + kind + '?' + UI.qs(np)); };
    const title = kind === 'bank' ? (p.acc && b.accById[p.acc] ? b.accountLabel(p.acc) : 'Cash/Bank Summary') : RG.TITLES[kind];
    const types = (p.types || '').split(',').filter(Boolean);
    const opts = { kind, accountId: p.acc, from, to, types, contactId: p.contact, ledgerId: p.ledger, min: centsOf(p.min), max: centsOf(p.max), number: p.no, memo: p.memo, party: p.party, status: p.status, classId: p.class, dir: p.dir };
    const month = /^\d{4}-\d{2}$/.test(p.month || '') ? p.month : '';
    const det = p.det === '1', narr = p.narr === '1', view = month || p.view === 'v' ? 'vouchers' : 'months';
    const filtersOn = ['types', 'contact', 'ledger', 'min', 'max', 'no', 'memo', 'party', 'status', 'class', 'dir'].filter((k) => p[k]).length;
    const sideOpen = !!filtersOn || OB.prefs.get('vregSide') === true;

    // --- Cash/Bank Summary (no account chosen)
    if (kind === 'bank' && !(p.acc && b.accById[p.acc])) {
      const rows = banks.map((a) => { const x = RG.build(b, { kind: 'bank', accountId: a.id, from, to }); return { a, x }; });
      el.innerHTML = page(`<table class="statement vr-table" data-testid="vr-summary"><thead><tr><th>Particulars</th><th class="num">Opening</th><th class="num">Debit</th><th class="num">Credit</th><th class="num">Closing balance</th></tr></thead><tbody>
        ${rows.map(({ a, x }) => `<tr class="click" data-href="#/vreg/bank?${esc(UI.qs({ acc: a.id, from: p.from, to: p.to, range: p.range }))}"><td><a href="#/vreg/bank?${esc(UI.qs({ acc: a.id, from: p.from, to: p.to, range: p.range }))}">${esc(b.accountLabel(a.id))}</a></td><td class="num">${esc(RG.drcr(x.opening))}</td><td class="num">${UI.money(x.debit)}</td><td class="num">${UI.money(x.credit)}</td><td class="num">${esc(RG.drcr(x.closing))}</td></tr>`).join('')}
        <tr class="grand"><td>Grand total</td><td></td><td class="num">${UI.money(U.sum(rows, (y) => y.x.debit))}</td><td class="num">${UI.money(U.sum(rows, (y) => y.x.credit))}</td><td></td></tr></tbody></table>
        ${rows.length ? '' : UI.empty('No bank or credit card accounts yet.')}`, '');
      bindCommon(null);
      return;
    }

    let rep;
    try { rep = RG.build(b, month ? Object.assign({}, opts, { from: month + '-01' < from ? from : month + '-01', to: U.monthEnd(month + '-01') > to ? to : U.monthEnd(month + '-01') }) : opts); }
    catch (e) { el.innerHTML = UI.page(title, '', `<div class="banner danger">${esc(e.message)}</div>`); return; }
    const showBal = kind === 'bank';
    let body;
    if (view === 'months') {
      body = `<table class="statement vr-table" data-testid="vr-months"><thead><tr><th>Particulars</th>${filtersOn ? '<th class="num">Vouchers</th>' : ''}<th class="num">Debit</th><th class="num">Credit</th><th class="num">Closing balance</th></tr></thead><tbody>
        ${kind === 'bank' ? `<tr class="r-open"><td>Opening balance</td>${filtersOn ? '<td></td>' : ''}<td></td><td></td><td class="num">${esc(RG.drcr(rep.opening))}</td></tr>` : ''}
        ${rep.months.map((m) => { const h = '#/vreg/' + kind + '?' + UI.qs(Object.assign({}, r.params, { month: m.month, page: undefined })); return `<tr class="click" data-href="${esc(h)}"><td><a href="${esc(h)}">${esc(MONTH(m.month))}</a></td>${filtersOn ? `<td class="num">${m.count || ''}</td>` : ''}<td class="num">${m.debit ? UI.money(m.debit) : ''}</td><td class="num">${m.credit ? UI.money(m.credit) : ''}</td><td class="num">${esc(RG.drcr(m.closing))}</td></tr>`; }).join('')}
        <tr class="grand"><td>Grand total</td>${filtersOn ? `<td class="num">${rep.vouchers.length}</td>` : ''}<td class="num">${UI.money(rep.debit)}</td><td class="num">${UI.money(rep.credit)}</td><td class="num">${esc(RG.drcr(rep.closing))}</td></tr></tbody></table>
        ${kind === 'bank' ? '' : monthChart(rep)}`;
    } else {
      const pg = +p.page || 0, size = 250, list = rep.vouchers.slice(pg * size, pg * size + size);
      if (!rep.vouchers.length) body = `<div data-testid="vr-vouchers">${UI.empty(filtersOn ? 'No vouchers match these filters in this period.' : 'No vouchers in this period.', filtersOn ? '<button class="btn" data-clearf>Clear filters</button>' : '<button class="btn" data-allperiod>Show all dates</button>')}</div>`;
      else body = `<table class="statement vr-table${det ? ' vr-det' : ''}" data-testid="vr-vouchers"><thead><tr><th>Date</th><th>Particulars</th><th>Vch type</th><th>Vch no.</th><th class="num">Debit</th><th class="num">Credit</th>${showBal ? '<th class="num">Balance</th>' : kind !== 'bank' ? '<th class="num">Open</th>' : ''}</tr></thead><tbody>
        ${kind === 'bank' ? `<tr class="r-open"><td></td><td>Opening balance</td><td></td><td></td><td></td><td></td><td class="num">${esc(RG.drcr(rep.opening))}</td></tr>` : ''}
        ${list.map((v) => `<tr class="click" data-href="#/txn/${esc(v.t.id)}"><td>${UI.date(v.date)}</td><td><a href="#/txn/${esc(v.t.id)}">${esc(v.party || '—')}</a></td><td>${esc(UI.typeLabel(v.type))}</td><td>${esc(v.number)}</td><td class="num">${v.debit ? UI.money(v.debit) : ''}</td><td class="num">${v.credit ? UI.money(v.credit) : ''}</td>${showBal ? `<td class="num">${esc(RG.drcr(v.balance))}</td>` : `<td class="num">${v.open ? UI.money(v.open) : ''}</td>`}</tr>
          ${det ? v.lines.map((l) => `<tr class="vr-line"><td></td><td colspan="3">${esc(l.account)}${l.memo ? ' <span class="muted">— ' + esc(l.memo) + '</span>' : ''}</td><td class="num">${l.amount > 0 ? UI.money(l.amount) : ''}</td><td class="num">${l.amount < 0 ? UI.money(-l.amount) : ''}</td><td></td></tr>`).join('') : ''}
          ${narr && v.memo ? `<tr class="vr-line vr-narr"><td></td><td colspan="6"><em>${esc(v.memo)}</em></td></tr>` : ''}`).join('')}
        <tr class="grand"><td></td><td>Total (${rep.vouchers.length} voucher${rep.vouchers.length === 1 ? '' : 's'})</td><td></td><td></td><td class="num">${UI.money(rep.debit)}</td><td class="num">${UI.money(rep.credit)}</td><td class="num">${showBal ? esc(RG.drcr(rep.closing)) : ''}</td></tr></tbody></table>
        ${UI.pager(rep.vouchers.length, pg, size, (n) => UI.go('#/vreg/' + kind + '?' + UI.qs(Object.assign({}, r.params, { page: n }))))}`;
    }
    el.innerHTML = page(body, filterPanel());
    bindCommon(rep);

    /** Month-wise bars under the table: net sales (credit less debit) or net purchases; each bar opens its month. */
    function monthChart(rp) {
      const net = (m) => kind === 'sales' ? m.credit - m.debit : m.debit - m.credit;
      const max = Math.max(0, ...rp.months.map(net));
      if (!max) return '';
      const what = kind === 'sales' ? 'Sales' : 'Purchases';
      return `<figure class="vr-chart" data-testid="vr-chart"><figcaption>${what} by month</figcaption><div class="vr-bars">${rp.months.map((m) => {
        const v = Math.max(0, net(m)), h = '#/vreg/' + kind + '?' + UI.qs(Object.assign({}, r.params, { month: m.month, page: undefined }));
        return `<a class="vr-bar" href="${esc(h)}" aria-label="${esc(MONTH(m.month) + ' ' + what.toLowerCase() + ' ' + U.fmt(v, { symbol: true }))}" title="${esc(MONTH(m.month) + ': ' + U.fmt(v, { symbol: true }))}"><span class="vr-bv">${v ? esc(short(v)) : ''}</span><i style="height:${Math.round(v / max * 100)}%"></i><span class="vr-bl">${esc(MONTH(m.month).slice(0, 3))}</span></a>`;
      }).join('')}</div></figure>`;
    }
    function short(c) { const d = c / 100; return d >= 1e6 ? (d / 1e6).toFixed(d >= 1e7 ? 0 : 1) + 'M' : d >= 1e3 ? Math.round(d / 1e3) + 'k' : String(Math.round(d)); }
    function page(main, side) {
      const per = month ? MONTH(month) : p.range === 'all' ? 'All dates' : U.fmtDate(from) + ' to ' + U.fmtDate(to);
      return `<div class="page vr-page fill">
        <div class="page-head no-print"><div>${kind === 'bank' && p.acc ? `<a href="#/vreg/bank?${esc(UI.qs({ from: p.from, to: p.to, range: p.range }))}" class="back">Cash/Bank Summary</a>` : '<a href="#/gateway?m=reports" class="back">Display More Reports</a>'}<h1>${esc(title)}</h1></div>
          <div class="actions">${side ? `<button class="btn${sideOpen ? ' on' : ''}" id="vr-side-t" aria-expanded="${sideOpen}" aria-controls="vr-side" title="Period, show and filters (Ctrl+F)" data-testid="vr-options">Filters and options${filtersOn ? ` <span class="st-badge">${filtersOn}</span>` : ''}</button>` : ''}<button class="btn" data-x="csv">CSV</button><button class="btn" data-x="xlsx">Excel</button><button class="btn" data-print>Print</button></div></div>
        <div class="vr-grid${side && sideOpen ? '' : ' no-side'}"><article class="report vr-report scroll-area" tabindex="-1" aria-label="${esc(title)}">
          <header><h2>${esc(b.company.name)}</h2><h1>${esc(title)}</h1><p>${esc(per)}${filtersOn ? ' · filtered' : ''}${month ? ' · <a href="#" data-allmonths>All months</a>' : ''}</p></header>${main}</article>
          ${side}</div></div>`;
    }
    function filterPanel() {
      const sel = (id, list, v) => `<select id="${id}">${list.map(([k, l]) => `<option value="${esc(k)}"${(v || '') === k ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
      const contactKind = kind === 'sales' ? 'customer' : kind === 'purchase' ? 'vendor' : '';
      const parties = b.contacts.filter((c) => !contactKind || c.kind === contactKind).sort((x, y) => b.contactLabel(x.id).localeCompare(b.contactLabel(y.id)));
      const ledgers = b.sortedAccounts((a) => a.active !== false && a.id !== p.acc);
      const statusList = kind === 'bank' ? [['', 'All'], ['cleared', 'Cleared'], ['uncleared', 'Not cleared'], ['reconciled', 'Reconciled']] : [['', 'All'], ['open', 'Unpaid (open)'], ['paid', 'Paid'], ['overdue', 'Overdue']];
      const tset = TYPE_SETS[kind];
      return `<aside class="vr-side no-print" id="vr-side" aria-label="Filters"${sideOpen ? '' : ' hidden'} data-testid="vr-filters"><form id="vr-f" autocomplete="off">
        <div class="vr-sh">Period <kbd>F2</kbd></div>
        ${UI.rangeSelect('vr-range', p.range || (p.from ? 'custom' : UI.period() ? 'period' : 'thisFY'))}
        <div class="vr-2"><label>From<input id="vr-from" class="smart-date" value="${esc(p.range === 'all' ? '' : U.fmtDate(from))}" placeholder="first entry"></label><label>To<input id="vr-to" class="smart-date" value="${esc(p.range === 'all' ? '' : U.fmtDate(to))}" placeholder="last entry"></label></div>
        ${kind === 'bank' ? `<div class="vr-sh">Account <kbd>F4</kbd></div>${sel('vr-acc', banks.map((a) => [a.id, b.accountLabel(a.id)]), p.acc)}` : ''}
        <div class="vr-sh">Show</div>
        <div class="seg" role="group" aria-label="View"><button type="button" data-view="m" aria-pressed="${view === 'months'}">Month-wise</button><button type="button" data-view="v" aria-pressed="${view === 'vouchers'}">Vouchers</button></div>
        <label class="check"><input type="checkbox" id="vr-det"${det ? ' checked' : ''}> Detailed (lines) <kbd>Alt+F5</kbd></label>
        <label class="check"><input type="checkbox" id="vr-narr"${narr ? ' checked' : ''}> Narration</label>
        <div class="vr-sh">Filters <kbd>Ctrl+F</kbd>${filtersOn ? ' <button type="button" class="btn ghost small" id="vr-clear">Clear</button>' : ''}</div>
        <fieldset class="vr-types"><legend>Voucher type</legend>${tset.map((t) => `<label class="check"><input type="checkbox" name="vr-t" value="${t}"${!types.length || types.indexOf(t) >= 0 ? ' checked' : ''}> ${esc(UI.typeLabel(t))}</label>`).join('')}</fieldset>
        <label>${kind === 'sales' ? 'Customer' : kind === 'purchase' ? 'Vendor' : 'Party'}${sel('vr-contact', [['', 'All']].concat(parties.map((c) => [c.id, b.contactLabel(c.id)])), p.contact)}</label>
        <label>Name contains<input id="vr-party" value="${esc(p.party || '')}" placeholder="any part of the name"></label>
        <label>Ledger (account on the voucher)${sel('vr-ledger', [['', 'Any account']].concat(ledgers.map((a) => [a.id, b.accountLabel(a.id)])), p.ledger)}</label>
        <div class="vr-2"><label>Amount from<input id="vr-min" inputmode="decimal" value="${esc(p.min || '')}"></label><label>to<input id="vr-max" inputmode="decimal" value="${esc(p.max || '')}"></label></div>
        <label>Voucher no. contains<input id="vr-no" value="${esc(p.no || '')}"></label>
        <label>Narration / memo contains<input id="vr-memo" value="${esc(p.memo || '')}"></label>
        <label>Status${sel('vr-status', statusList, p.status)}</label>
        ${kind === 'bank' ? `<label>Direction${sel('vr-dir', [['', 'Money in and out'], ['in', 'Money in (debit)'], ['out', 'Money out (credit)']], p.dir)}</label>` : ''}
        ${b.classes && b.classes.length ? `<label>Class${sel('vr-class', [['', 'All'], ['__none', 'Not specified']].concat(b.sortedClasses().map((c) => [c.id, b.classFullName(c.id)])), p.class)}</label>` : ''}
      </form></aside>`;
    }
    function bindCommon(rep) {
      UI.bindRowLinks(el);
      const pb = el.querySelector('[data-print]'); if (pb) pb.addEventListener('click', () => window.print());
      const cf = el.querySelector('[data-clearf]'); if (cf) cf.addEventListener('click', () => go({ types: '', contact: '', ledger: '', min: '', max: '', no: '', memo: '', party: '', status: '', class: '', dir: '' }));
      const ap = el.querySelector('[data-allperiod]'); if (ap) ap.addEventListener('click', () => go({ range: 'all', from: '', to: '', month: '' }));
      const am = el.querySelector('[data-allmonths]'); if (am) am.addEventListener('click', (e) => { e.preventDefault(); go({ month: '' }); });
      el.querySelectorAll('[data-x]').forEach((x) => x.addEventListener('click', () => {
        const m = [[{ v: b.company.name, bold: true }], [{ v: title, bold: true }], [U.fmtDate(from) + ' to ' + U.fmtDate(to)], []];
        if (!rep) [...el.querySelectorAll('.vr-table tr')].forEach((tr) => m.push([...tr.cells].map((c) => c.textContent.trim())));
        else if (view === 'months') { m.push(['Particulars', 'Debit', 'Credit', 'Closing balance']); rep.months.forEach((mm) => m.push([MONTH(mm.month), UI.m(mm.debit), UI.m(mm.credit), RG.drcr(mm.closing)])); m.push(['Grand total', UI.m(rep.debit), UI.m(rep.credit), RG.drcr(rep.closing)]); }
        else { m.push(['Date', 'Particulars', 'Vch type', 'Vch no.', 'Debit', 'Credit', 'Balance', 'Narration']); rep.vouchers.forEach((v) => m.push([U.fmtDate(v.date), v.party, UI.typeLabel(v.type), v.number, v.debit ? UI.m(v.debit) : '', v.credit ? UI.m(v.credit) : '', showBal ? RG.drcr(v.balance) : '', v.memo])); }
        UI.exportMatrix(title.replace(/[^A-Za-z0-9]+/g, '_'), m, x.dataset.x, { report: true });
      }));
      const f = el.querySelector('#vr-f');
      const applyPeriod = (a, z) => go({ range: 'custom', from: a, to: z, month: '' });
      UI.reportCtl = { hash: location.hash,
        period: { from, to, apply: applyPeriod },
        detail: rep && view === 'vouchers' ? { on: det, apply: () => go({ det: det ? '' : '1' }) } : rep ? { on: false, apply: () => go({ view: 'v', det: '1' }) } : null,
        vtype: rep ? { label: 'Voucher type', value: types.length ? types : TYPE_SETS[kind].slice(), options: TYPE_SETS[kind].map((t) => [t, UI.typeLabel(t)]), apply: (list) => go({ types: list.length === TYPE_SETS[kind].length ? '' : list.join(',') }) } : null,
        account: kind === 'bank' && banks.length ? { title: 'Bank or card account', value: p.acc || '', options: banks.map((a) => [a.id, b.accountLabel(a.id)]), apply: (v) => go({ acc: v, month: '' }) } : null,
        filter: f ? () => { if (!sideOpen) { OB.prefs.set('vregSide', true); UI.render(); } const x = el.querySelector('#vr-contact'); if (x) x.focus(); } : null,
        configure: f ? () => UI.choose({ title: 'Configure', multi: true, options: [{ value: 'det', label: 'Show the lines of each voucher (detailed)', on: det }, { value: 'narr', label: 'Show narration', on: narr }, { value: 'v', label: 'Show all vouchers instead of month-wise', on: view === 'vouchers' && !month }] })
          .then((v) => { if (v) go({ det: v.indexOf('det') >= 0 ? '1' : '', narr: v.indexOf('narr') >= 0 ? '1' : '', view: v.indexOf('v') >= 0 ? 'v' : '', month: v.indexOf('v') >= 0 ? '' : p.month }); }) : null };
      if (kind === 'bank' && !rep) {
        UI.reportCtl.account = banks.length ? { value: '', options: banks.map((a) => [a.id, b.accountLabel(a.id)]), apply: (v) => go({ acc: v }) } : null;
      }
      const st = el.querySelector('#vr-side-t');
      if (st) st.addEventListener('click', () => { OB.prefs.set('vregSide', !sideOpen); UI.render(); const t = el.querySelector('#vr-side-t'); if (t) t.focus(); });
      if (!f) return;
      const val = (id) => { const x = f.querySelector(id); return x ? x.value : ''; };
      const rangeSel = f.querySelector('#vr-range');
      rangeSel.addEventListener('change', () => { if (rangeSel.value !== 'custom') go({ range: rangeSel.value, from: '', to: '', month: '' }); });
      const rf = UI.bindSmartDate(f.querySelector('#vr-from'), null), rt = UI.bindSmartDate(f.querySelector('#vr-to'), null, () => rf() || from);
      ['#vr-from', '#vr-to'].forEach((id) => U.dateCommit(f.querySelector(id), () => {}, () => { const a = rf(), z = rt(); if (a && z && a <= z) applyPeriod(a, z); else UI.toast('Enter a valid From and To date.', 'error'); }));   // never mid-typing
      const sacc = f.querySelector('#vr-acc'); if (sacc) sacc.addEventListener('change', () => go({ acc: sacc.value, month: '' }));
      f.querySelectorAll('[data-view]').forEach((x) => x.addEventListener('click', () => go({ view: x.dataset.view === 'v' ? 'v' : '', month: '' })));
      f.querySelector('#vr-det').addEventListener('change', (e) => go({ det: e.target.checked ? '1' : '', view: e.target.checked && view === 'months' ? 'v' : r.params.view }));
      f.querySelector('#vr-narr').addEventListener('change', (e) => go({ narr: e.target.checked ? '1' : '' }));
      const clr = f.querySelector('#vr-clear'); if (clr) clr.addEventListener('click', () => go({ types: '', contact: '', ledger: '', min: '', max: '', no: '', memo: '', party: '', status: '', class: '', dir: '' }));
      f.querySelectorAll('[name=vr-t]').forEach((x) => x.addEventListener('change', () => {
        const on = [...f.querySelectorAll('[name=vr-t]:checked')].map((y) => y.value);
        if (!on.length) { x.checked = true; return UI.toast('Keep at least one voucher type.', 'error'); }
        go({ types: on.length === TYPE_SETS[kind].length ? '' : on.join(',') });
      }));
      ['contact', 'ledger', 'status', 'dir', 'class'].forEach((k) => { const x = f.querySelector('#vr-' + k); if (x) x.addEventListener('change', () => go({ [k]: x.value })); });
      ['party', 'min', 'max', 'no', 'memo'].forEach((k) => { const x = f.querySelector('#vr-' + k); if (!x) return;
        x.addEventListener('change', () => go({ [k]: x.value.trim() }));
        x.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go({ [k]: x.value.trim() }); } });
      });
      f.addEventListener('submit', (e) => e.preventDefault());
      void val;
    }
  };
  // Esc from a month's vouchers returns to the month-wise screen, like Tally (history already does this)

  /* ---------- company list: keyboard like TallyPrime's Select Company ---------- */
  let typed = '', typedAt = 0;
  document.addEventListener('keydown', (e) => {
    if (UI.book || !document.querySelector('#main .company-list, #main #newco')) return;
    if (document.querySelector('.modal-backdrop')) return;
    const t = e.target, inField = /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
    const items = [...document.querySelectorAll('#main .company-open')];
    const at = items.indexOf(t.closest ? t.closest('.company-open') : null);
    if (e.altKey && !e.ctrlKey && !e.metaKey) {
      const k = (e.code || '').replace('Key', '');
      if (k === 'C') { e.preventDefault(); const n = document.querySelector('#newco input[name=name]'); if (n) n.focus(); return; }
      if (k === 'R') { e.preventDefault(); const rf = document.querySelector('#restore-file'); if (rf) rf.click(); return; }
      if (k === 'Q') { e.preventDefault(); const qf = document.querySelector('#qb-newco'); if (qf) qf.click(); return; }
      if (k === 'S') { e.preventDefault(); if (items.length) items[0].focus(); return; }
      return;
    }
    if (inField) { if (e.key === 'Escape') { e.preventDefault(); t.blur(); (items[0] || document.getElementById('main')).focus(); } return; }
    if (!items.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const n = at < 0 ? 0 : (at + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length; items[n].focus(); return; }
    if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); items[e.key === 'Home' ? 0 : items.length - 1].focus(); return; }
    if ((e.key === 'Delete' || (e.altKey && e.key === 'd')) && at >= 0) { e.preventDefault(); const del = items[at].parentElement.querySelector('[data-del]'); if (del) del.click(); return; }
    if (e.key.length === 1 && /\S/.test(e.key) && !e.ctrlKey && !e.metaKey) {
      const now = Date.now(); typed = now - typedAt > 900 ? e.key.toLowerCase() : typed + e.key.toLowerCase(); typedAt = now;
      const hit = items.find((x) => (x.querySelector('strong') || x).textContent.trim().toLowerCase().startsWith(typed));
      if (hit) { e.preventDefault(); hit.focus(); }
    }
  });
})();
