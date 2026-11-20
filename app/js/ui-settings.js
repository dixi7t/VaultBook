/* OfflineBooks US — settings, backup, integrity, audit log. */
(function () {
  'use strict';
  const U = OB.util, S = OB.schema, UI = OB.ui, esc = U.esc;
  const routes = UI.routes;
  const TABS = [['company', 'Company'], ['features', 'Features'], ['salestax', 'Sales tax'], ['backup', 'Backup and restore'], ['security', 'Security'], ['data', 'Import and export'], ['integrity', 'Data integrity'], ['audit', 'Audit log'], ['storage', 'App and storage']];

  UI.downloadBackup = () => {
    const b = UI.book;
    const make = b.security ? OB.backup.createEncrypted(b) : Promise.resolve(OB.backup.create(b));
    return make.then((bk) => {
      U.download(OB.backup.fileName(b).replace(/\.json$/, b.security ? '_protected.json' : '.json'), JSON.stringify(bk), 'application/json');
      return b.saveCompany({ lastBackupAt: new Date().toISOString() }).then(() => UI.toast('Backup downloaded. Keep a copy outside this PC too.'));
    });
  };

  routes.settings = (el, r) => {
    const tab = r.params.tab || 'company';
    el.innerHTML = UI.page('Settings', '', `<nav class="tabs" role="tablist">${TABS.map(([k, l]) => `<a role="tab" href="#/settings?tab=${k}" class="${k === tab ? 'on' : ''}" aria-selected="${k === tab}">${l}</a>`).join('')}</nav><div id="tab"></div>`);
    const host = el.querySelector('#tab');
    ({ company, features, salestax, backup, data, integrity, audit, storage, security: UI.securityTab })[tab](host, r);
  };

  function company(el) {
    const b = UI.book, c = b.company;
    el.innerHTML = `<form id="co" class="card form-grid" autocomplete="off">
      <label class="field span2"><span>Company name</span><input name="name" value="${esc(c.name)}" maxlength="120"></label>
      <label class="field"><span>Legal name</span><input name="legalName" value="${esc(c.legalName)}"></label>
      <label class="field"><span>EIN</span><input name="ein" value="${esc(c.ein)}"></label>
      <label class="field"><span>Email</span><input name="email" value="${esc(c.email)}"></label>
      <label class="field"><span>Phone</span><input name="phone" value="${esc(c.phone)}"></label>
      <label class="field span2"><span>Address (printed on invoices)</span><textarea name="address" rows="3">${esc(c.address)}</textarea></label>
      <label class="field"><span>Default report basis</span><select name="basis"><option value="accrual">Accrual</option><option value="cash"${c.basis === 'cash' ? ' selected' : ''}>Cash</option></select></label>
      <label class="field"><span>First month of fiscal year</span><select name="fiscalYearStartMonth">${UI.MONTHS.map((mn, i) => `<option value="${i + 1}"${c.fiscalYearStartMonth === i + 1 ? ' selected' : ''}>${mn}</option>`).join('')}</select></label>
      <label class="field"><span>Default payment terms (days)</span><input name="defaultTerms" type="number" min="0" max="365" value="${esc(c.defaultTerms)}"></label>
      <label class="field"><span>Statement layout (Balance Sheet, Profit and Loss)</span><select name="statementLook" data-testid="co-look">${OB.reportModel.LOOKS.map(([k, l], i) => `<option value="${k}"${(c.statementLook || 'classic') === k ? ' selected' : ''}>${i + 1} ${l}</option>`).join('')}</select></label>
      <label class="field"><span>Currency</span><input value="USD" disabled></label>
      <label class="field"><span>Close the books through (optional)</span><input name="closingDate" type="date" value="${esc(c.closingDate)}"></label>
      ${c.closingPasswordHash ? '<label class="field"><span>Closing date password <span class="muted">(needed to change the date)</span></span><input name="closingPassword" type="password" autocomplete="off" data-testid="closing-pw"></label>' : '<span></span>'}
      <p class="muted span2">When a closing date is set, transactions on or before it cannot be added, changed or voided — useful after filing taxes.</p>
      <p class="muted span2">Class tracking, budgets and 1099 contractors are switched on or off in <a href="#/settings?tab=features">Settings → Features</a>.</p>
      <div class="span2"><button class="btn primary" type="submit" data-key="s">Save settings</button></div></form>
    <section class="card logo-card" data-testid="logo-card"><h2>Invoice logo <span class="muted small">(optional)</span></h2>
      <p class="muted">Printed at the top left of invoices, sales receipts and credit memos, above the company name. No logo is used unless you add one.</p>
      <div class="logo-row"><div class="logo-preview">${c.logo ? `<img src="${esc(c.logo)}" alt="Current invoice logo">` : '<span class="muted">No logo</span>'}</div>
        <label class="btn"><input type="file" id="logo-file" accept="image/png,image/jpeg,image/gif,image/webp" hidden data-testid="logo-file">${c.logo ? 'Replace logo…' : 'Add logo…'}</label>
        ${c.logo ? '<button type="button" class="btn ghost" id="logo-remove" data-testid="logo-remove">Remove logo</button>' : ''}</div>
      <p class="muted small">PNG, JPEG, GIF or WebP. Large images are scaled down to 1200 pixels wide; the logo is kept in this company’s books and backups.</p></section>
    <section class="card" data-testid="closing-card"><h2>Closing date password <span class="muted small">(optional)</span></h2>
      <p class="muted">With a password, nobody can move the closing date — and so change closed periods — without it. ${c.closingPasswordHash ? '<strong>A password is set.</strong>' : 'No password is set.'}</p>
      <form id="cpw" class="form-grid" autocomplete="off">
        ${c.closingPasswordHash ? '<label class="field"><span>Current password</span><input name="closingPassword" type="password" autocomplete="off"></label>' : ''}
        <label class="field"><span>${c.closingPasswordHash ? 'New password (leave blank to remove)' : 'New password'}</span><input name="newClosingPassword" type="password" autocomplete="new-password" data-testid="new-closing-pw"></label>
        <div class="span2"><button class="btn" type="submit">${c.closingPasswordHash ? 'Change or remove password' : 'Set password'}</button></div></form>
      ${(c.closingHistory || []).length ? `<h3>Closing date history</h3><table class="data compact" data-testid="closing-history"><thead><tr><th>Changed</th><th>From</th><th>To</th></tr></thead><tbody>${c.closingHistory.slice().reverse().slice(0, 20).map((h) => `<tr><td>${esc(new Date(h.at).toLocaleString())}</td><td>${h.from ? UI.date(h.from) : '—'}</td><td>${h.to ? UI.date(h.to) : 'Not closed'}</td></tr>`).join('')}</tbody></table>` : ''}</section>`;
    const cpw = el.querySelector('#cpw');
    cpw.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = Object.fromEntries(new FormData(cpw).entries());
      if (!c.closingPasswordHash && !v.newClosingPassword) return UI.toast('Enter a password.', 'error');
      b.saveCompany(v).then(() => { UI.toast(v.newClosingPassword ? 'Closing date password saved.' : 'Closing date password removed.'); company(el); }, UI.error);
    });
    const form = el.querySelector('#co');
    const submit = () => UI.runSave(form.querySelector('button[type=submit]'), () => b.saveCompany(Object.fromEntries(new FormData(form).entries())), 'Settings saved')
      .then((ok) => { if (ok) { tracker.reset(); document.getElementById('company-name').textContent = b.company.name; } return ok; });
    const tracker = UI.trackForm(form, { save: submit });
    form.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
    const saveLogo = (logo, msg) => b.saveCompany({ logo }).then(() => { UI.toast(msg); company(el); }, UI.error);
    el.querySelector('#logo-file').addEventListener('change', (e) => {
      const f = e.target.files[0]; if (!f) return;
      if (!/^image\/(png|jpeg|gif|webp)$/.test(f.type)) return UI.toast('Choose a PNG, JPEG, GIF or WebP image.', 'error');
      if (f.size > 15e6) return UI.toast('That image is too large.', 'error');
      const img = new Image(), url = URL.createObjectURL(f);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const k = Math.min(1, 1200 / img.naturalWidth), cv = document.createElement('canvas');
        cv.width = Math.max(1, Math.round(img.naturalWidth * k)); cv.height = Math.max(1, Math.round(img.naturalHeight * k));
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        saveLogo(cv.toDataURL('image/png'), 'Logo saved. It now prints on invoices.');
      };
      img.onerror = () => { URL.revokeObjectURL(url); UI.toast('That file could not be read as an image.', 'error'); };
      img.src = url;
    });
    const rm = el.querySelector('#logo-remove');
    if (rm) rm.addEventListener('click', () => UI.confirm('Remove logo', '<p>Invoices will print without a logo.</p>', { ok: 'Remove' }).then((ok) => ok && saveLogo('', 'Logo removed.')));
  }

  /* Sales tax rates (1.13). Each rate is owed in a liability account (usually Sales Tax Payable).
     A combined rate (state + county + city) is entered as one rate, as in QuickBooks' sales tax groups. */
  function salestax(el) {
    const b = UI.book, c = b.company, list = c.salesTaxes || [];
    el.innerHTML = `<section class="card" data-testid="salestax-card"><div class="card-head"><h2>Sales tax rates</h2><button type="button" class="btn primary" id="stx-new" data-testid="stx-new">New rate</button></div>
      <p class="muted">Add the rates you charge. Invoices, sales receipts, credit memos and estimates then show a Tax column and a sales tax choice; tax is worked out on the taxable lines and owed in the liability account. Mark customers as tax-exempt on their record. Pay the tax with a check or expense to the liability account. See <a href="#/report/salestax">Sales Tax Liability</a>.</p>
      ${list.length ? `<table class="data compact"><thead><tr><th>Name</th><th>Agency</th><th class="num">Rate</th><th>Liability account</th><th>Default</th><th>Status</th><th></th></tr></thead><tbody>${list.map((x) => `<tr><td>${esc(x.name)}</td><td>${esc(x.components && x.components.length ? x.components.map((c) => c.name + ' ' + OB.Book.fmtRate(c.rate) + ' (' + c.agency + ')').join(' + ') : x.agency || '')}</td><td class="num">${esc(OB.Book.fmtRate(x.rate))}</td><td>${esc(b.accountLabel(x.accountId))}</td><td>${c.defaultSalesTaxId === x.id ? 'Default' : ''}</td><td>${x.active === false ? 'Inactive' : 'Active'}</td><td><button type="button" class="btn ghost small" data-edit="${esc(x.id)}">Edit</button></td></tr>`).join('')}</tbody></table>` : UI.empty('No sales tax rates yet. Add one if you collect sales tax.')}
    </section>`;
    const edit = (x) => {
      if (x && !x.id) x = Object.assign({}, x, { id: '' });
      const liab = (a) => a.active && (a.type === 'ocl' || a.type === 'ltl');
      const defAcc = x ? x.accountId : (b.sys('STAX') || {}).id;
      UI.modal({ title: x ? 'Edit sales tax rate' : 'New sales tax rate', html: `<form id="stx" class="form-grid" autocomplete="off">
        <label class="field span2"><span>Name (printed on invoices)</span><input name="name" value="${esc(x ? x.name : '')}" maxlength="60" placeholder="e.g. Arizona + Tucson"></label>
        <label class="field"><span>Rate (%)</span><input name="rate" inputmode="decimal" value="${esc(x ? (x.rate / 10000).toString() : '')}" placeholder="8.7"></label>
        <label class="field"><span>Tax agency</span><input name="agency" value="${esc(x ? x.agency || '' : '')}" maxlength="80" placeholder="e.g. Arizona Dept. of Revenue"></label>
        <fieldset class="span2"><legend>Combined rate (optional) — state, county, city…</legend><table class="data compact" id="stx-parts"><thead><tr><th>Part</th><th>Agency</th><th class="num">Rate %</th></tr></thead><tbody>${[0, 1, 2, 3].map((i) => { const c = x && x.components && x.components[i]; return `<tr><td><input data-p="name" value="${esc(c ? c.name : '')}" aria-label="Part name"></td><td><input data-p="agency" value="${esc(c ? c.agency : '')}" aria-label="Agency"></td><td class="num"><input data-p="rate" inputmode="decimal" value="${esc(c ? (c.rate / 10000).toString() : '')}" aria-label="Rate" class="qty"></td></tr>`; }).join('')}</tbody></table>
          <p class="muted small">When parts are filled in, the rate is their total and each sale's tax is split by agency for the returns.</p></fieldset>
        <label class="field span2"><span>Owed in (liability account)</span><select name="accountId">${UI.accountOptions(defAcc, liab)}</select></label>
        <label class="check span2"><input type="checkbox" name="makeDefault"${!x || c.defaultSalesTaxId === x.id ? ' checked' : ''}> Default rate for new sales</label>
        ${x ? `<label class="check span2"><input type="checkbox" name="active"${x.active === false ? '' : ' checked'}> Active</label>` : ''}</form>
        <p class="muted small">Changing a rate affects new and edited documents; saved documents keep the rate they were posted with.</p>`,
        actions: [{ label: 'Cancel', value: null }, { label: 'Save', primary: true, collect: (m) => Object.assign(Object.fromEntries(new FormData(m.querySelector('#stx')).entries()), { components: [...m.querySelectorAll('#stx-parts tbody tr')].map((tr) => ({ name: tr.querySelector('[data-p=name]').value, agency: tr.querySelector('[data-p=agency]').value, rate: tr.querySelector('[data-p=rate]').value })).filter((p) => p.name || p.agency || p.rate) }) }] })
        .then((d) => d && b.saveSalesTax({ id: x ? x.id : '', name: d.name, rate: d.rate, agency: d.agency, accountId: d.accountId, makeDefault: !!d.makeDefault, active: x ? !!d.active : undefined, components: d.components })
          .then(() => { UI.toast('Sales tax rate saved'); salestax(el); }, (e) => { UI.error(e); edit(Object.assign({ id: x ? x.id : '', active: true }, x || {}, { name: d.name, agency: d.agency, accountId: d.accountId, rate: OB.Book.parseRate(d.rate) || 0 })); }));
    };
    el.querySelector('#stx-new').addEventListener('click', () => edit(null));
    el.querySelectorAll('[data-edit]').forEach((bt) => bt.addEventListener('click', () => edit(list.find((x) => x.id === bt.dataset.edit))));
  }

  /* Company features: one place to switch optional bookkeeping features on or off.
     Turning a feature off hides its menus, fields and reports; data already entered is kept. */
  const FEATURES = [
    { key: 'useClasses', id: 'classes', title: 'Class tracking', icon: 'M3 9.5V4a1 1 0 0 1 1-1h5.5l7.5 7.5-6.5 6.5z',
      desc: 'Tag transaction lines with a class — a department, location, product line or job — and see Profit and Loss by Class or filter any report by class.',
      adds: 'Adds: Class field and column on every transaction, Classes page, P&L by Class, class filters.', manage: ['#/classes', 'Manage classes'],
      count: (b) => b.classes.length ? b.classes.length + ' class' + (b.classes.length === 1 ? '' : 'es') : '' },
    { key: 'useBudgets', id: 'budgets', title: 'Budgets', icon: 'M3 16.5h14M5 13.5v-3M9 13.5V7M13 13.5V9.5',
      desc: 'Plan monthly targets for each income and expense account and compare them with actual results.',
      adds: 'Adds: Budgets page and editor, Budget vs. Actuals report.', manage: ['#/budgets', 'Manage budgets'],
      count: (b) => { const n = b.activeBudgets().length; return n ? n + ' budget' + (n === 1 ? '' : 's') : ''; } },
    { key: 'use1099', id: '1099', title: '1099 contractors', icon: 'M5 3h10v14H5zM7.5 7h5M7.5 10h5M7.5 13h3',
      desc: 'Track payments to contractors and other 1099 vendors and prepare Form 1099-NEC and 1099-MISC figures.',
      adds: 'Adds: 1099 setup page, Track for 1099 on vendors, 1099 Contractor Summary and Transaction Detail.', manage: ['#/1099', 'Open 1099 setup'],
      count: (b) => { const n = b.contacts.filter((c) => c.kind === 'vendor' && c.is1099).length; return n ? n + ' vendor' + (n === 1 ? '' : 's') + ' tracked' : ''; } },
    { key: 'allowNegativeInventory', id: 'neginv', off: true, title: 'Allow negative inventory', icon: 'M4 10h12M10 4v2M10 14v2',
      desc: 'Let a sale go through when the items are not on hand yet. The missing units are costed at the item\'s cost; when the purchase is entered, later sales are recosted.',
      adds: 'Off: a sale that would take an item below zero on hand is refused.', manage: ['#/items', 'Products and services'],
      count: () => '' }
  ];
  UI.FEATURES = FEATURES;
  function features(el) {
    const b = UI.book, c = b.company;
    const on = (f) => f.key === 'useClasses' || f.off ? !!c[f.key] : c[f.key] !== false;
    el.innerHTML = `<form id="feat" class="card feat-form" autocomplete="off">
      <p class="muted">Switch optional features on for this company. Turning a feature off hides its menus, fields and reports — anything you already entered is kept and comes back when you turn it on again.</p>
      <ul class="feat-list">${FEATURES.map((f) => `<li class="feat">
        <svg class="feat-ico" viewBox="0 0 20 20" aria-hidden="true"><path d="${f.icon}"/></svg>
        <div class="feat-txt"><label for="f-${f.id}"><strong>${esc(f.title)}</strong></label><p>${esc(f.desc)}</p><p class="muted small">${esc(f.adds)}${f.count(b) ? ' · <strong>' + esc(f.count(b)) + '</strong>' : ''}</p></div>
        <div class="feat-ctl"><span class="switch"><input type="checkbox" role="switch" id="f-${f.id}" name="${f.key}" ${on(f) ? 'checked' : ''}><span aria-hidden="true"></span></span>
          ${on(f) ? `<a href="${f.manage[0]}" class="small">${esc(f.manage[1])}</a>` : ''}</div></li>`).join('')}</ul>
      <div class="form-actions"><button type="submit" class="btn primary" data-key="s">Save features</button><span class="form-status" aria-live="off"></span></div></form>`;
    const form = el.querySelector('#feat');
    const read = () => { const o = {}; FEATURES.forEach((f) => { o[f.key] = form.querySelector(`[name="${f.key}"]`).checked; }); return o; };
    const submit = () => UI.runSave(form.querySelector('[type=submit]'), () => b.saveCompany(read()), 'Features saved').then((ok) => { if (ok) { tracker.reset(); UI.applyFeatures(); UI.render(); } return ok; });
    const tracker = UI.trackForm(form, { snapshot: () => JSON.stringify(read()), save: submit });
    form.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
  }

  function backup(el) {
    const b = UI.book, last = b.company.lastBackupAt;
    el.innerHTML = `<section class="card">
        <h2>Download a backup</h2>
        ${b.security ? '<div class="banner info">🔒 This company is password protected, so backups are encrypted. A backup opens only with the company password or recovery key.</div>' : ''}
        <p>Saves everything for <strong>${esc(b.company.name)}</strong> — accounts, customers, vendors, all ${b.transactions.length.toLocaleString()} transactions, rules, schedules, reconciliations and the audit log — to one JSON file with a checksum.</p>
        <p class="${last ? 'muted' : 'warn-text'}">${last ? 'Last backup: ' + esc(new Date(last).toLocaleString()) : 'No backup has been made yet.'}</p>
        <button class="btn primary" id="bk-dl">Download backup</button>
        <p class="muted small">Your browser saves it to your Downloads folder. Copy backups to a USB drive or another computer regularly — if this PC fails or browser data is cleared, the backup is the only copy.</p>
      </section>
      <section class="card">
        <h2>Restore a backup</h2>
        <p>The file is checked first (format, checksum, every transaction balances, A/R and A/P tie out). Nothing changes unless it passes and you confirm. You can restore as a separate company or replace this one.</p>
        <label class="btn">Choose backup file…<input type="file" id="bk-file" accept=".json,application/json" hidden></label>
      </section>`;
    el.querySelector('#bk-dl').addEventListener('click', (e) => UI.busy(e.target, UI.downloadBackup).catch(UI.error));
    el.querySelector('#bk-file').addEventListener('change', (e) => UI.restoreFlow(e.target.files[0], b.company.id));
  }

  function data(el) {
    const b = UI.book;
    el.innerHTML = `<div class="grid2">
      <section class="card"><h2>Export</h2><ul class="plain-list">
        <li><button class="btn" data-ex="tx">All transactions (journal lines)</button></li>
        <li><button class="btn" data-ex="acc">Chart of accounts</button></li>
        <li><button class="btn" data-ex="cus">Customers</button> <button class="btn" data-ex="ven">Vendors</button></li>
        <li><button class="btn" data-ex="all">Full workbook (.xlsx: accounts, contacts, journal)</button></li></ul>
        <p class="muted small">CSV opens in Excel; .xlsx files are native Excel workbooks.</p></section>
      <section class="card"><h2>Import</h2><ul class="plain-list">
        <li><a class="btn primary" href="#/migrate" data-testid="settings-migrate">Whole company from QuickBooks (IIF + General Ledger)</a></li>
        <li><a class="btn" href="#/bankfeed?import=1">Bank or card transactions (CSV, Excel, OFX, PDF)</a></li>
        <li><label class="btn">Customers (CSV)<input type="file" data-im="customer" accept=".csv" hidden></label> <label class="btn">Vendors (CSV)<input type="file" data-im="vendor" accept=".csv" hidden></label></li>
        <li><label class="btn">Chart of accounts (CSV)<input type="file" data-im="accounts" accept=".csv" hidden></label></li></ul>
        <p class="muted small">Contact files need a “Name” column; optional Company, Email, Phone, Address, Terms. Account files need “Name” and “Type” (e.g. Expense, Bank, Other Current Asset); optional Number, Description.</p></section></div>`;
    const journal = () => {
      const rows = [['Transaction ID', 'Date', 'Type', 'No.', 'Status', 'Name', 'Memo', 'Account', 'Debit', 'Credit', 'Line memo']];
      b.transactions.slice().sort(OB.Book.cmpTxn).forEach((t) => t.splits.forEach((s) => rows.push([t.id, t.date, UI.typeLabel(t.type), t.number, t.status, UI.contactName(s.contactId || t.contactId), t.memo, b.accountLabel(s.accountId), s.amount > 0 ? UI.m(s.amount) : '', s.amount < 0 ? UI.m(-s.amount) : '', s.memo])));
      return rows;
    };
    const accs = () => [['Number', 'Name', 'Type', 'Description', 'Active', 'Balance']].concat(b.sortedAccounts().map((a) => [a.number, b.accountFullName(a), S.TYPE[a.type].label, a.description, a.active ? 'Yes' : 'No', UI.m(b.accountBalance(a.id))]));
    const cons = (k) => [['Name', 'Company', 'Email', 'Phone', 'Address', 'Terms', 'Balance']].concat(b.contacts.filter((c) => c.kind === k).map((c) => [c.name, c.company, c.email, c.phone, c.address, c.terms, UI.m(b.contactBalance(c.id))]));
    el.addEventListener('click', (e) => {
      const x = e.target.closest('[data-ex]'); if (!x) return;
      const k = x.dataset.ex;
      if (k === 'tx') UI.exportMatrix('Journal_Lines', journal(), 'csv');
      if (k === 'acc') UI.exportMatrix('Chart_of_Accounts', accs(), 'csv');
      if (k === 'cus') UI.exportMatrix('Customers', cons('customer'), 'csv');
      if (k === 'ven') UI.exportMatrix('Vendors', cons('vendor'), 'csv');
      if (k === 'all') {
        const bytes = OB.xlsx.build([{ name: 'Accounts', rows: accs() }, { name: 'Customers', rows: cons('customer') }, { name: 'Vendors', rows: cons('vendor') }, { name: 'Journal', rows: journal() }]);
        U.download(U.safeFileName(b.company.name + '_Workbook_' + U.today()) + '.xlsx', new Blob([bytes], { type: OB.xlsx.MIME }));
      }
    });
    el.querySelectorAll('[data-im]').forEach((inp) => inp.addEventListener('change', (e) => UI.importCSVFile(e.target.files[0], (table) => {
      const kind = inp.dataset.im;
      const res = kind === 'accounts' ? OB.importer.accountsFromCSV(table) : OB.importer.contactsFromCSV(table, kind);
      let okN = 0; const errs = res.errors.slice();
      return res.items.reduce((p, it) => p.then(() => (kind === 'accounts' ? b.saveAccount(it) : b.saveContact(it)).then(() => okN++, (er) => errs.push(it.name + ': ' + er.message))), Promise.resolve())
        .then(() => UI.modal({ title: 'Import finished', html: `<p>Imported ${okN}.</p>${errs.length ? `<ul class="issues warn">${errs.slice(0, 30).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}` }));
    })));
  }

  function integrity(el) {
    const b = UI.book;
    el.innerHTML = `<section class="card"><h2>Data integrity check</h2><p>Re-checks every posted transaction and confirms that the ledger, subledgers and statements agree.</p><button class="btn primary" id="ic-run">Run check</button><div id="ic-out"></div></section>`;
    const run = () => {
      const t0 = performance.now();
      const res = b.checkIntegrity();
      const ms = Math.round(performance.now() - t0);
      el.querySelector('#ic-out').innerHTML = `
        ${res.issues.length ? `<div class="banner danger"><strong>${res.issues.length} problem(s) found.</strong> Restore a recent backup if these are unexpected.</div><ul class="issues">${res.issues.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : `<div class="banner ok"><strong>All checks passed.</strong></div>`}
        <ul class="checks">${res.ok.map((x) => `<li>✓ ${esc(x)}</li>`).join('')}</ul>
        <p class="muted small">${res.transactions.toLocaleString()} transactions checked in ${ms} ms.</p>`;
    };
    el.querySelector('#ic-run').addEventListener('click', run);
    run();
  }

  function audit(el, r) {
    const b = UI.book, page = +r.params.page || 0, size = 100;
    const q = (r.params.q || '').toLowerCase();
    const list = b.audit.filter((a) => !q || (a.summary + ' ' + a.action).toLowerCase().indexOf(q) >= 0).sort((x, y) => x.ts < y.ts ? 1 : -1);
    el.innerHTML = `<div class="toolbar"><input type="search" id="au-q" placeholder="Search the audit log" value="${esc(r.params.q || '')}" aria-label="Search audit log"></div>
      <table class="data"><thead><tr><th>When</th><th>Action</th><th>Details</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>
      ${list.slice(page * size, page * size + size).map((a) => `<tr><td class="nowrap">${esc(new Date(a.ts).toLocaleString())}</td><td><span class="badge">${esc(a.action)}</span></td><td>${esc(a.summary)}</td><td>${a.txnId && b.txById[a.txnId] ? `<a href="#/txn/${esc(a.txnId)}">Open</a>` : ''}</td></tr>`).join('')}
      </tbody></table>${UI.pager(list.length, page, size, (p) => UI.go('#/settings?' + UI.qs({ tab: 'audit', q: r.params.q, page: p })))}
      <p class="muted small">The audit log is append-only. Edits store the previous version of the transaction; voids keep the original amounts.</p>`;
    el.querySelector('#au-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') UI.go('#/settings?' + UI.qs({ tab: 'audit', q: e.target.value })); });
  }

  function storage(el) {
    const cur = UI.theme || 'system';
    el.innerHTML = `<section class="card"><h2>Appearance</h2>
      <div class="segmented" role="radiogroup" aria-label="Appearance">${[['system', 'Match Windows'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) =>
        `<button type="button" role="radio" aria-checked="${v === cur}" data-theme-opt="${v}">${l}</button>`).join('')}</div>
      <p class="muted small">The sun/moon button in the top bar switches between Light and Dark. Printing and PDFs always use the light appearance.</p>
      <h3>Density</h3>
      <div class="segmented" role="radiogroup" aria-label="Density" id="density-seg">${[['comfortable', 'Comfortable'], ['compact', 'Compact']].map(([v, l]) =>
        `<button type="button" role="radio" aria-checked="${v === (OB.prefs.get('density') || 'comfortable')}" data-density-opt="${v}">${l}</button>`).join('')}</div>
      <p class="muted small">Compact fits more rows on screen.</p>
      <h3>Tables</h3>
      <p class="muted small">Column widths and hidden columns are remembered for each report and list.</p>
      <button class="btn" id="reset-tables">Reset all table layouts</button>
      <p class="muted small">${OB.prefs.isPersistent() ? 'Appearance, density, sidebar and table preferences are saved in this browser and kept across restarts.' : 'This browser blocks saving preferences, so they reset when it closes.'}</p></section>
      <section class="card"><h2>Storage</h2><div id="st-info" class="muted">Checking…</div>
      <button class="btn" id="st-persist">Ask the browser to keep data permanently</button></section>
      <section class="card"><h2>About</h2><dl class="facts"><dt>Version</dt><dd>VaultBook ${esc(S.APP_VERSION)} (data format v${S.DATA_VERSION}; formerly OfflineBooks US)</dd>
      <dt>Storage</dt><dd>IndexedDB in this browser profile; one database per company</dd><dt>Network</dt><dd>None. The app makes no network requests.</dd>
      <dt>Self-test</dt><dd><a href="tests/tests.html" target="_blank">Open the test suite</a> (runs on separate test data)</dd></dl></section>`;
    const seg = el.querySelector('.segmented');
    seg.addEventListener('click', (e) => {
      const b = e.target.closest('[data-theme-opt]'); if (!b) return;
      UI.setTheme(b.dataset.themeOpt, true);
    });
    const arrows = (group) => group.addEventListener('keydown', (e) => {   // arrow keys move between options, as in native radio groups
      const opts = [...group.querySelectorAll('[role=radio]')], i = opts.findIndex((x) => x.getAttribute('aria-checked') === 'true');
      const n = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
      if (n) { e.preventDefault(); const t = opts[(i + n + opts.length) % opts.length]; t.click(); t.focus(); }
    });
    arrows(seg);
    const dseg = el.querySelector('#density-seg');
    dseg.addEventListener('click', (e) => { const b = e.target.closest('[data-density-opt]'); if (b) UI.setDensity(b.dataset.densityOpt); });
    arrows(dseg);
    el.querySelector('#reset-tables').addEventListener('click', () => { OB.prefs.resetTables(); UI.toast('Table layouts reset.'); });
    const show = () => OB.db.storageInfo().then((i) => {
      el.querySelector('#st-info').innerHTML = `<dl class="facts"><dt>Persistent storage</dt><dd>${i.persisted === true ? '✓ Granted — the browser will not clear this data automatically to free space.' : i.persisted === false ? 'Not granted — the browser may clear data if the disk gets very full. Keep backups.' : 'Unknown in this browser.'}</dd>
        <dt>Space used</dt><dd>${i.usage !== null ? (i.usage / 1048576).toFixed(1) + ' MB' : 'unknown'}${i.quota ? ' of about ' + Math.round(i.quota / 1048576).toLocaleString() + ' MB available' : ''}</dd></dl>`;
    });
    show();
    el.querySelector('#st-persist').addEventListener('click', () => OB.db.requestPersistence().then((ok) => { UI.toast(ok ? 'Persistent storage granted.' : 'The browser did not grant persistent storage. Keep regular backups.', ok ? 'ok' : 'error'); show(); }));
  }
})();
