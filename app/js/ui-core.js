/* OfflineBooks US — UI core: routing, shared widgets and helpers. */
(function () {
  'use strict';
  const U = OB.util, S = OB.schema;
  const UI = OB.ui = { book: null, routes: {}, current: null, dirty: false };
  const esc = U.esc;
  UI.esc = esc;

  /* ---------- formatting ---------- */
  UI.money = (c, opts) => {
    opts = opts || {};
    c = c || 0;
    if (opts.blankZero && !c) return '';
    const cls = 'amt' + (c < 0 && !opts.contra ? ' neg' : '') + (opts.strong ? ' strong' : '');   // contra: a negative balance that is normal (accumulated depreciation), not shown in red
    return `<span class="${cls}">${U.fmt(c, { parens: opts.parens !== false, symbol: !!opts.symbol })}</span>`;
  };
  UI.date = (d) => esc(U.fmtDate(d));
  UI.typeLabel = (t) => S.TXN_TYPES[t] ? S.TXN_TYPES[t].label : t;
  UI.contactName = (id) => { const c = id && UI.book.contactById[id]; return c ? (c.parentId && UI.book.contactLabel ? UI.book.contactLabel(id) : c.name) : ''; };
  UI.txnLink = (t, text) => `<a href="#/txn/${esc(t.id)}">${esc(text !== undefined ? text : (UI.typeLabel(t.type) + (t.number ? ' ' + t.number : '')))}</a>`;
  UI.statusBadge = (t) => {
    if (t.status === 'void') return '<span class="badge void">Void</span>';
    if (S.TXN_TYPES[t.type].nonPosting) return t.status === 'closed' ? '<span class="badge ok">Closed</span>' : '<span class="badge">Open</span>';
    const b = UI.book, open = b.openBalance(t);
    if (t.type === 'invoice' || t.type === 'bill') {
      if (open === 0) return '<span class="badge ok">Paid</span>';
      if (t.dueDate && t.dueDate < U.today()) return '<span class="badge danger">Overdue</span>';
      if (open < t.total) return '<span class="badge warn">Partial</span>';
      return '<span class="badge">Open</span>';
    }
    if (S.TXN_TYPES[t.type].applies && open > 0) return '<span class="badge warn">Unapplied ' + U.fmt(open) + '</span>';
    return '';
  };

  /* ---------- selects ---------- */
  UI.accountOptions = (selected, filter, opts) => {
    opts = opts || {};
    const b = UI.book;
    let html = opts.blank !== false ? `<option value="">${esc(opts.blankLabel || 'Choose account…')}</option>` : '';
    S.ACCOUNT_TYPES.forEach((t) => {
      const list = b.sortedAccounts((a) => a.type === t.id && (a.active || a.id === selected) && (!filter || filter(a)));
      if (!list.length) return;
      html += `<optgroup label="${esc(t.label)}">` + list.map((a) =>
        `<option value="${esc(a.id)}"${a.id === selected ? ' selected' : ''}>${esc(b.accountLabel(a.id))}${a.active ? '' : ' (inactive)'}</option>`).join('') + '</optgroup>';
    });
    return html;
  };
  UI.contactOptions = (kind, selected, opts) => {
    opts = opts || {};
    const b = UI.book;
    let html = opts.blank !== false ? `<option value="">${esc(opts.blankLabel || (kind === 'any' ? 'Choose payee (optional)…' : 'Choose ' + kind + '…'))}</option>` : '';
    const kinds = kind === 'any' ? ['vendor', 'customer'] : [kind];
    kinds.forEach((k) => {
      const list = b.contacts.filter((c) => c.kind === k && (c.active || c.id === selected)).sort((x, y) => x.name.localeCompare(y.name));
      if (!list.length) return;
      const items = list.map((c) => `<option value="${esc(c.id)}"${c.id === selected ? ' selected' : ''}>${esc(c.name)}</option>`).join('');
      html += kinds.length > 1 ? `<optgroup label="${k === 'vendor' ? 'Vendors' : 'Customers'}">${items}</optgroup>` : items;
    });
    return html;
  };

  /* ---------- feedback ---------- */
  /** Calm notifications: identical messages merge (with a count), at most 3 visible. */
  UI.toast = (msg, kind) => {
    const host = document.getElementById('toasts');
    kind = kind || 'ok';
    const same = [...host.children].find((t) => t.dataset.msg === msg && t.dataset.kind === kind && !t.classList.contains('out'));
    const life = kind === 'error' ? 7000 : 3200;
    const arm = (el) => { clearTimeout(el._t); el._t = setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, life); };
    if (same) {
      const n = (+same.dataset.n || 1) + 1; same.dataset.n = n;
      let c = same.querySelector('.count'); if (!c) { c = document.createElement('span'); c.className = 'count'; same.appendChild(c); }
      c.textContent = '×' + n; arm(same); return;
    }
    const el = document.createElement('div');
    el.className = 'toast ' + kind; el.dataset.msg = msg; el.dataset.kind = kind;
    el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    el.textContent = msg;
    host.appendChild(el);
    const live = [...host.children].filter((t) => !t.classList.contains('out'));
    live.slice(0, Math.max(0, live.length - 3)).forEach((t) => t.remove());
    arm(el);
  };
  UI.error = (e) => {
    console.error(e);
    UI.toast(e && e.message ? e.message : String(e), 'error');
  };

  /** Modal dialog. Returns a Promise resolving with the clicked action value (or null on cancel). */
  // a dialog button with a plain-letter key shows that letter underlined (Save keeps the app-wide Ctrl+S underline)
  const mnLabel = (a) => {
    const i = a.key && !(a.primary && /^Save\b/.test(a.label)) ? a.label.toLowerCase().indexOf(a.key.toLowerCase()) : -1;
    return i < 0 ? esc(a.label) : '<span class="mn-wrap">' + esc(a.label.slice(0, i)) + '<u class="mn">' + esc(a.label.charAt(i)) + '</u>' + esc(a.label.slice(i + 1)) + '</span>';
  };
  /** While a dialog is open the app behind it is inert: no focus, clicks or screen-reader reading. */
  UI._shellInert = (on) => {
    const open = document.querySelectorAll('.modal-backdrop').length;
    document.querySelectorAll('body > .skip, body > .app, body > .window-taskbar').forEach((x) => { if (on || !open) x.inert = !!(on || open); });
  };
  UI.modal = (o) => new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'modal-backdrop';
    const actions = (o.actions || [{ label: 'OK', value: true, primary: true }]);
    back.innerHTML = `<div class="modal${o.wide ? ' wide' : ''}${o.cls ? ' ' + esc(o.cls) : ''}" role="dialog" aria-modal="true" aria-labelledby="mtitle">
      <h2 id="mtitle">${esc(o.title || '')}</h2>
      <div class="modal-body">${o.html || ''}</div>
      <div class="modal-actions">${actions.map((a, i) => `<button type="button" class="btn ${a.primary ? 'primary' : ''} ${a.danger ? 'danger' : ''}" data-i="${i}"${a.primary && /^Save\b/.test(a.label) ? ' data-key="s"' : ''}>${mnLabel(a)}</button>`).join('')}</div>
    </div>`;
    document.body.appendChild(back);
    UI._shellInert(true);
    const prevFocus = document.activeElement;
    let edited = false;   // typed into this dialog: Esc and a click outside ask before throwing it away
    back.addEventListener('input', (e) => { if (e.target.type !== 'search') edited = true; });   // a search or filter box is not data
    const close = (v) => { back.remove(); document.removeEventListener('keydown', onKey); UI._shellInert(false); if (prevFocus && prevFocus.focus) prevFocus.focus(); resolve(v); };
    const dismiss = () => {
      if (o.locked) return;
      // only a real form asks (two or more fields); a one-line prompt or a filter just closes
      if (!edited || back.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=search]), textarea').length < 2) return close(null);
      UI.confirm('Discard what you typed?', '<p>Closing this window throws away what you entered.</p>', { ok: 'Discard', cancel: 'Keep editing' }).then((yes) => { if (yes) close(null); });
    };
    const top = () => { const all = document.querySelectorAll('.modal-backdrop'); return all[all.length - 1] === back; };
    const onKey = (e) => {
      if (!top()) return;   // only the topmost dialog answers keys
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); return dismiss(); }
      if (e.key === 'Tab') {   // keep focus inside the dialog
        const fs = [...back.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')].filter((x) => x.offsetParent !== null || x === document.activeElement);
        if (!fs.length) { e.preventDefault(); return; }
        const i = fs.indexOf(document.activeElement);
        if (e.shiftKey && i <= 0) { e.preventDefault(); fs[fs.length - 1].focus(); }
        else if (!e.shiftKey && (i === -1 || i === fs.length - 1)) { e.preventDefault(); fs[0].focus(); }
        return;
      }
      const btns = [...back.querySelectorAll('.modal-actions [data-i], .modal [data-i]')], at = btns.indexOf(document.activeElement);
      if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && at >= 0) { e.preventDefault(); btns[(at + (e.key === 'ArrowRight' ? 1 : btns.length - 1)) % btns.length].focus(); return; }
      const typingIn = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName);
      const hit = !typingIn && !e.ctrlKey && !e.metaKey && !e.altKey && actions.findIndex((a) => a.key && a.key.toLowerCase() === e.key.toLowerCase());
      if (hit !== false && hit >= 0) { e.preventDefault(); e.stopPropagation(); const bt = back.querySelector(`[data-i="${hit}"]`); if (bt) bt.click(); }
    };
    document.addEventListener('keydown', onKey);
    back.addEventListener('click', (e) => {
      if (e.target === back) return dismiss();
      const btn = e.target.closest('[data-i]');
      if (!btn) return;
      const a = actions[+btn.dataset.i];
      if (a.collect) {
        const v = a.collect(back.querySelector('.modal'));
        if (v === false) return;
        return close(v);
      }
      close(a.value);
    });
    if (o.onMount) o.onMount(back.querySelector('.modal'), close);
    const f = back.querySelector('input,select,textarea') || back.querySelector('.btn.primary') || back.querySelector('.btn');
    if (f) f.focus({ preventScroll: true });   // a long dialog opens at its top, even when focus starts on a button at the bottom
  });
  /** Side panel for secondary information (journal, history) — opened on request, closes with Esc. */
  UI.drawer = (o) => {
    document.querySelectorAll('.drawer-backdrop').forEach((x) => x.remove());
    const back = document.createElement('div');
    back.className = 'drawer-backdrop';
    back.innerHTML = `<aside class="drawer" role="dialog" aria-modal="true" aria-labelledby="dtitle"><header><div><h2 id="dtitle">${esc(o.title)}</h2>${o.sub ? `<p class="muted">${esc(o.sub)}</p>` : ''}</div>
      <button type="button" class="btn ghost" data-close aria-label="Close">✕</button></header><div class="drawer-body">${o.html}</div></aside>`;
    document.body.appendChild(back);
    const prev = document.activeElement;
    const close = () => { back.remove(); document.removeEventListener('keydown', key); if (prev && prev.focus) prev.focus(); };
    const key = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', key);
    back.addEventListener('click', (e) => { if (e.target === back || e.target.closest('[data-close]') || e.target.closest('a[href^="#/"]')) close(); });
    back.querySelector('[data-close]').focus();
  };
  window.addEventListener('hashchange', () => document.querySelectorAll('.drawer-backdrop').forEach((x) => x.remove()));
  UI.confirm = (title, html, opts) => {
    opts = opts || {};
    return UI.modal({ title, html, actions: [{ label: opts.cancel || 'Cancel', value: false }, { label: opts.ok || 'Continue', value: true, primary: !opts.danger, danger: !!opts.danger }] }).then((v) => !!v);
  };
  UI.prompt = (title, label, value, opts) => {
    opts = opts || {};
    return UI.modal({
      title, html: `<label class="field"><span>${esc(label)}</span><input id="pval" type="${opts.type || 'text'}" value="${esc(value || '')}"></label>${opts.help ? `<p class="muted">${opts.help}</p>` : ''}`,
      actions: [{ label: 'Cancel', value: null }, { label: opts.ok || 'OK', primary: true, danger: !!opts.danger, collect: (m) => m.querySelector('#pval').value }]
    });
  };

  /* ---------- busy guard: prevents double submits ---------- */
  UI.busy = (btn, fn) => {
    if (btn && (btn.disabled || btn.dataset.busy)) return Promise.resolve();
    let label = '';
    if (btn) { btn.disabled = true; btn.dataset.busy = '1'; label = btn.innerHTML; btn.textContent = 'Saving…'; btn.setAttribute('aria-busy', 'true'); }
    return Promise.resolve().then(fn).finally(() => { if (btn && btn.isConnected) { btn.disabled = false; delete btn.dataset.busy; btn.innerHTML = label; btn.removeAttribute('aria-busy'); } });
  };

  /* ---------- document status: Unsaved / Saving / Saved / Save failed ---------- */
  const status = { state: 'idle', msg: '', timer: null, dirty: false };
  const STATUS_TEXT = { dirty: 'Unsaved changes', saving: 'Saving…', saved: 'Saved', failed: 'Save failed' };
  UI.setStatus = (state, msg) => {
    clearTimeout(status.timer);
    status.state = state; status.msg = msg || '';
    if (state === 'saved') status.timer = setTimeout(() => UI.setStatus(status.dirty ? 'dirty' : 'idle'), 3500);
    renderStatus();
  };
  UI.getStatus = () => status.state;
  function renderStatus() {
    const st = status.state, text = STATUS_TEXT[st] || '';
    document.querySelectorAll('#save-status, .form-status').forEach((el) => {
      el.dataset.state = st;
      const inline = el.classList.contains('form-status');
      el.innerHTML = !text ? '' : `<span class="dot" aria-hidden="true"></span><span${inline && st === 'failed' ? ' role="alert"' : ''}>${esc(text)}${inline && status.msg ? ' — ' + esc(status.msg) : ''}</span>` +
        (inline && st === 'failed' && !/^Fix /.test(status.msg || '') ? ' <button type="button" class="btn small" data-act="retry">Try again</button>' : '');   // retry helps a storage failure, not a field to fix
      el.title = status.msg || text;
    });
    document.documentElement.classList.toggle('is-dirty', status.dirty);
  }
  // UI.dirty stays a simple boolean for callers, but now drives the visible indicator
  Object.defineProperty(UI, 'dirty', {
    get: () => status.dirty,
    set: (v) => {
      status.dirty = !!v;
      if (status.state === 'saving') return renderStatus();
      if (status.dirty && status.state !== 'failed') UI.setStatus('dirty');
      else if (!status.dirty && (status.state === 'dirty' || status.state === 'failed')) UI.setStatus('idle');
      else renderStatus();
    }
  });
  UI.guard = { save: null }; // a form registers save(): Promise<boolean>

  /** Dirty tracking by snapshot: typing and then undoing returns to "no changes". */
  UI.trackForm = (form, o) => {
    o = o || {};
    const snap = o.snapshot || (() => JSON.stringify([...new FormData(form).entries()]));
    let base = snap();
    const refresh = () => { if (form.isConnected) UI.dirty = snap() !== base; };
    form.addEventListener('input', () => { if (status.state === 'failed') UI.setStatus('dirty'); setTimeout(refresh); });
    form.addEventListener('change', () => setTimeout(refresh));
    form.addEventListener('click', () => setTimeout(refresh));
    if (o.save) UI.guard.save = o.save;
    UI.dirty = false;
    return { refresh, reset: () => { base = snap(); refresh(); } };
  };
  /** One save path: Saving → Saved / Save failed. Never re-enters; never clears the form on failure.
   *  fn resolves false when it handled a non-storage problem (e.g. validation) itself. */
  UI.runSave = (btn, fn, savedMsg) => {
    if (UI._saving) return Promise.resolve(false);
    UI._saving = true;
    UI.setStatus('saving');
    // the reason a save failed is shown inside the form too, next to the field it names
    const form = btn && btn.closest ? btn.closest('form') : null;
    const clearInline = () => { if (!form) return; form.querySelectorAll('.save-error').forEach((x) => x.remove()); form.querySelectorAll('[aria-invalid="true"][data-save-invalid]').forEach((x) => { x.removeAttribute('aria-invalid'); x.removeAttribute('data-save-invalid'); }); };
    clearInline();
    return UI.busy(btn, fn).then((res) => {
      if (res === false) return false;
      UI.dirty = false;
      UI.setStatus('saved', typeof savedMsg === 'function' ? savedMsg(res) : savedMsg);
      return true;
    }, (e) => {
      console.error(e);
      const msg = e && e.message ? e.message : String(e);
      UI.setStatus('failed', msg + ' Nothing was saved and your entries are still here.');
      if (form) {
        const box = document.createElement('div');
        box.className = 'banner danger save-error span2'; box.setAttribute('role', 'alert'); box.dataset.testid = 'save-error';
        box.textContent = msg + ' Nothing was saved.';
        form.prepend(box);
        const f = e && e.field && form.querySelector(`[name="${CSS.escape(e.field)}"]`);
        if (f) { f.setAttribute('aria-invalid', 'true'); f.dataset.saveInvalid = '1'; f.focus(); }
      }
      return false;
    }).finally(() => { UI._saving = false; });
  };

  /** Ask before discarding edits. proceed() runs when it's OK to leave. */
  UI.confirmLeave = (proceed) => {
    if (!UI.dirty) { proceed(); return Promise.resolve(true); }
    const canSave = typeof UI.guard.save === 'function';
    return UI.modal({
      title: 'Unsaved changes',
      html: `<p>You have changes on this page that haven’t been saved.</p>`,
      actions: [{ label: 'Keep editing', value: null, key: 'k' }, { label: 'Discard changes', value: 'discard', danger: true, key: 'd' }].concat(canSave ? [{ label: 'Save', value: 'save', primary: true, key: 's' }] : [])
    }).then((v) => {
      if (v === 'discard') { UI.dirty = false; proceed(); return true; }
      if (v === 'save') return UI.guard.save().then((ok) => { if (ok) { UI.dirty = false; proceed(); } return ok; });
      return false;
    });
  };

  /* ---------- pagination ---------- */
  UI.pager = (total, page, size, onPage) => {
    const pages = Math.max(1, Math.ceil(total / size));
    const id = 'pg' + Math.random().toString(36).slice(2, 8);
    setTimeout(() => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('click', (e) => { const b = e.target.closest('[data-p]'); if (b) onPage(+b.dataset.p); });
    });
    if (pages <= 1) return `<div class="pager" id="${id}"><span class="muted">${total} ${total === 1 ? 'row' : 'rows'}</span></div>`;
    return `<div class="pager" id="${id}">
      <button class="btn ghost small" data-p="0" ${page === 0 ? 'disabled' : ''}>First</button>
      <button class="btn ghost small" data-p="${page - 1}" ${page === 0 ? 'disabled' : ''}>Previous</button>
      <span class="muted">Page ${page + 1} of ${pages} · ${total} rows</span>
      <button class="btn ghost small" data-p="${page + 1}" ${page >= pages - 1 ? 'disabled' : ''}>Next</button>
      <button class="btn ghost small" data-p="${pages - 1}" ${page >= pages - 1 ? 'disabled' : ''}>Last</button></div>`;
  };

  /* ---------- date ranges ---------- */
  UI.ranges = () => {
    const t = U.today(), fm = UI.book.company.fiscalYearStartMonth || 1;
    const fys = U.fiscalYearStart(t, fm);
    const qStart = U.ymd(+t.slice(0, 4), Math.floor((+t.slice(5, 7) - 1) / 3) * 3 + 1, 1);
    const lm = U.addMonths(U.monthStart(t), -1);
    return {
      thisMonth: ['This month', U.monthStart(t), U.monthEnd(t)],
      lastMonth: ['Last month', lm, U.monthEnd(lm)],
      thisQuarter: ['This quarter', qStart, U.addDays(U.addMonths(qStart, 3), -1)],
      thisFY: ['This fiscal year', fys, U.addDays(U.addMonths(fys, 12), -1)],
      fyToDate: ['Fiscal year to date', fys, t],
      lastFY: ['Last fiscal year', U.addMonths(fys, -12), U.addDays(fys, -1)],
      last12: ['Last 12 months', U.addDays(U.addMonths(t, -12), 1), t],
      all: ['All dates', '1900-01-01', '2999-12-31']
    };
  };
  UI.rangeSelect = (id, selected) => {
    const r = UI.ranges();
    return `<select id="${id}" aria-label="Date range">${Object.keys(r).map((k) => `<option value="${k}"${k === selected ? ' selected' : ''}>${r[k][0]}</option>`).join('')}<option value="custom"${selected === 'custom' ? ' selected' : ''}>Custom</option></select>`;
  };

  /* ---------- printing a report: the real paginated document, not a picture of the screen ---------- */
  /** Open the system print window on a PDF made here. Falls back to a new tab when the browser will not print a framed PDF. */
  UI.printPdf = (bytes) => {
    const url = URL.createObjectURL(new Blob([bytes], { type: OB.pdf.MIME }));
    const old = document.getElementById('vb-print-frame'); if (old) { URL.revokeObjectURL(old.src); old.remove(); }
    const f = document.createElement('iframe');
    f.id = 'vb-print-frame'; f.title = 'Print'; f.setAttribute('aria-hidden', 'true'); f.tabIndex = -1;
    f.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0';   // not display:none: a hidden frame does not print
    const newTab = () => { window.open(url, '_blank'); UI.toast('The report opened in a new tab. Press Ctrl+P there to print.'); };
    f.onload = () => setTimeout(() => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { newTab(); } }, 350);
    f.onerror = newTab;
    f.src = url; document.body.appendChild(f);
  };
  /** Print the report on screen through its own PDF export; a screen with no PDF export prints as the browser shows it. */
  UI.printReport = () => {
    const x = [...document.querySelectorAll('[data-x="pdf"]')].find((b) => { const pg = b.closest('.page') || b; return pg.getClientRects().length > 0; });
    if (!x) return false;
    UI._printMode = true; try { x.click(); } finally { UI._printMode = false; }
    return true;
  };
  document.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === 'p' || e.key === 'P') && UI.printReport()) e.preventDefault(); }, true);
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[data-print], #st-print, #rb-print, #dz-print, [data-x="print"]');
    if (b && UI.printReport()) { e.preventDefault(); e.stopImmediatePropagation(); const m = b.closest('.menu'); if (m) m.hidden = true; }
  }, true);

  /* ---------- exports ---------- */
  /** PDF page setup dialog (remembered per browser). Resolves { paper, orientation, fontSize, width, height } or null. */
  UI.pdfSetup = () => {
    const cur = Object.assign({ paper: 'letter', orientation: 'auto', fontSize: 'auto', width: '8.5', height: '11' }, OB.prefs.get('pdfSetup') || {});
    const opt = (list, v) => list.map(([k, l]) => `<option value="${k}"${String(v) === k ? ' selected' : ''}>${l}</option>`).join('');
    return UI.modal({
      title: 'PDF page setup',
      html: `<div class="form-grid">
        <label class="field"><span>Paper size</span><select id="pdf-paper">${opt([['letter', 'US Letter (8.5 × 11 in)'], ['legal', 'US Legal (8.5 × 14 in)'], ['tabloid', 'Tabloid (11 × 17 in)'], ['a4', 'A4'], ['a3', 'A3'], ['custom', 'Custom size']], cur.paper)}</select></label>
        <label class="field"><span>Orientation</span><select id="pdf-orient">${opt([['auto', 'Automatic'], ['portrait', 'Portrait'], ['landscape', 'Landscape']], cur.orientation)}</select></label>
        <label class="field"><span>Text size</span><select id="pdf-size">${opt([['auto', 'Automatic (fit the columns)'], ['7', '7 pt'], ['8', '8 pt'], ['9', '9 pt'], ['10', '10 pt'], ['11', '11 pt']], cur.fontSize)}</select></label>
        <label class="field"><span>Custom width (inches)</span><input id="pdf-w" type="number" min="3" max="40" step="0.1" value="${esc(cur.width)}"></label>
        <label class="field"><span>Custom height (inches)</span><input id="pdf-h" type="number" min="3" max="40" step="0.1" value="${esc(cur.height)}"></label></div>
        <p class="muted small">Headings and column titles repeat on every page, with page numbers. The PDF is made on this computer.</p>`,
      actions: [{ label: 'Cancel', value: null }, { label: 'Create PDF', primary: true, collect: (m) => {
        const v = { paper: m.querySelector('#pdf-paper').value, orientation: m.querySelector('#pdf-orient').value, fontSize: m.querySelector('#pdf-size').value, width: m.querySelector('#pdf-w').value, height: m.querySelector('#pdf-h').value };
        if (v.paper === 'custom' && !(+v.width >= 3 && +v.height >= 3 && +v.width <= 40 && +v.height <= 40)) { UI.toast('Enter a custom size between 3 and 40 inches.', 'error'); return false; }
        OB.prefs.set('pdfSetup', v); return v;
      } }]
    });
  };
  /**
   * matrix: array of rows; cell = string | number(dollars) | {v, money, bold}
   * opts.report: the matrix is a report (title lines, blank row, column header): Excel gets the report layout
   * (merged title, frozen header, print titles, fit to width); PDF is always a paginated report.
   * opts.model: a ready OB.reportModel (statements), used for Excel and PDF instead of the matrix.
   */
  UI.exportMatrix = (name, matrix, format, opts) => {
    opts = opts || {};
    const fname = U.safeFileName(UI.book.company.name + '_' + name + '_' + U.today());
    const M = OB.reportModel;
    if (format === 'pdf' || (format === 'xlsx' && (opts.report || opts.model))) {
      const model = opts.model || M.fromMatrix(matrix);
      if (!opts.model && !model.footer.length) model.footer = ['Prepared ' + new Date().toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' }) + ' by VaultBook'];
      if (format === 'xlsx') {
        U.download(fname + '.xlsx', new Blob([OB.xlsx.build([M.toSheet(model, { name, page: OB.prefs.get('pdfSetup') || {} })])], { type: OB.xlsx.MIME }));
        return UI.toast('Exported ' + fname + '.xlsx');
      }
      // printing (Ctrl+P, Print buttons): the same paginated report as the PDF, sent to the print window with the saved page setup
      if (UI._printMode) { UI.printPdf(M.toPdf(model, OB.prefs.get('pdfSetup') || {})); return Promise.resolve(); }
      return UI.pdfSetup().then((setup) => {
        if (!setup) return;
        U.download(fname + '.pdf', new Blob([M.toPdf(model, setup)], { type: OB.pdf.MIME }));
        UI.toast('Exported ' + fname + '.pdf');
      });
    }
    if (format === 'xlsx') {
      const widths = [];
      matrix.forEach((r) => r.forEach((c, i) => { const v = c && typeof c === 'object' ? c.v : c; widths[i] = Math.min(60, Math.max(widths[i] || 8, String(v === undefined || v === null ? '' : v).length + 2)); }));
      const bytes = OB.xlsx.build([{ name: name, rows: matrix, widths }]);
      U.download(fname + '.xlsx', new Blob([bytes], { type: OB.xlsx.MIME }));
    } else {
      const rows = matrix.map((r) => r.map((c) => (c && typeof c === 'object') ? (typeof c.v === 'number' ? c.v.toFixed(2) : c.v) : c));
      U.download(fname + '.csv', '\uFEFF' + U.toCSV(rows), 'text/csv;charset=utf-8');
    }
    UI.toast('Exported ' + fname + '.' + (format === 'xlsx' ? 'xlsx' : 'csv'));
  };
  UI.m = (cents, bold) => ({ v: (cents || 0) / 100, money: true, bold: !!bold });

  /* ---------- routing ---------- */
  UI.parseHash = () => {
    const h = location.hash.replace(/^#\/?/, '');
    const [path, qs] = h.split('?');
    const params = {};
    (qs || '').split('&').filter(Boolean).forEach((kv) => { const [k, v] = kv.split('='); params[decodeURIComponent(k)] = decodeURIComponent(v || ''); });
    const parts = (path || '').split('/').filter(Boolean);
    return { name: parts[0] || 'gateway', id: parts[1] ? decodeURIComponent(parts[1]) : '', sub: parts[2] || '', params };
  };
  UI.go = (hash) => UI.confirmLeave(() => { if (location.hash === hash) UI.render(); else { UI._allowNav = true; location.hash = hash; } });
  // Intercept in-app links while a form has unsaved changes (before the address changes).
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[href^="#"]');
    if (!a || !UI.dirty || e.defaultPrevented || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const href = a.getAttribute('href');
    if (href === '#' || href === location.hash || href === '#main') return;
    e.preventDefault();
    UI.confirmLeave(() => { UI._allowNav = true; location.hash = href; });
  }, true);
  UI.qs = (o) => Object.keys(o).filter((k) => o[k] !== undefined && o[k] !== '').map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(o[k])).join('&');

  UI.render = () => {
    const main = document.getElementById('main');
    if (!UI.book) { document.body.classList.add('no-company'); document.getElementById('topbar-title').textContent = ''; return UI.routes.companies(main, {}); }
    document.body.classList.remove('no-company');
    const r = UI.parseHash();
    const known = Object.prototype.hasOwnProperty.call(UI.routes, r.name);
    const fn = known ? UI.routes[r.name] : UI.routes.gateway;
    UI.current = r;
    // A link with a query (Invoices = transactions?type=invoice) wins over the bare route link.
    const navLinks = Array.from(document.querySelectorAll('.nav a'));
    const hash = location.hash.replace(/^#\/?/, '');
    const routeOf = (a) => a.getAttribute('href').replace(/^#\/?/, '').split(/[/?]/)[0];
    const qMatch = navLinks.filter((a) => a.getAttribute('href').indexOf('?') >= 0 && hash.indexOf(a.getAttribute('href').replace(/^#\/?/, '')) === 0);
    // a transaction form lights up the part of the menu it belongs to: Sales, Expenses, or Books for the rest
    const txType = r.name === 'txn' ? ((r.params && r.params.type) || ((UI.book.txById || {})[r.id] || {}).type || '') : '';
    const txHref = !txType ? '' : /^(invoice|salesReceipt|creditMemo|payment|estimate|refund|salesOrder|statementCharge|delayedCharge|delayedCredit)$/.test(txType) ? '#/transactions?type=invoice'
      : /^(bill|expense|check|billPayment|vendorCredit|cardCharge|cardCredit|purchaseOrder|itemReceipt)$/.test(txType) ? '#/transactions?type=bill' : '#/transactions';
    navLinks.forEach((a) => {
      const href = a.getAttribute('href');
      const on = txHref ? href === txHref : qMatch.length ? qMatch.indexOf(a) >= 0
        : href.indexOf('?') < 0 && (routeOf(a) === r.name || (a.dataset.also || '').split(' ').indexOf(r.name) >= 0);
      a.classList.toggle('active', on);
    });
    document.getElementById('company-name').textContent = UI.book.company.name;
    document.getElementById('company-basis').textContent = (UI.book.company.basis === 'cash' ? 'Cash' : 'Accrual') + ' basis' + (UI.book.security ? ' · 🔒 protected' : '');
    document.getElementById('btn-lock').hidden = !UI.book.security;
    UI.applyFeatures();
    try {
      const res = fn(main, r);
      if (!known) UI.toast('There is no page at that address, so the Gateway is shown instead.');
      if (res && res.catch) res.catch(UI.error);
    } catch (e) {
      main.innerHTML = `<div class="page"><div class="banner danger"><strong>Something went wrong showing this page.</strong><br>${esc(e.message)}</div></div>`;
      console.error(e);
    }
    UI._lastHash = location.hash;
    const h1 = main.querySelector('h1');
    document.getElementById('topbar-title').textContent = h1 ? h1.textContent.trim() : '';
    main.focus({ preventScroll: true });
    main.scrollTop = 0;
    UI.markScrollRegions(main);
    if (UI.enhanceTables) UI.enhanceTables(main);
  };
  window.addEventListener('hashchange', () => {
    if (UI._revert) { UI._revert = false; return; }
    if (UI.dirty && !UI._allowNav && UI._lastHash !== undefined && location.hash !== UI._lastHash) {
      // Back button or typed address: return to the form, then ask.
      const target = location.hash;
      UI._revert = true; location.hash = UI._lastHash;
      UI.confirmLeave(() => { UI._allowNav = true; location.hash = target; });
      return;
    }
    UI._allowNav = false;
    UI.dirty = false; UI.guard.save = null;
    UI.render();
  });
  window.addEventListener('beforeunload', (e) => { if (UI.dirty) { e.preventDefault(); e.returnValue = ''; } });

  UI.onVersionChange = () => {
    UI.book = null;
    document.getElementById('main').innerHTML = '<div class="page"><div class="banner warn">The data was changed by a newer copy of VaultBook in another tab. Reload this page to continue.</div></div>';
  };

  /** Show or hide navigation for features switched in Settings > Features. */
  UI.applyFeatures = () => {
    if (!UI.book) return;
    document.querySelectorAll('[data-feature]').forEach((x) => { x.hidden = !UI.book.feature(x.dataset.feature); });
  };
  /** Page shown when a feature is switched off. */
  UI.featureOff = (el, id, title, what) => {
    el.innerHTML = UI.page(title, '', `<div class="card feature-off"><h2>${esc(title)} is turned off for this company</h2><p>${what}</p>
      <div class="row gap"><button class="btn primary" id="fo-on">Turn on ${esc(title.toLowerCase())}</button><a class="btn" href="#/settings?tab=features">All features</a></div></div>`);
    const key = { classes: 'useClasses', budgets: 'useBudgets', 1099: 'use1099' }[id];
    el.querySelector('#fo-on').addEventListener('click', () => UI.book.saveCompany({ [key]: true }).then(() => { UI.toast(title + ' turned on.'); UI.render(); }, UI.error));
  };

  /* ---------- page skeleton ---------- */
  // 1.50.4: no taglines under page titles. A subtitle shows only when it is information the screen needs ({ html }).
  UI.page = (title, actions, body, sub) => `<div class="page">
    <div class="page-head"><div><h1>${esc(title)}</h1>${sub && sub.html ? `<p class="sub">${sub.html}</p>` : ''}</div><div class="actions">${actions || ''}</div></div>
    ${body}</div>`;
  UI.empty = (msg, action) => `<div class="empty"><p>${msg}</p>${action || ''}</div>`;

  /* ---------- company session ---------- */
  /** Open a company. Password-protected companies show the unlock screen unless the key is supplied. */
  UI.openCompany = (id, key) => (key ? Promise.resolve(null) : OB.db.getSecurity(id)).then((sec) => {
    if (sec) {
      if (UI.book && UI.book.adapter && UI.book.adapter.close) UI.book.adapter.close();
      UI.book = null;
      OB.db.setSetting('lastCompany', id).catch(() => {});
      return UI.showUnlock(id, sec);
    }
    return OB.db.loadCompany(id, key).then((book) => {
      if (UI.book && UI.book.adapter && UI.book.adapter.close) UI.book.adapter.close();
      UI.book = book;
      OB.db.setSetting('lastCompany', id).catch(() => {});
      if (book.migratedFrom) UI.toast('Company data upgraded from format v' + book.migratedFrom + '.');
      if (UI._setLastActivity) UI._setLastActivity(Date.now());
      // reopening after a reload/restart returns to the page you were on
      const resume = UI._resumeHash; UI._resumeHash = null;
      location.hash = resume && /^#\/[a-z]/.test(resume) && !/^#\/txn\/new/.test(resume) ? resume : '#/dashboard';
      UI.render();
    });
  });
  UI.closeCompany = () => {
    if (UI.book && UI.book.adapter) { UI.book.adapter.key = null; if (UI.book.adapter.close) UI.book.adapter.close(); }
    if (UI.book) UI.book.dek = null;
    UI.book = null;
    OB.db.setSetting('lastCompany', '').catch(() => {});
    location.hash = '#/';
    UI.render();
  };

  /* ---------- New-transaction menu ---------- */
  UI.newMenu = () => {
    const groups = [
      ['Customers', ['estimate', 'salesOrder', 'invoice', 'payment', 'salesReceipt', 'creditMemo', 'customerRefund']],
      ['Vendors', ['purchaseOrder', 'bill', 'billPayment', 'expense', 'check', 'vendorCredit', 'vendorRefund', 'ccCredit']],
      ['Other', ['deposit', 'transfer', 'journal']]
    ];
    const html = '<div class="newmenu">' + groups.map((g) => `<div><h3>${g[0]}</h3>${g[1].map((t) => `<a href="#/txn/new?type=${t}" data-close>${UI.typeLabel(t)}</a>`).join('')}</div>`).join('') + '</div>';
    UI.modal({ title: 'Create', html, wide: true, actions: [{ label: 'Close', value: null }], onMount: (m, close) => m.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) close(null); }) });
  };

  /** Tables that scroll sideways (phones) must be reachable by keyboard: make them focusable regions. */
  UI.markScrollRegions = (root) => {
    (root || document).querySelectorAll('table.data, .scroll-x').forEach((t) => {
      const ox = getComputedStyle(t).overflowX;   // only containers that actually scroll are regions
      const scrolls = (ox === 'auto' || ox === 'scroll') && t.scrollWidth > t.clientWidth + 1;
      if (scrolls && !t.hasAttribute('tabindex')) {
        t.setAttribute('tabindex', '0'); t.setAttribute('role', t.tagName === 'TABLE' ? 'table' : 'region');
        const h = t.closest('section, .page'); const title = h && h.querySelector('h2, h1');
        t.setAttribute('aria-label', (title ? title.textContent.trim() + ' — ' : '') + 'scrollable table');
      } else if (!scrolls && t.getAttribute('tabindex') === '0') { t.removeAttribute('tabindex'); t.removeAttribute('aria-label'); t.removeAttribute('role'); }
    });
  };
  let resizeT = null;
  window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(() => UI.markScrollRegions(document.getElementById('main')), 150); });

  /* ---------- appearance ---------- */
  const sysDark = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : { matches: false };
  UI.effectiveTheme = () => UI.theme === 'light' || UI.theme === 'dark' ? UI.theme : (sysDark.matches ? 'dark' : 'light');
  UI.setTheme = (t, persist) => {
    const root = document.documentElement;
    if (t === 'light' || t === 'dark') root.dataset.theme = t; else delete root.dataset.theme;
    UI.theme = t === 'light' || t === 'dark' ? t : 'system';
    if (persist) OB.prefs.set('theme', UI.theme);
    const btn = document.getElementById('theme-toggle');
    if (btn) {
      const dark = UI.effectiveTheme() === 'dark', label = dark ? 'Switch to light appearance' : 'Switch to dark appearance';
      btn.dataset.mode = dark ? 'dark' : 'light'; btn.setAttribute('aria-label', label); btn.title = label;
    }
    document.querySelectorAll('[data-theme-opt]').forEach((x) => x.setAttribute('aria-checked', String(x.dataset.themeOpt === UI.theme)));
  };
  UI.toggleTheme = () => UI.setTheme(UI.effectiveTheme() === 'dark' ? 'light' : 'dark', true);
  if (sysDark.addEventListener) sysDark.addEventListener('change', () => UI.setTheme(UI.theme));
  UI.setDensity = (d) => {
    d = d === 'compact' ? 'compact' : 'comfortable';
    if (d === 'compact') document.documentElement.dataset.density = 'compact'; else delete document.documentElement.dataset.density;
    OB.prefs.set('density', d);
    document.querySelectorAll('[data-density-opt]').forEach((x) => x.setAttribute('aria-checked', String(x.dataset.densityOpt === d)));
    if (UI.enhanceTables) UI.enhanceTables(document.getElementById('main'), true); // row heights changed: remeasure
  };
  const narrow = () => window.matchMedia && window.matchMedia('(max-width: 760px)').matches;
  UI.setSidebar = (collapsed) => {
    document.documentElement.classList.toggle('sidebar-collapsed', collapsed);
    OB.prefs.set('sidebarCollapsed', collapsed);
    const b = document.getElementById('nav-toggle');
    b.setAttribute('aria-expanded', String(!collapsed));
    const l = collapsed ? 'Show sidebar' : 'Hide sidebar'; b.setAttribute('aria-label', l); b.title = l;
  };
  // paper is white: always print with the light palette
  window.addEventListener('beforeprint', () => { UI._printTheme = document.documentElement.dataset.theme; document.documentElement.dataset.theme = 'light'; });
  window.addEventListener('afterprint', () => UI.setTheme(UI._printTheme || UI.theme));

  /* ---------- startup ---------- */
  UI.start = () => {
    UI._resumeHash = location.hash;
    UI.setTheme(OB.prefs.get('theme'));
    if (!OB.prefs.isPersistent()) setTimeout(() => UI.toast('This browser blocks saving preferences; appearance settings will reset next time.', 'error'), 1500);
    // one-time move of the 1.4 appearance setting from IndexedDB into preferences
    if (OB.prefs.get('theme') === 'system') OB.db.getSetting('theme').then((t) => { if (t === 'light' || t === 'dark') UI.setTheme(t, true); }).catch(() => {});
    document.getElementById('theme-toggle').addEventListener('click', UI.toggleTheme);
    document.getElementById('top-search').addEventListener('click', () => UI.openPalette());
    UI.setSidebar(!!OB.prefs.get('sidebarCollapsed'));
    document.getElementById('btn-search').addEventListener('click', () => UI.openPalette());
    document.getElementById('btn-switch').addEventListener('click', () => UI.confirmLeave(UI.closeCompany));
    document.getElementById('btn-lock').addEventListener('click', () => UI.confirmLeave(() => UI.lock('manual')));
    document.getElementById('nav-toggle').addEventListener('click', () => {
      if (narrow()) document.body.classList.toggle('nav-open');      // phones: slide-over menu
      else UI.setSidebar(!document.documentElement.classList.contains('sidebar-collapsed'));
    });
    document.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === '\\' ) { e.preventDefault(); document.getElementById('nav-toggle').click(); } });
    document.querySelector('.nav').addEventListener('click', (e) => { if (e.target.closest('a')) document.body.classList.remove('nav-open'); });
    document.addEventListener('keydown', (e) => {
      if (e.altKey && (e.key === 'n' || e.key === 'N') && UI.book) { e.preventDefault(); UI.newMenu(); }
    });
    const main = document.getElementById('main');
    if (!OB.db.available()) {
      main.innerHTML = `<div class="page"><div class="banner danger"><strong>This browser does not allow local storage for files opened from disk.</strong><br>
        Open <code>index.html</code> with Google Chrome or Microsoft Edge on Windows 11. If you use a private/InPrivate window, data cannot be kept — use a normal window.</div></div>`;
      return;
    }
    OB.db.listCompanies().then((list) => OB.db.getSetting('lastCompany').then((last) => {
      if (last && list.some((c) => c.id === last)) return UI.openCompany(last);
      UI.render();
    })).catch((e) => {
      main.innerHTML = `<div class="page"><div class="banner danger"><strong>Local storage could not be opened.</strong><br>${esc(e.message)}<br><br>
        Use Chrome or Edge in a normal (not InPrivate/Incognito) window, and make sure site data is not blocked for local files.</div></div>`;
    });
  };
})();
