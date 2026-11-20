/* OfflineBooks US — Multi-window (MDI) manager.
   Adds top tabs + bottom taskbar with layout toggle and session persistence.
   Each "window" is a route (hash) with a cached title and icon. Opening a sidebar
   link focuses an existing tab if one exists, else creates a new tab.
   Middle-click / Ctrl-click opens in a background tab.
   Keyboard: Ctrl+Tab / Ctrl+Shift+Tab cycles; Ctrl+W closes; Ctrl+T opens dashboard tab.
*/
(function () {
  'use strict';
  const UI = OB.ui;
  const PREFS_KEY_LAYOUT = 'windowLayout';     // 'both' | 'tabs' | 'taskbar' | 'off'
  const STORE_KEY = 'OfflineBooksUS.windows.v1';

  const WM = OB.windows = {
    list: [],              // [{id, hash, title, iconKey, pinned}]
    activeId: null,
    layout: 'both',
    _bgOpen: false,        // next navigation opens in background
  };

  /* ---------- Icon library (reused from sidebar SVG set, keyed by route name) ---------- */
  const ICONS = {
    gateway: '<rect x="3.5" y="3.5" width="13" height="13" rx="1.5"/><path d="M7 7.5h6M7 10h6M7 12.5h4"/>',
    dashboard: '<rect x="3" y="3" width="6" height="6" rx="1.5"/><rect x="11" y="3" width="6" height="4" rx="1.5"/><rect x="11" y="9" width="6" height="8" rx="1.5"/><rect x="3" y="11" width="6" height="6" rx="1.5"/>',
    snapshot: '<path d="M3 16.5h14"/><path d="M5.5 13.5V9M10 13.5V5M14.5 13.5v-6"/>',
    accounts: '<path d="M3 8l7-4.5L17 8"/><path d="M4.5 8.5v6M8 8.5v6M12 8.5v6M15.5 8.5v6M3 16.5h14"/>',
    pdfimport: '<path d="M11.5 2.5H6a1.5 1.5 0 0 0-1.5 1.5v12A1.5 1.5 0 0 0 6 17.5h8a1.5 1.5 0 0 0 1.5-1.5V6.5z"/><path d="M11.5 2.5v4h4M7.5 11h5M7.5 14h3"/>',
    import: '<path d="M10 3v9M6.5 8.5L10 12l3.5-3.5"/><path d="M3.5 13.5v2a1.5 1.5 0 0 0 1.5 1.5h10a1.5 1.5 0 0 0 1.5-1.5v-2"/>',
    reconcile: '<circle cx="10" cy="10" r="7"/><path d="M6.8 10.2l2.2 2.2 4.2-4.6"/>',
    rules: '<path d="M3.5 5.5h13M3.5 10h9M3.5 14.5h5"/><circle cx="15" cy="13.5" r="2.5"/>',
    customers: '<circle cx="10" cy="7" r="3.2"/><path d="M3.8 16.5c.9-3 3.3-4.6 6.2-4.6s5.3 1.6 6.2 4.6"/>',
    vendors: '<path d="M3 8.5l1.2-4.5h11.6L17 8.5"/><path d="M4.5 10.5v6h11v-6"/>',
    transactions: '<path d="M4 6h10.5M11.5 3l3 3-3 3"/><path d="M16 14H5.5M8.5 11l-3 3 3 3"/>',
    recurring: '<path d="M15.5 8A6 6 0 0 0 4.7 6.2M4.5 12a6 6 0 0 0 10.8 1.8"/><path d="M4.5 3v3.5H8M15.5 17v-3.5H12"/>',
    reports: '<path d="M10 3a7 7 0 1 0 7 7h-7z"/><path d="M12.5 2.8A5 5 0 0 1 17.2 7.5H12.5z"/>',
    settings: '<g transform="scale(.8333)" stroke-width="1.9" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></g>',
    txn: '<rect x="4" y="3" width="12" height="14" rx="2"/><path d="M7 7h6M7 10h6M7 13h4"/>',
    default: '<rect x="3.5" y="3.5" width="13" height="13" rx="2"/>'
  };
  const iconSvg = (key) => {
    const body = ICONS[key] || ICONS.default;
    return `<svg class="wi" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
  };
  const iconKeyFor = (route) => ICONS[route] ? route : (route === 'txn' ? 'txn' : 'default');

  /* ---------- Persistence ---------- */
  const load = () => {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return null;
      const d = JSON.parse(raw);
      return d && Array.isArray(d.list) ? d : null;
    } catch { return null; }
  };
  const save = () => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ list: WM.list, activeId: WM.activeId }));
    } catch {}
  };

  /* ---------- Helpers ---------- */
  const makeId = () => 'w' + Math.random().toString(36).slice(2, 9);
  const hashOf = (w) => w.hash || '#/gateway';
  // one tab per page: #/settings?tab=backup reuses the Settings tab, #/gateway?m=vouchers the Gateway tab
  // (only one-level pages: #/txn/new?type=bill never reuses a new-invoice tab)
  const basePath = (h) => { const p = String(h || '').split('?')[0]; return /^#\/[^/]+$/.test(p) ? p : String(h || ''); };
  const findByHash = (hash) => WM.list.find((w) => w.hash === hash) || WM.list.find((w) => basePath(w.hash) === basePath(hash));
  const MAX_RESTORED = 10;   // tabs brought back after a reload: the Gateway, the active tab and the most recent others
  const findById = (id) => WM.list.find((w) => w.id === id);
  /* Unsaved-changes protection (BUG-002): a window action that leaves or re-renders the
     active view goes through UI.confirmLeave first, like any other navigation. Windows are
     routes, not live documents, so switching away would otherwise discard typed entries. */
  const leaving = (fn) => (UI.confirmLeave ? UI.confirmLeave(fn) : fn());

  // Titles come from route name; are later refreshed from <h1> after render.
  const titleFromRoute = (routeName, id) => {
    const map = {
      gateway: 'Gateway', dashboard: 'Dashboard', snapshot: 'Company Snapshot',
      accounts: 'Chart of Accounts', pdfimport: 'Import Statement',
      import: 'Import Bank CSV', reconcile: 'Reconcile',
      rules: 'Bank Rules', customers: 'Customers', vendors: 'Vendors',
      transactions: 'Transactions', recurring: 'Recurring', reports: 'Reports',
      settings: 'Settings', register: 'Register', companies: 'Companies',
      txn: id ? 'Transaction' : 'New Transaction', contact: 'Contact'
    };
    return map[routeName] || (routeName.charAt(0).toUpperCase() + routeName.slice(1));
  };

  /* ---------- Core open/focus/close ---------- */
  WM.openOrFocus = (hash, opts) => {
    opts = opts || {};
    hash = hash || '#/gateway';
    let w = findByHash(hash);
    const r = UI.parseHash.call ? parseHashLocal(hash) : parseHashLocal(hash);
    if (w) w.hash = hash;
    if (!w) {
      w = {
        id: makeId(),
        hash,
        title: titleFromRoute(r.name, r.id),
        iconKey: iconKeyFor(r.name),
        pinned: r.name === 'gateway'
      };
      WM.list.push(w);
    }
    if (!opts.background) {
      WM.activeId = w.id;
      if (location.hash !== hash) {
        UI._allowNav = true;
        location.hash = hash;
      } else {
        UI.render();
      }
    }
    renderChrome();
    save();
    return w;
  };

  WM.close = (id) => {
    const i = WM.list.findIndex((w) => w.id === id);
    if (i < 0) return;
    const w = WM.list[i];
    if (w.pinned && WM.list.length > 1 && WM.activeId !== id) { renderChrome(); return; }
    // closing a background window doesn't touch the active view; closing the active (or last) one does
    if (WM.activeId === id || WM.list.length === 1) return leaving(() => closeNow(id));
    return closeNow(id);
  };
  const closeNow = (id) => {
    const i = WM.list.findIndex((w) => w.id === id);
    if (i < 0) return;
    // Prevent closing last window
    if (WM.list.length === 1) {
      // Keep dashboard as the base
      WM.list[0] = { id: makeId(), hash: '#/gateway', title: 'Gateway', iconKey: 'gateway', pinned: true };
      WM.activeId = WM.list[0].id;
      UI._allowNav = true;
      if (location.hash !== '#/gateway') location.hash = '#/gateway'; else UI.render();
      renderChrome(); save(); return;
    }
    WM.list.splice(i, 1);
    if (WM.activeId === id) {
      const next = WM.list[Math.max(0, i - 1)] || WM.list[0];
      WM.activeId = next.id;
      UI._allowNav = true;
      if (location.hash !== next.hash) location.hash = next.hash; else UI.render();
    }
    renderChrome();
    save();
  };

  WM.closeOthers = (id) => {
    if (!findById(id)) return;
    return leaving(() => closeOthersNow(id));
  };
  const closeOthersNow = (id) => {
    const keep = findById(id);
    if (!keep) return;
    WM.list = WM.list.filter((w) => w.id === id || w.pinned);
    if (!WM.list.includes(keep)) WM.list.push(keep);
    WM.activeId = id;
    UI._allowNav = true;
    if (location.hash !== keep.hash) location.hash = keep.hash; else UI.render();
    renderChrome(); save();
  };

  WM.closeAll = () => leaving(() => {
    WM.list = [{ id: makeId(), hash: '#/gateway', title: 'Gateway', iconKey: 'gateway', pinned: true }];
    WM.activeId = WM.list[0].id;
    UI._allowNav = true;
    if (location.hash !== '#/gateway') location.hash = '#/gateway'; else UI.render();
    renderChrome(); save();
  });

  WM.cycle = (dir) => {
    if (WM.list.length < 2) return;
    return leaving(() => cycleNow(dir));
  };
  const cycleNow = (dir) => {
    if (WM.list.length < 2) return;
    const i = WM.list.findIndex((w) => w.id === WM.activeId);
    const n = (i + dir + WM.list.length) % WM.list.length;
    const next = WM.list[n];
    WM.activeId = next.id;
    UI._allowNav = true;
    if (location.hash !== next.hash) location.hash = next.hash; else UI.render();
    renderChrome();
    save();
  };

  WM.focus = (id) => {
    if (!findById(id)) return;
    return leaving(() => focusNow(id));
  };
  const focusNow = (id) => {
    const w = findById(id); if (!w) return;
    WM.activeId = id;
    UI._allowNav = true;
    if (location.hash !== w.hash) location.hash = w.hash; else UI.render();
    renderChrome(); save();
  };

  /** Open a fresh Dashboard window (new-tab button, Ctrl+T where the browser passes it through). */
  WM.newTab = () => leaving(() => {
    const fresh = { id: makeId(), hash: '#/gateway', title: 'Gateway', iconKey: 'gateway', pinned: false };
    WM.list.push(fresh); WM.activeId = fresh.id;
    UI._allowNav = true;
    if (location.hash !== '#/gateway') location.hash = '#/gateway'; else UI.render();
    renderChrome(); save();
  });

  /* ---------- Layout mode ---------- */
  WM.setLayout = (mode) => {
    if (!['both', 'tabs', 'taskbar', 'off'].includes(mode)) mode = 'both';
    WM.layout = mode;
    document.documentElement.dataset.windowLayout = mode;
    OB.prefs.set(PREFS_KEY_LAYOUT, mode);
    renderChrome();
  };

  /* ---------- UI chrome rendering ---------- */
  function renderChrome() {
    const tabs = document.getElementById('window-tabs');
    const bar = document.getElementById('window-taskbar');
    if (!tabs || !bar) return;

    const html = WM.list.map((w) => {
      const active = w.id === WM.activeId ? ' active' : '';
      const pinned = w.pinned ? ' pinned' : '';
      const closeBtn = w.pinned ? '' :
        `<button class="win-close" data-close="${w.id}" aria-label="Close ${UI.esc(w.title)}" title="Close window">×</button>`;
      return `<button class="win-tab${active}${pinned}" data-focus="${w.id}" data-ctx="${w.id}" title="${UI.esc(w.title)}">
        <span class="win-icon">${iconSvg(w.iconKey)}</span>
        <span class="win-title">${UI.esc(w.title)}</span>
        ${closeBtn}
      </button>`;
    }).join('');

    const home = WM.list.find((w) => w.hash === '#/gateway') || WM.list.find((w) => w.pinned), cur = WM.list.find((w) => w.id === WM.activeId);
    const atHome = !cur || (home && cur.id === home.id);
    const ctl = atHome ? '' : `<span class="win-ctl" role="group" aria-label="Window">`
      + (home ? `<button class="win-ctl-b" data-focus="${home.id}" title="Go to the Gateway (this window stays open)" data-testid="win-home"><svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true"><path d="M3.5 9.5 10 4l6.5 5.5M5.5 8v8h9V8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg><span>Home</span></button>` : '')
      + (cur && !cur.pinned ? `<button class="win-ctl-b" data-close="${cur.id}" title="Close this window (Esc)" data-testid="win-close-active"><svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true"><path d="M5.5 5.5l9 9M14.5 5.5l-9 9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg><span>Close</span></button>` : '')
      + '</span>';
    tabs.innerHTML = html + `<button class="win-newtab" id="win-newtab" title="New window" aria-label="New window">+</button>` + ctl;
    bar.innerHTML = `<div class="taskbar-items">${WM.list.map((w) => {
      const active = w.id === WM.activeId ? ' active' : '';
      return `<button class="task-item${active}" data-focus="${w.id}" data-ctx="${w.id}" title="${UI.esc(w.title)}">
        <span class="win-icon">${iconSvg(w.iconKey)}</span>
        <span class="win-title">${UI.esc(w.title)}</span>
      </button>`;
    }).join('')}</div>
    <div class="taskbar-tools">
      <button class="task-tool" id="win-layout-toggle" title="Window chrome layout" aria-label="Window layout" data-testid="win-layout-toggle">
        <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="2.5" y="3.5" width="15" height="4" rx="1"/><rect x="2.5" y="12.5" width="15" height="4" rx="1"/></svg>
        <span class="layout-label"></span>
      </button>
    </div>`;
    updateLayoutLabel();
  }

  function updateLayoutLabel() {
    const el = document.querySelector('.layout-label');
    if (!el) return;
    const names = { both: 'Tabs + Taskbar', tabs: 'Tabs only', taskbar: 'Taskbar only', off: 'Hidden' };
    el.textContent = names[WM.layout] || 'Both';
  }

  function layoutMenu(anchor) {
    const opts = [
      { v: 'both', l: 'Tabs + Taskbar' },
      { v: 'tabs', l: 'Tabs only' },
      { v: 'taskbar', l: 'Taskbar only' },
      { v: 'off', l: 'Hide window chrome' }
    ];
    const existing = document.getElementById('layout-popover'); if (existing) { existing.remove(); return; }
    const pop = document.createElement('div');
    pop.id = 'layout-popover';
    pop.className = 'layout-popover';
    pop.innerHTML = opts.map((o) => `<button role="menuitem" data-v="${o.v}" ${o.v === WM.layout ? 'aria-current="true"' : ''} data-testid="layout-opt-${o.v}">${o.l}</button>`).join('');
    document.body.appendChild(pop);
    const r = anchor.getBoundingClientRect();
    pop.style.bottom = (window.innerHeight - r.top + 6) + 'px';
    pop.style.right = (window.innerWidth - r.right) + 'px';
    const onDoc = (e) => { if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener('mousedown', onDoc, true); } };
    document.addEventListener('mousedown', onDoc, true);
    pop.addEventListener('click', (e) => {
      const b = e.target.closest('[data-v]'); if (!b) return;
      WM.setLayout(b.dataset.v); pop.remove();
    });
  }

  function contextMenu(x, y, winId) {
    document.querySelectorAll('.win-context').forEach((n) => n.remove());
    const w = findById(winId); if (!w) return;
    const items = [
      { l: 'Close', k: 'close', disabled: !!w.pinned },
      { l: 'Close others', k: 'closeOthers' },
      { l: 'Close all', k: 'closeAll' }
    ];
    const m = document.createElement('div');
    m.className = 'win-context';
    m.innerHTML = items.map((it) => `<button data-k="${it.k}" ${it.disabled ? 'disabled' : ''}>${it.l}</button>`).join('');
    document.body.appendChild(m);
    const rect = m.getBoundingClientRect();
    const mx = Math.min(x, window.innerWidth - rect.width - 6);
    const my = Math.min(y, window.innerHeight - rect.height - 6);
    m.style.left = mx + 'px'; m.style.top = my + 'px';
    const close = () => { m.remove(); document.removeEventListener('mousedown', onDoc, true); };
    const onDoc = (e) => { if (!m.contains(e.target)) close(); };
    document.addEventListener('mousedown', onDoc, true);
    m.addEventListener('click', (e) => {
      const b = e.target.closest('[data-k]'); if (!b) return;
      if (b.dataset.k === 'close') WM.close(winId);
      else if (b.dataset.k === 'closeOthers') WM.closeOthers(winId);
      else if (b.dataset.k === 'closeAll') WM.closeAll();
      close();
    });
  }

  function parseHashLocal(hash) {
    const h = String(hash || '').replace(/^#\/?/, '');
    const [path, qs] = h.split('?');
    const params = {};
    (qs || '').split('&').filter(Boolean).forEach((kv) => { const [k, v] = kv.split('='); params[decodeURIComponent(k)] = decodeURIComponent(v || ''); });
    const parts = (path || '').split('/').filter(Boolean);
    return { name: parts[0] || 'dashboard', id: parts[1] ? decodeURIComponent(parts[1]) : '' };
  }

  /* ---------- Hooks: sidebar link clicks, hashchange ---------- */
  function interceptLinkClick(e) {
    const a = e.target.closest && e.target.closest('a[href^="#/"]');
    if (!a) return;
    const href = a.getAttribute('href');
    if (!href || href === '#' || href === '#main') return;
    // Middle click or Ctrl/Meta/Shift = open in background tab
    const mid = e.button === 1;
    const bg = e.ctrlKey || e.metaKey || e.shiftKey || mid;
    if (mid) { e.preventDefault(); }
    if (bg) {
      e.preventDefault();
      WM.openOrFocus(href, { background: true });
      return;
    }
    // Otherwise: don't preventDefault — let the hash change happen, and we'll react in hashchange.
  }

  function syncFromHash() {
    const hash = location.hash && location.hash !== '#/' ? location.hash : '#/gateway';
    let w = findByHash(hash);
    if (w) w.hash = hash;
    if (!w) {
      // Opened from sidebar / direct nav — replace the active tab's hash (so sidebar nav doesn't flood tabs)
      // unless the active tab is pinned, then open a new tab.
      const active = findById(WM.activeId);
      const r = parseHashLocal(hash);
      if (active && !active.pinned) {
        active.hash = hash;
        active.title = titleFromRoute(r.name, r.id);
        active.iconKey = iconKeyFor(r.name);
        w = active;
      } else {
        w = { id: makeId(), hash, title: titleFromRoute(r.name, r.id), iconKey: iconKeyFor(r.name), pinned: false };
        WM.list.push(w);
        WM.activeId = w.id;
      }
    } else {
      WM.activeId = w.id;
    }
    renderChrome();
    save();
  }

  /* ---------- Title sync after render ---------- */
  function syncTitle() {
    const w = findById(WM.activeId);
    if (!w) return;
    const h1 = document.querySelector('#main h1');
    if (h1 && h1.textContent.trim()) {
      const t = h1.textContent.trim();
      if (w.title !== t) { w.title = t; renderChrome(); save(); }
    }
  }
  // Wrap UI.render to sync title afterwards (uses MutationObserver as fallback for async pages).
  const _origRender = UI.render;
  UI.render = function () {
    const r = _origRender.apply(this, arguments);
    setTimeout(syncTitle, 0);
    setTimeout(syncTitle, 300);
    return r;
  };

  /* ---------- Keyboard shortcuts ---------- */
  function onKeydown(e) {
    // Ctrl+Tab / Ctrl+Shift+Tab
    if (e.ctrlKey && !e.altKey && e.key === 'Tab') {
      e.preventDefault();
      WM.cycle(e.shiftKey ? -1 : 1);
      return;
    }
    // Ctrl+W close
    if ((e.ctrlKey || e.metaKey) && (e.key === 'w' || e.key === 'W')) {
      e.preventDefault();
      if (WM.activeId) WM.close(WM.activeId);
      return;
    }
    // Ctrl+T new tab (dashboard)
    if ((e.ctrlKey || e.metaKey) && (e.key === 't' || e.key === 'T') && !e.shiftKey) {
      e.preventDefault();
      WM.newTab();
    }
  }

  /* ---------- Boot ---------- */
  WM.init = () => {
    // Install chrome in DOM
    const content = document.querySelector('.content');
    if (!content) return;
    const topbar = content.querySelector('.topbar');
    const tabs = document.createElement('div');
    tabs.id = 'window-tabs';
    tabs.className = 'window-tabs';
    tabs.setAttribute('role', 'navigation'); tabs.setAttribute('aria-label', 'Open windows');  // A11Y-001: a landmark may hold tabs and their close buttons
    tabs.setAttribute('data-testid', 'window-tabs');
    topbar.insertAdjacentElement('afterend', tabs);

    const bar = document.createElement('div');
    bar.id = 'window-taskbar';
    bar.className = 'window-taskbar';
    bar.setAttribute('data-testid', 'window-taskbar');
    document.body.appendChild(bar);

    // Restore saved layout
    const saved = OB.prefs.get(PREFS_KEY_LAYOUT) || 'tabs';   // 1.36: the bottom taskbar repeated the tabs; it stays one click away
    WM.setLayout(saved);

    // Restore window list
    const data = load();
    if (data && data.list.length) {
      WM.list = data.list.map((w) => ({ ...w, id: w.id || makeId() }));
      // drop duplicates of one page (older versions opened a new tab for each Settings or Gateway section)
      WM.list = WM.list.filter((w, i, a) => a.findIndex((x) => basePath(x.hash) === basePath(w.hash)) === i || w.id === data.activeId);
      if (WM.list.length > MAX_RESTORED) WM.list = WM.list.filter((w, i, a) => w.pinned || w.id === data.activeId || i >= a.length - (MAX_RESTORED - 2));
      WM.activeId = data.activeId && findById(data.activeId) ? data.activeId : WM.list[0].id;
      // ensure dashboard pinned entry exists first
      if (!WM.list.some((w) => basePath(w.hash) === '#/gateway' && w.pinned)) {
        WM.list.unshift({ id: makeId(), hash: '#/gateway', title: 'Gateway', iconKey: 'gateway', pinned: true });
      }
    } else {
      WM.list = [{ id: makeId(), hash: '#/gateway', title: 'Gateway', iconKey: 'gateway', pinned: true }];
      WM.activeId = WM.list[0].id;
    }
    renderChrome();

    // Sidebar/content link clicks
    document.addEventListener('click', interceptLinkClick, true);
    document.addEventListener('auxclick', interceptLinkClick, true); // middle-click

    // Tab/taskbar interactions
    const handleBarClick = (e) => {
      const closeBtn = e.target.closest('[data-close]');
      if (closeBtn) { e.preventDefault(); e.stopPropagation(); WM.close(closeBtn.dataset.close); return; }
      const focusBtn = e.target.closest('[data-focus]');
      if (focusBtn) { e.preventDefault(); WM.focus(focusBtn.dataset.focus); return; }
      const newBtn = e.target.closest('#win-newtab');
      if (newBtn) {
        e.preventDefault();
        WM.newTab(); return;
      }
      const toggle = e.target.closest('#win-layout-toggle');
      if (toggle) { e.preventDefault(); layoutMenu(toggle); }
    };
    tabs.addEventListener('click', handleBarClick);
    bar.addEventListener('click', handleBarClick);

    // Middle click on tab closes it
    tabs.addEventListener('auxclick', (e) => {
      if (e.button !== 1) return;
      const t = e.target.closest('[data-focus]');
      if (t) { e.preventDefault(); WM.close(t.dataset.focus); }
    });

    // Right-click context menu on tabs or taskbar
    const onCtx = (e) => {
      const t = e.target.closest('[data-ctx]');
      if (!t) return;
      e.preventDefault();
      contextMenu(e.clientX, e.clientY, t.dataset.ctx);
    };
    tabs.addEventListener('contextmenu', onCtx);
    bar.addEventListener('contextmenu', onCtx);

    // Hashchange sync (also triggered by UI.go)
    window.addEventListener('hashchange', syncFromHash);

    // Keyboard
    document.addEventListener('keydown', onKeydown);

    // Initial sync with current hash
    syncFromHash();
  };
})();
