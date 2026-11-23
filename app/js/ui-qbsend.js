/* VaultBook — Send to QuickBooks Desktop screen (1.30): #/qbsend
 * Choose invoices and customer payments, download one batch file for "VaultBook QuickBooks.cmd", load its result back.
 * Route params: kinds (invoice,payment), range/from/to, contact, status (new|sent|problem|all), min, max. */
(function () {
  'use strict';
  const U = OB.util, UI = OB.ui, Q = OB.qbsend, esc = U.esc;
  const st = { picked: null, months: null };   // picked: Set of keys for the current list, null = all; months: Set of ticked months
  const snapKey = (b) => 'qbSnapshot:' + b.company.id;

  /* The connector as one download (1.59.1): the published site has no tools folder to copy, so every place that
   * names VaultBook QuickBooks.cmd links to tools/VaultBook-QuickBooks-Connector.zip (built by tools/build-site.py:
   * the .cmd and the .ps1 it runs, together in one folder). Same address as the page, so it also works offline. */
  UI.qbToolHref = 'tools/VaultBook-QuickBooks-Connector.zip';
  UI.qbToolButton = (cls) => `<a class="${cls || 'btn'}" href="${UI.qbToolHref}" download data-testid="qb-tool-download" title="Both connector files in one zip. On the PC with QuickBooks Desktop: unzip it (right-click › Extract All), then double-click VaultBook QuickBooks.cmd.">Download the QuickBooks tool</a>`;
  UI.qbToolWhere = `(<a href="${UI.qbToolHref}" download data-testid="qb-tool-link">download it</a> once and unzip it on that PC)`;

  UI.routes.qbsend = (el, r) => {
    const b = UI.book, p = Object.assign({ kinds: 'invoice,payment,bank', status: 'new', range: 'all', tab: 'months' }, r.params || {});
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
      `${UI.qbToolButton('btn ghost')}<label class="btn" for="qs-result">Load result file</label><input type="file" id="qs-result" accept=".json" hidden data-testid="qs-result">
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
      <p class="muted small">Tick what to send, then <strong>Download for QuickBooks</strong>. On the PC with QuickBooks Desktop open, double-click <strong>VaultBook QuickBooks.cmd</strong> ${UI.qbToolWhere}, choose <strong>Send</strong> and pick this file: it checks every item, asks before creating any missing customer or item, records invoices first, then the payments against their invoices, then bank transactions, and saves a result file. Load that file here so each item shows as sent.${sentCount ? ` ${sentCount} item${sentCount === 1 ? '' : 's'} sent so far.` : ''}</p>
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
  const tabs = (p, cur) => `<div class="segmented qs-tabs" role="tablist"><a role="tab" class="btn-tab" aria-selected="${cur === 'months'}" href="#/qbsend?tab=months" data-testid="qs-tab-months">Months</a><a role="tab" class="btn-tab" aria-selected="${cur === 'items'}" href="#/qbsend?${UI.qs(Object.assign({}, p, { tab: 'items' }))}" data-testid="qs-tab-items">Items</a></div>`;

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

  /** Months tab: what QuickBooks has per month (from the snapshot) against VaultBook; tick months, download the gap. */
  function monthsView(el, b, p) {
    const snap = OB.prefs.get(snapKey(b));
    let cmp = null, err = '';
    if (snap) { try { cmp = OB.qbsync.compare(b, snap); } catch (e) { err = e.message; } }
    const head = `${UI.qbToolButton('btn ghost')}<label class="btn" for="qs-result">Load snapshot or result file</label><input type="file" id="qs-result" accept=".json" hidden data-testid="qs-result">`;
    if (!cmp) {
      el.innerHTML = UI.page('Send to QuickBooks Desktop', head, tabs(p, 'months') + `<div class="empty"><p><strong>Start by reading QuickBooks.</strong></p>
        <p>First time? ${UI.qbToolButton('btn primary')}</p>
        <p>On the PC with QuickBooks Desktop open, double-click <strong>VaultBook QuickBooks.cmd</strong> ${UI.qbToolWhere} and choose <strong>1 Read QuickBooks</strong>. It saves a snapshot file (nothing is written to QuickBooks). Then click <strong>Load snapshot or result file</strong> here and choose it.</p>
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
