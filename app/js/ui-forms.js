/* OfflineBooks US — transaction entry forms. */
(function () {
  'use strict';
  const U = OB.util, S = OB.schema, UI = OB.ui, esc = U.esc;
  const routes = UI.routes;

  const SALES_LINES = { invoice: 1, salesReceipt: 1, creditMemo: 1, estimate: 1, salesOrder: 1 };
  const ITEM_LINES = { invoice: 1, salesReceipt: 1, creditMemo: 1, bill: 1, vendorCredit: 1, expense: 1, check: 1, ccCredit: 1, estimate: 1, purchaseOrder: 1, salesOrder: 1 };
  /** QuickBooks Create Invoices layout (VaultBook theme): invoices and estimates. */
  const QBF = { invoice: 1, estimate: 1, salesOrder: 1 };
  /** Transactions that can be printed as checks (from a bank account). */
  const PRINTABLE = { check: 1, billPayment: 1, expense: 1 };
  /** Sales tax is shown on taxable documents once the company has a rate (or the document already has tax). */
  const taxOn = (d) => !!S.TXN_TYPES[d.type].taxable && ((UI.book.company.salesTaxes || []).length > 0 || !!d.taxId);
  const taxOptions = (sel) => `<option value="">No sales tax</option>` + (UI.book.company.salesTaxes || []).filter((x) => x.active !== false || x.id === sel)
    .map((x) => `<option value="${esc(x.id)}"${x.id === sel ? ' selected' : ''}>${esc(x.name)} (${esc(OB.Book.fmtRate(x.rate))})</option>`).join('');
  /** Default rate for a customer: none when tax-exempt, else their own rate, else the company default. */
  UI.defaultTaxFor = (c) => { const co = UI.book.company; if (c && c.taxExempt) return ''; const id = (c && c.salesTaxId) || co.defaultSalesTaxId || ''; return UI.book.salesTaxById(id) ? id : ''; };
  /** Item column (products & services) when the company has items or the line already uses one. */
  const itemsOn = (type, lines) => !!ITEM_LINES[type] && ((UI.book.items || []).some((x) => x.active !== false) || (lines || []).some((l) => l.itemId));
  const HEAD_LABEL = { salesReceipt: 'Deposit to', payment: 'Deposit to', deposit: 'Deposit to', expense: 'Paid from', check: 'Bank account', billPayment: 'Paid from', customerRefund: 'Refund from', vendorRefund: 'Deposit to', ccCredit: 'Credit card', transfer: 'Transfer from' };
  const CREDIT_FORMS = { payment: 1, billPayment: 1 };   // CPA-06: forms that can also use the contact's open credits
  const DISC_FORMS = { payment: 1, billPayment: 1 };     // CPA-13: forms that can take an early-payment discount
  const APPLY_TITLE = { payment: 'Apply to open invoices', creditMemo: 'Apply credit to open invoices (optional)', customerRefund: 'Refund these credits', billPayment: 'Apply to open bills', vendorCredit: 'Apply credit to open bills (optional)', vendorRefund: 'Refund of these credits' };
  const HELP = {
    invoice: 'Records income now and what the customer owes (Accounts Receivable). Record the money later with Receive payment.',
    salesReceipt: 'A sale paid on the spot: income and the deposit are recorded together.',
    payment: 'Money received for invoices. It reduces Accounts Receivable — it is not counted as income again.',
    creditMemo: 'Reduces what a customer owes (returns, discounts). Apply it to an invoice or refund it.',
    customerRefund: 'Pays back a customer credit (an overpayment or credit memo).',
    vendorRefund: 'Money a vendor paid back to you for a vendor credit or an overpayment.',
    bill: 'Records an expense now and what you owe the vendor (Accounts Payable). Pay it later with Pay bills.',
    billPayment: 'Money paid for bills. It reduces Accounts Payable — it is not counted as an expense again.',
    vendorCredit: 'A credit from a vendor that reduces what you owe on bills.',
    expense: 'Money spent directly from a bank or credit card account.',
    check: 'A paper check written from a bank account.',
    ccCredit: 'A refund or credit on a credit card.',
    deposit: 'Money into a bank account that is not a customer payment (e.g. loans, owner investment, refunds).',
    transfer: 'Moves money between your own accounts. Transfers never create income or expenses.',
    journal: 'Advanced: debit and credit any accounts directly. Debits must equal credits.',
    estimate: 'A quote for a customer. It does not affect your books until you turn it into an invoice.',
    purchaseOrder: 'An order to a vendor. It does not affect your books until you turn it into a bill.',
    salesOrder: 'A customer order to fill. It does not affect your books until you invoice it (all at once or in parts).'
  };

  function blankDraft(type, p) {
    const b = UI.book, def = S.TXN_TYPES[type];
    const d = { type, date: p.date || UI.workDate(), number: '', contactId: p.contact || '', memo: '', accountId: p.account || '', lines: [], jlines: [], applications: [], amount: '' };
    if (!def.special) d.lines = [{}, {}];
    if (type === 'journal') d.jlines = [{}, {}, {}];
    if (def.head === 'account' || (def.special && type !== 'journal')) {
      if (!d.accountId) {
        const allowed = S.HEAD_ACCOUNT_TYPES[type] || [];
        const first = b.sortedAccounts((a) => a.active && allowed.indexOf(a.type) >= 0 && a.type === allowed[0])[0];
        d.accountId = first ? first.id : '';
      }
    }
    if (type === 'check') d.number = b.nextNumber('check');
    if (type === 'invoice' || type === 'bill') {
      const c = d.contactId && b.contactById[d.contactId];
      d.terms = c ? c.terms : b.company.defaultTerms;
      d.dueDate = U.addDays(d.date, +d.terms || 0);
    }
    if (def.taxable) d.taxId = UI.defaultTaxFor(d.contactId && b.contactById[d.contactId]);
    return d;
  }

  routes.txn = (el, r) => {
    const b = UI.book;
    let draft, existing = null;
    if (r.id === 'new') {
      const type = r.params.type;
      if (!S.TXN_TYPES[type]) { UI.newMenu(); return; }
      draft = blankDraft(type, r.params);
      if (r.params.copy && b.txById[r.params.copy]) {
        const src = U.clone(b.txById[r.params.copy]);
        ['id', 'splits', 'status', 'version', 'createdAt', 'updatedAt', 'voidedAt', 'voidReason', 'reversedBy', 'reversalOf', 'importHash', 'recurringId', 'clientToken', 'applications', 'sourceId', 'linkedTo', 'tax', 'taxableAmount', 'taxRate'].forEach((k) => delete src[k]);
        src.number = src.type === 'check' ? b.nextNumber('check') : '';
        src.date = U.today();
        if (src.dueDate) src.dueDate = U.addDays(src.date, +src.terms || 0);
        draft = Object.assign(draft, src, { applications: [] });
      }
      // turn an estimate into an invoice / a purchase order into a bill (the source closes when this is saved)
      const from = r.params.from && b.txById[r.params.from];
      if (from && S.TXN_TYPES[from.type].convertsTo === type && from.status === 'open') {
        Object.assign(draft, { contactId: from.contactId, memo: from.memo || '', classId: from.classId || '', sourceId: from.id,
          lines: b.progressLines(from.id, r.params.mode === 'pct' ? 'pct' : 'rest', r.params.pct) });
        if (S.TXN_TYPES[type].taxable) draft.taxId = from.taxId || '';
        if (from.message !== undefined) draft.message = from.message;
        const c = b.contactById[from.contactId];
        if (draft.terms !== undefined) { draft.terms = c ? c.terms : b.company.defaultTerms; draft.dueDate = U.addDays(draft.date, +draft.terms || 0); }
      }
    } else {
      existing = b.txById[r.id];
      if (!existing) { el.innerHTML = UI.page('Transaction not found', '', UI.empty('This transaction does not exist.')); return; }
      draft = U.clone(existing);
    }
    renderForm(el, draft, existing);
  };

  function renderForm(el, d, existing) {
    if (d.type === 'invAdjust') return UI.invAdjustForm(el, d, existing);
    const b = UI.book, def = S.TXN_TYPES[d.type];
    let updateRate = false; // CPA-02: "Update to current rate" was chosen
    const readOnly = existing && existing.status === 'void';
    const clientToken = U.uid('form');
    const title = def.label + (existing && existing.number ? ' ' + existing.number : '');   // same title rule as the invoice form
    const isApply = !!def.applies;
    const amountType = def.special && d.type !== 'journal';
    const headTypes = S.HEAD_ACCOUNT_TYPES[d.type];
    const contactKind = def.contact;
    const fmtIn = (c) => (c === '' || c === undefined || c === null) ? '' : (typeof c === 'number' ? U.fmtPlain(c) : c);

    let banner = '';
    if (existing && existing.status === 'void') banner = `<div class="banner danger"><strong>Void.</strong> Voided ${esc(new Date(existing.voidedAt).toLocaleString())}${existing.voidReason ? ' — ' + esc(existing.voidReason) : ''}. It is kept for the audit trail and excluded from all reports.</div>`;
    const vje = existing && existing.voidedBy && b.txById[existing.voidedBy];
    if (vje && vje.status === 'posted') banner = `<div class="banner warn"><strong>Voided as of ${esc(U.fmtDate(vje.date))}.</strong> It stays in its own period as reported; ${UI.txnLink(vje)} reverses it${existing.voidReason ? ' — ' + esc(existing.voidReason) : ''}.</div>`; // CPA-21
    else if (existing && existing.splits.some((s) => s.cleared === 'R')) banner = `<div class="banner info">This transaction is part of a completed bank reconciliation, so it is locked. Undo the reconciliation to change it.</div>`;
    if (existing && existing.reversalOf) banner += `<div class="banner info">This entry reverses ${UI.txnLink(b.txById[existing.reversalOf] || { id: existing.reversalOf, type: 'journal', number: '' })}.</div>`;
    if (existing && existing.reversedBy && b.txById[existing.reversedBy] && b.txById[existing.reversedBy].status === 'posted') banner += `<div class="banner info">Reversed by ${UI.txnLink(b.txById[existing.reversedBy])}.</div>`;
    const srcDoc = d.sourceId && b.txById[d.sourceId];
    if (srcDoc) banner += `<div class="banner info" data-testid="from-doc">Created from ${UI.txnLink(srcDoc)}.${existing ? '' : ' Saving closes the ' + esc(S.TXN_TYPES[srcDoc.type].label.toLowerCase()) + '.'}</div>`;
    if (existing && def.nonPosting) {
      const made = (existing.linkedTo || []).map((id) => b.txById[id]).filter(Boolean);
      const pr = b.sourceProgress(existing.id);
      banner += `<div class="banner ${existing.status === 'open' ? 'info' : ''}" data-testid="doc-status"><strong>${existing.status === 'open' ? 'Open' : existing.status === 'closed' ? 'Closed' : 'Void'}.</strong> This ${esc(def.label.toLowerCase())} does not affect your books.${made.length ? ' ' + (def.convertsTo === 'bill' ? 'Billed' : 'Invoiced') + ' ' + UI.money(pr.billed, { symbol: true }) + ' of ' + UI.money(pr.total, { symbol: true }) + ' on ' + made.map((x) => UI.txnLink(x)).join(', ') + '.' : ''}</div>`;
    }
    const locked = readOnly || (existing && existing.splits.some((s) => s.cleared === 'R'));

    // money is deposited to a bank or Undeposited Funds, not to Inventory Asset or Prepaid Expenses (a saved choice stays listed)
    const headOk = (a) => headTypes.indexOf(a.type) >= 0 && (a.type !== 'oca' || a.system === 'UNDEP' || a.id === d.accountId || (b.bankLines || []).some((l) => l.accountId === a.id));   // an asset used like a bank (PayPal clearing) has bank lines
    const headField = headTypes ? `<label class="field"><span>${HEAD_LABEL[d.type] || 'Account'}</span><select name="accountId" required>${UI.accountOptions(d.accountId, headOk)}</select></label>` : '';
    const contactLabel = contactKind === 'customer' ? 'Customer' : contactKind === 'vendor' ? 'Vendor' : 'Payee';
    const contactField = contactKind ? `<label class="field"><span>${contactLabel}${contactKind === 'any' ? ' (optional)' : ''}</span>
      ${UI.comboHtml('contact', contactKind === 'any' ? 'any' : contactKind, d.contactId, 'name="contactId"', { placeholder: 'Type a ' + contactLabel.toLowerCase() + ' name…', label: contactLabel })}</label>` : '';
    const showNumber = d.type !== 'payment' && d.type !== 'transfer';
    const useCls = classesOn();
    const classField = useCls ? `<label class="field"><span>Class${!def.special || d.type === 'journal' ? ' (all lines)' : ''}</span><select name="classId">${UI.classOptions(d.classId || '', { blankLabel: '— None —' })}</select></label>` : '';

    const meta = existing ? `Created ${esc(new Date(existing.createdAt).toLocaleString())}` +
      (existing.version > 1 ? ` · Last changed ${esc(new Date(existing.updatedAt).toLocaleString())}` : '') +
      ` · Version ${existing.version || 1} · <a href="#" data-meta="history">View history</a>` : '';
    const taxField = taxOn(d) ? `<label class="field"><span>Sales tax</span><select name="taxId" data-testid="tax-select">${taxOptions(d.taxId || '')}</select></label>` : '';
    if (QBF[d.type]) el.innerHTML = `<div class="page tx-page qbi-page">${banner}${qbInvoiceForm(d, existing, locked, contactField, classField)}${existing ? relatedHtml(existing) : ''}${existing ? `<p class="muted small qbi-meta">${meta}</p>` : ''}</div>`;
    else el.innerHTML = UI.page(title, existing ? `<span>${UI.statusBadge(existing)}</span>` : '', `
      ${banner}
      <form id="txf" class="txform tx-${esc(d.type)}${locked ? ' locked' : ''}" autocomplete="off" novalidate>
        <fieldset ${locked ? 'disabled' : ''}>
        <div class="tx-head">
          ${contactField}
          ${headField}
          ${d.type === 'transfer' ? `<label class="field"><span>Transfer to</span><select name="toAccountId">${UI.accountOptions(d.toAccountId, (a) => headTypes.indexOf(a.type) >= 0)}</select></label>` : ''}
          <label class="field"><span>Date</span><input type="date" name="date" value="${esc(d.date)}" required></label>
          ${d.type === 'invoice' || d.type === 'bill' ? `<label class="field"><span>Terms (days)</span><input type="number" min="0" max="365" name="terms" value="${esc(d.terms === undefined ? '' : d.terms)}"></label>
            <label class="field"><span>Due date</span><input type="date" name="dueDate" value="${esc(d.dueDate || '')}"></label>` : ''}
          ${showNumber ? `<label class="field"><span>${d.type === 'check' ? 'Check no.' : d.type === 'bill' ? 'Bill no.' : 'No.'}</span><input name="number" value="${esc(d.number || '')}" maxlength="30" placeholder="${def.prefix || d.type === 'journal' ? 'Auto' : d.toBePrinted ? 'To print' : ''}"></label>` : ''}
          ${PRINTABLE[d.type] ? `<label class="check tx-printlater"><input type="checkbox" name="toBePrinted" data-testid="print-later"${d.toBePrinted ? ' checked' : ''}> Print later</label>` : ''}
          ${amountType ? `<label class="field"><span>${d.type === 'payment' ? 'Amount received' : 'Amount'}</span><input name="amount" class="money" inputmode="decimal" value="${esc(fmtIn(d.amount))}" placeholder="0.00"></label>` : ''}
          ${taxField}
          ${classField}
        </div>
        ${!def.special ? linesTable(d) : ''}
        ${d.type === 'journal' ? journalTable(d) : ''}
        ${isApply ? `<section class="apply"><div class="card-head"><h2>${APPLY_TITLE[d.type]}</h2>${amountType ? `${CREDIT_FORMS[d.type] ? '<label class="check small"><input type="checkbox" id="use-credits-first"> Use credits first</label>' : ''}<button type="button" class="btn ghost small" data-act="autoapply">Apply oldest first</button>` : ''}</div><div id="apply-area"></div>${CREDIT_FORMS[d.type] ? '<div id="credit-area"></div>' : ''}</section>` : ''}
        <div class="form-grid cols2">
          <label class="field"><span>Memo</span><textarea name="memo" rows="2" maxlength="500">${esc(d.memo || '')}</textarea></label>
          <div class="totals" id="totals"></div>
        </div>
        </fieldset>
        <div class="form-actions">
          <span class="form-status" aria-live="off"></span>
          <span class="spacer"></span>
          ${existing && existing.status === 'posted' && ['invoice', 'salesReceipt', 'creditMemo'].indexOf(d.type) >= 0 ? `<a class="btn" href="#/print/${esc(existing.id)}" data-key="p">Print / PDF</a>` : ''}
          ${existing && existing.status === 'posted' && PRINTABLE[d.type] && b.accById[existing.accountId] && b.accById[existing.accountId].type === 'bank' ? `<a class="btn" href="#/printchecks?ids=${esc(existing.id)}" data-testid="print-check">Print check</a>` : ''}
          ${existing && def.nonPosting && existing.status === 'open' ? `<button type="button" class="btn primary" data-act="convert" data-testid="convert">Create ${esc(S.TXN_TYPES[def.convertsTo].label.toLowerCase())}</button>` : ''}
          ${existing && def.nonPosting && existing.status !== 'void' ? `<button type="button" class="btn" data-act="docstatus" data-to="${existing.status === 'open' ? 'closed' : 'open'}">${existing.status === 'open' ? 'Mark as closed' : 'Reopen'}</button>` : ''}${existing && existing.status === 'posted' && d.type === 'invoice' ? `<button type="button" class="btn" id="tx-iif-one" data-testid="iif-one" data-id="${esc(existing.id)}">QuickBooks .iif</button>` : ''}
          ${existing ? moreMenu(existing, locked) : ''}
          ${saveButtons(existing, locked)}
        </div>
      </form>
      ${existing ? relatedHtml(existing) : ''}`, existing ? { html: meta } : '');
    if (!QBF[d.type]) el.querySelector('.page').classList.add('tx-page');

    const form = el.querySelector('#txf');
    if (QBF[d.type]) {
      const ms = form.querySelector('#qbi-msg');
      let lastMsg = ms ? ms.value : '';
      if (ms) ms.addEventListener('change', () => {
        if (ms.value !== '__add') { lastMsg = ms.value; return; }
        UI.prompt('New customer message', 'Message (printed at the bottom of the invoice)', '', { ok: 'Add' }).then((m) => {
          m = String(m || '').trim().slice(0, 200);
          if (!m) { ms.value = lastMsg; return; }
          const list = UI.customerMessages(); if (list.indexOf(m) < 0) list.push(m);
          return b.saveCompany({ customerMessages: list }).then(() => {
            if (![...ms.options].some((o) => o.text === m)) ms.querySelector('option[value="__add"]').insertAdjacentHTML('beforebegin', `<option>${esc(m)}</option>`);
            ms.value = m; lastMsg = m; ms.dispatchEvent(new Event('input', { bubbles: true }));
          }, (e) => { ms.value = lastMsg; UI.error(e); });
        });
      });
    }
    const hl = el.querySelector('[data-meta="history"]');
    if (hl) hl.addEventListener('click', (e) => { e.preventDefault(); showHistory(existing); });
    const g = (n) => form.querySelector(`[name="${n}"]`);
    // 1.36: the voucher chips repeat the F-keys, so Tab skips them; a new form starts with the cursor in its first field
    el.querySelectorAll('.vch-switch .vch-k').forEach((x) => { x.tabIndex = -1; });
    if (!existing) requestAnimationFrame(() => {
      const a = document.activeElement;
      if (a && el.contains(a) && a.matches('input, select, textarea')) return;
      const f = form.querySelector('fieldset:not([disabled]) .combo-input, fieldset:not([disabled]) input:not([type=hidden]):not([readonly]):not([type=checkbox]), fieldset:not([disabled]) select');
      if (f) f.focus();
    });
    // typing in the last line of a line grid adds the next empty line, so a form never needs a screenful of blank rows
    form.addEventListener('input', (e) => {
      const tr = e.target.closest && e.target.closest('tbody.lines > tr, tbody.jlines > tr'); if (!tr || tr.nextElementSibling || !e.target.value) return;
      const btn = form.querySelector(tr.parentElement.classList.contains('jlines') ? '[data-act="addjline"]' : '[data-act="addline"]'); if (btn) btn.click();
    });
    let appState = {}; // txnId -> string amount
    let creditState = {}; // CPA-06: credit txnId -> { use: string amount, target: txnId }
    let discState = {}; // CPA-13: document id -> true when the early-payment discount is taken
    (d.applications || []).forEach((a) => { appState[a.txnId] = U.fmtPlain(a.amount); });
    // A new payment applies the amount typed to the oldest open documents, as QuickBooks does,
    // until the user picks or types applications themselves.
    const AUTO_APPLY = !existing && (d.type === 'payment' || d.type === 'billPayment');
    let manualApply = false;

    /* ---- gather draft from form ---- */
    function gather() {
      const out = { type: d.type, id: existing ? existing.id : '', clientToken };
      out.date = g('date').value;
      if (g('number')) out.number = g('number').value;
      if (g('contactId')) out.contactId = g('contactId').value;
      if (g('accountId')) out.accountId = g('accountId').value;
      if (g('toAccountId')) out.toAccountId = g('toAccountId').value;
      if (g('amount')) out.amount = g('amount').value;
      if (g('dueDate')) {
        out.dueDate = g('dueDate').value; out.terms = g('terms').value;
        // CPA-13: early-payment discount terms come from the customer / vendor (an existing document keeps its own)
        const dsrc = existing && existing.contactId === out.contactId ? existing : b.contactById[out.contactId];
        if (dsrc && dsrc.discountPct > 0) { out.discountPct = dsrc.discountPct; out.discountDays = dsrc.discountDays; }
      }
      out.memo = g('memo').value;
      if (g('message')) out.message = g('message').value === '__add' ? '' : g('message').value;
      if (g('classId')) out.classId = g('classId').value;
      if (g('taxId')) out.taxId = g('taxId').value;
      if (updateRate) out.updateTaxRate = true;   // CPA-02: re-tax at today's rate only when asked
      else if (d.taxId && def.taxable) out.taxId = d.taxId;
      if (d.sourceId) out.sourceId = d.sourceId;
      if (g('toBePrinted')) out.toBePrinted = g('toBePrinted').checked;
      if (!def.special) {
        out.lines = [...form.querySelectorAll('tr.line')].map((tr) => {
          const v = (n) => { const x = tr.querySelector(`[data-f="${n}"]`); return x ? x.value : ''; };
          const tx = tr.querySelector('[data-f="taxable"]');
          return { accountId: v('accountId'), itemId: v('itemId'), description: v('description'), qty: v('qty'), rate: v('rate'), amount: v('amount'), classId: v('classId'), taxable: tx ? tx.checked : false, fromTxnId: v('fromTxnId'), contactId: v('contactId'), billable: (tr.querySelector('[data-f="billable"]') || {}).checked || false, billOf: v('billOf'), srcLine: v('srcLine') };
        }).filter((l) => l.accountId || (l.amount && U.toCents(l.amount)) || l.description);
      }
      if (d.type === 'journal') {
        out.jlines = [...form.querySelectorAll('tr.jline')].map((tr) => {
          const v = (n) => { const x = tr.querySelector(`[data-f="${n}"]`); return x ? x.value : ''; };
          return { accountId: v('accountId'), debit: v('debit'), credit: v('credit'), contactId: v('contactId'), memo: v('memo'), classId: v('classId') };
        }).filter((l) => l.accountId || l.debit || l.credit);
      }
      if (isApply) out.applications = Object.keys(appState).filter((k) => appState[k] && safeC(appState[k])).map((k) => ({ txnId: k, amount: appState[k] }));
      if (existing && existing.reversalOf) out.reversalOf = existing.reversalOf;
      return out;
    }
    function safeC(v) { try { return U.toCents(v); } catch (e) { return NaN; } }

    /* ---- live totals ---- */
    function updateTotals() {
      const tot = el.querySelector('#totals');
      if (!def.special) {
        let sum = 0, taxable = 0;
        form.querySelectorAll('tr.line').forEach((tr) => {
          const am = tr.querySelector('[data-f="amount"]'), tx = tr.querySelector('[data-f="taxable"]'), v = safeC(am.value) || 0;
          sum += v; if (tx && tx.checked) taxable += v;
        });
        const stx = g('taxId') && b.salesTaxById(g('taxId').value);
        // CPA-02: an edited document keeps the rate it was posted at (the engine does the same)
        const posted = stx && existing && existing.taxId === stx.id && existing.taxRate !== undefined && !updateRate ? existing.taxRate : null;
        const rate = posted !== null ? posted : stx ? stx.rate : 0;
        const tax = stx ? OB.Book.taxOn(taxable, rate) : 0;
        const stale = posted !== null && posted !== stx.rate;
        const rateNote = stale ? ` <button type="button" class="link-btn small" data-act="updaterate" title="This document keeps the rate it was posted at">Update to current rate (${esc(OB.Book.fmtRate(stx.rate))})</button>` : '';
        const taxRows = stx ? `<div class="sub-t"><span>${QBF[d.type] ? 'SUBTOTAL' : 'Subtotal'}</span><b>${U.fmt(sum)}</b></div><div class="tax-t" data-testid="tax-amount"><span>${QBF[d.type] ? 'TAX' : 'Sales tax'} ${esc(OB.Book.fmtRate(rate))}${stale ? ' (as posted)' : ''}${rateNote}</span><b>${U.fmt(tax)}</b></div>` : '';
        const lt = el.querySelector('#qbi-taxrate'); if (lt) lt.textContent = stx ? '(' + OB.Book.fmtRate(rate) + ')' : '';
        sum += tax;
        creditCheck(sum);
        let extra = '';
        if (isApply) { const ap = appliedSum(); extra = `<div><span>Applied</span><b>${UI.money(ap)}</b></div><div><span>Remaining credit</span><b>${UI.money(sum - ap)}</b></div>`; }
        if (existing && (d.type === 'invoice' || d.type === 'bill') && existing.status === 'posted') {
          const paid = b.incomingApplied(existing.id);
          extra += `<div><span>Paid / credited</span><b>${UI.money(paid)}</b></div><div><span>Balance due</span><b>${UI.money(sum - paid)}</b></div>`;
        }
        if (d.type === 'invoice') {
          const paid = existing && existing.status === 'posted' ? b.incomingApplied(existing.id) : 0;
          tot.innerHTML = `${taxRows}<div><span>TOTAL</span><b>${U.fmt(sum)}</b></div><div><span>PAYMENTS APPLIED</span><b>${U.fmt(paid)}</b></div><div class="qbi-due"><span>BALANCE DUE</span><b>${U.fmt(sum - paid)}</b></div>`;
          return;
        }
        if (QBF[d.type]) { tot.innerHTML = `${taxRows}<div class="qbi-due"><span>TOTAL</span><b>${U.fmt(sum)}</b></div>`; return; }
        tot.innerHTML = `${taxRows}<div class="grand"><span>Total</span><b>${UI.money(sum, { symbol: true })}</b></div>${extra}`;
      } else if (d.type === 'journal') {
        let dr = 0, cr = 0;
        form.querySelectorAll('tr.jline').forEach((tr) => { dr += safeC(tr.querySelector('[data-f="debit"]').value) || 0; cr += safeC(tr.querySelector('[data-f="credit"]').value) || 0; });
        journalHint();
        tot.innerHTML = `<div><span>Total debits</span><b>${UI.money(dr)}</b></div><div><span>Total credits</span><b>${UI.money(cr)}</b></div>
          <div class="grand ${dr === cr ? (dr ? 'balanced' : '') : 'unbalanced'}"><span>${dr === cr ? (dr ? 'Balanced' : 'Enter amounts') : 'Out of balance'}</span><b>${UI.money(dr - cr)}</b></div>`;
      } else {
        const amt = safeC(g('amount').value) || 0;
        if (isApply) {
          const ap = appliedSum();
          tot.innerHTML = `<div><span>Amount</span><b>${UI.money(amt)}</b></div><div><span>Applied</span><b>${UI.money(ap)}</b></div>
            <div class="grand ${amt - ap < 0 ? 'unbalanced' : ''}"><span>${amt - ap < 0 ? 'Applied exceeds amount' : 'Unapplied (kept as credit)'}</span><b>${UI.money(amt - ap)}</b></div>`;
        } else tot.innerHTML = `<div class="grand"><span>Amount</span><b>${UI.money(amt, { symbol: true })}</b></div>`;
      }
    }
    /** Warn (do not block) when an invoice would take a customer past their credit limit. */
    function creditCheck(total) {
      let host = el.querySelector('#credit-hint');
      const c = d.type === 'invoice' && g('contactId') && b.contactById[g('contactId').value];
      let limit = NaN; try { limit = c && c.creditLimit ? U.toCents(c.creditLimit) : NaN; } catch (e) { limit = NaN; }
      const after = c ? b.contactBalance(c.id) - (existing && existing.status === 'posted' ? b.openBalance(existing) : 0) + total : 0;
      if (!(limit > 0) || after <= limit) { if (host) host.remove(); return; }
      if (!host) { host = document.createElement('div'); host.id = 'credit-hint'; host.className = 'banner warn'; host.setAttribute('role', 'status'); host.dataset.testid = 'credit-hint'; form.prepend(host); }
      host.innerHTML = `<strong>Over credit limit.</strong> ${esc(c.name)}'s balance would be ${UI.money(after, { symbol: true })}, over the credit limit of ${UI.money(limit, { symbol: true })}. You can still save.`;
    }
    function journalHint() {
      let host = el.querySelector('#je-hint');
      const types = [...form.querySelectorAll('tr.jline [data-f="accountId"]')].map((x) => b.accById[x.value] && b.accById[x.value].type).filter(Boolean);
      const cash = types.some((t) => t === 'bank' || t === 'cc');
      const msg = cash && types.indexOf('ar') >= 0 ? `This entry moves money against <strong>Accounts Receivable</strong>. If it is a customer paying an invoice, use <a href="#/txn/new?type=payment">Receive payment</a> instead — a journal entry won't mark the invoice as paid; it leaves the invoice open and gives the customer an unapplied credit.`
        : cash && types.indexOf('ap') >= 0 ? `This entry moves money against <strong>Accounts Payable</strong>. If it is a payment of a bill, use <a href="#/txn/new?type=billPayment">Pay bills</a> instead — a journal entry won't mark the bill as paid.` : '';
      if (!msg) { if (host) host.remove(); return; }
      if (!host) { host = document.createElement('div'); host.id = 'je-hint'; host.className = 'banner info'; host.setAttribute('role', 'note'); form.querySelector('[data-act="addjline"]').insertAdjacentElement('afterend', host); }
      host.innerHTML = msg;
    }
    function appliedSum() { return U.sum(Object.keys(appState), (k) => safeC(appState[k]) || 0); }

    /* ---- applications grid ---- */
    function renderApply() {
      const area = el.querySelector('#apply-area');
      if (!area) return;
      setTimeout(renderCredits);
      const cid = g('contactId').value;
      if (!cid) { area.innerHTML = `<p class="muted">Choose a ${contactKind} to see open ${def.applies.indexOf('invoice') >= 0 ? 'invoices' : def.applies.indexOf('bill') >= 0 ? 'bills' : 'credits'}.</p>`; return; }
      const docs = b.openDocs(d.type, cid, existing ? existing.id : '');
      // keep previously-applied docs visible even if now fully applied by this txn
      Object.keys(appState).forEach((k) => { if (!docs.some((x) => x.id === k) && b.txById[k]) docs.push(b.txById[k]); });
      Object.keys(appState).forEach((k) => { if (!b.txById[k] || b.txById[k].contactId !== cid) delete appState[k]; });
      // CPA-13: early-payment discounts still available on the payment date (new payments only)
      const payDate = g('date') ? g('date').value : U.today(), discOf = (t) => existing || !DISC_FORMS[d.type] ? 0 : b.discountAvailable(t.id, payDate).amount;
      Object.keys(discState).forEach((k) => { if (!docs.some((x) => x.id === k) || !discOf(b.txById[k])) delete discState[k]; });
      const anyDisc = docs.some((t) => discOf(t) > 0);
      if (!docs.length) { area.innerHTML = `<p class="muted">Nothing open for this ${contactKind}.${d.type === 'payment' ? ' A payment saved now is kept as a credit on the customer’s account.' : ''}</p>`; return; }
      area.innerHTML = `<table class="data compact"><thead><tr><th><span class="sr-only">Apply</span></th><th>Date</th><th>Document</th><th>Due</th><th class="num">Original</th><th class="num">Open</th>${anyDisc ? '<th class="num">Discount</th>' : ''}<th class="num">Apply</th></tr></thead><tbody>
        ${docs.map((t) => {
          const open = b.openBalance(t, existing ? existing.id : '') + (existing ? 0 : 0);
          const v = appState[t.id] || '';
          return `<tr><td><input type="checkbox" data-pick="${esc(t.id)}" ${v && safeC(v) ? 'checked' : ''} aria-label="Apply"></td><td>${UI.date(t.date)}</td><td>${UI.txnLink(t)}</td><td>${UI.date(t.dueDate || '')}</td>
            <td class="num">${UI.money(t.total)}</td><td class="num">${UI.money(open)}</td>
            ${anyDisc ? `<td class="num">${discOf(t) ? `<label class="check small"><input type="checkbox" data-disc="${esc(t.id)}" ${discState[t.id] ? 'checked' : ''}> Take ${UI.money(discOf(t))}</label>` : ''}</td>` : ''}
            <td class="num"><input class="money" inputmode="decimal" data-app="${esc(t.id)}" data-open="${open}" value="${esc(v)}" placeholder="0.00"></td></tr>`;
        }).join('')}</tbody></table>`;
    }
    /* ---- available credits (CPA-06): credit memos / unapplied payments used on the documents above ---- */
    function creditsFor() { const cid = g('contactId') && g('contactId').value; return cid ? b.availableCredits(cid, contactKind).filter((x) => !existing || x.t.id !== existing.id) : []; }
    function creditUse(target) { return U.sum(Object.keys(creditState), (k) => creditState[k].target === target ? safeC(creditState[k].use) || 0 : 0); }
    function renderCredits() {
      const area = el.querySelector('#credit-area'); if (!area) return;
      const cr = creditsFor(), docs = b.openDocs(d.type, g('contactId').value, existing ? existing.id : '');
      Object.keys(creditState).forEach((k) => { if (!cr.some((x) => x.t.id === k)) delete creditState[k]; });
      if (!cr.length || !docs.length) { area.innerHTML = ''; return; }
      const opts = (sel) => docs.map((t) => `<option value="${esc(t.id)}"${t.id === sel ? ' selected' : ''}>${esc(UI.typeLabel(t.type) + ' ' + (t.number || U.fmtDate(t.date)))} · ${esc(U.fmt(b.openBalance(t, existing ? existing.id : ''), { symbol: true }))} open</option>`).join('');
      area.innerHTML = `<h3 class="apply-sub">Available credits</h3><table class="data compact" data-testid="credits"><thead><tr><th><span class="sr-only">Use</span></th><th>Date</th><th>Credit</th><th class="num">Available</th><th class="num">Use</th><th>Apply to</th></tr></thead><tbody>
        ${cr.map((x) => { const st = creditState[x.t.id] || { use: '', target: (docs[0] || {}).id || '' };
          return `<tr><td><input type="checkbox" data-cr-pick="${esc(x.t.id)}" ${st.use && safeC(st.use) ? 'checked' : ''} aria-label="Use this credit"></td><td>${UI.date(x.t.date)}</td><td>${UI.txnLink(x.t)}</td>
            <td class="num">${UI.money(x.open)}</td><td class="num"><input class="money" inputmode="decimal" data-cr-use="${esc(x.t.id)}" data-open="${x.open}" value="${esc(st.use)}" placeholder="0.00"></td>
            <td><select data-cr-target="${esc(x.t.id)}" aria-label="Apply to">${opts(st.target)}</select></td></tr>`; }).join('')}</tbody></table>
        <p class="muted small">Credits are applied to the chosen ${def.applies.indexOf('invoice') >= 0 ? 'invoice' : 'bill'} when you save; the ${def.label.toLowerCase()} itself does not change.</p>`;
    }
    /** Validate credit choices against what stays open after this payment. Returns an error message or ''. */
    function creditErrors() {
      for (const k of Object.keys(creditState)) {
        const st = creditState[k], use = safeC(st.use) || 0; if (!use) continue;
        const cr = b.txById[k], open = b.openBalance(cr);
        if (use > open) return `${UI.typeLabel(cr.type)} ${cr.number || ''} has only ${U.fmt(open, { symbol: true })} available.`;
        const tgt = b.txById[st.target]; if (!tgt) return 'Choose where to apply each credit.';
        const left = b.openBalance(tgt, existing ? existing.id : '') - (safeC(appState[tgt.id]) || 0) - creditUse(tgt.id);
        if (left < 0) return `${UI.typeLabel(tgt.type)} ${tgt.number || ''}: the payment and credits are ${U.fmt(-left, { symbol: true })} more than is open.`;
      }
      return '';
    }
    function autoApply() {
      let remaining = safeC(g('amount').value) || 0;
      appState = {};
      const docs = b.openDocs(d.type, g('contactId').value, existing ? existing.id : '');
      // "Use credits first": credits cover the oldest documents before any cash
      const useCr = el.querySelector('#use-credits-first'), used = {};
      if (useCr && useCr.checked) {
        creditState = {};
        creditsFor().forEach((x) => {
          let left = x.open;
          docs.forEach((t) => {
            if (left <= 0 || creditState[x.t.id]) return;
            const room = b.openBalance(t, existing ? existing.id : '') - (used[t.id] || 0); if (room <= 0) return;
            const a = Math.min(room, left); creditState[x.t.id] = { use: U.fmtPlain(a), target: t.id }; used[t.id] = (used[t.id] || 0) + a; left -= a;
          });
        });
        if (!g('amount').dataset.touched) remaining = 0;
      }
      if (!remaining) { remaining = U.sum(docs, (t) => b.openBalance(t, existing ? existing.id : '') - (used[t.id] || 0)); g('amount').value = U.fmtPlain(remaining); }
      docs.forEach((t) => {
        if (remaining <= 0) return;
        const open = b.openBalance(t, existing ? existing.id : '') - (used[t.id] || 0);
        const a = Math.min(open, remaining);
        if (a > 0) { appState[t.id] = U.fmtPlain(a); remaining -= a; }
      });
      renderApply(); renderCredits(); updateTotals();
    }
    /** Spread the typed amount over the open documents, oldest first. Leaves the amount field alone. */
    function applyTyped() {
      let remaining = safeC(g('amount').value) || 0;
      appState = {};
      b.openDocs(d.type, g('contactId').value, '').forEach((t) => {
        const a = Math.min(b.openBalance(t) - creditUse(t.id), remaining);
        if (a > 0) { appState[t.id] = U.fmtPlain(a); remaining -= a; }
      });
      renderApply();
    }

    /* ---- events ---- */
    // choosing a product/service fills the line: account, description, rate (and amount when a quantity is known)
    form.addEventListener('change', (e) => {
      const t = e.target; if (t.dataset.f !== 'itemId' || !t.value) return;
      const it = b.itemById[t.value], tr = t.closest('tr'); if (!it || !tr) return;
      const sales = SALES_LINES[d.type];
      const accId = sales ? (it.incomeAccountId || it.expenseAccountId) : (b.tracked(it.id) ? it.assetAccountId : (it.expenseAccountId || it.incomeAccountId));
      const set = (f, v) => { const x = tr.querySelector(`[data-f="${f}"]`); if (x && v !== undefined && v !== null) { x.value = v; x.dispatchEvent(new Event('input', { bubbles: true })); } };
      if (accId) { const hid = tr.querySelector('[data-f="accountId"]'); hid.value = accId; const vis = hid.parentElement.querySelector('.combo-input'); if (vis) vis.value = b.accountLabel(accId); hid.dispatchEvent(new Event('change', { bubbles: true })); }
      set('description', (sales ? it.description : (it.purchaseDescription || it.description)) || '');
      // CPA-22: a discount follows the taxability of the line above it, so tax is on the discounted amount
      let prevTax = !!it.taxable;
      if (it.type === 'discount') { let pr = tr.previousElementSibling; while (pr && !pr.querySelector('[data-f="taxable"]')) pr = pr.previousElementSibling; prevTax = !!(pr && pr.querySelector('[data-f="taxable"]').checked); }
      const tb = tr.querySelector('[data-f="taxable"]'); if (tb) { tb.checked = prevTax; tb.dispatchEvent(new Event('change', { bubbles: true })); }
      const price = sales ? b.priceFor(it.id, g('contactId') ? g('contactId').value : '') : (it.cost !== null && it.cost !== undefined ? it.cost : it.price);
      if (tr.querySelector('[data-f="rate"]')) {
        const q = tr.querySelector('[data-f="qty"]'); if (q && !q.value) set('qty', '1');
        if (price !== null && price !== undefined) set('rate', U.fmtPlain(price));
      } else if (price !== null && price !== undefined) set('amount', U.fmtPlain(price));
    });
    form.addEventListener('input', (e) => {
      const t = e.target;
      if (t.dataset.f === 'qty' || t.dataset.f === 'rate') {
        const tr = t.closest('tr'), q = tr.querySelector('[data-f="qty"]').value, rt = tr.querySelector('[data-f="rate"]').value;
        if (q !== '' && rt !== '' && !isNaN(+q)) { const c = safeC(rt); if (!isNaN(c)) tr.querySelector('[data-f="amount"]').value = U.fmtPlain(Math.round(+q * c)); }
      }
      if (t.dataset.app) {
        appState[t.dataset.app] = t.value;
        const cb = form.querySelector(`[data-pick="${t.dataset.app}"]`); if (cb) cb.checked = !!safeC(t.value);
        if (d.type === 'payment' || d.type === 'billPayment' || d.type === 'customerRefund' || d.type === 'vendorRefund') {
          if (!g('amount').dataset.touched) g('amount').value = U.fmtPlain(appliedSum());
        }
      }
      if (t.dataset.crUse) {   // CPA-06
        const st = creditState[t.dataset.crUse] = creditState[t.dataset.crUse] || { use: '', target: (form.querySelector(`[data-cr-target="${t.dataset.crUse}"]`) || {}).value || '' };
        st.use = t.value; const cb = form.querySelector(`[data-cr-pick="${t.dataset.crUse}"]`); if (cb) cb.checked = !!safeC(t.value);
      }
      if (t.name === 'amount') { t.dataset.touched = '1'; if (AUTO_APPLY && !manualApply && g('contactId').value) applyTyped(); }
      if (t.dataset.app && e.isTrusted) manualApply = true;
      if (t.dataset.f === 'debit' && t.value) t.closest('tr').querySelector('[data-f="credit"]').value = '';
      if (t.dataset.f === 'credit' && t.value) t.closest('tr').querySelector('[data-f="debit"]').value = '';
      updateTotals();
    });
    form.addEventListener('change', (e) => {
      const t = e.target;
      const row = t.closest && t.closest('tr.line, tr.jline');
      if (row && t.dataset.f === 'accountId' && t.value) {
        // keep a blank row ready at the bottom, like a paper journal
        if (!row.nextElementSibling) row.parentNode.insertAdjacentHTML('beforeend', row.classList.contains('jline') ? jlineRow({}) : QBF[d.type] ? qbLineRow({}, !!form.querySelector('table.with-items'), taxOn(d)) : lineRow(d.type, {}, !!form.querySelector('table.with-items'), taxOn(d)));
        // journal: suggest the amount that balances the entry
        if (row.classList.contains('jline')) {
          const de = row.querySelector('[data-f="debit"]'), cr = row.querySelector('[data-f="credit"]');
          if (!de.value && !cr.value) {
            let dr = 0, crt = 0;
            form.querySelectorAll('tr.jline').forEach((r) => { dr += safeC(r.querySelector('[data-f="debit"]').value) || 0; crt += safeC(r.querySelector('[data-f="credit"]').value) || 0; });
            if (dr > crt) cr.value = U.fmtPlain(dr - crt); else if (crt > dr) de.value = U.fmtPlain(crt - dr);
          }
        }
        updateTotals();
      }
      if (t.name === 'contactId') {
        const c = b.contactById[t.value];
        if (c && g('terms')) { setTerms(g('terms'), c.terms); g('dueDate').value = U.addDays(g('date').value || U.today(), +c.terms || 0); }
        const addr = el.querySelector('#qbi-addr'); if (addr) addr.innerHTML = billToHtml(c);
        if (g('taxId') && c) { const tid = UI.defaultTaxFor(c); if ([...g('taxId').options].some((o) => o.value === tid)) g('taxId').value = tid; }
        billBtn();
        appState = {}; manualApply = false;
        if (AUTO_APPLY && g('amount').dataset.touched) applyTyped(); else renderApply();
        updateTotals();
      }
      if (t.dataset.f === 'taxable' || t.name === 'taxId') updateTotals();
      // "Print later": the check gets its number when printed (Print checks), so the number field is cleared
      if (t.name === 'toBePrinted' && g('number')) {
        if (t.checked) { g('number').dataset.was = g('number').value; g('number').value = ''; g('number').placeholder = 'To print'; }
        else { if (!g('number').value && g('number').dataset.was) g('number').value = g('number').dataset.was; g('number').placeholder = ''; }
      }
      if ((t.name === 'terms' || t.name === 'date') && g('terms') && g('terms').value !== '' && U.isDate(g('date').value)) g('dueDate').value = U.addDays(g('date').value, +g('terms').value || 0);
      if (t.name === 'date' && DISC_FORMS[d.type] && !existing) renderApply(); // CPA-13: discount availability depends on the date
      if (t.dataset.crTarget) { (creditState[t.dataset.crTarget] = creditState[t.dataset.crTarget] || { use: '' }).target = t.value; }
      if (t.dataset.crPick) {   // CPA-06: tick a credit → use what the chosen document still needs, up to what the credit has
        const id = t.dataset.crPick, inp = form.querySelector(`[data-cr-use="${id}"]`), sel = form.querySelector(`[data-cr-target="${id}"]`);
        const st = creditState[id] = creditState[id] || { use: '', target: sel ? sel.value : '' }; st.target = sel ? sel.value : st.target;
        if (t.checked) {
          st.use = ''; const tgt = b.txById[st.target];
          const need = tgt ? b.openBalance(tgt, existing ? existing.id : '') - (safeC(appState[tgt.id]) || 0) - creditUse(tgt.id) : 0;
          st.use = U.fmtPlain(Math.max(0, Math.min(+inp.dataset.open, need)));
        } else st.use = '';
        inp.value = st.use; UI.dirty = true; updateTotals();
      }
      if (t.dataset.disc) {
        // taking the discount: the payment applies the rest of the open balance
        manualApply = true;
        if (t.checked) discState[t.dataset.disc] = true; else delete discState[t.dataset.disc];
        const inp = form.querySelector(`[data-app="${t.dataset.disc}"]`), dv = b.discountAvailable(t.dataset.disc, g('date').value).amount;
        if (inp && t.checked) { inp.value = U.fmtPlain(Math.max(0, +inp.dataset.open - dv)); inp.dispatchEvent(new Event('input', { bubbles: true })); }
        UI.dirty = true;
      }
      if (t.dataset.pick) {
        manualApply = true;
        const inp = form.querySelector(`[data-app="${t.dataset.pick}"]`);
        if (t.checked) {
          let open = +inp.dataset.open;
          const amt = safeC(g('amount') ? g('amount').value : '') || 0;
          if (g('amount') && g('amount').dataset.touched && amt) open = Math.max(0, Math.min(open, amt - (appliedSum() - (safeC(inp.value) || 0))));
          inp.value = U.fmtPlain(open);
        } else inp.value = '';
        inp.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    form.addEventListener('click', (e) => {
      const a = e.target.closest('[data-act]');
      if (!a) return;
      const act = a.dataset.act;
      if (act === 'updaterate') {
        const stx = g('taxId') && b.salesTaxById(g('taxId').value);
        UI.confirm('Update to current tax rate?', `<p>This document was posted at ${esc(OB.Book.fmtRate(existing.taxRate))}. Re-tax it at today's ${esc(OB.Book.fmtRate(stx.rate))}? The change is saved when you save.</p>`, { ok: 'Update rate' })
          .then((yes) => { if (yes) { updateRate = true; UI.dirty = true; updateTotals(); } });
        return;
      }
      if (act === 'addline') { form.querySelector('tbody.lines').insertAdjacentHTML('beforeend', QBF[d.type] ? qbLineRow({}, !!form.querySelector('table.with-items'), taxOn(d)) : lineRow(d.type, {}, !!form.querySelector('table.with-items'), taxOn(d))); }
      if (act === 'docstatus' && existing) { b.setDocStatus(existing.id, a.dataset.to).then(() => { UI.toast(def.label + (a.dataset.to === 'closed' ? ' closed' : ' reopened')); UI.dirty = false; UI.render(); }, UI.error); return; }
      if (act === 'addjline') { form.querySelector('tbody.jlines').insertAdjacentHTML('beforeend', jlineRow({})); }
      if (act === 'rmline') { const tbody = a.closest('tbody'); if (tbody.children.length > 1) a.closest('tr').remove(); else a.closest('tr').querySelectorAll('input,select').forEach((x) => { x.value = ''; }); updateTotals(); }
      if (act === 'autoapply') autoApply();
      if (act === 'retry') { submit('view'); return; }
      if (act === 'close') { UI.confirmLeave(() => { UI.dirty = false; if (history.length > 1) history.back(); else UI.go('#/transactions'); }); return; }
      if (act === 'more') { toggleMenu(a); return; }
      closeMenus();
      if (act === 'duplicate') UI.go('#/txn/new?type=' + d.type + '&copy=' + existing.id);
      if (act === 'revert') { UI.confirmLeave(() => { UI.dirty = false; UI.render(); }); return; }
      if (act === 'findPrev' || act === 'findNext') { const id = a.dataset.target; if (id) UI.go('#/txn/' + id); return; }
      if (act === 'voidQb' && existing) doVoid(existing);
      if (act === 'journal') UI.drawer({ title: 'Transaction journal', sub: def.label + (existing.number ? ' ' + existing.number : '') + ' · ' + U.fmtDate(existing.date), html: journalHtml(existing) });
      if (act === 'history') showHistory(existing);
      if (act === 'void') doVoid(existing);
      if (act === 'reverse') doReverse(existing);
      if (act === 'bounce') doBounce(existing);
      if (act === 'recurring') makeRecurring(existing);
      if (act === 'writeoff') UI.writeOff(existing);
      if (act === 'convert' && existing) {
        const to = def.convertsTo, pr = b.sourceProgress(existing.id), left = pr.total - pr.billed, word = to === 'bill' ? 'bill' : 'invoice';
        UI.modal({ title: 'Create ' + S.TXN_TYPES[to].label.toLowerCase() + ' from ' + def.label.toLowerCase() + ' ' + (existing.number || ''), html: `<div class="form-grid">
          <p class="span2">${pr.billed ? 'Already ' + (to === 'bill' ? 'billed' : 'invoiced') + ': ' + UI.money(pr.billed, { symbol: true }) + ' of ' + UI.money(pr.total, { symbol: true }) + '.' : 'Total: ' + UI.money(pr.total, { symbol: true }) + '.'}</p>
          <label class="check span2"><input type="radio" name="pm" value="rest" checked> Everything that is left (${UI.money(left, { symbol: true })})</label>
          <label class="check"><input type="radio" name="pm" value="pct"> A percentage of each line</label><label class="field"><span>Percent</span><input id="pm-pct" type="number" min="1" max="100" value="50" data-testid="pm-pct"></label>
          <p class="muted small span2">Each line can't go over what is left on its ${esc(def.label.toLowerCase())} line. The ${esc(def.label.toLowerCase())} closes when everything is ${to === 'bill' ? 'billed' : 'invoiced'}.</p></div>`,
          actions: [{ label: 'Cancel', value: null }, { label: 'Continue', primary: true, collect: (m) => ({ mode: m.querySelector('[name=pm]:checked').value, pct: m.querySelector('#pm-pct').value }) }] })
          .then((v) => { if (v) UI.go('#/txn/new?type=' + to + '&from=' + existing.id + (v.mode === 'pct' ? '&mode=pct&pct=' + encodeURIComponent(v.pct) : '')); });
        return;
      }
      if (act === 'applydeposit') {
        const cid = g('contactId').value, dep = b.depositAccount(), held = b.depositsHeld(cid, true) - (existing && existing.status === 'posted' ? U.sum(existing.lines.filter((l) => dep && l.accountId === dep.id), (l) => -l.amount) : 0);
        let sum = 0; form.querySelectorAll('tr.line').forEach((tr) => { const a = tr.querySelector('[data-f="accountId"]').value; if (!dep || a !== dep.id) sum += safeC(tr.querySelector('[data-f="amount"]').value) || 0; });
        const use = Math.min(held, sum); if (!(use > 0) || !dep) return UI.toast('Nothing to apply.', 'error');
        const tb = form.querySelector('tbody.lines'), empty = [...tb.querySelectorAll('tr.line')].find((tr) => !tr.querySelector('[data-f="accountId"]').value && !tr.querySelector('[data-f="amount"]').value);
        const html = qbLineRow({ accountId: dep.id, description: 'Deposit applied', amount: -use }, !!form.querySelector('table.with-items'), taxOn(d));
        if (empty) empty.insertAdjacentHTML('beforebegin', html); else tb.insertAdjacentHTML('beforeend', html);
        updateTotals(); UI.dirty = true; billBtn();
      }
      if (act === 'billables') {
        const cid = g('contactId').value, inForm = new Set([...form.querySelectorAll('[data-f="billOf"]')].map((x) => x.value));
        const list = b.unbilledCosts('', existing ? existing.id : '').filter((x) => (x.customerId === cid || (b.contactById[x.customerId] || {}).parentId === cid) && !inForm.has(x.key));
        UI.modal({ title: 'Billable costs for ' + b.contactLabel(cid), wide: true, html: list.length ? `<table class="data compact"><thead><tr><th><span class="sr-only">Add</span></th><th>Date</th><th>From</th><th>Customer:Job</th><th>Account</th><th>Description</th><th class="num">Amount</th></tr></thead><tbody>
          ${list.map((x) => `<tr><td><input type="checkbox" data-bk="${esc(x.key)}" checked aria-label="Add"></td><td>${UI.date(x.t.date)}</td><td>${esc(UI.typeLabel(x.t.type) + ' ' + (x.t.number || ''))} ${esc(UI.contactName(x.t.contactId))}</td><td>${esc(b.contactLabel(x.customerId))}</td><td>${esc(b.accountLabel(x.line.accountId))}</td><td>${esc(x.line.description || '')}</td><td class="num">${UI.money(x.amount)}</td></tr>`).join('')}</tbody></table>
          <p class="muted small">Each cost is billed at what it cost you, to the same expense account (so it nets out of the expense). Change amounts or accounts on the invoice if you add a markup.</p>` : '<p class="muted">No unbilled costs for this customer.</p>',
          actions: [{ label: 'Cancel', value: null }, { label: 'Add to invoice', primary: true, collect: (m) => [...m.querySelectorAll('[data-bk]:checked')].map((x) => x.dataset.bk) }] }).then((keys) => {
          if (!keys || !keys.length) return;
          const tb = form.querySelector('tbody.lines'), withIt = !!form.querySelector('table.with-items');
          keys.forEach((k) => {
            const x = list.find((y) => y.key === k);
            const empty = [...tb.querySelectorAll('tr.line')].find((tr) => !tr.querySelector('[data-f="accountId"]').value && !tr.querySelector('[data-f="amount"]').value);
            const html = qbLineRow({ accountId: x.line.accountId, description: x.line.description || UI.typeLabel(x.t.type) + ' ' + (x.t.number || ''), amount: x.amount, billOf: x.key }, withIt, taxOn(d));
            if (empty) empty.insertAdjacentHTML('beforebegin', html); else tb.insertAdjacentHTML('beforeend', html);
          });
          updateTotals(); UI.dirty = true; billBtn();
        });
      }
    });
    let after = 'view', lastSaved = null;
    form.querySelectorAll('button[type=submit]').forEach((btn) => btn.addEventListener('click', () => { after = btn.dataset.after; }));
    form.addEventListener('submit', (e) => { e.preventDefault(); submit(after); });
    // ⌘/Ctrl+S and ⌘/Ctrl+Shift+S are handled by the underlined button mnemonics (ui-hotkeys.js)

    /** mode: 'view' (open the saved transaction), 'new' (blank form), 'stay' (save from the leave-page dialog). */
    function submit(mode) {
      const btn = form.querySelector(`button[data-after="${mode}"]`) || form.querySelector(`button[data-after="${mode === 'new' ? 'new' : 'view'}"]`);
      return UI.runSave(btn, save, (t) => def.label + (t && t.number ? ' ' + t.number : '') + ' saved').then((ok) => {
        if (!ok || mode === 'stay') return ok;
        if (mode === 'new') { const hash = '#/txn/new?type=' + d.type; if (location.hash === hash) UI.render(); else location.hash = hash; }
        else if (mode === 'close') { UI.dirty = false; if (history.length > 1) history.back(); else UI.go('#/transactions?type=' + d.type); }
        else UI.go('#/txn/' + lastSaved.id);
        return ok;
      });
    }
    /** Validate and post. Resolves the saved transaction, or false when the user must act first. */
    function save() {
      clearErrors();
      const draft = gather();
      let norm;
      try { norm = b.normalize(draft); } catch (e) { showErrors([{ message: e.message }]); UI.setStatus('failed', hadField ? 'Fix the highlighted fields.' : 'Fix the problem listed at the top.'); return Promise.resolve(false); }
      const errs = b.validate(Object.assign({}, norm, { id: existing ? existing.id : '' }), existing);
      const crErr = CREDIT_FORMS[d.type] ? creditErrors() : ''; if (crErr) errs.push({ message: crErr, field: 'applications' });
      if (errs.length) { showErrors(errs); UI.setStatus('failed', hadField ? 'Fix the highlighted fields.' : 'Fix the problems listed at the top.'); return Promise.resolve(false); }
      const dups = existing ? [] : b.findDuplicates(norm);
      const warns = b.warnings(Object.assign({}, norm, { id: existing ? existing.id : '' }), existing); // CPA-15–18, CPA-08
      // money left unapplied while documents are still open becomes a credit: say so before saving
      if (AUTO_APPLY && g('amount')) {
        const left = (safeC(g('amount').value) || 0) - appliedSum();
        const openLeft = U.sum(b.openDocs(d.type, g('contactId').value, ''), (t) => b.openBalance(t) - (safeC(appState[t.id]) || 0));
        if (left > 0 && openLeft > 0) warns.push({ message: `${U.fmt(left, { symbol: true })} is not applied to any ${d.type === 'payment' ? 'invoice' : 'bill'}. It will be kept as a credit on ${(b.contactById[g('contactId').value] || {}).name ? b.contactById[g('contactId').value].name + '’s' : 'this ' + contactKind + '’s'} account.` });
      }
      const dupHtml = dups.length ? `<p>A ${esc(def.label.toLowerCase())} with the same date, amount${norm.contactId ? ' and name' : ''} already exists:</p><ul>${dups.slice(0, 5).map((x) => `<li>${UI.txnLink(x)} — ${U.fmtDate(x.date)} — ${U.fmt(x.total, { symbol: true })}</li>`).join('')}</ul>` : '';
      const warnHtml = warns.length ? `<ul data-testid="save-warnings">${warns.map((w) => `<li>${esc(w.message)}</li>`).join('')}</ul>` : '';
      const go = dups.length || warns.length ? UI.confirm(dups.length ? 'Possible duplicate' : 'Check before saving', `${dupHtml}${warnHtml}<p>Save this one anyway?</p>`, { ok: 'Save anyway' }) : Promise.resolve(true);
      return go.then((okk) => {
        if (!okk) { UI.setStatus(UI.dirty ? 'dirty' : 'idle'); return false; }
        const credits = Object.keys(creditState).filter((k) => safeC(creditState[k].use) > 0);
        // CPA-06: credits are applied after the payment is saved, each as its own dated application
        const useCredits = (t) => credits.reduce((p, k) => p.then(() => b.applyCredit(k, creditState[k].target, safeC(creditState[k].use), t.date)), Promise.resolve()).then(() => { creditState = {}; return t; });
        const disc = existing ? [] : Object.keys(discState).map((k) => ({ txnId: k }));
        const post = disc.length ? b.receiveWithDiscount(draft, disc).then((r) => { discState = {}; return r.payment; }) : b.saveTransaction(draft);
        return post.then(useCredits).then((t) => { lastSaved = t; return t; }, (e) => {
          if (e.errors) { showErrors(e.errors); UI.setStatus('failed', hadField ? 'Fix the highlighted fields.' : 'Fix the problems listed at the top.'); return false; }
          throw e; // storage failure → "Save failed", form untouched
        });
      });
    }
    function clearErrors() { form.querySelectorAll('.invalid').forEach((x) => x.classList.remove('invalid')); const eb = el.querySelector('#form-errors'); if (eb) eb.remove(); }
    let hadField = false;
    function showErrors(errs) {
      const box = document.createElement('div');
      box.id = 'form-errors'; box.className = 'banner danger'; box.setAttribute('role', 'alert');
      box.innerHTML = '<strong>Please fix the following:</strong><ul>' + errs.map((x) => `<li>${esc(x.message)}</li>`).join('') + '</ul>';
      form.prepend(box);
      errs.forEach((x) => {
        if (!x.field) return;
        const [f, i] = x.field.split('.');
        let target = g(f);
        if (i !== undefined) { const rows = form.querySelectorAll(f === 'jlines' ? 'tr.jline' : 'tr.line'); target = rows[+i]; }
        if (target && target.type === 'hidden' && target.closest('.combo')) target = target.closest('.combo');
        if (target) target.classList.add('invalid');
      });
      // the first highlighted field gets the cursor; with nothing to highlight, the list itself is the place to look
      const first = form.querySelector('.invalid'), fi = first && (first.matches('input, select, textarea') ? first : first.querySelector('input:not([type=hidden]), select, textarea'));
      if (fi) { fi.focus(); fi.scrollIntoView({ block: 'center' }); } else box.scrollIntoView({ block: 'center' });
      hadField = !!first;
    }

    /** Show "+ Billable costs" when the chosen customer (or its jobs) has unbilled costs. */
    function billBtn() {
      const bt = form.querySelector('[data-act="billables"]'); if (!bt) return;
      const cid = g('contactId') && g('contactId').value, inForm = new Set([...form.querySelectorAll('[data-f="billOf"]')].map((x) => x.value));
      const n = cid ? b.unbilledCosts('', existing ? existing.id : '').filter((x) => (x.customerId === cid || (b.contactById[x.customerId] || {}).parentId === cid) && !inForm.has(x.key)).length : 0;
      bt.hidden = !n || locked; bt.textContent = '+ Billable costs (' + n + ')';
      const db = form.querySelector('[data-act="applydeposit"]'), dep = b.depositAccount && b.depositAccount();
      if (db) { const already = [...form.querySelectorAll('tr.line [data-f="accountId"]')].some((x) => dep && x.value === dep.id); const held = cid && dep ? b.depositsHeld(cid, true) : 0; db.hidden = !(held > 0) || already || locked; db.textContent = '+ Apply deposit (' + U.fmt(held, { symbol: true }) + ' held)'; }
    }
    billBtn();
    if (existing && UI.attachCard) UI.attachCard(el.querySelector('.page'), existing.id);
    renderApply();
    updateTotals();
    if (['invoice', 'salesReceipt', 'creditMemo', 'estimate'].indexOf(d.type) >= 0) formPreview(el, form, () => { const t = b.normalize(gather()); t.total = b.txnTotal(t); t.status = 'draft'; return t; }, existing);
    if (!locked) UI.trackForm(form, { snapshot: () => JSON.stringify(Object.assign(gather(), { clientToken: '' })), save: () => submit('stay') });
    else UI.dirty = false;
  }

  /* ---------- on-form preview and customize panel (1.26) ---------- */
  // The panel draws the same pages the Print screen and PDF use (OB.invoiceLayout), from the form as typed.
  function formPreview(el, form, draft, existing) {
    document.documentElement.classList.remove('fm-side-open');
    const host = form.querySelector('.qbi-tools') || form.querySelector('.form-actions'); if (!host) return;
    const btn = document.createElement('button'); btn.type = 'button'; btn.className = host.classList.contains('qbi-tools') ? 'qbi-tool fm-prev-btn' : 'btn fm-prev-btn';
    btn.dataset.testid = 'form-preview-btn'; btn.setAttribute('aria-expanded', 'false'); btn.setAttribute('aria-controls', 'fm-side');
    btn.innerHTML = host.classList.contains('qbi-tools') ? '<svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="4" y="2.5" width="12" height="15" rx="1"/><path d="M7 6.5h6M7 9.5h6M7 12.5h3.5"/></svg><span>Preview and customize</span>' : 'Preview and customize';
    host.appendChild(btn);
    let side = null, tm = 0;
    const L = OB.invoiceLayout, b = UI.book;
    const paint = () => {
      if (!side) return;
      let html;
      try { const pages = L.pages(b, draft()); html = pages.map((ops) => `<div class="inv-page">${L.svg(ops, 'class="inv-svg" role="img" aria-label="Preview of the printed form"')}</div>`).join(''); }
      catch (e) { html = `<p class="muted">The preview shows once the form has a customer and at least one line. (${esc(e.message)})</p>`; }
      side.querySelector('.fm-pages').innerHTML = html;
    };
    const onEdit = () => { clearTimeout(tm); tm = setTimeout(paint, 300); };
    const close = () => { if (!side) return; side.remove(); side = null; document.documentElement.classList.remove('fm-side-open'); btn.setAttribute('aria-expanded', 'false'); form.removeEventListener('input', onEdit); form.removeEventListener('change', onEdit); };
    btn.addEventListener('click', () => {
      if (side) { close(); return; }
      side = document.createElement('aside'); side.className = 'fm-side'; side.id = 'fm-side'; side.setAttribute('aria-label', 'Preview and customize'); side.dataset.testid = 'form-preview';
      side.innerHTML = `<header><h2>Preview</h2><button type="button" class="icon-btn" data-fm="close" aria-label="Close preview">✕</button></header>
        <div class="fm-pages" aria-live="polite"></div>
        <section class="fm-custom"><h3>Customize</h3>
          <p class="muted small">Forms print with your company name, address, phone, email and logo.</p>
          <a class="btn small" href="#/settings">Change logo and company details</a>
          ${existing && existing.status !== 'void' ? `<a class="btn small" href="#/print/${esc(existing.id)}">Print or download PDF</a>` : '<p class="muted small">Save the form to print it or download the PDF.</p>'}
        </section>`;
      el.querySelector('.page').appendChild(side);
      document.documentElement.classList.add('fm-side-open'); btn.setAttribute('aria-expanded', 'true');
      side.querySelector('[data-fm="close"]').addEventListener('click', () => { close(); btn.focus(); });
      form.addEventListener('input', onEdit); form.addEventListener('change', onEdit);
      paint();
    });
    window.addEventListener('hashchange', close, { once: true });
  }

  /* ---------- table builders ---------- */
  function classesOn() { const b = UI.book; return !!(b.company.useClasses && b.classes.length); }
  const classCell = (l) => classesOn() ? `<td data-label="Class"><select data-f="classId" aria-label="Class">${UI.classOptions(l.classId || '', { blankLabel: 'No class' })}</select></td>` : '';
  const classHead = () => classesOn() ? '<th>Class</th>' : '';
  function lineAccountFilter(type) {
    return (a) => a.type !== 'ar' && a.type !== 'ap';
  }
  /** Purchase lines (bill, check, expense) can be charged to a customer or job and marked billable (1.16). */
  const billCells = (type, l) => OB.Book.BILLABLE[type] ? `<td data-label="Customer:Job" class="bill-cust">${UI.comboHtml('contact', 'customer', l.contactId || '', 'data-f="contactId"', { placeholder: 'Customer:Job', label: 'Customer or job' })}</td><td class="tx-cell" data-label="Billable"><input type="checkbox" data-f="billable" aria-label="Billable"${l.billable ? ' checked' : ''}></td>` : '';
  const billHeads = (type) => OB.Book.BILLABLE[type] ? '<th>Customer:Job</th><th class="tx-cell" title="Bill this cost to the customer">Billable</th>' : '';
  const taxCell = (l, on) => on ? `<td class="tx-cell" data-label="Tax"><input type="checkbox" data-f="taxable" aria-label="Taxable"${l.taxable ? ' checked' : ''}></td>` : '';
  function lineRow(type, l, withItems, tax) {
    const sales = SALES_LINES[type], showQty = sales || (withItems && ITEM_LINES[type]); // purchases show Qty / Cost when items are in use (inventory)
    const fmt = (c) => (c === null || c === undefined || c === '') ? '' : (typeof c === 'number' ? U.fmtPlain(c) : c);
    return `<tr class="line">
      ${withItems ? `<td data-label="Item">${UI.comboHtml('item', '', l.itemId || '', 'data-f="itemId"', { placeholder: 'Type item name…', label: 'Product or service' })}</td>` : ''}
      <td data-label="${sales ? 'Income account' : 'Account'}">${UI.comboHtml('account', 'line', l.accountId, 'data-f="accountId"', { placeholder: sales ? 'Type income account…' : 'Type account or number…', label: 'Account', hint: sales || type === 'deposit' ? 'income' : 'expense' })}</td>
      <td data-label="Description"><input data-f="description" value="${esc(l.description || '')}" aria-label="Description" placeholder="Description">${l.fromTxnId ? `<input type="hidden" data-f="fromTxnId" value="${esc(l.fromTxnId)}">` : ''}${l.srcLine !== undefined ? `<input type="hidden" data-f="srcLine" value="${esc(l.srcLine)}">` : ''}</td>
      ${showQty ? `<td class="num" data-label="Qty"><input data-f="qty" class="qty" inputmode="decimal" value="${esc(l.qty === null || l.qty === undefined ? '' : l.qty)}" aria-label="Quantity"></td>
        <td class="num" data-label="${sales ? 'Rate' : 'Cost'}"><input data-f="rate" class="money" inputmode="decimal" value="${esc(fmt(l.rate))}" aria-label="Rate"></td>` : ''}
      <td class="num" data-label="Amount"><input data-f="amount" class="money" inputmode="decimal" value="${esc(fmt(l.amount))}" placeholder="0.00" aria-label="Amount"></td>
      ${taxCell(l, tax)}
      ${billCells(type, l)}
      ${classCell(l)}
      <td class="rm"><button type="button" class="btn ghost small icon" data-act="rmline" aria-label="Remove line" title="Remove line">✕</button></td></tr>`;
  }
  function linesTable(d) {
    const sales = SALES_LINES[d.type], showQty = sales || (itemsOn(d.type, d.lines) && ITEM_LINES[d.type]);
    const lines = d.lines && d.lines.length ? d.lines : [{}];
    const catLabel = { invoice: 'Product/service (income account)', salesReceipt: 'Income account', creditMemo: 'Income account', deposit: 'Received from (account)' }[d.type] || 'Category (expense account)';
    const withItems = itemsOn(d.type, d.lines), tax = taxOn(d);
    const cols = `<colgroup>${withItems ? '<col class="c-item">' : ''}<col class="c-acc"><col class="c-desc">${showQty ? '<col class="c-qty"><col class="c-rate">' : ''}<col class="c-amt">${tax ? '<col class="c-tax">' : ''}${OB.Book.BILLABLE[d.type] ? '<col class="c-cust"><col class="c-bill">' : ''}${classesOn() ? '<col class="c-cls">' : ''}<col class="c-rm"></colgroup>`;
    return `<table class="data lines-table${withItems ? ' with-items' : ''}">${cols}<thead><tr>${withItems ? '<th>Product/service</th>' : ''}<th>${withItems && sales ? 'Income account' : withItems ? 'Account' : catLabel}</th><th>Description</th>${showQty ? `<th class="num">Qty</th><th class="num">${sales ? 'Rate' : 'Cost'}</th>` : ''}<th class="num">Amount</th>${tax ? '<th class="tx-cell">Tax</th>' : ''}${billHeads(d.type)}${classHead()}<th><span class="sr-only">Actions</span></th></tr></thead>
      <tbody class="lines">${lines.map((l) => lineRow(d.type, l, withItems, tax)).join('')}</tbody></table>
      <button type="button" class="btn ghost small" data-act="addline" data-key="i,d">+ Add line</button>`;
  }
  function jlineRow(l) {
    const fmt = (c) => (c === null || c === undefined || c === '' || c === 0) ? '' : (typeof c === 'number' ? U.fmtPlain(c) : c);
    return `<tr class="jline">
      <td data-label="Account">${UI.comboHtml('account', 'any', l.accountId, 'data-f="accountId"', { placeholder: 'Type account name or number…', label: 'Account' })}</td>
      <td class="num" data-label="Debit"><input data-f="debit" class="money" inputmode="decimal" value="${esc(fmt(l.debit))}" aria-label="Debit"></td>
      <td class="num" data-label="Credit"><input data-f="credit" class="money" inputmode="decimal" value="${esc(fmt(l.credit))}" aria-label="Credit"></td>
      <td data-label="Name">${UI.comboHtml('contact', 'any', l.contactId, 'data-f="contactId"', { placeholder: 'Customer or vendor', label: 'Name' })}</td>
      <td data-label="Memo"><input data-f="memo" value="${esc(l.memo || '')}" aria-label="Line memo" placeholder="Line memo"></td>
      ${classCell(l)}
      <td class="rm"><button type="button" class="btn ghost small icon" data-act="rmline" aria-label="Remove line" title="Remove line">✕</button></td></tr>`;
  }
  function journalTable(d) {
    const lines = d.jlines && d.jlines.length ? d.jlines : [{}, {}];
    const cols = `<colgroup><col class="c-acc"><col class="c-amt"><col class="c-amt"><col class="c-name"><col class="c-desc">${classesOn() ? '<col class="c-cls">' : ''}<col class="c-rm"></colgroup>`;
    return `<table class="data lines-table jl">${cols}<thead><tr><th>Account</th><th class="num">Debit</th><th class="num">Credit</th><th title="Required on lines that use Accounts Receivable or Accounts Payable">Name</th><th>Memo</th>${classHead()}<th><span class="sr-only">Actions</span></th></tr></thead>
      <tbody class="jlines">${lines.map(jlineRow).join('')}</tbody></table>
      <button type="button" class="btn ghost small" data-act="addjline" data-key="i,d">+ Add line</button>`;
  }

  /* ---------- related info for saved transactions ---------- */
  /* ---------- invoice entry laid out like QuickBooks Desktop's Create Invoices window ----------
   * Same field names as the standard form, so validation, saving, items, terms and shortcuts behave the same. */
  const DEFAULT_MESSAGES = ['All work is complete!', 'It\u2019s been a pleasure working with you!', 'Please remit to above address.', 'Thank you for your business.', 'We appreciate your prompt payment.'];
  UI.customerMessages = () => { const m = UI.book.company.customerMessages; return m && m.length ? m.slice() : DEFAULT_MESSAGES.slice(); };
  const TERMS = [[0, 'Due on receipt'], [10, 'Net 10'], [15, 'Net 15'], [30, 'Net 30'], [45, 'Net 45'], [60, 'Net 60'], [90, 'Net 90']];
  function termsOptions(v) {
    const has = v === '' || v === undefined || v === null || TERMS.some((x) => String(x[0]) === String(v));
    return `<option value=""${v === '' || v === undefined || v === null ? ' selected' : ''}></option>` + TERMS.map(([k, l]) => `<option value="${k}"${String(v) === String(k) ? ' selected' : ''}>${l}</option>`).join('') + (has ? '' : `<option value="${esc(v)}" selected>Net ${esc(v)}</option>`);
  }
  function setTerms(sel, v) {
    if (sel.tagName === 'SELECT' && v !== '' && v !== undefined && v !== null && ![...sel.options].some((o) => o.value === String(v))) sel.insertAdjacentHTML('beforeend', `<option value="${esc(v)}">Net ${esc(v)}</option>`);
    sel.value = v === undefined || v === null ? '' : v;
  }
  function billToHtml(c) { return c ? esc(c.name) + (c.company && c.company !== c.name ? '<br>' + esc(c.company) : '') + (c.address ? '<br>' + esc(c.address).replace(/\n/g, '<br>') : '') : ''; }
  function qbLineRow(l, withItems, tax) {
    const fmt = (c) => (c === null || c === undefined || c === '') ? '' : (typeof c === 'number' ? U.fmtPlain(c) : c);
    return `<tr class="line">
      <td class="qi-item" data-label="Item"><div class="qi-wrap">${withItems ? UI.comboHtml('item', '', l.itemId || '', 'data-f="itemId"', { placeholder: 'Type item name…', label: 'Item' }) : ''}${UI.comboHtml('account', 'line', l.accountId, 'data-f="accountId"', { placeholder: withItems ? 'Income account' : 'Item / income account', label: 'Income account', hint: 'income' })}</div></td>
      <td data-label="Description"><input data-f="description" value="${esc(l.description || '')}" aria-label="Description">${l.billOf ? `<input type="hidden" data-f="billOf" value="${esc(l.billOf)}">` : ''}${l.srcLine !== undefined ? `<input type="hidden" data-f="srcLine" value="${esc(l.srcLine)}">` : ''}</td>
      <td class="num" data-label="Qty"><input data-f="qty" class="qty" inputmode="decimal" value="${esc(l.qty === null || l.qty === undefined ? '' : l.qty)}" aria-label="Quantity"></td>
      <td class="num" data-label="Rate"><input data-f="rate" class="money" inputmode="decimal" value="${esc(fmt(l.rate))}" aria-label="Rate"></td>
      <td class="num" data-label="Amount"><input data-f="amount" class="money" inputmode="decimal" value="${esc(fmt(l.amount))}" aria-label="Amount"></td>
      ${taxCell(l, tax)}
      ${classCell(l)}
      <td class="rm"><button type="button" class="btn ghost small icon" data-act="rmline" aria-label="Remove line" title="Remove line">✕</button></td></tr>`;
  }
  function qbInvoiceForm(d, existing, locked, contactField, classField) {
    const b = UI.book, withItems = (b.items || []).some((x) => x.active !== false) || (d.lines || []).some((l) => l.itemId);
    const lines = (d.lines && d.lines.length ? d.lines : []).slice();
    while (lines.length < 3) lines.push({});   // more appear as the last line is used (1.36)
    const def = S.TXN_TYPES[d.type], isInv = d.type === 'invoice', tax = taxOn(d), word = def.label.toLowerCase();
    const invs = b.transactions.filter((t) => t.type === d.type && t.status !== 'void').sort(OB.Book.cmpTxn);
    const at = existing ? invs.findIndex((t) => t.id === existing.id) : invs.length;
    const prev = at > 0 ? invs[at - 1] : null, next = existing && at >= 0 && at < invs.length - 1 ? invs[at + 1] : null;
    const msgs = UI.customerMessages(), cur = d.message !== undefined ? d.message : existing ? '' : 'Thank you for your business.';
    if (cur && msgs.indexOf(cur) < 0) msgs.push(cur);
    const posted = existing && existing.status !== 'void' && (isInv ? existing.status === 'posted' : true);
    return `<form id="txf" class="txform tx-${esc(d.type)} qbi${locked ? ' locked' : ''}" autocomplete="off" novalidate data-testid="qb-invoice">
      <div class="qbi-tools no-print" role="toolbar" aria-label="${esc(def.label)}">${qbRibbon(d, existing, locked, posted, isInv, prev, next, word)}</div>
      <fieldset ${locked ? 'disabled' : ''}>
      <div class="qbi-bar"><div class="qbi-cust">${contactField.replace('<span>Customer</span>', '<span>Customer:Job</span>')}</div>${classField ? `<div class="qbi-cls">${classField.replace(/<span>Class[^<]*<\/span>/, '<span>CLASS</span>')}</div>` : ''}</div>
      <div class="qbi-sheet">
        <div class="qbi-head">
          <div class="qbi-title"><h1>${esc(def.label + (existing && existing.number ? ' ' + existing.number : ''))}</h1>${existing ? '<a href="#" data-meta="history">See History</a>' : ''}${existing ? ` <span class="qbi-status">${UI.statusBadge(existing)}</span>` : ''}</div>
          <div class="qbi-fields">
            <label class="qbi-f"><span>DATE</span><input type="date" name="date" value="${esc(d.date)}" required></label>
            <label class="qbi-f"><span>${esc(def.label.toUpperCase())} #</span><input name="number" value="${esc(d.number || '')}" maxlength="30" placeholder="Auto"></label>
          </div>
          <div class="qbi-bill"><span>BILL TO</span><div class="qbi-addr" id="qbi-addr" aria-live="polite">${billToHtml(b.contactById[d.contactId])}</div></div>
        </div>
        <div class="qbi-terms">
          <label class="qbi-f"><span>TERMS</span><select name="terms">${termsOptions(d.terms === undefined ? '' : d.terms)}</select></label>
          <label class="qbi-f"><span>DUE DATE</span><input type="date" name="dueDate" value="${esc(d.dueDate || '')}"></label>
        </div>
        <div class="qbi-grid"><table class="lines-table qbi-lines${withItems ? ' with-items' : ''}">
          <colgroup><col class="c-item"><col class="c-desc"><col class="c-qty"><col class="c-rate"><col class="c-amt">${tax ? '<col class="c-tax">' : ''}${classesOn() ? '<col class="c-cls">' : ''}<col class="c-rm"></colgroup>
          <thead><tr><th>ITEM</th><th>DESCRIPTION</th><th class="num">QTY</th><th class="num">RATE</th><th class="num">AMOUNT</th>${tax ? '<th class="tx-cell">TAX</th>' : ''}${classesOn() ? '<th>CLASS</th>' : ''}<th><span class="sr-only">Remove</span></th></tr></thead>
          <tbody class="lines">${lines.map((l) => qbLineRow(l, withItems, tax)).join('')}</tbody></table></div>
        <button type="button" class="btn ghost small no-print" data-act="addline" data-key="i,d">+ Add line</button>
        ${isInv ? '<button type="button" class="btn ghost small no-print" data-act="billables" data-testid="add-billables" hidden>+ Billable costs</button><button type="button" class="btn ghost small no-print" data-act="applydeposit" data-testid="apply-deposit" hidden>+ Apply deposit</button>' : ''}
        <div class="qbi-foot">
          <div class="qbi-left">
            <label class="qbi-f"><span>CUSTOMER MESSAGE</span><select name="message" id="qbi-msg" data-testid="qbi-msg"><option value=""${cur === '' ? ' selected' : ''}></option>${msgs.map((m) => `<option${m === cur ? ' selected' : ''}>${esc(m)}</option>`).join('')}<option value="__add">&lt; Add New &gt;</option></select></label>
            ${tax ? `<label class="qbi-f qbi-tax"><span>SALES TAX</span><span class="qbi-taxrow"><select name="taxId" data-testid="tax-select">${taxOptions(d.taxId || '')}</select><span id="qbi-taxrate" class="muted"></span></span></label>` : ''}
            <label class="qbi-f qbi-memo"><span>MEMO</span><input name="memo" value="${esc(d.memo || '')}" maxlength="500"></label>
          </div>
          <div class="qbi-totals" id="totals" aria-live="polite"></div>
        </div>
        <div class="qbi-actions">
          <span class="form-status" aria-live="off"></span><span class="spacer"></span>
          ${saveButtons(existing, locked)}
        </div>
      </div>
      </fieldset>
    </form>`;
  }

  /** The same save buttons, in the same order, on every transaction form:
   *  Close · Clear (new) or Revert (saved) · Save · Save & New. The primary button is Save & New on a new form
   *  and Save changes on a saved one. */
  function saveButtons(existing, locked) {
    const close = '<button type="button" class="btn ghost" data-act="close" data-key="l,o">Close</button>';
    if (locked) return close;
    return close + `<button type="button" class="btn" data-act="revert">${existing ? 'Revert' : 'Clear'}</button>`
      + `<button type="submit" class="btn${existing ? ' primary' : ''}" data-after="view" data-key="s">${existing ? 'Save changes' : 'Save'}</button>`
      + `<button type="submit" class="btn${existing ? '' : ' primary'}" data-after="new" data-key="e,d">Save &amp; New</button>`;
  }

  function relatedHtml(t) {
    const b = UI.book;
    const inc = (b.incoming[t.id] || []).map((x) => ({ t: b.txById[x.from], amount: x.amount }));
    const out = (t.applications || []).map((a) => ({ t: b.txById[a.txnId], amount: a.amount })).filter((x) => x.t);
    if (!inc.length && !out.length) return '';
    const row = (x) => `<tr><td>${UI.date(x.t.date)}</td><td>${UI.txnLink(x.t)}</td><td class="num">${UI.money(x.amount)}</td></tr>`;
    return `<section class="card"><h2>Linked transactions</h2><table class="data compact"><tbody>
      ${inc.length ? `<tr class="group"><td colspan="3">Applied to this ${esc(UI.typeLabel(t.type).toLowerCase())}</td></tr>${inc.map(row).join('')}` : ''}
      ${out.length ? `<tr class="group"><td colspan="3">This ${esc(UI.typeLabel(t.type).toLowerCase())} is applied to</td></tr>${out.map(row).join('')}` : ''}
    </tbody></table></section>`;
  }
  /** Invoice-style toolbar laid out like a desktop ribbon: large buttons for the main actions and
   *  two-row stacks for the secondary ones, so every action is visible without a More menu. */
  function qbRibbon(d, existing, locked, posted, isInv, prev, next, word) {
    const b = UI.book, ic = (p, n) => `<svg viewBox="0 0 20 20" width="${n || 20}" height="${n || 20}" aria-hidden="true">${p}</svg>`;
    const big = (icon, label, attrs, href) => href ? `<a class="qbi-tool" href="${href}" ${attrs || ''}>${ic(icon)}<span>${label}</span></a>` : `<button type="button" class="qbi-tool" ${attrs}>${ic(icon)}<span>${label}</span></button>`;
    const mini = (icon, label, attrs) => `<button type="button" class="qbi-mini" ${attrs}>${ic(icon, 15)}<span>${label}</span></button>`;
    const stack = (...xs) => { xs = xs.filter(Boolean); return xs.length ? `<div class="qbi-stack">${xs.join('')}</div>` : ''; };
    const grp = (...xs) => { const h = xs.filter(Boolean).join(''); return h ? `<div class="qbi-grp">${h}</div>` : ''; };
    const I = {
      prev: '<path d="M12.5 4.5 7 10l5.5 5.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
      next: '<path d="M7.5 4.5 13 10l-5.5 5.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
      add: '<path d="M5 2.5h7l3.5 3.5v11.5H5z" fill="#fff" stroke="currentColor" stroke-width="1.4"/><path d="M10 8v6M7 11h6" stroke="#2f6db5" stroke-width="2"/>',
      save: '<path d="M3.5 3.5h11l2 2v11h-13z" fill="#5b8fd1" stroke="currentColor" stroke-width="1.2"/><path d="M6 3.5h7v4H6z" fill="#fff"/><path d="M6 11h8v5.5H6z" fill="#dfe9f7"/>',
      del: '<path d="M5 5l10 10M15 5 5 15" stroke="#2f6db5" stroke-width="2.4" stroke-linecap="round"/>',
      copy: '<path d="M6 2.5h7l3 3v9.5H6z" fill="#fff" stroke="currentColor" stroke-width="1.3"/><path d="M3.5 5.5v12h9" fill="none" stroke="currentColor" stroke-width="1.3"/>',
      repeat: '<path d="M4 9a6 6 0 0 1 10.5-4M16 11a6 6 0 0 1-10.5 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M14.8 2v3.2h-3.2M5.2 18v-3.2h3.2" fill="none" stroke="#2f6db5" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
      print: '<path d="M5.5 7.5V3h9v4.5M5.5 14H3.5v-6.5h13V14h-2" fill="#e9eef5" stroke="currentColor" stroke-width="1.3"/><rect x="5.5" y="11.5" width="9" height="5.5" fill="#fff" stroke="currentColor" stroke-width="1.3"/>',
      iif: '<path d="M4 3.5h8l4 4v9H4z" fill="#fff" stroke="currentColor" stroke-width="1.3"/><path d="M7 11h6M7 14h4" stroke="#2f6db5" stroke-width="1.6"/>',
      pay: '<rect x="2.5" y="6" width="15" height="9" rx="1" fill="#79b35a" stroke="currentColor" stroke-width="1.2"/><circle cx="10" cy="10.5" r="2.2" fill="#fff"/>',
      writeoff: '<circle cx="10" cy="10" r="6.5" fill="#fff" stroke="currentColor" stroke-width="1.3"/><path d="M6 14 14 6" stroke="#2f6db5" stroke-width="1.8"/>',
      journal: '<rect x="3.5" y="3" width="13" height="14" rx="1" fill="#fff" stroke="currentColor" stroke-width="1.3"/><path d="M10 3v14M5.5 7h3M11.5 10h3" stroke="#2f6db5" stroke-width="1.4"/>',
      history: '<circle cx="10" cy="10" r="6.5" fill="#fff" stroke="currentColor" stroke-width="1.3"/><path d="M10 6.5V10l2.5 1.8" fill="none" stroke="#2f6db5" stroke-width="1.6" stroke-linecap="round"/>',
      convert: '<path d="M3 5.5h8l4 4.5-4 4.5H3z" fill="#e9eef5" stroke="currentColor" stroke-width="1.3"/><path d="M12 10h6" stroke="#2f6db5" stroke-width="2"/>',
      status: '<circle cx="10" cy="10" r="6.5" fill="#fff" stroke="currentColor" stroke-width="1.3"/><path d="M7 10.2 9.2 12.4 13.4 8" fill="none" stroke="#2f6db5" stroke-width="1.8"/>',
    };
    const open = existing && existing.status !== 'void';
    const canRecur = posted && (!S.TXN_TYPES[d.type].applies || isInv);
    const canWriteOff = posted && isInv && !locked && b.openBalance(existing) > 0;
    const find = `<div class="qbi-grp qbi-find"><div class="qbi-find-arrows"><button type="button" class="qbi-mini" data-act="findPrev" data-target="${prev ? esc(prev.id) : ''}" aria-label="Previous ${word}"${prev ? '' : ' disabled'}>${ic(I.prev, 15)}</button><button type="button" class="qbi-mini" data-act="findNext" data-target="${next ? esc(next.id) : ''}" aria-label="Next ${word}"${next ? '' : ' disabled'}>${ic(I.next, 15)}</button></div><a class="qbi-findbtn" href="#/transactions?type=${esc(d.type)}">Find</a></div>`;
    return find
      + grp(big(I.add, 'New', '', `#/txn/new?type=${esc(d.type)}`),
        !locked ? `<button type="submit" class="qbi-tool" data-after="view">${ic(I.save)}<span>Save</span></button>` : '',
        posted && !locked ? big(I.del, 'Delete', `data-act="voidQb" title="Void this ${word} (kept for the audit trail)"`) : '',
        stack(posted ? mini(I.copy, 'Create a Copy', 'data-act="duplicate"') : '', canRecur ? mini(I.repeat, 'Make Recurring', 'data-act="recurring"') : ''))
      + grp(posted ? big(I.print, 'Print', '', `#/print/${esc(existing.id)}`) : '',
        posted && isInv ? stack(mini(I.iif, 'QuickBooks .iif', `id="tx-iif-one" data-testid="iif-one" data-id="${esc(existing.id)}"`)) : '')
      + grp(!isInv && existing && existing.status === 'open' ? big(I.convert, 'Create Invoice', 'data-act="convert" data-testid="convert"') : '',
        !isInv && open ? big(I.status, existing.status === 'open' ? 'Mark Closed' : 'Reopen', `data-act="docstatus" data-to="${existing.status === 'open' ? 'closed' : 'open'}"`) : '',
        posted && isInv ? big(I.pay, 'Receive Payments', '', `#/txn/new?type=payment&contact=${esc(existing.contactId || '')}`) : '',
        stack(canWriteOff ? mini(I.writeoff, 'Write Off Bad Debt', 'data-act="writeoff"') : ''))
      + (existing ? grp(stack(mini(I.journal, 'Transaction Journal', 'data-act="journal"'), mini(I.history, 'Audit History', 'data-act="history"'))) : '');
  }
  function doBounce(t) {
    UI.modal({ title: 'Record bounced payment', html: `<form id="bnc" class="form-grid" autocomplete="off">
        <label class="field"><span>Date the bank returned it</span><input type="date" name="date" value="${esc(U.today())}"></label>
        <label class="field"><span>Fee the bank charged you</span><input name="bankFee" inputmode="decimal" placeholder="0.00"></label>
        <label class="field"><span>Fee to charge the customer</span><input name="customerFee" inputmode="decimal" placeholder="0.00"></label></form>
        <p class="muted small">The payment stays as it was. A new charge puts ${esc(U.fmt(t.amount, { symbol: true }))} back on the customer’s balance (taking it out of the bank it was deposited to), plus any customer fee; a bank fee is posted as an expense.</p>`,
      actions: [{ label: 'Cancel', value: null }, { label: 'Record', primary: true, collect: (m) => Object.fromEntries(new FormData(m.querySelector('#bnc')).entries()) }] })
      .then((v) => v && UI.book.recordBouncedPayment(t.id, v).then((r) => { UI.toast('Bounced payment recorded.'); UI.go('#/txn/' + r.charge.id); })).catch(UI.error);
  }
  function moreMenu(t, locked) {
    const b = UI.book, def = S.TXN_TYPES[t.type], posted = t.status === 'posted';
    const reversed = t.reversedBy && b.txById[t.reversedBy] && b.txById[t.reversedBy].status === 'posted';
    const items = [];
    if (posted) items.push(['duplicate', 'Duplicate']);
    if (posted && (!def.applies || t.type === 'invoice')) items.push(['recurring', 'Make recurring']);
    if (posted && t.type === 'journal' && !t.reversalOf && !reversed) items.push(['reverse', 'Reverse entry…']);
    if (posted && t.type === 'invoice' && !locked && b.openBalance(t) > 0) items.push(['writeoff', 'Write off as bad debt…']);
    if (posted && t.type === 'payment' && !b.transactions.some((x) => x.status === 'posted' && x.bounceOf === t.id)) items.push(['bounce', 'Record bounced payment…']);
    items.push(null);
    if (t.type !== 'journal') items.push(['journal', 'Transaction journal (debits and credits)']);
    items.push(['history', 'Audit history']);
    if (posted && !(t.voidedBy && b.txById[t.voidedBy] && b.txById[t.voidedBy].status === 'posted') && (!locked || !(t.applications || []).length)) { items.push(null); items.push(['void', 'Void…', 'danger']); }
    const html = items.filter((x, i) => x || (i > 0 && items[i - 1])).map((x) => x ? `<button type="button" role="menuitem" class="${x[2] || ''}" data-act="${x[0]}">${esc(x[1])}</button>` : '<hr>').join('');
    return `<div class="menu-wrap"><button type="button" class="btn" data-act="more" aria-haspopup="menu" aria-expanded="false" data-key="o">More ▾</button><div class="menu" role="menu" hidden>${html}</div></div>`;
  }
  function toggleMenu(btn) {
    const m = btn.nextElementSibling, open = m.hidden;
    closeMenus();
    if (open) { m.hidden = false; btn.setAttribute('aria-expanded', 'true'); const f = m.querySelector('button'); if (f) f.focus(); }
  }
  function closeMenus() { document.querySelectorAll('.menu-wrap .menu').forEach((m) => { m.hidden = true; m.previousElementSibling.setAttribute('aria-expanded', 'false'); }); }
  document.addEventListener('click', (e) => { if (!e.target.closest('.menu-wrap')) closeMenus(); });
  document.addEventListener('keydown', (e) => {
    const m = e.target.closest && e.target.closest('.menu-wrap');
    if (!m) return;
    const items = [...m.querySelectorAll('.menu button')], i = items.indexOf(e.target);
    if (e.key === 'Escape') { closeMenus(); m.querySelector('[data-act=more]').focus(); }
    if (i >= 0 && e.key === 'ArrowDown') { e.preventDefault(); (items[i + 1] || items[0]).focus(); }
    if (i >= 0 && e.key === 'ArrowUp') { e.preventDefault(); (items[i - 1] || items[items.length - 1]).focus(); }
  });
  function showHistory(t) {
    UI.drawer({ title: 'Audit history', sub: UI.typeLabel(t.type) + (t.number ? ' ' + t.number : '') + ' · ' + U.fmtDate(t.date), html: historyHtml(t) });
  }
  function journalHtml(t) {
    const b = UI.book;
    const showCleared = t.splits.some((s) => s.cleared);
    const dr = U.sum(t.splits, (s) => s.amount > 0 ? s.amount : 0), cr = U.sum(t.splits, (s) => s.amount < 0 ? -s.amount : 0);
    return `<p class="muted small">The postings this ${esc(UI.typeLabel(t.type).toLowerCase())} made to the general ledger.${t.status === 'void' ? ' It is void, so these amounts are excluded from all reports.' : ''}</p>
      <div class="scroll-x"><table class="data compact"><thead><tr><th>Account</th><th>Name</th><th class="num">Debit</th><th class="num">Credit</th>${showCleared ? '<th title="C = cleared, R = reconciled">Status</th>' : ''}</tr></thead><tbody>
      ${t.splits.map((s) => `<tr><td class="wrap"><a href="#/register/${esc(s.accountId)}">${esc(b.accountLabel(s.accountId))}</a>${s.memo ? `<div class="muted small">${esc(s.memo)}</div>` : ''}</td><td class="wrap">${esc(UI.contactName(s.contactId))}</td><td class="num">${s.amount > 0 ? UI.money(s.amount) : ''}</td><td class="num">${s.amount < 0 ? UI.money(-s.amount) : ''}</td>${showCleared ? `<td>${s.cleared === 'R' ? 'Reconciled' : s.cleared === 'C' ? 'Cleared' : ''}</td>` : ''}</tr>`).join('')}
      </tbody><tfoot><tr><td colspan="2">Totals</td><td class="num">${UI.money(dr)}</td><td class="num">${UI.money(cr)}</td>${showCleared ? '<td></td>' : ''}</tr></tfoot></table></div>
      <p class="check-line ${dr === cr ? 'ok' : 'bad'}">${dr === cr ? '✓ Debits equal credits.' : '✗ Out of balance.'}</p>`;
  }
  function historyHtml(t) {
    const list = UI.book.audit.filter((a) => a.txnId === t.id).sort((a, b) => a.ts < b.ts ? 1 : -1);
    const diff = (a) => {
      if (!a.before) return '';
      const was = a.before, ch = [];
      if (was.date !== t.date && a.action === 'edit') ch.push('date was ' + U.fmtDate(was.date));
      if (was.total !== undefined) ch.push('total was ' + U.fmt(was.total, { symbol: true }));
      return `<div class="muted small">Before this change: ${esc(ch.join(' · '))} (version ${was.version || 1})</div>`;
    };
    return `<ol class="timeline">${list.map((a) => `<li><span class="badge">${esc(a.action)}</span><div><div>${esc(a.summary)}</div><time>${esc(new Date(a.ts).toLocaleString())}</time>${diff(a)}</div></li>`).join('')}</ol>
      <p class="muted small">Current version ${t.version || 1}. The audit history is append-only; previous versions are kept in full and included in backups.</p>`;
  }

  /* ---------- actions ---------- */
  function doVoid(t) {
    // CPA-21: a closed or reconciled period stays as reported — the void is posted as a reversing entry in an open period
    const b = UI.book, cd = b.company.closingDate, closed = !!(cd && t.date <= cd), recd = t.splits.some((s) => s.cleared === 'R'), must = closed || recd;
    const canAsOf = !S.TXN_TYPES[t.type].nonPosting && !(t.applications || []).length;
    const dflt = closed ? U.addDays(cd, 1) > U.today() ? U.addDays(cd, 1) : U.today() : U.today();
    UI.modal({
      title: 'Void ' + UI.typeLabel(t.type).toLowerCase(),
      html: `<p>Voiding keeps this transaction on record (marked Void) and removes its amounts from every account and report. This cannot be undone, but you can duplicate it later.</p>
        ${canAsOf ? `<label class="check"><input type="checkbox" id="vasof"${must ? ' checked disabled' : ''}> Keep the original period as reported — post the void as a reversing entry dated</label>
        <label class="field"><span>Void as of</span><input type="date" id="vdate" value="${esc(dflt)}"></label>
        ${must ? `<p class="muted small">This transaction is ${closed ? 'in a closed period (on or before ' + esc(U.fmtDate(cd)) + ')' : 'reconciled'}, so it can only be voided as of a later date.</p>` : ''}` : ''}
        <label class="field"><span>Reason (optional)</span><input id="vreason" maxlength="200"></label>`,
      actions: [{ label: 'Cancel', value: null }, { label: 'Void transaction', danger: true, collect: (m) => ({ reason: m.querySelector('#vreason').value, asOf: m.querySelector('#vasof') && m.querySelector('#vasof').checked ? m.querySelector('#vdate').value : '' }) }]
    }).then((v) => {
      if (v === null) return;
      return b.voidTransaction(t.id, v.reason, v.asOf ? { asOf: v.asOf } : undefined).then((r) => { UI.toast(v.asOf ? 'Voided as of ' + U.fmtDate(v.asOf) + ' by a reversing entry.' : 'Transaction voided.'); UI.render(); });
    }).catch(UI.error);
  }
  function doReverse(t) {
    UI.prompt('Reverse journal entry', 'Date of the reversing entry', U.addDays(U.monthEnd(t.date), 1), { type: 'date', ok: 'Post reversal', help: 'Posts an equal and opposite entry. Keeps the classes and fixed asset links. Typical for month-end accruals reversed on the first day of the next month.' })
      .then((date) => { if (date === null) return; return UI.book.reverseJournal(t.id, date).then((rev) => { UI.toast('Reversing entry posted.'); UI.go('#/txn/' + rev.id); }); }).catch(UI.error);
  }
  function makeRecurring(t) {
    UI.modal({
      title: 'Make recurring',
      html: `<p>Creates a schedule from this ${esc(UI.typeLabel(t.type).toLowerCase())}. Due copies are listed on the dashboard and posted when you confirm them.</p>
        <div class="form-grid"><label class="field span2"><span>Name</span><input id="r-name" value="${esc((UI.contactName(t.contactId) || UI.typeLabel(t.type)) + (t.memo ? ' — ' + t.memo : ''))}"></label>
        <label class="field"><span>Frequency</span><select id="r-freq"><option value="weekly">Weekly</option><option value="monthly" selected>Monthly</option><option value="quarterly">Quarterly</option><option value="yearly">Yearly</option></select></label>
        <label class="field"><span>Next date</span><input type="date" id="r-next" value="${U.addMonths(t.date, 1)}"></label>
        <label class="field"><span>End date (optional)</span><input type="date" id="r-end"></label></div>`,
      actions: [{ label: 'Cancel', value: null }, { label: 'Create schedule', primary: true, collect: (m) => ({ name: m.querySelector('#r-name').value, frequency: m.querySelector('#r-freq').value, nextDate: m.querySelector('#r-next').value, endDate: m.querySelector('#r-end').value }) }]
    }).then((v) => {
      if (!v) return;
      return UI.book.saveRecurring(Object.assign(v, { template: t })).then(() => { UI.toast('Recurring schedule created.'); UI.go('#/recurring'); });
    }).catch(UI.error);
  }

  /* ---------- printable invoice / receipt / credit memo ---------- */
  // Layout and PDF: js/invoice-layout.js (geometry of the reference invoice; screen and PDF draw the same operations)
  routes.print = (el, r) => {
    const b = UI.book, t = b.txById[r.id];
    if (!t) return;
    const L = OB.invoiceLayout, pages = L.pages(b, t);
    const titleMap = { invoice: 'Invoice', salesReceipt: 'Sales Receipt', creditMemo: 'Credit Memo', estimate: 'Estimate' };
    el.innerHTML = `<div class="page"><div class="page-head no-print"><div><h1>${esc(titleMap[t.type] || 'Document')} ${esc(t.number)}</h1><p class="sub">Download the PDF, or print on US Letter paper with no scaling.</p></div>
      <div class="actions"><a class="btn" href="#/txn/${esc(t.id)}">Back</a>${t.type === 'invoice' && t.status === 'posted' ? `<button type="button" class="btn" id="tx-iif-one" data-id="${esc(t.id)}">QuickBooks .iif</button>` : ''}<button class="btn" id="inv-pdf" data-key="d">Download PDF</button><button class="btn primary" data-print data-key="p">Print</button></div></div>
      <div class="inv-pages" data-testid="invoice-doc">${pages.map((ops, i) => `<div class="inv-page">${t.status === 'void' ? '<div class="void-stamp">VOID</div>' : ''}${L.svg(ops, 'class="inv-svg" role="img" aria-label="' + esc((titleMap[t.type] || 'Invoice') + ' ' + t.number + (pages.length > 1 ? ', page ' + (i + 1) : '')) + '"')}</div>`).join('')}</div></div>`;
    el.querySelector('#inv-pdf').addEventListener('click', () => {
      const logoJpeg = (src) => new Promise((res) => {
        if (!src) return res({});
        const img = new Image();
        img.onload = () => {
          const cv = document.createElement('canvas'); cv.width = img.naturalWidth; cv.height = img.naturalHeight;
          const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(img, 0, 0);
          const bin = atob(cv.toDataURL('image/jpeg', 0.92).split(',')[1]), bytes = new Uint8Array(bin.length);
          for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
          res({ [src]: { bytes, width: cv.width, height: cv.height } });
        };
        img.onerror = () => res({});
        img.src = src;
      });
      logoJpeg(b.company.logo).then((images) => {
        const name = U.safeFileName(t.date + '_' + (titleMap[t.type] || 'Invoice') + '_' + (t.number || '') + '_' + (b.contactById[t.contactId] || {}).name) + '.pdf';
        U.download(name, new Blob([L.pdf(pages, images, (titleMap[t.type] || 'Invoice') + ' ' + t.number)], { type: 'application/pdf' }));
        UI.toast('Downloaded ' + name);
      });
    });
  };
})();
