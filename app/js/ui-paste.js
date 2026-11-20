/* VaultBook — Paste entries page (1.48.0): an Excel-like grid on one ledger. Paste rows from Excel (Ctrl+V), change
 * what differs, repeat them for more months, then post them all. Accounting is in js/paste.js. */
(function () {
  'use strict';
  const U = OB.util, UI = OB.ui, S = OB.schema, P = OB.paste, esc = U.esc;
  const COLS = P.COLS, BLANK = 5;
  let ps = null;   // page state while the app is open
  const blank = () => { const r = {}; COLS.forEach((f) => { r[f] = ''; }); return r; };
  const used = (r) => COLS.some((f) => String(r[f] || '').trim());
  const fresh = (b) => ({ companyId: b.company.id, ledgerId: '', rows: [], sel: {}, choice: {}, result: null });
  function pad() { // always a few empty rows at the bottom to type or paste into
    let n = ps.rows.length; while (n && !used(ps.rows[n - 1])) n--;
    ps.rows.length = n; for (let i = 0; i < BLANK; i++) ps.rows.push(blank());
  }
  function opts() {
    const o = { map: {}, types: {} };
    Object.keys(ps.choice).forEach((k) => { const v = ps.choice[k]; if (v.startsWith('acc:')) o.map[k] = v.slice(4); else if (v.startsWith('type:')) o.types[k] = v.slice(5); });
    return o;
  }
  const show = (f, v) => f === 'date' && U.isDate(v) ? U.fmtDate(v) : v;
  const cell = (i, f) => `<td><input data-r="${i}" data-f="${f}" value="${esc(show(f, ps.rows[i][f]))}"${f === 'type' ? ' list="pe-dl-type"' : f === 'split' ? ' list="pe-dl-acc"' : f === 'name' ? ' list="pe-dl-name"' : ''}${f === 'debit' || f === 'credit' ? ' class="num" inputmode="decimal"' : ''} aria-label="${esc(P.LABELS[f])} row ${i + 1}" autocomplete="off"></td>`;
  const rowHtml = (i) => `<tr data-r="${i}"><td class="pe-c"><input type="checkbox" class="pe-sel" data-r="${i}"${ps.sel[i] ? ' checked' : ''} aria-label="Select row ${i + 1}"></td><td class="pe-n">${i + 1}</td>${COLS.map((f) => cell(i, f)).join('')}<td class="pe-st" data-st="${i}"></td></tr>`;

  UI.routes.paste = (el, r) => {
    const b = UI.book;
    if (!ps || ps.companyId !== b.company.id) ps = fresh(b);
    if (r.params.account && b.accById[r.params.account]) ps.ledgerId = r.params.account;
    pad();
    const led = b.accById[ps.ledgerId];
    el.innerHTML = UI.page('Paste entries', led ? `<a class="btn" href="#/register/${esc(led.id)}">Open the ledger</a>` : '', `
      <div class="pe-top">
        <label class="field"><span>Ledger</span><select id="pe-led" data-testid="pe-ledger">${UI.accountOptions(ps.ledgerId, null, { blankLabel: 'Choose the ledger…' })}</select></label>
        <p class="hint">One amount over several accounts: <code>Rent A 2000; Rent B 2000; Rent C</code> or <code>Rent A 20%; Rent B 80%</code> in Split.</p>
      </div>
      <div id="pe-result">${ps.result ? resultHtml(b) : ''}</div>
      <div class="toolbar pe-tools">
        <button class="btn small" id="pe-repeat" data-testid="pe-repeat">Repeat monthly</button>
        <label class="pe-months">for <input type="number" id="pe-months" min="1" max="36" value="${ps.months || 1}" aria-label="Months to repeat"> more month(s)</label>
        <button class="btn small" id="pe-join" data-testid="pe-join">Join into one entry</button><button class="btn small" id="pe-del">Delete rows</button><button class="btn small" id="pe-add">Add 10 rows</button><button class="btn small" id="pe-clear">Clear</button>
      </div>
      <div id="pe-missing"></div>
      <div class="pe-wrap"><table class="pe-grid" id="pe-grid" data-testid="pe-grid">
        <colgroup><col class="pe-c"><col class="pe-n"><col style="width:8.5%"><col style="width:7.5%"><col style="width:4.5%"><col style="width:3.5%"><col style="width:9%"><col><col style="width:3%"><col style="width:19%"><col style="width:7.5%"><col style="width:7.5%"><col style="width:4.5%"><col style="width:10%"></colgroup>
        <thead><tr><th class="pe-c"><input type="checkbox" id="pe-all" aria-label="Select all rows"></th><th class="pe-n">#</th>${COLS.map((f) => `<th${f === 'debit' || f === 'credit' ? ' class="num"' : ''}>${esc(f === 'split' ? 'Split' : P.LABELS[f])}</th>`).join('')}<th>Posts as</th></tr></thead>
        <tbody>${ps.rows.map((x, i) => rowHtml(i)).join('')}</tbody></table></div>
      <div class="pe-foot" id="pe-foot"></div>
      <datalist id="pe-dl-type">${P.TYPES.map((t) => `<option value="${esc(t)}">`).join('')}</datalist>
      <datalist id="pe-dl-acc">${b.sortedAccounts((a) => a.active).map((a) => `<option value="${esc(b.accountFullName(a))}">`).join('')}</datalist>
      <datalist id="pe-dl-name">${b.contacts.filter((c) => c.active !== false).map((c) => `<option value="${esc(c.name)}">`).join('')}</datalist>`);
    bind(el, b);
    refresh(el, b);
  };

  function resultHtml(b) {
    const x = ps.result, live = x.ids.filter((id) => b.txById[id] && b.txById[id].status === 'posted');
    return `<div class="banner ok pe-done" data-testid="pe-result">Posted ${x.ids.length} entr${x.ids.length === 1 ? 'y' : 'ies'}${x.accounts ? ` · created ${x.accounts} account${x.accounts === 1 ? '' : 's'}` : ''}${x.contacts ? ` · ${x.contacts} name${x.contacts === 1 ? '' : 's'}` : ''}.
      ${x.ledgerId ? `<a href="#/register/${esc(x.ledgerId)}">View the ledger</a>` : ''}${live.length ? ` <button class="btn small" id="pe-void" data-testid="pe-void">Void these ${live.length}</button>` : ' All voided.'}</div>`;
  }

  function refresh(el, b) {
    const led = b.accById[ps.ledgerId], foot = el.querySelector('#pe-foot'), miss = el.querySelector('#pe-missing');
    el.querySelectorAll('.pe-st').forEach((td) => { td.textContent = ''; td.className = 'pe-st'; });
    el.querySelectorAll('#pe-grid tr.bad').forEach((tr) => tr.classList.remove('bad'));
    const rows = ps.rows.filter(used).length;
    if (!led) { miss.innerHTML = ''; foot.innerHTML = `<span class="hint">${rows ? 'Choose the ledger these rows are from.' : 'Choose a ledger, then paste rows.'}</span>`; return null; }
    const p = P.plan(b, led.id, ps.rows, opts());
    const st = (i, text, cls) => { const td = el.querySelector(`[data-st="${i}"]`); if (td) { td.textContent = text; td.className = 'pe-st ' + (cls || ''); td.title = text; } };
    p.entries.forEach((e) => e.rows.forEach((i, k) => st(i, k ? '↳ same entry' : UI.typeLabel(e.kind) + ((e.draft.lines || e.draft.jlines || []).length > 1 ? ' · ' + (e.draft.lines || e.draft.jlines).length + ' lines' : '') + (e.duplicate ? ' · possible duplicate' : ''), e.duplicate ? 'warn' : '')));
    p.errors.forEach((x) => { const td0 = el.querySelector(`[data-st="${x.row}"]`); if (td0 && td0.classList.contains('bad')) return; st(x.row, x.message, 'bad'); const tr = el.querySelector(`#pe-grid tr[data-r="${x.row}"]`); if (tr) tr.classList.add('bad'); });
    const types = S.ACCOUNT_TYPES.map((t) => `<option value="type:${t.id}">Create as ${esc(t.label)}</option>`).join('');
    const accs = b.sortedAccounts((a) => a.active).map((a) => `<option value="acc:${esc(a.id)}">Use ${esc(b.accountLabel(a.id))}</option>`).join('');
    const vend = p.newNames.filter((n) => n.kind === 'vendor'), cust = p.newNames.filter((n) => n.kind === 'customer');
    const list = (a) => a.slice(0, 6).map((n) => esc(n.name)).join(', ') + (a.length > 6 ? ' and ' + (a.length - 6) + ' more' : '');
    miss.innerHTML = (p.missing.length ? `<div class="banner warn pe-miss" data-testid="pe-missing"><b>${p.missing.length} account${p.missing.length === 1 ? ' isn’t' : 's aren’t'} in VaultBook.</b> Choose what each becomes; they are created when you post.
        <table class="pe-acc">${p.missing.map((m) => `<tr><td>${esc(m.full)}${m.parentId ? ` <span class="hint">under ${esc(b.accountLabel(m.parentId))}</span>` : ''}</td><td class="hint">${m.rows.length} row${m.rows.length === 1 ? '' : 's'}</td>
          <td><select data-miss="${esc(m.key)}" aria-label="What ${esc(m.full)} becomes">${types.replace(`value="type:${m.type}"`, `value="type:${m.type}" selected`)}<optgroup label="Or use an existing account">${accs}</optgroup></select></td></tr>`).join('')}</table></div>` : '') +
      (p.newNames.length ? `<p class="hint pe-names">New names created when you post: ${vend.length ? `${vend.length} vendor${vend.length === 1 ? '' : 's'} (${list(vend)})` : ''}${vend.length && cust.length ? '; ' : ''}${cust.length ? `${cust.length} customer${cust.length === 1 ? '' : 's'} (${list(cust)})` : ''}.</p>` : '');
    miss.querySelectorAll('[data-miss]').forEach((s) => s.addEventListener('change', () => { ps.choice[s.dataset.miss] = s.value; refresh(el, b); }));
    const dr = U.sum(ps.rows, (x) => { const c = +P.money(x.debit); return isFinite(c) ? Math.round(c * 100) : 0; });
    const cr = U.sum(ps.rows, (x) => { const c = +P.money(x.credit); return isFinite(c) ? Math.round(c * 100) : 0; });
    const dups = p.entries.filter((e) => e.duplicate).length;
    foot.innerHTML = `<div class="pe-sum"><span>${p.entries.length} entr${p.entries.length === 1 ? 'y' : 'ies'} from ${rows} row${rows === 1 ? '' : 's'}</span><span>Debit <b>${UI.money(dr)}</b></span><span>Credit <b>${UI.money(cr)}</b></span>
      ${p.errors.length ? `<span class="bad">${p.errors.length} row${p.errors.length === 1 ? '' : 's'} to fix</span>` : ''}${dups ? `<span class="warn">${dups} possible duplicate${dups === 1 ? '' : 's'}</span>` : ''}</div>
      <button class="btn primary" id="pe-post" data-testid="pe-post">Post ${p.entries.length || ''} entr${p.entries.length === 1 ? 'y' : 'ies'}</button>`;
    foot.querySelector('#pe-post').addEventListener('click', () => post(el, b));
    return p;
  }

  function post(el, b) {
    const p = refresh(el, b);
    if (!p) { UI.toast('Choose the ledger first.', 'error'); return; }
    if (p.errors.length) { UI.toast('Fix the rows marked in red first: ' + p.errors[0].message, 'error'); const inp = el.querySelector(`input[data-r="${p.errors[0].row}"][data-f="date"]`); if (inp) inp.focus(); return; }
    if (!p.entries.length) { UI.toast('Paste or type some rows first.', 'error'); return; }
    const dups = p.entries.filter((e) => e.duplicate).length;
    const ask = dups ? UI.confirm('Possible duplicates', `<p>${dups} entr${dups === 1 ? 'y looks' : 'ies look'} like ${dups === 1 ? 'one' : 'ones'} already in this ledger (same date, amount and account). Post anyway?</p>`, { ok: 'Post anyway' }) : Promise.resolve(true);
    ask.then((go) => {
      if (!go) return;
      const btn = el.querySelector('#pe-post'); btn.disabled = true; btn.textContent = 'Posting…';
      return P.post(b, ps.ledgerId, ps.rows, opts()).then((res) => {
        ps.result = { ids: res.saved.map((t) => t.id), accounts: res.accounts.length, contacts: res.contacts.length, ledgerId: ps.ledgerId };
        ps.rows = []; ps.sel = {}; ps.choice = {};
        UI.toast('Posted ' + res.saved.length + ' entr' + (res.saved.length === 1 ? 'y' : 'ies') + '.');
        UI.render();
      }, (e) => { btn.disabled = false; btn.textContent = 'Post entries'; UI.toast(e.message, 'error'); refresh(el, b); });
    });
  }

  function setCell(i, f, v) {
    v = String(v == null ? '' : v).replace(/\r?\n$/, '');
    if (f === 'date') v = P.isoDate(v) || v.trim();
    else if (f === 'debit' || f === 'credit') v = P.money(v);
    else v = v.trim();
    ps.rows[i][f] = v;
  }

  function bind(el, b) {
    const grid = el.querySelector('#pe-grid'), tbody = grid.querySelector('tbody');
    const redraw = () => { pad(); tbody.innerHTML = ps.rows.map((x, i) => rowHtml(i)).join(''); refresh(el, b); };
    el.querySelector('#pe-led').addEventListener('change', (e) => { ps.ledgerId = e.target.value; ps.choice = {}; ps.result = null; UI.render(); });
    tbody.addEventListener('change', (e) => {
      const t = e.target;
      if (t.classList.contains('pe-sel')) { if (t.checked) ps.sel[t.dataset.r] = 1; else delete ps.sel[t.dataset.r]; return; }
      if (!t.dataset.f) return;
      const i = +t.dataset.r; setCell(i, t.dataset.f, t.value); t.value = show(t.dataset.f, ps.rows[i][t.dataset.f]);
      if (i >= ps.rows.length - 2) { const f = t.dataset.f; redraw(); const n = tbody.querySelector(`input[data-r="${i}"][data-f="${f}"]`); if (n) n.focus(); } else refresh(el, b);
    });
    tbody.addEventListener('paste', (e) => {
      const t = e.target; if (!t.dataset || !t.dataset.f) return;
      const text = (e.clipboardData || window.clipboardData).getData('text/plain') || '';
      if (!/[\t\n]/.test(text.replace(/\r?\n$/, ''))) return;   // one value: a normal paste into the cell
      e.preventDefault();
      const table = P.parseTSV(text).filter((r) => r.some((c) => String(c).trim())), at = +t.dataset.r, col = COLS.indexOf(t.dataset.f);
      let n;
      if (P.headerOf(table)) { const rows = P.fromTable(table); ps.rows.splice(at, rows.length, ...rows); n = rows.length; }   // a report with headings: columns by name
      else {   // plain cells: like Excel, they fill the grid from this cell, right and down
        table.forEach((r, j) => { while (ps.rows.length <= at + j) ps.rows.push(blank()); r.forEach((v, k) => { if (col + k < COLS.length) setCell(at + j, COLS[col + k], v); }); });
        n = table.length;
      }
      redraw(); UI.toast(n + ' row' + (n === 1 ? '' : 's') + ' pasted.');
    });
    tbody.addEventListener('keydown', (e) => {
      const t = e.target; if (!t.dataset || !t.dataset.f) return;
      const i = +t.dataset.r, f = t.dataset.f, go = (r, ff) => { const n = tbody.querySelector(`input[data-r="${r}"][data-f="${ff}"]`); if (n) { n.focus(); n.select(); } };
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd' && i > 0) { e.preventDefault(); ps.rows[i][f] = ps.rows[i - 1][f]; t.value = show(f, ps.rows[i][f]); refresh(el, b); return; }
      if (e.key === 'Enter' || (e.key === 'ArrowDown' && !t.list)) { e.preventDefault(); t.dispatchEvent(new Event('change', { bubbles: true })); go(i + 1, f); }
      else if (e.key === 'ArrowUp' && !t.list) { e.preventDefault(); go(i - 1, f); }
    });
    el.querySelector('#pe-all').addEventListener('change', (e) => { ps.sel = {}; if (e.target.checked) ps.rows.forEach((x, i) => { if (used(x)) ps.sel[i] = 1; }); tbody.querySelectorAll('.pe-sel').forEach((c) => { c.checked = !!ps.sel[c.dataset.r]; }); });
    const picked = () => { const ks = Object.keys(ps.sel).map(Number).filter((i) => ps.rows[i] && used(ps.rows[i])).sort((a, c) => a - c); return ks.length ? ks : ps.rows.map((x, i) => i).filter((i) => used(ps.rows[i])); };
    el.querySelector('#pe-repeat').addEventListener('click', () => {
      const months = Math.max(1, Math.min(36, Math.round(+el.querySelector('#pe-months').value || 1))); ps.months = months;
      const src = picked().map((i) => ps.rows[i]).filter((x) => U.isDate(x.date));
      if (!src.length) { UI.toast('Tick rows that have a date first.', 'error'); return; }
      const copies = P.repeat(src, months), last = ps.rows.filter(used).length;
      ps.rows.splice(last, 0, ...copies); ps.sel = {}; redraw();
      UI.toast(copies.length + ' row' + (copies.length === 1 ? '' : 's') + ' added for ' + months + ' month' + (months === 1 ? '' : 's') + '. Change what differs, then post.');
    });
    el.querySelector('#pe-join').addEventListener('click', () => {
      const ks = Object.keys(ps.sel).map(Number).filter((i) => ps.rows[i] && used(ps.rows[i])).sort((a, c) => a - c);
      if (ks.length < 2) { UI.toast('Tick two or more rows to join first.', 'error'); return; }
      const head = ps.rows[ks[0]], taken = {}; ps.rows.forEach((x) => { if (x.entry) taken[x.entry] = 1; });
      let n = 1; while (taken['J' + n]) n++;
      const ent = head.entry || 'J' + n, moved = ks.some((i) => ps.rows[i].date && ps.rows[i].date !== head.date);
      ks.forEach((i) => { const x = ps.rows[i]; x.entry = ent; x.date = head.date; ['type', 'num', 'name'].forEach((f) => { if (!x[f]) x[f] = head[f]; }); });
      ps.sel = {}; redraw();
      UI.toast(ks.length + ' rows are one entry (Entry # ' + ent + ')' + (moved ? ', dated ' + U.fmtDate(head.date) : '') + '.');
    });
    el.querySelector('#pe-del').addEventListener('click', () => {
      const ks = Object.keys(ps.sel).map(Number); if (!ks.length) { UI.toast('Tick the rows to delete first.', 'error'); return; }
      ps.rows = ps.rows.filter((x, i) => !ps.sel[i]); ps.sel = {}; redraw();
    });
    el.querySelector('#pe-add').addEventListener('click', () => { for (let i = 0; i < 10; i++) ps.rows.push(blank()); tbody.innerHTML = ps.rows.map((x, i) => rowHtml(i)).join(''); refresh(el, b); });
    el.querySelector('#pe-clear').addEventListener('click', () => {
      if (!ps.rows.some(used)) return;
      UI.confirm('Clear the grid', '<p>Remove every row from the grid? Nothing posted is changed.</p>', { ok: 'Clear', danger: true }).then((ok) => { if (ok) { ps.rows = []; ps.sel = {}; ps.choice = {}; redraw(); } });
    });
    const v = el.querySelector('#pe-void');
    if (v) v.addEventListener('click', () => {
      const ids = ps.result.ids.filter((id) => b.txById[id] && b.txById[id].status === 'posted');
      UI.confirm('Void the pasted entries', `<p>Void the ${ids.length} entr${ids.length === 1 ? 'y' : 'ies'} just posted? Accounts and names that were created stay.</p>`, { ok: 'Void', danger: true }).then((ok) => {
        if (!ok) return;
        let chain = Promise.resolve();
        ids.forEach((id) => { chain = chain.then(() => b.voidTransaction(id, 'Paste entries undone')); });
        chain.then(() => { UI.toast('Voided ' + ids.length + '.'); UI.render(); }, (e) => { UI.toast(e.message, 'error'); UI.render(); });
      });
    });
  }
})();
