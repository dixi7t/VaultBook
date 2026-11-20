/* VaultBook mobile (iPhone / small screens) and touch (iPad) layer.
 * Phones get their own screens built for one-handed use: Home, Activity, quick Add, Reports and More, with a bottom
 * tab bar. Every save goes through Book.saveTransaction (the same validation and double entry as the full forms), and
 * every existing screen stays reachable from More, which is built from the side menu so nothing is left out. */
(function () {
  'use strict';
  const UI = OB.ui, U = OB.util, S = OB.schema, esc = U.esc;
  const root = document.documentElement;
  const phoneMQ = window.matchMedia('(max-width: 760px), (max-height: 500px) and (pointer: coarse)');
  const touchMQ = window.matchMedia('(pointer: coarse)');
  const isPhone = () => phoneMQ.matches;
  const sync = () => { root.classList.toggle('m-phone', isPhone()); root.classList.toggle('m-touch', touchMQ.matches); };
  sync();
  const onChange = (mq, fn) => (mq.addEventListener ? mq.addEventListener('change', fn) : mq.addListener(fn));
  onChange(phoneMQ, () => { sync(); if (UI.book) UI.render(); });
  onChange(touchMQ, sync);
  const standalone = () => window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
  if (standalone()) root.classList.add('m-standalone');

  /* touch screens: the function-key panel is for keyboards; hide it unless the person chose it in Customize */
  if (touchMQ.matches && OB.prefs.get('fkeys') === undefined) { OB.prefs.set('fkeys', false); if (UI.applyFkeys) UI.applyFkeys(); }

  /* ---------- helpers ---------- */
  const money = (c) => '$' + U.fmt(Math.abs(c || 0));
  const signed = (c) => (c < 0 ? '−' : '') + money(c);
  const b = () => UI.book;
  const accType = (id) => { const a = b().accById[id]; return a ? a.type : ''; };
  const isCash = (id) => { const t = accType(id); return t === 'bank' || t === 'cc'; };
  const accName = (id) => { const a = b().accById[id]; return a ? a.name : ''; };
  const txLabel = (t) => (S.TXN_TYPES[t.type] || {}).label || t.type;
  /** money in (+) or out (−) through bank and card accounts; 0 when the entry does not touch them */
  const cashFlow = (t) => U.sum((t.splits || []).filter((s) => isCash(s.accountId)), (s) => s.amount);
  const live = () => b().transactions.filter((t) => t.status !== 'void' && !t.deleted);
  const fmtDay = (d) => { try { return new Date(d + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); } catch (e) { return d; } };
  const monthName = (d) => { try { return new Date(d + 'T12:00:00').toLocaleDateString(undefined, { month: 'long', year: 'numeric' }); } catch (e) { return d.slice(0, 7); } };
  const icon = (p) => `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
  const I = {
    home: '<path d="M3.5 11 12 4l8.5 7"/><path d="M5.5 9.5V20h13V9.5"/>',
    list: '<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    chart: '<path d="M4 20h16"/><path d="M7 16v-5M12 16V6M17 16v-8"/>',
    more: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
    out: '<path d="M12 4v16M6 14l6 6 6-6"/>',
    in: '<path d="M12 20V4M6 10l6-6 6 6"/>',
    swap: '<path d="M4 8h14l-3.5-3.5M20 16H6l3.5 3.5"/>',
    doc: '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4M10 12h5M10 16h5"/>',
    bill: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h4"/>',
    cash: '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/>',
    bank: '<path d="M3 9l9-5 9 5"/><path d="M5 10v7M9.5 10v7M14.5 10v7M19 10v7M3 20h18"/>',
    upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
    check: '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 12.3l2.3 2.3 4.7-5"/>',
    grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
    chev: '<path d="M9 6l6 6-6 6"/>',
    back: '<path d="M15 6l-6 6 6 6"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/>',
    phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>'
  };
  const page = (title, body, opts) => `<div class="page m-page" data-testid="m-page">
    <header class="m-head">${opts && opts.back ? `<a class="m-back" href="${esc(opts.back)}" aria-label="Back">${icon(I.back)}</a>` : ''}
      <div class="m-head-t"><h1>${esc(title)}</h1>${opts && opts.sub ? `<p>${esc(opts.sub)}</p>` : ''}</div>${opts && opts.right ? opts.right : ''}</header>${body}</div>`;
  const row = (t) => {
    const flow = cashFlow(t), amt = flow || b().txnTotal(t) || t.amount || 0;
    const who = UI.contactName(t.contactId) || t.memo || (t.type === 'transfer' ? accName(t.accountId) + ' → ' + accName(t.toAccountId) : txLabel(t));
    const where = (t.splits || []).filter((s) => isCash(s.accountId)).map((s) => accName(s.accountId))[0] || '';
    const cls = flow > 0 ? 'in' : flow < 0 ? 'out' : '';
    return `<a class="m-tx" href="#/txn/${encodeURIComponent(t.id)}" data-testid="m-tx">
      <span class="m-tx-ic ${cls}">${icon(flow > 0 ? I.in : flow < 0 ? I.out : t.type === 'transfer' ? I.swap : I.doc)}</span>
      <span class="m-tx-main"><b>${esc(who)}</b><small>${esc(txLabel(t))}${where ? ' · ' + esc(where) : ''}${t.number ? ' · ' + esc(t.number) : ''}</small></span>
      <span class="m-tx-amt ${cls}">${flow > 0 ? '+' : flow < 0 ? '−' : ''}${money(amt)}<small>${esc(fmtDay(t.date))}</small></span></a>`;
  };
  const sorted = (list) => list.slice().sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : (y.createdAt || '').localeCompare(x.createdAt || '')));
  const pnl = (from, to) => { try { return OB.reports.pnl(b(), { from, to }); } catch (e) { return null; } };
  const bars = (rows, max) => rows.map((r) => `<a class="m-bar" href="#/register/${encodeURIComponent(r.accountId)}"><span class="m-bar-l"><b>${esc(accName(r.accountId) || r.label)}</b><i>${money(r.v)}</i></span><span class="m-bar-t"><span style="width:${max ? Math.max(3, Math.round(100 * r.v / max)) : 0}%"></span></span></a>`).join('');
  const topRows = (rep, keys, n) => {
    const all = []; keys.forEach((k) => ((rep && rep.sections[k] && rep.sections[k].rows) || []).forEach((r) => all.push({ accountId: r.accountId, label: r.label, v: r.values[r.values.length - 1] })));
    return all.filter((r) => r.v > 0).sort((x, y) => y.v - x.v).slice(0, n || 6);
  };
  const ranges = () => {
    const t = U.today(), ms = U.monthStart(t), fy = b().company.fiscalYearStartMonth || 1;
    let ys = t.slice(0, 4) + '-' + String(fy).padStart(2, '0') + '-01'; if (ys > t) ys = U.addMonths(ys, -12);
    const lms = U.addMonths(ms, -1);
    return { month: { label: 'This month', from: ms, to: t }, last: { label: 'Last month', from: lms, to: U.addDays(ms, -1) },
      year: { label: 'This year', from: ys, to: t }, lastyear: { label: 'Last year', from: U.addMonths(ys, -12), to: U.addDays(ys, -1) } };
  };

  /* ---------- Home ---------- */
  function home(el) {
    const book = b(), today = U.today();
    const cashAccts = book.sortedAccounts((a) => (a.type === 'bank' || a.type === 'cc') && a.active !== false);
    const bal = (a) => book.accountBalance(a.id, today);
    const banks = cashAccts.filter((a) => a.type === 'bank'), cards = cashAccts.filter((a) => a.type === 'cc');
    const cash = U.sum(banks, bal), owed = U.sum(cards, bal);
    const R = ranges(), rep = pnl(R.month.from, R.month.to), last = rep ? rep.columns.length - 1 : 0;
    const income = rep ? rep.sections.income.totals[last] + rep.sections.oi.totals[last] : 0;
    const spend = rep ? rep.sections.expense.totals[last] + rep.sections.cogs.totals[last] + rep.sections.oe.totals[last] : 0;
    const top = topRows(rep, ['expense', 'cogs', 'oe'], 5), max = top.length ? top[0].v : 0;
    const overdue = live().filter((t) => (t.type === 'invoice' || t.type === 'bill') && t.dueDate && t.dueDate < today && book.openBalance(t) > 0);
    const odInv = overdue.filter((t) => t.type === 'invoice'), odBill = overdue.filter((t) => t.type === 'bill');
    const recent = sorted(live()).slice(0, 8);
    const hello = (() => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; })();
    const ios = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const installTip = ios && !standalone() && !OB.prefs.get('mInstallTipDone');

    el.innerHTML = page(book.company.name, `
      ${installTip ? `<div class="m-card m-tip" data-testid="m-install-tip">${icon(I.phone)}<div><b>Add VaultBook to your Home Screen</b>
        <p>In Safari tap <b>Share</b> then <b>Add to Home Screen</b>. It opens like an app, works offline, and stops Safari from clearing your books after a few weeks unused. Keep downloading backups too.</p>
        <button type="button" class="m-link" id="m-tip-x">Got it</button></div></div>` : ''}
      <section class="m-hero" data-testid="m-cash">
        <span>Cash in bank</span><strong>${signed(cash)}</strong>
        ${cards.length ? `<em>Cards owed ${money(owed)}</em>` : ''}
      </section>
      <div class="m-quick" role="group" aria-label="Quick add">
        <a href="#/m/add?kind=expense" class="m-q out" data-testid="m-q-expense">${icon(I.out)}<span>Expense</span></a>
        <a href="#/m/add?kind=income" class="m-q in" data-testid="m-q-income">${icon(I.in)}<span>Income</span></a>
        <a href="#/m/add?kind=transfer" class="m-q" data-testid="m-q-transfer">${icon(I.swap)}<span>Transfer</span></a>
        <button type="button" class="m-q" data-m-add>${icon(I.grid)}<span>More</span></button>
      </div>
      <section class="m-card">
        <div class="m-card-h"><h2>${esc(monthName(R.month.from))}</h2><a href="#/m/reports">Details</a></div>
        <div class="m-stats">
          <div><span>Money in</span><b class="in">${money(income)}</b></div>
          <div><span>Spent</span><b class="out">${money(spend)}</b></div>
          <div><span>Left over</span><b class="${income - spend < 0 ? 'out' : ''}">${signed(income - spend)}</b></div>
        </div>
        ${top.length ? `<h3 class="m-sub">Top spending</h3>${bars(top, max)}` : '<p class="m-empty">No spending recorded this month yet.</p>'}
      </section>
      ${odInv.length || odBill.length ? `<section class="m-card m-alerts">
        ${odInv.length ? `<a href="#/report/araging">${icon(I.doc)}<span><b>${odInv.length} overdue invoice${odInv.length > 1 ? 's' : ''}</b><small>${money(U.sum(odInv, (t) => book.openBalance(t)))} to collect</small></span>${icon(I.chev)}</a>` : ''}
        ${odBill.length ? `<a href="#/report/apaging">${icon(I.bill)}<span><b>${odBill.length} overdue bill${odBill.length > 1 ? 's' : ''}</b><small>${money(U.sum(odBill, (t) => book.openBalance(t)))} to pay</small></span>${icon(I.chev)}</a>` : ''}
      </section>` : ''}
      <section class="m-card">
        <div class="m-card-h"><h2>Accounts</h2><a href="#/accounts">All</a></div>
        ${cashAccts.length ? cashAccts.map((a) => `<a class="m-acct" href="#/register/${encodeURIComponent(a.id)}"><span class="m-tx-ic">${icon(a.type === 'cc' ? I.bill : I.bank)}</span><span class="m-tx-main"><b>${esc(a.name)}</b><small>${a.type === 'cc' ? 'Credit card' : 'Bank'}</small></span><span class="m-tx-amt">${signed(bal(a))}</span></a>`).join('')
        : '<p class="m-empty">No bank or card accounts yet. <a href="#/accounts">Add one</a>.</p>'}
        <a class="m-row-link" href="#/bankfeed">${icon(I.upload)}<span>Bank feed — import and review</span>${icon(I.chev)}</a>
      </section>
      <section class="m-card">
        <div class="m-card-h"><h2>Recent</h2><a href="#/m/activity">See all</a></div>
        ${recent.length ? recent.map(row).join('') : '<p class="m-empty">Nothing recorded yet. Tap <b>Expense</b> or <b>Income</b> to start.</p>'}
      </section>`, { sub: new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }) + ' · ' + hello });
    const x = el.querySelector('#m-tip-x'); if (x) x.addEventListener('click', () => { OB.prefs.set('mInstallTipDone', true); x.closest('.m-tip').remove(); });
    if (OB.db && OB.db.requestPersistence) { try { OB.db.requestPersistence(); } catch (e) { /* best effort */ } }
  }

  /* ---------- Activity ---------- */
  const FILTERS = [['all', 'All'], ['in', 'Money in'], ['out', 'Money out'], ['transfer', 'Transfers'], ['sales', 'Sales'], ['purchases', 'Bills & purchases']];
  function activity(el, r) {
    const f = r.params.f || 'all', q = r.params.q || '';
    el.innerHTML = page('Activity', `
      <label class="m-search">${icon(I.search)}<input type="search" id="m-q" value="${esc(q)}" placeholder="Search name, memo, number, amount" autocomplete="off" enterkeyhint="search"></label>
      <div class="m-chips" role="tablist">${FILTERS.map(([k, l]) => `<button type="button" role="tab" aria-selected="${k === f}" data-f="${k}">${esc(l)}</button>`).join('')}</div>
      <div id="m-list"></div>`, { right: '<a class="m-head-btn" href="#/transactions">Full list</a>' });
    const list = el.querySelector('#m-list'), input = el.querySelector('#m-q');
    let shown = 60, cur = f;
    const draw = () => {
      const s = input.value.trim().toLowerCase(), cents = /^[\d.,$]+$/.test(s) ? (() => { try { return U.toCents(s); } catch (e) { return null; } })() : null;
      let items = sorted(live()).filter((t) => {
        const flow = cashFlow(t), g = (S.TXN_TYPES[t.type] || {}).group;
        if (cur === 'in' && !(flow > 0)) return false; if (cur === 'out' && !(flow < 0)) return false;
        if (cur === 'transfer' && t.type !== 'transfer') return false; if (cur === 'sales' && g !== 'sales') return false; if (cur === 'purchases' && g !== 'purchases') return false;
        if (!s) return true;
        if (cents !== null && cents && (Math.abs(flow) === cents || b().txnTotal(t) === cents)) return true;
        return [UI.contactName(t.contactId), t.memo, t.number, txLabel(t)].concat((t.lines || []).map((l) => l.description)).join(' ').toLowerCase().indexOf(s) >= 0;
      });
      const total = items.length; items = items.slice(0, shown);
      let html = '', month = '';
      items.forEach((t) => { const m = t.date.slice(0, 7); if (m !== month) { month = m; html += `<h3 class="m-month">${esc(monthName(t.date))}</h3>`; } html += row(t); });
      list.innerHTML = (html || '<p class="m-empty">No matching entries.</p>') + (total > shown ? `<button type="button" class="m-btn ghost m-more-btn" id="m-more">Show more (${total - shown} left)</button>` : '');
      const more = list.querySelector('#m-more'); if (more) more.addEventListener('click', () => { shown += 100; draw(); });
    };
    el.querySelectorAll('[data-f]').forEach((x) => x.addEventListener('click', () => { cur = x.dataset.f; el.querySelectorAll('[data-f]').forEach((y) => y.setAttribute('aria-selected', String(y === x))); draw(); }));
    let tm; input.addEventListener('input', () => { clearTimeout(tm); tm = setTimeout(draw, 120); });
    draw();
  }

  /* ---------- Quick add (expense, income, transfer) ---------- */
  const KINDS = {
    expense: { title: 'Add expense', type: 'expense', who: 'Paid to', whoKind: 'vendor', cat: 'Category', catTypes: ['expense', 'cogs', 'oe'], acct: 'Paid from', acctTypes: ['bank', 'cc'], full: 'expense' },
    income: { title: 'Add income', type: 'deposit', who: 'Received from', whoKind: 'customer', cat: 'Category', catTypes: ['income', 'oi'], acct: 'Deposit to', acctTypes: ['bank'], full: 'deposit' },
    transfer: { title: 'Move money', type: 'transfer', acct: 'From', acctTypes: ['bank', 'cc', 'oca', 'ocl', 'ltl'], full: 'transfer' }
  };
  const lastKey = (k) => 'mLast_' + k;
  function add(el, r) {
    const kind = KINDS[r.params.kind] ? r.params.kind : 'expense', K = KINDS[kind], book = b();
    const accts = (types) => book.sortedAccounts((a) => types.indexOf(a.type) >= 0 && a.active !== false && !a.isHeader);
    const opt = (list, sel) => list.map((a) => `<option value="${esc(a.id)}"${a.id === sel ? ' selected' : ''}>${esc(book.accountFullName ? book.accountFullName(a) : a.name)}</option>`).join('');
    const last = OB.prefs.get(lastKey(kind)) || {};
    const from = accts(K.acctTypes), cats = K.catTypes ? accts(K.catTypes) : [], to = kind === 'transfer' ? accts(K.acctTypes) : [];
    const people = book.contacts.filter((c) => c.active !== false && !c.deleted).map((c) => c.name).sort((x, y) => x.localeCompare(y));
    el.innerHTML = page(K.title, `
      <div class="m-seg" role="tablist">${Object.keys(KINDS).map((k) => `<a role="tab" href="#/m/add?kind=${k}" aria-selected="${k === kind}">${k === 'expense' ? 'Expense' : k === 'income' ? 'Income' : 'Transfer'}</a>`).join('')}</div>
      <form class="m-form" id="m-form" novalidate autocomplete="off">
        <label class="m-amount ${kind === 'expense' ? 'out' : kind === 'income' ? 'in' : ''}"><span>Amount</span><div><i>$</i><input id="m-amt" name="amount" inputmode="decimal" placeholder="0.00" required data-testid="m-amount"></div></label>
        ${K.who ? `<label class="m-f"><span>${K.who}</span><input name="who" list="m-people" placeholder="Optional — e.g. ${kind === 'expense' ? 'Shell, Amazon, landlord' : 'employer, client'}" autocapitalize="words"><datalist id="m-people">${people.map((p) => `<option value="${esc(p)}">`).join('')}</datalist></label>` : ''}
        ${K.cat ? `<label class="m-f"><span>${K.cat}</span><select name="cat" required data-testid="m-cat"><option value="">Choose…</option>${opt(cats, last.cat)}</select></label>` : ''}
        <label class="m-f"><span>${K.acct}</span><select name="acct" required data-testid="m-acct"><option value="">Choose…</option>${opt(from, last.acct)}</select></label>
        ${kind === 'transfer' ? `<label class="m-f"><span>To</span><select name="to" required><option value="">Choose…</option>${opt(to, last.to)}</select></label>` : ''}
        <label class="m-f"><span>Date</span><input type="date" name="date" value="${U.today()}" required></label>
        <label class="m-f"><span>Note</span><input name="memo" placeholder="Optional" autocapitalize="sentences"></label>
        <p class="m-err" id="m-err" role="alert" hidden></p>
        <div class="m-actions">
          <button type="submit" class="m-btn primary" data-testid="m-save">Save</button>
          <button type="button" class="m-btn ghost" id="m-save-new">Save and add another</button>
        </div>
        <a class="m-row-link" href="#/txn/new?type=${K.full}">${icon(I.doc)}<span>Need splits, classes or attachments? Open the full form</span>${icon(I.chev)}</a>
      </form>`, { back: '#/m' });
    const form = el.querySelector('#m-form'), err = el.querySelector('#m-err');
    let again = false, busy = false;
    el.querySelector('#m-save-new').addEventListener('click', () => { again = true; form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event('submit', { cancelable: true })); });
    const fail = (m) => { err.textContent = m; err.hidden = false; err.scrollIntoView({ block: 'center', behavior: 'smooth' }); };
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); if (busy) return; err.hidden = true;
      const v = Object.fromEntries(new FormData(form).entries());
      let cents; try { cents = U.toCents(v.amount); } catch (x) { cents = 0; }
      if (!(cents > 0)) { again = false; return fail('Enter an amount greater than zero.'); }
      if (K.cat && !v.cat) { again = false; return fail('Choose a category.'); }
      if (!v.acct) { again = false; return fail('Choose the ' + K.acct.toLowerCase() + ' account.'); }
      if (kind === 'transfer' && (!v.to || v.to === v.acct)) { again = false; return fail('Choose two different accounts.'); }
      busy = true;
      try {
        let contactId = '';
        const who = (v.who || '').trim();
        if (who) {
          const lc = who.toLowerCase(), list = book.contacts.filter((c) => !c.deleted && c.name.toLowerCase() === lc);
          const hit = list.find((c) => c.kind === K.whoKind) || list[0];
          if (hit) contactId = hit.id;
          else { const c = await book.saveContact({ kind: K.whoKind, name: who }); contactId = c && c.id ? c.id : ((book.contacts.find((x) => x.name.toLowerCase() === lc) || {}).id || ''); }
        }
        const draft = kind === 'transfer'
          ? { type: 'transfer', date: v.date, accountId: v.acct, toAccountId: v.to, amount: cents, memo: v.memo || '' }
          : { type: K.type, date: v.date, accountId: v.acct, contactId, memo: v.memo || '', lines: [{ accountId: v.cat, amount: cents, description: v.memo || '' }] };
        await book.saveTransaction(draft);
        OB.prefs.set(lastKey(kind), { acct: v.acct, cat: v.cat || '', to: v.to || '' });
        UI.toast((kind === 'transfer' ? 'Transfer' : kind === 'income' ? 'Income' : 'Expense') + ' of ' + money(cents) + ' saved.');
        if (again) { again = false; busy = false; form.reset(); form.elements.date.value = v.date; form.elements.acct.value = v.acct; if (form.elements.cat) form.elements.cat.value = v.cat; el.querySelector('#m-amt').focus(); return; }
        UI.go('#/m');
      } catch (x) { fail(x && x.message ? x.message : String(x)); }
      busy = false; again = false;
    });
  }

  /* ---------- Reports ---------- */
  function reports(el, r) {
    const R = ranges(), key = R[r.params.p] ? r.params.p : 'month', P = R[key], book = b();
    const rep = pnl(P.from, P.to), last = rep ? rep.columns.length - 1 : 0, tot = (k) => (rep ? rep.sections[k].totals[last] : 0);
    const income = tot('income') + tot('oi'), spend = tot('expense') + tot('cogs') + tot('oe');
    const sp = topRows(rep, ['expense', 'cogs', 'oe'], 12), inc = topRows(rep, ['income', 'oi'], 8);
    const today = U.today(), cls = (a) => (S.TYPE[a.type] || {}).cls;
    const assets = U.sum(book.accounts.filter((a) => cls(a) === 'asset'), (a) => book.accountBalance(a.id, today));
    const liab = U.sum(book.accounts.filter((a) => cls(a) === 'liability'), (a) => book.accountBalance(a.id, today));
    const link = (h, l, d) => `<a class="m-row-link" href="${h}">${icon(I.chart)}<span>${esc(l)}${d ? `<small>${esc(d)}</small>` : ''}</span>${icon(I.chev)}</a>`;
    el.innerHTML = page('Reports', `
      <div class="m-chips" role="tablist">${Object.keys(R).map((k) => `<a role="tab" href="#/m/reports?p=${k}" aria-selected="${k === key}">${esc(R[k].label)}</a>`).join('')}</div>
      <section class="m-card">
        <div class="m-card-h"><h2>${esc(P.label)}</h2><small>${esc(U.fmtDate(P.from))} – ${esc(U.fmtDate(P.to))}</small></div>
        <div class="m-stats">
          <div><span>Money in</span><b class="in">${money(income)}</b></div>
          <div><span>Spent</span><b class="out">${money(spend)}</b></div>
          <div><span>Net</span><b class="${income - spend < 0 ? 'out' : ''}">${signed(income - spend)}</b></div>
        </div>
        <p class="m-note">${rep ? (rep.basis === 'cash' ? 'Cash basis' : 'Accrual basis') : ''}</p>
      </section>
      <section class="m-card"><div class="m-card-h"><h2>Where the money went</h2></div>${sp.length ? bars(sp, sp[0].v) : '<p class="m-empty">No spending in this period.</p>'}</section>
      <section class="m-card"><div class="m-card-h"><h2>Where it came from</h2></div>${inc.length ? bars(inc, inc[0].v) : '<p class="m-empty">No income in this period.</p>'}</section>
      <section class="m-card"><div class="m-card-h"><h2>Net worth today</h2></div>
        <div class="m-stats"><div><span>Own</span><b>${signed(assets)}</b></div><div><span>Owe</span><b>${signed(liab)}</b></div><div><span>Net worth</span><b class="${assets - liab < 0 ? 'out' : ''}">${signed(assets - liab)}</b></div></div></section>
      <section class="m-card"><div class="m-card-h"><h2>Full reports</h2></div>
        ${link('#/report/pnl?from=' + P.from + '&to=' + P.to, 'Profit and loss', 'Income and expenses by account')}
        ${link('#/report/bs', 'Balance sheet', 'What you own and owe')}
        ${link('#/report/cf', 'Cash flow')}
        ${link('#/report/gl', 'General ledger')}
        ${link('#/report/araging', 'Who owes you (A/R aging)')}
        ${link('#/report/apaging', 'What you owe (A/P aging)')}
        ${link('#/reports', 'All reports', 'Every report, saved and custom')}
      </section>`);
  }

  /* ---------- More: every screen, built from the side menu ---------- */
  function more(el) {
    const nav = document.querySelector('#sidebar .nav');
    let html = '', open = false;
    const start = (t) => { if (open) html += '</section>'; html += `<section class="m-card m-menu"><h2>${esc(t)}</h2>`; open = true; };
    const link = (a) => {
      if (a.hidden || a.closest('[hidden]')) return;
      const svg = a.querySelector('svg'), label = (a.querySelector('span') || a).textContent.trim();
      html += `<a class="m-row-link" href="${esc(a.getAttribute('href'))}">${svg ? svg.outerHTML : ''}<span>${esc(label)}</span>${icon(I.chev)}</a>`;
    };
    /* the side menu is either flat (headings between links) or grouped by ui-nav into .nav-grp blocks */
    const tops = [], groups = [];
    Array.from(nav ? nav.children : []).forEach((n) => {
      if (n.tagName === 'A') { if (!groups.length || n.classList.contains('nav-top')) tops.push(n); else groups[groups.length - 1].links.push(n); return; }
      const links = Array.from(n.querySelectorAll('a[href]'));
      const title = n.classList.contains('nav-group') ? n.textContent.trim() : ((n.querySelector('button, summary, .nav-grp-h, span') || n).textContent || '').trim().split('\n')[0];
      groups.push({ title, links });
    });
    start('Overview'); tops.forEach(link);
    groups.forEach((g) => { if (!g.links.some((a) => !a.hidden)) return; start(g.title); g.links.forEach(link); });
    if (open) html += '</section>';
    const lock = document.getElementById('btn-lock');
    el.innerHTML = page('More', `
      <section class="m-card m-menu"><h2>Quick</h2>
        <button type="button" class="m-row-link" id="m-search">${icon(I.search)}<span>Search or go to anything</span>${icon(I.chev)}</button>
        <button type="button" class="m-row-link" data-m-add>${icon(I.plus)}<span>Create any transaction</span>${icon(I.chev)}</button>
        <a class="m-row-link" href="#/settings">${icon(I.upload)}<span>Backup and restore<small>Download a backup regularly</small></span>${icon(I.chev)}</a>
        <a class="m-row-link" href="#/gateway?full=1">${icon(I.grid)}<span>Gateway (classic home)</span>${icon(I.chev)}</a>
        <a class="m-row-link" href="#/dashboard?full=1">${icon(I.chart)}<span>Business overview dashboard</span>${icon(I.chev)}</a>
      </section>
      ${html}
      <section class="m-card m-menu"><h2>App</h2>
        <button type="button" class="m-row-link" id="m-theme">${icon('<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2"/>')}<span>${esc(document.getElementById('theme-toggle').getAttribute('aria-label') || 'Appearance')}</span></button>
        ${UI.gearMenu ? `<button type="button" class="m-row-link" id="m-gear">${icon(I.grid)}<span>Lists, settings and tools</span>${icon(I.chev)}</button>` : ''}
        ${lock && !lock.hidden ? `<button type="button" class="m-row-link" id="m-lock">${icon('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>')}<span>Lock company</span></button>` : ''}
        <button type="button" class="m-row-link" id="m-switch">${icon(I.swap)}<span>Switch company</span></button>
      </section>`);
    el.querySelector('#m-search').addEventListener('click', () => UI.openPalette && UI.openPalette());
    el.querySelector('#m-theme').addEventListener('click', () => { document.getElementById('theme-toggle').click(); setTimeout(() => more(el), 0); });
    const g = el.querySelector('#m-gear'); if (g) g.addEventListener('click', () => UI.gearMenu());
    const l = el.querySelector('#m-lock'); if (l) l.addEventListener('click', () => lock.click());
    el.querySelector('#m-switch').addEventListener('click', () => document.getElementById('btn-switch').click());
  }

  /* ---------- Add sheet (bottom sheet with every way to record something) ---------- */
  function addSheet() {
    if (document.getElementById('m-sheet')) return;
    const T = (h, ic, l) => `<a href="${h}" class="m-tile">${icon(ic)}<span>${esc(l)}</span></a>`;
    const wrap = document.createElement('div');
    wrap.id = 'm-sheet'; wrap.className = 'm-sheet-wrap'; wrap.setAttribute('data-overlay', '');
    wrap.innerHTML = `<div class="m-sheet" role="dialog" aria-modal="true" aria-label="Add">
      <div class="m-grab" aria-hidden="true"></div><h2>Add</h2>
      <div class="m-tiles">
        ${T('#/m/add?kind=expense', I.out, 'Expense')}${T('#/m/add?kind=income', I.in, 'Income')}${T('#/m/add?kind=transfer', I.swap, 'Transfer')}
        ${T('#/txn/new?type=invoice', I.doc, 'Invoice')}${T('#/txn/new?type=payment', I.cash, 'Receive payment')}${T('#/txn/new?type=salesReceipt', I.cash, 'Sales receipt')}
        ${T('#/txn/new?type=bill', I.bill, 'Bill')}${T('#/txn/new?type=billPayment', I.check, 'Pay bills')}${T('#/txn/new?type=check', I.bill, 'Write check')}
        ${T('#/bankfeed', I.upload, 'Import bank file')}${T('#/pdfimport', I.doc, 'Import statement')}${T('#/txn/new?type=journal', I.list, 'Journal entry')}
      </div>
      <button type="button" class="m-btn ghost" id="m-all-types">All transaction types…</button>
      <button type="button" class="m-btn" id="m-sheet-x">Cancel</button></div>`;
    document.body.appendChild(wrap);
    requestAnimationFrame(() => wrap.classList.add('open'));
    const close = () => { wrap.classList.remove('open'); setTimeout(() => wrap.remove(), 200); document.removeEventListener('keydown', onKey, true); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    document.addEventListener('keydown', onKey, true);
    wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.closest('a') || e.target.id === 'm-sheet-x') close(); });
    wrap.querySelector('#m-all-types').addEventListener('click', () => { close(); UI.newMenu(); });
    const f = wrap.querySelector('.m-tile'); if (f) f.focus({ preventScroll: true });
  }
  document.addEventListener('click', (e) => { const t = e.target.closest && e.target.closest('[data-m-add]'); if (t) { e.preventDefault(); addSheet(); } });

  /* ---------- bottom tab bar ---------- */
  const tabbar = document.createElement('nav');
  tabbar.className = 'm-tabbar'; tabbar.id = 'm-tabbar'; tabbar.setAttribute('aria-label', 'Main'); tabbar.dataset.testid = 'm-tabbar';
  tabbar.innerHTML = `<a href="#/m" data-tab="home">${icon(I.home)}<span>Home</span></a>
    <a href="#/m/activity" data-tab="activity">${icon(I.list)}<span>Activity</span></a>
    <button type="button" class="m-tab-add" data-m-add aria-label="Add">${icon(I.plus)}</button>
    <a href="#/m/reports" data-tab="reports">${icon(I.chart)}<span>Reports</span></a>
    <a href="#/m/more" data-tab="more">${icon(I.more)}<span>More</span></a>`;
  document.body.appendChild(tabbar);
  const markTab = () => {
    const h = location.hash, r = UI.parseHash();
    const tab = r.name === 'm' ? (r.id || 'home') : /^#\/(transactions|txn|register|find)/.test(h) ? 'activity' : /^#\/(report|reports)/.test(h) ? 'reports' : 'more';
    tabbar.querySelectorAll('[data-tab]').forEach((a) => { if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  };
  window.addEventListener('hashchange', markTab);

  /* ---------- routes ---------- */
  UI.routes.m = (el, r) => {
    if (!isPhone()) { const map = { activity: '#/transactions', reports: '#/reports', more: '#/gateway', add: '#/txn/new?type=' + ((KINDS[r.params.kind] || KINDS.expense).full) }; location.replace(map[r.id] || '#/dashboard'); return; }
    root.classList.add('m-screen');
    ({ activity, add, reports, more }[r.id] || home)(el, r);
    markTab();
  };
  /* on a phone the landing screens open the mobile Home; ?full=1 still shows the classic screen */
  ['gateway', 'dashboard'].forEach((name) => {
    const orig = UI.routes[name]; if (!orig) return;
    UI.routes[name] = (el, r) => {
      if (isPhone() && !(r.params && r.params.full)) { location.replace('#/m'); return; }
      return orig(el, r);
    };
  });
  /* leaving a mobile screen drops its page styling; the tab bar keeps the current tab lit */
  const baseRender = UI.render;
  UI.render = function () { root.classList.remove('m-screen'); const res = baseRender.apply(this, arguments); markTab(); return res; };
  markTab();

  /* ---------- offline app (service worker) on https or localhost ---------- */
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => { /* offline cache is optional */ }); });
  }
})();
