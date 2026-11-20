/* VaultBook — Update QuickBooks to match VaultBook (1.47): #/qbd/update
 * 1 what QuickBooks has now: a fresh export from the connected tool (the link on 127.0.0.1) or a loaded export file;
 * 2 what will change: edits, voids and new accounts worked out by OB.qbupdate.plan;
 * 3 send them to the tool (you answer Y/N in its window) or download the update file; then compare again.
 * The comparison is in js/qbupdate.js; this file only shows it and moves files. */
(function () {
  'use strict';
  const U = OB.util, UI = OB.ui, QU = OB.qbupdate, esc = U.esc;
  const PORT = 47321, URL = 'http://127.0.0.1:' + PORT;
  let up = null;   // { companyId, full, source, plan, result, code, linked, busy } — kept while the app is open
  const fresh = (b) => ({ companyId: b.company.id, full: null, source: '', plan: null, result: null, code: '', linked: false, q: '' });
  const when = (iso) => iso ? new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '';

  /** One request to the connected tool. The body is plain text, so the browser sends it without a preflight. */
  function link(path, body) {
    const o = body ? { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'text/plain' } } : { method: 'GET' };
    return fetch(URL + path, o).then((r) => r.text().then((t) => {
      let j = null; try { j = JSON.parse(t); } catch (e) { /* not JSON */ }
      if (!r.ok) throw new Error((j && j.error) || ('The tool answered ' + r.status + '.'));
      if (!j) throw new Error('The tool sent something VaultBook cannot read.');
      return j;
    }), () => { throw new Error('VaultBook cannot reach the QuickBooks tool. Open it (Open the QuickBooks tool, or VaultBook QuickBooks.cmd › 7 Connect to VaultBook) and keep its window open.'); });
  }
  UI.qbLink = link;

  function plan(b) { try { up.plan = up.full ? QU.plan(b, up.full) : null; up.err = ''; } catch (e) { up.plan = null; up.err = e.message; } }

  UI.qbUpdate = (el, b) => {
    if (!up || up.companyId !== b.company.id) up = fresh(b);
    if (up.full && !up.plan && !up.err) plan(b);
    const p = up.plan, kinds = { check: 'Check', deposit: 'Deposit', journal: 'Journal entry' };
    const n = p ? { edits: p.updates.length, voids: p.voids.length, acc: Object.keys(p.accounts).length, skip: p.skipped.length } : null;
    const q = (up.q || '').toLowerCase(), shown = p ? p.updates.filter((u) => !q || (u.label + ' ' + u.what.join(' ')).toLowerCase().indexOf(q) >= 0) : [];
    const res = up.result, resItems = res ? (res.items || []) : [], cnt = (s) => resItems.filter((x) => x.status === s).length;
    el.innerHTML = UI.page('Update QuickBooks', `<a class="btn" href="vaultbook-qb://link" data-testid="qu-open">Open the QuickBooks tool</a>
        <label class="btn" for="qu-file">Load a QuickBooks export…</label><input type="file" id="qu-file" accept=".json,.JSON" hidden data-testid="qu-file">`,
      `<section class="card qu-step" data-testid="qu-step1"><h2>1. What QuickBooks has now</h2>
        ${up.full ? `<p data-testid="qu-source">QuickBooks export of <strong>${esc(when(up.full.at))}</strong> (${esc(up.source)}), ${U.sum(Object.keys(up.full.txns || {}), (k) => (up.full.txns[k] || []).length)} transactions.</p>` : '<p class="muted">Nothing loaded yet.</p>'}
        <div class="qu-ways">
          <div><h3>Connected to the tool</h3>
            <p class="small muted">On the QuickBooks computer, click <strong>Open the QuickBooks tool</strong> (or run VaultBook QuickBooks.cmd › <strong>7 Connect to VaultBook</strong>). Type the link code it shows.</p>
            <div class="toolbar"><label class="field inline"><span>Link code</span><input id="qu-code" inputmode="numeric" maxlength="6" autocomplete="off" value="${esc(up.code)}" data-testid="qu-code" style="width:7rem"></label>
              <button class="btn primary" id="qu-get" data-testid="qu-get">${up.linked ? 'Get a fresh export' : 'Connect and get the export'}</button>
              ${up.linked ? '<span class="badge ok" data-testid="qu-linked">Connected</span>' : ''}</div></div>
          <div><h3>Or with a file</h3>
            <p class="small muted">Run VaultBook QuickBooks.cmd › <strong>5 Export everything</strong>, then <strong>Load a QuickBooks export</strong> above and choose the <code>VaultBook-QB-full-….json</code>.</p></div>
        </div>
        ${up.err ? `<p class="warn-text">${esc(up.err)}</p>` : ''}</section>
      ${p ? `<section class="card qu-step" data-testid="qu-step2"><h2>2. What will change in QuickBooks</h2>
        <div class="cl-stats"><div><b data-testid="qu-n-edits">${n.edits}</b><span>edits</span></div><div><b data-testid="qu-n-voids">${n.voids}</b><span>voids</span></div><div><b>${n.acc}</b><span>new accounts</span></div><div><b>${p.linked}</b><span>linked transactions</span></div><div><b>${p.qbOnly}</b><span>only in QuickBooks (left alone)</span></div></div>
        ${n.acc ? `<p>Accounts QuickBooks gets first: ${Object.keys(p.accounts).map((k) => `<strong>${esc(k)}</strong> (${esc(p.accounts[k])})`).join(', ')}.</p>` : ''}
        ${n.skip ? `<details><summary>${n.skip} not changed by VaultBook (change them in QuickBooks)</summary><ul class="small">${p.skipped.slice(0, 50).map((s) => `<li>${esc(s.label)}: ${esc(s.why)}</li>`).join('')}</ul></details>` : ''}
        ${n.edits || n.voids ? `<div class="toolbar"><input type="search" id="qu-q" placeholder="Search the changes…" value="${esc(up.q)}" aria-label="Search the changes"></div>
          <div class="scroll-x"><table class="data compact" data-testid="qu-table"><thead><tr><th>Change</th><th>Transaction</th><th>What changes</th></tr></thead><tbody>
          ${p.voids.map((v) => `<tr><td><span class="badge warn">Void</span></td><td>${esc(v.label)}</td><td class="small">voided in VaultBook</td></tr>`).join('')}
          ${shown.slice(0, 400).map((u) => `<tr><td>${esc(kinds[u.kind])}</td><td><a href="#/txn/${esc(u.key)}">${esc(u.label)}</a></td><td class="small">${esc(u.what.join('; '))}</td></tr>`).join('')}</tbody></table></div>
          ${shown.length > 400 ? `<p class="muted small">Showing 400 of ${shown.length}; search to narrow.</p>` : ''}`
          : '<p data-testid="qu-nothing"><strong>QuickBooks already matches VaultBook.</strong> Nothing to change.</p>'}</section>
      ${n.edits || n.voids || n.acc ? `<section class="card qu-step" data-testid="qu-step3"><h2>3. Update QuickBooks</h2>
        <p>Make a QuickBooks backup first. The tool shows the list and asks Y/N before it changes anything; voids are asked separately. An entry changed in QuickBooks after this export is refused, never overwritten. Nothing is deleted.</p>
        <div class="form-actions"><button class="btn primary" id="qu-send" data-testid="qu-send" ${up.linked ? '' : 'disabled'}>Send to the tool (${n.edits + n.voids})</button>
          <button class="btn" id="qu-dl" data-testid="qu-dl">Download the update file</button></div>
        <p class="muted small">With the file: run VaultBook QuickBooks.cmd › <strong>4 Check only</strong> first if you like, then <strong>2 Send to QuickBooks</strong>, and choose the file.</p></section>` : ''}` : ''}
      ${res ? `<section class="card qu-step" data-testid="qu-result"><h2>What QuickBooks did</h2>
        <div class="cl-stats"><div><b data-testid="qu-r-upd">${cnt('Updated')}</b><span>changed</span></div><div><b>${cnt('Voided')}</b><span>voided</span></div><div><b data-testid="qu-r-prob">${cnt('Problem')}</b><span>problems</span></div><div><b>${cnt('Ready')}</b><span>not done</span></div></div>
        ${cnt('Problem') ? `<ul class="small">${resItems.filter((x) => x.status === 'Problem').slice(0, 50).map((x) => `<li>${esc(x.label)}: ${esc(x.details)}</li>`).join('')}</ul>` : ''}
        <p>${up.linked ? 'Get a fresh export (step 1) to confirm QuickBooks now matches: the number of edits should be 0.' : 'Export from QuickBooks again and load it here to confirm the edits are 0.'}</p></section>` : ''}`,
      'Make QuickBooks Desktop match the changes you made in VaultBook: reclassified lines, amounts, memos, dates, payees and voids. Only what differs is sent.');
    bind(el, b);
  };

  function bind(el, b) {
    const $ = (s) => el.querySelector(s), re = () => UI.render();
    const code = () => { up.code = (($('#qu-code') || {}).value || '').trim(); if (!/^\d{6}$/.test(up.code)) { UI.toast('Type the 6-digit link code the tool shows.', 'warn'); return ''; } return up.code; };
    const f = $('#qu-file');
    if (f) f.addEventListener('change', (e) => {
      const file = e.target.files[0]; e.target.value = ''; if (!file) return;
      const rd = new FileReader();
      rd.onload = () => { let d = null; try { d = JSON.parse(String(rd.result)); } catch (err) { /* below */ }
        if (!d || d.format !== 'vaultbook-qb-full') { UI.toast('Choose the full QuickBooks export (VaultBook-QB-full-….json).', 'error'); return; }
        up.full = d; up.source = file.name; up.plan = null; up.err = ''; up.result = null; re(); };
      rd.readAsText(file);
    });
    const get = $('#qu-get');
    if (get) get.addEventListener('click', () => { if (!code()) return;
      UI.busy(get, () => link('/hello').then(() => link('/run', { code: up.code, action: 'export' })).then((d) => {
        if (d.format !== 'vaultbook-qb-full') throw new Error(d.error || 'The tool did not send a QuickBooks export.');
        up.linked = true; up.full = d; up.source = 'from the connected tool'; up.plan = null; up.err = ''; re();
        UI.toast('Fresh export received from QuickBooks.');
      }).catch((e) => { up.err = e.message; re(); }));
    });
    const qi = $('#qu-q'); if (qi) qi.addEventListener('input', () => { up.q = qi.value; clearTimeout(up.t); up.t = setTimeout(() => { re(); const x = document.getElementById('qu-q'); if (x) { x.focus(); x.setSelectionRange(x.value.length, x.value.length); } }, 250); });
    const batchText = () => QU.toText(QU.batch(b, up.plan));
    const dl = $('#qu-dl');
    if (dl) dl.addEventListener('click', () => {
      const safe = b.company.name.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'company';
      U.download('VaultBook-QB-update-' + safe + '-' + U.today() + '.json', batchText(), 'application/json');
    });
    const send = $('#qu-send');
    if (send) send.addEventListener('click', () => { if (!code()) return;
      UI.busy(send, () => link('/run', { code: up.code, action: 'apply', batchText: batchText() }).then((r) => {
        if (r.format !== 'vaultbook-qb-result') throw new Error(r.error || 'The tool did not send a result.');
        up.result = r; re();
        const prob = (r.items || []).filter((x) => x.status === 'Problem').length;
        UI.toast(`QuickBooks: ${(r.items || []).filter((x) => x.status === 'Updated').length} changed, ${(r.items || []).filter((x) => x.status === 'Voided').length} voided${prob ? `, ${prob} problems` : ''}.`, prob ? 'warn' : undefined);
      }).catch((e) => { up.err = e.message; re(); }));
    });
  }
})();
