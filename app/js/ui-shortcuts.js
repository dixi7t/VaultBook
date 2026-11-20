/* OfflineBooks US — keyboard shortcuts: "?" help panel and "G then key" go-to sequences. */
(function () {
  'use strict';
  const UI = OB.ui;
  const GO = {
    h: ['#/gateway', 'Gateway (home)'], d: ['#/dashboard', 'Dashboard'], s: ['#/snapshot', 'Company Snapshot'], a: ['#/accounts', 'Chart of accounts'],
    p: ['#/pdfimport', 'Import bank statement (PDF)'], u: ['#/bankfeed', 'Bank feed'], o: ['#/reconcile', 'Reconcile'],
    c: ['#/customers', 'Customers'], i: ['#/transactions?type=invoice', 'Invoices'], v: ['#/vendors', 'Vendors'],
    b: ['#/transactions?type=bill', 'Bills'], t: ['#/transactions', 'Transactions'], e: ['#/recurring', 'Recurring'],
    r: ['#/reports', 'Reports'], x: ['#/settings', 'Settings and backup'], l: ['#/classes', 'Classes'], g: ['#/budgets', 'Budgets'], n: ['#/1099', '1099 setup'], k: ['#/builder', 'Custom report builder']
  };
  const MOD = UI.isMac ? '⌘' : 'Ctrl';
  const GENERAL = [[MOD + ' K', 'Search, create anything, open any report, calculate (also Alt G)'], ['Alt N', 'Create a transaction'], [MOD + ' \\', 'Show or hide the sidebar'], ['?', 'Show this panel'], ['Esc', 'Close a dialog or the search']];
  const k = (s) => s.split(' ').map((x) => `<kbd>${OB.util.esc(x)}</kbd>`).join(' ');

  UI.showShortcuts = () => {
    if (document.querySelector('.shortcuts-panel')) return;
    const here = UI.currentMnemonics ? UI.currentMnemonics() : [];
    const html = `<div class="shortcuts-panel" data-testid="shortcuts-panel">${UI.keys ? `<div class="sp-fkeys"><p class="muted small">Function keys and Alt menus change with the screen. Grey entries don't apply here. On a Mac, hold Fn for F1–F12 if your keyboard uses them for media.</p>${UI.keys.reference()}</div>` : ''}<section><h3>General</h3><dl>${GENERAL.map(([a, b]) => `<dt>${k(a)}</dt><dd>${b}</dd>`).join('')}</dl></section>
      <section><h3>Buttons — ${MOD} + the underlined letter</h3><p class="muted small">Every button with an underlined letter has a shortcut: hold ${MOD} and press that letter. Letters are unique on each screen and in each dialog.</p>
        <dl>${here.length ? here.map((x) => `<dt>${k(MOD + ' ' + x.key.toUpperCase())}</dt><dd>${OB.util.esc(x.label)}</dd>`).join('') : '<dd class="muted">No button shortcuts on this screen.</dd>'}</dl></section>
      <section><h3>Go to — press G, then</h3><dl>${Object.keys(GO).map((x) => `<dt>${k('G ' + x.toUpperCase())}</dt><dd>${GO[x][1]}</dd>`).join('')}</dl></section></div>`;
    UI.modal({ title: 'Keyboard shortcuts', html, wide: true, actions: [{ label: 'Close', value: null }] });
  };

  const typing = (t) => t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  let pending = 0;
  document.addEventListener('keydown', (e) => {
    if (!UI.book || e.ctrlKey || e.metaKey || e.altKey || typing(e.target) || document.querySelector('.modal-backdrop, .palette-backdrop')) return;
    if (e.key === '?') { e.preventDefault(); UI.showShortcuts(); return; }
    const key = e.key.toLowerCase();
    if (pending && Date.now() - pending < 1200 && GO[key]) { e.preventDefault(); pending = 0; UI.go(GO[key][0]); return; }
    pending = key === 'g' ? Date.now() : 0;
  });
  document.addEventListener('DOMContentLoaded', () => {});
  const btn = document.getElementById('btn-shortcuts');
  if (btn) btn.addEventListener('click', () => UI.showShortcuts());
})();
