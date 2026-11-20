/* VaultBook — "Import from QuickBooks" (company-level migration screen).
 * Route #/migrate. Drop or choose the files QuickBooks Desktop (IIF lists, General Ledger CSV) or QuickBooks Online
 * (Journal, Trial Balance, Balance Sheet, Profit and Loss and contact lists in Excel) exports for one company; VaultBook
 * recognises each file, shows exactly what it will create, imports everything in one atomic write,
 * then proves the result against QuickBooks' own balances and (optionally) its P&L / Balance Sheet PDFs.
 * The engine is OB.qbimport (js/qbimport.js); posting goes through Book.importBundle().
 */
(function () {
  'use strict';
  const UI = OB.ui, U = OB.util, S = OB.schema, Q = OB.qbimport, esc = U.esc;
  let st = { files: [], plan: null, model: null, result: null, opening: '', obDate: '', busy: false };
  UI.migrateState = () => st;   // read-only peek for tests
  const reset = () => { st = { files: [], plan: null, model: null, result: null, opening: '', obDate: '', busy: false }; };
  UI.resetMigration = reset;
  let lastCo = null;
  let pending = null;   // files chosen before their company existed (see UI.companyFromQuickBooks)

  /** Read a File: PDFs as bytes (text extracted later), others as text (UTF-8, falling back to Windows-1252 as QuickBooks writes). */
  function readFile(f) {
    return f.arrayBuffer().then((buf) => {
      const isPdf = /\.pdf$/i.test(f.name) || new Uint8Array(buf.slice(0, 4)).join(',') === '37,80,68,70';
      if (isPdf) return { name: f.name, isPdf: true, bytes: buf, text: '' };
      const head = new Uint8Array(buf.slice(0, 8)), zip = head[0] === 0x50 && head[1] === 0x4B, ole = head[0] === 0xD0 && head[1] === 0xCF;
      if (/\.(xlsx|xlsm|xls)$/i.test(f.name) || ((zip || ole) && !/\.(iif|csv|txt)$/i.test(f.name))) return sheetFiles(f.name, buf);
      let text;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (e) { text = new TextDecoder('windows-1252').decode(buf); }
      return { name: f.name, text };
    });
  }
  /** Excel workbook → one entry per sheet that has something in it, each as rows of cells (read by the bundled SheetJS). */
  function sheetFiles(name, buf) {
    return UI.loadVendor(['sheetjs.min.js']).then(() => {
      const wb = XLSX.read(new Uint8Array(buf), { type: 'array', cellNF: true, cellFormula: true, sheetStubs: true });
      const sheets = wb.SheetNames.map((sn) => ({ sn, rows: Q.sheetRows(wb.Sheets[sn], XLSX.SSF) })).filter((x) => x.rows.length);
      if (!sheets.length) return { name, rows: [[]], text: '' };
      return sheets.map((x) => ({ name: sheets.length > 1 ? name + ' › ' + x.sn : name, rows: x.rows, text: '' }));
    }).catch((e) => ({ name, text: '', rows: [[]], readError: 'Excel file could not be read: ' + e.message }));
  }
  const readAll = (list) => Promise.all([...list].map(readFile)).then((x) => [].concat.apply([], x));
  /** PDF → text lines (pdf.js), grouping text runs by their baseline so "Account ..... 1,234.56" stays on one line. */
  UI.pdfText = (bytes) => pdfText(bytes); // shared with the Doc Center (1.49)
  function pdfText(bytes) {
    return UI.loadVendor(['pdf.min.js', 'pdf-worker-src.js']).then(async () => {
      if (!pdfjsLib.GlobalWorkerOptions.workerSrc) pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([window.__OB_PDF_WORKER_SRC__], { type: 'application/javascript' }));
      const pdf = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
      const out = [], rows = [];
      for (let p = 1; p <= pdf.numPages; p++) {
        const page = await pdf.getPage(p), c = await page.getTextContent();
        // one printed line can sit on baselines a point apart (a name and its amount in different fonts): keep runs within 2.5pt together
        const items = c.items.filter((it) => it.str.trim()).map((it) => ({ x: it.transform[4], y: it.transform[5], w: it.width, s: it.str })).sort((a, b) => b.y - a.y || a.x - b.x);
        let row = [], y0 = null;
        const flush = () => { if (row.length) { row.sort((a, b) => a.x - b.x); out.push(row.map((r) => r.s).join('  ').replace(/\s+$/, '')); rows.push({ p, items: row.map((r) => ({ x: r.x, w: r.w, s: r.s })) }); } row = []; };
        items.forEach((it) => { if (y0 !== null && y0 - it.y > 2.5) flush(); if (!row.length) y0 = it.y; row.push(it); });
        flush();
      }
      return { text: out.join('\n'), rows };
    });
  }

  function addFiles(list) {
    return readAll(list).then((files) => {
      files.forEach((f) => { st.files = st.files.filter((x) => x.name !== f.name).concat([f]); });
      return pdfTexts();
    }).then(() => { st.result = null; rebuild(); });
  }
  const pdfTexts = () => Promise.all(st.files.filter((f) => f.isPdf && f.pdfText === undefined).map((f) => pdfText(f.bytes).then((t) => { f.pdfText = t.text; f.pdfRows = t.rows; }, (e) => { f.pdfText = ''; f.pdfError = e.message; })));
  /**
   * "Create a company from QuickBooks files": read the files, name the company as the reports do (asking only when
   * they do not say), create it and open straight into the import preview with the files already loaded.
   * Nothing is posted until the user presses Import.
   */
  UI.companyFromQuickBooks = (list, already) => (already ? Promise.resolve(already) : readAll(list)).then((files) => {
    if (!files.length) return null;
    const model = Q.read(files.filter((f) => !f.isPdf));
    const known = model.files.filter((f) => f.kind !== 'unknown').length + files.filter((f) => f.isPdf).length;
    if (!known) throw new Error('None of these files is a QuickBooks export VaultBook knows. Use the connector\'s Export everything file (VaultBook-QB-full-….json), or send the Journal, Trial Balance, Balance Sheet and Profit and Loss from QuickBooks Online (Excel), or the IIF lists and General Ledger from QuickBooks Desktop.');
    const guess = model.company.name || '';
    return (guess ? Promise.resolve(guess) : UI.prompt('Create a company from QuickBooks files', 'Company name', '', { ok: 'Create company', help: 'These files do not name the company.' })).then((name) => {
      name = String(name || '').trim(); if (!name) return null;
      return OB.db.createCompany({ name: name.slice(0, 120), basis: model.company.basis === 'cash' ? 'cash' : 'accrual', fiscalYearStartMonth: 1 }).then((book) => {
        OB.db.requestPersistence(); pending = files; UI._resumeHash = '#/migrate';
        return UI.openCompany(book.company.id).then(() => book.company.name);
      });
    });
  });
  function rebuild() {
    st.plan = null; st.model = null;
    if (!st.files.length || !UI.book) return;
    const plain = st.files.filter((f) => !f.isPdf), pdfs = st.files.filter((f) => f.isPdf && f.pdfRows);
    // a General Ledger printed to PDF is read as the ledger when the other files hold no transactions (1.44)
    let pdfIn = { files: [], labels: {}, notes: [] };
    st.model = Q.read(plain);
    if (!st.model.txns.length && pdfs.some((f) => Q.pdfKind(f.pdfRows) === 'gl')) {
      pdfIn = Q.pdfInputs(pdfs.map((f) => ({ name: f.name, rows: f.pdfRows })), plain.some((f) => /^!ACCNT/m.test(f.text || '')));
      if (pdfIn.files.length) { st.model = Q.read(plain.concat(pdfIn.files)); pdfIn.notes.forEach((n) => st.model.warnings.push(n)); }
    }
    st.model.files = st.files.map((f) => f.readError ? { name: f.name, kind: 'unknown', label: f.readError } : f.isPdf ? { name: f.name, kind: 'pdf', label: f.pdfError ? 'PDF could not be read: ' + f.pdfError : pdfIn.labels[f.name] ? pdfIn.labels[f.name] : /balance sheet/i.test(f.pdfText) ? 'Balance Sheet report — used to check balances' : /profit\s*&?\s*(and\s*)?loss/i.test(f.pdfText) ? 'Profit & Loss report — used to check totals' : 'PDF (not a P&L or Balance Sheet)' } : st.model.files.find((m) => m.name === f.name));
    st.plan = Q.plan(st.model, UI.book, { openingBalances: st.opening, openingBalanceDate: st.obDate || undefined, reportTexts: st.files.filter((f) => f.isPdf && f.pdfText).map((f) => f.pdfText) });
  }

  const KIND_LABEL = { invoice: 'Invoices', payment: 'Customer payments', creditMemo: 'Credit memos', salesReceipt: 'Sales receipts', customerRefund: 'Customer refunds', bill: 'Bills', billPayment: 'Bill payments', vendorCredit: 'Vendor credits', expense: 'Expenses / card charges', check: 'Checks', ccCredit: 'Card credits', deposit: 'Deposits', transfer: 'Transfers', journal: 'Journal entries' };
  const GUIDE = `<details class="mg-guide"><summary>Which files to export from QuickBooks Online</summary><ol>
      <li><strong>Transactions</strong>: <em>Reports › Journal</em>, Report period: <strong>All Dates</strong>, then <em>Export › Export to Excel</em>. This one report holds every transaction exactly as posted.</li>
      <li><strong>Account types</strong>: <em>Balance Sheet</em> and <em>Profit and Loss</em>, both for <strong>All Dates</strong>, exported to Excel. They tell VaultBook which accounts are bank, loan, income, expense and so on, and which are sub-accounts. (The <em>Account List</em> works too.)</li>
      <li><strong>The proof</strong>: <em>Trial Balance</em> for <strong>All Dates</strong>. After the import VaultBook compares every account with it.</li>
      <li><strong>Names</strong> (optional): <em>Customer Contact List</em>, <em>Vendor Contact List</em>, <em>Employee Contact List</em>.</li></ol>
      <p class="muted small">A General Ledger is only used when there is no Journal. Keep the files as QuickBooks made them: one report per file, with its title rows.</p></details>
    <details class="mg-guide"><summary>Which files to export from QuickBooks Desktop</summary><ol>
      <li><strong>Lists</strong>: <em>File › Utilities › Export › Lists to IIF Files</em> — tick Chart of Accounts, Customer List, Vendor List, Other Names List, Item List, Class List, Payment Terms List. One file each or all in one file.</li>
      <li><strong>Transactions</strong>: <em>Reports › Accountant & Taxes › General Ledger</em>, Dates: <strong>All</strong>, then <em>Excel › Create New Worksheet › Create a comma separated values (.csv) file</em>. A <em>Journal</em> report with the <em>Trans #</em> column, or IIF transaction exports, also work.</li>
      <li><strong>Optional checks</strong>: the <em>Profit & Loss</em> and <em>Balance Sheet</em> (All dates) saved as PDF, and the <em>Address</em> list (.txt). They are not imported; VaultBook uses them to prove the totals match.</li></ol>
      <p class="muted small">Everything is read on this computer. Nothing is uploaded.</p></details>`;

  /** Open the import preview with these files (QuickBooks Desktop section): into this company when it has no
   *  transactions yet, otherwise into a new company named from the files. */
  UI.migrateFiles = (list) => readAll(list).then((files) => {
    if (!files.length) return;
    if (UI.book && !UI.book.transactions.some((t) => t.status === 'posted')) { pending = files; UI.go('#/migrate'); return; }
    return UI.companyFromQuickBooks(null, files).then((n) => { if (n) UI.toast('Created ' + n + '. Check the preview, then press Import.'); });
  });
  UI.routes.migrate = (el) => {
    if (pending && UI.book) {   // arriving from "Create a company from QuickBooks files"
      lastCo = UI.book.company.id; reset(); st.files = pending; pending = null; rebuild();
      pdfTexts().then(() => { if (st.files.some((f) => f.isPdf)) { rebuild(); UI.render(); } });
    }
    const b = UI.book, hasTx = b.transactions.some((t) => t.status === 'posted');
    const p = st.plan, pv = p && p.preview;
    const fileRows = st.files.map((f) => {
      const m = (st.model && st.model.files.find((x) => x.name === f.name)) || {};
      const bad = m.kind === 'unknown' || (m.label || '').indexOf('could not') >= 0;
      return `<tr><td class="wrap">${esc(f.name)}</td><td class="${bad ? 'warn-text' : ''}">${esc(m.label || '')}</td><td class="num"><button type="button" class="btn ghost small" data-rm="${esc(f.name)}" aria-label="Remove ${esc(f.name)}">Remove</button></td></tr>`;
    }).join('');
    const history = (b.company.imports || []).slice().reverse();
    const blocking = (p && p.errors.length) || hasTx;
    el.innerHTML = UI.page('Import from QuickBooks', '', `
      <div class="mg" data-testid="migrate">
        ${st.result ? resultHtml() : ''}
        <section class="card">
          <h2>1. Add the QuickBooks files for ${esc(b.company.name)}</h2>
          <div class="mg-drop" id="mg-drop" tabindex="0" role="button" aria-label="Add QuickBooks files: drop them here or press Enter to choose">
            <p><strong>Drop QuickBooks files here</strong> or <label class="btn small">Choose files…<input type="file" id="mg-file" multiple accept=".iif,.IIF,.csv,.CSV,.txt,.TXT,.pdf,.PDF,.xlsx,.XLSX,.xlsm,.xls,.XLS,.json,.JSON" hidden></label></p>
            <p class="muted small">QuickBooks Online: Journal, Trial Balance, Balance Sheet, Profit and Loss and contact lists (Excel or CSV). QuickBooks Desktop: IIF lists, General Ledger CSV (or the General Ledger printed to PDF), Address list TXT, P&L / Balance Sheet PDF.</p>
          </div>
          ${st.files.length ? `<table class="data compact mg-files"><thead><tr><th>File</th><th>Recognised as</th><th></th></tr></thead><tbody>${fileRows}</tbody></table>` : ''}
          ${GUIDE}
        </section>
        ${p ? `<section class="card" data-testid="migrate-preview">
          <h2>2. Check what will be imported</h2>
          <div class="mg-stats">
            ${stat('Accounts', pv.accounts.created + ' new, ' + pv.accounts.updated + ' matched')}
            ${stat('Customers', pv.contacts.customers)}${stat('Vendors', pv.contacts.vendors)}
            ${stat('Items', pv.items)}${pv.classes ? stat('Classes', pv.classes) : ''}
            ${stat('Transactions', pv.transactions.toLocaleString() + (pv.firstDate ? ' · ' + U.fmtDate(pv.firstDate) + ' – ' + U.fmtDate(pv.lastDate) : ''))}
          </div>
          ${pv.transactions ? `<table class="data compact mg-kinds"><thead><tr><th>Becomes in VaultBook</th><th class="num">Count</th></tr></thead><tbody>${Object.keys(pv.kinds).map((k) => `<tr><td>${esc(KIND_LABEL[k] || k)}</td><td class="num">${pv.kinds[k]}</td></tr>`).join('')}</tbody></table>
            <p class="muted small">Source: ${esc(pv.source)}. Invoices, bills and payments become real documents (open-invoice and aging reports work); anything that does not fit a document type is posted as a journal entry with exactly the same debits and credits.${pv.applications && pv.applications.applied ? ' ' + pv.applications.applied + ' payment applications rebuilt (' + pv.applications.byNumber + ' by the invoice number in the payment reference).' : ''}</p>` : ''}
          ${pv.openingDiffs.length ? `<div class="banner warn"><strong>${pv.openingDiffs.length} balance${pv.openingDiffs.length === 1 ? '' : 's'} in QuickBooks ${pv.openingDiffs.length === 1 ? 'is' : 'are'} not fully explained by the transactions in these files</strong> ${pv.balancesLater ? `The chart of accounts file gives balances as of ${U.fmtDate(pv.balancesLater.listDate)}, but the transactions end on ${U.fmtDate(pv.balancesLater.lastDate)}. These differences are the activity after that date. To bring it in, export the General Ledger through ${U.fmtDate(pv.balancesLater.listDate)}.` : '(usually because the General Ledger was not exported for all dates).'}
            <table class="data compact"><thead><tr><th>Account</th><th class="num">QuickBooks</th><th class="num">From transactions</th><th class="num">Difference</th></tr></thead><tbody>${pv.openingDiffs.map((x) => `<tr><td>${esc(x.name)}</td><td class="num">${UI.money(x.qb)}</td><td class="num">${UI.money(x.imported)}</td><td class="num">${UI.money(x.diff)}</td></tr>`).join('')}</tbody></table>
            <div class="row gap"><label class="check"><input type="radio" name="mg-ob" value="post" ${pv.openingMode === 'post' ? 'checked' : ''}> Post the differences as an opening-balance entry dated <input type="date" id="mg-obdate" value="${esc(st.obDate || (pv.firstDate ? U.addDays(pv.firstDate, -1) : U.today()))}"></label>
            <label class="check"><input type="radio" name="mg-ob" value="skip" ${pv.openingMode === 'skip' ? 'checked' : ''}> Import the transactions only</label></div></div>` : ''}
          ${p.errors.length ? `<div class="banner danger" role="alert"><strong>Fix these before importing:</strong><ul class="issues">${p.errors.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
          ${p.warnings.length ? `<details class="mg-warn" open><summary>${p.warnings.length} note${p.warnings.length === 1 ? '' : 's'} about how QuickBooks data maps to VaultBook</summary><ul class="issues warn">${p.warnings.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></details>` : ''}
          ${pv.accounts.deactivated.length ? `<p class="muted small">Unused standard accounts made inactive (they stay available): ${esc(pv.accounts.deactivated.join(', '))}.</p>` : ''}
        </section>
        <section class="card">
          <h2>3. Import</h2>
          ${hasTx ? `<div class="banner warn">${esc(b.company.name)} already has transactions. To keep the books correct, import QuickBooks data into a new, empty company. <a href="#" id="mg-newco">${st.files.length ? 'Create a new company from these files' + (st.model && st.model.company.name ? ' (' + esc(st.model.company.name) + ')' : '') : 'Create a new company for this import'}</a></div>` : ''}
          <p>Everything is posted in one step: if any transaction fails the checks, nothing is changed. Download a backup afterwards.</p>
          <button type="button" class="btn primary" id="mg-go" data-key="i" ${blocking || st.busy ? 'disabled' : ''}>Import into ${esc(b.company.name)}</button>
        </section>` : ''}
        ${history.length ? `<section class="card"><h2>Import history</h2><table class="data compact"><thead><tr><th>Date</th><th>From</th><th>Summary</th></tr></thead><tbody>${history.map((h) => `<tr><td>${esc(new Date(h.at).toLocaleString())}</td><td>${esc(h.from)}</td><td class="wrap">${esc(h.summary)}</td></tr>`).join('')}</tbody></table></section>` : ''}
      </div>`);
    const drop = el.querySelector('#mg-drop'), input = el.querySelector('#mg-file');
    const take = (files) => { if (!files || !files.length) return; UI.toast('Reading ' + files.length + ' file' + (files.length === 1 ? '' : 's') + '…'); addFiles(files).then(() => UI.render(), UI.error); };
    input.addEventListener('change', () => take(input.files));
    drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove('over')));
    drop.addEventListener('drop', (e) => { e.preventDefault(); take(e.dataTransfer.files); });
    el.querySelectorAll('[data-rm]').forEach((x) => x.addEventListener('click', () => { st.files = st.files.filter((f) => f.name !== x.dataset.rm); st.result = null; rebuild(); UI.render(); }));
    el.querySelectorAll('input[name=mg-ob]').forEach((x) => x.addEventListener('change', () => { st.opening = x.value; rebuild(); UI.render(); }));
    const obd = el.querySelector('#mg-obdate'); U.dateCommit(obd, (v) => { if (U.isDate(v)) st.obDate = v; }, () => { rebuild(); UI.render(); });
    const nc = el.querySelector('#mg-newco'); if (nc) nc.addEventListener('click', (e) => { e.preventDefault(); if (st.files.length) UI.companyFromQuickBooks(null, st.files).then((n) => { if (n) UI.toast('Created ' + n + '. Check the preview, then press Import.'); }, UI.error); else UI.confirmLeave(UI.closeCompany); });
    const go = el.querySelector('#mg-go'); if (go) go.addEventListener('click', () => doImport(go));
  };
  const stat = (label, v) => `<div class="mg-stat"><span>${esc(label)}</span><b>${esc(String(v))}</b></div>`;

  function doImport(btn) {
    const b = UI.book, p = st.plan;
    if (!p || p.errors.length) return;
    st.busy = true; btn.disabled = true; btn.textContent = 'Importing…';
    const fullSummary = st.model && st.model.fullSummary;
    b.importBundle(p.bundle).then(() => {
      if (fullSummary) OB.prefs.set('qbFull:' + b.company.id, fullSummary);   // for QuickBooks Desktop › Tie-out report
      const cmp = Q.compareBalances(b, p.expected);
      const glPdf = st.files.find((f) => f.isPdf && f.pdfRows && Q.pdfKind(f.pdfRows) === 'gl' && !st.model.files.some((x) => x.kind === 'ledger-csv' && !/\(ledger\)\.csv$/.test(x.name))), glDay = glPdf ? Q.pdfPrinted(glPdf.pdfRows) : '';
      const reports = st.files.filter((f) => f.isPdf && f.pdfText && f !== glPdf).map((f) => Object.assign({ file: f.name, printed: f.pdfRows ? Q.pdfPrinted(f.pdfRows) : '', ledgerPrinted: glDay }, Q.verifyText(b, f.pdfText))).filter((r) => r.kind);
      st.result = { cmp, reports, count: p.bundle.transactions.length, later: p.preview.openingMode === 'skip' ? p.preview.balancesLater : null };
      st.files = []; st.plan = null; st.model = null;
      st.busy = false; UI.applyFeatures(); UI.toast('Imported ' + p.bundle.transactions.length.toLocaleString() + ' transactions from QuickBooks.');
      UI.render();
    }, (e) => {
      st.busy = false;
      UI.modal({ title: 'Nothing was imported', html: `<div class="banner danger">${esc(e.message)}</div>${e.errors ? `<ul class="issues">${e.errors.slice(0, 40).map((x) => `<li>${esc((x.ref ? x.ref + ': ' : '') + x.message)}</li>`).join('')}</ul>` : ''}`, actions: [{ label: 'Close', value: null }] });
      UI.render();
    });
  }
  function resultHtml() {
    const r = st.result, b = UI.book, bad = r.later ? [] : r.cmp.rows.filter((x) => !x.ok);
    const rep = r.reports.map((x) => `<li>${esc(x.file)} — ${x.kind === 'bs' ? 'Balance Sheet' : 'Profit & Loss'}: ${x.matched.length} line${x.matched.length === 1 ? '' : 's'} match${x.mismatched.length ? `, <strong class="warn-text">${x.mismatched.length} differ</strong> (${x.mismatched.map((m) => esc(m.label) + ' QuickBooks ' + U.fmt(m.qb) + ' / VaultBook ' + U.fmt(m.vb)).join('; ')})${x.ledgerPrinted && x.printed && x.ledgerPrinted !== x.printed ? ` <em>The ledger was printed on ${esc(x.ledgerPrinted)} and this statement on ${esc(x.printed)}: entries made in QuickBooks between those days are in the statement but not in the ledger. Print both on the same day to compare.</em>` : ''}` : ' ✓'}</li>`).join('');
    const integ = b.checkIntegrity();
    return `<section class="card mg-result" data-testid="migrate-result" role="status">
      <h2>Import complete — ${r.count.toLocaleString()} transactions</h2>
      ${r.later ? `<p class="check-line">The chart of accounts file gives balances as of ${U.fmtDate(r.later.listDate)}; the imported transactions end on ${U.fmtDate(r.later.lastDate)}, so those balances are not compared. ${r.reports.length ? 'The statements below are the check.' : 'Add a Balance Sheet and Profit and Loss PDF for ' + U.fmtDate(r.later.lastDate) + ' to check the result.'}</p>` : `<p class="check-line ${r.cmp.ok ? 'ok' : 'bad'}">${r.cmp.ok ? '✓ Every account balance equals QuickBooks (' + r.cmp.rows.length + ' accounts checked).' : '✗ ' + bad.length + ' account balance' + (bad.length === 1 ? ' differs' : 's differ') + ' from QuickBooks — see below.'}</p>`}
      <p class="check-line ${integ.issues.length ? 'bad' : 'ok'}">${integ.issues.length ? '✗ ' + esc(integ.issues.join(' ')) : '✓ ' + esc(integ.ok.join(' '))}</p>
      ${rep ? `<ul class="plain-list">${rep}</ul>` : ''}
      ${bad.length ? `<table class="data compact"><thead><tr><th>Account</th><th class="num">QuickBooks</th><th class="num">VaultBook</th></tr></thead><tbody>${bad.map((x) => `<tr><td>${esc(x.name)}</td><td class="num">${UI.money(x.qb)}</td><td class="num">${UI.money(x.vb)}</td></tr>`).join('')}</tbody></table>` : ''}
      <div class="row gap wrap">
        <a class="btn" href="#/report/tb">Trial Balance</a><a class="btn" href="#/report/bs">Balance Sheet</a><a class="btn" href="#/report/pnl?range=all">Profit & Loss (all dates)</a>
        <a class="btn" href="#/report/openinv">Open Invoices</a><a class="btn" href="#/accounts">Chart of accounts</a><a class="btn" href="#/items">Products and services</a>
        <a class="btn primary" href="#/settings?tab=backup">Download a backup</a></div>
    </section>`;
  }
  // a different company: start over
  window.addEventListener('hashchange', () => { if (UI.book && UI.book.company.id !== lastCo) { lastCo = UI.book.company.id; reset(); } });
})();
