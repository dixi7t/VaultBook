/* VaultBook — Payroll from paystubs (1.33): #/payroll
 * Drop paystubs (PDF, scans, photos). Each is read on this computer (text layer, else offline OCR), every figure is proved
 * against the stub's own totals and check, and one gross-up journal entry per pay date is prepared from the company's
 * payroll accounts. Nothing posts until "Post journal entry"; corrections and new labels are remembered for the company.
 * Tabs: ?tab=stubs (default) | settings | posted */
(function () {
  'use strict';
  const U = OB.util, UI = OB.ui, P = OB.paystub, esc = U.esc;
  const VENDOR = ['pdf.min.js', 'pdf-worker-src.js', 'sheetjs.min.js', 'statement-engine.js', 'tesseract.min.js', 'tesseract-worker-src.js', 'tesseract-core-src.js', 'eng-traineddata.js'];
  let st = null;
  const fresh = (b) => ({ companyId: b.company.id, stubs: [], docs: [], skip: {}, files: [], busy: false, log: '', posted: {}, draft: null });
  const CAT_OPTS = [['wages', 'Gross wages'], ['reimb', 'Reimbursement (no tax)'], ['subtotal', 'Subtotal (ignore)'], ['ee_ss', 'Social Security withheld'], ['ee_medicare', 'Medicare withheld'], ['fed', 'Federal income tax'], ['state', 'State income tax'], ['local', 'Local tax'], ['otherTax', 'Other employee tax (SDI…)'], ['retirement', '401(k) / retirement'], ['benefits', 'Health / benefits'], ['garnish', 'Garnishment'], ['otherDed', 'Other deduction']];
  const money = (c) => c === null || c === undefined ? '' : (c / 100).toFixed(2);
  const parseMoney = (v) => { const s = String(v || '').replace(/[$,\s]/g, ''); if (!s) return null; const n = parseFloat(s); return isFinite(n) ? Math.round(n * 100) : null; };

  UI.routes.payroll = (el, r) => {
    const b = UI.book;
    if (!st || st.companyId !== b.company.id) st = fresh(b);
    const tab = (r.params && r.params.tab) || 'stubs';
    // the working copy follows the saved settings whenever they change (saved here, or by another screen or the learning step)
    if (!st.draft || st.draft.companyId !== b.company.id || st.draftOf !== b.company.payroll) { st.draft = Object.assign({ companyId: b.company.id }, P.settings(b)); st.draftOf = b.company.payroll; }
    const S = st.draft;
    const tabs = `<div class="segmented qs-tabs" role="tablist">${[['stubs', 'Paystubs'], ['settings', 'Settings'], ['posted', 'Posted entries']].map(([k, l]) => `<a role="tab" class="btn-tab" aria-selected="${tab === k}" href="#/payroll?tab=${k}" data-testid="pr-tab-${k}">${l}</a>`).join('')}</div>`;
    const body = tab === 'settings' ? settingsView(b, S) : tab === 'posted' ? postedView(b) : stubsView(b, S);
    el.innerHTML = UI.page('Payroll from paystubs', '', tabs + body,
      'Drop paystubs and VaultBook prepares the payroll journal entry for each pay date: gross wages, withholding, employer taxes and net pay. Weekly, bi-weekly, semi-monthly or monthly. Post it to the books, download it as a QuickBooks .iif, or both.');
    if (tab === 'settings') bindSettings(el, b, S); else if (tab === 'stubs') bindStubs(el, b, S);
  };

  /* ---------------- paystubs ---------------- */
  const groupsOf = () => { const g = {}; st.stubs.forEach((s) => { (g[s.payDate || ''] = g[s.payDate || ''] || []).push(s); }); return Object.keys(g).sort().map((d) => ({ date: d, stubs: g[d] })); };
  const readyGroups = (b, S) => groupsOf().filter((g) => !st.skip[g.date] && !st.posted[g.date] && !P.journal(b, g.stubs, S).errors.length);
  // the .iif goes to QuickBooks, so a pay date already posted in VaultBook can still be exported (the books here are not QuickBooks)
  const iifGroups = (b, S) => { const nb = Object.create(b, { posted: { value: () => [] } }); return groupsOf().filter((g) => !st.skip[g.date] && !P.journal(nb, g.stubs, S).errors.length).map((g) => P.journal(nb, g.stubs, S).draft); };
  const pref = (k, d) => { const v = OB.prefs.get('payroll' + k + ':' + UI.book.company.id); return v === undefined ? d : v; };
  const setPref = (k, v) => OB.prefs.set('payroll' + k + ':' + UI.book.company.id, v);
  const jeTable = (b, d) => `<div class="scroll-x"><table class="data compact pr-je" data-testid="pr-je"><thead><tr><th>Account</th><th>Memo</th><th class="num">Debit</th><th class="num">Credit</th></tr></thead><tbody>
        ${d.jlines.map((l) => `<tr><td>${l.accountId && b.accById[l.accountId] ? esc(b.accountLabel(l.accountId)) : '<span class="warn-text">choose in Settings</span>'}</td><td>${esc(l.memo)}</td><td class="num">${l.debit ? UI.money(l.debit) : ''}</td><td class="num">${l.credit ? UI.money(l.credit) : ''}</td></tr>`).join('')}
        <tr class="grand"><td colspan="2">Total</td><td class="num">${UI.money(U.sum(d.jlines, (l) => l.debit || 0))}</td><td class="num">${UI.money(U.sum(d.jlines, (l) => l.credit || 0))}</td></tr></tbody></table></div>`;
  function actionBar(b, S) {
    const ready = readyGroups(b, S), iif = iifGroups(b, S), merge = pref('Merge', false), create = pref('IifCreate', true);
    const combined = merge && ready.length > 1 ? P.mergeDrafts(ready.map((g) => P.journal(b, g.stubs, S).draft)) : null;
    return (combined ? `<section class="card pr-group" data-testid="pr-combined"><div class="card-head"><h2>Combined entry <span class="badge">${ready.length} pay dates</span></h2><span class="muted small">Dated ${esc(U.fmtDate(combined.date))}, the last pay date. Untick a pay date to leave it out.</span></div><p class="muted small">Memo: ${esc(combined.memo)}</p>${jeTable(b, combined)}</section>` : '') +
      `<div class="pr-bar" data-testid="pr-bar">
        <label class="field-inline">Entries <select id="pr-merge" data-testid="pr-merge"><option value="">One per pay date</option><option value="1"${merge ? ' selected' : ''}>One combined entry for all ticked pay dates</option></select></label>
        <span class="muted small">${ready.length} ready to post${iif.length !== ready.length ? ' · ' + iif.length + ' for QuickBooks' : ''}</span>
        <span class="spacer"></span>
        <label class="check small"><input type="checkbox" id="pr-iif-create" data-testid="pr-iif-create"${create ? ' checked' : ''}> Create the accounts in QuickBooks first</label>
        <button class="btn" id="pr-iif" data-testid="pr-iif" ${iif.length ? '' : 'disabled'}>Download .iif for QuickBooks</button>
        <button class="btn primary" id="pr-postall" data-testid="pr-postall" ${ready.length ? '' : 'disabled'}>${combined ? 'Post combined entry to the books' : 'Post ' + (ready.length === 1 ? 'entry' : ready.length + ' entries') + ' to the books'}</button>
      </div>`;
  }
  function stubsView(b, S) {
    const drop = `<label class="dropzone pr-drop" id="pr-drop" data-testid="pr-drop"><input type="file" id="pr-file" multiple accept=".pdf,.PDF,.png,.PNG,.jpg,.JPG,.jpeg,.JPEG" hidden data-testid="pr-file">
      <strong>Drop paystubs and any other payroll documents here</strong> or <span class="btn small">Choose files…</span>
      <span class="muted small">Paystubs make the journal entries. Payroll summaries and registers, EFTPS deposits, Form 941, state withholding and unemployment returns and payments are recognised and cross-checked. PDF, scan or photo, read on this computer.</span></label>`;
    const setup = !S.saved ? `<div class="banner info" data-testid="pr-setup">First time for ${esc(b.company.name)}: check which accounts the entry uses in <a href="#/payroll?tab=settings">Settings</a> (VaultBook guessed them from your chart of accounts${S.accounts.wages ? ': wages to ' + esc(b.accountLabel(S.accounts.wages)) + ', withholding to ' + esc(b.accountLabel(S.accounts.fed)) : ''}). An earlier payroll entry can teach it the accounts.</div>` : '';
    const busy = st.busy ? `<p class="pr-log" data-testid="pr-log" aria-live="polite"><span class="pr-spin" aria-hidden="true"></span> ${esc(st.log || 'Reading…')}</p>` : '';
    const files = st.files.length ? `<p class="muted small" data-testid="pr-files">${st.files.map((f) => `${esc(f.name)}: ${esc(f.note)}`).join(' · ')}</p>` : '';
    const groups = groupsOf();
    if (!document.getElementById('pdc-css')) { const c = document.createElement('style'); c.id = 'pdc-css'; c.textContent = OB.paydocs.CSS; document.head.appendChild(c); }
    const check = st.docs.length ? (() => { const R = OB.paydocs.reconcile([OB.paydocs.stubDoc(st.stubs, 'Paystubs')].concat(st.docs));
      return `<details class="card pr-crosscheck" open data-testid="pr-crosscheck"><summary><h2>Cross-check of all payroll documents <span class="badge ${R.counts.diff ? 'warn' : ''}">${R.counts.ok} agree · ${R.counts.diff} differ · ${R.counts.missing} not provided</span></h2></summary>${OB.paydocs.reportHTML(R)}<div class="form-actions"><button class="btn ghost" id="pr-cleardocs">Remove the other documents</button></div></details>`; })() : '';
    return setup + drop + busy + files + check + (groups.length ? groups.map((g) => groupCard(b, S, g)).join('') + actionBar(b, S) : (st.busy ? '' : '<p class="muted">No paystubs read yet.</p>'));
  }
  function groupCard(b, S, g) {
    const j = P.journal(b, g.stubs, S), posted = st.posted[g.date] || (P.posted(b)[g.date] || [])[0];
    const s0 = g.stubs[0], freq = g.stubs.map((s) => s.frequency).filter(Boolean)[0] || '';
    const gap = P.ytdGap(b, g.stubs, S);
    const status = posted ? `<span class="qs-st qs-sent">Posted ${esc(posted.number || '')}</span>` : j.errors.length ? '<span class="qs-st qs-problem">Needs attention</span>' : '<span class="qs-st qs-sent">Ready</span>';
    return `<section class="card pr-group" data-testid="pr-group" data-date="${esc(g.date)}">
      <div class="card-head"><h2><input type="checkbox" data-skip="${esc(g.date)}" aria-label="Include this pay date" title="Include this pay date"${st.skip[g.date] ? '' : ' checked'}> Pay date ${g.date ? esc(U.fmtDate(g.date)) : '<span class="warn-text">not read</span>'}${freq ? ` <span class="badge">${esc(freq)}</span>` : ''} ${status}</h2>
        <span class="muted small">${s0.periodFrom ? 'Period ' + esc(U.fmtDate(s0.periodFrom)) + ' – ' + esc(U.fmtDate(s0.periodTo)) + ' · ' : ''}${g.stubs.length} employee${g.stubs.length === 1 ? '' : 's'}</span></div>
      ${gap && gap.message ? `<p class="small ${gap.missing ? 'warn-text' : 'muted'}" data-testid="pr-gap">${esc(gap.message)}</p>` : ''}
      <div class="pr-stubs">${g.stubs.map((s) => stubCard(s, j.employer[s.key] || {}, !!posted)).join('')}</div>
      <h3 class="pr-h3">Journal entry ${esc(j.draft.number)}</h3>
      ${jeTable(b, j.draft)}
      ${j.errors.length && !posted ? `<ul class="issues" data-testid="pr-errors">${j.errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>` : ''}
      <div class="form-actions">${posted ? `<a class="btn" href="#/txn/${esc(posted.id)}">Open ${esc(posted.number || 'entry')}</a>` : `<button class="btn primary" data-post="${esc(g.date)}" data-testid="pr-post" ${j.errors.length ? 'disabled' : ''}>Post journal entry</button>`}<button class="btn ghost" data-drop="${esc(g.date)}">Remove from this list</button></div>
    </section>`;
  }
  function stubCard(s, er, locked) {
    const k = esc(s.key), dis = locked ? 'disabled' : '';
    const lines = s.lines.map((l, i) => `<tr class="${l.subtotal ? 'muted' : ''}"><td>${esc(l.label)}${l.inferred ? ' <span class="badge warn" title="Not readable on the stub; worked out from the total">from total</span>' : ''}</td>
        <td><select data-cat="${k}|${i}" aria-label="What ${esc(l.label)} is" ${dis}>${l.category ? '' : '<option value="">Choose…</option>'}${CAT_OPTS.map(([v, t]) => `<option value="${v}"${l.category === v ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></td>
        <td class="num"><input class="pr-amt" data-amt="${k}|${i}" value="${money(l.current)}" inputmode="decimal" aria-label="${esc(l.label)} current" ${dis || (l.subtotal ? 'disabled' : '')}></td><td class="num muted">${l.ytd === null || l.ytd === undefined ? '' : UI.money(l.ytd)}</td></tr>`).join('');
    const T = s.totals, ok = !s.issues.length;
    const erRow = [['er_ss', 'Employer Social Security'], ['er_medicare', 'Employer Medicare'], ['futa', 'FUTA'], ['suta', 'SUTA']].map(([kk, l]) => `<label class="pr-er">${l} <input class="pr-amt" data-er="${k}|${kk}" value="${money(er[kk] || 0)}" inputmode="decimal" ${dis}></label>`).join('');
    return `<div class="pr-stub" data-testid="pr-stub" data-key="${k}">
      <div class="pr-stub-h"><input class="pr-name" data-name="${k}" value="${esc(s.employee)}" aria-label="Employee name" ${dis}> <input type="date" class="pr-date" data-date="${k}" value="${esc(s.payDate || '')}" aria-label="Pay date" ${dis}>
        <span class="${ok ? 'pr-ok' : 'pr-bad'} small" data-testid="pr-check">${ok ? '✓ Every figure ties (' + (s.copies > 1 ? s.copies + ' copies read' : 'read') + (s.checkAmount !== null && s.checkAmount !== undefined ? ', check ' + esc(UI.money(s.checkAmount)) : '') + ')' : '✗ ' + s.issues.length + ' to fix'}</span></div>
      <table class="data compact pr-lines"><thead><tr><th>On the stub</th><th>What it is</th><th class="num">Current</th><th class="num">YTD</th></tr></thead><tbody>${lines}
        <tr class="grand"><td colspan="2">Gross ${UI.money(T.gross || 0)} − taxes ${UI.money(T.taxes || 0)} − deductions ${UI.money(T.deductions || 0)}</td><td class="num">Net <input class="pr-amt" data-net="${k}" value="${money(T.net)}" inputmode="decimal" aria-label="Net pay" ${dis}></td><td class="num muted">${T.netYtd === null ? '' : UI.money(T.netYtd)}</td></tr></tbody></table>
      ${s.issues.length ? `<ul class="issues small">${s.issues.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      <div class="pr-ers"><span class="muted small">Employer taxes (not on the stub; worked out, change if needed):</span> ${erRow}</div></div>`;
  }
  const findStub = (key) => st.stubs.find((s) => s.key === key);
  function bindStubs(el, b, S) {
    const input = el.querySelector('#pr-file'), drop = el.querySelector('#pr-drop');
    input.addEventListener('change', (e) => { const f = [...e.target.files]; e.target.value = ''; if (f.length) readFiles(b, S, f); });
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); const f = [...e.dataTransfer.files]; if (f.length) readFiles(b, S, f); });
    el.querySelectorAll('[data-amt]').forEach((x) => x.addEventListener('change', () => { const [k, i] = x.dataset.amt.split('|'), s = findStub(k); s.lines[+i].current = parseMoney(x.value); s.lines[+i].inferred = false; P.retotal(s); UI.render(); }));
    el.querySelectorAll('[data-net]').forEach((x) => x.addEventListener('change', () => { const s = findStub(x.dataset.net); s.totals.net = parseMoney(x.value); s.issues = P.check(s); UI.render(); }));
    el.querySelectorAll('[data-er]').forEach((x) => x.addEventListener('change', () => { const [k, kk] = x.dataset.er.split('|'), s = findStub(k); s.employerOverride = Object.assign({}, s.employerOverride, { [kk]: parseMoney(x.value) || 0 }); UI.render(); }));
    el.querySelectorAll('[data-name]').forEach((x) => x.addEventListener('change', () => { const s = findStub(x.dataset.name); s.employee = x.value.trim(); s.issues = P.check(s); UI.render(); }));
    el.querySelectorAll('input[data-date]').forEach((x) => U.dateCommit(x, (v) => { const s = findStub(x.dataset.date); s.payDate = v; s.issues = P.check(s); }, () => UI.render()));
    el.querySelectorAll('[data-cat]').forEach((x) => x.addEventListener('change', () => {
      const [k, i] = x.dataset.cat.split('|'), s = findStub(k), l = s.lines[+i];
      l.category = x.value || null; l.subtotal = x.value === 'subtotal'; l.section = P.SECTION_OF[x.value] || l.section; P.retotal(s);
      if (x.value) { S.labels[P.canon(l.label)] = x.value; b.savePayroll(S).then(() => UI.toast('VaultBook will read "' + l.label + '" as ' + CAT_OPTS.find((c) => c[0] === x.value)[1] + ' on this company’s paystubs.'), UI.error); }
      UI.render();
    }));
    el.querySelectorAll('[data-drop]').forEach((x) => x.addEventListener('click', () => { st.stubs = st.stubs.filter((s) => (s.payDate || '') !== x.dataset.drop); delete st.posted[x.dataset.drop]; UI.render(); }));
    const cd = el.querySelector('#pr-cleardocs'); if (cd) cd.addEventListener('click', () => { st.docs = []; UI.render(); });
    el.querySelectorAll('[data-post]').forEach((x) => x.addEventListener('click', () => post(b, S, [x.dataset.post], x)));
    const all = el.querySelector('#pr-postall'); if (all) all.addEventListener('click', () => post(b, S, readyGroups(b, S).map((g) => g.date), all, pref('Merge', false)));
    el.querySelectorAll('[data-skip]').forEach((x) => x.addEventListener('change', () => { st.skip[x.dataset.skip] = !x.checked; UI.render(); }));
    const mg = el.querySelector('#pr-merge'); if (mg) mg.addEventListener('change', () => { setPref('Merge', !!mg.value); UI.render(); });
    const cr = el.querySelector('#pr-iif-create'); if (cr) cr.addEventListener('change', () => setPref('IifCreate', cr.checked));
    const ii = el.querySelector('#pr-iif'); if (ii) ii.addEventListener('click', () => downloadIIF(b, S));
  }
  /** QuickBooks .iif: VaultBook's own account names (Parent:Child) and types; one entry per pay date or one combined. */
  function downloadIIF(b, S) {
    let drafts = iifGroups(b, S); if (!drafts.length) return;
    const dates = drafts.map((d) => d.date).sort();
    const merged = pref('Merge', false) && drafts.length > 1; if (merged) drafts = [P.mergeDrafts(drafts)];
    const types = {}, named = drafts.map((d) => Object.assign({}, d, { jlines: d.jlines.map((l) => { const a = b.accById[l.accountId], n = b.accountFullName(a); types[n] = OB.qbexport.ACC[a.type] || 'OCLIAB';
      for (let p = a.parentId && b.accById[a.parentId]; p; p = p.parentId && b.accById[p.parentId]) types[b.accountFullName(p)] = OB.qbexport.ACC[p.type] || types[n];
      return Object.assign({}, l, { accountId: n }); }) }));
    const name = U.safeFileName(b.company.name + '_Payroll_' + dates[0] + (dates.length > 1 ? '_to_' + dates[dates.length - 1] : '') + (merged ? '_combined' : '')) + '.iif';
    U.download(name, new Blob([OB.qbexport.toAnsi(P.toIIF(named, { create: pref('IifCreate', true), types }))], { type: 'text/plain' }));
    UI.toast('Downloaded ' + name + ' (' + (merged ? 'one combined entry' : drafts.length + ' entr' + (drafts.length === 1 ? 'y' : 'ies')) + '). In QuickBooks Desktop: File › Utilities › Import › IIF Files.');
  }
  function post(b, S, dates, btn, merge) {
    btn.disabled = true;
    if (merge && dates.length > 1) {   // one combined entry for every ticked, ready pay date
      const c = P.mergeDrafts(dates.map((d) => P.journal(b, groupsOf().find((x) => x.date === d).stubs, S).draft));
      return b.saveTransaction(c).then((t) => { dates.forEach((d) => { st.posted[d] = t; }); UI.toast('Combined payroll entry for ' + dates.length + ' pay dates posted.'); if (!S.saved) { S.saved = true; return b.savePayroll(S); } }).catch(UI.error).then(() => UI.render());
    }
    const run = dates.reduce((p, d) => p.then((n) => {
      const g = groupsOf().find((x) => x.date === d), j = P.journal(b, g.stubs, S);
      if (j.errors.length) return n;
      return b.saveTransaction(j.draft).then((t) => { st.posted[d] = t; return n + 1; });
    }), Promise.resolve(0));
    run.then((n) => { UI.toast(n + ' payroll journal entr' + (n === 1 ? 'y' : 'ies') + ' posted.'); if (!S.saved) { S.saved = true; return b.savePayroll(S); } }).catch(UI.error).then(() => UI.render());
  }
  function readFiles(b, S, files) {
    st.busy = true; st.log = 'Loading the reader (first time only)…'; UI.render();
    const say = (t) => { st.log = String(t).trim(); const x = document.querySelector('[data-testid=pr-log]'); if (x) x.lastChild.textContent = ' ' + st.log; };
    UI.loadVendor(VENDOR).then(async () => {
      const E = window.OBStatement;
      for (const f of files) {
        const note = { name: f.name, note: '' };
        try {
          const { doc, how } = await OB.paydocs.readFile(f, E, { labels: S.labels }, say);
          st.docs = st.docs.filter((x) => x.name !== f.name);
          if (doc.kind === 'paystubs') doc.stubs.forEach((s) => { s.file = f.name; st.stubs = st.stubs.filter((x) => x.key !== s.key).concat([s]); });
          else st.docs.push(doc);
          note.note = doc.kind === 'paystubs' ? doc.stubs.length + ' stub' + (doc.stubs.length === 1 ? '' : 's') + ' (' + how + ')' : doc.label + (doc.state ? ' ' + doc.state : '') + (doc.period ? ' ' + doc.period : '') + ' (' + how + ')';
        } catch (e) { note.note = 'could not be read: ' + e.message; }
        st.files = st.files.filter((x) => x.name !== f.name).concat([note]);
      }
    }).catch((e) => UI.error(e)).then(() => { st.busy = false; st.log = ''; UI.render(); });
  }

  /* ---------------- settings ---------------- */
  function settingsView(b, S) {
    const accs = b.sortedAccounts((a) => a.active !== false);
    const opts = (sel, kind) => accs.filter((a) => kind === 'expense' ? ['expense', 'cogs', 'oe'].indexOf(a.type) >= 0 : kind === 'liability' ? ['ocl', 'ltl', 'cc'].indexOf(a.type) >= 0 : true)
      .map((a) => `<option value="${esc(a.id)}"${a.id === sel ? ' selected' : ''}>${esc(b.accountLabel(a.id))}</option>`).join('');
    const prior = b.posted().filter((t) => t.type === 'journal' && (t.jlines || []).some((l) => { const a = b.accById[l.accountId]; return a && /payroll|wage|salar|withh|fica|medicare/i.test(b.accountFullName(a) + ' ' + (l.memo || '')); }))
      .sort((x, y) => (x.date < y.date ? 1 : -1)).slice(0, 60);
    const E = S.employer;
    return `<section class="card"><h2>Accounts</h2><p class="muted small">Where each part of a paycheck goes. Liabilities can all be one Payroll Liabilities account or one sub-account each. Net pay to a clearing liability lets the bank feed clear it when the money leaves the bank; to a bank account if the paychecks themselves are not in the bank feed.</p>
        <table class="data compact pr-map" data-testid="pr-map"><tbody>${P.SLOTS.map(([k, l, kind]) => `<tr><td>${esc(l)}</td><td><select data-slot="${k}" aria-label="${esc(l)}"><option value="">Choose…</option>${opts(S.accounts[k], kind)}</select></td></tr>`).join('')}</tbody></table>
        <div class="form-actions"><button class="btn" id="pr-mkacc" data-testid="pr-mkacc">Create standard payroll sub-accounts</button></div></section>
      <section class="card"><h2>Learn from an earlier payroll entry</h2>
        ${prior.length ? `<p class="muted small">Pick a payroll journal entry already in the books (for example January–March). VaultBook reads which account each part went to.</p>
          <div class="form-grid cols2"><label class="field"><span>Entry</span><select id="pr-learn" data-testid="pr-learn">${prior.map((t) => `<option value="${esc(t.id)}">${esc(U.fmtDate(t.date) + ' ' + (t.number || '') + ' ' + (t.memo || '').slice(0, 60) + ' · ' + U.fmt(U.sum(t.jlines, (l) => l.debit || 0), { symbol: true }))}</option>`).join('')}</select></label>
          <div class="form-actions"><button class="btn" id="pr-learn-go" data-testid="pr-learn-go">Use its accounts</button></div></div>`
        : '<p class="muted small">No payroll journal entries in this company yet. After QuickBooks Desktop › Import everything, earlier payroll entries appear here.</p>'}</section>
      <section class="card"><h2>Employer taxes</h2>
        <label class="check"><input type="checkbox" id="pr-fica" ${E.fica ? 'checked' : ''}> Employer Social Security (matches the employee's) and Medicare (1.45% of wages; not the 0.9% additional)</label>
        <div class="form-grid cols4"><label class="field"><span>FUTA rate %</span><input id="pr-futa-r" value="${esc((E.futa || {}).rate || '')}" inputmode="decimal"></label><label class="field"><span>FUTA wage base</span><input id="pr-futa-b" value="${esc((E.futa || {}).base || '')}" inputmode="decimal"></label>
          <label class="field"><span>SUTA rate %</span><input id="pr-suta-r" value="${esc((E.suta || {}).rate || '')}" inputmode="decimal" placeholder="your state rate"></label><label class="field"><span>SUTA wage base</span><input id="pr-suta-b" value="${esc((E.suta || {}).base || '')}" inputmode="decimal"></label></div>
        <p class="muted small">FUTA and SUTA apply to each employee's wages up to the base, using the YTD on the stub. Leave a rate empty to leave it out.</p>
        <fieldset class="pr-detail"><legend>Journal lines</legend><label class="check"><input type="radio" name="pr-detail" value="employee" ${S.detail !== 'summary' ? 'checked' : ''}> One set of lines per employee</label> <label class="check"><input type="radio" name="pr-detail" value="summary" ${S.detail === 'summary' ? 'checked' : ''}> Summarised (one line per account)</label></fieldset></section>
      <section class="card"><h2>Labels VaultBook learned</h2>${Object.keys(S.labels).length ? `<table class="data compact" data-testid="pr-labels"><tbody>${Object.keys(S.labels).sort().map((k) => `<tr><td>${esc(k)}</td><td>${esc((CAT_OPTS.find((c) => c[0] === S.labels[k]) || [0, S.labels[k]])[1])}</td><td class="num"><button class="btn ghost small" data-forget="${esc(k)}">Forget</button></td></tr>`).join('')}</tbody></table>` : '<p class="muted small">None yet. When a paystub has a line VaultBook does not know, choose what it is once and it is remembered here.</p>'}</section>
      <div class="form-actions"><button class="btn primary" id="pr-save" data-testid="pr-save">Save settings</button></div>`;
  }
  function bindSettings(el, b, S) {
    el.querySelectorAll('[data-slot]').forEach((x) => x.addEventListener('change', () => { S.accounts[x.dataset.slot] = x.value; }));
    const v = (id) => el.querySelector(id).value.trim();
    const collect = () => { S.employer = { fica: el.querySelector('#pr-fica').checked, futa: { rate: v('#pr-futa-r'), base: v('#pr-futa-b') }, suta: { rate: v('#pr-suta-r'), base: v('#pr-suta-b') } }; S.detail = (el.querySelector('[name=pr-detail]:checked') || {}).value || 'employee'; };
    el.querySelector('#pr-save').addEventListener('click', () => { collect(); b.savePayroll(S).then(() => { S.saved = true; UI.toast('Payroll settings saved.'); UI.go('#/payroll'); }, UI.error); });
    el.querySelectorAll('[data-forget]').forEach((x) => x.addEventListener('click', () => { delete S.labels[x.dataset.forget]; UI.render(); }));
    const lg = el.querySelector('#pr-learn-go');
    if (lg) lg.addEventListener('click', () => {
      collect(); const t = b.txById[el.querySelector('#pr-learn').value], L = P.learnFromJournal(b, t);
      Object.assign(S.accounts, L.accounts); UI.toast('Took ' + Object.keys(L.accounts).length + ' account' + (Object.keys(L.accounts).length === 1 ? '' : 's') + ' from ' + (t.number || U.fmtDate(t.date)) + '. Check them, then Save settings.'); UI.render();
    });
    el.querySelector('#pr-mkacc').addEventListener('click', (e) => UI.busy(e.target, () => { collect(); return makeAccounts(b, S).then((n) => { UI.toast(n ? 'Created ' + n + ' payroll account' + (n === 1 ? '' : 's') + ' and chose them below. Save settings to keep.' : 'The standard payroll accounts already exist.'); UI.render(); }); }).catch(UI.error));
  }
  /** Sub-accounts under Payroll Liabilities / Payroll Expenses (only those missing), through saveAccount. */
  function makeAccounts(b, S) {
    const liab = b.accounts.find((a) => a.type === 'ocl' && /payroll liab/i.test(a.name)), exp = b.accounts.find((a) => a.type === 'expense' && /payroll exp/i.test(a.name));
    const plan = [['wages', 'expense', 'Salaries & Wages', exp], ['taxExpense', 'expense', 'Payroll Taxes', exp], ['fed', 'ocl', 'Federal Withholding', liab], ['ss', 'ocl', 'Social Security Payable', liab], ['medicare', 'ocl', 'Medicare Payable', liab],
      ['state', 'ocl', 'State Withholding', liab], ['futa', 'ocl', 'FUTA Payable', liab], ['suta', 'ocl', 'SUTA Payable', liab], ['net', 'ocl', 'Net Pay Clearing', liab]];
    let n = 0;
    return plan.reduce((p, [slot, type, name, parent]) => p.then(() => {
      const have = b.accounts.find((a) => a.name.toLowerCase() === name.toLowerCase() && a.type === type);
      if (have) { S.accounts[slot] = have.id; return; }
      return b.saveAccount({ type, name, parentId: parent ? parent.id : '' }).then((a) => { S.accounts[slot] = a.id; n++; });
    }), Promise.resolve()).then(() => n);
  }

  /* ---------------- posted ---------------- */
  function postedView(b) {
    const list = [].concat.apply([], Object.values(P.posted(b))).sort((x, y) => (x.date < y.date ? 1 : -1));
    if (!list.length) return UI.empty('No payroll journal entries from paystubs yet.');
    return `<div class="scroll-x"><table class="data compact" data-testid="pr-posted"><thead><tr><th>Pay date</th><th>Entry</th><th>Memo</th><th class="num">Amount</th></tr></thead><tbody>
      ${list.map((t) => `<tr><td>${UI.date(t.date)}</td><td>${UI.txnLink(t, t.number)}</td><td class="memo">${esc(t.memo)}</td><td class="num">${UI.money(U.sum(t.jlines, (l) => l.debit || 0))}</td></tr>`).join('')}</tbody></table></div>`;
  }
})();
