/* global OB */
/* OfflineBooks US — Company Snapshot.
 * Modeled on the QuickBooks Desktop Snapshot (Company / Payments / Customer tabs; add content from a gallery,
 * remove with ×, drag panels by their header, restore defaults, per-panel date ranges) and extended with:
 * keyboard moving, collapse, expand-to-full + print, chart/table views, 2–4 columns, drill-down everywhere.
 * Every figure comes from posted transactions (same engine as the reports). Layouts persist per company & tab.
 */
(function () {
  'use strict';
  const U = OB.util, S = OB.schema, R = OB.reports, UI = OB.ui, C = UI.chart, esc = U.esc;
  const routes = UI.routes;
  const TABS = [['company', 'Company'], ['payments', 'Payments'], ['customer', 'Customer']];

  /* ---------------- shared helpers ---------------- */
  const range = (key) => { const r = UI.ranges()[key] || UI.ranges().fyToDate; return { from: r[1], to: r[2], label: r[0] }; };
  const PERIOD = (def) => ({ key: 'period', label: 'Date range', def: def || 'fyToDate', choices: [['fyToDate', 'This fiscal year to date'], ['thisFY', 'This fiscal year'], ['lastFY', 'Last fiscal year'], ['last12', 'Last 12 months'], ['thisQuarter', 'This quarter'], ['thisMonth', 'This month'], ['lastMonth', 'Last month']] });
  const VIEW = (def, more) => ({ key: 'view', label: 'Show as', def: def || 'chart', choices: [['chart', 'Chart'], ['table', 'Table']].concat(more || []) });
  const qs = UI.qs;
  const plHref = (from, to) => '#/report/pnl?' + qs({ range: 'custom', from, to });
  const glHref = (id, from, to) => '#/report/gl?' + qs({ account: id, range: 'custom', from, to });
  const typesOf = (kind) => kind === 'income' ? ['income', 'oi'] : ['cogs', 'expense', 'oe'];
  /** Natural-sign total (income positive, expense positive) over accounts for a period. */
  function amountFor(b, ent, accounts, kind, from, to) {
    return U.sum(accounts, (a) => (kind === 'income' ? -1 : 1) * R.rawSum(ent[a.id], from, to));
  }
  const openDocs = (b, type, contactId) => b.posted().filter((t) => t.type === type && (!contactId || t.contactId === contactId) && b.openBalance(t) > 0);
  const overdueDays = (t, today) => t.dueDate && t.dueDate < today ? U.daysBetween(t.dueDate, today) : 0;
  function docTable(b, docs, s, full, kindLabel, today) {
    if (s.filter === 'overdue') docs = docs.filter((t) => overdueDays(t, today) > 0);
    let rows;
    if (s.group === 'contact') {
      const m = {};
      docs.forEach((t) => { const k = t.contactId; m[k] = m[k] || { id: k, amt: 0, due: t.dueDate || t.date, od: 0 }; m[k].amt += b.openBalance(t); if ((t.dueDate || t.date) < m[k].due) m[k].due = t.dueDate || t.date; m[k].od = Math.max(m[k].od, overdueDays(t, today)); });
      rows = Object.values(m).map((x) => ({ label: UI.contactName(x.id), go: '#/contact/' + x.id, due: x.due, od: x.od, amt: x.amt }));
    } else rows = docs.map((t) => ({ label: UI.contactName(t.contactId) + (t.number ? ' · ' + t.number : ''), go: '#/txn/' + t.id, due: t.dueDate || t.date, od: overdueDays(t, today), amt: b.openBalance(t) }));
    rows.sort(s.sort === 'amount' ? (x, y) => y.amt - x.amt : (x, y) => (x.due < y.due ? -1 : x.due > y.due ? 1 : 0));
    if (!rows.length) return C.empty(s.filter === 'overdue' ? 'Nothing is overdue.' : 'There are no open ' + kindLabel + '.');
    const shown = full ? rows : rows.slice(0, 8);
    return `<div class="tile-table"><table class="data compact fixed"><colgroup><col><col style="width:7.2rem"><col style="width:7rem"></colgroup><thead><tr><th>${s.group === 'contact' ? 'Name' : 'Name · No.'}</th><th>Due</th><th class="num">Amount due</th></tr></thead><tbody>
      ${shown.map((r) => `<tr class="${r.od ? 'late' : ''}"><td class="ell"><a href="${esc(r.go)}" title="${esc(r.label)}">${esc(r.label)}</a></td><td>${U.fmtDate(r.due)}${r.od ? `<span class="od">${r.od} days late</span>` : ''}</td><td class="num">${UI.money(r.amt)}</td></tr>`).join('')}
      </tbody><tfoot><tr><td colspan="2">${rows.length} open${rows.length > shown.length ? ` · <button type="button" class="link-btn" data-tact="expand">show all</button>` : ''}</td><td class="num">${UI.money(U.sum(rows, (r) => r.amt))}</td></tr></tfoot></table></div>`;
  }
  const kpis = (items) => `<div class="kpi-grid">${items.map((k) => `<a class="kpi2" href="${esc(k.go || '#/dashboard')}"><span>${esc(k.label)}</span><b class="${k.cls || ''}">${k.text !== undefined ? esc(k.text) : UI.money(k.value, { symbol: true })}</b>${k.sub ? `<small>${esc(k.sub)}</small>` : ''}</a>`).join('')}</div>`;

  /* ---------------- panel catalogue ---------------- */
  const W = {};

  W.incexp = {
    title: 'Income and Expense Trend', tabs: ['company'], desc: 'Income against expenses, month by month.',
    options: [PERIOD(), { key: 'interval', label: 'Group by', def: 'month', choices: [['month', 'Month'], ['quarter', 'Quarter']] }, VIEW()],
    render(x, s) {
      const rg = range(s.period), p = R.pnl(x.b, { from: rg.from, to: rg.to, columns: s.interval });
      const cols = p.columns.map((c, i) => ({ c, i })).filter((o) => !o.c.total);
      const sec = (k, i) => p.sections[k].totals[i];
      const inc = cols.map((o) => sec('income', o.i) + sec('oi', o.i)), exp = cols.map((o) => sec('cogs', o.i) + sec('expense', o.i) + sec('oe', o.i));
      const multiYear = rg.from.slice(0, 4) !== rg.to.slice(0, 4);
      const lab = cols.map((o) => s.interval === 'quarter' ? 'Q' + (Math.floor((+o.c.from.slice(5, 7) - 1) / 3) + 1) + (multiYear ? " '" + o.c.from.slice(2, 4) : '') : U.monthLabel(o.c.from).slice(0, 3) + (multiYear && o.c.from.slice(5, 7) === '01' ? " '" + o.c.from.slice(2, 4) : ''));
      if (s.view === 'table') return C.table(['Period', 'Income', 'Expenses', 'Net'], cols.map((o, k) => [{ label: lab[k], go: plHref(o.c.from, o.c.to) }, inc[k], exp[k], inc[k] - exp[k]]), { foot: ['Total', U.sum(inc), U.sum(exp), U.sum(inc) - U.sum(exp)] });
      return C.bars({ categories: lab, series: [{ name: 'Income', values: inc, cls: 's1' }, { name: 'Expenses', values: exp, cls: 's2' }], go: (ci) => plHref(cols[ci].c.from, cols[ci].c.to), label: 'Income and expenses by ' + s.interval });
    }
  };

  function comparison(kind) {
    return {
      title: 'Previous Year ' + (kind === 'income' ? 'Income' : 'Expense') + ' Comparison', tabs: ['company'],
      desc: 'This fiscal year against earlier years — yearly, quarterly or monthly.',
      options: [{ key: 'account', label: 'Account', def: 'all', choices: (b) => [['all', 'All ' + kind + ' accounts']].concat(b.sortedAccounts((a) => typesOf(kind).indexOf(a.type) >= 0 && a.active).map((a) => [a.id, b.accountLabel(a.id)])) },
        { key: 'interval', label: 'Compare', def: 'year', choices: [['year', 'Yearly'], ['quarter', 'Quarterly'], ['month', 'Monthly']] },
        { key: 'years', label: 'Years shown', def: '5', choices: [['3', '3'], ['5', '5'], ['8', '8']], when: (s) => s.interval === 'year' }, VIEW()],
      render(x, s) {
        const b = x.b, ent = R.entries(b, x.basis);
        const accts = b.accounts.filter((a) => typesOf(kind).indexOf(a.type) >= 0 && (s.account === 'all' || a.id === s.account));
        const fys = U.fiscalYearStart(x.today, x.fm), prior = kind === 'income' ? 's3' : 's4', cur = kind === 'income' ? 's1' : 's2';
        const fyLabel = (start) => x.fm === 1 ? start.slice(0, 4) : 'FY' + U.addMonths(start, 11).slice(2, 4);
        if (s.interval === 'year') {
          const n = +s.years, cats = [], vals = [], cls = [], links = [];
          for (let i = n - 1; i >= 0; i--) {
            const from = U.addMonths(fys, -12 * i), to = i === 0 ? x.today : U.addDays(U.addMonths(from, 12), -1);
            cats.push(fyLabel(from)); vals.push(amountFor(b, ent, accts, kind, from, to)); cls.push(i === 0 ? cur : prior); links.push([from, to]);
          }
          if (s.view === 'table') return C.table(['Fiscal year', 'Amount', 'Change'], cats.map((c, i) => [{ label: c + (i === n - 1 ? ' (to date)' : ''), go: plHref(links[i][0], links[i][1]) }, vals[i], i ? U.fmt(vals[i] - vals[i - 1]) : '—']));
          return C.bars({ categories: cats, series: [{ name: kind, values: vals, clsAt: cls }], legend: [{ name: 'Prior years', cls: prior }, { name: 'This year (to date)', cls: cur }], go: (ci) => plHref(links[ci][0], links[ci][1]), label: kind + ' by fiscal year' });
        }
        const step = s.interval === 'quarter' ? 3 : 1, cats = [], a = [], c = [], links = [];
        for (let m = 0; m < 12; m += step) {
          const f = U.addMonths(fys, m), t = U.addDays(U.addMonths(f, step), -1), pf = U.addMonths(f, -12), pt = U.addMonths(t, -12);
          cats.push(step === 3 ? 'Q' + (m / 3 + 1) : U.monthLabel(f).slice(0, 3));
          a.push(amountFor(b, ent, accts, kind, pf, pt)); c.push(f > x.today ? 0 : amountFor(b, ent, accts, kind, f, t < x.today ? t : x.today)); links.push([f, t]);
        }
        if (s.view === 'table') return C.table(['Period', 'Last year', 'This year', 'Change'], cats.map((k, i) => [{ label: k, go: plHref(links[i][0], links[i][1]) }, a[i], c[i], c[i] - a[i]]), { foot: ['Total', U.sum(a), U.sum(c), U.sum(c) - U.sum(a)] });
        return C.bars({ categories: cats, series: [{ name: 'Last fiscal year', values: a, cls: prior }, { name: 'This fiscal year', values: c, cls: cur }], go: (ci, si) => si ? plHref(links[ci][0], links[ci][1]) : plHref(U.addMonths(links[ci][0], -12), U.addMonths(links[ci][1], -12)), label: kind + ' this year against last year' });
      }
    };
  }
  W.previnc = comparison('income');
  W.prevexp = comparison('expense');

  W.accbal = {
    title: 'Account Balances', tabs: ['company'], desc: 'Current balances of the accounts you choose.',
    options: [{ key: 'show', label: 'Accounts', def: 'bs', choices: [['cash', 'Bank and credit cards'], ['assets', 'Assets'], ['liab', 'Liabilities'], ['bs', 'All balance sheet accounts'], ['custom', 'Choose accounts…']] },
      { key: 'accounts', label: 'Choose accounts', type: 'accounts', def: [], when: (s) => s.show === 'custom' },
      { key: 'sort', label: 'Sort by', def: 'chart', choices: [['chart', 'Chart of accounts order'], ['balance', 'Largest balance'], ['name', 'Name']] },
      { key: 'zero', label: 'Zero balances', def: 'hide', choices: [['hide', 'Hide'], ['show', 'Show']] }],
    render(x, s, full) {
      const b = x.b, pick = { cash: ['bank', 'cc'], assets: ['bank', 'ar', 'oca', 'fixed', 'oa'], liab: ['ap', 'cc', 'ocl', 'ltl'] };
      let list = b.sortedAccounts((a) => a.active && S.isBS(a.type) && (s.show === 'custom' ? s.accounts.indexOf(a.id) >= 0 : s.show === 'bs' || (pick[s.show] || []).indexOf(a.type) >= 0))
        .map((a) => ({ a, bal: b.accountBalance(a.id) }));
      if (s.zero === 'hide') list = list.filter((r) => r.bal);
      if (s.sort === 'balance') list.sort((p, q) => Math.abs(q.bal) - Math.abs(p.bal));
      if (s.sort === 'name') list.sort((p, q) => p.a.name.localeCompare(q.a.name));
      if (!list.length) return C.empty(s.show === 'custom' ? 'Choose accounts in this panel’s options.' : 'No balances to show.');
      const shown = full ? list : list.slice(0, 10);
      return `<div class="tile-table"><table class="data compact"><thead><tr><th>Account</th><th class="num">Balance</th></tr></thead><tbody>
        ${shown.map((r) => `<tr><td><a href="#/register/${esc(r.a.id)}">${esc(b.accountLabel(r.a.id))}</a></td><td class="num">${UI.money(r.bal)}</td></tr>`).join('')}</tbody>
        ${list.length > shown.length ? `<tfoot><tr><td colspan="2"><button type="button" class="link-btn" data-tact="expand">Show all ${list.length} accounts</button></td></tr></tfoot>` : ''}</table></div>
        <div class="tile-links"><a href="#/accounts">Go to chart of accounts</a></div>`;
    }
  };

  const OWE_OPTS = (who) => [{ key: 'group', label: 'List', def: 'invoice', choices: [['invoice', 'Each ' + (who === 'customer' ? 'invoice' : 'bill')], ['contact', 'Totals by ' + who]] },
    { key: 'filter', label: 'Show', def: 'all', choices: [['all', 'All open'], ['overdue', 'Overdue only']] },
    { key: 'sort', label: 'Sort by', def: 'due', choices: [['due', 'Due date'], ['amount', 'Amount']] }];
  W.owe = {
    title: 'Customers Who Owe Money', tabs: ['company', 'payments'], desc: 'Open invoices, oldest due first, with overdue days.', options: OWE_OPTS('customer'),
    render: (x, s, full) => docTable(x.b, openDocs(x.b, 'invoice'), s, full, 'invoices', x.today) + '<div class="tile-links"><a href="#/txn/new?type=payment">Receive payments</a></div>'
  };
  W.vendpay = {
    title: 'Vendors to Pay', tabs: ['company', 'payments'], desc: 'Open bills by due date.', options: OWE_OPTS('vendor'),
    render: (x, s, full) => docTable(x.b, openDocs(x.b, 'bill'), s, full, 'bills', x.today) + '<div class="tile-links"><a href="#/txn/new?type=billPayment">Pay bills</a></div>'
  };

  const TOPN = { key: 'top', label: 'Show', def: '5', choices: [['5', 'Top 5'], ['10', 'Top 10'], ['20', 'Top 20']] };
  W.topcust = {
    title: 'Top Customers by Sales', tabs: ['company'], desc: 'Who brought in the most income.', options: [PERIOD('fyToDate'), TOPN, VIEW()],
    render(x, s, full) {
      const b = x.b, ent = R.entries(b, x.basis), rg = range(s.period), m = {};
      b.accounts.forEach((a) => { if (typesOf('income').indexOf(a.type) < 0) return; (ent[a.id] || []).forEach((e) => { if (e.t.date < rg.from || e.t.date > rg.to) return; const c = b.contactById[e.s.contactId || e.t.contactId]; if (c && c.kind === 'customer') m[c.id] = (m[c.id] || 0) - e.s.amount; }); });
      const items = Object.keys(m).map((id) => ({ label: b.contactById[id].name, value: m[id], go: '#/contact/' + id })).filter((i) => i.value).sort((p, q) => q.value - p.value).slice(0, full ? 100 : +s.top);
      if (s.view === 'table') return items.length ? C.table(['Customer', 'Sales'], items.map((i) => [{ label: i.label, go: i.go }, i.value])) : C.empty('There is no data for this period.');
      return C.ranked({ items, cls: 's1', empty: 'No customer sales in this period.' });
    }
  };
  W.topvend = {
    title: 'Top Vendors by Expense', tabs: ['company'], desc: 'Where the money went, by vendor or payee.', options: [PERIOD('fyToDate'), TOPN, VIEW()],
    render(x, s, full) {
      const rg = range(s.period), rep = R.expenseByVendor(x.b, { from: rg.from, to: rg.to, basis: x.basis });
      const items = rep.rows.slice(0, full ? 100 : +s.top).map((r) => ({ label: r.name, value: r.amount, go: r.contactId ? '#/contact/' + r.contactId : '#/report/expvendor?' + qs({ range: 'custom', from: rg.from, to: rg.to }) }));
      if (s.view === 'table') return items.length ? C.table(['Vendor / payee', 'Expenses'], items.map((i) => [{ label: i.label, go: i.go }, i.value])) : C.empty('There is no data for this period.');
      return C.ranked({ items, cls: 's2', empty: 'No expenses in this period.' });
    }
  };

  function breakdown(kind) {
    return {
      title: (kind === 'income' ? 'Income' : 'Expense') + ' Breakdown', tabs: ['company'], desc: 'Share of each ' + kind + ' account.',
      options: [PERIOD(), { key: 'slices', label: 'Largest', def: '6', choices: [['4', '4 accounts + other'], ['6', '6 accounts + other'], ['9', '9 accounts + other']] }, VIEW('chart')],
      render(x, s, full) {
        const rg = range(s.period), p = R.pnl(x.b, { from: rg.from, to: rg.to, basis: x.basis });
        const rows = typesOf(kind).flatMap((t) => p.sections[t === 'expense' ? 'expense' : t].rows).filter((r) => r.values[0] > 0).sort((a, b2) => b2.values[0] - a.values[0]);
        const n = full ? rows.length : +s.slices, top = rows.slice(0, n), rest = rows.slice(n);
        const items = top.map((r) => ({ label: r.label.replace(/^\d+\s/, ''), value: r.values[0], go: glHref(r.accountId, rg.from, rg.to) }));
        if (rest.length) items.push({ label: 'Other accounts (' + rest.length + ')', value: U.sum(rest, (r) => r.values[0]), go: plHref(rg.from, rg.to) });
        if (s.view === 'table') return items.length ? C.table(['Account', 'Amount', 'Share'], items.map((i) => [{ label: i.label, go: i.go }, i.value, (i.value / U.sum(items, (z) => z.value) * 100).toFixed(1) + '%']), { foot: ['Total', U.sum(items, (z) => z.value), '100%'] }) : C.empty('There is no data for this period.');
        return C.donut({ items, label: kind + ' breakdown', centerLabel: 'Total', empty: 'No ' + kind + ' in this period.' });
      }
    };
  }
  W.expbreak = breakdown('expense');
  W.incbreak = breakdown('income');

  W.keyfig = {
    title: 'Key Figures', tabs: ['company', 'payments'], desc: 'Cash, what you’re owed, what you owe, profit and ratios.', options: [PERIOD()],
    render(x, s) {
      const b = x.b, rg = range(s.period), bal = (types) => U.sum(b.accounts.filter((a) => types.indexOf(a.type) >= 0), (a) => b.accountBalance(a.id));
      const p = R.pnl(b, { from: rg.from, to: rg.to, basis: x.basis }), inc = p.sections.income.totals[0], cogs = p.sections.cogs.totals[0];
      const ca = bal(['bank', 'ar', 'oca']), cl = bal(['ap', 'cc', 'ocl']);
      return kpis([
        { label: 'Cash in bank', value: bal(['bank']), go: '#/accounts' },
        { label: 'Customers owe you', value: bal(['ar']), go: '#/report/araging' },
        { label: 'You owe vendors', value: bal(['ap']), go: '#/report/apaging' },
        { label: 'Credit cards owed', value: bal(['cc']), go: '#/accounts' },
        { label: 'Net income', value: p.netIncome[0], sub: rg.label, go: plHref(rg.from, rg.to), cls: p.netIncome[0] < 0 ? 'neg' : '' },
        { label: 'Gross margin', text: inc ? ((inc - cogs) / inc * 100).toFixed(1) + '%' : '—', sub: rg.label, go: plHref(rg.from, rg.to) },
        { label: 'Current ratio', text: cl ? (ca / cl).toFixed(2) : '—', sub: 'Current assets ÷ current liabilities', go: '#/report/bs' }
      ]);
    }
  };

  W.reminders = {
    title: 'Reminders', tabs: ['company', 'payments'], desc: 'What needs attention: overdue items, due bills, reconciliations, backups.', options: [{ key: 'soon', label: 'Bills due within', def: '7', choices: [['3', '3 days'], ['7', '7 days'], ['14', '14 days']] }],
    render(x, s) {
      const b = x.b, t = x.today, items = [];
      const inv = openDocs(b, 'invoice').filter((d) => overdueDays(d, t));
      if (inv.length) items.push({ cls: 'danger', text: `${inv.length} overdue invoice${inv.length > 1 ? 's' : ''} · ${U.fmt(U.sum(inv, (d) => b.openBalance(d)), { symbol: true })}`, go: '#/report/araging?detail=1' });
      const bills = openDocs(b, 'bill'), od = bills.filter((d) => overdueDays(d, t)), soon = bills.filter((d) => !overdueDays(d, t) && (d.dueDate || d.date) <= U.addDays(t, +s.soon));
      if (od.length) items.push({ cls: 'danger', text: `${od.length} overdue bill${od.length > 1 ? 's' : ''} · ${U.fmt(U.sum(od, (d) => b.openBalance(d)), { symbol: true })}`, go: '#/report/apaging?detail=1' });
      if (soon.length) items.push({ cls: 'warn', text: `${soon.length} bill${soon.length > 1 ? 's' : ''} due in the next ${s.soon} days · ${U.fmt(U.sum(soon, (d) => b.openBalance(d)), { symbol: true })}`, go: '#/txn/new?type=billPayment' });
      const rec = b.dueRecurring(t);
      if (rec.length) items.push({ cls: 'warn', text: `${rec.length} recurring transaction${rec.length > 1 ? 's' : ''} to post`, go: '#/recurring' });
      const credits = b.posted().filter((d) => d.type === 'payment' && b.openBalance(d) > 0);
      if (credits.length) items.push({ cls: 'info', text: `${credits.length} customer payment${credits.length > 1 ? 's' : ''} not fully applied to invoices`, go: '#/transactions?type=payment' });
      ['UNCAT_INC', 'UNCAT_EXP'].forEach((code) => { const a = b.sys(code); const n = a ? (b.splitIndex()[a.id] || []).length : 0; if (n) items.push({ cls: 'info', text: `${n} transaction${n > 1 ? 's' : ''} in ${a.name} to categorize`, go: '#/register/' + a.id }); });
      b.accounts.filter((a) => (a.type === 'bank' || a.type === 'cc') && a.active && (b.splitIndex()[a.id] || []).length).forEach((a) => {
        const last = b.reconciliations.filter((r) => r.accountId === a.id && !r.undone).map((r) => r.statementDate).sort().pop();
        if (!last || U.daysBetween(last, t) > 45) items.push({ cls: 'info', text: `${a.name}: ${last ? 'last reconciled ' + U.fmtDate(last) : 'never reconciled'}`, go: '#/reconcile?account=' + a.id });
      });
      const lb = b.company.lastBackupAt;
      if (!lb || U.daysBetween(lb.slice(0, 10), t) > 7) items.push({ cls: 'warn', text: lb ? `Last backup ${U.daysBetween(lb.slice(0, 10), t)} days ago` : 'No backup yet', go: '#/settings?tab=backup' });
      if (!items.length) return C.empty('You’re all caught up.');
      return `<ul class="reminders">${items.map((i) => `<li class="${i.cls}"><span class="dot" aria-hidden="true"></span><a href="${esc(i.go)}">${esc(i.text)}</a></li>`).join('')}</ul>`;
    }
  };

  W.aging = {
    title: 'Aging Summary', tabs: ['company', 'payments'], desc: 'How overdue receivables or payables are.',
    options: [{ key: 'side', label: 'For', def: 'customer', choices: [['customer', 'Receivables (customers)'], ['vendor', 'Payables (vendors)']] }, VIEW()],
    render(x, s) {
      const rep = R.aging(x.b, { kind: s.side, asOf: x.today }), go = '#/report/' + (s.side === 'vendor' ? 'apaging' : 'araging') + '?detail=1';
      if (!rep.total && !rep.rows.length) return C.empty(s.side === 'vendor' ? 'You owe nothing to vendors.' : 'No customer owes you money.');
      if (s.view === 'table') return C.table(['Age', 'Amount'], rep.bucketLabels.map((l, i) => [{ label: l + (i ? ' days' : ''), go }, rep.totals[i]]), { foot: ['Total', rep.total] });
      return C.bars({ categories: rep.bucketLabels.map((l, i) => i ? l : 'Current'), series: [{ name: 'Open', values: rep.totals, clsAt: rep.totals.map((v, i) => ['s1', 's4', 's2', 's2', 's5'][i]) }], go: () => go, height: 190, label: 'Aging buckets' })
        + `<div class="tile-links"><span class="muted">Total ${U.fmt(rep.total, { symbol: true })}</span><a href="${go}">Open aging report</a></div>`;
    }
  };

  W.invstatus = {
    title: 'Invoice Payment Status', tabs: ['payments'], desc: 'Invoices issued in a period: paid, partly paid, not yet due, overdue.', options: [PERIOD('last12'), VIEW()],
    render(x, s) {
      const b = x.b, rg = range(s.period), inv = b.posted().filter((t) => t.type === 'invoice' && t.date >= rg.from && t.date <= rg.to);
      const g = { Paid: [], 'Partly paid': [], 'Not due yet': [], Overdue: [] };
      inv.forEach((t) => { const o = b.openBalance(t); const k = !o ? 'Paid' : overdueDays(t, x.today) ? 'Overdue' : o < t.total ? 'Partly paid' : 'Not due yet'; g[k].push(t); });
      const items = Object.keys(g).map((k) => ({ label: k + ' (' + g[k].length + ')', value: U.sum(g[k], (t) => t.total), go: '#/transactions?type=invoice' }));
      if (!inv.length) return C.empty('No invoices in this period.');
      if (s.view === 'table') return C.table(['Status', 'Invoices', 'Total'], Object.keys(g).map((k) => [k, String(g[k].length), U.sum(g[k], (t) => t.total)]));
      return C.donut({ items, label: 'Invoice status', centerLabel: inv.length + ' invoices' });
    }
  };

  W.recentpay = {
    title: 'Recent Payments Received', tabs: ['payments'], desc: 'Customer payments in the last weeks.', options: [{ key: 'days', label: 'Period', def: '30', choices: [['30', 'Last 30 days'], ['60', 'Last 60 days'], ['90', 'Last 90 days']] }],
    render(x, s, full) {
      const from = U.addDays(x.today, -+s.days), list = x.b.posted().filter((t) => (t.type === 'payment' || t.type === 'salesReceipt') && t.date >= from).sort((p, q) => (p.date < q.date ? 1 : -1));
      if (!list.length) return C.empty('No payments received in the last ' + s.days + ' days.');
      const shown = full ? list : list.slice(0, 8);
      return C.table(['Customer', 'Date', 'Amount'], shown.map((t) => [{ label: (UI.contactName(t.contactId) || UI.typeLabel(t.type)), go: '#/txn/' + t.id }, U.fmtDate(t.date), t.total]), { foot: [list.length + ' received' + (list.length > shown.length ? ' (expand to see all)' : ''), '', U.sum(list, (t) => t.total)] });
    }
  };

  /* ----- Customer tab ----- */
  const needCust = (x) => (!x.customerId || !x.b.contactById[x.customerId]) ? C.empty('Choose a customer above.') : '';
  function salesFor(b, basis, cid, from, to) {
    const ent = R.entries(b, basis);
    return U.sum(b.accounts.filter((a) => typesOf('income').indexOf(a.type) >= 0), (a) => U.sum((ent[a.id] || []).filter((e) => (e.s.contactId || e.t.contactId) === cid && e.t.date >= from && e.t.date <= to), (e) => -e.s.amount));
  }
  W.custsum = {
    title: 'Customer Summary', tabs: ['customer'], desc: 'Balance, sales, payment habits.', options: [],
    render(x) {
      const e = needCust(x); if (e) return e;
      const b = x.b, c = b.contactById[x.customerId], fys = U.fiscalYearStart(x.today, x.fm);
      const open = openDocs(b, 'invoice', c.id), od = open.filter((t) => overdueDays(t, x.today));
      const pays = b.posted().filter((t) => t.type === 'payment' && t.contactId === c.id).sort((p, q) => (p.date < q.date ? 1 : -1));
      let w = 0, wd = 0; pays.forEach((p) => (p.applications || []).forEach((a) => { const inv = b.txById[a.txnId]; if (inv && inv.type === 'invoice') { w += a.amount; wd += a.amount * U.daysBetween(inv.date, p.date); } }));
      const first = b.posted().filter((t) => t.contactId === c.id).map((t) => t.date).sort()[0];
      return `<div class="cust-head"><b>${esc(c.name)}</b>${c.company ? ' · ' + esc(c.company) : ''}<div class="muted small">${esc([c.email, c.phone].filter(Boolean).join(' · ') || 'No contact details')} · Net ${esc(c.terms)}</div></div>` + kpis([
        { label: 'Open balance', value: b.contactBalance(c.id), go: '#/contact/' + c.id },
        { label: 'Overdue', value: U.sum(od, (t) => b.openBalance(t)), sub: od.length + ' invoice' + (od.length === 1 ? '' : 's'), go: '#/contact/' + c.id, cls: od.length ? 'neg' : '' },
        { label: 'Sales this fiscal year', value: salesFor(b, x.basis, c.id, fys, x.today), go: '#/contact/' + c.id },
        { label: 'Average days to pay', text: w ? Math.round(wd / w) + ' days' : '—', sub: 'Invoice date to payment' },
        { label: 'Last payment', text: pays[0] ? U.fmt(pays[0].total, { symbol: true }) : '—', sub: pays[0] ? U.fmtDate(pays[0].date) : '', go: pays[0] ? '#/txn/' + pays[0].id : '' },
        { label: 'Customer since', text: first ? U.fmtDate(first) : '—' }
      ]);
    }
  };
  W.custtrend = {
    title: 'Customer Sales Trend', tabs: ['customer'], desc: 'This customer’s sales by month, this year against last.', options: [VIEW()],
    render(x, s) {
      const e = needCust(x); if (e) return e;
      const fys = U.fiscalYearStart(x.today, x.fm), cats = [], a = [], c = [];
      for (let m = 0; m < 12; m++) { const f = U.addMonths(fys, m), t = U.addDays(U.addMonths(f, 1), -1); cats.push(U.monthLabel(f).slice(0, 3)); a.push(salesFor(x.b, x.basis, x.customerId, U.addMonths(f, -12), U.addMonths(t, -12))); c.push(f > x.today ? 0 : salesFor(x.b, x.basis, x.customerId, f, t)); }
      if (s.view === 'table') return C.table(['Month', 'Last year', 'This year'], cats.map((k, i) => [k, a[i], c[i]]), { foot: ['Total', U.sum(a), U.sum(c)] });
      return C.bars({ categories: cats, series: [{ name: 'Last fiscal year', values: a, cls: 's3' }, { name: 'This fiscal year', values: c, cls: 's1' }], height: 200, label: 'Customer sales by month' });
    }
  };
  W.custopen = {
    title: 'Open Invoices', tabs: ['customer'], desc: 'What this customer still owes.', options: [{ key: 'filter', label: 'Show', def: 'all', choices: [['all', 'All open'], ['overdue', 'Overdue only']] }, { key: 'sort', label: 'Sort by', def: 'due', choices: [['due', 'Due date'], ['amount', 'Amount']] }],
    render(x, s, full) { const e = needCust(x); if (e) return e; return docTable(x.b, openDocs(x.b, 'invoice', x.customerId), Object.assign({ group: 'invoice' }, s), full, 'invoices', x.today) + `<div class="tile-links"><a href="#/txn/new?type=payment&contact=${esc(x.customerId)}">Receive payment</a><a href="#/statement/${esc(x.customerId)}">Statement</a></div>`; }
  };
  W.custrecent = {
    title: 'Recent Transactions', tabs: ['customer'], desc: 'Latest activity with this customer.', options: [{ key: 'n', label: 'Show', def: '8', choices: [['8', 'Last 8'], ['15', 'Last 15'], ['30', 'Last 30']] }],
    render(x, s, full) {
      const e = needCust(x); if (e) return e;
      const list = R.transactionList(x.b, { contactId: x.customerId }).slice(0, full ? 500 : +s.n);
      if (!list.length) return C.empty('No transactions with this customer yet.');
      return C.table(['Transaction', 'Date', 'Amount'], list.map((t) => [{ label: UI.typeLabel(t.type) + (t.number ? ' ' + t.number : ''), go: '#/txn/' + t.id }, U.fmtDate(t.date), t.total]));
    }
  };

  const DEFAULTS = {
    company: { cols: 3, columns: [['incexp', 'accbal', 'expbreak'], ['previnc', 'topcust'], ['owe', 'prevexp']] },
    payments: { cols: 3, columns: [['aging', 'owe'], ['invstatus', 'recentpay'], ['reminders', 'vendpay']] },
    customer: { cols: 2, columns: [['custsum', 'custopen'], ['custtrend', 'custrecent']] }
  };
  UI.SNAPSHOT_WIDGETS = W;

  /* ---------------- state (per company, per tab; kept in preferences) ---------------- */
  function store() { return OB.prefs.get('snapshot') || {}; }
  function tabState(b, tab) {
    const all = store(), co = all[b.company.id] = all[b.company.id] || {};
    let st = co[tab];
    if (!st || !Array.isArray(st.columns)) st = co[tab] = JSON.parse(JSON.stringify(DEFAULTS[tab]));
    st.settings = st.settings || {}; st.collapsed = st.collapsed || {};
    const seen = {};   // drop unknown/duplicate panels, fit to column count
    st.columns = st.columns.map((c) => c.filter((id) => W[id] && W[id].tabs.indexOf(tab) >= 0 && !seen[id] && (seen[id] = 1)));
    while (st.columns.length < st.cols) st.columns.push([]);
    if (st.columns.length > st.cols) { const extra = st.columns.splice(st.cols).flat(); extra.forEach((id, i) => st.columns[i % st.cols].push(id)); }
    return { all, st };
  }
  function save(all) { OB.prefs.set('snapshot', all); }
  function settingsFor(st, id, b) {
    const s = Object.assign({}, st.settings[id] || {});
    (W[id].options || []).forEach((o) => { if (s[o.key] === undefined) s[o.key] = Array.isArray(o.def) ? o.def.slice() : o.def; });
    return s;
  }
  const subtitle = (id, s) => { const o = (W[id].options || []).find((p) => p.key === 'period'); return o ? (o.choices.find((c) => c[0] === s.period) || [])[1] || '' : ''; };

  /* ---------------- page ---------------- */
  let cur = null; // { b, tab, all, st, x, el }
  routes.snapshot = (el, r) => {
    const b = UI.book, tab = TABS.some((t) => t[0] === r.params.tab) ? r.params.tab : 'company';
    const { all, st } = tabState(b, tab);
    if (tab === 'customer' && (!st.customerId || !b.contactById[st.customerId])) {
      const c = b.contacts.filter((c2) => c2.kind === 'customer' && c2.active).sort((p, q) => b.contactBalance(q.id) - b.contactBalance(p.id))[0];
      st.customerId = c ? c.id : ''; save(all);
    }
    const x = { b, basis: b.company.basis, today: U.today(), fm: b.company.fiscalYearStartMonth || 1, customerId: st.customerId };
    cur = { b, tab, all, st, x, el };
    const available = Object.keys(W).filter((id) => W[id].tabs.indexOf(tab) >= 0 && !st.columns.flat().includes(id));
    el.innerHTML = UI.page('Company Snapshot', `
      <button class="btn" id="snap-add"${available.length ? '' : ' disabled'}>+ Add content${available.length ? ` (${available.length})` : ''}</button>
      <div class="segmented" role="radiogroup" aria-label="Columns">${[2, 3, 4].map((n) => `<button type="button" role="radio" aria-checked="${st.cols === n}" data-cols="${n}" title="${n} columns">${n}</button>`).join('')}</div>
      <button class="btn ghost" id="snap-reset">Restore defaults</button>`, `
      <nav class="tabs" role="tablist" aria-label="Snapshot">${TABS.map(([k, l]) => `<a role="tab" href="#/snapshot?tab=${k}" class="${k === tab ? 'on' : ''}" aria-selected="${k === tab}">${l}</a>`).join('')}</nav>
      ${tab === 'customer' ? `<div class="toolbar snap-cust"><label>Customer ${UI.comboHtml('contact', 'customer', st.customerId, 'id="snap-cust"', { placeholder: 'Choose a customer…', label: 'Customer' })}</label>${st.customerId ? `<a class="btn small" href="#/contact/${esc(st.customerId)}">Open customer</a>` : ''}</div>` : ''}
      <div class="snap-grid" style="--cols:${st.cols}">${st.columns.map((col, ci) => `<div class="snap-col" data-col="${ci}">${col.map((id) => tileHtml(id, st, x)).join('')}</div>`).join('')}</div>
      <div class="sr-only" aria-live="polite" id="snap-live"></div>`,
    'Your business at a glance. Every number comes from your posted transactions — click any bar, slice or row for the detail.');
    bind(el);
  };

  function tileHtml(id, st, x) {
    const w = W[id], s = settingsFor(st, id), col = !!st.collapsed[id], sub = subtitle(id, s);
    let body;
    try { body = col ? '' : w.render(x, s, false); } catch (e) { console.error(e); body = C.empty('This panel could not be shown: ' + e.message); }
    return `<section class="tile${col ? ' collapsed' : ''}" data-id="${id}" aria-labelledby="tt-${id}">
      <header class="tile-head" title="Drag to move">
        <button type="button" class="tile-grip" data-tact="grip" aria-label="Move ${esc(w.title)}. Use arrow keys to move between positions and columns." aria-roledescription="draggable panel"><svg viewBox="0 0 10 16" width="9" height="14" aria-hidden="true"><g fill="currentColor"><circle cx="2.5" cy="3" r="1.4"/><circle cx="7.5" cy="3" r="1.4"/><circle cx="2.5" cy="8" r="1.4"/><circle cx="7.5" cy="8" r="1.4"/><circle cx="2.5" cy="13" r="1.4"/><circle cx="7.5" cy="13" r="1.4"/></g></svg></button>
        <div class="tile-titles"><h2 id="tt-${id}">${esc(w.title)}</h2>${sub ? `<span class="tile-sub">${esc(sub)}</span>` : ''}</div>
        <div class="tile-tools">
        ${(w.options || []).length ? `<button type="button" class="icon-btn sm" data-tact="opts" aria-haspopup="dialog" aria-label="Options for ${esc(w.title)}" title="Options"><svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true"><path d="M3 6h9M15 6h2M3 14h2M8 14h9" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="13.5" cy="6" r="1.9" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="6.5" cy="14" r="1.9" fill="none" stroke="currentColor" stroke-width="1.6"/></svg></button>` : ''}
        <button type="button" class="icon-btn sm" data-tact="expand" aria-label="Expand ${esc(w.title)}" title="Expand"><svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true"><path d="M12 3h5v5M8 17H3v-5M17 3l-6 6M3 17l6-6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg></button>
        <button type="button" class="icon-btn sm" data-tact="collapse" aria-expanded="${!col}" aria-label="${col ? 'Expand' : 'Collapse'} ${esc(w.title)} panel" title="${col ? 'Show' : 'Collapse'}"><svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true"><path d="${col ? 'M6 8l4 4 4-4' : 'M6 12l4-4 4 4'}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>
        <button type="button" class="icon-btn sm" data-tact="remove" aria-label="Remove ${esc(w.title)} from the snapshot" title="Remove"><svg viewBox="0 0 20 20" width="13" height="13" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>
        </div>
      </header>
      <div class="tile-body"${col ? ' hidden' : ''}>${body}</div></section>`;
  }
  function refreshTile(id) {
    const el = cur.el.querySelector(`.tile[data-id="${id}"]`); if (!el) return;
    const tmp = document.createElement('div'); tmp.innerHTML = tileHtml(id, cur.st, cur.x);
    el.replaceWith(tmp.firstElementChild);
  }
  const persistLayout = () => {
    cur.st.columns = [...cur.el.querySelectorAll('.snap-col')].map((c) => [...c.querySelectorAll(':scope > .tile')].map((t) => t.dataset.id));
    save(cur.all);
  };
  const announce = (msg) => { const l = cur.el.querySelector('#snap-live'); if (l) { l.textContent = ''; setTimeout(() => { l.textContent = msg; }, 30); } };

  function bind(el) {
    el.querySelector('#snap-add').addEventListener('click', gallery);
    el.querySelector('#snap-reset').addEventListener('click', () => UI.confirm('Restore defaults', '<p>Return this tab to its original panels, positions and date ranges? Other tabs are not changed.</p>', { ok: 'Restore defaults' }).then((ok) => {
      if (!ok) return; delete cur.all[cur.b.company.id][cur.tab]; save(cur.all); UI.render(); UI.toast('Snapshot restored to defaults.');
    }));
    el.querySelectorAll('[data-cols]').forEach((btn) => btn.addEventListener('click', () => {
      const n = +btn.dataset.cols, order = [];
      const cols = cur.st.columns, max = Math.max(...cols.map((c) => c.length));
      for (let r = 0; r < max; r++) cols.forEach((c) => { if (c[r]) order.push(c[r]); }); // reading order, row by row
      cur.st.cols = n; cur.st.columns = Array.from({ length: n }, () => []);
      order.forEach((id, i) => cur.st.columns[i % n].push(id));
      save(cur.all); UI.render();
    }));
    const cust = el.querySelector('#snap-cust');
    if (cust) cust.addEventListener('change', () => { if (cust.value) { cur.st.customerId = cust.value; save(cur.all); UI.render(); } });
    const grid = el.querySelector('.snap-grid');
    grid.addEventListener('click', (e) => {
      const go = e.target.closest('[data-go]');
      if (go) { UI.go(go.dataset.go); return; }
      const a = e.target.closest('[data-tact]'); if (!a) return;
      const tile = a.closest('.tile'), id = tile.dataset.id, act = a.dataset.tact;
      if (act === 'remove') {
        tile.remove(); persistLayout(); delete cur.st.collapsed[id];
        announce(W[id].title + ' removed. It is back in Add content.');
        const add = cur.el.querySelector('#snap-add'); add.disabled = false;
        add.textContent = '+ Add content (' + Object.keys(W).filter((k) => W[k].tabs.indexOf(cur.tab) >= 0 && !cur.st.columns.flat().includes(k)).length + ')';
      }
      if (act === 'collapse') { cur.st.collapsed[id] = !cur.st.collapsed[id]; if (!cur.st.collapsed[id]) delete cur.st.collapsed[id]; save(cur.all); refreshTile(id); const t = cur.el.querySelector(`.tile[data-id="${id}"] [data-tact=collapse]`); if (t) t.focus(); }
      if (act === 'expand') expand(id);
      if (act === 'opts') options(id, a);
    });
    grid.addEventListener('keydown', (e) => { const g = e.target.closest('.tile-grip'); if (g) keyMove(e, g.closest('.tile')); });
    grid.addEventListener('pointerdown', (e) => {
      const head = e.target.closest('.tile-head');
      if (!head || e.button !== 0 || (e.target.closest('button') && !e.target.closest('.tile-grip'))) return;
      drag(e, head.closest('.tile'));
    });
  }

  /* ---------------- moving: pointer drag ---------------- */
  function drag(e, tile) {
    const grid = cur.el.querySelector('.snap-grid'), r0 = tile.getBoundingClientRect(), dx = e.clientX - r0.left, dy = e.clientY - r0.top, sx = e.clientX, sy = e.clientY;
    const main = document.getElementById('main');
    let started = false, ph = null, raf = null;
    const move = (ev) => {
      if (!started) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return;
        started = true;
        ph = document.createElement('div'); ph.className = 'tile-ph'; ph.style.height = r0.height + 'px';
        tile.parentNode.insertBefore(ph, tile);
        tile.classList.add('dragging'); tile.style.width = r0.width + 'px';
        document.documentElement.classList.add('tile-dragging');
      }
      tile.style.left = (ev.clientX - dx) + 'px'; tile.style.top = (ev.clientY - dy) + 'px';
      const cols = [...grid.querySelectorAll('.snap-col')];
      let col = cols.find((c) => { const b = c.getBoundingClientRect(); return ev.clientX >= b.left && ev.clientX <= b.right && ev.clientY >= b.top - 40 && ev.clientY <= Math.max(b.bottom, b.top + 80) + 40; });
      if (!col) col = cols.reduce((best, c) => { const b = c.getBoundingClientRect(), d = Math.abs(ev.clientX - (b.left + b.right) / 2); return !best || d < best.d ? { c, d } : best; }, null).c;
      const before = [...col.querySelectorAll(':scope > .tile:not(.dragging)')].find((t) => { const b = t.getBoundingClientRect(); return ev.clientY < b.top + b.height / 2; });
      if (ph.parentNode !== col || ph.nextSibling !== (before || null)) col.insertBefore(ph, before || null);
      // auto-scroll near the edges of the content area
      cancelAnimationFrame(raf);
      const mb = main.getBoundingClientRect(), edge = 60, sp = ev.clientY < mb.top + edge ? -14 : ev.clientY > mb.bottom - edge ? 14 : 0;
      if (sp) { const tick = () => { main.scrollTop += sp; raf = requestAnimationFrame(tick); }; raf = requestAnimationFrame(tick); }
    };
    const up = () => {
      cancelAnimationFrame(raf);
      tile.removeEventListener('pointermove', move); tile.removeEventListener('pointerup', up); tile.removeEventListener('pointercancel', up);
      document.documentElement.classList.remove('tile-dragging');
      if (!started) return;
      ph.replaceWith(tile); tile.classList.remove('dragging'); tile.style.cssText = '';
      persistLayout();
      const pos = position(tile); announce(`${W[tile.dataset.id].title} moved to column ${pos.col}, position ${pos.row}.`);
    };
    tile.setPointerCapture(e.pointerId);
    tile.addEventListener('pointermove', move); tile.addEventListener('pointerup', up); tile.addEventListener('pointercancel', up);
  }
  function position(tile) {
    const col = tile.parentNode, cols = [...cur.el.querySelectorAll('.snap-col')];
    return { col: cols.indexOf(col) + 1, row: [...col.children].filter((c) => c.classList.contains('tile')).indexOf(tile) + 1 };
  }
  /* ---------------- moving: keyboard ---------------- */
  function keyMove(e, tile) {
    const k = e.key; if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].indexOf(k) < 0) return;
    e.preventDefault();
    const col = tile.parentNode, cols = [...cur.el.querySelectorAll('.snap-col')], ci = cols.indexOf(col), sibs = [...col.querySelectorAll(':scope > .tile')], i = sibs.indexOf(tile);
    if (k === 'ArrowUp' && i > 0) col.insertBefore(tile, sibs[i - 1]);
    else if (k === 'ArrowDown' && i < sibs.length - 1) col.insertBefore(tile, sibs[i + 1].nextSibling);
    else if (k === 'Home') col.insertBefore(tile, sibs[0]);
    else if (k === 'End') col.appendChild(tile);
    else if ((k === 'ArrowLeft' && ci > 0) || (k === 'ArrowRight' && ci < cols.length - 1)) {
      const target = cols[ci + (k === 'ArrowLeft' ? -1 : 1)], ts = [...target.querySelectorAll(':scope > .tile')];
      target.insertBefore(tile, ts[Math.min(i, ts.length)] || null);
    } else { announce('Can’t move further that way.'); return; }
    persistLayout();
    tile.querySelector('.tile-grip').focus();
    const pos = position(tile); announce(`Column ${pos.col}, position ${pos.row}.`);
  }

  /* ---------------- options popover ---------------- */
  function options(id, btn) {
    const old = document.querySelector('.tile-pop'); if (old) { old.remove(); if (old._id === id) return; }
    const w = W[id], b = cur.b;
    const pop = document.createElement('div');
    pop.className = 'tile-pop'; pop._id = id; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Options for ' + w.title);
    const draw = () => {
      const s = settingsFor(cur.st, id);
      pop.innerHTML = `<div class="cols-head">${esc(w.title)}</div>` + w.options.filter((o) => !o.when || o.when(s)).map((o) => {
        if (o.type === 'accounts') return `<fieldset class="acc-pick"><legend>${esc(o.label)}</legend>${b.sortedAccounts((a) => a.active && S.isBS(a.type)).map((a) => `<label class="check"><input type="checkbox" data-acc="${esc(a.id)}" ${s.accounts.indexOf(a.id) >= 0 ? 'checked' : ''}> ${esc(b.accountLabel(a.id))}</label>`).join('')}</fieldset>`;
        const ch = typeof o.choices === 'function' ? o.choices(b) : o.choices;
        return `<label class="field"><span>${esc(o.label)}</span><select data-opt="${o.key}">${ch.map(([v, l]) => `<option value="${esc(v)}"${String(s[o.key]) === String(v) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
      }).join('') + `<div class="cols-foot"><button type="button" class="btn ghost small" data-reset-tile>Reset this panel</button></div>`;
    };
    draw();
    document.body.appendChild(pop);
    const markOpen = (on) => { const t = cur.el.querySelector(`.tile[data-id="${id}"]`); if (t) t.classList.toggle('opts-open', on); };
    markOpen(true);
    const place = () => { const r = btn.isConnected ? btn.getBoundingClientRect() : pop._r; pop._r = r; pop.style.top = Math.min(r.bottom + 6, innerHeight - pop.offsetHeight - 8) + 'px'; pop.style.left = Math.max(8, Math.min(r.right - pop.offsetWidth, innerWidth - pop.offsetWidth - 8)) + 'px'; };
    place();
    const apply = (focusSel) => {
      save(cur.all); refreshTile(id); markOpen(true);
      btn = cur.el.querySelector(`.tile[data-id="${id}"] [data-tact=opts]`) || btn;
      draw(); place(); const f = focusSel && pop.querySelector(focusSel); if (f) f.focus();
    };
    pop.addEventListener('change', (e) => {
      const st = cur.st.settings[id] = cur.st.settings[id] || {}, t = e.target;
      if (t.dataset.opt) st[t.dataset.opt] = t.value;
      if (t.dataset.acc) { const s = settingsFor(cur.st, id); st.accounts = t.checked ? s.accounts.concat(t.dataset.acc) : s.accounts.filter((a) => a !== t.dataset.acc); }
      apply(t.dataset.opt ? `[data-opt="${t.dataset.opt}"]` : `[data-acc="${t.dataset.acc}"]`);
    });
    pop.addEventListener('click', (e) => { if (e.target.closest('[data-reset-tile]')) { delete cur.st.settings[id]; apply('select'); } });
    const close = (e) => {
      if (e.type === 'keydown' && e.key !== 'Escape') return;
      if (e.type === 'mousedown' && (pop.contains(e.target) || btn.contains(e.target))) return;
      pop.remove(); markOpen(false); document.removeEventListener('mousedown', close, true); document.removeEventListener('keydown', close, true);
      if (e.type === 'keydown') { const b2 = cur.el.querySelector(`.tile[data-id="${id}"] [data-tact=opts]`); if (b2) b2.focus(); }
    };
    document.addEventListener('mousedown', close, true); document.addEventListener('keydown', close, true);
    const f = pop.querySelector('select, input'); if (f) f.focus();
  }
  window.addEventListener('hashchange', () => { const p = document.querySelector('.tile-pop'); if (p) p.remove(); });

  /* ---------------- expand (full data) + print ---------------- */
  function expand(id) {
    const w = W[id], s = settingsFor(cur.st, id);
    let body; try { body = w.render(cur.x, s, true); } catch (e) { body = C.empty(e.message); }
    UI.modal({
      title: w.title + (subtitle(id, s) ? ' — ' + subtitle(id, s) : ''), wide: true,
      html: `<div class="tile-full-body">${body}</div>`,
      onMount: (m, close) => {
        m.classList.add('tile-full');
        m.addEventListener('click', (e) => { const a = e.target.closest('a[href^="#"], [data-go]'); if (a) { e.preventDefault(); close(null); UI.go(a.getAttribute('href') || a.dataset.go); } });
      },
      actions: [{ label: 'Print', collect: () => { document.body.classList.add('print-tile'); window.print(); setTimeout(() => document.body.classList.remove('print-tile'), 500); return false; } }, { label: 'Close', value: null, primary: true }]
    });
  }

  /* ---------------- Add content gallery (live previews) ---------------- */
  function gallery() {
    const ids = Object.keys(W).filter((id) => W[id].tabs.indexOf(cur.tab) >= 0 && !cur.st.columns.flat().includes(id));
    if (!ids.length) return UI.toast('Everything for this tab is already on your snapshot.');
    const added = [];
    UI.modal({
      title: 'Add content', wide: true,
      html: `<p class="muted">Previews use your real data. Added panels go to the shortest column; you can move them afterwards.</p>
        <div class="gallery">${ids.map((id) => { let pv = ''; try { pv = W[id].render(cur.x, settingsFor(cur.st, id), false); } catch (e) { pv = ''; }
          return `<article class="gal-card"><div class="gal-preview" aria-hidden="true" inert>${pv}</div><div class="gal-info"><h3>${esc(W[id].title)}</h3><p class="muted small">${esc(W[id].desc)}</p>
            <button type="button" class="btn small" data-add="${id}">Add</button></div></article>`; }).join('')}</div>`,
      onMount: (m) => m.addEventListener('click', (e) => {
        const b = e.target.closest('[data-add]'); if (!b || b.disabled) return;
        const cols = cur.st.columns, shortest = cols.reduce((mi, c, i) => (c.length < cols[mi].length ? i : mi), 0);
        cols[shortest].push(b.dataset.add); save(cur.all); added.push(b.dataset.add);
        b.disabled = true; b.textContent = 'Added ✓';
      }),
      actions: [{ label: 'Done', value: true, primary: true }]
    }).then(() => { if (added.length) { UI.render(); UI.toast(added.length === 1 ? W[added[0]].title + ' added.' : added.length + ' panels added.'); } });
  }
})();
