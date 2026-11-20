/* VaultBook — Gateway: the keyboard-first home screen with hierarchical menus.
 * Route: #/gateway            top level
 *        #/gateway?m=<menu>   a sub-menu (create, alter, vouchers, banking, reports)
 * Keys: ↑/↓/Home/End move, Enter opens, the highlighted letter opens directly, Esc returns to the parent menu.
 * Every item opens an existing screen, dialog or report; items for switched-off features are left out.
 */
(function () {
  'use strict';
  const UI = OB.ui, U = OB.util, S = OB.schema, esc = U.esc;
  const routes = UI.routes;
  const lastSel = {};   // menu -> index of the last chosen item (restored on return)

  const go = (h) => () => UI.go(h);
  const after = (p, h) => () => p().then((x) => { if (x) UI.go(h); });
  const feat = (f) => !!(UI.book && UI.book.feature(f));
  const TXN_KEY = { transfer: 'F4', expense: 'F5', vendorCredit: 'Alt+F5', payment: 'F6', creditMemo: 'Alt+F6', journal: 'F7', invoice: 'F8', salesReceipt: 'Alt+F8', bill: 'F9', billPayment: 'Alt+F9' };

  /** Menus: [{ caption, items: [{ label, hot?, run|sub, key? }] }] — `hot` = preferred letter. */
  function menus() {
    const b = UI.book;
    const reportGroups = {};
    Object.keys(UI.REPORTS).forEach((k) => { const d = UI.REPORTS[k]; if (d.hidden || (d.feature && !b.feature(d.feature))) return; (reportGroups[d.group] = reportGroups[d.group] || []).push(k); });
    const banks = b.sortedAccounts((a) => (a.type === 'bank' || a.type === 'cc') && a.active);
    return {
      root: { title: 'Gateway of VaultBook', sections: [
        { caption: 'Masters', items: [
          { label: 'Create', hot: 'c', sub: 'create', hint: 'new accounts, customers, items' },
          { label: 'Alter', hot: 'a', sub: 'alter', hint: 'change accounts, customers, items' }] },
        { caption: 'Transactions', items: [
          { label: 'Vouchers', hot: 'v', sub: 'vouchers', hint: 'enter invoices, bills, payments' },
          { label: 'Day Book', hot: 'k', run: go('#/transactions'), hint: 'every transaction, by date' }] },
        { caption: 'Banking', items: [
          { label: 'Banking', hot: 'n', sub: 'banking' }] },
        { caption: 'Reports', items: [
          { label: 'Balance Sheet', hot: 'b', run: go('#/report/bs') },
          { label: 'Profit & Loss', hot: 'p', run: go('#/report/pnl') },
          { label: 'Trial Balance', hot: 't', run: go('#/report/tb') },
          { label: 'Registers', hot: 'r', sub: 'registers' },
          { label: 'Display More Reports', hot: 'd', sub: 'reports' }] },
        { caption: 'Company', items: [
          { label: 'Company', hot: 'o', sub: 'company' },
          { label: 'Quit (close company)', hot: 'q', run: () => UI.confirmLeave(UI.closeCompany) }] }] },
      company: { title: 'Company', sections: [{ caption: 'Company', items: [
        { label: 'Features', hot: 'f', run: () => UI.openFeatures(), key: 'F11' },
        { label: 'Configure', hot: 'g', run: () => UI.openConfigure(), key: 'F12' },
        { label: 'Settings and backup', hot: 'e', run: go('#/settings') },
        { label: 'Import from QuickBooks', hot: 'm', run: go('#/migrate') },
        { label: 'Company Snapshot', hot: 's', run: go('#/snapshot') }] }] },
      create: { title: 'Create', sections: [{ caption: 'Masters', items: [
        { label: 'Account', hot: 'a', run: after(() => UI.editAccount(null), '#/accounts') },
        { label: 'Customer', hot: 'c', run: after(() => UI.editContact(null, 'customer'), '#/customers') },
        { label: 'Vendor', hot: 'v', run: after(() => UI.editContact(null, 'vendor'), '#/vendors') },
        { label: 'Product/service', hot: 'p', run: after(() => UI.editItem(null), '#/items') },
        feat('classes') ? { label: 'Class', hot: 'l', run: after(() => UI.editClass(null), '#/classes') } : null,
        { label: 'Bank rule', hot: 'r', run: after(() => UI.editRule(null), '#/rules') }] }] },
      alter: { title: 'Alter', sections: [{ caption: 'Masters', items: [
        { label: 'Chart of Accounts', hot: 'h', run: go('#/accounts') },
        { label: 'Customers', hot: 'c', run: go('#/customers') },
        { label: 'Vendors', hot: 'v', run: go('#/vendors') },
        { label: 'Products and services', hot: 'p', run: go('#/items') },
        { label: 'Fixed assets', run: go('#/fixedassets') },
        { label: 'Tax lines', run: go('#/taxlines') },
        { label: 'Price levels', run: go('#/pricelevels') },
        feat('classes') ? { label: 'Classes', hot: 'l', run: go('#/classes') } : null,
        { label: 'Bank rules', hot: 'r', run: go('#/rules') },
        { label: 'Recurring schedules', hot: 's', run: go('#/recurring') },
        feat('budgets') ? { label: 'Budgets', hot: 'b', run: go('#/budgets') } : null,
        feat('1099') ? { label: '1099 setup', hot: '1', run: go('#/1099') } : null] }] },
      vouchers: { title: 'Vouchers', sections: [
        { caption: 'Sales', items: ['estimate', 'salesOrder', 'invoice', 'salesReceipt', 'payment', 'creditMemo', 'customerRefund'].map(txnItem).concat([{ label: 'Assess finance charges', run: go('#/financecharges') }, { label: 'Batch invoicing', run: go('#/batchinvoice') }, { label: 'Receive deposit', run: () => UI.receiveDeposit('') }]) },
        { caption: 'Purchases', items: ['purchaseOrder', 'bill', 'billPayment', 'expense', 'check', 'vendorCredit', 'vendorRefund', 'ccCredit'].map(txnItem) },
        { caption: 'Banking and journal', items: ['deposit', 'transfer', 'journal'].map(txnItem) },
        { caption: 'Other work', items: [
          { label: 'Recurring', hot: 'u', run: go('#/recurring') },
          { label: 'Paste entries from Excel', run: go('#/paste') },
          { label: 'Doc Center', run: go('#/docs') },
          { label: 'Calendar', run: go('#/calendar') },
          { label: 'Reclassify transactions', hot: 'l', run: go('#/reclassify') }] }] },
      banking: { title: 'Banking', sections: [
        { caption: 'Bank work', items: [
          { label: 'Reconcile', hot: 'r', run: go('#/reconcile') },
          { label: 'Make deposits', hot: 'm', run: go('#/deposit') },
          { label: 'Print checks', hot: 'c', run: go('#/printchecks') },
          { label: 'Pay sales tax', run: go('#/paysalestax') },
          { label: 'Bank feed', hot: 'f', run: go('#/bankfeed') },
          { label: 'Close the books', hot: 'x', run: go('#/close') },
          { label: 'Import bank file', hot: 'i', run: go('#/bankfeed?import=1') },
          { label: 'Import statement (PDF)', hot: 'p', run: go('#/pdfimport') },
          { label: 'Bank rules', hot: 'b', run: go('#/rules') }] },
        { caption: 'Books', items: [{ label: 'Cash/Bank Book', hot: 'k', run: go('#/vreg/bank') }] }] },
      registers: { title: 'Registers', sections: [
        { caption: 'Account books', items: [
          { label: 'Sales Register', hot: 's', run: go('#/vreg/sales') },
          { label: 'Purchase Register', hot: 'p', run: go('#/vreg/purchase') },
          { label: 'Cash/Bank Book', hot: 'c', run: go('#/vreg/bank') },
          { label: 'Day Book', hot: 'd', run: go('#/transactions') },
          { label: 'General Ledger', hot: 'g', run: go('#/report/gl') },
          { label: 'Journal', hot: 'j', run: go('#/report/journal') }] },
        banks.length ? { caption: 'Account registers', items: banks.slice(0, 9).map((a) => ({ label: b.accountLabel(a.id), run: go('#/register/' + encodeURIComponent(a.id)) })) } : null] },
      reports: { title: 'Display More Reports', sections: Object.keys(reportGroups).map((g) => ({ caption: g, items: reportGroups[g].map((k) => ({ label: UI.REPORTS[k].title, run: go(UI.reportHref(k)) })) }))
        .concat((b.reports || []).length ? [{ caption: 'My reports', items: b.reports.slice(0, 12).map((x) => ({ label: x.name, run: go(UI.savedReportHref(x)) })) }] : []) }
    };
  }
  function txnItem(t) { return { label: UI.typeLabel(t), run: go('#/txn/new?type=' + t), key: TXN_KEY[t] }; }

  /** Give every item one unique hot letter (preferred letter first, then the first free letter of the label). */
  function assignHot(menu) {
    const taken = new Set();
    menu.sections.forEach((s) => s.items.forEach((it) => {
      const text = it.label.toLowerCase();
      const cand = (it.hot ? [it.hot] : []).concat(text.split('').filter((c) => /[a-z0-9]/.test(c)));
      it.hotKey = cand.find((c) => !taken.has(c) && text.indexOf(c) >= 0) || '';
      if (it.hotKey) taken.add(it.hotKey);
    }));
  }
  function labelHtml(it) {
    if (!it.hotKey) return esc(it.label);
    const i = it.label.toLowerCase().indexOf(it.hotKey);
    return esc(it.label.slice(0, i)) + `<span class="hot">${esc(it.label.charAt(i))}</span>` + esc(it.label.slice(i + 1));
  }

  function infoPanel(b) {
    const t = UI.workDate(), per = UI.currentPeriod(), custom = !!UI.period();
    const posted = b.transactions.filter((x) => x.status === 'posted');
    const last = posted.reduce((m, x) => (x.date > m ? x.date : m), '');
    const wd = (d) => new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long' });
    const alerts = [];
    const today = U.today();
    const due = b.dueRecurring(); if (due.length) alerts.push(['info', due.length + ' recurring due', '#/recurring', 'Review']);
    const overdue = posted.filter((x) => x.type === 'invoice' && x.dueDate && x.dueDate < today && b.openBalance(x) > 0);
    if (overdue.length) alerts.push(['warn', overdue.length + ' overdue invoice' + (overdue.length === 1 ? '' : 's'), '#/report/araging', 'A/R aging']);
    const btn = (act, cap, val, key, title) => `<button type="button" class="gw-stat" data-act="${act}" title="${esc(title)}"><span class="gw-cap">${cap}${key ? ` <kbd>${esc(UI.keys ? UI.keys.display(key) : key)}</kbd>` : ''}</span><span class="gw-val">${val}</span></button>`;
    return `<section class="gw-info" aria-label="Company">
      <div class="gw-pair">${btn('period', 'Current period', `${UI.date(per.from)} to ${UI.date(per.to)}${custom ? ' <span class="gw-tag">set</span>' : ''}`, 'Alt+F2', 'Change the current period (Alt+F2). Reports open on it.')}
        <div class="r">${btn('date', 'Current date', `${esc(wd(t))}, ${UI.date(t)}${t !== today ? ' <span class="gw-tag">not today</span>' : ''}`, 'F2', 'Change the current date (F2). New entries are dated on it.')}</div></div>
      <div class="gw-pair gw-co">${btn('company', 'Name of company', `<span class="strong" data-testid="gateway-company">${esc(b.company.name)}</span><span class="gw-sub">${b.company.basis === 'cash' ? 'Cash' : 'Accrual'} basis${b.security ? ' · protected' : ''}</span>`, '', 'Company information: name, accounting basis, fiscal year')}
        <div class="r">${btn('last', 'Date of last entry', last ? UI.date(last) : '—', '', 'Open the Day Book on the last entry date')}</div></div>
      ${alerts.length ? `<div class="gw-alerts">${alerts.map((a) => `<div class="gw-alert ${a[0]}"><span>${esc(a[1])}</span><a href="${a[2]}">${esc(a[3])}</a></div>`).join('')}</div>` : ''}
    </section>`;
  }
  const lastEntryDate = (b) => b.transactions.filter((x) => x.status === 'posted').reduce((m, x) => (x.date > m ? x.date : m), '');
  const STAT = {
    period: () => UI.changePeriod(),
    date: () => UI.changeWorkDate(),
    company: () => UI.go('#/settings?tab=company'),
    last: () => { const d = lastEntryDate(UI.book); UI.go(d ? '#/transactions?' + UI.qs({ range: 'custom', from: d, to: d }) : '#/transactions'); }
  };

  routes.gateway = (el, r) => {
    const b = UI.book, all = menus(), key = all[r.params.m] ? r.params.m : 'root', menu = all[key];
    menu.sections = menu.sections.filter(Boolean).map((s) => ({ caption: s.caption, items: s.items.filter(Boolean) })).filter((s) => s.items.length);
    assignHot(menu);
    const flat = []; menu.sections.forEach((s) => s.items.forEach((it) => flat.push(it)));
    el.innerHTML = `<div class="page gateway-page"><h1 class="sr-only">Gateway of VaultBook</h1><div class="gateway" data-testid="gateway">
      ${infoPanel(b)}
      <div class="gw-menu-wrap"><nav class="gw-menu" aria-label="${esc(menu.title)}" data-menu="${key}">
        <div class="gw-title">${key === 'root' ? '' : '<span class="gw-crumb">Gateway ›</span> '}${esc(menu.title)}</div>
        <div role="menu" aria-label="${esc(menu.title)}">${menu.sections.map((s) => `<div class="gw-sec" role="group" aria-label="${esc(s.caption)}"><div class="gw-cap">${esc(s.caption)}</div>
          ${s.items.map((it) => { const i = flat.indexOf(it); return `<button type="button" role="menuitem" class="gw-item" data-i="${i}" tabindex="-1"${it.hotKey ? ` aria-keyshortcuts="${esc(it.hotKey.toUpperCase())}"` : ''}><span class="gw-l">${labelHtml(it)}${it.hint ? ` <span class="gw-hint">${esc(it.hint)}</span>` : ''}${it.sub ? ' <span class="gw-more" aria-hidden="true">›</span>' : ''}</span>${it.key ? `<kbd>${esc(UI.keys ? UI.keys.display(it.key) : it.key)}</kbd>` : ''}</button>`; }).join('')}</div>`).join('')}
        </div>${key !== 'root' ? '<button type="button" class="gw-back" data-back>Esc · Back to Gateway</button>' : ''}</nav></div>
    </div></div>`;
    const items = [...el.querySelectorAll('.gw-item')];
    const select = (i, focus) => {
      i = (i + items.length) % items.length;
      items.forEach((x, j) => { x.classList.toggle('on', j === i); x.tabIndex = j === i ? 0 : -1; });
      lastSel[key] = i; if (focus !== false) items[i].focus({ preventScroll: false });
    };
    const activate = (i) => {
      const it = flat[i]; if (!it) return;
      lastSel[key] = i;
      if (it.sub) UI.go('#/gateway?m=' + it.sub); else it.run();
    };
    el.querySelector('.gw-info').addEventListener('click', (e) => { const x = e.target.closest('[data-act]'); if (x && STAT[x.dataset.act]) STAT[x.dataset.act](); });
    el.querySelector('.gw-menu').addEventListener('click', (e) => {
      const btn = e.target.closest('.gw-item'); if (btn) { select(+btn.dataset.i, false); activate(+btn.dataset.i); return; }
      if (e.target.closest('[data-back]')) UI.gatewayBack();
    });
    el.querySelector('.gw-menu').addEventListener('keydown', (e) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const cur = items.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); select(cur + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); select(cur - 1); }
      else if (e.key === 'Home') { e.preventDefault(); select(0); }
      else if (e.key === 'End') { e.preventDefault(); select(items.length - 1); }
    });
    // after the router has focused <main>: put the keyboard on the menu
    if (items.length) requestAnimationFrame(() => { if (items[0].isConnected) select(Math.min(lastSel[key] || 0, items.length - 1)); });
    // hot letters: plain letter keys on the Gateway (not while typing or in a dialog)
    UI._gatewayKeys = (e) => {
      if (UI.parseHash().name !== 'gateway' || e.altKey || e.ctrlKey || e.metaKey || e.key.length !== 1) return false;
      const t = e.target; if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return false;
      if (document.querySelector('.modal-backdrop, .palette-backdrop, .drawer-backdrop, .cmd-menu:not([hidden])')) return false;
      const k = e.key.toLowerCase(), i = flat.findIndex((it) => it.hotKey === k);
      if (i < 0) return false;
      e.preventDefault(); e.stopPropagation(); select(i, false); activate(i); return true;
    };
  };
  /** Esc on the Gateway: from a sub-menu return to the top level. Returns true when it handled the key. */
  UI.gatewayBack = () => {
    const r = UI.parseHash(); if (r.name !== 'gateway' || !r.params.m) return false;
    UI.go('#/gateway'); return true;
  };
  window.addEventListener('keydown', (e) => { if (UI._gatewayKeys) UI._gatewayKeys(e); }, true);
})();
