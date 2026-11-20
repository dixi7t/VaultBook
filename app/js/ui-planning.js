/* OfflineBooks US — classes, budgets and 1099 setup screens. */
(function () {
  'use strict';
  const U = OB.util, S = OB.schema, R = OB.reports, UI = OB.ui, esc = U.esc;
  const routes = UI.routes;

  /* =============== Classes =============== */
  UI.classOptions = (selected, opts) => {
    opts = opts || {};
    const b = UI.book;
    return (opts.blank !== false ? `<option value="">${esc(opts.blankLabel || '—')}</option>` : '') +
      b.sortedClasses((c) => c.active !== false || c.id === selected).map((c) => `<option value="${esc(c.id)}"${c.id === selected ? ' selected' : ''}>${esc(b.classFullName(c.id))}${c.active === false ? ' (inactive)' : ''}</option>`).join('');
  };
  UI.editClass = (c, pre) => {
    const b = UI.book;
    const parents = b.sortedClasses((x) => !c || x.id !== c.id);
    return UI.modal({
      title: c ? 'Edit class' : 'New class',
      html: `<div class="form-grid"><label class="field span2"><span>Name</span><input id="cl-name" maxlength="80" value="${esc(c ? c.name : pre || '')}"></label>
        <label class="field span2"><span>Sub-class of (optional)</span><select id="cl-parent"><option value="">— None (top level) —</option>${parents.map((x) => `<option value="${esc(x.id)}"${c && c.parentId === x.id ? ' selected' : ''}>${esc(b.classFullName(x.id))}</option>`).join('')}</select></label>
        <label class="field span2"><span>Description (optional)</span><input id="cl-desc" maxlength="200" value="${esc(c ? c.description || '' : '')}"></label>
        ${c ? `<label class="check span2"><input type="checkbox" id="cl-active" ${c.active !== false ? 'checked' : ''}> Active (inactive classes can’t be chosen on new transactions)</label>` : ''}</div>`,
      actions: [{ label: 'Cancel', value: null }, { label: 'Save', primary: true, collect: (m) => ({ id: c ? c.id : '', name: m.querySelector('#cl-name').value, parentId: m.querySelector('#cl-parent').value, description: m.querySelector('#cl-desc').value, active: c ? m.querySelector('#cl-active').checked : undefined }) }]
    }).then((v) => v ? b.saveClass(v).then((x) => { UI.toast('Class saved.'); return x; }, (e) => { UI.error(e); return UI.editClass(c ? Object.assign({}, c, v) : null, v.name); }) : null);
  };
  routes.classes = (el) => {
    const b = UI.book, on = !!b.company.useClasses;
    const yStart = U.fiscalYearStart(U.today(), b.company.fiscalYearStartMonth);
    const usage = {};
    b.posted().forEach((t) => t.splits.forEach((s) => { if (s.classId && t.date >= yStart && S.isPL(b.accById[s.accountId] && b.accById[s.accountId].type)) { usage[s.classId] = usage[s.classId] || { inc: 0, exp: 0 }; const a = b.accById[s.accountId]; if (S.TYPE[a.type].cls === 'income') usage[s.classId].inc -= s.amount; else usage[s.classId].exp += s.amount; } }));
    const list = b.sortedClasses();
    const depth = (c) => { let d = 0, p = c.parentId ? b.classById[c.parentId] : null; while (p && d < 10) { d++; p = p.parentId ? b.classById[p.parentId] : null; } return d; };
    el.innerHTML = UI.page('Classes', `<button class="btn primary" id="cl-new">+ New class</button>`, `
      ${on ? '' : `<div class="banner info"><strong>Class tracking is off.</strong> Turn it on to add a Class field to every transaction line, then run Profit and Loss by Class and filter any report by class. <button class="btn small" id="cl-on">Turn on class tracking</button> <a href="#/settings?tab=features" class="small">All features</a></div>`}
      ${list.length ? `<table class="data"><thead><tr><th>Class</th><th>Description</th><th class="num">Income (FY to date)</th><th class="num">Expenses (FY to date)</th><th>Status</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>
        ${list.map((c) => { const u = usage[c.id] || { inc: 0, exp: 0 }; return `<tr class="${c.active === false ? 'muted' : ''}"><td style="padding-left:${0.7 + depth(c) * 1.3}rem">${depth(c) ? '<span class="muted">↳</span> ' : ''}<a href="#/report/pnl?${UI.qs({ class: c.id })}">${esc(c.name)}</a></td><td>${esc(c.description || '')}</td>
          <td class="num">${UI.money(u.inc, { blankZero: true })}</td><td class="num">${UI.money(u.exp, { blankZero: true })}</td><td>${c.active === false ? '<span class="badge">Inactive</span>' : '<span class="badge ok">Active</span>'}</td>
          <td class="actions-cell"><button class="btn ghost small" data-edit="${esc(c.id)}">Edit</button><a class="btn ghost small" href="#/report/pnl?${UI.qs({ class: c.id })}">P&amp;L</a></td></tr>`; }).join('')}</tbody></table>`
      : UI.empty('Classes track income and expenses by department, location, product line or job — for example “Retail”, “Online” and “Wholesale”.', '<button class="btn primary" id="cl-new2">Create your first class</button>')}`,
    'Tag transaction lines with a class, then see <a href="#/report/pnlclass">Profit and Loss by Class</a> or filter any report.');
    const nw = () => UI.editClass(null).then((x) => { if (x) UI.render(); });
    el.querySelector('#cl-new').addEventListener('click', nw);
    const n2 = el.querySelector('#cl-new2'); if (n2) n2.addEventListener('click', nw);
    const onb = el.querySelector('#cl-on'); if (onb) onb.addEventListener('click', () => b.saveCompany({ useClasses: true }).then(() => { UI.toast('Class tracking is on. Transaction lines now have a Class column.'); UI.render(); }, UI.error));
    el.querySelectorAll('[data-edit]').forEach((x) => x.addEventListener('click', () => UI.editClass(b.classById[x.dataset.edit]).then((y) => { if (y) UI.render(); })));
  };

  /* =============== Budgets =============== */
  const PL_GROUPS = [['income', 'Income'], ['cogs', 'Cost of Goods Sold'], ['expense', 'Expenses'], ['oi', 'Other Income'], ['oe', 'Other Expenses']];
  const budgetTotals = (b, bud) => {
    const t = { income: 0, cogs: 0, expense: 0, oi: 0, oe: 0 };
    Object.keys(bud.amounts).forEach((id) => { const a = b.accById[id]; if (a && t[a.type] !== undefined) t[a.type] += U.sum(bud.amounts[id]); });
    t.net = t.income - t.cogs - t.expense + t.oi - t.oe;
    return t;
  };
  const fyLabel = (b, fyStart) => {
    const end = U.addDays(U.addMonths(fyStart, 12), -1);
    return fyStart.slice(5) === '01-01' ? 'FY ' + fyStart.slice(0, 4) : 'FY ' + U.monthLabel(fyStart) + ' – ' + U.monthLabel(end);
  };
  const budgetsOff = (el) => UI.featureOff(el, 'budgets', 'Budgets', 'Budgets set monthly targets for income and expense accounts, and Budget vs. Actuals compares them with your results.');
  routes.budgets = (el) => {
    const b = UI.book, list = b.activeBudgets();
    if (!b.feature('budgets')) return budgetsOff(el);
    el.innerHTML = UI.page('Budgets', '<button class="btn primary" id="bd-new">+ New budget</button>', list.length ? `
      <table class="data"><thead><tr><th>Budget</th><th>Fiscal year</th><th>Class</th><th class="num">Income</th><th class="num">Expenses</th><th class="num">Net income</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>
      ${list.map((x) => { const t = budgetTotals(b, x); return `<tr><td><a href="#/budget/${esc(x.id)}">${esc(x.name)}</a></td><td>${esc(fyLabel(b, x.fyStart))}</td><td>${esc(x.classId ? b.classFullName(x.classId) : 'All')}</td>
        <td class="num">${UI.money(t.income + t.oi)}</td><td class="num">${UI.money(t.cogs + t.expense + t.oe)}</td><td class="num">${UI.money(t.net)}</td>
        <td class="actions-cell"><a class="btn ghost small" href="#/budget/${esc(x.id)}">Edit</a><a class="btn ghost small" href="#/report/bva?${UI.qs({ budget: x.id, range: 'custom', from: x.fyStart, to: U.addDays(U.addMonths(x.fyStart, 12), -1), by: 'month', class: x.classId })}">Budget vs. actuals</a><button class="btn ghost small" data-copy="${esc(x.id)}">Copy</button><button class="btn ghost small" data-del="${esc(x.id)}">Delete</button></td></tr>`; }).join('')}</tbody></table>`
      : UI.empty('A budget sets a monthly target for each income and expense account. Start from zero, from last year’s actual results, or from another budget.', '<button class="btn primary" id="bd-new2">Create your first budget</button>'),
    'Compare plans with results in <a href="#/report/bva">Budget vs. Actuals</a>.');
    const nw = (copyOf) => newBudget(copyOf).then((x) => { if (x) UI.go('#/budget/' + x.id); });
    el.querySelector('#bd-new').addEventListener('click', () => nw());
    const n2 = el.querySelector('#bd-new2'); if (n2) n2.addEventListener('click', () => nw());
    el.querySelectorAll('[data-copy]').forEach((x) => x.addEventListener('click', () => nw(x.dataset.copy)));
    el.querySelectorAll('[data-del]').forEach((x) => x.addEventListener('click', () => {
      const bud = b.budgets.find((y) => y.id === x.dataset.del);
      UI.confirm('Delete budget', `<p>Delete the budget “${esc(bud.name)}”? Your transactions are not affected.</p>`, { danger: true, ok: 'Delete budget' }).then((ok) => ok && b.deleteBudget(bud.id).then(() => { UI.toast('Budget deleted.'); UI.render(); }));
    }));
  };
  function newBudget(copyOf) {
    const b = UI.book, fys = U.fiscalYearStart(U.today(), b.company.fiscalYearStartMonth);
    const years = [-1, 0, 1, 2].map((k) => U.addMonths(fys, 12 * k));
    const others = b.activeBudgets();
    return UI.modal({
      title: copyOf ? 'Copy budget' : 'New budget',
      html: `<div class="form-grid"><label class="field span2"><span>Name</span><input id="bn-name" maxlength="80" value="${esc(copyOf ? 'Copy of ' + others.find((x) => x.id === copyOf).name : fyLabel(b, fys) + ' budget')}"></label>
        <label class="field"><span>Fiscal year</span><select id="bn-fy">${years.map((y) => `<option value="${y}"${y === fys ? ' selected' : ''}>${esc(fyLabel(b, y))}</option>`).join('')}</select></label>
        <label class="field"><span>Class (optional)</span><select id="bn-class"><option value="">All (company-wide)</option>${UI.classOptions('', { blank: false })}</select></label>
        <fieldset class="span2 cz-types"><legend>Start from</legend>
          <label class="check"><input type="radio" name="bn-src" value="zero" ${copyOf ? '' : 'checked'}> Blank (zeros)</label>
          <label class="check"><input type="radio" name="bn-src" value="actual"> Actual results of the previous fiscal year, month by month</label>
          ${others.length ? `<label class="check"><input type="radio" name="bn-src" value="copy" ${copyOf ? 'checked' : ''}> Another budget: <select id="bn-copy">${others.map((x) => `<option value="${esc(x.id)}"${x.id === copyOf ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>` : ''}
          <label class="field"><span>Then adjust by %</span><input id="bn-pct" inputmode="decimal" value="0" style="max-width:8rem"></label></fieldset></div>`,
      actions: [{ label: 'Cancel', value: null }, { label: 'Create budget', primary: true, collect: (m) => ({ name: m.querySelector('#bn-name').value, fyStart: m.querySelector('#bn-fy').value, classId: m.querySelector('#bn-class').value, src: (m.querySelector('[name="bn-src"]:checked') || {}).value || 'zero', copy: m.querySelector('#bn-copy') ? m.querySelector('#bn-copy').value : '', pct: parseFloat(m.querySelector('#bn-pct').value) || 0 }) }]
    }).then((v) => {
      if (!v) return null;
      let amounts = {};
      if (v.src === 'copy') { const src = b.budgets.find((x) => x.id === v.copy); amounts = U.clone(src.amounts); }
      if (v.src === 'actual') {
        const prev = U.addMonths(v.fyStart, -12);
        for (let k = 0; k < 12; k++) {
          const f = U.addMonths(prev, k), t = U.monthEnd(f);
          const mp = R.plMap(b, b.company.basis, f, t, v.classId ? { cls: R.classFilter(b, v.classId) } : null).values;
          Object.keys(mp).forEach((id) => { (amounts[id] = amounts[id] || new Array(12).fill(0))[k] = mp[id]; });
        }
      }
      if (v.pct) Object.keys(amounts).forEach((id) => { amounts[id] = amounts[id].map((c) => Math.round(c * (1 + v.pct / 100) / 100) * 100); });
      return b.saveBudget({ name: v.name, fyStart: v.fyStart, classId: v.classId, amounts });
    }).catch((e) => { UI.error(e); return null; });
  }

  routes.budget = (el, r) => {
    const b = UI.book, bud = b.budgets.find((x) => x.id === r.id && !x.deleted);
    if (!b.feature('budgets')) return budgetsOff(el);
    if (!bud) { el.innerHTML = UI.page('Budget not found', '', UI.empty('This budget does not exist.', '<a class="btn" href="#/budgets">Back to budgets</a>')); return; }
    const months = Array.from({ length: 12 }, (_, k) => U.addMonths(bud.fyStart, k));
    const rows = [];
    PL_GROUPS.forEach(([type, label]) => {
      const accs = b.sortedAccounts((a) => a.type === type && (a.active || bud.amounts[a.id]));
      if (accs.length) rows.push({ group: type, label, accs });
    });
    const val = (id, k) => bud.amounts[id] ? bud.amounts[id][k] : 0;
    const inp = (id, k) => { const v = val(id, k); return `<input class="money bd-in" inputmode="decimal" data-acc="${esc(id)}" data-m="${k}" value="${v ? U.fmtPlain(v) : ''}" placeholder="0" aria-label="${esc(b.accountLabel(id))} ${esc(U.monthLabel(months[k]))}">`; };
    el.innerHTML = `<div class="page fill bd-page">
      <div class="page-head"><div><a href="#/budgets" class="back">Budgets</a><h1>${esc(bud.name)}</h1><p class="sub">${esc(fyLabel(b, bud.fyStart))}${bud.classId ? ' · Class: ' + esc(b.classFullName(bud.classId)) : ''} · amounts in each account’s normal direction (income and expenses both positive)</p></div>
        <div class="actions"><button type="button" class="btn" id="bd-tools" aria-haspopup="menu" data-key="j,d">Adjust…</button><a class="btn" href="#/report/bva?${UI.qs({ budget: bud.id, range: 'custom', from: bud.fyStart, to: U.addDays(U.addMonths(bud.fyStart, 12), -1), by: 'month', class: bud.classId })}">Budget vs. actuals</a>
          <button type="button" class="btn" data-act="close" data-key="l,o">Close</button><button type="button" class="btn primary" id="bd-save" data-key="s">Save</button><span class="form-status" aria-live="off"></span></div></div>
      <p class="muted small no-print">A yearly amount typed in <strong>Total</strong> spreads evenly over the months.</p>
      <form id="bd-form" class="scroll-area table-wrap" autocomplete="off"><table class="data bd-grid"><thead><tr><th class="bd-acc">Account</th>${months.map((mm) => `<th class="num">${esc(U.monthLabel(mm))}</th>`).join('')}<th class="num">Total</th><th><span class="sr-only">Row actions</span></th></tr></thead><tbody>
        ${rows.map((g) => `<tr class="group"><td colspan="15">${esc(g.label)}</td></tr>` + g.accs.map((a) => `<tr data-row="${esc(a.id)}" data-type="${g.group}"><td class="bd-acc">${esc(b.accountLabel(a.id))}</td>${months.map((_, k) => `<td class="num">${inp(a.id, k)}</td>`).join('')}
          <td class="num"><input class="money bd-tot" inputmode="decimal" data-tot="${esc(a.id)}" aria-label="${esc(b.accountLabel(a.id))} total for the year"></td>
          <td class="rm"><div class="menu-wrap"><button type="button" class="btn ghost small icon" data-rowmenu aria-haspopup="menu" aria-label="Row actions for ${esc(a.name)}">⋯</button><div class="menu" role="menu" hidden>
            <button type="button" role="menuitem" data-ra="across">Copy first month across</button><button type="button" role="menuitem" data-ra="spread">Spread total evenly</button><button type="button" role="menuitem" data-ra="clear">Clear row</button></div></div></td></tr>`).join('') +
          `<tr class="subtotal" data-sub="${g.group}"><td class="bd-acc">Total ${esc(g.label)}</td>${months.map((_, k) => `<td class="num" data-sm="${k}"></td>`).join('')}<td class="num" data-sm="t"></td><td></td></tr>`).join('')}
        <tr class="grand" data-net><td class="bd-acc">Net income</td>${months.map((_, k) => `<td class="num" data-nm="${k}"></td>`).join('')}<td class="num" data-nm="t"></td><td></td></tr>
      </tbody></table></form></div>`;
    const form = el.querySelector('#bd-form');
    const cents = (x) => { try { return U.toCents(x || 0); } catch (e) { return NaN; } };
    const rowVals = (tr) => [...tr.querySelectorAll('.bd-in')].map((x) => cents(x.value) || 0);
    const recalc = () => {
      const sums = {}; PL_GROUPS.forEach(([t]) => { sums[t] = new Array(13).fill(0); });
      form.querySelectorAll('tr[data-row]').forEach((tr) => {
        const v = rowVals(tr), tot = U.sum(v);
        const ti = tr.querySelector('.bd-tot'); if (document.activeElement !== ti) ti.value = tot ? U.fmtPlain(tot) : '';
        v.forEach((c, k) => { sums[tr.dataset.type][k] += c; }); sums[tr.dataset.type][12] += tot;
      });
      PL_GROUPS.forEach(([t]) => { const sub = form.querySelector(`[data-sub="${t}"]`); if (sub) sub.querySelectorAll('[data-sm]').forEach((td) => { td.innerHTML = UI.money(sums[t][td.dataset.sm === 't' ? 12 : +td.dataset.sm]); }); });
      form.querySelectorAll('[data-nm]').forEach((td) => { const k = td.dataset.nm === 't' ? 12 : +td.dataset.nm; td.innerHTML = UI.money(sums.income[k] - sums.cogs[k] - sums.expense[k] + sums.oi[k] - sums.oe[k], { strong: true }); });
    };
    const spread = (tr, total) => {
      const ins = [...tr.querySelectorAll('.bd-in')];
      const base = Math.trunc(total / 12), rem = total - base * 12;
      ins.forEach((x, k) => { const c = base + (k === 11 ? rem : 0); x.value = c ? U.fmtPlain(c) : ''; });
    };
    form.addEventListener('change', (e) => {
      const t = e.target;
      if (t.classList.contains('bd-in')) { const c = cents(t.value); if (isNaN(c)) { t.classList.add('invalid'); return; } t.classList.remove('invalid'); t.value = c ? U.fmtPlain(c) : ''; }
      if (t.classList.contains('bd-tot')) { const c = cents(t.value); if (isNaN(c)) { t.classList.add('invalid'); return; } t.classList.remove('invalid'); spread(t.closest('tr'), c); }
      recalc();
    });
    form.addEventListener('input', (e) => { if (e.target.classList.contains('bd-in')) recalc(); });
    form.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || !e.target.matches('input')) return;
      e.preventDefault();
      const all = [...form.querySelectorAll('input')]; const i = all.indexOf(e.target);
      e.target.dispatchEvent(new Event('change', { bubbles: true }));
      const tr = e.target.closest('tr'), next = tr.nextElementSibling && tr.nextElementSibling.dataset.row !== undefined ? tr.nextElementSibling : null;
      const col = [...tr.querySelectorAll('input')].indexOf(e.target);
      const target = e.shiftKey ? all[i - 1] : next ? next.querySelectorAll('input')[col] : all[i + 1];
      if (target) { target.focus(); target.select(); }
    });
    form.addEventListener('click', (e) => {
      const rm = e.target.closest('[data-rowmenu]');
      if (rm) { const m = rm.nextElementSibling, open = m.hidden; document.querySelectorAll('.bd-grid .menu').forEach((x) => { x.hidden = true; }); m.hidden = !open; if (open) m.querySelector('button').focus(); return; }
      const ra = e.target.closest('[data-ra]');
      if (ra) {
        const tr = ra.closest('tr'), ins = [...tr.querySelectorAll('.bd-in')];
        if (ra.dataset.ra === 'across') ins.forEach((x) => { x.value = ins[0].value; });
        if (ra.dataset.ra === 'spread') spread(tr, U.sum(rowVals(tr)));
        if (ra.dataset.ra === 'clear') ins.forEach((x) => { x.value = ''; });
        ra.closest('.menu').hidden = true; recalc(); form.dispatchEvent(new Event('input'));
      }
    });
    const gather = () => { const amounts = {}; form.querySelectorAll('tr[data-row]').forEach((tr) => { amounts[tr.dataset.row] = rowVals(tr); }); return amounts; };
    const save = () => {
      if (form.querySelector('.invalid')) { UI.setStatus('failed', 'Fix the highlighted amounts.'); return Promise.resolve(false); }
      return b.saveBudget(Object.assign({}, bud, { amounts: gather() }));
    };
    const submit = () => UI.runSave(el.querySelector('#bd-save'), save, 'Budget saved').then((ok) => { if (ok) tracker.reset(); return ok; });
    const tracker = UI.trackForm(form, { snapshot: () => JSON.stringify(gather()), save: submit });
    el.querySelector('#bd-save').addEventListener('click', submit);
    el.querySelector('[data-act="close"]').addEventListener('click', () => UI.go('#/budgets'));
    el.querySelector('#bd-tools').addEventListener('click', () => UI.modal({
      title: 'Adjust budget',
      html: `<label class="field"><span>Change every amount by (%)</span><input id="adj-pct" inputmode="decimal" value="5"></label><label class="check"><input type="checkbox" id="adj-round" checked> Round to whole dollars</label>
        <fieldset class="cz-types"><legend>Apply to</legend><label class="check"><input type="radio" name="adj-w" value="all" checked> All accounts</label><label class="check"><input type="radio" name="adj-w" value="income"> Income accounts only</label><label class="check"><input type="radio" name="adj-w" value="exp"> Expense accounts only</label></fieldset>`,
      actions: [{ label: 'Cancel', value: null }, { label: 'Apply', primary: true, collect: (m) => ({ pct: parseFloat(m.querySelector('#adj-pct').value) || 0, round: m.querySelector('#adj-round').checked, w: m.querySelector('[name="adj-w"]:checked').value }) }]
    }).then((v) => {
      if (!v) return;
      form.querySelectorAll('tr[data-row]').forEach((tr) => {
        const inc = tr.dataset.type === 'income' || tr.dataset.type === 'oi';
        if ((v.w === 'income' && !inc) || (v.w === 'exp' && inc)) return;
        tr.querySelectorAll('.bd-in').forEach((x) => { let c = cents(x.value) || 0; c = c * (1 + v.pct / 100); c = v.round ? Math.round(c / 100) * 100 : Math.round(c); x.value = c ? U.fmtPlain(c) : ''; });
      });
      recalc(); tracker.refresh();
    }));
    recalc();
  };

  document.addEventListener('click', (e) => { if (!e.target.closest || !e.target.closest('.bd-grid .menu-wrap')) document.querySelectorAll('.bd-grid .menu').forEach((x) => { x.hidden = true; }); });

  /* =============== 1099 setup =============== */
  routes['1099'] = (el) => {
    const b = UI.book, map = b.company.map1099 || {};
    if (!b.feature('1099')) return UI.featureOff(el, '1099', '1099 contractors', 'Track payments to contractors and prepare Form 1099-NEC and 1099-MISC figures.');
    const accs = b.sortedAccounts((a) => ['expense', 'cogs', 'oe'].indexOf(a.type) >= 0 && (a.active || map[a.id]));
    const vendors = b.contacts.filter((c) => c.kind === 'vendor' && (c.active || c.is1099)).sort((x, y) => x.name.localeCompare(y.name));
    const year = String(+U.today().slice(0, 4) - (+U.today().slice(5, 7) <= 3 ? 1 : 0));
    const rep = R.report1099(b, { year });
    const guess = (a) => /contract|subcontract|freelanc/i.test(a.name) ? 'NEC1' : /legal|attorney|lawyer/i.test(a.name) ? 'MISC10' : /rent|lease/i.test(a.name) ? 'MISC1' : '';
    const boxSelect = (a) => `<select data-map="${esc(a.id)}" aria-label="1099 box for ${esc(a.name)}"><option value="">Not reported</option>${S.BOXES_1099.map((x) => `<option value="${x.id}"${map[a.id] === x.id ? ' selected' : ''}>${esc(x.form + ' box ' + x.box + ' — ' + x.label)}</option>`).join('')}</select>`;
    el.innerHTML = UI.page('1099 setup', `<a class="btn" href="#/report/t1099?year=${year}">1099 summary ${year}</a><a class="btn" href="#/report/d1099?year=${year}">Transaction detail</a>`, `
      <ol class="steps"><li class="on">Map accounts</li><li class="on">Choose vendors</li><li>Review and file</li></ol>
      <form id="m1099" class="card" autocomplete="off">
        <div class="card-head"><h2>1. Which accounts hold 1099 payments?</h2>${Object.keys(map).length ? '' : '<button type="button" class="btn small" id="m-guess">Suggest from account names</button>'}</div>
        <p class="muted">Pick the 1099 box for each expense account you use to pay contractors, rent, attorneys and so on. Only money paid from these accounts counts.</p>
        <table class="data compact"><thead><tr><th>Expense account</th><th>1099 box</th></tr></thead><tbody>${accs.map((a) => `<tr><td>${esc(b.accountLabel(a.id))}</td><td>${boxSelect(a)}</td></tr>`).join('')}</tbody></table>
        <h2 class="mt">2. Which vendors get a 1099?</h2>
        <p class="muted">Tick contractors and other vendors you pay for services or rent. Corporations usually don’t get a 1099 (attorneys are the exception). The W-9 they give you has their tax ID.</p>
        <table class="data compact"><thead><tr><th>Track</th><th>Vendor</th><th>Tax ID (EIN or SSN)</th><th>W-9</th><th>Address</th><th class="num">Paid ${year} (mapped accounts)</th></tr></thead><tbody>
          ${vendors.map((c) => { const r = rep.rows.find((x) => x.contactId === c.id); return `<tr><td><input type="checkbox" data-v1099="${esc(c.id)}" ${c.is1099 ? 'checked' : ''} aria-label="Track ${esc(c.name)} for 1099"></td><td><a href="#/contact/${esc(c.id)}">${esc(c.name)}</a></td>
            <td><input data-vtax="${esc(c.id)}" value="${esc(c.taxId || '')}" placeholder="12-3456789" maxlength="20" aria-label="Tax ID for ${esc(c.name)}"></td><td><input type="checkbox" data-vw9="${esc(c.id)}" ${c.w9OnFile ? 'checked' : ''} aria-label="W-9 on file for ${esc(c.name)}"></td><td>${c.address ? esc(c.address.split('\n')[0]) : '<span class="warn-text">Missing</span>'}</td><td class="num">${r ? UI.money(r.total) : ''}</td></tr>`; }).join('') || '<tr><td colspan="6" class="muted">No vendors yet.</td></tr>'}</tbody></table>
        <div class="form-actions"><button type="submit" class="btn primary" data-key="s">Save 1099 setup</button><span class="form-status" aria-live="off"></span></div>
      </form>
      <section class="card"><h2>3. Review and file</h2>
        <p>${rep.rows.filter((x) => x.meets).length} vendor(s) are over the ${year} filing threshold (${U.fmt(S.threshold1099('NEC1', year), { symbol: true })}). ${rep.missingTaxId.length ? `<span class="warn-text">${rep.missingTaxId.length} tracked vendor(s) have no tax ID.</span>` : ''}</p>
        <p><a class="btn" href="#/report/t1099?year=${year}&thr=meets">See vendors to file for ${year}</a></p>
        <p class="muted small">VaultBook prepares the figures; file Forms 1099-NEC and 1099-MISC with the IRS (IRIS or FIRE) or through your accountant, and send copies to vendors by January 31.</p></section>
      <section class="card" data-testid="forms-1099"><h2>4. Forms ${year}</h2>
        ${(() => { const rr = R.recipients1099(b, year), t = R.totals1096(rr), bad = rr.filter((x) => x.problems.length); return `
        <table class="data compact"><thead><tr><th>Form</th><th class="num">Number of forms</th><th class="num">Total reported</th></tr></thead><tbody>
          <tr><td>1099-NEC</td><td class="num">${t.nec.forms}</td><td class="num">${UI.money(t.nec.total, { symbol: true })}</td></tr>
          <tr><td>1099-MISC</td><td class="num">${t.misc.forms}</td><td class="num">${UI.money(t.misc.total, { symbol: true })}</td></tr></tbody></table>
        <p class="muted small">These are the totals for Form 1096 (needed only when filing paper Copy A).</p>
        ${bad.length ? `<div class="banner warn"><strong>Fix before filing:</strong><ul>${bad.map((x) => `<li><a href="#/contact/${esc(x.contactId)}">${esc(x.name)}</a> — ${esc(x.problems.join(', '))}</li>`).join('')}</ul></div>` : ''}
        <div class="form-actions"><button type="button" class="btn" id="f1099-pdf" data-testid="f1099-pdf"${rr.length ? '' : ' disabled'}>Recipient copies (Copy B, PDF)</button><button type="button" class="btn" id="f1099-csv" data-testid="f1099-csv"${rr.length ? '' : ' disabled'}>1099 data for IRIS (CSV)</button></div>
        <p class="muted small">Recipient copies are plain-paper substitute statements you may give vendors instead of the official Copy B. To e-file, download the 1099-NEC / 1099-MISC template from the IRS IRIS Taxpayer Portal ("Upload CSV with Form Data") and copy the columns from this CSV into it — IRIS accepts only its own template file.</p>`; })()}</section>`,
    'Prepare 1099-NEC and 1099-MISC figures from your books.');
    const form = el.querySelector('#m1099');
    const pdfBtn = el.querySelector('#f1099-pdf'), csvBtn = el.querySelector('#f1099-csv');
    if (pdfBtn) pdfBtn.addEventListener('click', () => { const L = OB.invoiceLayout, pages = L.stmt1099Pages(b, R.recipients1099(b, year), year); U.download(U.safeFileName(b.company.name + '_1099_recipient_copies_' + year) + '.pdf', new Blob([L.pdf(pages, {}, '1099 recipient copies ' + year)], { type: 'application/pdf' })); });
    if (csvBtn) csvBtn.addEventListener('click', () => U.download(U.safeFileName(b.company.name + '_1099_data_' + year) + '.csv', R.csv1099(b, year), 'text/csv'));
    const g = el.querySelector('#m-guess');
    if (g) g.addEventListener('click', () => { form.querySelectorAll('[data-map]').forEach((s) => { const a = b.accById[s.dataset.map]; if (!s.value) s.value = guess(a); }); form.dispatchEvent(new Event('change')); });
    const save = () => {
      const m = {}; form.querySelectorAll('[data-map]').forEach((s) => { if (s.value) m[s.dataset.map] = s.value; });
      let p = b.saveCompany({ map1099: m });
      form.querySelectorAll('[data-v1099]').forEach((cb) => {
        const c = b.contactById[cb.dataset.v1099], tax = form.querySelector(`[data-vtax="${CSS.escape(c.id)}"]`).value.trim();
        const w9 = form.querySelector(`[data-vw9="${CSS.escape(c.id)}"]`).checked;
        if (!!c.is1099 !== cb.checked || (c.taxId || '') !== tax || !!c.w9OnFile !== w9) p = p.then(() => b.saveContact(Object.assign({}, c, { is1099: cb.checked, taxId: tax, w9OnFile: w9 })));
      });
      return p;
    };
    const submit = () => UI.runSave(form.querySelector('[type=submit]'), save, '1099 setup saved').then((ok) => { if (ok) { tracker.reset(); UI.render(); } return ok; });
    const tracker = UI.trackForm(form, { save: submit, snapshot: () => JSON.stringify([...form.querySelectorAll('select,input')].map((x) => x.type === 'checkbox' ? x.checked : x.value)) });
    form.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
  };
})();
