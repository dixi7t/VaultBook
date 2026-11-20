/* VaultBook — Statement designer screen (#/designer).
 * Gallery of starter templates and saved designs; editor with a row list (drag and drop, Alt+↑/↓), a row editor
 * and a live preview drawn by the statement table (same drill-down, collapse, sort, Excel, PDF, print).
 * Designs are saved as saved reports (report: 'designer', params.def = template JSON) — no new database store.
 */
(function () {
  'use strict';
  const U = OB.util, S = OB.schema, R = OB.reports, UI = OB.ui, D = OB.designer, M = OB.reportModel, esc = U.esc;
  const TYPE_LABEL = { accounts: 'Accounts', formula: 'Formula', header: 'Heading', text: 'Text', spacer: 'Blank line' };
  const BY = [['total', 'Total only'], ['month', 'Months'], ['quarter', 'Quarters'], ['year', 'Years'], ['class', 'Class'], ['customer', 'Customer'], ['vendor', 'Vendor']];
  const CMP = { pl: ['py', 'pp', 'mtd', 'qtd', 'ytd', 'pyytd', 'chg', 'pchg', 'inc'], bs: ['py', 'pp', 'chg', 'pchg'] };
  let ds = null; // editor state, kept while the same design is open

  UI.routes.designer = (el, r) => (r.id ? editor(el, r) : gallery(el));

  /* ---------- gallery ---------- */
  function gallery(el) {
    const b = UI.book, mine = b.savedReports().filter((x) => x.report === 'designer');
    const card = (k) => { const t = D.TEMPLATES[k]; return `<li><a href="#/designer/new?tpl=${k}"><strong>${esc(t.name)}</strong><span>${t.kind === 'bs' ? 'Balance sheet' : 'Profit and loss'} · ${t.rows.length} rows</span></a></li>`; };
    el.innerHTML = UI.page('Statement designer', '<button type="button" class="btn" id="dz-import">Import template…</button>', `
      <section class="card"><h2>Start from a template</h2><ul class="report-links">${Object.keys(D.TEMPLATES).map(card).join('')}</ul></section>
      <section class="card"><h2>My designs</h2>${mine.length ? `<ul class="report-links">${mine.map((x) => `<li><a href="#/designer/${esc(x.id)}"><strong>${esc(x.name)}</strong><span>${esc(((x.params || {}).def || {}).kind === 'bs' ? 'Balance sheet' : 'Profit and loss')} · saved ${esc(new Date(x.updatedAt || x.createdAt).toLocaleDateString())}</span></a></li>`).join('')}</ul>` : '<p class="muted">Designs you save appear here and under Reports → My reports.</p>'}</section>
      <input type="file" id="dz-file" accept=".json,application/json" hidden>`,
    'Lay out your own financial statements: pick accounts for each line, add formulas such as gross margin or the current ratio, and style rows. Figures come from the same engine as every other report.');
    const file = el.querySelector('#dz-file');
    el.querySelector('#dz-import').addEventListener('click', () => file.click());
    file.addEventListener('change', () => importFile(file.files[0]));
  }
  function importFile(f) {
    if (!f) return;
    f.text().then((t) => {
      const def = D.fromJson(t, UI.book);
      ds = fresh('import:' + Date.now(), def, null);
      ds.dirty = true;
      UI.go('#/designer/new?imported=1');
      UI.toast('Template imported. Save it to keep it.');
    }).catch((e) => UI.toast(e.message, 'error'));
  }

  /* ---------- editor ---------- */
  function fresh(key, def, savedId) { return { key, def, savedId, company: UI.book.company.id, sel: def.rows.length ? 0 : -1, collapsed: {}, seen: {}, dirty: false }; }
  function editor(el, r) {
    const b = UI.book;
    let key = r.id === 'new' ? (r.params.imported && ds && /^import:/.test(ds.key) ? ds.key : 'new:' + (r.params.tpl || 'blankpl')) : r.id;
    if (!ds || ds.key !== key || ds.company !== b.company.id) {
      if (r.id === 'new') {
        const def = D.starter(r.params.tpl || 'blankpl') || D.starter('blankpl');
        ds = fresh(key, def, null);
      } else {
        const saved = b.reports.find((x) => x.id === r.id && !x.deleted && x.report === 'designer');
        if (!saved) { el.innerHTML = UI.page('Statement designer', '', UI.empty('This design was deleted or does not exist.', '<a class="btn" href="#/designer">All designs</a>')); return; }
        ds = fresh(key, D.normalize(Object.assign({}, saved.params.def, { name: saved.name })), saved.id);
      }
    }
    const def = ds.def, ranges = UI.ranges();
    const per = def.period || {};
    if (!per.range) per.range = 'fyToDate';
    if (per.range !== 'custom' && ranges[per.range]) { per.from = ranges[per.range][1]; per.to = ranges[per.range][2]; }
    if (!U.isDate(per.from) || !U.isDate(per.to)) { per.range = 'fyToDate'; per.from = ranges.fyToDate[1]; per.to = ranges.fyToDate[2]; }
    if (per.range === 'all' && def.kind === 'bs') per.to = U.today();
    def.period = per;
    const title = def.name || (def.kind === 'bs' ? 'New balance sheet design' : 'New profit and loss design');
    el.innerHTML = `<div class="page report-page dz-page" data-testid="designer">
      <div class="page-head no-print"><div><a href="#/designer" class="back">Statement designer</a><h1 id="dz-h1">${esc(title)}</h1></div>
        <div class="actions">
          <button type="button" class="btn" data-x="xlsx" data-key="e">Excel</button><button type="button" class="btn" data-x="pdf">PDF</button><button type="button" class="btn" id="dz-print" data-key="p">Print</button>
          <div class="menu-wrap"><button type="button" class="btn" id="dz-more" aria-haspopup="menu" aria-expanded="false">More ▾</button>
            <div class="menu" role="menu" hidden><button type="button" role="menuitem" data-m="copy">Save as a copy…</button><button type="button" role="menuitem" data-m="export">Export template (.json)</button><button type="button" role="menuitem" data-m="import">Import template…</button>${ds.savedId ? '<button type="button" role="menuitem" data-m="delete">Delete design…</button>' : ''}</div></div>
          <button type="button" class="btn primary" id="dz-save" data-key="s">Save</button></div></div>
      <form class="toolbar wrap no-print dz-opts" id="dz-opts" autocomplete="off">
        <label>Name <input id="dz-name" maxlength="80" value="${esc(def.name)}" placeholder="Name this design"></label>
        <label>Statement <select id="dz-kind"><option value="pl">Profit and loss</option><option value="bs"${def.kind === 'bs' ? ' selected' : ''}>Balance sheet</option></select></label>
        <label>Period ${UI.rangeSelect('dz-range', per.range)}</label>
        ${def.kind === 'bs' ? '' : `<label>From <input type="date" id="dz-from" value="${esc(per.from)}"></label>`}
        <label>${def.kind === 'bs' ? 'As of' : 'To'} <input type="date" id="dz-to" value="${esc(per.to)}"></label>
        <label>Basis <select id="dz-basis"><option value="">Company default</option><option value="accrual"${def.basis === 'accrual' ? ' selected' : ''}>Accrual</option><option value="cash"${def.basis === 'cash' ? ' selected' : ''}>Cash</option></select></label>
        <label>Columns <select id="dz-by">${BY.filter((x) => def.kind !== 'bs' || ['class', 'customer', 'vendor'].indexOf(x[0]) < 0).map(([k, l]) => `<option value="${k}"${def.columns.by === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        <fieldset class="dz-cmp"><legend>Compare</legend>${CMP[def.kind].map((c) => `<label class="check"><input type="checkbox" name="cmp" value="${c}"${def.columns.compare.indexOf(c) >= 0 ? ' checked' : ''}> ${esc(R.COMPARE_LABELS[c].replace(/ \(.*\)$/, ''))}</label>`).join('')}</fieldset>
      </form>
      <div class="dz-split">
        <section class="card dz-rows no-print" aria-labelledby="dz-rows-h">
          <div class="card-head"><h2 id="dz-rows-h">Rows</h2>
            <div class="menu-wrap"><button type="button" class="btn small" id="dz-add" aria-haspopup="menu" aria-expanded="false">+ Add row ▾</button>
              <div class="menu" role="menu" hidden>${Object.keys(TYPE_LABEL).map((t) => `<button type="button" role="menuitem" data-add="${t}">${TYPE_LABEL[t]}</button>`).join('')}</div></div></div>
          <ol class="dz-list" id="dz-list" role="listbox" aria-labelledby="dz-rows-h" tabindex="0"></ol>
          <div class="sr-only" aria-live="polite" id="dz-live"></div>
          <div id="dz-edit" class="dz-edit"></div>
        </section>
        <section class="dz-preview" aria-label="Preview">
          <div id="dz-msgs"></div>
          <article class="report sb-report d-compact grid-rows" aria-label="${esc(title)} preview">
            <header><h2>${esc(b.company.name)}</h2><h1 id="dz-ptitle">${esc(title)}</h1><p id="dz-pperiod"></p></header>
            <div class="sb-table-wrap" id="dz-table"></div>
            <footer class="muted small" id="dz-pfoot"></footer>
          </article>
        </section>
      </div>
      <input type="file" id="dz-file" accept=".json,application/json" hidden></div>`;
    UI.guard.save = () => save(false);
    if (ds.dirty) UI.dirty = true;
    bind(el);
    drawList(el); drawEditor(el); drawPreview(el);
  }

  const changed = (el, opts) => {
    ds.dirty = true; UI.dirty = true;
    if (!opts || opts.list !== false) drawList(el);
    clearTimeout(ds.t); ds.t = setTimeout(() => drawPreview(el), opts && opts.now ? 0 : 160);
  };
  const rowTitle = (r) => r.type === 'spacer' ? '(blank line)' : (r.label || (r.type === 'formula' ? r.formula || '(formula)' : '(no label)'));

  function drawList(el) {
    const list = el.querySelector('#dz-list'), rows = ds.def.rows;
    list.innerHTML = rows.map((r, i) => `<li role="option" id="dz-r-${i}" data-i="${i}" draggable="true" aria-selected="${i === ds.sel}" class="${i === ds.sel ? 'on' : ''}">
      <span class="dz-grip" aria-hidden="true">⋮⋮</span><span class="badge dz-t-${r.type}">${TYPE_LABEL[r.type]}</span>
      <span class="dz-lbl" style="padding-left:${(((r.style || {}).indent) || 0) * 0.7}rem">${esc(rowTitle(r))}</span>${r.id ? `<code class="dz-id">${esc(r.id)}</code>` : ''}
      <span class="dz-btns"><button type="button" class="btn ghost small" data-up="${i}" aria-label="Move ${esc(rowTitle(r))} up"${i ? '' : ' disabled'}>↑</button><button type="button" class="btn ghost small" data-down="${i}" aria-label="Move ${esc(rowTitle(r))} down"${i < rows.length - 1 ? '' : ' disabled'}>↓</button><button type="button" class="btn ghost small" data-dup="${i}" aria-label="Duplicate ${esc(rowTitle(r))}">⧉</button><button type="button" class="btn ghost small" data-del="${i}" aria-label="Delete ${esc(rowTitle(r))}">✕</button></span></li>`).join('') ||
      '<li class="muted dz-empty">No rows yet. Use “+ Add row”.</li>';
    if (ds.sel >= 0) list.setAttribute('aria-activedescendant', 'dz-r-' + ds.sel); else list.removeAttribute('aria-activedescendant');
  }
  function move(el, from, to) {
    const rows = ds.def.rows;
    if (to < 0 || to >= rows.length || from === to) return;
    const [r] = rows.splice(from, 1); rows.splice(to, 0, r);
    ds.sel = to; changed(el, { now: true }); drawEditor(el);
    el.querySelector('#dz-live').textContent = rowTitle(r) + ' moved to position ' + (to + 1) + ' of ' + rows.length;
  }
  function select(el, i, focusList) {
    ds.sel = i; drawList(el); drawEditor(el);
    if (focusList) el.querySelector('#dz-list').focus();
  }
  const newRow = (type) => {
    const ids = {}; ds.def.rows.forEach((r) => { if (r.id) ids[r.id] = 1; });
    const id = (base) => { let k = 1; while (ids[base + k]) k++; return base + k; };
    if (type === 'accounts') return { id: id('row'), type, label: 'New accounts row', select: { types: [] }, detail: 'summary' };
    if (type === 'formula') return { id: id('calc'), type, label: 'New calculation', formula: '', format: 'money', style: { bold: true, line: 'above' } };
    if (type === 'header') return { type, label: 'Heading' };
    if (type === 'text') return { type, label: 'Note' };
    return { type: 'spacer' };
  };

  /* ---------- row editor ---------- */
  function drawEditor(el) {
    const host = el.querySelector('#dz-edit'), r = ds.def.rows[ds.sel];
    if (!r) { host.innerHTML = '<p class="muted small">Select a row to edit it.</p>'; return; }
    const kind = ds.def.kind, b = UI.book, sel = r.select || {}, st = r.style || {}, cd = r.cond || {};
    const types = S.ACCOUNT_TYPES.filter((t) => kind === 'bs' ? S.isBS(t.id) : S.isPL(t.id));
    const accs = b.sortedAccounts((a) => types.some((t) => t.id === a.type));
    const ids = ds.def.rows.filter((x) => x.id && x !== r && (x.type === 'accounts' || x.type === 'formula')).map((x) => x.id);
    const opt = (list, v) => list.map(([k, l]) => `<option value="${esc(k)}"${String(v === undefined ? '' : v) === k ? ' selected' : ''}>${esc(l)}</option>`).join('');
    const chk = (name, label, on) => `<label class="check"><input type="checkbox" name="${name}"${on ? ' checked' : ''}> ${label}</label>`;
    let html = `<h3>${TYPE_LABEL[r.type]} row ${ds.sel + 1}</h3><form id="dz-row" class="dz-form" autocomplete="off">`;
    if (r.type !== 'spacer') html += `<label class="field"><span>Label</span><input name="label" maxlength="120" value="${esc(r.label || '')}"></label>`;
    if (r.type === 'accounts' || r.type === 'formula') html += `<label class="field"><span>Row id <span class="muted small">(use it in formulas)</span></span><input name="id" maxlength="32" value="${esc(r.id || '')}" pattern="[a-z_][a-z0-9_]*" spellcheck="false"></label>`;
    if (r.type === 'accounts') {
      html += `<fieldset class="dz-types"><legend>Account types</legend>${types.map((t) => `<label class="check"><input type="checkbox" name="atype" value="${t.id}"${(sel.types || []).indexOf(t.id) >= 0 ? ' checked' : ''}> ${esc(t.label)}</label>`).join('')}</fieldset>
        <label class="field"><span>Account numbers <span class="muted small">(e.g. 4000-4999, 6100)</span></span><input name="numbers" value="${esc(sel.numbers || '')}" spellcheck="false"></label>
        <label class="field"><span>Name contains</span><input name="match" value="${esc(sel.match || '')}"></label>
        <label class="field"><span>Also these accounts <span class="muted small">(Ctrl/⌘-click for several)</span></span><select name="accounts" multiple size="6">${accs.map((a) => `<option value="${esc(a.id)}"${(sel.accounts || []).indexOf(a.id) >= 0 ? ' selected' : ''}>${esc(b.accountLabel(a.id))}</option>`).join('')}</select></label>
        ${chk('rest', 'All remaining accounts (not picked by another row)', sel.rest)}${kind === 'bs' ? chk('netIncome', 'Include net income for the year', sel.netIncome) : ''}
        <label class="field"><span>Show</span><select name="detail">${opt([['summary', 'One line, expandable to accounts'], ['accounts', 'Each account with a total'], ['none', 'One line only']], r.detail || 'summary')}</select></label>
        <label class="field"><span>Total line label</span><input name="totalLabel" maxlength="120" value="${esc(r.totalLabel || '')}" placeholder="Total ${esc(r.label || '')}"></label>
        <label class="field"><span>Sign</span><select name="sign">${opt([['1', 'As the accounts normally show'], ['-1', 'Reversed']], String(r.sign || 1))}</select></label>`;
    }
    if (r.type === 'formula') {
      html += `<label class="field"><span>Formula</span><input name="formula" value="${esc(r.formula || '')}" spellcheck="false" placeholder="income - cogs" aria-describedby="dz-fhelp"></label>
        <p class="muted small" id="dz-fhelp">Use row ids with + − × ÷ and ( ). Also abs(), min(), max(). Money rows are in dollars; a % row shows a fraction as a percent (gp / income).</p>
        ${ids.length ? `<div class="dz-chips" aria-label="Insert a row id">${ids.map((x) => `<button type="button" class="btn ghost small" data-ins="${esc(x)}">${esc(x)}</button>`).join('')}</div>` : ''}
        <label class="field"><span>Show as</span><select name="format">${opt([['money', 'Money'], ['pct', 'Percent'], ['ratio', 'Ratio (2 decimals)']], r.format || 'money')}</select></label>`;
    }
    if (r.type !== 'spacer') {
      html += `<fieldset><legend>Style</legend>${r.type !== 'header' ? chk('bold', 'Bold', st.bold) : ''}${chk('italic', 'Italic', st.italic)}
        <label class="field"><span>Indent</span><select name="indent">${opt([0, 1, 2, 3, 4, 5, 6].map((n) => [String(n), n ? n + ' level' + (n > 1 ? 's' : '') : 'None']), String(st.indent || 0))}</select></label>
        ${r.type === 'accounts' || r.type === 'formula' ? `<label class="field"><span>Line</span><select name="line">${opt([['', 'None'], ['above', 'Line above the amounts'], ['double', 'Total (line above, double line below)']], st.line || '')}</select></label>${chk('hideZero', 'Hide when every amount is zero', st.hideZero)}` : ''}
        ${chk('pageBreak', 'Start a new page here (PDF and print)', st.pageBreak)}</fieldset>`;
    } else html += `<fieldset><legend>Style</legend>${chk('pageBreak', 'Start a new page here (PDF and print)', st.pageBreak)}</fieldset>`;
    if (r.type === 'accounts' || r.type === 'formula') {
      html += `<fieldset><legend>Highlight</legend><div class="dz-cond"><span>When the amount is</span><select name="cop" aria-label="Comparison">${opt([['', 'never'], ['lt', 'less than'], ['le', 'at most'], ['gt', 'more than'], ['ge', 'at least']], cd.op || '')}</select>
        <input name="cval" type="number" step="any" aria-label="Value" value="${cd.value === undefined ? '' : esc(cd.value)}"><select name="cstyle" aria-label="Colour">${opt([['bad', 'show in red'], ['good', 'show in green']], cd.style || 'bad')}</select></div>
        <p class="muted small">Dollars for money rows; percent for % rows (30 = 30 %); the ratio for ratio rows.</p></fieldset>`;
    }
    host.innerHTML = html + '</form>';
    const form = host.querySelector('#dz-row');
    const read = () => {
      const f = (n) => form.querySelector(`[name="${n}"]`);
      const on = (n) => !!(f(n) && f(n).checked);
      const val = (n) => (f(n) ? f(n).value : '');
      const x = { type: r.type };
      if (r.type !== 'spacer') x.label = val('label');
      if (val('id').trim()) x.id = val('id').trim().toLowerCase();
      if (r.type === 'accounts') {
        x.select = { types: [...form.querySelectorAll('[name="atype"]:checked')].map((c) => c.value) };
        if (val('numbers').trim()) x.select.numbers = val('numbers').trim();
        if (val('match').trim()) x.select.match = val('match').trim();
        const picked = [...f('accounts').selectedOptions].map((o) => o.value); if (picked.length) x.select.accounts = picked;
        if (on('rest')) x.select.rest = true; if (on('netIncome')) x.select.netIncome = true;
        x.detail = val('detail'); if (val('totalLabel').trim()) x.totalLabel = val('totalLabel').trim(); if (val('sign') === '-1') x.sign = -1;
      }
      if (r.type === 'formula') { x.formula = val('formula'); x.format = val('format'); }
      const s = {};
      if (on('bold') || r.type === 'header') s.bold = true; if (on('italic')) s.italic = true; if (+val('indent')) s.indent = +val('indent');
      if (val('line')) s.line = val('line'); if (on('hideZero')) s.hideZero = true; if (on('pageBreak')) s.pageBreak = true;
      if (Object.keys(s).length) x.style = s;
      if (val('cop') && val('cval') !== '' && isFinite(+val('cval'))) x.cond = { op: val('cop'), value: +val('cval'), style: val('cstyle') };
      return x;
    };
    const apply = () => {
      const old = ds.def.rows[ds.sel], x = read();
      // renaming a row id updates the formulas that use it
      if (old.id && x.id && old.id !== x.id && /^[a-z_][a-z0-9_]*$/.test(x.id)) ds.def.rows.forEach((o) => { if (o.formula) o.formula = o.formula.replace(new RegExp('\\b' + old.id + '\\b', 'gi'), x.id); });
      ds.def.rows[ds.sel] = x; changed(el);
    };
    form.addEventListener('input', apply);
    form.addEventListener('change', apply);
    form.addEventListener('submit', (e) => e.preventDefault());
    host.querySelectorAll('[data-ins]').forEach((x) => x.addEventListener('click', () => {
      const inp = form.querySelector('[name="formula"]'), at = inp.selectionStart === null ? inp.value.length : inp.selectionStart;
      inp.value = inp.value.slice(0, at) + (at && !/\s$/.test(inp.value.slice(0, at)) ? ' ' : '') + x.dataset.ins + ' ' + inp.value.slice(inp.selectionEnd || at);
      inp.focus(); apply();
    }));
  }

  /* ---------- preview ---------- */
  function runNow() {
    const def = ds.def;
    return D.run(UI.book, def, { from: def.period.from, to: def.period.to });
  }
  function nfParams() { return { basis: ds.def.basis || UI.book.company.basis, class: '', hideList: [] }; }
  function periodText() {
    const p = ds.def.period, ld = (d) => new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    return ds.def.kind === 'bs' ? 'As of ' + ld(p.to) : (p.range === 'all' ? 'All dates' : ld(p.from) + ' – ' + ld(p.to));
  }
  function drawPreview(el) {
    if (!el.isConnected) return;
    const res = runNow(), msgs = el.querySelector('#dz-msgs'), host = el.querySelector('#dz-table');
    ds.last = res;
    el.querySelector('#dz-ptitle').textContent = ds.def.name || 'Untitled design';
    el.querySelector('#dz-pperiod').textContent = periodText();
    el.querySelector('#dz-pfoot').textContent = (res.basis === 'cash' ? 'Cash' : 'Accrual') + ' basis · figures from the posted ledger';
    msgs.innerHTML = (res.errors.length ? `<div class="banner danger" role="alert"><strong>Fix these to see the report:</strong><ul>${res.errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>` : '') +
      (res.warnings.length ? `<div class="banner warn" data-testid="dz-warn"><ul>${res.warnings.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>${res.audit.unmapped.length ? '<button type="button" class="btn small" id="dz-addrest">Add a row for them</button>' : ''}</div>` : '');
    const ar = msgs.querySelector('#dz-addrest');
    if (ar) ar.addEventListener('click', () => { const r = newRow('accounts'); r.label = 'Other'; r.select = { rest: true }; ds.def.rows.push(r); ds.sel = ds.def.rows.length - 1; changed(el, { now: true }); drawEditor(el); });
    if (res.errors.length) { host.innerHTML = ''; return; }
    Object.keys(res.collapsed).forEach((k) => { if (!ds.seen[k]) { ds.seen[k] = 1; ds.collapsed[k] = true; } });
    const state = { st: res, p: nfParams(), collapsed: ds.collapsed, sort: ds.sort || null };
    host.innerHTML = UI.statementTable(state);
    ds.state = state;
  }

  /* ---------- actions ---------- */
  function save(asCopy) {
    const b = UI.book, def = ds.def;
    const v = D.validate(D.normalize(def), b);
    if (v.errors.length) { UI.toast('Fix the problems shown above the preview first.', 'error'); return Promise.resolve(false); }
    const go = (name) => b.saveReport({ id: asCopy ? undefined : ds.savedId, name, report: 'designer', params: { def: D.normalize(Object.assign({}, def, { name })) } }).then((x) => {
      def.name = x.name; ds.dirty = false; UI.dirty = false; UI.toast('Saved “' + x.name + '”.');
      if (x.id !== ds.savedId) { ds.savedId = x.id; ds.key = x.id; UI._allowNav = true; location.hash = '#/designer/' + x.id; }
      else { const h = document.getElementById('dz-h1'); if (h) h.textContent = x.name; }
      return true;
    }, (e) => { UI.error(e); return false; });
    if (def.name && !asCopy) return go(def.name);
    return UI.prompt(asCopy ? 'Save a copy' : 'Save design', 'Name', asCopy ? (def.name || 'Design') + ' (copy)' : def.name || (def.kind === 'bs' ? 'My balance sheet' : 'My profit and loss'), { ok: 'Save' }).then((n) => (n ? go(n.trim()) : false));
  }
  function exportOut(fmt) {
    const res = ds.last || runNow();
    if (res.errors.length) return UI.toast('Fix the problems shown above the preview first.', 'error');
    const title = ds.def.name || 'Statement';
    const model = M.fromStatement(res, { company: UI.book.company.name, title, lines: [periodText()], footer: [(res.basis === 'cash' ? 'Cash' : 'Accrual') + ' basis | Prepared ' + new Date().toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' })], nf: {}, collapsed: ds.collapsed });
    UI.exportMatrix(title.replace(/[^A-Za-z0-9]+/g, '_'), [], fmt, { model });
  }

  function bind(el) {
    const def = ds.def;
    el.querySelector('#dz-name').addEventListener('input', (e) => { def.name = e.target.value; changed(el, { list: false }); });
    el.querySelector('#dz-kind').addEventListener('change', (e) => {
      const k = e.target.value;
      UI.confirm('Change statement type', '<p>Switching between profit and loss and balance sheet starts from the blank template for that statement. Your current rows are replaced.</p>', { ok: 'Switch' }).then((ok) => {
        if (!ok) { e.target.value = def.kind; return; }
        const n = D.starter(k === 'bs' ? 'blankbs' : 'blankpl'); n.name = def.name; ds.def = n; ds.sel = 0; ds.collapsed = {}; ds.seen = {}; ds.dirty = true; UI.render();
      });
    });
    const setPer = (p) => { def.period = Object.assign({}, def.period, p); ds.dirty = true; UI.dirty = true; UI.render(); };
    el.querySelector('#dz-range').addEventListener('change', (e) => { if (e.target.value !== 'custom') setPer({ range: e.target.value }); });
    ['#dz-from', '#dz-to'].forEach((s) => { const x = el.querySelector(s); if (x) U.dateCommit(x, () => {}, () => {   // never mid-typing
      const from = el.querySelector('#dz-from') ? el.querySelector('#dz-from').value : U.fiscalYearStart(el.querySelector('#dz-to').value, UI.book.company.fiscalYearStartMonth);
      const to = el.querySelector('#dz-to').value;
      if (!U.isDate(from) || !U.isDate(to) || from > to) return UI.toast('Enter a valid date range.', 'error');
      setPer({ range: 'custom', from, to });
    }); });
    el.querySelector('#dz-basis').addEventListener('change', (e) => { def.basis = e.target.value; changed(el, { list: false, now: true }); });
    el.querySelector('#dz-by').addEventListener('change', (e) => { def.columns.by = e.target.value; changed(el, { list: false, now: true }); });
    el.querySelectorAll('[name="cmp"]').forEach((c) => c.addEventListener('change', () => { def.columns.compare = [...el.querySelectorAll('[name="cmp"]:checked')].map((x) => x.value); changed(el, { list: false, now: true }); }));
    el.querySelector('#dz-opts').addEventListener('submit', (e) => e.preventDefault());

    // menus
    el.querySelectorAll('.menu-wrap > button').forEach((btn) => btn.addEventListener('click', (e) => {
      e.stopPropagation(); const m = btn.nextElementSibling, open = m.hidden;
      el.querySelectorAll('.menu-wrap .menu').forEach((x) => { x.hidden = true; x.previousElementSibling.setAttribute('aria-expanded', 'false'); });
      if (open) { m.hidden = false; btn.setAttribute('aria-expanded', 'true'); const f = m.querySelector('button'); if (f) f.focus(); }
    }));
    el.addEventListener('click', (e) => { if (!e.target.closest('.menu-wrap')) el.querySelectorAll('.menu-wrap .menu').forEach((x) => { if (!x.hidden) { x.hidden = true; x.previousElementSibling.setAttribute('aria-expanded', 'false'); } }); });
    el.querySelectorAll('.menu').forEach((m) => m.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); m.hidden = true; m.previousElementSibling.setAttribute('aria-expanded', 'false'); m.previousElementSibling.focus(); } }));
    el.querySelectorAll('[data-add]').forEach((x) => x.addEventListener('click', () => {
      x.closest('.menu').hidden = true;
      const at = ds.sel >= 0 ? ds.sel + 1 : ds.def.rows.length;
      ds.def.rows.splice(at, 0, newRow(x.dataset.add)); ds.sel = at; changed(el, { now: true }); drawEditor(el);
      const f = el.querySelector('#dz-row input, #dz-row select'); if (f) f.focus();
    }));
    const file = el.querySelector('#dz-file');
    file.addEventListener('change', () => importFile(file.files[0]));
    el.querySelectorAll('[data-m]').forEach((x) => x.addEventListener('click', () => {
      x.closest('.menu').hidden = true;
      const a = x.dataset.m;
      if (a === 'copy') save(true);
      if (a === 'export') { U.download(U.safeFileName((ds.def.name || 'report_template')) + '.vbtemplate.json', D.toJson(ds.def), 'application/json'); UI.toast('Template exported.'); }
      if (a === 'import') UI.confirmLeave(() => file.click());
      if (a === 'delete') UI.confirm('Delete design', `<p>Delete “${esc(ds.def.name)}”? Your transactions are not affected.</p>`, { danger: true, ok: 'Delete' }).then((ok) => ok && UI.book.deleteReport(ds.savedId).then(() => { ds = null; UI.dirty = false; UI.toast('Design deleted.'); UI.go('#/designer'); }));
    }));
    el.querySelector('#dz-save').addEventListener('click', () => save(false));
    el.querySelectorAll('[data-x]').forEach((x) => x.addEventListener('click', () => exportOut(x.dataset.x)));
    el.querySelector('#dz-print').addEventListener('click', () => window.print());

    // row list: click, buttons, keyboard, drag and drop
    const list = el.querySelector('#dz-list');
    list.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (btn) {
        if (btn.dataset.up !== undefined) return move(el, +btn.dataset.up, +btn.dataset.up - 1);
        if (btn.dataset.down !== undefined) return move(el, +btn.dataset.down, +btn.dataset.down + 1);
        if (btn.dataset.dup !== undefined) { const i = +btn.dataset.dup, c = U.clone(ds.def.rows[i]); if (c.id) c.id = newRow(c.type).id; ds.def.rows.splice(i + 1, 0, c); ds.sel = i + 1; changed(el, { now: true }); drawEditor(el); return; }
        if (btn.dataset.del !== undefined) { const i = +btn.dataset.del; ds.def.rows.splice(i, 1); ds.sel = Math.min(i, ds.def.rows.length - 1); changed(el, { now: true }); drawEditor(el); list.focus(); return; }
      }
      const li = e.target.closest('li[data-i]'); if (li) select(el, +li.dataset.i);
    });
    list.addEventListener('keydown', (e) => {
      if (e.target !== list) return;
      const n = ds.def.rows.length; if (!n) return;
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const d = e.key === 'ArrowUp' ? -1 : 1;
        if (e.altKey) { move(el, ds.sel, ds.sel + d); list.focus(); }
        else select(el, Math.max(0, Math.min(n - 1, (ds.sel < 0 ? 0 : ds.sel + d))), true);
      } else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); select(el, e.key === 'Home' ? 0 : n - 1, true); }
      else if (e.key === 'Enter') { e.preventDefault(); const f = el.querySelector('#dz-row input, #dz-row select'); if (f) f.focus(); }
      else if (e.key === 'Delete') { e.preventDefault(); const b2 = list.querySelector(`[data-del="${ds.sel}"]`); if (b2) b2.click(); }
    });
    let dragFrom = -1;
    list.addEventListener('dragstart', (e) => { const li = e.target.closest('li[data-i]'); if (!li) return; dragFrom = +li.dataset.i; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(dragFrom)); li.classList.add('dragging'); });
    list.addEventListener('dragover', (e) => { if (dragFrom < 0) return; e.preventDefault(); const li = e.target.closest('li[data-i]'); list.querySelectorAll('.drop-before').forEach((x) => x.classList.remove('drop-before')); if (li) li.classList.add('drop-before'); });
    list.addEventListener('dragend', () => { dragFrom = -1; list.querySelectorAll('.dragging, .drop-before').forEach((x) => x.classList.remove('dragging', 'drop-before')); });
    list.addEventListener('drop', (e) => {
      e.preventDefault();
      const li = e.target.closest('li[data-i]'), from = dragFrom; dragFrom = -1;
      if (from < 0) return;
      move(el, from, li ? +li.dataset.i : ds.def.rows.length - 1); // the dragged row takes the place of the row it is dropped on
    });

    // preview table: expand / collapse and sort, like the statement screen
    el.querySelector('#dz-table').addEventListener('click', (e) => {
      const tog = e.target.closest('[data-tog]');
      if (tog) { const k = tog.dataset.tog; if (ds.collapsed[k]) delete ds.collapsed[k]; else ds.collapsed[k] = true; drawPreview(el); const again = el.querySelector(`[data-tog="${CSS.escape(k)}"]`); if (again) again.focus(); return; }
      const so = e.target.closest('[data-sort]');
      if (so) { const ci = +so.dataset.sort, cur = ds.sort; ds.sort = !cur || cur.col !== ci ? { col: ci, dir: 'desc' } : cur.dir === 'desc' ? { col: ci, dir: 'asc' } : null; drawPreview(el); }
    });
  }
})();
