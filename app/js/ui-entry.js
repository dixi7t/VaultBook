/* VaultBook — entry-window header for every transaction screen (presentation only).
 * Adds a compact voucher strip above the form: type badge, number, date with weekday, and the
 * function keys that switch to another transaction type. Shows the current balance under the
 * customer/vendor and the bank/card account as they are chosen. Reads values only; never writes
 * form fields or the books, so posting rules and unsaved-change tracking are untouched.
 */
(function () {
  'use strict';
  const UI = OB.ui, U = OB.util, S = OB.schema, esc = U.esc;
  const SWITCH = [['F4', 'transfer'], ['F5', 'expense'], ['F6', 'payment'], ['F7', 'journal'], ['F8', 'invoice'], ['F9', 'bill']];
  const weekday = (d) => { try { return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long' }); } catch (e) { return ''; } };

  function enhance() {
    const r = UI.parseHash(); if (r.name !== 'txn' || !UI.book) return;
    const form = document.querySelector('#main form#txf'); if (!form || form.dataset.vch) return;
    form.dataset.vch = '1';
    const b = UI.book, existing = r.id !== 'new' ? b.txById[r.id] : null;
    const type = existing ? existing.type : r.params.type, def = S.TXN_TYPES[type]; if (!def) return;
    const g = (n) => form.querySelector(`[name="${n}"]`);
    const strip = document.createElement('div');
    strip.className = 'vch-strip'; strip.setAttribute('data-testid', 'voucher-strip');
    strip.innerHTML = `<span class="vch-type">${esc(def.label)}</span><span class="vch-no">No. <b data-v="no"></b></span>
      ${!existing ? `<span class="vch-switch" aria-label="Switch transaction type">${SWITCH.filter((x) => x[1] !== type).map(([k, t]) => `<button type="button" class="vch-k" data-switch="${t}" title="${esc(UI.typeLabel(t))} (${k})"><kbd>${k}</kbd>${esc(UI.typeLabel(t))}</button>`).join('')}</span>` : '<span class="vch-switch"></span>'}
      <span class="vch-date"><b data-v="date"></b><span data-v="wd"></span></span>`;
    // Invoice-style forms already show type, number and date in the sheet: keep only the type switch, in the toolbar.
    const tools = form.classList.contains('qbi') && form.querySelector('.qbi-tools');
    if (tools) { strip.classList.add('vch-inline'); tools.insertBefore(strip, tools.querySelector('.qbi-more')); } else form.insertBefore(strip, form.firstChild);
    strip.addEventListener('click', (e) => { const x = e.target.closest('[data-switch]'); if (x) UI.go('#/txn/new?type=' + x.dataset.switch); });

    // current balances shown under the party and the bank/card account (as in a ledger entry window)
    const addBal = (field, fn) => {
      if (!field) return null;
      const host = field.closest('.field') || field.parentElement;
      const el = document.createElement('span'); el.className = 'cur-bal'; el.setAttribute('aria-live', 'polite');
      host.appendChild(el);
      const upd = () => { const v = fn(field.value); el.innerHTML = v === null ? '' : `Current balance: ${UI.money(v.amt)}${v.suffix ? ' ' + esc(v.suffix) : ''}`; };
      field.addEventListener('change', upd); upd(); return upd;
    };
    addBal(g('contactId'), (id) => { if (!id || !b.contactById[id]) return null; const c = b.contactById[id], v = b.contactBalance(id); return { amt: Math.abs(v), suffix: v === 0 ? '' : c.kind === 'customer' ? (v > 0 ? 'owed to you' : 'credit') : (v > 0 ? 'you owe' : 'credit') }; });
    addBal(g('accountId'), (id) => id && b.accById[id] ? { amt: b.accountBalance(id), suffix: '' } : null);
    addBal(g('toAccountId'), (id) => id && b.accById[id] ? { amt: b.accountBalance(id), suffix: '' } : null);

    const upd = () => {
      const no = g('number'), dt = g('date');
      strip.querySelector('[data-v="no"]').textContent = no ? (no.value || (no.placeholder && no.placeholder !== 'Auto' ? no.placeholder : 'Auto')) : (existing && existing.number) || '—';
      const d = dt && dt.value;
      strip.querySelector('[data-v="date"]').textContent = d ? U.fmtDate(d) : '';
      strip.querySelector('[data-v="wd"]').textContent = d ? weekday(d) : '';
    };
    form.addEventListener('input', upd); form.addEventListener('change', upd); upd();
  }
  if (UI.keys) UI.keys.hooks.push(enhance);
})();
