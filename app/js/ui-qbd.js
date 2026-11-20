/* VaultBook — QuickBooks Desktop section (1.32): everything about moving books between QuickBooks Desktop and VaultBook
 * in one place.  #/qbd          overview: status, the four steps in order, the connector, reports and tools
 *                #/qbd/tieout   tie-out report: VaultBook against QuickBooks after "Import everything" */
(function () {
  'use strict';
  const U = OB.util, UI = OB.ui, esc = U.esc;

  const fileInput = (id, label, cls) => `<label class="btn ${cls || ''}" for="${id}">${label}</label><input type="file" id="${id}" accept=".json,.JSON" hidden data-testid="${id}">`;
  const when = (iso) => iso ? new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '';

  UI.routes.qbd = (el, r) => {
    const b = UI.book;
    if (r && r.id === 'tieout') return tieOut(el, b);
    if (r && r.id === 'update') return UI.qbUpdate(el, b);
    const full = OB.prefs.get('qbFull:' + b.company.id), snap = UI.qbSnapshot ? UI.qbSnapshot(b) : null;
    let cmp = null; if (snap) { try { cmp = OB.qbsync.compare(b, snap); } catch (e) { cmp = null; } }
    const sent = b.company.qbSent || {}, nSent = Object.keys(sent).filter((k) => sent[k].qbTxnId).length, nProb = Object.keys(sent).filter((k) => sent[k].problem && !sent[k].qbTxnId).length;
    const tie = full ? OB.qbfull.tieOut(b, full) : null;
    const imports = (b.company.imports || []).slice().reverse().slice(0, 6);
    const step = (n, title, body, actions, done) => `<section class="card qbd-step${done ? ' done' : ''}" data-testid="qbd-step-${n}"><div class="qbd-num" aria-hidden="true">${n}</div><div class="qbd-body"><h2>${title}${done ? ' <span class="qs-st qs-sent">Done</span>' : ''}</h2>${body}<div class="form-actions">${actions}</div></div></section>`;
    const glance = [
      ['Imported from QuickBooks', full ? when(full.at) : 'Not yet'],
      ['Last QuickBooks read', snap ? when(snap.at) : 'Not yet'],
      ['In QuickBooks (matched or sent)', String(nSent)],
      ['Only in VaultBook', cmp ? String(cmp.missing.length) : '—'],
      ['Problems to fix', String(nProb)],
      ['Balances tie', tie ? (tie.ok ? 'Yes' : 'No — see tie-out') : '—']];
    el.innerHTML = UI.page('QuickBooks Desktop', `${fileInput('qbd-any', 'Load a connector file…')}`, `
      <dl class="rr-glance qbd-glance" data-testid="qbd-glance">${glance.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
      <div class="qbd-steps">
      ${step(1, 'Import everything from QuickBooks', `<p>Bring a client's QuickBooks file into VaultBook: chart of accounts, customers, vendors, items, classes, terms and every transaction with its lines, payments applied to the right invoices, and each QuickBooks id kept.</p>
          <ol class="qbd-how"><li>On the QuickBooks PC run <strong>VaultBook QuickBooks.cmd</strong> › <strong>5 Export everything</strong> and choose a folder.</li><li>Here, choose the <code>VaultBook-QB-full-….json</code> it saved. You get a preview first; nothing is posted until you press Import.</li></ol>
          <p class="muted small">${b.transactions.some((t) => t.status === 'posted') ? 'This company already has transactions, so the export goes into a <strong>new company</strong> named from the file.' : 'This company is empty, so the export goes into it.'}</p>`,
        `${fileInput('qbd-full', 'Choose the full export…', 'primary')}${full ? '<a class="btn" href="#/qbd/tieout">Tie-out report</a>' : ''}`, !!full)}
      ${step(2, 'Read QuickBooks and see the gap', `<p>Before sending anything, see what QuickBooks already has, month by month: Done, Partly, Not in QuickBooks, QuickBooks only.</p>
          <ol class="qbd-how"><li>Run <strong>VaultBook QuickBooks.cmd</strong> › <strong>1 Read QuickBooks</strong>.</li><li>Choose the snapshot it saved.</li></ol>`,
        `${fileInput('qbd-snap', 'Choose a snapshot…', snap ? '' : 'primary')}<a class="btn" href="#/qbsend?tab=months">Months</a>`, !!snap)}
      ${step(3, 'Send what QuickBooks is missing', `<p>Tick months (any order) or single invoices and payments, then download one file for the connector. Payments go in applied to their invoices.</p>
          <ol class="qbd-how"><li>Choose in <strong>Months</strong> or <strong>Items</strong> and press <strong>Download for QuickBooks</strong>.</li><li>Run <strong>VaultBook QuickBooks.cmd</strong> › <strong>3 Read, send, read</strong> (or <strong>4 Check only</strong> first) and choose that file. It asks before creating any customer or item.</li></ol>`,
        `<a class="btn primary" href="#/qbsend?tab=months">Months</a><a class="btn" href="#/qbsend?tab=items">Items</a>`, cmp && !cmp.missing.length && !!snap)}
      ${step(4, 'Load what happened', `<p>The connector saves a <code>.result.json</code> next to your file (and a new snapshot with option 3). Load them so every item shows Sent or Problem, and the months show Done.</p>`,
        `${fileInput('qbd-result', 'Choose a result or snapshot…')}<a class="btn" href="#/qbsend?tab=items&status=problem">Problems (${nProb})</a><a class="btn" href="#/qbsend?tab=items&status=sent">Sent (${nSent})</a>`, false)}
      ${step(5, 'Update QuickBooks to match VaultBook', `<p>Changed or reclassified entries in VaultBook that came from QuickBooks? VaultBook compares them with a fresh QuickBooks export and sends only the edits and voids; new accounts are created first. Nothing is deleted.</p>
          <ol class="qbd-how"><li>On the QuickBooks PC: <strong>Open the QuickBooks tool</strong> (or VaultBook QuickBooks.cmd › <strong>7 Connect to VaultBook</strong>).</li><li>Type its link code here, get the export, check the list and send. Answer Y/N in the tool's window.</li></ol>`,
        `<a class="btn primary" href="#/qbd/update" data-testid="qbd-update">Update QuickBooks</a>`, false)}
      </div>
      <div class="qbd-grid">
        <section class="card"><h2>Reports</h2><ul class="report-links">
          <li><a href="#/qbd/tieout"><strong>Tie-out report</strong><span>VaultBook against QuickBooks after the import: every balance-sheet account and the number of transactions of each type.</span></a></li>
          <li><a href="#/qbsend?tab=months"><strong>Months: QuickBooks vs VaultBook</strong><span>Per month: in QuickBooks, in VaultBook, matched, only in one of them.</span></a></li>
          <li><a href="#/qbsend?tab=items&status=sent"><strong>Sent to QuickBooks</strong><span>Every invoice and payment recorded or found in QuickBooks, with its QuickBooks id.</span></a></li>
          <li><a href="#/qbsend?tab=items&status=problem"><strong>Problems</strong><span>What the connector could not record, with the reason.</span></a></li></ul></section>
        <section class="card"><h2>The connector</h2>
          <p>One file in VaultBook's <code>tools</code> folder: <strong>VaultBook QuickBooks.cmd</strong>. Copy the folder to the PC with QuickBooks Desktop once and double-click it there.</p>
          <table class="data compact qbd-menu"><tbody>
            <tr><td>1</td><td>Read QuickBooks</td><td>Snapshot for step 2. Writes nothing.</td></tr>
            <tr><td>2</td><td>Send to QuickBooks</td><td>Records a file from step 3: invoices, customer payments and bank transactions (checks, deposits, transfers, card charges, journal entries).</td></tr>
            <tr><td>3</td><td>Read, send, read</td><td>The usual cycle.</td></tr>
            <tr><td>4</td><td>Check only</td><td>Shows the plan. Writes nothing.</td></tr>
            <tr><td>5</td><td>Export everything</td><td>Full export for step 1. Writes nothing.</td></tr>
            <tr><td>6</td><td>Reports and ledgers</td><td>A bank or any account's ledger, general ledger, transaction list, P&amp;L, Balance Sheet, Trial Balance, open invoices, unpaid bills, for any dates, as an Excel-ready .csv. Writes nothing; VaultBook is not needed.</td></tr>
            <tr><td>7</td><td>Connect to VaultBook</td><td>VaultBook talks to the tool directly on this computer (link code shown in its window): fresh exports and updates without moving files.</td></tr>
            <tr><td>8</td><td>Install the link</td><td>One time, no admin rights: lets <strong>Open the QuickBooks tool</strong> in VaultBook start the tool.</td></tr></tbody></table>
          <p class="muted small">Before sending, choose <strong>Window › Close All</strong> in QuickBooks: open reports and registers recalculate after every entry and can make QuickBooks stop.</p>
          <p class="muted small">First time: open the company file as Admin in single-user mode; when QuickBooks asks, allow "VaultBook Connector" (Yes, always). Windows administrator rights are not needed. The connector never searches for files; it always asks.</p></section>
        <section class="card"><h2>Other ways</h2><ul class="report-links">
          <li><a href="#/migrate"><strong>Import from QuickBooks files</strong><span>IIF lists, General Ledger CSV, QuickBooks Online Excel reports — when the connector cannot run.</span></a></li>
          <li><a href="#/bankfeed"><strong>Bank feed › Export (.iif)</strong><span>Send bank-feed transactions as an IIF file (payments arrive unapplied; use with the payments-to-apply list).</span></a></li></ul>
          ${imports.length ? `<h3 class="qbd-h3">Import history</h3><table class="data compact" data-testid="qbd-history"><tbody>${imports.map((x) => `<tr><td>${esc(when(x.at))}</td><td>${esc(x.from || '')}</td><td class="memo">${esc(x.summary || '')}</td></tr>`).join('')}</tbody></table>` : ''}</section>
      </div>`,
      'Move books between QuickBooks Desktop and VaultBook: import a client file, see what QuickBooks is missing, send it, and prove the balances tie.');
    ['#qbd-any', '#qbd-full', '#qbd-snap', '#qbd-result'].forEach((id) => {
      const x = el.querySelector(id); if (!x) return;
      x.addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) UI.qbLoadFile(b, f).then(() => { if (location.hash.indexOf('#/qbd') === 0) UI.render(); }); });
    });
  };

  function tieOut(el, b) {
    const full = OB.prefs.get('qbFull:' + b.company.id);
    if (!full) {
      el.innerHTML = UI.page('Tie-out report', '<a class="btn" href="#/qbd">QuickBooks Desktop</a>', UI.empty('No full QuickBooks export has been imported into this company yet. Use <strong>QuickBooks Desktop › 1 Import everything</strong>; the tie-out report then compares every balance with QuickBooks.', '<a class="btn primary" href="#/qbd">Go to QuickBooks Desktop</a>'));
      return;
    }
    const t = OB.qbfull.tieOut(b, full), LBL = OB.schema.TXN_TYPES;
    const VB = { Invoice: 'invoice', SalesReceipt: 'salesReceipt', CreditMemo: 'creditMemo', ReceivePayment: 'payment', ARRefundCreditCard: 'customerRefund', Bill: 'bill', VendorCredit: 'vendorCredit', BillPaymentCheck: 'billPayment', BillPaymentCreditCard: 'billPayment', Check: 'check', CreditCardCharge: 'expense', CreditCardCredit: 'ccCredit', Deposit: 'deposit', Transfer: 'transfer', JournalEntry: 'journal', SalesTaxPaymentCheck: 'check' };
    const qbBy = {}; Object.keys(t.counts.qb).forEach((k) => { const v = VB[k] || k; qbBy[v] = (qbBy[v] || 0) + t.counts.qb[k]; });
    const kinds = Object.keys(Object.assign({}, qbBy, t.counts.vb)).filter((k) => qbBy[k] || t.counts.vb[k]).sort();
    const money = (c) => c === null || c === undefined ? '—' : UI.money(c);
    const bad = t.rows.filter((r) => r.diff !== 0);
    const mtx = [['Account', 'No.', 'Type', 'QuickBooks', 'VaultBook', 'Difference'].map((h) => ({ v: h, bold: true }))].concat(t.rows.map((r) => [r.name, r.number, r.type, { v: r.qb / 100, money: true }, r.vb === null ? 'not found' : { v: r.vb / 100, money: true }, r.diff === null ? '' : { v: r.diff / 100, money: true }]));
    el.innerHTML = `<div class="page report-page fill">
      <div class="page-head no-print"><div><a href="#/qbd" class="back">QuickBooks Desktop</a><h1>Tie-out report</h1></div>
        <div class="actions"><button class="btn" data-x="csv">CSV</button><button class="btn" data-x="xlsx">Excel</button><button class="btn" data-x="pdf">PDF</button><button class="btn primary" data-print>Print</button></div></div>
      <article class="report scroll-area" tabindex="0" aria-label="Tie-out report">
        <header><h2>${esc(b.company.name)}</h2><h1>Tie-out: VaultBook against QuickBooks Desktop</h1><p>QuickBooks export of ${esc(when(full.at))}${full.from ? ' · from ' + esc(U.fmtDate(full.from)) : ' · all dates'}</p></header>
        <p class="check-line ${t.ok ? 'ok' : 'bad'}" data-testid="qbd-tie">${t.ok ? '✓ Every balance-sheet account ties to QuickBooks.' : '✗ ' + bad.length + ' account' + (bad.length === 1 ? ' does' : 's do') + ' not tie. Transactions entered in either system since the export also show here.'}</p>
        <h2 class="qbd-rh">Balances</h2>
        <table class="statement" data-testid="qbd-tie-table"><thead><tr><th>Account</th><th>Type</th><th class="num">QuickBooks</th><th class="num">VaultBook</th><th class="num">Difference</th></tr></thead><tbody>
          ${t.rows.map((r) => `<tr class="${r.diff ? 'qbd-bad' : ''}"><td>${r.accountId ? `<a href="#/register/${esc(r.accountId)}">${esc((r.number ? r.number + ' ' : '') + r.name)}</a>` : esc(r.name)}</td><td>${esc(r.type)}</td><td class="num">${money(r.qb)}</td><td class="num">${r.vb === null ? '<span class="warn-text">not found</span>' : money(r.vb)}</td><td class="num">${r.diff ? `<strong>${money(r.diff)}</strong>` : r.diff === 0 ? '0.00' : ''}</td></tr>`).join('')}
        </tbody></table>
        <h2 class="qbd-rh">Transactions</h2>
        <table class="statement narrow" data-testid="qbd-count-table"><thead><tr><th>Type</th><th class="num">In the QuickBooks export</th><th class="num">Imported into VaultBook</th></tr></thead><tbody>
          ${kinds.map((k) => `<tr><td>${esc((LBL[k] || { label: k }).label)}</td><td class="num">${qbBy[k] || 0}</td><td class="num">${t.counts.vb[k] || 0}</td></tr>`).join('')}</tbody></table>
        <p class="muted small">Balances are in each account's own direction, as QuickBooks shows them (liabilities and equity positive when credit). Counts differ when QuickBooks transactions became journal entries in VaultBook (for example a discount or an entry that touches two A/R accounts) or zero-amount entries were skipped. Retained earnings is left out: QuickBooks and VaultBook both calculate it from the profit and loss.</p>
        <footer class="muted small">Generated ${esc(new Date().toLocaleString())} by VaultBook</footer>
      </article></div>`;
    el.querySelector('[data-print]').addEventListener('click', () => window.print());
    el.querySelectorAll('[data-x]').forEach((btn) => btn.addEventListener('click', () => UI.exportMatrix('QuickBooks_tie_out', [[{ v: b.company.name, bold: true }], [{ v: 'Tie-out: VaultBook against QuickBooks Desktop', bold: true }], ['QuickBooks export of ' + when(full.at)], []].concat(mtx), btn.dataset.x, { report: true })));
  }
})();
