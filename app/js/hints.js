/* VaultBook — extra help for bank lines with no suggestion (1.45). Two sources, chosen in the bank feed:
 *  clients: what the firm's other clients' books used for the same payee or bank wording (learned on this computer;
 *           only merchant words and account names are kept — no amounts, dates or customers);
 *  common:  a built-in list of well-known US merchants and the kind of expense they usually are.
 * Suggestions only: the user adds each line, nothing posts by itself. Only income and expense accounts are suggested. */
(function (root) {
  'use strict';
  var OB = root.OB, I = OB.importer, S = OB.schema, H = OB.hints = {};
  var STOP = /^(THE|LLC|INC|CO|LTD|CORP|AND|OF|DES|ID|INDN|ACH|PPD|CCD|WEB|POS|DEBIT|CREDIT|CARD|CHECKCARD|PURCHASE|ONLINE|PAYMENT|PAYMENTS|PMT|TRANSFER|FROM|TO|RECURRING|WWW|COM|NET|ORG|HTTPS|HTTP)$/;
  function words(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9& ]/g, ' ').split(/\s+/).filter(function (w) { return w.length >= 2 && !/^\d+$/.test(w) && !STOP.test(w); }); }
  // bank wording that names no payee: never learned as one
  var NOT_PAYEE = /^(CHK|CHECK|CK|DEPOSIT|DEP|MOBILE|REMOTE|BRANCH|ATM|CASH|WITHDRAWAL|WITHDRWL|WIRE|BANKING|INTERNET|ZELLE|VENMO|PAYPAL|CASH APP|SQUARE|STRIPE|INTEREST|FEE|SERVICE|MISC|VOID|REVERSAL|ADJUSTMENT|BALANCE|OVERDRAFT|EXTERNAL|INTERNAL|BOOK|TFR|XFER)\b/;
  function has(desc, key) { return (' ' + desc + ' ').indexOf(' ' + key + ' ') >= 0; } // whole words, in order
  function cls(a) { var t = a && S.TYPE[a.type]; return t ? t.cls : ''; }
  function pl(a) { return a && a.active !== false && (cls(a) === 'income' || (cls(a) === 'expense' && a.type !== 'cogs')); }

  /** What one company's books teach: { name, pairs: [[key, 'in'|'out', [[account name, class, uses], …]], …] }.
   *  key = the payee's name words, else the merchant words of the memo. One bank or card line and one P&L line only. */
  H.learn = function (book) {
    var m = {};
    book.transactions.forEach(function (t) {
      if (t.status && t.status !== 'posted') return;
      var ps = book.buildSplitsSafe(t), cash = ps.filter(function (p) { var a = book.accById[p.accountId]; return a && (a.type === 'bank' || a.type === 'cc'); });
      if (cash.length !== 1 || ps.length !== 2) return;
      var other = book.accById[ps[0] === cash[0] ? ps[1].accountId : ps[0].accountId]; if (!pl(other)) return;
      var c = t.contactId && book.contactById[t.contactId], key = words(c ? c.name : I.ruleTextFor(t.memo)).slice(0, 4).join(' ');
      if (H.notPayee(key)) return;
      var k = key + '|' + (cash[0].amount > 0 ? 'in' : 'out'), v = other.name.toLowerCase() + '|' + cls(other);
      (m[k] = m[k] || {})[v] = (m[k][v] || 0) + 1;
    });
    return { name: (book.company && book.company.name) || '', pairs: Object.keys(m).map(function (k) {
      var p = k.split('|'); return [p[0], p[1], Object.keys(m[k]).map(function (v) { var q = v.split('|'); return [q[0], q[1], m[k][v]]; })];
    }) };
  };

  /** This client's account for an account name and class seen elsewhere: same name, else the most shared words. */
  function sameAccount(book, name, c) {
    var list = book.accounts.filter(function (a) { return pl(a) && cls(a) === c; });
    var exact = list.find(function (a) { return a.name.toLowerCase() === name; }); if (exact) return exact;
    var want = words(name).filter(function (w) { return w.length >= 4; }), best = null, top = 0, tie = false;
    list.forEach(function (a) {
      var n = words(a.name).filter(function (w) { return want.indexOf(w) >= 0; }).length;
      if (n > top) { top = n; best = a; tie = false; } else if (n && n === top) tie = true;
    });
    return top && !tie ? best : null;
  }

  // first word of each learned key -> [pair, client number, id], built once per firm list
  function index(firm) {
    if (!firm) return {};
    if (firm._ix) return firm._ix;
    var ix = {}, n = 0;
    firm.forEach(function (f, fi) { (f.pairs || []).forEach(function (p) { var w = p[0].split(' ')[0]; (ix[w] = ix[w] || []).push([p, fi, n++]); }); });
    try { Object.defineProperty(firm, '_ix', { value: ix }); } catch (e) { /* frozen list: no cache */ }
    return ix;
  }
  function uses(book, a) { return (book.splitIndex()[a.id] || []).length; }
  // a parent account with exactly one active sub-account and no postings of its own: post to the sub-account
  function leaf(book, a) {
    if (a && uses(book, a)) return a;
    var kids = a ? book.accounts.filter(function (x) { return x.parentId === a.id && x.active !== false; }) : [];
    return kids.length === 1 ? leaf(book, kids[0]) : a;
  }

  /** Suggestion from the other clients (firm = H.learn results of the other companies), or null. */
  H.fromClients = function (book, line, firm) {
    var desc = words(line.description).join(' '), dir = line.amount > 0 ? 'in' : 'out', votes = {}, who = {}, keys = {}, n = 0;
    var ix = index(firm), seen = {};
    desc.split(' ').forEach(function (w) {
      (ix[w] || []).forEach(function (e) {
        var p = e[0], fi = e[1];
        if (seen[e[2]] || p[1] !== dir || !has(desc, p[0])) return;
        seen[e[2]] = 1;
        keys[p[0]] = 1;
        p[2].forEach(function (x) { var v = x[0] + '|' + x[1]; votes[v] = (votes[v] || 0) + x[2]; n += x[2]; (who[v] = who[v] || {})[fi] = 1; });
      });
    });
    var ids = Object.keys(votes).sort(function (a, b) { return votes[b] - votes[a]; }); if (!ids.length) return null;
    var top = ids[0], share = votes[top] / n; if (votes[top] < 2 || share < 0.7) return null;   // mixed habits: no guess
    var q = top.split('|'), a = leaf(book, sameAccount(book, q[0], q[1])); if (!a) return null;
    var k = Object.keys(who[top]).length;
    return { categoryId: a.id, contactId: '', source: 'clients', extra: true,
      reason: 'Other clients: ' + votes[top] + ' of ' + n + ' times for ' + Object.keys(keys).join(', ') + ' (' + k + ' other client' + (k === 1 ? '' : 's') + ')' };
  };

  /* Kinds of expense and the account names each goes to (first that exists wins); the merchant names are in js/merchants.js.
     shortcut: a fixed list, money out only; grow it from the lines users still categorise by hand. */
  var KINDS = {
    fuel: ['Fuel', [/fuel|gasoline/, /\bcar\b|truck|auto(?!mat)|vehicle/]],
    vehicle: ['Vehicle', [/\bcar\b|truck|auto(?!mat)|vehicle/]],
    meals: ['Meals', [/meal/, /entertain/]],
    travel: ['Travel', [/travel/, /lodging|airfare|hotel/]],
    utilities: ['Utilities', [/utilit/, /telephone|phone|internet|cable/]],
    phone: ['Phone and internet', [/telephone|phone/, /internet|cable/, /utilit/]],
    software: ['Software', [/subscription/, /software/, /dues/, /computer|internet|technology/, /office/]],
    supplies: ['Supplies', [/office suppl/, /^(?!.*(medical|dental|lab|clinic)).*suppl/, /office/]],
    shipping: ['Shipping', [/postage|shipping|delivery|freight|courier|mail/, /office/]],
    advertising: ['Advertising', [/advertis|marketing|promotion/]],
    repairs: ['Repairs', [/repair|maintenance/]],
    insurance: ['Insurance', [/insurance/]],
    bankfees: ['Bank fees', [/service charge|bank (service|charge|fee)/, /bank/, /merchant fee/]]
  };
  // longest names first, so UBER EATS wins over UBER and GOOGLE ADS over GOOGLE
  var NAMES = [];
  Object.keys(KINDS).forEach(function (k) { String((OB.merchants || {})[k] || '').split('|').forEach(function (n) { NAMES.push([words(n).join(' '), k]); }); });
  NAMES = NAMES.filter(function (x) { return x[0]; }).sort(function (a, b) { return b[0].length - a[0].length; });

  /** Suggestion from the common-merchant list, or null (money out only). */
  H.fromCommon = function (book, line) {
    if (line.amount > 0) return null;
    var desc = words(line.description).join(' '), hit = NAMES.find(function (x) { return has(desc, x[0]); }); if (!hit) return null;
    var kind = KINDS[hit[1]], list = book.accounts.filter(function (a) { return pl(a) && cls(a) === 'expense'; }), a = null;
    kind[1].some(function (re) {   // the matching account this company uses most (chart order on a tie)
      list.forEach(function (x) { if (re.test(x.name.toLowerCase()) && (!a || uses(book, x) > uses(book, a))) a = x; });
      return a;
    });
    a = leaf(book, a);
    return a ? { categoryId: a.id, contactId: '', source: 'common', extra: true, reason: 'Common merchant: ' + hit[0] + ' is usually ' + kind[0] } : null;
  };

  H.words = words;
  // also no payee: cash at an ATM, wires and book transfers wherever they appear in the wording
  var NO_PAYEE_ANY = /\b(ATM|WIRE|MEMOWIRE|TYPEBOOK|WITHDRAWAL|WITHDRWL|CASH|TRANSFER|XFER|TFR)\b/;
  H.notPayee = function (key) { return !key || NOT_PAYEE.test(key) || NO_PAYEE_ANY.test(key) || key.length < 4; };
  /** The contact whose every name word is in the bank text (longest name wins), or null. */
  /** The part of a bank description that can name the payee: upper case, the payee first, bank noise removed. */
  var PROC = /^(TST|SQ|PY|PYL|SP|PP|PAYPAL|DNH|EB|FS|WPY|CKO|TOAST)\s*\*\s*/;
  H.payeeText = function (desc) {
    var s = String(desc || ''), cut = s.lastIndexOf(' — ');   // the feed shows "Short name — FULL BANK TEXT": read the full text
    if (cut >= 0) s = s.slice(cut + 3);
    s = s.toUpperCase();
    var m = /\b(?:ORIG|BNF)\s*:\s*(.+?)\s+(?:ID|SND BK|BNF BK|PMT DET|RFB|OBI|BNF)\s*:/.exec(s) || /\bPAYMENT (?:TO|FROM)\s+(.+?)(?:\s+CONF\s*#|\s+FOR\b|$)/.exec(s);
    if (m) return m[1].trim();
    if (/^WIRE TYPE/.test(s)) return s;                                                                         // a wire names the party anywhere in its text
    s = s.replace(/\b(DES|ID|INDN|CO ID|TRACE|PPD|CCD|REF)\s*:.*$/, '');                                        // ACH tail: it holds the company's own name
    s = s.replace(/^(MOBILE\s+)?(PURCHASE|CHECKCARD|CHECK CARD|DEBIT CARD|POS)(\s+REFUND)?(\s+\d{4})?\s+/, '');   // card prefix and its date
    s = s.replace(/\s+\d\d\/\d\d\s+#\d+.*$/, '');                                                             // "NAME 01/04 #000008163 PURCHASE NAME CITY"
    s = s.replace(PROC, '').replace(/\bCKCD\b.*$/, '').replace(/\bX{4,}\S*/g, ' ');
    return s.replace(/\s+/g, ' ').trim();
  };
  var CORP = /^(THE|LLC|INC|CO|LTD|CORP|AND|OF)$/, LOOSE = /^(TRANSFER|EXPRESS|MOBILE|PAYMENT|DEPOSIT|ONLINE|PURCHASE|SERVICE|SERVICES|INTERNATIONAL)$/;
  function tok(s) { return String(s || '').toUpperCase().replace(/['’]/g, '').replace(/[^A-Z0-9]+/g, ' ').trim().split(' ').filter(function (w) { return w && !CORP.test(w); }); }
  function vendorIndex(book) {   // names with their words run together ("CIRCLEK"), longest first; rebuilt when the contact list changes
    var ix = book._vendorIx;
    if (ix && ix.src === book.contacts && ix.n === book.contacts.length) return ix.list;
    var list = []; book.contacts.forEach(function (c) { if (c.active === false) return; var j = tok(c.name).join(''); if (j.length >= 3) list.push({ c: c, j: j }); });
    list.sort(function (a, b) { return b.j.length - a.j.length; });
    Object.defineProperty(book, '_vendorIx', { value: { src: book.contacts, n: book.contacts.length, list: list }, writable: true, configurable: true, enumerable: false });
    return list;
  }
  H.forgetVendors = function (book) { if (book._vendorIx) book._vendorIx = null; };
  /**
   * The contact a bank line names: { contact, how }. how 'start' = the payee text begins with the name (spaces, dots and
   * apostrophes ignored, so CIRCLEK is Circle K; a name the bank cut short still counts from 8 letters);
   * 'inside' = the whole name appears later in the text (6 letters or more). The longest name wins; start beats inside.
   */
  H.vendorMatch = function (book, desc) {
    var w = tok(H.payeeText(desc)); if (!w.length) return null;
    var P = w.join(''), ends = {}, starts = {}, n = 0;
    w.forEach(function (x) { starts[n] = 1; n += x.length; ends[n] = 1; });
    var list = vendorIndex(book), i, e, inside = null;
    for (i = 0; i < list.length; i++) {
      e = list[i];
      if (P.lastIndexOf(e.j, 0) === 0 ? (ends[e.j.length] || e.j.length >= 8) : (P.length >= 8 && e.j.lastIndexOf(P, 0) === 0)) return { contact: e.c, how: 'start' };
      if (!inside && e.j.length >= 6 && !LOOSE.test(e.j)) { var at = P.indexOf(e.j, 1); while (at > 0 && !(starts[at] && ends[at + e.j.length])) at = P.indexOf(e.j, at + 1); if (at > 0) inside = e.c; }
    }
    return inside ? { contact: inside, how: 'inside' } : null;
  };
  H.vendorIn = function (book, desc) { var m = H.vendorMatch(book, desc); return m ? m.contact : null; };
  /** How many of these lines the source identified: { found, of }. */
  H.coverage = function (book, lines, fn) {
    return { of: lines.length, found: lines.filter(function (l) { return fn(l); }).length };
  };
})(typeof window !== 'undefined' ? window : global);
