/* OfflineBooks US — report screens. */
(function () {
  'use strict';
  const U = OB.util, S = OB.schema, R = OB.reports, UI = OB.ui, esc = U.esc;
  const routes = UI.routes;
  const m = UI.m;

  const REPORTS = {
    pnl: { title: 'Profit and Loss', group: 'Business overview', statement: true, desc: 'Income, expenses and net income. On the report: Alt+N columns by month, quarter, class or customer; Alt+C compare with last year or last period, $ and % change, % of income; Ctrl+B cash or accrual.' },
    pnlmonth: { title: 'Profit and Loss by Month', hidden: true, group: 'Business overview', alias: ['pnl', { by: 'month' }], desc: 'One column per month with a total.' },
    pnlcmp: { title: 'Profit and Loss Comparison', hidden: true, group: 'Business overview', alias: ['pnl', { cmp: 'py,chg,pchg' }], desc: 'This period next to the same period last year, with $ and % change.' },
    pnlpct: { title: 'Profit and Loss as % of Total Income', hidden: true, group: 'Business overview', alias: ['pnl', { cmp: 'inc' }], desc: 'Every line as a percentage of total income.' },
    pnlclass: { title: 'Profit and Loss by Class', hidden: true, group: 'Business overview', feature: 'classes', alias: ['pnl', { by: 'class' }], desc: 'One column per class (department, location or job).' },
    pnlcust: { title: 'Profit and Loss by Customer', hidden: true, group: 'Business overview', alias: ['pnl', { by: 'customer' }], desc: 'Income and expenses for each customer.' },
    bs: { title: 'Balance Sheet', group: 'Business overview', statement: true, desc: 'Assets, liabilities and equity on a date. On the report: Alt+N columns by month or quarter; Alt+C compare with last year or last period; Ctrl+B cash or accrual.' },
    bscmp: { title: 'Balance Sheet Comparison', hidden: true, group: 'Business overview', alias: ['bs', { cmp: 'py,chg,pchg' }], desc: 'Balances now and a year ago, with $ and % change.' },
    paydays: { title: 'Invoice Payment Days', group: 'Management (MIS)', kind: 'range', fields: true, keep: ['view', 'by', 'status', 'contact', 'upto', 'f'], desc: 'When each invoice was raised and when it was paid: days to pay, days late, average and amount-weighted days by customer, paid on time %, open invoices. Summary by customer, by invoice or by payment; choose the fields.' },
    bva: { title: 'Budget vs. Actuals', group: 'Budgets', feature: 'budgets', statement: true, desc: 'Actual income and expenses against your budget, by month or in total, with amount over budget and % of budget.' },
    budovr: { title: 'Budget Overview', group: 'Budgets', feature: 'budgets', href: '#/budgets', desc: 'Create and edit budgets by account and month.' },
    t1099: { title: '1099 Contractor Summary', group: 'Expenses', feature: '1099', kind: 'year', desc: 'Payments to 1099 vendors by box for a calendar year, with the filing threshold and missing tax IDs flagged.' },
    d1099: { title: '1099 Transaction Detail', group: 'Expenses', feature: '1099', kind: 'year', desc: 'Every payment counted on the 1099 summary.' },
    designer: { title: 'Statement designer', group: 'Custom reports', href: '#/designer', desc: 'Design your own profit and loss or balance sheet: account groups, formulas such as margins and ratios, row styles and highlights. Save, export and import templates.' },
    builder: { title: 'Custom report builder', group: 'Custom reports', href: '#/builder', desc: 'Build your own report from transaction lines: choose columns, filters, grouping and sorting, then save it.' },
    cf: { title: 'Statement of Cash Flows', group: 'Business overview', kind: 'range', basis: true, desc: 'Where cash came from and went, by operating, investing and financing activity.' },
    tb: { title: 'Trial Balance', group: 'For my accountant', kind: 'asof', basis: true, desc: 'Debit and credit balance of every account. Debits always equal credits.' },
    txdetail: { title: 'Transaction Detail By Account', group: 'For my accountant', kind: 'range', basis: true, keep: ['src', 'node', 'class', 'contact'], desc: 'Every transaction behind the Profit and Loss (or a line you click on it), grouped by account with subtotals.' },
    gl: { title: 'General Ledger', group: 'For my accountant', kind: 'range', basis: true, account: true, desc: 'Every posting to every account with running balances.' },
    recon: { title: 'Report Reconciliation', group: 'For my accountant', kind: 'range', basis: true, desc: 'Proves the trial balance, balance sheet, profit and loss, cash flow and A/R / A/P aging all tie to the posted ledger.' },
    journal: { title: 'Journal', group: 'For my accountant', kind: 'range', desc: 'Each transaction with its debits and credits.' },
    araging: { title: 'A/R Aging Summary', group: 'Who owes you', kind: 'asof', detail: true, desc: 'Unpaid customer balances by how overdue they are.' },
    custbal: { title: 'Customer Balance Summary', group: 'Who owes you', kind: 'asof', desc: 'Open balance per customer; ties to Accounts Receivable.' },
    apaging: { title: 'A/P Aging Summary', group: 'What you owe', kind: 'asof', detail: true, desc: 'Unpaid bills by how overdue they are.' },
    vendbal: { title: 'Vendor Balance Summary', group: 'What you owe', kind: 'asof', desc: 'Open balance per vendor; ties to Accounts Payable.' },
    expdetail: { title: 'Expense Detail', group: 'Expenses', kind: 'range', basis: true, desc: 'Every expense posting, grouped by expense account.' },
    expvendor: { title: 'Expenses by Vendor', group: 'Expenses', kind: 'range', basis: true, desc: 'Total spending per vendor or payee.' },
    txlist: { title: 'Transaction List by Date', group: 'For my accountant', kind: 'range', desc: 'All posted transactions in a period.' },
    openinv: { title: 'Open Invoices', group: 'Who owes you', kind: 'asof', desc: 'Every unpaid invoice, credit and unapplied payment by customer, with terms, due date and days past due.' },
    custdetail: { title: 'Customer Balance Detail', group: 'Who owes you', kind: 'asof', desc: 'Each transaction that makes up every customer balance, with a running total.' },
    unpaidbills: { title: 'Unpaid Bills Detail', group: 'What you owe', kind: 'asof', desc: 'Every unpaid bill and open vendor credit by vendor, with due date and days past due.' },
    venddetail: { title: 'Vendor Balance Detail', group: 'What you owe', kind: 'asof', desc: 'Each transaction that makes up every vendor balance, with a running total.' },
    salescust: { title: 'Sales by Customer Summary', group: 'Sales', kind: 'range', basis: true, desc: 'Income earned from each customer in a period.' },
    salesitem: { title: 'Sales by Product/Service Summary', group: 'Sales', kind: 'range', desc: 'Quantity, amount and average price for each product or service sold.' },
    taxagency: { title: 'Sales Tax Return by Agency', group: 'Sales tax', kind: 'range', basis: true, desc: 'For each tax agency: taxable sales, tax collected and paid in the period, and the amount due — the figures for each sales tax return.' },
    collections: { title: 'A/R Collections', group: 'Who owes you', kind: 'asof', desc: 'Overdue invoices by customer with phone and email, oldest first — a call list.' },
    missingchecks: { title: 'Missing Checks', group: 'Banking', kind: 'asof', account: true, desc: 'Checks in number order for a bank account, with gaps and duplicate numbers flagged.' },
    changed: { title: 'Voided/Changed Transactions', group: 'For my accountant', kind: 'range', desc: 'Every transaction voided or edited in the period (by change date), with what changed — from the audit trail.' },
    forecast: { title: 'Cash Flow Forecast', group: 'Business overview', kind: 'asof', desc: 'Bank balance projected week by week from open invoices, open bills and recurring transactions.' },
    taxsum: { title: 'Income Tax Summary', group: 'For my accountant', kind: 'range', basis: true, desc: 'Income and expenses totalled by the lines of your income tax return (Schedule C, 1120-S, 1065 or 1120), with accounts not yet mapped.' },
    unbilled: { title: 'Unbilled Costs by Job', group: 'Who owes you', kind: 'asof', desc: 'Billable expenses not yet added to an invoice, by customer and job.' },
    pnljob: { title: 'Profit and Loss by Job', hidden: true, group: 'Business overview', alias: ['pnl', { by: 'customer' }], desc: 'Income and expenses for each customer and job (Customer:Job), including costs charged to a job.' },
    invval: { title: 'Inventory Valuation Summary', group: 'Inventory', kind: 'asof', desc: 'Quantity on hand, average cost and asset value of each inventory item, tied to the Inventory Asset account.' },
    stock: { title: 'Inventory Stock Status', group: 'Inventory', kind: 'asof', desc: 'Quantity on hand, on open purchase orders and reorder point, with what to reorder.' },
    fixedassets: { title: 'Fixed Asset Register', group: 'For my accountant', kind: 'asof', desc: 'Each fixed asset with cost, depreciation recorded, book value, this year’s depreciation and anything not yet posted.' },
    salestax: { title: 'Sales Tax Liability', group: 'Sales tax', kind: 'range', desc: 'Taxable and non-taxable sales and tax charged for each rate, and what you owe each tax agency (collected, paid, balance).' },
    depdetail: { title: 'Deposit Detail', group: 'Banking', kind: 'range', desc: 'Every deposit, customer payment and sales receipt into a bank or Undeposited Funds, with what it was for.' },
    checkdetail: { title: 'Check Detail', group: 'Banking', kind: 'range', desc: 'Every check, numbered expense and bill payment from a bank account, with its lines.' },
    salesreg: { title: 'Sales Register', group: 'Account books', href: '#/vreg/sales', desc: 'Month-wise sales with debit, credit and closing balance; Enter on a month for its invoices, receipts and credit memos. Filters by customer, ledger, amount, number, narration and status.' },
    purchreg: { title: 'Purchase Register', group: 'Account books', href: '#/vreg/purchase', desc: 'Month-wise purchases: bills, expenses, checks and vendor credits, with filters.' },
    bankbook: { title: 'Cash/Bank Book', group: 'Account books', href: '#/vreg/bank', desc: 'Every bank and card account with opening, debit, credit and closing; Enter for the monthly summary and the vouchers.' },
    reclassify: { hidden: true, title: 'Reclassify Transactions', group: 'For my accountant', href: '#/reclassify',   // a work screen, not a report: Books > Reclassify (1.50.2)
      desc: 'Find lines posted to the wrong account or class and move them, one by one or all at once, with a preview and undo.' },
    acctlist: { title: 'Account Listing', group: 'Lists', kind: 'asof', desc: 'The chart of accounts with type, number, description and balance.' },
    custlist: { title: 'Customer Contact List', group: 'Lists', kind: 'asof', desc: 'Every customer with contact details, terms and balance.' },
    vendlist: { title: 'Vendor Contact List', group: 'Lists', kind: 'asof', desc: 'Every vendor with contact details, terms, 1099 status and balance.' },
    itemlist: { title: 'Product/Service List', group: 'Lists', kind: 'asof', href: '#/items', desc: 'Your products and services with prices, costs and accounts.' }
  };

  UI.REPORTS = REPORTS;
  const headLen = (t) => t.tHead.rows[t.tHead.rows.length - 1].cells.length;

  const reportHref = (k) => { const d = REPORTS[k]; return d.href ? d.href : d.alias ? '#/report/' + d.alias[0] + '?' + UI.qs(d.alias[1]) : '#/report/' + k; };
  UI.reportHref = reportHref;
  UI.savedReportHref = (x) => x.report === 'builder' ? '#/builder/' + encodeURIComponent(x.id) : x.report === 'designer' ? '#/designer/' + encodeURIComponent(x.id) : '#/report/' + x.report + '?' + UI.qs(Object.assign({}, x.params, { saved: x.id }));
  routes.reports = (el) => {
    const b = UI.book, groups = {};
    Object.keys(REPORTS).forEach((k) => { if (!REPORTS[k].hidden && (!REPORTS[k].feature || b.feature(REPORTS[k].feature))) (groups[REPORTS[k].group] = groups[REPORTS[k].group] || []).push(k); });
    const mine = b.savedReports();
    const myHtml = `<section class="card my-reports"><div class="card-head"><h2>My reports</h2><a class="btn small" href="#/builder">+ New custom report</a></div>
      ${mine.length ? `<table class="data compact"><thead><tr><th>Name</th><th>Based on</th><th>Last saved</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>${mine.map((x) => `<tr>
        <td><a href="${esc(UI.savedReportHref(x))}">${esc(x.name)}</a></td><td>${esc(x.report === 'builder' ? 'Custom report builder' : x.report === 'designer' ? 'Statement designer' : (REPORTS[x.report] || { title: x.report }).title)}</td><td>${esc(new Date(x.updatedAt || x.createdAt).toLocaleDateString())}</td>
        <td class="actions-cell"><button type="button" class="btn ghost small" data-rn="${esc(x.id)}">Rename</button><button type="button" class="btn ghost small" data-rm="${esc(x.id)}">Delete</button></td></tr>`).join('')}</tbody></table>`
      : '<p class="muted">Customize any report and choose <strong>Save as</strong> — or build one from scratch — and it appears here.</p>'}</section>`;
    el.innerHTML = UI.page('Reports', '<button type="button" class="btn primary" id="rp-workbook" data-testid="export-workbook" data-key="w">Export financial workbook</button><a class="btn" href="#/designer">Statement designer</a><a class="btn" href="#/builder">Custom report builder</a>', `<div class="toolbar rp-find"><input type="search" id="rp-filter" placeholder="Find a report by name or what it shows" aria-label="Find a report" data-testid="rp-filter"><span class="muted small" id="rp-count" aria-live="polite"></span></div>` + myHtml + `<div class="report-groups">${Object.keys(groups).map((g) => `<section class="card" data-rgroup><h2>${esc(g)}</h2><ul class="report-links">
      ${groups[g].map((k) => `<li><a href="${esc(reportHref(k))}" title="${esc(REPORTS[k].desc)}"><strong>${esc(REPORTS[k].title)}</strong><span>${esc(REPORTS[k].desc)}</span></a></li>`).join('')}</ul></section>`).join('')}</div>`,
    'Every figure is calculated from your posted transactions. Click amounts to see the transactions behind them.');
    el.querySelector('#rp-workbook').addEventListener('click', () => UI.exportWorkbook());
    // about 30 reports: typing narrows the list, and groups with no match drop out
    const flt = el.querySelector('#rp-filter'), cnt = el.querySelector('#rp-count');
    flt.addEventListener('input', () => {
      const q = flt.value.trim().toLowerCase(); let n = 0;
      el.querySelectorAll('.report-links li').forEach((li) => { const hit = !q || li.textContent.toLowerCase().indexOf(q) >= 0; li.hidden = !hit; if (hit) n++; });
      el.querySelectorAll('[data-rgroup]').forEach((sec) => { sec.hidden = !!q && !sec.querySelector('li:not([hidden])'); });
      cnt.textContent = q ? (n ? n + ' report' + (n === 1 ? '' : 's') : 'No report matches. Try another word.') : '';
    });
    el.querySelectorAll('[data-rm]').forEach((x) => x.addEventListener('click', () => {
      const rp = b.reports.find((y) => y.id === x.dataset.rm);
      UI.confirm('Delete saved report', `<p>Delete “${esc(rp.name)}”? Your transactions are not affected.</p>`, { danger: true, ok: 'Delete' }).then((ok) => ok && b.deleteReport(rp.id).then(() => { UI.toast('Saved report deleted.'); UI.render(); }));
    }));
    el.querySelectorAll('[data-rn]').forEach((x) => x.addEventListener('click', () => {
      const rp = b.reports.find((y) => y.id === x.dataset.rn);
      UI.prompt('Rename saved report', 'Name', rp.name, { ok: 'Rename' }).then((n) => n && b.saveReport(Object.assign({}, rp, { name: n })).then(() => UI.render(), UI.error));
    }));
  };

  /* ---------- Export financial workbook (one .xlsx for this company) ---------- */
  UI.exportWorkbook = () => {
    const b = UI.book, W = OB.workbook, fyM = b.company.fiscalYearStartMonth || 1;
    const cur = U.fiscalYearStart(U.today(), fyM);
    const first = b.transactions.reduce((m, t) => (t.date < m ? t.date : m), U.today());
    const years = [];
    for (let s = cur; s >= U.fiscalYearStart(first, fyM) && years.length < 30; s = U.addMonths(s, -12)) years.push(s);
    const fyLabel = (s) => { const e = U.addDays(U.addMonths(s, 12), -1); return 'FY ' + (s.slice(0, 4) === e.slice(0, 4) ? s.slice(0, 4) : s.slice(0, 4) + '–' + e.slice(2, 4)) + ' (' + U.fmtDate(s) + ' – ' + U.fmtDate(e) + ')'; };
    const prev = OB.prefs.get('workbookExport') || {};
    const sheetBoxes = W.SHEETS.map(([k, n]) => `<label class="check"><input type="checkbox" name="wb-sheet" value="${k}" ${W.REQUIRED[k] ? 'checked disabled' : (prev.sheets && prev.sheets[k] === false ? '' : 'checked')}> ${esc(n)}${W.REQUIRED[k] ? ' <span class="muted small">(always)</span>' : ''}</label>`).join('');
    return UI.modal({
      title: 'Export financial workbook', wide: true,
      html: `<p>One Excel workbook for <strong>${esc(b.company.name)}</strong>: statements, ledgers, journal, aging and an account index, all linked and driven by dates you can change in Excel.</p>
        <div class="form-grid">
          <label class="field"><span>Reporting period</span><select id="wb-period">${years.map((y, i) => `<option value="${y}"${i === 0 ? ' selected' : ''}>${esc(fyLabel(y))}${i === 0 ? ' — current' : ''}</option>`).join('')}<option value="custom">Custom dates</option></select></label>
          <label class="field"><span>Accounting basis</span><select id="wb-basis"><option value="accrual"${b.company.basis !== 'cash' ? ' selected' : ''}>Accrual</option><option value="cash"${b.company.basis === 'cash' ? ' selected' : ''}>Cash</option></select></label>
          <label class="field"><span>From</span><input type="date" id="wb-from" value="${esc(cur)}" disabled></label>
          <label class="field"><span>To</span><input type="date" id="wb-to" value="${esc(U.addDays(U.addMonths(cur, 12), -1))}" disabled></label></div>
        <fieldset class="wb-sheets"><legend>Sheets</legend>${sheetBoxes}</fieldset>
        <label class="check"><input type="checkbox" id="wb-all"${prev.includeAllAccounts ? ' checked' : ''}> Include accounts with no activity</label>
        <label class="check"><input type="checkbox" id="wb-protect"${prev.protect ? ' checked' : ''}> Protect the original data sheets (no password; Excel’s Review › Unprotect Sheet removes it)</label>
        <p class="muted small">The workbook is a snapshot made on this computer. Editing it in Excel never changes VaultBook — enter new transactions here and export again. No macros or internet are needed.</p>`,
      onMount: (m) => {
        const per = m.querySelector('#wb-period'), f = m.querySelector('#wb-from'), t = m.querySelector('#wb-to');
        per.addEventListener('change', () => {
          const custom = per.value === 'custom'; f.disabled = t.disabled = !custom;
          if (!custom) { f.value = per.value; t.value = U.addDays(U.addMonths(per.value, 12), -1); }
        });
      },
      actions: [{ label: 'Cancel', value: null }, { label: 'Export workbook', primary: true, collect: (m) => {
        const from = m.querySelector('#wb-from').value, to = m.querySelector('#wb-to').value;
        if (!U.isDate(from) || !U.isDate(to) || from > to) { UI.toast('Choose a valid period.', 'error'); return false; }
        const sheets = {}; m.querySelectorAll('[name="wb-sheet"]').forEach((x) => { sheets[x.value] = x.checked; });
        const o = { from, to, basis: m.querySelector('#wb-basis').value, sheets, includeAllAccounts: m.querySelector('#wb-all').checked, protect: m.querySelector('#wb-protect').checked };
        OB.prefs.set('workbookExport', { sheets, includeAllAccounts: o.includeAllAccounts, protect: o.protect });
        return o;
      } }]
    }).then((o) => {
      if (!o) return;
      UI.toast('Building the workbook…');
      return new Promise((res) => setTimeout(res, 30)).then(() => W.buildAsync(b, o)).then((out) => {
        const name = U.safeFileName(b.company.name + '_Financial_Workbook_' + o.from + '_to_' + o.to + '_' + o.basis) + '.xlsx';
        U.download(name, new Blob([out.bytes], { type: OB.xlsx.MIME }));
        UI.toast('Exported ' + name + ' — ' + out.plan.stats.lines.toLocaleString() + ' ledger lines, ' + out.plan.sheets.length + ' sheets.');
      }).catch((e) => { console.error(e); UI.toast(e.message, 'error'); });
    });
  };

  routes.report = (el, r) => {
    const b = UI.book, key = r.id, def = REPORTS[key];
    if (!def) return routes.reports(el);
    if (def.feature && !b.feature(def.feature)) {
      const F = { budgets: ['Budgets', 'Budgets set monthly targets and Budget vs. Actuals compares them with your results.'], 1099: ['1099 contractors', 'Prepare Form 1099-NEC and 1099-MISC figures from your books.'], classes: ['Class tracking', 'Tag lines with classes to report by department, location or job.'] }[def.feature];
      return UI.featureOff(el, def.feature, F[0], F[1]);
    }
    if (def.alias) { location.replace(reportHref(key)); return; }
    if (def.href) { location.replace(def.href); return; }
    if (def.statement) return UI.renderStatementPage(el, key, r.params);
    const p = Object.assign({}, r.params);
    const ranges = UI.ranges();
    p.range = p.range || (def.kind === 'range' ? UI.defaultRange('fyToDate') : '');
    if (def.kind === 'range' && p.range !== 'custom' && ranges[p.range]) { p.from = ranges[p.range][1]; p.to = ranges[p.range][2]; }
    if (def.kind === 'range' && (!p.from || !p.to)) { p.from = ranges.fyToDate[1]; p.to = ranges.fyToDate[2]; }
    if (def.kind === 'asof') p.asOf = p.asOf || (UI.period() ? UI.period().to : UI.workDate());
    if (def.kind === 'year') p.year = /^\d{4}$/.test(p.year || '') ? p.year : String(+U.today().slice(0, 4) - (+U.today().slice(5, 7) <= 3 ? 1 : 0));
    p.basis = p.basis || b.company.basis;
    const t0 = performance.now();
    let out;
    try { out = RENDER[key](b, p); } catch (e) { console.error(e); out = { html: `<div class="banner danger">${esc(e.message)}</div>`, matrix: [] }; }
    const ms = Math.round(performance.now() - t0);
    const period = def.kind === 'range' ? (p.range === 'all' ? 'All dates' : U.fmtDate(p.from) + ' – ' + U.fmtDate(p.to)) : def.kind === 'year' ? 'January – December ' + p.year : 'As of ' + U.fmtDate(p.asOf);
    const years = (() => { const ys = {}; b.transactions.forEach((t) => { ys[t.date.slice(0, 4)] = 1; }); ys[U.today().slice(0, 4)] = 1; ys[p.year || U.today().slice(0, 4)] = 1; return Object.keys(ys).sort().reverse(); })();
    const tkey = 'report:' + key + (def.cols ? ':' + (p.columns || 'total') : '') + (def.compare ? ':' + (p.compare || 'none') : '');
    el.innerHTML = `<div class="page report-page fill">
      <div class="page-head no-print"><div><a href="#/reports" class="back">Reports</a><h1>${esc(def.title)}</h1></div>
        <div class="actions">${def.kind === 'year' ? '<a class="btn" href="#/1099">1099 setup</a>' : ''}${def.fields ? '<button type="button" class="btn" id="rp-fields" data-testid="rp-fields">Fields</button>' : UI.columnsButton(tkey)}<button class="btn" data-x="csv">CSV</button><button class="btn" data-x="xlsx" data-key="e">Excel</button><button class="btn" data-x="pdf">PDF</button><button class="btn primary" data-print data-key="p">Print</button></div></div>
      <form class="toolbar wrap no-print" id="rp-form">
        ${def.kind === 'range' ? `<label>Period ${UI.rangeSelect('rp-range', p.range)}</label>
          <label>From <input type="date" id="rp-from" value="${esc(p.from)}"></label><label>To <input type="date" id="rp-to" value="${esc(p.to)}"></label>` : def.kind === 'year' ? `<label>Tax year <select id="rp-year">${years.map((y) => `<option${y === p.year ? ' selected' : ''}>${y}</option>`).join('')}</select></label>
          <label>Vendors <select id="rp-thr"><option value="">All 1099 vendors paid</option><option value="meets"${p.thr === 'meets' ? ' selected' : ''}>Only those over the filing threshold</option></select></label>` : `<label>As of <input type="date" id="rp-asof" value="${esc(p.asOf)}"></label>`}
        ${def.account && b.classes.length ? `<label>Class <select id="rp-class"><option value="">All</option><option value="__none"${p.class === '__none' ? ' selected' : ''}>Not specified</option>${b.sortedClasses().map((c) => `<option value="${esc(c.id)}"${p.class === c.id ? ' selected' : ''}>${esc(b.classFullName(c.id))}</option>`).join('')}</select></label>` : ''}
        ${out.toolbar || ''}
        ${def.basis ? `<label>Basis <select id="rp-basis"><option value="accrual">Accrual</option><option value="cash"${p.basis === 'cash' ? ' selected' : ''}>Cash</option></select></label>` : ''}
        ${def.cols ? `<label>Columns <select id="rp-cols">${[['total', 'Total only'], ['month', 'Months'], ['quarter', 'Quarters'], ['year', 'Years'], ['py', 'vs. previous year']].map(([v, l]) => `<option value="${v}"${p.columns === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>` : ''}
        ${def.compare ? `<label>Compare <select id="rp-cmp">${[['', 'None'], ['pm', 'Previous month end'], ['py', 'Previous year (same date)'], ['m12', 'Last 12 month ends']].map(([v, l]) => `<option value="${v}"${p.compare === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>` : ''}
        ${def.account ? `<label>Account ${UI.comboHtml('account', 'any', p.account, 'id="rp-acc"', { placeholder: 'All accounts', label: 'Account' })}</label>` : ''}
        ${def.detail ? `<label class="check"><input type="checkbox" id="rp-detail" ${p.detail === '1' ? 'checked' : ''}> Show documents</label>` : ''}
        <button class="btn" type="submit">Run report</button>
      </form>
      <article class="report scroll-area" tabindex="0" aria-label="${esc(def.title)}">
        <header><h2>${esc(b.company.name)}</h2><h1>${esc(out.title || def.title)}</h1><p>${esc(period)}${def.basis ? ' · ' + (p.basis === 'cash' ? 'Cash' : 'Accrual') + ' basis' : ''}</p></header>
        ${out.html}
        <footer class="muted small">Generated ${esc(new Date().toLocaleString())} by VaultBook · ${ms} ms</footer>
      </article></div>`;
    const tables = [...el.querySelectorAll('article.report table')].filter((t) => t.tHead && t.tHead.rows.length);
    tables.forEach((t) => { t.dataset.tkey = t.dataset.tsub ? tkey + ':' + t.dataset.tsub : tkey; t.dataset.sticky = '1'; }); // data-tsub: a second table with other columns
    if (!tables.length || headLen(tables[0]) < 3) { const cb = el.querySelector('[data-columns-for]'); if (cb) cb.remove(); }
    const form = el.querySelector('#rp-form');
    const rangeSel = el.querySelector('#rp-range');
    if (rangeSel) rangeSel.addEventListener('change', () => { const rr = UI.ranges()[rangeSel.value]; if (rr) { el.querySelector('#rp-from').value = rr[1]; el.querySelector('#rp-to').value = rr[2]; } });
    ['#rp-from', '#rp-to'].forEach((id) => { const x = el.querySelector(id); if (x) x.addEventListener('change', () => { rangeSel.value = 'custom'; }); });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = (id) => { const x = el.querySelector(id); return x ? (x.type === 'checkbox' ? (x.checked ? '1' : '') : x.value) : undefined; };
      const q = { range: v('#rp-range'), from: v('#rp-range') === 'custom' ? v('#rp-from') : undefined, to: v('#rp-range') === 'custom' ? v('#rp-to') : undefined, asOf: v('#rp-asof'), basis: v('#rp-basis'), columns: v('#rp-cols'), compare: v('#rp-cmp'), account: v('#rp-acc'), detail: v('#rp-detail'), year: v('#rp-year'), thr: v('#rp-thr'), class: v('#rp-class'), contact: p.contact };
      (def.keep || []).forEach((k) => { if (p[k]) q[k] = p[k]; });   // the report's own context (e.g. which statement line) survives a re-run
      el.querySelectorAll('[data-rp]').forEach((x) => { q[x.dataset.rp] = x.value; });   // the report's own toolbar fields
      if (q.range === 'custom' && (!U.isDate(q.from) || !U.isDate(q.to) || q.from > q.to)) return UI.toast('Enter a valid date range.', 'error');
      UI.go('#/report/' + key + '?' + UI.qs(q));
    });
    UI.bindRowLinks(el);   // rows with data-href open on click
    if (out.bind) out.bind(el, p);
    // TallyPrime-style button panel for this report
    const rerun = (ch) => UI.go('#/report/' + key + '?' + UI.qs(Object.assign({}, p, ch)));
    const colOpts = [['total', 'Total only'], ['month', 'Months'], ['quarter', 'Quarters'], ['year', 'Years'], ['py', 'vs. previous year']];
    UI.reportCtl = { hash: location.hash,
      period: def.kind === 'range' ? { from: p.from, to: p.to, apply: (f, t) => rerun({ range: 'custom', from: f, to: t }) } : def.kind === 'asof' ? { asOf: p.asOf, apply: (d) => rerun({ asOf: d }) } : null,
      auto: def.cols ? { value: p.columns || 'total', options: colOpts, apply: (v) => rerun({ columns: v }) } : null,
      newcol: def.compare ? { multi: false, value: p.compare || '', options: [['', 'None'], ['pm', 'Previous month end'], ['py', 'Previous year (same date)'], ['m12', 'Last 12 month ends']], apply: (v) => rerun({ compare: v }) } : null,
      basis: def.basis ? { value: p.basis, options: [['accrual', 'Accrual'], ['cash', 'Cash']], apply: (v) => rerun({ basis: v }) } : null,
      detail: def.detail ? { on: p.detail === '1', apply: () => rerun({ detail: p.detail === '1' ? '' : '1' }) } : (el.querySelector('article.report details') ? { on: !![...el.querySelectorAll('article.report details')].every((d) => d.open), apply: () => { const ds = [...el.querySelectorAll('article.report details')], open = !ds.every((d) => d.open); ds.forEach((d) => { d.open = open; }); UI.keys.renderPanel(); } } : null),
      account: def.account ? { value: p.account || '', options: [['', 'All accounts']].concat(b.sortedAccounts((a) => a.active !== false).map((a) => [a.id, b.accountLabel(a.id)])), apply: (v) => rerun({ account: v }) } : null };
    const pb = el.querySelector('[data-print]'); if (pb) pb.addEventListener('click', () => window.print());
    el.querySelectorAll('[data-x]').forEach((btn) => btn.addEventListener('click', () => {
      const header = [[{ v: b.company.name, bold: true }], [{ v: out.title || def.title, bold: true }], [period + (def.basis ? ' · ' + p.basis + ' basis' : '')], []];
      UI.exportMatrix(def.title.replace(/[^A-Za-z]+/g, '_'), header.concat(out.matrix), btn.dataset.x, { report: true });
    }));
  };

  /* drill-down helpers */
  const glLink = (accountId, from, to, html, basis) => `<a href="#/report/gl?${UI.qs({ account: accountId, range: 'custom', from: from || '1900-01-01', to, basis })}">${html}</a>`;
  const cell = (c, opts) => `<td class="num">${UI.money(c, opts)}</td>`;

  const RENDER = {};

  /* ---------- Trial balance ---------- */
  RENDER.tb = (b, p) => {
    const rep = R.trialBalance(b, { asOf: p.asOf, basis: p.basis });
    const fys = U.fiscalYearStart(p.asOf, b.company.fiscalYearStartMonth);
    const mtx = [[{ v: 'Account', bold: true }, { v: 'Debit', bold: true }, { v: 'Credit', bold: true }]];
    let html = `<table class="statement narrow"><thead><tr><th>Account</th><th class="num">Debit</th><th class="num">Credit</th></tr></thead><tbody>`;
    rep.rows.forEach((row) => {
      const from = S.isPL(row.type) ? fys : null;
      html += `<tr><td>${esc(row.label)}</td><td class="num">${row.debit ? glLink(row.accountId, from, p.asOf, UI.money(row.debit), p.basis) : ''}</td><td class="num">${row.credit ? glLink(row.accountId, from, p.asOf, UI.money(row.credit), p.basis) : ''}</td></tr>`;
      mtx.push([row.label, row.debit ? m(row.debit) : '', row.credit ? m(row.credit) : '']);
    });
    html += `<tr class="grand"><td>Total</td>${cell(rep.totalDebit)}${cell(rep.totalCredit)}</tr></tbody></table>
      <p class="check-line ${rep.balanced ? 'ok' : 'bad'}">${rep.balanced ? '✓ Debits equal credits.' : '✗ Debits and credits differ by ' + U.fmt(rep.totalDebit - rep.totalCredit, { symbol: true })}</p>
      <p class="muted small">Income and expense accounts show fiscal-year-to-date amounts (from ${U.fmtDate(fys)}); earlier years’ profit is included in Retained Earnings.</p>`;
    mtx.push([{ v: 'Total', bold: true }, m(rep.totalDebit, true), m(rep.totalCredit, true)]);
    return { html, matrix: mtx };
  };

  /* ---------- Report reconciliation ---------- */
  RENDER.recon = (b, p) => {
    const rep = R.reconcile(b, { from: p.from, to: p.to, basis: p.basis });
    const mtx = [['Check', 'Expected', 'Actual', 'Difference', 'Result'].map((h) => ({ v: h, bold: true }))];
    let html = `<table class="statement"><thead><tr><th>Check</th><th class="num">Expected</th><th class="num">Actual</th><th class="num">Difference</th><th>Result</th></tr></thead><tbody>`;
    rep.checks.forEach((c) => {
      html += `<tr><td>${esc(c.label)}</td>${cell(c.expected)}${cell(c.actual)}${cell(c.actual - c.expected)}<td class="${c.ok ? 'ok' : 'bad'}">${c.ok ? '✓ Ties' : '✗ Does not tie'}</td></tr>`;
      mtx.push([c.label, m(c.expected), m(c.actual), m(c.actual - c.expected), c.ok ? 'Ties' : 'Does not tie']);
    });
    html += `</tbody></table><p class="check-line ${rep.ok ? 'ok' : 'bad'}">${rep.ok ? '✓ Every report ties to the ledger.' : '✗ Some reports do not tie. Run Settings → Data integrity.'}</p>
      <p class="muted small">Balances are as of ${esc(U.fmtDate(p.to))}; profit, loss and cash flow cover the period. Excel and PDF exports are produced from the same figures as the screen.</p>`;
    return { html, matrix: mtx };
  };

  /* ---------- General ledger ---------- */
  RENDER.gl = (b, p) => {
    const rep = R.generalLedger(b, { from: p.from, to: p.to, basis: p.basis, accountIds: p.account ? [p.account] : null, plFromFiscalStart: false, classId: p.class || '', contactId: p.contact ? (p.contact === '__none' ? '' : p.contact) : undefined });
    const filt = [p.class ? 'Class: ' + (p.class === '__none' ? 'Not specified' : b.classFullName(p.class)) : '', p.contact ? (p.contact === '__none' ? 'No customer/vendor' : UI.contactName(p.contact)) : ''].filter(Boolean);
    const mtx = [['Account', 'Date', 'Type', 'No.', 'Name', 'Memo', 'Split', 'Debit', 'Credit', 'Balance'].map((h) => ({ v: h, bold: true }))];
    const MAX = 5000;
    let shown = 0, truncated = false;
    let html = '';
    if (!rep.accounts.length) html = UI.empty('No activity for this period.');
    rep.accounts.forEach((a) => {
      html += `<section class="gl-acc"><h2 class="gl-h"><a href="#/register/${esc(a.accountId)}">${esc(a.label)}</a></h2><div class="scroll-x"><table class="statement gl"><thead><tr><th>Date</th><th>Type</th><th>No.</th><th>Name</th><th>Memo</th><th>Split</th><th class="num">Debit</th><th class="num">Credit</th><th class="num">Balance</th></tr></thead><tbody>
        <tr class="muted"><td colspan="8">Beginning balance</td>${cell(a.opening)}</tr>`;
      mtx.push([{ v: a.label, bold: true }]); mtx.push(['', '', 'Beginning balance', '', '', '', '', '', '', m(a.opening)]);
      a.rows.forEach((x) => {
        if (shown < MAX) html += `<tr><td>${UI.date(x.date)}</td><td>${UI.txnLink(x.t, x.type)}</td><td>${esc(x.number)}</td><td>${esc(x.name)}</td><td class="memo">${esc(x.memo)}</td><td class="memo">${esc(x.split)}</td><td class="num">${x.debit ? UI.money(x.debit) : ''}</td><td class="num">${x.credit ? UI.money(x.credit) : ''}</td>${cell(x.balance)}</tr>`;
        else truncated = true;
        shown++;
        mtx.push(['', U.fmtDate(x.date), x.type, x.number, x.name, x.memo, x.split, x.debit ? m(x.debit) : '', x.credit ? m(x.credit) : '', m(x.balance)]);
      });
      html += `<tr class="subtotal"><td colspan="6">Total ${esc(a.label)}</td>${cell(a.totalDebit)}${cell(a.totalCredit)}${cell(a.closing)}</tr></tbody></table></div></section>`;
      mtx.push([{ v: 'Total ' + a.label, bold: true }, '', '', '', '', '', '', m(a.totalDebit, true), m(a.totalCredit, true), m(a.closing, true)]);
    });
    if (filt.length) html = `<p class="muted">Filtered — ${esc(filt.join(' · '))}. <a href="#/report/gl?${UI.qs({ account: p.account, range: p.range, from: p.from, to: p.to, basis: p.basis })}">Show all</a></p>` + html;
    if (truncated) html = `<div class="banner info">Showing the first ${MAX.toLocaleString()} of ${shown.toLocaleString()} lines on screen. CSV and Excel exports include every line. Narrow the dates or pick one account to see more here.</div>` + html;
    return { html, matrix: mtx };
  };

  /* ---------- Transaction Detail By Account (QuickBooks Desktop layout) ----------
     p.src: 'pnl' | 'bs'; p.node: a statement row key ('s:income', 'a:<account id>' …) or 'net:<key>' for a computed line.
     The statement is rebuilt with the same dates, basis and filters, so headings and subtotals match the line clicked. */
  const NET_PARTS = { gross: ['income', 'cogs'], netop: ['income', 'cogs', 'expense'], netother: ['oi', 'oe'], net: ['income', 'cogs', 'expense', 'oi', 'oe'], inc: ['income', 'oi'], exp: ['cogs', 'expense', 'oe'] };
  const NET_TITLES = { inc: 'Income', exp: 'Expenses' }; // dashboard drill-downs: all income / all expenses
  RENDER.txdetail = (b, p) => {
    const kind = p.src === 'bs' ? 'bs' : 'pl';
    const st = R.statement(b, { kind, from: p.from, to: p.to, basis: p.basis, columns: 'total', compare: [], classId: p.class || '', contactId: p.contact ? (p.contact === '__none' ? '' : p.contact) : undefined, rows: 'active', cols: 'active', titles: {} });
    const find = (list, key) => { for (const n of list || []) { if (n.key === key) return n; const x = find(n.children, key); if (x) return x; } return null; };
    let roots, title = kind === 'bs' ? 'Balance Sheet accounts' : 'Profit and Loss accounts';
    if (p.node && /^net:/.test(p.node)) { const keys = NET_PARTS[p.node.slice(4)] || []; roots = st.tree.filter((n) => n.kind === 'group' && keys.indexOf(n.section) >= 0); const net = st.tree.find((n) => n.key === 'n:' + p.node.slice(4)); if (net) title = net.label; else if (NET_TITLES[p.node.slice(4)]) title = NET_TITLES[p.node.slice(4)]; }
    else if (p.node) { const n = find(st.tree, p.node); roots = n ? [n] : []; if (n) title = n.label; }
    else roots = st.tree.filter((n) => n.kind === 'group');
    const ids = []; const collect = (n) => { if (n.accountId && ids.indexOf(n.accountId) < 0) ids.push(n.accountId); (n.children || []).forEach(collect); }; roots.forEach(collect);
    const gl = R.generalLedger(b, { from: p.from, to: p.to, basis: p.basis, accountIds: ids, plFromFiscalStart: false, classId: p.class || '', contactId: p.contact ? (p.contact === '__none' ? '' : p.contact) : undefined });
    const byAcc = {}; gl.accounts.forEach((a) => { byAcc[a.accountId] = a; });
    const signs = {}; ids.forEach((id) => { signs[b.normalSign(b.accById[id])] = 1; });
    const sameSign = Object.keys(signs).length <= 1;
    const H = ['Type', 'Date', 'Num', 'Name', 'Memo', 'Split', 'Debit', 'Credit', 'Balance'];
    const mtx = [[{ v: '', bold: true }].concat(H.map((h) => ({ v: h, bold: true })))];
    const pad = (d) => `style="padding-left:${0.5 + d * 0.9}rem"`;
    let html = '', rows = 0;
    const money = (c, bold) => c ? UI.money(c) : (bold ? UI.money(0) : '');
    const totalRow = (label, t, depth, cls) => {
      html += `<tr class="txd-tot ${cls || ''}"><td class="lbl" colspan="6" ${pad(depth)}>${esc(label)}</td><td class="num">${UI.money(t.debit)}</td><td class="num">${UI.money(t.credit)}</td><td class="num">${t.balance === null ? '' : UI.money(t.balance)}</td></tr>`;
      mtx.push([{ v: label, bold: true }, '', '', '', '', '', '', m(t.debit, true), m(t.credit, true), t.balance === null ? '' : m(t.balance, true)]);
    };
    const walk = (n, depth) => {
      const t = { debit: 0, credit: 0, balance: 0 };
      const leaf = n.accountId && !(n.children || []).some((c) => c.accountId || c.kind === 'group');
      if (leaf) {
        const a = byAcc[n.accountId]; if (!a || (!a.rows.length && !a.opening)) return null;
        html += `<tr class="txd-acc"><td class="lbl" colspan="9" ${pad(depth)}>${esc(n.label)}</td></tr>`; mtx.push([{ v: n.label, bold: true }]);
        if (a.opening) { html += `<tr class="txd-open muted"><td colspan="8" class="txd-t">Beginning balance</td><td class="num">${UI.money(a.opening)}</td></tr>`; mtx.push(['', 'Beginning balance', '', '', '', '', '', '', '', m(a.opening)]); }
        a.rows.forEach((x) => {
          rows++;
          html += `<tr class="click txd-row" data-href="#/txn/${esc(x.t.id)}"><td class="txd-t">${UI.txnLink(x.t, x.type)}</td><td>${UI.date(x.date)}</td><td>${esc(x.number || '')}</td><td class="memo"><span title="${esc(x.name)}">${esc(x.name)}</span></td><td class="memo"><span title="${esc(x.memo || '')}">${esc(x.memo || '')}</span></td><td class="memo"><span title="${esc(x.split)}">${esc(x.split)}</span></td><td class="num">${money(x.debit)}</td><td class="num">${money(x.credit)}</td><td class="num">${UI.money(x.balance)}</td></tr>`;
          mtx.push(['', x.type, U.fmtDate(x.date), x.number || '', x.name, x.memo || '', x.split, x.debit ? m(x.debit) : '', x.credit ? m(x.credit) : '', m(x.balance)]);
        });
        t.debit = a.totalDebit; t.credit = a.totalCredit; t.balance = a.closing;
        totalRow('Total ' + n.label, t, depth);
        return t;
      }
      if (n.kind !== 'group') return null;
      const mark = html.length, mlen = mtx.length;
      html += `<tr class="txd-grp d${depth}"><td class="lbl" colspan="9" ${pad(depth)}>${esc(n.label)}</td></tr>`; mtx.push([{ v: n.label, bold: true }]);
      let any = false;
      (n.children || []).forEach((c) => { const r = walk(c, depth + 1); if (r) { any = true; t.debit += r.debit; t.credit += r.credit; t.balance += r.balance; } });
      if (!any) { html = html.slice(0, mark); mtx.length = mlen; return null; }
      totalRow(n.totalLabel || 'Total ' + n.label, t, depth);
      return t;
    };
    const grand = { debit: 0, credit: 0, balance: 0 };
    roots.forEach((n) => { const r = walk(n, 0); if (r) { grand.debit += r.debit; grand.credit += r.credit; grand.balance += r.balance; } });
    if (!sameSign) grand.balance = null;
    if (!rows && !html) html = UI.empty('No transactions for this line in the period.');
    else {
      totalRow('TOTAL', grand, 0, 'txd-grand');
      html = `<div class="scroll-x"><table class="statement txd"><thead><tr>${H.map((h, i) => `<th${i >= 6 ? ' class="num"' : i === 0 ? ' class="txd-t"' : ''}>${h}</th>`).join('')}</tr></thead><tbody>${html}</tbody></table></div>`;
    }
    if (p.node) html = `<p class="muted small no-print">Showing ${esc(title)}. <a href="#/report/txdetail?${UI.qs({ src: p.src, range: 'custom', from: p.from, to: p.to, basis: p.basis })}">All ${kind === 'bs' ? 'balance sheet' : 'profit and loss'} accounts</a></p>` + html;
    return { html, matrix: mtx, title: 'Transaction Detail By Account' };
  };

  /* ---------- Journal ---------- */
  RENDER.journal = (b, p) => {
    const list = R.transactionList(b, { from: p.from, to: p.to }).reverse();
    const mtx = [['Date', 'Type', 'No.', 'Name', 'Memo', 'Account', 'Debit', 'Credit'].map((h) => ({ v: h, bold: true }))];
    let html = `<div class="scroll-x"><table class="statement gl"><thead><tr><th>Date</th><th>Type</th><th>No.</th><th>Name</th><th>Account</th><th>Memo</th><th class="num">Debit</th><th class="num">Credit</th></tr></thead><tbody>`;
    let td = 0, tc = 0, n = 0;
    list.forEach((t) => {
      t.splits.forEach((s, i) => {
        if (n < 6000) html += `<tr class="${i === 0 ? 'first' : ''}"><td>${i === 0 ? UI.date(t.date) : ''}</td><td>${i === 0 ? UI.txnLink(t, UI.typeLabel(t.type)) : ''}</td><td>${i === 0 ? esc(t.number) : ''}</td><td>${esc(UI.contactName(s.contactId))}</td><td>${esc(b.accountLabel(s.accountId))}</td><td class="memo">${esc(s.memo)}</td><td class="num">${s.amount > 0 ? UI.money(s.amount) : ''}</td><td class="num">${s.amount < 0 ? UI.money(-s.amount) : ''}</td></tr>`;
        n++;
        if (s.amount > 0) td += s.amount; else tc -= s.amount;
        mtx.push([U.fmtDate(t.date), UI.typeLabel(t.type), t.number, UI.contactName(s.contactId), s.memo || t.memo, b.accountLabel(s.accountId), s.amount > 0 ? m(s.amount) : '', s.amount < 0 ? m(-s.amount) : '']);
      });
    });
    html += `<tr class="grand"><td colspan="6">Total</td>${cell(td)}${cell(tc)}</tr></tbody></table></div>`;
    if (n > 6000) html = `<div class="banner info">Showing the first 6,000 of ${n.toLocaleString()} lines; exports include all lines.</div>` + html;
    mtx.push([{ v: 'Total', bold: true }, '', '', '', '', '', m(td, true), m(tc, true)]);
    return { html, matrix: mtx };
  };

  /* ---------- Aging ---------- */
  const aging = (kind) => (b, p) => {
    const rep = R.aging(b, { kind, asOf: p.asOf });
    const heads = ['Name'].concat(rep.bucketLabels).concat(['Total']);
    const mtx = [heads.map((h) => ({ v: h, bold: true }))];
    let html = `<div class="scroll-x"><table class="statement"><thead><tr>${heads.map((h, i) => `<th class="${i ? 'num' : ''}">${esc(h)}</th>`).join('')}</tr></thead><tbody>`;
    rep.rows.forEach((row) => {
      html += `<tr><td><a href="#/contact/${esc(row.contactId)}">${esc(row.name)}</a></td>${row.buckets.map((v) => `<td class="num">${UI.money(v, { blankZero: true })}</td>`).join('')}${cell(row.total)}</tr>`;
      mtx.push([row.name].concat(row.buckets.map((v) => m(v))).concat([m(row.total)]));
      if (p.detail === '1') row.docs.sort((x, y) => x.t.date < y.t.date ? -1 : 1).forEach((d) => {
        html += `<tr class="detail"><td class="ind1">${UI.txnLink(d.t)} <span class="muted">${U.fmtDate(d.t.date)}${d.due && !d.other ? ' · due ' + U.fmtDate(d.due) : ''}</span></td>${rep.bucketLabels.map((_, i) => `<td class="num">${i === d.bucket ? UI.money(d.open) : ''}</td>`).join('')}<td></td></tr>`;
        mtx.push(['    ' + UI.typeLabel(d.t.type) + ' ' + (d.t.number || '') + ' ' + U.fmtDate(d.t.date)].concat(rep.bucketLabels.map((_, i) => i === d.bucket ? m(d.open) : '')));
      });
    });
    html += `<tr class="grand"><td>Total</td>${rep.totals.map((v) => cell(v)).join('')}${cell(rep.total)}</tr></tbody></table></div>`;
    mtx.push([{ v: 'Total', bold: true }].concat(rep.totals.map((v) => m(v, true))).concat([m(rep.total, true)]));
    const accName = kind === 'customer' ? 'Accounts Receivable' : 'Accounts Payable';
    html += `<p class="check-line ${rep.total === rep.accountBalance ? 'ok' : 'bad'}">${rep.total === rep.accountBalance ? '✓' : '✗'} Ties to ${accName} balance of ${U.fmt(rep.accountBalance, { symbol: true })} on ${U.fmtDate(p.asOf)}.</p>`;
    if (!rep.rows.length) html = UI.empty('Nothing outstanding on this date.') + html;
    return { html, matrix: mtx };
  };
  RENDER.araging = aging('customer');
  RENDER.apaging = aging('vendor');

  const balSummary = (kind) => (b, p) => {
    const list = b.contacts.filter((c) => c.kind === kind).map((c) => ({ c, bal: b.contactBalance(c.id, p.asOf) })).filter((x) => x.bal).sort((x, y) => x.c.name.localeCompare(y.c.name));
    const total = U.sum(list, (x) => x.bal);
    const acc = kind === 'customer' ? b.sys('AR') : b.sys('AP');
    const accBal = b.accountBalance(acc.id, p.asOf);
    const mtx = [[{ v: 'Name', bold: true }, { v: 'Balance', bold: true }]];
    let html = `<table class="statement narrow"><thead><tr><th>Name</th><th class="num">Balance</th></tr></thead><tbody>`;
    list.forEach((x) => { html += `<tr><td><a href="#/contact/${esc(x.c.id)}">${esc(x.c.name)}</a></td>${cell(x.bal)}</tr>`; mtx.push([x.c.name, m(x.bal)]); });
    html += `<tr class="grand"><td>Total</td>${cell(total)}</tr></tbody></table><p class="check-line ${total === accBal ? 'ok' : 'bad'}">${total === accBal ? '✓' : '✗'} Ties to ${esc(acc.name)}: ${U.fmt(accBal, { symbol: true })}.</p>`;
    mtx.push([{ v: 'Total', bold: true }, m(total, true)]);
    return { html, matrix: mtx };
  };
  RENDER.custbal = balSummary('customer');
  RENDER.vendbal = balSummary('vendor');

  /* ---------- Cash flow ---------- */
  RENDER.cf = (b, p) => {
    const rep = R.cashFlow(b, { from: p.from, to: p.to, basis: p.basis });
    const mtx = [[{ v: '', bold: true }, { v: 'Amount', bold: true }]];
    let html = `<table class="statement narrow"><tbody>`;
    const sec = (title, rows, total, label, ni) => {
      html += `<tr class="section"><td colspan="2">${title}</td></tr>`; mtx.push([{ v: title, bold: true }]);
      if (ni !== undefined) { html += `<tr><td class="ind1"><a href="#/report/pnl?${UI.qs({ range: 'custom', from: p.from, to: p.to, basis: p.basis })}">Net Income</a></td>${cell(ni)}</tr>`; mtx.push(['  Net Income', m(ni)]); if (rows.length) { html += `<tr><td class="ind1 muted" colspan="2">Adjustments to reconcile net income to net cash provided by operations:</td></tr>`; } }
      rows.forEach((r) => { html += `<tr><td class="ind2">${esc(r.label)}</td><td class="num">${r.accountId ? glLink(r.accountId, p.from, p.to, UI.money(r.amount), p.basis) : UI.money(r.amount)}</td></tr>`; mtx.push(['    ' + r.label, m(r.amount)]); });
      html += `<tr class="subtotal"><td>${label}</td>${cell(total)}</tr>`; mtx.push([{ v: label, bold: true }, m(total, true)]);
    };
    sec('Operating Activities', rep.operating, rep.netOperating, 'Net cash provided by operating activities', rep.netIncome);
    sec('Investing Activities', rep.investing, rep.netInvesting, 'Net cash provided by investing activities');
    sec('Financing Activities', rep.financing, rep.netFinancing, 'Net cash provided by financing activities');
    html += `<tr class="subtotal strong"><td>Net cash increase (decrease) for period</td>${cell(rep.netChange)}</tr>
      <tr><td>Cash at beginning of period</td>${cell(rep.cashBegin)}</tr><tr class="grand"><td>Cash at end of period</td>${cell(rep.cashEnd)}</tr></tbody></table>
      <p class="check-line ${rep.reconciles ? 'ok' : 'bad'}">${rep.reconciles ? '✓ Reconciles to the change in cash (bank accounts and Undeposited Funds).' : '✗ Does not reconcile to the change in cash.'}</p>`;
    mtx.push([{ v: 'Net cash increase (decrease)', bold: true }, m(rep.netChange, true)], ['Cash at beginning of period', m(rep.cashBegin)], [{ v: 'Cash at end of period', bold: true }, m(rep.cashEnd, true)]);
    return { html, matrix: mtx };
  };

  /* ---------- Expenses ---------- */
  RENDER.expdetail = (b, p) => {
    const rep = R.expenseDetail(b, { from: p.from, to: p.to, basis: p.basis });
    const mtx = [['Account', 'Date', 'Type', 'No.', 'Payee', 'Memo', 'Amount'].map((h) => ({ v: h, bold: true }))];
    let html = '';
    rep.accounts.forEach((a) => {
      html += `<section class="gl-acc"><h2 class="gl-h">${glLink(a.accountId, p.from, p.to, esc(a.label), p.basis)}</h2><div class="scroll-x"><table class="statement gl"><thead><tr><th>Date</th><th>Type</th><th>No.</th><th>Payee</th><th>Memo</th><th class="num">Amount</th></tr></thead><tbody>`;
      mtx.push([{ v: a.label, bold: true }]);
      a.rows.forEach((x) => {
        const amt = x.debit - x.credit;
        html += `<tr><td>${UI.date(x.date)}</td><td>${UI.txnLink(x.t, x.type)}</td><td>${esc(x.number)}</td><td>${esc(x.name)}</td><td class="memo">${esc(x.memo)}</td>${cell(amt)}</tr>`;
        mtx.push(['', U.fmtDate(x.date), x.type, x.number, x.name, x.memo, m(amt)]);
      });
      html += `<tr class="subtotal"><td colspan="5">Total ${esc(a.label)}</td>${cell(a.closing)}</tr></tbody></table></div></section>`;
      mtx.push([{ v: 'Total ' + a.label, bold: true }, '', '', '', '', '', m(a.closing, true)]);
    });
    html += `<table class="statement narrow"><tbody><tr class="grand"><td>Total expenses</td>${cell(rep.total)}</tr></tbody></table>`;
    mtx.push([{ v: 'Total expenses', bold: true }, '', '', '', '', '', m(rep.total, true)]);
    if (!rep.accounts.length) html = UI.empty('No expenses in this period.');
    return { html, matrix: mtx };
  };
  RENDER.expvendor = (b, p) => {
    const rep = R.expenseByVendor(b, { from: p.from, to: p.to, basis: p.basis });
    const mtx = [[{ v: 'Vendor / payee', bold: true }, { v: 'Total', bold: true }]];
    let html = `<table class="statement narrow"><thead><tr><th>Vendor / payee</th><th class="num">Total</th></tr></thead><tbody>`;
    rep.rows.forEach((r) => { html += `<tr><td>${r.contactId ? `<a href="#/contact/${esc(r.contactId)}">${esc(r.name)}</a>` : esc(r.name)}</td>${cell(r.amount)}</tr>`; mtx.push([r.name, m(r.amount)]); });
    html += `<tr class="grand"><td>Total</td>${cell(rep.total)}</tr></tbody></table>`;
    mtx.push([{ v: 'Total', bold: true }, m(rep.total, true)]);
    return { html, matrix: mtx };
  };

  /* ---------- 1099 ---------- */
  const box = (id) => S.BOXES_1099.find((x) => x.id === id);
  const setupHint = (rep) => !rep.mappedCount ? `<div class="banner warn"><strong>No expense accounts are mapped to 1099 boxes yet.</strong> <a href="#/1099">Open 1099 setup</a> to choose which accounts hold contractor payments, rent and so on.</div>` :
    !rep.vendors1099 ? `<div class="banner warn">No vendors are marked “Track for 1099”. <a href="#/1099">Open 1099 setup</a> to mark them.</div>` : '';
  RENDER.t1099 = (b, p) => {
    const rep = R.report1099(b, { year: p.year, threshold: p.thr });
    const heads = ['Vendor', 'Tax ID'].concat(rep.boxes.map((x) => x.form.replace('1099-', '') + ' box ' + x.box + ' — ' + x.label)).concat(['Total', 'Status']);
    const mtx = [heads.map((h) => ({ v: h, bold: true }))];
    let html = setupHint(rep) + `<div class="scroll-x"><table class="statement"><thead><tr>${heads.map((h, i) => `<th class="${i > 1 && i < heads.length - 1 ? 'num' : ''}">${esc(h)}</th>`).join('')}</tr></thead><tbody>`;
    rep.rows.forEach((r) => {
      const status = [r.meets ? '<span class="badge ok">File 1099</span>' : '<span class="badge">Under threshold</span>', r.missingTaxId ? '<span class="badge danger">No tax ID</span>' : '', !r.is1099 ? '<span class="badge warn">Not tracked</span>' : ''].join(' ');
      html += `<tr><td><a href="#/contact/${esc(r.contactId)}">${esc(r.name)}</a></td><td>${esc(r.taxId ? r.taxId.replace(/^(\d{3}|\d{2})-?(\d{2})?-?(\d+)$/, (m0) => '•••' + m0.slice(-4)) : '—')}</td>${rep.boxes.map((x) => `<td class="num">${r.boxes[x.id] ? `<a href="#/report/d1099?${UI.qs({ year: p.year, contact: r.contactId })}">${UI.money(r.boxes[x.id])}</a>` : ''}</td>`).join('')}<td class="num">${UI.money(r.total)}</td><td>${status}</td></tr>`;
      mtx.push([r.name, r.taxId].concat(rep.boxes.map((x) => r.boxes[x.id] ? m(r.boxes[x.id]) : '')).concat([m(r.total), (r.meets ? 'File 1099' : 'Under threshold') + (r.missingTaxId ? ' · No tax ID' : '')]));
    });
    html += `<tr class="grand"><td colspan="2">Total</td>${rep.boxes.map((x) => cell(rep.totals[x.id])).join('')}${cell(rep.total)}<td></td></tr></tbody></table></div>`;
    mtx.push([{ v: 'Total', bold: true }, ''].concat(rep.boxes.map((x) => m(rep.totals[x.id], true))).concat([m(rep.total, true)]));
    if (!rep.rows.length) html = setupHint(rep) + UI.empty('No payments to 1099 vendors from bank accounts in ' + esc(p.year) + '.');
    html += `<p class="muted small">Counts money paid in ${esc(p.year)} from bank accounts (checks, expenses and bill payments) to accounts mapped in 1099 setup. Credit card and payment-app payments are excluded — the card company reports those on Form 1099-K.
      Filing threshold for ${esc(p.year)}: ${U.fmt(S.threshold1099('NEC1', p.year), { symbol: true })} per box (royalties ${U.fmt(S.threshold1099('MISC2', p.year), { symbol: true })}). Check current IRS rules before filing.</p>`;
    if (rep.missingTaxId.length) html += `<div class="banner warn">${rep.missingTaxId.length} vendor${rep.missingTaxId.length === 1 ? '' : 's'} tracked for 1099 ${rep.missingTaxId.length === 1 ? 'has' : 'have'} no tax ID: ${rep.missingTaxId.map((c) => `<a href="#/contact/${esc(c.id)}">${esc(c.name)}</a>`).join(', ')}.</div>`;
    return { html, matrix: mtx, title: '1099 Contractor Summary — ' + p.year };
  };
  RENDER.d1099 = (b, p) => {
    const rep = R.report1099(b, { year: p.year });
    const list = rep.detail.filter((d) => !p.contact || d.contactId === p.contact);
    const mtx = [['Date', 'Type', 'No.', 'Vendor', 'Account', '1099 box', 'Memo', 'Amount'].map((h) => ({ v: h, bold: true }))];
    let html = setupHint(rep) + (p.contact ? `<p class="muted">Vendor: <strong>${esc(UI.contactName(p.contact))}</strong> · <a href="#/report/d1099?year=${esc(p.year)}">Show all vendors</a></p>` : '') +
      `<div class="scroll-x"><table class="statement gl"><thead><tr><th>Date</th><th>Type</th><th>No.</th><th>Vendor</th><th>Account</th><th>1099 box</th><th>Memo</th><th class="num">Amount</th></tr></thead><tbody>`;
    list.forEach((d) => {
      const bx = box(d.box);
      html += `<tr><td>${UI.date(d.t.date)}</td><td>${UI.txnLink(d.t, UI.typeLabel(d.t.type))}</td><td>${esc(d.t.number)}</td><td>${esc(UI.contactName(d.contactId))}</td><td>${esc(b.accountLabel(d.accountId))}</td><td>${esc(bx.form + ' ' + bx.box)}</td><td class="memo">${esc(d.memo)}</td>${cell(d.amount)}</tr>`;
      mtx.push([U.fmtDate(d.t.date), UI.typeLabel(d.t.type), d.t.number, UI.contactName(d.contactId), b.accountLabel(d.accountId), bx.form + ' box ' + bx.box, d.memo, m(d.amount)]);
    });
    const total = U.sum(list, (d) => d.amount);
    html += `<tr class="grand"><td colspan="7">Total</td>${cell(total)}</tr></tbody></table></div>`;
    mtx.push([{ v: 'Total', bold: true }, '', '', '', '', '', '', m(total, true)]);
    if (!list.length) html = setupHint(rep) + UI.empty('No 1099 payments in ' + esc(p.year) + '.');
    return { html, matrix: mtx, title: '1099 Transaction Detail — ' + p.year };
  };

  /* ---------- Transaction list ---------- */
  RENDER.txlist = (b, p) => {
    const list = R.transactionList(b, { from: p.from, to: p.to }).reverse();
    const mtx = [['Date', 'Type', 'No.', 'Name', 'Memo', 'Accounts', 'Amount'].map((h) => ({ v: h, bold: true }))];
    let html = `<div class="scroll-x"><table class="statement gl"><thead><tr><th>Date</th><th>Type</th><th>No.</th><th>Name</th><th>Memo</th><th>Accounts</th><th class="num">Amount</th></tr></thead><tbody>`;
    list.forEach((t, i) => {
      const accs = [...new Set(t.splits.map((s) => b.accById[s.accountId] ? b.accById[s.accountId].name : '?'))].join(', ');
      if (i < 5000) html += `<tr><td>${UI.date(t.date)}</td><td>${UI.txnLink(t, UI.typeLabel(t.type))}</td><td>${esc(t.number)}</td><td>${esc(UI.contactName(t.contactId))}</td><td class="memo">${esc(t.memo)}</td><td class="memo">${esc(accs)}</td>${cell(t.total)}</tr>`;
      mtx.push([U.fmtDate(t.date), UI.typeLabel(t.type), t.number, UI.contactName(t.contactId), t.memo, accs, m(t.total)]);
    });
    html += `</tbody></table></div><p class="muted">${list.length.toLocaleString()} transactions${list.length > 5000 ? ' (first 5,000 shown; exports include all)' : ''}.</p>`;
    return { html, matrix: mtx };
  };

  /* ---------- Open invoices / unpaid bills ---------- */
  const termsText = (b, t) => {
    const c = b.contactById[t.contactId];
    if (t.terms !== '' && t.terms !== undefined && t.terms !== null) return +t.terms === 0 ? 'Due on receipt' : 'Net ' + t.terms;
    return c && c.paymentTerms ? c.paymentTerms : '';
  };
  const openDocs = (kind) => (b, p) => {
    const rep = R.openDocs(b, { kind, asOf: p.asOf });
    const heads = ['Type', 'Date', 'No.', 'Terms', 'Due date', 'Aging', 'Open balance'];
    const mtx = [heads.map((h) => ({ v: h, bold: true }))];
    let html = `<div class="scroll-x"><table class="statement gl"><thead><tr>${heads.map((h, i) => `<th class="${i >= 5 ? 'num' : ''}">${esc(h)}</th>`).join('')}</tr></thead><tbody>`;
    rep.groups.forEach((g) => {
      html += `<tr class="section"><td colspan="7">${g.contactId ? `<a href="#/contact/${esc(g.contactId)}">${esc(g.name)}</a>` : esc(g.name)}</td></tr>`;
      mtx.push([{ v: g.name, bold: true }]);
      g.docs.forEach((d) => {
        const tm = d.other ? '' : termsText(b, d.t);
        html += `<tr><td class="ind1">${UI.txnLink(d.t, UI.typeLabel(d.type))}</td><td>${UI.date(d.date)}</td><td>${esc(d.number)}</td><td>${esc(tm)}</td><td>${d.due ? UI.date(d.due) : ''}</td><td class="num">${d.aging || ''}</td>${cell(d.open)}</tr>`;
        mtx.push(['  ' + UI.typeLabel(d.type), U.fmtDate(d.date), d.number, tm, d.due ? U.fmtDate(d.due) : '', d.aging || '', m(d.open)]);
      });
      html += `<tr class="subtotal"><td colspan="6">Total ${esc(g.name)}</td>${cell(g.total)}</tr>`;
      mtx.push([{ v: 'Total ' + g.name, bold: true }, '', '', '', '', '', m(g.total, true)]);
    });
    html += `<tr class="grand"><td colspan="6">Total</td>${cell(rep.total)}</tr></tbody></table></div>`;
    mtx.push([{ v: 'Total', bold: true }, '', '', '', '', '', m(rep.total, true)]);
    const accName = kind === 'customer' ? 'Accounts Receivable' : 'Accounts Payable';
    html += `<p class="check-line ${rep.total === rep.accountBalance ? 'ok' : 'bad'}">${rep.total === rep.accountBalance ? '✓' : '✗'} Ties to ${accName} balance of ${U.fmt(rep.accountBalance, { symbol: true })} on ${U.fmtDate(p.asOf)}.</p>`;
    if (!rep.groups.length) html = UI.empty(kind === 'customer' ? 'No open invoices on this date.' : 'No unpaid bills on this date.') + html;
    return { html, matrix: mtx };
  };
  RENDER.openinv = openDocs('customer');

  /* ---------- Invoice Payment Days (MIS) ---------- */
  RENDER.paydays = (b, p) => {
    const P = OB.payDays, view = P.FIELDS[p.view] ? p.view : 'drill', upto = U.isDate(p.upto || '') ? p.upto : U.today();
    const r = P.report(b, { from: p.range === 'all' ? '' : p.from, to: p.range === 'all' ? '' : p.to, by: p.by, asOf: upto, contactId: p.contact || '', status: p.status || '' });
    const ALL = P.allFields(view, r);
    // fields of another view are ignored; an income-account field this period does not use is simply left out
    const valid = (ks) => { if (!ks || !ks.length || !ks.every((k) => /^inc:/.test(k) || P.FIELDS[view].some((f) => f.key === k) || ALL.some((f) => f.key === k))) return null; const v = ks.filter((k) => ALL.some((f) => f.key === k)); return v.length ? v : null; };
    const keys = valid(p.f ? p.f.split(',') : null) || valid(OB.prefs.get('paydaysFields:' + view));
    const fs = P.fields(view, keys, r), list = P.items(r, view), tot = P.totals(r, view), T = r.total;
    const opt = (v, cur, l) => `<option value="${v}"${v === (cur || '') ? ' selected' : ''}>${esc(l)}</option>`;
    const custs = b.contacts.filter((c) => c.kind === 'customer').sort((x, y) => x.name.localeCompare(y.name));
    const toolbar = `<label>View <select data-rp="view" id="pd-view">${opt('drill', view, 'Drill-down (customer › invoices)')}${opt('summary', view, 'Summary by customer')}${opt('invoice', view, 'By invoice')}${opt('payment', view, 'By payment')}</select></label>
      <label>Period is <select data-rp="by" id="pd-by">${opt('', p.by, 'Invoice date')}${opt('payment', p.by, 'Date paid / received')}</select></label>
      <label>Status <select data-rp="status" id="pd-status">${opt('', p.status, 'All invoices')}${opt('paid', p.status, 'Paid')}${opt('part', p.status, 'Partly paid')}${opt('open', p.status, 'Not paid')}${opt('unpaid', p.status, 'Not fully paid')}</select></label>
      <label>Customer <select data-rp="contact" id="pd-cust"><option value="">All customers</option>${custs.map((c) => opt(c.id, p.contact, c.name)).join('')}</select></label>
      <label>Payments up to <input type="date" data-rp="upto" id="pd-upto" value="${esc(upto)}"></label>`;
    const fmt = (f, x) => {
      const v = x[f.key];
      if (v === null || v === undefined || v === '') return '';
      if (f.type === 'money') return UI.money(v);
      if (f.type === 'date') return UI.date(v);
      if (f.key === 'onTimePct' || f.key === 'onTime') return v + '%';
      if (f.key === 'incomeText' || f.key === 'payments') return String(v).split('; ').map((t) => `<span class="pd-li">${esc(t)}</span>`).join('');   // one per line
      if (view === 'invoice' && f.key === 'number' && x.t) return UI.txnLink(x.t, v);
      if (view === 'payment' && f.key === 'number' && x.t) return UI.txnLink(x.t, v);
      if (view === 'payment' && f.key === 'invoice' && x.invoiceId) return `<a href="#/txn/${esc(x.invoiceId)}">${esc(v)}</a>`;
      if (view === 'summary' && f.key === 'customer' && x.contactId) return `<a href="#/report/paydays?${UI.qs(Object.assign({}, p, { view: 'invoice', contact: x.contactId, f: '' }))}" title="This customer's invoices">${esc(v)}</a>`;
      if (f.key === 'status') return `<span class="pd-st pd-${esc(String(v).replace(/\s+/g, '-').toLowerCase())}">${esc(v)}</span>`;
      if (f.key === 'daysLate' && v > 0) return `<span class="pd-late">${v}</span>`;
      return esc(v);
    };
    const num = (f) => f.type === 'money' || f.type === 'num';
    const glance = [['Invoices', T.invoices], ['Invoiced', UI.money(T.invoiced)], ['Received', UI.money(T.received)], ['Open balance', UI.money(T.open)],
      ['Avg days to pay', T.avgDays === null ? '—' : T.avgDays], ['Weighted avg days', T.weightedDays === null ? '—' : T.weightedDays], ['Paid on time', T.onTimePct === null ? '—' : T.onTimePct + '%'], ['Oldest open', T.oldestOpen === null ? '—' : T.oldestOpen + ' days']];
    let html = `<dl class="rr-glance pd-glance" data-testid="pd-glance">${glance.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join('')}</dl>`;
    if (!list.length) html += UI.empty('No invoices match. Change the period, status or customer.');
    else if (view === 'drill') {
      const hasKids = {}; list.forEach((x) => { const i = x.path.lastIndexOf('/'); if (i > 0) hasKids[x.path.slice(0, i)] = 1; });
      html += `<div class="pd-levels no-print" role="group" aria-label="Drill down"><button type="button" class="btn small" data-lv="2" data-testid="pd-expand">Expand all customers</button><button type="button" class="btn small" data-lv="1" data-testid="pd-collapse">Collapse all</button></div>
        <div class="scroll-x"><table class="statement pd-table pd-tree" data-testid="pd-table"><thead><tr><th>${esc(P.DRILL_HEAD)}</th>${fs.map((f) => `<th${num(f) ? ' class="num"' : ''}>${esc(f.label)}</th>`).join('')}</tr></thead><tbody>
        ${list.map((x) => `<tr class="pd-l${x.level}${x.level ? ' pd-hide' : ''}" data-path="${esc(x.path)}" data-level="${x.level}"><td class="pd-name" style="--lv:${x.level}">${hasKids[x.path] ? `<button type="button" class="pd-tog" aria-expanded="false" aria-label="Show ${esc(x.label)} detail" data-tog="${esc(x.path)}"></button>` : '<span class="pd-tog-sp"></span>'}${x.level === 0 && x.contactId ? `<a href="#/contact/${esc(x.contactId)}">${esc(x.label)}</a>` : x.t ? UI.txnLink(x.t, x.label) : esc(x.label)}</td>
          ${fs.map((f) => `<td${num(f) ? ' class="num"' : f.key === 'memo' || f.key === 'payments' || f.key === 'incomeText' ? ' class="memo"' : ''}>${fmt(f, x)}</td>`).join('')}</tr>`).join('')}
        <tr class="grand"><td>Total</td>${fs.map((f) => `<td${num(f) ? ' class="num"' : ''}>${fmt(f, tot)}</td>`).join('')}</tr></tbody></table></div>`;
    }
    else html += `<div class="scroll-x"><table class="statement pd-table" data-testid="pd-table"><thead><tr>${fs.map((f) => `<th${num(f) ? ' class="num"' : ''}>${esc(f.label)}</th>`).join('')}</tr></thead><tbody>
      ${list.map((x) => `<tr>${fs.map((f) => `<td${num(f) ? ' class="num"' : f.key === 'payments' || f.key === 'memo' || f.key === 'incomeText' ? ' class="memo"' : ''}>${fmt(f, x)}</td>`).join('')}</tr>`).join('')}
      <tr class="grand">${fs.map((f, i) => `<td${num(f) ? ' class="num"' : ''}>${i === 0 ? 'Total' : f.key === 'customer' ? '' : fmt(f, tot)}</td>`).join('')}</tr></tbody></table></div>`;
    html += `<p class="muted small">Days to pay: invoice date to the day it was paid in full. Days late: after the due date (0 when paid on time). Weighted: each payment's days weighted by its amount. Credits applied settle an invoice but do not count as payments. Payments after ${esc(U.fmtDate(upto))} are not counted.${view === 'summary' ? ' Click a customer for its invoices.' : view === 'drill' ? ' Click ▸ on a customer for its invoices, or Expand all customers. Customer rows show totals and averages; each invoice row shows its payments. In Excel the invoices are grouped under their customer: use the 1 2 buttons or +/− at the left.' : ''}</p>`;
    const mtx = P.matrix(r, view, fs.map((f) => f.key), r).map((row, i, a) => i === 0 || i === a.length - 1 ? row.map((c) => (c && typeof c === 'object' ? Object.assign({}, c, { bold: true }) : { v: c, bold: true })) : row);
    const bind = (el) => {
      const tree = el.querySelector('.pd-tree');
      if (tree) {   // drill-down: a row shows when every row above it in the tree is open
        const open = new Set(), rows = [...tree.querySelectorAll('tr[data-path]')];
        const paint = () => rows.forEach((tr) => {
          const parts = tr.dataset.path.split('/'); let vis = true;
          for (let i = 1; i < parts.length; i++) if (!open.has(parts.slice(0, i).join('/'))) { vis = false; break; }
          tr.classList.toggle('pd-hide', !vis);   // visibility: collapse keeps the column widths of hidden rows
          const tg = tr.querySelector('[data-tog]'); if (tg) tg.setAttribute('aria-expanded', String(open.has(tr.dataset.path)));
        });
        tree.addEventListener('click', (e) => { const tg = e.target.closest('[data-tog]'); if (!tg) return; const k = tg.dataset.tog; if (open.has(k)) open.delete(k); else open.add(k); paint(); });
        el.querySelectorAll('[data-lv]').forEach((bt) => bt.addEventListener('click', () => { const lv = +bt.dataset.lv; open.clear(); rows.forEach((tr) => { if (+tr.dataset.level < lv - 1) open.add(tr.dataset.path); }); paint(); }));
      }
      const btn = el.querySelector('#rp-fields'); if (!btn) return;
      btn.addEventListener('click', () => {
        let order = fs.map((f) => f.key).concat(ALL.map((f) => f.key).filter((k) => !fs.some((f) => f.key === k)));
        const on = {}; fs.forEach((f) => { on[f.key] = true; });
        const label = (k) => ALL.find((f) => f.key === k).label;
        const paint = (m) => {
          m.querySelector('.pd-flist').innerHTML = order.map((k, i) => `<li><label class="check"><input type="checkbox" data-k="${k}"${on[k] ? ' checked' : ''}> ${esc(label(k))}</label>
            <span class="pd-move"><button type="button" class="btn ghost small" data-up="${i}" aria-label="Move ${esc(label(k))} up"${i ? '' : ' disabled'}>▲</button><button type="button" class="btn ghost small" data-down="${i}" aria-label="Move ${esc(label(k))} down"${i < order.length - 1 ? '' : ' disabled'}>▼</button></span></li>`).join('');
        };
        UI.modal({ title: 'Fields — ' + { drill: 'Drill-down', summary: 'Summary by customer', invoice: 'By invoice', payment: 'By payment' }[view],
          html: (view === 'payment' ? '' : '<p class="muted small">Income accounts: the list of accounts on each invoice, how many, and one column per income account used in this report (amounts add up by customer).</p>') + '<ul class="pd-flist" data-testid="pd-flist"></ul><p><button type="button" class="btn ghost small" id="pd-freset">Standard fields</button></p>',
          onMount: (m) => {
            paint(m);
            m.addEventListener('change', (e) => { if (e.target.dataset.k) on[e.target.dataset.k] = e.target.checked; });
            m.addEventListener('click', (e) => {
              const u = e.target.closest('[data-up],[data-down]');
              if (u) { const i = +(u.dataset.up !== undefined ? u.dataset.up : u.dataset.down), j = u.dataset.up !== undefined ? i - 1 : i + 1; [order[i], order[j]] = [order[j], order[i]]; paint(m); return; }
              if (e.target.id === 'pd-freset') { order = P.DEFAULTS[view].concat(ALL.map((f) => f.key).filter((k) => P.DEFAULTS[view].indexOf(k) < 0)); Object.keys(on).forEach((k) => delete on[k]); P.DEFAULTS[view].forEach((k) => { on[k] = true; }); paint(m); }
            });
          },
          actions: [{ label: 'Cancel', value: null }, { label: 'Apply', primary: true, collect: () => { const ks = order.filter((k) => on[k]); if (!ks.length) { UI.toast('Choose at least one field.', 'error'); return false; } return ks; } }]
        }).then((ks) => {
          if (!ks) return;
          OB.prefs.set('paydaysFields:' + view, ks);
          UI.go('#/report/paydays?' + UI.qs(Object.assign({}, p, { f: ks.join(',') })));
        });
      });
    };
    return { html, matrix: mtx, toolbar, bind, title: 'Invoice Payment Days — ' + { drill: 'Drill-down', summary: 'Summary by customer', invoice: 'By invoice', payment: 'By payment' }[view] };
  };
  RENDER.unpaidbills = openDocs('vendor');

  const contactDetail = (kind) => (b, p) => {
    const rep = R.contactDetail(b, { kind, asOf: p.asOf });
    const heads = ['Type', 'Date', 'No.', 'Memo', 'Amount', 'Balance'];
    const mtx = [heads.map((h) => ({ v: h, bold: true }))];
    let html = `<div class="scroll-x"><table class="statement gl"><thead><tr>${heads.map((h, i) => `<th class="${i >= 4 ? 'num' : ''}">${esc(h)}</th>`).join('')}</tr></thead><tbody>`;
    let n = 0;
    rep.groups.forEach((g) => {
      html += `<tr class="section"><td colspan="6">${g.contactId ? `<a href="#/contact/${esc(g.contactId)}">${esc(g.name)}</a>` : esc(g.name)}</td></tr>`;
      mtx.push([{ v: g.name, bold: true }]);
      g.rows.forEach((x) => {
        if (n++ < 6000) html += `<tr><td class="ind1">${UI.txnLink(x.t, UI.typeLabel(x.t.type))}</td><td>${UI.date(x.t.date)}</td><td>${esc(x.t.number)}</td><td class="memo">${esc(x.memo)}</td>${cell(x.amount)}${cell(x.balance)}</tr>`;
        mtx.push(['  ' + UI.typeLabel(x.t.type), U.fmtDate(x.t.date), x.t.number, x.memo, m(x.amount), m(x.balance)]);
      });
      html += `<tr class="subtotal"><td colspan="5">Total ${esc(g.name)}</td>${cell(g.total)}</tr>`;
      mtx.push([{ v: 'Total ' + g.name, bold: true }, '', '', '', '', m(g.total, true)]);
    });
    html += `<tr class="grand"><td colspan="5">Total</td>${cell(rep.total)}</tr></tbody></table></div>`;
    mtx.push([{ v: 'Total', bold: true }, '', '', '', '', m(rep.total, true)]);
    if (n > 6000) html = `<div class="banner info">Showing the first 6,000 of ${n.toLocaleString()} lines; exports include all lines.</div>` + html;
    const accName = kind === 'customer' ? 'Accounts Receivable' : 'Accounts Payable';
    html += `<p class="check-line ${rep.total === rep.accountBalance ? 'ok' : 'bad'}">${rep.total === rep.accountBalance ? '✓' : '✗'} Ties to ${accName} balance of ${U.fmt(rep.accountBalance, { symbol: true })}.</p>`;
    if (!rep.groups.length) html = UI.empty('No open balances on this date.') + html;
    return { html, matrix: mtx };
  };
  RENDER.custdetail = contactDetail('customer');
  RENDER.venddetail = contactDetail('vendor');

  /* ---------- Sales ---------- */
  RENDER.salescust = (b, p) => {
    const rep = R.salesByCustomer(b, { from: p.from, to: p.to, basis: p.basis });
    const mtx = [[{ v: 'Customer', bold: true }, { v: 'Total', bold: true }]];
    let html = `<table class="statement narrow"><thead><tr><th>Customer</th><th class="num">Total</th></tr></thead><tbody>`;
    rep.rows.forEach((r) => { html += `<tr><td>${r.contactId ? `<a href="#/contact/${esc(r.contactId)}">${esc(r.name)}</a>` : esc(r.name)}</td>${cell(r.amount)}</tr>`; mtx.push([r.name, m(r.amount)]); });
    html += `<tr class="grand"><td>Total</td>${cell(rep.total)}</tr></tbody></table>`;
    mtx.push([{ v: 'Total', bold: true }, m(rep.total, true)]);
    if (!rep.rows.length) html = UI.empty('No income in this period.');
    else html += '<p class="muted small">Counts every posting to income accounts, so it agrees with Total Income on the Profit and Loss for the same period and basis.</p>';
    return { html, matrix: mtx };
  };
  RENDER.salesitem = (b, p) => {
    const rep = R.salesByItem(b, { from: p.from, to: p.to });
    const mtx = [['Product/service', 'Qty', 'Amount', 'Avg. price'].map((h) => ({ v: h, bold: true }))];
    let html = `<table class="statement narrow"><thead><tr><th>Product/service</th><th class="num">Qty</th><th class="num">Amount</th><th class="num">Avg. price</th></tr></thead><tbody>`;
    rep.rows.forEach((r) => {
      html += `<tr><td>${esc(r.name)}</td><td class="num">${r.qty ? esc(String(Math.round(r.qty * 100) / 100)) : ''}</td>${cell(r.amount)}<td class="num">${r.avg === null ? '' : UI.money(r.avg)}</td></tr>`;
      mtx.push([r.name, r.qty || '', m(r.amount), r.avg === null ? '' : m(r.avg)]);
    });
    html += `<tr class="grand"><td>Total</td><td></td>${cell(rep.total)}<td></td></tr></tbody></table>
      <p class="muted small">From invoice, sales receipt and credit memo lines (accrual), whatever account each line posts to — so items posted to a liability such as a retainer are included, as in QuickBooks. Lines without a product/service are grouped together. For income only, see Sales by Customer Summary.</p>`;
    mtx.push([{ v: 'Total', bold: true }, '', m(rep.total, true), '']);
    if (!rep.rows.length) html = UI.empty('No sales lines in this period.');
    return { html, matrix: mtx };
  };

  /* ---------- 1.18 reports ---------- */
  RENDER.taxagency = (b, p) => {
    const rep = R.salesTaxByAgency(b, { from: p.from, to: p.to, basis: p.basis });
    const heads = ['Agency', 'Owed at start', 'Taxable sales', 'Tax collected', 'Paid', 'Due'];
    const mtx = [heads.map((h) => ({ v: h, bold: true }))];
    let html = `<div class="scroll-x"><table class="statement gl" data-testid="taxagency"><thead><tr>${heads.map((h, i) => `<th class="${i ? 'num' : ''}">${esc(h)}</th>`).join('')}</tr></thead><tbody>`;
    rep.rows.forEach((r) => { html += `<tr><td>${esc(r.agency)}</td>${cell(r.opening)}${cell(r.taxable)}${cell(r.collected)}${cell(-r.paid)}${cell(r.due)}</tr>`; mtx.push([r.agency, m(r.opening), m(r.taxable), m(r.collected), m(-r.paid), m(r.due)]); });
    html += `<tr class="grand"><td>Total</td><td></td><td></td>${cell(rep.totals.collected)}${cell(-rep.totals.paid)}${cell(rep.totals.due)}</tr></tbody></table></div>
      <p class="muted small">Exempt sales (to tax-exempt customers) in the period: ${UI.money(rep.exemptSales, { symbol: true })}. Combined rates are split by agency on each document. <a href="#/paysalestax">Pay sales tax</a></p>`;
    mtx.push([{ v: 'Total', bold: true }, '', '', m(rep.totals.collected, true), m(-rep.totals.paid, true), m(rep.totals.due, true)]);
    if (!rep.rows.length) html = UI.empty('No sales tax rates yet. Add them in Settings → Sales tax.');
    return { html, matrix: mtx };
  };
  RENDER.collections = (b, p) => {
    const rep = R.collections(b, { asOf: p.asOf });
    const mtx = [['Customer', 'Phone', 'Email', 'Invoice', 'Due', 'Days overdue', 'Open'].map((h) => ({ v: h, bold: true }))];
    let html = `<div class="scroll-x"><table class="statement gl" data-testid="collections"><thead><tr><th>Invoice</th><th>Due date</th><th class="num">Days overdue</th><th class="num">Open balance</th></tr></thead><tbody>`;
    rep.groups.forEach((g) => {
      html += `<tr class="section"><td colspan="3"><a href="#/contact/${esc(g.customerId || g.contactId)}">${esc(g.name)}</a> <span class="muted small">${esc([g.contactName, g.phone, g.email].filter(Boolean).join(' · '))}</span></td>${cell(g.total)}</tr>`;
      g.rows.forEach((x) => { html += `<tr><td>${UI.txnLink(x.t)}</td><td>${UI.date(x.t.dueDate)}</td><td class="num">${x.days}</td>${cell(x.open)}</tr>`; mtx.push([g.name, g.phone, g.email, x.t.number || '', x.t.dueDate, x.days, m(x.open)]); });
    });
    html += `<tr class="grand"><td colspan="3">Total overdue</td>${cell(rep.total)}</tr></tbody></table></div>`;
    if (!rep.groups.length) html = UI.empty('Nothing is overdue on this date.');
    return { html, matrix: mtx };
  };
  RENDER.missingchecks = (b, p) => {
    const bank = p.account && b.accById[p.account] && b.accById[p.account].type === 'bank' ? p.account : (b.sortedAccounts((a) => a.type === 'bank')[0] || {}).id;
    if (!bank) return { html: UI.empty('No bank account.'), matrix: [] };
    const rep = R.missingChecks(b, { accountId: bank });
    const mtx = [['No.', 'Date', 'Type', 'Pay to', 'Amount', 'Note'].map((h) => ({ v: h, bold: true }))];
    let html = `<p class="muted">${esc(b.accountLabel(bank))} — ${rep.count} numbered checks, ${rep.gaps} gap(s), ${rep.duplicates} duplicate number(s). Choose another bank account above.</p><div class="scroll-x"><table class="statement gl" data-testid="missingchecks"><thead><tr><th>No.</th><th>Date</th><th>Type</th><th>Pay to</th><th class="num">Amount</th><th>Note</th></tr></thead><tbody>`;
    rep.rows.forEach((r) => {
      if (r.gap) { const txt = r.from === r.to ? 'Missing ' + r.from : 'Missing ' + r.from + '–' + r.to; html += `<tr class="warn-row"><td colspan="6"><strong class="warn-text">${esc(txt)}</strong></td></tr>`; mtx.push(['', '', '', '', '', txt]); return; }
      const note = (r.duplicate ? 'Duplicate number' : '') + (r.void ? (r.duplicate ? ' · ' : '') + 'Void' : '');
      html += `<tr><td>${esc(r.n)}</td><td>${UI.date(r.t.date)}</td><td>${UI.txnLink(r.t, UI.typeLabel(r.t.type))}</td><td>${esc(UI.contactName(r.t.contactId))}</td>${cell(r.t.status === 'void' ? 0 : r.t.total)}<td class="${r.duplicate ? 'warn-text' : ''}">${esc(note)}</td></tr>`;
      mtx.push([r.n, r.t.date, UI.typeLabel(r.t.type), UI.contactName(r.t.contactId), m(r.t.status === 'void' ? 0 : r.t.total), note]);
    });
    html += '</tbody></table></div>';
    if (!rep.count) html = UI.empty('No numbered checks from this account.');
    return { html, matrix: mtx };
  };
  RENDER.changed = (b, p) => {
    const rep = R.changedTransactions(b, { from: p.from, to: p.to });
    const heads = ['Changed', 'Action', 'Transaction', 'Date', 'Before', 'After', 'What changed'];
    const mtx = [heads.map((h) => ({ v: h, bold: true }))];
    let html = `<div class="scroll-x"><table class="statement gl" data-testid="changed"><thead><tr>${heads.map((h, i) => `<th class="${i === 4 || i === 5 ? 'num' : ''}">${esc(h)}</th>`).join('')}</tr></thead><tbody>`;
    rep.rows.forEach((r) => {
      const label = (r.type ? UI.typeLabel(r.type) : '') + (r.number ? ' ' + r.number : '');
      html += `<tr><td>${esc(new Date(r.ts).toLocaleString())}</td><td>${esc(r.action)}</td><td>${r.t ? UI.txnLink(r.t, label) : esc(label)}</td><td>${UI.date(r.date)}</td><td class="num">${r.before === undefined ? '' : UI.money(r.before)}</td><td class="num">${r.after === null || r.after === undefined ? '' : UI.money(r.after)}</td><td class="memo">${esc(r.changes.join('; ') || (r.action === 'Voided' ? r.summary : ''))}</td></tr>`;
      mtx.push([r.ts, r.action, label, r.date, r.before === undefined ? '' : m(r.before), r.after === null || r.after === undefined ? '' : m(r.after), r.changes.join('; ')]);
    });
    html += '</tbody></table></div><p class="muted small">From the hash-chained audit trail; the period is the date of the change. Open a transaction and choose More → Audit history for every version.</p>';
    if (!rep.rows.length) html = UI.empty('No transactions were voided or changed in this period.');
    return { html, matrix: mtx };
  };
  RENDER.forecast = (b, p) => {
    const rep = R.cashForecast(b, { asOf: p.asOf, weeks: 12 });
    const heads = ['Week', 'Starting balance', 'Expected in (invoices)', 'Expected out (bills)', 'Recurring', 'Ending balance'];
    const mtx = [heads.map((h) => ({ v: h, bold: true }))];
    let html = `<div class="scroll-x"><table class="statement gl" data-testid="forecast"><thead><tr>${heads.map((h, i) => `<th class="${i ? 'num' : ''}">${esc(h)}</th>`).join('')}</tr></thead><tbody>`;
    rep.weeks.forEach((w, i) => { const lab = U.fmtDate(w.from) + ' – ' + U.fmtDate(w.to) + (i === 0 && (rep.overdueIn || rep.overdueOut) ? ' (incl. overdue)' : '');
      html += `<tr><td>${esc(lab)}</td>${cell(w.start)}${cell(w.receipts)}${cell(-w.payments)}${cell(w.recurring)}<td class="num${w.end < 0 ? ' warn-text' : ''}">${UI.money(w.end)}</td></tr>`;
      mtx.push([lab, m(w.start), m(w.receipts), m(-w.payments), m(w.recurring), m(w.end)]); });
    html += `</tbody></table></div><p class="muted small">Starts from the balance of all bank accounts on ${UI.date(rep.asOf)}. Open invoices and bills are expected on their due dates (overdue ones in the first week); recurring checks, expenses, deposits and sales receipts on their schedule. A forecast, not a promise.</p>`;
    return { html, matrix: mtx };
  };

  /* ---------- Tax lines and unbilled costs (1.16) ---------- */
  RENDER.taxsum = (b, p) => {
    const rep = R.taxSummary(b, { from: p.from, to: p.to, basis: p.basis });
    if (!rep.form) return { html: UI.empty('Choose your income tax return and map accounts in <a href="#/taxlines">Lists → Tax lines</a>.'), matrix: [] };
    const mtx = [[{ v: 'Tax line', bold: true }, { v: 'Account', bold: true }, { v: 'Amount', bold: true }]];
    let html = `<p class="muted">${esc(rep.formLabel)}</p><div class="scroll-x"><table class="statement" data-testid="taxsum"><thead><tr><th>Tax line</th><th class="num">Amount</th></tr></thead><tbody>`;
    rep.rows.forEach((r) => {
      html += `<tr class="subtotal"><td>${esc(r.label)}</td>${cell(r.amount)}</tr>` + r.accounts.map((a) => `<tr class="detail"><td class="ind1"><a href="#/register/${esc(a.accountId)}">${esc(a.label)}</a></td>${cell(a.amount)}</tr>`).join('');
      r.accounts.forEach((a) => mtx.push([r.label, a.label, m(a.amount)])); mtx.push([{ v: r.label, bold: true }, 'Total', m(r.amount, true)]);
    });
    html += '</tbody></table></div>';
    if (rep.unmapped.length) { html += `<div class="banner warn"><strong>Not mapped to a tax line:</strong> ${rep.unmapped.map((a) => esc(a.label) + ' (' + UI.money(a.amount) + ')').join(', ')}. <a href="#/taxlines">Map them</a>.</div>`; rep.unmapped.forEach((a) => mtx.push(['NOT MAPPED', a.label, m(a.amount)])); }
    html += '<p class="muted small">Book amounts from the ledger. Income and expenses are shown as positive numbers. Tax adjustments (M-1, depreciation differences, the 50% meals limit) are for your tax preparer.</p>';
    return { html, matrix: mtx };
  };
  RENDER.unbilled = (b, p) => {
    const rep = R.unbilledCosts(b, { asOf: p.asOf });
    const heads = ['Date', 'Type', 'No.', 'Vendor', 'Account', 'Description', 'Amount'];
    const mtx = [[{ v: 'Customer:Job', bold: true }].concat(heads.map((h) => ({ v: h, bold: true })))];
    let html = `<div class="scroll-x"><table class="statement gl" data-testid="unbilled"><thead><tr>${heads.map((h, i) => `<th class="${i === 6 ? 'num' : ''}">${esc(h)}</th>`).join('')}</tr></thead><tbody>`;
    rep.groups.forEach((g) => {
      html += `<tr class="section"><td colspan="6"><a href="#/contact/${esc(g.customerId)}">${esc(g.name)}</a> <a class="btn ghost small" href="#/txn/new?type=invoice&contact=${esc(g.customerId)}">Invoice</a></td>${cell(g.total)}</tr>`;
      g.rows.forEach((x) => { html += `<tr><td>${UI.date(x.t.date)}</td><td>${UI.txnLink(x.t, UI.typeLabel(x.t.type))}</td><td>${esc(x.t.number || '')}</td><td>${esc(UI.contactName(x.t.contactId))}</td><td>${esc(b.accountLabel(x.line.accountId))}</td><td class="memo">${esc(x.line.description || '')}</td>${cell(x.amount)}</tr>`;
        mtx.push([g.name, x.t.date, UI.typeLabel(x.t.type), x.t.number || '', UI.contactName(x.t.contactId), b.accountLabel(x.line.accountId), x.line.description || '', m(x.amount)]); });
    });
    html += `<tr class="grand"><td colspan="6">Total</td>${cell(rep.total)}</tr></tbody></table></div>`;
    if (!rep.groups.length) html = UI.empty('No unbilled costs. Tick Billable and choose a Customer:Job on bill, check or expense lines to re-bill costs.');
    return { html, matrix: mtx };
  };

  /* ---------- Inventory and fixed assets (1.15) ---------- */
  const qtyTxt = (q) => esc(String(Math.round(q * 10000) / 10000));
  RENDER.invval = (b, p) => {
    const rep = R.inventoryValuation(b, { asOf: p.asOf });
    const heads = ['Item', 'On hand', 'Avg. cost', 'Asset value', '% of total', 'Sales price', 'Retail value'];
    const mtx = [heads.map((h) => ({ v: h, bold: true }))];
    let html = `<div class="scroll-x"><table class="statement gl" data-testid="invval"><thead><tr>${heads.map((h, i) => `<th class="${i ? 'num' : ''}">${esc(h)}</th>`).join('')}</tr></thead><tbody>`;
    rep.rows.forEach((r) => { html += `<tr><td>${esc(r.name)}</td><td class="num${r.qty < 0 ? ' warn-text' : ''}">${qtyTxt(r.qty)}</td>${cell(r.avg)}${cell(r.value)}<td class="num">${(r.pct * 100).toFixed(1)}%</td><td class="num">${r.price === null || r.price === undefined ? '' : UI.money(r.price)}</td><td class="num">${r.retail === null ? '' : UI.money(r.retail)}</td></tr>`;
      mtx.push([r.name, r.qty, m(r.avg), m(r.value), r.pct, r.price === null || r.price === undefined ? '' : m(r.price), r.retail === null ? '' : m(r.retail)]); });
    html += `<tr class="grand"><td>Total</td><td></td><td></td>${cell(rep.total)}<td></td><td></td>${cell(rep.retail)}</tr></tbody></table></div>`;
    mtx.push([{ v: 'Total', bold: true }, '', '', m(rep.total, true), '', '', m(rep.retail, true)]);
    html += `<p class="${rep.total === rep.ledger ? 'muted' : 'warn-text'} small">Inventory asset account balance: ${UI.money(rep.ledger, { symbol: true })}${rep.total === rep.ledger ? ' — agrees with the valuation.' : ' — differs from the valuation by ' + UI.money(rep.ledger - rep.total, { symbol: true }) + ' (postings to the account that are not item purchases, sales or adjustments).'}</p>`;
    if (!rep.rows.length) html = UI.empty('No items track quantity on hand. Edit an inventory part and tick “Track quantity on hand”.');
    return { html, matrix: mtx };
  };
  RENDER.stock = (b, p) => {
    const rep = R.stockStatus(b, { asOf: p.asOf });
    const heads = ['Item', 'On hand', 'On purchase orders', 'Reorder point', 'Order'];
    const mtx = [heads.map((h) => ({ v: h, bold: true }))];
    let html = `<div class="scroll-x"><table class="statement gl" data-testid="stock"><thead><tr>${heads.map((h, i) => `<th class="${i ? 'num' : ''}">${esc(h)}</th>`).join('')}</tr></thead><tbody>`;
    rep.rows.forEach((r) => { html += `<tr><td>${esc(r.name)}</td><td class="num${r.negative ? ' warn-text' : ''}">${qtyTxt(r.qty)}</td><td class="num">${r.onPO ? qtyTxt(r.onPO) : ''}</td><td class="num">${r.reorderPoint === null ? '' : qtyTxt(r.reorderPoint)}</td><td class="num">${r.order ? '<span class="badge warn">Reorder</span>' : ''}</td></tr>`;
      mtx.push([r.name, r.qty, r.onPO, r.reorderPoint === null ? '' : r.reorderPoint, r.order ? 'Reorder' : '']); });
    html += '</tbody></table></div><p class="muted small">Reorder when on hand plus on open purchase orders is at or below the reorder point. <a href="#/txn/new?type=purchaseOrder">New purchase order</a> · <a href="#/txn/new?type=invAdjust">Adjust inventory</a></p>';
    if (!rep.rows.length) html = UI.empty('No items track quantity on hand.');
    return { html, matrix: mtx };
  };
  RENDER.fixedassets = (b, p) => {
    const rep = R.fixedAssets(b, { asOf: p.asOf });
    const heads = ['Asset', 'In service', 'Method', 'Cost', 'Accum. depreciation', 'Book value', 'This fiscal year', 'Not yet posted', 'Tax (MACRS) this year'];
    const mtx = [heads.map((h) => ({ v: h, bold: true }))];
    let html = `<div class="scroll-x"><table class="statement gl" data-testid="fa-register"><thead><tr>${heads.map((h, i) => `<th class="${i > 2 ? 'num' : ''}">${esc(h)}</th>`).join('')}</tr></thead><tbody>`;
    rep.rows.forEach((r) => { html += `<tr><td>${esc(r.name)}</td><td>${UI.date(r.inService)}</td><td>${esc(r.method)}</td>${cell(r.cost)}${cell(r.recorded)}${cell(r.bookValue)}${cell(r.thisYear)}${cell(r.unrecorded)}${r.taxThisYear === null ? '<td></td>' : cell(r.taxThisYear)}</tr>`;
      mtx.push([r.name + (r.disposed ? ' (disposed ' + r.disposed + ')' : ''), r.inService, r.method, m(r.cost), m(r.recorded), m(r.bookValue), m(r.thisYear), m(r.unrecorded), r.taxThisYear === null ? '' : m(r.taxThisYear)]); });
    html += `<tr class="grand"><td>Total</td><td></td><td></td>${cell(rep.cost)}${cell(rep.recorded)}${cell(rep.bookValue)}<td></td>${cell(rep.unrecorded)}<td></td></tr></tbody></table></div>
      <p class="small${rep.reconcile.difference || rep.reconcile.accumDifference ? ' warn-text' : ' muted'}" data-testid="fa-reconcile">Register vs general ledger — cost ${UI.money(rep.reconcile.register)} vs ${UI.money(rep.reconcile.ledger)} (difference ${UI.money(rep.reconcile.difference)}); accumulated depreciation ${UI.money(rep.reconcile.accumRegister)} vs ${UI.money(rep.reconcile.accumLedger)} (difference ${UI.money(rep.reconcile.accumDifference)}).</p>
      <p class="muted small">Accumulated depreciation is read from the posted depreciation entries. <a href="#/fixedassets">Fixed assets</a> to add assets or post depreciation.</p>`;
    mtx.push([{ v: 'Total', bold: true }, '', '', m(rep.cost, true), m(rep.recorded, true), m(rep.bookValue, true), '', m(rep.unrecorded, true), '']);
    if (!rep.rows.length) html = UI.empty('No fixed assets yet. Add them in Lists → Fixed assets.');
    return { html, matrix: mtx };
  };

  /* ---------- Sales tax (1.13) ---------- */
  RENDER.salestax = (b, p) => {
    const rep = R.salesTaxLiability(b, { from: p.from, to: p.to });
    const heads = ['Sales tax', 'Agency', 'Rate', 'Taxable sales', 'Non-taxable sales', 'Tax charged'];
    const mtx = [heads.map((h) => ({ v: h, bold: true }))];
    let html = `<div class="scroll-x"><table class="statement gl" data-testid="salestax-rates"><thead><tr>${heads.map((h, i) => `<th class="${i > 1 ? 'num' : ''}">${esc(h)}</th>`).join('')}</tr></thead><tbody>`;
    rep.rows.forEach((r) => {
      html += `<tr><td>${esc(r.name)}</td><td>${esc(r.agency)}</td><td class="num">${r.taxId ? esc(OB.Book.fmtRate(r.rate)) : ''}</td>${cell(r.taxable)}${cell(r.nontaxable)}${cell(r.tax)}</tr>`;
      mtx.push([r.name, r.agency, r.taxId ? OB.Book.fmtRate(r.rate) : '', m(r.taxable), m(r.nontaxable), m(r.tax)]);
    });
    html += `<tr class="grand"><td>Total</td><td></td><td></td>${cell(rep.totals.taxable)}${cell(rep.totals.nontaxable)}${cell(rep.totals.tax)}</tr></tbody></table></div>`;
    mtx.push([{ v: 'Total', bold: true }, '', '', m(rep.totals.taxable, true), m(rep.totals.nontaxable, true), m(rep.totals.tax, true)]);
    if (rep.accounts.length) {
      const h2 = ['Liability account', 'Balance at start', 'Tax collected', 'Paid', 'Other changes', 'Balance owed'];
      html += `<h3>What you owe</h3><div class="scroll-x"><table class="statement gl" data-testid="salestax-owed" data-tsub="owed"><thead><tr>${h2.map((h, i) => `<th class="${i ? 'num' : ''}">${esc(h)}</th>`).join('')}</tr></thead><tbody>`;
      mtx.push([]); mtx.push(h2.map((h) => ({ v: h, bold: true })));
      rep.accounts.forEach((a) => {
        html += `<tr><td><a href="#/register/${esc(a.accountId)}">${esc(a.label)}</a></td>${cell(a.opening)}${cell(a.collected)}${cell(-a.paid)}${cell(a.adjustments)}${cell(a.balance)}</tr>`;
        mtx.push([a.label, m(a.opening), m(a.collected), m(-a.paid), m(a.adjustments), m(a.balance)]);
      });
      html += '</tbody></table></div>';
    }
    html += `<p class="muted small">Accrual basis, by document date: invoices, sales receipts and credit memos (credit memos subtract). To pay the tax, write a check or record an expense to the liability account — it then shows under Paid.${(b.company.salesTaxes || []).length ? '' : ' Set up rates in <a href="#/settings?tab=salestax">Settings → Sales tax</a>.'}</p>`;
    if (!rep.rows.length && !rep.accounts.length) html = UI.empty('No sales tax rates yet. Add them in Settings → Sales tax.');
    return { html, matrix: mtx };
  };

  /* ---------- Banking detail ---------- */
  const bankDetail = (mode) => (b, p) => {
    const rep = R.bankDetail(b, { mode, from: p.from, to: p.to });
    const heads = ['Type', 'Date', 'No.', 'Name', 'Account', 'Memo', 'Amount'];
    const mtx = [heads.map((h) => ({ v: h, bold: true }))];
    let html = `<div class="scroll-x"><table class="statement gl"><thead><tr>${heads.map((h, i) => `<th class="${i === 6 ? 'num' : ''}">${esc(h)}</th>`).join('')}</tr></thead><tbody>`;
    let n = 0;
    rep.rows.forEach((r) => {
      if (n < 4000) {
        html += `<tr class="first"><td>${UI.txnLink(r.t, UI.typeLabel(r.t.type))}</td><td>${UI.date(r.t.date)}</td><td>${esc(r.t.number)}</td><td>${esc(UI.contactName(r.t.contactId))}</td><td>${esc(b.accountLabel(r.accountId))}</td><td class="memo">${esc(r.t.memo)}</td>${cell(r.amount)}</tr>`;
        r.lines.forEach((l) => { html += `<tr class="detail"><td></td><td></td><td></td><td class="ind1">${esc(UI.contactName(l.contactId))}</td><td>${esc(b.accountLabel(l.accountId))}</td><td class="memo">${esc(l.memo)}</td>${cell(l.amount)}</tr>`; });
      }
      n++;
      mtx.push([UI.typeLabel(r.t.type), U.fmtDate(r.t.date), r.t.number, UI.contactName(r.t.contactId), b.accountLabel(r.accountId), r.t.memo, m(r.amount)]);
      r.lines.forEach((l) => mtx.push(['', '', '', '  ' + UI.contactName(l.contactId), b.accountLabel(l.accountId), l.memo, m(l.amount)]));
    });
    html += `<tr class="grand"><td colspan="6">Total</td>${cell(rep.total)}</tr></tbody></table></div>`;
    mtx.push([{ v: 'Total', bold: true }, '', '', '', '', '', m(rep.total, true)]);
    if (n > 4000) html = `<div class="banner info">Showing the first 4,000 of ${n.toLocaleString()} transactions; exports include all.</div>` + html;
    if (!rep.rows.length) html = UI.empty(mode === 'check' ? 'No checks in this period.' : 'No deposits in this period.');
    return { html, matrix: mtx };
  };
  RENDER.depdetail = bankDetail('deposit');
  RENDER.checkdetail = bankDetail('check');

  /* ---------- Lists ---------- */
  RENDER.acctlist = (b, p) => {
    const heads = ['No.', 'Account', 'Type', 'Description', 'Status', 'Balance'];
    const mtx = [heads.map((h) => ({ v: h, bold: true }))];
    let html = `<div class="scroll-x"><table class="statement gl"><thead><tr>${heads.map((h, i) => `<th class="${i === 5 ? 'num' : ''}">${esc(h)}</th>`).join('')}</tr></thead><tbody>`;
    b.sortedAccounts().forEach((a) => {
      const bal = S.isPL(a.type) ? '' : b.accountBalance(a.id, p.asOf);
      const tl = (S.TYPE[a.type] || { label: a.type }).label;
      html += `<tr><td>${esc(a.number || '')}</td><td><a href="#/register/${esc(a.id)}">${esc(b.accountFullName(a))}</a></td><td>${esc(tl)}</td><td class="memo">${esc(a.description || '')}</td><td>${a.active === false ? 'Inactive' : ''}</td><td class="num">${bal === '' ? '' : UI.money(bal)}</td></tr>`;
      mtx.push([a.number || '', b.accountFullName(a), tl, a.description || '', a.active === false ? 'Inactive' : '', bal === '' ? '' : m(bal)]);
    });
    html += `</tbody></table></div><p class="muted small">Balance sheet accounts show balances as of ${U.fmtDate(p.asOf)}; income and expense accounts are shown without a balance, as in QuickBooks.</p>`;
    return { html, matrix: mtx };
  };
  const contactList = (kind) => (b, p) => {
    const heads = ['Name', 'Company', 'Contact', 'Phone', 'Email', 'Billing address', 'Terms'].concat(kind === 'vendor' ? ['1099', 'Tax ID'] : []).concat(['Status', 'Balance']);
    const mtx = [heads.map((h) => ({ v: h, bold: true }))];
    let html = `<div class="scroll-x"><table class="statement gl"><thead><tr>${heads.map((h, i) => `<th class="${i === heads.length - 1 ? 'num' : ''}">${esc(h)}</th>`).join('')}</tr></thead><tbody>`;
    b.contacts.filter((c) => c.kind === kind).sort((x, y) => x.name.localeCompare(y.name)).forEach((c) => {
      const bal = b.contactBalance(c.id, p.asOf);
      const terms = c.paymentTerms || (c.terms === 0 ? 'Due on receipt' : c.terms ? 'Net ' + c.terms : '');
      const cols = [c.company || '', c.contactName || '', [c.phone, c.altPhone].filter(Boolean).join(' / '), c.email || '', (c.address || '').replace(/\n/g, ', '), terms].concat(kind === 'vendor' ? [c.is1099 ? 'Yes' : '', c.taxId ? '•••' + String(c.taxId).slice(-4) : ''] : []).concat([c.active === false ? 'Inactive' : '']);
      html += `<tr><td><a href="#/contact/${esc(c.id)}">${esc(c.name)}</a></td>${cols.map((v) => `<td class="memo">${esc(v)}</td>`).join('')}${cell(bal)}</tr>`;
      mtx.push([c.name].concat(cols).concat([m(bal)]));
    });
    html += '</tbody></table></div>';
    return { html, matrix: mtx };
  };
  RENDER.custlist = contactList('customer');
  RENDER.vendlist = contactList('vendor');
})();
