/* OfflineBooks US — type-to-search combobox for accounts, customers/vendors and items, with inline "Add new".
 *
 * Markup: UI.comboHtml(kind, filter, value, attrs, opts) renders
 *   <div class="combo"><input type="hidden" {attrs}> <input class="combo-input" role="combobox"></div>
 * The hidden input carries the selected id, so form code reads `.value` exactly as it did from a <select>,
 * and receives a bubbling `change` event whenever the selection changes.
 *
 * Keyboard: type to filter · ↓/↑ move · Enter choose (and jump to the next field) · Tab choose and move ·
 *           Esc cancel · Alt+↓ open full list. The last suggestion is always "+ Add new …" when nothing matches exactly.
 */
(function () {
  'use strict';
  const U = OB.util, S = OB.schema, UI = OB.ui, esc = U.esc;

  const SOURCES = {
    account: {
      noun: () => 'account',
      items: (filter) => {
        const b = UI.book;
        return b.sortedAccounts((a) => a.active && (filter !== 'line' || (a.type !== 'ar' && a.type !== 'ap')))
          .map((a) => ({ id: a.id, label: b.accountLabel(a.id), sub: S.TYPE[a.type].label, number: a.number || '', name: a.name }));
      },
      label: (id) => (id && UI.book.accById[id] ? UI.book.accountLabel(id) : ''),
      creates: () => [{ text: 'Add new account', kind: '' }],
      create: (text, kind, hint) => UI.editAccount(null, { name: text, type: hint || 'expense' }).then((a) => a && a.id)
    },
    // products and services, searchable by name, SKU or description; shows price and stock on hand (as in a Tally item list)
    item: {
      noun: () => 'item',
      items: () => {
        const b = UI.book, inv = b.inventoryState ? b.inventoryState(U.today()) : {};
        const type = (id) => ((S.ITEM_TYPES || []).find((t) => t.id === id) || { label: '' }).label;
        return (b.items || []).filter((x) => x.active !== false).slice().sort((x, y) => x.name.localeCompare(y.name, undefined, { numeric: true }))
          .map((x) => ({ id: x.id, label: x.name, name: (x.name + ' ' + (x.description || '')).trim(), number: x.sku || '',
            sub: [type(x.type), x.price !== null && x.price !== undefined ? U.fmt(x.price, { symbol: true }) : '', inv[x.id] ? inv[x.id].qty + ' on hand' : ''].filter(Boolean).join(' · ') }));
      },
      label: (id) => (id && UI.book.itemById && UI.book.itemById[id] ? UI.book.itemById[id].name : ''),
      creates: () => [{ text: 'Add new item', kind: '' }],
      create: (text) => UI.editItem(null, text).then((x) => x && x.id)
    },
    contact: {
      noun: (filter) => (filter === 'any' ? 'name' : filter),
      items: (filter) => {
        const kinds = filter === 'any' ? ['customer', 'vendor'] : [filter];
        const L = (c) => UI.book.contactLabel(c.id);
        return UI.book.contacts.filter((c) => c.active && kinds.indexOf(c.kind) >= 0).sort((x, y) => L(x).localeCompare(L(y)))
          .map((c) => ({ id: c.id, label: L(c), sub: (c.kind === 'customer' ? 'Customer' : 'Vendor') + (c.company && c.company !== c.name ? ' · ' + c.company : ''), number: '', name: c.name }));
      },
      label: (id) => (id && UI.book.contactById[id] ? UI.book.contactLabel(id) : ''),
      creates: (filter) => filter === 'any'
        ? [{ text: 'Add as new vendor', kind: 'vendor' }, { text: 'Add as new customer', kind: 'customer' }]
        : [{ text: 'Add new ' + filter, kind: filter }],
      create: (text, kind) => UI.editContact(null, kind, { name: text }).then((c) => c && c.id)
    }
  };

  UI.comboHtml = (kind, filter, value, attrs, opts) => {
    opts = opts || {};
    const src = SOURCES[kind];
    return `<div class="combo" data-kind="${kind}" data-filter="${esc(filter)}" data-hint="${esc(opts.hint || '')}">` +
      `<input type="hidden" ${attrs} value="${esc(value || '')}">` +
      `<input type="text" class="combo-input" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="combo-list"` +
      ` autocomplete="off" spellcheck="false" placeholder="${esc(opts.placeholder || 'Type to search…')}" aria-label="${esc(opts.label || src.noun(filter))}" value="${esc(src.label(value))}"></div>`;
  };

  /* ---------- shared floating list ---------- */
  let list = null, st = null; // st: active combo state
  function ensureList() {
    if (list && list.isConnected) return list; // recreated if it was removed (e.g. when the company locks)
    list = document.createElement('ul');
    list.id = 'combo-list'; list.className = 'combo-list'; list.setAttribute('role', 'listbox'); list.hidden = true;
    document.body.appendChild(list);
    // mousedown + preventDefault keeps focus in the input, so blur logic doesn't fire mid-click
    list.addEventListener('mousedown', (e) => { e.preventDefault(); const li = e.target.closest('li[data-i]'); if (li) pick(+li.dataset.i, true); });
    return list;
  }
  function ctx(input) {
    const box = input.closest('.combo');
    return { input, box, hidden: box.querySelector('input[type=hidden]'), kind: box.dataset.kind, src: SOURCES[box.dataset.kind], filter: box.dataset.filter, hint: box.dataset.hint };
  }

  /** Rank: number prefix > name prefix > every word starts a word > contains everything. */
  function rank(items, q) {
    q = q.trim().toLowerCase();
    if (!q) return items.slice(0, 300);
    const toks = q.split(/\s+/), out = [];
    items.forEach((it, i) => {
      const lab = it.label.toLowerCase(), name = it.name.toLowerCase(), words = lab.split(/[\s:&\/(),.-]+/);
      let s;
      if (it.number && it.number.toLowerCase().startsWith(q)) s = 0;
      else if (name.startsWith(q) || lab.startsWith(q)) s = 1;
      else if (toks.every((t) => words.some((w) => w.startsWith(t)))) s = 2;
      else if (toks.every((t) => lab.indexOf(t) >= 0 || it.sub.toLowerCase().indexOf(t) >= 0)) s = 3;
      else return;
      out.push({ it, s, i });
    });
    out.sort((a, b) => a.s - b.s || a.i - b.i);
    return out.slice(0, 300).map((x) => x.it);
  }
  function exactMatch(c, text) {
    const t = text.trim().toLowerCase();
    if (!t) return null;
    return c.src.items(c.filter).find((it) => it.label.toLowerCase() === t || it.name.toLowerCase() === t || (it.number && it.number.toLowerCase() === t)) || null;
  }

  function openFor(input, showAll) {
    const c = ctx(input);
    if (!st || st.input !== input) st = Object.assign(c, { all: c.src.items(c.filter), index: 0 });
    const q = showAll || input.value === c.src.label(c.hidden.value) ? '' : input.value;
    st.q = q;
    const matches = rank(st.all, q);
    st.opts = matches.map((it) => ({ it }));
    if (q.trim() && !exactMatch(st, q)) c.src.creates(c.filter).forEach((cr) => st.opts.push({ create: cr }));
    st.index = q ? 0 : Math.max(0, st.opts.findIndex((o) => o.it && o.it.id === c.hidden.value));
    render();
  }
  function render() {
    const l = ensureList(), noun = st.src.noun(st.filter);
    if (!st.opts.length) {
      l.innerHTML = `<li class="empty">No ${esc(noun)}s yet — type a name to add one</li>`;
    } else {
      l.innerHTML = st.opts.map((o, i) => o.create
        ? `<li role="option" id="co-${i}" data-i="${i}" class="create${i === st.index ? ' on' : ''}" aria-selected="${i === st.index}">+ ${esc(o.create.text)}: <strong>${esc(st.q.trim())}</strong></li>`
        : `<li role="option" id="co-${i}" data-i="${i}" class="${i === st.index ? 'on' : ''}" aria-selected="${i === st.index}"><span class="lab">${esc(o.it.label)}</span><span class="sub">${esc(o.it.sub)}</span></li>`).join('');
      if (st.opts.length && !st.opts.some((o) => !o.create)) l.insertAdjacentHTML('afterbegin', `<li class="empty">No ${esc(noun)} matches “${esc(st.q.trim())}”</li>`);
    }
    l.hidden = false;
    st.input.setAttribute('aria-expanded', 'true');
    st.input.setAttribute('aria-activedescendant', 'co-' + st.index);
    position();
    const on = l.querySelector('li.on');
    if (on) on.scrollIntoView({ block: 'nearest' });
  }
  function position() {
    if (!st || !list || list.hidden) return;
    const r = st.input.getBoundingClientRect();
    const below = window.innerHeight - r.bottom, h = Math.min(320, list.scrollHeight);
    list.style.left = Math.max(4, Math.min(r.left, window.innerWidth - Math.max(r.width, 340) - 4)) + 'px';
    list.style.minWidth = Math.max(r.width, 340) + 'px';
    if (below < h + 8 && r.top > below) { list.style.top = ''; list.style.bottom = (window.innerHeight - r.top + 2) + 'px'; }
    else { list.style.bottom = ''; list.style.top = (r.bottom + 2) + 'px'; }
  }
  function close() {
    if (list) list.hidden = true;
    if (st) { st.input.setAttribute('aria-expanded', 'false'); st.input.removeAttribute('aria-activedescendant'); }
    st = null;
  }
  function select(c, id) {
    const changed = c.hidden.value !== id;
    c.hidden.value = id;
    c.input.value = c.src.label(id);
    c.box.classList.remove('invalid');
    if (changed) c.hidden.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function pick(i, advance) {
    if (!st) return;
    const o = st.opts[i], c = st, q = st.q.trim();
    close();
    if (!o) return;
    if (o.create) return create(c, q, o.create.kind);
    select(c, o.it.id);
    if (advance) UI.focusNext(c.input);
  }
  function create(c, text, kind) {
    c.box.dataset.creating = '1';
    c.src.create(text, kind, c.hint).then((id) => {
      delete c.box.dataset.creating;
      if (id) { select(c, id); UI.focusNext(c.input); }
      else { c.input.focus(); }
    }, (e) => { delete c.box.dataset.creating; UI.error(e); });
  }
  /** On leaving the field: accept an exact (or single) match, otherwise flag it. */
  function commit(input) {
    const c = ctx(input);
    if (c.box.dataset.creating) return;
    const text = input.value.trim();
    if (!text) { if (c.hidden.value) select(c, ''); return; }
    if (text === c.src.label(c.hidden.value)) return;
    const ex = exactMatch(c, text) || (function () { const r = rank(c.src.items(c.filter), text); return r.length === 1 ? r[0] : null; })();
    if (ex) { select(c, ex.id); return; }
    if (c.hidden.value) { c.hidden.value = ''; c.hidden.dispatchEvent(new Event('change', { bubbles: true })); }
    c.box.classList.add('invalid');
    input.title = 'Not found — choose from the list or use “Add new”';
  }

  UI.focusNext = (el) => {
    const scope = el.closest('form') || el.closest('.modal') || document;
    const els = [...scope.querySelectorAll('input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])')]
      .filter((x) => x.offsetParent !== null && !x.closest('[data-act="rmline"]') && x.tabIndex !== -1);
    const i = els.indexOf(el);
    if (i >= 0 && els[i + 1]) els[i + 1].focus();
  };

  /* ---------- events (delegated) ---------- */
  document.addEventListener('focusin', (e) => {
    const t = e.target;
    if (t.matches && t.matches('.combo-input')) t.select(); // suggestions open on intent (typing, click, ↓), never just on focus
    else if (t.matches && t.matches('input.money, input.qty')) t.select();
  });
  document.addEventListener('click', (e) => {
    const t = e.target;
    if (t.matches && t.matches('.combo-input') && !t.disabled && (!st || st.input !== t)) openFor(t, true);
  });
  document.addEventListener('input', (e) => {
    if (e.target.matches && e.target.matches('.combo-input')) { e.target.closest('.combo').classList.remove('invalid'); openFor(e.target, false); }
  });
  document.addEventListener('focusout', (e) => {
    const t = e.target;
    if (t.matches && t.matches('.combo-input')) { if (st && st.input === t) close(); commit(t); }
    if (t.matches && t.matches('input.money') && t.value.trim()) { try { t.value = U.fmtPlain(U.toCents(t.value)); } catch (x) { /* left for validation */ } }
  });
  document.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t.matches && t.matches('.combo-input')) {
      const isOpen = st && st.input === t && !list.hidden;
      if (e.key === 'ArrowDown') { e.preventDefault(); if (!isOpen) openFor(t, e.altKey || true); else { st.index = Math.min(st.opts.length - 1, st.index + 1); render(); } }
      else if (e.key === 'ArrowUp') { if (isOpen) { e.preventDefault(); st.index = Math.max(0, st.index - 1); render(); } }
      else if (e.key === 'Enter') { e.preventDefault(); if (isOpen && st.opts.length) pick(st.index, true); else UI.focusNext(t); }
      else if (e.key === 'Tab' && !e.shiftKey) {
        if (isOpen && st.q && st.opts.length) {
          const o = st.opts[st.index];
          if (o.create) { e.preventDefault(); pick(st.index, false); } else { select(st, o.it.id); close(); }
        } else if (isOpen) close();
      } else if (e.key === 'Escape' && isOpen) {
        e.preventDefault(); e.stopPropagation();
        const c = ctx(t); t.value = c.src.label(c.hidden.value); close();
      }
      return;
    }
    // Enter moves to the next field inside transaction forms instead of submitting (Ctrl+S saves).
    if (e.key === 'Enter' && t.closest && t.closest('form.txform') && t.tagName === 'INPUT' && !e.ctrlKey) { e.preventDefault(); UI.focusNext(t); return; }
    // Date shortcuts, as in desktop accounting software: t = today, + / − = next / previous day.
    if (t.matches && t.matches('input[type=date]') && !e.ctrlKey && !e.altKey && !e.metaKey) {
      let v = null;
      if (e.key === 't' || e.key === 'T') v = U.today();
      else if ((e.key === '+' || e.key === '=') && U.isDate(t.value)) v = U.addDays(t.value, 1);
      else if (e.key === '-' && U.isDate(t.value)) v = U.addDays(t.value, -1);
      if (v) { e.preventDefault(); t.value = v; t.dispatchEvent(new Event('input', { bubbles: true })); t.dispatchEvent(new Event('change', { bubbles: true })); }
    }
  }, true);
  window.addEventListener('scroll', position, true);
  window.addEventListener('resize', position);
  window.addEventListener('hashchange', close);
})();
