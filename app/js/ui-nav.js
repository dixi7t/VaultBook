/* VaultBook — side menu and top bar patterns (1.26): bookmarks (Ctrl+D), the gear menu (settings, lists,
 * tools, your company) and the compact side menu (icons only, menus open beside it). Display only: nothing
 * here writes accounting data. Bookmarks and the compact choice are browser preferences (OB.prefs);
 * bookmarks are kept per company.
 */
(function () {
  'use strict';
  const OB = window.OB, UI = OB.ui, U = OB.util, esc = U.esc;
  const svg = (d, n) => `<svg viewBox="0 0 20 20" width="${n || 18}" height="${n || 18}" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const STAR = '<path d="M10 2.8l2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5L2.8 8.1l5-.7z"/>';

  /* ---------------- bookmarks ---------------- */
  const bmKey = () => 'bookmarks:' + ((UI.book && UI.book.company && UI.book.company.id) || '');
  const bmList = () => (OB.prefs.get(bmKey()) || []).filter((x) => x && typeof x.hash === 'string' && x.hash.indexOf('#/') === 0);
  const bmSave = (l) => { OB.prefs.set(bmKey(), l.slice(0, 30)); paint(); };
  const here = () => (location.hash && location.hash.indexOf('#/') === 0 ? location.hash : '#/gateway');
  const pageName = () => {
    const h = document.querySelector('#main h1');
    const t = (h && h.textContent.trim()) || (document.querySelector('#main .page-head h2') || {}).textContent || '';
    return (t || here().slice(2)).replace(/\s+/g, ' ').trim().slice(0, 60);
  };
  UI.bookmarks = bmList;
  UI.toggleBookmark = () => {
    if (!UI.book) return;
    const l = bmList(), h = here(), i = l.findIndex((x) => x.hash === h);
    if (i >= 0) { l.splice(i, 1); bmSave(l); UI.toast('Bookmark removed.'); return; }
    if (l.length >= 30) { UI.toast('You have 30 bookmarks. Remove one first.', 'error'); return; }
    const label = pageName(); l.push({ hash: h, label }); bmSave(l); UI.toast('Bookmarked: ' + label + '. It is in the side menu.');
  };
  UI.editBookmarks = () => {
    const l = bmList();
    if (!l.length) { UI.toast('No bookmarks yet. Press Ctrl+D on any page to add one.'); return Promise.resolve(); }
    const row = (x) => `<li class="st-bme" data-hash="${esc(x.hash)}"><input aria-label="Bookmark name" value="${esc(x.label)}" maxlength="60">
      <button type="button" class="btn small ghost" data-mv="-1" aria-label="Move up">↑</button><button type="button" class="btn small ghost" data-mv="1" aria-label="Move down">↓</button>
      <button type="button" class="btn small ghost" data-rm aria-label="Remove">Remove</button></li>`;
    return UI.modal({ title: 'Edit bookmarks', html: `<p class="muted small">Rename, reorder or remove. Bookmarks are kept for this company in this browser.</p><ol class="st-bmlist" id="st-bmlist" data-testid="bm-edit">${l.map(row).join('')}</ol>`,
      onMount: (m) => m.querySelector('#st-bmlist').addEventListener('click', (e) => {
        const li = e.target.closest('li'); if (!li) return;
        if (e.target.closest('[data-rm]')) { li.remove(); return; }
        const mv = e.target.closest('[data-mv]'); if (!mv) return;
        const to = +mv.dataset.mv < 0 ? li.previousElementSibling : li.nextElementSibling; if (!to) return;
        if (+mv.dataset.mv < 0) to.before(li); else to.after(li);
        mv.focus();
      }),
      actions: [{ label: 'Cancel', value: null }, { label: 'Save', primary: true, collect: (m) => [...m.querySelectorAll('.st-bme')].map((li) => ({ hash: li.dataset.hash, label: li.querySelector('input').value.trim() || li.dataset.hash.slice(2) })) }] })
      .then((v) => { if (v) { bmSave(v); UI.toast('Bookmarks saved.'); } });
  };

  const side = document.getElementById('sidebar'), nav = side && side.querySelector('.nav');
  let box = null;
  if (nav) {
    box = document.createElement('section'); box.className = 'st-bm'; box.id = 'st-bm'; box.setAttribute('aria-label', 'Bookmarks'); box.dataset.testid = 'nav-bookmarks';
    box.addEventListener('click', (e) => { if (e.target.closest('[data-bm-edit]')) UI.editBookmarks(); });
    nav.before(box);
  }
  const star = document.getElementById('st-bmbtn');
  if (star) star.addEventListener('click', () => UI.toggleBookmark());
  function paint() {
    if (!UI.book) return;
    const l = bmList(), h = here(), on = l.some((x) => x.hash === h);
    if (star) { star.setAttribute('aria-pressed', String(on)); star.title = on ? 'Remove this page from bookmarks (Ctrl+D)' : 'Bookmark this page (Ctrl+D)'; star.setAttribute('aria-label', star.title); }
    if (!box) return;
    box.innerHTML = `<div class="st-bm-h"><span>${svg(STAR, 15)}<span class="st-bm-t">Bookmarks</span></span>${l.length ? '<button type="button" class="st-bm-edit" data-bm-edit>Edit</button>' : ''}</div>`
      + (l.length ? l.map((x) => `<a href="${esc(x.hash)}" class="st-bm-a${x.hash === h ? ' active' : ''}" title="${esc(x.label)}" data-testid="bm-link"><span class="st-bm-dot" aria-hidden="true">${esc((x.label[0] || '•').toUpperCase())}</span><span>${esc(x.label)}</span></a>`).join('')
        : '<p class="st-bm-empty">Press Ctrl+D on any page to keep it here.</p>');
  }

  /* ---------------- gear menu ---------------- */
  const gear = document.getElementById('st-gear');
  const GEAR = () => {
    const b = UI.book, f = (k) => !b || !b.feature || b.feature(k);
    return [
      ['Your company', [['#/settings', 'Company settings and backup'], ['@features', 'Features (F11)'], ['@configure', 'Configure (F12)'], ['#/snapshot', 'Company Snapshot'], ['@switch', 'Switch company']]],
      ['Lists', [['#/accounts', 'Chart of accounts'], ['#/items', 'Products and services'], ['#/customers', 'Customers'], ['#/vendors', 'Vendors'], f('classes') && ['#/classes', 'Classes'], ['#/recurring', 'Recurring transactions'], ['#/rules', 'Bank rules'], ['#/pricelevels', 'Price levels'], ['#/taxlines', 'Tax lines']].filter(Boolean)],
      ['Tools', [['#/find', 'Find (Ctrl+F)'], ['#/migrate', 'Import from QuickBooks'], ['#/bankfeed', 'Bank feed'], ['#/qbd', 'QuickBooks Desktop'], ['#/reconcile', 'Reconcile'], ['#/reclassify', 'Reclassify transactions'], ['#/builder', 'Custom report builder'], f('budgets') && ['#/budgets', 'Budgets']].filter(Boolean)],
      ['Profile', [['@compact', OB.prefs.get('navCompact') ? 'Full side menu (labels)' : 'Compact side menu (icons only)'], ['@bookmarks', 'Edit bookmarks'], ['@keys', 'Keyboard shortcuts (Ctrl+Alt+/)']]]
    ];
  };
  let pop = null;
  const closeGear = () => { if (!pop) return; pop.remove(); pop = null; if (gear) gear.setAttribute('aria-expanded', 'false'); };
  UI.gearMenu = () => {
    if (!UI.book) return;
    if (pop) { closeGear(); return; }
    pop = document.createElement('div'); pop.className = 'st-gear-pop st-pop'; pop.setAttribute('role', 'menu'); pop.setAttribute('aria-label', 'Settings'); pop.dataset.testid = 'gear-menu';
    pop.innerHTML = GEAR().map(([h, items]) => `<section><h3>${esc(h)}</h3>${items.map(([to, l]) => to[0] === '#'
      ? `<a role="menuitem" href="${esc(to)}">${esc(l)}</a>` : `<button type="button" role="menuitem" data-g="${esc(to.slice(1))}">${esc(l)}</button>`).join('')}</section>`).join('');
    document.body.appendChild(pop);
    const r = (gear || document.querySelector('.topbar')).getBoundingClientRect();
    pop.style.top = Math.round(r.bottom + 6) + 'px';
    pop.style.right = Math.max(8, Math.round(window.innerWidth - r.right)) + 'px';
    if (gear) gear.setAttribute('aria-expanded', 'true');
    pop.addEventListener('click', (e) => {
      const t = e.target.closest('a, button'); if (!t) return;
      const g = t.dataset.g; closeGear();
      if (g === 'features') UI.openFeatures(); else if (g === 'configure') UI.openConfigure(); else if (g === 'switch') UI.confirmLeave(UI.closeCompany);
      else if (g === 'compact') UI.setCompactNav(!OB.prefs.get('navCompact')); else if (g === 'bookmarks') UI.editBookmarks(); else if (g === 'keys') UI.showShortcuts();
    });
    pop.addEventListener('keydown', (e) => {
      const items = [...pop.querySelectorAll('[role=menuitem]')], i = items.indexOf(document.activeElement);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus(); }
      if (e.key === 'Tab') closeGear();
    });
    const first = pop.querySelector('[role=menuitem]'); if (first) first.focus();
  };
  if (gear) gear.addEventListener('click', (e) => { e.stopPropagation(); UI.gearMenu(); });
  document.addEventListener('click', (e) => { if (pop && !pop.contains(e.target)) closeGear(); });
  document.addEventListener('keydown', (e) => { if (pop && e.key === 'Escape') { e.preventDefault(); closeGear(); if (gear) gear.focus(); } });
  window.addEventListener('hashchange', closeGear);

  /* ---------------- compact side menu ---------------- */
  UI.setCompactNav = (on) => {
    OB.prefs.set('navCompact', !!on);
    document.documentElement.classList.toggle('nav-compact', !!on);
    UI.toast(on ? 'Compact side menu: point at an icon to see its menu.' : 'Side menu shows labels again.');
  };
  // names for icon-only items (hover tooltip and screen readers keep the text)
  if (nav) nav.querySelectorAll('a.nav-top, .nav-parent').forEach((x) => { const t = (x.querySelector('span:not(.nav-ico-slot):not(.st-badge)') || x).textContent.trim(); if (t && !x.title) x.title = t; });

  /* ---------------- after every screen ---------------- */
  const orig = UI.render;
  const wrapped = function () { const x = orig.apply(this, arguments); try { paint(); } catch (e) { console.error(e); } return x; };
  Object.keys(orig).forEach((k) => { wrapped[k] = orig[k]; });
  UI.render = wrapped;
})();
