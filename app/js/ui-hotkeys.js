/* OfflineBooks US — button mnemonics: ⌘ (Ctrl on Windows) + the underlined letter.
 *
 * A control opts in with data-key="letters in order of preference", e.g. data-key="s" or data-key="e,d".
 * For each screen layer (the page, or the open dialog / drawer) the controls are assigned letters so that
 *   - no two visible controls share a letter (primary buttons choose first, then page order),
 *   - the letter appears in the label and is underlined there (S̲ave, Save and ne̲w, Cu̲stomize),
 *   - letters the operating system, the browser or text editing own are never used
 *     (⌘N/T/W/Q/H/M can't be intercepted; ⌘A/C/V/X/Z are editing; ⌘R/F/K/\ are kept for reload, find, search, sidebar).
 * Pressing ⌘ + that letter (no Shift) presses the control. Tooltips show the shortcut.
 */
(function () {
  'use strict';
  const UI = OB.ui;
  const MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
  UI.isMac = MAC;
  UI.modKey = MAC ? '⌘' : 'Ctrl';
  const RESERVED = new Set('acvxzntwqhmrfk'.split(''));
  UI.combo = (key) => (MAC ? '⌘' : 'Ctrl+') + key.toUpperCase();

  const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  /** A control is live when it is shown, or sits in a closed menu whose trigger is shown. */
  const live = (el) => {
    if (el.disabled || el.closest('fieldset[disabled]')) return false;
    const menu = el.closest('.menu[hidden]');
    if (menu) { const trig = menu.previousElementSibling; return !!trig && visible(trig); }
    return visible(el) && !el.closest('[hidden]');
  };
  function activeLayer() {
    const layers = [...document.querySelectorAll('.modal-backdrop, .drawer-backdrop, .sb-drawer-back')];
    return layers.length ? layers[layers.length - 1] : document.querySelector('.app') || document.body;
  }
  const labelText = (el) => {
    const t = el.cloneNode(true);
    t.querySelectorAll('kbd, .sr-only, svg').forEach((x) => x.remove());
    return (t.textContent || '').replace(/\s+/g, ' ').trim();
  };
  /** Text used to pick a letter: the visible label, or the accessible name of an icon-only button. */
  const nameText = (el) => labelText(el) || (el.getAttribute('aria-label') || '').trim();
  /** Index of the letter to underline: start of a word if possible, else inside the last word that has it. */
  function underlineIndex(text, key) {
    const lower = text.toLowerCase();
    for (let i = 0; i < lower.length; i++) if (lower[i] === key && (i === 0 || /[\s&/(+-]/.test(lower[i - 1]))) return i;
    return lower.lastIndexOf(key);
  }
  function clearMark(el) {
    el.querySelectorAll('span.mn-wrap').forEach((w) => w.replaceWith(document.createTextNode(w.textContent)));
    el.normalize();
  }
  function mark(el, key) {
    clearMark(el);
    const text = labelText(el), at = underlineIndex(text, key);
    if (at < 0) return;
    // find the text node holding character #at of the visible label
    let count = 0;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (node.parentElement && node.parentElement.closest('kbd, .sr-only, svg')) continue;
      const v = node.nodeValue.replace(/\s+/g, ' ');
      const lead = count === 0 ? v.length - v.trimStart().length : 0;
      const usable = count === 0 ? v.trimStart() : v;
      if (at < count + usable.length) {
        const i = lead + (at - count);
        // one wrapper span, so flex buttons (which put a gap between children) keep the word together
        const wrap = document.createElement('span'); wrap.className = 'mn-wrap';
        const u = document.createElement('u'); u.className = 'mn'; u.textContent = node.nodeValue.charAt(i);
        wrap.append(node.nodeValue.slice(0, i), u, node.nodeValue.slice(i + 1));
        node.replaceWith(wrap);
        return;
      }
      count += usable.length;
    }
  }
  /** Assign letters for one layer. Returns [{el, key}]. */
  function assign(layer) {
    const ctrls = [...layer.querySelectorAll('[data-key]')].filter((el) => !el.closest('.modal-backdrop, .drawer-backdrop, .sb-drawer-back') || el.closest('.modal-backdrop, .drawer-backdrop, .sb-drawer-back') === layer || layer === document.body);
    const liveOnes = ctrls.filter(live);
    liveOnes.sort((a, b) => (b.classList.contains('primary') ? 1 : 0) - (a.classList.contains('primary') ? 1 : 0));
    const taken = new Set(), out = [];
    liveOnes.forEach((el) => {
      const text = nameText(el).toLowerCase();
      const prefs = el.dataset.key.toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
      const letters = prefs.concat(text.split('').filter((c) => /[a-z]/.test(c)));
      const key = letters.find((c) => !RESERVED.has(c) && !taken.has(c) && text.indexOf(c) >= 0);
      if (!key) { if (el.dataset.k) { delete el.dataset.k; clearMark(el); el.removeAttribute('aria-keyshortcuts'); } return; }
      taken.add(key); out.push({ el, key });
      if (el.dataset.k !== key || !el.querySelector('u.mn')) {
        el.dataset.k = key; mark(el, key);
        const base = (el.dataset.tip || nameText(el));
        el.dataset.tip = base;
        el.setAttribute('title', base + ' (' + UI.combo(key) + ')');
        el.setAttribute('aria-keyshortcuts', (MAC ? 'Meta+' : 'Control+') + key.toUpperCase());
      }
    });
    // controls that lost their letter (hidden, or a dialog now owns the screen) keep no stale underline
    ctrls.filter((el) => !liveOnes.includes(el) && el.dataset.k && !el.closest('.menu')).forEach((el) => { delete el.dataset.k; clearMark(el); });
    return out;
  }
  UI.decorateKeys = () => assign(activeLayer());
  UI.currentMnemonics = () => assign(activeLayer()).map((x) => ({ key: x.key, label: nameText(x.el) }));

  let pending = false;
  const schedule = () => { if (pending) return; pending = true; requestAnimationFrame(() => { pending = false; UI.decorateKeys(); }); };
  new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === 'attributes') { schedule(); return; }
      for (const n of [...m.addedNodes, ...m.removedNodes]) {
        if (n.nodeType !== 1) continue;
        if (n.matches('[data-key], .modal-backdrop, .drawer-backdrop, .sb-drawer-back') || (n.querySelector && n.querySelector('[data-key]'))) { schedule(); return; }
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'disabled'] });
  window.addEventListener('resize', schedule);

  document.addEventListener('keydown', (e) => {
    if (!(MAC ? e.metaKey : e.ctrlKey) || e.altKey || e.shiftKey || !e.key || e.key.length !== 1) return;
    if (document.querySelector('.palette-backdrop')) return;
    const key = e.key.toLowerCase();
    if (RESERVED.has(key)) return;
    const hit = assign(activeLayer()).find((x) => x.key === key);
    if (!hit) return;
    e.preventDefault(); e.stopPropagation();
    // let a field that is being edited commit its value first (amount formatting, combos)
    const f = document.activeElement;
    if (f && /INPUT|TEXTAREA|SELECT/.test(f.tagName)) f.dispatchEvent(new Event('change', { bubbles: true }));
    hit.el.click();
  }, true);

  // Show ⌘ instead of "Ctrl" in keyboard hints on a Mac.
  const macKbd = () => document.querySelectorAll('kbd').forEach((k) => { k.textContent = k.textContent.replace(/^Ctrl\s?/, '⌘'); });
  if (MAC) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', macKbd); else macKbd(); }
})();
