/* global OB */
/* OfflineBooks US — main pages. */
(function () {
  'use strict';
  const U = OB.util, S = OB.schema, R = OB.reports, UI = OB.ui, esc = U.esc;
  const routes = UI.routes;
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  UI.MONTHS = MONTHS;

  /* =============== Company picker / setup =============== */
  routes.companies = (el) => {
    OB.db.listCompanies().then((list) => {
      list = list.slice().sort((x, y) => String(y.lastOpened || '').localeCompare(String(x.lastOpened || '')));   // most recent first, like Select Company
      el.innerHTML = `<div class="welcome">
        <div class="welcome-head">
          <div class="logo-mark" aria-hidden="true">VB</div>
          <div><h1>VaultBook</h1><p class="sub">Double-entry bookkeeping that stays on this computer.</p></div>
        </div>
        <div class="welcome-grid">
          <section class="card">
            <h2>Your companies</h2>
            ${list.length ? `<ul class="company-list">${list.map((c) => `<li><button class="company-open" data-id="${esc(c.id)}"><strong>${esc(c.name)}${c.protected ? ' <span class="badge" title="Password protected">🔒 Protected</span>' : ''}</strong><span class="muted">Last opened ${c.lastOpened ? esc(new Date(c.lastOpened).toLocaleString()) : '—'}</span></button>
              <button class="btn ghost small" data-del="${esc(c.id)}" data-name="${esc(c.name)}" title="Delete company">Delete</button></li>`).join('')}</ul>`
              : '<p class="muted">No companies yet. Create one to start bookkeeping, or restore a backup file.</p>'}
            ${list.length ? '<p class="co-keys muted small"><kbd>↑</kbd><kbd>↓</kbd> select · <kbd>Enter</kbd> open · type a name to jump · <kbd>Alt+C</kbd> create · <kbd>Alt+R</kbd> restore · <kbd>Alt+Q</kbd> from QuickBooks files · <kbd>Del</kbd> delete</p>' : '<p class="co-keys muted small"><kbd>Alt+C</kbd> create · <kbd>Alt+R</kbd> restore a backup · <kbd>Alt+Q</kbd> create from QuickBooks files</p>'}
            <div class="row gap">
              <label class="btn">Restore from backup… <kbd>Alt+R</kbd><input type="file" id="restore-file" accept=".json,application/json" hidden></label>
              <label class="btn" title="Choose all the files a client sent from QuickBooks: VaultBook names the company from them and shows what it will import">Create from QuickBooks files… <kbd>Alt+Q</kbd><input type="file" id="qb-newco" data-testid="qb-newco" multiple accept=".xlsx,.xlsm,.xls,.csv,.iif,.txt,.pdf,.json,.XLSX,.XLS,.CSV,.IIF,.TXT,.PDF,.JSON" hidden></label>
            </div>
            <p class="muted small">Got a client's QuickBooks export (Journal, Trial Balance, Balance Sheet, Profit and Loss, lists)? Choose all the files at once with <em>Create from QuickBooks files</em>.</p>
          </section>
          <section class="card">
            <h2>Create a company <kbd class="co-kbd">Alt+C</kbd></h2>
            <form id="newco" class="form-grid" autocomplete="off">
              <label class="field span2"><span>Company name</span><input name="name" required maxlength="120" placeholder="e.g. Riverside Plumbing LLC"></label>
              <label class="field"><span>Accounting basis</span><select name="basis"><option value="accrual">Accrual</option><option value="cash">Cash</option></select></label>
              <label class="field"><span>Fiscal year starts</span><select name="fiscalYearStartMonth">${MONTHS.map((m, i) => `<option value="${i + 1}">${m}</option>`).join('')}</select></label>
              <label class="field"><span>EIN (optional)</span><input name="ein" maxlength="20" placeholder="12-3456789"></label>
              <div class="field"><span>Currency</span><p class="field-static">US dollar (USD)</p></div>
              <div class="span2 row gap"><button class="btn primary" type="submit">Create company</button>
              <label class="check"><input type="checkbox" name="sample"> Add sample data to explore</label>
              <label class="check"><input type="checkbox" name="qb" data-testid="newco-qb"> Bring in my books from QuickBooks next</label></div>
            </form>
            <p class="muted small">A standard US small-business chart of accounts is created. You can edit it any time.</p>
          </section>
        </div>
        <section class="card note">
          <h2>Where your data lives</h2>
          <p>Books are saved in this browser's private storage on this device (IndexedDB), for the user account and browser profile you're using now.
          Clearing this site's data, using a private window, or switching browsers means you won't see the data.
          <strong>Download a backup file regularly</strong> (Settings → Backup) and keep copies somewhere safe.</p>
        </section>
      </div>`;
      el.querySelectorAll('.company-open').forEach((b) => b.addEventListener('click', () => UI.openCompany(b.dataset.id).catch(UI.error)));
      el.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => deleteCompany(b.dataset.del, b.dataset.name)));
      el.querySelector('#newco').addEventListener('submit', (e) => {
        e.preventDefault();
        const f = new FormData(e.target), btn = e.target.querySelector('button[type=submit]');
        UI.busy(btn, () => OB.db.createCompany({ name: f.get('name'), basis: f.get('basis'), fiscalYearStartMonth: f.get('fiscalYearStartMonth'), ein: f.get('ein') })
          .then((book) => Promise.resolve(f.get('sample') && !f.get('qb') ? OB.sample.populate(book) : null).then(() => {
            OB.db.requestPersistence();
            if (f.get('qb')) UI._resumeHash = '#/migrate';   // open straight into the QuickBooks import
            return UI.openCompany(book.company.id);
          }))).catch(UI.error);
      });
      // sample data and a QuickBooks import exclude each other: ticking one clears the other
      const nf = el.querySelector('#newco');
      nf.addEventListener('change', (e) => { const o = { sample: 'qb', qb: 'sample' }[e.target.name]; if (o && e.target.checked) nf.querySelector(`[name="${o}"]`).checked = false; });
      el.querySelector('#restore-file').addEventListener('change', (e) => UI.restoreFlow(e.target.files[0], null));
      el.querySelector('#qb-newco').addEventListener('change', (e) => {
        const files = [...e.target.files]; e.target.value = ''; if (!files.length) return;
        UI.toast('Reading ' + files.length + ' file' + (files.length === 1 ? '' : 's') + '…');
        UI.companyFromQuickBooks(files).then((name) => { if (name) UI.toast('Created ' + name + '. Check the preview, then press Import.'); }).catch(UI.error);
      });
      // keyboard first: the most recent company is highlighted, Enter opens it (TallyPrime's Select Company)
      const first = el.querySelector('.company-open') || el.querySelector('#newco input[name=name]');
      if (first) requestAnimationFrame(() => { if (first.isConnected && !document.querySelector('.modal-backdrop')) first.focus(); });
    }).catch(UI.error);
  };
  function deleteCompany(id, name) {
    UI.modal({
      title: 'Delete company',
      html: `<p>This permanently deletes <strong>${esc(name)}</strong> and all of its transactions from this browser. It cannot be undone.</p>
        <p>Make sure you have a backup first.</p>
        <label class="field"><span>Type the company name to confirm</span><input id="delname" autocomplete="off" aria-describedby="delname-msg"></label>
        <p id="delname-msg" class="warn-text small" role="alert" hidden></p>`,
      actions: [{ label: 'Cancel', value: null }, { label: 'Delete permanently', danger: true, collect: (m) => {
        const inp = m.querySelector('#delname'), msg = m.querySelector('#delname-msg');
        if (inp.value.trim() === name) return inp.value.trim();
        msg.textContent = `Type ${name} exactly as shown to delete it.`; msg.hidden = false; inp.setAttribute('aria-invalid', 'true'); inp.focus();
        return false;   // the dialog stays open
      } }]
    }).then((v) => {
      if (v === null || v !== name) return;
      return OB.db.deleteCompany(id).then(() => { UI.toast('Company deleted.'); UI.render(); });
    }).catch(UI.error);
  }

  /** Read, validate and restore a backup file. currentId given = may replace that company. */
  UI.restoreFlow = (file, currentId) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      let obj;
      try { obj = JSON.parse(reader.result); } catch (e) { UI.toast('That file is not valid JSON.', 'error'); return; }
      if (obj && obj.encrypted) UI.askBackupSecret(obj).then((d) => { if (d) proceed(d.inner, { dek: d.dek, security: d.security }); }).catch(UI.error);
      else proceed(obj, null);
    };
    const proceed = (obj, prot) => {
      const v = OB.backup.validate(obj);
      if (!v.ok) {
        UI.modal({ title: 'Backup cannot be restored', html: `<div class="banner danger">The file failed validation. Nothing was changed.</div><ul class="issues">${v.errors.slice(0, 20).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>${v.errors.length > 20 ? `<p class="muted">…and ${v.errors.length - 20} more.</p>` : ''}` });
        return;
      }
      const s = v.summary;
      const sameId = v.data.company.id;
      OB.db.listCompanies().then((list) => {
        const exists = list.find((c) => c.id === sameId);
        const actions = [{ label: 'Cancel', value: null }, { label: 'Restore as a new company', value: 'copy', primary: !exists }];
        if (exists) actions.push({ label: 'Replace "' + exists.name + '"', value: 'replace', danger: true });
        return UI.modal({
          title: 'Restore backup', wide: true,
          html: `<div class="banner ok">Backup verified: checksum and accounting integrity checks passed.</div>
            ${prot ? '<div class="banner info">🔒 Encrypted backup. The restored company stays password protected with the same password.</div>' : ''}
            <dl class="facts"><dt>Company</dt><dd>${esc(s.companyName)}</dd><dt>Created</dt><dd>${esc(s.createdAt ? new Date(s.createdAt).toLocaleString() : 'unknown')}</dd>
            <dt>Contents</dt><dd>${s.accounts} accounts · ${s.contacts} customers/vendors · ${s.transactions} transactions</dd></dl>
            ${v.warnings.length ? `<ul class="issues warn">${v.warnings.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
            ${exists ? `<p>A company with this identity already exists in this browser (<strong>${esc(exists.name)}</strong>). Replacing it overwrites its current data with the backup.</p>` : ''}`,
          actions
        }).then((mode) => {
          if (!mode) return;
          // replacing: one last check, with a backup of the current data offered first when it is the open company
          const canBackup = mode === 'replace' && UI.book && UI.book.company.id === exists.id;
          return (mode !== 'replace' ? Promise.resolve('go') : UI.modal({ title: 'Replace "' + exists.name + '"?',
            html: `<p>All current data in <strong>${esc(exists.name)}</strong> is overwritten by the backup. This cannot be undone.</p>${canBackup ? '<p>Download a backup of the current data first, so you can go back.</p>' : ''}`,
            actions: [{ label: 'Cancel', value: null }].concat(canBackup ? [{ label: 'Back up, then replace', value: 'backup', primary: true }] : []).concat([{ label: 'Replace', value: 'go', danger: true }]) }))
            .then((how) => { if (!how) return null; return how === 'backup' ? UI.downloadBackup().then(() => 'go') : 'go'; })
            .then((how) => { if (!how) return;
              const data = OB.backup.prepareRestore(v.data, mode);
              if (UI.book && UI.book.company.id === data.company.id) UI.book.adapter.close();
              return OB.db.writeCompanyData(data, prot).then(() => { UI.toast('Backup restored.'); return UI.openCompany(data.company.id, prot ? prot.dek : undefined); });
            });
        });
      }).catch(UI.error);
    };
    reader.onerror = () => UI.toast('Could not read the file.', 'error');
    reader.readAsText(file);
  };

  /* Dashboard: see js/ui-studio.js (an older copy here was never shown and was removed in 1.50.2). */

  /** Clickable rows: the whole row opens on click, and the first cell becomes a real link so keyboard and
   *  screen-reader users can reach every row with Tab and open it with Enter. */
  UI.bindRowLinks = (el) => el.querySelectorAll('tr.click').forEach((tr) => {
    if (!tr.querySelector('a')) { const td = tr.querySelector('td'); if (td) td.innerHTML = `<a class="row-link" href="${esc(tr.dataset.href)}">${td.innerHTML}</a>`; }
    tr.addEventListener('click', (e) => { if (!e.target.closest('a,button,input')) location.hash = tr.dataset.href; });
  });

  /* =============== Chart of accounts =============== */
  routes.accounts = (el, r) => {
    const b = UI.book;
    const showInactive = r.params.inactive === '1';
    const q = (r.params.q || '').toLowerCase();
    const list = b.sortedAccounts((a) => (showInactive || a.active) && (!q || (a.name + ' ' + a.number + ' ' + S.TYPE[a.type].label).toLowerCase().indexOf(q) >= 0));
    el.innerHTML = UI.page('Chart of accounts', `
      <button class="btn" id="acc-export">Export CSV</button>
      <label class="btn">Import CSV<input type="file" id="acc-import" accept=".csv" hidden></label>
      <button class="btn primary" id="acc-new">+ New account</button>`, `
      <div class="toolbar"><input type="search" id="acc-q" placeholder="Search accounts" value="${esc(r.params.q || '')}" aria-label="Search accounts">
      <label class="check"><input type="checkbox" id="acc-inactive" ${showInactive ? 'checked' : ''}> Show inactive</label></div>
      <table class="data"><thead><tr><th>Number</th><th>Name</th><th>Type</th><th class="num">Balance</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>
      ${list.map((a) => {
        const bs = S.isBS(a.type);
        const bal = bs ? b.accountBalance(a.id) : R.netIncome ? b.normalSign(a) * R.rawSum(b.splitIndex()[a.id], U.fiscalYearStart(U.today(), b.company.fiscalYearStartMonth), U.today()) : 0;
        return `<tr class="${a.active ? '' : 'inactive'}"><td>${esc(a.number)}</td><td style="padding-left:${0.75 + depthOf(a) * 1.25}rem"><a href="#/register/${esc(a.id)}">${esc(a.name)}</a>${a.system ? ' <span class="badge">System</span>' : ''}${a.active ? '' : ' <span class="badge void">Inactive</span>'}${a.description ? `<div class="muted small">${esc(a.description)}</div>` : ''}</td>
          <td>${esc(S.TYPE[a.type].label)}</td><td class="num">${UI.money(bal, { contra: bs && /^accumulated (depreciation|amortization)/i.test(a.name) })}${bs ? '' : '<div class="muted small">FY to date</div>'}</td>
          <td class="actions-cell"><button class="btn ghost small" data-edit="${esc(a.id)}">Edit</button>${bs && a.type !== 'ar' && a.type !== 'ap' && a.system !== 'OBE' ? `<button class="btn ghost small" data-ob="${esc(a.id)}">Opening balance</button>` : ''}</td></tr>`;
      }).join('')}</tbody></table>`, { html: 'Income and expense accounts show fiscal-year-to-date totals.' });
    UI.fillLayout(el, 'table.data', 'list:accounts', 1);
    function depthOf(a) { let d = 0, p = a.parentId && b.accById[a.parentId]; while (p && d < 8) { d++; p = p.parentId && b.accById[p.parentId]; } return d; }
    el.querySelector('#acc-new').addEventListener('click', () => UI.editAccount(null).then((x) => { if (x) UI.render(); }).catch(UI.error));
    el.querySelectorAll('[data-edit]').forEach((x) => x.addEventListener('click', () => UI.editAccount(b.accById[x.dataset.edit]).then((y) => { if (y) UI.render(); }).catch(UI.error)));
    el.querySelectorAll('[data-ob]').forEach((x) => x.addEventListener('click', () => openingBalance(b.accById[x.dataset.ob])));
    let t;
    el.querySelector('#acc-q').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => UI.go('#/accounts?' + UI.qs({ q: e.target.value, inactive: showInactive ? 1 : '' })), 300); });
    el.querySelector('#acc-inactive').addEventListener('change', (e) => UI.go('#/accounts?' + UI.qs({ q: r.params.q, inactive: e.target.checked ? 1 : '' })));
    el.querySelector('#acc-export').addEventListener('click', () => UI.exportMatrix('Chart_of_Accounts', [['Number', 'Name', 'Type', 'Description', 'Active', 'Balance']].concat(
      b.sortedAccounts().map((a) => [a.number, b.accountFullName(a), S.TYPE[a.type].label, a.description, a.active ? 'Yes' : 'No', UI.m(b.accountBalance(a.id))])), 'csv'));
    el.querySelector('#acc-import').addEventListener('change', (e) => importCSVFile(e.target.files[0], (table) => {
      const res = OB.importer.accountsFromCSV(table);
      return importItems(res, (it) => b.saveAccount(it), 'accounts').then(() => UI.render());
    }));
  };
  function importCSVFile(file, fn) {
    if (!file) return;
    const rd = new FileReader();
    rd.onload = () => { try { Promise.resolve(fn(U.parseCSV(rd.result))).catch(UI.error); } catch (e) { UI.error(e); } };
    rd.readAsText(file);
  }
  UI.importCSVFile = importCSVFile;
  function importItems(res, save, what) {
    let okN = 0; const errs = res.errors.slice();
    return res.items.reduce((p, it) => p.then(() => save(it).then(() => okN++, (e) => errs.push(it.name + ': ' + e.message))), Promise.resolve())
      .then(() => UI.modal({ title: 'Import finished', html: `<p>Imported ${okN} ${what}.</p>${errs.length ? `<p>${errs.length} skipped:</p><ul class="issues warn">${errs.slice(0, 30).map((e) => `<li>${esc(e)}</li>`).join('')}</ul>` : ''}` }));
  }

  /** Account editor. pre = prefilled values (e.g. the name typed in a form). Resolves to the saved account or null.
   *  Never re-renders the page, so it can be used from inside an unsaved transaction form. */
  UI.editAccount = function editAccount(a, pre) {
    const b = UI.book;
    const v0 = Object.assign({ type: 'expense', number: '', name: '', parentId: '', description: '', active: true }, a || {}, pre || {});
    const types = S.ACCOUNT_TYPES.filter((t) => (a && a.type === t.id) || (t.id !== 'ar' && t.id !== 'ap'));
    return UI.modal({
      title: a ? 'Edit account' : 'New account',
      html: `<div class="form-grid">
        <label class="field span2"><span>Name</span><input id="f-name" value="${esc(v0.name)}" maxlength="100"></label>
        <label class="field"><span>Account type</span><select id="f-type" ${a && a.system ? 'disabled' : ''}>${types.map((t) => `<option value="${t.id}"${v0.type === t.id ? ' selected' : ''}>${esc(t.label)}</option>`).join('')}</select></label>
        <label class="field"><span>Number (optional)</span><input id="f-num" value="${esc(v0.number)}" maxlength="12"></label>
        <label class="field span2"><span>Sub-account of (optional)</span><select id="f-parent"></select></label>
        <label class="field span2"><span>Description</span><input id="f-desc" value="${esc(v0.description)}" maxlength="200"></label>
        <label class="field span2" id="f-cf-wrap"><span>Statement of Cash Flows section</span><select id="f-cf">${[['', 'By account type (default)'], ['operating', 'Operating activities'], ['investing', 'Investing activities'], ['financing', 'Financing activities']].map(([k, l]) => `<option value="${k}"${(v0.cashFlow || '') === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        ${a && !a.system ? `<label class="check span2"><input type="checkbox" id="f-active" ${v0.active ? 'checked' : ''}> Active</label>` : ''}
      </div>`,
      onMount: (m) => {
        const fill = () => {
          const type = m.querySelector('#f-type').value;
          m.querySelector('#f-parent').innerHTML = UI.accountOptions(v0.parentId, (x) => x.type === type && (!a || x.id !== a.id), { blankLabel: '— none —' });
        };
        const cf = () => { m.querySelector('#f-cf-wrap').hidden = !S.isBS(m.querySelector('#f-type').value) || !!(S.TYPE[m.querySelector('#f-type').value] || {}).cash; };
        m.querySelector('#f-type').addEventListener('change', () => { fill(); cf(); }); fill(); cf();
        const nm = m.querySelector('#f-name'); nm.focus(); nm.setSelectionRange(nm.value.length, nm.value.length);
      },
      actions: [{ label: 'Cancel', value: null }, {
        label: 'Save account', primary: true, collect: (m) => ({
          id: a ? a.id : '', type: a && a.system ? a.type : m.querySelector('#f-type').value, number: m.querySelector('#f-num').value, name: m.querySelector('#f-name').value,
          parentId: m.querySelector('#f-parent').value, description: m.querySelector('#f-desc').value, active: m.querySelector('#f-active') ? m.querySelector('#f-active').checked : undefined,
          cashFlow: m.querySelector('#f-cf-wrap').hidden ? '' : m.querySelector('#f-cf').value
        })
      }]
    }).then((v) => {
      if (!v) return null;
      return b.saveAccount(v).then((saved) => { UI.toast('Account “' + saved.name + '” saved.'); return saved; },
        (e) => { UI.toast(e.message, 'error'); return UI.editAccount(a, v); }); // reopen with what was typed
    });
  };
  UI.editContact = (c, kind, pre) => {
    const b = UI.book;
    kind = c ? c.kind : kind;
    const orig = c;
    if (pre) c = Object.assign({ terms: b.company.defaultTerms, active: true }, c || {}, pre);
    return UI.modal({
      title: orig ? 'Edit ' + kind : 'New ' + kind,
      html: `<div class="form-grid">
        <label class="field span2"><span>Display name</span><input id="ct-name" value="${esc(c ? c.name : '')}" maxlength="120"></label>
        <label class="field"><span>Company</span><input id="ct-company" value="${esc(c ? c.company : '')}"></label>
        ${kind === 'customer' ? `<label class="field"><span>Job of (Customer:Job)</span><select id="ct-parent" data-testid="ct-parent"><option value="">— Not a job —</option>${b.contacts.filter((x) => x.kind === 'customer' && x.active && (!c || x.id !== c.id)).sort((x, y) => b.contactLabel(x.id).localeCompare(b.contactLabel(y.id))).map((x) => `<option value="${esc(x.id)}"${c && c.parentId === x.id ? ' selected' : ''}>${esc(b.contactLabel(x.id))}</option>`).join('')}</select></label>
        ${(b.company.priceLevels || []).length ? `<label class="field"><span>Price level</span><select id="ct-pricelevel" data-testid="ct-pricelevel"><option value="">Standard prices</option>${b.company.priceLevels.map((p) => `<option value="${esc(p.id)}"${c && c.priceLevelId === p.id ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>` : ''}
        <label class="field"><span>Job status</span><select id="ct-jobstatus">${['', 'pending', 'awarded', 'in progress', 'closed', 'not awarded'].map((x) => `<option value="${x}"${c && c.jobStatus === x ? ' selected' : ''}>${x ? x.charAt(0).toUpperCase() + x.slice(1) : '—'}</option>`).join('')}</select></label>` : ''}
        <label class="field"><span>Email</span><input id="ct-email" type="email" value="${esc(c ? c.email : '')}"></label>
        <label class="field"><span>Phone</span><input id="ct-phone" value="${esc(c ? c.phone : '')}"></label>
        <label class="field"><span>Payment terms (days)</span><input id="ct-terms" type="number" min="0" max="365" value="${esc(c ? c.terms : b.company.defaultTerms)}"></label>
        <label class="field"><span>Early-payment discount</span><span class="inline-pair"><input id="ct-discpct" type="number" min="0" max="99" step="0.01" aria-label="Discount percent" placeholder="%" value="${esc(c && c.discountPct ? c.discountPct : '')}"> % if paid within <input id="ct-discdays" type="number" min="0" max="365" aria-label="Discount days" placeholder="days" value="${esc(c && c.discountPct ? c.discountDays : '')}"> days</span></label>
        <label class="field span2"><span>Address</span><textarea id="ct-address" rows="2">${esc(c ? c.address : '')}</textarea></label>
        ${kind === 'customer' && (UI.book.company.salesTaxes || []).length ? `<label class="field"><span>Sales tax rate</span><select id="ct-salestax" data-testid="ct-salestax"><option value="">Company default</option>${UI.book.company.salesTaxes.filter((x) => x.active !== false || (c && c.salesTaxId === x.id)).map((x) => `<option value="${esc(x.id)}"${c && c.salesTaxId === x.id ? ' selected' : ''}>${esc(x.name)} (${esc(OB.Book.fmtRate(x.rate))})</option>`).join('')}</select></label><label class="check"><input type="checkbox" id="ct-taxexempt" data-testid="ct-taxexempt" ${c && c.taxExempt ? 'checked' : ''}> Tax-exempt (resale, nonprofit, government)</label>
        <label class="field"><span>Exemption certificate no.</span><input id="ct-certno" value="${esc(c && c.exemptCert ? c.exemptCert.number : '')}" data-testid="ct-certno"></label>
        <label class="field"><span>Certificate state · reason · expires</span><span class="row-inputs"><input id="ct-certstate" maxlength="2" size="3" value="${esc(c && c.exemptCert ? c.exemptCert.state : '')}" aria-label="State"><select id="ct-certreason" aria-label="Reason">${['', 'resale', 'nonprofit', 'government', 'other'].map((r) => `<option value="${r}"${c && c.exemptCert && c.exemptCert.reason === r ? ' selected' : ''}>${r || '—'}</option>`).join('')}</select><input type="date" id="ct-certexp" value="${esc(c && c.exemptCert ? c.exemptCert.expires : '')}" aria-label="Expires"></span></label>` : ''}
        ${kind === 'vendor' && UI.book.feature('1099') ? `<label class="field"><span>Tax ID (EIN/SSN)</span><input id="ct-taxid" value="${esc(c ? c.taxId : '')}"></label><label class="check"><input type="checkbox" id="ct-1099" ${c && c.is1099 ? 'checked' : ''}> Track for 1099</label>` : ''}
        <label class="field span2"><span>Notes</span><textarea id="ct-notes" rows="2">${esc(c ? c.notes : '')}</textarea></label>
        <details class="span2 ct-more"${c && ['contactName', 'altPhone', 'fax', 'website', 'shipAddress', 'accountNo', 'creditLimit', 'paymentTerms'].some((k) => c[k]) ? ' open' : ''}><summary>More details</summary><div class="form-grid">
          <label class="field"><span>Contact person</span><input id="ct-contactName" maxlength="120" value="${esc(c ? c.contactName || '' : '')}"></label>
          <label class="field"><span>Alternate phone</span><input id="ct-altPhone" value="${esc(c ? c.altPhone || '' : '')}"></label>
          <label class="field"><span>Fax</span><input id="ct-fax" value="${esc(c ? c.fax || '' : '')}"></label>
          <label class="field"><span>Website</span><input id="ct-website" value="${esc(c ? c.website || '' : '')}"></label>
          <label class="field"><span>Account no.</span><input id="ct-accountNo" value="${esc(c ? c.accountNo || '' : '')}"></label>
          <label class="field"><span>Credit limit</span><input id="ct-creditLimit" inputmode="decimal" value="${esc(c ? c.creditLimit || '' : '')}"></label>
          <label class="field span2"><span>Terms name (as shown on documents)</span><input id="ct-paymentTerms" maxlength="60" placeholder="e.g. Net 30" value="${esc(c ? c.paymentTerms || '' : '')}"></label>
          <label class="field span2"><span>${kind === 'customer' ? 'Shipping address' : 'Ship-from / remit-to address'}</span><textarea id="ct-shipAddress" rows="2">${esc(c ? c.shipAddress || '' : '')}</textarea></label>
        </div></details>
        ${orig ? `<label class="check span2"><input type="checkbox" id="ct-active" ${c.active ? 'checked' : ''}> Active</label>` : ''}</div>`,
      onMount: (m) => { const nm = m.querySelector('#ct-name'); nm.focus(); nm.setSelectionRange(nm.value.length, nm.value.length); },
      actions: [{ label: 'Cancel', value: null }, {
        label: 'Save ' + kind, primary: true, collect: (m) => {
          const g = (id) => { const x = m.querySelector(id); return x ? (x.type === 'checkbox' ? x.checked : x.value) : undefined; };
          return { id: orig ? orig.id : '', kind, name: g('#ct-name'), company: g('#ct-company'), email: g('#ct-email'), phone: g('#ct-phone'), terms: g('#ct-terms'), discountPct: g('#ct-discpct') || 0, discountDays: g('#ct-discdays') || 0, address: g('#ct-address'), notes: g('#ct-notes'), contactName: g('#ct-contactName'), altPhone: g('#ct-altPhone'), fax: g('#ct-fax'), website: g('#ct-website'), accountNo: g('#ct-accountNo'), creditLimit: g('#ct-creditLimit'), paymentTerms: g('#ct-paymentTerms'), shipAddress: g('#ct-shipAddress'), taxId: g('#ct-taxid') !== undefined ? g('#ct-taxid') : (orig ? orig.taxId : ''), is1099: g('#ct-1099') !== undefined ? g('#ct-1099') : !!(orig && orig.is1099), taxExempt: g('#ct-taxexempt'), salesTaxId: g('#ct-salestax'), parentId: g('#ct-parent'), jobStatus: g('#ct-jobstatus'), priceLevelId: g('#ct-pricelevel'), exemptCert: g('#ct-certno') !== undefined ? { number: g('#ct-certno'), state: g('#ct-certstate'), reason: g('#ct-certreason'), expires: g('#ct-certexp') } : undefined, active: orig ? g('#ct-active') : undefined };
        }
      }]
    }).then((v) => v ? b.saveContact(v).then((saved) => { UI.toast((kind === 'customer' ? 'Customer “' : 'Vendor “') + saved.name + '” saved.'); return saved; },
      (e) => { UI.toast(e.message, 'error'); return UI.editContact(orig, kind, v); }) : null).catch((e) => { UI.error(e); return null; });
  };

  function openingBalance(a) {
    const b = UI.book;
    UI.modal({
      title: 'Opening balance — ' + a.name,
      html: `<p>Posts a journal entry between <strong>${esc(a.name)}</strong> and <em>Opening Balance Equity</em>. Use the balance from your statement on the day before you start bookkeeping.</p>
        <div class="form-grid"><label class="field"><span>As of date</span><input type="date" id="ob-date" value="${U.addDays(U.fiscalYearStart(U.today(), b.company.fiscalYearStartMonth), -1)}"></label>
        <label class="field"><span>Balance ${a.type === 'cc' || S.TYPE[a.type].cls === 'liability' ? '(amount owed)' : ''}</span><input id="ob-amt" inputmode="decimal" placeholder="0.00"></label></div>`,
      actions: [{ label: 'Cancel', value: null }, { label: 'Post opening balance', primary: true, collect: (m) => ({ date: m.querySelector('#ob-date').value, amt: m.querySelector('#ob-amt').value }) }]
    }).then((v) => {
      if (!v) return;
      return b.setOpeningBalance(a.id, v.date, U.toCents(v.amt)).then(() => { UI.toast('Opening balance posted.'); UI.render(); });
    }).catch(UI.error);
  }

  /* =============== Account register =============== */
  routes.register = (el, r) => {
    const b = UI.book, a = b.accById[r.id];
    if (!a) { el.innerHTML = UI.page('Account not found', '', UI.empty('This account does not exist.')); return; }
    const page = +r.params.page || 0, size = 100;
    const reg = b.register(a.id, r.params.from, r.params.to);
    const q = (r.params.q || '').toLowerCase();
    let rows = reg.rows.slice().reverse();
    if (q) rows = rows.filter((x) => (x.t.number + ' ' + x.t.memo + ' ' + x.s.memo + ' ' + UI.contactName(x.s.contactId || x.t.contactId) + ' ' + U.fmtPlain(Math.abs(x.amount))).toLowerCase().indexOf(q) >= 0);
    const isBank = a.type === 'bank' || a.type === 'cc';
    let cols = b.normalSign(a) > 0 ? ['Debit (increase)', 'Credit (decrease)'] : ['Debit (decrease)', 'Credit (increase)'];
    if (a.type === 'bank') cols = ['Deposit', 'Payment'];
    if (a.type === 'cc') cols = ['Payment', 'Charge'];
    const shown = rows.slice(page * size, page * size + size);
    el.innerHTML = UI.page(b.accountLabel(a.id), `
      ${isBank ? `<a class="btn" href="#/reconcile?account=${esc(a.id)}">Reconcile</a><a class="btn" href="#/bankfeed?account=${esc(a.id)}">Bank feed</a>` : ''}
      <a class="btn" href="#/paste?account=${esc(a.id)}" data-testid="reg-paste">Paste entries</a>${UI.columnsButton('list:register')}<button class="btn" id="reg-export">Export</button>`, `
      <div class="summary-strip"><div><span>${S.isBS(a.type) ? 'Balance' : 'All-time total'}</span><b>${UI.money(b.accountBalance(a.id), { symbol: true })}</b></div>
      ${isBank ? `<div><span>Reconciled balance</span><b>${UI.money(b.reconciledBalance(a.id), { symbol: true })}</b></div>` : ''}
      <div><span>Type</span><b class="plain">${esc(S.TYPE[a.type].label)}</b></div></div>
      <div class="toolbar">
        <input type="search" id="reg-q" placeholder="Search memo, payee, number or amount" value="${esc(r.params.q || '')}" aria-label="Search register">
        <label>From <input type="date" id="reg-from" value="${esc(r.params.from || '')}"></label>
        <label>To <input type="date" id="reg-to" value="${esc(r.params.to || '')}"></label>
        <button class="btn small" id="reg-apply">Apply</button>
      </div>
      ${shown.length ? `<table class="data"><thead><tr><th>Date</th><th>Type</th><th>No.</th><th>Payee / name</th><th>Account (other side)</th><th>Memo</th><th class="num">${cols[0]}</th><th class="num">${cols[1]}</th><th data-col="Cleared" title="Cleared status"><span aria-hidden="true">✓</span><span class="sr-only">Cleared</span></th><th class="num">Balance</th></tr></thead><tbody>
      ${shown.map((x) => `<tr class="click${x.t.status === 'void' ? ' inactive' : ''}" data-href="#/txn/${esc(x.t.id)}"><td>${UI.date(x.t.date)}</td><td>${esc(UI.typeLabel(x.t.type))}</td><td>${esc(x.t.number)}</td>
        <td>${esc(UI.contactName(x.s.contactId || x.t.contactId))}</td><td class="memo">${esc(b.splitCounterpart(x.t, x.i))}</td><td class="memo">${esc(x.s.memo || x.t.memo)}</td>
        <td class="num">${x.amount > 0 ? UI.money(x.amount) : ''}</td><td class="num">${x.amount < 0 ? UI.money(-x.amount) : ''}</td>
        <td class="cleared">${x.s.cleared === 'R' ? '<span title="Reconciled">R</span>' : x.s.cleared === 'C' ? '<span title="Cleared">C</span>' : ''}</td><td class="num">${UI.money(x.balance)}</td></tr>`).join('')}
      </tbody></table>${UI.pager(rows.length, page, size, (p) => UI.go('#/register/' + a.id + '?' + UI.qs(Object.assign({}, r.params, { page: p }))))}`
        : UI.empty('No transactions in this account' + (q || r.params.from ? ' match the filters.' : ' yet.'))}`);
    UI.fillLayout(el, 'table.data', 'list:register', 1);
    UI.bindRowLinks(el);
    const apply = () => UI.go('#/register/' + a.id + '?' + UI.qs({ q: el.querySelector('#reg-q').value, from: el.querySelector('#reg-from').value, to: el.querySelector('#reg-to').value }));
    el.querySelector('#reg-apply').addEventListener('click', apply);
    el.querySelector('#reg-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') apply(); });
    el.querySelector('#reg-export').addEventListener('click', () => {
      const m = [['Date', 'Type', 'No.', 'Name', 'Other account', 'Memo', 'Debit', 'Credit', 'Cleared', 'Balance']];
      reg.rows.forEach((x) => m.push([U.fmtDate(x.t.date), UI.typeLabel(x.t.type), x.t.number, UI.contactName(x.s.contactId || x.t.contactId), b.splitCounterpart(x.t, x.i), x.s.memo || x.t.memo, x.amount > 0 ? UI.m(x.amount) : '', x.amount < 0 ? UI.m(-x.amount) : '', x.s.cleared, UI.m(x.balance)]));
      UI.exportMatrix('Register_' + a.name, m, 'xlsx');
    });
  };

  /* =============== Customers & vendors =============== */
  const contactList = (kind) => (el, r) => {
    const b = UI.book, title = kind === 'customer' ? 'Customers' : 'Vendors', base = kind === 'customer' ? 'customers' : 'vendors';
    const q = (r.params.q || '').toLowerCase();
    const list = b.contacts.filter((c) => c.kind === kind && (r.params.inactive === '1' || c.active) && (!q || (c.name + ' ' + c.company + ' ' + c.email + ' ' + c.phone).toLowerCase().indexOf(q) >= 0))
      .sort((x, y) => b.contactLabel(x.id).localeCompare(b.contactLabel(y.id)));
    const total = U.sum(list, (c) => b.contactBalance(c.id));
    const has = { company: list.some((c) => c.company), email: list.some((c) => c.email), phone: list.some((c) => c.phone) };   // a column nobody filled is not shown
    el.innerHTML = UI.page(title, `
      <button class="btn" id="c-export">Export CSV</button>
      <label class="btn">Import CSV<input type="file" id="c-import" accept=".csv" hidden></label>
      <a class="btn" href="#/txn/new?type=${kind === 'customer' ? 'invoice' : 'bill'}">${kind === 'customer' ? 'New invoice' : 'New bill'}</a>
      <button class="btn primary" id="c-new">+ New ${kind}</button>`, `
      <div class="toolbar"><input type="search" id="c-q" placeholder="Search ${title.toLowerCase()}" value="${esc(r.params.q || '')}" aria-label="Search ${title.toLowerCase()}">
      <label class="check"><input type="checkbox" id="c-inactive" ${r.params.inactive === '1' ? 'checked' : ''}> Show inactive</label>
      <span class="muted">Total open balance: ${UI.money(total, { symbol: true })}</span></div>
      ${list.length ? `<table class="data"><thead><tr><th>Name</th>${has.company ? '<th>Company</th>' : ''}${has.email ? '<th>Email</th>' : ''}${has.phone ? '<th>Phone</th>' : ''}<th class="num">Open balance</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>
      ${list.map((c) => `<tr class="click${c.active ? '' : ' inactive'}" data-href="#/contact/${esc(c.id)}"><td class="${c.parentId ? 'job-name' : ''}"><a href="#/contact/${esc(c.id)}">${esc(c.parentId ? '↳ ' + b.contactLabel(c.id) : c.name)}</a>${c.jobStatus ? ` <span class="badge">${esc(c.jobStatus)}</span>` : ''}</td>${has.company ? `<td>${esc(c.company)}</td>` : ''}${has.email ? `<td>${esc(c.email)}</td>` : ''}${has.phone ? `<td>${esc(c.phone)}</td>` : ''}<td class="num">${UI.money(b.contactBalance(c.id))}</td>
        <td class="actions-cell">${b.contactBalance(c.id) > 0 ? `<a class="btn ghost small" href="#/txn/new?type=${kind === 'customer' ? 'payment' : 'billPayment'}&contact=${esc(c.id)}">${kind === 'customer' ? 'Receive payment' : 'Pay'}</a>` : ''}</td></tr>`).join('')}
      </tbody></table>` : UI.empty(q ? 'No ' + title.toLowerCase() + ' match your search.' : 'No ' + title.toLowerCase() + ' yet.', `<button class="btn primary" id="c-new2">+ New ${kind}</button>`)}`);
    UI.fillLayout(el, 'table.data', 'list:' + kind, 1);
    UI.bindRowLinks(el);
    const nb = () => UI.editContact(null, kind).then((c) => { if (c) UI.go('#/contact/' + c.id); });
    el.querySelector('#c-new').addEventListener('click', nb);
    if (el.querySelector('#c-new2')) el.querySelector('#c-new2').addEventListener('click', nb);
    let t;
    el.querySelector('#c-q').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => UI.go('#/' + base + '?' + UI.qs({ q: e.target.value, inactive: r.params.inactive })), 300); });
    el.querySelector('#c-inactive').addEventListener('change', (e) => UI.go('#/' + base + '?' + UI.qs({ q: r.params.q, inactive: e.target.checked ? 1 : '' })));
    el.querySelector('#c-export').addEventListener('click', () => UI.exportMatrix(title, [['Name', 'Company', 'Email', 'Phone', 'Address', 'Terms', 'Active', 'Open balance']].concat(
      b.contacts.filter((c) => c.kind === kind).map((c) => [c.name, c.company, c.email, c.phone, c.address, c.terms, c.active ? 'Yes' : 'No', UI.m(b.contactBalance(c.id))])), 'csv'));
    el.querySelector('#c-import').addEventListener('change', (e) => importCSVFile(e.target.files[0], (table) => {
      const res = OB.importer.contactsFromCSV(table, kind);
      return importItems(res, (it) => b.saveContact(it), title.toLowerCase()).then(() => UI.render());
    }));
  };
  routes.customers = contactList('customer');
  routes.vendors = contactList('vendor');

  routes.contact = (el, r) => {
    const b = UI.book, c = b.contactById[r.id];
    if (!c) { el.innerHTML = UI.page('Not found', '', UI.empty('This customer or vendor does not exist.')); return; }
    const txns = R.transactionList(b, { contactId: c.id, status: 'all' });
    const isC = c.kind === 'customer';
    const open = txns.filter((t) => t.status === 'posted' && (t.type === 'invoice' || t.type === 'bill') && b.openBalance(t) > 0);
    const overdue = open.filter((t) => t.dueDate && t.dueDate < U.today());
    const tab = ['statements', 'details', 'notes'].indexOf(r.params.tab) >= 0 ? r.params.tab : 'transactions';
    const hubTabs = `<nav class="bf-tabs ct-tabs" role="tablist" aria-label="${esc(c.name)}" data-testid="ct-tabs">${[['transactions', 'Transactions', txns.length], ['statements', isC ? 'Statements' : 'Open bills', open.length], ['details', 'Details'], ['notes', 'Notes', c.notes ? '•' : '']]
      .map(([k, l, n]) => `<a role="tab" href="#/contact/${esc(c.id)}${k === 'transactions' ? '' : '?tab=' + k}" aria-selected="${tab === k}" data-testid="ct-tab-${k}">${esc(l)}${n ? ` <span class="bf-count">${esc(String(n))}</span>` : ''}</a>`).join('')}</nav>`;
    el.innerHTML = UI.page(b.contactLabel(c.id), `
      <button class="btn" id="ct-edit">Edit</button>
      ${isC ? `<button class="btn" id="ct-job" data-testid="new-job">+ New job</button><button class="btn" id="ct-dep" data-testid="receive-deposit">Receive deposit</button>${b.depositsHeld(c.id, true) > 0 ? '<button class="btn" id="ct-rdep" data-testid="refund-deposit">Refund deposit</button>' : ''}` : ''}
      ${isC ? `<a class="btn" href="#/statement/${esc(c.id)}">Statement</a><a class="btn" href="#/txn/new?type=invoice&contact=${esc(c.id)}">New invoice</a><a class="btn primary" href="#/txn/new?type=payment&contact=${esc(c.id)}">Receive payment</a>`
        : `<a class="btn" href="#/txn/new?type=bill&contact=${esc(c.id)}">New bill</a><a class="btn primary" href="#/txn/new?type=billPayment&contact=${esc(c.id)}">Pay bills</a>`}`, `
      <div class="summary-strip">
        <div><span>Open balance</span><b>${UI.money(b.contactBalance(c.id), { symbol: true })}</b></div>
        <div><span>Overdue</span><b>${UI.money(U.sum(overdue, (t) => b.openBalance(t)), { symbol: true })}</b></div>
        <div><span>Contact</span><b class="plain">${esc([c.email, c.phone].filter(Boolean).join(' · ') || '—')}</b></div>
        <div><span>Terms</span><b class="plain">${c.discountPct ? esc(c.discountPct + '% ' + c.discountDays + ' ') : ''}Net ${esc(c.terms)}</b></div>
        ${isC && b.depositsHeld && b.depositsHeld(c.id, true) ? `<div><span>Deposits held</span><b data-testid="deposits-held">${UI.money(b.depositsHeld(c.id, true), { symbol: true })}</b></div>` : ''}
      </div>
      ${c.address ? `<p class="muted">${esc(c.address)}</p>` : ''}
      ${isC && c.taxExempt ? (c.exemptCert && c.exemptCert.number ? `<div class="banner ${c.exemptCert.expires && c.exemptCert.expires < U.today() ? 'warn' : 'info'}" data-testid="cert">Tax-exempt — certificate ${esc(c.exemptCert.number)}${c.exemptCert.state ? ' (' + esc(c.exemptCert.state) + ')' : ''}${c.exemptCert.reason ? ', ' + esc(c.exemptCert.reason) : ''}${c.exemptCert.expires ? (c.exemptCert.expires < U.today() ? ' — <strong>expired ' + UI.date(c.exemptCert.expires) + '</strong>' : ', expires ' + UI.date(c.exemptCert.expires)) : ''}. Attach a copy below.</div>` : '<div class="banner warn" data-testid="cert">Tax-exempt with no exemption certificate on file. Edit the customer to record it and attach a copy below.</div>') : ''}
      ${hubTabs}
      ${tab === 'statements' ? hubStatements(b, c, open) : tab === 'details' ? hubDetails(b, c) : tab === 'notes' ? `<form class="ct-notes" id="ct-notes"><label class="field"><span>Notes about ${esc(c.name)} (only you see these)</span><textarea name="notes" rows="8" maxlength="4000" data-testid="ct-notes">${esc(c.notes || '')}</textarea></label><div class="form-actions"><button class="btn primary" type="submit">Save notes</button></div></form>`
        : txns.length ? `<table class="data"><thead><tr><th>Date</th><th>Type</th><th>No.</th><th>Due</th><th>Memo</th><th class="num">Total</th><th class="num">Open</th><th>Status</th></tr></thead><tbody>
        ${txns.map((t) => `<tr class="click${t.status === 'void' ? ' inactive' : ''}" data-href="#/txn/${esc(t.id)}"><td>${UI.date(t.date)}</td><td>${esc(UI.typeLabel(t.type))}</td><td>${esc(t.number)}</td><td>${UI.date(t.dueDate || '')}</td><td class="memo">${esc(t.memo)}</td>
          <td class="num">${UI.money(t.total)}</td><td class="num">${t.status === 'posted' && (S.TXN_TYPES[t.type].applies || t.type === 'invoice' || t.type === 'bill') ? UI.money(b.openBalance(t), { blankZero: true }) : ''}</td><td>${UI.statusBadge(t)}</td></tr>`).join('')}
      </tbody></table>` : UI.empty('No transactions with ' + esc(c.name) + ' yet.')}`);
    UI.bindRowLinks(el);
    el.querySelector('#ct-edit').addEventListener('click', () => UI.editContact(c).then((x) => { if (x) UI.render(); }));
    el.querySelectorAll('[data-ct-edit]').forEach((x) => x.addEventListener('click', () => el.querySelector('#ct-edit').click()));
    const nf = el.querySelector('#ct-notes');
    if (nf) nf.addEventListener('submit', (e) => { e.preventDefault(); const btn = nf.querySelector('[type=submit]'); UI.busy(btn, () => b.saveContact(Object.assign({}, c, { notes: nf.elements.notes.value.trim() }))).then(() => { UI.toast('Notes saved.'); UI.render(); }, UI.error); });
    const sf = el.querySelector('#ct-stmt');
    if (sf) sf.addEventListener('submit', (e) => { e.preventDefault(); UI.go('#/statement/' + c.id + '?' + UI.qs({ from: sf.elements.from.value, to: sf.elements.to.value })); });
    if (UI.attachCard) UI.attachCard(el.querySelector('.page'), c.id); // W-9s, exemption certificates, contracts
    const nd = el.querySelector('#ct-dep'); if (nd) nd.addEventListener('click', () => UI.receiveDeposit(c.id));
    const rd = el.querySelector('#ct-rdep'); if (rd) rd.addEventListener('click', () => UI.refundDeposit(c.id));
    const nj = el.querySelector('#ct-job'); if (nj) nj.addEventListener('click', () => UI.editContact(null, 'customer', { name: '', parentId: c.id, terms: c.terms, address: c.address }).then((j) => { if (j) UI.go('#/contact/' + j.id); }));
  };

  /* customer / vendor hub tabs (1.26) */
  function hubStatements(b, c, open) {
    const list = open.length ? `<table class="data"><thead><tr><th>Date</th><th>Type</th><th>No.</th><th>Due</th><th class="num">Open</th></tr></thead><tbody>${open.map((t) => `<tr class="click" data-href="#/txn/${esc(t.id)}"><td>${UI.date(t.date)}</td><td>${esc(UI.typeLabel(t.type))}</td><td>${esc(t.number)}</td><td>${UI.date(t.dueDate || '')}${t.dueDate && t.dueDate < U.today() ? ' <span class="badge warn">Overdue</span>' : ''}</td><td class="num">${UI.money(b.openBalance(t))}</td></tr>`).join('')}</tbody></table>`
      : `<p class="muted">Nothing open with ${esc(c.name)}.</p>`;
    if (c.kind !== 'customer') return `<h2 class="h3">Open bills</h2>${list}<p><a href="#/report/apaging">A/P aging report</a></p>`;
    const to = U.today(), from = U.addMonths(U.monthStart(to), -2);
    return `<form class="row gap wrap ct-stmt" id="ct-stmt" data-testid="ct-stmt"><label class="field"><span>From</span><input type="date" name="from" value="${esc(from)}"></label><label class="field"><span>To</span><input type="date" name="to" value="${esc(to)}"></label>
      <button class="btn primary" type="submit">Create statement</button><a class="btn" href="#/statement/${esc(c.id)}">Last 3 months</a></form>
      <p class="muted small">The statement opens ready to print or save as PDF.</p><h2 class="h3">Open invoices</h2>${list}`;
  }
  function hubDetails(b, c) {
    const pl = (b.company.priceLevels || []).find((x) => x.id === c.priceLevelId);
    const rows = [['Name', b.contactLabel(c.id)], ['Company', c.company], ['Email', c.email], ['Phone', c.phone], ['Address', c.address], ['Terms', 'Net ' + c.terms + (c.discountPct ? ', ' + c.discountPct + '% if paid in ' + c.discountDays + ' days' : '')],
      c.kind === 'vendor' ? ['1099 vendor', c.is1099 ? 'Yes' + (c.w9OnFile ? ', W-9 on file' : ', no W-9 yet') : 'No'] : ['Sales tax', c.taxExempt ? 'Exempt' : 'Taxable'],
      ['Tax ID', c.taxId ? '•••• ' + String(c.taxId).slice(-4) : ''], pl ? ['Price level', pl.name] : null, ['Status', c.active === false ? 'Inactive' : 'Active']].filter((x) => x && x[1]);
    return `<dl class="ct-details" data-testid="ct-details">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(String(v)).replace(/\n/g, '<br>')}</dd>`).join('')}</dl><p><button type="button" class="btn" data-ct-edit>Edit details</button></p>`;
  }

  /* Customer statement (printable) */
  routes.statement = (el, r) => {
    const b = UI.book, c = b.contactById[r.id];
    if (!c) return;
    const to = r.params.to || U.today(), from = r.params.from || U.addMonths(U.monthStart(to), -2);
    const ar = b.sys('AR').id;
    const opening = b.contactBalance(c.id, U.addDays(from, -1));
    let bal = opening;
    const rows = (b.splitIndex()[ar] || []).filter((e) => e.s.contactId === c.id && e.t.date >= from && e.t.date <= to).map((e) => { bal += e.s.amount; return { t: e.t, amt: e.s.amount, bal }; });
    const co = b.company;
    el.innerHTML = `<div class="page"><div class="page-head no-print"><div><h1>Statement</h1></div><div class="actions">
      <label>From <input type="date" id="st-from" value="${from}"></label><label>To <input type="date" id="st-to" value="${to}"></label>
      <button class="btn" id="st-run">Update</button><button class="btn primary" data-print data-key="p">Print / Save as PDF</button></div></div>
      <article class="doc">
        <header class="doc-head"><div><h2>${esc(co.name)}</h2><p>${esc(co.address).replace(/\n/g, '<br>')}</p><p>${esc([co.phone, co.email].filter(Boolean).join(' · '))}</p></div>
        <div class="doc-title"><h1>Statement</h1><p>${U.fmtDate(from)} – ${U.fmtDate(to)}</p></div></header>
        <div class="doc-to"><span class="muted">To</span><strong>${esc(c.name)}</strong><p>${esc(c.address).replace(/\n/g, '<br>')}</p></div>
        <table class="data doc-lines"><thead><tr><th>Date</th><th>Activity</th><th class="num">Amount</th><th class="num">Balance</th></tr></thead><tbody>
        <tr><td>${U.fmtDate(from)}</td><td>Balance forward</td><td></td><td class="num">${UI.money(opening)}</td></tr>
        ${rows.map((x) => `<tr><td>${UI.date(x.t.date)}</td><td>${esc(UI.typeLabel(x.t.type) + (x.t.number ? ' #' + x.t.number : ''))}${x.t.dueDate ? ' — due ' + U.fmtDate(x.t.dueDate) : ''}</td><td class="num">${UI.money(x.amt)}</td><td class="num">${UI.money(x.bal)}</td></tr>`).join('')}
        </tbody><tfoot><tr><td colspan="3">Amount due</td><td class="num">${UI.money(bal, { symbol: true })}</td></tr></tfoot></table>
      </article></div>`;
    el.querySelector('#st-run').addEventListener('click', () => UI.go('#/statement/' + c.id + '?' + UI.qs({ from: el.querySelector('#st-from').value, to: el.querySelector('#st-to').value })));
  };

  /* =============== Transactions list =============== */
  routes.transactions = (el, r) => {
    const b = UI.book, p = r.params;
    const range = p.range || (UI.period() ? 'period' : 'all');
    const rg = UI.ranges()[range];
    const from = range === 'custom' ? p.from : rg ? rg[1] : '', to = range === 'custom' ? p.to : rg ? rg[2] : '';
    const list = R.transactionList(b, { from, to, type: p.type, contactId: p.contact, accountId: p.account, search: p.q, status: p.status || 'posted' });
    const page = +p.page || 0, size = 100;
    const shown = list.slice(page * size, page * size + size);
    const listTitle = p.type && S.TXN_TYPES[p.type] ? (S.TXN_TYPES[p.type].plural || S.TXN_TYPES[p.type].label + 's') : 'Transactions';   // the Invoices menu item opens "Invoices"
    el.innerHTML = UI.page(listTitle, `${UI.columnsButton('list:transactions')}<button class="btn" id="tx-export">Export</button><button class="btn" id="tx-iif" data-testid="iif-export">Export invoices to QuickBooks (.iif)</button><button class="btn primary" id="tx-new">+ New transaction</button>`, `
      <div class="toolbar wrap">
        <input type="search" id="tx-q" placeholder="Search number, memo, name, amount" value="${esc(p.q || '')}" aria-label="Search transactions">
        <select id="tx-type" aria-label="Transaction type"><option value="">All types</option>${Object.keys(S.TXN_TYPES).map((k) => `<option value="${k}"${p.type === k ? ' selected' : ''}>${esc(S.TXN_TYPES[k].label)}</option>`).join('')}</select>
        ${UI.rangeSelect('tx-range', range)}
        <span id="tx-custom" ${range === 'custom' ? '' : 'hidden'}><input type="date" id="tx-from" aria-label="From date" value="${esc(p.from || '')}"> – <input type="date" id="tx-to" aria-label="To date" value="${esc(p.to || '')}"></span>
        ${UI.comboHtml('account', 'any', p.account, 'id="tx-account"', { placeholder: 'All accounts', label: 'Account' })}
        <select id="tx-status" aria-label="Status"><option value="posted">Posted</option><option value="void"${p.status === 'void' ? ' selected' : ''}>Voided</option><option value="all"${p.status === 'all' ? ' selected' : ''}>All</option></select>
        <button class="btn small" id="tx-apply">Apply</button>
      </div>
      ${shown.length ? `<table class="data"><thead><tr><th>Date</th><th>Type</th><th>No.</th><th>Name</th><th>Memo</th><th class="num">Amount</th><th>Status</th></tr></thead><tbody>
      ${shown.map((t) => `<tr class="click${t.status === 'void' ? ' inactive' : ''}" data-href="#/txn/${esc(t.id)}"><td>${UI.date(t.date)}</td><td>${esc(UI.typeLabel(t.type))}</td><td>${esc(t.number)}</td><td>${esc(UI.contactName(t.contactId))}</td><td class="memo">${esc(t.memo)}</td><td class="num">${UI.money(t.total)}</td><td>${UI.statusBadge(t)}</td></tr>`).join('')}
      </tbody></table>${UI.pager(list.length, page, size, (pg) => UI.go('#/transactions?' + UI.qs(Object.assign({}, p, { page: pg }))))}` : UI.empty(b.transactions.length ? 'No transactions match these filters.' : 'No transactions yet. Create an invoice, record an expense, or bring in your bank transactions to get started.')}`);
    UI.fillLayout(el, 'table.data', 'list:transactions', 1);
    UI.bindRowLinks(el);
    el.querySelector('#tx-new').addEventListener('click', UI.newMenu);
    el.querySelector('#tx-range').addEventListener('change', (e) => { el.querySelector('#tx-custom').hidden = e.target.value !== 'custom'; });
    const apply = () => UI.go('#/transactions?' + UI.qs({ q: el.querySelector('#tx-q').value, type: el.querySelector('#tx-type').value, range: el.querySelector('#tx-range').value, from: el.querySelector('#tx-from').value, to: el.querySelector('#tx-to').value, account: el.querySelector('#tx-account').value, status: el.querySelector('#tx-status').value, contact: p.contact }));
    el.querySelector('#tx-apply').addEventListener('click', apply);
    el.querySelector('#tx-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') apply(); });
    el.querySelector('#tx-iif').addEventListener('click', () => UI.exportInvoicesIif());
    el.querySelector('#tx-export').addEventListener('click', () => {
      // journal-line export: one row per split, so it re-totals to the ledger
      const m = [['Transaction ID', 'Date', 'Type', 'No.', 'Status', 'Name', 'Memo', 'Account', 'Debit', 'Credit', 'Line memo']];
      list.forEach((t) => t.splits.forEach((s) => m.push([t.id, t.date, UI.typeLabel(t.type), t.number, t.status, UI.contactName(s.contactId || t.contactId), t.memo, b.accountLabel(s.accountId), s.amount > 0 ? UI.m(s.amount) : '', s.amount < 0 ? UI.m(-s.amount) : '', s.memo])));
      UI.modal({ title: 'Export transactions', html: `<p>${list.length} transactions (${m.length - 1} journal lines) matching the current filters.</p>`, actions: [{ label: 'Cancel', value: null }, { label: 'CSV', value: 'csv' }, { label: 'Excel (.xlsx)', value: 'xlsx', primary: true }] })
        .then((f) => { if (f) UI.exportMatrix('Transactions', m, f); });
    });
  };

  /* ---------- export selected invoices to QuickBooks Desktop (.iif) ---------- */
  document.addEventListener('click', (e) => { const x = e.target.closest && e.target.closest('#tx-iif-one'); if (x) UI.exportInvoicesIif([x.dataset.id]); });
  UI.exportInvoicesIif = (preselect) => {
    const b = UI.book, fy = UI.ranges().thisFY, picked = {};
    (preselect || []).forEach((id) => { picked[id] = true; });
    const all = () => b.posted().filter((t) => t.type === 'invoice').sort((x, y) => -OB.Book.cmpTxn(x, y));
    const first = preselect && preselect.length ? b.txById[preselect[0]] : null;
    const st = { from: first ? first.date : fy[1], to: first ? first.date : fy[2], contact: '', open: false };
    const customers = b.contacts.filter((c) => c.kind === 'customer').sort((x, y) => x.name.localeCompare(y.name));
    const rows = () => all().filter((t) => (!st.from || t.date >= st.from) && (!st.to || t.date <= st.to) && (!st.contact || t.contactId === st.contact) && (!st.open || b.openBalance(t) > 0));
    const table = () => {
      const list = rows();
      return `<table class="data compact iif-list"><thead><tr><th><input type="checkbox" id="iif-all" aria-label="Select all shown invoices"${list.length && list.every((t) => picked[t.id]) ? ' checked' : ''}></th><th>Date</th><th>No.</th><th>Customer</th><th class="num">Total</th><th class="num">Open</th></tr></thead><tbody>
        ${list.map((t) => `<tr><td><input type="checkbox" data-iif="${esc(t.id)}" aria-label="Invoice ${esc(t.number)}"${picked[t.id] ? ' checked' : ''}></td><td>${U.fmtDate(t.date)}</td><td>${esc(t.number)}</td><td>${esc(UI.contactName(t.contactId))}</td><td class="num">${U.fmt(t.total)}</td><td class="num">${U.fmt(b.openBalance(t))}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">No invoices match.</td></tr>'}</tbody></table>`;
    };
    const summary = () => { const ids = Object.keys(picked).filter((k) => picked[k] && b.txById[k]); return `${ids.length} invoice${ids.length === 1 ? '' : 's'} selected · ${U.fmt(U.sum(ids, (k) => b.txById[k].total), { symbol: true })}`; };
    return UI.modal({
      title: 'Export invoices to QuickBooks Desktop (.iif)', wide: true,
      html: `<div class="toolbar wrap">
          <label>From <input type="date" id="iif-from" value="${esc(st.from)}"></label><label>To <input type="date" id="iif-to" value="${esc(st.to)}"></label>
          <label>Customer <select id="iif-cust"><option value="">All customers</option>${customers.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</select></label>
          <label class="check"><input type="checkbox" id="iif-open"> Open invoices only</label></div>
        <div class="iif-wrap" id="iif-table">${table()}</div>
        <p class="iif-sum" id="iif-sum" aria-live="polite">${summary()}</p>
        <label class="check"><input type="checkbox" id="iif-lists" checked> Include the accounts, customers and products/services these invoices use (QuickBooks adds any it doesn’t have)</label>
        <label class="check"><input type="checkbox" id="iif-print"> Mark as “To be printed” in QuickBooks</label>
        <p class="muted small">In QuickBooks Desktop: File › Utilities › Import › IIF Files. Make a QuickBooks backup first. Each invoice keeps its number, date, customer, lines, items, classes, due date and terms.</p>`,
      onMount: (m) => {
        const redraw = () => { m.querySelector('#iif-table').innerHTML = table(); m.querySelector('#iif-sum').textContent = summary(); };
        U.dateCommit(m.querySelector('#iif-from'), (v) => { st.from = v; }, redraw);
        U.dateCommit(m.querySelector('#iif-to'), (v) => { st.to = v; }, redraw);
        m.querySelector('#iif-cust').addEventListener('change', (e) => { st.contact = e.target.value; redraw(); });
        m.querySelector('#iif-open').addEventListener('change', (e) => { st.open = e.target.checked; redraw(); });
        m.querySelector('#iif-table').addEventListener('change', (e) => {
          if (e.target.id === 'iif-all') rows().forEach((t) => { picked[t.id] = e.target.checked; });
          else if (e.target.dataset.iif) picked[e.target.dataset.iif] = e.target.checked;
          redraw();
        });
      },
      actions: [{ label: 'Cancel', value: null }, { label: 'Download .iif', primary: true, collect: (m) => {
        const ids = Object.keys(picked).filter((k) => picked[k] && b.txById[k]);
        if (!ids.length) { UI.toast('Tick at least one invoice.', 'error'); return false; }
        return { ids, lists: m.querySelector('#iif-lists').checked, toPrint: m.querySelector('#iif-print').checked };
      } }]
    }).then((o) => {
      if (!o) return;
      const r = OB.qbexport.invoicesIIF(b, o.ids, o);
      const name = U.safeFileName(b.company.name + '_Invoices_' + U.today()) + '.iif';
      U.download(name, new Blob([OB.qbexport.toAnsi(r.text)], { type: 'text/plain' }));
      UI.toast('Exported ' + r.count + ' invoice' + (r.count === 1 ? '' : 's') + ' (' + U.fmt(r.total, { symbol: true }) + ') to ' + name + '.');
    });
  };
})();
