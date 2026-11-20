/* OfflineBooks US — financial table enhancements.
 * Any <table data-tkey="report:gl" data-sticky="1"> gets:
 *   - resizable columns (drag the header edge, or focus it and use ←/→; double-click resets),
 *   - a Columns menu to show/hide columns (the key column can't be hidden),
 *   - sticky key columns on the left (data-sticky = how many),
 * and all tables sharing a key share one layout (so every General Ledger section lines up).
 * Layouts persist per table type in OB.prefs. Columns are identified by their header text.
 */
(function () {
  'use strict';
  const U = OB.util, UI = OB.ui, esc = U.esc;
  const MIN = 48, MAX_DEFAULT = 420;

  const headCells = (t) => { const r = t.tHead && t.tHead.rows[t.tHead.rows.length - 1]; return r ? [...r.cells] : []; };
  const labelOf = (th, i) => (th.dataset.col || th.textContent || '').trim() || 'col' + i;

  /** Enhance every keyed table under root. force = remeasure (e.g. after density change). */
  UI.enhanceTables = (root, force) => {
    const groups = {};
    (root || document).querySelectorAll('table[data-tkey]').forEach((t) => { (groups[t.dataset.tkey] = groups[t.dataset.tkey] || []).push(t); });
    Object.keys(groups).forEach((k) => setup(k, groups[k], !!force));
  };

  function setup(key, tables, force) {
    const first = tables[0], ths = headCells(first);
    if (!ths.length) return;
    const labels = ths.map(labelOf);
    const sticky = Math.max(0, +first.dataset.sticky || 0);
    const pref = OB.prefs.table(key);
    // natural widths: measure in auto layout, widest across all tables of this type
    if (force) tables.forEach((t) => { t.style.tableLayout = ''; t.style.width = ''; const cg = t.querySelector('colgroup.tw'); if (cg) cg.remove(); });
    const natural = labels.map(() => 0);
    tables.forEach((t) => headCells(t).forEach((th, i) => { if (i < natural.length) natural[i] = Math.max(natural[i], Math.min(MAX_DEFAULT, Math.ceil(th.getBoundingClientRect().width))); }));
    const g = { key, tables, labels, sticky, natural, pref };
    tables.forEach((t) => {
      t.classList.add('tbl');
      if (!t.querySelector('colgroup.tw')) {
        const cg = document.createElement('colgroup'); cg.className = 'tw';
        labels.forEach(() => cg.appendChild(document.createElement('col')));
        t.insertBefore(cg, t.firstChild);
      }
      headCells(t).forEach((th, i) => {
        if (th.querySelector('.col-resizer')) return;
        const h = document.createElement('span');
        h.className = 'col-resizer'; h.tabIndex = 0;
        h.setAttribute('role', 'separator'); h.setAttribute('aria-orientation', 'vertical');
        h.setAttribute('aria-label', 'Resize column ' + labels[i] + ' (left and right arrows)');
        h.setAttribute('aria-valuemin', MIN);
        th.appendChild(h);
        bindResizer(h, g, i);
      });
    });
    apply(g);
    const btn = document.querySelector(`[data-columns-for="${CSS.escape(key)}"]`);
    if (btn) {
      btn._group = g;
      if (!btn.dataset.bound) { btn.dataset.bound = '1'; btn.addEventListener('click', () => columnsMenu(g, btn)); }
    }
  }

  const widthOf = (g, i) => Math.max(MIN, +g.pref.widths[g.labels[i]] || g.natural[i] || 120);
  const hidden = (g, i) => i >= Math.max(1, g.sticky) && g.pref.hidden.indexOf(g.labels[i]) >= 0;

  /** Write widths, visibility and sticky offsets to every table in the group. */
  function apply(g) {
    let total = 0;
    const lefts = [];
    g.labels.forEach((l, i) => { lefts[i] = total; if (!hidden(g, i)) total += widthOf(g, i); });
    g.tables.forEach((t) => {
      const cols = t.querySelector('colgroup.tw').children;
      g.labels.forEach((l, i) => {
        const c = cols[i]; if (!c) return;
        c.style.width = widthOf(g, i) + 'px';
        c.style.visibility = hidden(g, i) ? 'collapse' : '';
      });
      t.style.tableLayout = 'fixed';
      t.style.width = total + 'px';
      for (let i = 0; i < g.sticky; i++) t.style.setProperty('--sl' + i, lefts[i] + 'px');
      if (g.sticky && !t.dataset.stickyMarked) {
        // mark key-column cells once (cells whose start column is < sticky)
        [...t.rows].forEach((row) => {
          let col = 0;
          // pin only cells that fit inside the key columns; a wide label cell (colspan) scrolls normally
          [...row.cells].forEach((cell) => { const span = cell.colSpan || 1; if (col + span <= g.sticky) cell.classList.add('kc', 'kc' + col); col += span; });
        });
        t.dataset.stickyMarked = '1';
      }
      headCells(t).forEach((th, i) => { const r = th.querySelector('.col-resizer'); if (r) r.setAttribute('aria-valuenow', widthOf(g, i)); });
    });
  }

  function bindResizer(h, g, i) {
    h.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      const x0 = e.clientX, w0 = widthOf(g, i);
      h.setPointerCapture(e.pointerId);
      document.documentElement.classList.add('col-resizing');
      const move = (ev) => { g.pref.widths[g.labels[i]] = Math.max(MIN, Math.round(w0 + ev.clientX - x0)); apply(g); };
      const up = () => {
        h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up); h.removeEventListener('pointercancel', up);
        document.documentElement.classList.remove('col-resizing');
        OB.prefs.saveTable(g.key, g.pref);
      };
      h.addEventListener('pointermove', move); h.addEventListener('pointerup', up); h.addEventListener('pointercancel', up);
    });
    h.addEventListener('click', (e) => e.stopPropagation());
    h.addEventListener('dblclick', (e) => { e.stopPropagation(); delete g.pref.widths[g.labels[i]]; apply(g); OB.prefs.saveTable(g.key, g.pref); });
    h.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 48 : 16;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      g.pref.widths[g.labels[i]] = Math.max(MIN, widthOf(g, i) + (e.key === 'ArrowRight' ? step : -step));
      apply(g); OB.prefs.saveTable(g.key, g.pref);
    });
  }

  /** Popover with a checkbox per column. */
  function columnsMenu(gIn, btn) {
    const g = btn._group || gIn; // latest group (tables are rebuilt on every render)
    const old = document.querySelector('.cols-pop'); if (old) { old.remove(); if (old._for === btn) return; }
    const pop = document.createElement('div');
    pop.className = 'cols-pop'; pop._for = btn;
    pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Show or hide columns');
    pop.innerHTML = `<div class="cols-head">Columns</div>${g.labels.map((l, i) => `<label class="check"><input type="checkbox" data-i="${i}" ${hidden(g, i) ? '' : 'checked'} ${i < Math.max(1, g.sticky) ? 'disabled' : ''}> ${esc(l)}</label>`).join('')}
      <div class="cols-foot"><button type="button" class="btn ghost small" data-reset>Reset layout</button></div>`;
    document.body.appendChild(pop);
    const r = btn.getBoundingClientRect();
    pop.style.top = (r.bottom + 6) + 'px';
    pop.style.left = Math.max(8, Math.min(r.right - pop.offsetWidth, innerWidth - pop.offsetWidth - 8)) + 'px';
    pop.addEventListener('change', (e) => {
      const i = +e.target.dataset.i, l = g.labels[i];
      g.pref.hidden = g.pref.hidden.filter((x) => x !== l);
      if (!e.target.checked) g.pref.hidden.push(l);
      apply(g); OB.prefs.saveTable(g.key, g.pref);
    });
    pop.querySelector('[data-reset]').addEventListener('click', () => {
      g.pref.widths = {}; g.pref.hidden = []; apply(g); OB.prefs.saveTable(g.key, g.pref);
      pop.querySelectorAll('input[data-i]').forEach((c) => { c.checked = true; });
    });
    const close = (e) => {
      if (e.type === 'keydown' && e.key !== 'Escape') return;
      if (e.type === 'mousedown' && (pop.contains(e.target) || btn.contains(e.target))) return;
      pop.remove(); document.removeEventListener('mousedown', close, true); document.removeEventListener('keydown', close, true);
      if (e.type === 'keydown') btn.focus();
    };
    document.addEventListener('mousedown', close, true); document.addEventListener('keydown', close, true);
    const f = pop.querySelector('input:not([disabled])'); if (f) f.focus();
  }
  window.addEventListener('hashchange', () => { const p = document.querySelector('.cols-pop'); if (p) p.remove(); });

  /** Turn a list page into a fill page: header and filters stay, the table scrolls in place. */
  UI.fillLayout = (el, tableSel, key, sticky) => {
    const page = el.querySelector('.page'), t = el.querySelector(tableSel);
    if (!page || !t) return;
    page.classList.add('fill');
    const w = document.createElement('div');
    w.className = 'scroll-area table-wrap';
    t.parentNode.insertBefore(w, t); w.appendChild(t);
    if (key) { t.dataset.tkey = key; t.dataset.sticky = sticky || 1; }
  };
  UI.columnsButton = (key) => `<button type="button" class="btn" data-columns-for="${esc(key)}" aria-haspopup="dialog">Columns</button>`;
})();
