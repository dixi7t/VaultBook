/* VaultBook — central keyboard registry, function-key panel, command bar, Esc-back and row cursor.
 *
 * One registry (UI.keys) owns every function-key and Alt-menu shortcut. Each entry declares the screen
 * contexts it applies to; the same list drives the key handler, the clickable function-key panel on the
 * right, and the shortcut reference (F1). Nothing here changes accounting data: actions only navigate,
 * open existing dialogs, or press existing buttons.
 *
 * Contexts: 'gateway' | 'entry' | 'report' | 'register' | 'other'  (no company open: no shortcuts).
 * Text editing is never intercepted: F-keys are not text keys; Alt+letter is ignored while typing on a Mac
 * (Option+letter types characters there); Esc inside a field only leaves the field.
 */
(function () {
  'use strict';
  const UI = OB.ui, esc = OB.util.esc;
  const MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
  const K = UI.keys = { list: [] };

  /* ---------- context ---------- */
  const REGISTER_ROUTES = { transactions: 1, register: 1, accounts: 1, customers: 1, vendors: 1, contact: 1, classes: 1, budgets: 1, recurring: 1, rules: 1, '1099': 1 };
  K.context = () => {
    if (!UI.book) return 'none';
    const r = UI.parseHash();
    if (r.name === 'gateway') return 'gateway';
    if (r.name === 'txn') return 'entry';
    if (r.name === 'report' || r.name === 'vreg' || r.name === 'builder' || r.name === 'designer' || r.name === 'reports' || r.name === 'budget') return 'report';
    if (REGISTER_ROUTES[r.name]) return 'register';
    return 'other';
  };
  const typing = (t) => !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  const overlayOpen = () => !!document.querySelector('.modal-backdrop, .drawer-backdrop, .sb-drawer-back, .palette-backdrop, .cols-pop, .win-context, .cmd-menu:not([hidden]), .menu-wrap .menu:not([hidden]), .sb-pop:not([hidden]), .st-pop, [role="listbox"]:not([hidden]):not(:empty), [data-overlay]');   // [data-overlay]: a page's own popover or selection takes Esc (1.50.1)

  /** Register a shortcut. def: { id, key: 'F5' | 'Alt+F5' | 'Alt+G' | 'Esc', label, group, ctx: [contexts] | fn, run, panel, hint } */
  K.add = (def) => { K.list.push(def); return def; };
  const applies = (d, ctx) => typeof d.ctx === 'function' ? !!d.ctx(ctx) : (!d.ctx || d.ctx.indexOf(ctx) >= 0);
  K.active = (ctx) => K.list.filter((d) => applies(d, ctx || K.context()));
  const label = (d, ctx) => typeof d.label === 'function' ? d.label(ctx) : d.label;
  K.display = (key) => MAC ? key.replace('Ctrl+', '⌃').replace('Alt+', '⌥') : key;

  function eventKey(e) {
    if (e.key === 'Escape') return (e.altKey || e.ctrlKey || e.metaKey) ? '' : 'Esc';
    if (/^F([1-9]|1[0-2])$/.test(e.key)) return (e.altKey ? 'Alt+' : '') + (e.ctrlKey ? 'Ctrl+' : '') + (e.shiftKey ? 'Shift+' : '') + e.key;
    if (e.ctrlKey && e.altKey && !e.metaKey && !e.shiftKey) {   // QuickBooks Online keys; AltGr also sends Ctrl+Alt, so the key must still be the plain letter
      if (/^Key[A-Z]$/.test(e.code || '') && (e.key || '').toUpperCase() === e.code.slice(3)) return 'Ctrl+Alt+' + e.code.slice(3);
      if (e.code === 'Slash' && (e.key === '/' || e.key === '?')) return 'Ctrl+Alt+/';
      return '';
    }
    if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && /^Key[A-Z]$/.test(e.code || '')) return 'Alt+' + e.code.slice(3);
    if (e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && /^Key[BFD]$/.test(e.code || '')) return 'Ctrl+' + e.code.slice(3);   // Tally: Ctrl+B basis, Ctrl+F filter
    return '';
  }
  K.run = (d) => { try { const r = d.run(K.context()); if (r && r.catch) r.catch(UI.error); } catch (err) { UI.error(err); } };

  /* ---------- the shortcut list ---------- */
  const ALL = ['gateway', 'entry', 'report', 'register', 'other'];
  const newTxn = (type) => () => UI.go('#/txn/new?type=' + type);
  const pressIn = (sel) => { const el = document.querySelector('#main ' + sel); if (el) { el.click(); return true; } return false; };
  const focusIn = (sel) => { const el = document.querySelector('#main ' + sel); if (el && !el.disabled) { el.focus(); if (el.select && el.tagName === 'INPUT') try { el.select(); } catch (x) { /* date inputs */ } return true; } return false; };

  K.add({ id: 'help', key: 'F1', label: 'Help', group: 'General', ctx: ALL, panel: false, run: () => UI.showShortcuts() });
  K.add({ id: 'date', key: 'F2', label: 'Date', group: 'Screen', ctx: (c) => c === 'entry' && !!document.querySelector('#main input[name=date]:not(:disabled)'), run: () => focusIn('input[name=date]') });
  K.add({ id: 'period', key: 'F2', label: 'Period', group: 'Screen',
    ctx: (c) => c === 'report' && !!document.querySelector('#main #st-range, #main select[aria-label="Date range"], #main input[type=date]'),
    run: () => focusIn('#st-range') || focusIn('select[aria-label="Date range"]') || focusIn('input[type=date]') });
  K.add({ id: 'company', key: 'F3', label: 'Company', group: 'Company', ctx: ALL, run: () => UI.confirmLeave(UI.closeCompany) });
  K.add({ id: 'transfer', key: 'F4', label: 'Transfer', group: 'Create', ctx: ALL, run: newTxn('transfer') });
  K.add({ id: 'expense', key: 'F5', label: 'Expense', group: 'Create', ctx: ALL, run: newTxn('expense') });
  K.add({ id: 'detail', key: 'Alt+F5', label: (c) => 'Detailed / condensed', group: 'Screen',
    ctx: (c) => c === 'report' && !!document.querySelector('#main [data-coll]'),
    run: () => { K._condensed = !K._condensed; return pressIn(K._condensed ? '[data-coll=collapse]' : '[data-coll=expand]'); } });
  K.add({ id: 'vendorCredit', key: 'Alt+F5', label: 'Vendor credit', group: 'Create', ctx: (c) => c !== 'none' && !(c === 'report' && document.querySelector('#main [data-coll]')), run: newTxn('vendorCredit') });
  K.add({ id: 'receive', key: 'F6', label: 'Receive payment', group: 'Create', ctx: ALL, run: newTxn('payment') });
  K.add({ id: 'creditMemo', key: 'Alt+F6', label: 'Credit memo', group: 'Create', ctx: ALL, run: newTxn('creditMemo') });
  K.add({ id: 'journal', key: 'F7', label: 'Journal entry', group: 'Create', ctx: ALL, run: newTxn('journal') });
  K.add({ id: 'invoice', key: 'F8', label: 'Invoice', group: 'Create', ctx: ALL, run: newTxn('invoice') });
  K.add({ id: 'salesReceipt', key: 'Alt+F8', label: 'Sales receipt', group: 'Create', ctx: ALL, run: newTxn('salesReceipt') });
  K.add({ id: 'bill', key: 'F9', label: 'Bill', group: 'Create', ctx: ALL, run: newTxn('bill') });
  K.add({ id: 'payBills', key: 'Alt+F9', label: 'Pay bills', group: 'Create', ctx: ALL, run: newTxn('billPayment') });
  K.add({ id: 'otherTxn', key: 'F10', label: 'Create anything', group: 'Create', ctx: ALL, run: () => UI.newMenu() });
  K.add({ id: 'features', key: 'F11', label: 'Features', group: 'Company', ctx: ALL, run: () => UI.openFeatures() });
  K.add({ id: 'configure', key: 'F12', label: 'Configure', group: 'Company', ctx: ALL, run: () => UI.openConfigure() });
  K.add({ id: 'goto', key: 'Alt+G', label: 'Go To', group: 'General', ctx: ALL, panel: false, run: () => UI.openPalette() });
  ['K', 'Y', 'O', 'X', 'P'].forEach((L) => K.add({ id: 'menu' + L, key: 'Alt+' + L, label: () => (MENUS[L] || {}).label, group: 'Menus', ctx: ALL, panel: false, run: () => openMenu(L) }));
  /* QuickBooks Online keys (Ctrl+Alt+letter), as aliases: the F-keys above stay. On a form the letters act on the form. */
  const onForm = (c) => c === 'entry' && !!document.querySelector('#main form');
  const QB = 'QuickBooks Online keys';
  [['I', 'invoice', 'Invoice', newTxn('invoice')], ['W', 'check', 'Check', newTxn('check')], ['E', 'estimate', 'Estimate', newTxn('estimate')],
    ['R', 'receive', 'Receive payment', newTxn('payment')], ['V', 'vendors', 'Vendors', () => UI.go('#/vendors')], ['A', 'accounts', 'Chart of accounts', () => UI.go('#/accounts')],
    ['L', 'lists', 'Lists and settings (gear menu)', () => UI.gearMenu && UI.gearMenu()], ['F', 'search', 'Search', () => UI.openPalette()],
    ['H', 'help', 'Help and shortcuts', () => UI.showShortcuts()]].forEach(([L, id, lbl, run]) => K.add({ id: 'qb-' + id, key: 'Ctrl+Alt+' + L, label: lbl, group: QB, ctx: ALL, panel: false, run }));
  K.add({ id: 'qb-expense', key: 'Ctrl+Alt+X', label: 'Expense', group: QB, ctx: (c) => c !== 'none' && !onForm(c), panel: false, run: newTxn('expense') });
  K.add({ id: 'qb-customers', key: 'Ctrl+Alt+C', label: 'Customers', group: QB, ctx: (c) => c !== 'none' && !onForm(c), panel: false, run: () => UI.go('#/customers') });
  K.add({ id: 'qb-keys', key: 'Ctrl+Alt+/', label: 'Keyboard shortcuts', group: QB, ctx: ALL, panel: false, run: () => UI.showShortcuts() });
  const formBtn = (sel) => () => { const el = document.querySelector('#main form ' + sel); if (el && !el.disabled) el.click(); else UI.toast('Not on this form.'); };
  [['S', 'save-new', 'On a form: save and new', '[data-after="new"]'], ['D', 'save-close', 'On a form: save and close', '[data-after="close"], [data-after="view"]'],
    ['M', 'save-send', 'On a form: save and send', '[data-after="send"], [data-act="email"], [data-after="view"]'], ['P', 'print', 'On a form: print', 'a[href^="#/print/"], [data-act="print"]']]
    .forEach(([L, id, lbl, sel]) => K.add({ id: 'qbf-' + id, key: 'Ctrl+Alt+' + L, label: lbl, group: QB, ctx: onForm, panel: false, run: formBtn(sel) }));
  K.add({ id: 'qbf-close', key: 'Ctrl+Alt+X', label: 'On a form: close (also Ctrl+Alt+C)', group: QB, ctx: onForm, panel: false, run: () => K.back() });
  K.add({ id: 'qbf-close2', key: 'Ctrl+Alt+C', label: 'On a form: close', group: QB, ctx: onForm, panel: false, run: () => K.back() });
  K.add({ id: 'bookmark', key: 'Ctrl+D', label: 'Bookmark this page', group: 'General', ctx: (c) => c !== 'none', panel: false, run: () => UI.toggleBookmark && UI.toggleBookmark() });
  K.add({ id: 'back', key: 'Esc', label: 'Back / close', group: 'General', ctx: ALL, panel: false, run: () => K.back() });

  /* ---------- Esc = back, with remembered scroll and row ---------- */
  const mem = K._mem = {};   // hash -> { scroll, row }
  let depth = 0, goingBack = false;
  window.addEventListener('hashchange', () => { if (goingBack) depth = Math.max(0, depth - 1); else depth++; });
  K.back = () => {
    const r = UI.parseHash();
    if (r.name === 'gateway' && UI.gatewayBack && UI.gatewayBack()) return;   // close a submenu first
    if (r.name === 'gateway') return;                                          // top level: nowhere to go
    UI.confirmLeave(() => {
      UI.dirty = false;
      if (depth > 0) { goingBack = true; UI._allowNav = true; history.back(); setTimeout(() => { goingBack = false; }, 400); }
      else UI.go('#/dashboard');
    });
  };
  K.afterRender = () => {
    const h = location.hash, m = document.getElementById('main'), saved = mem[h];
    if (goingBack && saved && m) {
      requestAnimationFrame(() => { m.scrollTop = saved.scroll; if (saved.row >= 0) setCursor(saved.row, false); });
    }
    K.hooks.forEach((fn) => { try { fn(); } catch (err) { console.error(err); } });
    renderPanel();
  };
  K.hooks = [];   // other modules add post-render enhancers here (entry header, ...)

  /* ---------- row cursor (registers and reports) ---------- */
  // rows that only hold tick boxes (deposits, reconcile, pay bills…) take the cursor too; Space ticks them
  const TEXTY = 'input:not([type=checkbox]):not([type=radio]), select, textarea';
  const rowList = () => [...document.querySelectorAll('#main table.data tbody tr, #main table.statement tbody tr, #main table.sb-table tbody tr:not(.r-gap), #main table.tbl tbody tr, #main .ledger-table tbody tr, #main table.bf-table tbody tr, #main ul.report-links > li, #main [data-kbrow]')]
    .filter((tr) => tr.offsetParent !== null && !tr.querySelector(TEXTY) && !tr.closest('form.txform') && !tr.classList.contains('vr-line') && !tr.closest('.modal'));
  function cursorIndex() { return rowList().findIndex((tr) => tr.classList.contains('kb-row')); }
  function setCursor(i, focusScroll) {
    const rows = rowList(); if (!rows.length) return false;
    i = Math.max(0, Math.min(rows.length - 1, i));
    document.querySelectorAll('#main .kb-row').forEach((tr) => { tr.classList.remove('kb-row'); tr.removeAttribute('aria-selected'); });
    const tr = rows[i]; tr.classList.add('kb-row'); tr.setAttribute('aria-selected', 'true');
    (mem[location.hash] = mem[location.hash] || {}).row = i;   // remembered for Esc / Back
    if (focusScroll !== false) tr.scrollIntoView({ block: 'nearest' });
    return true;
  }
  function tickRow() {
    const tr = document.querySelector('#main .kb-row'); const box = tr && tr.querySelector('input[type=checkbox]:not(:disabled), input[type=radio]:not(:disabled)');
    if (!box) return false; box.click(); return true;
  }
  function openRow() {
    const tr = document.querySelector('#main .kb-row'); if (!tr) return false;
    const a = tr.querySelector('a[href]:not([href="#"])');
    if (a) { a.click(); return true; }
    if (tr.dataset.href) { location.hash = tr.dataset.href; return true; }
    const btn = tr.querySelector('button'); if (btn) { btn.click(); return true; }
    return false;
  }
  K.cursor = { set: setCursor, index: cursorIndex, open: openRow };
  // One highlight at a time: the pointer moves the same row cursor the arrow keys do. Arrow keys put the
  // page in keyboard mode; only a real mouse movement (not rows scrolling under a still pointer) takes it back.
  let kbNav = false, lastTr = null, lastXY = '';
  document.addEventListener('keydown', (e) => { if (/^(Arrow(Up|Down)|Page(Up|Down)|Home|End)$/.test(e.key)) { kbNav = true; lastTr = null; } }, true);
  document.addEventListener('mousemove', (e) => {
    const xy = e.screenX + ',' + e.screenY; if (xy === lastXY) return; lastXY = xy; kbNav = false;
    const tr = e.target.closest && e.target.closest('#main tbody tr, #main ul.report-links > li, #main [data-kbrow]'); if (!tr || tr === lastTr) return; lastTr = tr;
    const i = rowList().indexOf(tr); if (i >= 0 && !tr.classList.contains('kb-row')) setCursor(i, false);
  }, { passive: true });
  K.pointerMode = () => !kbNav;
  document.addEventListener('mousedown', (e) => {   // clicking a row moves the cursor there too
    const tr = e.target.closest && e.target.closest('#main tbody tr, #main ul.report-links > li, #main [data-kbrow]'); if (!tr) return;
    const i = rowList().indexOf(tr); if (i >= 0) setCursor(i, false);
  });

  /* ---------- dispatcher (capture phase: runs before page handlers, sees overlays before they close) ---------- */
  window.addEventListener('keydown', (e) => {
    if (!UI.book || e.isComposing) return;
    const t = e.target, box = t && t.tagName === 'INPUT' && (t.type === 'checkbox' || t.type === 'radio') && t.closest('#main tr, #main li');
    const inField = typing(t) && !box;
    const ctx = K.context();
    // row cursor: plain arrows / Enter / PgUp / PgDn outside fields
    if (!inField && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && !overlayOpen() && ctx !== 'entry' && ctx !== 'gateway' && !(t.closest && t.closest('.nav, .mbar, .window-tabs, .window-taskbar, .fkeys, .cmdbar, .menu-wrap, [role="tablist"], [role="radiogroup"]'))) {
      const i = cursorIndex();
      const step = { ArrowDown: 1, ArrowUp: -1, PageDown: 10, PageUp: -10 }[e.key];
      if (step && rowList().length) { e.preventDefault(); if (box) t.blur(); setCursor(i < 0 ? 0 : i + step); return; }
      if (e.key === 'Enter' && i >= 0 && !/^(A|BUTTON|SUMMARY)$/.test(t.tagName)) { if (openRow()) { e.preventDefault(); return; } }
      if (e.key === ' ' && i >= 0 && !box && !/^(A|BUTTON|SUMMARY)$/.test(t.tagName)) { if (tickRow()) { e.preventDefault(); return; } }
    }
    const k = eventKey(e); if (!k) return;
    if (k === 'Esc') {
      if (overlayOpen() || document.documentElement.classList.contains('sb-focus') || document.querySelector('.nav-flyout.open')) return;
      if (inField && t.closest('.combo') && t.getAttribute('aria-expanded') === 'true') return;   // Esc first closes an open list
      if (inField && ctx === 'entry' && !t.closest('.modal, .drawer, .palette')) { e.preventDefault(); t.blur(); setTimeout(K.back); return; }   // like Tally/QuickBooks: Esc quits the entry
      if (inField) { if (t.closest('.modal, .drawer, .palette')) return; e.preventDefault(); t.blur(); const f = t.closest('form') || document.getElementById('main'); if (f) { if (!f.hasAttribute('tabindex')) f.setAttribute('tabindex', '-1'); f.focus({ preventScroll: true }); } return; }
      if (t.closest && t.closest('.modal, .drawer, .palette')) return;
      e.preventDefault(); setTimeout(K.back); return;   // after this keypress, so the Esc doesn't also dismiss the dialog it opens
    }
    if (k.startsWith('Alt+') && !/^Alt\+F/.test(k) && MAC && inField) return;   // Option+letter types characters on a Mac
    if (document.querySelector('.modal-backdrop, .palette-backdrop') && !/^F1$/.test(k)) return;  // dialogs own the keyboard
    const d = K.active(ctx).find((x) => x.key === k);
    if (!d) return;
    e.preventDefault(); e.stopPropagation();
    if (document.querySelector('.cmd-menu:not([hidden])')) closeMenus();
    K.run(d);
  }, true);

  /* ---------- function-key panel ---------- */
  function renderPanel() {
    const host = document.getElementById('fkeys'); if (!host) return;
    const ctx = K.context();
    if (ctx === 'none') { host.innerHTML = ''; host.hidden = true; return; }
    host.hidden = false;
    const defs = K.active(ctx).filter((d) => d.panel !== false);
    const groups = ['Screen', 'Create', 'Company'];
    const title = { Screen: 'This screen', Create: 'Create', Company: 'Company' };
    const hints = '';
    const chev = (d) => `<svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    let show = document.getElementById('fk-show');
    if (!show) { show = document.createElement('button'); show.type = 'button'; show.id = 'fk-show'; show.className = 'fk-show'; show.dataset.fkpanel = 'show'; show.title = 'Show function-key panel'; show.setAttribute('aria-label', 'Show function-key panel'); show.innerHTML = chev('M12.5 4.5 7 10l5.5 5.5'); host.after(show); }
    host.innerHTML = `<button type="button" class="fk-collapse" data-fkpanel="hide" title="Hide this panel (the keys still work)" aria-label="Hide function-key panel">${chev('M7.5 4.5 13 10l-5.5 5.5')}</button>` + groups.map((g) => {
      const list = defs.filter((d) => d.group === g); if (!list.length) return '';
      return `<div class="fk-group" role="group" aria-label="${title[g]}"><div class="fk-h">${title[g]}</div>${list.map((d) =>
        `<button type="button" class="fk" data-fk="${esc(d.id)}" aria-keyshortcuts="${esc(d.key.replace('Esc', 'Escape'))}"><kbd>${esc(K.display(d.key))}</kbd><span>${esc(label(d, ctx))}</span></button>`).join('')}</div>`;
    }).join('') + hints + (ctx === 'gateway' && !UI.parseHash().params.m ? '' : `<div class="fk-foot"><button type="button" class="fk" data-fk="back"><kbd>Esc</kbd><span>${ctx === 'gateway' ? 'Back to Gateway' : 'Back'}</span></button></div>`);
  }
  K.renderPanel = renderPanel;
  document.addEventListener('click', (e) => {
    const t = e.target.closest && e.target.closest('[data-fkpanel]'); if (!t) return;
    OB.prefs.set('fkeys', t.dataset.fkpanel === 'show'); UI.applyFkeys();
  });
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('.fkeys [data-fk]'); if (!b) return;
    const d = K.list.find((x) => x.id === b.dataset.fk && applies(x, K.context())) || K.list.find((x) => x.id === b.dataset.fk);
    if (d) K.run(d);
  });

  /* ---------- command bar menus (Alt+letter) ---------- */
  const route = (h) => () => UI.go(h);
  const MENUS = {
    K: { label: 'Company', items: () => [
      ['Company information', route('#/settings?tab=company')],
      ['Features…', () => UI.openFeatures(), 'F11'],
      ['Configure…', () => UI.openConfigure(), 'F12'],
      ['Security', route('#/settings?tab=security')],
      UI.book && UI.book.security ? ['Lock company', () => UI.confirmLeave(() => UI.lock('manual'))] : null,
      ['Switch company', () => UI.confirmLeave(UI.closeCompany), 'F3']] },
    Y: { label: 'Data', items: () => [
      ['Backup and restore', route('#/settings?tab=backup')],
      ['Data integrity check', route('#/settings?tab=integrity')],
      ['Audit log', route('#/settings?tab=audit')],
      ['App and storage', route('#/settings?tab=storage')]] },
    O: { label: 'Import', items: () => [
      ['QuickBooks company files (migrate)', route('#/migrate')],
      ['Bank feed', route('#/bankfeed')], ['Bank transactions file', route('#/bankfeed?import=1')],
      ['Bank statement (PDF)', route('#/pdfimport')],
      ['Accounts, customers, vendors (CSV)', route('#/settings?tab=data')]] },
    X: { label: 'Export', items: () => [
      document.querySelector('#main [data-x=xlsx]') ? ['This screen to Excel', () => pressIn('[data-x=xlsx]')] : null,
      document.querySelector('#main [data-x=csv]') ? ['This screen to CSV', () => pressIn('[data-x=csv]')] : null,
      ['Books to Excel / CSV', route('#/settings?tab=data')],
      ['Backup file (JSON)', route('#/settings?tab=backup')]] },
    P: { label: 'Print', items: () => {
      const r = UI.parseHash(), t = r.name === 'txn' && UI.book && UI.book.txById[r.id];
      return [
        t && t.status === 'posted' && ['invoice', 'salesReceipt', 'creditMemo'].indexOf(t.type) >= 0 ? ['Print this ' + UI.typeLabel(t.type).toLowerCase(), route('#/print/' + t.id)] : null,
        ['Print this screen / PDF', () => UI.printReport() || pressIn('[data-print]') || pressIn('#st-print') || window.print()]];
    } }
  };
  K.MENUS = MENUS;
  function closeMenus() { document.querySelectorAll('.cmd-menu').forEach((m) => { m.hidden = true; const b = document.querySelector(`.cmdbar [data-menu="${m.dataset.for}"]`); if (b) b.setAttribute('aria-expanded', 'false'); }); }
  function openMenu(L) {
    if (!UI.book) return;
    const btn = document.querySelector(`.cmdbar [data-menu="${L}"]`);
    let m = document.querySelector(`.cmd-menu[data-for="${L}"]`);
    if (m && !m.hidden) { closeMenus(); return; }
    closeMenus();
    if (!m) { m = document.createElement('div'); m.className = 'cmd-menu'; m.dataset.for = L; m.setAttribute('role', 'menu'); document.body.appendChild(m); }
    const items = MENUS[L].items().filter(Boolean);
    m.setAttribute('aria-label', MENUS[L].label);
    m.innerHTML = items.map((it, i) => `<button type="button" role="menuitem" data-i="${i}"><span>${esc(it[0])}</span>${it[2] ? `<kbd>${esc(it[2])}</kbd>` : ''}</button>`).join('');
    m._items = items;
    const r = (btn || document.querySelector('.cmdbar') || document.body).getBoundingClientRect();
    m.style.left = Math.max(6, Math.min(r.left, innerWidth - 270)) + 'px'; m.style.top = (r.bottom + 2) + 'px';
    m._prev = document.activeElement && !(document.activeElement.closest && document.activeElement.closest('.cmdbar')) ? document.activeElement : null;   // Esc goes back here, not to the hidden bar
    m.hidden = false; if (btn) btn.setAttribute('aria-expanded', 'true');
    const first = m.querySelector('button'); if (first) first.focus();
  }
  K.openMenu = openMenu; K.closeMenus = closeMenus;
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('.cmdbar [data-menu]');
    if (b) { e.preventDefault(); if (b.dataset.menu === 'G') { closeMenus(); UI.openPalette(); } else if (b.dataset.menu === 'H') { closeMenus(); UI.showShortcuts(); } else openMenu(b.dataset.menu); return; }
    const it = e.target.closest && e.target.closest('.cmd-menu [data-i]');
    if (it) { const m = it.closest('.cmd-menu'), fn = m._items[+it.dataset.i][1]; closeMenus(); fn(); return; }
    if (!(e.target.closest && e.target.closest('.cmd-menu'))) closeMenus();
  });
  document.addEventListener('keydown', (e) => {
    const m = e.target.closest && e.target.closest('.cmd-menu'); if (!m) return;
    const items = [...m.querySelectorAll('button')], i = items.indexOf(e.target);
    if (e.key === 'ArrowDown') { e.preventDefault(); (items[i + 1] || items[0]).focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); (items[i - 1] || items[items.length - 1]).focus(); }
    else if (e.key === 'Home') { e.preventDefault(); items[0].focus(); }
    else if (e.key === 'End') { e.preventDefault(); items[items.length - 1].focus(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); const back = m._prev; closeMenus(); if (back && back.isConnected && back.focus) back.focus(); }
    else if (e.key === 'Tab') closeMenus();
  });
  window.addEventListener('hashchange', closeMenus);

  /* ---------- shortcut reference (F1 / ?) generated from the registry ---------- */
  K.reference = () => {
    const ctx = K.context(), here = new Set(K.active(ctx).map((d) => d.id));
    const groups = {};
    K.list.forEach((d) => { (groups[d.group] = groups[d.group] || []).push(d); });
    return Object.keys(groups).map((g) => `<section><h3>${esc(g)}</h3><dl>${groups[g].map((d) =>
      `<dt><kbd>${esc(K.display(d.key))}</kbd></dt><dd class="${here.has(d.id) ? '' : 'muted'}">${esc(label(d, ctx) || '')}${here.has(d.id) ? '' : ' <span class="small">(not on this screen)</span>'}</dd>`).join('')}</dl></section>`).join('');
  };

  /* ---------- re-render hooks ---------- */
  function hook() {
    if (UI.render && !UI.render.__keys) {
      const orig = UI.render;
      const wrapped = function () { const x = orig.apply(this, arguments); try { K.afterRender(); } catch (err) { console.error(err); } return x; };
      wrapped.__keys = true; Object.keys(orig).forEach((p) => { wrapped[p] = orig[p]; });
      UI.render = wrapped;
    }
  }
  hook();
  // the main scroll position, remembered per screen for Esc / Back
  const mainEl = document.getElementById('main');
  if (mainEl) mainEl.addEventListener('scroll', () => { if (location.hash) (mem[location.hash] = mem[location.hash] || {}).scroll = mainEl.scrollTop; }, { passive: true });
})();
