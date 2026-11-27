/* VaultBook — Bank feed page (1.20): account tiles, For review / Posted / Excluded / Imports, import wizard,
 * per-line Categorize / Find match / Transfer / Split, batch actions, keyboard, adjustable columns and density.
 * All accounting goes through the engine (js/bankfeed.js); this file only draws and collects input. */
(function () {
  'use strict';
  const U = OB.util, S = OB.schema, UI = OB.ui, I = OB.importer, esc = U.esc, P = OB.prefs;
  const FEED = (a) => a.active !== false && (a.type === 'bank' || a.type === 'cc');
  // bank accounts first, then cards, by number; another current asset only once it has bank lines
  const feedAccounts = (b) => b.accounts.filter((a) => FEED(a) || (a.type === 'oca' && a.active !== false && b.bankLines.some((l) => l.accountId === a.id && l.status !== 'removed')))
    .sort((x, y) => (x.type === 'bank' ? 0 : x.type === 'cc' ? 1 : 2) - (y.type === 'bank' ? 0 : y.type === 'cc' ? 1 : 2) || String(x.number || '').localeCompare(String(y.number || '')) || x.name.localeCompare(y.name));
  const COLS = [['check', 'Check no.'], ['payee', 'Payee'], ['balance', 'Bank balance']];
  const pref = () => Object.assign({ density: 'comfortable', cols: { check: true, payee: true, balance: false }, pageSize: 100 }, P.get('bankfeed') || {});
  const setPref = (k, v) => { const p = pref(); p[k] = v; P.set('bankfeed', p); };
  // what the firm's other clients' books teach (OB.hints.learn), read once per open company; password-protected companies are skipped
  let firm = null;
  const loadFirm = (b) => {
    if (firm && firm.companyId === b.company.id) return firm.ready;
    const f = firm = { companyId: b.company.id, list: [], skipped: 0, done: false };
    f.ready = OB.db.listCompanies().then((cs) => cs.filter((c) => c.id !== b.company.id).reduce((p, c) => p.then(() => OB.db.getSecurity(c.id).then((sec) => {
      if (sec || c.protected) { f.skipped++; return; }
      return OB.db.openCompanyAdapter(c.id).then((ad) => ad.loadAll().then((data) => {
        if (data.company) { OB.schema.migrate(data); f.list.push(OB.hints.learn(new OB.Book(ad, data))); }
      }).finally(() => { if (ad.close) ad.close(); }));
    }).catch(() => { f.skipped++; })), Promise.resolve())).then(() => { f.done = true; });
    return f.ready;
  };
  let bf = null; // page state, kept while the app is open (lines themselves are in the database)
  const fresh = (b) => ({ companyId: b.company.id, accountId: '', tab: 'review', q: '', dir: 'all', onlySug: false, show: 'all', help: 'off', sort: { key: 'date', desc: true }, sel: new Set(), open: '', openTab: 'cat', drafts: {}, imp: null, focus: '', page: 0 });

  UI.routes.bankfeed = (el, r) => {
    const b = UI.book;
    if (!bf || bf.companyId !== b.company.id) bf = fresh(b);
    const accs = feedAccounts(b);
    if (r.params.account && r.params.account !== bf.accountId) { bf.accountId = r.params.account; bf.sel.clear(); bf.open = ''; }
    if (!accs.some((a) => a.id === bf.accountId)) {
      const busy = accs.find((a) => b.bankLinesFor(a.id, 'review').length);
      bf.accountId = (busy || accs[0] || {}).id || '';
    }
    const h = typeof location !== 'undefined' ? location.hash : '';
    if (h !== bf.seenHash) { // link parameters act once per visit, so Cancel or a tab click is not undone by the next render
      bf.seenHash = h;
      if (r.params.import === '1' && !bf.imp) bf.imp = { step: 'pick', accountId: bf.accountId };
      if (r.params.tab && ['review', 'posted', 'excluded', 'imports'].includes(r.params.tab)) bf.tab = r.params.tab;
    }
    if (!accs.length) {
      el.innerHTML = UI.page('Bank feed', '', UI.empty('Add a bank or credit card account first, then import its transactions here.', '<a class="btn primary" href="#/accounts">Chart of accounts</a>'));
      return;
    }
    const a = b.accById[bf.accountId], pf = pref();
    el.innerHTML = UI.page('Bank feed', `<button class="btn primary" id="bf-import" data-testid="bf-import-btn">Import file</button><a class="btn" href="#/rules">Rules</a><button class="btn" id="bf-recon" data-testid="bf-reconcile-btn">Reconcile</button>
        <details class="bf-more"><summary class="btn ghost small" aria-label="More bank feed tools" data-testid="bf-more">More ▾</summary>
          <div class="bf-morepop" role="menu"><button role="menuitem" id="bf-export" data-testid="bf-export-btn">Export posted transactions to QuickBooks…<span class="muted small">Advanced: .iif for QuickBooks Desktop, or a bank-upload file for QuickBooks Online</span></button></div></details>`,
      `<div class="bf-tiles" role="tablist" aria-label="Accounts">${accs.map((x) => tile(b, x)).join('')}</div>
       ${bf.imp ? `<section class="card bf-import" id="bf-imp" data-testid="bf-import-panel">${importPanel(b)}</section>` : ''}
       ${bf.exp ? `<section class="card bf-import" id="bf-exp" data-testid="bf-export-panel">${exportPanel(b, accs)}</section>` : ''}
       <div class="bf-tabs segmented" role="tablist" aria-label="Bank lines">${[['review', 'For review'], ['posted', 'Posted'], ['excluded', 'Excluded'], ['imports', 'Imports']].map(([k, t]) => {
        const n = k === 'imports' ? b.bankImportsFor(a.id).length : b.bankLinesFor(a.id, k).length;
        return `<button role="tab" aria-selected="${bf.tab === k}" data-tab="${k}" data-testid="bf-tab-${k}">${t} <span class="bf-count">${n}</span></button>`; }).join('')}</div>
       ${bf.tab === 'imports' ? importsTable(b, a) : linesView(b, a, pf)}`,
      'Imported lines wait here until you add, match, transfer, split or exclude each one. Nothing posts on import.');
    bind(el, b, a);
  };
  // the old CSV route and the statement reader both land here
  UI.routes.import = (el, r) => UI.go('#/bankfeed?' + UI.qs({ account: r.params.account || '', import: '1' }));
  UI.importTable = (accountId, table, fileName, sheets) => {
    const b = UI.book; if (!bf || bf.companyId !== b.company.id) bf = fresh(b);
    bf.accountId = accountId; bf.imp = startMap(b, accountId, table, fileName);
    if (sheets && sheets.length) { bf.imp.sheets = sheets; bf.imp.sheet = 0; }
  };

  function tile(b, a) {
    const bank = b.bankBalance(a.id), book = b.accountBalance(a.id), n = b.bankLinesFor(a.id, 'review').length;
    return `<button class="bf-tile${a.id === bf.accountId ? ' on' : ''}" role="tab" aria-selected="${a.id === bf.accountId}" data-acc="${esc(a.id)}" data-testid="bf-tile">
      <span class="bf-tname">${esc(b.accountLabel(a.id))}</span>
      <span class="bf-tbal"><span>Bank${bank && bank.date ? ' ' + esc(U.fmtDate(bank.date)) : ''}</span><b>${bank ? UI.money(bank.amount, { symbol: true }) : '—'}</b></span>
      <span class="bf-tbal"><span>In VaultBook</span><b>${UI.money(book, { symbol: true })}</b></span>
      <span class="bf-twait">${n ? `<em>${n}</em> to review` : 'Nothing to review'}</span></button>`;
  }

  /* ---------------- lines ---------------- */
  function rowsFor(b, a) {
    let list = b.bankLinesFor(a.id, bf.tab);
    const q = bf.q.trim().toLowerCase();
    if (q) list = list.filter((l) => l.description.toLowerCase().includes(q) || (l.checkNo || '').includes(q) || U.fmtPlain(Math.abs(l.amount)).includes(q.replace(/[$,]/g, '')));
    if (bf.dir !== 'all') list = list.filter((l) => (bf.dir === 'in') === (l.amount > 0));
    const k = bf.sort.key, s = bf.sort.desc ? -1 : 1;
    list = list.slice().sort((x, y) => {
      const vx = k === 'amount' ? x.amount : k === 'desc' ? x.description : x.date, vy = k === 'amount' ? y.amount : k === 'desc' ? y.description : y.date;
      return vx < vy ? -s : vx > vy ? s : 0;
    });
    return list;
  }
  function plan(b, l) { // what the row proposes: a best match, a suggestion, or the user's own pick
    const d = bf.drafts[l.id] || {};
    const cands = b.bankCandidates(l.id), best = cands.find((c) => c.best);
    let sug = b.bankSuggestion(l.id), who = '', label = '';
    if (OB.close && l.status === 'review') {   // 1.57: the payee's habit in the books (the Close the books engine), then a common merchant
      const cp = OB.close.forFeed(b, l.accountId)[l.id];
      if (cp) {
        who = cp.contactId || ''; label = cp.label || '';
        if (!sug && !best && cp.categoryId && (cp.kind === 'habit' || cp.kind === 'common')) sug = { categoryId: cp.categoryId, contactId: who, source: cp.kind === 'habit' ? 'books' : 'common', sure: !!cp.auto, reason: cp.reason + (cp.why ? ' (' + cp.why + ')' : '') };
      }
    }
    const had = !!(best || sug);
    if (!had && bf.help === 'clients' && firm && firm.done) sug = OB.hints.fromClients(b, l, firm.list);
    if (!had && bf.help === 'common') sug = OB.hints.fromCommon(b, l);
    const categoryId = d.categoryId || (sug && sug.categoryId) || '';
    // sure = a match, the user's own pick, a rule, or a steady habit; check = any other suggestion; none = nothing to offer
    const level = (!d.categoryId && best) || d.categoryId || (sug && (sug.source === 'rule' || sug.sure)) ? 'sure' : categoryId ? 'check' : 'none';
    return { had, cands, best: d.categoryId ? null : best, sug, categoryId, level, label: label || l.description, contactId: d.contactId !== undefined ? d.contactId : (sug && sug.contactId) || who };
  }
  function likeIds(b, a, p) { return rowsFor(b, a).filter((x) => plan(b, x).label === p.label).map((x) => x.id); }   // the same payee (or the same bank wording when no payee is known)
  function candLabel(b, c) {
    if (c.kind === 'deposit' || c.kind === 'group') {
      const ids = c.kind === 'deposit' ? c.txnIds : c.links.map((x) => x.txnId);
      const list = ids.map((id) => b.txById[id]).filter(Boolean);
      const head = c.kind === 'deposit' ? (list.length === 1 ? 'Deposit of ' : 'Deposit of ' + list.length + ' payments: ') : list.length + ' entries: ';
      return esc(head) + list.slice(0, 4).map((t) => `${esc(UI.typeLabel(t.type))}${t.number ? ' ' + esc(t.number) : ''}${UI.contactName(t.contactId) ? ' · ' + esc(UI.contactName(t.contactId)) : ''} ${esc(U.fmtDate(t.date))}`).join('; ') + (list.length > 4 ? ' …' : '');
    }
    if (c.split) {
      const t = b.txById[c.txnId], who = UI.contactName(t.contactId) || '', bl = b.bankLineById;
      return `Part payment of ${esc(UI.typeLabel(t.type))} ${esc(t.number || U.fmtDate(t.date))} (${esc(U.fmt(b.openBalance(t), { symbol: true }))}) with ${c.peers.map((id) => bl[id] ? esc(U.fmtDate(bl[id].date)) + ' ' + esc(U.fmt(Math.abs(bl[id].amount), { symbol: true })) : '').join(' + ')}${who ? ' · ' + esc(who) : ''}`;
    }
    if (c.kind === 'open' && c.txnIds && c.txnIds.length > 1) {
      const list = c.txnIds.map((id) => b.txById[id]).filter(Boolean), who = UI.contactName(list[0].contactId) || '';
      return `${esc(UI.typeLabel(list[0].type))}s ${list.map((t) => `${esc(t.number || U.fmtDate(t.date))} (${esc(U.fmt(b.openBalance(t), { symbol: true }))})`).join(' + ')}${who ? ' · ' + esc(who) : ''}`;
    }
    const t = b.txById[c.txnId], who = UI.contactName(t.contactId) || '';
    return `${esc(UI.typeLabel(t.type))}${t.number ? ' ' + esc(t.number) : ''} · ${esc(U.fmtDate(t.date))}${who ? ' · ' + esc(who) : ''}`;
  }
  function linesView(b, a, pf) {
    let list = rowsFor(b, a);
    const plans = {};
    let count = { sure: 0, check: 0, none: 0 };
    if (bf.tab === 'review') {
      list.forEach((l) => { plans[l.id] = plan(b, l); count[plans[l.id].level]++; });
      if (bf.onlySug) list = list.filter((l) => plans[l.id].best || plans[l.id].sug);
      if (bf.show !== 'all') list = list.filter((l) => plans[l.id].level === bf.show);
      const k = bf.sort.key, s = bf.sort.desc ? -1 : 1, RANK = { sure: 0, check: 1, none: 2 };
      const val = { payee: (p) => (UI.contactName(p.contactId) || p.label || '').toLowerCase(), cat: (p) => (p.categoryId ? b.accountLabel(p.categoryId) : '\uffff').toLowerCase(), level: (p) => RANK[p.level] }[k];
      // lines of one payee stay together (then by date), so a group can be ticked and posted in one go
      if (val) list = list.slice().sort((x, y) => { const vx = val(plans[x.id]), vy = val(plans[y.id]); return vx < vy ? -s : vx > vy ? s : (plans[x.id].label < plans[y.id].label ? -1 : plans[x.id].label > plans[y.id].label ? 1 : x.date < y.date ? 1 : x.date > y.date ? -1 : 0); });
    }
    const pages = Math.max(1, Math.ceil(list.length / pf.pageSize)); if (bf.page >= pages) bf.page = pages - 1;
    const shown = list.slice(bf.page * pf.pageSize, (bf.page + 1) * pf.pageSize);
    [...bf.sel].forEach((id) => { if (!list.some((l) => l.id === id)) bf.sel.delete(id); });
    const ready = bf.tab === 'review' ? list.filter((l) => plans[l.id].best || (plans[l.id].categoryId && !(plans[l.id].sug && plans[l.id].sug.extra && !bf.drafts[l.id]))) : [];
    const none = bf.tab === 'review' ? list.filter((l) => !plans[l.id].had) : [], found = none.filter((l) => plans[l.id].sug).length;
    const busy = bf.help === 'clients' && !(firm && firm.done);
    const sortH = (k, label, cls) => `<th class="${cls || ''}"><button class="bf-sort${bf.sort.key === k ? ' on' : ''}" data-sort="${k}" aria-label="Sort by ${label}">${label}${bf.sort.key === k ? (bf.sort.desc ? ' ▾' : ' ▴') : ''}</button></th>`;
    const ncol = 7 + (pf.cols.check ? 1 : 0) + (pf.cols.payee ? 1 : 0) + (pf.cols.balance ? 1 : 0);
    return `<div class="bf-tools">
        <input type="search" id="bf-q" placeholder="Search description, amount or check no." value="${esc(bf.q)}" aria-label="Search bank lines">
        <div class="segmented" role="group" aria-label="Direction">${[['all', 'All'], ['in', 'Money in'], ['out', 'Money out']].map(([k, t]) => `<button data-dir="${k}" aria-pressed="${bf.dir === k}">${t}</button>`).join('')}</div>
        <label class="bf-pick"><span>Sort by</span><select id="bf-sortby" data-testid="bf-sortby">${[['date:d', 'Date, newest first'], ['date:a', 'Date, oldest first'], ...(bf.tab === 'review' ? [['payee:a', 'Payee'], ['cat:a', 'Category'], ['level:a', 'Sure first']] : []), ['amount:a', 'Amount, largest spent first'], ['amount:d', 'Amount, largest received first'], ['desc:a', 'Bank description']]
          .map(([v, t]) => `<option value="${v}"${v === bf.sort.key + ':' + (bf.sort.desc ? 'd' : 'a') ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
        ${bf.tab === 'review' ? `<label class="bf-pick"><span>Show</span><select id="bf-show" data-testid="bf-show">${[['all', 'All lines'], ['sure', 'Sure (' + count.sure + ')'], ['check', 'To check (' + count.check + ')'], ['none', 'No suggestion (' + count.none + ')']].map(([v, t]) => `<option value="${v}"${v === bf.show ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
        <label class="check"><input type="checkbox" id="bf-onlysug" ${bf.onlySug ? 'checked' : ''}> Only lines with a suggestion</label>` : ''}
        ${bf.tab === 'review' ? `<span class="bf-help"><span class="muted small">Also ask</span><span class="segmented" role="group" aria-label="Extra help for lines with no suggestion">${[['off', 'Off'], ['clients', 'Other clients']].map(([k, t]) => `<button data-help="${k}" aria-pressed="${bf.help === k}" data-testid="bf-help-${k}">${t}</button>`).join('')}</span>
          ${bf.help !== 'off' ? `<span class="small" data-testid="bf-help-count">${busy ? 'Reading your other clients…' : `Identified <strong>${found}</strong> of ${none.length} line${none.length === 1 ? '' : 's'} with no suggestion${bf.help === 'clients' ? ` · learned from ${firm.list.length} client${firm.list.length === 1 ? '' : 's'}${firm.skipped ? `, ${firm.skipped} password-protected skipped` : ''}` : ''}`}</span>` : ''}</span>` : ''}
        <span class="spacer"></span>
        <div class="segmented" role="group" aria-label="Row density">${[['comfortable', 'Comfortable'], ['compact', 'Compact']].map(([k, t]) => `<button data-density="${k}" aria-pressed="${pf.density === k}">${t}</button>`).join('')}</div>
        <details class="bf-colmenu"><summary class="btn ghost small">Columns</summary><div class="bf-colpop">${COLS.map(([k, t]) => `<label class="check"><input type="checkbox" data-col="${k}" ${pf.cols[k] ? 'checked' : ''}> ${t}</label>`).join('')}
          <label class="field"><span>Rows per page</span><select id="bf-ps">${[50, 100, 200, 500].map((n) => `<option${n === pf.pageSize ? ' selected' : ''}>${n}</option>`).join('')}</select></label></div></details>
      </div>
      ${bf.tab === 'review' && (count.sure || count.check) ? `<div class="banner info bf-ready" data-testid="bf-ready"><span class="bf-counts" data-testid="bf-counts"><strong>${count.sure}</strong> sure · <strong>${count.check}</strong> to check · <strong>${count.none}</strong> with no suggestion</span>
        ${count.sure ? `<button class="btn small primary" id="bf-sel-sure" data-testid="bf-sel-sure">Select the ${count.sure} sure</button>` : ''}<button class="btn small" id="bf-sel-ready">Select all ${count.sure + count.check} with a suggestion</button></div>` : ''}
      <div class="bf-batch" ${bf.sel.size ? '' : 'hidden'} data-testid="bf-batch"><strong>${bf.sel.size} selected</strong>
        ${bf.tab === 'review' ? `<span class="bf-batch-cat">${UI.comboHtml('account', 'line', '', 'id="bf-bcat"', { placeholder: 'Set category…', label: 'Category for the selected lines' })}</span>
          <button class="btn primary small" id="bf-bpost" data-testid="bf-batch-post">Post selected</button><button class="btn small" id="bf-bexcl">Exclude…</button>` : ''}
        ${bf.tab === 'posted' ? '<button class="btn small" id="bf-bundo" data-testid="bf-batch-undo">Undo selected</button>' : ''}
        ${bf.tab === 'excluded' ? '<button class="btn small" id="bf-brest">Restore selected</button>' : ''}
        <button class="btn ghost small" id="bf-bclear">Clear</button></div>
      ${list.length ? `<div class="scroll-x"><table class="bf-table ${pf.density === 'compact' ? 'compact' : ''}" data-testid="bf-table"><thead><tr>
        <th class="bf-ck"><input type="checkbox" id="bf-all" aria-label="Select all shown" ${shown.length && shown.every((l) => bf.sel.has(l.id)) ? 'checked' : ''}></th>
        ${sortH('date', 'Date')}${sortH('desc', 'Bank description')}${pf.cols.check ? '<th>Check no.</th>' : ''}${pf.cols.payee ? (bf.tab === 'review' ? sortH('payee', 'Payee') : '<th>Payee</th>') : ''}
        ${bf.tab === 'review' ? sortH('cat', 'Category or match') : `<th>${bf.tab === 'posted' ? 'Posted as' : 'Reason'}</th>`}${sortH('amount', 'Spent', 'num')}<th class="num">Received</th>${pf.cols.balance ? '<th class="num">Balance</th>' : ''}<th><span class="sr-only">Action</span></th></tr></thead>
        <tbody>${shown.map((l) => row(b, a, l, plans[l.id], pf) + (bf.open === l.id && plans[l.id] ? `<tr class="bf-detail"><td colspan="${ncol}">${detail(b, a, l, plans[l.id])}</td></tr>` : '')).join('')}</tbody></table></div>
        ${pages > 1 ? `<div class="bf-pager"><button class="btn ghost small" id="bf-prev" ${bf.page ? '' : 'disabled'}>Previous</button><span>Page ${bf.page + 1} of ${pages} · ${list.length} lines</span><button class="btn ghost small" id="bf-next" ${bf.page < pages - 1 ? '' : 'disabled'}>Next</button></div>` : ''}
        <p class="muted small bf-keys">Keys: ↑ ↓ move · Enter open · Space select · A post · X exclude · Esc close</p>`
      : UI.empty(bf.tab === 'review' ? (bf.q || bf.dir !== 'all' || bf.onlySug ? 'No lines match the filter.' : 'Nothing to review for ' + a.name + '. Import a CSV, Excel, OFX/QBO or PDF file from your bank.') : bf.tab === 'posted' ? 'No posted bank lines yet.' : 'No excluded lines.',
        bf.tab === 'review' && !bf.q ? '<button class="btn primary" id="bf-import2">Import file</button>' : '')}`;
  }
  function row(b, a, l, p, pf) {
    const t = l.txnId ? b.txById[l.txnId] : null;
    let mid = '', act = '';
    if (bf.tab === 'review') {
      if (p.best) { mid = `<span class="badge ok">Match</span> ${candLabel(b, p.best)}`; act = `<button class="btn small primary" data-act="post" data-testid="bf-match-btn">Match</button>`; }
      else if (p.categoryId) { mid = `${p.sug && p.sug.splits && !(bf.drafts[l.id] || {}).categoryId ? 'Split: ' + p.sug.splits.map((x) => esc(b.accountLabel(x.accountId))).join(' + ') : esc(b.accountLabel(p.categoryId))}${p.sug && !bf.drafts[l.id] ? ` <span class="badge ${p.sug.source === 'rule' || p.sug.sure ? 'ok' : ''}" title="${esc(p.sug.reason)}" data-testid="bf-badge">${{ rule: 'Rule', clients: 'Other clients', common: 'Common merchant', books: p.sug.sure ? 'Sure' : 'Check' }[p.sug.source] || 'Last time'}</span>` : ''}`; act = `<button class="btn small primary" data-act="post" data-testid="bf-add-btn">Add</button>`; }
      else { mid = `<span class="muted">${p.cands.length ? p.cands.length + ' possible match' + (p.cands.length === 1 ? '' : 'es') : 'Choose a category'}</span>`; act = `<button class="btn small" data-act="open">Review</button>`; }
    } else if (bf.tab === 'posted') {
      mid = l.links ? `Matched to ${l.links.length} entries: ${l.links.slice(0, 3).map((x) => { const y = b.txById[x.txnId]; return y ? `<a href="#/txn/${esc(y.id)}">${esc(UI.typeLabel(y.type))}${y.number ? ' ' + esc(y.number) : ''}</a>` : ''; }).join(', ')}` : t ? `${l.auto === 'books' ? '<span class="badge ok" title="' + esc((l.matchReasons || []).join(' · ')) + '">Already in books</span> ' : ''}${l.via === 'match' ? 'Matched to ' : l.via === 'deposit' ? 'Deposit · ' : ''}<a href="#/txn/${esc(t.id)}">${esc(UI.typeLabel(t.type))}${t.number ? ' ' + esc(t.number) : ''}</a>${t.status === 'void' ? ' <span class="badge void">Void</span>' : ''}${l.categoryId ? ' · ' + esc(b.accountLabel(l.categoryId)) : ''}` : '<span class="muted">—</span>';
      act = `<button class="btn small ghost" data-act="undo" data-testid="bf-undo-btn">Undo</button>`;
    } else { mid = esc(l.excludeReason || '—'); act = `<button class="btn small ghost" data-act="restore">Restore</button>`; }
    const payee = bf.tab === 'review' ? UI.contactName(p.contactId) : t ? UI.contactName(t.contactId) : '';
    return `<tr class="bf-row${bf.open === l.id ? ' open' : ''}${bf.sel.has(l.id) ? ' sel' : ''}" data-id="${esc(l.id)}" tabindex="-1">
      <td class="bf-ck"><input type="checkbox" data-sel ${bf.sel.has(l.id) ? 'checked' : ''} aria-label="Select line"></td>
      <td class="nowrap">${UI.date(l.date)}</td><td class="bf-desc">${esc(l.description)}${l.note ? `<span class="bf-note" title="${esc(l.note)}" data-testid="bf-note">${esc(l.note)}</span>` : ''}</td>${pf.cols.check ? `<td>${esc(l.checkNo || '')}</td>` : ''}
      ${pf.cols.payee ? `<td>${esc(payee || '')}</td>` : ''}<td class="bf-mid">${mid}</td>
      <td class="num">${l.amount < 0 ? UI.money(-l.amount) : ''}</td><td class="num">${l.amount > 0 ? UI.money(l.amount) : ''}</td>
      ${pf.cols.balance ? `<td class="num muted">${l.balance === null || l.balance === undefined ? '' : UI.money(l.balance)}</td>` : ''}<td class="bf-act">${act}</td></tr>`;
  }
  function detail(b, a, l, p) {
    const d = bf.drafts[l.id] || (bf.drafts[l.id] = {}), tab = bf.openTab;
    const tabs = [['cat', 'Categorize'], ['match', 'Find match' + (p.cands.length ? ' (' + p.cands.length + ')' : '')], ['xfer', 'Transfer'], ['split', 'Split']];
    let body = '';
    if (tab === 'cat') body = `<div class="form-grid cols3">
        <label class="field"><span>Category</span>${UI.comboHtml('account', 'line', d.categoryId || p.categoryId, 'data-d="categoryId"', { label: 'Category' })}</label>
        <label class="field"><span>Payee</span>${UI.comboHtml('contact', 'any', d.contactId !== undefined ? d.contactId : p.contactId, 'data-d="contactId"', { placeholder: '—', label: 'Payee' })}</label>
        <label class="field"><span>Memo</span><input data-d="memo" value="${esc(d.memo !== undefined ? d.memo : l.description)}"></label></div>
        ${p.sug ? `<p class="muted small">Suggested: ${esc(p.sug.reason)}.</p>` : ''}
        <div class="form-actions"><button class="btn primary" data-act="add" data-testid="bf-detail-add">${l.amount > 0 ? 'Add deposit' : l.checkNo ? 'Add check ' + esc(l.checkNo) : 'Add expense'}</button>
          ${(() => { const n = likeIds(b, a, p).length; return n > 1 ? `<button class="btn" data-act="like" data-testid="bf-like">Select the ${n} lines of this payee</button>` : ''; })()}</div>`;
    else if (tab === 'match') body = p.cands.length ? `<table class="bf-cands"><tbody>${p.cands.map((c, i) => `<tr><td><input type="radio" name="bfc-${esc(l.id)}" data-cand="${i}" ${(d.cand === undefined ? (c.best ? 0 : -1) : d.cand) === i ? 'checked' : ''} aria-label="Choose this match"></td>
          <td>${c.split ? '<span class="badge">Split</span>' : ({ open: '<span class="badge">Open</span>', deposit: '<span class="badge">Deposit</span>', group: '<span class="badge">Several</span>' }[c.kind] || '<span class="badge">Entry</span>')} ${candLabel(b, c)}</td><td class="num">${UI.money(Math.abs(l.amount))}</td><td class="muted small">${esc(c.reasons.join(' · '))}</td></tr>`).join('')}</tbody></table>
        <div class="form-actions"><button class="btn primary" data-act="match" data-testid="bf-detail-match">Match</button></div>`
      : `<p class="muted">No entry in ${esc(a.name)} or open ${l.amount > 0 ? 'invoice' : 'bill'} has this amount (${UI.money(Math.abs(l.amount), { symbol: true })}) near ${esc(U.fmtDate(l.date))}. Pick the ${l.amount > 0 ? 'invoices' : 'bills'} yourself below, or use Categorize.</p>`;
    else if (tab === 'xfer') body = `<div class="form-grid cols3"><label class="field"><span>${l.amount > 0 ? 'Money came from' : 'Money went to'}</span><select data-d="xferId"><option value="">Choose account…</option>${b.accounts.filter((x) => x.id !== a.id && x.active !== false && ['bank', 'cc', 'oca', 'ocl', 'ltl'].includes(x.type)).map((x) => `<option value="${esc(x.id)}"${d.xferId === x.id ? ' selected' : ''}>${esc(b.accountLabel(x.id))}</option>`).join('')}</select></label></div>
        <p class="muted small">Import the other account's file later and its line will be offered as a match to this transfer, so it is never counted twice.</p>
        <div class="form-actions"><button class="btn primary" data-act="xfer" data-testid="bf-detail-xfer">Record transfer</button></div>`;
    else {
      const sp = d.split || (d.split = [{ accountId: p.categoryId || '', amount: U.fmtPlain(Math.abs(l.amount)), memo: '' }, { accountId: '', amount: '', memo: '' }]);
      let sum = 0; sp.forEach((x) => { try { sum += U.toCents(x.amount || 0); } catch (e) { /* shown below */ } });
      const diff = Math.abs(l.amount) - sum;
      body = `<table class="bf-split"><thead><tr><th>Category</th><th class="num">Amount</th><th>Memo</th><th></th></tr></thead><tbody>${sp.map((x, i) => `<tr data-si="${i}">
          <td>${UI.comboHtml('account', 'line', x.accountId, 'data-s="accountId"', { label: 'Split category' })}</td><td class="num"><input class="money" inputmode="decimal" data-s="amount" value="${esc(x.amount)}" aria-label="Split amount"></td>
          <td><input data-s="memo" value="${esc(x.memo)}" aria-label="Split memo"></td><td>${sp.length > 2 ? `<button class="btn icon" data-act="sdel" aria-label="Remove line">×</button>` : ''}</td></tr>`).join('')}</tbody></table>
        <div class="form-actions"><button class="btn ghost small" data-act="sadd">+ Add line</button><span class="spacer"></span>
          <span class="${diff ? 'warn-text' : 'muted'}" data-testid="bf-split-diff">Difference ${UI.money(diff, { symbol: true })}</span>
          <button class="btn primary" data-act="split" ${diff ? 'disabled' : ''} data-testid="bf-detail-split">Split and post</button></div>`;
    }
    if (tab === 'match' && a.type !== 'cc') body += manualPick(b, l, d, !p.cands.length);
    return `<div class="bf-pane" data-line="${esc(l.id)}"><div class="bf-ptabs segmented" role="tablist">${tabs.map(([k, t]) => `<button role="tab" data-ptab="${k}" aria-selected="${tab === k}">${t}</button>`).join('')}</div>
      <span class="bf-pside"><button class="btn ghost small" data-act="rule" data-testid="bf-rule-btn">Create rule…</button><button class="btn ghost small" data-act="exclude" data-testid="bf-exclude-btn">Exclude…</button></span>
      <div class="bf-pbody">${body}</div>
      <details class="bf-linefix"${l.note || l.bankDate ? ' open' : ''}><summary>Date and note${l.note ? ' · ' + esc(l.note.length > 40 ? l.note.slice(0, 40) + '…' : l.note) : ''}${l.bankDate ? ' · date changed' : ''}</summary>
        <div class="form-grid cols3"><label class="field"><span>Date</span><input type="date" data-ln="date" value="${esc(l.date)}" data-testid="bf-line-date"></label>
        <label class="field span2"><span>Note (stays on this bank line)</span><input data-ln="note" maxlength="500" value="${esc(l.note || '')}" data-testid="bf-line-note" placeholder="e.g. Ask client what this is"></label></div>
        <div class="form-actions">${l.bankDate ? `<span class="muted small">Bank date ${UI.date(l.bankDate)}</span>` : ''}<button class="btn small" data-act="linesave" data-testid="bf-line-save">Save date and note</button></div>
      </details></div>`;
  }

  /* Match by hand: tick any number of one customer's open invoices (or a vendor's open bills) until they add up
     to the bank line; the amount on a row can be lowered to pay part of it. Posts one payment (postBankLine 'open'). */
  function manualPick(b, l, d, open) {
    const inv = l.amount > 0, noun = inv ? 'invoice' : 'bill', who = inv ? 'Customer' : 'Vendor';
    const od = b.bankOpenDocs(l.id, d.mc === undefined ? null : d.mc), sel = d.msel || (d.msel = {});
    if (!od.contacts.length) return `<p class="muted small">There are no open ${noun}s.</p>`;
    const abs = Math.abs(l.amount);
    const rows = od.docs.map((t) => { const ob = b.openBalance(t), on = sel[t.id] !== undefined;
      return `<tr data-mt="${esc(t.id)}"><td><input type="checkbox" data-mi="${esc(t.id)}" ${on ? 'checked' : ''} aria-label="Pay ${esc(noun)} ${esc(t.number || '')}"></td>
        <td><a href="#/txn/${esc(t.id)}">${esc(t.number || '—')}</a></td><td>${UI.date(t.date)}</td><td>${t.dueDate ? UI.date(t.dueDate) : ''}</td>
        <td class="num">${UI.money(ob)}</td><td class="num"><input class="money" inputmode="decimal" data-ma="${esc(t.id)}" value="${on ? esc(sel[t.id]) : ''}" ${on ? '' : 'disabled'} aria-label="Payment for ${esc(noun)} ${esc(t.number || '')}"></td></tr>`; }).join('');
    return `<details class="bf-manual" data-testid="bf-manual" ${open || Object.keys(sel).length || d.mc !== undefined ? 'open' : ''}><summary>Match open ${noun}s yourself</summary>
      <div class="row gap wrap"><label class="field"><span>${who}</span><select data-mc data-testid="bf-manual-contact"><option value="">Choose ${who.toLowerCase()}…</option>${od.contacts.map((id) => `<option value="${esc(id)}" ${id === od.contactId ? 'selected' : ''}>${esc(b.contactById[id].name)}</option>`).join('')}</select></label></div>
      ${od.contactId ? `<table class="data bf-mtable"><thead><tr><th><span class="sr-only">Pay</span></th><th>${inv ? 'Invoice' : 'Bill'} no.</th><th>Date</th><th>Due</th><th class="num">Open balance</th><th class="num">Payment</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="form-actions"><span class="muted" data-testid="bf-manual-sum"></span><span class="spacer"></span>
        <button class="btn primary" data-act="manual" data-testid="bf-manual-post" disabled>Match</button></div>` : `<p class="muted small">Choose the ${who.toLowerCase()} to see their open ${noun}s.</p>`}
      <input type="hidden" data-mabs="${abs}"></details>`;
  }
  function manualSum(pane) { // live total, difference and button state; nothing re-renders while typing
    const box = pane.querySelector('.bf-manual'); if (!box) return;
    const abs = +box.querySelector('[data-mabs]').dataset.mabs, ins = [...box.querySelectorAll('[data-ma]:not([disabled])')];
    let sum = 0, bad = false; ins.forEach((x) => { try { sum += U.toCents(x.value || 0); } catch (e) { bad = true; } });
    const diff = abs - sum, out = box.querySelector('[data-testid=bf-manual-sum]'), btn = box.querySelector('[data-act=manual]');
    if (out) { out.textContent = bad ? 'Check the amounts' : `${ins.length} chosen · ${U.fmt(sum, { symbol: true })} of ${U.fmt(abs, { symbol: true })}` + (diff ? ` · difference ${U.fmt(diff, { symbol: true })}` : ' · adds up'); out.className = diff || bad ? 'warn-text' : 'ok-text'; }
    if (btn) { btn.disabled = bad || !!diff || !ins.length; btn.textContent = ins.length > 1 ? `Match ${ins.length} items` : 'Match'; }
  }

  /* ---------------- imports tab ---------------- */
  function importsTable(b, a) {
    const list = b.bankImportsFor(a.id);
    return list.length ? `<div class="scroll-x"><table class="data compact" data-testid="bf-imports"><thead><tr><th>Imported</th><th>File</th><th>Dates</th><th class="num">New lines</th><th class="num">Already imported</th><th class="num">Ending balance</th><th>Status</th><th><span class="sr-only">Action</span></th></tr></thead><tbody>
      ${list.map((x) => `<tr class="${x.undone ? 'inactive' : ''}"><td>${esc(new Date(x.importedAt).toLocaleString())}</td><td>${esc(x.fileName)}</td><td>${esc(U.fmtDate(x.dateFrom))} – ${esc(U.fmtDate(x.dateTo))}</td>
        <td class="num">${x.added}</td><td class="num">${x.duplicates}</td><td class="num">${x.endingBalance === null ? '—' : UI.money(x.endingBalance)}</td><td>${x.undone ? '<span class="badge void">Undone</span>' : 'Imported'}</td>
        <td>${x.undone ? '' : `<button class="btn ghost small" data-undoimp="${esc(x.id)}" data-testid="bf-undo-import">Undo import</button>`}</td></tr>`).join('')}</tbody></table></div>`
      : UI.empty('No files imported into ' + a.name + ' yet.', '<button class="btn primary" id="bf-import2">Import file</button>');
  }

  /* ---------------- import wizard ---------------- */
  function startMap(b, accountId, table, fileName) {
    const header = (table[0] || []).map((c) => String(c).replace(/^﻿/, '').trim()).join('|');
    const prof = b.bankProfile(accountId, header);
    const m = prof ? Object.assign({}, prof.mapping) : I.detectColumns(table[0] || [], table.slice(1));
    if (!prof) m.hasHeader = (table[0] || []).some((c) => isNaN(parseFloat(String(c).replace(/[$,]/g, ''))) && !I.parseDateAs(c, 'MDY'));
    const dates = m.date >= 0 ? table.slice(m.hasHeader ? 1 : 0).map((r) => r[m.date]) : [];
    const df = I.detectDateFormat(dates);
    m.dateFormat = prof ? prof.dateFormat : df.format;
    const imp = { step: 'map', accountId, table, fileName, header, mapping: m, ambiguous: !prof && df.ambiguous, invert: prof ? prof.invert : b.accById[accountId].type === 'cc', remember: true, fromProfile: !!prof };
    const chk = I.checkFile(table, m);
    if (prof && chk.ok) { imp.step = 'preview'; preview(b, imp); } // the saved layout already settled the date format
    return imp;
  }
  function preview(b, imp) {
    const parsed = I.parseBankRows(imp.table, imp.mapping, { invert: imp.invert });
    imp.rows = parsed.rows; imp.errors = parsed.errors;
    imp.bal = I.checkBalances(parsed.rows); imp.pre = b.bankPreview(imp.accountId, parsed.rows);
  }
  function importPanel(b) {
    const imp = bf.imp, acc = b.accById[imp.accountId];
    const head = `<div class="card-head"><h2>Import into ${esc(acc ? b.accountLabel(acc.id) : '…')}</h2><button class="btn ghost small" id="bfi-cancel">Cancel</button></div>`;
    if (imp.step === 'pick') return head + `<div class="form-grid cols2"><label class="field"><span>Account</span><select id="bfi-acc">${UI.accountOptions(imp.accountId, FEED)}</select></label></div>
      <label class="dropzone" id="bfi-drop"><input type="file" id="bfi-file" accept=".csv,.txt,.tsv,.xlsx,.xls,.xlsm,.ofx,.qfx,.qbo,.pdf" data-testid="bf-file-input">
        <strong>Drop your bank or card file here, or click to browse</strong><span class="muted small">CSV, Excel, OFX / QFX / QBO or PDF statement · read on this computer only · lines you already imported are skipped</span></label>
      ${imp.error ? `<div class="banner danger" data-testid="bf-import-error">${esc(imp.error)}</div>` : ''}`;
    const t = imp.table, m = imp.mapping, ncol = Math.max(...t.slice(0, 20).map((r) => r.length));
    if (imp.step === 'map') {
      const chk = I.checkFile(t, m);
      const sample = (i) => { const v = t.slice(m.hasHeader ? 1 : 0, 4).map((r) => r[i]).filter((x) => String(x || '').trim()).slice(0, 2).join(', '); return v ? ' — e.g. ' + v.slice(0, 40) : ''; };
      const opts = (sel) => `<option value="-1">— none —</option>` + Array.from({ length: ncol }, (_, i) => `<option value="${i}"${sel === i ? ' selected' : ''}>${esc((m.hasHeader && t[0][i] ? t[0][i] : 'Column ' + (i + 1)) + sample(i))}</option>`).join('');
      const f = (id, label, v) => `<label class="field"><span>${label}</span><select id="${id}">${opts(v)}</select></label>`;
      return head + `<p><strong>${esc(imp.fileName)}</strong> · ${t.length - (m.hasHeader ? 1 : 0)} lines · check the columns VaultBook picked</p>
        ${chk.ok ? '' : `<div class="banner danger" data-testid="bf-file-problem">${esc(chk.message)}</div>`}
        ${imp.ambiguous ? `<div class="banner warn" data-testid="bf-date-ambiguous">Every date in this file could be read as month/day or day/month. Check the date format below against one transaction you know.</div>` : ''}
        <div class="form-grid cols4">${(imp.sheets || []).length > 1 ? `<label class="field"><span>Sheet</span><select id="bfm-sheet" data-testid="bf-sheet">${imp.sheets.map((x, i) => `<option value="${i}"${i === imp.sheet ? ' selected' : ''}>${esc(x.name)} (${x.count})</option>`).join('')}</select></label>` : ''}${f('bfm-date', 'Date', m.date)}<label class="field"><span>Date format</span><select id="bfm-df">${[['MDY', 'MM/DD/YYYY (US)'], ['DMY', 'DD/MM/YYYY'], ['YMD', 'YYYY-MM-DD']].map(([k, x]) => `<option value="${k}"${m.dateFormat === k ? ' selected' : ''}>${x}</option>`).join('')}</select></label>
          ${f('bfm-desc', 'Description', m.description)}${f('bfm-amt', 'Amount (one column, − = money out)', m.amount)}
          ${f('bfm-deb', '…or Money out', m.debit)}${f('bfm-cre', '…and Money in', m.credit)}${f('bfm-sign', 'Debit / Credit column (sets the sign)', m.sign === undefined ? -1 : m.sign)}${f('bfm-chk', 'Check / reference no.', m.check)}${f('bfm-bal', 'Running balance (optional)', m.balance)}
          <label class="check"><input type="checkbox" id="bfm-head" ${m.hasHeader ? 'checked' : ''}> First row is a header</label>
          <label class="check"><input type="checkbox" id="bfm-inv" ${imp.invert ? 'checked' : ''}> Reverse signs (card files that show charges as positive)</label>
          <label class="check"><input type="checkbox" id="bfm-rem" ${imp.remember ? 'checked' : ''}> Remember these columns for ${esc(acc.name)}</label></div>
        <div class="scroll-x"><table class="data compact bf-preview"><tbody>${t.slice(0, 5).map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
        <div class="form-actions"><button class="btn ghost" id="bfi-back">Choose another file</button><button class="btn primary" id="bfm-next" data-testid="bf-map-next">Continue</button></div>`;
    }
    const bal = imp.bal, n = imp.pre.fresh, rows = imp.rows, dates = rows.map((r) => r.date).sort();
    return head + `<p><strong>${esc(imp.fileName)}</strong>${imp.fromProfile ? ' · columns remembered from your last import (<button class="link-btn" id="bfi-remap">change</button>)' : ''}</p>
      <dl class="facts bf-checks" data-testid="bf-preview">
        <dt>Lines</dt><dd><strong>${n}</strong> new${imp.pre.duplicates ? ` · ${imp.pre.duplicates} already imported (skipped)` : ''}${rows.length ? ` · ${esc(U.fmtDate(dates[0]))} – ${esc(U.fmtDate(dates[dates.length - 1]))}` : ''}</dd>
        ${imp.pre.inBooks && imp.pre.inBooks.length ? `<dt>Already in your books</dt><dd data-testid="bf-inbooks"><label class="check"><input type="checkbox" id="bfi-books" ${imp.matchBooks !== false ? 'checked' : ''}> <strong>${imp.pre.inBooks.length}</strong> line${imp.pre.inBooks.length === 1 ? ' is' : 's are'} already entered in ${esc(acc.name)} — match ${imp.pre.inBooks.length === 1 ? 'it' : 'them'} instead of adding again</label>
          <details><summary>Show which</summary><table class="data compact bf-inbooks"><thead><tr><th>Bank date</th><th>Description</th><th class="num">Amount</th><th>In the books as</th></tr></thead><tbody>${imp.pre.inBooks.slice(0, 60).map((x) => `<tr><td>${UI.date(x.date)}</td><td>${esc(x.description)}</td><td class="num">${UI.money(x.amount)}</td><td>${esc(x.entry)} <span class="muted small">${esc(x.reasons.slice(1).join(' · '))}</span></td></tr>`).join('')}</tbody></table></details></dd>` : ''}
        ${imp.pre.autoAdd ? `<dt>Auto-add rules</dt><dd><label class="check"><input type="checkbox" id="bfi-auto" ${imp.autoAdd !== false ? 'checked' : ''}> <strong>${imp.pre.autoAdd}</strong> line${imp.pre.autoAdd === 1 ? '' : 's'} will be posted by your auto-add rules</label></dd>` : ''}
        <dt>Money in / out</dt><dd>${UI.money(U.sum(rows.filter((r) => r.amount > 0), (r) => r.amount), { symbol: true })} in · ${UI.money(-U.sum(rows.filter((r) => r.amount < 0), (r) => r.amount), { symbol: true })} out</dd>
        <dt>Running balance</dt><dd data-testid="bf-balance-check">${!bal.hasBalance ? '<span class="muted">No balance column in this file</span>' : bal.mismatches.length ? `<span class="badge warn">Breaks at line${bal.mismatches.length === 1 ? '' : 's'} ${esc(bal.mismatches.slice(0, 8).join(', '))}</span> — lines may be missing or the file was edited` : `<span class="badge ok">Checks out</span> · ending balance ${UI.money(bal.endingBalance, { symbol: true })} on ${esc(U.fmtDate(bal.endingDate))}`}</dd>
        ${imp.errors.length ? `<dt>Skipped</dt><dd><details><summary>${imp.errors.length} line${imp.errors.length === 1 ? '' : 's'} could not be read</summary><ul>${imp.errors.slice(0, 50).map((e) => `<li>${esc(e)}</li>`).join('')}</ul></details></dd>` : ''}
      </dl>
      <div class="scroll-x"><table class="data compact"><thead><tr><th>Date</th><th>Description</th><th class="num">Amount</th></tr></thead><tbody>${rows.slice(0, 5).map((r) => `<tr><td>${UI.date(r.date)}</td><td>${esc(r.description)}</td><td class="num">${UI.money(r.amount)}</td></tr>`).join('')}</tbody></table></div>
      <div class="form-actions"><button class="btn ghost" id="bfi-remap2">Back to columns</button><span class="spacer"></span><button class="btn primary" id="bfi-go" data-testid="bf-import-go" ${n ? '' : 'disabled'}>${n ? `Import ${n} new line${n === 1 ? '' : 's'}` : 'Nothing new to add'}</button></div>`;
  }

  /* ---------------- events ---------------- */
  function bind(el, b, a) {
    const $ = (s) => el.querySelector(s), on = (s, ev, fn) => { const x = $(s); if (x) x.addEventListener(ev, fn); };
    const rerender = (focus) => { if (focus) bf.focus = focus; UI.render(); };
    el.querySelectorAll('[data-acc]').forEach((x) => x.addEventListener('click', () => { bf.accountId = x.dataset.acc; bf.sel.clear(); bf.open = ''; bf.page = 0; UI.go('#/bankfeed?account=' + encodeURIComponent(x.dataset.acc)); }));
    el.querySelectorAll('[data-tab]').forEach((x) => x.addEventListener('click', () => { bf.tab = x.dataset.tab; bf.sel.clear(); bf.open = ''; bf.page = 0; rerender(); }));
    const openImport = () => { bf.imp = { step: 'pick', accountId: bf.accountId }; rerender(); };
    on('#bf-import', 'click', openImport); on('#bf-import2', 'click', openImport);
    on('#bf-recon', 'click', () => { const bb = b.bankBalance(a.id); UI.go('#/reconcile?' + UI.qs(bb ? { account: a.id, date: bb.date || U.today(), ending: U.fmtPlain(bb.amount) } : { account: a.id })); });
    bindImport(el, b);
    bindExport(el, b, feedAccounts(b));
    on('#bf-export', 'click', () => { const m = el.querySelector('.bf-more'); if (m) m.open = false; bf.exp = bf.exp ? null : { format: 'iif', accountIds: [bf.accountId], preset: 'all', from: '', to: '', onlyNew: true, cleared: true, lists: true, payments: 'payment', names: Object.assign({}, b.company.qbNames || {}) }; bf.imp = null; rerender(); });
    const q = $('#bf-q'); if (q) { let tm = 0; q.addEventListener('input', () => { clearTimeout(tm); tm = setTimeout(() => { bf.q = q.value; bf.page = 0; rerender(); const n = document.getElementById('bf-q'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }, 250); }); }
    el.querySelectorAll('[data-dir]').forEach((x) => x.addEventListener('click', () => { bf.dir = x.dataset.dir; bf.page = 0; rerender(); }));
    el.querySelectorAll('[data-help]').forEach((x) => x.addEventListener('click', () => { bf.help = x.dataset.help; if (bf.help === 'clients') loadFirm(b).then(() => { if (bf && bf.help === 'clients') rerender(); }); rerender(); }));
    on('#bf-onlysug', 'change', (e) => { bf.onlySug = e.target.checked; rerender(); });
    el.querySelectorAll('[data-density]').forEach((x) => x.addEventListener('click', () => { setPref('density', x.dataset.density); rerender(); }));
    el.querySelectorAll('[data-col]').forEach((x) => x.addEventListener('change', () => { const p = pref(); p.cols[x.dataset.col] = x.checked; setPref('cols', p.cols); rerender(); }));
    on('#bf-ps', 'change', (e) => { setPref('pageSize', +e.target.value); bf.page = 0; rerender(); });
    on('#bf-prev', 'click', () => { bf.page--; rerender(); }); on('#bf-next', 'click', () => { bf.page++; rerender(); });
    el.querySelectorAll('[data-sort]').forEach((x) => x.addEventListener('click', () => { const k = x.dataset.sort; bf.sort = { key: k, desc: bf.sort.key === k ? !bf.sort.desc : k !== 'desc' }; rerender(); }));
    on('#bf-all', 'change', (e) => { el.querySelectorAll('tr.bf-row').forEach((tr) => { if (e.target.checked) bf.sel.add(tr.dataset.id); else bf.sel.delete(tr.dataset.id); }); rerender(); });
    on('#bf-sortby', 'change', (e) => { const [k, d] = e.target.value.split(':'); bf.sort = { key: k, desc: d === 'd' }; bf.page = 0; rerender(); });
    on('#bf-show', 'change', (e) => { bf.show = e.target.value; bf.page = 0; rerender(); });
    on('#bf-sel-sure', 'click', () => { rowsFor(b, a).forEach((l) => { if (plan(b, l).level === 'sure') bf.sel.add(l.id); }); rerender(); });
    on('#bf-sel-ready', 'click', () => { rowsFor(b, a).forEach((l) => { const p = plan(b, l); if (p.best || p.categoryId) bf.sel.add(l.id); }); rerender(); });
    on('#bf-bclear', 'click', () => { bf.sel.clear(); rerender(); });
    on('#bf-bpost', 'click', (e) => UI.busy(e.target, () => batchPost(b, a, (($('#bf-bcat') || {}).value) || '')));
    on('#bf-bexcl', 'click', () => excludeAsk([...bf.sel]));
    on('#bf-bundo', 'click', (e) => UI.busy(e.target, () => seq([...bf.sel], (id) => b.undoBankLine(id)).then((r) => { bf.sel.clear(); done(r, 'returned to For review'); })));
    on('#bf-brest', 'click', () => b.restoreBankLines([...bf.sel]).then(() => { const n = bf.sel.size; bf.sel.clear(); UI.toast(n + ' line' + (n === 1 ? '' : 's') + ' restored.'); rerender(); }).catch(UI.error));
    el.querySelectorAll('[data-undoimp]').forEach((x) => x.addEventListener('click', () => UI.confirm('Undo import', '<p>Remove every line of this file that is still in For review or Excluded? Posted lines must be undone first.</p>', { ok: 'Undo import', danger: true })
      .then((okk) => okk && b.undoBankImport(x.dataset.undoimp).then(() => { UI.toast('Import undone.'); rerender(); })).catch(UI.error)));

    const tb = el.querySelector('.bf-table tbody'); if (!tb) return;
    tb.addEventListener('click', (e) => {
      const tr = e.target.closest('tr.bf-row'), pane = e.target.closest('.bf-pane');
      if (pane) return paneClick(e, b, a, pane);
      if (!tr) return;
      const id = tr.dataset.id;
      if (e.target.matches('[data-sel]')) { if (e.target.checked) bf.sel.add(id); else bf.sel.delete(id); return rerender(id); }
      const act = e.target.closest('[data-act]');
      if (act) return rowAct(b, a, id, act.dataset.act, act);
      if (e.target.closest('a, input, button')) return;
      toggle(id);
    });
    tb.addEventListener('change', (e) => { const pane = e.target.closest('.bf-pane'); if (pane) paneChange(e, b, pane); });
    tb.addEventListener('input', (e) => { const pane = e.target.closest('.bf-pane'); if (pane) paneChange(e, b, pane); });
    tb.querySelectorAll('.bf-pane').forEach(manualSum);
    const wrap = el.querySelector('.bf-table');
    wrap.addEventListener('keydown', (e) => keys(e, b, a));
    const f = bf.focus && wrap.querySelector(`tr.bf-row[data-id="${CSS.escape(bf.focus)}"]`); if (f && !wrap.contains(document.activeElement)) f.focus({ preventScroll: false });
  }
  function toggle(id) {
    const l = UI.book.bankLineById[id];
    if (!l || l.status !== 'review') {   // Posted / Excluded: no review panel; open what the line became, if anything
      bf.open = ''; const tid = l && (l.txnId || (l.links && l.links[0] && l.links[0].txnId));
      if (tid && UI.book.txById[tid]) UI.go('#/txn/' + tid); else { bf.focus = id; UI.render(); }
      return;
    }
    if (bf.open === id) bf.open = ''; else { bf.open = id; bf.openTab = UI.book.bankCandidates(id).some((c) => c.best) ? 'match' : 'cat'; } bf.focus = id; UI.render(); }
  function done(r, what) {
    const ok = r.filter((x) => x.ok).length, bad = r.filter((x) => !x.ok);
    UI.toast(ok + ' line' + (ok === 1 ? '' : 's') + ' ' + what + (bad.length ? '; ' + bad.length + ' could not: ' + bad[0].error : '.'), bad.length ? 'error' : '');
    UI.render();
  }
  const seq = (ids, fn) => ids.reduce((p, id) => p.then((acc) => fn(id).then(() => acc.concat([{ id, ok: true }]), (e) => acc.concat([{ id, ok: false, error: e.message }]))), Promise.resolve([]));
  const candDraft = (c) => c.kind === 'open' ? { kind: 'open', txnIds: c.txnIds, amounts: c.amounts } : c.kind === 'deposit' ? { kind: 'deposit', txnIds: c.txnIds } : c.kind === 'group' ? { kind: 'group', links: c.links } : { kind: 'match', txnId: c.txnId, splitIndex: c.splitIndex };
  function primary(b, id) { // the row's one-click action: the best match, else Add with its category (a rule's split posts as a split)
    try { return b.postBankLine(id, primaryDraft(b, id)); } catch (e) { return Promise.reject(e); }
  }
  function primaryDraft(b, id) {
    const l = b.bankLineById[id], p = plan(b, l);
    if (p.best) return candDraft(p.best);
    if (!p.categoryId) throw new Error('Choose a category for ' + l.description + '.');
    const d = bf.drafts[id] || {};
    if (p.sug && p.sug.splits && !d.categoryId) return { kind: 'split', lines: p.sug.splits, contactId: p.contactId, memo: d.memo !== undefined ? d.memo : p.sug.memo };
    return { kind: 'add', categoryId: p.categoryId, contactId: p.contactId, classId: p.sug && !d.categoryId ? p.sug.classId : '', memo: d.memo !== undefined ? d.memo : (p.sug && !d.categoryId && p.sug.memo) || undefined };
  }
  function batchPost(b, a, cat) {
    const ids = [...bf.sel];
    if (cat) ids.forEach((id) => { const d = bf.drafts[id] || (bf.drafts[id] = {}); d.categoryId = cat; });
    // 1.57: decide every line first, then post. Deciding after each post re-read the whole statement (a second per line on a long one).
    const drafts = {}; ids.forEach((id) => { try { drafts[id] = primaryDraft(b, id); } catch (e) { drafts[id] = e; } });
    return seq(ids, (id) => (drafts[id] instanceof Error ? Promise.reject(drafts[id]) : b.postBankLine(id, drafts[id])).then(() => { delete bf.drafts[id]; })).then((r) => { r.filter((x) => x.ok).forEach((x) => bf.sel.delete(x.id)); if (bf.open && !b.bankLineById[bf.open] || (b.bankLineById[bf.open] || {}).status !== 'review') bf.open = ''; done(r, 'posted'); });
  }
  function excludeAsk(ids) {
    if (!ids.length) return;
    UI.prompt('Exclude ' + ids.length + ' line' + (ids.length === 1 ? '' : 's'), 'Reason (kept with the line, e.g. "duplicate of card feed", "personal")', '', { ok: 'Exclude' })
      .then((reason) => reason === null ? null : UI.book.excludeBankLines(ids, reason).then(() => { ids.forEach((id) => bf.sel.delete(id)); if (ids.includes(bf.open)) bf.open = ''; UI.toast(ids.length + ' line' + (ids.length === 1 ? '' : 's') + ' excluded.'); UI.render(); })).catch(UI.error);
  }
  function rowAct(b, a, id, act, btn) {
    if (act === 'open') return toggle(id);
    if (act === 'post') return UI.busy(btn, () => primary(b, id).then(() => { delete bf.drafts[id]; if (bf.open === id) bf.open = ''; UI.toast('Posted.'); nextFocus(id); UI.render(); })).catch((e) => { UI.error(e); toggle(id); });
    if (act === 'undo') return UI.busy(btn, () => b.undoBankLine(id).then(() => { UI.toast('Back in For review.'); UI.render(); })).catch(UI.error);
    if (act === 'restore') return b.restoreBankLines([id]).then(() => { UI.toast('Restored to For review.'); UI.render(); }).catch(UI.error);
  }
  function nextFocus(id) { const rows = [...document.querySelectorAll('.bf-table tr.bf-row')], i = rows.findIndex((r) => r.dataset.id === id), n = rows[i + 1] || rows[i - 1]; bf.focus = n ? n.dataset.id : ''; }
  function paneClick(e, b, a, pane) {
    const id = pane.dataset.line, d = bf.drafts[id] || (bf.drafts[id] = {}), t = e.target.closest('[data-ptab], [data-act]'); if (!t) return;
    if (t.dataset.ptab) { bf.openTab = t.dataset.ptab; return UI.render(); }
    const act = t.dataset.act, l = b.bankLineById[id], p = plan(b, l);
    if (act === 'like') {   // tick every line of this payee; a category already picked here goes with them
      likeIds(b, b.accById[l.accountId], p).forEach((x) => { bf.sel.add(x); if (d.categoryId) (bf.drafts[x] || (bf.drafts[x] = {})).categoryId = d.categoryId; });
      bf.open = ''; return UI.render();
    }
    const post = (draft) => UI.busy(t, () => b.postBankLine(id, draft).then(() => { delete bf.drafts[id]; bf.open = ''; nextFocus(id); UI.toast('Posted.'); UI.render(); })).catch(UI.error);
    if (act === 'linesave') {
      const v = (k) => pane.querySelector(`[data-ln="${k}"]`).value;
      return UI.busy(t, () => b.updateBankLine(id, { date: v('date'), note: v('note') }).then(() => { UI.toast('Saved.'); UI.render(); })).catch(UI.error);
    }
    if (act === 'add') { const cat = d.categoryId || p.categoryId; if (!cat) return UI.toast('Choose a category.', 'error'); return post({ kind: 'add', categoryId: cat, contactId: d.contactId !== undefined ? d.contactId : p.contactId, memo: d.memo }); }
    if (act === 'manual') { const ids = Object.keys(d.msel || {}); return post({ kind: 'open', txnIds: ids, amounts: d.msel }); }
    if (act === 'match') {
      const i = d.cand !== undefined ? d.cand : p.cands.findIndex((c) => c.best), c = p.cands[i];
      if (!c) return UI.toast('Choose a match.', 'error');
      return post(candDraft(c));
    }
    if (act === 'xfer') { if (!d.xferId) return UI.toast('Choose the other account.', 'error'); return post({ kind: 'transfer', accountId: d.xferId }); }
    if (act === 'sadd') { d.split.push({ accountId: '', amount: '', memo: '' }); return UI.render(); }
    if (act === 'sdel') { d.split.splice(+t.closest('tr').dataset.si, 1); return UI.render(); }
    if (act === 'split') {
      let lines; try { lines = d.split.filter((x) => x.accountId && x.amount).map((x) => ({ accountId: x.accountId, amount: U.toCents(x.amount), memo: x.memo })); } catch (err) { return UI.toast(err.message, 'error'); }
      return post({ kind: 'split', lines, contactId: d.contactId || p.contactId || '' });
    }
    if (act === 'exclude') return excludeAsk([id]);
    if (act === 'rule') return UI.editRule({ contains: I.ruleTextFor(l.description) || '', accountId: d.categoryId || p.categoryId || '', contactId: d.contactId || p.contactId || '', direction: l.amount > 0 ? 'in' : 'out', accountIds: [l.accountId], sample: l }).then((r) => { if (r) UI.render(); });
  }
  function paneChange(e, b, pane) { // store what was typed or picked; never re-render under the user's cursor
    const id = pane.dataset.line, d = bf.drafts[id] || (bf.drafts[id] = {}), x = e.target;
    if (x.dataset.mc !== undefined) { if (e.type === 'change') { d.mc = x.value; d.msel = {}; UI.render(); } return; }
    if (x.dataset.mi) {
      if (e.type !== 'change') return;
      const sel = d.msel || (d.msel = {}), amt = pane.querySelector(`[data-ma="${x.dataset.mi}"]`), l = b.bankLineById[id];
      if (x.checked) { // fill what is still missing from the bank amount, up to the open balance
        let used = 0; Object.keys(sel).forEach((k) => { try { used += U.toCents(sel[k] || 0); } catch (err) { /* checked below */ } });
        const ob = b.openBalance(b.txById[x.dataset.mi]), left = Math.abs(l.amount) - used;
        sel[x.dataset.mi] = U.fmtPlain(left > 0 ? Math.min(ob, left) : ob); amt.disabled = false; amt.value = sel[x.dataset.mi];
      } else { delete sel[x.dataset.mi]; amt.value = ''; amt.disabled = true; }
      return manualSum(pane);
    }
    if (x.dataset.ma) { (d.msel || (d.msel = {}))[x.dataset.ma] = x.value; return manualSum(pane); }
    if (x.dataset.d) { d[x.dataset.d] = x.value; return; }
    if (x.dataset.cand !== undefined) { d.cand = +x.dataset.cand; return; }
    if (!x.dataset.s) return;
    d.split[+x.closest('tr').dataset.si][x.dataset.s] = x.value;
    let sum = 0; d.split.forEach((s) => { try { sum += U.toCents(s.amount || 0); } catch (err) { sum = NaN; } });
    const diff = Math.abs(b.bankLineById[id].amount) - sum, el = pane.querySelector('[data-testid="bf-split-diff"]'), btn = pane.querySelector('[data-act="split"]');
    if (el) { el.textContent = isNaN(diff) ? 'Check the amounts' : 'Difference ' + U.fmt(diff, { symbol: true }); el.className = diff ? 'warn-text' : 'muted'; }
    if (btn) btn.disabled = !!diff || isNaN(diff);
  }
  function keys(e, b, a) {
    if (e.target.closest('.bf-pane') && !e.target.matches('[data-ptab]') || e.target.matches('input:not([type=checkbox]):not([type=radio]), select, textarea, .combo-input')) { if (e.key === 'Escape' && bf.open) { bf.open = ''; UI.render(); e.stopPropagation(); } return; }
    const rows = [...document.querySelectorAll('.bf-table tr.bf-row')], cur = e.target.closest('tr.bf-row') || rows.find((r) => r.dataset.id === bf.focus), i = rows.indexOf(cur);
    const go = (k) => { const n = rows[Math.max(0, Math.min(rows.length - 1, k))]; if (n) { bf.focus = n.dataset.id; n.focus(); } };
    const id = cur && cur.dataset.id, k = e.key.toLowerCase(), handled = () => { e.preventDefault(); e.stopPropagation(); };
    if (e.key === 'ArrowDown') { handled(); return go(i + 1); }
    if (e.key === 'ArrowUp') { handled(); return go(i - 1); }
    if (!id || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Enter') { handled(); return toggle(id); }
    if (e.key === ' ') { handled(); if (bf.sel.has(id)) bf.sel.delete(id); else bf.sel.add(id); bf.focus = id; return UI.render(); }
    if (e.key === 'Escape' && bf.open) { handled(); bf.open = ''; return UI.render(); }
    if (bf.tab === 'review' && k === 'a') { handled(); return primary(b, id).then(() => { delete bf.drafts[id]; nextFocus(id); UI.toast('Posted.'); UI.render(); }, (err) => { UI.error(err); toggle(id); }); }
    if (bf.tab === 'review' && k === 'x') { handled(); return excludeAsk(bf.sel.size ? [...bf.sel] : [id]); }
  }
  function bindImport(el, b) {
    const imp = bf.imp; if (!imp) return;
    const $ = (s) => el.querySelector(s), on = (s, ev, fn) => { const x = $(s); if (x) x.addEventListener(ev, fn); };
    on('#bfi-cancel', 'click', () => { bf.imp = null; UI.render(); });
    on('#bfi-acc', 'change', (e) => { imp.accountId = e.target.value; });
    on('#bfi-back', 'click', () => { bf.imp = { step: 'pick', accountId: imp.accountId }; UI.render(); });
    const takeFile = (f) => {
      if (!f) return;
      const accId = ($('#bfi-acc') || {}).value || imp.accountId;
      if (!accId) { imp.error = 'Choose the account to import into first.'; return UI.render(); }
      if (/\.(xlsx|xlsm|xls)$/i.test(f.name)) { // 1.47.1: Excel opens in the same column step as CSV, on the sheet with the most transactions
        return f.arrayBuffer().then((buf) => UI.loadVendor(['sheetjs.min.js']).then(() => {
          const wb = window.XLSX.read(buf, { type: 'array', cellNF: true });
          const list = I.pickSheets(wb.SheetNames.map((name) => ({ name, rows: OB.qbimport.sheetRows(wb.Sheets[name], window.XLSX.SSF) })));
          if (!list.length) { imp.error = 'No sheet in "' + f.name + '" has a date column and an amount (or money in / money out) column.'; return UI.render(); }
          bf.accountId = accId; bf.imp = startMap(b, accId, list[0].table, f.name); bf.imp.sheets = list; bf.imp.sheet = 0; UI.render();
        })).catch((e) => { imp.error = 'Could not read "' + f.name + '": ' + e.message; UI.render(); });
      }
      if (!/\.(csv|txt|tsv)$/i.test(f.name)) { // OFX/QBO and PDF go through the statement reader, then come back here
        UI.statementQueue = { files: [f], accountId: accId }; bf.imp = null; return UI.go('#/pdfimport');
      }
      const rd = new FileReader();
      rd.onload = () => {
        const text = String(rd.result || ''), table = /\.tsv$/i.test(f.name) ? text.split(/\r?\n/).filter((x) => x.trim()).map((x) => x.split('\t')) : U.parseCSV(text);
        if (!table.length || !table.some((r) => r.some((c) => String(c).trim()))) { imp.error = 'The file "' + f.name + '" is empty.'; return UI.render(); }
        bf.accountId = accId; bf.imp = startMap(b, accId, table.slice(I.findHeader(table)), f.name); UI.render(); // title rows above the header are skipped
      };
      rd.onerror = () => { imp.error = 'Could not read "' + f.name + '".'; UI.render(); };
      rd.readAsText(f);
    };
    on('#bfi-file', 'change', (e) => takeFile(e.target.files[0]));
    const drop = $('#bfi-drop');
    if (drop) { ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); })); ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('over'); })); drop.addEventListener('drop', (e) => takeFile(e.dataTransfer.files[0])); }
    on('#bfm-next', 'click', () => {
      const v = (id) => +$(id).value, m = { date: v('#bfm-date'), description: v('#bfm-desc'), amount: v('#bfm-amt'), check: v('#bfm-chk'), sign: v('#bfm-sign'), debit: v('#bfm-deb'), credit: v('#bfm-cre'), balance: v('#bfm-bal'), hasHeader: $('#bfm-head').checked, dateFormat: $('#bfm-df').value };
      imp.mapping = m; imp.invert = $('#bfm-inv').checked; imp.remember = $('#bfm-rem').checked; imp.ambiguous = false;
      const chk = I.checkFile(imp.table, m);
      if (!chk.ok) return UI.render();
      imp.step = 'preview'; preview(b, imp); UI.render();
    });
    ['#bfm-head', '#bfm-date', '#bfm-df', '#bfm-amt', '#bfm-deb', '#bfm-cre', '#bfm-sign'].forEach((s) => on(s, 'change', () => { // keep the problem banner live
      const v = (id) => +$(id).value; Object.assign(imp.mapping, { date: v('#bfm-date'), amount: v('#bfm-amt'), debit: v('#bfm-deb'), credit: v('#bfm-cre'), description: v('#bfm-desc'), check: v('#bfm-chk'), sign: v('#bfm-sign'), balance: v('#bfm-bal'), hasHeader: $('#bfm-head').checked, dateFormat: $('#bfm-df').value });
      imp.invert = $('#bfm-inv').checked; imp.remember = $('#bfm-rem').checked; UI.render();
    }));
    on('#bfm-sheet', 'change', (e) => { const k = +e.target.value, sh = imp.sheets; bf.imp = startMap(b, imp.accountId, sh[k].table, imp.fileName); bf.imp.sheets = sh; bf.imp.sheet = k; UI.render(); });
    const remap = () => { imp.step = 'map'; imp.fromProfile = false; UI.render(); };
    on('#bfi-remap', 'click', remap); on('#bfi-remap2', 'click', remap);
    on('#bfi-books', 'change', (e) => { imp.matchBooks = e.target.checked; });
    on('#bfi-auto', 'change', (e) => { imp.autoAdd = e.target.checked; });
    on('#bfi-go', 'click', (e) => UI.busy(e.target, () => {
      const bal = imp.bal, meta = { fileName: imp.fileName, source: 'csv', endingBalance: bal.hasBalance && !bal.mismatches.length ? bal.endingBalance : null, endingDate: bal.hasBalance ? bal.endingDate : '' };
      const save = imp.remember ? b.saveBankProfile(imp.accountId, { header: imp.header, mapping: imp.mapping, dateFormat: imp.mapping.dateFormat, invert: imp.invert }) : Promise.resolve();
      meta.matchBooks = imp.matchBooks !== false; meta.autoAdd = imp.autoAdd !== false;
      return save.then(() => b.importBankLines(imp.accountId, imp.rows, meta)).then((r) => {
        bf.imp = null; bf.tab = 'review'; bf.accountId = imp.accountId;
        const waiting = r.added - (r.matched || 0) - (r.autoAdded || 0);
        UI.toast(waiting + ' line' + (waiting === 1 ? '' : 's') + ' added to For review' + (r.matched ? ' · ' + r.matched + ' already in the books, matched' : '') + (r.autoAdded ? ' · ' + r.autoAdded + ' posted by rules' : '') + (r.duplicates ? ' · ' + r.duplicates + ' already imported' : '') + '. Matched and posted lines are on the Posted tab.');
        UI.go('#/bankfeed?account=' + encodeURIComponent(imp.accountId));
      });
    }).catch(UI.error));
  }
  /* ---------------- export to QuickBooks ---------------- */
  function periodOf(preset, from, to) {
    const t = U.today(), y = +t.slice(0, 4), m = +t.slice(5, 7), ymd = (yy, mm, dd) => U.ymd(yy, mm, dd), end = (yy, mm) => U.monthEnd(ymd(yy, mm, 1));
    const q = Math.floor((m - 1) / 3), lm = m === 1 ? [y - 1, 12] : [y, m - 1], lq = q === 0 ? [y - 1, 3] : [y, q - 1];
    switch (preset) {
      case 'thisMonth': return [ymd(y, m, 1), end(y, m)];
      case 'lastMonth': return [ymd(lm[0], lm[1], 1), end(lm[0], lm[1])];
      case 'thisQuarter': return [ymd(y, q * 3 + 1, 1), end(y, q * 3 + 3)];
      case 'lastQuarter': return [ymd(lq[0], lq[1] * 3 + 1, 1), end(lq[0], lq[1] * 3 + 3)];
      case 'thisYear': return [ymd(y, 1, 1), ymd(y, 12, 31)];
      case 'lastYear': return [ymd(y - 1, 1, 1), ymd(y - 1, 12, 31)];
      case 'last12': return [U.addMonths(U.monthStart(t), -11), U.monthEnd(t)];
      case 'custom': return [from || '', to || ''];
      default: return ['', ''];
    }
  }
  function expOpts(b, ex) {
    const [from, to] = periodOf(ex.preset, ex.from, ex.to);
    return { accountIds: ex.accountIds, from, to, onlyNew: ex.onlyNew, cleared: ex.cleared, lists: ex.lists, payments: ex.payments, names: ex.names };
  }
  function exportPanel(b, accs) {
    const ex = bf.exp, o = expOpts(b, ex), iif = ex.format === 'iif';
    const r = ex.accountIds.length ? (iif ? OB.qbexport.bankIIF(b, o) : OB.qbexport.bankCSV(b, o)) : null;
    const pl = iif && ex.accountIds.length ? OB.qbexport.paymentList(b, o) : null;
    const reasons = {}; (r ? r.skipped : []).forEach((s) => { const k = s.reason.replace(/ on .*$/, '').replace(/ before$/, ''); reasons[k] = (reasons[k] || 0) + 1; });
    const hist = (b.company.bankExports || []).slice().reverse().slice(0, 20);
    return `<div class="card-head"><h2>Export bank transactions to QuickBooks</h2><button class="btn ghost small" id="bfx-cancel">Close</button></div>
      <div class="segmented" role="group" aria-label="QuickBooks version">${[['iif', 'QuickBooks Desktop (.iif)'], ['csv', 'QuickBooks Online bank upload (.csv)']].map(([k, t]) => `<button data-xfmt="${k}" aria-pressed="${ex.format === k}">${t}</button>`).join('')}</div>
      <p class="muted small"><strong>Only transactions posted in VaultBook are sent</strong>; lines still in For review stay behind until you post them. ${iif ? 'Sends each posted line as the transaction you recorded, with its category, payee, class and splits: payments out become Checks, deposits become Deposits, transfers go once for both accounts, card charges become Credit Card charges. In QuickBooks Desktop: back up the company file, then File → Utilities → Import → IIF Files.' : 'QuickBooks Online cannot read .iif files. This gives one Date / Description / Amount file per account for Banking → Upload transactions; QuickBooks Online then categorizes the lines in its own bank feed (your VaultBook categories are not carried).'}</p>
      <div class="bf-xgrid">
        <fieldset class="bf-xacc"><legend>Accounts</legend>${accs.map((a) => `<div class="bf-xrow"><label class="check"><input type="checkbox" data-xacc="${esc(a.id)}" ${ex.accountIds.includes(a.id) ? 'checked' : ''}> ${esc(b.accountLabel(a.id))}</label>
          ${iif && ex.accountIds.includes(a.id) ? `<input class="bf-xname" data-xname="${esc(a.id)}" value="${esc(ex.names[a.id] || b.accountFullName(a))}" aria-label="Name of ${esc(a.name)} in QuickBooks" title="The account's exact name in QuickBooks">` : ''}</div>`).join('')}
          ${iif ? '<p class="muted small">The box beside each account is its exact name in QuickBooks; change it if QuickBooks calls it something else, so the lines land in the right register.</p>' : ''}</fieldset>
        <fieldset><legend>Period</legend><label class="field"><span>Dates</span><select id="bfx-preset">${[['all', 'All dates'], ['thisMonth', 'This month'], ['lastMonth', 'Last month'], ['thisQuarter', 'This quarter'], ['lastQuarter', 'Last quarter'], ['thisYear', 'This year'], ['lastYear', 'Last year'], ['last12', 'Last 12 months'], ['custom', 'Custom dates']].map(([k, t]) => `<option value="${k}"${ex.preset === k ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
          ${ex.preset === 'custom' ? `<div class="form-grid cols2"><label class="field"><span>From</span><input type="date" id="bfx-from" value="${esc(ex.from)}"></label><label class="field"><span>To</span><input type="date" id="bfx-to" value="${esc(ex.to)}"></label></div>` : o.from ? `<p class="muted small">${esc(U.fmtDate(o.from))} – ${esc(U.fmtDate(o.to))}</p>` : ''}
          <legend class="bf-xsub">What to send</legend>
          <label class="check"><input type="checkbox" id="bfx-new" ${ex.onlyNew ? 'checked' : ''}> Only lines not exported before</label>
          ${iif ? `<label class="check"><input type="checkbox" id="bfx-clr" ${ex.cleared ? 'checked' : ''}> Mark them cleared in QuickBooks</label>
          <label class="check"><input type="checkbox" id="bfx-lists" ${ex.lists ? 'checked' : ''}> Include the accounts, vendors and customers used</label>
          <label class="field"><span>Payments of invoices and bills</span><select id="bfx-pay" data-testid="bfx-pay"><option value="payment"${ex.payments !== 'skip' ? ' selected' : ''}>Send as customer payments and bill payments</option><option value="skip"${ex.payments === 'skip' ? ' selected' : ''}>Leave out (enter them in QuickBooks)</option></select></label>` : ''}</fieldset>
      </div>
      ${r ? `<div class="scroll-x"><table class="data compact" data-testid="bf-export-preview"><thead><tr><th>Account</th><th class="num">Lines</th><th class="num">Money in</th><th class="num">Money out</th></tr></thead><tbody>
        ${ex.accountIds.map((id) => { const x = r.byAccount[id] || { in: 0, out: 0, count: 0 }; return `<tr><td>${esc(b.accountLabel(id))}</td><td class="num">${x.count}</td><td class="num">${UI.money(x.in)}</td><td class="num">${UI.money(x.out)}</td></tr>`; }).join('')}</tbody></table></div>
        <p><strong data-testid="bf-export-count">${r.txnCount}</strong> ${iif ? 'transaction' + (r.txnCount === 1 ? '' : 's') : 'line' + (r.txnCount === 1 ? '' : 's')} will be written.${Object.keys(reasons).length ? ` Left out: ${Object.keys(reasons).map((k) => `${reasons[k]} ${esc(k)}`).join('; ')}.` : ''}</p>` : '<p class="warn-text">Choose at least one account.</p>'}
      ${iif && pl && pl.rows.length ? `<section class="bf-xpay" data-testid="bf-xpay"><h3>Payments of invoices and bills: ${pl.payments} payment${pl.payments === 1 ? '' : 's'}, ${pl.rows.length} ${pl.rows.length === 1 ? 'item' : 'items'} to apply</h3>
        <p class="small">QuickBooks Desktop does not link imported payments to invoices. ${ex.payments === 'skip' ? 'You chose to leave them out: enter them with Receive Payments and Pay Bills using this list.' : 'Each payment arrives as a real customer payment or bill payment with the invoices it pays written in its memo, and the list below downloads with the file.'}
          If QuickBooks' <i>Automatically apply payments</i> preference (Edit › Preferences › Payments) is on, it applies each payment to an invoice of the same amount, otherwise to the oldest; turn it off and tick the invoices from this list when one payment pays several invoices.</p>
        <div class="scroll-x"><table class="data compact" data-testid="bf-xpay-table"><thead><tr><th>Date</th><th>Customer or vendor</th><th class="num">Payment</th><th>Apply to</th><th class="num">Amount</th></tr></thead><tbody>${pl.rows.slice(0, 12).map((x) => `<tr><td>${UI.date(x.date)}</td><td>${esc(x.name)}</td><td class="num">${UI.money(x.amount)}</td><td>${esc((x.kind === 'Bill payment' ? 'Bill ' : 'Invoice ') + (x.doc || U.fmtDate(x.docDate)))}</td><td class="num">${UI.money(x.applied)}</td></tr>`).join('')}${pl.rows.length > 12 ? `<tr><td colspan="5" class="muted">and ${pl.rows.length - 12} more in the file</td></tr>` : ''}</tbody></table></div>
        <div class="form-actions"><button class="btn" id="bfx-paylist" data-testid="bfx-paylist">Download payments to apply (.csv)</button></div></section>` : ''}
      ${iif ? `<p class="small"><button class="btn ghost small" id="bfx-paylist-old" data-testid="bfx-paylist-old">Payments to apply for lines already exported</button> <span class="muted">If an earlier file left invoices open in QuickBooks: this lists which invoices each of those payments pays, for the chosen period.</span></p>
      <p class="small"><button class="btn ghost small" id="bfx-qbbatch" data-testid="bfx-qbbatch">Connector batch for QuickBooks (.json)</button> <span class="muted">Customer payments in the chosen period, exported before or not, for VaultBook QuickBooks.cmd (tools folder) › Send: it records each payment against its invoices in QuickBooks Desktop, so they close. Banking › Send to QuickBooks does this for invoices too.</span></p>` : ''}
      <div class="form-actions"><span class="spacer"></span><button class="btn primary" id="bfx-go" data-testid="bf-export-go" ${r && r.txnCount ? '' : 'disabled'}>${iif ? 'Download .iif' : 'Download .csv' + (ex.accountIds.length > 1 ? ' files' : '')}</button></div>
      ${hist.length ? `<details class="bf-xhist"><summary>Export history (${hist.length})</summary><table class="data compact" data-testid="bf-export-history"><tbody>${hist.map((h) => `<tr class="${h.undone ? 'inactive' : ''}"><td>${esc(new Date(h.at).toLocaleString())}</td><td>${esc(h.fileName)}</td><td class="num">${h.count} line${h.count === 1 ? '' : 's'}</td>
        <td>${h.undone ? '<span class="badge void">Marked not exported</span>' : `<button class="btn ghost small" data-xundo="${esc(h.id)}">Mark as not exported</button>`}</td></tr>`).join('')}</tbody></table></details>` : ''}`;
  }
  function bindExport(el, b, accs) {
    const ex = bf.exp; if (!ex) return;
    const $ = (s) => el.querySelector(s), on = (s, ev, fn) => { const x = $(s); if (x) x.addEventListener(ev, fn); };
    const re = () => UI.render();
    on('#bfx-cancel', 'click', () => { bf.exp = null; re(); });
    el.querySelectorAll('[data-xfmt]').forEach((x) => x.addEventListener('click', () => { ex.format = x.dataset.xfmt; re(); }));
    el.querySelectorAll('[data-xacc]').forEach((x) => x.addEventListener('change', () => { ex.accountIds = accs.map((a) => a.id).filter((id) => id === x.dataset.xacc ? x.checked : ex.accountIds.includes(id)); re(); }));
    el.querySelectorAll('[data-xname]').forEach((x) => x.addEventListener('change', () => { ex.names[x.dataset.xname] = x.value; re(); }));
    on('#bfx-preset', 'change', (e) => { ex.preset = e.target.value; re(); });
    U.dateCommit($('#bfx-from'), (v) => { ex.from = v; }, re); U.dateCommit($('#bfx-to'), (v) => { ex.to = v; }, re);   // not on every digit of the year
    [['#bfx-new', 'onlyNew'], ['#bfx-clr', 'cleared'], ['#bfx-lists', 'lists']].forEach(([s, k]) => on(s, 'change', (e) => { ex[k] = e.target.checked; re(); }));
    on('#bfx-pay', 'change', (e) => { ex.payments = e.target.value; re(); });
    const payCsv = (onlyNew) => {
      const o = Object.assign(expOpts(b, ex), { onlyNew }), pl = OB.qbexport.paymentList(b, o), co = (b.company.name || 'VaultBook').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-');
      if (!pl.rows.length) return UI.toast(onlyNew ? 'No invoice or bill payments in this choice.' : 'No exported invoice or bill payments in this period.');
      U.download(`${co}-payments-to-apply-${(o.from || 'all') + (o.to ? '_' + o.to : '')}.csv`, new Blob([pl.csv], { type: 'text/csv' }));
      UI.toast(pl.rows.length + ' invoice' + (pl.rows.length === 1 ? '' : 's') + ' and bills listed with the payment that pays them.');
    };
    on('#bfx-paylist', 'click', () => payCsv(ex.onlyNew));
    on('#bfx-paylist-old', 'click', () => payCsv(false));
    on('#bfx-qbbatch', 'click', () => {
      const o = Object.assign(expOpts(b, ex), { onlyNew: false }), names = {};
      ex.accountIds.forEach((id) => { if (ex.names[id]) names[id] = ex.names[id]; });
      const batch = OB.qbexport.connectorBatch(b, Object.assign(o, { names })), co = (b.company.name || 'VaultBook').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-');
      if (!batch.payments.length) return UI.toast('No customer payments of invoices in this period.');
      U.download(`${co}-qb-payments-${(o.from || 'all') + (o.to ? '_' + o.to : '')}.json`, new Blob([JSON.stringify(batch, null, 2)], { type: 'application/json' }));
      UI.toast(batch.payments.length + ' customer payment' + (batch.payments.length === 1 ? '' : 's') + ' saved for the connector' + (batch.billPayments ? '; ' + batch.billPayments + ' bill payment' + (batch.billPayments === 1 ? '' : 's') + ' not included yet' : '') + '.');
    });
    el.querySelectorAll('[data-xundo]').forEach((x) => x.addEventListener('click', () => b.undoBankExport(x.dataset.xundo).then(() => { UI.toast('Those lines will be exported again next time.'); re(); }).catch(UI.error)));
    on('#bfx-go', 'click', (e) => UI.busy(e.target, () => {
      const o = expOpts(b, ex), co = (b.company.name || 'VaultBook').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-'), span = (o.from || 'all') + (o.to ? '_' + o.to : '');
      const names = {}; ex.accountIds.forEach((id) => { const a = b.accById[id]; if (ex.names[id] && ex.names[id] !== b.accountFullName(a)) names[id] = ex.names[id]; else names[id] = ''; });
      if (ex.format === 'iif') {
        const r = OB.qbexport.bankIIF(b, o), name = `${co}-bank-${span}.iif`, pl = OB.qbexport.paymentList(b, o);
        U.download(name, new Blob([OB.qbexport.toAnsi(r.text)], { type: 'text/plain' }));
        if (pl.rows.length) setTimeout(() => U.download(`${co}-payments-to-apply-${span}.csv`, new Blob([pl.csv], { type: 'text/csv' })), 400);
        return b.recordBankExport(r, { fileName: name, format: 'iif', accountIds: ex.accountIds, from: o.from, to: o.to, names }).then(() => { UI.toast(r.txnCount + ' transaction' + (r.txnCount === 1 ? '' : 's') + ' saved to ' + name + '.'); re(); });
      }
      return ex.accountIds.reduce((p, id) => p.then((n) => {
        const r = OB.qbexport.bankCSV(b, Object.assign({}, o, { accountIds: [id] })); if (!r.txnCount) return n;
        const a = b.accById[id], name = `${co}-${a.name.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-')}-${span}.csv`;
        U.download(name, new Blob([r.text], { type: 'text/csv' }));
        return b.recordBankExport(r, { fileName: name, format: 'csv', accountIds: [id], from: o.from, to: o.to }).then(() => n + r.txnCount);
      }), Promise.resolve(0)).then((n) => { UI.toast(n + ' line' + (n === 1 ? '' : 's') + ' saved for QuickBooks Online.'); re(); });
    }).catch(UI.error));
  }
})();
