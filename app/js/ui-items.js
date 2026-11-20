/* VaultBook — Products & services list (#/items) and editor.
 * Items are optional: choosing one on a sales or purchase line fills the account, description and price.
 * Data lives in the 'items' store (data v4); accounting never depends on an item. */
(function () {
  'use strict';
  const UI = OB.ui, U = OB.util, S = OB.schema, esc = U.esc;
  const typeLabel = (id) => (S.ITEM_TYPES.find((t) => t.id === id) || { label: id }).label;
  const accOpts = (b, sel, types) => '<option value="">— None —</option>' + b.sortedAccounts((a) => types.indexOf(a.type) >= 0 && (a.active !== false || a.id === sel))
    .map((a) => `<option value="${esc(a.id)}"${a.id === sel ? ' selected' : ''}>${esc(b.accountLabel(a.id))}</option>`).join('');
  const money = (c) => c === null || c === undefined ? '' : U.fmtPlain(c);

  UI.editItem = (it, name) => {
    const b = UI.book;
    const INC = ['income', 'oi', 'oca', 'ocl', 'expense', 'cogs', 'equity'];
    const EXP = ['cogs', 'expense', 'oe', 'oca', 'fixed', 'oa', 'ocl'];
    return UI.modal({
      title: it ? 'Edit product/service' : 'New product/service', wide: true,
      html: `<div class="form-grid">
        <label class="field span2"><span>Name</span><input id="it-name" maxlength="120" value="${esc(it ? it.name : name || '')}" data-testid="item-name"></label>
        <label class="field"><span>Type</span><select id="it-type">${S.ITEM_TYPES.map((t) => `<option value="${t.id}"${(it ? it.type : 'service') === t.id ? ' selected' : ''}>${esc(t.label)}</option>`).join('')}</select></label>
        <label class="field"><span>SKU / code (optional)</span><input id="it-sku" maxlength="60" value="${esc(it ? it.sku || '' : '')}"></label>
        <label class="field span2"><span>Sales description</span><input id="it-desc" maxlength="400" value="${esc(it ? it.description || '' : '')}"></label>
        <label class="field"><span>Sales price</span><input id="it-price" inputmode="decimal" value="${esc(it ? money(it.price) : '')}"></label>
        <label class="field"><span>Income account</span><select id="it-inc">${accOpts(b, it ? it.incomeAccountId : '', INC)}</select></label>
        <label class="field span2"><span>Purchase description</span><input id="it-pdesc" maxlength="400" value="${esc(it ? it.purchaseDescription || '' : '')}"></label>
        <label class="field"><span>Cost</span><input id="it-cost" inputmode="decimal" value="${esc(it ? money(it.cost) : '')}"></label>
        <label class="field"><span>Expense / COGS account</span><select id="it-exp">${accOpts(b, it ? it.expenseAccountId : '', EXP)}</select></label>
        <label class="check"><input type="checkbox" id="it-tax" ${it && it.taxable ? 'checked' : ''}> Taxable</label>
        <fieldset class="span2 inv-fs" id="it-inv" ${(it ? it.type : 'service') === 'inventory' ? '' : 'hidden'}><legend>Inventory</legend><div class="form-grid">
          <label class="check span2"><input type="checkbox" id="it-track" data-testid="item-track" ${!it || it.trackQty ? 'checked' : ''}> Track quantity on hand (average cost; cost of goods sold is recorded when you sell)</label>
          <label class="field"><span>Inventory asset account</span><select id="it-asset">${accOpts(b, it && it.assetAccountId ? it.assetAccountId : (b.sys('INV') || {}).id, ['oca', 'oa'])}</select></label>
          <label class="field"><span>Reorder point (quantity)</span><input id="it-reorder" inputmode="decimal" value="${esc(it && it.reorderPoint !== null && it.reorderPoint !== undefined ? it.reorderPoint : '')}"></label>
          ${!it ? `<label class="field"><span>Quantity on hand now</span><input id="it-oqty" inputmode="decimal" placeholder="0" data-testid="item-oqty"></label>
          <label class="field"><span>Total value of that quantity</span><input id="it-oval" inputmode="decimal" placeholder="0.00" data-testid="item-oval"></label>
          <label class="field"><span>As of</span><input type="date" id="it-odate" value="${esc(U.today())}"></label>` : ''}</div></fieldset>
        ${it ? `<label class="check"><input type="checkbox" id="it-active" ${it.active !== false ? 'checked' : ''}> Active</label>` : ''}
        <p class="muted small span2">Choosing this item on an invoice, bill, check or expense line fills in the account, description and price. Inventory parts that track quantity are bought into the inventory asset account and sold at average cost.</p></div>`,
      onMount: (m) => { const ty = m.querySelector('#it-type'), fs = m.querySelector('#it-inv'); ty.addEventListener('change', () => { fs.hidden = ty.value !== 'inventory'; }); },
      actions: [{ label: 'Cancel', value: null }, { label: 'Save', primary: true, collect: (m) => {
        const v = (id) => m.querySelector(id).value;
        const num = (id) => { const x = v(id).replace(/[$,\s]/g, ''); return x === '' ? '' : x; };
        const bad = [num('#it-price'), num('#it-cost')].some((x) => x !== '' && !isFinite(+x));
        if (bad) { UI.toast('Enter price and cost as numbers.', 'error'); return false; }
        return { id: it ? it.id : '', name: v('#it-name'), type: v('#it-type'), sku: v('#it-sku'), description: v('#it-desc'), purchaseDescription: v('#it-pdesc'),
          price: num('#it-price'), cost: num('#it-cost'), incomeAccountId: v('#it-inc'), expenseAccountId: v('#it-exp'),
          assetAccountId: v('#it-type') === 'inventory' ? v('#it-asset') : (it ? it.assetAccountId || '' : ''), taxable: m.querySelector('#it-tax').checked, active: it ? m.querySelector('#it-active').checked : undefined,
          trackQty: v('#it-type') === 'inventory' && m.querySelector('#it-track').checked, reorderPoint: num('#it-reorder'),
          _open: !it && m.querySelector('#it-oqty') ? { qty: num('#it-oqty'), value: num('#it-oval'), date: v('#it-odate') } : null };
      } }]
    }).then((v) => {
      if (!v) return null;
      const open = v._open; delete v._open;
      return b.saveItem(v).then((x) => {
        // opening quantity: an inventory adjustment against Opening Balance Equity
        if (x.trackQty && open && open.qty && +open.qty) return b.saveTransaction({ type: 'invAdjust', date: open.date || U.today(), accountId: b.sys('OBE').id, memo: 'Opening quantity', adjustments: [{ itemId: x.id, qty: +open.qty, value: open.value || '0' }] })
          .then(() => { UI.toast('Product saved with ' + open.qty + ' on hand.'); return x; }, (e) => { UI.error(e); return x; });
        UI.toast('Product/service saved.'); return x;
      }, (e) => { UI.error(e); return UI.editItem(it ? Object.assign({}, it, v) : null, v.name); });
    });
  };

  UI.routes.items = (el, r) => {
    const b = UI.book;
    const q = ((r && r.params && r.params.q) || '').toLowerCase();
    const showAll = r && r.params && r.params.all === '1';
    const list = (b.items || []).filter((it) => (showAll || it.active !== false) && (!q || (it.name + ' ' + (it.sku || '') + ' ' + (it.description || '')).toLowerCase().indexOf(q) >= 0))
      .sort((x, y) => x.name.localeCompare(y.name));
    const inactive = (b.items || []).filter((it) => it.active === false).length;
    const st = b.inventoryState(U.today());
    el.innerHTML = UI.page('Products and services', `${Object.keys(st).length ? '<a class="btn" href="#/txn/new?type=invAdjust" data-testid="inv-adjust">Adjust inventory</a><a class="btn" href="#/report/invval">Inventory valuation</a><a class="btn" href="#/report/stock">Stock status</a>' : ''}<button class="btn primary" id="it-new" data-testid="item-new">+ New product/service</button>`, `
      <form class="toolbar" id="it-f"><label>Search <input id="it-q" value="${esc(q)}" placeholder="Name, SKU or description"></label>
        ${inactive ? `<label class="check"><input type="checkbox" id="it-all" ${showAll ? 'checked' : ''}> Show inactive (${inactive})</label>` : ''}<button class="btn" type="submit">Find</button></form>
      ${list.length ? `<table class="data" data-testid="items-table"><thead><tr><th>Name</th><th>SKU</th><th>Type</th><th>Description</th><th class="num">Price</th><th class="num">Cost</th><th class="num">On hand</th><th>Income account</th><th>Status</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>
        ${list.map((it) => `<tr class="${it.active === false ? 'muted' : ''}"><td>${esc(it.name)}</td><td>${esc(it.sku || '')}</td><td>${esc(typeLabel(it.type))}</td><td class="memo">${esc(it.description || '')}</td>
          <td class="num">${it.price === null || it.price === undefined ? '' : UI.money(it.price)}</td><td class="num">${it.cost === null || it.cost === undefined ? '' : UI.money(it.cost)}</td><td class="num">${st[it.id] ? `<span class="${st[it.id].qty < 0 || (it.reorderPoint !== null && it.reorderPoint !== undefined && st[it.id].qty <= it.reorderPoint) ? 'warn-text' : ''}">${esc(String(st[it.id].qty))}</span>` : ''}</td>
          <td>${esc(it.incomeAccountId ? b.accountLabel(it.incomeAccountId) : '')}</td><td>${it.active === false ? '<span class="badge">Inactive</span>' : '<span class="badge ok">Active</span>'}</td>
          <td class="actions-cell"><button class="btn ghost small" data-edit="${esc(it.id)}">Edit</button></td></tr>`).join('')}</tbody></table>`
      : UI.empty(q ? 'No products or services match “' + esc(q) + '”.' : 'Products and services fill in the account, description and price when you pick them on an invoice or bill line.', '<button class="btn primary" id="it-new2">Create your first product/service</button>')}`,
    'See <a href="#/report/salesitem">Sales by Product/Service</a> for what each one earned.');
    const nw = () => UI.editItem(null).then((x) => { if (x) UI.render(); });
    el.querySelector('#it-new').addEventListener('click', nw);
    const n2 = el.querySelector('#it-new2'); if (n2) n2.addEventListener('click', nw);
    el.querySelector('#it-f').addEventListener('submit', (e) => {
      e.preventDefault();
      const all = el.querySelector('#it-all');
      UI.go('#/items?' + UI.qs({ q: el.querySelector('#it-q').value, all: all && all.checked ? '1' : '' }));
    });
    el.querySelectorAll('[data-edit]').forEach((x) => x.addEventListener('click', () => UI.editItem(b.itemById[x.dataset.edit]).then((y) => { if (y) UI.render(); })));
  };
})();
