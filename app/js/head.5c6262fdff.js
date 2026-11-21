/* == js/gate.js == */
/* VaultBook passcode screen. Shown before the app starts on the hosted site; the app starts only after unlock.
 * This is a deterrent for casual visitors, not encryption: it runs in the browser. Books are protected by the
 * company password (Settings), which encrypts them with AES-GCM. */
(function () {
  'use strict';
  var root = document.documentElement, S = window.sessionStorage, L = window.localStorage;
  var KEY = 'vbGateOpen', FAILS = 'vbGateFails', MAX_TRIES = 5, WAIT_MS = 60000;
  var done, ready = new Promise(function (r) { done = r; });
  window.VBGate = { ready: ready };
  var get = function (s, k) { try { return s.getItem(k); } catch (e) { return null; } };
  var set = function (s, k, v) { try { if (v === null) s.removeItem(k); else s.setItem(k, v); } catch (e) { /* private mode */ } };
  var hosted = location.protocol === 'https:' || location.protocol === 'http:';
  if (!hosted || get(S, KEY) === '1') { done(); return; }
  root.classList.add('vb-locked');

  var fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: true });
  var codeAt = function (t) { var h = '', m = ''; fmt.formatToParts(new Date(t)).forEach(function (p) { if (p.type === 'hour') h = p.value; if (p.type === 'minute') m = p.value; }); return String(+h) + m; };
  var valid = function () { var n = Date.now(); return [codeAt(n), codeAt(n - 60000)]; };

  var fails = function () { try { return JSON.parse(get(L, FAILS) || '{}'); } catch (e) { return {}; } };
  var dots = '', busy = false, timer = null;

  function build() {
    var keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'];
    var wrap = document.createElement('div');
    wrap.id = 'vb-gate'; wrap.className = 'vbg'; wrap.setAttribute('role', 'dialog'); wrap.setAttribute('aria-modal', 'true'); wrap.setAttribute('aria-labelledby', 'vbg-t');
    wrap.innerHTML = '<div class="vbg-in">'
      + '<div class="vbg-mark" aria-hidden="true">VB</div>'
      + '<h1 id="vbg-t" class="vbg-t">Enter Passcode</h1>'
      + '<p class="vbg-s" id="vbg-s">VaultBook is locked</p>'
      + '<div class="vbg-dots" id="vbg-dots" aria-hidden="true"><i></i><i></i><i></i><i></i></div>'
      + '<input id="vbg-in" class="vbg-field" type="password" inputmode="numeric" autocomplete="off" maxlength="4" aria-label="Passcode" aria-describedby="vbg-s">'
      + '<div class="vbg-pad" role="group" aria-label="Keypad">' + keys.map(function (k) {
          if (!k) return '<span></span>';
          if (k === 'del') return '<button type="button" class="vbg-del" data-k="del" aria-label="Delete">Delete</button>';
          return '<button type="button" class="vbg-key" data-k="' + k + '" aria-label="' + k + '">' + k + '</button>';
        }).join('') + '</div>'
      + '<p class="vbg-live" id="vbg-live" role="status" aria-live="polite"></p>'
      + '</div>';
    document.body.appendChild(wrap);
    var field = wrap.querySelector('#vbg-in');
    wrap.addEventListener('click', function (e) { var b = e.target.closest('[data-k]'); if (!b) return; press(b.dataset.k); });
    field.addEventListener('input', function () { var v = field.value.replace(/\D/g, '').slice(0, 4); field.value = ''; for (var i = 0; i < v.length; i++) press(v[i]); });
    document.addEventListener('keydown', onKey, true);
    if (!matchMedia('(pointer: coarse)').matches) field.focus({ preventScroll: true });
    render(); tick();
  }
  function onKey(e) {
    if (!root.classList.contains('vb-locked')) return;
    if (/^[0-9]$/.test(e.key)) { e.preventDefault(); press(e.key); }
    else if (e.key === 'Backspace') { e.preventDefault(); press('del'); }
    else if (e.key === 'Enter') { e.preventDefault(); check(true); }
    else if (e.key !== 'Tab') e.stopPropagation();
  }
  function lockedFor() { var f = fails(); return f.until && f.until > Date.now() ? f.until - Date.now() : 0; }
  function render() {
    var g = document.getElementById('vb-gate'); if (!g) return;
    var ds = g.querySelectorAll('.vbg-dots i'); for (var i = 0; i < ds.length; i++) ds[i].className = i < dots.length ? 'on' : '';
    var wait = lockedFor(), s = g.querySelector('#vbg-s');
    g.classList.toggle('vbg-wait', wait > 0);
    var btns = g.querySelectorAll('button'); for (var j = 0; j < btns.length; j++) btns[j].disabled = wait > 0;
    var secs = Math.ceil(wait / 1000);
    s.textContent = wait > 0 ? 'Try again in ' + secs + ' second' + (secs === 1 ? '' : 's') :(fails().n ? (MAX_TRIES - fails().n) + ' attempt' + (MAX_TRIES - fails().n === 1 ? '' : 's') + ' left' : 'VaultBook is locked');
    g.querySelector('.vbg-del').textContent = dots.length ? 'Delete' : '';
    g.querySelector('.vbg-del').setAttribute('aria-hidden', dots.length ? 'false' : 'true');
  }
  function tick() { clearInterval(timer); timer = setInterval(function () { if (lockedFor() <= 0 && document.getElementById('vb-gate') && document.getElementById('vb-gate').classList.contains('vbg-wait')) { var f = fails(); f.until = 0; set(L, FAILS, JSON.stringify(f)); } render(); }, 1000); }
  function press(k) {
    if (busy || lockedFor() > 0) return;
    if (k === 'del') dots = dots.slice(0, -1); else if (dots.length < 4) dots += k;
    render(); check(false);
  }
  function check(final) {
    if (!dots.length) return;
    var ok = valid(), max = Math.max(ok[0].length, ok[1].length);
    if (ok.indexOf(dots) >= 0) return unlock();
    if (dots.length >= max || final) wrong();
  }
  function wrong() {
    busy = true;
    var f = fails(); f.n = (f.n || 0) + 1; if (f.n >= MAX_TRIES) { f.until = Date.now() + WAIT_MS; f.n = 0; } set(L, FAILS, JSON.stringify(f));
    var g = document.getElementById('vb-gate'), live = g.querySelector('#vbg-live');
    live.textContent = 'Wrong passcode';
    g.classList.add('vbg-shake'); if (navigator.vibrate) navigator.vibrate(120);
    setTimeout(function () { g.classList.remove('vbg-shake'); dots = ''; busy = false; render(); setTimeout(function () { live.textContent = ''; }, 1200); }, 450);
  }
  function unlock() {
    busy = true; set(S, KEY, '1'); set(L, FAILS, null); clearInterval(timer);
    document.removeEventListener('keydown', onKey, true);
    var g = document.getElementById('vb-gate');
    g.classList.add('vbg-out');
    root.classList.remove('vb-locked');
    done();
    setTimeout(function () { if (g.parentNode) g.parentNode.removeChild(g); }, 320);
  }
  if (document.body) build(); else document.addEventListener('DOMContentLoaded', build);
})();

;
/* == js/theme-early.js == */
/* Apply the saved appearance before first paint (no flash of the wrong theme). Loaded in <head>. */
try { var p = JSON.parse(localStorage.getItem('OfflineBooksUS.prefs.v1') || '{}'), d = document.documentElement;
  if (p.theme === 'light' || p.theme === 'dark') d.dataset.theme = p.theme;
  if (p.density === 'compact') d.dataset.density = 'compact';
  if (p.sidebarCollapsed !== false) d.classList.add('sidebar-collapsed');
  if (p.navCompact) d.classList.add('nav-compact'); } catch (e) {}

;
