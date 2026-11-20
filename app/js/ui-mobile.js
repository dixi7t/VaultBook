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
        <a href="#/m/feed" class="m-q feed" data-testid="m-q-feed">${icon(I.bank)}<span>Bank Feed</span></a>
      </div>
      ${(() => { const fa = feedAccts(), rv = U.sum(fa, (a) => book.bankLinesFor(a.id, 'review').length);
        return `<section class="m-card m-feed-home" data-testid="m-home-feed"><div class="m-card-h"><h2>Bank Feed</h2><a href="#/m/feed">Accounts</a></div>
          <p class="m-note">${rv ? `<b>${rv}</b> statement line${rv === 1 ? '' : 's'} waiting for a category.` : 'Type or paste your bank and credit card statement lines, then categorize them.'}</p>
          <div class="m-feed-btns"><a class="m-btn primary" href="${fa.length ? '#/m/feed/enter?account=' + encodeURIComponent(fa[0].id) : '#/m/feed'}">${icon(I.plus)}Add Lines</a><a class="m-btn ${rv ? 'warn' : ''}" href="#/m/feed/review">${icon(I.check)}Review${rv ? ` <i class="m-badge">${rv}</i>` : ''}</a></div></section>`; })()}
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
        <a class="m-row-link" href="#/m/feed">${icon(I.upload)}<span>Bank feed — enter or review statements</span>${icon(I.chev)}</a>
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
    const start = (t) => { if (open) html += '</section>'; html += `<h2 class="m-sec">${esc(t)}</h2><section class="m-card m-menu">`; open = true; };
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
      <h2 class="m-sec">Quick</h2><section class="m-card m-menu">
        <button type="button" class="m-row-link" id="m-search">${icon(I.search)}<span>Search or go to anything</span>${icon(I.chev)}</button>
        <button type="button" class="m-row-link" data-m-add>${icon(I.plus)}<span>Create any transaction</span>${icon(I.chev)}</button>
        <a class="m-row-link" href="#/m/reports">${icon(I.chart)}<span>Reports<small>This month, this year, net worth</small></span>${icon(I.chev)}</a>
        <a class="m-row-link" href="#/m/feed">${icon(I.bank)}<span>Bank feed</span>${icon(I.chev)}</a>
        <a class="m-row-link" href="#/settings">${icon(I.upload)}<span>Backup and restore<small>Download a backup regularly</small></span>${icon(I.chev)}</a>
        <a class="m-row-link" href="#/gateway?full=1">${icon(I.grid)}<span>Gateway (classic home)</span>${icon(I.chev)}</a>
        <a class="m-row-link" href="#/dashboard?full=1">${icon(I.chart)}<span>Business overview dashboard</span>${icon(I.chev)}</a>
      </section>
      ${html}
      <h2 class="m-sec">App</h2><section class="m-card m-menu">
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

  /* ---------- Bank feed for touch screens (phone and iPad) ----------
   * Statement lines typed or pasted here go to the account's For review list through Book.importBankLines (the same
   * duplicate check as a bank file); review posts each through Book.postBankLine (rules, history, matching). */
  const FEED = { bank: 1, cc: 1, oca: 1 };
  const feedAccts = () => b().sortedAccounts((a) => FEED[a.type] && a.active !== false && !(a.type === 'oca' && a.system));
  const isCard = (id) => accType(id) === 'cc';
  const draftKey = (acct) => 'vbFeedDraft:' + (b().company.id || '') + ':' + acct;
  const loadDraft = (acct) => { try { return JSON.parse(localStorage.getItem(draftKey(acct)) || '[]'); } catch (e) { return []; } };
  const saveDraft = (acct, rows) => { try { if (rows.length) localStorage.setItem(draftKey(acct), JSON.stringify(rows)); else localStorage.removeItem(draftKey(acct)); } catch (e) { /* draft is a convenience */ } };
  async function contactFor(name, kind) {
    const who = String(name || '').trim(); if (!who) return '';
    const book = b(), lc = who.toLowerCase(), list = book.contacts.filter((c) => !c.deleted && c.name.toLowerCase() === lc);
    const hit = list.find((c) => c.kind === kind) || list[0]; if (hit) return hit.id;
    const c = await book.saveContact({ kind, name: who });
    return (c && c.id) || ((book.contacts.find((x) => x.name.toLowerCase() === lc) || {}).id || '');
  }
  const pickAcct = (sel, base) => `<label class="m-f"><span>Account</span><select id="m-feed-acct" data-base="${esc(base)}">${feedAccts().map((a) => `<option value="${esc(a.id)}"${a.id === sel ? ' selected' : ''}>${esc(a.name)} · ${a.type === 'cc' ? 'Credit card' : 'Bank'}</option>`).join('')}</select></label>`;
  const wirePick = (el) => { const s = el.querySelector('#m-feed-acct'); if (s) s.addEventListener('change', () => UI.go(s.dataset.base + encodeURIComponent(s.value))); };

  function feedHub(el) {
    const book = b(), list = feedAccts(), today = U.today();
    const total = U.sum(list, (a) => book.bankLinesFor(a.id, 'review').length);
    el.innerHTML = page('Bank Feed', `
      <section class="m-card m-feed-intro">
        <p>Type or paste the lines from your bank and credit card statements, a month or a whole year at a time. They wait in <b>For review</b> until you pick a category; VaultBook suggests one from your rules and past choices and spots entries you already recorded.</p>
        ${total ? `<p class="m-feed-total"><b>${total}</b> line${total === 1 ? '' : 's'} waiting for review</p>` : ''}
      </section>
      ${list.length ? list.map((a) => {
        const rev = book.bankLinesFor(a.id, 'review').length, posted = book.bankLinesFor(a.id, 'posted'), card = a.type === 'cc';
        const lastD = book.bankLinesFor(a.id)[0];
        return `<section class="m-card m-feed-acct" data-testid="m-feed-acct">
          <div class="m-feed-acct-h"><span class="m-tx-ic">${icon(card ? I.bill : I.bank)}</span>
            <span class="m-tx-main"><b>${esc(a.name)}</b><small>${card ? 'Credit card' : 'Bank'}${lastD ? ' · statement lines to ' + esc(U.fmtDate(lastD.date)) : ' · no statement lines yet'}</small></span>
            <span class="m-tx-amt">${signed(book.accountBalance(a.id, today))}<small>${card ? 'owed' : 'in VaultBook'}</small></span></div>
          <div class="m-feed-btns">
            <a class="m-btn primary" href="#/m/feed/enter?account=${encodeURIComponent(a.id)}">${icon(I.plus)}Add Lines</a>
            <a class="m-btn ${rev ? 'warn' : ''}" href="#/m/feed/review?account=${encodeURIComponent(a.id)}">${icon(I.check)}Review${rev ? ` <i class="m-badge">${rev}</i>` : ''}</a>
          </div>
          ${posted.length ? `<small class="m-feed-meta">${posted.length} line${posted.length === 1 ? '' : 's'} posted</small>` : ''}
          ${loadDraft(a.id).length ? `<small class="m-feed-meta warn">${loadDraft(a.id).length} unsaved line${loadDraft(a.id).length === 1 ? '' : 's'} in progress — tap Enter statement</small>` : ''}
        </section>`;
      }).join('') : '<section class="m-card"><p class="m-empty">No bank or credit card accounts yet. Add one below to start.</p></section>'}
      <section class="m-card">
        <div class="m-card-h"><h2>Add a bank or credit card account</h2></div>
        <form id="m-new-acct" class="m-form" autocomplete="off">
          <div class="m-seg m-seg2" role="radiogroup"><label><input type="radio" name="type" value="bank" checked><span>Bank</span></label><label><input type="radio" name="type" value="cc"><span>Credit card</span></label></div>
          <label class="m-f"><span>Name</span><input name="name" placeholder="e.g. Chase Checking, Amex Gold" autocapitalize="words" required></label>
          <label class="m-f"><span>Balance on the first statement (optional)</span><input name="open" inputmode="decimal" placeholder="0.00"></label>
          <label class="m-f"><span>As of</span><input type="date" name="openDate" value="${esc(U.addDays(U.monthStart(today), -1))}"></label>
          <p class="m-err" hidden></p>
          <button class="m-btn" type="submit">Add account</button>
        </form>
      </section>
      <h2 class="m-sec">Other ways in</h2><section class="m-card m-menu">
        <a class="m-row-link" href="#/bankfeed?full=1">${icon(I.upload)}<span>Import a bank file (CSV, OFX, QFX)<small>Opens the full bank feed</small></span>${icon(I.chev)}</a>
        <a class="m-row-link" href="#/pdfimport">${icon(I.doc)}<span>Import a PDF statement</span>${icon(I.chev)}</a>
        <a class="m-row-link" href="#/rules">${icon(I.list)}<span>Bank rules<small>Categorize repeating lines automatically</small></span>${icon(I.chev)}</a>
        <a class="m-row-link" href="#/reconcile">${icon(I.check)}<span>Reconcile to a statement</span>${icon(I.chev)}</a>
      </section>`, { sub: 'Bank and credit card statements' });
    const f = el.querySelector('#m-new-acct'), err = f.querySelector('.m-err');
    f.addEventListener('submit', async (e) => {
      e.preventDefault(); err.hidden = true;
      const v = Object.fromEntries(new FormData(f).entries());
      try {
        let cents = 0; if (v.open) cents = U.toCents(v.open);
        const a = await book.saveAccount({ name: v.name, type: v.type });
        if (cents) await book.setOpeningBalance(a.id, v.openDate || today, cents);
        UI.toast(a.name + ' added.');
        UI.go('#/m/feed/enter?account=' + encodeURIComponent(a.id));
      } catch (x) { err.textContent = x.message || String(x); err.hidden = false; }
    });
  }

  function feedEnter(el, r) {
    const book = b(), list = feedAccts();
    if (!list.length) return UI.go('#/m/feed');
    const acct = list.some((a) => a.id === r.params.account) ? r.params.account : list[0].id, card = isCard(acct);
    let rows = loadDraft(acct), dir = OB.prefs.get('mFeedDir_' + acct) || 'out';
    const descs = Array.from(new Set(book.bankLinesFor(acct).map((l) => l.description))).slice(0, 300);
    const L = card ? { out: 'Charge', in: 'Payment / credit' } : { out: 'Money out', in: 'Money in' };
    const lastDate = rows.length ? rows[rows.length - 1].date : (OB.prefs.get('mFeedDate_' + acct) || U.today());
    el.innerHTML = page('Add Lines', `
      ${pickAcct(acct, '#/m/feed/enter?account=')}
      <form class="m-card m-form m-entry" id="m-line" autocomplete="off" novalidate>
        <div class="m-seg m-seg2 m-dir" role="radiogroup" aria-label="Direction">
          <label class="out"><input type="radio" name="dir" value="out"${dir === 'out' ? ' checked' : ''}><span>${L.out}</span></label>
          <label class="in"><input type="radio" name="dir" value="in"${dir === 'in' ? ' checked' : ''}><span>${L.in}</span></label></div>
        <div class="m-date-row"><button type="button" class="m-step" data-d="-1" aria-label="Previous day">${icon(I.back)}</button>
          <input type="date" name="date" value="${esc(lastDate)}" required aria-label="Date">
          <button type="button" class="m-step" data-d="1" aria-label="Next day">${icon(I.chev)}</button></div>
        <label class="m-f"><span>Description</span><input name="desc" list="m-descs" placeholder="As on the statement, e.g. SHELL OIL 123" autocapitalize="characters" enterkeyhint="next"><datalist id="m-descs">${descs.map((d) => `<option value="${esc(d)}">`).join('')}</datalist></label>
        <div class="m-two"><label class="m-f"><span>Amount</span><input name="amount" inputmode="decimal" placeholder="0.00" enterkeyhint="done" data-testid="m-line-amt"></label>
          ${card ? '' : '<label class="m-f m-chk"><span>Check #</span><input name="checkNo" inputmode="numeric" placeholder="—"></label>'}</div>
        <p class="m-err" id="m-line-err" hidden></p>
        <button type="submit" class="m-btn primary" data-testid="m-line-add">Add Line</button>
        <button type="button" class="m-link m-paste-t" id="m-paste-t">Paste many lines at once</button>
        <div class="m-paste" id="m-paste" hidden>
          <p class="m-note">One line per transaction: <b>date, description, amount</b>, separated by commas or tabs. Rows copied from a spreadsheet, Notes or your bank's website work.</p>
          <textarea id="m-paste-x" rows="6" placeholder="01/03/2026, GROCERY OUTLET, 54.21&#10;01/04/2026, PAYROLL DEPOSIT, -2150.00"></textarea>
          <label class="m-check"><input type="checkbox" id="m-paste-sign" checked> ${card ? 'A minus sign means a payment or credit; other amounts are charges' : 'A minus sign means money out; other amounts are money in'}</label>
          <p class="m-note">Untick to use the ${esc(L.out)} / ${esc(L.in)} switch above for every pasted line.</p>
          <button type="button" class="m-btn" id="m-paste-go">Add these lines</button>
        </div>
      </form>
      <section class="m-card" id="m-pending"></section>`, { back: '#/m/feed', sub: card ? 'Credit card statement' : 'Bank statement' });
    wirePick(el);
    const form = el.querySelector('#m-line'), err = el.querySelector('#m-line-err'), pend = el.querySelector('#m-pending');
    const fail = (m) => { err.textContent = m; err.hidden = !m; };
    const sign = (d) => (d === 'in' ? 1 : -1);
    const draw = () => {
      saveDraft(acct, rows);
      const inn = U.sum(rows.filter((x) => x.amount > 0), (x) => x.amount), out = -U.sum(rows.filter((x) => x.amount < 0), (x) => x.amount);
      const sorted2 = rows.map((x, i) => ({ x, i })).sort((a, c) => (a.x.date < c.x.date ? 1 : a.x.date > c.x.date ? -1 : c.i - a.i));
      pend.innerHTML = rows.length ? `<div class="m-card-h"><h2>${rows.length} line${rows.length === 1 ? '' : 's'} ready</h2><button type="button" class="m-link" id="m-clear">Clear</button></div>
        <div class="m-stats m-stats2"><div><span>${L.in}</span><b class="in">${money(inn)}</b></div><div><span>${L.out}</span><b class="out">${money(out)}</b></div></div>
        <div class="m-plist">${sorted2.map(({ x, i }) => `<div class="m-pline"><button type="button" class="m-pedit" data-i="${i}"><span><b>${esc(x.description)}</b><small>${esc(U.fmtDate(x.date))}${x.checkNo ? ' · #' + esc(x.checkNo) : ''}</small></span><i class="${x.amount > 0 ? 'in' : 'out'}">${x.amount > 0 ? '+' : '−'}${money(x.amount)}</i></button><button type="button" class="m-pdel" data-i="${i}" aria-label="Remove line">×</button></div>`).join('')}</div>
        <details class="m-endbal"><summary>Statement ending balance (optional)</summary>
          <div class="m-two"><label class="m-f"><span>Ending balance</span><input id="m-end" inputmode="decimal" placeholder="0.00"></label><label class="m-f"><span>Statement date</span><input type="date" id="m-end-d" value="${esc(rows.map((x) => x.date).sort().pop() || U.today())}"></label></div>
          <p class="m-note">Kept with this batch so you can compare it with VaultBook and reconcile later.</p></details>
        <button type="button" class="m-btn primary" id="m-save-lines" data-testid="m-save-lines">Save ${rows.length} line${rows.length === 1 ? '' : 's'} for review</button>
        <p class="m-note">Lines you add are kept on this device until you save them.</p>`
        : '<p class="m-empty">Lines you add show here. Save them when the statement is done; nothing is posted until you review.</p>';
      pend.querySelectorAll('.m-pdel').forEach((x) => x.addEventListener('click', () => { rows.splice(+x.dataset.i, 1); draw(); }));
      pend.querySelectorAll('.m-pedit').forEach((x) => x.addEventListener('click', () => {
        const row = rows.splice(+x.dataset.i, 1)[0]; draw();
        form.elements.date.value = row.date; form.elements.desc.value = row.description; form.elements.amount.value = U.fmt(Math.abs(row.amount)).replace(/,/g, '');
        if (form.elements.checkNo) form.elements.checkNo.value = row.checkNo || '';
        form.querySelector(`input[name=dir][value=${row.amount > 0 ? 'in' : 'out'}]`).checked = true;
        form.scrollIntoView({ behavior: 'smooth', block: 'start' }); form.elements.amount.focus();
      }));
      const clr = pend.querySelector('#m-clear'); if (clr) clr.addEventListener('click', () => UI.confirm('Clear the lines?', `Remove the ${rows.length} unsaved line${rows.length === 1 ? '' : 's'}?`, { ok: 'Clear' }).then((ok) => { if (ok) { rows = []; draw(); } }));
      const sv = pend.querySelector('#m-save-lines'); if (sv) sv.addEventListener('click', async () => {
        sv.disabled = true;
        try {
          const endTxt = (pend.querySelector('#m-end') || {}).value || '', meta = { fileName: 'Entered on ' + (isPhone() ? 'phone' : 'tablet') + ' ' + U.fmtDate(U.today()), source: 'manual' };
          if (endTxt) { meta.endingBalance = (card ? -1 : 1) * U.toCents(endTxt); meta.endingDate = pend.querySelector('#m-end-d').value; }
          const res = await book.importBankLines(acct, rows.map((x) => ({ date: x.date, description: x.description, amount: x.amount, checkNo: x.checkNo || '' })), meta);
          rows = []; saveDraft(acct, rows); markTab();
          pend.innerHTML = `<div class="m-done">${icon(I.check)}<h2>${res.added} line${res.added === 1 ? '' : 's'} saved for review</h2>
            ${res.duplicates ? `<p class="m-note">${res.duplicates} line${res.duplicates === 1 ? ' was' : 's were'} skipped because the same date, description and amount was already entered. If one is really a separate purchase, add it again with a small change to the description (for example “#2”).</p>` : ''}
            <a class="m-btn primary" href="#/m/feed/review?account=${encodeURIComponent(acct)}">Review and categorize now</a>
            <button type="button" class="m-btn ghost" id="m-more-lines">Enter more lines</button></div>`;
          pend.querySelector('#m-more-lines').addEventListener('click', draw);
        } catch (x) { sv.disabled = false; UI.toast(x.message || String(x), 'error'); }
      });
    };
    form.querySelectorAll('.m-step').forEach((x) => x.addEventListener('click', () => { const d = form.elements.date; d.value = U.addDays(d.value || U.today(), +x.dataset.d); }));
    form.querySelectorAll('input[name=dir]').forEach((x) => x.addEventListener('change', () => { dir = x.value; OB.prefs.set('mFeedDir_' + acct, dir); }));
    form.elements.desc.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); form.elements.amount.focus(); } });
    form.addEventListener('submit', (e) => {
      e.preventDefault(); fail('');
      const v = Object.fromEntries(new FormData(form).entries());
      let cents = 0; try { cents = U.toCents(v.amount); } catch (x) { cents = 0; }
      if (!U.isDate(v.date)) return fail('Choose the date.');
      if (!String(v.desc || '').trim()) { fail('Type the description from the statement.'); return form.elements.desc.focus(); }
      if (!cents) { fail('Enter the amount.'); return form.elements.amount.focus(); }
      rows.push({ date: v.date, description: String(v.desc).trim(), amount: sign(v.dir) * Math.abs(cents), checkNo: String(v.checkNo || '').trim() });
      OB.prefs.set('mFeedDate_' + acct, v.date);
      form.elements.desc.value = ''; form.elements.amount.value = ''; if (form.elements.checkNo) form.elements.checkNo.value = '';
      draw(); form.elements.desc.focus();
    });
    const pt = el.querySelector('#m-paste-t'), pbox = el.querySelector('#m-paste');
    pt.addEventListener('click', () => { pbox.hidden = !pbox.hidden; if (!pbox.hidden) el.querySelector('#m-paste-x').focus(); });
    el.querySelector('#m-paste-go').addEventListener('click', () => {
      const minusFlips = el.querySelector('#m-paste-sign').checked, txt = el.querySelector('#m-paste-x').value, bad = [];
      let n = 0;
      txt.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).forEach((line, k) => {
        const parts = line.indexOf('\t') >= 0 ? line.split('\t') : line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/);
        const cells = parts.map((s) => s.trim().replace(/^"|"$/g, '')).filter((s) => s !== '');
        if (cells.length < 3) { bad.push(k + 1); return; }
        const dt = (U.smartDate ? U.smartDate(cells[0], U.today()) : null) || U.parseDate(cells[0]);
        let cents; try { cents = U.toCents(cells[cells.length - 1]); } catch (x) { cents = 0; }
        if (!U.isDate(dt) || !cents) { bad.push(k + 1); return; }
        const amount = minusFlips ? (card ? (cents < 0 ? Math.abs(cents) : -Math.abs(cents)) : cents) : sign(form.querySelector('input[name=dir]:checked').value) * Math.abs(cents);
        rows.push({ date: dt, description: cells.slice(1, -1).join(', ') || '(no description)', amount, checkNo: '' }); n++;
      });
      draw();
      UI.toast(n + ' line' + (n === 1 ? '' : 's') + ' added' + (bad.length ? '; could not read line ' + bad.slice(0, 8).join(', ') + (bad.length > 8 ? '…' : '') : '') + '.', bad.length ? 'error' : '');
      if (n) el.querySelector('#m-paste-x').value = '';
    });
    draw();
  }

  function feedReview(el, r) {
    const book = b(), list = feedAccts();
    if (!list.length) return UI.go('#/m/feed');
    const acct = list.some((a) => a.id === r.params.account) ? r.params.account : (list.find((a) => book.bankLinesFor(a.id, 'review').length) || list[0]).id;
    const card = isCard(acct);
    const pl = book.sortedAccounts((a) => S.isPL(a.type) && a.active !== false);
    const xfer = book.sortedAccounts((a) => ['bank', 'cc', 'oca', 'ocl', 'ltl'].indexOf(a.type) >= 0 && a.id !== acct && a.active !== false);
    const grp = (label, accts, sel) => accts.length ? `<optgroup label="${esc(label)}">${accts.map((a) => `<option value="${esc(a.id)}"${a.id === sel ? ' selected' : ''}>${esc(book.accountFullName ? book.accountFullName(a) : a.name)}</option>`).join('')}</optgroup>` : '';
    const catOpts = (inbound, sel) => {
      const inc = pl.filter((a) => ['income', 'oi'].indexOf(a.type) >= 0), exp = pl.filter((a) => ['expense', 'cogs', 'oe'].indexOf(a.type) >= 0);
      return `<option value="">Choose a category…</option>` + (inbound ? grp('Income', inc, sel) + grp('Refunds and expenses', exp, sel) : grp('Expenses', exp, sel) + grp('Income', inc, sel))
        + grp(card && inbound ? 'Paid from (transfer)' : 'Transfer to or from', xfer, sel);
    };
    const people = book.contacts.filter((c) => c.active !== false && !c.deleted).map((c) => c.name).sort((x, y) => x.localeCompare(y));
    let filt = 'all', shown = 40;
    el.innerHTML = page('Review', `
      ${pickAcct(acct, '#/m/feed/review?account=')}
      <div class="m-chips" role="tablist"><button type="button" role="tab" data-rf="all" aria-selected="true">All</button><button type="button" role="tab" data-rf="sug" aria-selected="false">Has a suggestion</button><button type="button" role="tab" data-rf="in" aria-selected="false">${card ? 'Payments' : 'Money in'}</button><button type="button" role="tab" data-rf="out" aria-selected="false">${card ? 'Charges' : 'Money out'}</button></div>
      <div id="m-rv-top"></div><div id="m-rv"></div>
      <datalist id="m-rv-people">${people.map((p) => `<option value="${esc(p)}">`).join('')}</datalist>`,
      { back: '#/m/feed', sub: accName(acct), right: `<a class="m-head-btn" href="#/m/feed/enter?account=${encodeURIComponent(acct)}">+ Lines</a>` });
    wirePick(el);
    const host = el.querySelector('#m-rv'), top = el.querySelector('#m-rv-top');
    const card1 = (l) => {
      const sug = book.bankSuggestion(l.id), cands = book.bankCandidates(l.id), best = cands.find((c) => c.best && c.kind === 'register');
      const bt = best ? book.txById[best.txnId] : null, inbound = l.amount > 0;
      return `<article class="m-card m-rl" data-id="${esc(l.id)}" data-testid="m-review-line">
        <header><span class="m-rl-d">${esc(fmtDay(l.date))}<small>${esc(l.date.slice(0, 4))}</small></span><b>${esc(l.description)}</b><i class="${inbound ? 'in' : 'out'}">${inbound ? '+' : '−'}${money(l.amount)}</i></header>
        ${bt ? `<div class="m-rl-match">${icon(I.check)}<span><b>Already in VaultBook?</b><small>${esc(txLabel(bt))}${bt.number ? ' ' + esc(bt.number) : ''} · ${esc(UI.contactName(bt.contactId) || bt.memo || '')} · ${esc(U.fmtDate(bt.date))}</small></span><button type="button" class="m-btn small" data-act="match" data-txn="${esc(best.txnId)}" data-si="${best.splitIndex}">Match</button></div>` : ''}
        <label class="m-f"><span>Category${sug ? ` <em class="m-sug">${esc(sug.source === 'rule' ? 'from your rule' : 'suggested')}</em>` : ''}</span><select data-k="cat">${catOpts(inbound, sug ? sug.categoryId : '')}</select></label>
        <label class="m-f"><span>${inbound ? 'Received from' : 'Paid to'} (optional)</span><input data-k="who" list="m-rv-people" value="${esc(sug && sug.contactId ? UI.contactName(sug.contactId) : '')}" autocapitalize="words"></label>
        <div class="m-rl-btns"><button type="button" class="m-btn primary" data-act="add">${sug ? 'Accept' : 'Add'}</button><button type="button" class="m-btn ghost" data-act="excl">Exclude</button></div>
        <p class="m-err" hidden></p></article>`;
    };
    const lines = () => book.bankLinesFor(acct, 'review').slice().reverse().filter((l) => filt === 'all' || (filt === 'in' ? l.amount > 0 : filt === 'out' ? l.amount < 0 : !!book.bankSuggestion(l.id)));
    const draw = () => {
      const all = lines(), withSug = book.bankLinesFor(acct, 'review').filter((l) => book.bankSuggestion(l.id));
      markTab();
      top.innerHTML = all.length || withSug.length ? `<div class="m-rv-sum"><span><b>${book.bankLinesFor(acct, 'review').length}</b> to review</span>${withSug.length ? `<button type="button" class="m-btn small primary" id="m-acc-all">Accept ${withSug.length} suggestion${withSug.length === 1 ? '' : 's'}</button>` : ''}</div>` : '';
      host.innerHTML = all.length ? all.slice(0, shown).map(card1).join('') + (all.length > shown ? `<button type="button" class="m-btn ghost" id="m-rv-more">Show ${Math.min(40, all.length - shown)} more of ${all.length - shown}</button>` : '')
        : `<section class="m-card m-done">${icon(I.check)}<h2>All caught up</h2><p class="m-note">Nothing left to review for ${esc(accName(acct))}.</p><a class="m-btn primary" href="#/m/feed/enter?account=${encodeURIComponent(acct)}">Enter more statement lines</a><a class="m-btn ghost" href="#/m/feed">Back to bank feed</a></section>`;
      const more = host.querySelector('#m-rv-more'); if (more) more.addEventListener('click', () => { shown += 40; draw(); });
      const accAll = top.querySelector('#m-acc-all'); if (accAll) accAll.addEventListener('click', async () => {
        const go = withSug.slice(); if (!(await UI.confirm('Accept suggestions?', `Post ${go.length} line${go.length === 1 ? '' : 's'} with the suggested category? You can undo any of them later in the full bank feed.`, { ok: 'Post ' + go.length }))) return;
        accAll.disabled = true; let ok = 0, bad = 0;
        for (const l of go) { const s = book.bankSuggestion(l.id); if (!s) continue; try { await book.postBankLine(l.id, { kind: 'add', categoryId: s.categoryId, contactId: s.contactId || '' }); ok++; } catch (x) { bad++; } }
        UI.toast(ok + ' posted' + (bad ? ', ' + bad + ' need a look' : '') + '.', bad ? 'error' : ''); draw();
      });
    };
    host.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-act]'); if (!btn) return;
      const art = btn.closest('.m-rl'), id = art.dataset.id, l = book.bankLineById[id], er = art.querySelector('.m-err');
      er.hidden = true; btn.disabled = true;
      try {
        if (btn.dataset.act === 'excl') await book.excludeBankLines([id], 'Excluded on ' + (isPhone() ? 'phone' : 'tablet'));
        else if (btn.dataset.act === 'match') await book.postBankLine(id, { kind: 'match', txnId: btn.dataset.txn, splitIndex: +btn.dataset.si });
        else {
          const cat = art.querySelector('[data-k=cat]').value;
          if (!cat) throw new Error('Choose a category first.');
          const ct = accType(cat), transfer = ['bank', 'cc', 'oca', 'ocl', 'ltl'].indexOf(ct) >= 0;
          const contactId = transfer ? '' : await contactFor(art.querySelector('[data-k=who]').value, l.amount > 0 ? 'customer' : 'vendor');
          await book.postBankLine(id, transfer ? { kind: 'transfer', accountId: cat } : { kind: 'add', categoryId: cat, contactId });
        }
        art.classList.add('m-gone'); setTimeout(draw, 180);
      } catch (x) { btn.disabled = false; er.textContent = x.message || String(x); er.hidden = false; }
    });
    el.querySelectorAll('[data-rf]').forEach((x) => x.addEventListener('click', () => { filt = x.dataset.rf; shown = 40; el.querySelectorAll('[data-rf]').forEach((y) => y.setAttribute('aria-selected', String(y === x))); draw(); }));
    draw();
  }
  const feed = (el, r) => ({ enter: feedEnter, review: feedReview }[r.sub] || feedHub)(el, r);

  /* ---------- Add sheet (bottom sheet with every way to record something) ---------- */
  function addSheet() {
    if (document.getElementById('m-sheet')) return;
    const T = (h, ic, l) => `<a href="${h}" class="m-tile">${icon(ic)}<span>${esc(l)}</span></a>`;
    const wrap = document.createElement('div');
    wrap.id = 'm-sheet'; wrap.className = 'm-sheet-wrap'; wrap.setAttribute('data-overlay', '');
    wrap.innerHTML = `<div class="m-sheet" role="dialog" aria-modal="true" aria-label="Add">
      <div class="m-grab" aria-hidden="true"></div><h2>Add</h2>
      <div class="m-tiles">
        ${T('#/m/feed/enter', I.bank, 'Enter statement')}${T('#/m/feed/review', I.check, 'Review bank lines')}${T('#/m/add?kind=expense', I.out, 'Expense')}${T('#/m/add?kind=income', I.in, 'Income')}${T('#/m/add?kind=transfer', I.swap, 'Transfer')}
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
  /* a floating tab bar that only navigates, with the Add action in its own round button beside it */
  tabbar.innerHTML = `<div class="m-tabs"><a href="#/m" data-tab="home">${icon(I.home)}<span>Home</span></a>
    <a href="#/m/feed" data-tab="feed" data-testid="m-tab-feed">${icon(I.bank)}<span>Bank Feed</span><i class="m-tab-badge" hidden></i></a>
    <a href="#/m/activity" data-tab="activity">${icon(I.list)}<span>Activity</span></a>
    <a href="#/m/more" data-tab="more">${icon(I.more)}<span>More</span></a></div>
    <button type="button" class="m-tab-add" data-m-add aria-label="Add">${icon(I.plus)}</button>`;
  document.body.appendChild(tabbar);
  const markTab = () => {
    const h = location.hash, r = UI.parseHash();
    const tab = r.name === 'm' ? (r.id === 'reports' ? 'home' : r.id || 'home') : /^#\/(bankfeed|rules|reconcile|pdfimport|import)/.test(h) ? 'feed' : /^#\/(transactions|txn|register|find)/.test(h) ? 'activity' : 'more';
    const bd = tabbar.querySelector('.m-tab-badge');
    if (bd && UI.book && UI.book.bankLinesFor) { const n = UI.book.bankLines.filter((l) => l.status === 'review').length; bd.hidden = !n; bd.textContent = n > 99 ? '99+' : String(n); }
    tabbar.querySelectorAll('[data-tab]').forEach((a) => { if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  };
  window.addEventListener('hashchange', markTab);

  /* ---------- routes ---------- */
  UI.routes.m = (el, r) => {
    if (r.id === 'feed' && (isPhone() || touchMQ.matches)) { root.classList.add('m-screen'); feed(el, r); markTab(); return; }
    if (!isPhone()) { const map = { activity: '#/transactions', reports: '#/reports', more: '#/gateway', add: '#/txn/new?type=' + ((KINDS[r.params.kind] || KINDS.expense).full) }; location.replace(map[r.id] || '#/dashboard'); return; }
    root.classList.add('m-screen');
    ({ activity, add, reports, more }[r.id] || home)(el, r);
    markTab();
  };
  /* on a phone the landing screens open the mobile Home; ?full=1 still shows the classic screen */
  const bf0 = UI.routes.bankfeed;
  if (bf0) UI.routes.bankfeed = (el, r) => {
    if ((isPhone() || touchMQ.matches) && !Object.keys(r.params || {}).length) { location.replace('#/m/feed'); return; }
    return bf0(el, r);
  };
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
