/* VaultBook Intelligence panel (1.42): ask the books a question beside any screen. The answers come from OB.intel (js/intel.js);
 * this file only shows them. Optional: when the browser has a built-in on-device language model (Chrome's Prompt API,
 * window.LanguageModel) and the user turns it on, a question the built-in reading does not understand is passed to that
 * model to fill the slots. The model never supplies a figure and VaultBook itself makes no network request. */
(function () {
  'use strict';
  const OB = window.OB, UI = OB.ui, U = OB.util, I = OB.intel, esc = U.esc;
  const st = { open: false, log: [], ctx: {}, busy: false, model: 'none' };   // model: none | off | ready | loading
  let panel = null;

  const here = () => {   // the record on the screen behind the panel, so "open invoices" means this customer's
    const r = UI.parseHash ? UI.parseHash() : {}, b = UI.book; if (!b) return {};
    if (r.name === 'contact' && b.contactById[r.id]) return { contactId: r.id, label: b.contactById[r.id].name };
    if (r.params && r.params.account && b.accById[r.params.account] && /^(report|register|bankfeed)$/.test(r.name)) return { accountId: r.params.account, label: b.accById[r.params.account].name };
    return {};
  };
  const cellHtml = (c) => {
    if (c && typeof c === 'object') {
      if (c.href) return `<a href="${esc(c.href)}">${esc(c.v)}</a>`;
      if (c.ask) return `<button type="button" class="vi-link" data-ask="${esc(c.ask)}">${esc(c.v)}</button>`;
      return esc(c.v);
    }
    return esc(c === undefined || c === null ? '' : c);
  };
  const isNum = (c) => /^[-+(]?\$?[\d,]+(\.\d+)?%?\)?$/.test(String(c && typeof c === 'object' ? c.v : c).trim());
  const answerHtml = (a) => {
    const t = a.table, n = t && t.rows.length;
    const table = t ? `<table class="vi-table${t.head ? '' : ' kv'}">${t.head ? `<thead><tr>${t.head.map((h, i) => `<th${i && t.rows.every((r) => r[i] === '' || isNum(r[i])) ? ' class="num"' : ''}>${esc(h)}</th>`).join('')}</tr></thead>` : ''}<tbody>${t.rows.map((r, ri) =>
      `<tr${t.total && ri === n - 1 ? ' class="tot"' : ''}>${r.map((c, i) => `<td${i && (t.head ? t.rows.every((x) => x[i] === '' || isNum(x[i])) : true) ? ' class="num"' : ''}>${cellHtml(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>` : '';
    return `${a.understood ? `<p class="vi-und">${esc(a.understood)}${a.byModel ? ' · read by the on-device model' : ''}</p>` : ''}<p class="vi-text">${esc(a.text || '')}</p>${table}${a.more ? `<p class="vi-more">${esc(a.more)}</p>` : ''}
      ${a.source ? `<p class="vi-src">Source: <a href="${esc(a.source.href)}">${esc(a.source.label)}</a></p>` : ''}
      ${a.actions && a.actions.length ? `<div class="vi-acts">${a.actions.map((x) => x.href ? `<a class="btn small" href="${esc(x.href)}">${esc(x.label)}</a>` : `<button type="button" class="btn small" data-ask="${esc(x.ask)}">${esc(x.label)}</button>`).join('')}</div>` : ''}`;
  };
  const suggestions = () => {
    const b = UI.book, h = here(), c = b && b.contacts.find((x) => x.kind === 'customer' && x.active !== false);
    return (h.contactId ? ['Open invoices', 'Unpaid bills'] : []).concat(c && !h.contactId ? [c.name] : [], ['How many open invoices are there?', 'Who owes us more than 60 days?', 'Income by month with percentage', 'Top 5 expenses this year', 'Why did profit change from last year?', 'Bank balances']);
  };
  const draw = () => {
    if (!panel) return;
    const h = here(), log = panel.querySelector('#vi-log');
    panel.querySelector('#vi-about').innerHTML = h.label ? `About <strong>${esc(h.label)}</strong>` : 'Offline · answers come from your books';
    log.innerHTML = st.log.length ? st.log.map((x) => `<div class="vi-q">${esc(x.q)}</div><div class="vi-a${x.a.notUnderstood ? ' miss' : ''}" data-testid="vi-answer">${answerHtml(x.a)}</div>`).join('') + (st.busy ? '<p class="vi-und">Reading the question…</p>' : '')
      : `<p class="vi-und">Type a customer, vendor or account name, or ask a question. Try:</p><div class="vi-sugg">${suggestions().map((s) => `<button type="button" class="btn small" data-ask="${esc(s)}">${esc(s)}</button>`).join('')}</div>`;
    log.scrollTop = log.scrollHeight;
    const m = panel.querySelector('#vi-model');
    m.innerHTML = st.model === 'ready' ? 'Smart reading is on (this browser\'s on-device model). <button type="button" class="vi-link" data-model="off">Turn off</button>'
      : st.model === 'off' ? (st.avail === 'available' ? 'This browser has an on-device language model. ' : 'This browser can add an on-device language model (the browser downloads it once). ') + '<button type="button" class="vi-link" data-model="on">Use it for questions I do not understand</button>'
      : st.model === 'loading' ? 'Getting the on-device model ready…' : '';
    m.hidden = !m.innerHTML;
  };
  /* ---- optional on-device model (Chrome Prompt API). Feature-detected; every call is guarded. ---- */
  let session = null;
  const LM = () => (typeof self !== 'undefined' && self.LanguageModel) || null;
  const detectModel = () => {
    const L = LM(); if (!L || !L.availability) return;
    Promise.resolve().then(() => L.availability()).then((a) => { if (a === 'unavailable') return; st.avail = a; st.model = OB.prefs.get('intelModel') && a === 'available' ? 'ready' : 'off'; draw(); }).catch(() => {});
  };
  const modelOn = () => {   // from a click: the browser may need to fetch its own model the first time
    const L = LM(); if (!L) return;
    st.model = 'loading'; draw();
    Promise.resolve().then(() => L.create({ initialPrompts: [{ role: 'system', content: I.SLOT_PROMPT }] })).then((s) => { session = s; OB.prefs.set('intelModel', true); st.model = 'ready'; draw(); })
      .catch(() => { st.model = 'off'; draw(); UI.toast('The on-device model could not be started in this browser.', 'error'); });
  };
  const modelSlots = (text) => {
    const L = LM(); if (st.model !== 'ready' || !L) return Promise.resolve(null);
    const get = session ? Promise.resolve(session) : Promise.resolve().then(() => L.create({ initialPrompts: [{ role: 'system', content: I.SLOT_PROMPT }] })).then((s) => (session = s));
    const run = get.then((s) => s.prompt('Question: ' + text.slice(0, 300), { responseConstraint: I.SLOT_SCHEMA })).then((out) => I.fromModel(out, text));
    return Promise.race([run, new Promise((res) => setTimeout(() => res(null), 20000))]).catch(() => null);
  };

  const ask = (text) => {
    text = String(text || '').trim(); const b = UI.book;
    if (!text || !b || st.busy) return;
    const h = here(), last = st.log.length ? st.log[st.log.length - 1].a : null;
    const ctx = { contactId: (last && last.ctx.contactId) || h.contactId || '', accountId: (last && last.ctx.accountId) || h.accountId || '', last: last && !last.notUnderstood ? last.intent : null };
    let a; try { a = I.ask(b, text, ctx); } catch (e) { a = { notUnderstood: true, text: 'That question could not be answered: ' + e.message, ctx: {}, actions: [] }; }
    const entry = { q: text, a }; st.log.push(entry); if (st.log.length > 30) st.log.shift();
    if (!a.notUnderstood || st.model !== 'ready') return draw();
    st.busy = true; draw();
    modelSlots(text).then((s) => {
      if (s) { try { const a2 = I.run(b, I.resolve(b, s, ctx)); if (!a2.notUnderstood) { a2.byModel = true; entry.a = a2; } } catch (e) { /* keep the first answer */ } }
    }).then(() => { st.busy = false; draw(); });
  };
  const build = () => {
    panel = document.createElement('aside');
    panel.id = 'vi'; panel.className = 'vi no-print'; panel.setAttribute('aria-label', 'VaultBook Intelligence'); panel.setAttribute('data-testid', 'vi-panel');
    panel.innerHTML = `<div class="vi-head"><h2>VaultBook Intelligence</h2><button type="button" class="icon-btn" id="vi-clear" title="Start over" aria-label="Start over">↺</button><button type="button" class="icon-btn" id="vi-close" title="Close (Esc)" aria-label="Close">×</button></div>
      <p class="vi-about" id="vi-about"></p>
      <div class="vi-log" id="vi-log" role="log" aria-live="polite"></div>
      <p class="vi-model" id="vi-model" hidden></p>
      <form class="vi-form" id="vi-form" autocomplete="off"><label class="sr-only" for="vi-input">Ask about your books</label><input id="vi-input" data-testid="vi-input" placeholder="A name or a question" maxlength="300"><button type="submit" class="btn primary small" data-testid="vi-send">Ask</button></form>`;
    (document.querySelector('.workarea') || document.body).appendChild(panel);
    panel.querySelector('#vi-form').addEventListener('submit', (e) => { e.preventDefault(); const i = panel.querySelector('#vi-input'); ask(i.value); i.value = ''; });
    panel.querySelector('#vi-close').addEventListener('click', () => UI.intel(false));
    panel.querySelector('#vi-clear').addEventListener('click', () => { st.log = []; draw(); panel.querySelector('#vi-input').focus(); });
    panel.addEventListener('click', (e) => {
      const a = e.target.closest('[data-ask]'); if (a) { ask(a.dataset.ask); return; }
      const m = e.target.closest('[data-model]'); if (m) { if (m.dataset.model === 'on') modelOn(); else { OB.prefs.set('intelModel', false); st.model = 'off'; draw(); } }
    });
    panel.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); UI.intel(false); } });
    detectModel();
  };
  /** Open, close or toggle the panel. */
  UI.intel = (open) => {
    if (!UI.book) return;
    st.open = open === undefined ? !st.open : !!open;
    if (st.open && !panel) build();
    if (panel) panel.hidden = !st.open;
    document.body.classList.toggle('vi-open', st.open);
    const btn = document.getElementById('vi-btn'); if (btn) btn.setAttribute('aria-expanded', String(st.open));
    if (st.open) { draw(); panel.querySelector('#vi-input').focus(); } else if (btn) btn.focus();
  };
  UI.intelAsk = (text) => { UI.intel(true); ask(text); };
  document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('#vi-btn')) UI.intel(); });
  document.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === 'i' || e.key === 'I') && UI.book) { e.preventDefault(); UI.intel(); } }, true);
  window.addEventListener('hashchange', () => { if (st.open) draw(); });
})();
