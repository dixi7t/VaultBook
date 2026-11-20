/* QuickBooks-style hover flyout navigation (progressive enhancement).
   Transforms the flat sidebar nav into primary items + hover-triggered floating
   submenus. Keeps every original <a href> and data-testid so the router and
   active-state logic in ui-core.js keep working unchanged. */
(function () {
  'use strict';
  var STANDALONE = { dashboard: 1, snapshot: 1, settings: 1 };
  var hideTimer = null, openGrp = null;

  function hrefName(a) { return (a.getAttribute('href') || '').replace(/^#\/?/, '').split(/[/?]/)[0]; }

  function transform() {
    var nav = document.querySelector('.nav');
    if (!nav || nav.dataset.flyout) return;
    nav.dataset.flyout = '1';
    var nodes = Array.prototype.slice.call(nav.children);
    var frag = document.createDocumentFragment();
    var curGrp = null, curFly = null;

    nodes.forEach(function (node) {
      if (node.classList && node.classList.contains('nav-group')) {
        var label = node.textContent.trim();
        curGrp = document.createElement('div');
        curGrp.className = 'nav-grp';
        curGrp.dataset.group = label;
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'nav-parent';
        btn.setAttribute('aria-haspopup', 'true');
        btn.setAttribute('data-testid', 'nav-group-' + label.toLowerCase());
        btn.innerHTML = '<span class="nav-ico-slot"></span><span class="nav-parent-l">' + label +
          '</span><span class="nav-caret" aria-hidden="true"><svg viewBox="0 0 20 20" width="12" height="12"><path d="M7.5 5l5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></span>';
        curGrp.appendChild(btn);
        curFly = document.createElement('div');
        curFly.className = 'nav-flyout';
        curFly.setAttribute('role', 'menu');
        var h = document.createElement('div');
        h.className = 'nav-flyout-h';
        h.textContent = label;
        curFly.appendChild(h);
        curGrp.appendChild(curFly);
        frag.appendChild(curGrp);
        return;
      }
      if (node.tagName === 'A') {
        var name = hrefName(node);
        if (STANDALONE[name] || !curGrp) { node.classList.add('nav-top'); frag.appendChild(node); curGrp = null; curFly = null; return; }
        curFly.appendChild(node);
        var slot = curGrp.querySelector('.nav-ico-slot');
        if (slot && !slot.firstChild) { var ico = node.querySelector('svg.ni'); if (ico) slot.appendChild(ico.cloneNode(true)); }
        return;
      }
      frag.appendChild(node); curGrp = null; curFly = null;
    });

    nav.innerHTML = '';
    nav.appendChild(frag);
    wire(nav);
    sync();
  }

  function place(grp) {
    var fly = grp.querySelector('.nav-flyout'); if (!fly) return;
    var r = grp.getBoundingClientRect();
    fly.classList.add('open');
    var side = grp.closest('.sidebar'), edge = side ? side.getBoundingClientRect().right : r.right;
    fly.style.left = Math.round(Math.max(r.right, edge) + 4) + 'px';   // beside the side menu, never over it
    var h = fly.offsetHeight, vh = window.innerHeight;
    var top = r.top;
    if (top + h > vh - 10) top = Math.max(10, vh - 10 - h);
    fly.style.top = Math.round(top) + 'px';
  }
  function openFly(grp) {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    if (openGrp && openGrp !== grp) close(openGrp);
    openGrp = grp; place(grp);
  }
  function close(grp) {
    var fly = grp.querySelector('.nav-flyout'); if (fly) fly.classList.remove('open');
    if (openGrp === grp) openGrp = null;
  }
  function scheduleClose(grp) {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(function () { close(grp); }, 200);
  }

  function wire(nav) {
    nav.querySelectorAll('.nav-grp').forEach(function (grp) {
      var fly = grp.querySelector('.nav-flyout');
      grp.addEventListener('mouseenter', function () { openFly(grp); });
      grp.addEventListener('mouseleave', function () { scheduleClose(grp); });
      fly.addEventListener('mouseenter', function () { if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; } });
      fly.addEventListener('mouseleave', function () { scheduleClose(grp); });
      var btn = grp.querySelector('.nav-parent');
      btn.addEventListener('mouseenter', function () { openFly(grp); });
      btn.addEventListener('focus', function () { openFly(grp); });
      btn.addEventListener('click', function () { var a = fly.querySelector('a[href]'); if (a) location.hash = a.getAttribute('href').replace(/^#/, ''); });
      fly.querySelectorAll('a').forEach(function (a) { a.addEventListener('click', function () { close(grp); }); });
    });
    window.addEventListener('resize', function () { if (openGrp) place(openGrp); });
    window.addEventListener('hashchange', function () { if (openGrp) close(openGrp); });
  }

  function sync() {
    document.querySelectorAll('.nav-grp').forEach(function (grp) {
      grp.classList.toggle('has-active', !!grp.querySelector('a.active'));
    });
  }

  function hook() {
    if (window.OB && OB.ui && OB.ui.render && !OB.ui.render.__fly) {
      var orig = OB.ui.render;
      var wrapped = function () { var x = orig.apply(this, arguments); try { sync(); } catch (e) {} return x; };
      wrapped.__fly = true;
      OB.ui.render = wrapped;
    }
  }

  transform();
  hook();
})();
