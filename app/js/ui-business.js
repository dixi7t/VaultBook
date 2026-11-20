/* VaultBook — screens for the 1.14 workflows: Make Deposits, Print Checks, Assess Finance Charges,
 * Write off (bad debt). Engine: js/business.js and js/ledger.js. */
(function () {
  'use strict';
  const U = OB.util, S = OB.schema, R = OB.reports, UI = OB.ui, esc = U.esc, routes = UI.routes;
  const safeC = (v) => { try { return U.toCents(v); } catch (e) { return NaN; } };

  /* ================= Make Deposits ================= */
  routes.deposit = (el) => {
    const b = UI.book, items = b.undepositedItems(), undep = b.sys('UNDEP');
    const banks = (a) => a.active && a.type === 'bank';
    const first = b.sortedAccounts(banks)[0];
    el.innerHTML = UI.page('Make deposits', '<a class="btn" href="#/txn/new?type=deposit">Other deposit</a>', `
      <form id="mdep" class="card" autocomplete="off" data-testid="make-deposits">
        <div class="form-grid cols3">
          <label class="field"><span>Deposit to</span><select name="accountId">${UI.accountOptions(first ? first.id : '', banks)}</select></label>
          <label class="field"><span>Date</span><input type="date" name="date" value="${esc(U.today())}"></label>
          <label class="field"><span>Memo</span><input name="memo" maxlength="200" value="Deposit"></label>
        </div>
        ${items.length ? `<div class="card-head"><h2>Payments to deposit</h2><button type="button" class="btn ghost small" id="dep-all">Select all</button></div>
        <table class="data compact"><thead><tr><th><span class="sr-only">Deposit</span></th><th>Date</th><th>Type</th><th>No.</th><th>Received from</th><th>Memo</th><th class="num">Amount</th></tr></thead><tbody>
          ${items.map((t) => `<tr><td><input type="checkbox" data-pick="${esc(t.id)}" aria-label="Deposit ${esc(UI.typeLabel(t.type))} ${esc(t.number || '')}"></td><td>${UI.date(t.date)}</td><td>${UI.txnLink(t, UI.typeLabel(t.type))}</td><td>${esc(t.number || '')}</td><td>${esc(UI.contactName(t.contactId))}</td><td class="memo">${esc(t.memo || '')}</td><td class="num">${UI.money(b.undepositedAmount(t))}</td></tr>`).join('')}
        </tbody></table>` : UI.empty(`Nothing is waiting in ${esc(undep ? undep.name : 'Undeposited Funds')}. Customer payments and sales receipts recorded to it appear here, so one bank deposit can hold several of them.`)}
        <div class="form-grid cols2"><div></div><div class="totals" id="dep-total"></div></div>
        <div class="form-actions"><button type="submit" class="btn primary" data-key="s"${items.length ? '' : ' disabled'}>Save deposit</button><span class="form-status" aria-live="off"></span></div>
      </form>`, 'Group payments waiting in Undeposited Funds into one deposit, matching the deposit on your bank statement.');
    const form = el.querySelector('#mdep');
    const picked = () => [...form.querySelectorAll('[data-pick]:checked')].map((x) => b.txById[x.dataset.pick]);
    const total = () => { const sum = U.sum(picked(), (t) => b.undepositedAmount(t)); el.querySelector('#dep-total').innerHTML = `<div class="grand"><span>Deposit total</span><b data-testid="dep-total">${UI.money(sum, { symbol: true })}</b></div><div><span>Items</span><b>${picked().length}</b></div>`; };
    form.addEventListener('change', total);
    const all = el.querySelector('#dep-all'); if (all) all.addEventListener('click', () => { form.querySelectorAll('[data-pick]').forEach((x) => { x.checked = true; }); total(); });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const ts = picked(); if (!ts.length) return UI.toast('Tick the payments to deposit.', 'error');
      const g = (n) => form.querySelector(`[name="${n}"]`).value;
      UI.runSave(form.querySelector('button[type=submit]'), () => b.saveTransaction({ type: 'deposit', date: g('date'), accountId: g('accountId'), memo: g('memo'),
        lines: ts.map((t) => ({ accountId: undep.id, fromTxnId: t.id, amount: b.undepositedAmount(t), description: UI.typeLabel(t.type) + (t.number ? ' ' + t.number : '') + ' — ' + UI.contactName(t.contactId), contactId: t.contactId })) }),
        'Deposit saved').then((ok) => { if (ok) UI.go('#/txn/' + b.transactions[b.transactions.length - 1].id); });
    });
    total();
  };

  /* ================= Print checks ================= */
  routes.printchecks = (el, r) => {
    const b = UI.book, L = OB.invoiceLayout, co = b.company, align = co.checkAlign || { dx: 0, dy: 0 };
    const only = r.params.ids ? r.params.ids.split(',').map((id) => b.txById[id]).filter(Boolean) : null;
    const queue = only || b.checksToPrint();
    const next = String(co.counters.check || 1001);
    el.innerHTML = UI.page('Print checks', '', `
      <section class="card no-print" data-testid="print-checks">
        ${queue.length ? `<table class="data compact"><thead><tr><th><span class="sr-only">Print</span></th><th>Date</th><th>Type</th><th>Pay to</th><th>Bank account</th><th>No.</th><th class="num">Amount</th></tr></thead><tbody>
          ${queue.map((t) => `<tr><td><input type="checkbox" data-pick="${esc(t.id)}" checked aria-label="Print"></td><td>${UI.date(t.date)}</td><td>${UI.txnLink(t, UI.typeLabel(t.type))}</td><td>${esc(UI.contactName(t.contactId))}</td><td>${esc(b.accountLabel(t.accountId))}</td><td>${esc(t.number || (t.toBePrinted ? 'To print' : ''))}</td><td class="num">${UI.money(t.total)}</td></tr>`).join('')}</tbody></table>`
          : UI.empty('No checks are waiting to be printed. Tick “Print later” on a check, bill payment or expense from a bank account.')}
        <div class="form-grid cols3">
          ${only && only.every((t) => t.number && !t.toBePrinted) ? '' : `<label class="field"><span>First check number</span><input id="pc-first" inputmode="numeric" value="${esc(next)}" data-testid="pc-first"></label>`}
          <label class="field"><span>Move right (points, 72 = 1 inch)</span><input id="pc-dx" type="number" step="1" value="${esc(align.dx || 0)}"></label>
          <label class="field"><span>Move down (points)</span><input id="pc-dy" type="number" step="1" value="${esc(align.dy || 0)}"></label>
        </div>
        <label class="check"><input type="checkbox" id="pc-co" ${co.checkCompanyBlock === false ? '' : 'checked'}> Print my company name and address (turn off if the check stock has them)</label>
        <p class="muted small">For US Letter voucher checks (check on top, two stubs). Print at 100% (no “fit to page”). Print a test on plain paper and hold it against the check stock; adjust the alignment if needed.</p>
        <div class="form-actions"><button type="button" class="btn" id="pc-pdf" data-key="d">Download PDF</button><button type="button" class="btn" id="pc-print" data-key="p">Print</button>
          ${queue.some((t) => t.toBePrinted) ? '<button type="button" class="btn primary" id="pc-done" data-testid="pc-done">Checks printed correctly — record the numbers</button>' : ''}</div>
      </section>
      <div class="inv-pages" id="pc-pages" data-testid="check-pages"></div>`, 'Print checks on voucher check stock.');
    const sel = () => [...el.querySelectorAll('[data-pick]:checked')].map((x) => b.txById[x.dataset.pick]);
    const firstNo = () => { const f = el.querySelector('#pc-first'); return f ? parseInt(f.value, 10) : NaN; };
    // the preview shows the numbers the checks will get
    const numbered = () => { let n = firstNo(); return sel().map((t) => (t.toBePrinted && n > 0 ? Object.assign({}, t, { number: String(n++) }) : t)); };
    const opts = () => ({ dx: +el.querySelector('#pc-dx').value || 0, dy: +el.querySelector('#pc-dy').value || 0, companyBlock: el.querySelector('#pc-co').checked });
    const draw = () => { const pages = L.checkPages(b, numbered(), opts()); el.querySelector('#pc-pages').innerHTML = pages.map((ops) => `<div class="inv-page">${L.svg(ops, 'class="inv-svg" role="img" aria-label="Check"')}</div>`).join(''); return pages; };
    el.addEventListener('change', (e) => { if (e.target.closest('[data-testid=print-checks]')) draw(); });
    el.addEventListener('input', (e) => { if (e.target.id === 'pc-first' || e.target.id === 'pc-dx' || e.target.id === 'pc-dy') draw(); });
    const saveAlign = () => { const o = opts(); if (o.dx !== (align.dx || 0) || o.dy !== (align.dy || 0) || o.companyBlock !== (co.checkCompanyBlock !== false)) b.saveCompany({ checkAlign: { dx: o.dx, dy: o.dy }, checkCompanyBlock: o.companyBlock }).catch(UI.error); };
    el.querySelector('#pc-pdf').addEventListener('click', () => { if (!sel().length) return UI.toast('Tick the checks to print.', 'error'); const pages = draw(); saveAlign(); U.download(U.safeFileName(co.name + '_Checks_' + U.today()) + '.pdf', new Blob([L.pdf(pages, {}, 'Checks')], { type: 'application/pdf' })); });
    el.querySelector('#pc-print').addEventListener('click', () => { if (!sel().length) return UI.toast('Tick the checks to print.', 'error'); draw(); saveAlign(); window.print(); });
    const done = el.querySelector('#pc-done');
    if (done) done.addEventListener('click', () => {
      const ids = sel().filter((t) => t.toBePrinted).map((t) => t.id);
      if (!ids.length) return UI.toast('None of the ticked checks is waiting to be printed.', 'error');
      b.setChecksPrinted(ids, firstNo()).then((u) => { UI.toast(u.length + ' check(s) numbered ' + u[0].number + (u.length > 1 ? '–' + u[u.length - 1].number : '')); UI.go('#/printchecks'); UI.render(); }, UI.error);
    });
    draw();
  };

  /* ================= Assess finance charges ================= */
  routes.financecharges = (el) => {
    const b = UI.book, fc = b.company.financeCharge || { apr: 18, minCharge: 0, graceDays: 0 };
    el.innerHTML = UI.page('Assess finance charges', '', `
      <form id="fc" class="card" autocomplete="off" data-testid="finance-charges">
        <div class="form-grid cols3">
          <label class="field"><span>Annual interest rate (%)</span><input name="apr" inputmode="decimal" value="${esc(fc.apr)}"></label>
          <label class="field"><span>Minimum charge</span><input name="minCharge" class="money" inputmode="decimal" value="${esc(U.fmtPlain(fc.minCharge || 0))}"></label>
          <label class="field"><span>Grace period (days after due date)</span><input name="graceDays" type="number" min="0" max="365" value="${esc(fc.graceDays || 0)}"></label>
          <label class="field"><span>Assessment date</span><input type="date" name="asOf" value="${esc(U.today())}"></label>
          <label class="check"><input type="checkbox" name="onFinanceCharges"${fc.onFinanceCharges ? ' checked' : ''}> Charge on past finance charges too</label>
        </div>
        <div id="fc-list"></div>
        <div class="form-actions"><button type="submit" class="btn primary" data-testid="fc-assess">Assess charges</button><span class="form-status" aria-live="off"></span></div>
      </form>`, 'Charge interest on overdue customer balances. Each charge is an invoice to Finance Charge Income.');
    const form = el.querySelector('#fc');
    const read = () => { const v = Object.fromEntries(new FormData(form).entries()); return { apr: +v.apr || 0, minCharge: safeC(v.minCharge) || 0, graceDays: +v.graceDays || 0, asOf: v.asOf, onFinanceCharges: !!v.onFinanceCharges }; };
    let rows = [];
    const list = () => {
      const o = read(); rows = b.financeChargePreview(o);
      el.querySelector('#fc-list').innerHTML = rows.length ? `<table class="data compact"><thead><tr><th><span class="sr-only">Charge</span></th><th>Customer</th><th class="num">Overdue balance</th><th>Oldest due date</th><th class="num">Finance charge</th></tr></thead><tbody>
        ${rows.map((r) => `<tr><td><input type="checkbox" data-pick="${esc(r.contactId)}" checked aria-label="Charge ${esc(r.name)}"></td><td><a href="#/contact/${esc(r.contactId)}">${esc(r.name)}</a></td><td class="num">${UI.money(r.overdue)}</td><td>${UI.date(r.invoices.map((x) => x.dueDate).sort()[0])}</td><td class="num">${UI.money(r.charge)}</td></tr>`).join('')}</tbody></table>`
        : UI.empty('No customer has an overdue balance past the grace period on this date.');
    };
    form.addEventListener('input', list); form.addEventListener('change', (e) => { if (!e.target.dataset.pick) list(); });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const o = read(), chosen = rows.filter((r) => { const cb = form.querySelector(`[data-pick="${CSS.escape(r.contactId)}"]`); return cb && cb.checked; });
      if (!chosen.length) return UI.toast('Nothing to charge.', 'error');
      UI.runSave(form.querySelector('button[type=submit]'), () => b.saveCompany({ financeCharge: { apr: o.apr, minCharge: o.minCharge, graceDays: o.graceDays, onFinanceCharges: o.onFinanceCharges } })
        .then(() => b.assessFinanceCharges(chosen, o)), (x) => (x ? x.length : 0) + ' finance charge invoice(s) created').then((ok) => { if (ok) list(); });
    });
    list();
  };

  /* ================= Inventory adjustment (1.15) ================= */
  UI.invAdjustForm = (el, d, existing) => {
    const b = UI.book, tracked = b.items.filter((it) => b.tracked(it.id) && (it.active !== false || (d.adjustments || []).some((a) => a.itemId === it.id)));
    const st = b.inventoryState(d.date || U.today(), { exclude: existing ? existing.id : '' });
    const locked = existing && existing.status === 'void';
    const shrink = b.accounts.find((a) => a.type === 'cogs' && a.active);
    const rows = (d.adjustments && d.adjustments.length ? d.adjustments : []).slice(); while (rows.length < 5) rows.push({});
    const fmt = (c) => (c === null || c === undefined || c === '') ? '' : U.fmtPlain(c);
    const opt = (sel) => '<option value="">—</option>' + tracked.map((it) => `<option value="${esc(it.id)}"${it.id === sel ? ' selected' : ''}>${esc(it.name)}</option>`).join('');
    el.innerHTML = UI.page((existing ? '' : 'New ') + 'Inventory adjustment' + (existing && existing.number ? ' ' + existing.number : ''), existing ? `<span>${UI.statusBadge(existing)}</span>` : '', `
      ${locked ? '<div class="banner danger"><strong>Void.</strong> Kept for the audit trail.</div>' : ''}
      ${tracked.length ? '' : '<div class="banner warn">No products track quantity on hand yet. Edit an inventory part and tick “Track quantity on hand”.</div>'}
      <form id="txf" class="txform tx-invAdjust" autocomplete="off" novalidate data-testid="inv-adjust-form"><fieldset ${locked ? 'disabled' : ''}>
        <div class="tx-head">
          <label class="field"><span>Adjustment account</span><select name="accountId">${UI.accountOptions(d.accountId || (shrink ? shrink.id : ''), (a) => a.type !== 'ar' && a.type !== 'ap')}</select></label>
          <label class="field"><span>Date</span><input type="date" name="date" value="${esc(d.date || U.today())}"></label>
          <label class="field"><span>No.</span><input name="number" value="${esc(d.number || '')}" placeholder="Auto" maxlength="30"></label>
        </div>
        <table class="data lines-table"><thead><tr><th>Item</th><th class="num">On hand</th><th class="num">Qty change (+/−)</th><th class="num">Value change</th><th>Memo</th></tr></thead><tbody class="adj">
          ${rows.map((a) => `<tr class="adj-row"><td><select data-f="itemId" aria-label="Item">${opt(a.itemId || '')}</select></td><td class="num" data-on></td>
            <td class="num"><input data-f="qty" class="qty" inputmode="decimal" value="${esc(a.qty === undefined || a.qty === null ? '' : a.qty)}" aria-label="Quantity change"></td>
            <td class="num"><input data-f="value" class="money" inputmode="decimal" value="${esc(fmt(a.value))}" placeholder="at average cost" aria-label="Value change"></td>
            <td><input data-f="memo" value="${esc(a.memo || '')}" aria-label="Memo"></td></tr>`).join('')}</tbody></table>
        <p class="muted small">Count shortfall: enter a negative quantity and leave Value blank — it is valued at average cost and charged to the adjustment account (usually Cost of Goods Sold or an inventory shrinkage expense). To revalue only, enter a value change with no quantity.</p>
        <label class="field"><span>Memo</span><textarea name="memo" rows="2" maxlength="500">${esc(d.memo || '')}</textarea></label></fieldset>
        <div class="form-actions">${locked ? '' : `<button type="submit" class="btn primary" data-key="s">${existing ? 'Save changes' : 'Save'}</button>`}<a class="btn ghost" href="#/items">Close</a>
          ${existing && !locked ? '<button type="button" class="btn danger" id="adj-void">Void…</button>' : ''}<span class="form-status" aria-live="off"></span></div>
      </form>`, 'Adjust quantity on hand or value of inventory (count differences, damage, revaluation).');
    const form = el.querySelector('#txf');
    const onHand = () => form.querySelectorAll('tr.adj-row').forEach((tr) => { const id = tr.querySelector('[data-f=itemId]').value, s = st[id]; tr.querySelector('[data-on]').textContent = s ? String(s.qty) + ' @ ' + U.fmt(Math.round(s.avg)) : ''; });
    form.addEventListener('change', onHand); onHand();
    const vd = el.querySelector('#adj-void'); if (vd) vd.addEventListener('click', () => UI.confirm('Void adjustment', '<p>Undo this adjustment? It is kept for the audit trail.</p>', { ok: 'Void', danger: true }).then((ok) => ok && b.voidTransaction(existing.id, '').then(() => UI.render(), UI.error)));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const g = (n) => form.querySelector(`[name="${n}"]`).value;
      const adjustments = [...form.querySelectorAll('tr.adj-row')].map((tr) => { const v = (f) => tr.querySelector(`[data-f="${f}"]`).value; return { itemId: v('itemId'), qty: v('qty'), value: v('value') === '' ? null : v('value'), memo: v('memo') }; }).filter((a) => a.itemId);
      UI.runSave(form.querySelector('button[type=submit]'), () => b.saveTransaction({ type: 'invAdjust', id: existing ? existing.id : '', date: g('date'), number: g('number'), accountId: g('accountId'), memo: g('memo'), adjustments }), 'Inventory adjusted')
        .then((ok) => { if (ok) { UI.dirty = false; UI.go('#/report/stock'); } });
    });
  };

  /* ================= Fixed assets (1.15) ================= */
  routes.fixedassets = (el) => {
    const b = UI.book, list = b.company.fixedAssets || [], asOf = U.today(), rep = R.fixedAssets(b, { asOf });
    // CPA-11: mid-quarter convention test per year, for years with half-year MACRS assets
    const years = [...new Set(list.filter((a) => (a.taxMethod || a.method) === 'MACRS' && a.convention !== 'MQ').map((a) => a.inService.slice(0, 4)))];
    const mq = years.map((y) => R.macrsConventionCheck(b, y)).filter((w) => w.midQuarter);
    const mqWarn = mq.map((w) => `<p class="warn-text small" data-testid="fa-mq">${esc(w.message)} Set those assets' convention to mid-quarter (IRS Pub. 946).</p>`).join('');
    const rc = rep.reconcile, recon = rc.difference || rc.accumDifference ? `<p class="muted small" data-testid="fa-recon">Register vs general ledger: cost ${UI.money(rc.register)} vs ${UI.money(rc.ledger)} in the asset accounts (difference ${UI.money(rc.difference)}); accumulated depreciation ${UI.money(rc.accumRegister)} vs ${UI.money(rc.accumLedger)} (difference ${UI.money(rc.accumDifference)}). A difference means a purchase or entry was posted to these accounts without a register asset, or an asset was not bought through the books.</p>` : '';
    el.innerHTML = UI.page('Fixed assets', '<button class="btn primary" id="fa-new" data-testid="fa-new">+ New asset</button>', `
      ${list.length ? `<table class="data" data-testid="fa-table"><thead><tr><th>Asset</th><th>In service</th><th>Method</th><th class="num">Cost</th><th class="num">Depreciation recorded</th><th class="num">Book value</th><th class="num">Not yet recorded</th><th></th></tr></thead><tbody>
        ${rep.rows.map((r) => `<tr><td>${esc(r.name)}${r.disposed ? ' <span class="badge">Disposed ' + UI.date(r.disposed) + '</span>' : ''}</td><td>${UI.date(r.inService)}</td><td>${esc(r.method)}</td><td class="num">${UI.money(r.cost)}</td><td class="num">${UI.money(r.recorded)}</td><td class="num">${UI.money(r.bookValue)}</td><td class="num">${UI.money(r.unrecorded)}</td><td class="nowrap"><button class="btn ghost small" data-edit="${esc(r.assetId)}">Edit</button>${r.disposalId ? ` <a class="btn ghost small" href="#/txn/${esc(r.disposalId)}">Disposal entry</a>` : ` <button class="btn ghost small" data-dispose="${esc(r.assetId)}" data-testid="fa-dispose">Dispose…</button>`}</td></tr>`).join('')}
        </tbody></table>${mqWarn}${recon}` : UI.empty('List your equipment, vehicles and buildings to work out depreciation and post it each month or year.')}
      <section class="card" data-testid="fa-run"><h2>Record depreciation</h2>
        <div class="form-grid cols3"><label class="field"><span>Through</span><input type="date" id="fa-through" value="${esc(U.monthEnd ? U.monthEnd(asOf) : asOf)}"></label></div>
        <div id="fa-due"></div>
        <div class="form-actions"><button type="button" class="btn primary" id="fa-post" data-testid="fa-post">Post depreciation entry</button></div>
        <p class="muted small">Posts one journal entry: debit each asset's depreciation expense, credit its accumulated depreciation, for everything scheduled through the date and not yet posted. MACRS amounts are posted at December 31 of each tax year (IRS Pub. 946 tables, half-year or mid-quarter). See <a href="#/report/fixedassets">Fixed Asset Register</a>.</p></section>`,
      'Fixed asset register and depreciation.');
    const due = () => { const d = b.depreciationDue(el.querySelector('#fa-through').value); el.querySelector('#fa-due').innerHTML = d.length ? `<table class="data compact"><thead><tr><th>Asset</th><th class="num">Scheduled to date</th><th class="num">Already posted</th><th class="num">To post</th></tr></thead><tbody>${d.map((r) => `<tr><td>${esc(r.name)}</td><td class="num">${UI.money(r.scheduled)}</td><td class="num">${UI.money(r.recorded)}</td><td class="num">${UI.money(r.due)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Nothing to post through this date.</p>'; };
    el.querySelector('#fa-through').addEventListener('input', due); due();
    el.querySelector('#fa-post').addEventListener('click', () => b.recordDepreciation(el.querySelector('#fa-through').value).then((je) => { UI.toast('Depreciation posted (' + U.fmt(je.total, { symbol: true }) + ')'); UI.render(); }, UI.error));
    const edit = (a) => {
      const fx = (x) => x.active && (x.type === 'fixed' || x.type === 'oa'), ex = (x) => x.active && (x.type === 'expense' || x.type === 'oe');
      const find = (re, types) => (b.accounts.find((x) => types.indexOf(x.type) >= 0 && re.test(x.name)) || {}).id;
      UI.modal({ title: a ? 'Edit fixed asset' : 'New fixed asset', wide: true, html: `<form id="fa" class="form-grid" autocomplete="off">
        <label class="field span2"><span>Name</span><input name="name" value="${esc(a ? a.name : '')}" maxlength="80"></label>
        <label class="field"><span>Placed in service</span><input type="date" name="inService" value="${esc(a ? a.inService : U.today())}"></label>
        <label class="field"><span>Cost</span><input name="cost" inputmode="decimal" value="${esc(a ? U.fmtPlain(a.cost) : '')}"></label>
        <label class="field"><span>Method</span><select name="method"><option value="SL"${!a || a.method === 'SL' ? ' selected' : ''}>Straight-line (book)</option><option value="DDB"${a && a.method === 'DDB' ? ' selected' : ''}>Double-declining balance</option><option value="MACRS"${a && a.method === 'MACRS' ? ' selected' : ''}>MACRS (tax)</option></select></label>
        <label class="field"><span>Useful life (years) — SL / DDB</span><input name="lifeYears" inputmode="decimal" value="${esc(a && a.lifeMonths ? a.lifeMonths / 12 : '5')}"></label>
        <label class="field"><span>Salvage value — SL / DDB</span><input name="salvage" inputmode="decimal" value="${esc(a ? U.fmtPlain(a.salvage || 0) : '0')}"></label>
        <label class="field"><span>MACRS recovery period</span><select name="macrsClass">${[3, 5, 7, 10, 15, 20].map((y) => `<option value="${y}"${a && a.macrsClass === y ? ' selected' : (!a && y === 5 ? ' selected' : '')}>${y}-year</option>`).join('')}</select></label>
        <label class="field"><span>MACRS convention</span><select name="convention"><option value="">Half-year</option><option value="MQ"${a && a.convention === 'MQ' ? ' selected' : ''}>Mid-quarter</option></select></label>
        <label class="field"><span>Tax depreciation</span><select name="taxMethod"><option value="">Same as book</option><option value="MACRS"${a && a.taxMethod === 'MACRS' ? ' selected' : ''}>MACRS (shown on the register, not posted)</option></select></label>
        <label class="field"><span>Tax recovery period</span><select name="taxClass">${[3, 5, 7, 10, 15, 20].map((y) => `<option value="${y}"${a && a.taxClass === y ? ' selected' : (!(a && a.taxClass) && y === 5 ? ' selected' : '')}>${y}-year</option>`).join('')}</select></label>
        <label class="field"><span>Asset account</span><select name="accountId">${UI.accountOptions(a ? a.accountId : find(/equip|furniture|vehicle|machin/i, ['fixed']), (x) => fx(x) && !/accum/i.test(x.name))}</select></label>
        <label class="field"><span>Accumulated depreciation account</span><select name="accumAccountId">${UI.accountOptions(a ? a.accumAccountId : find(/accum/i, ['fixed', 'oa']), fx)}</select></label>
        <label class="field"><span>Depreciation expense account</span><select name="expenseAccountId">${UI.accountOptions(a ? a.expenseAccountId : find(/depreciat/i, ['expense', 'oe']), ex)}</select></label>
        ${a && a.disposalId ? '' : `<label class="field"><span>Stop depreciating on (optional)</span><input type="date" name="disposed" value="${esc(a ? a.disposed || '' : '')}"></label>`}
        <label class="field span2"><span>Description / serial no.</span><input name="description" value="${esc(a ? a.description || '' : '')}" maxlength="200"></label></form>
        <p class="muted small">Record the purchase itself as usual (a bill, check or journal entry to the asset account). To sell or scrap an asset, use Dispose… on the list: it posts depreciation to the disposal date and the entry that clears the asset and books the gain or loss.</p>`,
        actions: [{ label: 'Cancel', value: null }, { label: 'Save', primary: true, collect: (m) => Object.fromEntries(new FormData(m.querySelector('#fa')).entries()) }] })
        .then((v) => v && b.saveFixedAsset(Object.assign({}, v, { id: a ? a.id : '', lifeMonths: Math.round((+v.lifeYears || 0) * 12) })).then(() => { UI.toast('Fixed asset saved'); UI.render(); }, (e) => { UI.error(e); }));
    };
    const dispose = (a) => {
      const cash = (x) => x.active && (OB.schema.TYPE[x.type].cash || x.type === 'oca');
      UI.modal({ title: 'Dispose of ' + a.name, html: `<form id="fad" class="form-grid" autocomplete="off">
        <label class="field"><span>Date sold or scrapped</span><input type="date" name="date" value="${esc(U.today())}"></label>
        <label class="field"><span>Proceeds (0 if scrapped)</span><input name="proceeds" inputmode="decimal" value="0"></label>
        <label class="field span2"><span>Proceeds deposited to</span><select name="depositAccountId">${UI.accountOptions((b.sys('UNDEP') || {}).id || '', cash)}</select></label></form>
        <p class="muted small">Posts depreciation through the date, then one journal entry: debit accumulated depreciation and the proceeds account, credit the asset's cost, and the difference to Gain/Loss on Sale of Assets.</p>`,
        actions: [{ label: 'Cancel', value: null }, { label: 'Dispose', primary: true, collect: (m) => Object.fromEntries(new FormData(m.querySelector('#fad')).entries()) }] })
        .then((v) => v && b.disposeFixedAsset(a.id, v).then((r) => { UI.toast(a.name + ' disposed — ' + (r.gain >= 0 ? 'gain ' : 'loss ') + U.fmt(Math.abs(r.gain), { symbol: true })); UI.render(); }, UI.error));
    };
    el.querySelectorAll('[data-dispose]').forEach((x) => x.addEventListener('click', () => dispose(b.fixedAssetById(x.dataset.dispose))));
    el.querySelector('#fa-new').addEventListener('click', () => edit(null));
    el.querySelectorAll('[data-edit]').forEach((x) => x.addEventListener('click', () => edit(b.fixedAssetById(x.dataset.edit))));
  };

  /* ================= Write off (bad debt) ================= */
  UI.writeOff = (inv) => {
    const b = UI.book, open = b.openBalance(inv);
    const bad = b.accounts.find((a) => a.system === 'BADDEBT') || b.accounts.find((a) => a.type === 'expense' && /bad\s*debt/i.test(a.name));
    return UI.modal({ title: 'Write off ' + UI.typeLabel(inv.type).toLowerCase() + ' ' + (inv.number || ''), html: `<div class="form-grid">
      <p class="span2">Writes off the open <strong>${UI.money(open, { symbol: true })}</strong> as bad debt: a credit memo to an expense account, applied to this invoice. The invoice shows as paid; your income stays as it was.</p>
      <label class="field"><span>Date</span><input type="date" id="wo-date" value="${esc(U.today() < inv.date ? inv.date : U.today())}"></label>
      <label class="field"><span>Expense account</span><select id="wo-acc">${UI.accountOptions(bad ? bad.id : '', (a) => a.active && (a.type === 'expense' || a.type === 'oe'), bad ? { blank: false } : { blankLabel: 'Bad Debt (new account)' })}</select></label>
      <label class="field span2"><span>Memo</span><input id="wo-memo" maxlength="200" value="Bad debt write-off of invoice ${esc(inv.number || '')}"></label>
      ${inv.tax ? `<label class="check span2"><input type="checkbox" id="wo-tax" checked> Reverse the sales tax part (${UI.money(Math.round(inv.tax * open / inv.total), { symbol: true })}) instead of expensing it</label>
      <p class="muted small span2">Most states let you recover sales tax on bad debts; untick only where yours does not.</p>` : ''}</div>`,
      actions: [{ label: 'Cancel', value: null }, { label: 'Write off', danger: true, collect: (m) => ({ date: m.querySelector('#wo-date').value, accountId: m.querySelector('#wo-acc').value, memo: m.querySelector('#wo-memo').value, reverseTax: m.querySelector('#wo-tax') ? m.querySelector('#wo-tax').checked : undefined }) }] })
      .then((v) => v && b.writeOffInvoice(inv.id, v).then((cm) => { UI.toast('Written off — credit memo ' + (cm.number || '') + ' saved'); UI.dirty = false; UI.render(); return cm; }, UI.error));
  };
})();

/* ================= 1.16: attachments card, tax lines page ================= */
(function () {
  'use strict';
  const U = OB.util, UI = OB.ui, R = OB.reports, esc = U.esc, routes = UI.routes;
  const kb = (n) => n < 1024 ? n + ' B' : n < 1048576 ? Math.round(n / 1024) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
  /** Attachments card for a saved transaction (receipts, bills, contracts). */
  UI.attachCard = (host, ownerId) => {
    const b = UI.book; if (!host) return;
    const draw = () => {
      let sec = host.querySelector('[data-testid=attachments]');
      if (!sec) { sec = document.createElement('section'); sec.className = 'card no-print'; sec.dataset.testid = 'attachments'; host.appendChild(sec); }
      const list = b.attachmentsFor(ownerId);
      sec.innerHTML = `<div class="card-head"><h2>Attachments${list.length ? ' (' + list.length + ')' : ''}</h2><span><a class="btn small ghost" href="#/docs">Doc Center</a> <label class="btn small">Attach file…<input type="file" data-testid="attach-file" hidden multiple></label></span></div>
        ${list.length ? `<table class="data compact"><tbody>${list.map((a) => `<tr><td><a href="#" data-open="${esc(a.id)}">${esc(a.name)}</a></td><td class="muted">${esc(kb(a.size))}</td><td class="muted">${esc(new Date(a.addedAt).toLocaleDateString())}</td><td class="actions-cell"><button type="button" class="btn ghost small" data-rm="${esc(a.id)}">Remove</button></td></tr>`).join('')}</tbody></table>`
          : `<p class="muted small">Keep the ${b.txById[ownerId] ? 'receipt, bill or contract with this transaction' : (b.contactById && b.contactById[ownerId] ? 'contracts, W-9s and other papers for this ' + (b.contactById[ownerId].kind === 'vendor' ? 'vendor' : 'customer') : 'related files here')}. Files (up to 4 MB each) are stored in this company and its backups.</p>`}`;
      sec.querySelector('[data-testid=attach-file]').addEventListener('change', (e) => {
        const files = [...e.target.files];
        files.reduce((p, f) => p.then(() => new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => res(null); r.readAsDataURL(f); })
          .then((url) => url ? b.addAttachment({ ownerId, name: f.name, dataUrl: url }).then(() => UI.toast('Attached ' + f.name), UI.error) : UI.toast('Could not read ' + f.name, 'error'))), Promise.resolve()).then(draw);
      });
      sec.querySelectorAll('[data-open]').forEach((x) => x.addEventListener('click', (e) => {
        e.preventDefault();
        const a = b.attachments.find((y) => y.id === x.dataset.open); if (!a) return;
        const bin = atob(a.data.split(',')[1] || ''), arr = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        U.download(a.name, new Blob([arr], { type: a.type }));
      }));
      sec.querySelectorAll('[data-rm]').forEach((x) => x.addEventListener('click', () => UI.confirm('Remove attachment', '<p>Remove this file? The removal is recorded in the audit log.</p>', { ok: 'Remove' }).then((ok) => ok && b.removeAttachment(x.dataset.rm).then(draw, UI.error))));
    };
    draw();
  };

  /* ---------- tax lines ---------- */
  routes.taxlines = (el) => {
    const b = UI.book, Book = OB.Book, co = b.company, form = co.taxForm || '', def = Book.TAX_FORMS[form], map = co.taxLines || {};
    const accs = b.sortedAccounts((a) => ['income', 'oi', 'cogs', 'expense', 'oe'].indexOf(a.type) >= 0 && (a.active || map[a.id]));
    const year = U.today().slice(0, 4);
    el.innerHTML = UI.page('Tax lines', def ? `<a class="btn" href="#/report/taxsum?from=${year}-01-01&to=${year}-12-31">Income Tax Summary</a><button class="btn" id="tl-csv" data-testid="tl-csv">Tax export (CSV)</button>` : '', `
      <form id="tl" class="card" autocomplete="off" data-testid="taxlines">
        <label class="field"><span>Income tax return</span><select name="taxForm" id="tl-form"><option value="">Choose…</option>${Object.keys(Book.TAX_FORMS).map((k) => `<option value="${k}"${k === form ? ' selected' : ''}>${esc(Book.TAX_FORMS[k].label)}</option>`).join('')}</select></label>
        ${def ? `<div class="card-head"><h2>Map each income and expense account to a line</h2><button type="button" class="btn small" id="tl-suggest" data-testid="tl-suggest">Suggest from account names</button></div>
        <table class="data compact"><thead><tr><th>Account</th><th>Type</th><th>Tax line</th></tr></thead><tbody>
          ${accs.map((a) => `<tr><td>${esc(b.accountLabel(a.id))}</td><td>${esc(OB.schema.TYPE[a.type].label)}</td><td><select data-tl="${esc(a.id)}" aria-label="Tax line for ${esc(a.name)}"><option value="">— Not mapped —</option>${def.lines.map((l) => `<option value="${l[0]}"${map[a.id] === l[0] ? ' selected' : ''}>${esc(l[1])}</option>`).join('')}</select></td></tr>`).join('')}</tbody></table>
        <p class="muted small">Line numbers follow the 2025 forms — check them against the year's form. The Income Tax Summary totals each line for your accountant or tax software; the CSV lists each account under its line.</p>` : '<p class="muted">Choose the return your business files to map accounts to its lines.</p>'}
        <div class="form-actions"><button type="submit" class="btn primary" data-key="s">Save tax lines</button></div></form>`, 'Map accounts to income tax return lines.');
    const f = el.querySelector('#tl');
    el.querySelector('#tl-form').addEventListener('change', (e) => b.saveCompany({ taxForm: e.target.value }).then(() => UI.render(), UI.error));
    const sg = el.querySelector('#tl-suggest'); if (sg) sg.addEventListener('click', () => { f.querySelectorAll('[data-tl]').forEach((s) => { if (!s.value) s.value = Book.suggestTaxLine(form, b.accById[s.dataset.tl]) || ''; }); UI.dirty = true; });
    f.addEventListener('submit', (e) => { e.preventDefault(); const m = {}; f.querySelectorAll('[data-tl]').forEach((s) => { if (s.value) m[s.dataset.tl] = s.value; }); b.saveCompany({ taxLines: m }).then(() => { UI.dirty = false; UI.toast('Tax lines saved'); }, UI.error); });
    const csv = el.querySelector('#tl-csv'); if (csv) csv.addEventListener('click', () => U.download(U.safeFileName(co.name + '_tax_lines_' + year) + '.csv', R.taxCsv(b, { from: year + '-01-01', to: year + '-12-31' }), 'text/csv'));
  };
})();

/* ================= 1.17: batch invoicing, deposits, price levels ================= */
(function () {
  'use strict';
  const U = OB.util, UI = OB.ui, esc = U.esc, routes = UI.routes;
  const safeC = (v) => { try { return U.toCents(v); } catch (e) { return NaN; } };

  routes.batchinvoice = (el) => {
    const b = UI.book, custs = b.contacts.filter((c) => c.kind === 'customer' && c.active).sort((x, y) => b.contactLabel(x.id).localeCompare(b.contactLabel(y.id)));
    const items = b.items.filter((x) => x.active !== false);
    const row = () => `<tr class="bl"><td><select data-f="itemId" aria-label="Item"><option value="">—</option>${items.map((x) => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('')}</select></td>
      <td>${UI.comboHtml('account', 'line', '', 'data-f="accountId"', { placeholder: 'Income account', label: 'Income account', hint: 'income' })}</td><td><input data-f="description" aria-label="Description"></td>
      <td class="num"><input data-f="qty" class="qty" value="1" aria-label="Quantity"></td><td class="num"><input data-f="rate" class="money" placeholder="price level" aria-label="Rate"></td></tr>`;
    el.innerHTML = UI.page('Batch invoicing', '', `
      <form id="bi" class="card" autocomplete="off" data-testid="batch-invoice">
        <div class="form-grid cols3"><label class="field"><span>Invoice date</span><input type="date" name="date" value="${esc(U.today())}"></label>
          <label class="field"><span>Customer message</span><input name="message" maxlength="200" value="Thank you for your business."></label>
          <label class="check"><input type="checkbox" name="tax" checked> Use each customer's sales tax</label></div>
        <h2>Lines (the same on every invoice)</h2>
        <table class="data lines-table"><thead><tr><th>Item</th><th>Income account</th><th>Description</th><th class="num">Qty</th><th class="num">Rate</th></tr></thead><tbody class="blines">${row()}${row()}${row()}</tbody></table>
        <p class="muted small">Leave Rate blank on item lines to use each customer's price (price level). Terms, due date and sales tax come from each customer.</p>
        <div class="card-head"><h2>Customers</h2><button type="button" class="btn ghost small" id="bi-all">Select all</button></div>
        <table class="data compact"><tbody>${custs.map((c) => `<tr><td><label class="check"><input type="checkbox" data-c="${esc(c.id)}"> ${esc(b.contactLabel(c.id))}</label></td><td class="muted">${c.priceLevelId && b.priceLevelById(c.priceLevelId) ? esc(b.priceLevelById(c.priceLevelId).name) : ''}</td><td class="muted">Net ${esc(c.terms === undefined ? b.company.defaultTerms : c.terms)}</td></tr>`).join('') || '<tr><td class="muted">No customers yet.</td></tr>'}</tbody></table>
        <div class="form-actions"><button type="submit" class="btn primary" data-testid="bi-create">Create invoices</button><span class="form-status" aria-live="off"></span></div>
        <div id="bi-result"></div></form>`, 'Create the same invoice for many customers at once.');
    const f = el.querySelector('#bi');
    f.addEventListener('change', (e) => {
      if (e.target.dataset.f !== 'itemId' || !e.target.value) return;
      const it = b.itemById[e.target.value], tr = e.target.closest('tr');
      const hid = tr.querySelector('[data-f="accountId"]'); hid.value = it.incomeAccountId || ''; const vis = hid.parentElement.querySelector('.combo-input'); if (vis) vis.value = b.accountLabel(hid.value);
      tr.querySelector('[data-f="description"]').value = it.description || it.name;
    });
    el.querySelector('#bi-all').addEventListener('click', () => f.querySelectorAll('[data-c]').forEach((x) => { x.checked = true; }));
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = Object.fromEntries(new FormData(f).entries());
      const lines = [...f.querySelectorAll('tr.bl')].map((tr) => { const g = (n) => tr.querySelector(`[data-f="${n}"]`).value; return { itemId: g('itemId'), accountId: g('accountId'), description: g('description'), qty: g('qty'), rate: g('rate') }; }).filter((l) => l.accountId);
      const ids = [...f.querySelectorAll('[data-c]:checked')].map((x) => x.dataset.c);
      UI.runSave(f.querySelector('button[type=submit]'), () => b.batchInvoices(ids, { date: v.date, message: v.message, taxId: v.tax ? 'customer' : '', lines }), (r) => r.posted.length + ' invoice(s) created').then((r) => {
        const res = el.querySelector('#bi-result'); if (!r || !r.posted) return;
        res.innerHTML = `<p>${r.posted.length} invoice(s) created: ${r.posted.map((t) => UI.txnLink(t)).join(', ')}.</p>${r.errors.length ? `<div class="banner danger"><ul>${r.errors.map((x) => `<li>${esc(x.name)}: ${esc(x.message)}</li>`).join('')}</ul></div>` : ''}`;
      });
    });
  };

  UI.receiveDeposit = (contactId) => {
    const b = UI.book, banks = (a) => a.active && (a.type === 'bank' || a.system === 'UNDEP');
    return UI.modal({ title: 'Receive deposit or retainer', html: `<div class="form-grid">
      <label class="field span2"><span>Customer</span>${UI.comboHtml('contact', 'customer', contactId || '', 'id="rd-c"', { label: 'Customer' })}</label>
      <label class="field"><span>Date</span><input type="date" id="rd-date" value="${esc(U.today())}"></label>
      <label class="field"><span>Amount</span><input id="rd-amt" class="money" inputmode="decimal" data-testid="rd-amt"></label>
      <label class="field span2"><span>Deposit to</span><select id="rd-acc">${UI.accountOptions((b.sortedAccounts((a) => a.type === 'bank')[0] || {}).id, banks)}</select></label>
      <p class="muted small span2">The money is held in Customer Deposits (a liability) — it is not income yet. When you invoice the customer, choose “+ Apply deposit”.</p></div>`,
      actions: [{ label: 'Cancel', value: null }, { label: 'Save', primary: true, collect: (m) => ({ contactId: m.querySelector('#rd-c').value, date: m.querySelector('#rd-date').value, amount: m.querySelector('#rd-amt').value, accountId: m.querySelector('#rd-acc').value }) }] })
      .then((v) => v && b.receiveDeposit(v).then((t) => { UI.toast('Deposit of ' + U.fmt(t.total, { symbol: true }) + ' received'); UI.render(); return t; }, UI.error));
  };
  /** CPA-12: give back what is left of a customer's deposit, by check from a bank account. */
  UI.refundDeposit = (contactId) => {
    const b = UI.book, held = contactId ? b.depositsHeld(contactId, true) : 0;
    return UI.modal({ title: 'Refund deposit', html: `<div class="form-grid">
      <label class="field span2"><span>Customer</span>${UI.comboHtml('contact', 'customer', contactId || '', 'id="rf-c"', { label: 'Customer' })}</label>
      <label class="field"><span>Date</span><input type="date" id="rf-date" value="${esc(U.today())}"></label>
      <label class="field"><span>Amount</span><input id="rf-amt" class="money" inputmode="decimal" value="${held > 0 ? esc(U.fmtPlain(held)) : ''}" data-testid="rf-amt"></label>
      <label class="field span2"><span>Pay from</span><select id="rf-acc">${UI.accountOptions((b.sortedAccounts((a) => a.type === 'bank')[0] || {}).id, (a) => a.active && a.type === 'bank')}</select></label>
      <p class="muted small span2" id="rf-held">${contactId ? 'Held for this customer: ' + esc(U.fmt(held, { symbol: true })) + '.' : 'You can refund up to what is held for the customer.'}</p></div>`,
      onMount: (m) => m.querySelector('#rf-c').addEventListener('change', (e) => { const h = e.target.value ? b.depositsHeld(e.target.value, true) : 0; m.querySelector('#rf-held').textContent = 'Held for this customer: ' + U.fmt(h, { symbol: true }) + '.'; if (h > 0) m.querySelector('#rf-amt').value = U.fmtPlain(h); }),
      actions: [{ label: 'Cancel', value: null }, { label: 'Refund', primary: true, collect: (m) => ({ contactId: m.querySelector('#rf-c').value, date: m.querySelector('#rf-date').value, amount: m.querySelector('#rf-amt').value, accountId: m.querySelector('#rf-acc').value }) }] })
      .then((v) => v && b.refundDeposit(v).then((t) => { UI.toast('Deposit refund of ' + U.fmt(t.total, { symbol: true }) + ' saved'); UI.render(); return t; }, UI.error));
  };

  routes.pricelevels = (el) => {
    const b = UI.book, list = b.company.priceLevels || [];
    el.innerHTML = UI.page('Price levels', '<button class="btn primary" id="pl-new" data-testid="pl-new">+ New price level</button>', list.length ? `<table class="data" data-testid="pl-table"><thead><tr><th>Name</th><th>Method</th><th>Customers</th><th></th></tr></thead><tbody>
      ${list.map((p) => `<tr><td>${esc(p.name)}</td><td>${p.method === 'pct' ? (p.pct >= 0 ? '+' : '') + esc(p.pct) + '% on every item' : Object.keys(p.prices).length + ' item price(s)'}</td><td>${b.contacts.filter((c) => c.priceLevelId === p.id).length}</td><td><button class="btn ghost small" data-edit="${esc(p.id)}">Edit</button></td></tr>`).join('')}</tbody></table>`
      : UI.empty('Give customers their own prices: a percentage up or down on every item, or a price per item. Choose the level on the customer.'), 'Customer-specific pricing.');
    const edit = (p) => UI.modal({ title: p ? 'Edit price level' : 'New price level', wide: true, html: `<div class="form-grid">
      <label class="field"><span>Name</span><input id="pl-name" value="${esc(p ? p.name : '')}" maxlength="60"></label>
      <label class="field"><span>Method</span><select id="pl-method"><option value="pct">Percentage on every item</option><option value="item"${p && p.method === 'item' ? ' selected' : ''}>Price per item</option></select></label>
      <label class="field"><span>Percent (negative = discount)</span><input id="pl-pct" type="number" step="0.01" value="${esc(p ? p.pct : '-10')}"></label>
      <table class="data compact span2" id="pl-items"><thead><tr><th>Item</th><th class="num">Standard price</th><th class="num">Price at this level</th></tr></thead><tbody>${b.items.filter((x) => x.active !== false).map((x) => `<tr><td>${esc(x.name)}</td><td class="num">${x.price === null || x.price === undefined ? '' : UI.money(x.price)}</td><td class="num"><input class="money" data-ip="${esc(x.id)}" value="${esc(p && p.prices[x.id] !== undefined ? U.fmtPlain(p.prices[x.id]) : '')}"></td></tr>`).join('')}</tbody></table></div>`,
      actions: [{ label: 'Cancel', value: null }, { label: 'Save', primary: true, collect: (m) => { const prices = {}; m.querySelectorAll('[data-ip]').forEach((x) => { if (x.value !== '') prices[x.dataset.ip] = x.value; }); return { id: p ? p.id : '', name: m.querySelector('#pl-name').value, method: m.querySelector('#pl-method').value, pct: m.querySelector('#pl-pct').value, prices }; } }] })
      .then((v) => v && b.savePriceLevel(v).then(() => { UI.toast('Price level saved'); UI.render(); }, UI.error));
    el.querySelector('#pl-new').addEventListener('click', () => edit(null));
    el.querySelectorAll('[data-edit]').forEach((x) => x.addEventListener('click', () => edit(b.priceLevelById(x.dataset.edit))));
  };
})();

/* ================= 1.18: Pay sales tax ================= */
(function () {
  'use strict';
  const U = OB.util, UI = OB.ui, R = OB.reports, esc = U.esc, routes = UI.routes;
  const safeC = (v) => { try { return U.toCents(v); } catch (e) { return NaN; } };
  routes.paysalestax = (el, r) => {
    const b = UI.book, to = (r.params && r.params.to) || U.today(), rep = R.salesTaxByAgency(b, { from: '0000-01-01', to });
    const banks = (a) => a.active && a.type === 'bank';
    const due = rep.rows.filter((x) => x.due !== 0);
    el.innerHTML = UI.page('Pay sales tax', '<a class="btn" href="#/report/taxagency">Sales Tax Return by Agency</a>', `
      <form id="pst" class="card" autocomplete="off" data-testid="pay-sales-tax">
        <div class="form-grid cols3">
          <label class="field"><span>Show sales tax due through</span><input type="date" name="through" value="${esc(to)}"></label>
          <label class="field"><span>Pay from</span><select name="accountId">${UI.accountOptions((b.sortedAccounts((a) => a.type === 'bank')[0] || {}).id, banks)}</select></label>
          <label class="field"><span>Payment date</span><input type="date" name="date" value="${esc(U.today())}"></label>
          <label class="field"><span>Period (printed on the check)</span><input name="period" value="" placeholder="e.g. Q3 2026"></label>
          <label class="check"><input type="checkbox" name="toBePrinted"> Print checks later</label>
        </div>
        ${due.length ? `<table class="data compact"><thead><tr><th><span class="sr-only">Pay</span></th><th>Agency</th><th class="num">Owed through ${UI.date(to)}</th><th class="num">Amount to pay</th></tr></thead><tbody>
          ${due.map((x) => `<tr><td><input type="checkbox" data-pay="${esc(x.agency)}" ${x.due > 0 ? 'checked' : ''} aria-label="Pay ${esc(x.agency)}"></td><td>${esc(x.agency)}</td><td class="num">${UI.money(x.due)}</td><td class="num"><input class="money" data-amt="${esc(x.agency)}" value="${esc(x.due > 0 ? U.fmtPlain(x.due) : '')}" aria-label="Amount for ${esc(x.agency)}"></td></tr>`).join('')}</tbody></table>`
          : UI.empty('No sales tax is owed through this date.')}
        <div class="form-actions"><button type="submit" class="btn primary" data-testid="pst-pay"${due.length ? '' : ' disabled'}>Pay sales tax</button><span class="form-status" aria-live="off"></span></div>
      </form>`, 'One check per tax agency, from the sales tax liability.');
    const f = el.querySelector('#pst');
    { let thr = ''; U.dateCommit(f.querySelector('[name=through]'), (v) => { thr = v; }, () => UI.go('#/paysalestax?' + UI.qs({ to: thr }))); }
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = Object.fromEntries(new FormData(f).entries());
      const items = [...f.querySelectorAll('[data-pay]:checked')].map((x) => ({ agency: x.dataset.pay, amount: safeC(f.querySelector(`[data-amt="${CSS.escape(x.dataset.pay)}"]`).value) || 0 }));
      UI.runSave(f.querySelector('button[type=submit]'), () => b.paySalesTax({ date: v.date, accountId: v.accountId, period: v.period, toBePrinted: !!v.toBePrinted, items }), (x) => (x ? x.length : 0) + ' sales tax payment(s) recorded')
        .then((ok) => { if (ok) UI.render(); });
    });
  };
})();
