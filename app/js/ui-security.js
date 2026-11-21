/* global OB */
/* OfflineBooks US — company password: unlock screen, lock / auto-lock, Security settings. */
(function () {
  'use strict';
  const U = OB.util, UI = OB.ui, C = OB.sec, esc = U.esc;
  const failures = {}; // companyId -> { n, until } — slows down repeated guessing in this window

  /* ---------- unlock screen ---------- */
  UI.showUnlock = (companyId, security, message) => {
    const main = document.getElementById('main');
    document.body.classList.add('no-company');
    return OB.db.listCompanies().then((list) => {
      const entry = list.find((c) => c.id === companyId) || { name: 'Company' };
      let mode = 'password';
      main.innerHTML = `<div class="unlock-wrap"><section class="card unlock" aria-labelledby="ul-title">
        <div class="lock-mark" aria-hidden="true"><svg viewBox="0 0 24 24" width="30" height="30"><rect x="5" y="10.5" width="14" height="10" rx="2" fill="currentColor"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="2"/></svg></div>
        <h1 id="ul-title">${esc(entry.name)}</h1>
        <p class="muted">This company is password protected. Its data is encrypted on this computer.</p>
        ${message ? `<div class="banner info">${esc(message)}</div>` : ''}
        <form id="ul-form" autocomplete="off">
          <label class="field"><span id="ul-label">Company password</span><input type="password" id="ul-secret" autocomplete="current-password" required></label>
          <div id="ul-msg" class="ul-msg" role="alert"></div>
          <button class="btn primary wide" type="submit" id="ul-go">Unlock</button>
        </form>
        <div class="ul-links">
          ${security.hint ? '<button type="button" class="btn ghost small" id="ul-hint">Show hint</button>' : ''}
          <button type="button" class="btn ghost small" id="ul-mode">Forgot password? Use recovery key</button>
          <button type="button" class="btn ghost small" id="ul-back">Other companies</button>
        </div>
      </section></div>`;
      const input = main.querySelector('#ul-secret'), msg = main.querySelector('#ul-msg'), go = main.querySelector('#ul-go');
      input.focus();
      const setMode = (m) => {
        mode = m;
        main.querySelector('#ul-label').textContent = m === 'recovery' ? 'Recovery key (32 characters)' : 'Company password';
        input.type = m === 'recovery' ? 'text' : 'password';
        input.placeholder = m === 'recovery' ? 'XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX' : '';
        main.querySelector('#ul-mode').textContent = m === 'recovery' ? 'Use password instead' : 'Forgot password? Use recovery key';
        input.value = ''; msg.textContent = ''; input.focus();
      };
      main.querySelector('#ul-mode').addEventListener('click', () => setMode(mode === 'password' ? 'recovery' : 'password'));
      main.querySelector('#ul-back').addEventListener('click', () => UI.closeCompany());
      const hb = main.querySelector('#ul-hint');
      if (hb) hb.addEventListener('click', () => { msg.className = 'ul-msg hint'; msg.textContent = 'Hint: ' + security.hint; });
      main.querySelector('#ul-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const f = failures[companyId];
        if (f && f.until > Date.now()) return;
        go.disabled = true; go.textContent = 'Unlocking…'; msg.className = 'ul-msg'; msg.textContent = '';
        C.unlock(security, input.value, mode).then((dek) => {
          delete failures[companyId];
          const usedRecovery = mode === 'recovery';
          return UI.openCompany(companyId, dek).then(() => { if (usedRecovery) return UI.forceNewPassword(); });
        }).catch((err) => {
          if (err.code !== 'BAD_SECRET') { UI.error(err); go.disabled = false; go.textContent = 'Unlock'; return; }
          const st = failures[companyId] = failures[companyId] || { n: 0, until: 0 };
          st.n++;
          const wait = st.n >= 3 ? Math.min(60, Math.pow(2, st.n - 3)) : 0;
          msg.className = 'ul-msg bad';
          msg.textContent = err.message + (wait ? ` Try again in ${wait} s.` : '');
          input.select();
          if (wait) {
            st.until = Date.now() + wait * 1000;
            const tick = setInterval(() => {
              const left = Math.ceil((st.until - Date.now()) / 1000);
              if (!go.isConnected || left <= 0) { clearInterval(tick); if (go.isConnected) { go.disabled = false; go.textContent = 'Unlock'; } return; }
              go.textContent = 'Wait ' + left + ' s';
            }, 250);
          } else { go.disabled = false; go.textContent = 'Unlock'; }
        });
      });
    });
  };

  /* ---------- lock / auto-lock ---------- */
  UI.lock = (reason) => {
    const b = UI.book;
    if (!b || !b.security) return;
    const id = b.company.id, sec = b.security, mins = sec.autoLockMinutes;
    document.querySelectorAll('.modal-backdrop, .drawer-backdrop, .palette-backdrop, #toasts > *, #combo-list').forEach((x) => x.remove()); // nothing from the books stays on screen
    try { b.adapter.key = null; b.adapter.close(); } catch (e) { /* ignore */ }
    b.dek = null;
    UI.book = null; UI.dirty = false;
    history.replaceState(null, '', location.pathname + '#/');
    UI.showUnlock(id, sec, reason === 'auto' ? `Locked automatically after ${mins} minute${mins === 1 ? '' : 's'} without activity.` : 'Company locked.');
  };
  let lastActivity = Date.now();
  ['mousedown', 'keydown', 'touchstart', 'wheel'].forEach((ev) => document.addEventListener(ev, () => { lastActivity = Date.now(); }, true));
  UI.checkIdle = (now) => {
    const b = UI.book;
    if (!b || !b.security || !(b.security.autoLockMinutes > 0)) return false;
    if ((now || Date.now()) - lastActivity >= b.security.autoLockMinutes * 60000) { UI.lock('auto'); return true; }
    return false;
  };
  UI._setLastActivity = (t) => { lastActivity = t; }; // used by the automated tests
  setInterval(() => UI.checkIdle(), 15000);

  /* ---------- dialogs ---------- */
  UI.showRecoveryKey = (key, companyName, intro) => UI.modal({
    title: 'Save your recovery key', wide: true, locked: true,
    html: `${intro ? `<div class="banner ok">${intro}</div>` : ''}
      <p>If you forget the company password, this key is the <strong>only</strong> way to unlock <strong>${esc(companyName)}</strong>. Nobody — including the makers of this app — can recover the data without the password or this key.</p>
      <div class="reckey" id="rk-text">${esc(key)}</div>
      <div class="row gap"><button type="button" class="btn" id="rk-copy">Copy</button><button type="button" class="btn" id="rk-dl">Download as text file</button></div>
      <p class="muted small">Print it or write it down and keep it somewhere safe, away from this computer. Don't keep it in the same folder as your backups.</p>
      <label class="check"><input type="checkbox" id="rk-ok"> I have saved the recovery key somewhere safe</label>`,
    onMount: (m) => {
      m.querySelector('#rk-copy').addEventListener('click', () => {
        (navigator.clipboard ? navigator.clipboard.writeText(key) : Promise.reject()).then(() => UI.toast('Recovery key copied.'), () => UI.toast('Copy failed — select the key and press Ctrl+C.', 'error'));
      });
      m.querySelector('#rk-dl').addEventListener('click', () => U.download(U.safeFileName(companyName) + '_RECOVERY_KEY.txt',
        `VaultBook — recovery key\r\nCompany: ${companyName}\r\nIssued: ${new Date().toLocaleString()}\r\n\r\n${key}\r\n\r\nUse this key on the unlock screen ("Forgot password? Use recovery key") if you forget the company password.\r\nIt also opens password-protected backup files of this company. Keep it private and away from this PC.\r\n`, 'text/plain'));
    },
    actions: [{ label: 'Done', primary: true, collect: (m) => { if (m.querySelector('#rk-ok').checked) return true; UI.toast('Tick the box to confirm you saved the recovery key.', 'error'); return false; } }]
  });

  function passwordFields(prefix, opts) {
    opts = opts || {};
    return `${opts.current ? `<label class="field"><span>Current password</span><input type="password" id="${prefix}-cur" autocomplete="current-password"></label>` : ''}
      <label class="field"><span>${opts.newLabel || 'New password'}</span><input type="password" id="${prefix}-new" autocomplete="new-password">
        <span class="meter" aria-hidden="true"><i></i></span><span class="muted small" id="${prefix}-meter">At least ${C.MIN_PASSWORD} characters. A short sentence is easy to remember and hard to guess.</span></label>
      <label class="field"><span>Confirm new password</span><input type="password" id="${prefix}-conf" autocomplete="new-password"></label>`;
  }
  function bindMeter(root, prefix) {
    const inp = root.querySelector('#' + prefix + '-new'), bar = inp.parentNode.querySelector('.meter i'), txt = root.querySelector('#' + prefix + '-meter');
    inp.addEventListener('input', () => {
      const s = C.strength(inp.value), probs = C.passwordProblems(inp.value, UI.book && UI.book.company.name);
      bar.style.width = (s * 25) + '%'; bar.className = 's' + s;
      txt.textContent = inp.value ? (probs[0] || ['Weak', 'Fair', 'Good', 'Strong', 'Very strong'][s]) : `At least ${C.MIN_PASSWORD} characters. A short sentence is easy to remember and hard to guess.`;
    });
  }
  function readNew(root, prefix) {
    const pw = root.querySelector('#' + prefix + '-new').value, cf = root.querySelector('#' + prefix + '-conf').value;
    const probs = C.passwordProblems(pw, UI.book.company.name);
    if (probs.length) { UI.toast(probs.join(' '), 'error'); return null; }
    if (pw !== cf) { UI.toast("The passwords don't match.", 'error'); return null; }
    return pw;
  }

  /** After unlocking with the recovery key, a new password is required (and a new recovery key issued). */
  UI.forceNewPassword = () => UI.modal({
    title: 'Set a new password', locked: true,
    html: `<div class="banner info">You unlocked with the recovery key. Choose a new company password now. A new recovery key will be issued and the old one will stop working.</div>${passwordFields('fp')}`,
    onMount: (m) => bindMeter(m, 'fp'),
    actions: [{ label: 'Save new password', primary: true, collect: (m) => readNew(m, 'fp') || false }]
  }).then((pw) => OB.db.resetAfterRecovery(UI.book, pw)).then((rk) => UI.showRecoveryKey(rk, UI.book.company.name, 'New password saved.'))
    .catch((e) => { UI.error(e); return UI.forceNewPassword(); });

  /** Password prompt for an encrypted backup file. Resolves {inner, dek, security} or null. */
  UI.askBackupSecret = (obj) => {
    let mode = 'password';
    const ask = (err) => UI.modal({
      title: 'Password-protected backup',
      html: `<p>This backup of <strong>${esc(obj.companyName || 'a company')}</strong> is encrypted. Enter that company's password${obj.security && obj.security.hint ? ` (hint: ${esc(obj.security.hint)})` : ''}, or its recovery key.</p>
        ${err ? `<div class="banner danger">${esc(err)}</div>` : ''}
        <label class="field"><span id="bk-lab">Company password</span><input type="password" id="bk-sec"></label>
        <label class="check"><input type="checkbox" id="bk-rec"> Use the recovery key instead</label>`,
      onMount: (m) => m.querySelector('#bk-rec').addEventListener('change', (e) => { mode = e.target.checked ? 'recovery' : 'password'; m.querySelector('#bk-sec').type = e.target.checked ? 'text' : 'password'; m.querySelector('#bk-lab').textContent = e.target.checked ? 'Recovery key' : 'Company password'; }),
      actions: [{ label: 'Cancel', value: null }, { label: 'Open backup', primary: true, collect: (m) => ({ secret: m.querySelector('#bk-sec').value, mode }) }]
    }).then((v) => {
      if (!v) return null;
      return OB.backup.decrypt(obj, v.secret, v.mode).catch((e) => ask(e.message));
    });
    return ask();
  };

  /* ---------- Settings → Security ---------- */
  UI.securityTab = (el) => {
    const b = UI.book, sec = b.security;
    if (!C.available()) {
      el.innerHTML = `<div class="banner danger">This browser doesn't provide the encryption features needed for password protection. Use a current version of Chrome or Edge.</div>`;
      return;
    }
    if (!sec) {
      el.innerHTML = `<section class="card">
        <h2>Password-protect this company</h2>
        <p>When protection is on, everything for <strong>${esc(b.company.name)}</strong> is <strong>encrypted</strong> on this computer (AES-256). Opening the company needs the password, and backup files you download are encrypted too.</p>
        <ul class="sec-points">
          <li>You get a <strong>recovery key</strong> to save. If you lose both the password and the recovery key, the data cannot be recovered by anyone.</li>
          <li>The company <em>name</em> stays visible in the company list; everything inside it is encrypted.</li>
          <li>Backup files downloaded <em>before</em> turning this on are not encrypted. Download a new backup afterwards and delete the old ones.</li>
          <li>The company locks automatically after a period without activity (unsaved form entries are discarded when it locks).</li>
        </ul>
        <form id="sec-on" class="form-grid" autocomplete="off">
          <div class="span2 form-grid">${passwordFields('on')}</div>
          <label class="field"><span>Password hint (optional, visible on the unlock screen)</span><input id="on-hint" maxlength="100" placeholder="Never the password itself"></label>
          <label class="field"><span>Lock automatically after</span><select id="on-auto">${[[5, '5 minutes'], [15, '15 minutes'], [30, '30 minutes'], [60, '1 hour'], [0, 'Never']].map(([v, l]) => `<option value="${v}"${v === 15 ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
          <div class="span2"><button class="btn primary" type="submit">Turn on password protection</button></div>
        </form></section>`;
      bindMeter(el, 'on');
      el.querySelector('#sec-on').addEventListener('submit', (e) => {
        e.preventDefault();
        const pw = readNew(el, 'on'); if (!pw) return;
        const hint = el.querySelector('#on-hint').value;
        if (hint && pw.toLowerCase().indexOf(hint.toLowerCase()) >= 0 && hint.length > 3) return UI.toast("The hint mustn't contain the password.", 'error');
        UI.busy(e.target.querySelector('button[type=submit]'), () => OB.db.protect(b, pw, { hint, autoLockMinutes: +el.querySelector('#on-auto').value })
          .then((rk) => UI.showRecoveryKey(rk, b.company.name, 'Password protection is on. All company data is now encrypted.'))
          .then(() => { UI.render(); UI.toast('Protection on. Download a new (encrypted) backup and delete older unencrypted ones.'); }))
          .catch(UI.error);
      });
      return;
    }
    el.innerHTML = `<section class="card">
        <div class="card-head"><h2>Password protection is on</h2><button class="btn" id="sec-lock">Lock now</button></div>
        <dl class="facts"><dt>Encryption</dt><dd>AES-256-GCM, key derived with PBKDF2-SHA256 (${sec.password.iterations.toLocaleString()} rounds)</dd>
          <dt>Turned on</dt><dd>${esc(new Date(sec.enabledAt).toLocaleString())}</dd><dt>Password last changed</dt><dd>${esc(new Date(sec.changedAt).toLocaleString())}</dd>
          <dt>Backups</dt><dd>Encrypted with this company's key (open with the password or recovery key)</dd></dl>
      </section>
      <div class="grid2">
        <section class="card"><h2>Change password</h2><form id="sec-ch" autocomplete="off" class="stack">${passwordFields('ch', { current: true })}<button class="btn primary" type="submit">Change password</button></form></section>
        <section class="card"><h2>Options</h2><form id="sec-opt" class="stack">
          <label class="field"><span>Lock automatically after</span><select id="opt-auto">${[[5, '5 minutes'], [15, '15 minutes'], [30, '30 minutes'], [60, '1 hour'], [0, 'Never']].map(([v, l]) => `<option value="${v}"${v === sec.autoLockMinutes ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
          <label class="field"><span>Password hint</span><input id="opt-hint" maxlength="100" value="${esc(sec.hint)}"></label>
          <button class="btn" type="submit">Save options</button></form>
          <hr><h3>Recovery key</h3><p class="muted small">Lost the recovery key? Issue a new one; the old one stops working.</p><button class="btn" id="sec-rk">Issue new recovery key</button>
          <hr><h3>Turn off protection</h3><p class="muted small">Decrypts all data back to normal storage on this PC.</p><button class="btn danger" id="sec-off">Turn off password protection</button></section>
      </div>`;
    bindMeter(el, 'ch');
    el.querySelector('#sec-lock').addEventListener('click', () => UI.lock('manual'));
    el.querySelector('#sec-ch').addEventListener('submit', (e) => {
      e.preventDefault();
      const pw = readNew(el, 'ch'); if (!pw) return;
      UI.busy(e.target.querySelector('button[type=submit]'), () => OB.db.changePassword(b, el.querySelector('#ch-cur').value, pw).then(() => { UI.toast('Password changed.'); UI.render(); })).catch(UI.error);
    });
    el.querySelector('#sec-opt').addEventListener('submit', (e) => {
      e.preventDefault();
      UI.busy(e.target.querySelector('button[type=submit]'), () => OB.db.setSecurityOptions(b, { autoLockMinutes: el.querySelector('#opt-auto').value, hint: el.querySelector('#opt-hint').value }).then(() => UI.toast('Options saved.'))).catch(UI.error);
    });
    el.querySelector('#sec-rk').addEventListener('click', () => UI.prompt('Issue new recovery key', 'Company password', '', { type: 'password', ok: 'Issue new key' })
      .then((pw) => pw === null ? null : OB.db.newRecoveryKey(b, pw).then((rk) => UI.showRecoveryKey(rk, b.company.name, 'New recovery key issued. The previous one no longer works.'))).catch(UI.error));
    el.querySelector('#sec-off').addEventListener('click', () => UI.prompt('Turn off password protection', 'Company password', '', { type: 'password', ok: 'Turn off protection', danger: true, help: 'All data for this company will be stored unencrypted on this PC, and new backups will not be encrypted.' })
      .then((pw) => pw === null ? null : OB.db.unprotect(b, pw).then(() => { UI.toast('Password protection turned off.'); UI.render(); })).catch(UI.error));
  };
})();

/* ---------- Connected services (1.58.0): keys for outside services, kept by OB.secrets ---------- */
(function () {
  'use strict';
  const UI = OB.ui, esc = OB.util.esc, X = OB.secrets;
  const base = UI.securityTab;
  const KIND = { simplefin: 'Bank sync (SimpleFIN Bridge)' };
  const when = (iso) => { try { return iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'never'; } catch (e) { return iso || 'never'; } };
  function render(card) {
    const co = UI.book.company.id;
    if (!X || !X.available()) { card.innerHTML = '<h2>Connected services</h2><p class="muted">This browser cannot keep encrypted keys, so outside services cannot be connected here.</p>'; return; }
    X.list(co).then((list) => {
      card.innerHTML = `<h2>Connected services</h2>
        <p>Keys VaultBook uses to fetch data from outside services, such as automatic bank sync. Each key is <strong>encrypted on this device</strong>, is <strong>never included</strong> in backups or exports, and does not leave this device except to reach its own service.</p>
        ${list.length ? `<div class="scroll-x"><table class="data" data-testid="secrets-list"><thead><tr><th>Service</th><th>Added</th><th>Last used</th><th></th></tr></thead><tbody>${list.map((s) => `<tr>
            <td><strong>${esc(s.label)}</strong><div class="muted small">${esc(KIND[s.kind] || s.kind)}</div></td><td>${esc(when(s.createdAt))}</td><td>${esc(when(s.lastUsedAt))}</td>
            <td><button type="button" class="btn ghost small" data-rm="${esc(s.id)}" data-label="${esc(s.label)}">Remove</button></td></tr>`).join('')}</tbody></table></div>
          <p class="muted small">Removing a key stops VaultBook from using it. To cut off access completely, also revoke it at the service itself (for SimpleFIN Bridge: sign in at beta-bridge.simplefin.org and remove the app).</p>`
        : '<p class="muted" data-testid="secrets-empty">No services connected. Nothing is fetched from outside this device.</p>'}`;
      card.querySelectorAll('[data-rm]').forEach((btn) => btn.addEventListener('click', () => {
        UI.confirm('Remove ' + btn.dataset.label + '?', '<p>VaultBook will stop using this key on this device. Lines already imported stay in your books.</p>', { ok: 'Remove' })
          .then((yes) => yes && X.remove(btn.dataset.rm).then(() => { UI.toast(btn.dataset.label + ' removed.'); render(card); }))
          .catch(UI.error);
      }));
    }).catch((e) => { card.innerHTML = '<h2>Connected services</h2><div class="banner danger">' + esc(e.message || String(e)) + '</div>'; });
  }
  UI.securityTab = function (el, r) {
    base(el, r);
    const card = document.createElement('section');
    card.className = 'card'; card.dataset.testid = 'connected-services';
    el.appendChild(card); render(card);
  };
})();
