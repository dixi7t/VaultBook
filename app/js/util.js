/* OfflineBooks US — utilities. Classic script (no ES modules) so it runs from file://. */
(function (root) {
  'use strict';
  var OB = root.OB = root.OB || {};
  var U = OB.util = {};

  /* ---------- Money: always integer cents internally ---------- */
  U.toCents = function (v) {
    if (v === null || v === undefined || v === '') return 0;
    if (typeof v === 'number') {
      if (!isFinite(v)) throw new Error('Invalid amount');
      return Math.round(v * 100);
    }
    var s = String(v).trim();
    var neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    s = s.replace(/[$,\s]/g, '');
    if (s.charAt(0) === '-') { neg = !neg; s = s.slice(1); }
    if (s.charAt(s.length - 1) === '-') { neg = !neg; s = s.slice(0, -1); }
    if (s === '' || s === '.') return 0;
    if (!/^\d*(\.\d*)?$/.test(s)) throw new Error('Invalid amount: ' + v);
    var parts = s.split('.');
    var whole = parseInt(parts[0] || '0', 10);
    var frac = (parts[1] || '');
    var cents = parseInt((frac + '00').slice(0, 2), 10);
    // round half up on third decimal
    if (frac.length > 2 && parseInt(frac.charAt(2), 10) >= 5) cents += 1;
    var total = whole * 100 + cents;
    return neg ? -total : total;
  };
  U.fromCents = function (c) { return (c || 0) / 100; };
  U.fmt = function (c, opts) {
    opts = opts || {};
    c = c || 0;
    var neg = c < 0; var a = Math.abs(c);
    var whole = Math.floor(a / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    var s = whole + '.' + String(a % 100).padStart(2, '0');
    if (opts.symbol) s = '$' + s;
    if (neg) s = opts.parens ? '(' + s + ')' : '-' + s;
    return s;
  };
  U.fmtPlain = function (c) { // for CSV / inputs: 1234.50
    c = c || 0; var neg = c < 0; var a = Math.abs(c);
    return (neg ? '-' : '') + Math.floor(a / 100) + '.' + String(a % 100).padStart(2, '0');
  };
  /** Split total cents across weights proportionally; result sums exactly to total. */
  U.allocate = function (total, weights) {
    var sum = weights.reduce(function (s, w) { return s + w; }, 0);
    if (sum === 0) return weights.map(function (w, i) { return i === 0 ? total : 0; });
    var out = []; var used = 0;
    for (var i = 0; i < weights.length; i++) {
      if (i === weights.length - 1) { out.push(total - used); break; }
      var v = Math.round(total * weights[i] / sum);
      out.push(v); used += v;
    }
    return out;
  };

  /* ---------- Dates: ISO yyyy-mm-dd strings, local-calendar ---------- */
  /** A date box that redraws the screen: the browser reports a "change" after every digit of the year (0002, 0020, 0202, 2026),
   *  so redrawing at once throws the cursor out mid-typing. The value is kept at once; the redraw waits until the box is left
   *  (or Enter), and a little longer so a click on a button is not lost. */
  U.dateCommit = function (input, keep, redraw) {
    if (!input) return;
    // 1.50.2: Chrome reports no focus for a moment when typing moves from the month to the day, so "not focused" does not
    // mean "picked from the calendar". A change with no key pressed in the last moment is the calendar (or a script).
    // 1.50.3: a typed date that is complete (a real year, 1900-2100) applies by itself after a short pause; the cursor
    // comes back to the box. Half-typed years (0002, 0202) never do.
    var dirty = false, lastKey = 0, timer = null, id = input.id;
    var go = function () {
      clearTimeout(timer); if (!dirty) return; dirty = false;
      var had = typeof document !== 'undefined' && document.activeElement === input;
      redraw();
      if (had && id) setTimeout(function () { var n = document.getElementById(id); if (n && n !== input) n.focus(); }, 0);
    };
    var whole = function (v) { var y = +String(v || '').slice(0, 4); return /^\d{4}-\d\d-\d\d$/.test(v || '') && y >= 1900 && y <= 2100; };
    input.addEventListener('keydown', function (e) { lastKey = Date.now(); clearTimeout(timer); if (e.key === 'Enter') { e.preventDefault(); keep(input.value); dirty = true; go(); } });
    input.addEventListener('change', function () {
      keep(input.value); dirty = true; clearTimeout(timer);
      if (Date.now() - lastKey > 600) go();   // picked from the calendar
      else if (whole(input.value)) timer = setTimeout(go, 700);
    });
    input.addEventListener('blur', function () { setTimeout(function () { if (typeof document === 'undefined' || document.activeElement !== input) go(); }, 180); });
  };

  U.today = function () {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };
  U.isDate = function (s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    var p = s.split('-').map(Number); var d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
    return d.getUTCFullYear() === p[0] && d.getUTCMonth() === p[1] - 1 && d.getUTCDate() === p[2];
  };
  U.parseDate = function (s) { // accepts ISO, M/D/YYYY, M/D/YY, MM-DD-YYYY
    if (!s) return null; s = String(s).trim();
    var m;
    if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return U.ymd(+m[1], +m[2], +m[3]);
    if ((m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/))) {
      var y = +m[3]; if (y < 100) y += 2000;
      return U.ymd(y, +m[1], +m[2]);
    }
    return null;
  };
  /** Typed date shorthand (US month-day order), like TallyPrime's date entry. ref = the date that fills a missing
   *  month or year (default today). Accepts: "june20", "20 jun", "Jun 20, 2026", "0620", "620", "06-20", "6.20",
   *  "6/20", "6/20/26", "062026", "06202026", "2026-06-20", "20" (day of ref's month), "t"/"today", "+3"/"-1" (days).
   *  Returns 'YYYY-MM-DD' or null. */
  var MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  U.smartDate = function (s, ref) {
    ref = U.isDate(ref) ? ref : U.today();
    var ry = +ref.slice(0, 4), rm = +ref.slice(5, 7);
    s = String(s === undefined || s === null ? '' : s).trim().toLowerCase();
    if (!s) return null;
    if (s === 't' || s === 'today') return ref;
    var m;
    if ((m = s.match(/^([+-])\s*(\d{1,4})$/))) return U.addDays(ref, (m[1] === '-' ? -1 : 1) * +m[2]);
    var year = function (y) { if (y === undefined || y === '') return ry; y = +y; return y < 100 ? 2000 + y : y; };
    if ((m = s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/))) return U.ymd(+m[1], +m[2], +m[3]);
    if ((m = s.match(/[a-z]+/))) {   // a month name anywhere: "june20", "20june", "jun 20 26", "sept. 5, 2026"
      var w = m[0], mi = w.length >= 3 ? MON.indexOf(w.slice(0, 3)) : -1;
      if (mi < 0 || (w.length > 3 && 'january february march april may june july august september october november december'.split(' ')[mi].indexOf(w) !== 0 && !(mi === 8 && w === 'sept'))) return null;
      var nums = (s.slice(0, m.index) + ' ' + s.slice(m.index + w.length)).match(/\d+/g) || [];
      if (!nums.length || nums.length > 2) return null;
      var d = +nums[0], y = nums[1];
      if (nums.length === 1 && nums[0].length > 2) { // "june2026"? no day; "jun202026" → 20, 2026
        var t = nums[0]; if (t.length === 4 && +t.slice(0, 2) > 31) return null;
        d = +t.slice(0, 2); y = t.slice(2) || undefined;
        if (t.length === 3) { d = +t.slice(0, 1); y = undefined; if (+t > 31) { d = +t.slice(0, 2); } }
      }
      return U.ymd(year(y), mi + 1, d);
    }
    var parts = s.split(/[\/\-.\s,]+/).filter(Boolean);
    if (parts.some(function (x) { return !/^\d+$/.test(x); })) return null;
    if (parts.length === 1) {
      var n = parts[0];
      if (n.length <= 2) return U.ymd(ry, rm, +n);                                   // day of this month
      if (n.length === 3) return U.ymd(ry, +n.slice(0, 1), +n.slice(1));             // 620 = 6/20
      if (n.length === 4) return U.ymd(ry, +n.slice(0, 2), +n.slice(2));             // 0620
      if (n.length === 6) return U.ymd(year(n.slice(4)), +n.slice(0, 2), +n.slice(2, 4));   // 062026
      if (n.length === 8) return /^(19|20)/.test(n) && +n.slice(4, 6) <= 12 && !U.ymd(+n.slice(4), +n.slice(0, 2), +n.slice(2, 4)) ? U.ymd(+n.slice(0, 4), +n.slice(4, 6), +n.slice(6)) : U.ymd(+n.slice(4), +n.slice(0, 2), +n.slice(2, 4));
      return null;
    }
    if (parts.length === 2) return U.ymd(ry, +parts[0], +parts[1]);
    if (parts.length === 3) return U.ymd(year(parts[2]), +parts[0], +parts[1]);
    return null;
  };
  U.ymd = function (y, m, d) {
    var s = y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    return U.isDate(s) ? s : null;
  };
  U.addDays = function (s, n) {
    var p = s.split('-').map(Number); var d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + n));
    return d.toISOString().slice(0, 10);
  };
  U.addMonths = function (s, n) {
    var p = s.split('-').map(Number);
    var y = p[0], m = p[1] - 1 + n, day = p[2];
    y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
    var last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return U.ymd(y, m + 1, Math.min(day, last));
  };
  U.daysBetween = function (a, b) { // b - a
    var pa = a.split('-').map(Number), pb = b.split('-').map(Number);
    return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 86400000);
  };
  U.monthStart = function (s) { return s.slice(0, 8) + '01'; };
  U.monthEnd = function (s) { return U.addDays(U.addMonths(U.monthStart(s), 1), -1); };
  /** Fiscal year start containing date s, given first month (1-12). */
  U.fiscalYearStart = function (s, firstMonth) {
    firstMonth = firstMonth || 1;
    var y = +s.slice(0, 4), m = +s.slice(5, 7);
    if (m < firstMonth) y -= 1;
    return U.ymd(y, firstMonth, 1);
  };
  U.fmtDate = function (s) {
    if (!s) return '';
    var p = s.split('-'); return p[1] + '/' + p[2] + '/' + p[0];
  };
  U.monthLabel = function (s) {
    var names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return names[+s.slice(5, 7) - 1] + ' ' + s.slice(0, 4);
  };

  /* ---------- IDs ---------- */
  U.uid = function (prefix) {
    var r = '';
    var c = root.crypto;
    if (c && c.getRandomValues) {
      var a = new Uint8Array(10); c.getRandomValues(a);
      for (var i = 0; i < a.length; i++) r += a[i].toString(16).padStart(2, '0');
    } else {
      for (var j = 0; j < 20; j++) r += Math.floor(Math.random() * 16).toString(16);
    }
    return (prefix ? prefix + '_' : '') + Date.now().toString(36) + r;
  };

  /* ---------- SHA-256 (synchronous, UTF-8 input, hex output) — used for the hash-chained audit trail ---------- */
  var SHA_K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
  U.sha256 = function (str) {
    var bytes = [], i, j;
    str = unescape(encodeURIComponent(String(str)));
    for (i = 0; i < str.length; i++) bytes.push(str.charCodeAt(i));
    var bitLen = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    for (i = 7; i >= 0; i--) bytes.push(i > 3 ? 0 : (bitLen >>> (i * 8)) & 0xff); // messages < 512 MB
    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19], W = new Array(64);
    var rotr = function (x, n) { return (x >>> n) | (x << (32 - n)); };
    for (i = 0; i < bytes.length; i += 64) {
      for (j = 0; j < 16; j++) W[j] = (bytes[i + j * 4] << 24) | (bytes[i + j * 4 + 1] << 16) | (bytes[i + j * 4 + 2] << 8) | bytes[i + j * 4 + 3];
      for (j = 16; j < 64; j++) {
        var s0 = rotr(W[j - 15], 7) ^ rotr(W[j - 15], 18) ^ (W[j - 15] >>> 3), s1 = rotr(W[j - 2], 17) ^ rotr(W[j - 2], 19) ^ (W[j - 2] >>> 10);
        W[j] = (W[j - 16] + s0 + W[j - 7] + s1) | 0;
      }
      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (j = 0; j < 64; j++) {
        var t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + SHA_K[j] + W[j]) | 0;
        var t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0; H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    return H.map(function (x) { return (x >>> 0).toString(16).padStart(8, '0'); }).join('');
  };

  /* ---------- Hashing (FNV-1a 32 + CRC32) ---------- */
  U.fnv = function (str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(16).padStart(8, '0');
  };
  var crcTable = null;
  U.crc32 = function (bytes) {
    if (!crcTable) {
      crcTable = new Uint32Array(256);
      for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; }
    }
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  };
  /** Stable JSON (sorted keys) so checksums are deterministic. */
  U.stableStringify = function (v) {
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(U.stableStringify).join(',') + ']';
    return '{' + Object.keys(v).sort().filter(function (k) { return v[k] !== undefined; })
      .map(function (k) { return JSON.stringify(k) + ':' + U.stableStringify(v[k]); }).join(',') + '}';
  };
  U.clone = function (o) { return o === undefined ? undefined : JSON.parse(JSON.stringify(o)); };

  /* ---------- CSV ---------- */
  U.parseCSV = function (text) {
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    var rows = [], row = [], field = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      if (q) {
        if (ch === '"') { if (text.charAt(i + 1) === '"') { field += '"'; i++; } else q = false; }
        else field += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') { row.push(field); field = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text.charAt(i + 1) === '\n') i++;
        row.push(field); field = ''; rows.push(row); row = [];
      } else field += ch;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (c) { return String(c).trim() !== ''; }); });
  };
  U.toCSV = function (rows) {
    return rows.map(function (r) {
      return r.map(function (c) {
        var s = c === null || c === undefined ? '' : String(c);
        // neutralize spreadsheet formula injection
        if (/^[=+\-@]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
        return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(',');
    }).join('\r\n');
  };

  /* ---------- Misc ---------- */
  /**
   * Text QuickBooks Desktop can read. Its request reader accepts Latin-1 only and refuses the WHOLE request
   * ("error when parsing the provided XML text stream") on one long dash, curly quote or other character beyond it.
   * Typographic marks become their plain form; anything else outside Latin-1 becomes a space.
   */
  U.qbText = function (s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/[\u2010-\u2015\u2212]/g, '-').replace(/[\u2018\u2019\u201A\u2032]/g, "'").replace(/[\u201C\u201D\u201E\u2033]/g, '"')
      .replace(/\u2026/g, '...').replace(/[\u2022\u00B7]/g, '-').replace(/[\u00A0\u2000-\u200B\u202F]/g, ' ')
      .replace(/[^\x09\x0A\x0D\x20-\x7E\xA1-\xFF]/g, ' ');
  };
  U.esc = function (s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  U.download = function (filename, content, mime) {
    var blob = content instanceof Blob ? content : new Blob([content], { type: mime || 'text/plain' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1500);
  };
  U.safeFileName = function (s) { return String(s).replace(/[^A-Za-z0-9 _.-]+/g, '').trim().replace(/\s+/g, '_') || 'file'; };
  U.sum = function (arr, fn) { var t = 0; for (var i = 0; i < arr.length; i++) t += fn ? fn(arr[i]) : arr[i]; return t; };
  U.byKey = function (arr, key) { var m = {}; arr.forEach(function (x) { m[x[key]] = x; }); return m; };
})(typeof window !== 'undefined' ? window : globalThis);
