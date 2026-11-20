/* VaultBook — F11 Company Features and F12 Configuration windows.
 * Both are compact "Label : value" windows. Every setting maps to an existing, working setting:
 *  F11 → company record (Book.saveCompany): basis, fiscal year, terms, closing date, classes, budgets, 1099.
 *        Turning a feature off keeps its data (existing behaviour of Book.feature()).
 *  F12 → display preferences (OB.prefs / UI.setTheme / UI.setDensity / sidebar / window layout / function-key panel)
 *        plus the current screen's own configuration tools (report Customize, Columns, Expand/Collapse).
 */
(function () {
  'use strict';
  const UI = OB.ui, U = OB.util, esc = U.esc;

  const yesNo = (name, on) => `<select name="${name}" class="cfg-v"><option value="1"${on ? ' selected' : ''}>Yes</option><option value="0"${on ? '' : ' selected'}>No</option></select>`;
  const row = (labelText, control, help, id) => `<div class="cfg-row"><label class="cfg-l"${id ? ` for="${id}"` : ''}>${esc(labelText)}</label><span class="cfg-c">:</span><span class="cfg-ctl">${control}</span>${help ? `<span class="cfg-help">${help}</span>` : ''}</div>`;
  const withId = (html, id) => html.replace(/^<(select|input)/, `<$1 id="${id}"`);

  /* ---------- F11 ---------- */
  UI.openFeatures = () => {
    const b = UI.book; if (!b) return Promise.resolve(null);
    if (document.querySelector('.modal.cfg-window')) return Promise.resolve(null);
    const c = b.company;
    const counts = (f) => { const x = (UI.FEATURES || []).find((y) => y.key === f); const n = x && x.count ? x.count(b) : ''; return n ? esc(n) + ' kept' : ''; };
    const html = `<div class="cfg cfg-2col">
      <section><h3>Accounting</h3>
        ${row('Default report basis', withId(`<select name="basis" class="cfg-v"><option value="accrual">Accrual</option><option value="cash"${c.basis === 'cash' ? ' selected' : ''}>Cash</option></select>`, 'cf-basis'), '', 'cf-basis')}
        ${row('Fiscal year begins in', withId(`<select name="fiscalYearStartMonth" class="cfg-v">${UI.MONTHS.map((m, i) => `<option value="${i + 1}"${(c.fiscalYearStartMonth || 1) === i + 1 ? ' selected' : ''}>${m}</option>`).join('')}</select>`, 'cf-fy'), '', 'cf-fy')}
        ${row('Statement layout', withId(`<select name="statementLook" class="cfg-v">${OB.reportModel.LOOKS.map(([k, l], i) => `<option value="${k}"${(c.statementLook || 'classic') === k ? ' selected' : ''}>${i + 1} ${l}</option>`).join('')}</select>`, 'cf-look'), 'Balance Sheet, Profit and Loss', 'cf-look')}
        ${row('Close books through', withId(`<input type="date" name="closingDate" class="cfg-v" value="${esc(c.closingDate || '')}">`, 'cf-close'), 'Locks earlier periods', 'cf-close')}
      </section>
      <section><h3>Customers and vendors</h3>
        ${row('Default payment terms (days)', withId(`<input type="number" min="0" max="365" name="defaultTerms" class="cfg-v num" value="${esc(c.defaultTerms === undefined ? 30 : c.defaultTerms)}">`, 'cf-terms'), '', 'cf-terms')}
        ${row('Track 1099 contractors', withId(yesNo('use1099', c.use1099 !== false), 'cf-1099'), counts('use1099'), 'cf-1099')}
      </section>
      <section><h3>Tracking</h3>
        ${row('Track classes (departments, jobs)', withId(yesNo('useClasses', !!c.useClasses), 'cf-cls'), counts('useClasses'), 'cf-cls')}
        ${row('Budgets', withId(yesNo('useBudgets', c.useBudgets !== false), 'cf-bud'), counts('useBudgets'), 'cf-bud')}
      </section>
      <section><h3>Security</h3>
        <div class="cfg-row"><span class="cfg-l">Password protection</span><span class="cfg-c">:</span><span class="cfg-ctl strong">${b.security ? 'On' : 'Off'}</span><span class="cfg-help"><a href="#/settings?tab=security" data-close-cfg>Security settings</a></span></div>
        <div class="cfg-row"><span class="cfg-l">Audit trail</span><span class="cfg-c">:</span><span class="cfg-ctl strong">Always on</span><span class="cfg-help"><a href="#/settings?tab=audit" data-close-cfg>Audit log</a></span></div>
      </section></div>
      <p class="muted small cfg-note">Turning a feature off hides its menus, fields and reports. Anything already entered is kept and returns when you turn it on again.</p>`;
    return UI.modal({
      title: 'Company Features — ' + c.name, html, wide: true, cls: 'cfg-window',
      actions: [{ label: 'Cancel', value: null }, { label: 'Save', primary: true, collect: (m) => {
        const v = (n) => m.querySelector(`[name="${n}"]`).value;
        return { basis: v('basis'), fiscalYearStartMonth: v('fiscalYearStartMonth'), closingDate: v('closingDate'), defaultTerms: v('defaultTerms'), statementLook: v('statementLook'),
          use1099: v('use1099') === '1', useClasses: v('useClasses') === '1', useBudgets: v('useBudgets') === '1' };
      } }],
      onMount: (m, close) => m.addEventListener('click', (e) => { if (e.target.closest('[data-close-cfg]')) close(null); })
    }).then((input) => {
      if (!input) return null;
      return b.saveCompany(input).then(() => { UI.toast('Company features saved.'); UI.applyFeatures(); UI.render(); return true; },
        (e) => { UI.toast(e.message, 'error'); return null; });
    });
  };

  /* ---------- F12 ---------- */
  UI.fkeysVisible = () => OB.prefs.get('fkeys') !== false;
  UI.applyFkeys = () => document.documentElement.classList.toggle('fkeys-off', !UI.fkeysVisible());
  UI.applyFkeys();

  UI.openConfigure = () => {
    if (!UI.book) return Promise.resolve(null);
    if (document.querySelector('.modal.cfg-window')) return Promise.resolve(null);
    const ctx = UI.keys ? UI.keys.context() : 'other';
    const layout = (OB.windows && OB.windows.layout) || 'both';
    const sel = (name, opts, cur) => `<select name="${name}" id="cg-${name}" class="cfg-v">${opts.map(([v, l]) => `<option value="${v}"${v === cur ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
    const tools = [];
    const has = (s) => document.querySelector('#main ' + s);
    if (ctx === 'report') {
      if (has('#st-customize')) tools.push(['customize', 'Customize report (filters, rows, columns, format)…']);
      if (has('[data-columns-for]')) tools.push(['columns', 'Choose columns…']);
      if (has('[data-coll=expand]')) tools.push(['expand', 'Expand all rows'], ['collapse', 'Collapse all rows']);
      if (has('#st-view')) tools.push(['view', 'View: density, zoom, heading…']);
    }
    if (ctx === 'register' && has('[data-columns-for]')) tools.push(['columns', 'Choose columns…']);
    const html = `<div class="cfg">
      <section><h3>Display</h3>
        ${row('Appearance', sel('theme', [['system', 'Match system'], ['light', 'Light'], ['dark', 'Dark']], UI.theme || 'system'), '', 'cg-theme')}
        ${row('Density', sel('density', [['compact', 'Compact'], ['comfortable', 'Comfortable']], OB.prefs.get('density') === 'compact' ? 'compact' : 'comfortable'), '', 'cg-density')}
        ${row('Function-key panel', sel('fkeys', [['1', 'Show'], ['0', 'Hide']], UI.fkeysVisible() ? '1' : '0'), 'Keys work either way', 'cg-fkeys')}
        ${row('Sidebar', sel('sidebar', [['1', 'Show'], ['0', 'Hide']], OB.prefs.get('sidebarCollapsed') ? '0' : '1'), '', 'cg-sidebar')}
        ${row('Open windows', sel('layout', [['both', 'Tabs and taskbar'], ['tabs', 'Tabs only'], ['taskbar', 'Taskbar only'], ['off', 'Hidden']], layout), '', 'cg-layout')}
      </section>
      ${tools.length ? `<section><h3>This screen</h3><div class="cfg-tools">${tools.map(([k, l]) => `<button type="button" class="btn small" data-tool="${k}">${esc(l)}</button>`).join('')}</div></section>` : ''}
      <p class="muted small cfg-note">Display settings are kept in this browser. Company-wide settings are under <a href="#" data-f11>F11 Company Features</a>.</p></div>`;
    let tool = null;
    return UI.modal({
      title: 'Configuration', html, cls: 'cfg-window',
      actions: [{ label: 'Cancel', value: null }, { label: 'Apply', primary: true, collect: (m) => {
        const v = (n) => m.querySelector(`[name="${n}"]`).value;
        return { theme: v('theme'), density: v('density'), fkeys: v('fkeys') === '1', sidebar: v('sidebar') === '1', layout: v('layout') };
      } }],
      onMount: (m, close) => m.addEventListener('click', (e) => {
        const t = e.target.closest('[data-tool]'); if (t) { tool = t.dataset.tool; close(null); return; }
        if (e.target.closest('[data-f11]')) { e.preventDefault(); tool = 'f11'; close(null); }
      })
    }).then((v) => {
      if (tool) return runTool(tool);
      if (!v) return null;
      UI.setTheme(v.theme, true);
      UI.setDensity(v.density);
      OB.prefs.set('fkeys', v.fkeys); UI.applyFkeys();
      if (!!OB.prefs.get('sidebarCollapsed') === v.sidebar) UI.setSidebar(!v.sidebar);
      if (OB.windows && OB.windows.setLayout && OB.windows.layout !== v.layout) OB.windows.setLayout(v.layout);
      UI.toast('Configuration applied.');
      return true;
    });
  };
  function runTool(k) {
    const click = (s) => { const el = document.querySelector('#main ' + s); if (el) el.click(); };
    if (k === 'f11') return UI.openFeatures();
    if (k === 'customize') click('#st-customize');
    else if (k === 'columns') click('[data-columns-for]');
    else if (k === 'expand') click('[data-coll=expand]');
    else if (k === 'collapse') click('[data-coll=collapse]');
    else if (k === 'view') click('#st-view');
    return true;
  }
})();
