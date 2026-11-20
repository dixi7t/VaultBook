/* VaultBook — invoice / sales receipt / credit memo page layout.
 * Geometry is measured from the reference invoices (US Letter, 612 × 792 pt, points from the top-left; line width 0.96 pt):
 * company block Times 12 pt at the top left (optional logo above it), "Invoice" Arial Bold 21.1 pt at the top right with a
 * Date | Invoice # box, a "Bill To" label box and address box (Times 9.12 pt), a Description | Amount table that fills the
 * page, and a footer with "Thank you for your business." and "Total" (Arial Bold 16.08 pt).
 * OB.invoiceLayout.pages(book, txn) returns pages of drawing operations; the screen (SVG) and the PDF both draw from them,
 * and text is measured with the same font metrics, so line breaks and positions are identical in both.
 */
(function (root) {
  'use strict';
  var OB = root.OB = root.OB || {};
  var U = OB.util;
  var L = OB.invoiceLayout = {};
  var LW = 0.96, TIMES = 'times', ARIAL = 'arial', ARIALB = 'arialb';
  var PDFFONT = { times: 'tnr', arial: 'arial', arialb: 'arialb' };
  var measure = function (s, size, font) { return OB.pdf.measure(s, size, PDFFONT[font]); };
  L.W = 612; L.H = 792;
  var BODY_TOP = 356.64, BODY_STEP = 10.8, BODY_BOTTOM = 690; // last baseline that fits above the footer box (693.1)
  var DESC_X = 39.12, DESC_W = 427.4 - 39.12 - 4, AMT_R = 566.4;

  /** m/d/yyyy, as on the reference invoices. */
  L.date = function (d) { return d ? (+d.slice(5, 7)) + '/' + (+d.slice(8, 10)) + '/' + d.slice(0, 4) : ''; };
  /** Word-wrap a paragraph to a width with the given font metrics (long words are broken). */
  L.wrap = function (text, size, font, width) {
    var out = [];
    String(text || '').split(/\r?\n/).forEach(function (para) {
      var line = '';
      para.split(/\s+/).filter(Boolean).forEach(function (w) {
        var t = line ? line + ' ' + w : w;
        if (measure(t, size, font) <= width) { line = t; return; }
        if (line) out.push(line);
        while (measure(w, size, font) > width) { var k = w.length; while (k > 1 && measure(w.slice(0, k), size, font) > width) k--; out.push(w.slice(0, k)); w = w.slice(k); }
        line = w;
      });
      out.push(line);
    });
    return out;
  };

  /**
   * Pages of drawing operations for a sales document.
   * op: { t: 'text', x, y (baseline), s, font: 'times'|'arial'|'arialb', size, align: 'left'|'right'|'center', underline }
   *     { t: 'line', x1, y1, x2, y2 } · { t: 'image', x, y, w, h, src (data URL) }
   */
  L.pages = function (book, t) {
    var co = book.company, c = book.contactById[t.contactId] || {};
    var title = { invoice: 'Invoice', salesReceipt: 'Sales Receipt', creditMemo: 'Credit Memo', estimate: 'Estimate' }[t.type] || 'Invoice';
    var noLabel = t.type === 'invoice' ? 'Invoice #' : t.type === 'creditMemo' ? 'Credit No.' : t.type === 'estimate' ? 'Estimate #' : 'Sale No.';
    var txt = function (ops, x, y, s, font, size, align, extra) { ops.push(Object.assign({ t: 'text', x: x, y: y, s: String(s), font: font, size: size, align: align || 'left' }, extra || {})); };
    var box = function (ops, x1, y1, x2, y2) { ops.push({ t: 'line', x1: x1, y1: y1, x2: x2, y2: y1 }, { t: 'line', x1: x1, y1: y2, x2: x2, y2: y2 }, { t: 'line', x1: x1, y1: y1, x2: x1, y2: y2 }, { t: 'line', x1: x2, y1: y1, x2: x2, y2: y2 }); };

    // body rows: each line's description wrapped, its amount on the first row
    var rows = [];
    var showQty = (t.lines || []).some(function (l) { return l.qty !== null && l.qty !== undefined && l.qty !== '' && +l.qty !== 1; });
    (t.lines || []).forEach(function (l) {
      var desc = l.description || (book.accById[l.accountId] || {}).name || '';
      if (showQty && l.qty !== null && l.qty !== undefined && l.qty !== '' && l.rate !== null && l.rate !== undefined) desc += '  (' + l.qty + ' × ' + U.fmt(l.rate) + ')';
      L.wrap(desc, 9.12, TIMES, DESC_W).forEach(function (s, i) { rows.push({ s: s, amt: i === 0 ? U.fmt(l.amount) : '' }); });
    });
    if (t.memo) L.wrap(t.memo, 9.12, TIMES, DESC_W).forEach(function (s) { rows.push({ s: s, amt: '' }); });
    if (t.tax) { // sales tax (1.13): subtotal and tax rows above the footer Total
      var stx = book.salesTaxById ? book.salesTaxById(t.taxId) : null;
      rows.push({ s: '', amt: '' }); rows.push({ s: 'Subtotal', amt: U.fmt(book.lineTotal(t.lines)) });
      rows.push({ s: 'Sales tax' + (stx ? ' — ' + stx.name : '') + ' (' + OB.Book.fmtRate(t.taxRate || 0) + ' on ' + U.fmt(t.taxableAmount || 0, { symbol: true }) + ')', amt: U.fmt(t.tax) });
    }
    var paid = t.type === 'invoice' && book.incomingApplied ? book.incomingApplied(t.id) : 0;
    if (paid) { rows.push({ s: '', amt: '' }); rows.push({ s: 'Payments and credits', amt: U.fmt(-paid) }); rows.push({ s: 'Balance due', amt: U.fmt(t.total - paid) }); }
    var perPage = Math.floor((BODY_BOTTOM - BODY_TOP) / BODY_STEP) + 1;
    var chunks = []; for (var i = 0; i < rows.length || !chunks.length; i += perPage) chunks.push(rows.slice(i, i + perPage));

    return chunks.map(function (chunk, pi) {
      var ops = [], last = pi === chunks.length - 1;
      // company block (optional logo above it)
      if (co.logo) ops.push({ t: 'image', x: 37, y: 33.4, w: 200, h: 27.6, src: co.logo, fit: 'left' }); // reference logo box: 37, 33.4, height 27.6 pt
      var lines = [co.legalName || co.name].concat(String(co.address || '').split(/\r?\n/).filter(Boolean));
      var base = [66.72, 83.04, 97.2], xs = [40.08, 39.12, 39.12];
      lines.forEach(function (s, k) { txt(ops, k < 3 ? xs[k] : 39.12, k < 3 ? base[k] : 97.2 + (k - 2) * 14.16, s, TIMES, 12); });
      var y = (lines.length < 3 ? base[lines.length - 1] : 97.2 + (lines.length - 3) * 14.16) + 16.32;
      if (co.email) { txt(ops, 38.16, y, 'Email - ' + co.email, TIMES, 12, 'left', { underline: true }); y += 16.08; }
      if (co.phone) { txt(ops, 36.48, y, 'Tel # ' + co.phone, TIMES, 12); y += 16.08; }
      if (co.ein) { txt(ops, 36.48, y, 'EIN ' + co.ein, TIMES, 12); }
      // title and Date | Invoice # box
      txt(ops, 570.4, 45.12, title, ARIALB, 21.12, 'right');
      box(ops, 427.4, 56.6, 504.0, 76.6); box(ops, 427.4, 76.6, 504.0, 93.6); box(ops, 503.0, 56.6, 574.3, 76.6); box(ops, 503.0, 76.6, 574.3, 93.6);
      txt(ops, 465.7, 69.6, 'Date', ARIAL, 9.12, 'center'); txt(ops, 538.65, 69.6, noLabel, ARIAL, 9.12, 'center');
      txt(ops, 465.7, 88.08, L.date(t.date), TIMES, 9.12, 'center'); txt(ops, 538.65, 88.08, t.number || '', TIMES, 9.12, 'center');
      if (t.type === 'invoice' && t.dueDate && t.dueDate !== t.date) txt(ops, 574.3, 106, 'Due ' + L.date(t.dueDate) + (t.terms ? ' · Net ' + t.terms : ''), TIMES, 9.12, 'right');
      // Bill To
      box(ops, 40.6, 162.0, 288.0, 180.0); txt(ops, 43.68, 172.08, t.type === 'creditMemo' ? 'Customer' : 'Bill To', ARIAL, 9.12);
      box(ops, 40.6, 189.1, 288.0, 279.1);
      var addr = [c.name || ''].concat(c.company && c.company !== c.name ? [c.company] : [], String(c.address || '').split(/\r?\n/).filter(Boolean));
      var ay = 199.2;
      addr.forEach(function (s) { L.wrap(s, 9.12, TIMES, 288 - 43.68 - 4).forEach(function (w) { if (ay <= 275) txt(ops, 43.68, ay, w, TIMES, 9.12); ay += 10.8; }); });
      // Description | Amount
      box(ops, 36.0, 324.0, 427.4, 346.6); box(ops, 427.4, 324.0, 575.0, 346.6);
      txt(ops, 231.7, 338.16, 'Description', ARIAL, 9.12, 'center'); txt(ops, 528.9, 338.16, 'Amount', ARIAL, 9.12, 'right'); // as on the reference: right of centre
      box(ops, 36.0, 346.6, 427.4, 693.1); box(ops, 427.4, 346.6, 575.0, 693.1);
      chunk.forEach(function (r, k) {
        var by = BODY_TOP + k * BODY_STEP;
        if (r.s) txt(ops, DESC_X, by, r.s, TIMES, 9.12);
        if (r.amt) txt(ops, AMT_R, by, r.amt, TIMES, 9.12, 'right');
      });
      // footer
      box(ops, 36.0, 693.1, 427.4, 729.1); box(ops, 427.4, 693.1, 576.0, 729.1);
      txt(ops, 39.12, 714.0, last ? (t.message !== undefined ? t.message : 'Thank you for your business.') : 'Continued on the next page.', TIMES, 9.12);
      if (last) { txt(ops, 439.44, 716.64, 'Total', ARIALB, 16.08); txt(ops, 572.9, 718.32, U.fmt(t.total, { symbol: true }), TIMES, 9.12, 'right'); }
      if (chunks.length > 1) txt(ops, 576, 745, 'Page ' + (pi + 1) + ' of ' + chunks.length, TIMES, 9.12, 'right');
      return ops;
    });
  };

  /* ---------- renderers ---------- */
  var FAMILY = { times: "'Times New Roman', Times, 'Liberation Serif', serif", arial: "Arial, Helvetica, 'Liberation Sans', sans-serif", arialb: "Arial, Helvetica, 'Liberation Sans', sans-serif" };
  var xmlEsc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  /** One page as SVG (612 × 792 user units = points). */
  /**
   * Checks on US Letter voucher check stock (1.14): the check in the top third, two stubs below.
   * Only the fill-in fields are printed (the stock carries the bank details and MICR line).
   * opts.dx / opts.dy nudge everything (points) to line up with the stock; opts.companyBlock prints the payer.
   */
  L.checkPages = function (book, list, opts) {
    opts = opts || {};
    var dx = +opts.dx || 0, dy = +opts.dy || 0, co = book.company;
    var txt = function (ops, x, y, s, font, size, align) { ops.push({ t: 'text', x: x + dx, y: y + dy, s: String(s), font: font, size: size, align: align || 'left' }); };
    var line = function (ops, x1, y1, x2, y2) { ops.push({ t: 'line', x1: x1 + dx, y1: y1 + dy, x2: x2 + dx, y2: y2 + dy }); };
    return list.map(function (t) {
      var ops = [], c = book.contactById[t.contactId] || {}, payee = c.name || t.payee || '', amt = t.total;
      var addr = String(c.address || '').split(/\r?\n/).filter(Boolean);
      if (opts.companyBlock !== false) {
        [co.legalName || co.name].concat(String(co.address || '').split(/\r?\n/).filter(Boolean)).slice(0, 4).forEach(function (sx, k) { txt(ops, 36, 42 + k * 11, sx, k ? ARIAL : ARIALB, k ? 8.5 : 10); });
      }
      if (t.number) txt(ops, 576, 42, t.number, ARIALB, 10, 'right');
      txt(ops, 468, 84, L.date(t.date), ARIAL, 10);
      txt(ops, 72, 117, payee, ARIAL, 10);
      txt(ops, 576, 117, '**' + U.fmt(amt), ARIALB, 10.5, 'right');
      var w = U.amountWords(amt), wl = L.wrap(w, 9.5, ARIAL, 440)[0];
      var stars = ''; while (measure(wl + ' ' + stars + '*', 9.5, ARIAL) < 450) stars += '*';
      txt(ops, 36, 143, wl + (stars ? ' ' + stars : ''), ARIAL, 9.5);
      [payee].concat(addr).slice(0, 5).forEach(function (sx, k) { txt(ops, 72, 170 + k * 11, sx, ARIAL, 9); });
      if (t.memo) txt(ops, 58, 228, String(t.memo).slice(0, 60), ARIAL, 9);
      // two stubs: payee, date, number, what was paid, total
      [270, 532].forEach(function (y0) {
        txt(ops, 36, y0, payee, ARIALB, 10); txt(ops, 400, y0, L.date(t.date), ARIAL, 9); if (t.number) txt(ops, 576, y0, t.number, ARIAL, 9, 'right');
        line(ops, 36, y0 + 6, 576, y0 + 6);
        var rows = [];
        if (t.type === 'billPayment') (t.applications || []).forEach(function (a) { var bl = book.txById[a.txnId]; if (bl) rows.push([L.date(bl.date), 'Bill ' + (bl.number || ''), U.fmt(bl.total), U.fmt(a.amount)]); });
        else (t.lines || []).forEach(function (l) { rows.push(['', (book.accById[l.accountId] || {}).name || '', l.description || '', U.fmt(l.amount)]); });
        txt(ops, 36, y0 + 20, t.type === 'billPayment' ? 'Date' : '', ARIALB, 8); txt(ops, 110, y0 + 20, t.type === 'billPayment' ? 'Bill' : 'Account', ARIALB, 8);
        txt(ops, 300, y0 + 20, t.type === 'billPayment' ? 'Original amount' : 'Memo', ARIALB, 8); txt(ops, 576, y0 + 20, 'Amount', ARIALB, 8, 'right');
        rows.slice(0, 16).forEach(function (r, k) {
          var y = y0 + 33 + k * 11.5;
          txt(ops, 36, y, r[0], ARIAL, 8.5); txt(ops, 110, y, String(r[1]).slice(0, 34), ARIAL, 8.5); txt(ops, 300, y, String(r[2]).slice(0, 40), ARIAL, 8.5); txt(ops, 576, y, r[3], ARIAL, 8.5, 'right');
        });
        if (rows.length > 16) txt(ops, 110, y0 + 33 + 16 * 11.5, '… and ' + (rows.length - 16) + ' more', ARIAL, 8.5);
        line(ops, 420, y0 + 226, 576, y0 + 226);
        txt(ops, 420, y0 + 238, (book.accById[t.accountId] || {}).name || '', ARIAL, 8.5); txt(ops, 576, y0 + 238, U.fmt(amt, { symbol: true }), ARIALB, 9, 'right');
      });
      return ops;
    });
  };

  /**
   * Recipient statements for Forms 1099-NEC / 1099-MISC (1.14): a plain-paper substitute "Copy B — For Recipient",
   * which payers may furnish instead of the official form (Pub. 1179). Not for filing with the IRS (Copy A).
   */
  L.stmt1099Pages = function (book, rows, year) {
    var co = book.company, ca = String(co.address || '').split(/\r?\n/).filter(Boolean), pages = [];
    var txt = function (ops, x, y, s, font, size, align) { ops.push({ t: 'text', x: x, y: y, s: String(s), font: font, size: size, align: align || 'left' }); };
    var box = function (ops, x1, y1, x2, y2) { ops.push({ t: 'line', x1: x1, y1: y1, x2: x2, y2: y1 }, { t: 'line', x1: x1, y1: y2, x2: x2, y2: y2 }, { t: 'line', x1: x1, y1: y1, x2: x1, y2: y2 }, { t: 'line', x1: x2, y1: y1, x2: x2, y2: y2 }); };
    var mask = function (tin) { var s = String(tin || ''); return s.length > 4 ? s.replace(/\d(?=.*\d{4})/g, 'X') : s; };
    rows.forEach(function (r) {
      [['1099-NEC', 'Nonemployee Compensation', [['1', 'Nonemployee compensation', r.nec1]]],
       ['1099-MISC', 'Miscellaneous Information', [['1', 'Rents', r.misc1], ['2', 'Royalties', r.misc2], ['3', 'Other income', r.misc3], ['6', 'Medical and health care payments', r.misc6], ['10', 'Gross proceeds paid to an attorney', r.misc10]]]].forEach(function (f) {
        if (!f[2].some(function (x) { return x[2]; })) return;
        var ops = [];
        txt(ops, 36, 56, 'Form ' + f[0] + ' — ' + f[1], ARIALB, 15); txt(ops, 576, 56, 'Tax year ' + year, ARIALB, 12, 'right');
        txt(ops, 36, 74, 'Copy B — For Recipient', ARIALB, 10); txt(ops, 576, 74, 'Substitute statement', ARIAL, 9, 'right');
        box(ops, 36, 90, 306, 196); txt(ops, 42, 102, "PAYER'S name, street address, city, state, ZIP code, and telephone no.", ARIAL, 7);
        [co.legalName || co.name].concat(ca, [co.phone || '']).filter(Boolean).slice(0, 6).forEach(function (sx, k) { txt(ops, 42, 118 + k * 12, sx, ARIAL, 10); });
        box(ops, 306, 90, 441, 122); txt(ops, 312, 101, "PAYER'S TIN", ARIAL, 7); txt(ops, 312, 115, co.ein || '', ARIAL, 10);
        box(ops, 441, 90, 576, 122); txt(ops, 447, 101, "RECIPIENT'S TIN", ARIAL, 7); txt(ops, 447, 115, mask(r.tin), ARIAL, 10);
        box(ops, 36, 196, 306, 290); txt(ops, 42, 208, "RECIPIENT'S name, street address, city, state, and ZIP code", ARIAL, 7);
        [r.name, r.address.line1, r.address.line2, [r.address.city, r.address.state].filter(Boolean).join(', ') + ' ' + r.address.zip].filter(function (x) { return String(x).trim(); }).forEach(function (sx, k) { txt(ops, 42, 224 + k * 12, sx, ARIAL, 10); });
        var y = 122;
        f[2].forEach(function (bx) { if (!bx[2] && f[0] === '1099-MISC') return; box(ops, 306, y, 576, y + 34); txt(ops, 312, y + 11, bx[0] + '  ' + bx[1], ARIAL, 7.5); txt(ops, 570, y + 27, U.fmt(bx[2], { symbol: true }), ARIALB, 11, 'right'); y += 34; });
        L.wrap('This is important tax information and is being furnished to the IRS. If you are required to file a return, a negligence penalty or other sanction may be imposed on you if this income is taxable and the IRS determines that it has not been reported. Keep for your records.', 8, ARIAL, 540)
          .forEach(function (sx, k) { txt(ops, 36, Math.max(y, 290) + 24 + k * 10, sx, ARIAL, 8); });
        txt(ops, 36, 760, 'Prepared by VaultBook from ' + (co.name || '') + "'s books. File Copy A with the IRS through IRIS or on the official form; this copy is for the recipient.", ARIAL, 7);
        pages.push(ops);
      });
    });
    return pages;
  };

  L.svg = function (ops, attrs) {
    var out = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 612 792" ' + (attrs || '') + '><rect width="612" height="792" fill="#fff"/>'];
    ops.forEach(function (o) {
      if (o.t === 'line') out.push('<line x1="' + o.x1 + '" y1="' + o.y1 + '" x2="' + o.x2 + '" y2="' + o.y2 + '" stroke="#000" stroke-width="' + LW + '"/>');
      else if (o.t === 'image') out.push('<image href="' + xmlEsc(o.src) + '" x="' + o.x + '" y="' + o.y + '" width="' + o.w + '" height="' + o.h + '" preserveAspectRatio="xMinYMid meet"/>');
      else {
        var w = measure(o.s, o.size, o.font), x0 = o.align === 'right' ? o.x - w : o.align === 'center' ? o.x - w / 2 : o.x;
        // textLength pins each string to the PDF metrics, so line ends match the PDF even when the screen font differs slightly
        out.push('<text x="' + x0.toFixed(2) + '" y="' + o.y + '" font-family="' + FAMILY[o.font] + '" font-size="' + o.size + '"' + (o.font === ARIALB ? ' font-weight="700"' : '') +
          (o.s.length > 1 ? ' textLength="' + w.toFixed(2) + '" lengthAdjust="spacingAndGlyphs"' : '') + ' xml:space="preserve">' + xmlEsc(o.s) + '</text>');
        if (o.underline) out.push('<line x1="' + x0.toFixed(2) + '" y1="' + (o.y + 1.44) + '" x2="' + (x0 + w).toFixed(2) + '" y2="' + (o.y + 1.44) + '" stroke="#000" stroke-width="0.48"/>');
      }
    });
    out.push('</svg>');
    return out.join('');
  };
  /**
   * The document as a PDF (Uint8Array). images: { dataURL: { bytes (JPEG), width, height } } prepared by the caller
   * (the browser converts the logo to JPEG on a canvas); images that are missing are left out.
   */
  L.pdf = function (pages, images, title) {
    var P = OB.pdf, d = P.create({ width: L.W, height: L.H });
    pages.forEach(function (ops) {
      d.addPage();
      ops.forEach(function (o) {
        if (o.t === 'line') d.line(o.x1, o.y1, o.x2, o.y2, { width: LW });
        else if (o.t === 'image') {
          var im = images && images[o.src]; if (!im) return;
          var k = Math.min(o.w / im.width, o.h / im.height), w = im.width * k, h = im.height * k;
          d.image(o.x, o.y + (o.h - h) / 2, w, h, im);
        } else {
          var tw = d.text(o.x, o.y, o.s, { size: o.size, font: PDFFONT[o.font], align: o.align, baseline: true });
          if (o.underline) { var x0 = o.align === 'right' ? o.x - tw : o.align === 'center' ? o.x - tw / 2 : o.x; d.line(x0, o.y + 1.44, x0 + tw, o.y + 1.44, { width: 0.48 }); }
        }
      });
    });
    return d.output({ title: title || 'Invoice' });
  };
})(typeof window !== 'undefined' ? window : globalThis);
