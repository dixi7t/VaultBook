/* VaultBook — Calendar page (1.50.1). Works like a desktop calendar: click any empty spot to add a to-do; drag any item
 * that can move (to-dos, a bill's pay date, an invoice's expected date, the next recurring entry) to another day or
 * time; Ctrl/Shift-click to pick several and drag, tick or delete them together; drag in the hour grid to create, move
 * or resize timed to-dos; every change can be undone (Ctrl+Z). Deadlines set by law and the books' own dates stay put.
 * Engine: js/calendar.js. */
(function () {
  'use strict';
  const U = OB.util, UI = OB.ui, K = OB.cal, esc = U.esc;
  const KINDS = [['bill', 'Bills'], ['invoice', 'Invoices'], ['recurring', 'Recurring'], ['payroll', 'Payroll'], ['tax', 'Tax deadlines'], ['close', 'Close the books'], ['question', 'Client questions'], ['todo', 'To-dos']];
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const REMIND = [['', 'No reminder'], ['0', 'At the time'], ['10', '10 minutes before'], ['30', '30 minutes before'], ['60', '1 hour before'], ['1440', '1 day before'], ['10080', '1 week before']];
  const REPEAT = [['', 'Does not repeat'], ['daily', 'Every day'], ['weekly', 'Every week'], ['monthly', 'Every month'], ['quarterly', 'Every quarter'], ['yearly', 'Every year']];
  const HOUR = 44, SNAP = 15;
  const LOCK = { tax: 'Tax and filing deadlines are set by law and stay on their date.', payroll: 'Pay dates come from your payroll.', close: 'Close the books dates follow the month.', question: 'Client questions show on today.', recurring: 'Only the next recurring entry can be moved.' };
  let cs = null;
  const fresh = (b) => ({ companyId: b.company.id, view: 'month', cursor: U.today(), sel: U.today(), off: {}, cash: true, settings: false, pick: {}, pop: null, undo: null, scroll: 7 * HOUR, pk: '' });
  const dowOf = (d) => new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10))).getUTCDay();
  const first = (d) => d.slice(0, 8) + '01';
  const lastOf = (d) => U.addDays(U.addMonths(first(d), 1), -1);
  const money = (c) => U.fmt(Math.abs(c), { symbol: true });
  const mins = (t) => t ? +t.slice(0, 2) * 60 + +t.slice(3, 5) : 0;
  const hm = (m) => { m = Math.max(0, Math.min(1439, Math.round(m))); return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
  const ampm = (t) => { if (!t) return ''; let h = +t.slice(0, 2); const m = t.slice(3, 5), s = h < 12 ? 'am' : 'pm'; h = h % 12 || 12; return h + (m === '00' ? '' : ':' + m) + s; };
  const daysBetween = (a, b) => Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / 86400000);
  function range() {
    if (cs.view === 'day') return { from: cs.cursor, to: cs.cursor };
    if (cs.view === 'week') { const s = U.addDays(cs.cursor, -dowOf(cs.cursor)); return { from: s, to: U.addDays(s, 6) }; }
    if (cs.view === 'agenda') return { from: cs.cursor, to: U.addDays(cs.cursor, 59) };
    const s = U.addDays(first(cs.cursor), -dowOf(first(cs.cursor))), e = U.addDays(lastOf(cs.cursor), 6 - dowOf(lastOf(cs.cursor)));
    return { from: s, to: e };
  }
  const title = () => cs.view === 'month' ? MONTHS[+cs.cursor.slice(5, 7) - 1] + ' ' + cs.cursor.slice(0, 4)
    : cs.view === 'day' ? DOW[dowOf(cs.cursor)] + ', ' + MONTHS[+cs.cursor.slice(5, 7) - 1] + ' ' + +cs.cursor.slice(8) + ', ' + cs.cursor.slice(0, 4)
    : cs.view === 'week' ? (() => { const r = range(); return U.fmtDate(r.from) + ' – ' + U.fmtDate(r.to); })() : 'From ' + U.fmtDate(cs.cursor);
  let EV = [];   // the events on screen, for the handlers
  const evBy = (k) => EV.find((e) => e.key === k);
  const picked = () => Object.keys(cs.pick).map(evBy).filter(Boolean);

  const chip = (e, cls) => `<div role="button" tabindex="0" class="cal-ev cal-k-${e.kind}${e.done ? ' done' : ''}${e.overdue ? ' late' : ''}${cs.pick[e.key] ? ' picked' : ''}${e.movable ? ' mov' : ''}${cls ? ' ' + cls : ''}" data-ev="${esc(e.key)}" title="${esc(e.title + (e.amount ? ' · ' + money(e.amount) : '') + (e.movable ? '' : ' · ' + (LOCK[e.kind] || '')))}">
    <span class="cal-dot" aria-hidden="true"></span>${e.time ? `<span class="cal-tm">${ampm(e.time)}</span>` : ''}<span class="cal-t">${esc(e.title)}</span>${e.amount ? `<span class="cal-a">${e.amount < 0 ? '−' : '+'}${esc(U.fmt(Math.abs(e.amount)))}</span>` : ''}</div>`;

  UI.routes.calendar = (el, r) => {
    const b = UI.book;
    if (!cs || cs.companyId !== b.company.id) cs = fresh(b);
    const pk = (r.params.date || '') + '|' + (r.params.view || '');
    if (pk !== cs.pk) { cs.pk = pk; if (r.params.date && U.isDate(r.params.date)) cs.cursor = cs.sel = r.params.date; if (/^(month|week|day|agenda)$/.test(r.params.view || '')) cs.view = r.params.view; }
    const today = U.today(), rg = range();
    EV = K.events(b, { from: rg.from, to: rg.to, today }).filter((e) => !cs.off[e.kind]);
    Object.keys(cs.pick).forEach((k) => { if (!evBy(k)) delete cs.pick[k]; });
    const horizon = rg.to > today ? rg.to : today;
    const fc = K.forecast(b, K.events(b, { from: U.addDays(today, -400), to: horizon, today }).filter((e) => !e.done), { today, to: horizon });
    const byDay = {}; EV.forEach((e) => { (byDay[e.date] = byDay[e.date] || []).push(e); });
    Object.values(byDay).forEach((l) => l.sort((x, y) => (x.time ? 0 : -1) - (y.time ? 0 : -1) || mins(x.time) - mins(y.time)));
    const npick = Object.keys(cs.pick).length;
    el.innerHTML = UI.page('Calendar', `<button class="btn primary" id="cal-new" data-testid="cal-add-todo" title="New to-do (C)">+ Create</button><button class="btn" id="cal-ics" data-testid="cal-ics">Download .ics</button><button class="btn" id="cal-set" aria-expanded="${cs.settings}">Settings</button>`, `
      ${cs.settings ? settingsHtml(b, K.settings(b)) : ''}
      <div class="cal-bar">
        <button class="btn small" id="cal-today" title="Today (T)">Today</button>
        <span class="cal-nav"><button class="btn small ghost" id="cal-prev" aria-label="Previous" title="Previous">‹</button><button class="btn small ghost" id="cal-next" aria-label="Next" title="Next">›</button></span>
        <h2 class="cal-title" data-testid="cal-title">${esc(title())}</h2>
        <span class="segmented" role="group" aria-label="View">${[['day', 'Day', 'D'], ['week', 'Week', 'W'], ['month', 'Month', 'M'], ['agenda', 'Agenda', 'A']].map(([k, l, h]) => `<button type="button" data-view="${k}" aria-pressed="${cs.view === k}" title="${l} (${h})">${l}</button>`).join('')}</span>
        <details class="cal-show"><summary class="btn small">Show</summary><div class="cal-show-menu">${KINDS.map(([k, l]) => `<label class="cal-f cal-k-${k}"><input type="checkbox" data-kind="${k}"${cs.off[k] ? '' : ' checked'}><span class="cal-dot" aria-hidden="true"></span>${l}</label>`).join('')}<label class="cal-f"><input type="checkbox" id="cal-cash"${cs.cash ? ' checked' : ''}>Bank balance</label></div></details>
      </div>
      ${npick ? `<div class="cal-selbar" data-testid="cal-selbar" data-overlay><b>${npick} selected</b><button class="btn small" id="cal-sel-done">Mark done</button><button class="btn small" id="cal-sel-del">Delete to-dos</button><button class="btn small ghost" id="cal-sel-clear">Clear (Esc)</button></div>` : ''}
      ${fc.lowDays.length ? `<p class="banner warn cal-lowbar" data-testid="cal-low">The bank balance is forecast to fall below ${money(fc.low)} on ${U.fmtDate(fc.lowDays[0])} (${fc.days[fc.lowDays[0]].balance < 0 ? '−' : ''}${money(fc.days[fc.lowDays[0]].balance)}). <button class="btn small" data-goto="${fc.lowDays[0]}">Show that day</button></p>` : ''}
      <div class="cal-shell card" id="cal-shell">${cs.view === 'agenda' ? agenda(byDay, fc, today) : cs.view === 'month' ? month(rg, byDay, fc, today) : hours(rg, byDay, fc, today)}
        <div id="cal-pop"></div></div>
      <div class="cal-snack" id="cal-snack" role="status" aria-live="polite"></div>
`, 'Bills, invoices, payroll, deadlines and to-dos, with the bank balance each day.');
    bind(el, b, fc, rg);
    if (cs.pop) openPop(el, b, cs.pop);
    const sc = el.querySelector('.cal-scroll'); if (sc) sc.scrollTop = cs.scroll;
  };

  function month(rg, byDay, fc, today) {
    const days = []; for (let d = rg.from; d <= rg.to; d = U.addDays(d, 1)) days.push(d);
    const mon = cs.cursor.slice(0, 7);
    return `<div class="cal-grid" role="grid" data-testid="cal-grid">${DOW.map((d) => `<div class="cal-h" role="columnheader">${d}</div>`).join('')}
      ${days.map((d) => { const ev = byDay[d] || [], x = fc.days[d], hol = K.isHoliday(d);
        return `<div class="cal-cell${d.slice(0, 7) !== mon ? ' other' : ''}${d === today ? ' today' : ''}${d === cs.sel ? ' sel' : ''}${x && x.low ? ' low' : ''}" role="gridcell" data-day="${d}" tabindex="${d === cs.sel ? 0 : -1}" aria-label="${esc(U.fmtDate(d) + (ev.length ? ', ' + ev.length + ' item' + (ev.length === 1 ? '' : 's') : ''))}">
          <div class="cal-d"><button type="button" class="cal-n" data-dayview="${d}" title="Open the day">${+d.slice(8)}</button>${hol ? `<span class="cal-hol">${esc(hol)}</span>` : ''}${cs.cash && x && (x.in || x.out || d === today) ? `<span class="cal-bal${x.balance < 0 ? ' neg' : ''}" title="Forecast bank balance after this day">${esc(U.fmt(x.balance))}</span>` : ''}</div>
          ${ev.slice(0, 4).map((e) => chip(e)).join('')}${ev.length > 4 ? `<button type="button" class="cal-more" data-more="${d}">+${ev.length - 4} more</button>` : ''}</div>`; }).join('')}</div>`;
  }
  function hours(rg, byDay, fc, today) {
    const days = []; for (let d = rg.from; d <= rg.to; d = U.addDays(d, 1)) days.push(d);
    const now = new Date(), nowMin = now.getHours() * 60 + now.getMinutes();
    const col = (d) => {   // timed to-dos, laid out side by side where they overlap
      const t = (byDay[d] || []).filter((e) => e.time).map((e) => ({ e, s: mins(e.time), f: mins(e.time) + Math.max(e.dur || 60, 15) })).sort((a, b) => a.s - b.s || b.f - a.f);
      const cols = []; let group = [], end = -1;
      const flush = () => { const n = Math.max(1, ...group.map((g) => g.c + 1)); group.forEach((g) => { g.n = n; }); group = []; };
      t.forEach((x) => { if (x.s >= end) { flush(); cols.length = 0; } let c = cols.findIndex((f) => f <= x.s); if (c < 0) { c = cols.length; cols.push(0); } cols[c] = x.f; x.c = c; group.push(x); end = Math.max(end, x.f); });
      flush();
      return t.map((x) => `<div role="button" tabindex="0" class="cal-tev cal-k-todo${x.e.done ? ' done' : ''}${cs.pick[x.e.key] ? ' picked' : ''} mov" data-ev="${esc(x.e.key)}" style="top:${x.s * HOUR / 60}px;height:${Math.max(18, (x.f - x.s) * HOUR / 60 - 2)}px;left:calc(${x.c * 100 / x.n}% + 2px);width:calc(${100 / x.n}% - 4px)" title="${esc(x.e.title)}">
        <span class="cal-t">${esc(x.e.title)}</span><span class="cal-tm">${ampm(x.e.time)} – ${ampm(hm(x.f))}</span><span class="cal-rs" data-resize="${esc(x.e.key)}" aria-hidden="true"></span></div>`).join('');
    };
    return `<div class="cal-hgrid${days.length === 1 ? ' one' : ''}" data-testid="cal-hours" style="--days:${days.length}">
      <div class="cal-hhead"><div class="cal-gut"></div>${days.map((d) => { const x = fc.days[d]; return `<div class="cal-hd${d === today ? ' today' : ''}"><button type="button" class="cal-daylink" data-dayview="${d}">${DOW[dowOf(d)]} <b>${+d.slice(8)}</b></button>${K.isHoliday(d) ? `<span class="cal-hol">${esc(K.isHoliday(d))}</span>` : ''}${cs.cash && x ? `<span class="cal-bal${x.balance < 0 ? ' neg' : ''}${x.low ? ' lowtxt' : ''}">${esc(U.fmt(x.balance))}</span>` : ''}</div>`; }).join('')}</div>
      <div class="cal-allday"><div class="cal-gut small muted">all day</div>${days.map((d) => `<div class="cal-adcell${d === cs.sel ? ' sel' : ''}" data-day="${d}">${(byDay[d] || []).filter((e) => !e.time).map((e) => chip(e)).join('')}</div>`).join('')}</div>
      <div class="cal-scroll"><div class="cal-hbody" style="height:${24 * HOUR}px">
        <div class="cal-gut">${Array.from({ length: 24 }, (_, h) => `<span class="cal-hr" style="top:${h * HOUR}px">${h ? ampm(hm(h * 60)) : ''}</span>`).join('')}</div>
        ${days.map((d) => `<div class="cal-col${d === today ? ' today' : ''}" data-col="${d}">${d === today ? `<div class="cal-now" style="top:${nowMin * HOUR / 60}px" aria-hidden="true"></div>` : ''}${col(d)}</div>`).join('')}
      </div></div></div>`;
  }
  function agenda(byDay, fc, today) {
    const days = Object.keys(byDay).sort();
    if (!days.length) return UI.empty('Nothing in the next 60 days. Click + Create to add a to-do.');
    return `<div class="cal-agenda" data-testid="cal-agenda">${days.map((d) => { const x = fc.days[d]; return `<section class="cal-ag-day" data-day="${d}"><h3><button type="button" class="cal-daylink" data-dayview="${d}">${esc(DOW[dowOf(d)] + ' ' + U.fmtDate(d))}</button>${d === today ? ' <span class="badge">Today</span>' : ''}${cs.cash && x ? `<span class="cal-bal${x.balance < 0 ? ' neg' : ''}">Balance ${esc(U.fmt(x.balance, { symbol: true }))}</span>` : ''}</h3>
      ${byDay[d].map((e) => chip(e)).join('')}</section>`; }).join('')}</div>`;
  }

  /* ---------- popovers: event details, quick add, full editor, "+N more" ---------- */
  function popHtml(b, p) {
    const today = U.today();
    if (p.type === 'more') return `<div class="cal-pophead"><b>${esc(DOW[dowOf(p.day)] + ' ' + U.fmtDate(p.day))}</b><button class="cal-x" data-close aria-label="Close">×</button></div>${EV.filter((e) => e.date === p.day).map((e) => chip(e)).join('')}`;
    if (p.type === 'quick') return `<form class="cal-quick" id="cal-quick" data-testid="cal-quick"><input name="title" placeholder="Add a to-do" aria-label="To-do" autocomplete="off" required>
      <div class="cal-qrow"><span class="muted small">${esc(DOW[dowOf(p.date)] + ' ' + U.fmtDate(p.date))}${p.time ? ' · ' + ampm(p.time) + (p.dur ? ' – ' + ampm(hm(mins(p.time) + p.dur)) : '') : ''}</span>
      <select name="remind" aria-label="Reminder">${REMIND.map(([k, l]) => `<option value="${k}"${k === (p.time ? '10' : '') ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="cal-qrow"><button type="button" class="btn small ghost" data-more-opts>More options</button><span><button type="button" class="btn small ghost" data-close>Cancel</button> <button class="btn small primary" type="submit">Save</button></span></div></form>`;
    if (p.type === 'edit') {
      const t = p.todo, allday = !t.time;
      return `<form class="cal-edit" id="cal-edit" data-testid="cal-todo-form"><div class="cal-pophead"><b>${t.id ? 'Edit to-do' : 'New to-do'}</b><button type="button" class="cal-x" data-close aria-label="Close">×</button></div>
        <label class="field"><span>Title</span><input name="title" value="${esc(t.title || '')}" placeholder="Call client about missing receipts" required></label>
        <div class="cal-erow"><label class="field"><span>Date</span><input type="date" name="date" value="${esc(t.date)}"></label>
          <label class="cal-chk"><input type="checkbox" name="allday"${allday ? ' checked' : ''}> All day</label></div>
        <div class="cal-erow cal-times"${allday ? ' hidden' : ''}><label class="field"><span>Start</span><input type="time" name="time" value="${esc(t.time || '09:00')}" step="900"></label><label class="field"><span>End</span><input type="time" name="end" value="${esc(hm(mins(t.time || '09:00') + (t.dur || 60)))}" step="900"></label></div>
        <div class="cal-erow"><label class="field"><span>Repeat</span><select name="repeat">${REPEAT.map(([k, l]) => `<option value="${k}"${(t.repeat || '') === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
          <label class="field"><span>Reminder</span><select name="remind">${REMIND.map(([k, l]) => `<option value="${k}"${String(t.remind === null || t.remind === undefined ? '' : t.remind) === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label></div>
        <label class="field"><span>Note</span><textarea name="note" rows="2">${esc(t.note || '')}</textarea></label>
        ${p.occ && t.repeat ? '<p class="muted small">Changes apply to every repeat. To move only this one, drag it.</p>' : ''}
        <div class="form-actions">${t.id ? `<button type="button" class="btn small danger" data-del-todo>Delete</button>` : ''}<span class="grow"></span><button type="button" class="btn small ghost" data-close>Cancel</button><button class="btn small primary" type="submit">Save</button></div></form>`;
    }
    const e = evBy(p.key); if (!e) return '';
    const acts = [];
    if (e.kind === 'bill') acts.push(`<a class="btn small primary" href="#/txn/new?type=billPayment&contact=${esc(e.contactId || '')}&date=${esc(e.date < today ? today : e.date)}" data-testid="cal-pay">Pay</a>`);
    if (e.kind === 'invoice') acts.push(`<button class="btn small" data-remind="${esc(e.txnId)}" data-testid="cal-remind">Reminder</button>`);
    if (e.kind === 'recurring' && e.next && e.due) acts.push(`<button class="btn small primary" data-post="${esc(e.recurringId)}" data-testid="cal-post">Post now</button>`);
    if (e.kind === 'todo') acts.push(`<button class="btn small" data-edit="${esc(e.key)}">Edit</button>`, `<button class="btn small ghost" data-del="${esc(e.key)}">Delete</button>`);
    if (e.href) acts.push(`<a class="btn small ghost" href="${esc(e.href)}">Open</a>`);
    return `<div class="cal-pophead"><span class="cal-dot cal-k-${e.kind}" aria-hidden="true"></span><b>${esc(e.title)}</b><button class="cal-x" data-close aria-label="Close">×</button></div>
      <div class="cal-popbody"><div>${esc(DOW[dowOf(e.date)] + ', ' + U.fmtDate(e.date))}${e.time ? ' · ' + ampm(e.time) + ' – ' + ampm(hm(mins(e.time) + (e.dur || 60))) : ''}${e.repeat ? ' · ' + esc((REPEAT.find((x) => x[0] === e.repeat) || ['', ''])[1].toLowerCase()) : ''}</div>
        ${e.amount ? `<div>${e.amount < 0 ? 'Money out' : 'Money in'} <b>${esc(money(e.amount))}</b></div>` : ''}
        ${e.kind === 'bill' || e.kind === 'invoice' ? `<div class="small ${e.overdue ? 'neg' : 'muted'}">Due ${esc(U.fmtDate(e.due))}${e.overdue ? ' · overdue' : ''}${e.planned ? ' · ' + (e.kind === 'bill' ? 'planned pay date' : 'expected date') + ` <button class="btn small ghost" data-reset="${esc(e.key)}">Back to the due date</button>` : ''}</div>` : ''}
        ${e.remind !== null && e.remind !== undefined && e.kind === 'todo' ? `<div class="small muted">Reminder ${esc((REMIND.find((x) => x[0] === String(e.remind)) || ['', e.remind + ' minutes before'])[1].toLowerCase())}</div>` : ''}
        ${e.note ? `<div class="small muted">${esc(e.note)}</div>` : ''}
        ${!e.movable ? `<div class="small muted">${esc(LOCK[e.kind] || '')}</div>` : ''}
        ${['tax', 'todo', 'payroll'].includes(e.kind) ? `<label class="cal-chk"><input type="checkbox" data-done="${esc(e.key)}"${e.done ? ' checked' : ''}> ${e.kind === 'tax' ? 'Filed / paid' : 'Done'}</label>` : ''}</div>
      <div class="cal-acts">${acts.join('')}</div>`;
  }
  function openPop(el, b, p) {
    const host = el.querySelector('#cal-pop'), shell = el.querySelector('#cal-shell'); if (!host || !shell) return;
    const html = popHtml(b, p); if (!html) { cs.pop = null; host.innerHTML = ''; return; }
    host.innerHTML = `<div class="cal-popover ${p.type === 'edit' ? 'wide' : ''}" role="dialog" aria-label="Details" data-testid="cal-pop" data-overlay>${html}</div>`;
    const box = host.firstChild, sr = shell.getBoundingClientRect();
    const anchor = p.key ? shell.querySelector(`[data-ev="${CSS.escape(p.key)}"]`) : p.slot ? shell.querySelector(p.slot) : (p.day || p.date) ? shell.querySelector(`[data-day="${p.day || p.date}"], [data-col="${p.day || p.date}"]`) : null;
    const ar = anchor ? anchor.getBoundingClientRect() : { left: sr.left + 40, right: sr.left + 40, top: sr.top + 40, bottom: sr.top + 60 };
    const w = box.offsetWidth, h = box.offsetHeight;
    let x = ar.right + 8 - sr.left; if (x + w > sr.width - 4) x = ar.left - w - 8 - sr.left; if (x < 4) x = Math.max(4, Math.min(sr.width - w - 4, ar.left - sr.left));
    let y = (p.y !== undefined ? p.y : ar.top - sr.top); if (y + h > shell.scrollHeight - 4) y = Math.max(4, shell.scrollHeight - h - 4);
    box.style.left = x + 'px'; box.style.top = Math.max(4, y) + 'px';
    bindPop(el, b, box, p);
    const f = box.querySelector('input[name=title]'); if (f) setTimeout(() => f.focus(), 0);
  }
  const closePop = (el) => { cs.pop = null; const h = el.querySelector('#cal-pop'); if (h) h.innerHTML = ''; };
  function todoOf(b, key) { const p = key.split('|'), t = K.settings(b).todos.find((x) => x.id === p[1]); return t ? U.clone(t) : null; }
  function bindPop(el, b, box, p) {
    const re = () => UI.render();
    box.querySelectorAll('[data-close]').forEach((x) => x.addEventListener('click', () => closePop(el)));
    box.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePop(el); } });
    const q = box.querySelector('#cal-quick');
    if (q) {
      q.addEventListener('submit', (e) => { e.preventDefault(); const t = q.elements.title.value.trim(); if (!t) return;
        K.saveTodo(b, { title: t, date: p.date, time: p.time || '', dur: p.dur || 60, remind: q.elements.remind.value === '' ? null : +q.elements.remind.value })
          .then(() => { cs.pop = null; cs.sel = p.date; snack('To-do added.'); re(); }, UI.error); });
      q.querySelector('[data-more-opts]').addEventListener('click', () => { cs.pop = { type: 'edit', date: p.date, todo: { title: q.elements.title.value, date: p.date, time: p.time || '', dur: p.dur || 60, remind: q.elements.remind.value === '' ? null : +q.elements.remind.value } }; openPop(el, b, cs.pop); });
    }
    const ed = box.querySelector('#cal-edit');
    if (ed) {
      const f = ed.elements, ad = f.allday, tm = ed.querySelector('.cal-times');
      ad.addEventListener('change', () => { tm.hidden = ad.checked; });
      ed.addEventListener('submit', (e) => { e.preventDefault();
        const time = ad.checked ? '' : f.time.value, dur = ad.checked ? 60 : Math.max(15, mins(f.end.value) - mins(f.time.value) || 60);
        K.saveTodo(b, { id: p.todo.id, title: f.title.value, date: f.date.value, time, dur, repeat: f.repeat.value, note: f.note.value, remind: f.remind.value === '' ? null : +f.remind.value })
          .then((t) => { cs.pop = null; cs.sel = t.date; if (t.date < range().from || t.date > range().to) cs.cursor = t.date; snack('To-do saved.'); re(); }, UI.error); });
      const del = ed.querySelector('[data-del-todo]'); if (del) del.addEventListener('click', () => removeTodos(b, [p.key || 'todo|' + p.todo.id + '|' + p.todo.date], true));
    }
    box.querySelectorAll('[data-done]').forEach((x) => x.addEventListener('change', () => K.markMany(b, [x.dataset.done], x.checked).then((tok) => { snack(x.checked ? 'Marked done.' : 'Not done.', tok); re(); }, UI.error)));
    box.querySelectorAll('[data-edit]').forEach((x) => x.addEventListener('click', () => { const t = todoOf(b, x.dataset.edit); if (t) { cs.pop = { type: 'edit', key: x.dataset.edit, occ: true, todo: t }; openPop(el, b, cs.pop); } }));
    box.querySelectorAll('[data-del]').forEach((x) => x.addEventListener('click', () => removeTodos(b, [x.dataset.del])));
    box.querySelectorAll('[data-reset]').forEach((x) => x.addEventListener('click', () => { const k = x.dataset.reset, id = k.split('|')[1], c = U.clone(K.settings(b)); delete (k.startsWith('bill|') ? c.payOn : c.expectOn)[id]; b.saveCompany({ calendar: c }).then(() => { cs.pop = null; re(); }, UI.error); }));
    box.querySelectorAll('[data-post]').forEach((x) => x.addEventListener('click', () => UI.busy(x, () => b.postRecurring(x.dataset.post).then(() => { cs.pop = null; snack('Posted.'); re(); }, UI.error))));
    box.querySelectorAll('[data-remind]').forEach((x) => x.addEventListener('click', () => reminder(b, x.dataset.remind)));
    box.querySelectorAll('.cal-ev').forEach((c) => c.addEventListener('click', (e) => { e.stopPropagation(); cs.pop = { type: 'event', key: c.dataset.ev }; openPop(el, b, cs.pop); }));
  }
  function removeTodos(b, keys, all) {
    const todos = keys.filter((k) => k.startsWith('todo|')); if (!todos.length) { UI.toast('Only to-dos can be deleted here.', 'warn'); return; }
    const rep = todos.some((k) => { const t = todoOf(b, k); return t && t.repeat; });
    const ask = rep && all === undefined ? UI.modal({ title: 'Delete a repeating to-do', html: '<p>Delete only this one, or the to-do and all its repeats?</p>', actions: [{ label: 'Cancel', value: null }, { label: 'All repeats', value: 'all', danger: true }, { label: 'Only this one', value: 'one', primary: true }] }) : Promise.resolve(all ? 'all' : 'one');
    ask.then((v) => { if (!v) return; return K.removeMany(b, todos, v === 'all').then((tok) => { cs.pop = null; todos.forEach((k) => delete cs.pick[k]); snack(`Deleted ${todos.length} to-do${todos.length === 1 ? '' : 's'}.`, tok); UI.render(); }, UI.error); });
  }
  function reminder(b, id) {
    const t = b.txById[id], c = t && b.contactById[t.contactId]; if (!t) return;
    const text = `Hello${c ? ' ' + c.name : ''},\n\nThis is a friendly reminder that invoice ${t.number || ''} dated ${U.fmtDate(t.date)} for ${U.fmt(b.openBalance(t), { symbol: true })} is due on ${U.fmtDate(t.dueDate || t.date)}. Please let us know when we can expect payment.\n\nThank you,\n${b.company.name}`;
    const mail = c && c.email ? `<a class="btn primary" href="mailto:${esc(c.email)}?subject=${encodeURIComponent('Invoice ' + (t.number || '') + ' reminder')}&body=${encodeURIComponent(text)}">Open in your email</a>` : '';
    UI.modal({ title: 'Payment reminder', html: `<textarea class="cal-rem-text" rows="9" aria-label="Reminder text">${esc(text)}</textarea>${mail ? `<p class="form-actions">${mail}</p>` : '<p class="muted small">Add an email address to the customer to open it in your email.</p>'}`, actions: [{ label: 'Copy text', value: 'copy', primary: !mail }, { label: 'Close', value: false }] })
      .then((v) => { if (v === 'copy' && navigator.clipboard) navigator.clipboard.writeText(text).then(() => UI.toast('Reminder copied.'), () => UI.toast('Could not copy.', 'warn')); });
  }
  let snackT = null;
  function snack(msg, tok) {
    if (tok) cs.undo = tok;
    const s = document.getElementById('cal-snack'); if (!s) return;
    s.innerHTML = `<span>${esc(msg)}</span>${tok ? '<button class="btn small" id="cal-undo" data-testid="cal-undo">Undo</button>' : ''}`; s.classList.add('on');
    const u = s.querySelector('#cal-undo'); if (u) u.addEventListener('click', doUndo);
    clearTimeout(snackT); snackT = setTimeout(() => { s.classList.remove('on'); }, 8000);
  }
  function doUndo() {
    const tok = cs && cs.undo; if (!tok) return; cs.undo = null;
    K.undo(UI.book, tok).then(() => { UI.render(); setTimeout(() => snack('Undone.'), 0); }, UI.error);
  }

  /* ---------- dragging: one pointer system for chips, timed blocks, resizing and drawing a new block ---------- */
  function hit(x, y) {
    const n = document.elementFromPoint(x, y); if (!n) return null;
    const col = n.closest('[data-col]');
    if (col) { const r = col.getBoundingClientRect(); return { date: col.dataset.col, min: Math.max(0, Math.min(1440 - SNAP, Math.floor((y - r.top) / HOUR * 60 / SNAP) * SNAP)) };   /* the slot under the pointer */ }
    const day = n.closest('[data-day]'); return day ? { date: day.dataset.day, allday: true } : null;
  }
  function bindDrag(el, b) {
    const shell = el.querySelector('#cal-shell');
    let st = null;
    const ghost = (txt) => { const g = document.createElement('div'); g.className = 'cal-ghost'; g.textContent = txt; document.body.appendChild(g); return g; };
    shell.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const rs = e.target.closest('[data-resize]'), ch = e.target.closest('[data-ev]'), col = !ch && e.target.closest('[data-col]');
      if (rs) { e.preventDefault(); e.stopPropagation(); const ev = evBy(rs.dataset.resize); st = { mode: 'resize', ev, x0: e.clientX, y0: e.clientY, block: rs.closest('.cal-tev') }; return; }
      if (ch && !e.target.closest('.cal-popover')) { st = { mode: 'press', key: ch.dataset.ev, x0: e.clientX, y0: e.clientY, el: ch, add: e.ctrlKey || e.metaKey || e.shiftKey, grab: ch.classList.contains('cal-tev') ? Math.floor((e.clientY - ch.getBoundingClientRect().top) / HOUR * 60 / SNAP) * SNAP : 0 }; return; }
      if (col && !e.target.closest('.cal-popover')) { const h = hit(e.clientX, e.clientY); if (h) { e.preventDefault(); st = { mode: 'draw', date: h.date, a: h.min, b: h.min + 60, y0: e.clientY, col }; } }
    });
    const move = (e) => {
      if (!st) return;
      const dx = e.clientX - st.x0, dy = e.clientY - (st.y0 || 0);
      if (st.mode === 'press' && Math.hypot(dx, dy) > 5) {
        const ev = evBy(st.key);
        if (!ev.movable) { st = { mode: 'locked' }; UI.toast(LOCK[ev.kind] || 'This date cannot be moved.', 'warn'); return; }
        const set = cs.pick[st.key] ? picked().filter((x) => x.movable) : [ev];
        st = { mode: 'drag', ev, set, g: ghost(set.length > 1 ? `Move ${set.length} items` : ev.title), from: ev.date, x0: st.x0, y0: st.y0, grab: st.grab };
        document.body.classList.add('cal-dragging');
      }
      if (st.mode === 'drag') {
        st.g.style.left = e.clientX + 12 + 'px'; st.g.style.top = e.clientY + 8 + 'px';
        shell.querySelectorAll('.drop').forEach((n) => n.classList.remove('drop'));
        st.h = hit(e.clientX, e.clientY); if (st.h && !st.h.allday) st.h.min = Math.max(0, st.h.min - (st.grab || 0));
        if (st.h) { const n = st.h.allday ? shell.querySelector(`[data-day="${st.h.date}"]`) : shell.querySelector(`[data-col="${st.h.date}"]`); if (n) n.classList.add('drop'); st.g.textContent = (st.set.length > 1 ? `Move ${st.set.length} items` : st.ev.title) + ' → ' + U.fmtDate(st.h.date) + (st.h.allday ? '' : ' ' + ampm(hm(st.h.min))); }
      }
      if (st.mode === 'resize' && st.block) { const h = Math.max(HOUR / 4, (st.ev.dur || 60) * HOUR / 60 + dy); st.block.style.height = h + 'px'; st.dur = Math.max(SNAP, Math.round(h / HOUR * 60 / SNAP) * SNAP); }
      if (st.mode === 'draw') {
        const h = hit(e.clientX, e.clientY); if (!h || h.date !== st.date) return;
        st.b = Math.max(st.a + SNAP, h.min + SNAP); st.moved = true;
        let box = st.col.querySelector('.cal-drawn'); if (!box) { box = document.createElement('div'); box.className = 'cal-drawn'; st.col.appendChild(box); }
        box.style.top = st.a * HOUR / 60 + 'px'; box.style.height = (st.b - st.a) * HOUR / 60 + 'px'; box.textContent = ampm(hm(st.a)) + ' – ' + ampm(hm(st.b));
      }
    };
    const up = (e) => {
      if (!st) return; const s = st; st = null; document.body.classList.remove('cal-dragging');
      if (s.g) s.g.remove(); shell.querySelectorAll('.drop').forEach((n) => n.classList.remove('drop'));
      if (s.mode === 'press') {   // a click
        if (s.add) { if (cs.pick[s.key]) delete cs.pick[s.key]; else cs.pick[s.key] = 1; cs.pop = null; UI.render(); return; }
        cs.pick = {}; cs.pop = { type: 'event', key: s.key }; const ev = evBy(s.key); if (ev) cs.sel = ev.date; UI.render(); return;
      }
      if (s.mode === 'drag' && s.h) {
        const shift = daysBetween(s.from, s.h.date), moves = s.set.map((x) => {
          const mv = { key: x.key, date: U.addDays(x.date, shift) };
          if (x.kind === 'todo' && x === s.ev) { if (s.h.allday) mv.time = ''; else { mv.time = hm(s.h.min); mv.date = s.h.date; } }
          else if (x.kind === 'todo' && !s.h.allday && x.time && s.ev.time) mv.time = hm(mins(x.time) + (s.h.min - mins(s.ev.time)));
          return mv;
        }).filter((m) => m.date !== evBy(m.key).date || (m.time !== undefined && m.time !== (evBy(m.key).time || '')));
        if (!moves.length) return;
        K.move(b, moves, EV).then((tok) => {
          const n = moves.length, ev = s.ev, msg = n > 1 ? `Moved ${n} items.` : ev.kind === 'bill' ? 'Planned to pay on ' + U.fmtDate(moves[0].date) + '; the due date stays.' : ev.kind === 'invoice' ? 'Expected on ' + U.fmtDate(moves[0].date) + '; the due date stays.' : 'Moved to ' + U.fmtDate(moves[0].date) + (moves[0].time ? ' ' + ampm(moves[0].time) : '') + '.';
          cs.sel = s.h.date; cs.pop = null; UI.render(); setTimeout(() => snack(msg + (tok.skipped.length ? ' ' + tok.skipped.length + ' could not move.' : ''), tok), 0);
        }, UI.error);
      }
      if (s.mode === 'resize' && s.dur && s.dur !== s.ev.dur) K.move(b, [{ key: s.ev.key, date: s.ev.date, dur: s.dur }], EV).then((tok) => { UI.render(); setTimeout(() => snack('Now ' + ampm(s.ev.time) + ' – ' + ampm(hm(mins(s.ev.time) + s.dur)) + '.', tok), 0); }, UI.error);
      if (s.mode === 'draw') {
        const sc = el.querySelector('.cal-scroll'); if (sc) cs.scroll = sc.scrollTop;
        const y = s.a * HOUR / 60 - (sc ? sc.scrollTop : 0) + (sc ? sc.offsetTop : 0);
        cs.pop = { type: 'quick', date: s.date, time: hm(s.a), dur: s.moved ? s.b - s.a : 60, day: s.date, y }; cs.sel = s.date; UI.render();
      }
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }

  function bind(el, b, fc, rg) {
    const re = () => UI.render(), on = (s, ev, f) => { const x = el.querySelector(s); if (x) x.addEventListener(ev, f); };
    if (window.__calUnbind) window.__calUnbind();
    const move = (n) => { const v = cs.view; cs.cursor = v === 'month' ? U.addMonths(first(cs.cursor), n) : U.addDays(cs.cursor, n * (v === 'week' ? 7 : v === 'day' ? 1 : 60)); cs.sel = v === 'month' ? (cs.cursor.slice(0, 7) === U.today().slice(0, 7) ? U.today() : cs.cursor) : cs.cursor; cs.pop = null; re(); };
    const setView = (v) => { cs.view = v; cs.cursor = v === 'agenda' ? U.today() : cs.sel; cs.pop = null; re(); };
    el.querySelectorAll('[data-view]').forEach((x) => x.addEventListener('click', () => setView(x.dataset.view)));
    on('#cal-prev', 'click', () => move(-1)); on('#cal-next', 'click', () => move(1));
    on('#cal-today', 'click', () => { cs.cursor = cs.sel = U.today(); cs.pop = null; re(); });
    el.querySelectorAll('[data-kind]').forEach((x) => x.addEventListener('change', () => { if (x.checked) delete cs.off[x.dataset.kind]; else cs.off[x.dataset.kind] = 1; re(); }));
    on('#cal-cash', 'change', (e) => { cs.cash = e.target.checked; re(); });
    el.querySelectorAll('[data-goto]').forEach((x) => x.addEventListener('click', () => { cs.sel = cs.cursor = x.dataset.goto; re(); }));
    el.querySelectorAll('[data-dayview]').forEach((x) => x.addEventListener('click', (e) => { e.stopPropagation(); cs.sel = cs.cursor = x.dataset.dayview; cs.view = 'day'; cs.pop = null; re(); }));
    el.querySelectorAll('[data-more]').forEach((x) => x.addEventListener('click', (e) => { e.stopPropagation(); cs.pop = { type: 'more', day: x.dataset.more }; openPop(el, b, cs.pop); }));
    // click an empty spot of a day (month cell, all-day row, agenda day) to add a to-do there
    el.querySelectorAll('[data-day]').forEach((c) => {
      c.addEventListener('click', (e) => { if (e.target.closest('.cal-ev, button, a, input')) return; cs.sel = c.dataset.day; cs.pick = {}; cs.pop = { type: 'quick', date: c.dataset.day, day: c.dataset.day }; re(); });
      c.addEventListener('keydown', (e) => {
        const k = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
        if (k && cs.view === 'month') { e.preventDefault(); cs.sel = U.addDays(cs.sel, k); if (cs.sel < rg.from || cs.sel > rg.to) cs.cursor = cs.sel; re(); setTimeout(() => { const n = document.querySelector(`[data-day="${cs.sel}"]`); if (n) n.focus(); }, 0); }
        else if (e.key === 'Enter' && e.target === c) { cs.pop = { type: 'quick', date: c.dataset.day, day: c.dataset.day }; re(); }
      });
    });
    el.querySelectorAll('.cal-ev, .cal-tev').forEach((x) => x.addEventListener('keydown', (k) => { if (k.key === 'Enter' || k.key === ' ') { k.preventDefault(); k.stopPropagation(); if (k.ctrlKey || k.shiftKey || k.metaKey) { if (cs.pick[x.dataset.ev]) delete cs.pick[x.dataset.ev]; else cs.pick[x.dataset.ev] = 1; } else cs.pop = { type: 'event', key: x.dataset.ev }; re(); } }));
    const unDrag = bindDrag(el, b);
    const sc = el.querySelector('.cal-scroll'); if (sc) sc.addEventListener('scroll', () => { cs.scroll = sc.scrollTop; });
    on('#cal-new', 'click', () => { cs.pop = { type: 'edit', date: cs.sel, todo: { title: '', date: cs.sel, time: '', dur: 60, remind: null } }; openPop(el, b, cs.pop); });
    on('#cal-sel-clear', 'click', () => { cs.pick = {}; re(); });
    on('#cal-sel-done', 'click', () => { const ks = picked().filter((e) => ['tax', 'todo', 'payroll'].includes(e.kind)).map((e) => e.key); if (!ks.length) { UI.toast('Only deadlines, payroll and to-dos can be marked done.', 'warn'); return; } K.markMany(b, ks, true).then((tok) => { cs.pick = {}; re(); setTimeout(() => snack(`Marked ${ks.length} done.`, tok), 0); }, UI.error); });
    on('#cal-sel-del', 'click', () => removeTodos(b, Object.keys(cs.pick)));
    on('#cal-ics', 'click', () => {
      const from = U.addDays(U.today(), -31), to = U.addMonths(U.today(), 13), evs = K.events(b, { from, to }).filter((e) => !cs.off[e.kind]);
      U.download(U.safeFileName(b.company.name + ' calendar') + '.ics', K.ics(b, evs), 'text/calendar');
      UI.toast(`${evs.length} dates from ${U.fmtDate(from)} to ${U.fmtDate(to)} saved. Open the file to add them to Outlook, Google or Apple Calendar.`);
    });
    on('#cal-set', 'click', () => { cs.settings = !cs.settings; re(); });
    on('#cal-notify', 'click', () => Notification.requestPermission().then(() => re()));
    on('#cal-set-save', 'click', () => {
      let low = 0; try { low = U.toCents(el.querySelector('#cal-low-amt').value || 0); } catch (e) { UI.toast('Enter an amount.', 'warn'); return; }
      const st = {}; el.querySelectorAll('[data-stf]').forEach((x) => { const a = x.dataset.stf, d = el.querySelector(`[data-std="${CSS.escape(a)}"]`); st[a] = { freq: x.value, day: Math.max(1, Math.min(31, Math.round(+d.value || 20))) }; });
      const pr = el.querySelector('#cal-pr').value;
      K.saveSettings(b, { low, salesTax: st, payroll: pr === 'on' ? true : pr === 'off' ? false : null, remind: el.querySelector('#cal-rem').value !== 'off' }).then(() => { cs.settings = false; UI.toast('Calendar settings saved.'); re(); }, UI.error);
    });
    // keyboard shortcuts (not while typing)
    const keys = (e) => {
      if (!document.getElementById('cal-shell')) { window.removeEventListener('keydown', keys, true); return; }
      const typing = e.target.closest && e.target.closest('input, textarea, select, [contenteditable]');
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing && cs.undo) { e.preventDefault(); e.stopImmediatePropagation(); doUndo(); return; }
      if (typing || e.ctrlKey || e.metaKey || e.altKey || document.querySelector('.modal')) return;
      if (e.key === 'Escape') { if (cs.pop || Object.keys(cs.pick).length) { e.preventDefault(); e.stopImmediatePropagation(); if (cs.pop) closePop(el); else { cs.pick = {}; re(); } } return; }   // otherwise Esc goes Back as everywhere
      if ((e.key === 'Delete' || e.key === 'Backspace') && Object.keys(cs.pick).length) { e.preventDefault(); removeTodos(b, Object.keys(cs.pick)); return; }
      const k = e.key.toLowerCase();
      if (k === 'c' || k === 'n') { e.preventDefault(); el.querySelector('#cal-new').click(); }
      else if (k === 't') { e.preventDefault(); el.querySelector('#cal-today').click(); }
      else if ({ d: 'day', w: 'week', m: 'month', a: 'agenda' }[k]) { e.preventDefault(); setView({ d: 'day', w: 'week', m: 'month', a: 'agenda' }[k]); }
      else if (k === 'j' || e.key === 'PageDown') { e.preventDefault(); move(1); } else if (k === 'k' || e.key === 'PageUp') { e.preventDefault(); move(-1); }
    };
    window.addEventListener('keydown', keys, true);   // before the app's own keys (Esc = Back)
    // a click outside an open popover closes it
    const out = (e) => { if (!document.getElementById('cal-shell')) { document.removeEventListener('pointerdown', out, true); return; } if (cs.pop && !e.target.closest('.cal-popover, .modal, [data-ev], [data-day], [data-col], [data-more], #cal-new')) closePop(el); };
    document.addEventListener('pointerdown', out, true);
    window.__calUnbind = () => { window.removeEventListener('keydown', keys, true); document.removeEventListener('pointerdown', out, true); unDrag(); window.__calUnbind = null; };
  }

  function settingsHtml(b, s) {
    const ag = [...new Set((b.company.salesTaxes || []).filter((t) => t.active !== false).map((t) => t.agency || t.name).filter(Boolean))];
    const form = b.company.taxForm || '';
    return `<section class="card cal-settings" data-testid="cal-settings"><h2>Calendar settings</h2>
      <div class="form-grid cols3">
        <label class="field"><span>Warn when the bank balance falls below</span><input id="cal-low-amt" inputmode="decimal" value="${(s.low / 100).toFixed(2)}"></label>
        <label class="field"><span>Payroll deadlines (941, 940, W-2)</span><select id="cal-pr"><option value="">From the payroll in VaultBook</option><option value="on"${s.payroll === true ? ' selected' : ''}>Always show</option><option value="off"${s.payroll === false ? ' selected' : ''}>Never show</option></select></label>
        <label class="field"><span>Reminders while VaultBook is open</span><select id="cal-rem"><option value="on">On</option><option value="off"${s.remind === false ? ' selected' : ''}>Off</option></select></label>
      </div>
      <p class="muted small">Income tax deadlines follow the return chosen in <a href="#/taxlines">Tax lines</a>${form ? ` (now ${esc(form === '1040C' ? 'Form 1040, Schedule C' : 'Form ' + form.replace('1120S', '1120-S'))})` : ' (none chosen yet)'} and the fiscal year. Due dates on a weekend or legal holiday move to the next business day. Check state deadlines with your state.</p>
      ${ag.length ? `<h3>Sales tax returns</h3><table class="data compact"><thead><tr><th>Agency</th><th>Files</th><th>Due day of the next month</th></tr></thead><tbody>${ag.map((a) => { const x = s.salesTax[a] || {}; return `<tr><td>${esc(a)}</td><td><select data-stf="${esc(a)}">${[['monthly', 'Monthly'], ['quarterly', 'Quarterly'], ['yearly', 'Yearly']].map(([k, l]) => `<option value="${k}"${(x.freq || 'quarterly') === k ? ' selected' : ''}>${l}</option>`).join('')}</select></td><td><input data-std="${esc(a)}" class="num" inputmode="numeric" value="${x.day || 20}" aria-label="Due day for ${esc(a)}"></td></tr>`; }).join('')}</tbody></table>` : ''}
      <div class="form-actions"><button class="btn primary small" id="cal-set-save">Save settings</button>${'Notification' in window && Notification.permission !== 'granted' ? '<button class="btn small" id="cal-notify">Also show reminders as desktop notifications</button>' : ''}</div></section>`;
  }

  // reminders while VaultBook is open: a to-do's own reminder at its time; and once a session what is due today,
  // tomorrow or overdue
  const told = {};
  function remind(again) {
    const b = UI.book; if (!b || !b.company || K.settings(b).remind === false) return;
    const t = U.today(), now = new Date(), ev = K.events(b, { from: U.addDays(t, -60), to: U.addDays(t, 8), today: t });
    // a reminder whose time has come, for a to-do that has not started more than 5 minutes ago, once a session
    K.dueReminders(ev, new Date(now.getTime() - 86400000), now).filter((e) => { const k = 'r' + b.company.id + e.key, h = (e.time || '09:00').split(':'), start = new Date(+e.date.slice(0, 4), +e.date.slice(5, 7) - 1, +e.date.slice(8, 10), +h[0], +h[1]).getTime(); if (told[k] || start < now.getTime() - 300000) return false; told[k] = 1; return true; }).forEach((e) => {
      const msg = e.title + (e.time ? ' at ' + ampm(e.time) : '') + (e.date !== t ? ' on ' + U.fmtDate(e.date) : '');
      UI.toast('Reminder: ' + msg, 'warn');
      if ('Notification' in window && Notification.permission === 'granted') try { new Notification(b.company.name, { body: msg }); } catch (er) { /* not available here */ }
    });
    const tm = U.addDays(t, 1), due = ev.filter((e) => !e.done && (e.date === t || e.date === tm || (e.overdue && e.kind === 'bill')) && e.kind !== 'question' && !(e.kind === 'todo' && e.remind !== null && e.remind !== undefined));
    const fresh = due.filter((e) => again || !told[b.company.id + e.key]); if (!fresh.length) return;
    fresh.forEach((e) => { told[b.company.id + e.key] = 1; });
    const today = fresh.filter((e) => e.date <= t), msg = (today.length ? today.length + ' due today' + (today.some((e) => e.overdue) ? ' or overdue' : '') : '') + (today.length && fresh.length > today.length ? ', ' : '') + (fresh.length > today.length ? (fresh.length - today.length) + ' tomorrow' : '');
    UI.toast(`Calendar: ${msg} — ${fresh.slice(0, 3).map((e) => e.title).join('; ')}${fresh.length > 3 ? '…' : ''}`, 'warn');
    if ('Notification' in window && Notification.permission === 'granted') try { new Notification(b.company.name + ': ' + msg, { body: fresh.slice(0, 4).map((e) => e.title).join('\n') }); } catch (e) { /* not available here */ }
  }
  setTimeout(function tick() { try { remind(); } catch (e) { /* never break the app for a reminder */ } setTimeout(tick, 30000); }, 8000);
  UI.calendarRemind = remind;
})();
