/* OfflineBooks US — financial statement screen (Profit and Loss, Balance Sheet, Budget vs. Actuals).
 * Modeled on QuickBooks Online's modern report view:
 *   top bar  — Report period, From/To, Cash|Accrual, Display columns by, Compare to, Customize, Save As
 *   frame    — density + zoom + Expand/Collapse all menu, refresh, print, export
 *   table    — grouped column headers, collapsible groups at every level (a collapsed group shows its total),
 *              "Total" lines, column sorting, drill-down on every amount
 *   Customize (Data / Visual) — filters, active/all/non-zero rows and columns, number format,
 *              section titles, header/footer content and alignment, empty cells, banded rows, gridlines.
 * All options live in the URL, so a customized report can be bookmarked or saved by name.
 */
(function () {
  'use strict';
  const U = OB.util, S = OB.schema, R = OB.reports, UI = OB.ui, esc = U.esc;

  const KINDS = { pnl: 'pl', bs: 'bs', bva: 'bva' };
  const TITLES = { pnl: 'Profit and Loss', bs: 'Balance Sheet', bva: 'Budget vs. Actuals' };
  const BY = [['total', 'Total'], ['day', 'Days'], ['week', 'Weeks'], ['month', 'Months'], ['quarter', 'Quarters'], ['year', 'Years'], ['class', 'Class'], ['customer', 'Customer'], ['vendor', 'Vendor']];
  const CMP_TIME = { pl: ['py', 'pp', 'mtd', 'qtd', 'ytd', 'pyytd'], bs: ['py', 'pp'], bva: [] };
  const CMP_CALC = { pl: ['chg', 'pchg', 'row', 'col', 'inc', 'exp'], bs: ['chg', 'pchg', 'row', 'col'], bva: ['row', 'col', 'inc', 'exp'] };
  const VIEW = { density: ['compact', 'normal', 'cozy', 'comfort'], zoom: [75, 90, 100, 125, 150] };
  const RM = OB.reportModel;
  const DENSITY_LABEL = { compact: 'Compact', normal: 'Normal', cozy: 'Cozy', comfort: 'Comfort' };
  const SECTION_KEYS = {
    pl: R.PL_SECTION_TITLES,
    bva: R.PL_SECTION_TITLES,
    bs: [['assets', 'ASSETS'], ['ca', 'Current Assets'], ['bank', 'Checking/Savings'], ['ar', 'Accounts Receivable'], ['oca', 'Other Current Assets'], ['fa', 'Fixed Assets'], ['oa', 'Other Assets'], ['le', 'LIABILITIES & EQUITY'], ['liab', 'Liabilities'], ['cl', 'Current Liabilities'], ['ap', 'Accounts Payable'], ['cc', 'Credit Cards'], ['ocl', 'Other Current Liabilities'], ['ltl', 'Long-Term Liabilities'], ['equity', 'Equity']]
  };
  const HIDE_KEYS = ['co', 'title', 'period', 'date', 'time', 'basis'];
  const collapsedByReport = {};   // report key -> { nodeKey: true } (kept while the app is open)
  const view = () => Object.assign({ density: 'compact', zoom: 'fit', hdr: 'full', headCollapsed: false }, OB.prefs.get('stmtView') || {});

  UI.isStatement = (key) => !!KINDS[key];

  /* ---------- parameters ---------- */
  function normalizeParams(key, raw) {
    const b = UI.book, p = Object.assign({}, raw), ranges = UI.ranges();
    if (key === 'bs' && p.asOf && !p.to) { p.range = 'custom'; p.to = p.asOf; p.from = U.fiscalYearStart(p.asOf, b.company.fiscalYearStartMonth); }
    if (key === 'bs' && p.compare && !p.cmp) p.cmp = p.compare === 'm12' ? '' : p.compare === 'pm' ? 'pp' : p.compare;   // old links
    if (key === 'pnl' && p.columns && !p.by) { if (p.columns === 'py') p.cmp = 'py,chg,pchg'; else p.by = p.columns; }
    p.range = p.range || UI.defaultRange(key === 'bva' ? 'thisFY' : 'fyToDate');
    if (p.range !== 'custom' && ranges[p.range]) { p.from = ranges[p.range][1]; p.to = ranges[p.range][2]; }
    if (!U.isDate(p.from) || !U.isDate(p.to)) { p.from = ranges.fyToDate[1]; p.to = ranges.fyToDate[2]; p.range = 'fyToDate'; }
    if (p.range === 'all' && key === 'bs') p.to = UI.workDate();
    p.basis = p.basis === 'cash' || p.basis === 'accrual' ? p.basis : b.company.basis;
    p.by = BY.some((x) => x[0] === p.by) ? p.by : 'total';
    if (key === 'bs' && ['class', 'customer', 'vendor'].indexOf(p.by) >= 0) p.by = 'total';
    p.cmpList = (p.cmp || '').split(',').filter(Boolean);
    p.hideList = (p.hide || '').split(',').filter(Boolean);
    return p;
  }
  const paramString = (p) => {
    const keep = Object.assign({}, p); delete keep.cmpList; delete keep.hideList; delete keep.saved;
    if (keep.range !== 'custom') { delete keep.from; delete keep.to; }
    Object.keys(keep).forEach((k) => { if (keep[k] === '' || keep[k] === undefined || keep[k] === null) delete keep[k]; });
    return UI.qs(keep);
  };

  /* ---------- number formatting ---------- */
  /* screen text comes from the shared formatter, so PDF and screen show identical figures */
  function fmt(v, p, opts) {
    const s = OB.reportModel.fmtNumber(v, p, opts);
    return s && !opts.pct && !opts.ratio && v < 0 && p.red === '1' ? `<span class="neg-red">${s}</span>` : s;
  }
  const plain = (v, opts) => (v === null || v === undefined || (v === 0 && opts.empty)) ? '' : opts.pct ? (isFinite(v) ? (Math.round(v * 10) / 10).toFixed(1) + '%' : '') : UI.m(v, opts.bold);

  /* ---------- page ---------- */
  UI.renderStatementPage = (el, key, rawParams) => {
    const b = UI.book, kind = KINDS[key];
    const p = normalizeParams(key, rawParams);
    const saved = rawParams.saved ? b.reports.find((x) => x.id === rawParams.saved && !x.deleted) : null;
    if (kind === 'bva' && !b.activeBudgets().length) {
      el.innerHTML = UI.page('Budget vs. Actuals', '', UI.empty('Create a budget first. Budgets set monthly targets for income and expense accounts; this report compares them with your actual results.', '<a class="btn primary" href="#/budgets">Go to Budgets</a>'));
      return;
    }
    const titles = {}; Object.keys(p).forEach((k) => { if (k.indexOf('t_') === 0 && p[k]) titles[k.slice(2)] = p[k]; });
    const t0 = performance.now();
    let st;
    try {
      st = R.statement(b, { kind, from: p.from, to: p.to, basis: p.basis, columns: p.by, compare: p.cmpList, classId: p.class || '', contactId: p.contact || undefined,
        accountTypes: p.atypes ? p.atypes.split(',') : null, budgetId: p.budget, rows: p.rows || 'active', cols: p.cols || 'active', titles });
    } catch (e) { console.error(e); el.innerHTML = UI.page(TITLES[key], '', `<div class="banner danger">${esc(e.message)}</div>`); return; }
    const ms = Math.round(performance.now() - t0);
    const title = p.title || (saved ? saved.name : TITLES[key]);
    const ranges = UI.ranges();
    const v = view();
    const vbudget = kind === 'bva' ? st.budget : null;
    const classOpts = b.classes.length ? `<label class="sb-f"><span>Class</span><select id="st-class"><option value="">All classes</option><option value="__none"${p.class === '__none' ? ' selected' : ''}>Not specified</option>${b.sortedClasses().map((c) => `<option value="${esc(c.id)}"${p.class === c.id ? ' selected' : ''}>${esc(b.classFullName(c.id))}${c.active === false ? ' (inactive)' : ''}</option>`).join('')}</select></label>` : '';
    const periodText = kind === 'bs' ? 'As of ' + longDate(p.to) : (p.range === 'all' ? 'All dates' : longRange(p.from, p.to));
    const cmpCount = p.cmpList.length;

    const byLabel = (BY.find((x) => x[0] === p.by) || BY[0])[1];
    const chips = [kind === 'bs' ? periodText : (p.range === 'custom' ? periodText : (ranges[p.range] ? ranges[p.range][0] : periodText)), p.basis === 'cash' ? 'Cash' : 'Accrual',
      p.by !== 'total' ? 'By ' + byLabel.toLowerCase() : '', cmpCount ? 'Compare: ' + p.cmpList.map((c) => R.COMPARE_LABELS[c].replace(/ \(.*\)$/, '')).join(', ') : '',
      p.class ? 'Class: ' + (p.class === '__none' ? 'Not specified' : b.classFullName(p.class)) : '', vbudget ? vbudget.name : ''].filter(Boolean);
    const icon = (d) => `<svg viewBox="0 0 20 20" width="17" height="17" aria-hidden="true">${d}</svg>`;
    const zoomLabel = v.zoom === 'fit' ? 'Fit' : v.zoom + '%';
    const lineHdr = v.hdr === 'line', corner = !p.falign || p.falign === 'corner';
    // layout: the company's choice (Settings > Company) unless one of the quick buttons on the report overrides it
    // A quick-button choice is kept only while the company layout it replaced stays the same: changing the setting always shows.
    const coLook = RM.lookOf(b.company.statementLook), pick = OB.prefs.get('stmtLook'), look = pick && pick.co === coLook && pick.k ? RM.lookOf(pick.k) : coLook;
    const lookName = (k) => RM.LOOKS.find((x) => x[0] === k)[1];
    const lookBtns = RM.MAJOR_LOOKS.concat(RM.MAJOR_LOOKS.indexOf(coLook) < 0 ? [coLook] : []);
    const modern = OB.prefs.get('reportLayout') !== 'classic', chartOn = !!OB.prefs.get('reportChart');

    el.innerHTML = `<div class="page report-page sb-page fill${v.headCollapsed ? ' sb-collapsed' : ''}" data-report="${esc(key)}">
      <div class="sb-head no-print">
        <div class="sb-titlebar sb-qbbar" role="toolbar" aria-label="${esc(title)}">
          <a href="#/reports" class="sb-back" title="Back to reports" aria-label="Back to reports">‹</a>
          <h1 class="sr-only">${esc(title)}</h1>${saved ? `<span class="sb-tag" title="Saved report based on ${esc(TITLES[key])}">${esc(title)}</span>` : ''}
${modern ? `          <span class="sb-rtitle" aria-hidden="true">${esc(title)}</span>
          <span class="spacer"></span>
          <button type="button" class="btn small${chartOn ? ' on' : ''}" id="st-chart" aria-pressed="${chartOn}" data-testid="st-chart-btn" title="Show a chart above the report">Chart</button>
          <button type="button" class="btn small" id="st-customize" data-key="u" data-testid="st-customize">Customize</button>
          <button type="button" class="btn small" id="st-save" data-key="s">${saved ? 'Save' : 'Save customization'}</button>
          <button type="button" class="icon-btn" id="st-print" data-key="p" title="Print" aria-label="Print">${icon('<path d="M5.5 7.5V3h9v4.5M5.5 14H3.5v-6.5h13V14h-2" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="5.5" y="11.5" width="9" height="5.5" fill="none" stroke="currentColor" stroke-width="1.5"/>')}</button>
          <div class="sb-tools">
            <div class="menu-wrap"><button type="button" class="icon-btn" id="st-export" aria-haspopup="menu" aria-expanded="false" title="Export" aria-label="Export">${icon('<path d="M10 3v9M6.5 8.5 10 12l3.5-3.5M4 14.5v2h12v-2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>')}</button>
              <div class="menu" role="menu" hidden><button type="button" role="menuitem" data-x="xlsx" data-key="e">Export to Excel</button><button type="button" role="menuitem" data-x="pdf">Export to PDF</button><button type="button" role="menuitem" data-x="csv">Export to CSV</button></div></div>
          </div>
` : `          <button type="button" class="qb-btn" id="st-customize" data-key="u">Customize Report</button>
          <button type="button" class="qb-btn" data-more="note">${p.note ? 'Edit Comment' : 'Comment on Report'}</button>
          <button type="button" class="qb-btn" id="st-save" data-key="s">${saved ? 'Save' : 'Memorize'}</button>
          <span class="qb-sep"></span>
          <button type="button" class="qb-btn" id="st-print" data-key="p">Print</button>
          <div class="sb-tools">
            <div class="menu-wrap"><button type="button" class="qb-btn" id="st-export" aria-haspopup="menu" aria-expanded="false">Excel ▾</button>
              <div class="menu" role="menu" hidden><button type="button" role="menuitem" data-x="xlsx" data-key="e">Export to Excel</button><button type="button" role="menuitem" data-x="pdf">Export to PDF</button><button type="button" role="menuitem" data-x="csv">Export to CSV</button><button type="button" role="menuitem" data-x="print">Print…</button></div></div>
          </div>
          <span class="qb-sep"></span>
          <button type="button" class="qb-btn" id="st-hdr" aria-pressed="${v.hdr === 'none'}">${v.hdr === 'none' ? 'Show Header' : 'Hide Header'}</button>
          <button type="button" class="qb-btn" id="st-rows">Collapse Rows</button>
          <button type="button" class="qb-btn" id="st-refresh">Refresh</button>
`}          <span class="spacer"></span>
          <div class="sb-tools">
            <div class="menu-wrap sb-view"><button type="button" class="qb-btn" id="st-view" aria-haspopup="menu" aria-expanded="false" title="View: density, zoom, heading">${DENSITY_LABEL[v.density]} · ${zoomLabel} ▾</button>
              <div class="menu" role="menu" hidden id="st-view-menu">
                <div class="menu-h">Row density</div>${VIEW.density.map((d) => `<button type="button" role="menuitemradio" aria-checked="${v.density === d}" data-density="${d}">${DENSITY_LABEL[d]}</button>`).join('')}<hr>
                <div class="menu-h">Zoom</div><button type="button" role="menuitemradio" aria-checked="${v.zoom === 'fit'}" data-zoom="fit">Fit to width</button>${VIEW.zoom.map((z) => `<button type="button" role="menuitemradio" aria-checked="${v.zoom === z}" data-zoom="${z}">${z}%</button>`).join('')}<hr>
                <div class="menu-h">Report heading on screen</div><button type="button" role="menuitemradio" aria-checked="${v.hdr === 'full'}" data-hdr="full">Full, as printed</button><button type="button" role="menuitemradio" aria-checked="${v.hdr === 'line'}" data-hdr="line">One line (saves space)</button><button type="button" role="menuitemradio" aria-checked="${v.hdr === 'none'}" data-hdr="none">Hidden</button><hr>
                <button type="button" role="menuitem" data-coll="expand">Expand all rows</button><button type="button" role="menuitem" data-coll="lv2">Show two levels</button><button type="button" role="menuitem" data-coll="collapse">Collapse all rows</button>
              </div></div>
            <div class="menu-wrap"><button type="button" class="icon-btn" id="st-more" aria-haspopup="menu" aria-expanded="false" title="More" aria-label="More">${icon('<circle cx="10" cy="4.5" r="1.5"/><circle cx="10" cy="10" r="1.5"/><circle cx="10" cy="15.5" r="1.5"/>')}</button>
              <div class="menu" role="menu" hidden><button type="button" role="menuitem" data-more="saveas">Save as new report…</button>${saved ? '<button type="button" role="menuitem" data-more="rename">Rename saved report…</button>' : ''}<button type="button" role="menuitem" data-more="reset">Reset customizations</button>${modern ? `<hr><button type="button" role="menuitem" data-more="note">${p.note ? 'Edit comment' : 'Comment on report'}</button><button type="button" role="menuitem" id="st-hdr" aria-pressed="${v.hdr === 'none'}">${v.hdr === 'none' ? 'Show header' : 'Hide header'}</button><button type="button" role="menuitem" id="st-rows">Collapse rows</button><button type="button" role="menuitem" id="st-refresh">Refresh</button>` : ''}<hr><button type="button" role="menuitem" data-more="layout" data-testid="st-layout">${modern ? 'Classic layout (QuickBooks Desktop toolbar)' : 'Modern layout (slim bar and Customize panel)'}</button></div></div>
          </div>
          <button type="button" class="icon-btn" id="st-focus" aria-pressed="${!!UI._stmtFocus}" title="${UI._stmtFocus ? 'Exit full screen (Esc)' : 'Full screen: hide menus and give the report the whole window'}" aria-label="Full screen report">${icon(UI._stmtFocus ? '<path d="M8 3v5H3M12 3v5h5M8 17v-5H3M12 17v-5h5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>' : '<path d="M3 8V3h5M17 8V3h-5M3 12v5h5M17 12v5h-5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>')}</button>
          <button type="button" class="icon-btn sb-collapse" id="st-collapse" aria-expanded="${!v.headCollapsed}" aria-controls="st-form" title="${v.headCollapsed ? 'Show report options' : 'Hide report options'}" aria-label="${v.headCollapsed ? 'Show report options' : 'Hide report options'}">${icon('<path d="M5 12.5l5-5 5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>')}</button>
        </div>
        <button type="button" class="sb-chips" id="st-chips" aria-label="Show report options" title="Show report options"${v.headCollapsed ? '' : ' hidden'}>${chips.map((c) => `<span>${esc(c)}</span>`).join('')}</button>
        <form class="sb-bar sb-inline" id="st-form" autocomplete="off"${v.headCollapsed ? ' hidden' : ''}>
          <label class="sb-f"><span>Dates</span>${UI.rangeSelect('st-range', p.range)}</label>
          ${kind === 'bs' ? '' : `<label class="sb-f"><span>From</span><input type="date" id="st-from" value="${esc(p.from)}"></label>`}
          <label class="sb-f"><span>${kind === 'bs' ? 'As of' : 'To'}</span><input type="date" id="st-to" value="${esc(p.to)}"></label>
          <label class="sb-f"><span>Show Columns</span><select id="st-by">${BY.filter((x) => (kind !== 'bs' || ['class', 'customer', 'vendor'].indexOf(x[0]) < 0) && (x[0] !== 'class' || b.feature('classes') || p.by === 'class')).map(([k, l]) => `<option value="${k}"${p.by === k ? ' selected' : ''}>${k === 'total' ? 'Total only' : l}</option>`).join('')}</select></label>
          ${kind === 'bva' ? `<label class="sb-f"><span>Budget</span><select id="st-budget">${b.activeBudgets().map((x) => `<option value="${esc(x.id)}"${vbudget && vbudget.id === x.id ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>` : ''}
          <div class="sb-f sb-cmp"><span id="st-cmp-l">${kind === 'bva' ? 'Show' : 'Compare to'}</span>
            <button type="button" class="sb-select" id="st-cmp" aria-haspopup="true" aria-expanded="false" aria-labelledby="st-cmp-l st-cmp">${cmpCount ? (cmpCount === 1 ? esc(R.COMPARE_LABELS[p.cmpList[0]]) : 'Multiple (' + cmpCount + ')') : '<span class="muted">None</span>'}</button>
            <div class="sb-pop" id="st-cmp-pop" hidden>
              ${CMP_TIME[kind].length ? `<div class="sb-pop-h">Time periods</div>${CMP_TIME[kind].map((c) => cmpBox(c, p)).join('')}` : ''}
              <div class="sb-pop-h">Calculations</div>${CMP_CALC[kind].map((c) => cmpBox(c, p)).join('')}
              <p class="muted small">$ and % change compare with the first time period ticked.</p>
            </div></div>
          ${classOpts}
          <div class="sb-f sb-look"><span id="st-look-l">Layout</span><div class="sb-seg" role="radiogroup" aria-labelledby="st-look-l">${lookBtns.map((k) => `<button type="button" role="radio" aria-checked="${look === k}" data-look="${k}"${k === coLook ? ' title="Company layout (Settings > Company)"' : ''}>${esc(lookName(k))}</button>`).join('')}</div></div>
          <div class="sb-f sb-basis"><span id="st-basis-l">Report Basis:</span><div class="qb-radios" role="radiogroup" aria-labelledby="st-basis-l">
            <button type="button" role="radio" aria-checked="${p.basis === 'accrual'}" data-basis="accrual">Accrual</button><button type="button" role="radio" aria-checked="${p.basis === 'cash'}" data-basis="cash">Cash</button></div></div>
        </form>
      </div>
      <div class="sb-frame scroll-area" id="st-frame">
        <article class="report sb-report look-${esc((look === 'two' || look === 'step') && (st.cols.length !== 1 || st.template) ? 'classic' : look)} d-${esc(v.density)}${p.band === '1' ? ' banded' : ''} grid-${esc(p.grid || 'none')}${lineHdr ? ' hdr-line' : ''}" aria-label="${esc(title)}">
          ${v.hdr === 'none' ? '' : `${corner ? `<div class="sb-meta">${metaLines(p)}</div>` : ''}<header class="al-${esc(p.halign || 'center')}">
            ${p.hideList.indexOf('co') < 0 ? `<h2>${esc(b.company.name)}</h2>` : ''}
            ${p.hideList.indexOf('title') < 0 ? `<h1>${esc(title)}</h1>` : ''}
            ${p.hideList.indexOf('period') < 0 ? `<p>${esc(periodText)}${p.class ? ' · Class: ' + esc(p.class === '__none' ? 'Not specified' : b.classFullName(p.class)) : ''}${vbudget ? ' · ' + esc(vbudget.name) : ''}</p>` : ''}
          </header>`}
          ${kind === 'bs' && !st.balanced ? '<div class="banner danger">The balance sheet does not balance. Run Settings → Data integrity.</div>' : ''}
          ${chartOn ? `<div class="sb-chart" id="st-chartbox" data-testid="st-chart">${chartHtml(st)}</div>` : ''}
          <div class="sb-table-wrap" id="st-table"></div>
          ${p.note ? `<div class="sb-note"><strong>Note:</strong> ${esc(p.note)}</div>` : ''}
          ${corner ? '' : `<footer class="al-${esc(p.falign)}">${footerText(p, ms)}</footer>`}
        </article>
      </div></div>`;

    const state = { key, p, st, look, collapsed: collapsedByReport[key + (saved ? ':' + saved.id : '')] = collapsedByReport[key + (saved ? ':' + saved.id : '')] || {}, sort: parseSort(p.sort) };
    const tableHost = el.querySelector('#st-table');
    const frame = el.querySelector('#st-frame'), article = el.querySelector('.sb-report');
    document.documentElement.classList.toggle('sb-focus', !!UI._stmtFocus);
    /* Zoom: a fixed percentage, or "Fit to width" — shrink (never below 50%) until the whole table fits the frame.
       Header, notes and footer stay centered in the visible frame while a wide table scrolls sideways. */
    const fit = () => {
      if (!frame.isConnected) return;
      const vv = view();
      let z = vv.zoom === 'fit' ? 1 : vv.zoom / 100;
      if (vv.zoom === 'fit') {
        article.style.zoom = 1;
        const need = article.scrollWidth, have = frame.clientWidth;
        z = need > have ? Math.max(0.5, Math.floor(have / need * 100) / 100) : 1;
      }
      article.style.zoom = z;
      article.style.setProperty('--frame-w', (frame.clientWidth / z) + 'px');
      const vb = el.querySelector('#st-view'); if (vb && vv.zoom === 'fit') vb.firstChild.nodeValue = DENSITY_LABEL[vv.density] + ' · Fit ' + Math.round(z * 100) + '% ▾';
    };
    const draw = () => { tableHost.innerHTML = tableHtml(state); fit(); if (el.querySelector('#st-rows')) el.querySelector('#st-rows').textContent = Object.keys(state.collapsed).length ? 'Expand Rows' : 'Collapse Rows'; };
    draw();
    if (UI._stmtResize) window.removeEventListener('resize', UI._stmtResize);
    UI._stmtResize = fit; window.addEventListener('resize', fit);
    if (window.ResizeObserver) { if (UI._stmtRO) UI._stmtRO.disconnect(); UI._stmtRO = new ResizeObserver(() => fit()); UI._stmtRO.observe(frame); }
    const setView = (patch) => { OB.prefs.set('stmtView', Object.assign(view(), patch)); };
    const toggleHead = (open) => {
      const pg = el.querySelector('.sb-page'), form = el.querySelector('#st-form'), btn = el.querySelector('#st-collapse');
      open = open === undefined ? form.hidden : open;
      form.hidden = !open; pg.classList.toggle('sb-collapsed', !open);
      el.querySelector('#st-chips').hidden = open;
      btn.setAttribute('aria-expanded', String(open));
      const lbl = open ? 'Hide report options' : 'Show report options'; btn.title = lbl; btn.setAttribute('aria-label', lbl);
      setView({ headCollapsed: !open }); fit();
      if (open) { const f = form.querySelector('select, input'); if (f) f.focus(); }
    };
    el.querySelector('#st-collapse').addEventListener('click', () => toggleHead());
    el.querySelector('#st-chips').addEventListener('click', () => toggleHead(true));
    el.querySelector('#st-focus').addEventListener('click', () => { UI._stmtFocus = !UI._stmtFocus; UI.render(); });


    /* --- interactions --- */
    const nav = (changes) => {
      const np = Object.assign({}, p, changes);
      if (saved) np.saved = saved.id;
      UI.go('#/report/' + key + '?' + paramString(np) + (saved ? '&saved=' + encodeURIComponent(saved.id) : ''));
    };
    const rangeSel = el.querySelector('#st-range');
    rangeSel.addEventListener('change', () => { if (rangeSel.value !== 'custom') nav({ range: rangeSel.value }); });
    ['#st-from', '#st-to'].forEach((sel) => { const x = el.querySelector(sel); if (x) U.dateCommit(x, () => {}, () => {   // apply on Enter, leaving the field or a calendar pick, never mid-typing
      const from = el.querySelector('#st-from') ? el.querySelector('#st-from').value : U.fiscalYearStart(el.querySelector('#st-to').value, b.company.fiscalYearStartMonth);
      const to = el.querySelector('#st-to').value;
      if (!U.isDate(from) || !U.isDate(to) || from > to) return UI.toast('Enter a valid date range.', 'error');
      nav({ range: 'custom', from, to });
    }); });
    el.querySelectorAll('[data-basis]').forEach((x) => x.addEventListener('click', () => nav({ basis: x.dataset.basis })));
    el.querySelector('#st-by').addEventListener('change', (e) => nav({ by: e.target.value }));
    const bsel = el.querySelector('#st-budget'); if (bsel) bsel.addEventListener('change', () => nav({ budget: bsel.value }));
    const csel = el.querySelector('#st-class'); if (csel) csel.addEventListener('change', () => nav({ class: csel.value }));
    el.querySelector('#st-form').addEventListener('submit', (e) => e.preventDefault());
    // TallyPrime-style button panel (F2 Period, Alt+N Auto column, Alt+C New column, Ctrl+B Basis, Alt+F5 Detailed, F12 Configure)
    const byList = BY.filter((x) => (kind !== 'bs' || ['class', 'customer', 'vendor'].indexOf(x[0]) < 0) && (x[0] !== 'class' || b.feature('classes') || p.by === 'class'));
    const allFolded = () => st.tree.some((n) => n.kind === 'group' && n.children.some((c) => c.kind === 'group')) && !!Object.keys(state.collapsed).length;
    UI.reportCtl = { hash: location.hash,
      period: kind === 'bs' ? { asOf: p.to, apply: (d) => nav({ range: 'custom', from: U.fiscalYearStart(d, b.company.fiscalYearStartMonth), to: d }) } : { from: p.from, to: p.to, apply: (f, t) => nav({ range: 'custom', from: f, to: t }) },
      auto: { value: p.by, options: byList.map(([k, l]) => [k, k === 'total' ? 'Total only (no auto column)' : l]), apply: (v) => nav({ by: v }) },
      newcol: { value: p.cmpList.slice(), note: '$ and % change compare with the first period ticked', options: CMP_TIME[kind].map((c) => [c, R.COMPARE_LABELS[c], '', 'Time periods']).concat(CMP_CALC[kind].map((c) => [c, R.COMPARE_LABELS[c], '', 'Calculations'])), apply: (list) => nav({ cmp: list.join(',') }) },
      basis: { value: p.basis, options: [['accrual', 'Accrual', 'Income when invoiced, expenses when billed'], ['cash', 'Cash', 'Income when received, expenses when paid']], apply: (v) => nav({ basis: v }) },
      detail: { on: !Object.keys(state.collapsed).length, apply: () => { el.querySelector('#st-rows').click(); UI.reportCtl.detail.on = !Object.keys(state.collapsed).length; UI.keys.renderPanel(); } } };
    void allFolded;

    // Compare to: multi-select popover, applied when it closes (like QuickBooks)
    const cmpBtn = el.querySelector('#st-cmp'), cmpPop = el.querySelector('#st-cmp-pop');
    const closeCmp = (apply) => {
      if (cmpPop.hidden) return;
      cmpPop.hidden = true; cmpBtn.setAttribute('aria-expanded', 'false');
      document.removeEventListener('mousedown', outside, true);
      if (!apply) return;
      const list = [...cmpPop.querySelectorAll('input:checked')].map((x) => x.value);
      if (list.join(',') !== p.cmpList.join(',')) nav({ cmp: list.join(',') });
    };
    const outside = (e) => { if (!cmpPop.contains(e.target) && e.target !== cmpBtn) closeCmp(true); };
    cmpBtn.addEventListener('click', () => {
      if (!cmpPop.hidden) return closeCmp(true);
      cmpPop.hidden = false; cmpBtn.setAttribute('aria-expanded', 'true');
      document.addEventListener('mousedown', outside, true);
      const f = cmpPop.querySelector('input'); if (f) f.focus();
    });
    cmpPop.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeCmp(true); cmpBtn.focus(); } });

    // view menu, export, more
    const menus = el.querySelectorAll('.sb-tools .menu-wrap > button');
    menus.forEach((btn) => btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const m = btn.nextElementSibling, open = m.hidden;
      el.querySelectorAll('.sb-tools .menu').forEach((x) => { x.hidden = true; x.previousElementSibling.setAttribute('aria-expanded', 'false'); });
      if (open) { m.hidden = false; btn.setAttribute('aria-expanded', 'true'); const f = m.querySelector('button'); if (f) f.focus(); }
    }));
    el.querySelector('#st-view-menu').addEventListener('click', (e) => {
      const x = e.target.closest('button'); if (!x) return;
      if (x.dataset.density || x.dataset.zoom || x.dataset.hdr) {
        const nv = view();
        if (x.dataset.density) nv.density = x.dataset.density;
        if (x.dataset.zoom) nv.zoom = x.dataset.zoom === 'fit' ? 'fit' : +x.dataset.zoom;
        if (x.dataset.hdr) nv.hdr = x.dataset.hdr;
        OB.prefs.set('stmtView', nv); UI.render(); return;
      }
      if (x.dataset.coll === 'expand') { Object.keys(state.collapsed).forEach((k) => delete state.collapsed[k]); }
      if (x.dataset.coll === 'lv2') { Object.keys(state.collapsed).forEach((k) => delete state.collapsed[k]); const deep = (n) => { if (n.kind === 'group') { if (n.depth >= 1) state.collapsed[n.key] = true; n.children.forEach(deep); } }; st.tree.forEach(deep); }
      if (x.dataset.coll === 'collapse') { const all = (n) => { if (n.kind === 'group') { state.collapsed[n.key] = true; n.children.forEach(all); } }; st.tree.forEach(all); }
      x.closest('.menu').hidden = true; draw();
    });
    el.querySelectorAll('.sb-look [data-look]').forEach((x) => x.addEventListener('click', () => { OB.prefs.set('stmtLook', x.dataset.look === coLook ? null : { k: x.dataset.look, co: coLook }); UI.render(); }));
    el.querySelector('#st-refresh').addEventListener('click', () => UI.render());
    el.querySelector('#st-hdr').addEventListener('click', () => { setView({ hdr: view().hdr === 'none' ? 'full' : 'none' }); UI.render(); });
    // Collapse Rows (QuickBooks): fold every group whose rows are accounts, so each shows one total line; again to expand
    const rowsBtn = el.querySelector('#st-rows');
    const leafGroups = (n, out) => { if (n.kind === 'group') { if (n.children.length && !n.children.some((c) => c.kind === 'group')) out.push(n.key); n.children.forEach((c) => leafGroups(c, out)); } return out; };
    rowsBtn.addEventListener('click', () => {
      if (Object.keys(state.collapsed).length) Object.keys(state.collapsed).forEach((k) => delete state.collapsed[k]);
      else st.tree.forEach((n) => leafGroups(n, []).forEach((k) => { state.collapsed[k] = true; }));
      draw();
    });
    el.querySelector('#st-print').addEventListener('click', () => window.print());
    el.querySelectorAll('[data-x]').forEach((x) => x.addEventListener('click', () => {
      x.closest('.menu').hidden = true;
      if (x.dataset.x === 'print') return window.print();
      UI.exportMatrix(title.replace(/[^A-Za-z0-9]+/g, '_'), exportMatrix(state, title, periodText), x.dataset.x, { model: UI.statementModel(state, title, periodText) });
    }));
    el.querySelectorAll('[data-more]').forEach((x) => x.addEventListener('click', () => {
      if (x.closest('.menu')) x.closest('.menu').hidden = true;
      const a = x.dataset.more;
      if (a === 'saveas') saveAs(key, p, null);
      if (a === 'rename') UI.prompt('Rename saved report', 'Name', saved.name, { ok: 'Rename' }).then((n) => n && b.saveReport(Object.assign({}, saved, { name: n })).then(() => { UI.toast('Report renamed.'); UI.render(); }, UI.error));
      if (a === 'note') UI.modal({ title: p.note ? 'Edit note' : 'Add note', html: `<label class="field"><span>Note (shown under the report and printed)</span><textarea id="st-note" rows="4" maxlength="1000">${esc(p.note || '')}</textarea></label>`,
        actions: [{ label: 'Cancel', value: null }, { label: 'Apply', primary: true, collect: (m) => m.querySelector('#st-note').value }] }).then((n) => { if (n !== null) nav({ note: n.trim() }); });
      if (a === 'layout') { OB.prefs.set('reportLayout', modern ? 'classic' : 'modern'); UI.render(); return; }
      if (a === 'reset') UI.go('#/report/' + key + (saved ? '?saved=' + encodeURIComponent(saved.id) : ''));
    }));
    el.querySelector('#st-save').addEventListener('click', () => saveAs(key, p, saved));
    const chb = el.querySelector('#st-chart'); if (chb) chb.addEventListener('click', () => { OB.prefs.set('reportChart', !chartOn); UI.render(); });
    if (modern) ['#st-hdr', '#st-rows', '#st-refresh'].forEach((q) => { const x = el.querySelector(q); if (x) x.addEventListener('click', () => { const m = x.closest('.menu'); if (m) m.hidden = true; }); });
    el.querySelector('#st-customize').addEventListener('click', () => customize(key, kind, p, nav));

    // table: collapse, sort
    tableHost.addEventListener('click', (e) => {
      if (!e.target.closest('a, button')) { const tr = e.target.closest('tbody tr'), a = tr && tr.querySelector('td.num a[href]'); if (a) { a.click(); return; } }
      const tog = e.target.closest('[data-tog]');
      if (tog) { const k = tog.dataset.tog; if (state.collapsed[k]) delete state.collapsed[k]; else state.collapsed[k] = true; draw(); const again = tableHost.querySelector(`[data-tog="${CSS.escape(k)}"]`); if (again) again.focus(); return; }
      const so = e.target.closest('[data-sort]');
      if (so) {
        const ci = +so.dataset.sort, cur = state.sort;
        state.sort = !cur || cur.col !== ci ? { col: ci, dir: 'desc' } : cur.dir === 'desc' ? { col: ci, dir: 'asc' } : null;
        p.sort = state.sort ? state.sort.col + ':' + state.sort.dir : '';
        history.replaceState(null, '', '#/report/' + key + '?' + paramString(p) + (saved ? '&saved=' + encodeURIComponent(saved.id) : ''));
        UI._lastHash = location.hash;
        draw(); const again = tableHost.querySelector(`[data-sort="${ci}"]`); if (again) again.focus();
      }
    });
  };
  function closeToolMenus(e) {
    if (e.target.closest && e.target.closest('.sb-tools .menu-wrap')) return;
    document.querySelectorAll('.sb-tools .menu').forEach((x) => { if (!x.hidden) { x.hidden = true; x.previousElementSibling.setAttribute('aria-expanded', 'false'); } });
  }
  document.addEventListener('click', closeToolMenus);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && UI._stmtFocus && !document.querySelector('.modal-backdrop, .drawer-backdrop, .sb-drawer-back, .palette-backdrop, .menu:not([hidden]), .sb-pop:not([hidden])')) { UI._stmtFocus = false; UI.render(); }
  });
  window.addEventListener('hashchange', () => { if (!/^#\/report\/(pnl|bs|bva)\b/.test(location.hash)) { UI._stmtFocus = false; document.documentElement.classList.remove('sb-focus'); } });
  const cmpBox = (c, p) => `<label class="check"><input type="checkbox" value="${c}" ${p.cmpList.indexOf(c) >= 0 ? 'checked' : ''}> ${esc(R.COMPARE_LABELS[c])}</label>`;
  const parseSort = (s) => { const m = /^(\d+):(asc|desc)$/.exec(s || ''); return m ? { col: +m[1], dir: m[2] } : null; };
  function longDate(d) { const dt = new Date(d + 'T00:00:00'); return dt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }); }
  function longRange(a, z) {
    const A = new Date(a + 'T00:00:00'), Z = new Date(z + 'T00:00:00');
    if (a.slice(0, 4) === z.slice(0, 4)) return A.toLocaleDateString('en-US', { month: 'long', day: 'numeric' }) + ' – ' + longDate(z);
    void Z; return longDate(a) + ' – ' + longDate(z);
  }
  function footerParts(p) {
    const now = new Date(), parts = [];
    if (p.hideList.indexOf('basis') < 0) parts.push((p.basis === 'cash' ? 'Cash' : 'Accrual') + ' basis');
    const dt = [];
    if (p.hideList.indexOf('date') < 0) dt.push(now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }));
    if (p.hideList.indexOf('time') < 0) dt.push(now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }));
    if (dt.length) parts.push(dt.join(' '));
    return parts;
  }
  /** Shared report model of what is on screen (collapsed groups, custom titles, header/footer choices, number format). */
  UI.statementModel = (state, title, periodText, extra) => {
    const { st, p } = state, b = UI.book, hid = (k) => (p.hideList || []).indexOf(k) >= 0;
    const sub = [periodText + (p.class ? ' · Class: ' + (p.class === '__none' ? 'Not specified' : b.classFullName(p.class)) : '') + (st.budget ? ' · ' + st.budget.name : '')];
    const foot = footerParts(p).join(' | ');
    return OB.reportModel.fromStatement(st, Object.assign({ company: hid('co') ? '' : b.company.name, title: hid('title') ? '' : title, lines: hid('period') ? [] : sub,
      footer: [foot].concat(p.note ? ['Note: ' + p.note] : []).filter(Boolean), nf: p, collapsed: state.collapsed, look: state.look }, extra || {}));
  };
  /** QuickBooks Desktop corner block: time, date (MM/DD/YY) and basis, top left of the report. */
  function metaLines(p) {
    const now = new Date(), out = [];
    if (p.hideList.indexOf('time') < 0) out.push(now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }));
    if (p.hideList.indexOf('date') < 0) out.push(now.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: '2-digit' }));
    if (p.hideList.indexOf('basis') < 0) out.push((p.basis === 'cash' ? 'Cash' : 'Accrual') + ' Basis');
    return out.map((x) => `<div>${esc(x)}</div>`).join('');
  }
  function footerText(p, ms) {
    const now = new Date(), parts = [];
    if (p.hideList.indexOf('basis') < 0) parts.push((p.basis === 'cash' ? 'Cash' : 'Accrual') + ' basis');
    const dt = [];
    if (p.hideList.indexOf('date') < 0) dt.push(now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }));
    if (p.hideList.indexOf('time') < 0) dt.push(now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }));
    if (dt.length) parts.push(dt.join(' '));
    return parts.map(esc).join(' <span aria-hidden="true">|</span> ') + `<span class="sr-only"> · ${ms} ms</span>`;
  }

  /* ---------- table ---------- */
  function sortedChildren(state, n) {
    if (!state.sort || !n.children) return n.children;
    const ci = state.sort.col, d = state.sort.dir === 'asc' ? 1 : -1;
    const own = n.children.filter((c) => c.ownRow), rest = n.children.filter((c) => !c.ownRow);
    rest.sort((a, z) => ((a.cells[ci] || 0) - (z.cells[ci] || 0)) * d);
    return own.concat(rest);
  }
  /** The statement table, reused by the statement designer preview (same drill-down, collapse and sort). */
  UI.statementTable = (state) => tableHtml(state);
  function tableHtml(state) {
    const { st, p } = state, cols = st.cols, b = UI.book;
    const ncol = cols.length + 1;
    let head = '';
    const sortBtn = (i, label) => {
      const on = state.sort && state.sort.col === i ? state.sort.dir : '';
      return `<button type="button" class="sb-sort${on ? ' on' : ''}" data-sort="${i}" aria-label="Sort by ${esc(label)}${on ? (on === 'desc' ? ', sorted high to low' : ', sorted low to high') : ''}"><span aria-hidden="true">${on === 'asc' ? '▲' : on === 'desc' ? '▼' : '⇅'}</span></button>`;
    };
    if (st.multiHeader) {
      head = `<tr class="grp"><th class="lbl"><span class="sr-only">Account</span></th>${st.groups.map((g) => `<th colspan="${g.span}" class="gh">${esc(g.label)}</th>`).join('')}</tr>
        <tr><th class="lbl"><span class="sr-only">Account</span></th>${cols.map((c, i) => `<th class="num${c.variant === 'cur' ? ' gstart' : ''}">${sortBtn(i, c.label)}${esc(c.label)}</th>`).join('')}</tr>`;
    } else head = `<tr><th class="lbl"><span class="sr-only">Account</span></th>${cols.map((c, i) => `<th class="num">${sortBtn(i, c.label)}${esc(c.label)}</th>`).join('')}</tr>`;
    let body = '';
    const one = cols.length === 1 && !st.template, step = state.look === 'step' && one;   // stepped and two-sided need a single amount column
    const drill = (n, c, inner) => {
      if (!inner || c.pct || !c.value || c.bud) return inner;
      if (n.netIncome) return `<a href="#/report/pnl?${UI.qs({ range: 'custom', from: U.fiscalYearStart(c.to, b.company.fiscalYearStartMonth), to: c.to, basis: p.basis })}">${inner}</a>`;
      // totals, groups and computed lines (Total Income, Gross Profit, Net Income…) open Transaction Detail By Account
      if (!n.accountId || n.accGroup) {
        if (!state.key || !/^(pnl|bs|bva)$/.test(state.key)) return inner;
        const node = n.kind === 'net' ? (n.section ? 'net:' + n.section : '') : n.kind === 'group' ? n.key : '';
        if (!node) return inner;
        const q = { src: st.kind === 'bs' ? 'bs' : 'pnl', node, range: 'custom', from: st.kind === 'bs' ? U.fiscalYearStart(c.to, b.company.fiscalYearStartMonth) : c.from, to: c.to, basis: p.basis };
        if (c.f && c.f.clsExact !== undefined) q.class = c.f.clsExact || '__none'; else if (p.class) q.class = p.class;
        if (c.f && c.f.contactId !== undefined) q.contact = c.f.contactId || '__none';
        return `<a href="#/report/txdetail?${UI.qs(q)}" title="Show the transactions">${inner}</a>`;
      }
      const from = st.kind === 'bs' ? '1900-01-01' : c.from;
      const q = { account: n.accountId, range: 'custom', from, to: c.to, basis: p.basis };
      if (c.f && c.f.clsExact !== undefined) q.class = c.f.clsExact || '__none';
      else if (p.class) q.class = p.class;
      if (c.f && c.f.contactId !== undefined) q.contact = c.f.contactId || '__none';
      return `<a href="#/report/gl?${UI.qs(q)}">${inner}</a>`;
    };
    const ledger = (n) => n.accountId && !n.accGroup && /^(pnl|bs)$/.test(state.key || '')
      ? `<a class="sb-ledger" href="#/report/gl?${UI.qs(Object.assign({ account: n.accountId, range: 'custom', from: st.kind === 'bs' ? '1900-01-01' : p.from, to: p.to, basis: p.basis }, p.class ? { class: p.class } : {}))}" title="Open this account's ledger">${esc(n.label)}</a>` : esc(n.label);
    const cellsHtml = (n, opts) => n.cells.map((v, i) => {
      const c = cols[i];
      const pct = c.pct || n.fmt === 'pct', ratio = n.fmt === 'ratio' && !c.pct;
      const txt = fmt(v, p, { pct, ratio, empty: v === 0, symbol: opts.total && !pct && !ratio });
      const cc = n.cond ? OB.reportModel.condClass(n, v, c) : '';
      const inner = opts.link ? drill(n, c, txt) : txt;
      return `<td class="num${c.variant === 'cur' && st.multiHeader ? ' gstart' : ''}${pct ? ' pct' : ''}${cc ? ' c-' + cc : ''}${txt ? '' : ' nil'}">${step && inner ? `<span class="stp">${inner}</span>` : inner}</td>`;
    }).join('');
    const rowCls = (n) => { const s = n.style || {}; return (s.bold ? ' r-bold' : '') + (s.italic ? ' r-italic' : '') + (s.line === 'above' ? ' r-line' : s.line === 'double' ? ' r-dline' : '') + (s.pageBreak ? ' r-break' : ''); };
    const pad = (d) => `style="padding-left:${0.6 + d * 1.05}rem"`;
    const visit = (n) => {
      if (n.kind === 'group') {
        const collapsed = !!state.collapsed[n.key];
        const tog = `<button type="button" class="sb-tog" data-tog="${esc(n.key)}" aria-expanded="${!collapsed}" aria-label="${collapsed ? 'Expand' : 'Collapse'} ${esc(n.label)}"><span aria-hidden="true">${collapsed ? '›' : '⌄'}</span></button>`;
        if (collapsed) { body += `<tr class="r-hdr r-coll d${n.depth}${rowCls(n)}"><td class="lbl" ${pad(n.depth)}>${tog}${esc(n.label)}</td>${cellsHtml(n, { total: false, link: true })}</tr>`; return; }
        body += `<tr class="r-hdr d${n.depth}"><td class="lbl" ${pad(n.depth)}>${tog}${esc(n.label)}</td><td colspan="${ncol - 1}" class="fill"></td></tr>`;
        sortedChildren(state, n).forEach(visit);
        body += `<tr class="r-tot d${n.depth}${rowCls(n)}"><td class="lbl" ${pad(n.depth + 1)}>${esc(n.totalLabel)}</td>${cellsHtml(n, { total: true, link: true })}</tr>`;
      } else if (n.kind === 'net') {
        body += `<tr class="${n.style && n.style.plain ? 'r-acc r-formula' : 'r-net'}${n.grand ? ' r-grand' : ''}${rowCls(n)}"><td class="lbl" ${pad(n.depth || 0)}>${esc(n.label)}</td>${cellsHtml(n, { total: true, link: true })}</tr>`;
      } else if (n.kind === 'text') {
        body += `<tr class="r-text${rowCls(n)}"><td class="lbl" ${pad(n.depth || 0)} colspan="${ncol}">${esc(n.label)}</td></tr>`;
      } else if (n.kind === 'spacer') {
        body += `<tr class="r-gap${rowCls(n)}"><td colspan="${ncol}"></td></tr>`;
      } else {
        body += `<tr class="r-acc${n.inactive ? ' inactive' : ''}${rowCls(n)}"><td class="lbl" ${pad(n.depth + 1)}>${ledger(n)}${n.inactive ? ' <span class="muted small">(inactive)</span>' : ''}</td>${cellsHtml(n, { total: false, link: true })}</tr>`;
      }
    };
    const empty = !st.template && !st.tree.some((n) => n.kind === 'group' && n.children.length);
    const emptyMsg = empty ? `<p class="sb-empty">${st.kind === 'bs' ? 'No balances on this date.' : 'No income or expense activity in this period.'} Try another report period or accounting method.</p>` : '';
    const check = st.kind === 'bs' && st.balanced !== undefined ? `<p class="check-line ${st.balanced ? 'ok' : 'bad'}">${st.balanced ? '✓ Assets equal liabilities plus equity.' : '✗ Out of balance.'}</p>` : '';
    if (state.look === 'two' && one && !empty) {
      // T-format: liabilities and equity (or expenses) on the left, assets (or income) on the right, totals level at the foot
      const sides = RM.twoSides(st), money = (v) => fmt(v, p, { symbol: true });
      const side = (x) => {
        body = ''; x.nodes.forEach(visit);
        return `<div class="two-side"><div class="two-h">${esc(x.title)}</div><table class="statement sb-table"><tbody>${body}${x.extra ? `<tr class="r-acc r-bold"><td class="lbl" ${pad(0)}>${x.extra.link ? `<a class="sb-ledger" href="${x.extra.link}">${esc(x.extra.label)}</a>` : esc(x.extra.label)}</td><td class="num">${fmt(x.extra.value, p, {})}</td></tr>` : ''}</tbody></table><div class="two-t"><span>${esc(x.totalLabel)}</span><span>${money(x.total)}</span></div></div>`;
      };
      return emptyMsg + `<div class="sb-two">${side(sides.left)}${side(sides.right)}</div>` + check;
    }
    // each top-level section sits in its own <tbody>, so a layout can box or band a whole section
    let bodies = '';
    st.tree.forEach((n) => { body = ''; visit(n); bodies += `<tbody>${body}</tbody>`; if ((st.kind === 'bs' && n.section === 'assets') || state.look === 'boxed') bodies += `<tbody class="gap"><tr class="r-gap"><td colspan="${ncol}"></td></tr></tbody>`; });
    body = bodies;
    // a balance sheet's top-level totals (TOTAL ASSETS, TOTAL LIABILITIES & EQUITY) are styled as grand totals
    body = body.replace(/(<tr class="r-tot d0)("><td class="lbl"[^>]*>(?:Total|TOTAL) [^<]*<\/td>)/g, (m0, a, rest) => a + ' r-grand-bs' + rest);
    return emptyMsg + `<table class="statement sb-table" style="--ncol:${cols.length}"><thead>${head}</thead>${body}</table>` + check;
  }

  function exportMatrix(state, title, periodText) {
    const { st, p } = state, b = UI.book;
    const rows = [[{ v: b.company.name, bold: true }], [{ v: title, bold: true }], [periodText + ' · ' + (p.basis === 'cash' ? 'Cash' : 'Accrual') + ' basis'], []];
    if (st.multiHeader) {
      const r1 = [''];
      st.groups.forEach((g) => { r1.push({ v: g.label, bold: true }); for (let i = 1; i < g.span; i++) r1.push(''); });
      rows.push(r1);
    }
    rows.push([{ v: '', bold: true }].concat(st.cols.map((c) => ({ v: c.label, bold: true }))));
    R.flattenStatement(st, state.collapsed).forEach((r) => {
      const label = '  '.repeat(r.depth) + r.label;
      const bold = r.kind !== 'account';
      if (!r.cells) { rows.push([{ v: label, bold: true }]); return; }
      rows.push([bold ? { v: label, bold: true } : label].concat(r.cells.map((v, i) => plain(v, { pct: st.cols[i].pct, empty: r.kind === 'account' && v === 0, bold }))));
    });
    return rows;
  }

  /* ---------- Save as ---------- */
  function saveAs(key, p, saved) {
    const b = UI.book;
    const params = {}; Object.keys(p).forEach((k) => { if (['cmpList', 'hideList', 'saved'].indexOf(k) < 0 && p[k] !== '' && p[k] !== undefined) params[k] = p[k]; });
    if (params.range !== 'custom') { delete params.from; delete params.to; }
    if (saved) {
      return b.saveReport(Object.assign({}, saved, { params })).then(() => { UI.toast('Saved “' + saved.name + '”.'); }, UI.error);
    }
    return UI.modal({
      title: 'Save report',
      html: `<label class="field"><span>Report name</span><input id="sv-name" maxlength="80" value="${esc(TITLES[key] + (p.by !== 'total' ? ' by ' + (BY.find((x) => x[0] === p.by) || ['', ''])[1].replace(/s$/, '') : '') + (p.cmpList.length ? ' — comparison' : ''))}"></label>
        <p class="muted small">Saves the period choice, columns, comparisons, filters and every Customize setting. Find it under Reports → My reports. A relative period such as “This fiscal year” moves with the calendar.</p>`,
      actions: [{ label: 'Cancel', value: null }, { label: 'Save', primary: true, collect: (m) => m.querySelector('#sv-name').value.trim() || false }]
    }).then((name) => {
      if (!name) return;
      return b.saveReport({ name, report: key, params }).then((r) => { UI.toast('Saved “' + r.name + '” to My reports.'); UI.go('#/report/' + key + '?' + UI.qs(Object.assign({}, params, { saved: r.id }))); });
    }).catch(UI.error);
  }

  /* ---------- Customize drawer ---------- */
  /** Bars per period: income vs expenses (P&L) or assets / liabilities / equity (balance sheet); numbers from R.statementChart. */
  function chartHtml(st) {
    const c = R.statementChart(st);
    if (!c.points.length || !c.max) return '<p class="muted small">Nothing to chart for this period.</p>';
    const pct = (v) => Math.max(1.5, Math.round(Math.abs(v) / c.max * 1000) / 10);
    return `<div class="sb-chart-legend">${c.series.map(([k, l], i) => `<span><i class="sw s${i}"></i>${esc(l)}</span>`).join('')}<span class="muted">${st.kind === 'bs' ? 'Net assets' : 'Net income'} under each period</span></div>
      <div class="sb-chart-plot" role="img" aria-label="${esc(c.points.map((pt) => pt.label + ': ' + c.series.map(([k, l]) => l + ' ' + OB.util.fmt(pt.values[k], { symbol: true })).join(', ')).join('; '))}">${c.points.slice(-24).map((pt) => `<div class="sb-cg">
        <div class="sb-cbars">${c.series.map(([k], i) => `<span class="sb-cbar s${i}${pt.values[k] < 0 ? ' neg' : ''}" style="height:${pct(pt.values[k])}%" title="${esc(OB.util.fmt(pt.values[k], { symbol: true }))}"></span>`).join('')}</div>
        <div class="sb-clabel">${esc(pt.label)}</div><div class="sb-cnet${pt.net < 0 ? ' neg' : ''}">${esc(OB.util.fmt(pt.net, { symbol: true }))}</div></div>`).join('')}</div>`;
  }
  function customize(key, kind, p, nav) {
    const b = UI.book;
    document.querySelectorAll('.sb-drawer-back').forEach((x) => x.remove());
    const back = document.createElement('div');
    back.className = 'sb-drawer-back';
    const radio = (name, val, label, cur) => `<label class="check"><input type="radio" name="${name}" value="${val}" ${cur === val ? 'checked' : ''}> ${label}</label>`;
    const chk = (name, label, on) => `<label class="check"><input type="checkbox" name="${name}" ${on ? 'checked' : ''}> ${label}</label>`;
    const sec = (title, body, open) => `<details class="cz-sec"${open ? ' open' : ''}><summary>${title}</summary><div class="cz-body">${body}</div></details>`;
    const atypes = (p.atypes || '').split(',').filter(Boolean);
    const typeList = S.ACCOUNT_TYPES.filter((t) => kind === 'bs' ? S.isBS(t.id) : S.isPL(t.id));
    const dataTab = `
      ${sec('Filters', `
        ${b.classes.length ? `<label class="field"><span>Class</span><select name="class"><option value="">All classes</option><option value="__none"${p.class === '__none' ? ' selected' : ''}>Not specified</option>${b.sortedClasses().map((c) => `<option value="${esc(c.id)}"${p.class === c.id ? ' selected' : ''}>${esc(b.classFullName(c.id))}</option>`).join('')}</select></label>` : '<p class="muted small">Turn on class tracking in Settings → Company to filter by class.</p>'}
        ${kind !== 'bs' ? `<label class="field"><span>Customer or vendor</span><select name="contact"><option value="">All</option>${['customer', 'vendor'].map((k) => `<optgroup label="${k === 'customer' ? 'Customers' : 'Vendors'}">${b.contacts.filter((c) => c.kind === k).sort((x, y) => x.name.localeCompare(y.name)).map((c) => `<option value="${esc(c.id)}"${p.contact === c.id ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</optgroup>`).join('')}</select></label>` : ''}
        <fieldset class="cz-types"><legend>Account types</legend>${typeList.map((t) => `<label class="check"><input type="checkbox" name="atype" value="${t.id}" ${!atypes.length || atypes.indexOf(t.id) >= 0 ? 'checked' : ''}> ${esc(t.label)}</label>`).join('')}</fieldset>`, true)}
      ${sec('Show non-zero or active', `
        <div class="cz-row"><span class="cz-l">Show rows</span>${radio('rows', 'active', 'Active', p.rows || 'active')}${radio('rows', 'all', 'All', p.rows || 'active')}${radio('rows', 'nonzero', 'Non-zero', p.rows || 'active')}</div>
        <div class="cz-row"><span class="cz-l">Show columns</span>${radio('cols', 'active', 'Active', p.cols || 'active')}${radio('cols', 'all', 'All', p.cols || 'active')}${radio('cols', 'nonzero', 'Non-zero', p.cols || 'active')}</div>
        <p class="muted small">Active = accounts with any activity in the period. All = every account in the chart. Non-zero = only amounts other than zero.</p>`, true)}
      ${sec('Number format', `
        ${chk('d1000', 'Divide by 1000', p.d1000 === '1')}
        ${chk('nosym', 'Don’t show currency symbol', p.nosym === '1')}
        <label class="field"><span>Negative numbers</span><select name="neg"><option value="minus"${!p.neg || p.neg === 'minus' ? ' selected' : ''}>-100</option><option value="trail"${p.neg === 'trail' ? ' selected' : ''}>100-</option><option value="paren"${p.neg === 'paren' ? ' selected' : ''}>(100)</option></select></label>
        ${chk('red', 'Show in red', p.red === '1')}
        <div class="cz-row"><span class="cz-l">Decimals</span>${radio('dec', '0', 'Round to the nearest whole number', p.dec === '0' ? '0' : '2')}${radio('dec', '2', 'Show 2 decimal places', p.dec === '0' ? '0' : '2')}</div>`, true)}
      ${sec('Edit titles', `
        <label class="field"><span>Report title</span><input name="title" value="${esc(p.title || '')}" placeholder="${esc(TITLES[key])}" maxlength="80"></label>
        ${SECTION_KEYS[kind].map(([k, l]) => `<label class="field"><span>${esc(l)}</span><input name="t_${k}" value="${esc(p['t_' + k] || '')}" placeholder="Enter custom title" maxlength="60"></label>`).join('')}`)}`;
    const hid = (k) => p.hideList.indexOf(k) >= 0;
    const visualTab = `
      ${sec('Header', `${chk('h_co', 'Company name', !hid('co'))}${chk('h_title', 'Report title', !hid('title'))}${chk('h_period', 'Report period', !hid('period'))}
        <div class="cz-row"><span class="cz-l">Alignment</span>${radio('halign', 'left', 'Left', p.halign || 'center')}${radio('halign', 'center', 'Center', p.halign || 'center')}${radio('halign', 'right', 'Right', p.halign || 'center')}</div>`, true)}
      ${sec('Date, time and basis', `${chk('h_date', 'Date prepared', !hid('date'))}${chk('h_time', 'Time prepared', !hid('time'))}${chk('h_basis', 'Report basis (cash vs. accrual)', !hid('basis'))}
        <div class="cz-row"><span class="cz-l">Position</span>${radio('falign', 'corner', 'Top left', p.falign || 'corner')}${radio('falign', 'left', 'Footer, left', p.falign || 'corner')}${radio('falign', 'center', 'Footer, center', p.falign || 'corner')}${radio('falign', 'right', 'Footer, right', p.falign || 'corner')}</div>`, true)}
      ${sec('Cell settings', `<div class="cz-row"><span class="cz-l">Show empty cells as</span>${radio('empty', 'blank', 'Blank', p.empty || 'blank')}${radio('empty', 'dash', 'Dash', p.empty || 'blank')}</div>`, true)}
      ${sec('Row settings', chk('band', 'Banded rows (alternate shading)', p.band === '1'), true)}
      ${sec('Gridlines', `<label class="field"><span>Report borders</span><select name="grid">${[['none', 'No gridlines (default)'], ['rows', 'Row lines'], ['all', 'All gridlines']].map(([k, l]) => `<option value="${k}"${(p.grid || 'none') === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>`, true)}`;
    back.innerHTML = `<aside class="sb-drawer" role="dialog" aria-modal="true" aria-labelledby="cz-title">
      <header><h2 id="cz-title">Customize</h2><button type="button" class="btn ghost" data-cz="close" aria-label="Close">✕</button></header>
      <div class="seg cz-tabs" role="tablist"><button type="button" role="tab" aria-selected="true" data-tab="data">Data</button><button type="button" role="tab" aria-selected="false" data-tab="visual">Visual</button></div>
      <form class="cz-form" id="cz-form" autocomplete="off"><div data-pane="data">${dataTab}</div><div data-pane="visual" hidden>${visualTab}</div></form>
      <footer><button type="button" class="btn" data-cz="cancel">Cancel</button><button type="button" class="btn primary" data-cz="apply" data-key="y,p">Apply changes</button></footer></aside>`;
    document.body.appendChild(back);
    const prev = document.activeElement;
    const close = () => { back.remove(); document.removeEventListener('keydown', key2, true); if (prev && prev.focus) prev.focus(); };
    const key2 = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    document.addEventListener('keydown', key2, true);
    back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
    back.querySelectorAll('[data-tab]').forEach((t) => t.addEventListener('click', () => {
      back.querySelectorAll('[data-tab]').forEach((x) => x.setAttribute('aria-selected', String(x === t)));
      back.querySelectorAll('[data-pane]').forEach((x) => { x.hidden = x.dataset.pane !== t.dataset.tab; });
    }));
    back.querySelector('[data-cz="close"]').addEventListener('click', close);
    back.querySelector('[data-cz="cancel"]').addEventListener('click', close);
    back.querySelector('[data-cz="apply"]').addEventListener('click', () => {
      const f = back.querySelector('#cz-form');
      const val = (n) => { const x = f.querySelector(`[name="${n}"]:checked`) || f.querySelector(`select[name="${n}"], input[name="${n}"]:not([type=radio]):not([type=checkbox])`); return x ? x.value : ''; };
      const on = (n) => { const x = f.querySelector(`input[name="${n}"]`); return x && x.checked ? '1' : ''; };
      const ch = {
        class: val('class'), contact: val('contact'), rows: val('rows'), cols: val('cols'),
        d1000: on('d1000'), nosym: on('nosym'), neg: val('neg') === 'minus' ? '' : val('neg'), red: on('red'), dec: val('dec') === '0' ? '0' : '',
        title: val('title').trim(), halign: val('halign') === 'center' ? '' : val('halign'), falign: val('falign') === 'corner' ? '' : val('falign'),
        empty: val('empty') === 'dash' ? 'dash' : '', band: on('band'), grid: val('grid') === 'none' ? '' : val('grid')
      };
      if (ch.rows === 'active') ch.rows = ''; if (ch.cols === 'active') ch.cols = '';
      const types = [...f.querySelectorAll('input[name="atype"]')];
      const picked = types.filter((x) => x.checked).map((x) => x.value);
      if (!picked.length) return UI.toast('Choose at least one account type.', 'error');
      ch.atypes = picked.length === types.length ? '' : picked.join(',');
      ch.hide = HIDE_KEYS.filter((k) => !on('h_' + k)).join(',');
      SECTION_KEYS[kind].forEach(([k]) => { ch['t_' + k] = val('t_' + k).trim(); });
      close();
      nav(ch);
    });
    const first = back.querySelector('[data-tab]'); if (first) first.focus();
  }
})();
