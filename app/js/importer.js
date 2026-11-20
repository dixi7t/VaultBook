/* OfflineBooks US — CSV imports (bank transactions, customers/vendors, chart of accounts). */
(function (root) {
  'use strict';
  var OB = root.OB = root.OB || {};
  var U = OB.util, S = OB.schema;
  var I = OB.importer = {};

  /* ---------- 1.20: column detection by score (BF-01) ---------- */
  // Each role scores every header; the best-scoring column wins. Description prefers an exact "Description"
  // and free text over code-like columns such as Chase's Details (DEBIT/CREDIT) or Type (ACH_DEBIT).
  var ROLE = {
    date: [[/^(transaction |posting |post |trans\.? |value |txn )?date$/, 10], [/date/, 6]],
    description: [[/^description$/, 10], [/^(transaction )?(description|narrative|narration|payee|merchant|merchant name|name|particulars)$/, 9], [/desc|narrat|payee|merchant|particular/, 7], [/memo|details|name|remarks/, 4]],
    amount: [[/^(transaction )?amount( \(.*\))?$/, 10], [/^amt$|^value$/, 7]],
    debit: [[/^(debit|debits|withdrawal|withdrawals|money out|paid out|payments?|charges?)( amount)?$/, 10], [/debit|withdraw|money out|paid out/, 7]],
    credit: [[/^(credit|credits|deposit|deposits|money in|paid in)( amount)?$/, 10], [/credit|deposit|money in|paid in/, 7]],
    check: [[/^(check|cheque|chq)( ?(no|number|num|#))?\.?$|check or slip|^ref(erence)?( no| number|#)?\.?$/, 10], [/check|cheque|chq|slip/, 7]],
    balance: [[/^(running |available |ledger )?balance$/, 10], [/balance/, 6]]
  };
  function codeLike(vals) { // few distinct short upper-case tokens (DEBIT, CREDIT, ACH_DEBIT…) = a type column, not a description
    var v = vals.filter(function (x) { return String(x || '').trim(); });
    if (!v.length) return false;
    var d = {}; v.forEach(function (x) { d[String(x).trim().toUpperCase()] = 1; });
    return Object.keys(d).length <= 3 && v.every(function (x) { return /^[A-Z_\-]{2,16}$/.test(String(x).trim()); });
  }
  /** Guess column roles from a header row (and a few sample rows). Returns indexes, -1 = none. */
  I.detectColumns = function (header, sample) {
    var h = header.map(function (x) { return String(x).replace(/^﻿/, '').toLowerCase().trim(); }), rows = (sample || []).slice(0, 20);
    var used = {}, m = {};
    var col = function (i) { return rows.map(function (r) { return r[i]; }); };
    ['date', 'amount', 'balance', 'check', 'debit', 'credit', 'description'].forEach(function (role) {
      var best = -1, bestScore = 0;
      h.forEach(function (name, i) {
        if (used[i]) return;
        var sc = 0; ROLE[role].forEach(function (p) { if (sc < p[1] && p[0].test(name)) sc = p[1]; });
        if (role === 'description' && sc && codeLike(col(i))) sc -= 8;
        if (sc > bestScore) { bestScore = sc; best = i; }
      });
      m[role] = bestScore > 0 ? best : -1; if (m[role] >= 0) used[m[role]] = 1;
    });
    if (m.amount >= 0) { m.debit = -1; m.credit = -1; }
    m.sign = -1; // 1.47.1: a Debit/Credit (Dr/Cr, Withdrawal/Deposit) column that says which way an unsigned amount goes
    if (m.amount >= 0) h.forEach(function (name, i) {
      if (m.sign >= 0 || used[i]) return;
      var v = col(i).filter(function (x) { return String(x || '').trim(); });
      if (v.length && (/^(type|transaction type|txn type|dr ?\/ ?cr|cr ?\/ ?dr|d ?\/ ?c|c ?\/ ?d|debit ?\/ ?credit|credit ?\/ ?debit|details|indicator|sign)$/.test(name) || !name)
        && v.filter(function (x) { return signOf(x); }).length >= v.length * 0.8) m.sign = i;
    });
    if (m.date >= 0 && rows.length) m.dateFormat = I.detectDateFormat(col(m.date)).format;
    return m;
  };

  /* ---------- dates (BF-04) ---------- */
  var MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
  /** Decide MDY / DMY / YMD from the values in a date column; ambiguous = every value could be read both ways. */
  I.detectDateFormat = function (vals) {
    var a = 0, b = 0, n = 0, iso = 0;
    (vals || []).forEach(function (v) {
      var s = String(v || '').trim(), m;
      if (/^\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2}/.test(s)) { iso++; return; }
      if ((m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/))) { n++; if (+m[1] > 12) a++; if (+m[2] > 12) b++; }
    });
    if (iso && !n) return { format: 'YMD', ambiguous: false };
    if (a && !b) return { format: 'DMY', ambiguous: false };
    if (b && !a) return { format: 'MDY', ambiguous: false };
    return { format: 'MDY', ambiguous: n > 0 && !a && !b };
  };
  /** Parse a bank date in the given order; also "3 Nov 2026", "Nov 3, 2026", "03-NOV-26". */
  I.parseDateAs = function (v, fmt) {
    var s = String(v == null ? '' : v).trim(), m, y;
    if (!s) return null;
    if ((m = s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/))) return U.ymd(+m[1], +m[2], +m[3]);
    var yr = function (x) { x = +x; return x < 100 ? x + 2000 : x; };
    if ((m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})(?:\s|T|$)/))) {
      y = yr(m[3]); return fmt === 'DMY' ? U.ymd(y, +m[2], +m[1]) : U.ymd(y, +m[1], +m[2]);
    }
    if ((m = s.match(/^(\d{1,2})[\s\-\/.]+([A-Za-z]{3,9})\.?[\s\-\/.,]+(\d{2,4})/)) && MON[m[2].toLowerCase().slice(0, 3)]) return U.ymd(yr(m[3]), MON[m[2].toLowerCase().slice(0, 3)], +m[1]);
    if ((m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{2,4})/)) && MON[m[1].toLowerCase().slice(0, 3)]) return U.ymd(yr(m[3]), MON[m[1].toLowerCase().slice(0, 3)], +m[2]);
    return null;
  };
  /** +1 money in, -1 money out, 0 unknown, from a type cell: CR / Credit / Deposit / ACH_CREDIT, DR / Debit / Withdrawal… */
  function signOf(v) {
    var w = String(v == null ? '' : v).toLowerCase().split(/[^a-z]+/).filter(Boolean);
    var inn = w.some(function (x) { return /^(cr|c|credit|credits|deposit|deposits|receipt|in)$/.test(x); }), out = w.some(function (x) { return /^(dr|d|debit|debits|withdrawal|withdrawals|withdraw|out)$/.test(x); });
    return inn === out ? 0 : inn ? 1 : -1;
  }
  I.signOf = signOf;
  I.amountOf = function (v) { return amountOf(v); };
  function amountOf(v) { // "12.50 CR" / "7.25 DR" / "1,234.00-" / "(5.00)" / "$1,234"
    var s = String(v == null ? '' : v).trim(), sign = 1, m;
    if ((m = s.match(/^(.*?)\s*(CR|DR|Cr|Dr|cr|dr)\.?$/))) { s = m[1]; sign = /^c/i.test(m[2]) ? 1 : -1; return sign * Math.abs(U.toCents(s)); }
    return U.toCents(s);
  }

  /** Is this a bank export at all? { ok, message } — names what is missing (BF-07). */
  I.checkFile = function (table, mapping) {
    if (!table || !table.length || !table.some(function (r) { return r.some(function (c) { return String(c || '').trim(); }); })) return { ok: false, message: 'The file is empty.' };
    var start = mapping.hasHeader ? 1 : 0, body = table.slice(start).filter(function (r) { return r.some(function (c) { return String(c || '').trim(); }); });
    var miss = [];
    var dates = mapping.date >= 0 ? body.filter(function (r) { return I.parseDateAs(r[mapping.date], mapping.dateFormat); }).length : 0;
    if (mapping.date < 0 || dates < Math.max(1, body.length / 2)) miss.push('a date column');
    var amtCols = [mapping.amount, mapping.debit, mapping.credit].filter(function (i) { return i >= 0; });
    var nums = body.filter(function (r) { return amtCols.some(function (i) { try { return String(r[i] || '').trim() !== '' && !isNaN(amountOf(r[i])); } catch (e) { return false; } }); }).length;
    if (!amtCols.length || nums < Math.max(1, body.length / 2)) miss.push('an amount column (or money in / money out columns)');
    if (miss.length) return { ok: false, message: 'This does not look like a bank or card export: VaultBook could not find ' + miss.join(' or ') + '. Check that you chose the transactions download (CSV) from your bank, or pick the columns below.' };
    return { ok: true, message: '' };
  };

  /**
   * Parse bank rows using a mapping. Returns { rows: [{date, description, amount, checkNo, balance, line}], errors: [] }.
   * amount: positive = money into the account, negative = money out. mapping.dateFormat: 'MDY' (default) | 'DMY' | 'YMD'.
   */
  I.parseBankRows = function (table, mapping, opts) {
    opts = opts || {};
    var rows = [], errors = [];
    var start = mapping.hasHeader ? 1 : 0, fmt = mapping.dateFormat || 'MDY';
    // the type column only decides when the file's amounts carry no minus sign of their own
    var useSign = mapping.sign >= 0 && mapping.amount >= 0 && !table.slice(start).some(function (row) { try { return amountOf(row[mapping.amount]) < 0; } catch (e) { return false; } });
    for (var r = start; r < table.length; r++) {
      var row = table[r], line = r + 1;
      if (!row.some(function (c) { return String(c || '').trim(); })) continue;
      try {
        var date = I.parseDateAs(row[mapping.date], fmt);
        if (!date) { errors.push('Line ' + line + ': unrecognized date "' + (row[mapping.date] || '') + '"'); continue; }
        var amount;
        if (mapping.amount >= 0) { amount = amountOf(row[mapping.amount]); if (useSign && signOf(row[mapping.sign])) amount = signOf(row[mapping.sign]) * Math.abs(amount); }
        else {
          var deb = mapping.debit >= 0 ? Math.abs(amountOf(row[mapping.debit])) : 0;
          var cre = mapping.credit >= 0 ? Math.abs(amountOf(row[mapping.credit])) : 0;
          amount = cre - deb;
        }
        if (opts.invert) amount = -amount;
        if (!amount) { errors.push('Line ' + line + ': zero amount skipped'); continue; }
        var desc = mapping.description >= 0 ? String(row[mapping.description] || '').replace(/\s+/g, ' ').trim() : '';
        var bal = null;
        if (mapping.balance >= 0 && String(row[mapping.balance] || '').trim() !== '') { try { bal = amountOf(row[mapping.balance]); } catch (e) { bal = null; } }
        rows.push({ date: date, description: desc || '(no description)', amount: amount, checkNo: mapping.check >= 0 ? String(row[mapping.check] || '').trim() : '', balance: bal, line: line });
      } catch (e) { errors.push('Line ' + line + ': ' + e.message); }
    }
    return { rows: rows, errors: errors };
  };

  /** Index of the header row: the first of the top 30 rows that names a date and an amount (or money in / out)
   *  column and is followed by a row with a date. 0 when none (headerless files keep the old behavior). */
  I.findHeader = function (table) {
    for (var i = 0; i < Math.min(30, (table || []).length); i++) {
      var row = table[i] || []; if (!row.some(function (c) { return String(c || '').trim(); })) continue;
      var m = I.detectColumns(row, []);
      if (m.date < 0 || (m.amount < 0 && m.debit < 0 && m.credit < 0)) continue;
      var next = table.slice(i + 1, i + 6);
      if (next.some(function (r) { return I.parseDateAs((r || [])[m.date], 'MDY') || I.parseDateAs((r || [])[m.date], 'DMY'); })) return i;
    }
    return 0;
  };
  /** Workbook sheets that hold transactions, most transactions first: [{name, table (from the header row), count}].
   *  sheets: [{name, rows}] — rows as from OB.qbimport.sheetRows (dates as yyyy-mm-dd). Summary sheets drop out. */
  I.pickSheets = function (sheets) {
    var out = [];
    (sheets || []).forEach(function (sh) {
      var rows = sh.rows || [], i = I.findHeader(rows), t = rows.slice(i), m = I.detectColumns(t[0] || [], t.slice(1));
      if (m.date < 0 || (m.amount < 0 && m.debit < 0 && m.credit < 0)) return;
      m.hasHeader = true; var n = I.parseBankRows(t, m).rows.length;
      if (n) out.push({ name: sh.name, table: t, count: n });
    });
    return out.sort(function (a, b) { return b.count - a.count; });
  };

  /** Running-balance check (BF-08): works for oldest-first and newest-first files.
   *  Returns { hasBalance, mismatches: [line numbers], endingBalance, endingDate }. */
  I.checkBalances = function (rows) {
    var withBal = rows.filter(function (r) { return r.balance !== null && r.balance !== undefined; });
    if (withBal.length < 2 || withBal.length !== rows.length) return { hasBalance: withBal.length > 0 && withBal.length === rows.length, mismatches: [], endingBalance: withBal.length ? withBal[0].balance : null, endingDate: withBal.length ? withBal[0].date : '' };
    var bad = function (list) { var out = []; for (var i = 1; i < list.length; i++) if (list[i - 1].balance + list[i].amount !== list[i].balance) out.push(list[i].line); return out; };
    var fwd = bad(rows), rev = bad(rows.slice().reverse()), newestFirst = rev.length < fwd.length || (rev.length === fwd.length && rows[0].date > rows[rows.length - 1].date);
    var last = newestFirst ? rows[0] : rows[rows.length - 1];
    return { hasBalance: true, mismatches: newestFirst ? rev : fwd, endingBalance: last.balance, endingDate: last.date, newestFirst: newestFirst };
  };

  /** Text for a rule suggested from a bank line (BF-02): the merchant words, without processor prefixes,
   *  store numbers, dates, ACH tails or locations. '' when nothing usable is left (e.g. "DEBIT"). */
  I.ruleTextFor = function (desc) {
    var s = String(desc || '').toUpperCase();
    s = s.replace(/\b(DES|ID|INDN|CO ID|TRACE|PPD|CCD|WEB|REF)\s*:.*$/, '');               // ACH tails
    s = s.replace(/^(SQ|TST|SP|PP|PAYPAL|POS|DEBIT CARD|CHECKCARD|CHECK CARD|PURCHASE|ACH|ONLINE|RECURRING|CARD)\s*\*?\s*/, '');
    s = s.replace(/\*.*$/, ' ').replace(/#\s*\d+/g, ' ').replace(/\b[\d\-\/\.]{3,}\b.*$/, ' ').replace(/\b\d+\b/g, ' ');
    s = s.replace(/\s+[A-Z]{2}$/, '').replace(/\s+/g, ' ').trim();
    if (/^(DEBIT|CREDIT|DEPOSIT|WITHDRAWAL|CHECK|PAYMENT|TRANSFER|ACH|POS|FEE)?$/.test(s)) return '';
    return s.split(' ').slice(0, 3).join(' ').replace(/[^A-Z0-9&' ]/g, '').trim();
  };

  /** Stable fingerprint per row; identical rows within one file get an occurrence counter. */
  I.assignHashes = function (accountId, rows) {
    var seen = {};
    rows.forEach(function (r) {
      var base = accountId + '|' + r.date + '|' + r.amount + '|' + r.description.toLowerCase().replace(/\s+/g, ' ');
      seen[base] = (seen[base] || 0) + 1;
      r.hash = 'imp:' + U.fnv(base) + ':' + U.fnv(base + '#' + seen[base]) + ':' + seen[base];
    });
    return rows;
  };

  /** Pre-fill categories using rules; mark rows already imported (duplicates). */
  I.categorize = function (book, accountId, rows) {
    var existing = {};
    book.transactions.forEach(function (t) { if (t.importHash && t.status === 'posted') existing[t.importHash] = t; });
    var fallbackIn = book.sys('UNCAT_INC'), fallbackOut = book.sys('UNCAT_EXP');
    rows.forEach(function (r) {
      r.duplicate = !!existing[r.hash];
      var rule = book.matchRule(r.description, r.amount);
      r.ruleId = rule ? rule.id : '';
      r.categoryId = rule ? rule.accountId : (r.amount > 0 ? (fallbackIn && fallbackIn.id) : (fallbackOut && fallbackOut.id)) || '';
      r.contactId = rule ? rule.contactId : '';
      // likely match with an existing manually-entered transaction (same account, amount, ±3 days)
      if (!r.duplicate) {
        var sameAmt = (book.splitIndex()[accountId] || []).find(function (e) {
          var sign = book.normalSign(book.accById[accountId]);
          return !e.t.importHash && sign * e.s.amount === r.amount && Math.abs(U.daysBetween(e.t.date, r.date)) <= 3;
        });
        r.possibleMatch = sameAmt ? sameAmt.t.id : '';
      }
      r.include = !r.duplicate && !r.possibleMatch;
    });
    return rows;
  };

  /** Turn a reviewed bank row into a transaction draft. */
  I.rowToDraft = function (book, accountId, r) {
    var acc = book.accById[accountId], cat = book.accById[r.categoryId];
    if (!cat) throw new Error('Choose a category.');
    var isCard = acc.type === 'cc';
    var abs = Math.abs(r.amount);
    var base = { date: r.date, memo: r.description, importHash: r.hash, contactId: r.contactId || '' };
    if (S.HEAD_ACCOUNT_TYPES.transfer.indexOf(cat.type) >= 0 && (cat.type === 'bank' || cat.type === 'cc')) {
      // money movement between two of your own accounts
      return Object.assign(base, { type: 'transfer', contactId: '', amount: abs, accountId: r.amount > 0 ? cat.id : accountId, toAccountId: r.amount > 0 ? accountId : cat.id });
    }
    var line = [{ accountId: cat.id, amount: abs, description: r.description }];
    if (r.amount > 0) return Object.assign(base, { type: isCard ? 'ccCredit' : 'deposit', accountId: accountId, lines: line });
    return Object.assign(base, { type: r.checkNo && !isCard ? 'check' : 'expense', number: r.checkNo || '', accountId: accountId, lines: line });
  };

  /** Customers/vendors from CSV: Name, Company, Email, Phone, Address, Terms */
  I.contactsFromCSV = function (table, kind) {
    if (!table.length) return { items: [], errors: ['The file is empty.'] };
    var h = table[0].map(function (x) { return String(x).toLowerCase().trim(); });
    var col = function (re) { for (var i = 0; i < h.length; i++) if (re.test(h[i])) return i; return -1; };
    var c = { name: col(/^(display )?name|customer|vendor/), company: col(/company/), email: col(/e-?mail/), phone: col(/phone/), address: col(/address/), terms: col(/terms/) };
    if (c.name < 0) return { items: [], errors: ['A "Name" column is required.'] };
    var items = [], errors = [];
    for (var r = 1; r < table.length; r++) {
      var row = table[r];
      var name = String(row[c.name] || '').trim();
      if (!name) { errors.push('Line ' + (r + 1) + ': missing name'); continue; }
      var get = function (k) { return c[k] >= 0 ? String(row[c[k]] || '').trim() : ''; };
      items.push({ kind: kind, name: name, company: get('company'), email: get('email'), phone: get('phone'), address: get('address'), terms: get('terms') ? parseInt(get('terms'), 10) || '' : '' });
    }
    return { items: items, errors: errors };
  };

  /** Accounts from CSV: Number, Name, Type (type label or id), Description */
  I.accountsFromCSV = function (table) {
    if (!table.length) return { items: [], errors: ['The file is empty.'] };
    var h = table[0].map(function (x) { return String(x).toLowerCase().trim(); });
    var col = function (re) { for (var i = 0; i < h.length; i++) if (re.test(h[i])) return i; return -1; };
    var c = { number: col(/number|no\.?$|code/), name: col(/name|account$/), type: col(/type/), description: col(/desc/) };
    if (c.name < 0 || c.type < 0) return { items: [], errors: ['"Name" and "Type" columns are required.'] };
    var items = [], errors = [];
    for (var r = 1; r < table.length; r++) {
      var row = table[r], name = String(row[c.name] || '').trim(), typeRaw = String(row[c.type] || '').trim().toLowerCase();
      if (!name) continue;
      var t = S.ACCOUNT_TYPES.find(function (x) { return x.id === typeRaw || x.label.toLowerCase() === typeRaw || x.label.toLowerCase().indexOf(typeRaw) === 0; });
      if (!t) { errors.push('Line ' + (r + 1) + ': unknown account type "' + row[c.type] + '"'); continue; }
      if (t.id === 'ar' || t.id === 'ap') { errors.push('Line ' + (r + 1) + ': A/R and A/P accounts already exist and cannot be imported.'); continue; }
      items.push({ number: c.number >= 0 ? String(row[c.number] || '').trim() : '', name: name, type: t.id, description: c.description >= 0 ? String(row[c.description] || '') : '' });
    }
    return { items: items, errors: errors };
  };
})(typeof window !== 'undefined' ? window : globalThis);
