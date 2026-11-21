/* OfflineBooks US — Import bank statement (PDF / QBO / OFX / Excel).
 * Uses the blended Statement Studio engine (js/vendor/statement-engine.js), loaded on first use,
 * then hands the extracted lines to the normal bank import review (rules, duplicates, post). */
(function () {
  'use strict';
  const U = OB.util, UI = OB.ui, esc = U.esc;
  const V = 'js/vendor/';
  const BASE = ['pdf.min.js', 'pdf-worker-src.js', 'sheetjs.min.js', 'statement-engine.js'];
  const OCR = ['tesseract.min.js', 'tesseract-worker-src.js', 'tesseract-core-src.js', 'eng-traineddata.js'];
  const loaded = {};
  const loadScript = (f) => loaded[f] || (loaded[f] = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = V + f; s.onload = res;
    s.onerror = () => { delete loaded[f]; rej(new Error('Could not load ' + f + '. Keep the js/vendor folder next to index.html.')); };
    document.head.appendChild(s);
  }));
  const loadAll = (list) => list.reduce((p, f) => p.then(() => loadScript(f)), Promise.resolve());
  /** Shared loader for the bundled vendor libraries (also used by the QuickBooks import to read PDF reports). */
  UI.loadVendor = loadAll;

  const bankFilter = (a) => a.type === 'bank' || a.type === 'cc';
  const usd = (n) => (n == null || isNaN(n) ? '—' : U.fmt(Math.round(n * 100), { symbol: true }));
  let st = null;

  UI.routes.pdfimport = (el) => {
    const b = UI.book;
    if (!st || st.companyId !== b.company.id) st = { companyId: b.company.id, accountId: '', queue: [], results: [], active: 0, ocr: false, busy: false, log: '' };
    const handed = UI.statementQueue; UI.statementQueue = null;
    if (handed) { st.accountId = handed.accountId; st.queue = handed.files.slice(); st.results = []; setTimeout(run); }
    el.innerHTML = UI.page('Import bank statement', '', `
      <ol class="steps"><li class="on">Extract statement</li><li>Check totals</li><li>Review in the Bank feed</li></ol>
      <section class="card ss-source" data-testid="pdfimport-source-card">
        <div class="form-grid">
          <label class="field"><span>Post into account</span><select id="ss-acc" data-testid="pdfimport-account-select">${UI.accountOptions(st.accountId, bankFilter)}</select></label>
          <label class="check ss-ocr"><input type="checkbox" id="ss-ocr" data-testid="pdfimport-ocr-toggle" ${st.ocr ? 'checked' : ''}> Try OCR for scanned PDFs <span class="muted small">(slower, offline)</span></label>
        </div>
        <label class="dropzone" id="ss-drop" data-testid="pdfimport-dropzone">
          <input type="file" id="ss-file" multiple accept=".pdf,.qbo,.qfx,.ofx,.xlsx,.xlsm,.xls,.csv" data-testid="pdfimport-file-input">
          <svg viewBox="0 0 24 24" width="34" height="34" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M14 3v5h5M12 18v-6M9.5 14.5L12 12l2.5 2.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          <strong>Drop bank statements here, or click to browse</strong>
          <span class="muted small">PDF statements, QBO / QFX / OFX downloads, or Excel / CSV exports (one spreadsheet opens in the Bank feed so you can check its columns) · processed only on this PC</span>
        </label>
        <ul class="ss-queue" data-testid="pdfimport-queue">${st.queue.map((f, i) => `<li><span class="badge">${esc(OBKind(f))}</span> ${esc(f.name)} <span class="muted small">${Math.max(1, Math.round(f.size / 1024))} KB</span><button class="btn icon" data-rm="${i}" aria-label="Remove ${esc(f.name)}" data-testid="pdfimport-queue-remove-${i}">×</button></li>`).join('')}</ul>
        <div class="form-actions"><span class="muted small" id="ss-status" data-testid="pdfimport-status"></span><span class="spacer"></span>
          ${st.queue.length ? '<button class="btn ghost" id="ss-clear" data-testid="pdfimport-clear-btn">Clear</button>' : ''}
          <button class="btn primary" id="ss-run" data-testid="pdfimport-extract-btn" ${st.queue.length && !st.busy ? '' : 'disabled'}>${st.busy ? 'Extracting…' : 'Extract transactions'}</button></div>
        <div class="ss-progress" ${st.busy ? '' : 'hidden'}><i id="ss-bar"></i></div>
        <pre class="ss-log" id="ss-log" data-testid="pdfimport-log" ${st.log ? '' : 'hidden'}>${esc(st.log)}</pre>
      </section>
      <div id="ss-results">${results()}</div>`,
    'Reads the statement on this computer (nothing is uploaded), checks the extracted totals against the statement’s own printed totals, then adds new lines to the Bank feed for review; lines you already imported are skipped. Nothing posts on import.');
    bind(el);
  };

  function OBKind(f) { const n = f.name.toLowerCase(); return /\.(qbo|qfx|ofx)$/.test(n) ? 'OFX' : /\.(xlsx|xlsm|xls|csv)$/.test(n) ? 'Sheet' : 'PDF'; }

  function results() {
    if (!st.results.length) return '';
    const r = st.results[st.active] || st.results[0], s = r.summary, tx = r.transactions;
    const chk = (stated, computed, ok) => stated == null ? `<span class="muted">${usd(computed)}</span> <span class="badge">no printed total</span>`
      : `${usd(computed)} <span class="badge ${ok ? 'ok' : 'warn'}">${ok ? 'Matches statement' : 'Statement says ' + usd(stated)}</span>`;
    const total = st.results.reduce((n, x) => n + x.transactions.length, 0);
    return `<div class="ss-tabs segmented" role="tablist" data-testid="pdfimport-file-tabs">${st.results.map((x, i) => `<button role="tab" aria-checked="${i === st.active}" data-tab="${i}" data-testid="pdfimport-file-tab-${i}">${x.error && !x.transactions.length ? '⚠ ' : ''}${esc(x.summary.fileName)} <span class="muted">${x.transactions.length}</span></button>`).join('')}</div>
      ${r.error ? `<div class="banner ${tx.length ? 'warn' : 'danger'}" data-testid="pdfimport-error">${esc(r.error)}</div>` : ''}
      <section class="card" data-testid="pdfimport-summary">
        <div class="ss-summary">
          <div><span>Bank</span><b>${esc(s.bank || '—')}</b></div>
          <div><span>Account holder</span><b>${esc(s.accountHolder || '—')}</b></div>
          <div><span>Account no.</span><b>${esc(s.accountNumber || '—')}</b></div>
          <div><span>Period</span><b>${esc(s.period || '—')}</b></div>
          <div><span>Beginning balance</span><b class="amt">${usd(s.beginningBalance)}</b></div>
          <div><span>Ending balance</span><b class="amt">${usd(s.endingBalance)}</b></div>
        </div>
        <dl class="facts ss-checks">
          <dt>Money in (credits)</dt><dd data-testid="pdfimport-credits-check">${chk(s.statedCredits, s.computedCredits, s.creditsMatch)}</dd>
          <dt>Money out (debits)</dt><dd data-testid="pdfimport-debits-check">${chk(s.statedDebits, s.computedDebits, s.debitsMatch)}</dd>
          ${s.autoCorrected && s.autoCorrected.length ? `<dt>Auto-corrected</dt><dd>${esc(s.autoCorrected.join(', '))}</dd>` : ''}
          ${s.usedOcr ? '<dt>Source</dt><dd><span class="badge warn">Read with OCR — double-check amounts</span></dd>' : ''}
        </dl>
        <div class="form-actions">
          <button class="btn" id="ss-xlsx" data-testid="pdfimport-download-xlsx-btn">Excel</button>
          <button class="btn" id="ss-csv" data-testid="pdfimport-download-csv-btn">CSV</button>
          <button class="btn" id="ss-qbo" data-testid="pdfimport-download-qbo-btn">QBO</button>
          <span class="spacer"></span>
          ${st.results.length > 1 ? `<button class="btn" id="ss-send-all" data-testid="pdfimport-send-all-btn" ${total ? '' : 'disabled'}>Review all files (${total})</button>` : ''}
          <button class="btn primary" id="ss-send" data-testid="pdfimport-send-to-review-btn" ${tx.length ? '' : 'disabled'}>Send ${tx.length} lines to the Bank feed →</button>
        </div>
      </section>
      ${tx.length ? `<div class="table-wrap ss-table"><table class="data compact" data-testid="pdfimport-transactions-table"><thead><tr><th>Date</th><th>Description</th><th>Section</th><th class="num">Money in</th><th class="num">Money out</th><th class="num">Balance</th></tr></thead><tbody>
        ${tx.map((t) => `<tr><td>${esc(t.dateISO ? U.fmtDate(t.dateISO) : t.date)}</td><td class="memo wrap">${esc(t.description)}</td><td class="muted small">${esc(t.section || '')}</td>
          <td class="num amt">${t.type === 'Credit' ? usd(Math.abs(t.amount)) : ''}</td><td class="num amt">${t.type !== 'Credit' ? usd(Math.abs(t.amount)) : ''}</td><td class="num amt muted">${t.balance == null ? '' : usd(t.balance)}</td></tr>`).join('')}
      </tbody></table></div>` : ''}`;
  }

  function addFiles(list) { Array.from(list || []).forEach((f) => st.queue.push(f)); UI.render(); }

  function bind(el) {
    const acc = el.querySelector('#ss-acc');
    acc.addEventListener('change', () => { st.accountId = acc.value; });
    el.querySelector('#ss-ocr').addEventListener('change', (e) => { st.ocr = e.target.checked; });
    el.querySelector('#ss-file').addEventListener('change', (e) => addFiles(e.target.files));
    const drop = el.querySelector('#ss-drop');
    ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', (e) => addFiles(e.dataTransfer.files));
    el.querySelectorAll('[data-rm]').forEach((x) => x.addEventListener('click', (e) => { e.preventDefault(); st.queue.splice(+x.dataset.rm, 1); UI.render(); }));
    const clr = el.querySelector('#ss-clear'); if (clr) clr.addEventListener('click', () => { st.queue = []; st.results = []; st.log = ''; UI.render(); });
    el.querySelector('#ss-run').addEventListener('click', run);
    bind2(el);
  }
  function bind2(el) {
    el.querySelectorAll('[data-tab]').forEach((x) => { x.onclick = () => { st.active = +x.dataset.tab; el.querySelector('#ss-results').innerHTML = results(); bind2(el); }; });
    const r = st.results[st.active]; if (!r) return;
    const E = window.OBStatement, base = E.baseFileName(r.summary.fileName);
    const on = (id, fn) => { const b = el.querySelector(id); if (b) b.onclick = fn; };
    on('#ss-xlsx', () => window.XLSX.writeFile(E.buildSingleWorkbook(r), base + '.xlsx'));
    on('#ss-csv', () => E.downloadBlob(E.buildCSV(r.transactions), base + '.csv', 'text/csv'));
    on('#ss-qbo', () => E.downloadBlob(E.generateQBO(r.metadata, r.transactions).text, base + '.qbo', 'application/vnd.intu.qbo'));
    on('#ss-send', () => send([r]));
    on('#ss-send-all', () => send(st.results));
  }

  function send(list) {
    const accId = document.getElementById('ss-acc').value;
    if (!accId) return UI.toast('Choose the account to post into first.', 'error');
    const rows = [];
    list.forEach((r) => r.transactions.forEach((t) => {
      const amt = Math.round((t.type === 'Credit' ? 1 : -1) * Math.abs(t.amount) * 100), date = t.dateISO || OB.importer.parseDateAs(t.date, 'MDY');
      if (amt && date) rows.push({ date, description: t.description || '', amount: amt, checkNo: t.checkNo || t.checkNumber || '' });
    }));
    if (!rows.length) return UI.toast('No transactions to review.', 'error');
    // the statement's printed ending balance is kept only when one file is sent and its totals check out
    const one = list.length === 1 ? list[0].summary : null, okTotals = one && one.endingBalance != null && one.creditsMatch !== false && one.debitsMatch !== false;
    const last = rows.map((x) => x.date).sort().pop();
    UI.busy(document.getElementById('ss-send'), () => UI.book.importBankLines(accId, rows, { fileName: list.map((r) => r.summary.fileName).join(', '), source: 'statement', endingBalance: okTotals ? Math.round(one.endingBalance * 100) : null, endingDate: okTotals ? last : '' })
      .then((r) => {
        st.queue = []; st.results = []; st.log = '';
        UI.toast(r.added + ' line' + (r.added === 1 ? '' : 's') + ' added to For review' + (r.duplicates ? ' · ' + r.duplicates + ' already imported' : '') + '.');
        UI.go((UI.feedReviewHash && UI.feedReviewHash(accId)) || '#/bankfeed?account=' + encodeURIComponent(accId));
      })).catch(UI.error);
  }

  /** 1.47.1: Excel and CSV are read by the same engine as the Bank feed import (OB.importer): the sheet with the most
   *  transactions, a header below title rows, Debit/Credit type columns, day-first dates, card files reversed. */
  async function sheetResult(f, E, say) {
    const I = OB.importer, X = window.XLSX;
    const sheets = /\.csv$/i.test(f.name) ? [{ name: f.name, rows: OB.util.parseCSV(await f.text()) }]
      : ((wb) => wb.SheetNames.map((name) => ({ name, rows: OB.qbimport.sheetRows(wb.Sheets[name], X.SSF) })))(X.read(await f.arrayBuffer(), { type: 'array', cellNF: true }));
    const best = I.pickSheets(sheets)[0];
    if (!best) throw new Error('No sheet has a date column and an amount (or money in / money out) column.');
    const m = I.detectColumns(best.table[0], best.table.slice(1)); m.hasHeader = true;
    const acc = UI.book.accById[st.accountId], rows = I.parseBankRows(best.table, m, { invert: !!acc && acc.type === 'cc' }).rows;
    const tx = rows.map((r) => ({ date: OB.util.fmtDate(r.date), dateISO: r.date, description: r.description, type: r.amount > 0 ? 'Credit' : 'Debit', amount: r.amount / 100, balance: r.balance === null ? null : r.balance / 100, checkNo: r.checkNo, section: r.amount > 0 ? 'Deposits' : 'Withdrawals', signSource: 'spreadsheet' }));
    const sum = (k) => Math.round(rows.filter((r) => k * r.amount > 0).reduce((a, r) => a + Math.abs(r.amount), 0)) / 100;
    const summary = { fileName: f.name, bank: '', period: tx.length ? tx[0].date + ' to ' + tx[tx.length - 1].date : '(not detected)', beginningBalance: null, endingBalance: null, statedCredits: null, statedDebits: null, computedCredits: sum(1), computedDebits: sum(-1), creditsMatch: null, debitsMatch: null, transactionCount: tx.length, autoCorrected: [], recognizedFromMemory: [], sourceFormat: 'spreadsheet', sourceSheet: best.name };
    say('  → ' + tx.length + ' transactions read from sheet "' + best.name + '"');
    return { summary, transactions: tx, metadata: E.deriveQboMetadata(summary, tx) };
  }

  /** The sheets of an Excel or CSV file that hold transactions, most first (OB.importer.pickSheets). */
  async function sheetTables(f) {
    if (/\.csv$/i.test(f.name)) return OB.importer.pickSheets([{ name: f.name, rows: OB.util.parseCSV(await f.text()) }]);
    await UI.loadVendor(['sheetjs.min.js']);
    const wb = window.XLSX.read(await f.arrayBuffer(), { type: 'array', cellNF: true });
    return OB.importer.pickSheets(wb.SheetNames.map((name) => ({ name, rows: OB.qbimport.sheetRows(wb.Sheets[name], window.XLSX.SSF) })));
  }
  function run() {
    if (!st.queue.length || st.busy) return;
    const accEl = document.getElementById('ss-acc'); st.accountId = accEl ? accEl.value : st.accountId;
    // 1.50.2: one Excel or CSV file opens in the Bank feed's column step, so the columns can be checked before import
    // (one door for spreadsheets). PDF, OFX/QBO and several files at once are read here.
    if (st.queue.length === 1 && OBKind(st.queue[0]) === 'Sheet' && st.accountId) {
      const f = st.queue[0];
      sheetTables(f).then((list) => {
        if (!list.length) { UI.toast('No sheet in "' + f.name + '" has a date column and an amount (or money in / money out) column.', 'error'); return; }
        UI.importTable(st.accountId, list[0].table, f.name, list); st.queue = [];
        UI.go('#/bankfeed?account=' + encodeURIComponent(st.accountId)); UI.toast('Check the columns, then click Continue.');
      }, (e) => UI.toast('Could not read "' + f.name + '": ' + e.message, 'error'));
      return;
    }
    st.busy = true; st.results = []; st.active = 0; st.log = '';
    UI.render();
    const say = (m) => { st.log += m + '\n'; const l = document.getElementById('ss-log'); if (l) { l.hidden = false; l.textContent = st.log; l.scrollTop = l.scrollHeight; } };
    const bar = (p) => { const b = document.getElementById('ss-bar'); if (b) b.style.width = Math.round(p * 100) + '%'; };
    const needOcr = st.ocr && st.queue.some((f) => OBKind(f) === 'PDF');
    say('Loading statement reader…');
    loadAll(BASE.concat(needOcr ? OCR : [])).then(async () => {
      const E = window.OBStatement;
      E.setOcrEnabled(st.ocr);
      for (let i = 0; i < st.queue.length; i++) {
        const f = st.queue[i]; bar(i / st.queue.length);
        try { const r = OBKind(f) === 'Sheet' ? await sheetResult(f, E, say) : await E.parseAny(f, say); r.error = null; st.results.push(r); }
        catch (err) {
          say('  ⚠ ' + f.name + ': ' + err.message);
          st.results.push({ summary: { fileName: f.name, bank: 'Unknown', transactionCount: 0, autoCorrected: [] }, transactions: [], metadata: E.deriveQboMetadata({ period: '' }, []), error: err.message });
        }
      }
      bar(1); say('Done.');
    }).catch((e) => { say('⚠ ' + e.message); UI.toast(e.message, 'error'); }).then(() => {
      st.busy = false;
      if (UI.current && UI.current.name === 'pdfimport') UI.render();
      const n = st.results.reduce((a, r) => a + r.transactions.length, 0);
      if (st.results.length) UI.toast(n + ' transactions extracted from ' + st.results.length + ' file' + (st.results.length > 1 ? 's' : '') + '.');
    });
  }
})();
