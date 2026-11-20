/* OfflineBooks US — command bar (Ctrl+K / ⌘K).
 * One place to find anything (transactions by number, name, memo or amount; customers, vendors,
 * accounts, reports) and to start any task. Fully keyboard-driven; ARIA combobox + listbox.
 */
(function () {
  'use strict';
  const U = OB.util, S = OB.schema, UI = OB.ui, esc = U.esc;
  const LIMITS = { Calculator: 1, Actions: 8, Pages: 5, Reports: 8, Customers: 5, Vendors: 5, Accounts: 5, Transactions: 8 };

  function actions() {
    const b = UI.book;
    const a = [
      ['New invoice', '#/txn/new?type=invoice', 'create sale bill customer'],
      ['Receive payment', '#/txn/new?type=payment', 'customer money in'],
      ['New expense', '#/txn/new?type=expense', 'spend purchase card'],
      ['New bill', '#/txn/new?type=bill', 'vendor payable'],
      ['Pay bills', '#/txn/new?type=billPayment', 'vendor payment'],
      ['New sales receipt', '#/txn/new?type=salesReceipt', 'cash sale'],
      ['Write check', '#/txn/new?type=check', 'cheque'],
      ['New deposit', '#/txn/new?type=deposit', 'money in bank'],
      ['Transfer money', '#/txn/new?type=transfer', 'move between accounts'],
      ['New journal entry', '#/txn/new?type=journal', 'je jv general journal debit credit'],
      ['New credit memo', '#/txn/new?type=creditMemo', 'refund return customer credit'],
      ['New estimate', '#/txn/new?type=estimate', 'quote proposal bid customer'],
      ['New sales order', '#/txn/new?type=salesOrder', 'so customer order'],
      ['Batch invoicing', '#/batchinvoice', 'invoice many customers monthly'],
      ['Receive deposit', () => UI.receiveDeposit(''), 'retainer prepayment customer deposit'],
      ['Refund deposit', () => UI.refundDeposit(''), 'give back retainer customer deposit refund'],
      ['Price levels', '#/pricelevels', 'customer pricing discount wholesale'],
      ['Tax lines', '#/taxlines', 'schedule c 1120s 1065 1120 income tax return mapping'],
      ['Fixed assets', '#/fixedassets', 'depreciation equipment asset register macrs'],
      ['Adjust inventory', '#/txn/new?type=invAdjust', 'inventory count shrinkage quantity on hand'],
      ['Pay sales tax', '#/paysalestax', 'sales tax return agency payment liability'],
      ['Make deposits', '#/deposit', 'undeposited funds bank deposit batch payments'],
      ['Print checks', '#/printchecks', 'check printing cheque queue voucher'],
      ['Assess finance charges', '#/financecharges', 'late fee interest overdue'],
      ['New purchase order', '#/txn/new?type=purchaseOrder', 'po order vendor supplier'],
      ['Sales tax rates', '#/settings?tab=salestax', 'sales tax rate agency setup'],
      ['New vendor credit', '#/txn/new?type=vendorCredit', 'supplier credit'],
      ['New vendor refund', '#/txn/new?type=vendorRefund', 'money back supplier refund check received'],
      ['New customer refund', '#/txn/new?type=customerRefund', 'refund money back customer'],
      ['New credit card credit', '#/txn/new?type=ccCredit', 'card refund return'],
      ['New customer', () => UI.editContact(null, 'customer').then((c) => { if (c) UI.go('#/contact/' + c.id); }), 'add client contact'],
      ['New vendor', () => UI.editContact(null, 'vendor').then((c) => { if (c) UI.go('#/contact/' + c.id); }), 'add supplier payee contact'],
      ['New account', () => UI.editAccount(null).then((a) => { if (a) UI.go('#/accounts'); }), 'chart of accounts category add'],
      ['New bank rule', () => UI.editRule({}).then((r) => { if (r) UI.go('#/rules'); }), 'categorize automatic rule'],
      ['New class', () => UI.editClass(null).then((c) => { if (c) UI.go('#/classes'); }), 'department location job category tracking'],
      ['Classes', '#/classes', 'department location job tracking'],
      ['Products and services', '#/items', 'items product service list price sku'],
      ['New product/service', () => UI.editItem(null).then((x) => { if (x) UI.go('#/items'); }), 'add item product service'],
      ['Import from QuickBooks', '#/migrate', 'migrate quickbooks qb iif desktop convert move company data'],
      ['Open invoices', '#/report/openinv', 'unpaid invoices receivable report'],
      ['Unpaid bills', '#/report/unpaidbills', 'open bills payable report'],
      ['Budgets', '#/budgets', 'plan forecast targets'],
      ['Budget vs. actuals', '#/report/bva', 'budget variance plan'],
      ['Custom report builder', '#/builder', 'custom report filter group columns create my report'],
      ['Export invoices to QuickBooks (.iif)', () => UI.exportInvoicesIif(), 'iif quickbooks desktop invoices export import intuit'],
      ['Export financial workbook (Excel)', () => UI.exportWorkbook(), 'excel workbook export xlsx accountant cpa financial statements ledger download'],
      ['Statement designer', '#/designer', 'statement writer designer template layout formula margin ratio custom financial statement'],
      ['1099 setup', '#/1099', 'contractor nec misc irs tax form'],
      ['1099 contractor summary', '#/report/t1099', 'contractor nec misc irs report'],
      ['Create transaction…', () => UI.newMenu(), 'new menu all types', 'Alt N'],
      ['Import bank statement (PDF)', '#/pdfimport', 'upload statement pdf ocr qbo ofx excel extract'],
      ['Bank feed', '#/bankfeed', 'bank feed review match categorize transactions'], ['Calendar', '#/calendar', 'calendar due dates deadlines bills invoices payroll tax 941 1099 sales tax reminders to-do todo cash forecast schedule ics outlook google'], ['Doc Center', '#/docs', 'documents receipts bills attachments inbox scan missing receipts clean up package zip cpa audit'], ['Paste entries', '#/paste', 'paste copy excel bulk entries batch multiple journal checks deposits ledger grid repeat monthly'], ['Close the books', '#/close', 'close month year end checklist prepare review sign off autopilot flux reconcile client questions'], ['Import bank file', '#/bankfeed?import=1', 'upload csv ofx qbo statement transactions'], ['Send to QuickBooks Desktop', '#/qbsend', 'quickbooks export invoices payments connector batch sync'], ['Payroll from paystubs', '#/payroll', 'payroll paystub pay stub paycheck journal entry gross up wages withholding'], ['Payroll settings', '#/payroll?tab=settings', 'payroll accounts employer taxes futa suta'], ['QuickBooks Desktop', '#/qbd', 'quickbooks desktop connector import everything export read snapshot months send tie out'], ['QuickBooks tie-out report', '#/qbd/tieout', 'quickbooks tie out balances compare import'],
      ['Post due recurring transactions', '#/recurring', 'schedule repeat'],
      ['Reconcile an account', '#/reconcile', 'bank statement'],
      ['Download backup', () => UI.downloadBackup(), 'save export json'],
      ['Toggle dark / light mode', () => UI.toggleTheme(), 'dark mode light theme appearance night'],
      ['Toggle compact density', () => UI.setDensity(document.documentElement.dataset.density === 'compact' ? 'comfortable' : 'compact'), 'dense comfortable rows spacing'],
      ['Show or hide sidebar', () => document.getElementById('nav-toggle').click(), 'menu navigation collapse', 'Ctrl \\'],
      ['Keyboard shortcuts', () => UI.showShortcuts && UI.showShortcuts(), 'help keys hotkeys', '?'],
      ['Print this page', () => UI.printReport() || window.print(), 'pdf save print'],
      ['Change appearance', '#/settings?tab=storage', 'dark mode light theme'],
      ['Restore from backup', '#/settings?tab=backup', 'restore import json'],
      ['Check data integrity', '#/settings?tab=integrity', 'verify validate errors'],
      ['Password and security', '#/settings?tab=security', 'lock encrypt protect']
    ];
    if (b && b.security) a.push(['Lock company', () => UI.lock('manual'), 'security password']);
    a.push(['Switch company', () => UI.closeCompany(), 'open other company']);
    return a.map(([title, go, kw, hint]) => ({ group: 'Actions', title, sub: '', go, kw, hint }));
  }
  function pages() {
    return [['Gateway of VaultBook (home)', '#/gateway', 'G H'], ['Dashboard', '#/dashboard', 'G D'], ['Company Snapshot', '#/snapshot', 'G S'], ['Import bank statement (PDF)', '#/pdfimport', 'G P'], ['Bank feed', '#/bankfeed', 'G U'], ['Reconcile', '#/reconcile', 'G O'],
      ['Backup and restore', '#/settings?tab=backup'], ['Security settings', '#/settings?tab=security'], ['Import and export', '#/settings?tab=data'], ['Data integrity', '#/settings?tab=integrity'], ['App and storage', '#/settings?tab=storage'], ['Payments Snapshot', '#/snapshot?tab=payments'], ['Customer Snapshot', '#/snapshot?tab=customer'], ['Chart of accounts', '#/accounts'], ['Customers', '#/customers'], ['Vendors', '#/vendors'],
      ['Transactions', '#/transactions'], ['Invoices', '#/transactions?type=invoice'], ['Bills', '#/transactions?type=bill'],
      ['Recurring transactions', '#/recurring', 'G E'], ['Bank rules', '#/rules'], ['Reports', '#/reports', 'G R'], ['Audit log', '#/settings?tab=audit'], ['Settings', '#/settings', 'G X']]
      .map(([title, go, hint]) => ({ group: 'Pages', title, sub: '', go, kw: 'go to open', hint: hint || ({ '#/accounts': 'G A', '#/customers': 'G C', '#/vendors': 'G V', '#/transactions': 'G T', '#/transactions?type=invoice': 'G I', '#/transactions?type=bill': 'G B' })[go] }));
  }
  function records() {
    const b = UI.book, out = [];
    Object.keys(UI.REPORTS || {}).filter((k) => !UI.REPORTS[k].hidden).forEach((k) => out.push({ group: 'Reports', title: UI.REPORTS[k].title, sub: UI.REPORTS[k].group, go: '#/report/' + k, kw: 'report ' + UI.REPORTS[k].desc }));
    b.contacts.filter((c) => c.active).forEach((c) => out.push({ group: c.kind === 'customer' ? 'Customers' : 'Vendors', title: c.name, sub: 'Balance ' + U.fmt(b.contactBalance(c.id), { symbol: true }), go: '#/contact/' + c.id, kw: [c.company, c.email, c.phone].join(' ') }));
    b.accounts.filter((a) => a.active).forEach((a) => out.push({ group: 'Accounts', title: b.accountLabel(a.id), sub: S.TYPE[a.type].label, go: '#/register/' + a.id, kw: a.number }));
    return out;
  }

  /* ---------- matching ---------- */
  function score(text, q, toks) {
    const t = text.toLowerCase();
    if (t.startsWith(q)) return 0;
    const words = t.split(/[\s:&\/(),.\-#]+/);
    if (toks.every((k) => words.some((w) => w.startsWith(k)))) return 1;
    if (toks.every((k) => t.indexOf(k) >= 0)) return 2;
    return -1;
  }
  function search(q) {
    const b = UI.book, ql = q.trim().toLowerCase(), toks = ql.split(/\s+/).filter(Boolean);
    const groups = {};
    const push = (it, s) => { (groups[it.group] = groups[it.group] || []).push({ it, s }); };
    const calc = calcItem(ql);
    if (calc) push(calc, 0);
    if (!ql) {
      actions().slice(0, 6).forEach((it, i) => push(it, i));
      OB.reports.transactionList(b, { status: 'posted' }).slice(0, 5).forEach((t, i) => push(txnItem(t), i));
    } else {
      actions().concat(pages(), records()).forEach((it) => {
        let s = score(it.title, ql, toks);
        if (s < 0 && it.kw) { const k = score(it.title + ' ' + it.kw, ql, toks); if (k >= 0) s = 3; }
        if (s === 0 && it.title.toLowerCase() === ql) s = -0.5; // exact title match ranks first
        if (s >= 0 || s === -0.5) push(it, s);
      });
      // transactions: number, name, memo, line descriptions, amount
      let cents = null;
      if (/^[$\s\d,.()-]+$/.test(ql) && /\d/.test(ql)) { try { cents = Math.abs(U.toCents(ql)); } catch (e) { cents = null; } }
      const found = [];
      for (let i = 0; i < b.transactions.length && found.length < 200; i++) {
        const t = b.transactions[i];
        if (t.status !== 'posted') continue;
        let s = -1;
        if (cents && t.total === cents) s = 0;
        else if (t.number && t.number.toLowerCase().startsWith(ql)) s = 0;
        else {
          const name = t.contactId && b.contactById[t.contactId] ? b.contactById[t.contactId].name : '';
          s = score([t.number, name, t.memo, S.TXN_TYPES[t.type].label, (t.lines || []).map((l) => l.description).join(' ')].join(' '), ql, toks);
          if (s >= 0) s += 1;
        }
        if (s >= 0) found.push({ t, s });
      }
      found.sort((x, y) => x.s - y.s || (x.t.date < y.t.date ? 1 : -1)).forEach((f) => push(txnItem(f.t), f.s));
    }
    const order = ['Calculator', 'Actions', 'Pages', 'Reports', 'Customers', 'Vendors', 'Transactions', 'Accounts'];
    const flat = [], seen = {};
    (ql ? order : ['Actions', 'Transactions']).forEach((g) => {
      const list = (groups[g] || []).sort((x, y) => x.s - y.s).filter((x) => typeof x.it.go !== 'string' || (seen[x.it.go] ? false : (seen[x.it.go] = true))).slice(0, LIMITS[g]);
      list.forEach((x, i) => flat.push(Object.assign({ first: i === 0, label: !ql && g === 'Transactions' ? 'Recent' : g }, x.it)));
    });
    if (ql) flat.push({ first: true, label: 'Find', group: 'Find', title: 'Search all company data for “' + q.trim() + '”', sub: 'Every date and every field: transactions, line descriptions, names, accounts, bank lines (Ctrl+F)', go: '#/find?q=' + encodeURIComponent(q.trim()), kw: '' });
    return flat;
  }
  /* Spotlight-style calculator: "1250*1.0825" or "(300+45)/3" */
  function calcItem(q) {
    if (!/^[\d\s.,$+\-*\/()%]+$/.test(q) || !/\d\s*[+\-*\/%]\s*[\d(]/.test(q)) return null;
    const toks = q.replace(/[$,\s]/g, '').match(/\d*\.?\d+|[+\-*\/()%]/g) || [];
    let i = 0;
    const num = () => { const t = toks[i++]; if (t === '(') { const v = expr(); i++; return v; } if (t === '-') return -num(); return parseFloat(t); };
    const term = () => { let v = num(); while (toks[i] === '*' || toks[i] === '/' || toks[i] === '%') { const o = toks[i++], r = num(); v = o === '*' ? v * r : o === '/' ? v / r : v % r; } return v; };
    const expr = () => { let v = term(); while (toks[i] === '+' || toks[i] === '-') { const o = toks[i++], r = term(); v = o === '+' ? v + r : v - r; } return v; };
    let v; try { v = expr(); } catch (e) { return null; }
    if (i !== toks.length || !isFinite(v)) return null;
    const out = (Math.round(v * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return { group: 'Calculator', title: '= ' + out, sub: 'Enter copies the result', kw: '', go: () => { (navigator.clipboard ? navigator.clipboard.writeText(out.replace(/,/g, '')) : Promise.reject()).then(() => UI.toast('Copied ' + out), () => UI.toast(out)); } };
  }
  function txnItem(t) {
    const b = UI.book, name = t.contactId && b.contactById[t.contactId] ? b.contactById[t.contactId].name : '';
    return { group: 'Transactions', title: S.TXN_TYPES[t.type].label + (t.number ? ' ' + t.number : '') + (name ? ' · ' + name : ''), sub: U.fmtDate(t.date) + ' · ' + U.fmt(t.total, { symbol: true }), go: '#/txn/' + t.id, kw: t.memo };
  }
  function hl(text, q) {
    const toks = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!toks.length) return esc(text);
    const low = text.toLowerCase(); let i = -1, len = 0;
    toks.forEach((k) => { const j = low.indexOf(k); if (j >= 0 && (i < 0 || j < i)) { i = j; len = k.length; } });
    return i < 0 ? esc(text) : esc(text.slice(0, i)) + '<mark>' + esc(text.slice(i, i + len)) + '</mark>' + esc(text.slice(i + len));
  }

  /* ---------- UI ---------- */
  let st = null;
  UI.openPalette = () => {
    if (!UI.book || document.querySelector('.palette-backdrop')) return;
    const back = document.createElement('div');
    back.className = 'palette-backdrop';
    back.innerHTML = `<div class="palette" role="dialog" aria-modal="true" aria-label="Search and commands">
      <div class="palette-input"><svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><circle cx="8.5" cy="8.5" r="6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M13 13l5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        <input type="text" id="pal-q" role="combobox" aria-expanded="true" aria-controls="pal-list" aria-autocomplete="list" autocomplete="off" spellcheck="false" placeholder="Search, create, open any report, or calculate (e.g. 1200*1.08)" data-testid="palette-input"></div>
      <ul id="pal-list" role="listbox" aria-label="Results" data-testid="palette-results"></ul>
      <div class="palette-foot"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span><span><kbd>Esc</kbd> close</span><span class="spacer"></span><span><kbd>?</kbd> all shortcuts</span></div></div>`;
    document.body.appendChild(back);
    const input = back.querySelector('#pal-q'), list = back.querySelector('#pal-list');
    st = { back, input, list, items: [], index: 0, prev: document.activeElement };
    const render = () => {
      if (!st) return;
      st.items = search(input.value);
      st.index = Math.min(st.index, Math.max(0, st.items.length - 1));
      list.innerHTML = (st.items.length === 1 && st.items[0].group === 'Find' ? `<li class="pal-empty" role="presentation">No results for “${esc(input.value)}” here — search every date and field:</li>` : '') + (st.items.length ? st.items.map((it, i) => `${it.first ? `<li class="pal-group" role="presentation">${esc(it.label)}</li>` : ''}<li role="option" id="pal-${i}" data-i="${i}" data-testid="palette-item-${i}" aria-selected="${i === st.index}" class="${i === st.index ? 'on' : ''}">
        <span class="pal-ico pi-${esc(it.group.toLowerCase())}" aria-hidden="true"></span><span class="pal-title">${hl(it.title, input.value)}</span>${it.sub ? `<span class="pal-sub">${esc(it.sub)}</span>` : ''}${it.hint ? `<kbd class="pal-kbd">${esc(it.hint)}</kbd>` : ''}</li>`).join('')
        : `<li class="pal-empty" role="presentation">No results for “${esc(input.value)}”</li>`);
      input.setAttribute('aria-activedescendant', st.items.length ? 'pal-' + st.index : '');
      const on = list.querySelector('li.on'); if (on) on.scrollIntoView({ block: 'nearest' });
    };
    let timer = null;
    input.addEventListener('input', () => { st.index = 0; clearTimeout(timer); timer = setTimeout(() => { timer = null; render(); }, input.value.length > 2 ? 40 : 0); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); st.index = Math.min(st.items.length - 1, st.index + 1); render(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); st.index = Math.max(0, st.index - 1); render(); }
      else if (e.key === 'Enter') { e.preventDefault(); if (timer) { clearTimeout(timer); timer = null; render(); } choose(st.index); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
      else if (e.key === 'Tab') e.preventDefault(); // keep focus in the dialog
    });
    list.addEventListener('mousemove', (e) => { const li = e.target.closest('li[data-i]'); if (li && +li.dataset.i !== st.index) { st.index = +li.dataset.i; render(); } });
    list.addEventListener('mousedown', (e) => { e.preventDefault(); const li = e.target.closest('li[data-i]'); if (li) choose(+li.dataset.i); });
    back.addEventListener('mousedown', (e) => { if (e.target === back) close(true); });
    render();
    input.focus();
  };
  function close(restore) {
    if (!st) return;
    const prev = st.prev; st.back.remove(); st = null;
    if (restore && prev && prev.isConnected && prev.focus) prev.focus();
  }
  function choose(i) {
    const it = st && st.items[i];
    if (!it) return;
    close(false);
    if (typeof it.go === 'function') it.go(); else UI.go(it.go);
  }
  UI.closePalette = () => close(true);

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'k' || e.key === 'K')) {
      if (!UI.book) return;
      e.preventDefault();
      if (document.querySelector('.palette-backdrop')) close(true); else UI.openPalette();
    }
  });
  window.addEventListener('hashchange', () => close(false));
})();
