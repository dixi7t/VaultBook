/* OfflineBooks US — small SVG chart kit (no libraries).
 * Every chart: themed by CSS tokens, tooltips via <title>, clickable marks (data-go → drill-down),
 * an accessible description, and an equivalent data table (UI.chart.table) for "View as table".
 */
(function () {
  'use strict';
  const U = OB.util, UI = OB.ui, esc = U.esc;
  const C = UI.chart = {};
  const K = (c) => (Math.abs(c) >= 100000000 ? U.fmt(Math.round(c / 100000), {}).replace(/\.00$/, '') + 'k' : U.fmt(c).replace(/\.00$/, ''));

  /** Round axis maximum to a "nice" number. */
  function nice(max) {
    if (max <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(max))), n = max / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
  }
  const axisLabel = (cents) => {
    const d = Math.abs(cents) / 100, s = cents < 0 ? '-' : '';
    if (d >= 1e6) return s + (d / 1e6).toFixed(d % 1e6 ? 1 : 0) + 'M';
    if (d >= 1e3) return s + (d / 1e3).toFixed(d % 1e3 ? 1 : 0) + 'k';
    return s + Math.round(d);
  };

  /**
   * Grouped bars. o = { categories:[label], series:[{name, values:[cents], cls:'s1'}], go:(ci,si)=>hash, height, label }
   * Handles negatives (zero line), and any number of series.
   */
  C.bars = (o) => {
    const W = 400, H = o.height || 210, padL = 40, padB = 24, padT = 8, padR = 4;
    const all = o.series.flatMap((s) => s.values);
    const maxV = nice(Math.max(0, ...all)), minV = Math.min(0, ...all) < 0 ? -nice(-Math.min(...all)) : 0;
    const plotH = H - padB - padT, plotW = W - padL - padR;
    const y = (v) => padT + (maxV - v) / (maxV - minV || 1) * plotH;
    const n = o.categories.length, gw = plotW / Math.max(1, n), sN = o.series.length;
    const bw = Math.max(3, Math.min(26, (gw * 0.74) / sN));
    let g = '';
    for (let t = 0; t <= 4; t++) {
      const v = minV + (maxV - minV) * t / 4, yy = y(v);
      g += `<line x1="${padL}" x2="${W - padR}" y1="${yy}" y2="${yy}" class="grid${v === 0 ? ' zero' : ''}"/><text x="${padL - 6}" y="${yy + 3.5}" text-anchor="end" class="tick">${axisLabel(v)}</text>`;
    }
    o.categories.forEach((c, ci) => {
      const x0 = padL + ci * gw + (gw - bw * sN) / 2;
      o.series.forEach((s, si) => {
        const v = s.values[ci] || 0, y0 = y(Math.max(0, v)), h = Math.max(v ? 1 : 0, Math.abs(y(v) - y(0)));
        const go = o.go ? o.go(ci, si) : '';
        g += `<rect x="${(x0 + si * bw).toFixed(1)}" y="${(v >= 0 ? y0 : y(0)).toFixed(1)}" width="${(bw - 1.5).toFixed(1)}" height="${h.toFixed(1)}" rx="1.5" class="mark ${(s.clsAt && s.clsAt[ci]) || s.cls || 's' + (si + 1)}"${go ? ` data-go="${esc(go)}" tabindex="-1"` : ''}><title>${esc(c)} · ${esc(s.name)}: ${U.fmt(v, { symbol: true })}</title></rect>`;
      });
      if (n <= 8 || ci % Math.ceil(n / 7) === 0) g += `<text x="${padL + ci * gw + gw / 2}" y="${H - 8}" text-anchor="middle" class="tick">${esc(c)}</text>`;
    });
    const keys = o.legend || (o.series.length > 1 ? o.series.map((s, i) => ({ name: s.name, cls: s.cls || 's' + (i + 1) })) : []);
    const legend = keys.length ? `<div class="legend">${keys.map((k) => `<span><i class="key ${k.cls}"></i>${esc(k.name)}</span>`).join('')}</div>` : '';
    return `<svg viewBox="0 0 ${W} ${H}" class="chart2" role="img" aria-label="${esc(o.label || 'Bar chart')}">${g}</svg>${legend}`;
  };

  /** Donut. o = { items:[{label, value(cents), go}], label, total } — slices < 1% merge into "Other". */
  C.donut = (o) => {
    const items = o.items.filter((i) => i.value > 0);
    const total = U.sum(items, (i) => i.value);
    if (!total) return C.empty(o.empty || 'No data for this period.');
    const R = 70, r = 44, cx = 90, cy = 90;
    let a0 = -Math.PI / 2, paths = '';
    items.forEach((it, i) => {
      const frac = it.value / total, a1 = a0 + frac * Math.PI * 2, large = frac > 0.5 ? 1 : 0;
      const p = (rad, a) => (cx + rad * Math.cos(a)).toFixed(2) + ' ' + (cy + rad * Math.sin(a)).toFixed(2);
      const d = frac >= 0.9999 ? `M ${cx - R} ${cy} A ${R} ${R} 0 1 1 ${cx + R} ${cy} A ${R} ${R} 0 1 1 ${cx - R} ${cy} M ${cx - r} ${cy} A ${r} ${r} 0 1 0 ${cx + r} ${cy} A ${r} ${r} 0 1 0 ${cx - r} ${cy} Z`
        : `M ${p(R, a0)} A ${R} ${R} 0 ${large} 1 ${p(R, a1)} L ${p(r, a1)} A ${r} ${r} 0 ${large} 0 ${p(r, a0)} Z`;
      paths += `<path d="${d}" class="mark p${(i % 7) + 1}"${it.go ? ` data-go="${esc(it.go)}"` : ''} fill-rule="evenodd"><title>${esc(it.label)}: ${U.fmt(it.value, { symbol: true })} (${(frac * 100).toFixed(1)}%)</title></path>`;
      a0 = a1;
    });
    const center = `<text x="${cx}" y="${cy - 2}" text-anchor="middle" class="donut-total">${axisLabel(total)}</text><text x="${cx}" y="${cy + 14}" text-anchor="middle" class="tick">${esc(o.centerLabel || 'Total')}</text>`;
    const legend = `<ul class="donut-legend">${items.map((it, i) => `<li><i class="key p${(i % 7) + 1}"></i><span class="lab">${it.go ? `<a href="${esc(it.go)}">${esc(it.label)}</a>` : esc(it.label)}</span><span class="amt">${U.fmt(it.value)}</span><span class="pct">${(it.value / total * 100).toFixed(0)}%</span></li>`).join('')}</ul>`;
    return `<div class="donut-wrap"><svg viewBox="0 0 180 180" class="donut" role="img" aria-label="${esc(o.label || 'Breakdown')}, total ${U.fmt(total, { symbol: true })}">${paths}${center}</svg>${legend}</div>`;
  };

  /** Ranked horizontal bars. o = { items:[{label, value, go, sub}] } */
  C.ranked = (o) => {
    const items = o.items.filter((i) => i.value);
    if (!items.length) return C.empty(o.empty || 'No data for this period.');
    const max = Math.max(...items.map((i) => Math.abs(i.value)));
    return `<ol class="ranked">${items.map((it) => `<li><div class="rk-top">${it.go ? `<a href="${esc(it.go)}">${esc(it.label)}</a>` : `<span>${esc(it.label)}</span>`}<span class="amt">${U.fmt(it.value, { symbol: true })}</span></div>
      <div class="rk-bar" aria-hidden="true"><i class="${o.cls || 's1'}" style="width:${Math.max(1.5, Math.abs(it.value) / max * 100).toFixed(1)}%"></i></div>${it.sub ? `<div class="muted small">${esc(it.sub)}</div>` : ''}</li>`).join('')}</ol>`;
  };

  /** Same data as a table (for "View as table", screen readers, and exact figures). */
  C.table = (head, rows, opts) => `<div class="tile-table"><table class="data compact"><thead><tr>${head.map((h, i) => `<th class="${i ? 'num' : ''}">${esc(h)}</th>`).join('')}</tr></thead><tbody>
    ${rows.map((r) => `<tr>${r.map((c, i) => i === 0 ? `<td>${c && c.go ? `<a href="${esc(c.go)}">${esc(c.label)}</a>` : esc(c && c.label !== undefined ? c.label : c)}</td>` : `<td class="num">${typeof c === 'number' ? UI.money(c) : esc(c)}</td>`).join('')}</tr>`).join('')}
    </tbody>${opts && opts.foot ? `<tfoot><tr>${opts.foot.map((c, i) => i ? `<td class="num">${typeof c === 'number' ? UI.money(c) : esc(c)}</td>` : `<td>${esc(c)}</td>`).join('')}</tr></tfoot>` : ''}</table></div>`;
  C.empty = (msg) => `<div class="tile-empty">${esc(msg)}</div>`;
  C.k = K;
})();
