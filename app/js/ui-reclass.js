/* VaultBook — Reclassify Transactions screen (#/reclassify), the accountant's clean-up tool.
 * Left: accounts with their activity in the period. Right: the lines posted to the chosen account, with filters.
 * Tick lines, choose "Account to" and/or "Class to", see what will move, then Reclassify (one atomic change,
 * kept in a history that can be undone). Keyboard: ↑/↓ rows, Space ticks, Ctrl+A ticks all, Ctrl+Enter reclassifies,
 * Alt+L moves to the accounts list, F2 changes the period.
 */
(function () {
  'use strict';
  const UI = OB.ui, U = OB.util, S = OB.schema, esc = U.esc;
  const VIEWS = [['pl', 'Profit & Loss accounts'], ['bs', 'Balance Sheet accounts'], ['bank', 'Bank and credit card accounts'], ['all', 'All accounts'], ['used', 'Accounts used in the period']];
  const SHOW = [['all', 'All lines'], ['nonitem', 'Account lines (account and class can change)'], ['item', 'Product/service lines (class only)'], ['head', 'Written from this account (checks, payments, deposits)']];
  const sel = new Set();   // ticked row keys, kept while the screen is open

  UI.routes.reclassify = (el, r) => {
    const b = UI.book, p = Object.assign({}, r.params);
    const cur = UI.currentPeriod ? UI.currentPeriod() : { from: U.fiscalYearStart(U.today(), b.company.fiscalYearStartMonth || 1), to: U.today() };
    const from = U.isDate(p.from) ? p.from : cur.from, to = U.isDate(p.to) ? p.to : cur.to;
    const view = VIEWS.some((v) => v[0] === p.view) ? p.view : 'pl';
    const useClass = b.feature('classes') || (b.classes || []).length > 0;
    const act = b.reclassActivity(from, to);
    const accs = b.sortedAccounts((a) => {
      if (view === 'pl') return S.isPL(a.type);
      if (view === 'bs') return S.isBS(a.type);
      if (view === 'bank') return a.type === 'bank' || a.type === 'cc';
      if (view === 'used') return !!act[a.id];
      return true;
    }).filter((a) => a.active !== false || act[a.id]);
    const accountId = p.acc === '*' ? '' : p.acc && b.accById[p.acc] ? p.acc : (accs.find((a) => act[a.id]) || accs[0] || {}).id || '';
    const show = SHOW.some((x) => x[0] === p.show) ? p.show : 'all';
    const types = (p.types || '').split(',').filter(Boolean);
    const rows = b.reclassRows({ accountId, from, to, contactId: p.contact, show, types, memo: p.q, min: cents(p.min), max: cents(p.max) });
    const visible = new Set(rows.map((x) => x.key));
    [...sel].forEach((k) => { if (!visible.has(k)) sel.delete(k); });
    const go = (ch) => { const np = Object.assign({}, r.params, ch); Object.keys(np).forEach((k) => { if (np[k] === '' || np[k] === undefined) delete np[k]; }); UI.go('#/reclassify?' + UI.qs(np)); };
    const names = b.contacts.slice().sort((x, y) => b.contactLabel(x.id).localeCompare(b.contactLabel(y.id)));
    const usedTypes = [...new Set(rows.map((x) => x.type))];
    const accLabel = accountId ? b.accountLabel(accountId) : 'All accounts';
    const hist = b.reclassBatches().slice(0, 8);

    el.innerHTML = `<div class="page rc-page fill">
      <div class="page-head"><div><a href="#/gateway" class="back">Gateway</a><h1>Reclassify transactions</h1>
        <p class="muted small">Find lines posted to the wrong account or class and move them, one by one or all at once.</p></div>
        <div class="actions"><button class="btn" id="rc-hist" ${hist.length ? '' : 'disabled'}>History${hist.length ? ' (' + hist.length + ')' : ''}</button></div></div>
      <div class="rc-grid">
        <section class="rc-left card" aria-label="Accounts">
          <div class="rc-h">Accounts</div>
          <div class="vr-2"><label class="rc-f">From<input id="rc-from" class="smart-date" value="${esc(U.fmtDate(from))}"></label><label class="rc-f">To<input id="rc-to-date" class="smart-date" value="${esc(U.fmtDate(to))}"></label></div>
          <label class="rc-f">View<select id="rc-view">${VIEWS.map(([k, l]) => `<option value="${k}"${k === view ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
          <div class="rc-acc-head"><span>Name</span><span>Type</span><span class="num">Activity</span></div>
          <div class="rc-acc" role="group" aria-label="Accounts" id="rc-acc">
            <button type="button" class="rc-a${accountId ? '' : ' on'}" data-acc="*" aria-pressed="${!accountId}"><span>All accounts</span><span></span><span></span></button>
            ${accs.map((a) => { const x = act[a.id]; return `<button type="button" class="rc-a${a.id === accountId ? ' on' : ''}${x ? '' : ' idle'}" data-acc="${esc(a.id)}" aria-pressed="${a.id === accountId}" title="${esc(b.accountLabel(a.id))}${x ? ' · ' + x.count + ' line' + (x.count === 1 ? '' : 's') : ''}"><span class="${a.parentId ? 'sub' : ''}">${esc(a.name)}</span><span>${esc((S.TYPE[a.type] || {}).label || a.type)}</span><span class="num">${x ? UI.money(b.normalSign(a) * x.net) : ''}</span></button>`; }).join('')}
          </div>
        </section>
        <section class="rc-right card" aria-label="Transactions">
          <div class="rc-h">Transactions <span class="muted">· ${esc(accLabel)} · ${esc(U.fmtDate(from))} – ${esc(U.fmtDate(to))}</span></div>
          <div class="rc-filters">
            <label class="rc-f">Name<select id="rc-contact"><option value="">All names</option>${names.map((c) => `<option value="${esc(c.id)}"${p.contact === c.id ? ' selected' : ''}>${esc(b.contactLabel(c.id))}</option>`).join('')}</select></label>
            <label class="rc-f">Show<select id="rc-show">${SHOW.map(([k, l]) => `<option value="${k}"${k === show ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
            <label class="rc-f">Type<select id="rc-type"><option value="">All types</option>${Object.keys(S.TXN_TYPES).filter((t) => !S.TXN_TYPES[t].nonPosting && (usedTypes.indexOf(t) >= 0 || types.indexOf(t) >= 0)).map((t) => `<option value="${t}"${types[0] === t ? ' selected' : ''}>${esc(UI.typeLabel(t))}</option>`).join('')}</select></label>
            <label class="rc-f rc-grow">Search memo, name or no.<input type="search" id="rc-q" value="${esc(p.q || '')}"></label>
            <label class="rc-f rc-amt">Amount from<input id="rc-min" inputmode="decimal" value="${esc(p.min || '')}"></label>
            <label class="rc-f rc-amt">to<input id="rc-max" inputmode="decimal" value="${esc(p.max || '')}"></label>
          </div>
          <div class="rc-table-wrap scroll-area">
          ${rows.length ? `<table class="data compact rc-table" data-testid="rc-rows"><thead><tr><th class="rc-ck"><input type="checkbox" id="rc-all" aria-label="Tick all lines that can change"></th><th>Date</th><th>Type</th><th>No.</th><th>Name</th><th>Memo</th><th>Account</th>${useClass ? '<th>Class</th>' : ''}<th class="num">Amount</th></tr></thead><tbody>
            ${rows.map((x) => `<tr data-key="${esc(x.key)}" class="${x.canAccount || x.canClass ? '' : 'rc-locked'}${sel.has(x.key) ? ' rc-on' : ''}"><td class="rc-ck"><input type="checkbox" data-k="${esc(x.key)}"${sel.has(x.key) ? ' checked' : ''}${x.canAccount || x.canClass ? '' : ' disabled'} aria-label="Select ${esc(UI.typeLabel(x.type))} ${esc(x.number)}"></td>
              <td>${UI.date(x.date)}</td><td><a href="#/txn/${esc(x.txnId)}" title="Open">${esc(UI.typeLabel(x.type))}</a></td><td>${esc(x.number)}</td><td class="wrap">${esc(x.name)}</td><td class="memo">${esc(x.memo)}</td>
              <td>${esc(b.accountLabel(x.accountId))}${x.why ? ` <span class="rc-why" title="${esc(x.why)}" aria-label="${esc(x.why)}">${x.canClass && !x.canAccount ? 'class only' : '🔒'}</span>` : ''}</td>${useClass ? `<td>${esc(x.classId ? b.classFullName(x.classId) : '')}</td>` : ''}<td class="num">${UI.money(x.amount)}</td></tr>`).join('')}
          </tbody></table>` : UI.empty((p.contact || p.q || p.min || p.max || p.types || show !== 'all') ? 'No lines' + (accountId ? ' on ' + accLabel : '') + ' match these filters in this period.' : accountId ? 'Nothing was posted to ' + accLabel + ' between these dates.' : 'Nothing was posted between these dates.', (p.contact || p.q || p.min || p.max || p.types || show !== 'all') ? '<button class="btn" id="rc-clear">Clear filters</button>' : '')}
          </div>
          <div class="rc-foot">
            <div class="rc-sel"><button class="btn small" id="rc-selall">Select all</button><button class="btn small" id="rc-none">Deselect all</button>
              <span class="muted" id="rc-count"></span></div>
            <div class="rc-preview" id="rc-preview" aria-live="polite"></div>
            <div class="rc-change">
              <span class="rc-cap">For all selected lines, change</span>
              <label class="check"><input type="checkbox" id="rc-doacc"${p.toacc ? ' checked' : ''}> Account to</label>
              <div class="rc-combo">${UI.comboHtml('account', 'any', p.toacc || '', 'id="rc-toacc"', { placeholder: 'Choose the correct account', label: 'Account to' })}</div>
              ${useClass ? `<label class="check"><input type="checkbox" id="rc-docls"> Class to</label><select id="rc-tocls" aria-label="Class to"><option value="">(no class)</option>${b.sortedClasses().map((c) => `<option value="${esc(c.id)}">${esc(b.classFullName(c.id))}</option>`).join('')}</select>` : ''}
              <input id="rc-note" class="rc-note" placeholder="Note for the audit trail (optional)" maxlength="200" aria-label="Note">
              <button class="btn primary" id="rc-go" data-testid="rc-go" title="Ctrl+Enter">Reclassify</button>
            </div>
          </div>
        </section>
      </div></div>`;

    const $ = (s) => el.querySelector(s);
    const boxes = () => [...el.querySelectorAll('[data-k]')];
    const rowByKey = {}; rows.forEach((x) => { rowByKey[x.key] = x; });
    const change = () => {
      const c = {};
      if ($('#rc-doacc').checked && $('#rc-toacc').value) c.accountId = $('#rc-toacc').value;
      if ($('#rc-docls') && $('#rc-docls').checked) c.classId = $('#rc-tocls').value;
      return c;
    };
    const refresh = () => {
      const keys = [...sel], tot = U.sum(keys, (k) => (rowByKey[k] || {}).amount || 0);
      $('#rc-count').textContent = keys.length ? keys.length + ' selected · total ' + U.fmt(tot, { symbol: true }) : rows.length + ' line' + (rows.length === 1 ? '' : 's');
      const allBox = $('#rc-all'); if (allBox) { const can = boxes().filter((x) => !x.disabled); allBox.checked = can.length > 0 && can.every((x) => x.checked); allBox.indeterminate = !allBox.checked && can.some((x) => x.checked); }
      el.querySelectorAll('tr[data-key]').forEach((tr) => tr.classList.toggle('rc-on', sel.has(tr.dataset.key)));
      const c = change(), pv = $('#rc-preview');
      if (!keys.length || (!c.accountId && c.classId === undefined)) { pv.innerHTML = keys.length ? '<span class="muted">Tick <b>Account to</b> or <b>Class to</b> and choose the new one.</span>' : ''; $('#rc-go').disabled = true; return; }
      let pr; try { pr = b.reclassPreview(keys, c); } catch (e) { pv.innerHTML = `<span class="bad">${esc(e.message)}</span>`; $('#rc-go').disabled = true; return; }
      const parts = pr.moves.map((m) => `<b>${UI.money(Math.abs(m.amount), { symbol: true })}</b> from ${esc(b.accountLabel(m.from))} → <b>${esc(b.accountLabel(m.to))}</b>`);
      if (pr.classes) parts.push(`class on ${pr.classes} line${pr.classes === 1 ? '' : 's'} → <b>${esc(c.classId ? b.classFullName(c.classId) : 'no class')}</b>`);
      pv.innerHTML = (pr.lines ? `Will change ${pr.lines} line${pr.lines === 1 ? '' : 's'} in ${pr.txns} transaction${pr.txns === 1 ? '' : 's'}: ${parts.join('; ')}.` : '<span class="muted">Nothing to change: the selected lines already use that.</span>') +
        (pr.blocked.length ? ` <span class="bad">${pr.blocked.length} can’t change: ${esc(pr.blocked[0].why)}${pr.blocked.length > 1 ? ' …' : ''}</span>` : '');
      $('#rc-go').disabled = !pr.lines;
    };
    const tick = (k, on) => { if (on) sel.add(k); else sel.delete(k); const bx = el.querySelector(`[data-k="${CSS.escape(k)}"]`); if (bx) bx.checked = on; };
    el.querySelectorAll('[data-k]').forEach((x) => x.addEventListener('change', () => { tick(x.dataset.k, x.checked); refresh(); }));
    const all = (on) => { boxes().filter((x) => !x.disabled).forEach((x) => tick(x.dataset.k, on)); refresh(); };
    if ($('#rc-all')) $('#rc-all').addEventListener('change', (e) => all(e.target.checked));
    $('#rc-selall').addEventListener('click', () => all(true));
    $('#rc-none').addEventListener('click', () => all(false));
    $('#rc-toacc').addEventListener('change', () => { if ($('#rc-toacc').value) $('#rc-doacc').checked = true; refresh(); });
    $('#rc-doacc').addEventListener('change', refresh);
    if ($('#rc-docls')) { $('#rc-docls').addEventListener('change', refresh); $('#rc-tocls').addEventListener('change', () => { $('#rc-docls').checked = true; refresh(); }); }
    const run = () => {
      const keys = [...sel], c = change();
      if (!keys.length) return UI.toast('Tick the lines to reclassify first.', 'error');
      let pr; try { pr = b.reclassPreview(keys, c); } catch (e) { return UI.toast(e.message, 'error'); }
      if (!pr.lines) return UI.toast(pr.blocked.length ? pr.blocked[0].why : 'Nothing to change.', 'error');
      return UI.busy($('#rc-go'), () => b.reclassify(keys, c, $('#rc-note').value).then((res) => {
        sel.clear();
        UI.toast(`Reclassified ${res.lines} line${res.lines === 1 ? '' : 's'} in ${res.txns} transaction${res.txns === 1 ? '' : 's'}.${res.blocked.length ? ' ' + res.blocked.length + ' could not change.' : ''} History → Undo puts them back.`);
        UI.render();
      })).catch(UI.error);
    };
    $('#rc-go').addEventListener('click', run);
    // accounts pane
    el.querySelectorAll('[data-acc]').forEach((x) => x.addEventListener('click', () => { sel.clear(); go({ acc: x.dataset.acc === '*' ? '*' : x.dataset.acc }); }));
    $('#rc-acc').addEventListener('keydown', (e) => {
      const list = [...el.querySelectorAll('.rc-a')], i = list.indexOf(document.activeElement);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); const n = list[Math.max(0, Math.min(list.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]; if (n) n.focus(); }
      else if (e.key.length === 1 && /\w/.test(e.key) && !e.ctrlKey && !e.altKey) { const k = e.key.toLowerCase(), hit = list.find((x, n) => n > i && x.textContent.trim().toLowerCase().startsWith(k)) || list.find((x) => x.textContent.trim().toLowerCase().startsWith(k)); if (hit) { e.preventDefault(); hit.focus(); } }
    }, true);
    const onAcc = el.querySelector('.rc-a.on'); if (onAcc) onAcc.scrollIntoView({ block: 'nearest' });
    // period and filters
    const rf = UI.bindSmartDate ? UI.bindSmartDate($('#rc-from'), null) : () => U.parseDate($('#rc-from').value);
    const rt = UI.bindSmartDate ? UI.bindSmartDate($('#rc-to-date'), null, () => rf() || from) : () => U.parseDate($('#rc-to-date').value);
    ['#rc-from', '#rc-to-date'].forEach((s) => U.dateCommit($(s), () => {}, () => { const a = rf(), z = rt(); if (a && z && a <= z) go({ from: a, to: z }); else UI.toast('Enter a valid From and To date.', 'error'); }));   // never mid-typing
    $('#rc-view').addEventListener('change', (e) => go({ view: e.target.value, acc: '' }));
    $('#rc-contact').addEventListener('change', (e) => go({ contact: e.target.value }));
    $('#rc-show').addEventListener('change', (e) => go({ show: e.target.value === 'all' ? '' : e.target.value }));
    $('#rc-type').addEventListener('change', (e) => go({ types: e.target.value }));
    ['q', 'min', 'max'].forEach((k) => { const x = $('#rc-' + k); x.addEventListener('change', () => go({ [k]: x.value.trim() })); x.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go({ [k]: x.value.trim() }); } }); });
    $('#rc-hist').addEventListener('click', () => history(b));
    const clr = $('#rc-clear'); if (clr) clr.addEventListener('click', () => go({ contact: '', q: '', min: '', max: '', types: '', show: '' }));
    UI.reportCtl = { hash: location.hash, period: { from, to, apply: (a, z) => go({ from: a, to: z }) } };
    UI._reclassKeys = (e) => {
      if (UI.parseHash().name !== 'reclassify' || document.querySelector('.modal-backdrop')) return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run(); }
      else if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A') && !/^(INPUT|TEXTAREA)$/.test(e.target.tagName) || ((e.ctrlKey || e.metaKey) && e.key === 'a' && e.target.type === 'checkbox')) { e.preventDefault(); all(true); }
      else if (e.altKey && (e.code === 'KeyL')) { e.preventDefault(); (el.querySelector('.rc-a.on') || el.querySelector('.rc-a')).focus(); }
    };
    refresh();
  };
  window.addEventListener('keydown', (e) => { if (UI._reclassKeys) UI._reclassKeys(e); });

  function cents(v) { const s = String(v || '').replace(/[$,\s]/g, ''); return s && isFinite(+s) ? U.toCents(s) : ''; }

  function history(b) {
    const list = b.reclassBatches();
    return UI.modal({ title: 'Reclassify history', wide: true,
      html: list.length ? `<table class="data compact"><thead><tr><th>When</th><th>Changed</th><th>To</th><th>Note</th><th></th></tr></thead><tbody>${list.map((x) => `<tr><td>${esc(new Date(x.at).toLocaleString())}</td>
        <td>${x.lines} line${x.lines === 1 ? '' : 's'} · ${x.txns.length} txn${x.txns.length === 1 ? '' : 's'}</td>
        <td>${esc([x.accountId ? b.accountLabel(x.accountId) : '', x.classId !== undefined && x.classId !== null ? 'class ' + (x.classId ? b.classFullName(x.classId) : 'none') : ''].filter(Boolean).join(' · '))}</td>
        <td class="wrap">${esc(x.note || '')}</td><td>${x.undone ? '<span class="muted">Undone</span>' : `<button class="btn small" data-undo="${esc(x.id)}">Undo</button>`}</td></tr>`).join('')}</tbody></table>
        <p class="muted small">Undo puts every transaction of that change back as it was, if none was edited since. Each change and undo is in the audit log.</p>` : '<p class="muted">Nothing reclassified yet.</p>',
      onMount: (m, close) => m.querySelectorAll('[data-undo]').forEach((x) => x.addEventListener('click', () => b.undoReclass(x.dataset.undo).then(() => { UI.toast('Reclassification undone.'); close(null); UI.render(); }, UI.error))),
      actions: [{ label: 'Close', value: null }] });
  }
})();
