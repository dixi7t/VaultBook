/* VaultBook — minimal offline PDF writer for reports (PDF 1.4, standard Helvetica / Helvetica-Bold, WinAnsi text).
 * No fonts are embedded and nothing is compressed, so files stay small and every figure is searchable text.
 * Glyph widths: Adobe Core14 AFM metrics for Helvetica, Helvetica-Bold and Times-Roman (WinAnsi codes 32–255),
 * Copyright (c) 1985, 1987, 1989, 1990, 1997 Adobe Systems Incorporated. All Rights Reserved. Used to measure text only.
 * API: d = OB.pdf.create({ width, height }); d.addPage(); d.text(x, yTop, str, { size, bold, color, align, maxWidth });
 *      d.line(x1, y1, x2, y2, { width, color }); d.rect(x, y, w, h, { fill }); d.measure(str, size, bold); d.output({ title }) → Uint8Array
 * Coordinates are points from the top-left corner of the page (72 points = 1 inch).
 */
(function (root) {
  'use strict';
  var OB = root.OB = root.OB || {};
  var P = OB.pdf = {};
  var W = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584,0,556,0,222,556,333,1000,556,556,333,1000,667,333,1000,0,611,0,0,222,222,333,333,350,556,1000,333,1000,500,333,944,0,500,667,278,333,556,556,556,556,260,556,333,737,370,556,584,333,737,333,400,584,0,0,333,556,537,278,333,0,365,556,834,834,834,611,667,667,667,667,667,667,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,500,556,556,556,556,278,278,278,278,556,556,556,556,556,556,556,584,611,556,556,556,556,500,556,500];
  var WB = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584,0,556,0,278,556,500,1000,556,556,333,1000,667,333,1000,0,611,0,0,278,278,500,500,350,556,1000,333,1000,556,333,944,0,500,667,278,333,556,556,556,556,280,556,333,737,370,556,584,333,737,333,400,584,0,0,333,611,556,278,333,0,365,556,834,834,834,611,722,722,722,722,722,722,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,556,556,556,556,556,278,278,278,278,611,611,611,611,611,611,611,584,611,611,611,611,611,556,611,556];
  var WT = [250,333,408,500,500,833,778,180,333,333,500,564,250,333,250,278,500,500,500,500,500,500,500,500,500,500,278,278,564,564,564,444,921,722,667,667,722,611,556,722,722,333,389,722,611,889,722,722,556,722,667,556,611,722,722,944,722,722,611,333,278,333,469,500,333,444,500,444,500,444,333,500,500,278,278,500,278,778,500,500,500,500,333,389,278,500,500,722,500,500,444,480,200,480,541,0,500,0,333,500,444,1000,500,500,333,1000,556,333,889,0,611,0,0,333,333,444,444,350,500,1000,333,980,389,333,722,0,444,722,250,333,500,500,500,500,200,500,333,760,276,500,564,333,760,333,400,564,0,0,333,500,453,250,333,0,310,500,750,750,750,444,722,722,722,722,722,722,889,667,611,611,611,611,333,333,333,333,722,722,722,722,722,722,722,564,722,722,722,722,722,722,556,500,444,444,444,444,444,444,667,444,444,444,444,444,278,278,278,278,500,500,500,500,500,500,500,564,500,500,500,500,500,500,500,500];
  // Times New Roman, Arial, Arial Bold (widths of the metric-compatible Liberation fonts, SIL OFL), for documents that name those fonts
  var WTNR = [250,333,408,500,500,833,778,180,333,333,500,564,250,333,250,278,500,500,500,500,500,500,500,500,500,500,278,278,564,564,564,444,921,722,667,667,722,611,556,722,722,333,389,722,611,889,722,722,556,722,667,556,611,722,722,944,722,722,611,333,278,333,469,500,333,444,500,444,500,444,333,500,500,278,278,500,278,778,500,500,500,500,333,389,278,500,500,722,500,500,444,480,200,480,541,0,500,0,333,500,444,1000,500,500,333,1000,556,333,889,0,611,0,0,333,333,444,444,350,500,1000,333,980,389,333,722,0,444,722,250,333,500,500,500,500,200,500,333,760,276,500,564,333,760,500,400,549,300,300,333,576,453,333,333,300,310,500,750,750,750,444,722,722,722,722,722,722,889,667,611,611,611,611,333,333,333,333,722,722,722,722,722,722,722,564,722,722,722,722,722,722,556,500,444,444,444,444,444,444,667,444,444,444,444,444,278,278,278,278,500,500,500,500,500,500,500,549,500,500,500,500,500,500,500,500];
  var WAR = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584,0,556,0,222,556,333,1000,556,556,333,1000,667,333,1000,0,611,0,0,222,222,333,333,350,556,1000,333,1000,500,333,944,0,500,667,278,333,556,556,556,556,260,556,333,737,370,556,584,333,737,552,400,549,333,333,333,576,537,333,333,333,365,556,834,834,834,611,667,667,667,667,667,667,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,500,556,556,556,556,278,278,278,278,556,556,556,556,556,556,556,549,611,556,556,556,556,500,556,500];
  var WARB = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584,0,556,0,278,556,500,1000,556,556,333,1000,667,333,1000,0,611,0,0,278,278,500,500,350,556,1000,333,1000,556,333,944,0,500,667,278,333,556,556,556,556,280,556,333,737,370,556,584,333,737,552,400,549,333,333,333,576,556,333,333,333,365,556,834,834,834,611,722,722,722,722,722,722,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,556,556,556,556,556,278,278,278,278,611,611,611,611,611,611,611,549,611,611,611,611,611,556,611,556];
  P.PAPER = { letter: [612, 792], legal: [612, 1008], tabloid: [792, 1224], a4: [595.28, 841.89], a3: [841.89, 1190.55] };

  // Unicode → WinAnsi (cp1252) byte for the 0x80–0x9F block; Latin-1 maps to itself.
  var CP = { 0x20AC: 128, 0x201A: 130, 0x0192: 131, 0x201E: 132, 0x2026: 133, 0x2020: 134, 0x2021: 135, 0x02C6: 136, 0x2030: 137, 0x0160: 138, 0x2039: 139, 0x0152: 140, 0x017D: 142,
    0x2018: 145, 0x2019: 146, 0x201C: 147, 0x201D: 148, 0x2022: 149, 0x2013: 150, 0x2014: 151, 0x02DC: 152, 0x2122: 153, 0x0161: 154, 0x203A: 155, 0x0153: 156, 0x017E: 158, 0x0178: 159 };
  P.CP = CP;
  var SUB = { 0x2212: '-', 0x2713: 'OK', 0x2714: 'OK', 0x2717: 'X', 0x2718: 'X', 0x2192: '->', 0x2190: '<-', 0x2264: '<=', 0x2265: '>=', 0x00A0: ' ', 0x2009: ' ', 0x202F: ' ' };
  /** Text as WinAnsi byte codes (characters with no WinAnsi glyph become "?"). */
  P.encode = function (s) {
    var out = [];
    String(s === null || s === undefined ? '' : s).replace(/[\r\n\t]+/g, ' ').split('').forEach(function (ch) {
      var c = ch.charCodeAt(0);
      if (SUB[c]) { SUB[c].split('').forEach(function (x) { out.push(x.charCodeAt(0)); }); return; }
      if (c >= 32 && c < 127) out.push(c);
      else if (c >= 160 && c < 256) out.push(c);
      else if (CP[c]) out.push(CP[c]);
      else if (c >= 0xD800 && c <= 0xDBFF) return; // first half of an emoji etc.; its second half becomes "?"
      else out.push(63);
    });
    return out;
  };
  // font keys: 'helv' (default), true or 'helvb', 'times'; and the Windows fonts 'tnr', 'arial', 'arialb' (not embedded, like Office PDFs)
  var FONTS = { helv: ['F1', W], helvb: ['F2', WB], times: ['F3', WT], tnr: ['F4', WTNR], arial: ['F5', WAR], arialb: ['F6', WARB] };
  var fontKey = function (f) { return f === true ? 'helvb' : FONTS[f] ? f : 'helv'; };
  /** bold: true = Helvetica-Bold, or a font key ('times', 'tnr', 'arial', 'arialb'), otherwise Helvetica. */
  P.measure = function (s, size, bold) {
    var t = FONTS[fontKey(bold)][1], w = 0, codes = P.encode(s);
    for (var i = 0; i < codes.length; i++) w += (t[codes[i] - 32] || 556);
    return w * (size || 10) / 1000;
  };
  /** Shorten text with "…" until it fits maxWidth. */
  P.fit = function (s, size, bold, maxWidth) {
    s = String(s === null || s === undefined ? '' : s);
    if (!maxWidth || P.measure(s, size, bold) <= maxWidth) return s;
    var lo = 0, hi = s.length;
    while (lo < hi) { var mid = (lo + hi + 1) >> 1; if (P.measure(s.slice(0, mid) + '…', size, bold) <= maxWidth) lo = mid; else hi = mid - 1; }
    return lo ? s.slice(0, lo).replace(/\s+$/, '') + '…' : '';
  };
  function pdfStr(codes) {
    var s = '(';
    codes.forEach(function (c) {
      if (c === 40 || c === 41 || c === 92) s += '\\' + String.fromCharCode(c);
      else if (c > 126) s += '\\' + ('00' + c.toString(8)).slice(-3);
      else s += String.fromCharCode(c);
    });
    return s + ')';
  }
  function num(n) { return (Math.round(n * 100) / 100).toString(); }
  function rgb(hex) { hex = String(hex || '000000').replace('#', ''); return [0, 2, 4].map(function (i) { return num(parseInt(hex.slice(i, i + 2), 16) / 255); }).join(' '); }

  P.create = function (opts) {
    var Wd = opts.width, Ht = opts.height, pages = [], cur = null, images = [];
    var d = {
      width: Wd, height: Ht, pages: pages,
      addPage: function () { cur = []; pages.push(cur); return d; },
      measure: P.measure, fit: P.fit,
      text: function (x, y, s, o) {
        o = o || {};
        var size = o.size || 10, bold = o.font && FONTS[o.font] ? o.font : !!o.bold;
        if (o.maxWidth) s = P.fit(s, size, bold, o.maxWidth);
        var w = P.measure(s, size, bold);
        if (o.align === 'right') x -= w; else if (o.align === 'center') x -= w / 2;
        // y is the top of the line box (baseline at about 80% of the font size), or the baseline itself with o.baseline
        cur.push('BT ' + (o.color ? rgb(o.color) + ' rg ' : '0 g ') + '/' + FONTS[fontKey(bold)][0] + ' ' + num(size) + ' Tf 1 0 0 1 ' + num(x) + ' ' + num(Ht - (o.baseline ? y : y + size * 0.8)) + ' Tm ' + pdfStr(P.encode(s)) + ' Tj ET');
        return w;
      },
      line: function (x1, y1, x2, y2, o) {
        o = o || {};
        cur.push((o.color ? rgb(o.color) : '0 0 0') + ' RG ' + num(o.width || 0.5) + ' w ' + num(x1) + ' ' + num(Ht - y1) + ' m ' + num(x2) + ' ' + num(Ht - y2) + ' l S');
      },
      /** JPEG image (bytes, pixel width/height) drawn in the box x, yTop, w, h. */
      image: function (x, y, w, h, img) { images.push(img); cur.push('q ' + num(w) + ' 0 0 ' + num(h) + ' ' + num(x) + ' ' + num(Ht - y - h) + ' cm /Im' + images.length + ' Do Q'); },
      rect: function (x, y, w, h, o) {
        cur.push(rgb((o && o.fill) || 'EEEEEE') + ' rg ' + num(x) + ' ' + num(Ht - y - h) + ' ' + num(w) + ' ' + num(h) + ' re f');
      },
      output: function (info) {
        info = info || {};
        var objs = [], offsets = [];
        var add = function (s) { objs.push(s); return objs.length; };
        add('<< /Type /Catalog /Pages 2 0 R >>');
        add(null); // pages, filled below
        add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
        add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
        var now = new Date(), pad = function (n) { return ('0' + n).slice(-2); };
        var stamp = 'D:' + now.getUTCFullYear() + pad(now.getUTCMonth() + 1) + pad(now.getUTCDate()) + pad(now.getUTCHours()) + pad(now.getUTCMinutes()) + pad(now.getUTCSeconds()) + 'Z';
        add('<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding /WinAnsiEncoding >>');
        [['TimesNewRomanPSMT', WTNR, 34, '-568 -307 2000 1007', 891, -216, 662], ['ArialMT', WAR, 32, '-665 -325 2000 1006', 905, -212, 716], ['Arial-BoldMT', WARB, 32, '-628 -376 2000 1018', 905, -212, 716]].forEach(function (f, k) {
          add('<< /Type /Font /Subtype /TrueType /BaseFont /' + f[0] + ' /FirstChar 32 /LastChar 255 /Widths [' + f[1].map(function (x) { return x || 0; }).join(' ') + '] /Encoding /WinAnsiEncoding /FontDescriptor ' + (6 + k * 2 + 1) + ' 0 R >>');
          add('<< /Type /FontDescriptor /FontName /' + f[0] + ' /Flags ' + f[2] + ' /FontBBox [' + f[3] + '] /ItalicAngle 0 /Ascent ' + f[4] + ' /Descent ' + f[5] + ' /CapHeight ' + f[6] + ' /StemV ' + (k === 2 ? 136 : 80) + ' >>');
        });
        var imgIds = images.map(function (im) {
          var bin = ''; for (var k = 0; k < im.bytes.length; k++) bin += String.fromCharCode(im.bytes[k]);
          return add('<< /Type /XObject /Subtype /Image /Width ' + im.width + ' /Height ' + im.height + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + im.bytes.length + ' >>\nstream\n' + bin + '\nendstream');
        });
        var xo = imgIds.length ? ' /XObject << ' + imgIds.map(function (id, k) { return '/Im' + (k + 1) + ' ' + id + ' 0 R'; }).join(' ') + ' >>' : '';
        var infoId = add('<< /Producer (VaultBook) /Creator (VaultBook) /Title ' + pdfStr(P.encode(info.title || 'Report')) + ' /CreationDate (' + stamp + ') >>');
        var kids = [];
        pages.forEach(function (ops) {
          var content = ops.join('\n');
          var cid = add('<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream');
          kids.push(add('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + num(Wd) + ' ' + num(Ht) + '] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R /F4 6 0 R /F5 8 0 R /F6 10 0 R >>' + xo + ' >> /Contents ' + cid + ' 0 R >>'));
        });
        objs[1] = '<< /Type /Pages /Kids [' + kids.map(function (k) { return k + ' 0 R'; }).join(' ') + '] /Count ' + kids.length + ' >>';
        var out = '%PDF-1.4\n%âãÏÓ\n';
        objs.forEach(function (o, i) { offsets.push(out.length); out += (i + 1) + ' 0 obj\n' + o + '\nendobj\n'; });
        var xref = out.length;
        out += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n' + offsets.map(function (o) { return ('000000000' + o).slice(-10) + ' 00000 n \n'; }).join('');
        out += 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R /Info ' + infoId + ' 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
        var bytes = new Uint8Array(out.length);
        for (var i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 255;
        return bytes;
      }
    };
    return d;
  };
  P.MIME = 'application/pdf';
})(typeof window !== 'undefined' ? window : globalThis);
