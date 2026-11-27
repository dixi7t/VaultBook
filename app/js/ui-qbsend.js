/* VaultBook — Send to QuickBooks Desktop screen (1.30): #/qbsend
 * Choose invoices and customer payments, download one batch file for "VaultBook QuickBooks.cmd", load its result back.
 * Route params: kinds (invoice,payment), range/from/to, contact, status (new|sent|problem|all), min, max. */
(function () {
  'use strict';
  const U = OB.util, UI = OB.ui, Q = OB.qbsend, esc = U.esc;
  const st = { picked: null, months: null };   // picked: Set of keys for the current list, null = all; months: Set of ticked months
  const snapKey = (b) => 'qbSnapshot:' + b.company.id;

  UI.routes.qbsend = (el, r) => {
    const b = UI.book, p = Object.assign({ kinds: 'invoice,payment,bank', status: 'new', range: 'all', tab: 'months' }, r.params || {});
    if (p.tab === 'date') return dateView(el, b, p);
    if (p.tab === 'months') return monthsView(el, b, p);
    const ranges = UI.ranges();
    if (p.range !== 'custom' && p.range !== 'all' && ranges[p.range]) { p.from = ranges[p.range][1]; p.to = ranges[p.range][2]; }
    if (p.range === 'all') { p.from = ''; p.to = ''; }
    const kinds = p.kinds.split(',').filter(Boolean);
    const cents = (v) => { const n = parseFloat(String(v || '').replace(/[^0-9.]/g, '')); return isFinite(n) ? Math.round(n * 100) : 0; };
    const list = Q.sendList(b, { kinds, from: p.from, to: p.to, contactId: p.contact || '', accountId: p.account || '', status: p.status === 'all' ? '' : p.status, min: cents(p.min), max: cents(p.max) });
    const listKey = JSON.stringify([p.kinds, p.from, p.to, p.contact, p.account, p.status, p.min, p.max]);
    if (st.listKey !== listKey) { st.listKey = listKey; st.picked = null; }
    const picked = st.picked || new Set(list.map((x) => x.key));
    const chosen = list.filter((x) => picked.has(x.key));
    const nInv = chosen.filter((x) => x.kind === 'invoice').length, nPay = chosen.filter((x) => x.kind === 'payment').length, nBank = chosen.length - nInv - nPay, total = U.sum(chosen, (x) => x.amount);
    const custs = b.contacts.slice().sort((x, y) => x.name.localeCompare(y.name));
    const moneyAccs = b.sortedAccounts((a) => a.type === 'bank' || a.type === 'cc');
    const opt = (v, cur, l) => `<option value="${esc(v)}"${String(v) === String(cur || '') ? ' selected' : ''}>${esc(l)}</option>`;
    const sentCount = Object.keys((b.company.qbSent || {})).filter((k) => b.company.qbSent[k].qbTxnId).length;
    const badge = (x) => x.status === 'Sent' ? `<span class="qs-st qs-sent" title="Sent ${esc(new Date(x.sentAt).toLocaleString())} · QuickBooks id ${esc(x.qbTxnId)}">Sent</span>` : x.status === 'Problem' ? `<span class="qs-st qs-problem" title="${esc(x.problem)}">Problem</span>` : '<span class="qs-st qs-new">Not sent</span>';
    el.innerHTML = UI.page('Send to QuickBooks Desktop',
      `<label class="btn" for="qs-result">Load result file</label><input type="file" id="qs-result" accept=".json" hidden data-testid="qs-result">
       <button class="btn primary" id="qs-download" data-testid="qs-download" ${chosen.length ? '' : 'disabled'}>Download for QuickBooks (${chosen.length})</button>`,
      tabs(p, 'items') + `<form class="toolbar wrap" id="qs-form" data-testid="qs-form">
        <fieldset class="qs-kinds"><legend class="sr-only">What to send</legend>
          <label class="check"><input type="checkbox" name="kind" value="invoice" ${kinds.includes('invoice') ? 'checked' : ''}> Invoices</label>
          <label class="check"><input type="checkbox" name="kind" value="payment" ${kinds.includes('payment') ? 'checked' : ''}> Customer payments</label>
          <label class="check"><input type="checkbox" name="kind" value="bank" data-testid="qs-kind-bank" ${kinds.includes('bank') ? 'checked' : ''}> Bank transactions</label></fieldset>
        <label>Account <select id="qs-acct" data-testid="qs-acct"><option value="">All accounts</option>${moneyAccs.map((a) => opt(a.id, p.account, b.accountLabel(a.id))).join('')}</select></label>
        <label>Period ${UI.rangeSelect('qs-range', p.range)}</label>
        <label>From <input type="date" id="qs-from" value="${esc(p.from || '')}"></label><label>To <input type="date" id="qs-to" value="${esc(p.to || '')}"></label>
        <label>Name <select id="qs-cust"><option value="">All names</option>${custs.map((c) => opt(c.id, p.contact, c.name)).join('')}</select></label>
        <label>Status <select id="qs-status" data-testid="qs-status">${opt('new', p.status, 'Not sent yet')}${opt('sent', p.status, 'Sent')}${opt('problem', p.status, 'Problems')}${opt('all', p.status, 'All')}</select></label>
        <label>Amount from <input type="text" id="qs-min" inputmode="decimal" size="9" value="${esc(p.min || '')}"></label><label>to <input type="text" id="qs-max" inputmode="decimal" size="9" value="${esc(p.max || '')}"></label>
        <button class="btn" type="submit">Show</button>
      </form>
      <p class="muted small">Tick what to send, then <strong>Download for QuickBooks</strong>. On the PC with QuickBooks Desktop open, double-click <strong>VaultBook QuickBooks.cmd</strong> (in VaultBook's <code>tools</code> folder), choose <strong>Send</strong> and pick this file: it checks every item, asks before creating any missing customer or item, records invoices first, then the payments against their invoices, then bank transactions, and saves a result file. Load that file here so each item shows as sent.${sentCount ? ` ${sentCount} item${sentCount === 1 ? '' : 's'} sent so far.` : ''}</p>
      ${list.length ? `<div class="scroll-area table-wrap"><table class="data compact qs-table" data-testid="qs-table"><thead><tr>
          <th><input type="checkbox" id="qs-all" aria-label="Select all" ${chosen.length === list.length ? 'checked' : ''}></th><th>Type</th><th>Date</th><th>No.</th><th>Name</th><th>Pays / account</th><th class="num">Amount</th><th>Status</th></tr></thead><tbody>
        ${list.map((x) => `<tr class="${picked.has(x.key) ? '' : 'inactive'}"><td><input type="checkbox" data-k="${esc(x.key)}" ${picked.has(x.key) ? 'checked' : ''} aria-label="Send ${esc(x.kind)} ${esc(x.number)}"></td>
          <td>${esc(x.label)}</td><td>${UI.date(x.date)}</td><td>${UI.txnLink(x.t, x.number || '—')}</td><td>${esc(x.customer)}</td><td class="memo">${esc(x.applied || x.account)}</td><td class="num">${UI.money(x.amount)}</td><td>${badge(x)}</td></tr>`).join('')}
        </tbody><tfoot><tr class="grand"><td></td><td colspan="5">Selected: ${nInv} invoice${nInv === 1 ? '' : 's'}, ${nPay} payment${nPay === 1 ? '' : 's'}, ${nBank} bank transaction${nBank === 1 ? '' : 's'}</td><td class="num" data-testid="qs-total">${UI.money(total)}</td><td></td></tr></tfoot></table></div>`
        : UI.empty(p.status === 'new' ? 'Nothing waiting to be sent for this choice.' : 'Nothing matches this choice.')}`,
      'Records VaultBook invoices, customer payments and bank transactions (checks, deposits, transfers, card charges, journal entries) in QuickBooks Desktop. Load a QuickBooks snapshot first and whatever QuickBooks already has shows as Sent. Nothing is written until you run the script and confirm.');
    const form = el.querySelector('#qs-form'), rangeSel = el.querySelector('#qs-range');
    rangeSel.addEventListener('change', () => { const rr = UI.ranges()[rangeSel.value]; if (rr) { el.querySelector('#qs-from').value = rr[1]; el.querySelector('#qs-to').value = rr[2]; } if (rangeSel.value === 'all') { el.querySelector('#qs-from').value = ''; el.querySelector('#qs-to').value = ''; } });
    ['#qs-from', '#qs-to'].forEach((id) => el.querySelector(id).addEventListener('change', () => { rangeSel.value = 'custom'; }));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const ks = [...form.querySelectorAll('[name=kind]:checked')].map((x) => x.value);
      if (!ks.length) return UI.toast('Tick invoices, payments or bank transactions.', 'error');
      const q = { tab: 'items', kinds: ks.join(','), range: rangeSel.value, contact: el.querySelector('#qs-cust').value, account: el.querySelector('#qs-acct').value, status: el.querySelector('#qs-status').value, min: el.querySelector('#qs-min').value.trim(), max: el.querySelector('#qs-max').value.trim() };
      if (q.range === 'custom') { q.from = el.querySelector('#qs-from').value; q.to = el.querySelector('#qs-to').value; }
      UI.go('#/qbsend?' + UI.qs(q));
    });
    const all = el.querySelector('#qs-all');
    if (all) all.addEventListener('change', () => { st.picked = all.checked ? null : new Set(); UI.render(); });
    el.querySelectorAll('[data-k]').forEach((cb) => cb.addEventListener('change', () => { const s = new Set(picked); if (cb.checked) s.add(cb.dataset.k); else s.delete(cb.dataset.k); st.picked = s; UI.render(); }));
    el.querySelector('#qs-download').addEventListener('click', () => {
      download(b, chosen.map((x) => x.key), U.today());
    });
    bindResult(el, b);
  };

  function download(b, keys, tag) {
    const batch = Q.batch(b, keys, { names: b.company.qbNames || {} }), n = (x, w) => x + ' ' + w + (x === 1 ? '' : 's');
    const co = (b.company.name || 'VaultBook').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-');
    U.download(`VaultBook-QB-${co}-${tag}.json`, new Blob([JSON.stringify(batch, null, 2)], { type: 'application/json' }));
    const left = {}; batch.skipped.forEach((x) => { left[x.type] = (left[x.type] || 0) + 1; });
    UI.toast(`${n(batch.invoices.length, 'invoice')}, ${n(batch.payments.length, 'payment')} and ${n((batch.bank || []).length, 'bank transaction')} saved. On the QuickBooks PC, run VaultBook QuickBooks.cmd › Send and choose this file.` +
      (batch.skipped.length ? ` Left out (the connector cannot record these yet): ${Object.keys(left).map((k) => left[k] + ' ' + ((OB.schema.TXN_TYPES[k] || {}).label || k)).join(', ')}.` : ''), batch.skipped.length ? 'error' : undefined);
  }
  const tabs = (p, cur) => `<div class="segmented qs-tabs" role="tablist"><a role="tab" class="btn-tab" aria-selected="${cur === 'date'}" href="#/qbsend?tab=date" data-testid="qs-tab-date">By date</a><a role="tab" class="btn-tab" aria-selected="${cur === 'months'}" href="#/qbsend?tab=months" data-testid="qs-tab-months">Months</a><a role="tab" class="btn-tab" aria-selected="${cur === 'items'}" href="#/qbsend?${UI.qs(Object.assign({}, p, { tab: 'items' }))}" data-testid="qs-tab-items">Items</a></div>`;

  /** Load result file / snapshot: both are JSON from the connector; the format field says which. */
  /** One loader for every connector file: a snapshot (months), a result (sent / problems) or a full export (import). */
  UI.qbLoadFile = (b, f) => new Promise((resolve) => {
    const rd = new FileReader();
    rd.onload = () => {
      const text = String(rd.result);
      let data; try { data = JSON.parse(text); } catch (err) { UI.toast('That is not a VaultBook QuickBooks file.', 'error'); return resolve(); }
      if (data && data.format === 'vaultbook-qb-full') { UI.migrateFiles([f]).then(resolve, (e) => { UI.error(e); resolve(); }); return; }
      if (data && data.format === 'vaultbook-qb-snapshot') {
        let cmp; try { cmp = OB.qbsync.compare(b, data); } catch (err) { UI.toast(err.message, 'error'); return resolve(); }
        OB.prefs.set(snapKey(b), data); st.months = null;
        OB.qbsync.remember(b, cmp).then((n) => { UI.toast(`QuickBooks snapshot loaded: ${data.txns.length} transaction${data.txns.length === 1 ? '' : 's'}${n ? `, ${n} matched to VaultBook entries` : ''}.${cmp.warning ? ' ' + cmp.warning : ''}`, cmp.warning ? 'error' : undefined); UI.go('#/qbsend?tab=months'); UI.render(); resolve(); }).catch((e) => { UI.error(e); resolve(); });
        return;
      }
      Q.applyResult(b, data).then((res) => { UI.toast(`${res.sent} item${res.sent === 1 ? '' : 's'} marked as sent${res.problems ? `, ${res.problems} with problems (Items › Status: Problems)` : ''}.`); UI.render(); resolve(); }).catch((e) => { UI.error(e); resolve(); });
    };
    rd.readAsText(f);
  });
  UI.qbSnapshot = (b) => OB.prefs.get(snapKey(b));
  function bindResult(el, b) {
    el.querySelector('#qs-result').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) UI.qbLoadFile(b, f); e.target.value = ''; });
  }

  /**
   * 1.61: hand the entries to the QuickBooks tool in parts (Q.chunks), each in a fresh QuickBooks session, with a short
   * rest between parts. The tool asks its question for the first part only. Each part's result is saved at once, so a
   * stop loses nothing: Send again goes on with what is left. Progress lives in st.run and survives leaving the screen.
   */
  function runSend(b, r, code) {
    const parts = Q.chunks(r), run = st.run = { co: b.company.id, total: r.keys.length, done: 0, recorded: 0, dup: 0, prob: 0, state: 'running' };
    const show = () => { if (UI.parseHash().name === 'qbsend') UI.render(); }, wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
    let i = 0;
    const next = () => {
      if (i >= parts.length) { run.state = 'done'; run.at = new Date().toISOString(); return null; }
      if (run.halt) { run.state = 'halted'; return null; }
      const part = parts[i], text = OB.qbupdate.toText(Q.batch(b, part, { names: b.company.qbNames || {} }));
      return UI.qbLink('/run', { code, action: 'apply', batchText: text, yes: i > 0 }).then((res) => {
        if (res.format !== 'vaultbook-qb-result') throw new Error(res.error || 'The tool did not send a result.');
        const sum = Q.resultSummary(res);
        return Q.applyResult(b, res).then(() => {
          run.done += part.length; run.recorded += sum.recorded; run.dup += sum.dup; run.prob += sum.prob;
          if (sum.stopped) { run.state = 'stopped'; return null; }
          if (sum.declined) { run.state = 'declined'; return null; }
          i++; show(); return wait(i < parts.length ? Q.REST_MS : 0).then(next);
        });
      });
    };
    show();
    return UI.qbLink('/hello').then((h) => { run.old = !(parseFloat(h && h.version) >= 1.61); }).then(next).catch((e) => { run.state = 'error'; run.msg = e.message; }).then(show);
  }

  /** By date tab (1.58, 1.59): choose the dates, then send straight to the connected QuickBooks tool or download the file. */
  const PERIODS = [['since', 'From a date onward'], ['day', 'One day'], ['last12', 'Last 12 months'], ['fyToDate', 'This fiscal year to date'], ['lastFY', 'Last fiscal year'], ['thisMonth', 'This month'], ['lastMonth', 'Last month'], ['custom', 'Custom period']];
  function dateView(el, b, p) {
    const pref = 'qbFrom:' + b.company.id, isDay = (v) => /^\d{4}-\d\d-\d\d$/.test(v || ''), today = U.today();
    let saved = OB.prefs.get(pref); if (typeof saved === 'string') saved = { per: 'since', from: saved };   // 1.58 kept the date alone
    saved = saved || {};
    const per = PERIODS.some((x) => x[0] === p.per) ? p.per : isDay(p.from) ? 'since' : saved.per || 'since';
    let from = isDay(p.from) ? p.from : isDay(saved.from) ? saved.from : today.slice(0, 4) + '-01-01', to = isDay(p.to) ? p.to : isDay(saved.to) ? saved.to : today;
    if (per === 'since') to = ''; else if (per === 'day') to = from; else if (per !== 'custom') { const rr = UI.ranges()[per]; from = rr[1]; to = rr[2]; }
    if (to && to < from) to = from;
    const r = Q.fromDate(b, from, to), row = (label, n, cls) => `<tr${cls ? ` class="${cls}"` : ''}><td>${label}</td><td class="num">${n}</td></tr>`;
    const left = Object.keys(r.left).map((k) => r.left[k] + ' ' + ((OB.schema.TXN_TYPES[k] || {}).label || k).toLowerCase()).join(', ');
    // 1.62: the bank transactions of the period as one .iif (File > Utilities > Import > IIF Files in QuickBooks)
    const bankIds = r.items.filter((x) => x.kind === 'bank').map((x) => x.id), ask = st.iif && st.iif.co === b.company.id ? st.iif : null;
    const iifAsk = !ask ? '' : `<div class="banner warn qs-run" role="status" data-testid="qs-iif-ask"><span>${ask.done ? `<strong>${ask.done}</strong> bank transaction${ask.done === 1 ? '' : 's'} marked as in QuickBooks.` : `Saved <strong>${esc(ask.file)}</strong> with ${ask.keys.length} bank transaction${ask.keys.length === 1 ? '' : 's'}. In QuickBooks: File › Utilities › Import › IIF Files. Did QuickBooks import it without errors?`}</span>
      ${ask.done ? '<button class="btn small" id="qs-iif-ok" data-testid="qs-iif-ok">OK</button>' : '<button class="btn small primary" id="qs-iif-yes" data-testid="qs-iif-yes">Yes, mark them as in QuickBooks</button><button class="btn small" id="qs-iif-no" data-testid="qs-iif-no">No</button>'}</div>`;
    const typed = per === 'since' || per === 'day' || per === 'custom', run = st.run && st.run.co === b.company.id ? st.run : null, busy = !!run && run.state === 'running';
    const tally = run ? `<strong>${run.recorded}</strong> recorded, <strong>${run.dup}</strong> already there and skipped, <strong>${run.prob}</strong> with problems${run.prob ? ` (<a href="#/qbsend?tab=items&amp;status=problem&amp;range=all">see them</a>)` : ''}` : '';
    const runLine = !run ? '' : `<div class="banner ${{ running: 'info', done: 'ok', halted: 'info' }[run.state] || 'warn'} qs-run" role="status" data-testid="qs-run"><span>${{
      running: `Sending to QuickBooks: ${run.done} of ${run.total} handed over. ${tally}.${run.old ? ' This copy of the QuickBooks tool is older and asks before every part; the tools folder of this version asks once.' : ''}`,
      done: `Finished ${esc(new Date(run.at).toLocaleString())}: ${tally}.`,
      halted: `Stopped at your request: ${tally}. Send again to go on.`,
      declined: `Nothing more was recorded: the question in the QuickBooks tool was answered No. So far: ${tally}.`,
      stopped: `QuickBooks stopped answering. So far: ${tally}. Reopen QuickBooks and the company file, choose Window › Close All, then press Send again: what is already recorded is skipped.`,
      error: `${esc(run.msg || 'The send did not finish.')} So far: ${tally}. If QuickBooks closed, reopen it and the company file, then press Send again.` }[run.state]}</span>${busy ? '<button class="btn small" id="qs-halt" data-testid="qs-halt">Stop after this part</button>' : ''}</div>`;
    el.innerHTML = UI.page('Send to QuickBooks Desktop',
      `<a class="btn" href="vaultbook-qb://link" data-testid="qs-open">Open the QuickBooks tool</a>
       <label class="btn" for="qs-result">Load snapshot or result file</label><input type="file" id="qs-result" accept=".json" hidden data-testid="qs-result">`,
      tabs(p, 'date') + `<div class="toolbar wrap">
        <label>Send <select id="qs-per" data-testid="qs-per">${PERIODS.map(([k, t]) => `<option value="${k}"${k === per ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
        ${typed ? `<label>${per === 'day' ? 'Date' : 'From'} <input type="date" id="qs-since" data-testid="qs-since" value="${esc(from)}"></label>` : `<span data-testid="qs-range">${esc(U.fmtDate(from))} – ${esc(U.fmtDate(to))}</span>`}
        ${per === 'custom' ? `<label>To <input type="date" id="qs-until" data-testid="qs-until" value="${esc(to)}"></label>` : ''}</div>
      <div class="table-wrap qs-since"><table class="data compact" data-testid="qs-since-table"><tbody>
        ${row('Invoices', r.counts.invoice)}${row('Customer payments', r.counts.payment)}${row('Bank transactions', r.counts.bank)}
        ${r.extra.length ? row('Earlier invoices these payments pay', r.extra.length) : ''}
        ${row('To send', r.keys.length, 'grand')}
        ${row('Already in QuickBooks, left out', r.already)}
        ${left ? row('Cannot be sent yet: ' + esc(left), U.sum(Object.keys(r.left), (k) => r.left[k])) : ''}
      </tbody></table></div>
      <div class="toolbar wrap qs-go"><label>Link code <input id="qs-code" data-testid="qs-code" inputmode="numeric" maxlength="6" autocomplete="off" size="7" value="${esc(st.code || '')}"></label>
        <button class="btn primary" id="qs-send" data-testid="qs-send" ${r.keys.length && !busy ? '' : 'disabled'}>Send to QuickBooks now (${r.keys.length})</button>
        <button class="btn" id="qs-download" data-testid="qs-download" ${r.keys.length ? '' : 'disabled'}>Download the file instead</button>
        <button class="btn" id="qs-iif" data-testid="qs-iif" ${bankIds.length && !busy ? '' : 'disabled'}>Download bank transactions as .iif (${bankIds.length})</button></div>
      ${iifAsk}
      ${runLine}`);
    const $ = (q) => el.querySelector(q);
    const go = () => { const q = { tab: 'date', per: $('#qs-per').value }, f = $('#qs-since'), u = $('#qs-until');
      if (q.per === 'since' || q.per === 'day' || q.per === 'custom') q.from = (f && f.value) || from;
      if (q.per === 'custom') q.to = (u && u.value) || to || today;
      OB.prefs.set(pref, { per: q.per, from: q.from || from, to: q.to || '' }); UI.go('#/qbsend?' + UI.qs(q)); };
    $('#qs-per').addEventListener('change', go);
    ['#qs-since', '#qs-until'].forEach((q) => { if ($(q)) U.dateCommit($(q), () => {}, go); });
    $('#qs-download').addEventListener('click', () => download(b, r.keys, (to ? from + '_' + to : 'from-' + from)));
    $('#qs-iif').addEventListener('click', () => {
      const out = OB.qbexport.txnsIIF(b, bankIds, { names: b.company.qbNames || {} }), co = (b.company.name || 'VaultBook').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-');
      const file = `${co}-bank-${to ? from + '_' + to : 'from-' + from}.iif`;
      U.download(file, new Blob([OB.qbexport.toAnsi(out.text)], { type: 'text/plain' }));
      st.iif = { co: b.company.id, keys: bankIds.slice(), file }; UI.render();
    });
    if ($('#qs-iif-yes')) $('#qs-iif-yes').addEventListener('click', () => UI.busy($('#qs-iif-yes'), () => Q.markIIF(b, st.iif.keys).then((n) => { st.iif.done = n; UI.render(); })));
    if ($('#qs-iif-no')) $('#qs-iif-no').addEventListener('click', () => { st.iif = null; UI.render(); });
    if ($('#qs-iif-ok')) $('#qs-iif-ok').addEventListener('click', () => { st.iif = null; UI.render(); });
    if ($('#qs-halt')) $('#qs-halt').addEventListener('click', () => { st.run.halt = true; $('#qs-halt').disabled = true; });
    $('#qs-send').addEventListener('click', () => {
      const code = $('#qs-code').value.trim(); if (!/^\d{6}$/.test(code)) return UI.toast('Type the 6-digit link code the QuickBooks tool shows.', 'warn');
      st.code = code; runSend(b, r, code);
    });
    bindResult(el, b);
  }

  /** Months tab: what QuickBooks has per month (from the snapshot) against VaultBook; tick months, download the gap. */
  function monthsView(el, b, p) {
    const snap = OB.prefs.get(snapKey(b));
    let cmp = null, err = '';
    if (snap) { try { cmp = OB.qbsync.compare(b, snap); } catch (e) { err = e.message; } }
    const head = `<label class="btn" for="qs-result">Load snapshot or result file</label><input type="file" id="qs-result" accept=".json" hidden data-testid="qs-result">`;
    if (!cmp) {
      el.innerHTML = UI.page('Send to QuickBooks Desktop', head, tabs(p, 'months') + `<div class="empty"><p><strong>Start by reading QuickBooks.</strong></p>
        <p>On the PC with QuickBooks Desktop open, double-click <strong>VaultBook QuickBooks.cmd</strong> (in VaultBook's <code>tools</code> folder) and choose <strong>5 What QuickBooks has</strong>. It saves a snapshot file (nothing is written to QuickBooks). Then click <strong>Load snapshot or result file</strong> here and choose it.</p>
        <p class="muted small">The Months tab then shows, month by month, what QuickBooks already has and what is still only in VaultBook, so you send only the gap, in any order. ${err ? `<br><span class="warn-text">${esc(err)}</span>` : ''}Prefer to pick items yourself? Use the <a href="#/qbsend?tab=items">Items</a> tab.</p></div>`,
        'Records VaultBook transactions in QuickBooks Desktop. Nothing is written until you run the script and confirm.');
      bindResult(el, b); return;
    }
    const months = cmp.months.filter((m) => m.state !== 'Empty');
    const sendable = months.filter((m) => m.missing);
    const picked = st.months || new Set();
    const gap = OB.qbsync.gap(b, cmp, [...picked]);
    const stCls = { Done: 'qs-sent', 'Not in QuickBooks': 'qs-new', Partly: 'qs-part', 'QuickBooks only': 'qs-qb' };
    const at = snap.at ? new Date(snap.at).toLocaleString() : '';
    el.innerHTML = UI.page('Send to QuickBooks Desktop',
      head + `<button class="btn primary" id="qs-download" data-testid="qs-download" ${gap.keys.length ? '' : 'disabled'}>Download for QuickBooks (${gap.keys.length})</button>`,
      tabs(p, 'months') + `<p class="muted small">QuickBooks read ${esc(at)}${snap.from ? ` · ${esc(U.fmtDate(snap.from))} – ${esc(U.fmtDate(snap.to))}` : ''} · ${cmp.matched.length} matched, <strong>${cmp.missing.length} only in VaultBook</strong>, ${cmp.qbOnly.length} only in QuickBooks.${cmp.warning ? ` <span class="warn-text">${esc(cmp.warning)}</span>` : ''} Tick the months to send, in any order. Read QuickBooks again after sending to see them as Done.</p>
      <div class="scroll-area table-wrap"><table class="data compact qs-months" data-testid="qs-months"><thead><tr><th><input type="checkbox" id="qs-mall" aria-label="Select every month with something to send" ${sendable.length && sendable.every((m) => picked.has(m.month)) ? 'checked' : ''}></th><th>Month</th><th class="num">In QuickBooks</th><th class="num">In VaultBook</th><th class="num">Matched</th><th class="num">Only in VaultBook</th><th class="num">Only in QuickBooks</th><th>State</th></tr></thead><tbody>
        ${months.map((m) => `<tr data-month="${m.month}" class="${picked.has(m.month) ? '' : 'inactive'}"><td>${m.missing ? `<input type="checkbox" data-m="${m.month}" ${picked.has(m.month) ? 'checked' : ''} aria-label="Send ${esc(m.label)}">` : ''}</td><td>${esc(m.label)}</td><td class="num">${m.qb}</td><td class="num">${m.vb}</td><td class="num">${m.matched}</td><td class="num">${m.missing ? `<a href="#/qbsend?${UI.qs({ tab: 'items', range: 'custom', from: m.month + '-01', to: U.monthEnd(m.month + '-01'), status: 'new', kinds: 'invoice,payment' })}" title="Open these in Items">${m.missing}</a>` : '0'}</td><td class="num">${m.qbOnly}</td><td><span class="qs-st ${stCls[m.state] || ''}">${esc(m.state)}</span></td></tr>`).join('')}
        </tbody></table></div>
      ${gap.keys.length ? `<p class="small" data-testid="qs-gap">Will send <strong>${gap.items.length}</strong> item${gap.items.length === 1 ? '' : 's'} from the ticked month${picked.size === 1 ? '' : 's'}${gap.extra.length ? `, plus ${gap.extra.length} from other months that these payments pay: ${gap.extra.map((x) => esc((x.t.type === 'bill' ? 'bill ' : 'invoice ') + (x.number || U.fmtDate(x.t.date)) + ' (' + x.month + ')')).join(', ')}` : ''}.</p>` : ''}
      <p class="muted small">Matched = the same transaction in both (by the id the connector wrote, or by type, date, number and amount). Only in QuickBooks = entered there by hand or not yet imported into VaultBook; nothing is sent for those. Partly = some of the month is in QuickBooks.</p>`,
      'Records VaultBook transactions in QuickBooks Desktop. Nothing is written until you run the script and confirm.');
    const all = el.querySelector('#qs-mall');
    if (all) all.addEventListener('change', () => { st.months = all.checked ? new Set(sendable.map((m) => m.month)) : new Set(); UI.render(); });
    el.querySelectorAll('[data-m]').forEach((cb) => cb.addEventListener('change', () => { const s2 = new Set(picked); if (cb.checked) s2.add(cb.dataset.m); else s2.delete(cb.dataset.m); st.months = s2; UI.render(); }));
    el.querySelector('#qs-download').addEventListener('click', () => {
      download(b, gap.keys, [...picked].sort().join('_') || U.today());
    });
    bindResult(el, b);
  }
})();
