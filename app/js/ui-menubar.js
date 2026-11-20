/* VaultBook 1.51.0: menu bar (File ... Help) and icon toolbar across the top. Every item opens a screen that already
 * exists; the side menu is now a View choice. Icons are taken from the side menu links so there is one icon set. */
(function () {
  'use strict';
  const UI = OB.ui, esc = OB.util.esc, $ = (id) => document.getElementById(id);
  const content = document.querySelector('.content'), topbar = content && content.querySelector('.topbar');
  if (!topbar) return;
  /* once, on the first start with the menu bar: the side menu steps aside (View brings it back) */
  if (!OB.prefs.get('menubarSeen')) { OB.prefs.set('menubarSeen', true); OB.prefs.set('sidebarCollapsed', true); }
  const click = (id) => () => $(id).click();
  const cmd = (m) => () => document.querySelector('.cmdbar [data-menu="' + m + '"]').click();
  const sideOff = () => document.documentElement.classList.contains('sidebar-collapsed');
  /* the strip of open-window tabs under the toolbar; the Window menu still lists every open screen while it is hidden */
  const tabsOff = () => !OB.windows || OB.windows.layout === 'off' || OB.windows.layout === 'taskbar';
  const toggleTabs = () => {
    const W = OB.windows; if (!W || !W.setLayout) return;
    const map = tabsOff() ? { off: 'tabs', taskbar: 'both' } : { tabs: 'off', both: 'taskbar' };
    W.setLayout(map[W.layout] || (tabsOff() ? 'tabs' : 'off'));
  };
  const tabsItem = () => [tabsOff() ? 'Show the window tabs' : 'Hide the window tabs', toggleTabs];
  /* the icon toolbar and the function-key panel can each be hidden from View, for a calmer screen */
  const tbOff = () => OB.prefs.get('toolbar') === false;
  const applyTb = () => document.documentElement.classList.toggle('toolbar-off', tbOff());
  applyTb();
  const tbItem = () => [tbOff() ? 'Show the toolbar' : 'Hide the toolbar', () => { OB.prefs.set('toolbar', tbOff()); applyTb(); }];
  const fkItem = () => [UI.fkeysVisible && !UI.fkeysVisible() ? 'Show the function-key panel' : 'Hide the function-key panel', () => { OB.prefs.set('fkeys', !(UI.fkeysVisible && UI.fkeysVisible())); if (UI.applyFkeys) UI.applyFkeys(); }];
  const SEP = null;
  /* [label, href or function, shortcut shown] */
  const MENUS = {
    File: () => [['Open or switch company', click('btn-switch')], SEP, ['Backup and restore', '#/settings?tab=backup'], ['Import from QuickBooks', '#/migrate'], ['Import statement', '#/pdfimport'],
      ['Import', cmd('O'), 'Alt+O'], ['Export', cmd('X'), 'Alt+X'], SEP, ['Print', cmd('P'), 'Alt+P'], SEP, ['Lock company', $('btn-lock').hidden ? '' : click('btn-lock')], ['Settings', '#/settings']],
    Edit: () => [['Search or go to', () => UI.openPalette(), 'Ctrl+K'], ['Find transactions', '#/find'], SEP, ['Change the period', click('st-period'), 'Alt+F2'], ['New', click('st-new'), 'F10']],
    View: () => [['Home', '#/dashboard'], ['Gateway', '#/gateway'], ['Calendar', '#/calendar'], ['Company Snapshot', '#/snapshot'], SEP,
      [sideOff() ? 'Show the side menu' : 'Hide the side menu', click('nav-toggle'), 'Ctrl+\\'], tabsItem(), tbItem(), fkItem(), [$('theme-toggle').getAttribute('aria-label'), click('theme-toggle')]],
    Lists: () => [['Chart of accounts', '#/accounts'], ['Products & services', '#/items'], ['Customers', '#/customers'], ['Vendors', '#/vendors'], ['Classes', '#/classes'], SEP, ['Recurring', '#/recurring'], ['Bank rules', '#/rules']],
    Company: () => [['Calendar', '#/calendar'], ['Doc Center', '#/docs'], ['Budgets', '#/budgets'], SEP, ['Company Snapshot', '#/snapshot'], ['Lists and settings', () => UI.gearMenu && UI.gearMenu(), 'Ctrl+Alt+L']],
    Customers: () => [['Customers', '#/customers'], ['Invoices', '#/transactions?type=invoice'], SEP, ['Create invoice', '#/txn/new?type=invoice', 'F8'], ['Receive payment', '#/txn/new?type=payment'],
      ['Sales receipt', '#/txn/new?type=salesReceipt'], ['Estimate', '#/txn/new?type=estimate'], ['Credit memo', '#/txn/new?type=creditMemo'], SEP, ['A/R aging', '#/report/araging']],
    Vendors: () => [['Vendors', '#/vendors'], ['Bills', '#/transactions?type=bill'], SEP, ['Enter bill', '#/txn/new?type=bill'], ['Pay bills', '#/txn/new?type=billPayment', 'Alt+F9'], ['Write check', '#/txn/new?type=check'],
      ['Record expense', '#/txn/new?type=expense', 'F5'], ['Purchase order', '#/txn/new?type=purchaseOrder'], SEP, ['1099 setup', '#/1099'], ['A/P aging', '#/report/apaging']],
    Employees: () => [['Paystubs to journal', '#/payroll'], ['Payroll settings', '#/payroll?tab=settings']],
    Banking: () => [['Bank feed', '#/bankfeed'], ['Import statement', '#/pdfimport'], SEP, ['Make deposit', '#/txn/new?type=deposit'], ['Transfer', '#/txn/new?type=transfer'], ['Write check', '#/txn/new?type=check'], SEP,
      ['Reconcile', '#/reconcile'], ['Bank rules', '#/rules'], ['Registers', '#/vreg/sales'], ['Transactions', '#/transactions']],
    Accountant: () => [['Close the books', '#/close'], ['Reclassify', '#/reclassify'], ['Journal entry', '#/txn/new?type=journal'], ['Paste entries', '#/paste'], SEP,
      ['QuickBooks Desktop', '#/qbd'], ['Months & send', '#/qbsend?tab=months'], ['Update QuickBooks', '#/qbd/update'], ['Tie-out report', '#/qbd/tieout']],
    Reports: () => [['Report center', '#/reports'], SEP, ['Profit and loss', '#/report/pnl'], ['Balance sheet', '#/report/bs'], SEP, ['A/R aging', '#/report/araging'], ['A/P aging', '#/report/apaging'],
      ['General ledger', '#/report/gl'], ['Trial balance', '#/report/tb'], ['Journal', '#/report/journal']],
    Window: () => (OB.windows ? OB.windows.list : []).map((w) => [(w.id === OB.windows.activeId ? '✓ ' : '') + (w.title || w.hash), () => OB.windows.focus(w.id), '', w.id])
      .concat([SEP, ['Close the other screens', () => OB.windows.closeOthers(OB.windows.activeId)], tabsItem()]),
    Help: () => [['Keyboard shortcuts', () => UI.showShortcuts(), 'F1']]
  };
  /* an item is left out when its feature is switched off for this company (the side menu link is hidden) */
  const off = (href) => { const a = typeof href === 'string' && document.querySelector('#sidebar a[href="' + href + '"]'); return a && a.hidden; };

  const bar = document.createElement('nav');
  bar.id = 'mbar'; bar.className = 'mbar'; bar.setAttribute('aria-label', 'Menu bar'); bar.dataset.testid = 'menubar';
  bar.innerHTML = Object.keys(MENUS).map((n) => `<div class="mb-item"><button type="button" class="mb-top" aria-haspopup="menu" aria-expanded="false">${n}</button></div>`).join('') + '<span class="mb-co" id="mb-co"></span>';
  content.insertBefore(bar, topbar);
  const co = $('company-name'), setCo = () => { $('mb-co').textContent = co.textContent; };
  new MutationObserver(setCo).observe(co, { childList: true, characterData: true, subtree: true }); setCo();

  let runs = [];
  const tops = () => Array.from(bar.querySelectorAll('.mb-top'));
  const close = () => { const m = bar.querySelector('.mb-menu'); if (m) m.remove(); tops().forEach((b) => b.setAttribute('aria-expanded', 'false')); };
  const open = (btn, focus) => {
    close(); runs = [];
    const items = MENUS[btn.textContent]().filter((it) => !it || (it[1] && !off(it[1])));
    const m = document.createElement('div'); m.className = 'mb-menu'; m.setAttribute('role', 'menu'); m.setAttribute('aria-label', btn.textContent); m.setAttribute('data-overlay', '');
    m.innerHTML = items.map((it, i) => {
      if (!it) return i && items[i - 1] && i < items.length - 1 ? '<hr>' : '';
      const inner = `<span>${esc(it[0])}</span>${it[2] ? `<kbd>${esc(it[2])}</kbd>` : ''}`;
      if (typeof it[1] === 'string') return `<a role="menuitem" href="${esc(it[1])}">${inner}</a>`;
      runs.push(it[1]); return `<button type="button" role="menuitem" data-run="${runs.length - 1}"${it[3] ? ` data-win="${esc(it[3])}"` : ''}>${inner}</button>`;
    }).join('');
    btn.parentNode.appendChild(m); btn.setAttribute('aria-expanded', 'true');
    if (focus) { const f = m.querySelector('[role=menuitem]'); if (f) f.focus(); }
  };
  bar.addEventListener('click', (e) => {
    const top = e.target.closest('.mb-top'), it = e.target.closest('[role=menuitem]');
    if (top) { if (top.getAttribute('aria-expanded') === 'true') close(); else open(top); return; }
    if (!it) return;
    const run = it.dataset.run ? runs[+it.dataset.run] : null; close();
    if (run) { e.preventDefault(); setTimeout(run, 0); }   // after this click has finished, so a menu the action opens is not closed by it
  });
  bar.addEventListener('mouseover', (e) => { const top = e.target.closest('.mb-top'); if (top && bar.querySelector('.mb-menu') && top.getAttribute('aria-expanded') !== 'true') open(top); });
  document.addEventListener('click', (e) => { if (!bar.contains(e.target)) close(); });
  window.addEventListener('hashchange', close);
  bar.addEventListener('keydown', (e) => {
    const t = tops(), cur = e.target.closest('.mb-item'), i = t.indexOf(cur && cur.querySelector('.mb-top')), m = bar.querySelector('.mb-menu'), inMenu = !!e.target.closest('.mb-menu');
    const step = (d) => { const n = t[(i + d + t.length) % t.length]; if (m) open(n, true); else n.focus(); };
    if (e.key === 'ArrowRight') step(1); else if (e.key === 'ArrowLeft') step(-1);
    else if (e.key === 'Escape' && m) { close(); t[i].focus(); }
    else if (!inMenu && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) open(t[i], true);
    else if (inMenu && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { const its = Array.from(m.querySelectorAll('[role=menuitem]')), k = its.indexOf(e.target); its[(k + (e.key === 'ArrowDown' ? 1 : -1) + its.length) % its.length].focus(); }
    else return;
    e.preventDefault(); e.stopPropagation();
  });

  /* ---------- icon toolbar ---------- */
  const TOOLS = [['Home', '#/dashboard'], ['Calendar', '#/calendar'], SEP, ['Customers', '#/customers'], ['Vendors', '#/vendors'], ['Payroll', '#/payroll'], SEP,
    ['Bank feed', '#/bankfeed'], ['Reconcile', '#/reconcile'], ['Close books', '#/close'], ['Reports', '#/reports'], SEP, ['Paste entries', '#/paste'], ['Docs', '#/docs'], ['Snapshot', '#/snapshot'], SEP,
    ['Send to QBD', '#/qbsend?tab=months'], ['Backup', '#/settings?tab=backup']];
  const tb = document.createElement('div');
  tb.id = 'tbar'; tb.className = 'tbar'; tb.setAttribute('role', 'toolbar'); tb.setAttribute('aria-label', 'Main toolbar'); tb.dataset.testid = 'toolbar';
  tb.innerHTML = TOOLS.map((x) => { if (!x) return '<i aria-hidden="true"></i>'; const s = document.querySelector('#sidebar a[href="' + x[1] + '"] svg') || document.querySelector('#sidebar a[href="' + x[1].split('?')[0] + '"] svg');
    return `<a href="${x[1]}">${s ? s.outerHTML : ''}<span>${x[0]}</span></a>`; }).join('');
  topbar.insertBefore(tb, topbar.firstChild);
  const name = (h) => h.slice(2).split(/[/?]/)[0];
  const mark = () => { const n = name(location.hash || '#/dashboard'); tb.querySelectorAll('a').forEach((a) => { if (name(a.getAttribute('href')) === n) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); }); };
  window.addEventListener('hashchange', mark); mark();
})();
