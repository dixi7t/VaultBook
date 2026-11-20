/* VaultBook — Studio screens (1.25): the top bar's period and + New buttons, the Banking badge, the home tabs
 * (Get things done = Gateway, Business overview = Dashboard), the Business overview widgets and the + New menu.
 * Every existing key keeps working: F10 and + New open the same menu, F2 / Alt+F2 the same date and period
 * dialogs, G H / G D the two home tabs. Numbers come from OB.reports.home (engine), not from this file.
 */
(function () {
  'use strict';
  const OB = window.OB, UI = OB.ui, U = OB.util, R = OB.reports, esc = U.esc;
  const routes = UI.routes;

  /* ---------------- top bar and side menu, refreshed after every screen ---------------- */
  const per = document.getElementById('st-period'), nw = document.getElementById('st-new');
  if (per) per.addEventListener('click', () => { if (UI.book) UI.changePeriod(); });
  if (nw) nw.addEventListener('click', () => { if (UI.book) UI.newMenu(); });
  function refresh() {
    if (!UI.book) return;
    const p = UI.currentPeriod(), t = document.getElementById('st-period-text');
    if (t && p) t.textContent = U.fmtDate(p.from) + ' – ' + U.fmtDate(p.to);
    const link = document.querySelector('.nav a[data-testid=nav-bankfeed]');
    if (link) {
      const b = UI.book, n = b.bankLinesFor ? U.sum(b.accounts.filter((a) => (a.type === 'bank' || a.type === 'cc') && a.active), (a) => b.bankLinesFor(a.id, 'review').length) : 0;
      let badge = link.querySelector('.st-badge');
      if (n && !badge) { badge = document.createElement('span'); badge.className = 'st-badge'; badge.setAttribute('data-testid', 'nav-bankfeed-count'); link.appendChild(badge); }
      if (badge) { if (n) { badge.textContent = n > 999 ? '999+' : String(n); badge.title = n + ' bank line' + (n === 1 ? '' : 's') + ' to review'; } else badge.remove(); }
      // the Banking group shows the same count while its menu is folded
      const parent = link.closest('.nav-grp') && link.closest('.nav-grp').querySelector('.nav-parent');
      if (parent) {
        let pb = parent.querySelector('.st-badge');
        if (n && !pb) { pb = document.createElement('span'); pb.className = 'st-badge'; pb.setAttribute('aria-hidden', 'true'); parent.insertBefore(pb, parent.querySelector('.nav-caret')); }
        if (pb) { if (n) pb.textContent = n > 999 ? '999+' : String(n); else pb.remove(); }
      }
    }
  }
  const orig = UI.render;
  const wrapped = function () { const x = orig.apply(this, arguments); try { refresh(); } catch (e) { console.error(e); } return x; };
  Object.keys(orig).forEach((k) => { wrapped[k] = orig[k]; });
  UI.render = wrapped;

  /* ---------------- home tabs ---------------- */
  UI.homeTabs = (cur) => `<nav class="st-hometabs" aria-label="Home" data-testid="home-tabs">
      <a href="#/gateway"${cur === 'gateway' ? ' aria-current="page"' : ''} data-testid="home-tab-gateway">Get things done</a>
      <a href="#/dashboard"${cur === 'dashboard' ? ' aria-current="page"' : ''} data-testid="home-tab-dashboard">Business overview</a>
      <span class="spacer"></span>${cur === 'dashboard' ? `<button type="button" class="btn small" id="st-privacy" aria-pressed="${!!OB.prefs.get('homePrivacy')}" data-testid="home-privacy" title="Hide amounts on this page (for screen sharing)">${OB.prefs.get('homePrivacy') ? 'Show amounts' : 'Privacy'}</button><button type="button" class="btn small" id="st-wcustom" data-testid="home-customize">Customize</button><a class="btn small" href="#/snapshot">Company Snapshot</a>` : ''}</nav>`;
  const gw = routes.gateway;
  routes.gateway = function (el) {
    const x = gw.apply(this, arguments);
    const pg = el.querySelector('.gateway-page'), h1 = pg && pg.querySelector('h1');
    if (h1) h1.insertAdjacentHTML('afterend', UI.homeTabs('gateway'));
    return x;
  };

  /* ---------------- Business overview (G1) ---------------- */
  const IC = {
    invoice: '<path d="M6 3h9l4 4v14H6z"/><path d="M9 12h7M9 16h5"/>',
    expense: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18"/>',
    deposit: '<path d="M12 4v12M7 11l5 5 5-5M4 20h16"/>',
    pay: '<path d="M4 7h16v10H4z"/><circle cx="12" cy="12" r="2.5"/>',
    rec: '<path d="M5 12l4 4 10-10"/>',
    pnl: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    bank: '<path d="M3 10h18M5 10v8M9 10v8M15 10v8M19 10v8M2 21h20M12 3l9 5H3z"/>'
  };
  const icon = (k) => `<span class="st-ic"><svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${IC[k]}</svg></span>`;
  const DONUT = ['var(--chart-1, #2452c7)', 'var(--chart-2, #7c9ae6)', 'var(--chart-3, #f2c94c)', 'var(--chart-4, #bcc3cf)'];   // themed: dark teal disappears on the dark surface
  const pct = (a, t) => t > 0 ? Math.max(0, Math.min(100, Math.round(a / t * 1000) / 10)) : 0;
  const money = (c) => UI.money(c, { symbol: true });

  function donut(rows, total) {
    const C = 2 * Math.PI * 60; let off = 0;
    const segs = total > 0 ? rows.map((r, i) => { const len = r.amount / total * C, s = `<circle cx="80" cy="80" r="60" fill="none" style="stroke:${DONUT[i]}" stroke-width="26" stroke-dasharray="${len.toFixed(2)} ${C.toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 80 80)"/>`; off += len; return s; }).join('')
      : `<circle cx="80" cy="80" r="60" fill="none" stroke="var(--line)" stroke-width="26"/>`;
    const label = total > 0 ? 'Expenses: ' + rows.map((r) => r.label + ' ' + pct(r.amount, total) + '%').join(', ') : 'No expenses in this period';
    return `<svg role="img" aria-label="${esc(label)}" width="132" height="132" viewBox="0 0 160 160">${segs}</svg>`;
  }

  routes.dashboard = (el) => {
    // the profit figures use the same period as the top bar (Alt+F2), so they agree with the reports
    const b = UI.book, today = UI.workDate ? UI.workDate() : U.today(), per = UI.currentPeriod ? UI.currentPeriod() : null;
    const h = R.home(b, today, per && per.from <= today ? { from: per.from, to: per.to } : undefined), d = R.dashboard(b, today);
    const due = b.dueRecurring();
    const recent = R.transactionList(b, { status: 'posted' }).slice(0, 8);
    const rng = (from, to) => UI.qs({ range: 'custom', from, to });
    const drill = (node, from, to) => '#/report/txdetail?' + UI.qs({ src: 'pnl', node, range: 'custom', from, to });

    // a change is only shown when both periods made a profit; a percentage across a loss means nothing
    const p = h.pnl, ch = p.change === null || p.net <= 0 || p.prevNet <= 0 ? '' : ` · ${p.change >= 0 ? 'up' : 'down'} ${Math.abs(Math.round(p.change * 100))}% on the ${h.days} days before`;
    const top = Math.max(p.income, p.expense, 1);
    const wPnl = `<section class="st-w" aria-labelledby="w-pnl" data-testid="w-pnl">
        <div class="st-wh"><h2 id="w-pnl">Profit and loss</h2><span data-testid="w-pnl-period">${esc(U.fmtDate(h.from) + ' – ' + U.fmtDate(h.to))}</span></div>
        <div><a class="st-big plain-link" href="#/report/pnl?${esc(rng(h.from, h.to))}">${money(p.net)}</a><div class="st-note">${p.net >= 0 ? 'Net profit' : 'Net loss'}${esc(ch)}</div></div>
        <a class="st-bar plain-link" href="${esc(drill('net:inc', h.from, h.to))}"><span class="st-bl"><span>Income</span><b>${money(p.income)}</b></span><span class="st-track"><i style="width:${pct(p.income, top)}%;background:var(--accent)"></i></span></a>
        <a class="st-bar plain-link" href="${esc(drill('net:exp', h.from, h.to))}"><span class="st-bl"><span>Expenses</span><b>${money(p.expense)}</b></span><span class="st-track"><i style="width:${pct(p.expense, top)}%;background:var(--chart-2)"></i></span></a>
        <a class="st-more" href="#/report/pnl?${esc(rng(h.from, h.to))}">See profit and loss</a></section>`;

    const ex = h.expenses;
    const wExp = `<section class="st-w" aria-labelledby="w-exp" data-testid="w-expenses">
        <div class="st-wh"><h2 id="w-exp">Expenses</h2><span>${esc(U.fmtDate(h.from) + ' – ' + U.fmtDate(h.to))}</span></div>
        <div class="st-donut">${donut(ex.rows, ex.total)}<div class="st-legend">${ex.rows.length ? ex.rows.map((r, i) => `<span><i style="background:${DONUT[i]}"></i><em title="${esc(r.label)}">${esc(r.label)}</em><b>${esc(U.fmt(r.amount))}</b></span>`).join('') : '<span class="muted">Nothing spent yet.</span>'}</div></div>
        <a class="st-more" href="${esc(drill('net:exp', h.from, h.to))}">See all expenses</a></section>`;

    const wBank = `<section class="st-w" aria-labelledby="w-bank" data-testid="w-banks">
        <div class="st-wh"><h2 id="w-bank">Bank accounts</h2><span>As of ${esc(U.fmtDate(today))}</span></div>
        ${h.banks.length ? h.banks.slice(0, 5).map((x) => `<div class="st-acct">
          <span class="st-at"><a class="st-name" href="#/register/${esc(x.account.id)}">${esc(x.account.name)}</a>${x.review ? `<a class="st-pill warn" href="#/bankfeed?account=${esc(x.account.id)}">${x.review} to review</a>` : x.bank ? '<span class="st-pill ok">Reviewed</span>' : ''}</span>
          ${x.bank ? `<span class="st-ab"><span>Bank balance${x.bank.date ? ' ' + esc(U.fmtDate(x.bank.date)) : ''}</span><span>${money(x.bank.amount)}</span></span>` : ''}
          <span class="st-ab"><span>In VaultBook</span><span>${money(x.balance)}</span></span></div>`).join('') : '<p class="muted">No bank or card accounts yet.</p>'}
        <a class="st-more" href="#/bankfeed">Go to banking</a></section>`;

    const iv = h.invoices, unpaid = iv.overdue.total + iv.notDue.total, paid = iv.paid30;
    const wInv = `<section class="st-w span2" aria-labelledby="w-inv" data-testid="w-invoices">
        <div class="st-wh"><h2 id="w-inv">Invoices</h2><a href="#/txn/new?type=invoice">Create invoice</a></div>
        <a class="st-bar plain-link" href="#/report/araging"><span class="st-bl"><span><b>${money(unpaid)}</b> unpaid</span><span class="muted">Open now</span></span>
          <span class="st-track" role="img" aria-label="${esc(U.fmt(iv.overdue.total, { symbol: true }) + ' overdue, ' + U.fmt(iv.notDue.total, { symbol: true }) + ' not due yet')}"><i style="width:${pct(iv.overdue.total, unpaid)}%;background:#c2571a"></i><i style="width:${pct(iv.notDue.total, unpaid)}%;background:var(--line)"></i></span></a>
        <div class="st-inv-legend"><span class="over">${money(iv.overdue.total)} overdue (${iv.overdue.count})</span><span>${money(iv.notDue.total)} not due yet (${iv.notDue.count})</span></div>
        <a class="st-bar plain-link" href="#/transactions?type=payment"><span class="st-bl"><span><b>${money(paid)}</b> paid</span><span class="muted">Last 30 days</span></span>
          <span class="st-track" role="img" aria-label="${esc(U.fmt(Math.max(0, paid - iv.undeposited), { symbol: true }) + ' deposited, ' + U.fmt(iv.undeposited, { symbol: true }) + ' not deposited')}"><i style="width:${pct(Math.max(0, paid - iv.undeposited), Math.max(paid, iv.undeposited))}%;background:var(--accent)"></i><i style="width:${pct(Math.min(iv.undeposited, Math.max(paid, iv.undeposited)), Math.max(paid, iv.undeposited))}%;background:var(--chart-2)"></i></span></a>
        <div class="st-inv-legend"><span>${money(Math.max(0, paid - iv.undeposited))} deposited</span><span>${money(iv.undeposited)} not deposited${iv.undeposited ? ' · <a href="#/txn/new?type=deposit">Make a deposit</a>' : ''}</span></div></section>`;

    const tasks = [];
    if (h.toReview) tasks.push(['#/bankfeed', `Review ${h.toReview} bank line${h.toReview === 1 ? '' : 's'}`, '']);
    if (h.bills.dueSoon.count) tasks.push(['#/txn/new?type=billPayment', `Pay ${h.bills.dueSoon.count} bill${h.bills.dueSoon.count === 1 ? '' : 's'} due this week`, money(h.bills.dueSoon.total)]);
    if (iv.overdue.count) tasks.push(['#/report/araging', `Follow up ${iv.overdue.count} overdue invoice${iv.overdue.count === 1 ? '' : 's'}`, money(iv.overdue.total)]);
    if (due.length) tasks.push(['#/recurring', `Post ${due.length} recurring transaction${due.length === 1 ? '' : 's'}`, '']);
    if (iv.undeposited) tasks.push(['#/txn/new?type=deposit', 'Deposit payments waiting in Undeposited Funds', money(iv.undeposited)]);
    // a new company gets four first steps instead of an empty task list; each ticks itself off from the books
    const bk = UI.book, steps = [
      ['#/accounts', 'Add your bank account and its opening balance', bk.transactions.some((t) => t.splits.some((x) => (bk.accById[x.accountId] || {}).type === 'bank'))],
      ['#/customers', 'Add your first customer', bk.contacts.some((c) => c.kind === 'customer')],
      ['#/txn/new?type=invoice', 'Create your first invoice', bk.transactions.some((t) => t.type === 'invoice')],
      ['#/bankfeed?import=1', 'Bring in your bank transactions', (bk.bankLines || []).length > 0]];
    const setup = steps.some((x) => !x[2]) && bk.transactions.length < 25;
    const wTask = `<section class="st-w" aria-labelledby="w-task" data-testid="w-tasks">
        <div class="st-wh"><h2 id="w-task">${setup && !tasks.length ? 'Get started' : 'Tasks'}</h2>${setup && !tasks.length ? `<span>${steps.filter((x) => x[2]).length} of 4 done</span>` : ''}</div>
        ${tasks.length ? tasks.map((t) => `<a class="st-task" href="${esc(t[0])}"><span>${esc(t[1])}</span><b>${t[2]}</b></a>`).join('')
          : setup ? `<ol class="st-setup" data-testid="setup-steps">${steps.map((x) => `<li class="${x[2] ? 'done' : ''}"><a class="st-task" href="${esc(x[0])}"><span>${x[2] ? '<span class="sr-only">Done: </span>' : ''}${esc(x[1])}</span><b aria-hidden="true">${x[2] ? '✓' : ''}</b></a></li>`).join('')}</ol>`
          : '<p class="muted">Nothing needs your attention right now.</p>'}</section>`;

    // the 12-month chart and fiscal-year totals (unchanged drill-downs: every bar opens what it shows)
    const maxV = Math.max(1, ...d.months.map((m) => Math.max(m.income, m.expense))), W = 1200, H = 150, bw = W / 12;
    const pnlFor = (from, to) => '#/report/pnl?' + UI.qs({ range: 'custom', from, to });
    const chart = `<svg viewBox="0 0 ${W} ${H + 24}" class="chart dash-chart" role="group" aria-label="Income and expenses by month, last 12 months. Choose a bar to see its transactions." data-testid="dash-chart">
      ${d.months.map((m, i) => {
        const hi = Math.max(0, m.income) / maxV * H, he = Math.max(0, m.expense) / maxV * H, x = i * bw + bw * 0.18, full = U.monthLabel(m.from);
        return `<g>
          <a href="${esc(drill('net:inc', m.from, m.to))}" class="bar-link" data-testid="bar-in" aria-label="${esc(full + ' income ' + U.fmt(m.income, { symbol: true }))}"><title>${esc(full)} income ${U.fmt(m.income, { symbol: true })} — open</title>
            <rect x="${i * bw + bw * 0.12}" y="0" width="${bw * 0.38}" height="${H}" class="bar-hit"/><rect x="${x}" y="${H - hi}" width="${bw * 0.3}" height="${hi}" rx="2" class="bar-in"/></a>
          <a href="${esc(drill('net:exp', m.from, m.to))}" class="bar-link" data-testid="bar-out" aria-label="${esc(full + ' expenses ' + U.fmt(m.expense, { symbol: true }))}"><title>${esc(full)} expenses ${U.fmt(m.expense, { symbol: true })} — open</title>
            <rect x="${i * bw + bw * 0.5}" y="0" width="${bw * 0.38}" height="${H}" class="bar-hit"/><rect x="${x + bw * 0.34}" y="${H - he}" width="${bw * 0.3}" height="${he}" rx="2" class="bar-out"/></a>
          <a href="${esc(pnlFor(m.from, m.to))}" class="bar-link" aria-label="${esc('Profit and loss for ' + full)}"><title>Profit and loss, ${esc(full)}</title><text x="${i * bw + bw / 2}" y="${H + 16}" text-anchor="middle">${m.label}</text></a></g>`;
      }).join('')}<line x1="0" y1="${H}" x2="${W}" y2="${H}" class="axis"/></svg>`;
    const wYear = `<section class="st-w span3" aria-labelledby="w-year" style="grid-column: 1 / -1" data-testid="w-year">
        <div class="st-wh"><h2 id="w-year">Income and expenses by month</h2><span>Last 12 months · ${esc(b.company.basis)} basis</span></div>
        <div class="kpis">
          <a class="kpi" href="${esc(drill('net:inc', d.fyStart, today))}" data-testid="kpi-income"><span>Income</span><b>${money(d.ytdIncome)}</b></a>
          <a class="kpi" href="${esc(drill('net:exp', d.fyStart, today))}" data-testid="kpi-expense"><span>Expenses</span><b>${money(d.ytdExpense)}</b></a>
          <a class="kpi" href="#/report/pnl?range=fyToDate"><span>Net income</span><b>${money(d.ytdNet)}</b></a></div>
        ${chart}<div class="legend"><span class="key in"></span>Income <span class="key out"></span>Expenses</div></section>`;
    const wRecent = `<section class="st-w st-recent" aria-labelledby="w-rec" style="grid-column: 1 / -1" data-testid="w-recent">
        <div class="st-wh"><h2 id="w-rec">Recent transactions</h2><a href="#/transactions">View all</a></div>
        ${recent.length ? `<div class="scroll-x"><table class="data"><thead><tr><th>Date</th><th>Type</th><th>No.</th><th>Name</th><th>Memo</th><th class="num">Amount</th></tr></thead><tbody>
        ${recent.map((t) => `<tr class="click" data-href="#/txn/${esc(t.id)}"><td>${UI.date(t.date)}</td><td>${esc(UI.typeLabel(t.type))}</td><td>${esc(t.number)}</td><td>${esc(UI.contactName(t.contactId))}</td><td class="memo">${esc(t.memo)}</td><td class="num">${UI.money(t.total)}</td></tr>`).join('')}
        </tbody></table></div>` : UI.empty('No transactions yet. Start by recording a sale, an expense, or importing your bank statement.', '<div class="row gap"><a class="btn" href="#/txn/new?type=invoice">Create invoice</a><a class="btn" href="#/txn/new?type=expense">Record expense</a><a class="btn" href="#/bankfeed?import=1">Import bank file</a></div>')}</section>`;

    const sc = [['#/txn/new?type=invoice', 'invoice', 'Create invoice', 'F8'], ['#/txn/new?type=expense', 'expense', 'Record expense', 'F5'], ['#/txn/new?type=deposit', 'deposit', 'Bank deposit', ''],
      ['#/txn/new?type=billPayment', 'pay', 'Pay bills', 'Alt+F9'], ['#/reconcile', 'rec', 'Reconcile', ''], ['#/report/pnl', 'pnl', 'Profit and loss', '']];
    el.innerHTML = `<div class="page st-home"><h1 class="sr-only">Business overview</h1>${UI.homeTabs('dashboard')}
      <nav class="st-shortcuts" aria-label="Shortcuts" data-testid="home-shortcuts">${sc.map((s) => `<a href="${esc(s[0])}">${icon(s[1])}${esc(s[2])}${s[3] ? `<kbd>${esc(s[3])}</kbd>` : ''}</a>`).join('')}</nav>
      <div class="st-widgets dash">${homeLayout().filter((x) => x.on).map((x) => ({ pnl: wPnl, expenses: wExp, banks: wBank, invoices: wInv, tasks: wTask, year: wYear, recent: wRecent })[x.id]).join('') || '<p class="muted">All widgets are hidden. Choose Customize to show some.</p>'}</div></div>`;
    el.querySelector('.st-home').classList.toggle('st-private', !!OB.prefs.get('homePrivacy'));
    el.querySelector('#st-privacy').addEventListener('click', () => { OB.prefs.set('homePrivacy', !OB.prefs.get('homePrivacy')); UI.render(); });
    el.querySelector('#st-wcustom').addEventListener('click', customizeHome);
    UI.bindRowLinks(el);
  };

  /* Business overview layout: which widgets show, in what order (a browser preference). */
  const WIDGETS = [['pnl', 'Profit and loss'], ['expenses', 'Expenses'], ['banks', 'Bank accounts'], ['invoices', 'Invoices'], ['tasks', 'Tasks'], ['year', 'Income and expenses by month'], ['recent', 'Recent transactions']];
  function homeLayout() {
    const saved = (OB.prefs.get('homeWidgets') || []).filter((x) => x && WIDGETS.some((w) => w[0] === x.id));
    const out = saved.map((x) => ({ id: x.id, on: x.on !== false }));
    WIDGETS.forEach(([id]) => { if (!out.some((x) => x.id === id)) out.push({ id, on: true }); });   // widgets added later show up
    return out;
  }
  UI.homeLayout = homeLayout;
  function customizeHome() {
    const name = (id) => (WIDGETS.find((w) => w[0] === id) || [id, id])[1];
    const row = (x) => `<li class="st-bme" data-id="${esc(x.id)}"><label class="check" style="flex:1"><input type="checkbox"${x.on ? ' checked' : ''}> ${esc(name(x.id))}</label>
      <button type="button" class="btn small ghost" data-mv="-1" aria-label="Move ${esc(name(x.id))} up">↑</button><button type="button" class="btn small ghost" data-mv="1" aria-label="Move ${esc(name(x.id))} down">↓</button></li>`;
    UI.modal({ title: 'Customize Business overview', html: `<ol class="st-bmlist" id="st-wlist" data-testid="home-customize-list">${homeLayout().map(row).join('')}</ol>`,
      onMount: (m) => m.querySelector('#st-wlist').addEventListener('click', (e) => {
        const mv = e.target.closest('[data-mv]'); if (!mv) return;
        const li = mv.closest('li'), to = +mv.dataset.mv < 0 ? li.previousElementSibling : li.nextElementSibling; if (!to) return;
        if (+mv.dataset.mv < 0) to.before(li); else to.after(li); mv.focus();
      }),
      actions: [{ label: 'Reset', value: 'reset' }, { label: 'Cancel', value: null }, { label: 'Save', primary: true, collect: (m) => [...m.querySelectorAll('#st-wlist li')].map((li) => ({ id: li.dataset.id, on: li.querySelector('input').checked })) }] })
      .then((v) => { if (!v) return; OB.prefs.set('homeWidgets', v === 'reset' ? [] : v); UI.render(); });
  }

  /* ---------------- + New menu (G3) ---------------- */
  const KEYS = { invoice: 'F8', payment: 'F6', salesReceipt: 'Alt+F8', creditMemo: 'Alt+F6', expense: 'F5', bill: 'F9', billPayment: 'Alt+F9', vendorCredit: 'Alt+F5', transfer: 'F4', journal: 'F7' };
  const WORDS = { payment: 'receive customer paid money in', salesReceipt: 'cash sale paid now', expense: 'spent bought card cash purchase', check: 'cheque paid', bill: 'owe vendor invoice payable',
    billPayment: 'pay bills', deposit: 'bank money in', transfer: 'move between accounts', journal: 'adjust entry je', creditMemo: 'refund credit customer', ccCredit: 'card refund', estimate: 'quote' };
  UI.newMenu = () => {
    const b = UI.book; if (!b) return;
    const T = (t) => ({ label: UI.typeLabel(t), href: '#/txn/new?type=' + t, key: KEYS[t] || '', words: WORDS[t] || '' });
    const groups = [
      ['Customers', ['invoice', 'payment', 'estimate', 'salesOrder', 'salesReceipt', 'creditMemo', 'customerRefund'].map(T).concat([{ label: 'Customer', act: () => UI.editContact(null, 'customer'), words: 'new customer' }])],
      ['Vendors', ['expense', 'check', 'bill', 'billPayment', 'purchaseOrder', 'vendorCredit', 'vendorRefund', 'ccCredit'].map(T).concat([{ label: 'Vendor', act: () => UI.editContact(null, 'vendor'), words: 'new vendor supplier' }])],
      ['Bank and accounting', ['deposit', 'transfer', 'journal'].map(T).concat([
        { label: 'Import bank file', href: '#/bankfeed?import=1', words: 'statement csv ofx qbo pdf bank feed' },
        { label: 'Reconcile', href: '#/reconcile', words: 'statement match' },
        { label: 'Account', act: () => UI.editAccount(null), words: 'chart of accounts new' }])]
    ];
    const mine = R.transactionList(b, { status: 'posted' }).filter((t) => ['invoice', 'bill', 'expense', 'check', 'salesReceipt', 'deposit', 'journal'].indexOf(t.type) >= 0).slice(0, 3);
    const recent = mine.map((t) => ({ label: UI.typeLabel(t.type) + (t.number ? ' ' + t.number : '') + (UI.contactName(t.contactId) ? ' · ' + UI.contactName(t.contactId) : ''), sub: 'Duplicate it', href: '#/txn/new?type=' + t.type + '&copy=' + t.id, words: 'recent copy duplicate' }));
    const all = [];
    const item = (x) => { const i = all.push(x) - 1; return `<a href="${x.href ? esc(x.href) : '#'}" class="${x.sub ? 'st-recent' : ''}" data-nm="${i}" tabindex="-1">${x.sub ? `<span>${esc(x.label)}</span><small>${esc(x.sub)}</small>` : `<span>${esc(x.label)}</span>${x.key ? `<kbd>${esc(x.key)}</kbd>` : ''}`}</a>`; };
    const html = `<div class="st-nm-top"><label for="nm-q"><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>
        <input id="nm-q" type="search" autocomplete="off" placeholder="Type to filter: “bill”, “paid”, “card”…" aria-label="Filter what to create" aria-controls="nm-list"></label>
        <span class="muted small">↑ ↓ ← → move · Enter open · F-keys work here too · Esc close</span></div>
      <div class="newmenu st-nm" id="nm-list" data-testid="new-menu">${groups.map((g) => `<div role="group" aria-label="${esc(g[0])}"><h3>${esc(g[0])}</h3>${g[1].map(item).join('')}</div>`).join('')}
        <div role="group" aria-label="Recently used"><h3>Recently used</h3>${recent.length ? recent.map(item).join('') : '<p class="muted small">Your recent entries show here, ready to duplicate.</p>'}
          <div class="st-nm-tip">Not sure which one? Type what happened, like “customer paid” or “bought on the card”.</div></div>
        <p class="st-nm-none" hidden>Nothing matches. Try another word.</p></div>`;
    return UI.modal({ title: 'Create new', html, wide: true, cls: 'st-newm', actions: [{ label: 'Close', value: null }], onMount: (m, close) => {
      const q = m.querySelector('#nm-q'), links = [...m.querySelectorAll('[data-nm]')], none = m.querySelector('.st-nm-none');
      let on = -1;
      const vis = () => links.filter((a) => !a.hidden);
      const mark = (a) => { links.forEach((x) => x.classList.toggle('on', x === a)); on = a ? links.indexOf(a) : -1; if (a) a.scrollIntoView({ block: 'nearest' }); };
      const open = (a) => { const x = all[+a.dataset.nm]; close(null); if (x.act) Promise.resolve(x.act()).then((r) => { if (r) UI.render(); }).catch(UI.error); else UI.go(x.href); };
      const filter = () => {
        const s = q.value.trim().toLowerCase();
        links.forEach((a) => { const x = all[+a.dataset.nm]; a.hidden = !!s && !(x.label + ' ' + (x.words || '')).toLowerCase().split(/\s+/).some((w) => w.indexOf(s) === 0) && x.label.toLowerCase().indexOf(s) < 0; });
        m.querySelectorAll('.newmenu [role=group]').forEach((g) => { g.hidden = !!s && !g.querySelector('[data-nm]:not([hidden])'); });
        none.hidden = vis().length > 0; mark(s ? vis()[0] : null);
      };
      const col = (a) => [...m.querySelectorAll('.newmenu [role=group]')].indexOf(a.closest('[role=group]'));
      q.addEventListener('input', filter);
      m.addEventListener('click', (e) => { const a = e.target.closest('[data-nm]'); if (a) { e.preventDefault(); open(a); } });
      m.addEventListener('keydown', (e) => {
        const v = vis(), cur = links[on];
        if (e.key === 'Enter') { if (cur && !cur.hidden) { e.preventDefault(); open(cur); } else if (v.length === 1) { e.preventDefault(); open(v[0]); } return; }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const i = cur ? v.indexOf(cur) : -1; mark(v[(i + (e.key === 'ArrowDown' ? 1 : v.length - 1) + (i < 0 && e.key === 'ArrowUp' ? 1 : 0)) % v.length] || null); return; }
        if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && cur && document.activeElement !== q) {
          e.preventDefault(); const c = col(cur) + (e.key === 'ArrowRight' ? 1 : -1), target = v.find((a) => col(a) === c); if (target) mark(target); return;
        }
        if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && cur && document.activeElement === q && q.value === '') {
          e.preventDefault(); const c = col(cur) + (e.key === 'ArrowRight' ? 1 : -1), target = v.find((a) => col(a) === c); if (target) mark(target); return;
        }
        const k = (e.altKey ? 'Alt+' : '') + e.key, hit = all.findIndex((x) => x.key === k);
        if (/^F\d+$/.test(e.key) && hit >= 0) { e.preventDefault(); e.stopPropagation(); open(links[hit]); }
      });
      setTimeout(() => q.focus(), 0);
    } });
  };
})();
